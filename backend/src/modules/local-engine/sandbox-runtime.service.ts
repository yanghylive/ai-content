import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import { platform } from 'os';

export interface SandboxRuntimeStatus {
  available: boolean;
  platform: string;
  dockerAvailable: boolean;
  sandboxType: string;
  message: string;
}

@Injectable()
export class SandboxRuntimeService {
  async getStatus(): Promise<SandboxRuntimeStatus> {
    const currentPlatform = platform();
    const dockerAvailable = this.checkDocker();
    const sandboxType = this.detectSandboxType(
      currentPlatform,
      dockerAvailable,
    );

    if (dockerAvailable) {
      return {
        available: true,
        platform: currentPlatform,
        dockerAvailable: true,
        sandboxType,
        message: `沙箱运行时可用：Docker 在线，平台 ${currentPlatform}，类型 ${sandboxType}`,
      };
    }

    if (currentPlatform === 'darwin') {
      return {
        available: true,
        platform: currentPlatform,
        dockerAvailable: false,
        sandboxType: 'native',
        message:
          '沙箱运行时可用：macOS native 模式（Docker 未安装，使用本机 Node.js 隔离执行）',
      };
    }

    return {
      available: false,
      platform: currentPlatform,
      dockerAvailable: false,
      sandboxType: 'none',
      message: '沙箱运行时不可用：Docker 未安装且当前平台不支持 native 沙箱',
    };
  }

  private checkDocker(): boolean {
    try {
      execSync('docker version --format "{{.Server.Version}}"', {
        stdio: 'ignore',
        timeout: 800,
      });
      return true;
    } catch {
      return false;
    }
  }

  private detectSandboxType(
    currentPlatform: string,
    dockerAvailable: boolean,
  ): string {
    if (dockerAvailable) return 'docker';
    if (currentPlatform === 'darwin') return 'native';
    if (currentPlatform === 'linux') return 'native';
    if (currentPlatform === 'win32') return 'wsl2';
    return 'none';
  }
}
