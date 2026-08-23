import { AgentGateway } from './agent-gateway';
import { ToolRegistry } from './tool-registry';
import { IdempotencyStore } from './idempotency';
import { ApprovalService } from './approval';
import { EventBus } from './event-bus';
import { MemoryOrchestrator, OutboxDbLike } from './memory-orchestrator';
import { PayloadValidator } from './payload-validator';
import { AgentGatewayMirror } from './mirror';
import { UsageEvent } from './types';
import { MockOctopAdapter } from '../adapters/octop-mock';
import { MockKaypalMemoryAdapter } from '../adapters/kaypal-memory-mock';
import { buildBusinessTools } from '../adapters/business-tools';
import { STANDARD_TOOL_SPECS } from './tool-specs';

/**
 * 工厂：装配整条链路的 mock 实现 + 标准工具规范。
 * 真实落地时，把 MockOctopAdapter / MockKaypalMemoryAdapter / business 执行器换成真实实现即可，
 * 核心引擎（状态机/幂等/审批/事件/编排）不变。
 *
 * P1-3：默认启动 MemoryOutbox 后台重试 worker（可传 opts.startOutboxWorker=false 关闭，
 * 测试里需要自行控制 timer 时使用）。
 */
export function createAgentGateway(opts: {
  startOutboxWorker?: boolean;
  /** 可注入 DB 幂等仓储（同 IdempotencyStore 语义，sync/async 均兼容；真实仓库用 agent_gateway_tool_calls） */
  idempotency?: { claim: (...a: unknown[]) => unknown; markDone: (...a: unknown[]) => unknown; release?: (...a: unknown[]) => unknown; get?: (...a: unknown[]) => unknown };
  /** 可注入 DB 审批仓储（同 ApprovalService 语义；真实仓库用 agent_gateway_approvals） */
  approvals?: { create: (...a: unknown[]) => unknown; get?: (...a: unknown[]) => unknown; validate: (...a: unknown[]) => unknown; consume: (...a: unknown[]) => unknown; reject?: (...a: unknown[]) => unknown };
  /** usage 持久化 sink（真实仓库落 agent_gateway_usage_events） */
  usageSink?: (ev: UsageEvent) => void | Promise<void>;
  /** 写路径持久化镜像（session/task/event/artifact；真实仓库 PrismaMirror） */
  mirror?: AgentGatewayMirror;
  /** outbox DB 仓储（可选；真实仓库落 agent_gateway_memory_outbox，重启续跑） */
  outboxDb?: OutboxDbLike;
} = {}) {
  const registry = new ToolRegistry();
  registry.registerMany(STANDARD_TOOL_SPECS);

  const idempotency = (opts.idempotency ?? new IdempotencyStore()) as IdempotencyStore;
  const approvals = (opts.approvals ?? new ApprovalService()) as ApprovalService;
  const bus = new EventBus(1000, (e) => {
    opts.mirror?.eventPublished?.(e);
  });
  const validator = new PayloadValidator();
  const octop = new MockOctopAdapter(registry.list().map((s) => s.name));
  const memoryRemote = new MockKaypalMemoryAdapter();
  const memory = new MemoryOrchestrator(memoryRemote, 2000, opts.outboxDb);
  const business = buildBusinessTools();

  // P1-3：远程记忆失败后自动重试（不依赖人工重放）
  let stopOutboxWorker: (() => void) | undefined;
  if (opts.startOutboxWorker !== false) {
    stopOutboxWorker = memory.startOutboxWorker(2000);
  }

  const gateway = new AgentGateway({ registry, idempotency, approvals, bus, octop, memory, business, validator, usageSink: opts.usageSink, mirror: opts.mirror });
  for (const spec of STANDARD_TOOL_SPECS) gateway.registerToolSpec(spec);

  return { gateway, registry, idempotency, approvals, bus, octop, memory, memoryRemote, business, validator, stopOutboxWorker };
}
