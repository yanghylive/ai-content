// local-engine 桌面控制检查簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；簇内互调走 this（通过 DesktopControlHost 接口）。
// 本簇方法完全自包含：仅依赖 node:os platform 与 child_process 的 execSync，无 service 业务字段访问。

import { execSync } from 'node:child_process';
import { platform } from 'node:os';

/** desktop 控制检查簇的 host 接口：本簇方法互调走 this（声明签名即可，无业务字段） */
export interface DesktopControlHost {
  checkDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkMacOSDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkWindowsDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkLinuxDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkMacOSAccessibility(): boolean;
  checkMacOSScreenRecording(): boolean;
  checkWindowsUIAutomation(): boolean;
  checkWindowsScreenCapture(): boolean;
  checkLinuxX11(): boolean;
  checkLinuxXdotool(): boolean;
}

export function checkDesktopControl(this: DesktopControlHost) {
  const currentPlatform = platform();

  if (currentPlatform === 'darwin') {
    return this.checkMacOSDesktopControl();
  } else if (currentPlatform === 'win32') {
    return this.checkWindowsDesktopControl();
  } else if (currentPlatform === 'linux') {
    return this.checkLinuxDesktopControl();
  }

  return {
    status: 'warning' as const,
    summary: `当前系统 ${currentPlatform} 暂不支持桌面控制。`,
    nextAction: '桌面控制目前仅支持 macOS、Windows 和 Linux 系统。',
    checks: [
      {
        name: '操作系统',
        status: 'warning' as const,
        message: `当前系统：${currentPlatform}，不在支持列表中。`,
      },
    ],
  };
}

export function checkMacOSDesktopControl(this: DesktopControlHost) {
  const hasAccessibility = this.checkMacOSAccessibility();
  const hasScreenRecording = this.checkMacOSScreenRecording();
  const allPermissionsGranted = hasAccessibility && hasScreenRecording;

  return {
    status: allPermissionsGranted ? 'ready' : 'warning',
    summary: allPermissionsGranted
      ? 'macOS 桌面控制权限已授予，可以执行桌面自动化任务。'
      : '已识别 macOS 环境，需要用户授予辅助功能和屏幕录制权限。',
    nextAction: allPermissionsGranted
      ? ''
      : '请在 macOS 系统设置 > 隐私与安全性 中授予"辅助功能"和"屏幕录制"权限，然后刷新此页面。',
    checks: [
      {
        name: '操作系统',
        status: 'ready' as const,
        message: 'macOS，可接入桌面控制。',
      },
      {
        name: '辅助功能权限',
        status: hasAccessibility ? 'ready' : 'warning',
        message: hasAccessibility
          ? '辅助功能权限已授予。'
          : '请在 系统设置 > 隐私与安全性 > 辅助功能 中勾选本应用。',
      },
      {
        name: '屏幕录制权限',
        status: hasScreenRecording ? 'ready' : 'warning',
        message: hasScreenRecording
          ? '屏幕录制权限已授予。'
          : '请在 系统设置 > 隐私与安全性 > 屏幕录制 中勾选本应用。',
      },
    ],
  };
}

export function checkWindowsDesktopControl(this: DesktopControlHost) {
  const hasUIAutomation = this.checkWindowsUIAutomation();
  const hasScreenCapture = this.checkWindowsScreenCapture();
  const allPermissionsGranted = hasUIAutomation && hasScreenCapture;

  return {
    status: allPermissionsGranted ? 'ready' : 'warning',
    summary: allPermissionsGranted
      ? 'Windows 桌面控制权限已授予，可以执行桌面自动化任务。'
      : '已识别 Windows 环境，需要检查 UI Automation 和屏幕捕获权限。',
    nextAction: allPermissionsGranted
      ? ''
      : '请确保以管理员身份运行本应用，并在 Windows 安全中心允许屏幕捕获。',
    checks: [
      {
        name: '操作系统',
        status: 'ready' as const,
        message: 'Windows，可接入桌面控制。',
      },
      {
        name: 'UI Automation',
        status: hasUIAutomation ? 'ready' : 'warning',
        message: hasUIAutomation
          ? 'UI Automation 接口可用。'
          : '请确保以管理员身份运行本应用，以启用 UI Automation 接口。',
      },
      {
        name: '屏幕捕获',
        status: hasScreenCapture ? 'ready' : 'warning',
        message: hasScreenCapture
          ? '屏幕捕获权限已授予。'
          : '请在 Windows 安全中心 > 隐私 > 屏幕捕获 中允许本应用。',
      },
    ],
  };
}

export function checkLinuxDesktopControl(this: DesktopControlHost) {
  const hasX11 = this.checkLinuxX11();
  const hasXdotool = this.checkLinuxXdotool();
  const allPermissionsGranted = hasX11 && hasXdotool;

  return {
    status: allPermissionsGranted ? 'ready' : 'warning',
    summary: allPermissionsGranted
      ? 'Linux 桌面控制权限已授予，可以执行桌面自动化任务。'
      : '已识别 Linux 环境，需要检查 X11/Wayland 和 xdotool 工具。',
    nextAction: allPermissionsGranted
      ? ''
      : '请确保已安装 xdotool（sudo apt install xdotool）并在 X11 会话中运行。',
    checks: [
      {
        name: '操作系统',
        status: 'ready' as const,
        message: 'Linux，可接入桌面控制。',
      },
      {
        name: 'X11/Wayland',
        status: hasX11 ? 'ready' : 'warning',
        message: hasX11
          ? 'X11 显示服务器可用。'
          : '请确保在 X11 会话中运行（Wayland 支持有限）。',
      },
      {
        name: 'xdotool 工具',
        status: hasXdotool ? 'ready' : 'warning',
        message: hasXdotool
          ? 'xdotool 已安装。'
          : '请安装 xdotool：sudo apt install xdotool',
      },
    ],
  };
}

export function checkMacOSAccessibility(this: DesktopControlHost): boolean {
  try {
    const result = execSync('tccutil list | grep -i accessibility', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 800,
    });
    return result.includes('kTCCServiceAccessibility');
  } catch {
    return false;
  }
}

export function checkMacOSScreenRecording(this: DesktopControlHost): boolean {
  try {
    const result = execSync('tccutil list | grep -i screen', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 800,
    });
    return result.includes('kTCCServiceScreenCapture');
  } catch {
    return false;
  }
}

export function checkWindowsUIAutomation(this: DesktopControlHost): boolean {
  try {
    execSync(
      'powershell -Command "Add-Type -AssemblyName UIAutomationClient"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 800 },
    );
    return true;
  } catch {
    return false;
  }
}

export function checkWindowsScreenCapture(this: DesktopControlHost): boolean {
  try {
    execSync(
      'powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 800 },
    );
    return true;
  } catch {
    return false;
  }
}

export function checkLinuxX11(this: DesktopControlHost): boolean {
  try {
    const display = process.env.DISPLAY;
    if (!display) return false;
    execSync('xdpyinfo', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 800,
    });
    return true;
  } catch {
    return false;
  }
}

export function checkLinuxXdotool(this: DesktopControlHost): boolean {
  try {
    execSync('which xdotool', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 800,
    });
    return true;
  } catch {
    return false;
  }
}

export const desktopControlMethods = {
  checkDesktopControl,
  checkMacOSDesktopControl,
  checkWindowsDesktopControl,
  checkLinuxDesktopControl,
  checkMacOSAccessibility,
  checkMacOSScreenRecording,
  checkWindowsUIAutomation,
  checkWindowsScreenCapture,
  checkLinuxX11,
  checkLinuxXdotool,
};
