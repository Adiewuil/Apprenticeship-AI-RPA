# -*- coding: utf-8 -*-
"""
train.py

修正要点：
1. 生成 gpt2_code 时，不会返回 None；若 data 为空或其他异常，也会返回一个最简脚本字符串，避免 'NoneType' 错误。
2. 其他逻辑与之前保持一致，包括：
   - 当 stepX 有坐标 => 只有匹配>=50 => local => (nogpt/gpt1:执行一次 => 下个step; gpt2:进一步让 gpt判断 => EXECUTE=>下个step, NOEXECUTE=>留在当前step)
   - 当 stepX 没有坐标 => match>=阈值 => 执行一次 => 下个step(或者在gpt2中还要gpt判断)
   - 在 gpt2 脚本中使用 GPT-4 Vision (gpt-4-vision-preview)，对压缩后的截图和条件进行判断。
3. nogpt脚本每次截图都会打印与 stepX-overall.png 的 inliers。
4. gpt1 脚本使用 GPT 生成并去除三空格缩进和多余解释行。
"""
import json
import os
import re
import cv2
import shutil
import base64
import numpy as np
import time
from textwrap import dedent
from openai import OpenAI


client = OpenAI(api_key='YOUR_API')


LOCAL_HALF_SIZE     = 46
OVERALL_THRESH      = 15.0
LOCAL_THRESH        = 10.0
HIGH_MATCH_THRESH   = 50.0

def parse_step_file(txt_path):
    """解析 'Step X: ...' => { '1': [...], '2': [...], ... }"""
    if not os.path.exists(txt_path):
        return {}
    pat = re.compile(r'^Step\s+(\d+):\s*(.*)$')
    result = {}
    with open(txt_path, 'r', encoding='utf-8') as f:
        for line in f:
            line=line.strip()
            if not line:
                continue
            m = pat.match(line)
            if m:
                sid = m.group(1)
                content= m.group(2)
                result.setdefault(sid,[]).append(content)
    return result

def find_xy(cmd: str):
    """在字符串中找 (x,y)"""
    pat = re.compile(r'\((\d+),\s*(\d+)\)')
    m   = pat.search(cmd)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None

def build_data():
    """
    在当前目录 => 找 retry* 文件夹
    若 retry0 中只有 condition.txt 无 motion-record.txt => skip motion
    """
    data = {}
    retry_folders = [d for d in os.listdir('.') if os.path.isdir(d) and d.startswith('retry')]
    if not retry_folders:
        print("[WARNING] No retry* folders found.")
        return data

    condition_map = {}
    skip_retry0_motion = False
    if 'retry0' in retry_folders:
        cond_path = os.path.join('retry0','condition.txt')
        if os.path.exists(cond_path):
            condition_map = parse_step_file(cond_path)
            motion0 = os.path.join('retry0','motion-record.txt')
            if not os.path.exists(motion0):
                skip_retry0_motion = True

    for folder in retry_folders:
        skip_motion = (folder=='retry0' and skip_retry0_motion)
        motion_map  = {}
        if not skip_motion:
            mfile = os.path.join(folder,'motion-record.txt')
            if os.path.exists(mfile):
                motion_map = parse_step_file(mfile)
            else:
                print(f"[INFO] {folder} => no motion-record.txt => skip parse.")
        else:
            print(f"[INFO] Skipping motion-record in {folder} => only condition used.")

        for fname in os.listdir(folder):
            mm = re.match(r'^step(\d+)\.png$', fname, flags=re.IGNORECASE)
            if mm:
                sid = mm.group(1)
                data.setdefault(sid,{
                    'overall_imgs': [],
                    'local_imgs': [],
                    'commands': [],
                    'conditions': []
                })
                full_path = os.path.join(folder,fname)
                data[sid]['overall_imgs'].append((folder, full_path))

                # parse motion
                if sid in motion_map:
                    for c in motion_map[sid]:
                        if c not in data[sid]['commands']:
                            data[sid]['commands'].append(c)
                        xy = find_xy(c)
                        if xy:
                            x,y = xy
                            img= cv2.imread(full_path)
                            if img is not None:
                                h,w = img.shape[:2]
                                half= LOCAL_HALF_SIZE
                                x1= max(0, x- half* 2)
                                x2= min(w, x+half*2)
                                y1= max(0, y-half)
                                y2= min(h, y+half)
                                roi= img[y1:y2, x1:x2]
                                if roi.size>0:
                                    data[sid]['local_imgs'].append((folder, roi))

    # merge condition
    for sid, cond_list in condition_map.items():
        data.setdefault(sid,{
            'overall_imgs':[],
            'local_imgs': [],
            'commands': [],
            'conditions': []
        })
        for c in cond_list:
            if c not in data[sid]['conditions']:
                data[sid]['conditions'].append(c)

    return data

def prepare_train_model_folder():
    out_dir = "train-model"
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    return out_dir

def call_gpt_for_script_gen(prompt_text: str) -> str:
    """
    调用 gpt-4 生成脚本；若错误则返回最小脚本。
    此函数修改了 "role":"system","content" ，
    以让 GPT 输出一个具有完整运行逻辑、可直接运行的 Python 脚本，
    无多余解释语句，并能根据输入条件生成 PyAutoGUI 代码。
    """
    try:
        resp = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an assistant capable of producing a fully runnable Python script "
                        "with no extra explanation. The script must contain a main() function, "
                        "an entry point if __name__=='__main__': main(), and minimal docstrings. "
                        "It should parse the given input logic, and when certain conditions match, "
                        "execute corresponding pyautogui statements. "
                        "Do not include any extraneous commentary or code fences (```). "
                        "Focus only on the essential Python code that can run immediately."
                    )
                },
                {
                    "role": "user",
                    "content": prompt_text
                }
            ]
        )
        code = resp.choices[0].message.content.strip()
        if not code:
            code = "#!/usr/bin/env python\nprint('No script content')"
        return code
    except Exception as e:
        print(f"[ERROR] GPT => {e}")
        return "#!/usr/bin/env python\nprint('GPT call failed')"



#######################
# 1) generate nogpt
#######################
def generate_nogpt_script(data: dict) -> str:
    """
    生成符合上传脚本功能的nogpt脚本。
    如果data为空，则返回一个最小脚本。
    """
    if not data:
        return dedent("""
        #!/usr/bin/env python
        print("No steps => no nogpt script.")
        """).strip()

    #data_json = json.dumps(data, indent=4)  # 将 data 转换为字符串形式并进行缩进
    code = dedent(f"""
    # -*- coding: utf-8 -*-
    import os
    import re
    import time
    import cv2
    import pyautogui
    import numpy as np

    CHECK_INTERVAL   = 5.0
    RANSAC_THRESH    = 5.0
    OVERALL_THRESH   = 15.0
    LOCAL_THRESH     = 10.0
    HIGH_MATCH_THRESH= 50.0

    data = {data}

    def orb_homography_score(img_query, img_train, ransac_thresh=5.0):
        orb = cv2.ORB_create()
        kp_q, des_q = orb.detectAndCompute(img_query, None)
        kp_t, des_t = orb.detectAndCompute(img_train, None)
        if des_q is None or des_t is None or len(des_q)<4 or len(des_t)<4:
            return 0
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(des_q, des_t)
        if len(matches)<4:
            return 0
        matches = sorted(matches, key=lambda x: x.distance)
        pts_q= np.float32([kp_q[m.queryIdx].pt for m in matches])
        pts_t= np.float32([kp_t[m.trainIdx].pt for m in matches])
        H, mask= cv2.findHomography(pts_q, pts_t, cv2.RANSAC, ransac_thresh)
        if H is None:
            return 0
        return mask.ravel().sum()


    def execute_commands_once(cmds):
        executed=False
        if not isinstance(cmds, list):
            cmds=[cmds]
        for c in cmds:
            if executed:
                break
            print(f"[ACTION] => {{c}}")
            xy = re.search(r'\((-?\d+),\s*(-?\d+)\)', c)
            if xy:
                xx= int(xy.group(1))
                yy= int(xy.group(2))
                print(f"pyautogui.click({{xx}}, {{yy}})")
                pyautogui.click(xx, yy)
                executed=True
            elif "key pressed:" in c:
                parts= c.split(".")
                if len(parts)>1:
                    key_char= parts[-1].strip()
                    print(f"pyautogui.press('{{key_char}}')")
                    pyautogui.press(key_char)
                    executed=True
        return executed
    
    def orb_homography_and_bbox(img_query, img_train, ransac_thresh=5.0):
        #使用 SIFT 特征点匹配和单应性矩阵计算图像区域。返回匹配分数和边界框 (x1, y1, x2, y2)
        sift = cv2.SIFT_create()
        kp_q, des_q = sift.detectAndCompute(img_query, None)
        kp_t, des_t = sift.detectAndCompute(img_train, None)
    
        if des_q is None or des_t is None:
            return 0, None, None
    
        bf = cv2.BFMatcher(cv2.NORM_L2, crossCheck=True)
        matches = bf.match(des_q, des_t)
    
        if len(matches) < 4:  # 匹配点不足
            return len(matches), None, None
    
        matches = sorted(matches, key=lambda x: x.distance)
        pts_q = np.float32([kp_q[m.queryIdx].pt for m in matches])
        pts_t = np.float32([kp_t[m.trainIdx].pt for m in matches])
    
        H, mask = cv2.findHomography(pts_q, pts_t, cv2.RANSAC, ransac_thresh)
    
        if H is None:
            return len(matches), None, None
    
        h, w = img_query.shape[:2]
        corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
        transformed_corners = cv2.perspectiveTransform(corners, H)
    
        x_coords = transformed_corners[:, 0, 0]
        y_coords = transformed_corners[:, 0, 1]
        x1, y1, x2, y2 = int(x_coords.min()), int(y_coords.min()), int(x_coords.max()), int(y_coords.max())
    
        # 计算中心点
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
    
        return mask.ravel().sum(), (x1, y1, x2, y2), (cx, cy)


    def main():
        step_ids = sorted(data.keys(), key=lambda x: int(x))  # 排序 Step ID
        idx = 0
    
        while idx < len(step_ids):
            sid = step_ids[idx]  # 当前 Step ID
            info = data[sid]     # 当前 Step 数据
            ov_list = info.get('overall_imgs', [])  # 整体图片列表
            loc_list = info.get('local_imgs', [])   # 局部图片列表
            cmds = info.get('commands', [])         # 对应的命令
            conds = info.get('conditions', [])      # 条件
    
            if not ov_list:
                # 如果整体图片不存在，报错并终止脚本
                print(f"[ERROR] step{{sid}} => no overall images found. Exiting.")
                return
    
            print(f"[INFO] Checking step{{sid}}...")
            sc = pyautogui.screenshot()  # 截取当前屏幕
            scr_cv = cv2.cvtColor(np.array(sc), cv2.COLOR_RGB2BGR)  # 转换为 OpenCV 格式
    
            has_xy = any(re.search(r'\((\d+),\s*(\d+)\)', c) for c in cmds)  # 检查命令是否包含坐标
            matched = False
    
            for (folder, rel_png) in ov_list:
                # 构造整体图片路径
                ovpath = os.path.join('..',  rel_png)
                if not os.path.exists(ovpath):
                    print(f"[ERROR] not found: {{ovpath}} => skip.")
                    continue
    
                ref_ov = cv2.imread(ovpath)
                if ref_ov is None:
                    print(f"[ERROR] cannot read {{ovpath}} => skip.")
                    continue
    
                sc_ov = orb_homography_score(ref_ov, scr_cv, RANSAC_THRESH)  # 计算整体匹配分数
                print(f"   => match with {{ovpath}}, inliers={{sc_ov}}")
    
                if has_xy:
                    if sc_ov >= HIGH_MATCH_THRESH:
                        # 整体匹配成功后，尝试局部匹配
                        for (fld2, localfile) in loc_list:
                            if fld2 != folder:
                                continue  # 只匹配同一个 folder 的局部图片
    
                            local_path = os.path.join( localfile)
                            if not os.path.exists(local_path):
                                print(f"[ERROR] Local file not found: {{local_path}}")
                                continue
    
                            ref_loc = cv2.imread(local_path)
                            if ref_loc is None:
                                print(f"[ERROR] Cannot read local image: {{local_path}}")
                                continue
    
                            # 计算局部匹配分数并找到区域
                            sc_loc, bbox, center = orb_homography_and_bbox(ref_loc, scr_cv, RANSAC_THRESH)
                            print(f"       => local match {{local_path}}, inliers={{sc_loc}}")
    
                            if sc_loc >= LOCAL_THRESH and bbox is not None:
                                # 计算局部区域的中心点
                                (x1, y1, x2, y2) = bbox
                                center_x, center_y = int((x1 + x2) / 2), int((y1 + y2) / 2)
                                cmds_with_coords = [
                                    f"Mouse clicked at ({{center_x}}, {{center_y}}) with Button.left"
                                ]
                                done = execute_commands_once(cmds_with_coords)
                                if done:
                                    matched = True
                                    break
    
                        if matched:
                            break  # 跳出 folder 匹配
    
                else:
                    if sc_ov >= OVERALL_THRESH:
                        # 无坐标的情况，整体匹配成功后直接执行命令
                        done = execute_commands_once(cmds)
                        if done:
                            matched = True
                            break
    
            if matched:
                idx += 1  # 进入下一 Step
            else:
                print(f"   => not matched => wait {{CHECK_INTERVAL}}s.")
                time.sleep(CHECK_INTERVAL)  # 等待下一次匹配
    
        print("[INFO] All steps done. Exit.")


    if __name__ == '__main__':
        main()
    """)
    return code.strip("\n")




###########################
def build_prompt_for_gpt1(data: dict)->str:
    data_info=""
    for sid, val in data.items():
        data_info += f"Step {sid}: overall={len(val['overall_imgs'])}, local={len(val['local_imgs'])}, commands={len(val['commands'])}, conditions={len(val['conditions'])}\\n"

    data_info= data_info[:2000]
    prompt= f"""
Generate "train-pyautogui-gpt1.py"
No extra indentation or explanation
When script runs in train-model => stepX.png in ../retry*
If stepX has coords => match>=50 => local => do once => next
Else => match>=OVERALL_THRESH => do once => next
Data info (partial):
{data_info}
"""
    return dedent(prompt).strip()

###########################
def generate_gpt2_script_code(data: dict)->str:
    """
    若 data 为空 => 返回简短脚本，而不是 None
    """
    if not data:
        return dedent("""
        #!/usr/bin/env python
        print("No steps => empty train-pyautogui-gpt2 script.")
        """).strip()

    code= dedent(f"""
    # -*- coding: utf-8 -*-
    import os
    import re
    import time
    import cv2
    import pyautogui
    import numpy as np
    import base64
    from openai import OpenAI

    client = OpenAI(api_key="YOUR_OPENAI_KEY")

    CHECK_INTERVAL   = 5.0
    RANSAC_THRESH    = 5.0
    OVERALL_THRESH   = 15.0
    LOCAL_THRESH     = 10.0
    HIGH_MATCH_THRESH= 50.0

    data = {data}

    def orb_homography_score(img_query, img_train, ransac_thresh=5.0):
        orb= cv2.ORB_create()
        kp_q, des_q= orb.detectAndCompute(img_query, None)
        kp_t, des_t= orb.detectAndCompute(img_train, None)
        if des_q is None or des_t is None or len(des_q)<4 or len(des_t)<4:
            return 0
        bf= cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches= bf.match(des_q, des_t)
        if len(matches)<4:
            return 0
        matches= sorted(matches, key=lambda x: x.distance)
        pts_q= np.float32([kp_q[m.queryIdx].pt for m in matches])
        pts_t= np.float32([kp_t[m.trainIdx].pt for m in matches])
        H, mask= cv2.findHomography(pts_q, pts_t, cv2.RANSAC, ransac_thresh)
        if H is None:
            return 0
        return mask.ravel().sum()

    def compress_screenshot(img, max_width=400, max_height=300):
        h,w= img.shape[:2]
        scale_w= max_width/ w if w>max_width else 1.0
        scale_h= max_height/h if h>max_height else 1.0
        scale= min(scale_w, scale_h)
        if scale<1.0:
            new_w= int(w*scale)
            new_h= int(h*scale)
            resized= cv2.resize(img,(new_w,new_h))
            return resized
        return img

    def call_gpt_vision(step_id, compressed_img, cond_str):
        # model="gpt-4-vision-preview"
        _, buf= cv2.imencode('.jpg', compressed_img, [cv2.IMWRITE_JPEG_QUALITY,70])
        b64= base64.b64encode(buf).decode('utf-8')
        prompt= f\"\"\"You are GPT-4 Vision. step{{step_id}} conditions:\\n{{cond_str}}\\nBelow is a compressed screenshot base64:\\n{{b64}}\\nReply EXECUTE or NOEXECUTE.\"\"\"

        try:
            resp= client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {{"role":"system","content":"You are GPT-4 Vision."}},
                    {{"role":"user","content":prompt}}
                ]
            )
            ans= resp.choices[0].message.content.strip()
            if ans.upper().startswith("EXECUTE"):
                return True
            return False
        except Exception as e:
            print(f"[ERROR] GPT => {{e}} => fallback NOEXECUTE")
            return False

    def execute_commands_once(cmds):
        executed=False
        if not isinstance(cmds,list):
            cmds=[cmds]
        for c in cmds:
            if executed:
                break
            print(f"[ACTION] => {{c}}")
            xy= re.search(r'\\\\((\\\\d+),\\\\s*(\\\\d+)\\\\)', c)
            if xy:
                xx= int(xy.group(1))
                yy= int(xy.group(2))
                print(f"pyautogui.click({{xx}},{{yy}})")
                pyautogui.click(xx, yy)
                executed= True
            elif "Key pressed:" in c:
                parts= c.split(":")
                if len(parts)>1:
                    key_char= parts[-1].strip()
                    print(f"pyautogui.press('{{key_char}}')")
                    pyautogui.press(key_char)
                    executed= True
        return executed

    def main():
        step_ids= sorted(data.keys(), key=lambda x:int(x))
        idx=0
        while idx< len(step_ids):
            sid= step_ids[idx]
            info= data[sid]
            ov_list= info.get('overall_imgs',[])
            loc_list= info.get('local_imgs',[])
            cmds   = info.get('commands',[])
            conds  = info.get('conditions',[])
            if not ov_list:
                print(f"[WARN] step{{sid}} => no overall => skip.")
                idx+=1
                continue

            print(f"[INFO] Checking step{{sid}}...")
            sc= pyautogui.screenshot()
            sc_cv= cv2.cvtColor(np.array(sc), cv2.COLOR_RGB2BGR)
            sc_cv_small= compress_screenshot(sc_cv,400,300)

            has_xy= any(re.search(r'\\\\((\\\\d+),\\\\s*(\\\\d+)\\\\)', c) for c in cmds)
            matched=False

            for (folder, rel_path) in ov_list:
                ovpath= os.path.join('..', rel_path)
                if not os.path.exists(ovpath):
                    print(f"[ERROR] cannot find {{ovpath}} => skip.")
                    continue
                ref_ov= cv2.imread(ovpath)
                if ref_ov is None:
                    print(f"[ERROR] cannot read {{ovpath}} => skip.")
                    continue
                sc_ov= orb_homography_score(ref_ov, sc_cv, RANSAC_THRESH)
                print(f"    overall {{ovpath}} => inliers={{sc_ov}}")

                if has_xy:
                    if sc_ov>=HIGH_MATCH_THRESH:
                        # local check
                        loc_ok=True
                        for (fld2, localp) in loc_list:
                            localpath= os.path.join('..', localp)
                            if not os.path.exists(localpath):
                                loc_ok=False
                                break
                            ref_loc= cv2.imread(localpath)
                            if ref_loc is None:
                                loc_ok=False
                                break
                            sc_loc= orb_homography_score(ref_loc, sc_cv, RANSAC_THRESH)
                            print(f"    local => inliers={{sc_loc}}")
                            if sc_loc<LOCAL_THRESH:
                                loc_ok=False
                                break
                        if loc_ok:
                            cond_str= "\\n".join(conds)[:500] if isinstance(conds,list) else "(no cond)"
                            dec= call_gpt_vision(sid, sc_cv_small, cond_str)
                            if dec:
                                done= execute_commands_once(cmds)
                                if done:
                                    matched=True
                                    idx+=1
                                    break
                            else:
                                print("[INFO] GPT => NOEXECUTE => not skip step => wait next screenshot.")
                    # else sc_ov<50 => do nothing, keep same step
                else:
                    # no coords => sc_ov>=OVERALL_THRESH => GPT => if EXECUTE => do => next
                    if sc_ov>=OVERALL_THRESH:
                        cond_str= "\\n".join(conds)[:500] if isinstance(conds,list) else "(no cond)"
                        dec= call_gpt_vision(sid, sc_cv_small, cond_str)
                        if dec:
                            done= execute_commands_once(cmds)
                            if done:
                                matched=True
                                idx+=1
                                break
                        else:
                            print("[INFO] GPT => NOEXECUTE => keep same step => wait next screenshot.")
            if not matched:
                print(f"    => not matched => wait {{CHECK_INTERVAL}}s.")
                time.sleep(CHECK_INTERVAL)

        print("[INFO] All steps done. Exit.")

    if __name__=='__main__':
        main()
    """)

    return code.strip("\n")


def main():
    print("[INFO] Building data from current directory's retry* folders...")
    data= build_data()

    out_dir= prepare_train_model_folder()

    # 保存 local => train-model
    for sid, info in data.items():
        new_loc= []
        for (folder, roi_np) in info['local_imgs']:
            out_name= f"step{sid}-local-{folder}.png"
            out_path= os.path.join(out_dir, out_name)
            cv2.imwrite(out_path, roi_np)
            new_loc.append((folder, out_name))
        info['local_imgs']= new_loc

    # 1) nogpt
    nogpt_code= generate_nogpt_script(data)
    nogpt_path= os.path.join(out_dir,"train-pyautogui-nogpt.py")
    with open(nogpt_path,'w',encoding='utf-8') as f:
        f.write(nogpt_code if nogpt_code else "#!/usr/bin/env python\nprint('no nogpt code')")

    print("[INFO] Created:", nogpt_path)

    # 2) gpt1
    #    构建prompt => GPT => strip => remove extra
    prompt_gpt1= build_prompt_for_gpt1(data)
    script_gpt1= call_gpt_for_script_gen(prompt_gpt1)
    if not script_gpt1:
        script_gpt1= "#!/usr/bin/env python\nprint('No GPT1 content')"

    lines1= script_gpt1.splitlines()
    final1=[]
    for line in lines1:
        final1.append(line.lstrip('   '))
    script_gpt1= "\n".join(final1).strip("\n")

    # remove triple backticks if any
    if script_gpt1.startswith("```"):
        script_gpt1= script_gpt1.lstrip("```")
    if script_gpt1.endswith("```"):
        script_gpt1= script_gpt1.rstrip("```")

    gpt1_path= os.path.join(out_dir,"train-pyautogui-gpt1.py")
    with open(gpt1_path,'w',encoding='utf-8') as f:
        f.write(script_gpt1 if script_gpt1 else "#!/usr/bin/env python\nprint('no gpt1 code')")
    print("[INFO] Created:", gpt1_path)

    # 3) gpt2
    gpt2_code= generate_gpt2_script_code(data)
    if not gpt2_code:
        gpt2_code= "#!/usr/bin/env python\nprint('No GPT2 content')"

    gpt2_path= os.path.join(out_dir,"train-pyautogui-gpt2.py")
    with open(gpt2_path,'w',encoding='utf-8') as f:
        # 确保 gpt2_code 不是 None
        f.write(gpt2_code if gpt2_code else "#!/usr/bin/env python\nprint('No GPT2 code')")
    print("[INFO] Created:", gpt2_path)

    print("[INFO] All done. Check train-model folder.")


if __name__=="__main__":
    main()
