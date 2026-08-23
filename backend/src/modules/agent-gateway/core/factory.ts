import { AgentGateway } from './agent-gateway';
import { ToolRegistry } from './tool-registry';
import { IdempotencyStore } from './idempotency';
import { ApprovalService } from './approval';
import { EventBus } from './event-bus';
import { MemoryOrchestrator } from './memory-orchestrator';
import { PayloadValidator } from './payload-validator';
import { MockOctopAdapter } from '../adapters/octop-mock';
import { MockKaypalMemoryAdapter } from '../adapters/kaypal-memory-mock';
import { buildBusinessTools } from '../adapters/business-tools';
import { STANDARD_TOOL_SPECS } from './tool-specs';

/**
 * 工厂：装配整条链路的 mock 实现 + 标准工具规范。
 * 真实落地时，把 MockOctopAdapter / MockKaypalMemoryAdapter / business 执行器换成真实实现即可，
 * 核心引擎（状态机/幂等/审批/事件/编排）不变。
 */
export function createAgentGateway() {
  const registry = new ToolRegistry();
  registry.registerMany(STANDARD_TOOL_SPECS);

  const idempotency = new IdempotencyStore();
  const approvals = new ApprovalService();
  const bus = new EventBus();
  const validator = new PayloadValidator();
  const octop = new MockOctopAdapter(registry.list().map((s) => s.name));
  const memoryRemote = new MockKaypalMemoryAdapter();
  const memory = new MemoryOrchestrator(memoryRemote);
  const business = buildBusinessTools();

  const gateway = new AgentGateway({ registry, idempotency, approvals, bus, octop, memory, business, validator });
  for (const spec of STANDARD_TOOL_SPECS) gateway.registerToolSpec(spec);

  return { gateway, registry, idempotency, approvals, bus, octop, memory, memoryRemote, business, validator };
}
