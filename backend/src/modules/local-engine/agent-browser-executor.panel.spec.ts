import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  AgentBrowserExecutor,
  readAgentPanelMode,
} from './agent-browser-executor.service';
import {
  AgentPanelBridgeService,
  PanelBridgeError,
} from './agent-panel-bridge.service';
import { AiBrowserActionService } from './ai-browser-action.service';

/**
 * agent-browser-executor.panel.spec.ts — 阶段 5 面板模式路由测试
 *
 * 盯死三条硬规矩：
 *  1. 默认 off = 纯透传，一点现有行为都不改；
 *  2. 不静默降级——面板不可用/缺身份/动作不支持，一律 ok:false 且**不碰**原执行器；
 *  3. 批准权不在后端——goto 必须 approved 的确认单，pending 就停在"需用户确认"。
 */

type PanelBridgeStub = Partial<AgentPanelBridgeService>;

function makeLegacy(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ action: unknown; actor?: unknown }> = [];
  const stub = {
    calls,
    async executeSingle(input: { action: unknown; actor?: unknown }) {
      calls.push({ action: input.action, actor: input.actor });
      return {
        index: 0,
        action: (input.action as { action: string }).action,
        ok: true,
        message: 'legacy-executed',
      };
    },
    async isEngineAlive() {
      return true;
    },
    ...overrides,
  };
  return stub;
}

function makePanel(stub: PanelBridgeStub) {
  return stub as unknown as AgentPanelBridgeService;
}

const ACTOR = { ownerId: 'user-a', tenantId: 'tenant-a' };

describe('AgentBrowserExecutor 面板模式', () => {
  const original = process.env.KAYPAL_AGENT_PANEL_MODE;
  const originalModeFile = process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;

  beforeEach(() => {
    delete process.env.KAYPAL_AGENT_PANEL_MODE;
    // ③ 隔离：开关文件指向不存在的路径，防真机上 desktop 写过 on 导致用例漂移
    process.env.KAYPAL_BROWSER_PANEL_MODE_FILE = '/nonexistent/browser-panel-mode.json';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.KAYPAL_AGENT_PANEL_MODE;
    else process.env.KAYPAL_AGENT_PANEL_MODE = original;
    if (originalModeFile === undefined) delete process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
    else process.env.KAYPAL_BROWSER_PANEL_MODE_FILE = originalModeFile;
  });

  it('默认 off：纯透传原执行器（零行为变化）', async () => {
    const legacy = makeLegacy();
    const panel = makePanel({ status: () => ({ available: true, reason: 'ready' }) });
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      panel,
    );
    const out = await exec.execute({
      action: { action: 'goto', url: 'https://kaypal.cn/x' },
      accountId: 'acc-1',
    });
    expect(out.ok).toBe(true);
    expect(out.message).toBe('legacy-executed');
    expect(legacy.calls.length).toBe(1);
  });

  it('非法 KAYPAL_AGENT_PANEL_MODE → 显式失败（不猜配置）', () => {
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: 'ON' })).toBe('on');
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: 'yes' })).toBe('invalid');
    // ③：env 未设时会真实读开关文件，这里显式传 null（= 文件不存在/不合规）锁定默认 off
    expect(readAgentPanelMode({}, null)).toBe('off');
  });

  // ── 阶段 6 决策 ③：开关文件优先级 ─────────────────────────────────────────
  it('③ env 未设 + 开关文件 on → on（用户面板按钮生效）', () => {
    expect(readAgentPanelMode({}, 'on')).toBe('on');
  });

  it('③ env 显式 off + 开关文件 on → off（env 是管理员一票否决）', () => {
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: 'off' }, 'on')).toBe('off');
  });

  it('③ env 显式 on + 开关文件 off/null → on（env 优先级最高）', () => {
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: 'on' }, 'off')).toBe('on');
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: 'on' }, null)).toBe('on');
  });

  it('③ env 空串视为未设置，落到开关文件判定', () => {
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: '' }, 'on')).toBe('on');
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: '  ' }, null)).toBe('off');
  });

  it('③ env 非法值 → invalid（不猜，也不吃掉文件开关）', () => {
    expect(readAgentPanelMode({ KAYPAL_AGENT_PANEL_MODE: 'yes' }, 'on')).toBe('invalid');
  });

  it('③ 文件 off / null → 默认 off（铁律不变）', () => {
    expect(readAgentPanelMode({}, 'off')).toBe('off');
    expect(readAgentPanelMode({}, null)).toBe('off');
  });

  it('非法开关 → 动作未执行且提示原因', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'maybe';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ status: () => ({ available: true, reason: 'ready' }) }),
    );
    const out = await exec.execute({ action: { action: 'extract', selector: 'body' } });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('仅允许 off/on');
    expect(legacy.calls.length).toBe(0);
  });

  it('on 但桥未注入 → 显式失败，不回退原执行器', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(legacy as unknown as AiBrowserActionService);
    const out = await exec.execute({ action: { action: 'extract', selector: 'body' } });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('面板桥服务未注入');
    expect(legacy.calls.length).toBe(0);
  });

  it('on 但面板不可用 → 显式失败并提示打开面板（不静默回退无头浏览器）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ status: () => ({ available: false, reason: 'panel-not-open' }) }),
    );
    const out = await exec.execute({
      action: { action: 'goto', url: 'https://kaypal.cn/x' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('面板不可用');
    expect(out.message).toContain('不静默回退');
    expect(legacy.calls.length).toBe(0);
  });

  it('on 但缺调用方身份 → 显式失败（actor 断言前置）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ status: () => ({ available: true, reason: 'ready' }) }),
    );
    const out = await exec.execute({ action: { action: 'extract', selector: 'body' } });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('缺少调用方身份');
    expect(legacy.calls.length).toBe(0);
  });

  it('on + extract → 面板 observe，返回同页证据 webContentsId', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const observe = jest.fn(async () => ({
      binding: {
        panelId: 'panel-1',
        sessionId: 'sess-1',
        webContentsId: 42,
        url: 'https://kaypal.cn/page',
      },
      title: 'T',
      textSample: 'hello panel',
    }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        observe,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: { action: 'extract', selector: 'body' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(true);
    expect(out.panelWebContentsId).toBe(42);
    expect(out.panelSessionId).toBe('sess-1');
    expect(out.extractText).toBe('hello panel');
    expect(out.url).toBe('https://kaypal.cn/page');
    expect(observe).toHaveBeenCalledWith(ACTOR);
    expect(legacy.calls.length).toBe(0);
  });

  it('on + goto 无确认单 → 签单后停在"需用户确认"（拿不到执行结果）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const requestAction = jest.fn(async () => ({
      actionId: 'ticket-1',
      binding: { webContentsId: 42, method: 'Page.navigate' },
    }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        requestAction,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: { action: 'goto', url: 'https://kaypal.cn/x' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.confirmationId).toBe('ticket-1');
    expect(out.message).toContain('需用户确认');
    expect(legacy.calls.length).toBe(0);
  });

  it('on + goto 带 pending 确认单 → 拒绝执行（后端不能替用户点头）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const execute = jest.fn(async () => ({ binding: { webContentsId: 42 } }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        actionState: async () => ({
          actionId: 'ticket-1',
          state: 'pending' as const,
          panelId: 'panel-1',
          method: 'Page.navigate',
          approvedAt: null,
        }),
        execute,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: {
        action: 'goto',
        url: 'https://kaypal.cn/x',
        actionId: 'ticket-1',
      } as never,
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('需用户在桌面端批准');
    expect(execute).not.toHaveBeenCalled();
    expect(legacy.calls.length).toBe(0);
  });

  it('on + goto 带 approved 确认单 → 真执行并回写真实 URL', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const execute = jest.fn(async () => ({
      binding: {
        panelId: 'panel-1',
        sessionId: 'sess-1',
        webContentsId: 42,
        url: 'https://kaypal.cn/landed',
      },
      method: 'Page.navigate',
      executed: true,
      actionId: 'ticket-1',
      result: null,
    }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        actionState: async () => ({
          actionId: 'ticket-1',
          state: 'approved' as const,
          panelId: 'panel-1',
          method: 'Page.navigate',
          approvedAt: Date.now(),
        }),
        execute,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: {
        action: 'goto',
        url: 'https://kaypal.cn/x',
        actionId: 'ticket-1',
      } as never,
      actor: ACTOR,
    });
    expect(out.ok).toBe(true);
    expect(out.url).toBe('https://kaypal.cn/landed');
    expect(out.panelWebContentsId).toBe(42);
    expect(execute).toHaveBeenCalledWith(ACTOR, {
      method: 'Page.navigate',
      params: { url: 'https://kaypal.cn/x' },
      actionId: 'ticket-1',
    });
    expect(legacy.calls.length).toBe(0);
  });

  // ── 阶段 6 决策 ②：两套确认机制合并后的新行为 ──────────────────────────

  it('② 签单必须透传 sessionId（否则落出来的是孤儿单，永远匹配不上会话）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const requestAction = jest.fn(async () => ({
      actionId: 'ticket-1',
      binding: { webContentsId: 42, method: 'Page.navigate' },
    }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        requestAction,
      } as PanelBridgeStub),
    );
    await exec.execute({
      action: { action: 'goto', url: 'https://kaypal.cn/x' },
      actor: ACTOR,
      sessionId: 'agent-session-7',
    });
    expect(requestAction).toHaveBeenCalledWith(ACTOR, {
      method: 'Page.navigate',
      params: { url: 'https://kaypal.cn/x' },
      summary: { label: '导航', url: 'https://kaypal.cn/x' },
      sessionId: 'agent-session-7',
    });
    expect(legacy.calls.length).toBe(0);
  });

  it('② 不带 sessionId 时签单传 null（不崩、不伪造会话）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const requestAction = jest.fn(async () => ({
      actionId: 'ticket-1',
      binding: { webContentsId: 42, method: 'Page.navigate' },
    }));
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        requestAction,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: { action: 'goto', url: 'https://kaypal.cn/x' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(requestAction).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({ sessionId: null }),
    );
  });

  it('② 用户批准 → 批准那一刻落库（markApproved），不是只在桥内存里', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const markApproved = jest.fn(async () => undefined);
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        actionState: async () => ({
          actionId: 'ticket-1',
          state: 'approved' as const,
          panelId: 'panel-1',
          method: 'Page.navigate',
          approvedAt: Date.now(),
        }),
        execute: async () => ({
          binding: { webContentsId: 42, url: 'https://kaypal.cn/landed' },
          method: 'Page.navigate',
          executed: true,
          actionId: 'ticket-1',
          result: null,
        }),
        markApproved,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: {
        action: 'goto',
        url: 'https://kaypal.cn/x',
        actionId: 'ticket-1',
      } as never,
      actor: ACTOR,
      sessionId: 'agent-session-7',
    });
    expect(out.ok).toBe(true);
    // 审计链的关键一环：桌面点批必须留痕，否则事后查不到"谁批的、什么时候批的"
    expect(markApproved).toHaveBeenCalledWith('ticket-1');
    expect(legacy.calls.length).toBe(0);
  });

  it('② 用户在面板拒绝 → 不执行、明确报错，且拒绝态收口为终态', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const execute = jest.fn(async () => ({ binding: { webContentsId: 42 } }));
    const markRejected = jest.fn(async () => undefined);
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        actionState: async () => ({
          actionId: 'ticket-1',
          state: 'rejected' as const,
          panelId: 'panel-1',
          method: 'Page.navigate',
          approvedAt: null,
        }),
        execute,
        markRejected,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: {
        action: 'goto',
        url: 'https://kaypal.cn/x',
        actionId: 'ticket-1',
      } as never,
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('已被用户在面板中拒绝');
    // 拒绝 ≠ 需要确认：这是终态，不能再等、不能重试生效
    expect(out.message).not.toContain('需用户在桌面端批准');
    expect(execute).not.toHaveBeenCalled();
    expect(markRejected).toHaveBeenCalledWith('ticket-1');
    expect(legacy.calls.length).toBe(0);
  });

  // ── 阶段 7：click 动作接通面板桥 ──────────────────────────────────────────

  /** click 桩：execute 按 method 分发（probe 回坐标，mutation 记调用） */
  function makeClickPanel(opts: {
    state?: 'pending' | 'approved' | 'rejected';
    probe?: { found: boolean; x?: number; y?: number; text?: string };
  }) {
    const cdpCalls: Array<{
      method: string;
      params?: Record<string, unknown>;
      actionId?: string | null;
    }> = [];
    const execute = jest.fn(
      async (
        _actor: unknown,
        input: { method: string; params?: Record<string, unknown>; actionId?: string | null },
      ) => {
        cdpCalls.push({ ...input });
        if (input.method === 'Runtime.evaluate') {
          return {
            binding: { webContentsId: 42, url: 'https://kaypal.cn/page' },
            method: input.method,
            executed: true,
            actionId: null,
            result: {
              result: {
                value:
                  opts.probe ??
                  { found: true, x: 100, y: 50, text: '提交订单' },
              },
            },
          };
        }
        return {
          binding: { webContentsId: 42, url: 'https://kaypal.cn/page' },
          method: input.method,
          executed: true,
          actionId: input.actionId ?? null,
          result: null,
        };
      },
    );
    const requestAction = jest.fn(async () => ({
      actionId: 'ticket-9',
      binding: { webContentsId: 42, method: 'Input.dispatchMouseEvent' },
    }));
    const markApproved = jest.fn(async () => undefined);
    const markRejected = jest.fn(async () => undefined);
    const panel = makePanel({
      status: () => ({ available: true, reason: 'ready' }),
      execute,
      requestAction,
      markApproved,
      markRejected,
      ...(opts.state
        ? {
            actionState: async () => ({
              actionId: 'ticket-1',
              state: opts.state,
              panelId: 'panel-1',
              method: 'Input.dispatchMouseEvent',
              approvedAt: opts.state === 'approved' ? Date.now() : null,
            }),
          }
        : {}),
    } as PanelBridgeStub);
    return { panel, cdpCalls, execute, requestAction, markApproved, markRejected };
  }

  it('⑦ click 无单 + 元素存在 → 只签单不执行（先 probe，requestAction 带 sessionId + 语义摘要）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeClickPanel({});
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'click', selector: 'text=提交订单' },
      actor: ACTOR,
      sessionId: 'agent-session-7',
    });
    expect(out.ok).toBe(false);
    expect(out.confirmationId).toBe('ticket-9');
    expect(out.message).toContain('需用户确认');
    // 先只读探测，再签单：mutation 一次都没执行
    expect(p.cdpCalls.filter((c) => c.method === 'Input.dispatchMouseEvent').length).toBe(0);
    expect(p.requestAction).toHaveBeenCalledWith(ACTOR, {
      method: 'Input.dispatchMouseEvent',
      summary: { label: '点击', selector: 'text=提交订单', targetText: '提交订单' },
      sessionId: 'agent-session-7',
    });
    expect(legacy.calls.length).toBe(0);
  });

  it('⑦ click 无单 + 元素不存在 → 不签单（用户不看到死卡片）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeClickPanel({ probe: { found: false } });
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'click', selector: '#not-exist' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('找不到可见元素');
    expect(out.message).toContain('未签确认单');
    expect(p.requestAction).not.toHaveBeenCalled();
    expect(p.cdpCalls.filter((c) => c.method === 'Input.dispatchMouseEvent').length).toBe(0);
    expect(legacy.calls.length).toBe(0);
  });

  it('⑦ click 带 approved 单（loop 锁定传入）→ markApproved + pressed/released 同单同坐标', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeClickPanel({ state: 'approved' });
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'click', selector: 'text=提交订单' },
      actor: ACTOR,
      // 阶段 7 修断链：确认单 id 从 loop 侧传入（不再依赖 action.actionId）
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(true);
    expect(out.confirmationId).toBe('ticket-1');
    expect(p.markApproved).toHaveBeenCalledWith('ticket-1');
    const mutations = p.cdpCalls.filter(
      (c) => c.method === 'Input.dispatchMouseEvent',
    );
    expect(mutations.length).toBe(2);
    expect(mutations[0]).toMatchObject({
      actionId: 'ticket-1',
      params: { type: 'mousePressed', x: 100, y: 50, button: 'left', clickCount: 1 },
    });
    // released 与 pressed 同单（配对通道），同坐标
    expect(mutations[1]).toMatchObject({
      actionId: 'ticket-1',
      params: { type: 'mouseReleased', x: 100, y: 50, button: 'left', clickCount: 1 },
    });
    expect(legacy.calls.length).toBe(0);
  });

  it('⑦ click 带 rejected 单 → markRejected 终态收口，mutation 一次不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeClickPanel({ state: 'rejected' });
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'click', selector: '#btn' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('已被用户在面板中拒绝');
    expect(out.message).not.toContain('需用户在桌面端批准');
    expect(p.markRejected).toHaveBeenCalledWith('ticket-1');
    expect(p.cdpCalls.filter((c) => c.method === 'Input.dispatchMouseEvent').length).toBe(0);
    expect(legacy.calls.length).toBe(0);
  });

  it('⑦ click 带 approved 单但执行时元素已消失 → 显式失败不盲点', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeClickPanel({ state: 'approved', probe: { found: false } });
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'click', selector: '#btn' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('目标已不可见');
    expect(p.cdpCalls.filter((c) => c.method === 'Input.dispatchMouseEvent').length).toBe(0);
    expect(legacy.calls.length).toBe(0);
  });

  // ── 阶段 7 续：type（输入）动作接通面板桥 ────────────────────────────────

  it('⑦ type 无单 + 元素存在 → 签 insertText 型单（摘要带文本预览、带 sessionId）不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeClickPanel({});
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'type', selector: '#kw', text: 'kaypal 搜索词' },
      actor: ACTOR,
      sessionId: 'agent-session-7',
    });
    expect(out.ok).toBe(false);
    expect(out.confirmationId).toBe('ticket-9');
    expect(out.message).toContain('需用户确认');
    expect(p.requestAction).toHaveBeenCalledWith(ACTOR, {
      method: 'Input.insertText',
      summary: { label: '输入文本', selector: '#kw', text: 'kaypal 搜索词' },
      sessionId: 'agent-session-7',
    });
    expect(p.cdpCalls.filter((c) => c.method !== 'Runtime.evaluate').length).toBe(0);
    expect(legacy.calls.length).toBe(0);
  });

  it('⑦ type 无单 + 长文本 → 摘要截断为 40 字符预览', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const long = 'x'.repeat(120);
    const p = makeClickPanel({});
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    await exec.execute({
      action: { action: 'type', selector: '#kw', text: long },
      actor: ACTOR,
    });
    expect(p.requestAction).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({
        summary: expect.objectContaining({
          text: `${'x'.repeat(40)}…（共 120 字符）`,
        }),
      }),
    );
  });

  it('⑦ type 无单 + 元素不存在 → 不签单', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ probe: { found: false } });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'type', selector: '#not-exist', text: 'hi' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('找不到可见元素');
    expect(p.requestAction).not.toHaveBeenCalled();
    expect(p.cdpCalls.filter((c) => c.method !== 'Runtime.evaluate').length).toBe(0);
  });

  it('⑦ type 带 approved 单 → markApproved + 聚焦 pressed + insertText 同单', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ state: 'approved' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'type', selector: '#kw', text: 'hello panel' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(true);
    expect(out.confirmationId).toBe('ticket-1');
    expect(p.markApproved).toHaveBeenCalledWith('ticket-1');
    const mutations = p.cdpCalls.filter((c) => c.method !== 'Runtime.evaluate');
    expect(mutations.length).toBe(2);
    // 第一步：聚焦（mousePressed 消耗 insertText 型确认单）
    expect(mutations[0]).toMatchObject({
      method: 'Input.dispatchMouseEvent',
      actionId: 'ticket-1',
      params: { type: 'mousePressed', x: 100, y: 50, button: 'left', clickCount: 1 },
    });
    // 第二步：插入文本（配对通道，同单）
    expect(mutations[1]).toMatchObject({
      method: 'Input.insertText',
      actionId: 'ticket-1',
      params: { text: 'hello panel' },
    });
  });

  it('⑦ type 带 rejected 单 → markRejected 终态收口，mutation 不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ state: 'rejected' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'type', selector: '#kw', text: 'hi' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('已被用户在面板中拒绝');
    expect(p.markRejected).toHaveBeenCalledWith('ticket-1');
    expect(p.cdpCalls.filter((c) => c.method !== 'Runtime.evaluate').length).toBe(0);
  });

  it('⑦ type 带 approved 单但执行时元素已消失 → 显式失败不盲输', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ state: 'approved', probe: { found: false } });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'type', selector: '#kw', text: 'hi' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('目标已不可见');
    expect(p.cdpCalls.filter((c) => c.method !== 'Runtime.evaluate').length).toBe(0);
  });

  it('on + 暂不支持的动作（press_key）→ 显式失败，绝不偷偷走老路径', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ status: () => ({ available: true, reason: 'ready' }) }),
    );
    const out = await exec.execute({
      action: { action: 'press_key', key: 'Enter' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('暂不支持动作 press_key');
    expect(out.message).toContain('仅支持 extract / goto / click / type');
    expect(out.message).toContain('未回退');
    expect(legacy.calls.length).toBe(0);
  });

  it('on + 桥抛 PanelBridgeError → 转成 ok:false（不抛、不回退）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        observe: async () => {
          throw new PanelBridgeError('POLICY_DENIED', 403);
        },
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: { action: 'extract', selector: 'body' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('POLICY_DENIED');
    expect(legacy.calls.length).toBe(0);
  });

  it('isAlive：on 模式看面板桥；off 模式看原引擎', async () => {
    const legacy = makeLegacy();
    const health = jest.fn(async () => false);
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ health } as PanelBridgeStub),
    );
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    expect(await exec.isAlive('acc-1')).toBe(false);
    expect(health).toHaveBeenCalled();

    process.env.KAYPAL_AGENT_PANEL_MODE = 'off';
    expect(await exec.isAlive('acc-1')).toBe(true);
  });

  it('DI：面板桥可选注入（未注册也能构造）', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        AgentBrowserExecutor,
        { provide: AiBrowserActionService, useValue: makeLegacy() },
      ],
    }).compile();
    const exec = mod.get(AgentBrowserExecutor);
    expect(exec.panelMode()).toBe('off');
  });
});
