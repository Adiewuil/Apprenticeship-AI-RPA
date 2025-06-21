# This file is created by Apprenticeships RPA.
import pyautogui
import time

# Get the current mouse position
current_position = pyautogui.position()

# Get the color of the pixel at the current mouse position
pixel_color = pyautogui.screenshot().getpixel(current_position)

# Check if the pixel color is white
if pixel_color == (255, 255, 255):
    # If the pixel is white, click on the current position
    pyautogui.click(current_position)

# Moving mouse at position (531, 21)
pyautogui.moveTo(531, 21)

# Left click at current position
pyautogui.click(button='left')
import pyautogui
import time

# Search for 'DeepL transla' keyword in current screen
deepL_location = pyautogui.locateOnScreen('DeepL_transla.png')
if deepL_location is not None:
    # If keyword found, click on the Google Columns (816, 30)
    pyautogui.click(816, 30, button='left')

time.sleep(2)  # pause for 2 seconds to make sure screen is updated

# If 'share translation' selected, then press 'type' key
share_translation_location = pyautogui.locateOnScreen('share_translation.png')
if share_translation_location is not None:
    # 'type' key press
    pyautogui.typewrite(['type'], interval=0.2)
import pyautogui

# Click at the specified position
pyautogui.click(816, 30, button='left')

# Assuming the 'type' key needs to be pressed regardless of the condition
pyautogui.press('type')
