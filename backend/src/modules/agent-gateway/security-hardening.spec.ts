import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';
import { createAgentGateway } from './core/factory';
import { EventBus } from './core/event-bus';
import { TenantContext, ToolRequest } from './core/types';
import { leadDiscover, ToolExecution } from './adapters/business-tools';
import { deriveNamespace } from './adapters/kaypal-memory-mock';
import { AuthService } from './core/auth';
import { makeError } from './contracts/error-codes';

const ctxA: TenantContext = { tenantId: 'tenant_1', userId: 'user_1', agentId: 'agent_default' };
const ctxB: TenantContext = { tenantId: 'tenant_2', userId: 'user_2', agentId: 'agent_default' };
const ctxSameTenantDiffUser: TenantContext = { tenantId: 'tenant_1', userId: 'user_9', agentId: 'agent_default' };

type GW = ReturnType<typeof createAgentGateway>;

function req(
  g: GW,
  sessionId: string,
  taskId: string,
  toolName: string,
  idemKey: string,
  payload: Record<string, unknown> = {},
  ctx: TenantContext = ctxA,
): ToolRequest {
  return {
    requestId: `req_${idemKey}`,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    agentId: ctx.agentId,
    sessionId,
    taskId,
    idempotencyKey: idemKey,
    toolName,
    requiresConfirmation: false,
    payload,
  };
}

describe('安全加固（P0/P1 复查项）', () => {
  let g: GW;
  beforeEach(() => {
    g = createAgentGateway();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('session 跨租户恢复 → FORBIDDEN；同租户不同用户恢复 → FORBIDDEN', async () => {
    const session = await g.gateway.createSession(ctxA);
    const codeOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return (e as { code: string }).code;
      }
      return 'NO_THROW';
    };
    expect(codeOf(() => g.gateway.resumeSession(session.id, ctxB))).toBe('FORBIDDEN');
    expect(codeOf(() => g.gateway.resumeSession(session.id, ctxSameTenantDiffUser))).toBe('FORBIDDEN');
    const own = g.gateway.resumeSession(session.id, ctxA);
    expect(own.session.id).toBe(session.id);
  });

  it('审批跨任务复用 → APPROVAL_MISMATCH', async () => {
    const session = await g.gateway.createSession(ctxA);
    const taskA = g.gateway.createTask(ctxA, session.id, 'publish', {});
    const outA = await g.gateway.executeTool(ctxA, req(g, session.id, taskA.id, 'publish_execute', 'idem_ap1', { platform: 'douyin' }));
    expect(outA.kind).toBe('awaiting_approval');
    if (outA.kind !== 'awaiting_approval') throw new Error('expect awaiting');

    const taskB = g.gateway.createTask(ctxA, session.id, 'publish', {});
    await expect(
      g.gateway.approveTask(ctxA, taskB.id, outA.approvalId, { toolName: 'publish_execute', payload: { platform: 'douyin' } }),
    ).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
  });

  it('审批一次性消费：同一审批 ID 二次使用 → APPROVAL_MISMATCH', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'publish', {});
    const out = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'publish_execute', 'idem_ap2', { platform: 'douyin' }));
    if (out.kind !== 'awaiting_approval') throw new Error('expect awaiting');
    await g.gateway.approveTask(ctxA, task.id, out.approvalId, { toolName: 'publish_execute', payload: { platform: 'douyin' } });
    await expect(
      g.gateway.approveTask(ctxA, task.id, out.approvalId, { toolName: 'publish_execute', payload: { platform: 'douyin' } }),
    ).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
  });

  it('工具异常 → 任务落 failed_retryable + 幂等锁释放 + 恢复后重跑成功', async () => {
    g.business.register('lead_discover', async () => {
      throw makeError('TOOL_EXECUTION_FAILED', { details: { reason: 'boom' } });
    });
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'lead', {});
    const out = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'lead_discover', 'idem_rec', { limit: 3 }));
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.result.error?.code).toBe('TOOL_EXECUTION_FAILED');
      expect(out.result.status).toBe('failed_retryable');
    }
    expect(g.gateway.getTask(task.id)?.status).toBe('failed_retryable');
    // 幂等锁已释放，同 key 可重新认领
    const claim = g.idempotency.claim('tenant_1', 'idem_rec', task.id);
    expect(claim.status).toBe('new');
    // 失败 usage 已记录
    expect(g.gateway.getUsageEvents().some((u) => u.status === 'failed')).toBe(true);

    // 换回正常执行器，resume 恢复成功
    g.business.register('lead_discover', leadDiscover);
    const resumed = await g.gateway.resumeTask(ctxA, task.id);
    expect(resumed.status).toBe('succeeded');
    expect(g.gateway.getTask(task.id)?.status).toBe('succeeded');
  });

  it('取消真正中止在途执行（AbortSignal）→ CANCEL_TIMEOUT + 任务 cancelled', async () => {
    const slow: (typeof leadDiscover) & { slow?: boolean } = async (_c, _r, _cp, signal) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(null), 1000);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(makeError('CANCEL_TIMEOUT', { details: { reason: 'aborted' } }));
        });
      });
      return { data: { ok: true }, evidence: [], usage: { inputTokens: 1, modelTokens: 1, computeUnits: 1, usageId: 'u_slow' }, status: 'succeeded' };
    };
    g.business.register('lead_discover', slow);
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'lead', {});
    const p = g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'lead_discover', 'idem_cancel', { limit: 3 }));
    await new Promise((r) => setTimeout(r, 30)); // 让执行器先跑起来
    g.gateway.cancelTask(ctxA, task.id);

    const out = await p;
    expect(out.kind).toBe('result');
    if (out.kind === 'result') expect(out.result.error?.code).toBe('CANCEL_TIMEOUT');
    expect(g.gateway.getTask(task.id)?.status).toBe('cancelled');
    // 幂等锁已释放（取消也算终止执行）
    expect(g.idempotency.get('tenant_1', 'idem_cancel')).toBeUndefined();
  });

  it('Memory 删除跨租户隔离 + 准确 deleted 标志（OR 语义，P1-6）', async () => {
    await g.gateway.memoryAdd(ctxA, 'user_preference', '品牌色是紫色');
    const all0 = await g.gateway.memorySearch(ctxA, 'user_preference', '');
    const itemId = all0.items.find((i) => i.content.includes('品牌'))!.id;

    // 租户 B 删除 A 的记忆 → 失败且 A 数据不动
    const rB = await g.gateway.memoryDelete(ctxB, itemId);
    expect(rB.deleted).toBe(false);
    const still = await g.gateway.memorySearch(ctxA, 'user_preference', '');
    expect(still.items.some((i) => i.content.includes('品牌'))).toBe(true);

    // 远程故障写入：本地有副本、远程没有 → 删除后 deleted=true（数据实际已全删）
    g.memoryRemote.setDegraded(true);
    await g.gateway.memoryAdd(ctxA, 'user_preference', '第二段记忆');
    const all2 = await g.gateway.memorySearch(ctxA, 'user_preference', '');
    const itemY = all2.items.find((i) => i.content.includes('第二段'))!;
    const rDeg = await g.gateway.memoryDelete(ctxA, itemY.id);
    expect(rDeg.deleted).toBe(true);
    g.memoryRemote.setDegraded(false);

    // P1-6 实测场景：远端有副本、本地索引不存在 → 远端删除成功，deleted=true
    const ns = deriveNamespace(ctxA, 'user_preference', 'direct_add');
    const remoteOnly = await g.memoryRemote.add(ns, '仅远程存在', 'remote_only_id');
    const rRemoteOnly = await g.gateway.memoryDelete(ctxA, remoteOnly.id);
    expect(rRemoteOnly.deleted).toBe(true);
    const after = await g.memoryRemote.search(ns, '仅远程存在');
    expect(after.length).toBe(0);

    // 自己正常删除（本地+远程同 id）→ deleted=true
    const rA = await g.gateway.memoryDelete(ctxA, itemId);
    expect(rA.deleted).toBe(true);
  });

  it('Memory outbox 自动重试：远程恢复后 worker 自动 flush 到 done', async () => {
    g.memory.stopOutboxWorker(); // 停掉 factory 自动起的 worker，测试自控 fake timer
    jest.useFakeTimers();
    g.memoryRemote.setDegraded(true);
    await g.gateway.memoryAdd(ctxA, 'user_preference', '待同步记忆');
    await jest.advanceTimersByTimeAsync(0); // 让首次 flush 失败完成：attempts=1, nextRetryAt=+2s
    const entry = g.memory.pendingOutbox()[0];
    expect(entry.outbox.status).toBe('pending');
    expect(entry.outbox.attempts).toBeGreaterThanOrEqual(1);

    g.memoryRemote.setDegraded(false);
    const stop = g.memory.startOutboxWorker(100);
    await jest.advanceTimersByTimeAsync(2500); // 越过退避期触发重试
    const after = g.memory.pendingOutbox()[0];
    expect(after.outbox.status).toBe('done');
    stop();
    jest.useRealTimers();
  });

  it('factory 默认启动 outbox worker；可显式关闭（P1-3）', () => {
    expect(g.memory.isOutboxWorkerRunning()).toBe(true);
    const g2 = createAgentGateway({ startOutboxWorker: false });
    expect(g2.memory.isOutboxWorkerRunning()).toBe(false);
  });

  it('删除记忆后 pending outbox 被作废，worker 不再重建（P1-4）', async () => {
    g.memory.stopOutboxWorker();
    g.memoryRemote.setDegraded(true);
    const { outboxId } = await g.gateway.memoryAdd(ctxA, 'user_preference', '将被删除');
    const all = await g.gateway.memorySearch(ctxA, 'user_preference', '');
    const item = all.items.find((i) => i.content.includes('将被删除'))!;
    g.memoryRemote.setDegraded(false);
    const del = await g.gateway.memoryDelete(ctxA, item.id);
    expect(del.deleted).toBe(true);
    const entry = g.memory.pendingOutbox().find((e) => e.outbox.id === outboxId);
    expect(entry?.outbox.status).toBe('done'); // 已作废，禁止重放
    const ns = deriveNamespace(ctxA, 'user_preference', 'confirmed_user_statement');
    expect((await g.memoryRemote.search(ns, '将被删除')).length).toBe(0);
  });

  it('outbox in-flight 锁：慢远端时同一条不重复提交', async () => {
    g.memory.stopOutboxWorker();
    jest.useFakeTimers();
    let addCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const orig = g.memoryRemote.add.bind(g.memoryRemote);
    (g.memoryRemote as unknown as { add: unknown }).add = async (ns: unknown, content: string, id?: string) => {
      addCalls += 1;
      await gate;
      return orig(ns as never, content, id);
    };
    await g.gateway.memoryAdd(ctxA, 'user_preference', '并发记忆'); // capture → 即时 flush 挂起（inflight 锁持有）
    await jest.advanceTimersByTimeAsync(0);
    const stop = g.memory.startOutboxWorker(100);
    await jest.advanceTimersByTimeAsync(300); // 多个 worker tick 被 inflight 挡住
    release!();
    await jest.advanceTimersByTimeAsync(0);
    expect(addCalls).toBe(1); // 只提交一次
    stop();
    jest.useRealTimers();
  });

  it('删除使用精确 scope（itemIndex），不固定 user_preference（P1-5）', async () => {
    await g.gateway.memoryAdd(ctxA, 'conversation', '对话记忆X');
    const all = await g.gateway.memorySearch(ctxA, 'conversation', '');
    const item = all.items.find((i) => i.content.includes('对话记忆X'))!;
    const del = await g.gateway.memoryDelete(ctxA, item.id); // 不传 scope，靠 itemIndex 定位
    expect(del.deleted).toBe(true);
    const ns = deriveNamespace(ctxA, 'conversation', 'confirmed_user_statement');
    expect((await g.memoryRemote.search(ns, '对话记忆X')).length).toBe(0);
  });

  it('token 缺 exp（签名正确）→ AUTH_INVALID（P1-6）', () => {
    const auth = new AuthService('secret');
    const body = Buffer.from(JSON.stringify({ tenantId: 't1', userId: 'u1', agentId: 'a1' })).toString('base64url'); // 无 exp
    const sig = crypto.createHmac('sha256', 'secret').update(body).digest('base64url');
    let code = '';
    try {
      auth.verify(`${body}.${sig}`);
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('AUTH_INVALID');
  });

  it('resumeSession 实时更新 lastEventId/lastSequence（P2-8）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'lead', {});
    await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'lead_discover', 'idem_prog', { limit: 1 }));
    const r = g.gateway.resumeSession(session.id, ctxA);
    expect(r.session.lastEventId).not.toBe('');
    expect(r.session.lastSequence).toBeGreaterThan(0);
  });

  it('过期会话审批/暂停/恢复/取消 → SESSION_EXPIRED（P1-1）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'publish', {});
    const out = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'publish_execute', 'idem_p1ctrl', { platform: 'douyin' }));
    if (out.kind !== 'awaiting_approval') throw new Error('expect awaiting');
    const s = g.gateway.getSession(session.id)!;
    s.expiresAt = new Date(Date.now() - 1000).toISOString();
    s.status = 'expired';

    await expect(
      g.gateway.approveTask(ctxA, task.id, out.approvalId, { toolName: 'publish_execute', payload: { platform: 'douyin' } }),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(g.gateway.resumeTask(ctxA, task.id)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });

    const codeOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return (e as { code: string }).code;
      }
      return 'NO_THROW';
    };
    expect(codeOf(() => g.gateway.pauseTask(ctxA, task.id))).toBe('SESSION_EXPIRED');
    expect(codeOf(() => g.gateway.cancelTask(ctxA, task.id))).toBe('SESSION_EXPIRED');
  });

  it('能力检查 fail-closed：拼错能力名 → 不满足', () => {
    const spec = g.registry.get('lead_discover')!;
    const bad = { ...spec, requiredCapabilities: ['rpa.brower'] };
    expect(g.registry.capabilitiesSatisfied(bad, g.octop.getCapabilities())).toBe(false);
    const good = { ...spec, requiredCapabilities: ['rpa.browser'] };
    expect(g.registry.capabilitiesSatisfied(good, g.octop.getCapabilities())).toBe(true);
  });

  it('事件窗口真实截断：超窗 lastEventId → RESUME_WINDOW_EXPIRED', () => {
    const bus = new EventBus(3);
    const e1 = bus.publish('s1', 'message', 't1', { i: 1 });
    bus.publish('s1', 'message', 't1', { i: 2 });
    bus.publish('s1', 'message', 't1', { i: 3 });
    bus.publish('s1', 'message', 't1', { i: 4 });
    expect(bus.snapshot('s1').length).toBe(3); // 窗口截断生效
    let code = '';
    try {
      bus.getEventsSince('s1', e1.eventId);
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('RESUME_WINDOW_EXPIRED');
    const last = bus.snapshot('s1').pop()!;
    expect(bus.getEventsSince('s1', last.eventId)).toEqual([]);
  });

  it('usage/ToolCall 状态真实：inputTokens>0、ToolCall done + usageId、失败 usage', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'lead', {});
    await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'lead_discover', 'idem_u', { limit: 3 }));
    const usages = g.gateway.getUsageEvents();
    expect(usages).toHaveLength(1);
    expect(usages[0].inputTokens).toBeGreaterThan(0);
    expect(usages[0].status).toBe('ok');
    const started = g.gateway.snapshotEvents(session.id).find((e) => e.type === 'tool_started');
    const tc = g.gateway.getToolCall(started!.payload.toolCallId as string);
    expect(tc?.status).toBe('done');
    expect(tc?.usageId).toBeTruthy();
  });

  it('并发幂等：同 key 两个任务并行 → 一个成功一个 IDEMPOTENCY_CONFLICT', async () => {
    const session = await g.gateway.createSession(ctxA);
    const taskA = g.gateway.createTask(ctxA, session.id, 'lead', {});
    const taskB = g.gateway.createTask(ctxA, session.id, 'lead', {});
    const [a, b] = await Promise.all([
      g.gateway.executeTool(ctxA, req(g, session.id, taskA.id, 'lead_discover', 'idem_conc', { limit: 3 })),
      g.gateway.executeTool(ctxA, req(g, session.id, taskB.id, 'lead_discover', 'idem_conc', { limit: 3 })),
    ]);
    const codes = [a, b].map((o) => (o.kind === 'result' ? (o.result.error?.code ?? 'OK') : 'AWAIT')).sort();
    expect(codes).toEqual(['IDEMPOTENCY_CONFLICT', 'OK']);
  });

  it('Octop 高级模式：createOctopSession + tokenExchange', async () => {
    const octop = await g.gateway.createOctopSession(ctxA);
    expect(octop.octopSessionId).toBeTruthy();
    const session = await g.gateway.createSession(ctxA);
    const tok = await g.gateway.tokenExchange(ctxA, session.id);
    expect(tok.token).toContain('tok_');
    expect(Date.parse(tok.expiresAt)).toBeGreaterThan(Date.now());
    // 跨租户 token 交换被拒
    await expect(g.gateway.tokenExchange(ctxB, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('终态任务写操作被拦：succeeded 后再执行 → TASK_TERMINAL', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'lead', {});
    await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'lead_discover', 'idem_term2', { limit: 3 }));
    const again = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'lead_discover', 'idem_term2b', { limit: 3 }));
    expect(again.kind).toBe('result');
    if (again.kind === 'result') expect(again.result.error?.code).toBe('TASK_TERMINAL');
  });

  // ------------------------------------------------------------ 第二轮复查项（P1-2/3/4/5/9 + P2-10）

  it('过期会话 createTask/executeTool → SESSION_EXPIRED（P1-2）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const s = g.gateway.getSession(session.id)!;
    s.expiresAt = new Date(Date.now() - 1000).toISOString();
    s.status = 'expired';
    const codeOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return (e as { code: string }).code;
      }
      return 'NO_THROW';
    };
    expect(codeOf(() => g.gateway.createTask(ctxA, session.id, 'lead', {}))).toBe('SESSION_EXPIRED');
    await expect(
      g.gateway.executeTool(ctxA, req(g, session.id, 'whatever_task', 'lead_discover', 'idem_exp', {})),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('同会话两个任务：取消 A 不 abort B（P1-3）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const taskA = g.gateway.createTask(ctxA, session.id, 'lead', {});
    const taskB = g.gateway.createTask(ctxA, session.id, 'review', {});
    const flagA = { aborted: false };
    const flagB = { aborted: false };
    const slow = (flag: { aborted: boolean }) => async (_c: unknown, _r: unknown, _cp: unknown, signal?: AbortSignal) => {
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => {
          flag.aborted = true;
        });
        setTimeout(resolve, 200);
      });
      return { data: { ok: true }, evidence: [], usage: { inputTokens: 1, modelTokens: 1, computeUnits: 1, usageId: `u_${Math.random()}` }, status: 'succeeded' };
    };
    g.business.register('lead_discover', slow(flagA));
    g.business.register('report_generate', slow(flagB));

    const pA = g.gateway.executeTool(ctxA, req(g, session.id, taskA.id, 'lead_discover', 'idem_isoA', {}));
    const pB = g.gateway.executeTool(ctxA, req(g, session.id, taskB.id, 'report_generate', 'idem_isoB', {}));
    await new Promise((r) => setTimeout(r, 30));
    g.gateway.cancelTask(ctxA, taskA.id);

    await Promise.all([pA, pB]);
    expect(flagA.aborted).toBe(true); // A 被中止
    expect(flagB.aborted).toBe(false); // B 不受影响
    expect(g.gateway.getTask(taskA.id)?.status).toBe('cancelled');
    expect(g.gateway.getTask(taskB.id)?.status).toBe('succeeded');
  });

  it('已取消任务再审批：抛 TASK_TERMINAL 且审批未被消费（P1-4）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'publish', {});
    const out = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'publish_execute', 'idem_apr', { platform: 'douyin' }));
    if (out.kind !== 'awaiting_approval') throw new Error('expect awaiting');
    g.gateway.cancelTask(ctxA, task.id);
    await expect(
      g.gateway.approveTask(ctxA, task.id, out.approvalId, { toolName: 'publish_execute', payload: { platform: 'douyin' } }),
    ).rejects.toMatchObject({ code: 'TASK_TERMINAL' });
    expect(g.approvals.get(out.approvalId)?.consumed).toBe(false); // 审批未丢失
  });

  it('awaiting_confirmation 重复提交：返回同一审批、无幂等残留、原审批仍可用（P1-5）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'publish', {});
    const out1 = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'publish_execute', 'idem_rep', { platform: 'douyin' }));
    if (out1.kind !== 'awaiting_approval') throw new Error('expect awaiting');
    const out2 = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'publish_execute', 'idem_rep2', { platform: 'douyin' }));
    expect(out2.kind).toBe('awaiting_approval');
    if (out2.kind === 'awaiting_approval') expect(out2.approvalId).toBe(out1.approvalId);
    // 第二次提交在 claim 之前被拦截：幂等无残留、pending 未被覆盖
    expect(g.idempotency.get('tenant_1', 'idem_rep2')).toBeUndefined();
    const res = await g.gateway.approveTask(ctxA, task.id, out1.approvalId, { toolName: 'publish_execute', payload: { platform: 'douyin' } });
    expect(res.status).toBe('succeeded');
  });

  it('执行成功与取消并发：外部成功 → 接口不报错 + task_done 事件照发（P1-9）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'lead', {});
    g.business.register('lead_discover', async (_c, _r, _cp, signal) => {
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => {
          /* 忽略：模拟外部动作已不可停 */
        });
        setTimeout(resolve, 150);
      });
      return { data: { ok: true }, evidence: [], usage: { inputTokens: 1, modelTokens: 1, computeUnits: 1, usageId: 'u_race' }, status: 'succeeded' };
    });
    const p = g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'lead_discover', 'idem_race', {}));
    await new Promise((r) => setTimeout(r, 30));
    g.gateway.cancelTask(ctxA, task.id); // 取消先到
    const out = await p;
    expect(out.kind).toBe('result');
    if (out.kind === 'result') expect(out.result.status).toBe('succeeded'); // 不报错
    expect(g.gateway.getUsageEvents().some((u) => u.status === 'ok')).toBe(true);
    expect(g.gateway.snapshotEvents(session.id).map((e) => e.type)).toContain('task_done'); // 事件照发
  });

  it('执行前 inputSchema 校验：非法载荷 → INVALID_PLAN（P2-10）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'content', {});
    const bad = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'content_generate', 'idem_pv', { title: 123 }));
    expect(bad.kind).toBe('result');
    if (bad.kind === 'result') expect(bad.result.error?.code).toBe('INVALID_PLAN');
    const ok = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'content_generate', 'idem_pv2', { title: '好标题' }));
    expect(ok.kind).toBe('result');
    if (ok.kind === 'result') expect(ok.result.status).toBe('succeeded');
  });

  it('执行后 outputSchema 校验：非法输出 → TOOL_EXECUTION_FAILED（P2-10）', async () => {
    const session = await g.gateway.createSession(ctxA);
    const task = g.gateway.createTask(ctxA, session.id, 'content', {});
    g.business.register('content_generate', async () => ({
      data: { contentId: 42 }, // outputSchema 要求 contentId: string
      evidence: [],
      usage: { inputTokens: 1, modelTokens: 1, computeUnits: 1, usageId: 'u_out' },
      status: 'succeeded',
    }));
    const out = await g.gateway.executeTool(ctxA, req(g, session.id, task.id, 'content_generate', 'idem_ov', { title: 'x' }));
    expect(out.kind).toBe('result');
    if (out.kind === 'result') expect(out.result.error?.code).toBe('TOOL_EXECUTION_FAILED');
  });
});

// 类型守卫：确认 slow executor 与 ToolExecution 兼容（避免 TS 告警）
const _t: ToolExecution = { data: {}, evidence: [], usage: { inputTokens: 1, modelTokens: 1, computeUnits: 1, usageId: 'x' }, status: 'succeeded' };
void _t;
