# -*- coding: utf-8 -*-
import os
import re
import time
import cv2
import pyautogui
import numpy as np
import base64
from openai import OpenAI


client = OpenAI(api_key='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')

data = {'1': {'overall_imgs': [('retry0', 'retry0\\step1.png'), ('retry1', 'retry1\\step1.png'), ('retry4', 'retry4\\step1.png'), ('retry5', 'retry5\\step1.png'), ('retry6', 'retry6\\step1.png'), ('retry7', 'retry7\\step1.png'), ('retry8', 'retry8\\step1.png'), ('retry9', 'retry9\\step1.png')], 'local_imgs': [('retry1', 'train-model\\step1-local-retry1.png'), ('retry4', 'train-model\\step1-local-retry4.png'), ('retry5', 'train-model\\step1-local-retry5.png'), ('retry6', 'train-model\\step1-local-retry6.png'), ('retry7', 'train-model\\step1-local-retry7.png'), ('retry8', 'train-model\\step1-local-retry8.png'), ('retry9', 'train-model\\step1-local-retry9.png')], 'commands': ['Mouse clicked at (1035, 25) with Button.left', 'Mouse clicked at (913, 39) with Button.left', 'Mouse clicked at (922, 39) with Button.left', 'Mouse clicked at (1499, 20) with Button.left', 'Mouse clicked at (113, 22) with Button.left', 'Mouse clicked at (156, 23) with Button.left', 'Mouse clicked at (711, 24) with Button.left'], 'conditions': ["If one of the current Google Chrome tabs has the words 'DeepL Transla' on it, click to select the tab."]}, '2': {'overall_imgs': [('retry0', 'retry0\\step2.png'), ('retry1', 'retry1\\step2.png'), ('retry4', 'retry4\\step2.png'), ('retry5', 'retry5\\step2.png'), ('retry6', 'retry6\\step2.png'), ('retry7', 'retry7\\step2.png'), ('retry8', 'retry8\\step2.png'), ('retry9', 'retry9\\step2.png')], 'local_imgs': [], 'commands': ['Special key pressed: Key.tab'], 'conditions': ["If 'Go to Write' is selected on the current page (framed by a dark blue rectangle) then press the Tab key on your keyboard."]}}

CHECK_INTERVAL = 5.0
RANSAC_THRESH  = 5.0
OVERALL_THRESH = 15.0
LOCAL_THRESH   = 10.0

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
    pts_q = np.float32([kp_q[m.queryIdx].pt for m in matches])
    pts_t = np.float32([kp_t[m.trainIdx].pt for m in matches])
    H, mask = cv2.findHomography(pts_q, pts_t, cv2.RANSAC, ransac_thresh)
    if H is None:
        return 0
    inliers = mask.ravel().sum()
    return float(inliers)

def call_gpt_for_decision(step_id, screen_b64, conditions):
    prompt = f"""You are GPT-4. We have step{step_id} conditions:\n{conditions}\nScreenshot base64:\n{screen_b64}\nReply 'EXECUTE' or 'NOEXECUTE'."""
    try:
        resp = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role":"system","content":"You are GPT-4."},
                {"role":"user","content":prompt}
            ]
        )
        ans = resp.choices[0].message.content.strip()
        if ans.upper().startswith("EXECUTE"):
            return True
        return False
    except Exception as e:
        print(f"[ERROR] GPT => {e} => fallback NOEXECUTE")
        return False

def execute_commands(cmds):
    if not isinstance(cmds, list):
        cmds=[cmds]
    for c in cmds:
        print(f"[ACTION] => {c}")
        xy = re.search(r'\\((\\d+),\\s*(\\d+)\\)', c)
        if xy:
            xx = int(xy.group(1))
            yy = int(xy.group(2))
            print(f"pyautogui.click({xx}, {yy})")
            pyautogui.click(xx, yy)
        elif "Key pressed:" in c:
            parts = c.split(":")
            if len(parts)>1:
                key_char = parts[-1].strip()
                print(f"pyautogui.press('{key_char}')")
                pyautogui.press(key_char)

def main():
    step_ids = sorted(data.keys(), key=lambda x: int(x))
    idx=0
    while idx< len(step_ids):
        sid = step_ids[idx]
        info = data[sid]
        ov_list= info.get('overall_imgs', [])
        loc_list= info.get('local_imgs', [])
        cmds   = info.get('commands', [])
        conds  = info.get('conditions', [])

        if not isinstance(cmds, list):
            cmds=[cmds]

        if not ov_list:
            print(f"[WARN] step{sid} => no overall => skip.")
            idx+=1
            continue

        print(f"\n[INFO] Checking step{sid}...")
        sc = pyautogui.screenshot()
        scr_cv = cv2.cvtColor(np.array(sc), cv2.COLOR_RGB2BGR)

        ov_ok = True
        for (folder, ovpath) in ov_list:
            if not os.path.exists(ovpath):
                print(f"[ERROR] cannot find {ovpath}")
                ov_ok=False
                break
            ref_ov = cv2.imread(ovpath)
            if ref_ov is None:
                print(f"[ERROR] cannot read {ovpath}")
                ov_ok=False
                break
            sc_ov = orb_homography_score(ref_ov, scr_cv, RANSAC_THRESH)
            print(f"   overall {ovpath} => inliers={sc_ov}")
            if sc_ov<OVERALL_THRESH:
                ov_ok=False
                break

        if not ov_ok:
            print(f"   => overall not matched => wait {CHECK_INTERVAL}s.")
            time.sleep(CHECK_INTERVAL)
            continue

        loc_ok=True
        for (folder, localpath) in loc_list:
            if not os.path.exists(localpath):
                print(f"[WARN] local not found: {localpath}")
                continue
            ref_loc = cv2.imread(localpath)
            if ref_loc is None:
                print(f"[WARN] cannot read {localpath}")
                continue
            sc_loc = orb_homography_score(ref_loc, scr_cv, RANSAC_THRESH)
            print(f"   local {localpath} => inliers={sc_loc}")
            if sc_loc<LOCAL_THRESH:
                loc_ok=False
                break

        if not loc_ok:
            print(f"   => local not matched => wait {CHECK_INTERVAL}s.")
            time.sleep(CHECK_INTERVAL)
            continue

        _, buf = cv2.imencode('.png', scr_cv)
        b64img = base64.b64encode(buf).decode('utf-8')
        cond_str = "\n".join(conds) if isinstance(conds,list) else "(no condition)"

        dec = call_gpt_for_decision(sid, b64img, cond_str)
        if dec:
            print(f"[INFO] GPT => EXECUTE => do commands.")
            execute_commands(cmds)
            idx+=1
        else:
            print(f"[INFO] GPT => NOEXECUTE => wait {CHECK_INTERVAL}s.")
            time.sleep(CHECK_INTERVAL)

    print("[INFO] All steps done. Exit.")

if __name__=='__main__':
    main()