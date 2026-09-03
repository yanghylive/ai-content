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

  it('on + 暂不支持的动作（click）→ 显式失败，绝不偷偷走老路径', async () => {
    process.env.KAYPAL_AGENT_PANEL_MODE = 'on';
    const legacy = makeLegacy();
    const exec = new AgentBrowserExecutor(
      legacy as unknown as AiBrowserActionService,
      makePanel({ status: () => ({ available: true, reason: 'ready' }) }),
    );
    const out = await exec.execute({
      action: { action: 'click', selector: '#btn' },
      actor: ACTOR,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('暂不支持动作 click');
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
