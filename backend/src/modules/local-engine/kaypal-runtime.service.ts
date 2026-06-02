import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { LocalControllerBridgeService } from './local-controller-bridge.service';

@Injectable()
export class KaypalRuntimeService implements OnModuleInit {
  private readonly logger = new Logger(KaypalRuntimeService.name);
  private runtimeProcess: ChildProcess | null = null;
  private readonly runtimeUrl: string;
  private readonly runtimePath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly localControllerBridge: LocalControllerBridgeService,
  ) {
    this.runtimeUrl =
      this.configService.get<string>('KAYPAL_RUNTIME_URL') ||
      'http://127.0.0.1:8001';
    this.runtimePath =
      this.configService.get<string>('KAYPAL_RUNTIME_PATH') ||
      join(
        process.cwd(),
        '..',
        '..',
        'kaypal-ai',
        'services',
        'kaypal-runtime',
      );
  }

  async onModuleInit() {
    if (process.env.AUTO_START_KAYPAL_RUNTIME !== 'false') {
      await this.ensureRuntimeRunning();
    }
  }

  async ensureRuntimeRunning(): Promise<boolean> {
    await this.localControllerBridge.ensureBridgeRunning();

    if (await this.isRuntimeRunning()) {
      this.logger.log('Kaypal Runtime 已在运行');
      return true;
    }

    this.logger.log('正在启动 Kaypal Runtime...');
    return await this.startRuntime();
  }

  private async isRuntimeRunning(): Promise<boolean> {
    try {
      const token =
        this.configService.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') || '';
      const response = await fetch(`${this.runtimeUrl}/healthz`, {
        method: 'GET',
        headers: {
          'x-kaypal-runtime-token': token,
        },
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async startRuntime(): Promise<boolean> {
    if (!existsSync(this.runtimePath)) {
      this.logger.warn(`Kaypal Runtime 路径不存在: ${this.runtimePath}`);
      return false;
    }

    try {
      const uvPath = 'uv';
      const args = [
        'run',
        '--project',
        this.runtimePath,
        'uvicorn',
        'app.main:app',
        '--port',
        '8001',
        '--app-dir',
        this.runtimePath,
      ];

      this.runtimeProcess = spawn(uvPath, args, {
        cwd: this.runtimePath,
        env: {
          ...process.env,
          ...this.localControllerBridge.getRuntimeEnvironment(),
        },
        stdio: 'pipe',
        detached: true,
      });

      this.runtimeProcess.stdout?.on('data', (data) => {
        this.logger.log(`[Kaypal Runtime] ${data.toString().trim()}`);
      });

      this.runtimeProcess.stderr?.on('data', (data) => {
        this.logger.error(`[Kaypal Runtime] ${data.toString().trim()}`);
      });

      this.runtimeProcess.on('error', (error) => {
        this.logger.error(`Kaypal Runtime 启动失败: ${error.message}`);
      });

      this.runtimeProcess.on('exit', (code) => {
        this.logger.log(`Kaypal Runtime 已退出，退出码: ${code}`);
        this.runtimeProcess = null;
      });

      // 等待服务启动
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (await this.isRuntimeRunning()) {
          this.logger.log('Kaypal Runtime 启动成功');
          return true;
        }
      }

      this.logger.warn('Kaypal Runtime 启动超时');
      return false;
    } catch (error) {
      this.logger.error(
        `启动 Kaypal Runtime 失败: ${error instanceof Error ? error.message : '未知错误'}`,
      );
      return false;
    }
  }

  async stopRuntime(): Promise<void> {
    if (this.runtimeProcess) {
      this.logger.log('正在停止 Kaypal Runtime...');
      this.runtimeProcess.kill('SIGTERM');
      this.runtimeProcess = null;
    }
  }

  getRuntimeUrl(): string {
    return this.runtimeUrl;
  }
}
