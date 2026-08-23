import { PrismaClient } from '@prisma/client';
import { PrismaIdempotencyStore } from './prisma-idempotency.store';
import { PrismaApprovalStore } from './prisma-approval.store';
import { PrismaUsageSink } from './prisma-usage.sink';
import { UsageEvent } from '../core/types';

/**
 * Prisma 仓储集成测试（需本地 pg：DATABASE_URL 指向已 deploy agent_gateway_entities 的库）。
 * 无 DATABASE_URL 环境自动跳过（CI 安全）。
 */
const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();

async function cleanTables() {
  // FK 顺序：先子后父
  await prisma.agentGatewayApproval.deleteMany();
  await prisma.agentGatewayEvidence.deleteMany();
  await prisma.agentGatewayArtifact.deleteMany();
  await prisma.agentGatewayToolCall.deleteMany();
  await prisma.agentGatewayTask.deleteMany();
  await prisma.agentGatewaySession.deleteMany();
  await prisma.agentGatewayUsageEvent.deleteMany();
  await prisma.agentGatewayMemoryOutbox.deleteMany();
  await prisma.agentGatewayDeviceLease.deleteMany();
}

const test = hasDb ? it : it.skip;

async function makeTask(tenantId: string, type = 'lead'): Promise<string> {
  const session = await prisma.agentGatewaySession.create({
    data: { tenantId, userId: 'u1', agentId: 'a1', expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const task = await prisma.agentGatewayTask.create({
    data: { sessionId: session.id, tenantId, userId: 'u1', agentId: 'a1', type, status: 'planned' },
  });
  return task.id;
}

describe('AgentGateway Prisma 仓储（幂等/审批/usage）', () => {
  beforeAll(async () => {
    if (!hasDb) return;
    await cleanTables();
  });

  afterAll(async () => {
    if (hasDb) await cleanTables();
    await prisma.$disconnect();
  });

  test('幂等：new → 冲突抛 IDEMPOTENCY_CONFLICT → markDone → done', async () => {
    const store = new PrismaIdempotencyStore(prisma as never);
    const taskA = await makeTask('t1');
    const r1 = await store.claim('t1', 'k1', taskA);
    expect(r1.status).toBe('new');
    await expect(store.claim('t1', 'k1', taskA)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await store.markDone('t1', 'k1', 'usage_123');
    const r3 = await store.claim('t1', 'k1', taskA);
    expect(r3.status).toBe('done');
    expect((r3 as { record: { usageId?: string } }).record.usageId).toBe('usage_123');
  });

  test('幂等：release 后同 key 可重新 claim', async () => {
    const store = new PrismaIdempotencyStore(prisma as never);
    const taskA = await makeTask('t1');
    await store.claim('t1', 'k_rel', taskA);
    await store.release('t1', 'k_rel');
    const taskB = await makeTask('t1');
    const r = await store.claim('t1', 'k_rel', taskB);
    expect(r.status).toBe('new');
  });

  test('幂等：跨租户同 key 不冲突（唯一约束含 tenantId）', async () => {
    const store = new PrismaIdempotencyStore(prisma as never);
    const taskA = await makeTask('ta');
    await store.claim('ta', 'shared', taskA);
    const taskB = await makeTask('tb');
    const r = await store.claim('tb', 'shared', taskB);
    expect(r.status).toBe('new');
  });

  test('审批：create → validate 绑定/预览 → consume → 二次使用 APPROVAL_MISMATCH', async () => {
    const store = new PrismaApprovalStore(prisma as never);
    // 先造 task（approval.create 回查 tenantId）
    const session = await prisma.agentGatewaySession.create({
      data: { tenantId: 't1', userId: 'u1', agentId: 'a1', expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const task = await prisma.agentGatewayTask.create({
      data: { sessionId: session.id, tenantId: 't1', userId: 'u1', agentId: 'a1', type: 'publish', status: 'awaiting_confirmation' },
    });
    const toolCall = await prisma.agentGatewayToolCall.create({
      data: { taskId: task.id, tenantId: 't1', userId: 'u1', toolName: 'publish_execute', risk: 'high', inputHash: 'x', status: 'running', idempotencyKey: 'k_apr' },
    });

    const preview = { toolName: 'publish_execute', payload: { platform: 'douyin' } };
    const apr = await store.create(task.id, toolCall.id, preview, 60_000);
    const row = await prisma.agentGatewayApproval.findUnique({ where: { id: apr.id } });
    expect(row?.tenantId).toBe('t1');

    // 跨任务复用 → APPROVAL_MISMATCH
    await expect(store.validate(apr.id, preview, 'OTHER_TASK', toolCall.id)).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
    // 正常审批
    await store.validate(apr.id, preview, task.id, toolCall.id);
    await store.consume(apr.id);
    // 二次使用 → APPROVAL_MISMATCH（已消费）
    await expect(store.validate(apr.id, preview, task.id, toolCall.id)).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
  });

  test('usage sink：upsert 落库，重复 usageId 幂等', async () => {
    const sink = new PrismaUsageSink(prisma as never);
    const ev: UsageEvent = {
      id: 'ue1',
      requestId: 'req1',
      tenantId: 't1',
      usageId: 'usage_sink_1',
      model: 'kaypal-writer',
      inputTokens: 120,
      outputTokens: 300,
      computeUnits: 4,
      cost: 0.012,
      status: 'ok',
      createdAt: new Date().toISOString(),
    };
    await sink.record(ev);
    await sink.record({ ...ev, inputTokens: 999 }); // 重复 usageId → update
    const row = await prisma.agentGatewayUsageEvent.findUnique({ where: { usageId: 'usage_sink_1' } });
    expect(row).not.toBeNull();
    expect(row?.inputTokens).toBe(999);
    expect(row?.tenantId).toBe('t1');
  });
});
