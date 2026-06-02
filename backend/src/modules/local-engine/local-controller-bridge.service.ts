import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

@Injectable()
export class LocalControllerBridgeService implements OnModuleInit {
  private static sharedStartPromise: Promise<boolean> | null = null;
  private readonly logger = new Logger(LocalControllerBridgeService.name);
  private bridgeProcess: ChildProcess | null = null;
  private readonly bridgeUrl: string;
  private readonly bridgePath: string;
  private readonly bridgeToken: string;
  private readonly tokenHeader: string;
  private readonly port: string;

  constructor(private readonly configService: ConfigService) {
    this.bridgeUrl =
      this.configService.get<string>('KAYPAL_RUNTIME_BROWSER_BRIDGE_URL') ||
      'http://127.0.0.1:8090';
    this.bridgePath =
      this.configService.get<string>('KAYPAL_BROWSER_BRIDGE_PATH') ||
      join(
        process.cwd(),
        '..',
        '..',
        'kaypal-ai',
        'services',
        'kaypal-browser-bridge',
      );
    this.bridgeToken =
      this.configService.get<string>('KAYPAL_RUNTIME_BROWSER_BRIDGE_TOKEN') ||
      this.configService.get<string>('KAYPAL_BROWSER_BRIDGE_TOKEN') ||
      'ai-content-local-controller-token';
    this.tokenHeader =
      this.configService.get<string>(
        'KAYPAL_RUNTIME_BROWSER_BRIDGE_TOKEN_HEADER',
      ) || 'x-kaypal-browser-bridge-token';
    this.port = new URL(this.bridgeUrl).port || '8090';
  }

  async onModuleInit() {
    this.applyRuntimeEnvironment();
  }

  async ensureBridgeRunning(): Promise<boolean> {
    this.applyRuntimeEnvironment();

    if (LocalControllerBridgeService.sharedStartPromise) {
      return LocalControllerBridgeService.sharedStartPromise;
    }

    if (await this.isBridgeRunning()) {
      this.logger.log('本机控制桥已在运行');
      return true;
    }

    this.logger.log('正在启动本机控制桥...');
    LocalControllerBridgeService.sharedStartPromise =
      this.startBridge().finally(() => {
        LocalControllerBridgeService.sharedStartPromise = null;
      });
    return LocalControllerBridgeService.sharedStartPromise;
  }

  async isBridgeRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.bridgeUrl}/readyz`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getRuntimeEnvironment(): NodeJS.ProcessEnv {
    this.applyRuntimeEnvironment();
    return {
      KAYPAL_RUNTIME_BROWSER_BRIDGE_URL: this.bridgeUrl,
      KAYPAL_RUNTIME_BROWSER_BRIDGE_TOKEN: this.bridgeToken,
      KAYPAL_RUNTIME_BROWSER_BRIDGE_TOKEN_HEADER: this.tokenHeader,
      KAYPAL_RUNTIME_BROWSER_BRIDGE_EXECUTE_PATH: '/api/browser/execute',
      KAYPAL_RUNTIME_LOCAL_CONTROLLER_CAPABILITIES_PATH:
        '/api/local-controller/capabilities',
      KAYPAL_RUNTIME_LOCAL_CONTROLLER_EXECUTE_PATH:
        '/api/local-controller/execute',
    };
  }

  async stopBridge(): Promise<void> {
    if (!this.bridgeProcess) return;
    this.logger.log('正在停止本机控制桥...');
    this.bridgeProcess.kill('SIGTERM');
    this.bridgeProcess = null;
  }

  private async startBridge(): Promise<boolean> {
    if (!existsSync(this.bridgePath)) {
      this.logger.warn(`本机控制桥路径不存在: ${this.bridgePath}`);
      return false;
    }

    const env = this.buildBridgeEnvironment();
    this.bridgeProcess = spawn('node', ['src/index.mjs'], {
      cwd: this.bridgePath,
      env,
      stdio: 'pipe',
      detached: true,
    });

    this.bridgeProcess.stdout?.on('data', (data) => {
      this.logger.log(`[Local Controller] ${data.toString().trim()}`);
    });
    this.bridgeProcess.stderr?.on('data', (data) => {
      this.logger.error(`[Local Controller] ${data.toString().trim()}`);
    });
    this.bridgeProcess.on('error', (error) => {
      this.logger.error(`本机控制桥启动失败: ${error.message}`);
    });
    this.bridgeProcess.on('exit', (code) => {
      this.logger.log(`本机控制桥已退出，退出码: ${code}`);
      this.bridgeProcess = null;
    });

    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await this.isBridgeRunning()) {
        this.logger.log('本机控制桥启动成功');
        return true;
      }
    }

    this.logger.warn('本机控制桥启动超时');
    return false;
  }

  private buildBridgeEnvironment(): NodeJS.ProcessEnv {
    const platformProvider =
      process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32'
          ? 'windows'
          : '';
    const appControlCapabilities = [
      'local.app.open',
      'local.app.close',
      'local.window.list',
      'local.window.focus',
      'local.input.click',
      'local.input.type',
      'local.screen.screenshot',
      'local.clipboard.read',
      'local.clipboard.write',
    ];

    return {
      ...process.env,
      PORT: this.port,
      KAYPAL_BROWSER_BRIDGE_TOKEN: this.bridgeToken,
      KAYPAL_BROWSER_BRIDGE_TOKEN_HEADER: this.tokenHeader,
      KAYPAL_BROWSER_BRIDGE_HEADLESS:
        process.env.KAYPAL_BROWSER_BRIDGE_HEADLESS || 'false',
      KAYPAL_BROWSER_BRIDGE_PROFILE_ROOT:
        process.env.KAYPAL_BROWSER_BRIDGE_PROFILE_ROOT ||
        join(process.cwd(), 'data', 'browser-profiles'),
      KAYPAL_BROWSER_LOCAL_CONTROLLER_PERMISSION_MODE:
        process.env.KAYPAL_BROWSER_LOCAL_CONTROLLER_PERMISSION_MODE || 'custom',
      KAYPAL_BROWSER_LOCAL_CONTROLLER_CUSTOM_ALLOWED_CAPABILITIES:
        process.env
          .KAYPAL_BROWSER_LOCAL_CONTROLLER_CUSTOM_ALLOWED_CAPABILITIES ||
        appControlCapabilities.join(','),
      KAYPAL_BROWSER_LOCAL_CONTROLLER_APP_CONTROL_ENABLED:
        process.env.KAYPAL_BROWSER_LOCAL_CONTROLLER_APP_CONTROL_ENABLED ||
        'true',
      KAYPAL_BROWSER_LOCAL_CONTROLLER_APP_ADAPTER_PATH:
        process.env.KAYPAL_BROWSER_LOCAL_CONTROLLER_APP_ADAPTER_PATH ||
        process.execPath,
      KAYPAL_BROWSER_LOCAL_CONTROLLER_APP_ADAPTER_ARGS_JSON:
        process.env.KAYPAL_BROWSER_LOCAL_CONTROLLER_APP_ADAPTER_ARGS_JSON ||
        JSON.stringify(['src/app-control-adapter.mjs']),
      KAYPAL_BROWSER_LOCAL_CONTROLLER_ALLOWED_APP_IDS:
        process.env.KAYPAL_BROWSER_LOCAL_CONTROLLER_ALLOWED_APP_IDS ||
        'Google Chrome,Chrome,Safari,WeChat,微信,Douyin,抖音,小红书,Red,Bilibili,哔哩哔哩,快手',
      ...(platformProvider
        ? {
            KAYPAL_BROWSER_LOCAL_CONTROLLER_NATIVE_APP_PROVIDER:
              platformProvider,
          }
        : {}),
    };
  }

  private applyRuntimeEnvironment(): void {
    const runtimeEnv = this.getRuntimeEnvironmentWithoutSideEffect();
    for (const [key, value] of Object.entries(runtimeEnv)) {
      process.env[key] = value;
    }
  }

  private getRuntimeEnvironmentWithoutSideEffect(): NodeJS.ProcessEnv {
    return {
      KAYPAL_RUNTIME_BROWSER_BRIDGE_URL: this.bridgeUrl,
      KAYPAL_RUNTIME_BROWSER_BRIDGE_TOKEN: this.bridgeToken,
      KAYPAL_RUNTIME_BROWSER_BRIDGE_TOKEN_HEADER: this.tokenHeader,
      KAYPAL_RUNTIME_BROWSER_BRIDGE_EXECUTE_PATH: '/api/browser/execute',
      KAYPAL_RUNTIME_LOCAL_CONTROLLER_CAPABILITIES_PATH:
        '/api/local-controller/capabilities',
      KAYPAL_RUNTIME_LOCAL_CONTROLLER_EXECUTE_PATH:
        '/api/local-controller/execute',
    };
  }
}
