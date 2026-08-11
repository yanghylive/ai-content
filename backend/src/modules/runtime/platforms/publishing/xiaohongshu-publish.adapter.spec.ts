import { XiaohongshuPublishAdapter } from './xiaohongshu-publish.adapter';

describe('XiaohongshuPublishAdapter', () => {
  const deps = {
    cleanTags: jest.fn((tags: string[], max: number) =>
      tags
        .map((t) =>
          String(t || '')
            .trim()
            .replace(/^#/, ''),
        )
        .filter(Boolean)
        .slice(0, max),
    ),
    fillFirstEditable: jest.fn().mockResolvedValue(undefined),
    waitGenericVideoUploaded: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = new XiaohongshuPublishAdapter(deps as never);
  const loginCheck = jest
    .fn()
    .mockResolvedValue({ ok: true, message: '已登录' });

  it('exposes the xiaohongshu capability mirroring the registry contract', () => {
    expect(adapter.capability).toMatchObject({
      platform: 'xiaohongshu',
      displayName: '小红书',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    });
  });

  it('builds a video publish plan with the xiaohongshu config shape', () => {
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    expect(plan).toMatchObject({
      platform: 'xiaohongshu',
      platformName: '小红书',
      publishUrl:
        'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video',
      publishButtonText: '发布',
      evidencePrefix: 'xiaohongshu',
    });
    expect(
      plan.successUrlPattern.test(
        'https://creator.xiaohongshu.com/publish/success',
      ),
    ).toBe(true);
    expect(typeof plan.fill).toBe('function');
    expect(typeof plan.waitReadback).toBe('function');
    expect(typeof plan.waitUploaded).toBe('function');
    expect(plan.loginCheck).toBe(loginCheck);
  });

  it('builds an image-text publish plan with beforeUpload and readback', () => {
    const plan = adapter.buildImageTextPublishPlan(loginCheck);
    expect(plan).toMatchObject({
      platform: 'xiaohongshu',
      platformName: '小红书',
      publishUrl:
        'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
      publishButtonText: '发布',
      evidencePrefix: 'xiaohongshu-image-text',
    });
    expect(
      plan.successUrlPattern.test(
        'https://creator.xiaohongshu.com/publish/success',
      ),
    ).toBe(true);
    expect(typeof plan.beforeUpload).toBe('function');
    expect(typeof plan.fill).toBe('function');
    expect(typeof plan.waitReadback).toBe('function');
    expect(plan.loginCheck).toBe(loginCheck);
  });

  it('fill truncates the title to 20 chars and joins cleaned hashtags', async () => {
    const titleFill = jest.fn().mockResolvedValue(undefined);
    const page = {
      locator: jest.fn().mockReturnValue({
        first: () => ({ fill: titleFill }),
      }),
      evaluate: jest.fn().mockResolvedValue(undefined),
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    const longTitle = '这是一个超过二十个字的小红书标题需要被截断掉';
    await plan.fill(page as never, longTitle, ['#门店', '打卡']);
    expect(titleFill).toHaveBeenCalledWith(longTitle.slice(0, 20), {
      timeout: 5000,
    });
    expect(deps.fillFirstEditable).toHaveBeenCalledWith(
      page,
      '这是一个超过二十个字的小红书标题需要被截断掉 #门店 #打卡',
      '[contenteditable="true"], textarea, div[class*="editor"]',
    );
  });

  it('checks the original declaration checkbox during fill (declaration selector logic)', async () => {
    const page = {
      locator: jest.fn().mockReturnValue({
        first: () => ({ fill: jest.fn().mockResolvedValue(undefined) }),
      }),
      evaluate: jest.fn().mockResolvedValue(undefined),
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    await plan.fill(page as never, '标题', ['#tag']);
    // fill 的 evaluate 即原创声明勾选（fill 内唯一 evaluate）
    const evaluate = page.evaluate as jest.Mock;
    expect(evaluate.mock.calls.length).toBe(1);
    const fn = evaluate.mock.calls[0]?.[0];
    expect(typeof fn).toBe('function');
    // 在 DOM mock 下执行：找到含"声明原创"的 label + checkbox，未勾选则点击
    const dom = {
      checked: false,
      click: jest.fn(),
    };
    global.document = {
      querySelectorAll: () => [
        {
          textContent: '声明原创',
          querySelector: () => dom,
        },
      ],
    } as unknown as Document;
    fn();
    expect(dom.click).toHaveBeenCalledTimes(1);
    delete (global as { document?: unknown }).document;
  });

  it('ignores declaration evaluate failure and keeps publish flow safe', async () => {
    const page = {
      locator: jest.fn().mockReturnValue({
        first: () => ({ fill: jest.fn().mockResolvedValue(undefined) }),
      }),
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('evaluate failed')),
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    await expect(plan.fill(page as never, '标题', [])).resolves.toBeUndefined();
  });
});

describe('XiaohongshuPublishAdapter §6b 发布按钮评分定位', () => {
  const deps = {
    cleanTags: jest.fn((tags: string[], max: number) => tags.slice(0, max)),
    fillFirstEditable: jest.fn().mockResolvedValue(undefined),
    waitGenericVideoUploaded: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = new XiaohongshuPublishAdapter(deps as never);
  const loginCheckLocal = jest
    .fn()
    .mockResolvedValue({ ok: true, message: '已登录' });

  function makePage(scored: { x: number; y: number; score: number } | null) {
    const mouse = {
      move: jest.fn().mockResolvedValue(undefined),
      down: jest.fn().mockResolvedValue(undefined),
      up: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    };
    return {
      // 调用序：scrollTo(忽略) → 评分 → stillThere(点击后按钮已消失=false → return)
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(scored)
        .mockResolvedValue(false),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      mouse,
      locator: jest.fn(() => ({
        innerText: jest.fn().mockResolvedValue(''),
      })),
    } as never;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('plan 暴露 locatePublishButton 回调', () => {
    const plan = adapter.buildVideoPublishPlan({}, loginCheckLocal);
    expect(typeof plan.locatePublishButton).toBe('function');
  });

  it('评分命中时派发完整事件序列并返回可点击句柄', async () => {
    const page = makePage({ x: 400, y: 700, score: 180 });
    const access = adapter as unknown as {
      locateXiaohongshuPublishButton(
        page: never,
        text: string,
      ): Promise<{ click: (options?: object) => Promise<void> }>;
    };
    const handle = await access.locateXiaohongshuPublishButton(
      page as never,
      '发布',
    );
    await handle.click();
    const pageMock = page as never as {
      mouse: { move: jest.Mock; down: jest.Mock; up: jest.Mock; click: jest.Mock };
    };
    expect(pageMock.mouse.move).toHaveBeenCalledWith(400, 700);
    expect(pageMock.mouse.down).toHaveBeenCalled();
    expect(pageMock.mouse.up).toHaveBeenCalled();
    expect(pageMock.mouse.click).toHaveBeenCalledWith(400, 700);
  });

  it('评分始终未命中时抛错（Date.now 加速过期）', async () => {
    // 让 while 循环的 90s 截止快速到达，避免空转
    const realNow = Date.now.bind(Date);
    let fakeNow = realNow();
    jest.spyOn(Date, 'now').mockImplementation(() => {
      fakeNow += 2000;
      return fakeNow;
    });
    const page = makePage(null);
    const access = adapter as unknown as {
      locateXiaohongshuPublishButton(
        page: never,
        text: string,
      ): Promise<{ click: (options?: object) => Promise<void> }>;
    };
    await expect(
      access.locateXiaohongshuPublishButton(page as never, '发布'),
    ).rejects.toThrow('评分定位失败');
  });
});
