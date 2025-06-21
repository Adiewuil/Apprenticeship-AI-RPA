
import cv2
import numpy as np
import pyautogui
import time

data = {
"step1": {"overall": 8, "local": 7, "commands": 7, "conditions": 1},
"step2": {"overall": 8, "local": 0, "commands": 1, "conditions": 1},
}

def match_template(overall, screenshot, method=cv2.TM_CCOEFF_NORMED):
result = cv2.matchTemplate(overall, screenshot, method)
_, max_val, _, max_loc = cv2.minMaxLoc(result)
return max_val, max_loc

def check_conditions(conditions):
return True

def execute_commands(commands):
pass

if __name__ == "__main__":
orb = cv2.ORB_create()

while True:
time.sleep(5)

screenshot = pyautogui.screenshot()
screenshot = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)

for step, info in data.items():
overall = cv2.imread(f"{info['overall']}.png", 0)

keypoints1, descriptors1 = orb.detectAndCompute(overall, None)
keypoints2, descriptors2 = orb.detectAndCompute(screenshot, None)

bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
matches = bf.match(descriptors1, descriptors2)

if len(matches) >= info["overall"]:
local = cv2.imread(f"{info['local']}.png", 0)

match_value, match_loc = match_template(local, screenshot)
if match_value >= info["local"]:
condition = check_conditions(info["conditions"])

if condition:
execute_commands(info["commands"])
