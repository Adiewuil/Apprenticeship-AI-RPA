#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 智能自动录制器
class IntelligentRecorder {
  constructor(controller) {
    this.controller = controller;
    this.isMonitoring = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.lastActiveWindow = null;
    this.lastScreenshot = null;
    this.actions = [];
    this.monitoringInterval = null;
    this.screenshotInterval = null;
    this.keyboardInterval = null;
    this.lastKeyboardState = '';
  }

  // 开始智能监控
  async startIntelligentMonitoring() {
    try {
      this.controller.log('=== Starting Intelligent Monitoring ===');
      this.isMonitoring = true;
      this.actions = [];
      
      // 启动鼠标位置监控
      this.monitoringInterval = setInterval(() => {
        this.monitorSystemChanges();
      }, 500); // 每500ms检查一次
      
      // 启动截图监控
      this.screenshotInterval = setInterval(() => {
        this.captureScreenForAnalysis();
      }, 3000); // 每3秒截图一次
      
      // 启动键盘监控
      this.keyboardInterval = setInterval(() => {
        this.monitorKeyboardActivity();
      }, 1000); // 每1秒检查键盘活动
      
      this.controller.log('Intelligent monitoring started');
      return true;
      
    } catch (error) {
      this.controller.log(`Failed to start monitoring: ${error.message}`);
      return false;
    }
  }

  // 停止智能监控
  async stopIntelligentMonitoring() {
    this.controller.log('=== Stopping Intelligent Monitoring ===');
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = null;
    }
    
    if (this.keyboardInterval) {
      clearInterval(this.keyboardInterval);
      this.keyboardInterval = null;
    }
    
    // 分析收集的数据
    const analysis = await this.analyzeCollectedActions();
    this.controller.log(`Monitoring stopped. Collected ${this.actions.length} events`);
    
    return analysis;
  }

  // 监控系统变化
  async monitorSystemChanges() {
    if (!this.isMonitoring) return;
    
    try {
      // 检查鼠标位置变化
      const currentMousePos = await this.getCurrentMousePosition();
      if (this.hasMouseMoved(currentMousePos)) {
        await this.detectMouseAction(currentMousePos);
        this.lastMousePos = currentMousePos;
      }
      
      // 检查活动窗口变化
      const currentWindow = await this.getCurrentActiveWindow();
      if (this.hasWindowChanged(currentWindow)) {
        await this.detectWindowChange(currentWindow);
        this.lastActiveWindow = currentWindow;
      }
      
    } catch (error) {
      this.controller.log(`Monitoring error: ${error.message}`);
    }
  }

  // 获取当前鼠标位置
  async getCurrentMousePosition() {
    try {
      if (this.controller.robotjs && !this.controller.useFallback) {
        return this.controller.robotjs.getMousePos();
      } else {
        return await this.getMousePositionWindowsAPI();
      }
    } catch (error) {
      return this.lastMousePos;
    }
  }

  async getMousePositionWindowsAPI() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Windows.Forms;

class MousePos {
    static void Main() {
        var pos = Cursor.Position;
        Console.WriteLine($"{pos.X},{pos.Y}");
    }
}`;

      const csFile = path.join(tempDir, 'MousePos.cs');
      const exeFile = path.join(tempDir, 'MousePos.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" /reference:System.Windows.Forms.dll "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}"`);
      const [x, y] = stdout.trim().split(',').map(Number);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
      return { x, y };
    } catch (error) {
      return this.lastMousePos;
    }
  }

  // 获取当前活动窗口
  async getCurrentActiveWindow() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Text;

class ActiveWindow {
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    
    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
    
    static void Main() {
        IntPtr hwnd = GetForegroundWindow();
        StringBuilder text = new StringBuilder(256);
        GetWindowText(hwnd, text, 256);
        
        RECT rect;
        GetWindowRect(hwnd, out rect);
        
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        
        Console.WriteLine($"{text}|{rect.Left},{rect.Top},{rect.Right},{rect.Bottom}|{processId}");
    }
}`;

      const csFile = path.join(tempDir, 'ActiveWindow.cs');
      const exeFile = path.join(tempDir, 'ActiveWindow.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}"`);
      const parts = stdout.trim().split('|');
      const title = parts[0];
      const coords = parts[1] ? parts[1].split(',').map(Number) : [0, 0, 0, 0];
      const processId = parts[2] ? parseInt(parts[2]) : 0;
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
      return {
        title: title,
        processId: processId,
        rect: {
          left: coords[0],
          top: coords[1],
          right: coords[2],
          bottom: coords[3]
        }
      };
    } catch (error) {
      return this.lastActiveWindow;
    }
  }

  // 检查鼠标是否移动
  hasMouseMoved(currentPos) {
    if (!this.lastMousePos) return true;
    
    const distance = Math.sqrt(
      Math.pow(currentPos.x - this.lastMousePos.x, 2) + 
      Math.pow(currentPos.y - this.lastMousePos.y, 2)
    );
    
    return distance > 10; // 移动超过10像素认为是有效移动
  }

  // 检查窗口是否变化
  hasWindowChanged(currentWindow) {
    if (!this.lastActiveWindow) return true;
    return currentWindow.title !== this.lastActiveWindow.title;
  }

  // 检测鼠标动作
  async detectMouseAction(mousePos) {
    try {
      // 检测是否可能是点击（鼠标停留）
      setTimeout(async () => {
        if (!this.isMonitoring) return;
        
        const newPos = await this.getCurrentMousePosition();
        if (Math.abs(newPos.x - mousePos.x) < 5 && Math.abs(newPos.y - mousePos.y) < 5) {
          // 鼠标停留，可能是点击
          const clickAction = {
            type: 'mouse_click',
            timestamp: new Date().toISOString(),
            position: mousePos,
            description: await this.analyzeClickLocation(mousePos)
          };
          
          this.actions.push(clickAction);
          this.controller.log(`Detected: ${clickAction.description}`);
        }
      }, 800);
      
    } catch (error) {
      this.controller.log(`Mouse action detection error: ${error.message}`);
    }
  }

  // 分析点击位置
  async analyzeClickLocation(mousePos) {
    try {
      const { width, height } = this.controller.screenInfo;
      
      // 分析点击位置的上下文
      if (mousePos.y > height - 60) {
        // 任务栏区域
        if (mousePos.x < 80) {
          return '点击了开始按钮';
        } else if (mousePos.x < 200) {
          return '点击了任务栏图标';
        } else {
          return '点击了任务栏';
        }
      } else if (mousePos.y < 50) {
        // 标题栏区域
        return '点击了窗口标题栏';
      } else {
        // 应用程序内容区域
        const activeWindow = await this.getCurrentActiveWindow();
        if (activeWindow && activeWindow.title) {
          if (activeWindow.title.includes('运行')) {
            return '在运行对话框中操作';
          } else if (activeWindow.title.includes('资源管理器') || activeWindow.title.includes('文件夹')) {
            return '在文件管理器中点击';
          } else if (activeWindow.title.includes('.xlsx') || activeWindow.title.includes('.xls')) {
            // 尝试分析Excel中的具体位置
            const excelInfo = await this.analyzeExcelLocation(mousePos, activeWindow);
            return excelInfo || `在Excel文件中点击 (${mousePos.x}, ${mousePos.y})`;
          } else {
            return `在 ${activeWindow.title} 中点击 (${mousePos.x}, ${mousePos.y})`;
          }
        } else {
          return `点击坐标 (${mousePos.x}, ${mousePos.y})`;
        }
      }
    } catch (error) {
      return `点击坐标 (${mousePos.x}, ${mousePos.y})`;
    }
  }

  // 分析Excel中的点击位置
  async analyzeExcelLocation(mousePos, window) {
    try {
      // 根据窗口位置和鼠标位置估算Excel单元格
      const { rect } = window;
      const relativeX = mousePos.x - rect.left;
      const relativeY = mousePos.y - rect.top;
      
      // Excel的大致布局估算
      if (relativeY < 120) {
        return 'Excel工具栏或菜单区域';
      } else if (relativeX < 80) {
        return 'Excel行号区域';
      } else if (relativeY < 150) {
        return 'Excel列标题区域';
      } else {
        // 估算单元格位置
        const colIndex = Math.floor((relativeX - 80) / 64); // 假设列宽64像素
        const rowIndex = Math.floor((relativeY - 150) / 20); // 假设行高20像素
        const colLetter = String.fromCharCode(65 + (colIndex % 26)); // A-Z
        return `Excel单元格 ${colLetter}${rowIndex + 1} (估算)`;
      }
    } catch (error) {
      return null;
    }
  }

  // 检测窗口变化
  async detectWindowChange(currentWindow) {
    try {
      let description = `切换到窗口: ${currentWindow.title}`;
      
      // 智能分析窗口类型
      if (currentWindow.title.includes('资源管理器') || currentWindow.title.includes('文件夹')) {
        description = '打开了文件管理器';
      } else if (currentWindow.title.includes('.xlsx') || currentWindow.title.includes('.xls')) {
        const fileName = currentWindow.title.split(' - ')[0];
        description = `打开了Excel文件: ${fileName}`;
      } else if (currentWindow.title.includes('.txt') || currentWindow.title.includes('.doc')) {
        const fileName = currentWindow.title.split(' - ')[0];
        description = `打开了文档: ${fileName}`;
      } else if (currentWindow.title.includes('运行')) {
        description = '打开了运行对话框';
      } else if (currentWindow.title.includes('Chrome') || currentWindow.title.includes('Edge')) {
        description = '切换到浏览器';
      } else if (currentWindow.title.includes('Claude')) {
        description = '切换到Claude Desktop';
      }
      
      const action = {
        type: 'window_change',
        timestamp: new Date().toISOString(),
        window: currentWindow,
        description: description
      };
      
      this.actions.push(action);
      this.controller.log(`Detected: ${action.description}`);
      
    } catch (error) {
      this.controller.log(`Window change detection error: ${error.message}`);
    }
  }

  // 监控键盘活动
  async monitorKeyboardActivity() {
    if (!this.isMonitoring) return;
    
    try {
      const clipboardContent = await this.getClipboardContent();
      if (clipboardContent !== this.lastKeyboardState && clipboardContent.length < 1000) {
        // 检测到可能的输入活动
        const action = {
          type: 'keyboard_input',
          timestamp: new Date().toISOString(),
          content: clipboardContent,
          description: `检测到文本输入: ${clipboardContent.substring(0, 50)}${clipboardContent.length > 50 ? '...' : ''}`
        };
        
        this.actions.push(action);
        this.controller.log(`Detected: ${action.description}`);
        this.lastKeyboardState = clipboardContent;
      }
    } catch (error) {
      // 键盘监控失败不影响整体监控
    }
  }

  // 获取剪贴板内容（用于检测输入）
  async getClipboardContent() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Windows.Forms;

class ClipboardReader {
    [STAThread]
    static void Main() {
        try {
            if (Clipboard.ContainsText()) {
                Console.WriteLine(Clipboard.GetText());
            }
        } catch {
            // 忽略剪贴板访问错误
        }
    }
}`;

      const csFile = path.join(tempDir, 'ClipboardReader.cs');
      const exeFile = path.join(tempDir, 'ClipboardReader.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" /reference:System.Windows.Forms.dll "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}"`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
      return stdout.trim();
    } catch (error) {
      return '';
    }
  }

  // 为分析截图
  async captureScreenForAnalysis() {
    if (!this.isMonitoring) return;
    
    try {
      const screenshotPath = await this.controller.captureScreen();
      
      const action = {
        type: 'screenshot',
        timestamp: new Date().toISOString(),
        screenshot: screenshotPath,
        description: '自动截图记录'
      };
      
      this.actions.push(action);
      this.lastScreenshot = screenshotPath;
      
    } catch (error) {
      this.controller.log(`Auto screenshot error: ${error.message}`);
    }
  }

  // 分析收集的动作
  async analyzeCollectedActions() {
    try {
      this.controller.log('=== Analyzing Collected Actions ===');
      
      // 过滤和合并相似动作
      const filteredActions = this.filterRelevantActions();
      
      // 生成操作摘要
      const summary = this.generateActionSummary(filteredActions);
      
      return {
        totalEvents: this.actions.length,
        relevantActions: filteredActions.length,
        summary: summary,
        actions: filteredActions
      };
      
    } catch (error) {
      this.controller.log(`Action analysis error: ${error.message}`);
      return {
        totalEvents: this.actions.length,
        relevantActions: 0,
        summary: '分析失败',
        actions: []
      };
    }
  }

  // 过滤相关动作
  filterRelevantActions() {
    const relevant = [];
    const seenDescriptions = new Set();
    
    for (const action of this.actions) {
      // 跳过重复的描述
      if (seenDescriptions.has(action.description)) {
        continue;
      }
      
      // 跳过自动截图（除非是关键时刻）
      if (action.type === 'screenshot' && !this.isKeyMoment(action)) {
        continue;
      }
      
      relevant.push(action);
      seenDescriptions.add(action.description);
    }
    
    return relevant;
  }

  // 判断是否为关键时刻的截图
  isKeyMoment(action) {
    // 如果截图前后有窗口变化或点击，认为是关键时刻
    const actionIndex = this.actions.indexOf(action);
    const nearbyActions = this.actions.slice(Math.max(0, actionIndex - 2), actionIndex + 3);
    
    return nearbyActions.some(a => a.type === 'window_change' || a.type === 'mouse_click');
  }

  // 生成动作摘要
  generateActionSummary(actions) {
    const summary = [];
    
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      summary.push(`${i + 1}. ${action.description}`);
    }
    
    return summary;
  }
}

// 真正工作的Windows控制器
class WorkingWindowsController {
  constructor() {
    this.screenInfo = null;
    this.activeKeys = new Set();
    this.lastMousePos = { x: 0, y: 0 };
    this.robotjs = null;
    this.currentInputMethod = null;
    this.useFallback = false;
    this.debugMode = true; // 启用详细调试
    this.init();
  }

  log(message) {
    if (this.debugMode) {
      console.error(`[DEBUG] ${new Date().toISOString()} - ${message}`);
    }
  }

  async init() {
    try {
      this.log('Initializing controller...');
      this.robotjs = await this.loadRobotJS();
      await this.updateScreenInfo();
      await this.detectInputMethod();
      this.setupCleanupHandlers();
      this.log('Controller initialized successfully');
    } catch (error) {
      this.log(`Controller init failed: ${error.message}`);
      await this.initFallbackController();
    }
  }

  async loadRobotJS() {
    try {
      const robotjs = require('robotjs');
      this.log('RobotJS loaded successfully');
      return robotjs;
    } catch (error) {
      this.log(`RobotJS load failed: ${error.message}`);
      throw error;
    }
  }

  async initFallbackController() {
    this.log('Using Windows API fallback controller');
    this.useFallback = true;
    await this.updateScreenInfo();
    await this.detectInputMethod();
    this.setupCleanupHandlers();
  }

  setupCleanupHandlers() {
    const cleanup = () => {
      this.log('Cleaning up active keys...');
      this.releaseAllKeys();
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
  }

  async updateScreenInfo() {
    try {
      if (this.robotjs && !this.useFallback) {
        const size = this.robotjs.getScreenSize();
        this.screenInfo = {
          width: size.width,
          height: size.height,
          virtualWidth: size.width,
          virtualHeight: size.height,
          virtualX: 0,
          virtualY: 0,
          dpi: 96,
          scaleFactor: 1.0
        };
        this.log(`Screen info from RobotJS: ${JSON.stringify(this.screenInfo)}`);
      } else {
        await this.getScreenInfoWindows();
      }
    } catch (error) {
      this.log(`Screen info failed: ${error.message}`);
      this.screenInfo = {
        width: 1920,
        height: 1080,
        virtualWidth: 1920,
        virtualHeight: 1080,
        virtualX: 0,
        virtualY: 0,
        dpi: 96,
        scaleFactor: 1.0
      };
    }
  }

  async getScreenInfoWindows() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Windows.Forms;

class ScreenInfo {
    static void Main() {
        var screen = Screen.PrimaryScreen;
        var bounds = screen.Bounds;
        Console.WriteLine($"{bounds.Width},{bounds.Height}");
    }
}`;

      const csFile = path.join(tempDir, 'ScreenInfo.cs');
      const exeFile = path.join(tempDir, 'ScreenInfo.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" /reference:System.Windows.Forms.dll "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}"`);
      const [width, height] = stdout.trim().split(',').map(Number);
      
      this.screenInfo = {
        width: width,
        height: height,
        virtualWidth: width,
        virtualHeight: height,
        virtualX: 0,
        virtualY: 0,
        dpi: 96,
        scaleFactor: 1.0
      };

      this.log(`Screen info from Windows API: ${JSON.stringify(this.screenInfo)}`);

      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows screen info failed: ${error.message}`);
      throw error;
    }
  }

  // 路径验证和修复
  async validateAndFixPath(filePath) {
    try {
      this.log(`=== Path Validation ===`);
      this.log(`Input path: ${filePath}`);
      
      // 修复常见的转义字符问题
      let fixedPath = filePath;
      
      // 修复 \t 被解析为 tab 的问题
      if (fixedPath.includes('	')) { // 检查是否包含实际的tab字符
        fixedPath = fixedPath.replace(/	/g, '\\t');
        this.log(`Fixed tab character: ${fixedPath}`);
      }
      
      // 修复test-data路径问题
      if (fixedPath.includes(' est-data')) {
        fixedPath = fixedPath.replace(/ est-data/g, 'test-data');
        this.log(`Fixed \\t issue: ${fixedPath}`);
      }
      
      // 修复其他常见转义问题
      fixedPath = fixedPath
        .replace(/\\\n/g, '\\n')   // 修复换行符
        .replace(/\\\r/g, '\\r');  // 修复回车符
      
      // 标准化路径分隔符
      fixedPath = fixedPath.replace(/\//g, '\\');
      
      this.log(`Final fixed path: ${fixedPath}`);
      
      // 验证路径是否存在（如果是本地文件）
      if (fixedPath.match(/^[A-Za-z]:\\/)) {
        try {
          await fs.access(fixedPath);
          this.log(`✅ Path exists: ${fixedPath}`);
        } catch (error) {
          this.log(`⚠️ Path may not exist: ${fixedPath}`);
          // 但仍然尝试打开，可能是文件将要创建
        }
      }
      
      return fixedPath;
      
    } catch (error) {
      this.log(`Path validation error: ${error.message}`);
      return filePath; // 返回原始路径作为备用
    }
  }

  // 真正工作的文件打开方法
  async openFileIntelligent(originalPath) {
    try {
      this.log(`=== Opening file: ${originalPath} ===`);
      
      // 修复路径
      const filePath = await this.validateAndFixPath(originalPath);
      
      // 基本验证
      if (!filePath || filePath.trim().length === 0) {
        throw new Error('File path is empty after processing');
      }
      
      this.log('Path validation and fixing completed');
      
      // 强制切换到英文输入法
      this.log('Switching to English input method...');
      await this.forceEnglishInput();
      
      // 确定打开方法
      const method = this.determineOpenMethod(filePath);
      this.log(`Selected method: ${method}`);
      
      let result = false;
      switch (method) {
        case 'rundialog':
          result = await this.executeRunDialog(filePath);
          break;
        case 'explorer':
          result = await this.executeExplorer(filePath);
          break;
        case 'powershell':
          result = await this.executePowerShell(filePath);
          break;
        default:
          result = await this.executeRunDialog(filePath);
      }
      
      this.log(`File open result: ${result}`);
      return result;
      
    } catch (error) {
      this.log(`File open error: ${error.message}`);
      return false;
    }
  }

  determineOpenMethod(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    // 可执行文件用运行对话框
    if (['.exe', '.msi', '.bat', '.cmd'].includes(ext)) {
      return 'rundialog';
    }
    
    // 长路径用PowerShell
    if (filePath.length > 200) {
      return 'powershell';
    }
    
    // 网络路径用explorer
    if (filePath.startsWith('\\\\')) {
      return 'explorer';
    }
    
    // 默认用运行对话框（最可靠）
    return 'rundialog';
  }

  // 真正执行Win+R的方法
  async executeRunDialog(filePath) {
    try {
      this.log('=== Executing Run Dialog ===');
      
      // Step 1: 按Win+R
      this.log('Step 1: Pressing Win+R...');
      await this.pressWinR();
      
      // Step 2: 等待对话框出现
      this.log('Step 2: Waiting for dialog...');
      await this.sleep(800);
      
      // Step 3: 清空可能的内容
      this.log('Step 3: Clearing existing content...');
      await this.pressCtrlA();
      await this.sleep(100);
      
      // Step 4: 输入路径
      this.log(`Step 4: Typing path: ${filePath}`);
      const formattedPath = this.formatPath(filePath);
      await this.typeString(formattedPath);
      
      // Step 5: 等待输入完成
      await this.sleep(300);
      
      // Step 6: 按回车
      this.log('Step 6: Pressing Enter...');
      await this.pressEnter();
      
      // Step 7: 等待执行
      await this.sleep(1000);
      
      this.log('Run dialog execution completed');
      return true;
      
    } catch (error) {
      this.log(`Run dialog execution failed: ${error.message}`);
      return false;
    }
  }

  // PowerShell方法
  async executePowerShell(filePath) {
    try {
      this.log('=== Executing via PowerShell ===');
      
      const command = `Start-Process "${filePath}"`;
      const { stdout, stderr } = await execAsync(`powershell -Command "${command}"`);
      
      this.log(`PowerShell output: ${stdout}`);
      if (stderr) {
        this.log(`PowerShell stderr: ${stderr}`);
      }
      
      return true;
    } catch (error) {
      this.log(`PowerShell execution failed: ${error.message}`);
      return false;
    }
  }

  // Explorer方法
  async executeExplorer(filePath) {
    try {
      this.log('=== Executing via Explorer ===');
      
      const { stdout, stderr } = await execAsync(`explorer "${filePath}"`);
      
      this.log(`Explorer output: ${stdout}`);
      if (stderr) {
        this.log(`Explorer stderr: ${stderr}`);
      }
      
      return true;
    } catch (error) {
      this.log(`Explorer execution failed: ${error.message}`);
      return false;
    }
  }

  // 真正的Win+R实现
  async pressWinR() {
    try {
      this.log('Executing Win+R press...');
      
      if (this.robotjs && !this.useFallback) {
        // RobotJS实现
        this.log('Using RobotJS for Win+R');
        this.robotjs.keyToggle('meta', 'down');
        await this.sleep(50);
        this.robotjs.keyTap('r');
        await this.sleep(50);
        this.robotjs.keyToggle('meta', 'up');
        this.log('RobotJS Win+R completed');
      } else {
        // Windows API实现
        this.log('Using Windows API for Win+R');
        await this.winRWindowsAPI();
      }
      
    } catch (error) {
      this.log(`Win+R failed: ${error.message}`);
      throw error;
    }
  }

  async winRWindowsAPI() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

class WinR {
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    const byte VK_LWIN = 0x5B;
    const byte VK_R = 0x52;
    const uint KEYEVENTF_KEYUP = 0x02;
    
    static void Main() {
        Console.WriteLine("Pressing Win+R...");
        
        // 按下Windows键
        keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
        Thread.Sleep(100);
        
        // 按下R键
        keybd_event(VK_R, 0, 0, UIntPtr.Zero);
        Thread.Sleep(100);
        
        // 释放R键
        keybd_event(VK_R, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(50);
        
        // 释放Windows键
        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        
        Console.WriteLine("Win+R completed");
    }
}`;

      const csFile = path.join(tempDir, 'WinR.cs');
      const exeFile = path.join(tempDir, 'WinR.exe');
      
      await fs.writeFile(csFile, csharpCode);
      this.log('Compiling Win+R executable...');
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      
      this.log('Executing Win+R...');
      const { stdout } = await execAsync(`"${exeFile}"`);
      this.log(`Win+R output: ${stdout}`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API Win+R failed: ${error.message}`);
      throw error;
    }
  }

  // Ctrl+A实现
  async pressCtrlA() {
    try {
      if (this.robotjs && !this.useFallback) {
        this.robotjs.keyToggle('control', 'down');
        this.robotjs.keyTap('a');
        this.robotjs.keyToggle('control', 'up');
      } else {
        await this.ctrlAWindowsAPI();
      }
    } catch (error) {
      this.log(`Ctrl+A failed: ${error.message}`);
    }
  }

  async ctrlAWindowsAPI() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

class CtrlA {
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    const byte VK_CONTROL = 0x11;
    const byte VK_A = 0x41;
    const uint KEYEVENTF_KEYUP = 0x02;
    
    static void Main() {
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(VK_A, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(VK_A, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}`;

      const csFile = path.join(tempDir, 'CtrlA.cs');
      const exeFile = path.join(tempDir, 'CtrlA.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      await execAsync(`"${exeFile}"`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API Ctrl+A failed: ${error.message}`);
    }
  }

  // 真正的文本输入
  async typeString(text) {
    try {
      this.log(`Typing text: "${text}"`);
      
      if (this.robotjs && !this.useFallback) {
        this.log('Using RobotJS to type text');
        // 分段输入，避免过长文本问题
        const chunks = this.chunkString(text, 50);
        for (const chunk of chunks) {
          this.robotjs.typeString(chunk);
          await this.sleep(100);
        }
      } else {
        this.log('Using Windows API to type text');
        await this.typeStringWindowsAPI(text);
      }
      
      this.log('Text typing completed');
      
    } catch (error) {
      this.log(`Text typing failed: ${error.message}`);
      throw error;
    }
  }

  // 分割字符串
  chunkString(str, length) {
    const chunks = [];
    for (let i = 0; i < str.length; i += length) {
      chunks.push(str.slice(i, i + length));
    }
    return chunks;
  }

  async typeStringWindowsAPI(text) {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Windows.Forms;
using System.Threading;

class TypeText {
    static void Main(string[] args) {
        if (args.Length > 0) {
            string text = args[0];
            Console.WriteLine($"Typing: {text}");
            
            // 使用SendKeys逐字符发送，提高可靠性
            foreach (char c in text) {
                if (c == '\\\\') {
                    SendKeys.SendWait("{{\\\\}}");
                } else if (c == '{' || c == '}') {
                    SendKeys.SendWait("{" + c + "}");
                } else {
                    SendKeys.SendWait(c.ToString());
                }
                Thread.Sleep(10); // 每个字符间隔10ms
            }
            
            Console.WriteLine("Typing completed");
        }
    }
}`;

      const csFile = path.join(tempDir, 'TypeText.cs');
      const exeFile = path.join(tempDir, 'TypeText.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" /reference:System.Windows.Forms.dll "${csFile}"`);
      
      // 转义双引号和特殊字符
      const escapedText = text.replace(/"/g, '""').replace(/\\/g, '\\\\');
      const { stdout } = await execAsync(`"${exeFile}" "${escapedText}"`);
      this.log(`Type text output: ${stdout}`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API text typing failed: ${error.message}`);
      throw error;
    }
  }

  // 真正的回车键
  async pressEnter() {
    try {
      this.log('Pressing Enter key...');
      
      if (this.robotjs && !this.useFallback) {
        this.robotjs.keyTap('enter');
        this.log('RobotJS Enter completed');
      } else {
        await this.pressEnterWindowsAPI();
      }
      
    } catch (error) {
      this.log(`Enter key failed: ${error.message}`);
      throw error;
    }
  }

  async pressEnterWindowsAPI() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

class PressEnter {
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    const byte VK_RETURN = 0x0D;
    const uint KEYEVENTF_KEYUP = 0x02;
    
    static void Main() {
        Console.WriteLine("Pressing Enter...");
        
        // 按下Enter
        keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        
        // 释放Enter
        keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        
        Console.WriteLine("Enter completed");
    }
}`;

      const csFile = path.join(tempDir, 'PressEnter.cs');
      const exeFile = path.join(tempDir, 'PressEnter.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}"`);
      this.log(`Enter output: ${stdout}`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API Enter failed: ${error.message}`);
      throw error;
    }
  }

  // 真正的输入法切换
  async forceEnglishInput() {
    try {
      this.log('=== Forcing English Input ===');
      
      // 方法1: Win+Space多次尝试
      for (let i = 0; i < 3; i++) {
        this.log(`Attempt ${i + 1}: Pressing Win+Space...`);
        await this.pressWinSpace();
        await this.sleep(300);
        
        // 检查是否成功
        const isEnglish = await this.checkEnglishInput();
        if (isEnglish) {
          this.log('Successfully switched to English input');
          return true;
        }
      }
      
      // 方法2: Ctrl+Shift
      this.log('Trying Ctrl+Shift...');
      await this.pressCtrlShift();
      await this.sleep(300);
      
      // 方法3: Alt+Shift
      this.log('Trying Alt+Shift...');
      await this.pressAltShift();
      await this.sleep(300);
      
      const finalCheck = await this.checkEnglishInput();
      this.log(`Final English check result: ${finalCheck}`);
      return finalCheck;
      
    } catch (error) {
      this.log(`Force English input failed: ${error.message}`);
      return false;
    }
  }

  async pressWinSpace() {
    try {
      if (this.robotjs && !this.useFallback) {
        this.robotjs.keyToggle('meta', 'down');
        this.robotjs.keyTap('space');
        this.robotjs.keyToggle('meta', 'up');
      } else {
        await this.winSpaceWindowsAPI();
      }
    } catch (error) {
      this.log(`Win+Space failed: ${error.message}`);
    }
  }

  async winSpaceWindowsAPI() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

class WinSpace {
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    const byte VK_LWIN = 0x5B;
    const byte VK_SPACE = 0x20;
    const uint KEYEVENTF_KEYUP = 0x02;
    
    static void Main() {
        keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(VK_SPACE, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(VK_SPACE, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}`;

      const csFile = path.join(tempDir, 'WinSpace.cs');
      const exeFile = path.join(tempDir, 'WinSpace.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      await execAsync(`"${exeFile}"`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API Win+Space failed: ${error.message}`);
    }
  }

  async pressCtrlShift() {
    try {
      if (this.robotjs && !this.useFallback) {
        this.robotjs.keyToggle('control', 'down');
        this.robotjs.keyToggle('shift', 'down');
        await this.sleep(100);
        this.robotjs.keyToggle('shift', 'up');
        this.robotjs.keyToggle('control', 'up');
      } else {
        await this.ctrlShiftWindowsAPI();
      }
    } catch (error) {
      this.log(`Ctrl+Shift failed: ${error.message}`);
    }
  }

  async ctrlShiftWindowsAPI() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

class CtrlShift {
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    const byte VK_CONTROL = 0x11;
    const byte VK_SHIFT = 0x10;
    const uint KEYEVENTF_KEYUP = 0x02;
    
    static void Main() {
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_SHIFT, 0, 0, UIntPtr.Zero);
        Thread.Sleep(100);
        keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}`;

      const csFile = path.join(tempDir, 'CtrlShift.cs');
      const exeFile = path.join(tempDir, 'CtrlShift.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      await execAsync(`"${exeFile}"`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API Ctrl+Shift failed: ${error.message}`);
    }
  }

  async pressAltShift() {
    try {
      if (this.robotjs && !this.useFallback) {
        this.robotjs.keyToggle('alt', 'down');
        this.robotjs.keyToggle('shift', 'down');
        await this.sleep(100);
        this.robotjs.keyToggle('shift', 'up');
        this.robotjs.keyToggle('alt', 'up');
      } else {
        await this.altShiftWindowsAPI();
      }
    } catch (error) {
      this.log(`Alt+Shift failed: ${error.message}`);
    }
  }

  async altShiftWindowsAPI() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

class AltShift {
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    const byte VK_ALT = 0x12;
    const byte VK_SHIFT = 0x10;
    const uint KEYEVENTF_KEYUP = 0x02;
    
    static void Main() {
        keybd_event(VK_ALT, 0, 0, UIntPtr.Zero);
        keybd_event(VK_SHIFT, 0, 0, UIntPtr.Zero);
        Thread.Sleep(100);
        keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_ALT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}`;

      const csFile = path.join(tempDir, 'AltShift.cs');
      const exeFile = path.join(tempDir, 'AltShift.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      await execAsync(`"${exeFile}"`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API Alt+Shift failed: ${error.message}`);
    }
  }

  async checkEnglishInput() {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Runtime.InteropServices;

class CheckInput {
    [DllImport("user32.dll")]
    static extern int GetKeyboardLayoutName(System.Text.StringBuilder pwszKLID);
    
    static void Main() {
        var sb = new System.Text.StringBuilder(256);
        GetKeyboardLayoutName(sb);
        var klid = sb.ToString();
        
        bool isEnglish = klid.Equals("00000409", StringComparison.OrdinalIgnoreCase);
        Console.WriteLine($"{klid},{isEnglish}");
    }
}`;

      const csFile = path.join(tempDir, 'CheckInput.cs');
      const exeFile = path.join(tempDir, 'CheckInput.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}"`);
      const [klid, isEnglish] = stdout.trim().split(',');
      
      this.log(`Input method check: KLID=${klid}, IsEnglish=${isEnglish}`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
      return isEnglish === 'True';
      
    } catch (error) {
      this.log(`English input check failed: ${error.message}`);
      return false;
    }
  }

  formatPath(filePath) {
    // 如果包含空格，用引号包装
    if (filePath.includes(' ')) {
      return `"${filePath}"`;
    }
    return filePath;
  }

  // 修复后的截图功能
  async captureScreen() {
    try {
      this.log('=== Starting screen capture ===');
      
      const timestamp = Date.now();
      const screenshotPath = path.join(__dirname, 'screenshots', `screenshot_${timestamp}.png`);
      
      // 确保目录存在
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      this.log(`Screenshot directory prepared: ${path.dirname(screenshotPath)}`);
      
      if (this.robotjs && !this.useFallback) {
        // RobotJS 方式
        this.log('Using RobotJS for screenshot...');
        try {
          const img = this.robotjs.screen.capture();
          this.log(`RobotJS captured image: width=${img.width}, height=${img.height}`);
          
          // 使用sharp库保存PNG（如果可用）
          try {
            const sharp = require('sharp');
            await sharp(img.image, {
              raw: {
                width: img.width,
                height: img.height,
                channels: img.bytesPerPixel
              }
            }).png().toFile(screenshotPath);
            this.log(`RobotJS screenshot saved with sharp: ${screenshotPath}`);
          } catch (sharpError) {
            // 直接写入PNG数据作为备用
            await fs.writeFile(screenshotPath, img.image);
            this.log(`RobotJS screenshot saved directly: ${screenshotPath}`);
          }
          
          // 验证文件
          const stats = await fs.stat(screenshotPath);
          this.log(`Screenshot file size: ${stats.size} bytes`);
          
          return screenshotPath;
        } catch (robotError) {
          this.log(`RobotJS screenshot failed: ${robotError.message}`);
          // 降级到Windows API
          return await this.captureScreenWindowsAPI(screenshotPath);
        }
      } else {
        // Windows API 方式
        return await this.captureScreenWindowsAPI(screenshotPath);
      }
      
    } catch (error) {
      this.log(`Screenshot failed: ${error.message}`);
      throw error;
    }
  }

  // Windows API 截图实现
  async captureScreenWindowsAPI(screenshotPath) {
    try {
      this.log('Using Windows API for screenshot...');
      
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const csharpCode = `
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.IO;

class Screenshot {
    static void Main(string[] args) {
        try {
            string outputPath = args[0];
            Console.WriteLine($"Taking screenshot, output: {outputPath}");
            
            // 获取屏幕边界
            Rectangle bounds = Screen.PrimaryScreen.Bounds;
            Console.WriteLine($"Screen bounds: {bounds.Width}x{bounds.Height}");
            
            // 创建位图
            using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb)) {
                // 创建图形对象
                using (Graphics graphics = Graphics.FromImage(bitmap)) {
                    // 设置高质量渲染
                    graphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
                    graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                    
                    // 复制屏幕内容
                    graphics.CopyFromScreen(Point.Empty, Point.Empty, bounds.Size);
                }
                
                // 确保目录存在
                string directory = Path.GetDirectoryName(outputPath);
                if (!Directory.Exists(directory)) {
                    Directory.CreateDirectory(directory);
                }
                
                // 保存为PNG
                bitmap.Save(outputPath, ImageFormat.Png);
                Console.WriteLine($"Screenshot saved successfully");
                
                // 验证文件
                FileInfo fileInfo = new FileInfo(outputPath);
                Console.WriteLine($"File size: {fileInfo.Length} bytes");
            }
        }
        catch (Exception ex) {
            Console.WriteLine($"Screenshot error: {ex.Message}");
            Environment.Exit(1);
        }
    }
}`;

      const csFile = path.join(tempDir, 'Screenshot.cs');
      const exeFile = path.join(tempDir, 'Screenshot.exe');
      
      await fs.writeFile(csFile, csharpCode);
      this.log('Compiling screenshot executable...');
      
      await execAsync(`csc /target:exe /out:"${exeFile}" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "${csFile}"`);
      this.log('Screenshot executable compiled');
      
      this.log('Executing screenshot capture...');
      const { stdout, stderr } = await execAsync(`"${exeFile}" "${screenshotPath}"`);
      
      this.log(`Screenshot output: ${stdout}`);
      if (stderr) {
        this.log(`Screenshot stderr: ${stderr}`);
      }
      
      // 验证文件是否创建成功
      try {
        const stats = await fs.stat(screenshotPath);
        this.log(`Windows API screenshot saved: ${screenshotPath} (${stats.size} bytes)`);
        
        if (stats.size === 0) {
          throw new Error('Screenshot file is empty');
        }
        
      } catch (statError) {
        this.log(`Screenshot file verification failed: ${statError.message}`);
        throw new Error('Screenshot file was not created properly');
      }
      
      // 清理临时文件
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
      return screenshotPath;
      
    } catch (error) {
      this.log(`Windows API screenshot failed: ${error.message}`);
      throw error;
    }
  }

  // 添加截图验证方法
  async verifyScreenshot(screenshotPath) {
    try {
      const stats = await fs.stat(screenshotPath);
      this.log(`Screenshot verification: ${screenshotPath}`);
      this.log(`File size: ${stats.size} bytes`);
      this.log(`Created: ${stats.birthtime}`);
      
      if (stats.size === 0) {
        throw new Error('Screenshot file is empty');
      }
      
      if (stats.size < 1000) {
        this.log('Warning: Screenshot file seems very small, may be corrupted');
      }
      
      return true;
    } catch (error) {
      this.log(`Screenshot verification failed: ${error.message}`);
      return false;
    }
  }

  // 其他必要方法
  async detectInputMethod() {
    try {
      const isEnglish = await this.checkEnglishInput();
      this.currentInputMethod = {
        isEnglish: isEnglish,
        name: isEnglish ? 'English (US)' : 'Other'
      };
    } catch (error) {
      this.currentInputMethod = { isEnglish: false, name: 'Unknown' };
    }
  }

  async releaseAllKeys() {
    // 清理所有活动按键
    this.activeKeys.clear();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 简化的鼠标方法
  async clickMouse(button = 'left', x = null, y = null) {
    try {
      if (x !== null && y !== null) {
        this.log(`Clicking at (${x}, ${y}) with ${button} button`);
        if (this.robotjs && !this.useFallback) {
          this.robotjs.moveMouse(x, y);
          await this.sleep(100);
          this.robotjs.mouseClick(button);
        } else {
          await this.clickMouseWindowsAPI(x, y, button);
        }
      }
    } catch (error) {
      this.log(`Mouse click failed: ${error.message}`);
    }
  }

  async clickMouseWindowsAPI(x, y, button) {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const buttonCode = button === 'right' ? 'MOUSEEVENTF_RIGHTDOWN|MOUSEEVENTF_RIGHTUP' : 'MOUSEEVENTF_LEFTDOWN|MOUSEEVENTF_LEFTUP';

      const csharpCode = `
using System;
using System.Runtime.InteropServices;

class MouseClick {
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);
    
    [DllImport("user32.dll")]
    static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    
    const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    const uint MOUSEEVENTF_LEFTUP = 0x04;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
    const uint MOUSEEVENTF_RIGHTUP = 0x10;
    
    static void Main(string[] args) {
        int x = int.Parse(args[0]);
        int y = int.Parse(args[1]);
        string button = args[2];
        
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(100);
        
        if (button == "right") {
            mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
            System.Threading.Thread.Sleep(50);
            mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
        } else {
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            System.Threading.Thread.Sleep(50);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        }
        
        Console.WriteLine($"Clicked at ({x}, {y}) with {button} button");
    }
}`;

      const csFile = path.join(tempDir, 'MouseClick.cs');
      const exeFile = path.join(tempDir, 'MouseClick.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}" ${x} ${y} ${button}`);
      this.log(`Mouse click output: ${stdout}`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API mouse click failed: ${error.message}`);
    }
  }

  // 键盘输入模拟
  async pressKey(key) {
    try {
      this.log(`Pressing key: ${key}`);
      
      if (this.robotjs && !this.useFallback) {
        this.robotjs.keyTap(key);
      } else {
        await this.pressKeyWindowsAPI(key);
      }
      
    } catch (error) {
      this.log(`Key press failed: ${error.message}`);
    }
  }

  async pressKeyWindowsAPI(key) {
    try {
      const tempDir = path.join(__dirname, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      // 键码映射
      const keyMap = {
        'enter': '0x0D',
        'space': '0x20',
        'escape': '0x1B',
        'tab': '0x09',
        'backspace': '0x08',
        'delete': '0x2E',
        'f1': '0x70',
        'f2': '0x71',
        'f3': '0x72',
        'f4': '0x73',
        'f5': '0x74',
        'f6': '0x75',
        'f7': '0x76',
        'f8': '0x77',
        'f9': '0x78',
        'f10': '0x79',
        'f11': '0x7A',
        'f12': '0x7B'
      };

      const keyCode = keyMap[key.toLowerCase()] || `0x${key.charCodeAt(0).toString(16)}`;

      const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

class PressKey {
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    const uint KEYEVENTF_KEYUP = 0x02;
    
    static void Main(string[] args) {
        byte keyCode = (byte)int.Parse(args[0]);
        
        // 按下
        keybd_event(keyCode, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        
        // 释放
        keybd_event(keyCode, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        
        Console.WriteLine($"Pressed key: {keyCode}");
    }
}`;

      const csFile = path.join(tempDir, 'PressKey.cs');
      const exeFile = path.join(tempDir, 'PressKey.exe');
      
      await fs.writeFile(csFile, csharpCode);
      await execAsync(`csc /target:exe /out:"${exeFile}" "${csFile}"`);
      
      const { stdout } = await execAsync(`"${exeFile}" ${keyCode}`);
      this.log(`Key press output: ${stdout}`);
      
      await fs.unlink(csFile).catch(() => {});
      await fs.unlink(exeFile).catch(() => {});
      
    } catch (error) {
      this.log(`Windows API key press failed: ${error.message}`);
    }
  }
}

// 工作的自动化记录器（集成智能录制）
class WorkingAutomationRecorder {
  constructor() {
    this.controller = new WorkingWindowsController();
    this.intelligentRecorder = new IntelligentRecorder(this.controller);
    this.isRecording = false;
    this.isIntelligentRecording = false;
    this.actions = [];
    this.sessionId = null;
    this.recordingDir = './recordings';
    this.replaySpeed = 1.0;
    this.init();
  }
  
  async init() {
    try {
      await fs.mkdir(this.recordingDir, { recursive: true });
      await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
      await fs.mkdir(path.join(__dirname, 'screenshots'), { recursive: true });
    } catch (error) {
      console.error('Error creating directories:', error);
    }
  }

  // 智能录制方法
  async startIntelligentRecording() {
    this.isIntelligentRecording = true;
    this.sessionId = `intelligent_session_${Date.now()}`;
    
    // 启动智能监控
    const monitoringStarted = await this.intelligentRecorder.startIntelligentMonitoring();
    
    if (monitoringStarted) {
      this.controller.log(`Intelligent recording started: ${this.sessionId}`);
      return this.sessionId;
    } else {
      this.isIntelligentRecording = false;
      throw new Error('Failed to start intelligent monitoring');
    }
  }

  async stopIntelligentRecording() {
    if (!this.isIntelligentRecording) return null;
    
    this.isIntelligentRecording = false;
    
    // 停止智能监控并获取分析结果
    const analysis = await this.intelligentRecorder.stopIntelligentMonitoring();
    
    const result = {
      sessionId: this.sessionId,
      type: 'intelligent_recording',
      totalEvents: analysis.totalEvents,
      relevantActions: analysis.relevantActions,
      actions: analysis.actions,
      summary: {
        workflow: analysis.summary,
        duration: this.calculateIntelligentDuration(analysis.actions)
      }
    };
    
    await this.saveRecording(result);
    return result;
  }

  calculateIntelligentDuration(actions) {
    if (actions.length < 2) return '0秒';
    
    const start = new Date(actions[0].timestamp);
    const end = new Date(actions[actions.length - 1].timestamp);
    const seconds = Math.round((end - start) / 1000);
    
    return `${seconds}秒`;
  }

  // 手动录制方法
  startRecording() {
    this.isRecording = true;
    this.actions = [];
    this.sessionId = `session_${Date.now()}`;
    return this.sessionId;
  }
  
  async stopRecording() {
    if (!this.isRecording) return null;
    
    this.isRecording = false;
    const result = {
      sessionId: this.sessionId,
      type: 'manual_recording',
      totalActions: this.actions.length,
      actions: this.actions,
      summary: {
        actionCount: this.actions.length,
        workflow: this.actions.map((a, i) => `${i + 1}. ${a.description}`)
      }
    };
    
    await this.saveRecording(result);
    return result;
  }
  
  async addAction(description, context = {}) {
    if (!this.isRecording) return false;
    
    const action = {
      timestamp: new Date().toISOString(),
      description: description,
      context: context
    };
    
    this.actions.push(action);
    return true;
  }

  // 录制回放功能
  async replayRecording(sessionId, speed = 1.0) {
    try {
      this.controller.log(`=== Replaying Recording: ${sessionId} ===`);
      
      const recordingPath = path.join(this.recordingDir, `${sessionId}.json`);
      const recordingData = JSON.parse(await fs.readFile(recordingPath, 'utf8'));
      
      this.replaySpeed = speed;
      const actions = recordingData.actions;
      
      this.controller.log(`Found ${actions.length} actions to replay`);
      
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        this.controller.log(`Replaying action ${i + 1}/${actions.length}: ${action.description}`);
        
        await this.replayAction(action);
        
        // 计算等待时间
        if (i < actions.length - 1) {
          const currentTime = new Date(action.timestamp);
          const nextTime = new Date(actions[i + 1].timestamp);
          const delay = Math.max(100, (nextTime - currentTime) / this.replaySpeed);
          await this.controller.sleep(delay);
        }
      }
      
      this.controller.log('Recording replay completed');
      return true;
      
    } catch (error) {
      this.controller.log(`Replay failed: ${error.message}`);
      return false;
    }
  }

  async replayAction(action) {
    try {
      switch (action.type) {
        case 'mouse_click':
          if (action.position) {
            await this.clickAt(action.position.x, action.position.y);
          }
          break;
          
        case 'window_change':
          // 窗口切换可能需要特殊处理
          this.controller.log(`Window change detected: ${action.description}`);
          break;
          
        case 'keyboard_input':
          if (action.content) {
            await this.controller.typeString(action.content);
          }
          break;
          
        case 'screenshot':
          // 截图动作在回放时跳过
          this.controller.log('Skipping screenshot action in replay');
          break;
          
        default:
          this.controller.log(`Unknown action type: ${action.type}`);
      }
    } catch (error) {
      this.controller.log(`Failed to replay action: ${error.message}`);
    }
  }

  // 列出所有录制记录
  async listRecordings() {
    try {
      const files = await fs.readdir(this.recordingDir);
      const recordings = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.recordingDir, file);
            const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
            recordings.push({
              sessionId: data.sessionId,
              type: data.type,
              actionCount: data.totalActions || data.relevantActions || 0,
              created: file.replace('.json', '').split('_').pop()
            });
          } catch (error) {
            // 跳过损坏的文件
          }
        }
      }
      
      return recordings;
    } catch (error) {
      this.controller.log(`Failed to list recordings: ${error.message}`);
      return [];
    }
  }

  async openFile(filePath) {
    return await this.controller.openFileIntelligent(filePath);
  }

  async clickAt(x, y, button = 'left') {
    await this.controller.clickMouse(button, x, y);
  }

  async screenshot() {
    return await this.controller.captureScreen();
  }

  async pressKey(key) {
    await this.controller.pressKey(key);
  }

  async typeText(text) {
    await this.controller.typeString(text);
  }

  async saveRecording(result) {
    try {
      const filePath = path.join(this.recordingDir, `${result.sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(result, null, 2));
      this.controller.log(`Recording saved: ${filePath}`);
    } catch (error) {
      console.error('Error saving recording:', error);
    }
  }

  // 获取系统信息
  getSystemInfo() {
    return {
      screenInfo: this.controller.screenInfo,
      inputMethod: this.controller.currentInputMethod,
      robotjsAvailable: !!this.controller.robotjs,
      fallbackMode: this.controller.useFallback
    };
  }
}

// 创建工作的自动化记录器实例
const automation = new WorkingAutomationRecorder();

// 创建 MCP 服务器
const server = new Server(
  {
    name: 'comprehensive-windows-automation',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'start_recording',
        description: '开始手动录制操作',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'stop_recording',
        description: '停止手动录制',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'record_action',
        description: '手动记录操作',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: '操作描述'
            }
          },
          required: ['description']
        }
      },
      {
        name: 'start_intelligent_recording',
        description: '开始智能自动录制（自动检测并理解用户操作）',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'stop_intelligent_recording',
        description: '停止智能自动录制并分析操作',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'open_file',
        description: '智能打开文件（已修复路径转义问题）',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: '文件完整路径'
            }
          },
          required: ['filePath']
        }
      },
      {
        name: 'click_at',
        description: '点击指定坐标',
        inputSchema: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            button: { type: 'string', default: 'left' }
          },
          required: ['x', 'y']
        }
      },
      {
        name: 'take_screenshot',
        description: '截图（已修复PNG格式问题）',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_screen_info',
        description: '获取屏幕信息',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'replay_recording',
        description: '回放指定的录制记录',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: '要回放的会话ID'
            },
            speed: {
              type: 'number',
              description: '回放速度倍数（默认1.0）',
              default: 1.0
            }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'list_recordings',
        description: '列出所有录制记录',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'press_key',
        description: '按下指定按键',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: '要按下的按键名称'
            }
          },
          required: ['key']
        }
      },
      {
        name: 'type_text',
        description: '输入文本',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: '要输入的文本'
            }
          },
          required: ['text']
        }
      },
      {
        name: 'get_system_info',
        description: '获取系统和控制器信息',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ]
  };
});

// 工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};
  
  automation.controller.log(`Tool called: ${toolName} with args: ${JSON.stringify(args)}`);
  
  try {
    switch (toolName) {
      case 'start_intelligent_recording':
        try {
          const sessionId = await automation.startIntelligentRecording();
          return {
            content: [{
              type: 'text',
              text: `🤖 智能自动录制已开始！

会话ID: ${sessionId}

✨ 智能监控功能:
• 自动检测鼠标点击位置和动作
• 自动识别窗口切换和程序打开
• 自动截图记录操作过程
• 智能分析和描述用户行为
• 识别Excel单元格位置（估算）
• 监控键盘输入活动

🎯 现在请开始您的操作:
• 打开文件、程序或网站
• 点击按钮、菜单或链接
• 切换窗口或应用程序
• 在Excel中点击单元格
• 进行任何您想要录制的操作

系统会自动监控并理解您的操作，无需手动输入描述。
完成后请说"停止智能录制"。

⚠️ 注意: 
• 监控期间会定期截图，请确保屏幕内容适宜
• 避免涉及敏感信息的操作
• 建议录制时间不超过5分钟以保证性能
• 录制的操作可以通过replay_recording工具回放`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `❌ 智能录制启动失败: ${error.message}

可能的原因:
• 系统权限不足
• C#编译器不可用
• 监控组件初始化失败

请检查控制台日志获取详细错误信息。`
            }]
          };
        }
        
      case 'stop_intelligent_recording':
        try {
          const result = await automation.stopIntelligentRecording();
          if (!result) {
            return {
              content: [{
                type: 'text',
                text: '❌ 没有正在进行的智能录制。'
              }]
            };
          }
          
          return {
            content: [{
              type: 'text',
              text: `🎯 智能录制分析完成！

📋 录制结果:
• 会话ID: ${result.sessionId}
• 总监控事件: ${result.totalEvents}
• 识别的有效操作: ${result.relevantActions}
• 录制时长: ${result.summary.duration}

🤖 AI识别的操作序列:
${result.summary.workflow.join('\n')}

📊 详细分析:
• 自动过滤了无关的鼠标移动事件
• 智能识别了窗口切换和程序打开
• 分析了点击位置的上下文含义
• 保存了关键时刻的截图
• 估算了Excel中的单元格位置

💾 录制数据已保存，可用于后续分析和重现。

🔄 回放操作: 使用 replay_recording 工具和会话ID "${result.sessionId}" 可以重现这些操作。

🔍 如需查看详细事件日志，请检查控制台输出。`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `❌ 智能录制停止失败: ${error.message}

请检查控制台日志获取详细错误信息。`
            }]
          };
        }
      
      case 'open_file':
        automation.controller.log(`=== OPEN_FILE TOOL CALLED ===`);
        
        // 修复路径转义问题
        let filePath = args.filePath;
        
        // 处理路径中的转义字符问题
        if (typeof filePath === 'string') {
          const originalPath = filePath;
          
          // 修复 \t 被解析为 tab 的问题
          filePath = filePath.replace(/\\\s/g, '\\t'); // 修复 \t 转义问题
          filePath = filePath.replace(/\\\n/g, '\\n'); // 修复 \n 转义问题
          filePath = filePath.replace(/\\\r/g, '\\r'); // 修复 \r 转义问题
          
          // 特殊处理test-data路径问题
          if (filePath.includes(' est-data')) {
            filePath = filePath.replace(/ est-data/g, 'test-data');
          }
          
          automation.controller.log(`Original path: ${originalPath}`);
          automation.controller.log(`Fixed path: ${filePath}`);
        }
        
        const openSuccess = await automation.openFile(filePath);
        
        return {
          content: [{
            type: 'text',
            text: openSuccess ? 
              `✅ 智能打开文件成功: ${filePath}

路径修复信息:
• 原始路径: ${args.filePath}
• 修复后路径: ${filePath}
• 修复内容: 转义字符处理

支持的打开方式:
• Win+R运行对话框（默认）
• PowerShell命令行
• Windows资源管理器

检查控制台日志查看详细执行过程。` : 
              `❌ 文件打开失败: ${filePath}

请检查：
1. 文件路径是否正确
2. 文件是否存在
3. 是否有访问权限
4. 查看控制台日志了解详细错误`
          }]
        };
      
      case 'take_screenshot':
        automation.controller.log('=== TAKE_SCREENSHOT TOOL CALLED ===');
        
        try {
          const screenshotPath = await automation.screenshot();
          
          // 验证截图文件
          const isValid = await automation.controller.verifyScreenshot(screenshotPath);
          
          return {
            content: [{
              type: 'text',
              text: `📸 截图${isValid ? '成功' : '可能有问题'}保存: ${screenshotPath}

文件状态: ${isValid ? '✅ 正常' : '⚠️ 可能损坏'}

修复内容:
• 使用高质量PNG格式
• 添加了文件完整性验证
• 改进了Windows API截图实现
• 增加了详细的错误诊断
• 支持RobotJS和Windows API双重备用

如果仍无法打开PNG文件:
1. 检查文件是否存在: ${screenshotPath}
2. 查看文件大小是否为0
3. 尝试用不同的图片查看器打开
4. 检查控制台日志了解详细信息`
            }]
          };
        } catch (error) {
          automation.controller.log(`Screenshot tool error: ${error.message}`);
          return {
            content: [{
              type: 'text',
              text: `❌ 截图失败: ${error.message}

请检查：
1. 屏幕访问权限
2. 磁盘写入权限  
3. C#编译器是否正常
4. 磁盘空间是否充足

查看控制台日志获取详细错误信息。`
            }]
          };
        }
      
      case 'start_recording':
        const sessionId = automation.startRecording();
        return {
          content: [{
            type: 'text',
            text: `🎬 手动录制已开始！

会话ID: ${sessionId}

现在请手动描述您的每个操作。
完成后说"停止录制"。

💡 提示: 如果希望自动检测操作，请使用"开始智能录制"功能。`
          }]
        };
        
      case 'stop_recording':
        const result = await automation.stopRecording();
        if (!result) {
          return {
            content: [{
              type: 'text',
              text: '❌ 没有正在进行的手动录制。'
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: `✅ 手动录制完成！

📋 会话信息:
• ID: ${result.sessionId}
• 操作数: ${result.totalActions}

📝 操作流程:
${result.summary.workflow.join('\n')}

🔄 回放操作: 使用 replay_recording 工具和会话ID "${result.sessionId}" 可以重现这些操作。`
          }]
        };
        
      case 'record_action':
        const success = await automation.addAction(args.description);
        return {
          content: [{
            type: 'text',
            text: success ? 
              `✓ 已记录操作: ${args.description}` : 
              '❌ 请先开始手动录制。'
          }]
        };
        
      case 'click_at':
        await automation.clickAt(args.x, args.y, args.button || 'left');
        return {
          content: [{
            type: 'text',
            text: `🖱️ 已点击坐标 (${args.x}, ${args.y}) 使用${args.button || 'left'}键`
          }]
        };
        
      case 'replay_recording':
        try {
          const replaySuccess = await automation.replayRecording(args.sessionId, args.speed || 1.0);
          return {
            content: [{
              type: 'text',
              text: replaySuccess ? 
                `✅ 录制回放完成！

会话ID: ${args.sessionId}
回放速度: ${args.speed || 1.0}x

所有操作已按录制顺序重现。` : 
                `❌ 录制回放失败: ${args.sessionId}

可能的原因:
• 会话ID不存在
• 录制文件损坏
• 系统环境变化
• 权限不足

请检查控制台日志获取详细错误信息。`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `❌ 回放出错: ${error.message}`
            }]
          };
        }
        
      case 'list_recordings':
        try {
          const recordings = await automation.listRecordings();
          if (recordings.length === 0) {
            return {
              content: [{
                type: 'text',
                text: '📁 暂无录制记录。'
              }]
            };
          }
          
          const recordingList = recordings.map((rec, index) => 
            `${index + 1}. ${rec.sessionId} (${rec.type}) - ${rec.actionCount}个操作`
          ).join('\n');
          
          return {
            content: [{
              type: 'text',
              text: `📋 录制记录列表:

${recordingList}

💡 使用 replay_recording 工具和会话ID来回放任何录制。`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `❌ 获取录制列表失败: ${error.message}`
            }]
          };
        }
        
      case 'press_key':
        await automation.pressKey(args.key);
        return {
          content: [{
            type: 'text',
            text: `⌨️ 已按下按键: ${args.key}`
          }]
        };
        
      case 'type_text':
        await automation.typeText(args.text);
        return {
          content: [{
            type: 'text',
            text: `📝 已输入文本: "${args.text}"`
          }]
        };
        
      case 'get_screen_info':
        const screenInfo = automation.controller.screenInfo;
        return {
          content: [{
            type: 'text',
            text: `🖥️ 屏幕信息:
• 尺寸: ${screenInfo.width} × ${screenInfo.height}
• 控制器: ${automation.controller.robotjs ? 'RobotJS' : 'Windows API'}
• 输入法: ${automation.controller.currentInputMethod?.name || '未知'}
• 回退模式: ${automation.controller.useFallback ? '是' : '否'}`
          }]
        };
        
      case 'get_system_info':
        const sysInfo = automation.getSystemInfo();
        return {
          content: [{
            type: 'text',
            text: `🔧 系统信息:

📺 屏幕:
• 分辨率: ${sysInfo.screenInfo.width} × ${sysInfo.screenInfo.height}
• 缩放因子: ${sysInfo.screenInfo.scaleFactor}
• DPI: ${sysInfo.screenInfo.dpi}

⌨️ 输入:
• 当前输入法: ${sysInfo.inputMethod?.name || '未知'}
• 英文模式: ${sysInfo.inputMethod?.isEnglish ? '是' : '否'}

🤖 控制器:
• RobotJS可用: ${sysInfo.robotjsAvailable ? '是' : '否'}
• 回退模式: ${sysInfo.fallbackMode ? '是（使用Windows API）' : '否'}

💡 系统状态: ${sysInfo.robotjsAvailable ? '最佳性能' : '基础功能（建议安装RobotJS）'}`
          }]
        };
        
      default:
        return {
          content: [{
            type: 'text',
            text: `❌ 未知工具: ${toolName}`
          }]
        };
    }
  } catch (error) {
    automation.controller.log(`Tool ${toolName} error: ${error.message}`);
    return {
      content: [{
        type: 'text',
        text: `❌ 工具 ${toolName} 执行出错: ${error.message}

请检查控制台日志获取详细错误信息。`
      }]
    };
  }
});

// 启动服务器
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('🚀 Comprehensive Windows Automation MCP server started successfully');
    console.error('📋 Available features:');
    console.error('   • 智能自动录制 (start_intelligent_recording)');
    console.error('   • 手动录制 (start_recording)');
    console.error('   • 录制回放 (replay_recording)');
    console.error('   • 文件操作 (open_file)');
    console.error('   • 屏幕截图 (take_screenshot)');
    console.error('   • 鼠标点击 (click_at)');
    console.error('   • 键盘输入 (press_key, type_text)');
    console.error('   • 系统信息 (get_screen_info, get_system_info)');
    console.error('🎯 Ready for automation tasks!');
  } catch (error) {
    console.error('❌ Server startup error:', error);
    process.exit(1);
  }
}

// 优雅关闭处理
process.on('SIGINT', async () => {
  console.error('🛑 Received SIGINT, shutting down gracefully...');
  try {
    if (automation.isIntelligentRecording) {
      console.error('🔄 Stopping intelligent recording...');
      await automation.stopIntelligentRecording();
    }
    if (automation.isRecording) {
      console.error('🔄 Stopping manual recording...');
      await automation.stopRecording();
    }
    console.error('✅ Cleanup completed');
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('🛑 Received SIGTERM, shutting down gracefully...');
  try {
    if (automation.isIntelligentRecording) {
      await automation.stopIntelligentRecording();
    }
    if (automation.isRecording) {
      await automation.stopRecording();
    }
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
  process.exit(0);
});

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// 启动主函数
main().catch((error) => {
  console.error('💥 Server startup failed:', error);
  process.exit(1);
});