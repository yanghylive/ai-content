import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createAgentGateway } from './core/factory';
import { PrismaMirror } from './prisma-store/prisma-mirror';
import { PrismaIdempotencyStore } from './prisma-store/prisma-idempotency.store';
import { PrismaUsageSink } from './prisma-store/prisma-usage.sink';
import { TenantContext, ToolRequest } from './core/types';

/**
 * 4.4 多工作区标签壳 · step1-5 端到端隔离验证（真实 Prisma 存储，无需 Kaypal 凭据）。
 * 链路：createSession → createTask → executeTool（含 tool_call / usage 落库），
 * 断言两个 workspace 的 session/task/toolCall/usageEvent 各行按 workspaceId 归属、互不串扰。
 */
const hasDb = process.env.E2E_REAL_CHAIN === '1';
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);
const T = 'ws_e2e';
const test = hasDb ? it : it.skip;

async function clean() {
  await prisma.agentGatewayToolCall.deleteMany({ where: { tenantId: T } });
  await prisma.agentGatewayUsageEvent.deleteMany({ where: { tenantId: T } });
  await prisma.agentGatewayEvent.deleteMany({ where: { tenantId: T } });
  await prisma.agentGatewayTask.deleteMany({ where: { tenantId: T } });
  await prisma.agentGatewaySession.deleteMany({ where: { tenantId: T } });
}

function toolReq(key: string, sessionId: string, taskId: string, ws: string): ToolRequest {
  return {
    requestId: `r_${key}`,
    tenantId: T,
    userId: 'ws_e2e_u',
    agentId: 'a1',
    workspaceId: ws,
    sessionId,
    taskId,
    idempotencyKey: key,
    toolName: 'lead_discover',
    requiresConfirmation: false,
    payload: { limit: 1 },
  };
}

describe('Workspace 隔离端到端（4.4 step1-5）', () => {
  let gateway: ReturnType<typeof createAgentGateway>['gateway'];
  const ctxA: TenantContext = { tenantId: T, userId: 'ws_e2e_u', agentId: 'a1', workspaceId: 'wsA' };
  const ctxB: TenantContext = { tenantId: T, userId: 'ws_e2e_u', agentId: 'a1', workspaceId: 'wsB' };

  beforeAll(async () => {
    if (!hasDb) return;
    await clean();
    const sink = new PrismaUsageSink(prisma as unknown as PrismaService);
    const { gateway: g } = createAgentGateway({
      idempotency: new PrismaIdempotencyStore(prisma as unknown as PrismaService),
      mirror: new PrismaMirror(prisma as unknown as PrismaService),
      usageSink: (ev) => sink.record(ev),
    });
    gateway = g;
  });

  afterAll(async () => {
    if (hasDb) await clean();
    await prisma.$disconnect();
  });

  test('session/task/toolCall/usageEvent 按 workspace 落库且互不串扰', async () => {
    // workspace A
    const sA = await gateway.createSession(ctxA);
    const tA = gateway.createTask(ctxA, sA.id, 'lead', {});
    const oA = await gateway.executeTool(ctxA, toolReq('kA', sA.id, tA.id, 'wsA'));
    expect(oA.kind).toBe('result');

    // workspace B
    const sB = await gateway.createSession(ctxB);
    const tB = gateway.createTask(ctxB, sB.id, 'lead', {});
    const oB = await gateway.executeTool(ctxB, toolReq('kB', sB.id, tB.id, 'wsB'));
    expect(oB.kind).toBe('result');

    // 等 usage sink 异步落库
    await new Promise((r) => setTimeout(r, 150));

    const [sessions, tasks, toolCalls, usage] = await Promise.all([
      prisma.agentGatewaySession.findMany({ where: { tenantId: T } }),
      prisma.agentGatewayTask.findMany({ where: { tenantId: T } }),
      prisma.agentGatewayToolCall.findMany({ where: { tenantId: T } }),
      prisma.agentGatewayUsageEvent.findMany({ where: { tenantId: T } }),
    ]);

    // 各自 1 行，且精确归属
    expect(sessions.length).toBe(2);
    expect(sessions.find((s) => s.id === sA.id)?.workspaceId).toBe('wsA');
    expect(sessions.find((s) => s.id === sB.id)?.workspaceId).toBe('wsB');
    expect(tasks.find((t) => t.id === tA.id)?.workspaceId).toBe('wsA');
    expect(tasks.find((t) => t.id === tB.id)?.workspaceId).toBe('wsB');

    expect(toolCalls.length).toBe(2);
    expect(toolCalls.find((c) => c.idempotencyKey === 'kA')?.workspaceId).toBe('wsA');
    expect(toolCalls.find((c) => c.idempotencyKey === 'kB')?.workspaceId).toBe('wsB');

    expect(usage.length).toBe(2);
    expect(usage.find((u) => u.requestId === 'r_kA')?.workspaceId).toBe('wsA');
    expect(usage.find((u) => u.requestId === 'r_kB')?.workspaceId).toBe('wsB');

    // 反向隔离：按 wsA 查询只拿到 A 自己的行
    const byWsA = await Promise.all([
      prisma.agentGatewaySession.findMany({ where: { workspaceId: 'wsA' } }),
      prisma.agentGatewayToolCall.findMany({ where: { workspaceId: 'wsA' } }),
      prisma.agentGatewayUsageEvent.findMany({ where: { workspaceId: 'wsA' } }),
    ]);
    expect(byWsA[0].length).toBe(1);
    expect(byWsA[1].length).toBe(1);
    expect(byWsA[2].length).toBe(1);
  });
});
