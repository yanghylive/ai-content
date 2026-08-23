import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createAgentGateway } from './core/factory';
import { PrismaIdempotencyStore } from './prisma-store/prisma-idempotency.store';
import { PrismaApprovalStore } from './prisma-store/prisma-approval.store';
import { PrismaUsageSink } from './prisma-store/prisma-usage.sink';
import { PrismaMirror } from './prisma-store/prisma-mirror';
import { PrismaHydrator } from './prisma-store/prisma-hydrator';
import { PrismaOutboxStore } from './prisma-store/prisma-outbox.store';
import { RealOctopAdapter } from './adapters/real-octop-adapter';

/**
 * Agent Gateway 服务：单例持有核心引擎实例。
 * 持久化开关：env `AGENT_GATEWAY_PERSISTENCE=prisma` 时——
 * - 幂等/审批走 DB（agent_gateway_tool_calls / agent_gateway_approvals）
 * - usage 落库（agent_gateway_usage_events，计费对账副本）
 * - 写路径镜像（session/task/event/artifact → agent_gateway_*，内存态仍权威）
 * - 启动 onModuleInit 从 DB 反灌内存（重启恢复：只恢复 active 未过期会话及其资源）
 * 默认内存态（与原型一致）。
 */
@Injectable()
export class AgentGatewayService implements OnModuleInit, OnModuleDestroy {
  readonly engine: ReturnType<typeof createAgentGateway>;
  private readonly persist: boolean;
  private readonly usageSink: PrismaUsageSink;
  private readonly mirror: PrismaMirror;
  private readonly hydrator: PrismaHydrator;
  private readonly outboxStore: PrismaOutboxStore;

  constructor(private readonly prisma: PrismaService) {
    this.persist = process.env.AGENT_GATEWAY_PERSISTENCE === 'prisma';
    this.usageSink = new PrismaUsageSink(this.prisma);
    this.mirror = new PrismaMirror(this.prisma);
    this.hydrator = new PrismaHydrator(this.prisma);
    this.outboxStore = new PrismaOutboxStore(this.prisma);
    this.engine = createAgentGateway({
      ...(this.persist
        ? { idempotency: new PrismaIdempotencyStore(this.prisma), approvals: new PrismaApprovalStore(this.prisma) }
        : {}),
      usageSink: this.persist ? (ev) => this.usageSink.record(ev) : undefined,
      mirror: this.persist ? this.mirror : undefined,
      outboxDb: this.persist ? this.outboxStore : undefined,
      // 真实 Octop 适配器：OCTOP_BASE_URL 配置后启用（凭据 OCTOP_API_PASSWORD / OCTOP_ACCESS_TOKEN）
      octop: process.env.OCTOP_BASE_URL ? new RealOctopAdapter() : undefined,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.persist) return;
    // 重启恢复：写路径镜像的读侧（DB → 内存）
    const data = await this.hydrator.hydrate();
    this.engine.gateway.hydrate(data);
    // outbox 续跑：恢复 pending/dead 记录，worker 自动重试
    const pending = await this.outboxStore.loadPending();
    this.engine.memory.hydrateOutbox(pending);
    if (data.sessions.length > 0 || pending.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[agent-gateway] 恢复 ${data.sessions.length} 会话 / ${data.tasks.length} 任务 / ${data.events.length} 事件 / ${pending.length} outbox`,
      );
    }
  }

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
