import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcess } from 'child_process';
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
      this.configService.get<string>('KAYPAL_RUNTIME_URL') || '';
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

  // eslint-disable-next-line @typescript-eslint/require-await -- 方法体当前同步，保留 async 签名以兼容调用方/生命周期/路由契约
  async onModuleInit() {
    if (process.env.AUTO_START_KAYPAL_RUNTIME !== 'false') {
      this.ensureRuntimeRunning();
    } else {
      this.logger.log(
        'AUTO_START_KAYPAL_RUNTIME=false — 不 spawn 8001 kaypal-runtime（plan: 不在客户交互路径上）',
      );
    }
  }

  ensureRuntimeRunning(): boolean {
    // 8001 已下线：mcp/plugin/agent-s 都改为本地查，不再 spawn 外部 runtime
    this.logger.log(
      'Kaypal Runtime (8001) 已下线：mcp/plugin/agent-s 走本地查',
    );
    return true;
  }

  async stopRuntime(): Promise<void> {
    // no-op: 8001 不再被本服务 spawn
  }

  getRuntimeUrl(): string {
    return this.runtimeUrl;
  }
}
