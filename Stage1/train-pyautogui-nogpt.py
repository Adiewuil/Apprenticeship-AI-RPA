# -*- coding: utf-8 -*-
import os
import re
import time
import cv2
import pyautogui
import numpy as np

CHECK_INTERVAL  = 5.0
RANSAC_THRESH   = 5.0
OVERALL_THRESH  = 15.0
LOCAL_THRESH    = 10.0
HIGH_MATCH_THRESH = 50.0  # 若某张匹配超过50 => 立即执行

# 如果要对 stepX-overall.png 仅匹配其中一片区域 => (x1,y1,x2,y2)；否则 (None,None,None,None)
match_region = (None, None, None, None)

data = {'1': {'overall_imgs': [('retry0', 'retry0\\step1.png'), ('retry1', 'retry1\\step1.png'), ('retry4', 'retry4\\step1.png'), ('retry5', 'retry5\\step1.png'), ('retry6', 'retry6\\step1.png'), ('retry7', 'retry7\\step1.png'), ('retry8', 'retry8\\step1.png'), ('retry9', 'retry9\\step1.png')], 'local_imgs': [('retry1', 'train-model\\step1-local-retry1.png'), ('retry4', 'train-model\\step1-local-retry4.png'), ('retry5', 'train-model\\step1-local-retry5.png'), ('retry6', 'train-model\\step1-local-retry6.png'), ('retry7', 'train-model\\step1-local-retry7.png'), ('retry8', 'train-model\\step1-local-retry8.png'), ('retry9', 'train-model\\step1-local-retry9.png')], 'commands': ['Mouse clicked at (1035, 25) with Button.left', 'Mouse clicked at (913, 39) with Button.left', 'Mouse clicked at (922, 39) with Button.left', 'Mouse clicked at (1499, 20) with Button.left', 'Mouse clicked at (113, 22) with Button.left', 'Mouse clicked at (156, 23) with Button.left', 'Mouse clicked at (711, 24) with Button.left'], 'conditions': ["If one of the current Google Chrome tabs has the words 'DeepL Transla' on it, click to select the tab."]}, '2': {'overall_imgs': [('retry0', 'retry0\\step2.png'), ('retry1', 'retry1\\step2.png'), ('retry4', 'retry4\\step2.png'), ('retry5', 'retry5\\step2.png'), ('retry6', 'retry6\\step2.png'), ('retry7', 'retry7\\step2.png'), ('retry8', 'retry8\\step2.png'), ('retry9', 'retry9\\step2.png')], 'local_imgs': [], 'commands': ['Special key pressed: Key.tab'], 'conditions': ["If 'Go to Write' is selected on the current page (framed by a dark blue rectangle) then press the Tab key on your keyboard."]}}

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

def apply_region_crop(img, region):
    (x1,y1,x2,y2) = region
    if x1 is None or y1 is None or x2 is None or y2 is None:
        return img
    h,w = img.shape[:2]
    x1 = max(0, min(w, x1))
    x2 = max(0, min(w, x2))
    y1 = max(0, min(h, y1))
    y2 = max(0, min(h, y2))
    return img[y1:y2, x1:x2]

def execute_commands(cmds):
    if not isinstance(cmds, list):
        cmds = [cmds]
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
        overall_imgs = info.get('overall_imgs', [])
        local_imgs   = info.get('local_imgs', [])
        commands     = info.get('commands', [])

        if not isinstance(commands, list):
            commands = [commands]

        if not overall_imgs:
            print(f"[WARN] step{sid} => no overall => skip.")
            idx+=1
            continue

        print(f"\n[INFO] Checking step{sid}...")
        sc = pyautogui.screenshot()
        scr_cv = cv2.cvtColor(np.array(sc), cv2.COLOR_RGB2BGR)

        overall_ok = True
        high_matched = False

        # 每次截图后输出“该截图与每张 stepX-overall.png 的匹配值”
        for (folder, ovpath) in overall_imgs:
            if not os.path.exists(ovpath):
                overall_ok = False
                break
            ref_ov = cv2.imread(ovpath)
            if ref_ov is None:
                overall_ok = False
                break
            ref_ov_crop = apply_region_crop(ref_ov, match_region)
            score_ov = orb_homography_score(ref_ov_crop, scr_cv, RANSAC_THRESH)
            print(f"   => match with {ovpath}, inliers={score_ov}")

            if score_ov >= HIGH_MATCH_THRESH:
                print(f"   => single image >= {HIGH_MATCH_THRESH} => do commands now.")
                execute_commands(commands)
                idx+=1
                high_matched = True
                break

            if score_ov < OVERALL_THRESH:
                overall_ok = False
                break

        if high_matched:
            # 进入下一个step
            continue

        if not overall_ok:
            print(f"   => overall not matched => wait {CHECK_INTERVAL}s.")
            time.sleep(CHECK_INTERVAL)
            continue

        # local
        local_ok = True
        for (folder, locpath) in local_imgs:
            if not os.path.exists(locpath):
                continue
            ref_loc = cv2.imread(locpath)
            if ref_loc is None:
                continue
            sc_loc = orb_homography_score(ref_loc, scr_cv, RANSAC_THRESH)
            print(f"   local {locpath} => inliers={sc_loc}")
            if sc_loc<LOCAL_THRESH:
                local_ok=False
                break

        if not local_ok:
            print(f"   => local not matched => wait {CHECK_INTERVAL}s.")
            time.sleep(CHECK_INTERVAL)
            continue

        print(f"[INFO] step{sid} => match success => execute commands.")
        execute_commands(commands)
        idx+=1

    print("[INFO] All steps done. Exit.")

if __name__=='__main__':
    main()