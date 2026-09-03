import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import {
  hydrateAgentSessionsFromStore,
  hydrateAgentConfirmationsFromStore,
  loadStoredAgentSession,
} from './local-engine.persist.mixin';
import {
  PANEL_CONFIRMATION_SOURCE,
  panelMethodForAction,
} from './agent-panel-bridge.service';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserLoopService } from './agent-browser-loop.service';
import type {
  AgentConfirmation,
  AgentSession,
  LocalEngineTenantScope,
} from './local-engine.types';

/**
 * 阶段 6 决策 ②：**两套确认机制合并成一套**的落点测试。
 *
 * 合并前：面板确认单活在 desktop 桥的内存里，后端确认单活在 AgentConfirmation
 * 表里 —— 同一个动作可能有两条审批路径，各说各话。
 * 合并后：面板单也落在同一张表（主键 = 桥 actionId），但**审批入口只有一个**
 * （桌面浏览器面板审批 UI）。
 *
 * 于是这里盯死一条最容易翻车的边界：面板单落库了，却**不能**出现在后端的
 * "待你确认"列表里。否则用户会在两个地方看到同一个待批动作 —— 那就不是合并，
 * 是两套并行。行仍然留在库里（审计/回放可查），只是不进待批列表。
 */

const SCOPE: LocalEngineTenantScope = { tenantId: 't1', userId: 'u1' };

/** 后端原生确认单（用户在后端待批列表里点） */
const BACKEND_CONFIRMATION = {
  id: 'conf-1',
  sessionId: 'sess-1',
  tenantId: 't1',
  userId: 'u1',
  confirmationJson: {
    id: 'conf-1',
    action: 'goto',
    target: '#btn',
    status: 'pending',
  },
};

/** 面板确认单（用户在桌面面板审批 UI 里点）——带 source 标记 */
const PANEL_CONFIRMATION = {
  id: 'act-1',
  sessionId: 'sess-1',
  tenantId: 't1',
  userId: 'u1',
  confirmationJson: {
    id: 'act-1',
    source: 'browser-panel',
    action: 'Page.navigate',
    method: 'Page.navigate',
    status: 'pending',
  },
};

/**
 * 注意：必须每次新造对象——hydrate 会**就地**往 sessionJson.confirmations
 * 里塞东西，用共享常量会让上一个用例的结果泄漏到下一个用例。
 */
function makeSessionRow() {
  return {
    id: 'sess-1',
    tenantId: 't1',
    userId: 'u1',
    sessionJson: {
      id: 'sess-1',
      status: 'running',
      url: 'https://kaypal.cn',
    } as unknown as AgentSession,
  };
}

function makeHost(rows: {
  sessions: Array<Record<string, unknown>>;
  confirmations: Array<Record<string, unknown>>;
}) {
  const remembered: AgentSession[] = [];
  const confirmationMap = new Map<string, AgentConfirmation>();
  const host = {
    agentConfirmations: confirmationMap,
    prisma: {
      agentSession: {
        findMany: async () => rows.sessions,
        findFirst: async () => rows.sessions[0] ?? null,
      },
      agentConfirmation: {
        findMany: async () => rows.confirmations,
      },
    },
    resolveTenantScope: async () => SCOPE,
    mergeAgentConfirmations: (
      left: AgentConfirmation[],
      right: AgentConfirmation[],
    ) => [...left, ...right],
    rememberAgentSession(session: AgentSession) {
      remembered.push(session);
      return session;
    },
  };
  return { host, remembered, confirmationMap };
}

describe('面板确认单不进后端待批列表（阶段 6 决策 ②）', () => {
  it('hydrateAgentSessionsFromStore：面板单被过滤，后端单保留', async () => {
    const { host, remembered } = makeHost({
      sessions: [makeSessionRow()],
      confirmations: [BACKEND_CONFIRMATION, PANEL_CONFIRMATION],
    });
    await hydrateAgentSessionsFromStore.call(host as never, 50, SCOPE);

    const ids = (remembered[0].confirmations ?? []).map((c) => c.id);
    expect(ids).toContain('conf-1');
    // 关键断言：面板单已经在桌面面板上批过了，不能再出现在后端待批列表
    expect(ids).not.toContain('act-1');
  });

  it('loadStoredAgentSession：同样过滤面板单', async () => {
    const { host } = makeHost({
      sessions: [makeSessionRow()],
      confirmations: [BACKEND_CONFIRMATION, PANEL_CONFIRMATION],
    });
    const session = await loadStoredAgentSession.call(host as never, 'sess-1', SCOPE);
    const ids = (session?.confirmations ?? []).map((c) => c.id);
    expect(ids).toContain('conf-1');
    expect(ids).not.toContain('act-1');
  });

  it('hydrateAgentConfirmationsFromStore：面板单不进内存待批 map', async () => {
    const { host, confirmationMap } = makeHost({
      sessions: [],
      confirmations: [BACKEND_CONFIRMATION, PANEL_CONFIRMATION],
    });
    await hydrateAgentConfirmationsFromStore.call(host as never, 200, SCOPE);
    expect(confirmationMap.has('conf-1')).toBe(true);
    expect(confirmationMap.has('act-1')).toBe(false);
  });

  it('脏数据不能让过滤失效：confirmationJson 为 null/非对象时按非面板单处理', async () => {
    const dirty = [
      { id: 'c-null', sessionId: 'sess-1', confirmationJson: null },
      { id: 'c-str', sessionId: 'sess-1', confirmationJson: 'browser-panel' },
      { id: 'c-num', sessionId: 'sess-1', confirmationJson: 42 },
    ];
    const { host, remembered } = makeHost({
      sessions: [makeSessionRow()],
      confirmations: dirty,
    });
    await hydrateAgentSessionsFromStore.call(host as never, 50, SCOPE);
    // 形状不合法不等于面板单——宁可留在后端列表里让人看见，也不能悄悄吞掉
    expect(remembered[0].confirmations ?? []).toHaveLength(3);
  });

  it('只有面板单时待批列表为空（用户不会看到"待确认"却无处可点）', async () => {
    const { host, remembered } = makeHost({
      sessions: [makeSessionRow()],
      confirmations: [PANEL_CONFIRMATION],
    });
    await hydrateAgentSessionsFromStore.call(host as never, 50, SCOPE);
    expect(remembered[0].confirmations ?? []).toHaveLength(0);
  });
});

// ── B 组：动作 → 面板 CDP 方法映射（指纹比对的地基）──────────────────────

describe('panelMethodForAction：只认已开通的写动作，其余 null', () => {
  it('已开通的写动作给出方法', () => {
    expect(panelMethodForAction('goto')).toBe('Page.navigate');
    expect(panelMethodForAction('click')).toBe('Input.dispatchMouseEvent');
    expect(panelMethodForAction('type')).toBe('Input.insertText');
    expect(panelMethodForAction('press_key')).toBe('Input.dispatchKeyEvent');
    // 阶段 7 round11：tabs 开通——主进程伪 method（非 CDP 命令）
    expect(panelMethodForAction('tabs')).toBe('Panel.tabs');
  });

  it('只读 / 未开通 / 未知动作 → null（确认单指纹对不上 → 拒绝，不猜）', () => {
    expect(panelMethodForAction('extract')).toBeNull();
    expect(panelMethodForAction('screenshot')).toBeNull();
    expect(panelMethodForAction('wait')).toBeNull();
    expect(panelMethodForAction('不存在的动作')).toBeNull();
  });
});

// ── C 组：loop 确认闸门（合并后放行权仍在同一处）────────────────────────

function makeBrowserMock() {
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'general-web-abc',
      page: { url: () => 'https://kaypal.cn', goto: jest.fn() },
    }),
    closeSession: jest.fn().mockResolvedValue(true),
  };
}

/** 让动作必定触发"高风险需确认"闸门的 policy 桩 */
function makePolicyRequiresConfirmation() {
  return {
    audit: jest.fn().mockReturnValue({
      allowed: true,
      requiresConfirmation: true,
      riskLevel: 'high',
    }),
    assertToolAllowed: jest.fn(),
  };
}

async function makeLoop(opts: {
  panelMode: 'off' | 'on';
  confirmationRows?: Array<Record<string, unknown>>;
  executeResult?: Record<string, unknown>;
  /** 2026-09-04 死锁修复：executor.resolvePanelApproval（问桥）返回值 */
  bridgeState?: 'approved' | 'rejected' | 'pending' | 'none';
}) {
  const sessionSvc = new AgentBrowserSessionService(
    makeBrowserMock() as never,
    {
      tenantMember: { findFirst: async () => ({ tenantId: 't1' }) },
    } as never,
    { resolveTenantId: async () => 't1' } as never,
  );
  const s = sessionSvc.create('u1', { startUrl: 'https://kaypal.cn' }, 't1');
  await sessionSvc.acquireEngineSession(s.id);

  const prisma = {
    agentConfirmation: {
      findMany: jest.fn().mockResolvedValue(opts.confirmationRows ?? []),
      create: jest.fn().mockResolvedValue({ id: 'backend-new-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const executor = {
    panelMode: jest.fn().mockReturnValue(opts.panelMode),
    isAlive: jest.fn().mockResolvedValue(true),
    resolvePanelApproval: jest
      .fn()
      .mockResolvedValue(opts.bridgeState ?? 'none'),
    execute: jest.fn().mockResolvedValue(
      opts.executeResult ?? {
        index: 0,
        action: 'goto',
        ok: false,
        message:
          '需用户确认后执行（面板导航确认单 act-1，请在右侧浏览器面板批准后携带该 id 重试）',
        confirmationId: 'act-1',
      },
    ),
  };
  const actionsMock = {
    parseActions: jest
      .fn()
      .mockResolvedValue([{ action: 'goto', url: 'https://kaypal.cn' }]),
    executeSingle: jest.fn().mockResolvedValue({
      index: 0,
      action: 'goto',
      ok: true,
      evidenceUrl: 'https://ev/1',
    }),
  };
  const loop = new AgentBrowserLoopService(
    sessionSvc,
    actionsMock as never,
    makePolicyRequiresConfirmation() as never,
    undefined,
    prisma as never,
    executor as never,
  );
  return { loop, session: s, sessionSvc, prisma, executor };
}

/** 造一张面板确认单：默认"已批准 + 绑定当前会话" */
function panelRow(
  sessionId: string,
  over: Partial<Record<string, unknown>> = {},
) {
  return {
    id: 'act-1',
    status: 'pending',
    sessionId,
    tenantId: 't1',
    userId: 'u1',
    action: 'Page.navigate',
    confirmationJson: {
      source: PANEL_CONFIRMATION_SOURCE,
      method: 'Page.navigate',
      status: 'approved',
    },
    ...over,
  };
}

describe('loop 确认闸门：面板模式下不再建第二张后端单（阶段 6 决策 ②）', () => {
  const ORIGINAL_MODE = process.env.AGENT_BROWSER_MODE;

  beforeAll(() => {
    // 循环默认 legacy（未开灰度），不设根本跑不起来
    process.env.AGENT_BROWSER_MODE = 'dom-agent';
  });
  afterAll(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.AGENT_BROWSER_MODE;
    else process.env.AGENT_BROWSER_MODE = ORIGINAL_MODE;
  });

  it('C1｜面板模式 + 无单：交给 executor 去桌面签单，闸门不自己造后端单', async () => {
    const { loop, session, prisma, executor } = await makeLoop({
      panelMode: 'on',
    });
    const events: Array<Record<string, unknown>> = [];
    await loop.run(session.id, '打开首页', {
      onStep: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    // 关键：没有第二张确认单——否则用户要在桌面和后端各批一次
    expect(prisma.agentConfirmation.create).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledTimes(1);
    // 会话 id 必须透到执行器（面板单按会话落库，靠它绑到会话上防跨会话复用）
    const input = executor.execute.mock.calls[0][0] as Record<string, unknown>;
    expect(input.sessionId).toBe(session.id);
    // 步骤事件留痕：这一步的批准发生在桌面面板上
    const step = events.find((e) => e.type === 'step');
    expect(step?.panelApproval).toBe(true);
    expect(step?.confirmationId).toBe('act-1');
  });

  it('C2｜对照组（面板关闭）：行为不变——建后端单、不碰 executor', async () => {
    const { loop, session, prisma, executor } = await makeLoop({
      panelMode: 'off',
    });
    await loop.run(session.id, '打开首页');
    expect(prisma.agentConfirmation.create).toHaveBeenCalledTimes(1);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('C3｜接缝：已批准（json.status=approved）的面板单照样走两阶段锁定放行', async () => {
    const built = await makeLoop({
      panelMode: 'on',
      executeResult: {
        index: 0,
        action: 'goto',
        ok: true,
        url: 'https://kaypal.cn',
        confirmationId: 'act-1',
      },
    });
    const { loop, session, prisma, executor } = built;
    // 会话 id 要先建好才知道，所以行在这里补进去
    prisma.agentConfirmation.findMany.mockResolvedValue([panelRow(session.id)]);
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    // pending → in_use（并发只有一方抢到），不是直接放行
    expect(prisma.agentConfirmation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'act-1', status: 'pending' } }),
    );
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(prisma.agentConfirmation.create).not.toHaveBeenCalled();
  });

  it('C4｜用户没点批准（json.status=pending）→ 不放行、也不建后端单', async () => {
    const built = await makeLoop({ panelMode: 'on' });
    const { loop, session, prisma, executor } = built;
    prisma.agentConfirmation.findMany.mockResolvedValue([
      panelRow(session.id, {
        confirmationJson: {
          source: PANEL_CONFIRMATION_SOURCE,
          method: 'Page.navigate',
          status: 'pending',
        },
      }),
    ]);
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    expect(prisma.agentConfirmation.updateMany).not.toHaveBeenCalled();
    expect(prisma.agentConfirmation.create).not.toHaveBeenCalled();
    // 交给 executor 再去问一次桥（用户可能刚点完）
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('C5｜跨会话的面板单不能拿来放行（防确认单复用）', async () => {
    const { loop, session, prisma, executor } = await makeLoop({
      panelMode: 'on',
      confirmationRows: [panelRow('别人的会话')],
    });
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    expect(prisma.agentConfirmation.updateMany).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('C6｜方法对不上 → 不放行（点按钮的确认单不能拿去导航）', async () => {
    const built = await makeLoop({ panelMode: 'on' });
    const { loop, session, prisma, executor } = built;
    prisma.agentConfirmation.findMany.mockResolvedValue([
      panelRow(session.id, {
        action: 'Input.dispatchMouseEvent',
        confirmationJson: {
          source: PANEL_CONFIRMATION_SOURCE,
          method: 'Input.dispatchMouseEvent',
          status: 'approved',
        },
      }),
    ]);
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    expect(prisma.agentConfirmation.updateMany).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
});

/**
 * 2026-09-04 修「批准后死锁」（真机 GUI 验证实证）：
 * 旧实现 resolveConfirmation 只认落库 json.status==='approved'，而该标记只有
 * executor 带票执行成功后才写（markApprovalSafe）——带票以锁单为前提，锁单又要求
 * 标记已写 → 鸡生蛋死锁：用户在面板点了「批准」，重试依然放不了行；
 * 且单 goto 全 defer 的会话被推成 failed 终态，run 通道 400「终态不可重跑」。
 * 修复：面板单批准态问桥（executor.resolvePanelApproval，桥是批准源头）；
 * pending 也放行锁定（executor 带票返回待批准失败，不签新单）；全 defer 会话
 * 落 partial_success 断点（sanctioned 重试通道），不再推 failed 终态。
 */
describe('面板单批准态问桥 + 待批会话可重试（2026-09-04 死锁修复）', () => {
  const ORIGINAL_MODE = process.env.AGENT_BROWSER_MODE;
  beforeAll(() => {
    process.env.AGENT_BROWSER_MODE = 'dom-agent';
  });
  afterAll(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.AGENT_BROWSER_MODE;
    else process.env.AGENT_BROWSER_MODE = ORIGINAL_MODE;
  });

  function pendingPanelRow(sessionId: string) {
    return panelRow(sessionId, {
      confirmationJson: {
        source: PANEL_CONFIRMATION_SOURCE,
        method: 'Page.navigate',
        status: 'pending',
      },
    });
  }

  it('D1｜桥上 approved（json.status 仍 pending）→ 问桥放行 + 锁定 + executor 带票执行', async () => {
    const built = await makeLoop({
      panelMode: 'on',
      bridgeState: 'approved',
      executeResult: {
        index: 0,
        action: 'goto',
        ok: true,
        url: 'https://kaypal.cn',
        confirmationId: 'act-1',
      },
    });
    const { loop, session, sessionSvc, prisma, executor } = built;
    prisma.agentConfirmation.findMany.mockResolvedValue([
      pendingPanelRow(session.id),
    ]);
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    // 问桥被调用（批准源头）
    expect(executor.resolvePanelApproval).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'u1' }),
      'act-1',
    );
    // 两阶段锁定放行：pending → in_use
    expect(prisma.agentConfirmation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'act-1', status: 'pending' } }),
    );
    // executor 带票执行（lockedConfirmationId 透传）
    const input = executor.execute.mock.calls[0][0] as Record<string, unknown>;
    expect(input.actionId).toBe('act-1');
    // 执行成功 → 会话 succeeded（终态）
    expect(sessionSvc.get(session.id).status).toBe('succeeded');
  });

  it('D2｜桥上 pending → 锁定携带（executor 不签新单）→ 失败释放回 pending → 会话 partial_success 等待批准', async () => {
    const built = await makeLoop({
      panelMode: 'on',
      bridgeState: 'pending',
      executeResult: {
        index: 0,
        action: 'goto',
        ok: false,
        message:
          '面板模式：导航需用户在桌面端批准（确认单 act-1 当前状态 pending）',
        confirmationId: 'act-1',
      },
    });
    const { loop, session, sessionSvc, prisma, executor } = built;
    prisma.agentConfirmation.findMany.mockResolvedValue([
      pendingPanelRow(session.id),
    ]);
    const events: Array<Record<string, unknown>> = [];
    await loop.run(session.id, '打开首页', {
      confirmationIds: ['act-1'],
      onStep: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    // 锁定放行（pending 单也锁——executor 带票问桥，不签新单）
    expect(prisma.agentConfirmation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'act-1', status: 'pending' } }),
    );
    // executor 带票执行
    const input = executor.execute.mock.calls[0][0] as Record<string, unknown>;
    expect(input.actionId).toBe('act-1');
    // 执行失败 → 释放回 pending（in_use → pending），可安全重试
    expect(prisma.agentConfirmation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'act-1', status: 'in_use' },
        data: expect.objectContaining({ status: 'pending' }),
      }),
    );
    // 会话落 partial_success 断点（非 failed 终态），done 事件明说等待批准
    const done = events.find((e) => e.type === 'done');
    expect(done?.status).toBe('partial_success');
    expect(String(done?.message)).toContain('等待面板批准');
    expect(sessionSvc.get(session.id).status).toBe('partial_success');
  });

  it('D3｜桥上 rejected → 不放行、不锁定（拒绝是终态，fail-closed 不变）', async () => {
    const built = await makeLoop({
      panelMode: 'on',
      bridgeState: 'rejected',
    });
    const { loop, session, prisma } = built;
    prisma.agentConfirmation.findMany.mockResolvedValue([
      pendingPanelRow(session.id),
    ]);
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    expect(prisma.agentConfirmation.updateMany).not.toHaveBeenCalled();
  });

  it('D4｜端到端两段闭环：第一轮 defer → partial_success；批准后第二轮同单执行成功 → succeeded', async () => {
    // 第一轮：桥上 pending（用户还没点）
    let bridgeState: 'approved' | 'pending' = 'pending';
    const built = await makeLoop({
      panelMode: 'on',
      bridgeState: 'pending',
      executeResult: {
        index: 0,
        action: 'goto',
        ok: false,
        message:
          '面板模式：导航需用户在桌面端批准（确认单 act-1 当前状态 pending）',
        confirmationId: 'act-1',
      },
    });
    const { loop, session, sessionSvc, prisma, executor } = built;
    prisma.agentConfirmation.findMany.mockResolvedValue([
      pendingPanelRow(session.id),
    ]);
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    expect(sessionSvc.get(session.id).status).toBe('partial_success');

    // —— 用户在面板点了「批准」——
    bridgeState = 'approved';
    executor.resolvePanelApproval.mockResolvedValue(bridgeState);
    executor.execute.mockResolvedValue({
      index: 0,
      action: 'goto',
      ok: true,
      url: 'https://kaypal.cn/explore',
      confirmationId: 'act-1',
    });
    // 模拟 controller run 的恢复路径：重置 running 后带同一张单重跑
    sessionSvc.updateStatus(session.id, 'created');
    await sessionSvc.acquireEngineSession(session.id);
    await loop.run(session.id, '打开首页', { confirmationIds: ['act-1'] });
    // 同一张单（act-1）被消费，不再签新单
    expect(prisma.agentConfirmation.create).not.toHaveBeenCalled();
    const lastInput = executor.execute.mock.calls[
      executor.execute.mock.calls.length - 1
    ][0] as Record<string, unknown>;
    expect(lastInput.actionId).toBe('act-1');
    expect(sessionSvc.get(session.id).status).toBe('succeeded');
  });
});
