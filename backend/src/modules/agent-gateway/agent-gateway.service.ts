import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createAgentGateway } from './core/factory';

/**
 * Agent Gateway 服务：单例持有核心引擎（内存态）实例。
 * 后续用 PrismaService 替换内存存储（见 docs/contracts Prisma 草案）时只改这里。
 */
@Injectable()
export class AgentGatewayService implements OnModuleDestroy {
  readonly engine = createAgentGateway();

  get gateway() {
    return this.engine.gateway;
  }
  get bus() {
    return this.engine.bus;
  }
  get memory() {
    return this.engine.memory;
  }
  get registry() {
    return this.engine.registry;
  }

  onModuleDestroy() {
    // 优雅关闭 outbox 后台 worker
    this.engine.stopOutboxWorker?.();
  }
}
