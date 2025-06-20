# Apprenticeship-AI-RPA
Repeatedly record the process of humans completing tasks, documenting what actions need to be taken under specific conditions. Use AI to make real-time judgments, thereby enabling the AI to learn both the task execution process and the conditional decision-making involved.

#多次记录人类的任务完成过程，记录下在哪些情况下需要执行什么样的操作，使用AI实时判断，从而实现AI对于人类完成任务的过程，以及条件判断的学习。

第一阶段（已初步实现）：使用python的tkinter搭建界面框架，语音或者文字记录下某项操作在什么条件下需要执行，pynput记录鼠标或者键盘操作，并在鼠标点击或者键盘敲击时截取完整屏幕截图以及鼠标点击区域附近的截图，多次重复记录不同情况下的操作，尽量涵盖执行该操作的所有情况，使用open CV图像识别以及调用AI API来实现自动化的判断以及决策，且能根据不同情况执行准确的指令。脚本1 xxx：搭建界面框架，记录执行命令的条件以及记录下的操作。使用Start New Record开始一段新的录制，使用Start A Step Record可以开始语音录制命令，使用OpenAI whisper模型转为文字显示在下方Speech-formed commands一栏，鼠标或者键盘进行单次操作，操作记录在下方Motion-formed commands一栏，使用To more standardized调用GPT 4O整合两栏信息（不怎么好用），或者手动复制过来。再次点击Start A Step Record可以录制下一步操作。使用Retry Record可以记录同一操作的不同情况，可以多次使用记录下不同情况，从而保存多组鼠标点击位置以及完整，点击位置的屏幕截图。最后Stop Record生成三份可执行脚本。第一份脚本AAA，判断只使用本地图片识别与比较库，可以结合不同情况分析出要点击哪一个位置的浏览器标签页。第二份脚本BBB，调用GPT 4O根据操作记录生成可执行脚本，该脚本基本都不能执行。第三份脚本CCC，判断情况时在通过了本地图片识别与比较库的条件时再使用GPT 4O API进行判断，截图压缩到满足API输入上限后分别率不够判断，因此未实装。

**Phase 1 (Preliminary Implementation)**:
A user interface framework was built using Python's Tkinter. Voice or text is used to record under what conditions a specific action should be executed. Mouse and keyboard operations are captured using pynput, and during each mouse click or keystroke, a full-screen screenshot and a localized screenshot around the click area are taken. This process is repeated multiple times under various conditions to cover as many scenarios for the action as possible. OpenCV is used for image recognition, and AI APIs are integrated to enable real-time decision-making and accurate execution of instructions based on different conditions.

**Script 1**: xxx

Builds the UI framework and records both the execution conditions and the corresponding operations.

Start New Record: Begins a new recording session.

Start A Step Record: Starts a voice command recording. The command is transcribed using OpenAI’s Whisper model and displayed in the Speech-formed Commands section.

A single mouse or keyboard operation is performed, and it is logged under Motion-formed Commands.

To more standardized: Uses GPT-4o to combine the two command sections (though this is not very reliable), or you can manually copy and paste them for integration.

Clicking Start A Step Record again allows you to record the next step.

Retry Record: Used to record the same action under different conditions. This can be used multiple times to capture various screenshots (both full and localized around the click position) for the same operation.

Stop Record: Ends the session and generates three executable scripts:

**Script AAA:** Uses only local image recognition and comparison libraries to analyze different conditions and determine which browser tab to click on.

**Script BBB:** Uses GPT-4o to generate an executable script based on the recorded operations, but this script is usually non-functional.

**Script CCC**: Uses local image comparison for initial condition filtering and then calls the GPT-4o API for further decision-making. However, due to resolution loss from compressing screenshots to fit API input limits, it cannot make reliable judgments and has not been fully implemented.

**Phase 2 & 3 (Framework Prototype Built, Not Yet Functional):**
Using AI tools (such as Claude Desktop or Cursor) in combination with various MCP tools, the goal is to record a sequence of human operations involved in completing a task. This can be done either by having the user input a description of each step (e.g., “selected cell A1”) or by allowing the AI to observe and summarize the steps on its own. The user must inform the AI, “I’m starting the task now, begin recording my operations.” Once the task is completed, the AI outputs the execution workflow. After correcting the flow and adding new conditional logic, the AI tool should be capable of executing the same task either on different files or at a later time.

**Script XXX:**
This experimental script is deployed within Claude Desktop, but the execution of commands is still quite rigid and lacks flexibility.
