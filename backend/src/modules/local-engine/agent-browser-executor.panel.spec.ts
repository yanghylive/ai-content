import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  AgentBrowserExecutor,
  readAgentPanelMode,
  clampPanelWaitMs,
  PANEL_WAIT_MAX_MS,
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

/** 最小 PNG base64（1x1 透明像素，iVBORw0KGgo 是 PNG 魔数开头） */
const PNG_BASE64_MIN =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

  it('on + extract → selector 定向文本提取（对齐旧无头语义，带 webContentsId 证据）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const execute = jest.fn(async () => ({
      binding: {
        panelId: 'panel-1',
        sessionId: 'sess-1',
        webContentsId: 42,
        url: 'https://kaypal.cn/page',
      },
      method: 'Runtime.evaluate',
      executed: true,
      actionId: null,
      result: { result: { value: { found: true, text: '订单金额 ¥199' } } },
    }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        execute,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: { action: 'extract', selector: 'text=订单金额' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(true);
    expect(out.extractText).toBe('订单金额 ¥199');
    expect(out.panelWebContentsId).toBe(42);
    expect(out.panelSessionId).toBe('sess-1');
    expect(execute).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({
        method: 'Runtime.evaluate',
        params: expect.objectContaining({
          expression: expect.stringContaining('text=订单金额'),
        }),
      }),
    );
    // 表达式对齐旧语义：trim + 截 2000（页面内）
    const expr = (execute.mock.calls[0] as unknown[])[1] as {
      params: { expression: string };
    };
    expect(expr.params.expression).toContain('slice(0, 2000)');
    expect(legacy.calls.length).toBe(0);
  });

  it('on + extract 未命中 → 显式失败（对齐旧文案"提取失败"，不回退）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const execute = jest.fn(async () => ({
      binding: { webContentsId: 42, url: 'https://kaypal.cn/page' },
      method: 'Runtime.evaluate',
      executed: true,
      actionId: null,
      result: { result: { value: { found: false } } },
    }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        execute,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: { action: 'extract', selector: '#not-exist' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('提取失败');
    expect(out.message).toContain('#not-exist');
    expect(out.message).toContain('不回退');
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

  it('⑦ round17 防回归：type 聚焦后先清空（Runtime.evaluate execCommand delete）再 insertText，顺序正确', async () => {
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
    // 批准后先 probe 重解析（Runtime.evaluate）→ 聚焦 pressed → 清空 evaluate → insertText
    const methods = p.cdpCalls.map((c) => c.method);
    expect(methods[methods.length - 3]).toBe('Input.dispatchMouseEvent');
    expect(methods[methods.length - 2]).toBe('Runtime.evaluate');
    expect(methods[methods.length - 1]).toBe('Input.insertText');
    // 清空表达式必须包含 execCommand selectAll+delete（拟真清空，触发 onChange）
    const evaluateCalls = p.cdpCalls.filter((c) => c.method === 'Runtime.evaluate');
    const clearExpr = String(evaluateCalls[evaluateCalls.length - 1]?.params?.expression ?? '');
    expect(clearExpr).toContain("execCommand('selectAll'");
    expect(clearExpr).toContain("execCommand('delete'");
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

  // ── 阶段 7 续（第九轮）：press_key（按键）动作接通面板桥 ──────────────────

  it('⑧ press_key 无单 → 签 dispatchKeyEvent 型单（摘要带 key、带 sessionId）不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeClickPanel({});
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'press_key', key: 'Enter' },
      actor: ACTOR,
      sessionId: 'agent-session-7',
    });
    expect(out.ok).toBe(false);
    expect(out.confirmationId).toBe('ticket-9');
    expect(out.message).toContain('需用户确认');
    expect(p.requestAction).toHaveBeenCalledWith(ACTOR, {
      method: 'Input.dispatchKeyEvent',
      summary: { label: '按下按键', key: 'Enter' },
      sessionId: 'agent-session-7',
    });
    expect(p.cdpCalls.filter((c) => c.method !== 'Runtime.evaluate').length).toBe(0);
    expect(legacy.calls.length).toBe(0);
  });

  it('⑧ press_key 带 approved 单 → markApproved + keyDown/keyUp 同单同键位（功能键不合成 text）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ state: 'approved' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'press_key', key: 'Enter' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(true);
    expect(out.confirmationId).toBe('ticket-1');
    expect(p.markApproved).toHaveBeenCalledWith('ticket-1');
    const mutations = p.cdpCalls.filter(
      (c) => c.method === 'Input.dispatchKeyEvent',
    );
    expect(mutations.length).toBe(2);
    // 第一步：keyDown（消耗确认单）
    expect(mutations[0]).toMatchObject({
      actionId: 'ticket-1',
      params: { type: 'keyDown', key: 'Enter' },
    });
    expect(mutations[0].params).not.toHaveProperty('text');
    // 第二步：keyUp（配对通道，同单）
    expect(mutations[1]).toMatchObject({
      actionId: 'ticket-1',
      params: { type: 'keyUp', key: 'Enter' },
    });
    expect(mutations[1].params).not.toHaveProperty('text');
  });

  it('⑧ press_key 可打印单字符 → keyDown 补 text（拟真键入语义），keyUp 不带', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ state: 'approved' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'press_key', key: 'x' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(true);
    const mutations = p.cdpCalls.filter(
      (c) => c.method === 'Input.dispatchKeyEvent',
    );
    expect(mutations[0]).toMatchObject({
      actionId: 'ticket-1',
      params: { type: 'keyDown', key: 'x', text: 'x' },
    });
    expect(mutations[1]).toMatchObject({
      actionId: 'ticket-1',
      params: { type: 'keyUp', key: 'x' },
    });
    expect(mutations[1].params).not.toHaveProperty('text');
  });

  it('⑧ press_key 带 rejected 单 → markRejected 终态收口，mutation 不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ state: 'rejected' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'press_key', key: 'Enter' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('已被用户在面板中拒绝');
    expect(out.message).not.toContain('需用户在桌面端批准');
    expect(p.markRejected).toHaveBeenCalledWith('ticket-1');
    expect(p.cdpCalls.filter((c) => c.method === 'Input.dispatchKeyEvent').length).toBe(0);
  });

  it('⑧ press_key 带 pending 单 → 停在需用户批准，不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeClickPanel({ state: 'pending' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'press_key', key: 'Enter' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('需用户在桌面端批准');
    expect(out.message).toContain('当前状态 pending');
    expect(p.cdpCalls.filter((c) => c.method === 'Input.dispatchKeyEvent').length).toBe(0);
  });

  // ── 阶段 7 续（第十轮）：wait（免审批本地等待）────────────────────────────

  it('⑩ wait 面板模式免单直接执行（无 requestAction、无 CDP 调用），ok 带实际时长', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const execute = jest.fn(async () => ({ binding: { webContentsId: 42 } }));
    const requestAction = jest.fn(async () => ({ actionId: 'ticket-x' }));
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        execute,
        requestAction,
      } as PanelBridgeStub),
    );
    const out = await exec.execute({
      action: { action: 'wait', ms: 50 },
      actor: ACTOR,
    });
    expect(out.ok).toBe(true);
    expect(out.message).toContain('面板等待完成（50ms');
    // 无副作用动作不签单、不碰 CDP
    expect(requestAction).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(legacy.calls.length).toBe(0);
  });

  it('⑩ wait off 模式纯透传原执行器（零行为变化）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'off';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ status: () => ({ available: true, reason: 'ready' }) }),
    );
    const out = await exec.execute({ action: { action: 'wait', ms: 1 }, accountId: 'acc-1' });
    expect(out.ok).toBe(true);
    expect(out.message).toBe('legacy-executed');
    expect(legacy.calls.length).toBe(1);
  });

  it('⑩ clampPanelWaitMs：floor/非法/负数→0/上限 30s（防天文数字卡死状态机）', () => {
    expect(PANEL_WAIT_MAX_MS).toBe(30_000);
    expect(clampPanelWaitMs(1500)).toBe(1500);
    expect(clampPanelWaitMs(99.9)).toBe(99);
    expect(clampPanelWaitMs(-5)).toBe(0);
    expect(clampPanelWaitMs(0)).toBe(0);
    expect(clampPanelWaitMs('abc')).toBe(0);
    expect(clampPanelWaitMs(Number.NaN)).toBe(0);
    expect(clampPanelWaitMs(999_999_999)).toBe(30_000);
  });

  // ── 阶段 7 续（第十一轮）：tabs（主进程伪 method Panel.tabs）────────────────

  function makeTabsPanel(opts: {
    state?: 'pending' | 'approved' | 'rejected';
    snapshot?: { tabs: number; activeIndex: number; url: string | null };
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
        return {
          binding: { webContentsId: 77, url: 'about:blank' },
          method: input.method,
          executed: true,
          actionId: input.actionId ?? null,
          // Panel.tabs 的 result = manager tab 台账快照（server 放行特例）
          result: opts.snapshot ?? { tabs: 2, activeIndex: 1, url: 'about:blank' },
        };
      },
    );
    const requestAction = jest.fn(async () => ({
      actionId: 'ticket-tabs',
      binding: { webContentsId: 77, method: 'Panel.tabs' },
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
              method: 'Panel.tabs',
              approvedAt: opts.state === 'approved' ? Date.now() : null,
            }),
          }
        : {}),
    });
    return { panel, execute, requestAction, markApproved, markRejected, cdpCalls };
  }

  it('⑪ tabs 无单 → 签语义级单（Panel.tabs 指纹 + operation/index 摘要），mutation 不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeTabsPanel({});
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'tabs', operation: 'switch', index: 2 },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('需用户确认后执行');
    expect(out.message).toContain('面板标签页确认单 ticket-tabs');
    expect(p.requestAction).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({
        method: 'Panel.tabs',
        summary: { label: '标签页操作', operation: 'switch', index: 2 },
      }),
    );
    expect(p.cdpCalls.length).toBe(0);
  });

  it('⑪ tabs 带 approved 单 → Panel.tabs 全链执行（消耗单 + 台账快照进 message + binding 取新 active）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeTabsPanel({
      state: 'approved',
      snapshot: { tabs: 2, activeIndex: 0, url: 'https://kaypal.cn/a' },
    });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'tabs', operation: 'switch', index: 0 },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(true);
    expect(p.markApproved).toHaveBeenCalledWith('ticket-1');
    expect(p.cdpCalls).toHaveLength(1);
    expect(p.cdpCalls[0]).toMatchObject({
      method: 'Panel.tabs',
      actionId: 'ticket-1',
      params: { operation: 'switch', index: 0 },
    });
    expect(out.message).toContain('面板标签页操作已执行（switch');
    expect(out.message).toContain('共 2 个，active=0');
    expect(out.message).toContain('确认单 ticket-1');
    // binding = 执行后重新解析的 active tab（switch 后 webContentsId 变化）
    expect(out.panelWebContentsId).toBe(77);
  });

  it('⑪ tabs 带 rejected 单 → markRejected 终态收口，mutation 不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeTabsPanel({ state: 'rejected' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'tabs', operation: 'close', index: 1 },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('已被用户在面板中拒绝');
    expect(out.message).not.toContain('需用户在桌面端批准');
    expect(p.markRejected).toHaveBeenCalledWith('ticket-1');
    expect(p.cdpCalls.length).toBe(0);
  });

  it('⑪ tabs 带 pending 单 → 停在需用户批准，不执行', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeTabsPanel({ state: 'pending' });
    const exec = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'tabs', operation: 'new' },
      actor: ACTOR,
      actionId: 'ticket-1',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('需用户在桌面端批准');
    expect(out.message).toContain('当前状态 pending');
    expect(p.cdpCalls.length).toBe(0);
  });

  it('on + 未登记的动作类型 → 显式失败，绝不偷偷走老路径', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ status: () => ({ available: true, reason: 'ready' }) }),
    );
    const out = await exec.execute({
      action: { action: 'record_video' } as never,
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('暂不支持动作 record_video');
    expect(out.message).toContain(
      '仅支持 extract / goto / click / type / press_key / wait / tabs / screenshot',
    );
    expect(out.message).toContain('未回退');
    expect(legacy.calls.length).toBe(0);
  });

  // ===== ⑫ screenshot（round12）：readonly 观察类免单，Page.captureScreenshot =====
  function makeScreenshotPanel(opts: {
    data?: string;
    execute?: PanelBridgeStub['execute'];
  }) {
    const cdpCalls: { method: string; params: unknown; actionId?: string }[] = [];
    const execute =
      opts.execute ??
      (async (_actor: unknown, input: { method: string; params: unknown; actionId?: string }) => {
        cdpCalls.push({ method: input.method, params: input.params, actionId: input.actionId });
        return {
          binding: { panelId: 'panel-1', sessionId: 'sess-1', webContentsId: 42, url: 'https://kaypal.cn/page' },
          method: input.method,
          executed: true,
          actionId: input.actionId ?? null,
          result: { data: opts.data ?? PNG_BASE64_MIN },
        };
      });
    return { panel: makePanel({ status: () => ({ available: true, reason: 'ready' }), execute } as PanelBridgeStub), cdpCalls };
  }

  it('⑫ on + screenshot → 免单直接执行（无 requestAction，Page.captureScreenshot png）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeScreenshotPanel({});
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({
      action: { action: 'screenshot', name: '首页快照' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(true);
    expect(out.screenshotBase64).toBe(PNG_BASE64_MIN);
    // message 只报字节数，绝不携带 base64 数据
    expect(out.message).toContain('PNG base64');
    expect(out.message).not.toContain(PNG_BASE64_MIN);
    expect(out.message).toContain('首页快照');
    expect(out.panelWebContentsId).toBe(42);
    expect(p.cdpCalls.length).toBe(1);
    expect(p.cdpCalls[0].method).toBe('Page.captureScreenshot');
    expect(p.cdpCalls[0].params).toEqual({ format: 'png' });
    // 免单：不带 actionId（readonly 通道）
    expect(p.cdpCalls[0].actionId).toBeUndefined();
    expect(legacy.calls.length).toBe(0);
  });

  it('⑫ round17：注入 engine 时截图证据落盘（evidenceUrl 填充）；未注入时动作仍成功', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const p = makeScreenshotPanel({});
    const saveEvidencePngBase64 = jest
      .fn()
      .mockResolvedValue({ path: '/tmp/evidence/x.png', url: '/api/local-engine/browser/evidence/x.png' });
    const engine = { saveEvidencePngBase64 } as unknown as never;
    const execWithEngine = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
      engine,
    );
    const out = await execWithEngine.execute({
      action: { action: 'screenshot', name: '首页快照' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(true);
    expect(out.evidenceUrl).toBe('/api/local-engine/browser/evidence/x.png');
    expect(saveEvidencePngBase64).toHaveBeenCalledWith(
      expect.objectContaining({ base64: PNG_BASE64_MIN, sessionKey: 'sess-1' }),
    );
    // 未注入 engine（老构造）→ 动作仍成功，evidenceUrl 留空（交底，不炸）
    const execNoEngine = new AgentBrowserExecutor(
      makeLegacy() as unknown as AiBrowserActionService,
      p.panel,
    );
    const out2 = await execNoEngine.execute({
      action: { action: 'screenshot', name: '首页快照' },
      actor: ACTOR,
    });
    expect(out2.ok).toBe(true);
    expect(out2.evidenceUrl).toBeUndefined();
    expect(out2.message).toContain('证据未落盘');
  });

  it('⑫ on + screenshot 无数据返回 → 显式失败（不回退）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const p = makeScreenshotPanel({ data: '' });
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      p.panel,
    );
    const out = await exec.execute({ action: { action: 'screenshot' }, actor: ACTOR });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('截图失败');
    expect(out.message).toContain('未返回图像数据');
    expect(legacy.calls.length).toBe(0);
  });

  it('on + 桥抛 PanelBridgeError → 转成 ok:false（不抛、不回退）', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({
        status: () => ({ available: true, reason: 'ready' }),
        execute: async () => {
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
