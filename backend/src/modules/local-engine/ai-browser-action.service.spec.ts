import { BadRequestException } from '@nestjs/common';
import { AiBrowserActionService } from './ai-browser-action.service';

function makePage() {
  return {
    goto: jest.fn(async () => undefined),
    waitForLoadState: jest.fn(async () => undefined),
    locator: jest.fn((selector: string) => ({
      first: () => ({
        fill: jest.fn(async () => undefined),
        click: jest.fn(async () => undefined),
        textContent: jest.fn(async () => '提取到的内容'),
      }),
      _selector: selector,
    })),
    bringToFront: jest.fn(async () => undefined),
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const page = makePage();
  const browser = {
    getOrCreateSession: jest.fn(async () => ({
      key: 'session-1',
      page,
      lastActivityAt: '',
    })),
    captureEvidence: jest.fn(async () => ({
      path: '/tmp/evidence.png',
      url: '/api/local-engine/browser/evidence/evidence.png',
    })),
    ...overrides,
  };
  const service = new AiBrowserActionService(browser as any);
  return { service, browser, page };
}

describe('AiBrowserActionService parseInstruction', () => {
  let svc: AiBrowserActionService;
  beforeEach(() => {
    svc = new AiBrowserActionService({} as any);
  });

  it('打开 URL', () => {
    const actions = svc.parseInstruction('打开 https://example.com');
    expect(actions).toEqual([{ action: 'goto', url: 'https://example.com' }]);
  });

  it('点击文本目标', () => {
    const actions = svc.parseInstruction('点击 登录');
    expect(actions).toEqual([{ action: 'click', selector: 'text=登录' }]);
  });

  it('输入文字', () => {
    const actions = svc.parseInstruction('输入 你好世界');
    expect(actions[0].action).toBe('type');
    expect((actions[0] as any).text).toBe('你好世界');
  });

  it('等待秒与毫秒', () => {
    expect(svc.parseInstruction('等待 2 秒')).toEqual([{ action: 'wait', ms: 2000 }]);
    expect(svc.parseInstruction('等待 500 毫秒')).toEqual([
      { action: 'wait', ms: 500 },
    ]);
  });

  it('截图', () => {
    expect(svc.parseInstruction('截图 首页')).toEqual([
      { action: 'screenshot', name: '首页' },
    ]);
  });

  it('提取内容', () => {
    const actions = svc.parseInstruction('提取 .price');
    expect(actions).toEqual([{ action: 'extract', selector: '.price' }]);
  });

  it('复合指令拆成多动作', () => {
    const actions = svc.parseInstruction('打开 https://a.com 然后点击 搜索');
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ action: 'goto', url: 'https://a.com' });
    expect(actions[1]).toEqual({ action: 'click', selector: 'text=搜索' });
  });

  it('空指令抛错', () => {
    expect(() => svc.parseInstruction('')).toThrow('指令不能为空');
  });

  it('无法解析的步骤抛错', () => {
    expect(() => svc.parseInstruction('随便说点什么')).toThrow('无法解析');
  });

  it('动作超上限拒绝', () => {
    const many = Array.from({ length: 15 }, (_, i) => `点击 按钮${i}`).join(' 然后 ');
    expect(() => svc.parseInstruction(many)).toThrow('动作过多');
  });
});

describe('AiBrowserActionService run', () => {
  it('mock 模式硬失败', async () => {
    const prev = process.env.DISPATCH_MOCK;
    process.env.DISPATCH_MOCK = 'true';
    const { service } = makeService();
    try {
      await expect(
        service.run({ instruction: '打开 https://a.com' }),
      ).rejects.toThrow('DISPATCH_MOCK');
    } finally {
      if (prev === undefined) delete process.env.DISPATCH_MOCK;
      else process.env.DISPATCH_MOCK = prev;
    }
  });

  it('完整执行：goto + click + 每步证据', async () => {
    const { service, browser, page } = makeService();
    const result = await service.run({
      instruction: '打开 https://example.com 然后点击 登录',
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://example.com',
      expect.any(Object),
    );
    expect(page.locator).toHaveBeenCalledWith('text=登录');
    expect(browser.captureEvidence).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].evidenceUrl).toContain('evidence.png');
  });

  it('url 参数兜底：无 goto 时前置插入', async () => {
    const { service, page } = makeService();
    await service.run({
      instruction: '点击 搜索',
      url: 'https://example.com/search',
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://example.com/search',
      expect.any(Object),
    );
  });

  it('extract 步骤返回提取文本', async () => {
    const { service } = makeService();
    const result = await service.run({ instruction: '提取 .title 内容' });
    expect(result.results[0].extractText).toBe('提取到的内容');
  });

  it('单步失败不中断（type 找不到元素也继续）', async () => {
    const { service } = makeService();
    const result = await service.run({
      instruction: '输入 你好 然后 截图',
    });
    // type 可能失败但截图继续，至少有一个 ok
    expect(result.results.length).toBe(2);
  });
});

describe('AiBrowserActionService validateAiActions (AI-LLM 解析)', () => {
  let svc: any;
  beforeEach(() => {
    const browser = {
      getOrCreateSession: jest.fn(async () => ({ key: 's', page: makePage() })),
      captureEvidence: jest.fn(async () => ({ path: '/tmp/e.png', url: '/e.png' })),
    };
    svc = new AiBrowserActionService(browser as any);
  });

  it('合法 JSON 数组通过白名单', () => {
    const actions = svc.validateAiActions(
      '[{"action":"goto","url":"https://a.com"},{"action":"wait","ms":500}]',
    );
    expect(actions).toEqual([
      { action: 'goto', url: 'https://a.com' },
      { action: 'wait', ms: 500 },
    ]);
  });

  it('Markdown 代码块包裹也能解析', () => {
    const actions = svc.validateAiActions(
      '```json\n[{"action":"click","selector":"text=登录"}]\n```',
    );
    expect(actions).toEqual([{ action: 'click', selector: 'text=登录' }]);
  });

  it('非法动作被过滤', () => {
    const actions = svc.validateAiActions(
      '[{"action":"delete_all","url":"https://a.com"},{"action":"screenshot"}]',
    );
    expect(actions).toEqual([{ action: 'screenshot', name: undefined }]);
  });

  it('非法 URL 的 goto 被过滤', () => {
    const actions = svc.validateAiActions(
      '[{"action":"goto","url":"javascript:alert(1)"}]',
    );
    expect(actions).toBeNull();
  });

  it('非 JSON 返回 null', () => {
    expect(svc.validateAiActions('not json')).toBeNull();
  });

  it('空数组返回 null', () => {
    expect(svc.validateAiActions('[]')).toBeNull();
  });

  it('wait 超上限 clamp 到 60s', () => {
    const actions = svc.validateAiActions('[{"action":"wait","ms":999999}]');
    expect(actions).toEqual([{ action: 'wait', ms: 60000 }]);
  });

  it('未配置模型时 parseWithAi 返回 null（降级规则解析）', async () => {
    const prisma = { defaultModelConfig: { findFirst: jest.fn(async () => null) } };
    const aiClient = {};
    const browser = { getOrCreateSession: jest.fn(), captureEvidence: jest.fn() };
    const svcWithPrisma = new AiBrowserActionService(
      browser as any,
      prisma as any,
      aiClient as any,
    );
    expect(await svcWithPrisma.parseWithAi('打开 https://a.com')).toBeNull();
  });
});

describe('AiBrowserActionService §7.4 状态语义', () => {
  it('部分失败返回 partial_success（不再一个成功就整体成功）', async () => {
    // 直接用真实服务测状态计算：通过私有方法不可达，用构造+mock executeStep
    const { AiBrowserActionService } = require('./ai-browser-action.service');
    const svc = Object.create(AiBrowserActionService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn() };
    svc.parseWithAi = jest.fn().mockResolvedValue([
      { action: 'goto', url: 'https://example.com' },
      { action: 'click', selector: '#x' },
    ]);
    svc.browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'k-1',
        page: { url: () => '', goto: jest.fn() },
      }),
      captureEvidence: jest.fn().mockResolvedValue({ url: 'ev' }),
    };
    // executeStep：第 1 步成功，第 2 步失败
    svc.executeStep = jest
      .fn()
      .mockResolvedValueOnce({ evidenceUrl: 'ev1' })
      .mockRejectedValueOnce(new Error('selector not found'));
    const result = await svc.run({
      instruction: '打开并点击',
      url: 'https://example.com',
    });
    expect(result.status).toBe('partial_success');
    expect(result.ok).toBe(false);
    expect(result.results.filter((r: { ok: boolean }) => r.ok).length).toBe(1);
  });

  it('全部成功返回 success', async () => {
    const { AiBrowserActionService } = require('./ai-browser-action.service');
    const svc = Object.create(AiBrowserActionService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn() };
    svc.parseWithAi = jest.fn().mockResolvedValue([
      { action: 'goto', url: 'https://example.com' },
    ]);
    svc.browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'k-2',
        page: { url: () => '', goto: jest.fn() },
      }),
      captureEvidence: jest.fn().mockResolvedValue({ url: 'ev' }),
    };
    svc.executeStep = jest.fn().mockResolvedValue({ evidenceUrl: 'ev1' });
    const result = await svc.run({
      instruction: '打开',
      url: 'https://example.com',
    });
    expect(result.status).toBe('success');
    expect(result.ok).toBe(true);
  });
});

describe('AiBrowserActionService §7.4 执行前策略拦截', () => {
  it('policyGate 拒绝时动作不执行（executeStep 不调用）', async () => {
    const { AiBrowserActionService } = require('./ai-browser-action.service');
    const svc = Object.create(AiBrowserActionService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn() };
    svc.parseWithAi = jest.fn().mockResolvedValue([
      { action: 'goto', url: 'https://example.com' },
    ]);
    svc.browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'k-3',
        page: { url: () => '', goto: jest.fn() },
      }),
      captureEvidence: jest.fn().mockResolvedValue({ url: 'ev' }),
    };
    svc.executeStep = jest.fn().mockResolvedValue({ evidenceUrl: 'ev1' });
    const result = await svc.run({
      instruction: '打开',
      url: 'https://example.com',
      policyGate: async () => ({ allowed: false, reason: '域名不在白名单' }),
    });
    expect(svc.executeStep).not.toHaveBeenCalled();
    expect(result.results[0].blocked).toBe(true);
    expect(result.results[0].message).toContain('策略阻断');
  });

  it('policyGate 放行时正常执行', async () => {
    const { AiBrowserActionService } = require('./ai-browser-action.service');
    const svc = Object.create(AiBrowserActionService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn() };
    svc.parseWithAi = jest.fn().mockResolvedValue([
      { action: 'goto', url: 'https://example.com' },
    ]);
    svc.browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'k-4',
        page: { url: () => '', goto: jest.fn() },
      }),
      captureEvidence: jest.fn().mockResolvedValue({ url: 'ev' }),
    };
    svc.executeStep = jest.fn().mockResolvedValue({ evidenceUrl: 'ev1' });
    const result = await svc.run({
      instruction: '打开',
      url: 'https://example.com',
      policyGate: async () => ({ allowed: true }),
    });
    expect(svc.executeStep).toHaveBeenCalled();
    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].blocked).toBeUndefined();
  });
});
