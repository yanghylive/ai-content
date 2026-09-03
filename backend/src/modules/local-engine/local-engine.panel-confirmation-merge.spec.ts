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
  return { loop, session: s, prisma, executor };
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
