import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createAgentGateway } from './core/factory';
import { PrismaIdempotencyStore } from './prisma-store/prisma-idempotency.store';
import { PrismaApprovalStore } from './prisma-store/prisma-approval.store';
import { PrismaUsageSink } from './prisma-store/prisma-usage.sink';
import { PrismaMirror } from './prisma-store/prisma-mirror';

/**
 * Agent Gateway 服务：单例持有核心引擎实例。
 * 持久化开关：env `AGENT_GATEWAY_PERSISTENCE=prisma` 时——
 * - 幂等/审批走 DB（agent_gateway_tool_calls / agent_gateway_approvals）
 * - usage 落库（agent_gateway_usage_events，计费对账副本）
 * - 写路径镜像（session/task/event/artifact → agent_gateway_*，内存态仍权威）
 * 默认内存态（与原型一致）。引擎其余读路径仍内存态，重启恢复为下一步。
 */
@Injectable()
export class AgentGatewayService implements OnModuleDestroy {
  readonly engine: ReturnType<typeof createAgentGateway>;
  private readonly persist: boolean;
  private readonly usageSink: PrismaUsageSink;
  private readonly mirror: PrismaMirror;

  constructor(private readonly prisma: PrismaService) {
    this.persist = process.env.AGENT_GATEWAY_PERSISTENCE === 'prisma';
    this.usageSink = new PrismaUsageSink(this.prisma);
    this.mirror = new PrismaMirror(this.prisma);
    this.engine = createAgentGateway({
      ...(this.persist
        ? { idempotency: new PrismaIdempotencyStore(this.prisma), approvals: new PrismaApprovalStore(this.prisma) }
        : {}),
      usageSink: this.persist ? (ev) => this.usageSink.record(ev) : undefined,
      mirror: this.persist ? this.mirror : undefined,
    });
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
