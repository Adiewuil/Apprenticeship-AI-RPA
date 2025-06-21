import time
import tkinter as tk
from tkinter import messagebox
from tkinter import ttk
import os
import re

import pyautogui
from openai import OpenAI
import pyaudio
import wave
import threading
import requests
from pynput import mouse, keyboard  # **新导入：用于监听鼠标和键盘操作**
from PIL import ImageGrab, Image, ImageTk  # **新导入：用于截图和裁剪功能**

# OpenAI API 配置
# 创建客户端实例
client = OpenAI(api_key="YOUR_OPENAI_KEY")
OPENAI_API_KEY = 'YOUR_OPENAI_KEY'
WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions'

#client_gpt4 = OpenAI(api_key=os.getenv("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"))
# 定义录音参数
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 2048
# 定义全局变量
operation_log = []  # **新添加：存储鼠标和键盘的操作记录**
is_motion_recording = False  # **新添加：标识当前是否在进行操作记录**

class AudioRecorder:
    def __init__(self, filename):
        self.filename = filename
        self.audio = pyaudio.PyAudio()
        self.stream = None
        self.frames = []
        self.is_recording = False
        self.has_recorded = False  # 标记是否有录音数据

    def start_recording(self):
        try:
            self.stream = self.audio.open(format=FORMAT,
                                          channels=CHANNELS,
                                          rate=RATE,
                                          input=True,
                                          frames_per_buffer=CHUNK)
            self.frames = []
            self.is_recording = True
            self.has_recorded = False  # 重置录音数据标记
            threading.Thread(target=self.record).start()
        except Exception as e:
            messagebox.showerror("Error", f"Failed to start recording: {e}")

    def record(self):
        try:
            while self.is_recording:
                data = self.stream.read(CHUNK, exception_on_overflow=False)  # 防止缓冲区溢出
                self.frames.append(data)
                self.has_recorded = True  # 成功读取数据，标记为已录制
        except Exception as e:
            messagebox.showerror("Error", f"Recording error: {e}")

    def stop_recording(self):
        if not self.has_recorded:
            messagebox.showwarning("Warning", "You did not record this operation.")
            return False
        try:
            self.is_recording = False
            self.stream.stop_stream()
            self.stream.close()
            with wave.open(self.filename, 'wb') as wf:
                wf.setnchannels(CHANNELS)
                wf.setsampwidth(self.audio.get_sample_size(FORMAT))
                wf.setframerate(RATE)
                wf.writeframes(b''.join(self.frames))
            self.audio.terminate()
            return True
        except Exception as e:
            messagebox.showerror("Error", f"Failed to stop recording: {e}")
            return False

def transcribe_audio(file_path):
    try:
        with open(file_path, 'rb') as audio_file:
            response = client.audio.transcriptions.create(
                model='whisper-1',
                file=audio_file
            )
            # 检查返回值类型并正确获取文本
            if hasattr(response, 'text'):
                return response.text  # 如果是对象，使用属性访问
            elif isinstance(response, dict):
                return response['text']  # 如果是字典，使用键访问
            #return response['text']
    except Exception as e:
        messagebox.showerror("Error", f"Transcription failed: {e}")
        return ""

# **新增：记录鼠标和键盘操作并截取屏幕截图**
def start_motion_recording(root):
    global is_motion_recording
    is_motion_recording = True
    operation_log.clear()  # 清空旧的操作记录
    messagebox.showinfo("Information", "Your motion will be recorded")

    def on_click(x, y, button, pressed):
        if pressed and is_motion_recording:
            # 记录鼠标点击并截取屏幕
            operation_log.append(f"Mouse clicked at ({x}, {y}) with {button}")
            screenshot_filename = f"step{root.step_counter - 1}.png"
            capture_screenshot(screenshot_filename)
            stop_motion_recording(root)  # 停止记录操作

    def on_key_press(key):
        if is_motion_recording:
            # 记录键盘输入并截取屏幕
            try:
                operation_log.append(f"Key pressed: {key.char}")
            except AttributeError:
                operation_log.append(f"Special key pressed: {key}")
            screenshot_filename = f"step{root.step_counter - 1}.png"
            capture_screenshot(screenshot_filename)
            stop_motion_recording(root)  # 停止记录操作

    # 启动监听器
    root.mouse_listener = mouse.Listener(on_click=on_click)
    root.keyboard_listener = keyboard.Listener(on_press=on_key_press)
    root.mouse_listener.start()
    root.keyboard_listener.start()

# **新增：停止监听鼠标和键盘**
def stop_motion_recording(root):
    global is_motion_recording
    is_motion_recording = False
    if hasattr(root, 'mouse_listener'):
        root.mouse_listener.stop()
    if hasattr(root, 'keyboard_listener'):
        root.keyboard_listener.stop()
    messagebox.showinfo("Information", "Motion record finish")
    update_motion_display()  # 更新操作日志显示

# **新增：截图功能**
def capture_screenshot(filename):
    screenshot = ImageGrab.grab()
    screenshot.save(filename)

# **新增：更新操作日志到 motion_text 区域**
def update_motion_display():
    motion_text.config(state=tk.NORMAL)
    #motion_text.delete(1.0, tk.END)
    for entry in operation_log:
        motion_text.insert(tk.END, entry + "\n\n")
    motion_text.config(state=tk.DISABLED)

def standardize_and_generate_commands():
    """将用户输入的命令标准化并生成对应的 PyAutoGUI 命令。"""
    original_text = organized_command_text.get("1.0", tk.END).strip()
    if not original_text:
        messagebox.showwarning("Warning", "Please enter content in the 'Organized command' text box.")
        return

    try:
        # 调用 GPT-4 模型进行标准化
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are an assistant skilled at converting natural language into PyAutoGUI commands."},
                {"role": "user", "content": f"Please convert the following text into standardized commands suitable for PyAutoGUI:\n\n{original_text}"}
            ]
        )

        standardized_text = response.choices[0].message.content.strip()

        # 清空 "Organized command" 文本框并插入标准化文本
        organized_command_text.delete("1.0", tk.END)
        organized_command_text.insert(tk.END, standardized_text + "\n")

        # 生成 PyAutoGUI 命令并写入 record.py 文件
        pyautogui_commands = generate_pyautogui_commands(standardized_text)
        with open("record.py", "a", encoding="utf-8") as file:
            file.write(pyautogui_commands + "\n")
            file.flush()  # 手动刷新缓冲区
            # print('111')
            # print(pyautogui_commands + "\n")


        messagebox.showinfo("Success", "Standardized commands have been generated and saved to record.py.")
    except Exception as e:
        messagebox.showerror("Error", f"An error occurred: {e}")
def generate_pyautogui_commands(standardized_text):
    """
    从输入文本中提取 ```python 和 ``` 之间的内容，并返回该代码块。
    """
    # 定义正则表达式模式，匹配 ```python 和 ``` 之间的内容
    pattern = r'```python(.*?)```'

    # 使用 re.DOTALL 标志，使 . 能匹配换行符
    match = re.search(pattern, standardized_text, re.DOTALL)

    if match:
        # 提取并返回匹配的代码块，去除首尾空白字符
        return match.group(1).strip()
    else:
        # 如果未找到匹配，返回空字符串或适当的消息
        return ""

def Start_New_Record():
    messagebox.showinfo("Information", f"Script starts recording")
    with open("record.py", "w") as f:
        f.write("# This file is created by Apprenticeships RPA.\n")


def Retry_Record():
    # 清空文本框内容
    motion_text.delete('1.0', tk.END)

    # 弹出提示框
    messagebox.showinfo("Information", "All your actions will be recorded. Press Esc+A to stop recording.")
    print("[DEBUG] Recording started. Press Esc+A to stop.")

    # 创建新的 retry 文件夹
    retry_folders = [f for f in os.listdir() if os.path.isdir(f) and f.startswith('retry')]
    if retry_folders:
        max_num = max([int(f[5:]) for f in retry_folders if f[5:].isdigit()])
        new_retry_folder = f'retry{max_num + 1}'
    else:
        new_retry_folder = 'retry1'

    if not os.path.exists(new_retry_folder):
        os.makedirs(new_retry_folder)
    print(f"[DEBUG] Using folder: {new_retry_folder}")

    # 隐藏主界面
    root.withdraw()
    print("[DEBUG] Main window hidden.")

    # 停止录制事件
    stop_recording = threading.Event()

    # 用于检测 Esc + A 停止条件的按键集合
    pressed_keys = set()
    step_counter = 1

    def record_operation(operation_str):
        nonlocal step_counter
        motion_text.insert(tk.END, f"Step {step_counter}: {operation_str}\n")
        motion_text.see(tk.END)
        print(f"[DEBUG] {operation_str}, Step {step_counter}")

        # 截图保存
        screenshot_path = os.path.join(new_retry_folder, f"step{step_counter}.png")
        try:
            screenshot = pyautogui.screenshot()
            screenshot.save(screenshot_path)
            print(f"[DEBUG] Screenshot saved: {screenshot_path}")
        except Exception as e:
            print(f"[ERROR] Failed to save screenshot: {e}")

        step_counter += 1

    def on_key_press(key):
        # 处理键盘按下
        key_str = None
        if hasattr(key, 'char') and key.char:
            # 普通字符键
            key_str = key.char.lower()
            pressed_keys.add(key_str)
        else:
            # 特殊键（如esc、shift、ctrl）
            if key == keyboard.Key.esc:
                pressed_keys.add('esc')
                key_str = 'esc'
            else:
                key_str = str(key)

        print(f"[DEBUG] Key pressed: {key_str}, pressed_keys={pressed_keys}")

        # 检查 Esc + A 同时按下
        if 'esc' in pressed_keys and 'a' in pressed_keys:
            print("[DEBUG] Esc + A detected. Stopping recording.")
            stop_recording.set()
            return False  # 停止键盘监听

        # 如果还没停止录制，则记录该键盘操作
        if not stop_recording.is_set():
            if key_str == 'esc':
                record_operation("Special key pressed: ESC")
            elif len(key_str) == 1:  # 普通字符键
                record_operation(f"Key pressed: {key_str}")
            else:
                record_operation(f"Special key pressed: {key_str}")

    def on_key_release(key):
        # 处理键盘释放
        if hasattr(key, 'char') and key.char:
            k = key.char.lower()
            if k in pressed_keys:
                pressed_keys.remove(k)
        else:
            if key == keyboard.Key.esc and 'esc' in pressed_keys:
                pressed_keys.remove('esc')
        print(f"[DEBUG] Key released: {key}, pressed_keys={pressed_keys}")

    # 鼠标事件回调
    def on_click(x, y, button, pressed):
        if pressed and not stop_recording.is_set():
            # 当鼠标按下时记录点击操作
            operation_str = f"Mouse clicked at ({x}, {y}) with {button}"
            print(f"[DEBUG] {operation_str}")
            record_operation(operation_str)

    # 启动监听器
    keyboard_listener = keyboard.Listener(on_press=on_key_press, on_release=on_key_release)
    mouse_listener = mouse.Listener(on_click=on_click)
    keyboard_listener.start()
    mouse_listener.start()
    print("[DEBUG] Listeners started.")

    # 使用root.after定期检查stop_recording状态，而不是在这里阻塞等待
    def check_stop_recording():
        if stop_recording.is_set():
            print("[DEBUG] stop_recording event triggered. Stopping listeners...")
            # Keyboard listener在Esc+A时已return False自动结束
            # 现在手动停止鼠标监听器
            mouse_listener.stop()

            # 等待监听结束
            keyboard_listener.join(timeout=2)
            mouse_listener.join(timeout=2)
            print("[DEBUG] Listeners joined. Recording stopped.")

            # ******** 新增删除逻辑开始 ********
            # 删除motion_text中最后一行
            all_text = motion_text.get('1.0', tk.END)
            lines = all_text.strip('\n').split('\n')
            if lines:
                # 删除最后一行
                lines = lines[:-1]
                # 清空motion_text并重新插入修改后的文本
                motion_text.delete('1.0', tk.END)
                for line in lines:
                    motion_text.insert(tk.END, line + '\n')
                print("[DEBUG] Last line in motion_text removed.")

                # 删除最后一张截图
                last_screenshot_path = os.path.join(new_retry_folder, f"step{step_counter-1}.png")
                if os.path.exists(last_screenshot_path):
                    os.remove(last_screenshot_path)
                    print(f"[DEBUG] Removed last screenshot: {last_screenshot_path}")
            # ******** 新增删除逻辑结束 ********

            # 恢复主界面
            root.deiconify()
            print("[DEBUG] Main window restored.")

            # 提示录制完成
            messagebox.showinfo("Information", "Motion record finished.")

            # 将记录写入文件（此时已删除最后一行记录）
            motion_record_path = os.path.join(new_retry_folder, 'motion-record.txt')
            with open(motion_record_path, 'w', encoding='utf-8') as file:
                text_content = motion_text.get('1.0', tk.END)
                file.write(text_content)
            print(f"[DEBUG] Motion record saved to {motion_record_path}")
        else:
            # 如果还没有触发停止，则继续每隔100ms检测一次
            root.after(100, check_stop_recording)

    # 开始定期检查stop_recording
    root.after(100, check_stop_recording)
def Stop_Record(label_text):
    messagebox.showinfo("提示", f"您点击了按钮: {label_text}")

def Start_A_Step_Record(root):
    # 显示提示消息
    messagebox.showinfo("Information", f"A new step will be recorded")
    # 隐藏程序主界面
    root.iconify()
    # 创建新窗口
    record_window = tk.Toplevel()
    record_window.title(f"Record Speech - Step {root.step_counter}")
    # 生成文件名，后缀为 step1, step2, ...
    filename = f"recorded_step{root.step_counter}.wav"

    # 创建 AudioRecorder 实例
    recorder = AudioRecorder(filename)

    # 定义开始录音的回调函数
    def start_recording():
        recorder.start_recording()
        messagebox.showinfo("Information", f"Recording started for {filename}.")

    # 定义停止录音的回调函数
    def stop_recording():
        if recorder.is_recording:
            if recorder.stop_recording():
                messagebox.showinfo("Information", f"Recording stopped. File saved as {filename}.")
                # 转录录音文件
                if os.path.exists(filename):
                    transcription = transcribe_audio(filename)
                    if transcription:
                        transcription_text.insert(tk.END, transcription + "\n"+ "\n")  # 动态插入文本
                    start_motion_recording(root)  # 开始操作记录
        else:
            if os.path.exists(filename):
                transcription = transcribe_audio(filename)
                if transcription:
                    transcription_text.insert(tk.END, transcription + "\n"+ "\n")  # 动态插入文本
                start_motion_recording(root)  # 开始操作记录
            else:
                messagebox.showwarning("Warning", "You did not record this operation.")
        record_window.destroy()

    # 添加按钮到新窗口
    btn_start = tk.Button(record_window, text="Start Record Speech", command=start_recording)
    btn_start.pack(pady=10)

    btn_stop = tk.Button(record_window, text="Stop Record Speech", command=stop_recording)
    btn_stop.pack(pady=10)
    record_window.geometry('')
    # 增加计数器
    root.step_counter += 1

def execute_command():
    command = py_command_text.get("1.0", tk.END)
    if command:
        try:
            # 使用 eval 执行输入的命令
            exec(command)
            messagebox.showinfo("Success", "Command executed successfully.")
        except Exception as e:
            messagebox.showerror("Error", f"An error occurred:\n{e}")
    else:
        messagebox.showwarning("Warning", "Please enter a command.")

def Cancel_A_Step(label_text):
    messagebox.showinfo("提示", f"您点击了按钮: {label_text}")

def Stop_A_Step_Record(label_text):
    messagebox.showinfo("提示", f"您点击了按钮: {label_text}")


def main():
    global transcription_text, motion_text,organized_command_text,py_command_text,root
    # 创建主窗口
    root = tk.Tk()
    root.title("Apprenticeships RPA")
    root.step_counter = 1

    # 设置窗口初始大小（较窄且较高）
    root.geometry("1100x1000")

    # 主框架
    main_frame = tk.Frame(root, bg="white")
    main_frame.pack(fill="both", expand=True)

    # 上方区域，放置按钮
    top_frame = tk.Frame(main_frame, bg="white")
    top_frame.pack(side="top", fill="x", pady=5)

    # 第一行按钮
    btn_start_new_record = tk.Button(top_frame, text="Start New Record", command=lambda: Start_New_Record())
    btn_start_new_record.pack(side="left", padx=5, pady=5)

    btn_retry_record = tk.Button(top_frame, text="Retry Record", command=lambda: Retry_Record())
    btn_retry_record.pack(side="left", padx=5, pady=5)

    btn_stop_record = tk.Button(top_frame, text="Stop Record", command=lambda: Stop_Record("Stop Record"))
    btn_stop_record.pack(side="left", padx=5, pady=5)

    # 添加下拉选择框
    # 创建StringVar来存放当前选择的值，并设置默认值
    LLM_model_var = tk.StringVar(value="Which LLM Model")
    # 创建下拉列表Combobox
    LLM_model_combobox = ttk.Combobox(top_frame, textvariable=LLM_model_var,
                                  values=["Gpt 4o", "Claude 3.5", "Gemini2.0"], state="readonly")
    LLM_model_combobox.pack(side="left", padx=5, pady=5)

    # 您可根据需要使用 model_var.get() 来获取用户选择的当前值，并在后续逻辑中使用。
    py_command_text = tk.Text(top_frame, wrap="word", bg="white", height= 2 ,   state="normal")
    py_command_text.pack(fill="both", expand=True, padx=5, pady=5)

    try_py_command = tk.Button(top_frame, text="Try pyautogui command", command=lambda: execute_command())
    try_py_command.pack(side="left", padx=5, pady=5)

    # 第二行按钮区域
    second_row_frame = tk.Frame(main_frame, bg="white")
    second_row_frame.pack(side="top", fill="x")

    btn_start_a_step_record= tk.Button(second_row_frame, text="Start A Step Record", command=lambda: Start_A_Step_Record(root))
    btn_start_a_step_record.pack(side="left", padx=5, pady=5)

    btn_cancel_a_step = tk.Button(second_row_frame, text="Cancel A Step", command=lambda: Cancel_A_Step("Cancel A Step"))
    btn_cancel_a_step.pack(side="left", padx=5, pady=5)

    btn_stop_a_step_record = tk.Button(second_row_frame, text="Stop A Step Record", command=lambda: Stop_A_Step_Record("Stop A Step Record"))
    btn_stop_a_step_record.pack(side="left", padx=5, pady=5)

    # 添加下拉选择框
    # 创建StringVar来存放当前选择的值，并设置默认值
    STT_model_var = tk.StringVar(value="Which Speech-to-Text Model")
    # 创建下拉列表Combobox
    STT_model_combobox = ttk.Combobox(second_row_frame, textvariable=STT_model_var,
                                  values=["OpenAI Whisper", "Google Cloud Speech-to-Text", "Microsoft Azure Speech"],
                                  state="readonly", width= 28)
    STT_model_combobox.pack(side="left", padx=5, pady=5)

    # 您可根据需要使用 model_var.get() 来获取用户选择的当前值，并在后续逻辑中使用。

    # 下方区域
    bottom_frame = tk.Frame(main_frame, bg="white")
    bottom_frame.pack(side="top", fill="both", expand=True, pady=5, padx=5)

    # # 使用grid分为三列：0列为左侧文本，1列为分隔线，2列为右侧文本
    # bottom_frame.columnconfigure(0, weight=1)
    # bottom_frame.columnconfigure(1, weight=0)
    # bottom_frame.columnconfigure(2, weight=1)
    # bottom_frame.columnconfigure(3, weight=0)
    # bottom_frame.columnconfigure(4, weight=1)
    # bottom_frame.rowconfigure(0, weight=1)
    # 配置底部框架的网格布局，确保均分三列
    for col in range(5):
        weight = 1 if col % 2 == 0 else 0
        bottom_frame.columnconfigure(col, weight=weight, minsize=200)  # 设置最小宽度为100像素
    bottom_frame.rowconfigure(0, weight=1)
    # 左下区域
    global left_lower_frame  # 声明为全局变量
    global transcription_text

    left_lower_frame = tk.Frame(bottom_frame, bg="white")
    left_lower_frame.grid(row=0, column=0, sticky="nsew")
    # 分隔线1（使用ttk.Separator）
    separator1 = ttk.Separator(bottom_frame, orient="vertical")
    separator1.grid(row=0, column=1, sticky="ns")
    # 下中区域
    median_lower_frame = tk.Frame(bottom_frame, bg="white")
    median_lower_frame.grid(row=0, column=2, sticky="nsew")
    # 分隔线2（使用ttk.Separator）
    separator2 = ttk.Separator(bottom_frame, orient="vertical")
    separator2.grid(row=0, column=3, sticky="ns")
    # 右下区域
    right_lower_frame = tk.Frame(bottom_frame, bg="white")
    right_lower_frame.grid(row=0, column=4, sticky="nsew")


    # 左下文本：左对齐
    label_speech_command = tk.Label(left_lower_frame,
                               text="Speech-formed commands ",
                               bg="white",
                               justify="left",
                               anchor="nw")
    label_speech_command.pack(fill="x",padx=5, pady=5)
    # **更新：添加动态文本显示区域**
    transcription_text = tk.Text(
        left_lower_frame,  # 放置在 left_lower_frame 内，与 label_speech_command 同级
        wrap="word",  # 自动换行
        bg="white",
        state="normal",  # 确保可以插入内容
    )
    #transcription_text.pack(fill="x", padx=5, pady=5)
    transcription_text.pack(fill="both", expand=True, padx=5, pady=5)  # 宽度跟随父框架
    # 右下文本：也使用左对齐
    label_motion_command = tk.Label(median_lower_frame,
                                text="Motion-formed commands ",
                                bg="white",
                                justify="left",
                                anchor="nw")
    label_motion_command.pack(fill="x",padx=5, pady=5)
    motion_text = tk.Text(median_lower_frame, wrap="word", bg="white", state="normal")
    motion_text.pack(fill="both", expand=True, padx=5, pady=5)

    # 在 right_lower_frame 中创建 "To more standardized" 按钮
    standardize_button = tk.Button(right_lower_frame, text="To more standardized",
                                   command=lambda: standardize_and_generate_commands())
    standardize_button.pack(pady=5)
    label_organized_command = tk.Label(right_lower_frame,
                                    text="Organized commands ",
                                    height = 1,
                                    bg="white",
                                    justify="left",
                                    anchor="nw")
    label_organized_command.pack()
    organized_command_text = tk.Text(right_lower_frame, wrap="word", bg="white", state="normal")
    organized_command_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

    # 启动主事件循环
    root.mainloop()

if __name__ == "__main__":
    main()
