import { PrismaClient } from '@prisma/client';
import { WorkspacesService } from './workspaces.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from './core/types';

/**
 * Workspace 服务集成测试：聚焦归属隔离（跨用户不可见/不可操作）、
 * 重名冲突(409)、软删除(archived 不出现在列表)。需本地 pg；无 DATABASE_URL 跳过。
 */
const hasDb = process.env.E2E_REAL_CHAIN === '1';
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);

const ctxA: TenantContext = { tenantId: 'ws_t', userId: 'ws_u_a', agentId: 'a1' };
const ctxB: TenantContext = { tenantId: 'ws_t', userId: 'ws_u_b', agentId: 'a1' };

const test = hasDb ? it : it.skip;

async function clean() {
  await prisma.workspace.deleteMany({
    where: { tenantId: 'ws_t', userId: { in: ['ws_u_a', 'ws_u_b'] } },
  });
}

describe('WorkspacesService（归属隔离 / 冲突 / 软删）', () => {
  let svc: WorkspacesService;
  beforeAll(async () => {
    if (!hasDb) return;
    await clean();
    svc = new WorkspacesService(prisma as unknown as PrismaService);
  });
  afterAll(async () => {
    if (hasDb) await clean();
    await prisma.$disconnect();
  });

  test('跨用户隔离：B 不能访问 A 的 workspace（统一 403，不泄露存在性）', async () => {
    const created = await svc.create(ctxA, { name: 'A-私有' });
    await expect(svc.get(ctxB, created.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const listed = await svc.list(ctxB);
    expect(listed.find((w) => w.id === created.id)).toBeUndefined();
  });

  test('重名冲突：同用户同名返回 DUPLICATE_REQUEST(409)', async () => {
    await svc.create(ctxA, { name: '重复名' });
    await expect(svc.create(ctxA, { name: '重复名' })).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });
    // 不同用户允许同名（归属维度区分）
    const other = await svc.create(ctxB, { name: '重复名' });
    expect(other.userId).toBe('ws_u_b');
  });

  test('更新：改名 / 改 agentId 生效，且仍受归属约束', async () => {
    const w = await svc.create(ctxA, { name: '待改', agentId: 'a1' });
    const updated = await svc.update(ctxA, w.id, { name: '已改', agentId: 'a2' });
    expect(updated.name).toBe('已改');
    expect(updated.agentId).toBe('a2');
    await expect(svc.update(ctxB, w.id, { name: '越权改' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('软删除：archived 后不在 active 列表，且不可再被访问', async () => {
    const w = await svc.create(ctxA, { name: '待删' });
    await svc.remove(ctxA, w.id);
    const listed = await svc.list(ctxA);
    expect(listed.find((x) => x.id === w.id)).toBeUndefined();
    await expect(svc.get(ctxA, w.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // 物理行仍在（软删）
    const raw = await prisma.workspace.findUnique({ where: { id: w.id } });
    expect(raw?.status).toBe('archived');
  });
});
