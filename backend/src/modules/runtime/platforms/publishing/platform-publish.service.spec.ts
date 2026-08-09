import { BilibiliPublishAdapter } from './bilibili-publish.adapter';
import { DouyinPublishAdapter } from './douyin-publish.adapter';
import { KuaishouPublishAdapter } from './kuaishou-publish.adapter';
import { WechatChannelPublishAdapter } from './wechat-channel-publish.adapter';
import { WeiboPublishAdapter } from './weibo-publish.adapter';
import { XiaohongshuPublishAdapter } from './xiaohongshu-publish.adapter';
import { ZhihuPublishAdapter } from './zhihu-publish.adapter';
import { ToutiaoPublishAdapter } from './toutiao-publish.adapter';
import { PlatformPublishService } from './platform-publish.service';
import { PlatformAdapterRegistry } from '../../../platform-registry/platform-adapter.registry';

describe('PlatformPublishService', () => {
  const browser = {
    getOrCreateSession: jest.fn(),
    captureEvidence: jest.fn(),
    closeSession: jest.fn(),
  };

  // 测试用真实 PlatformAdapterRegistry（与 module 装配同形：5 个真实 factory）；
  // xhs/douyin factory 内部会消费 deps，但 service 端在每个 publishXxx 入口
  // 显式注入 deps（this.xxxx → service 私有方法），所以 factory 注入的
  // deps 对象本身只是被 adapter 引用——adapter 的业务方法需要 deps 时
  // 才会真正调用。
  const buildRegistry = () => {
    const registry = new PlatformAdapterRegistry();
    for (const a of [
      new XiaohongshuPublishAdapter({
        cleanTags: (t) => t,
        fillFirstEditable: () => Promise.resolve(),
        waitGenericVideoUploaded: () => Promise.resolve(),
      }),
      new WechatChannelPublishAdapter(),
      new DouyinPublishAdapter({
        gotoBestEffort: () => Promise.resolve(),
        waitGenericPublishButton: () =>
          Promise.resolve({ click: () => Promise.resolve() }),
      }),
      new KuaishouPublishAdapter(),
      new BilibiliPublishAdapter(),
      new WeiboPublishAdapter(),
      new ZhihuPublishAdapter(),
      new ToutiaoPublishAdapter(),
    ]) {
      registry.register(a);
    }
    const factories: Record<
      string,
      (deps: Record<string, unknown>) => unknown
    > = {
      xiaohongshu: (d) => new XiaohongshuPublishAdapter(d as never),
      'wechat-channel': () => new WechatChannelPublishAdapter(),
      douyin: (d) => new DouyinPublishAdapter(d as never),
      kuaishou: () => new KuaishouPublishAdapter(),
      bilibili: () => new BilibiliPublishAdapter(),
      weibo: () => new WeiboPublishAdapter(),
      zhihu: () => new ZhihuPublishAdapter(),
      toutiao: () => new ToutiaoPublishAdapter(),
    };
    for (const [p, f] of Object.entries(factories)) {
      registry.registerPublishFactory(p, f as never);
    }
    return registry;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps unsupported platform publish explicit as not_integrated', async () => {
    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );

    const result = await service.execute(
      {
        relatedId: 'publish-1',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'bilibili',
        accountId: '5',
        payload: {
          platform: 'B站',
          platformType: 5,
          title: '图文测试',
          accountId: '5',
          materialFiles: ['/tmp/image.png'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('not_integrated');
    expect(result.userMessage).toContain('真实发布执行器尚未迁入 3011 Runtime');
    expect(browser.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('blocks image-text publish without material before opening browser', async () => {
    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );

    const result = await service.execute(
      {
        relatedId: 'publish-image-missing',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'xiaohongshu',
        accountId: '2',
        payload: {
          platform: '小红书',
          platformType: 1,
          title: '缺图片测试',
          accountId: '2',
          materialFiles: [],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('target_not_found');
    expect(result.userMessage).toContain('缺少图片素材');
    expect(browser.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('does not treat pending image upload progress as ready', async () => {
    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    const previousDocument = (globalThis as any).document;
    const samples = [
      '作品描述 发布 选题验收，别等发完再后悔-01.png 0% 0/1 取消上传',
      '作品描述 发布 上传完成 更换图片',
    ];
    const page = {
      evaluate: jest.fn().mockImplementation(async (callback) => {
        const text = samples.shift() || '';
        (globalThis as any).document = {
          body: {
            innerText: text,
            textContent: text,
          },
        };
        return callback();
      }),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    try {
      await service['waitGenericImagesReady'](page as never);
    } finally {
      (globalThis as any).document = previousDocument;
    }

    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it('routes xiaohongshu image-text publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.xiaohongshu.com/publish/success?note_id=1',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'xiaohongshu-2',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    const beforeUpload = jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'prepareXiaohongshuImageTextPublish',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(service as never, 'waitGenericImagesReady')
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'fillXiaohongshuDescription',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'xiaohongshu-image-text-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-image-1',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'xiaohongshu',
        accountId: '2',
        payload: {
          platform: '小红书',
          platformType: 1,
          title: '小红书图文链路测试',
          accountId: '2',
          materialFiles: ['/tmp/image.png'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'xiaohongshu',
      accountId: '2',
    });
    expect(service['gotoBestEffort']).toHaveBeenCalledWith(
      page,
      'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
      60000,
    );
    expect(beforeUpload).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
    expect(
      result.evidence.some((item) => item.label === 'publish-readback'),
    ).toBe(true);
  });

  it('uses the Xiaohongshu custom publish control when the native button is not exposed', async () => {
    const customPublishControl = {
      last: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
      boundingBox: jest.fn().mockResolvedValue({
        x: 100,
        y: 200,
        width: 300,
        height: 80,
      }),
    };
    const nativeCandidate = {
      last: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue(0),
    };
    const page = {
      evaluate: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      keyboard: { type: jest.fn().mockResolvedValue(undefined) },
      mouse: {
        click: jest.fn().mockResolvedValue(undefined),
      },
      locator: jest.fn((selector: string) =>
        selector ===
        'xhs-publish-btn[submit-text="发布"][submit-disabled="false"]'
          ? customPublishControl
          : nativeCandidate,
      ),
      getByRole: jest.fn().mockReturnValue(nativeCandidate),
    };
    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );

    const result = await service['waitGenericPublishButton'](
      page as never,
      '发布',
    );

    expect(customPublishControl.scrollIntoViewIfNeeded).toHaveBeenCalled();
    await result.click();
    expect(page.mouse.click).toHaveBeenCalledWith(286, 244);
  });

  it('classifies Xiaohongshu platform policy refusal as a blocked permission issue', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'xiaohongshu-2',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'prepareXiaohongshuImageTextPublish',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(service as never, 'waitGenericImagesReady')
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'fillXiaohongshuDescription',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'waitXiaohongshuPublishReadback',
      )
      .mockImplementation(() => {
        throw new Error('小红书平台拒绝发布：因违反社区规范禁止发笔记');
      });
    jest
      .spyOn(service as never, 'isPlatformPublishBlockedError')
      .mockReturnValue(true);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'xiaohongshu-image-text-publish-failed',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-19T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-image-xhs-blocked',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'xiaohongshu',
        accountId: '2',
        payload: {
          platform: '小红书',
          platformType: 1,
          title: '小红书风控测试',
          accountId: '2',
          materialFiles: ['/tmp/image.png'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('permission_missing');
    expect(result.userMessage).toContain('被平台拒绝发布');
  });

  it('aborts a stalled image-text publish with a deadline result and closes the browser session', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'xiaohongshu-2',
      page,
    });
    browser.closeSession.mockResolvedValue(undefined);

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    service['genericPublishDeadlineMs'] = 5;
    service['genericPublishAbortDelayMs'] = 1;
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'prepareXiaohongshuImageTextPublish',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(service as never, 'waitGenericImagesReady')
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'fillXiaohongshuDescription',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'waitXiaohongshuPublishReadback',
      )
      .mockImplementation(() => new Promise(() => undefined));
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([]);

    const result = await service.execute(
      {
        relatedId: 'publish-image-xhs-timeout',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'xiaohongshu',
        accountId: '2',
        payload: {
          platform: '小红书',
          platformType: 1,
          title: '小红书超时测试',
          accountId: '2',
          materialFiles: ['/tmp/image.png'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('send_failed');
    expect(result.userMessage).toContain('超过 1 秒未返回平台回执');
    expect(
      result.evidence.some((item) => item.label === 'publish-deadline-aborted'),
    ).toBe(true);
    expect(result.userMessage).not.toContain(
      'Target page, context or browser has been closed',
    );
    expect(browser.closeSession).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(browser.closeSession).toHaveBeenCalledWith('xiaohongshu-2');
  });

  it('routes wechat-channel image-text publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/post/list'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'wechat-channel-4',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'checkWechatChannelLogin',
      )
      .mockResolvedValue({
        ok: true,
        message: '已登录',
      });
    jest
      .spyOn(service as never, 'waitGenericImagesReady')
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'fillWechatChannelDescription',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'handleWechatChannelPostPublishPrompts',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'waitWechatChannelPublishReadback',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'wechat-channel-image-text-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-image-2',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'wechat-channel',
        accountId: '4',
        payload: {
          platform: '视频号',
          platformType: 2,
          title: '视频号图文链路测试',
          accountId: '4',
          materialFiles: ['/tmp/image.png'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: '4',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
  });

  it('routes douyin image-text publish through picture tab and disables sync publish', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/content/manage',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'douyin-1',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    const beforeUpload = jest
      .spyOn(
        DouyinPublishAdapter.prototype as never,
        'prepareDouyinImageTextPublish',
      )
      .mockResolvedValue(undefined);
    const beforeClick = jest
      .spyOn(
        DouyinPublishAdapter.prototype as never,
        'configureDouyinImageTextBeforePublish',
      )
      .mockResolvedValue(undefined);
    const afterClick = jest
      .spyOn(
        DouyinPublishAdapter.prototype as never,
        'confirmDouyinContentDeclarationIfNeeded',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest
      .spyOn(DouyinPublishAdapter.prototype as never, 'checkDouyinLogin')
      .mockResolvedValue({
        ok: true,
        message: '已登录',
      });
    jest
      .spyOn(service as never, 'waitGenericImagesReady')
      .mockResolvedValue(undefined);
    jest
      .spyOn(DouyinPublishAdapter.prototype as never, 'fillDouyinDescription')
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        DouyinPublishAdapter.prototype as never,
        'waitDouyinImageTextReadback',
      )
      .mockResolvedValue(true);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'douyin-image-text-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-image-douyin',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'douyin',
        accountId: '1',
        payload: {
          platform: '抖音',
          platformType: 3,
          title: '抖音图文链路测试',
          accountId: '1',
          materialFiles: ['/tmp/image.png'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: '1',
    });
    expect(page.locator).toHaveBeenCalledWith(
      'input[type="file"][accept*="image"], input[type="file"][accept*=".png"], input[type="file"][accept*=".jpg"], input[type="file"][accept*=".jpeg"], input[type="file"][accept*=".webp"]',
    );
    expect(fileInput.setInputFiles).toHaveBeenCalledWith(['/tmp/image.png'], {
      timeout: 60000,
    });
    expect(beforeUpload).toHaveBeenCalled();
    expect(beforeClick).toHaveBeenCalled();
    expect(afterClick).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
  });

  it('confirms the Douyin content declaration dialog after image-text publish', async () => {
    jest.restoreAllMocks();
    const aiOption = {
      first: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue(1),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const confirmButton = {
      last: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue(1),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/content/post/image',
        ),
      locator: jest.fn().mockReturnValue({
        innerText: jest
          .fn()
          .mockResolvedValue('对作品内容添加声明 请选择声明类型 内容由AI生成'),
      }),
      getByText: jest.fn().mockReturnValue(aiOption),
      getByRole: jest.fn().mockReturnValue(confirmButton),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const secondPublish = { click: jest.fn().mockResolvedValue(undefined) };
    const adapter = new DouyinPublishAdapter({
      gotoBestEffort: jest.fn().mockResolvedValue(undefined),
      waitGenericPublishButton: jest.fn().mockResolvedValue(secondPublish),
    });

    await adapter['confirmDouyinContentDeclarationIfNeeded'](page as never);

    expect(page.getByText).toHaveBeenCalledWith(/内容由AI生成/);
    expect(aiOption.click).toHaveBeenCalledWith({ force: true, timeout: 5000 });
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: /^确定$/ });
    expect(confirmButton.click).toHaveBeenCalledWith({
      force: true,
      timeout: 8000,
    });
    expect(adapter['deps'].waitGenericPublishButton).toHaveBeenCalledWith(
      page,
      '发布',
    );
    expect(secondPublish.click).toHaveBeenCalledWith({
      force: true,
      timeout: 15000,
    });
  });

  it('blocks douyin video publish without material before opening browser', async () => {
    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );

    const result = await service.execute(
      {
        relatedId: 'publish-2',
        relatedType: 'agent-session',
        type: 'platform-publish-video',
        platform: 'douyin',
        accountId: '1',
        payload: {
          platform: '抖音',
          platformType: 3,
          title: '缺素材测试',
          accountId: '1',
          materialFiles: [],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('target_not_found');
    expect(result.userMessage).toContain('缺少视频素材');
    expect(browser.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('routes douyin video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      waitFor: jest.fn().mockResolvedValue(undefined),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/content/manage',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue({
        started: true,
        done: true,
        failed: false,
        sample: '',
      }),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'douyin-1',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest
      .spyOn(DouyinPublishAdapter.prototype as never, 'checkDouyinLogin')
      .mockResolvedValue({
        ok: true,
        message: '已登录',
      });
    jest
      .spyOn(DouyinPublishAdapter.prototype as never, 'fillDouyinDescription')
      .mockResolvedValue(undefined);
    jest
      .spyOn(DouyinPublishAdapter.prototype as never, 'setDouyinCoverIfNeeded')
      .mockResolvedValue(undefined);
    jest
      .spyOn(DouyinPublishAdapter.prototype as never, 'setDouyinScheduleTime')
      .mockResolvedValue(undefined);
    jest
      .spyOn(DouyinPublishAdapter.prototype as never, 'waitDouyinPublishButton')
      .mockResolvedValue({
        click: jest.fn().mockResolvedValue(undefined),
      });
    jest
      .spyOn(
        DouyinPublishAdapter.prototype as never,
        'waitDouyinPublishReadback',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'douyin-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-3',
        relatedType: 'agent-session',
        type: 'platform-publish-video',
        platform: 'douyin',
        accountId: '1',
        payload: {
          platform: '抖音',
          platformType: 3,
          title: '真实发布链路测试',
          accountId: '1',
          materialFiles: ['/tmp/video.mp4'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: '1',
    });
    expect(page.locator).toHaveBeenCalledWith(
      'input[type="file"][accept*="video"], input[type="file"][accept*=".mp4"], input[type="file"][accept*=".mov"]',
    );
    expect(fileInput.setInputFiles).toHaveBeenCalledWith('/tmp/video.mp4', {
      timeout: 45000,
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.runtime.executor).toBe('platform-publish');
    expect(result.readback?.matched).toBe(true);
    expect(
      result.evidence.some((item) => item.label === 'publish-readback'),
    ).toBe(true);
  });

  it('routes wechat-channel video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/post/list'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'wechat-channel-4',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'checkWechatChannelLogin',
      )
      .mockResolvedValue({
        ok: true,
        message: '已登录',
      });
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'fillWechatChannelDescription',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'fillWechatChannelShortTitle',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'setWechatChannelCoverIfNeeded',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'setWechatChannelScheduleTime',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'waitWechatChannelVideoUploaded',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'waitWechatChannelPublishButton',
      )
      .mockResolvedValue({
        click: jest.fn().mockResolvedValue(undefined),
      });
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'handleWechatChannelPostPublishPrompts',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'waitWechatChannelPublishReadback',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'wechat-channel-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-4',
        relatedType: 'agent-session',
        type: 'platform-publish-video',
        platform: 'wechat-channel',
        accountId: '4',
        payload: {
          platform: '视频号',
          platformType: 2,
          title: '视频号发布链路测试',
          accountId: '4',
          materialFiles: ['/tmp/video.mp4'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: '4',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.runtime.executor).toBe('platform-publish');
    expect(result.readback?.matched).toBe(true);
    expect(
      result.evidence.some((item) => item.label === 'publish-readback'),
    ).toBe(true);
  });

  it('clicks WeChat Channel direct publish when the original revenue prompt appears', async () => {
    jest.restoreAllMocks();
    const directPublish = {
      first: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      getByRole: jest.fn().mockReturnValue(directPublish),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    const readState = jest
      .spyOn(
        WechatChannelPublishAdapter.prototype as never,
        'readWechatChannelPublishState',
      )
      .mockResolvedValueOnce({
        done: false,
        failed: false,
        originalPromptVisible: true,
        adminVerificationVisible: false,
        sample: '声明原创的视频有机会获得广告分成 直接发表 声明原创',
      })
      .mockResolvedValueOnce({
        done: true,
        failed: false,
        originalPromptVisible: false,
        adminVerificationVisible: false,
        sample: '视频管理 发表视频 评论管理 修改描述和封面',
      });

    const adapter = new WechatChannelPublishAdapter();
    await adapter['handleWechatChannelPostPublishPrompts'](page as never);

    expect(page.getByRole).toHaveBeenCalledWith('button', {
      name: '直接发表',
      exact: true,
    });
    expect(directPublish.click).toHaveBeenCalledWith({
      force: true,
      timeout: 8000,
    });
    expect(readState).toHaveBeenCalledTimes(2);
  });

  it('fills the visible WeChat Channel video description instead of hidden product textareas', async () => {
    jest.restoreAllMocks();
    const page = {
      evaluate: jest.fn().mockResolvedValue(true),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn(),
      keyboard: {
        press: jest.fn(),
        insertText: jest.fn(),
      },
    };
    const adapter = new WechatChannelPublishAdapter();

    await adapter['fillWechatChannelDescription'](
      page as never,
      '视频号描述测试',
      ['门店'],
    );

    expect(page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      '视频号描述测试 #门店',
    );
    expect(page.waitForTimeout).toHaveBeenCalledWith(600);
    expect(page.keyboard.insertText).not.toHaveBeenCalled();
  });

  it('routes xiaohongshu video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.xiaohongshu.com/publish/success?note_id=1',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'xiaohongshu-2',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(service as never, 'waitGenericVideoUploaded')
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        XiaohongshuPublishAdapter.prototype as never,
        'fillXiaohongshuDescription',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'xiaohongshu-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-5',
        relatedType: 'agent-session',
        type: 'platform-publish-video',
        platform: 'xiaohongshu',
        accountId: '2',
        payload: {
          platform: '小红书',
          platformType: 1,
          title: '小红书发布链路测试',
          accountId: '2',
          materialFiles: ['/tmp/video.mp4'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'xiaohongshu',
      accountId: '2',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
  });

  it('routes kuaishou video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://cp.kuaishou.com/article/manage/video?status=2&from=publish',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
      getByText: jest.fn().mockReturnValue({
        last: jest
          .fn()
          .mockReturnValue({ count: jest.fn().mockResolvedValue(0) }),
      }),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'kuaishou-3',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(
        KuaishouPublishAdapter.prototype as never,
        'waitGenericVideoUploaded',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        KuaishouPublishAdapter.prototype as never,
        'fillKuaishouDescription',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'kuaishou-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-6',
        relatedType: 'agent-session',
        type: 'platform-publish-video',
        platform: 'kuaishou',
        accountId: '3',
        payload: {
          platform: '快手',
          platformType: 4,
          title: '快手发布链路测试',
          accountId: '3',
          materialFiles: ['/tmp/video.mp4'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'kuaishou',
      accountId: '3',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
  });

  it('routes bilibili video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://member.bilibili.com/platform/upload/video/frame',
        ),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'bilibili-5',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(
        BilibiliPublishAdapter.prototype as never,
        'waitBilibiliVideoUploaded',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(BilibiliPublishAdapter.prototype as never, 'fillBilibiliForm')
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        BilibiliPublishAdapter.prototype as never,
        'waitBilibiliPublishReadback',
      )
      .mockResolvedValue(true);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'bilibili-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-7',
        relatedType: 'agent-session',
        type: 'platform-publish-video',
        platform: 'bilibili',
        accountId: '5',
        payload: {
          platform: 'B站',
          platformType: 5,
          title: 'B站发布链路测试',
          accountId: '5',
          materialFiles: ['/tmp/video.mp4'],
          tags: ['门店'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'bilibili',
      accountId: '5',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
  });

  it('routes weibo video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://weibo.com'),
      locator: jest.fn().mockReturnValue(fileInput),
      evaluate: jest.fn().mockResolvedValue({ done: true, failed: false, sample: '' }),
      click: jest.fn().mockResolvedValue(undefined),
      keyboard: { type: jest.fn().mockResolvedValue(undefined) },
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'weibo-6',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(WeiboPublishAdapter.prototype as never, 'waitWeiboVideoUploaded')
      .mockResolvedValue(undefined);
    jest
      .spyOn(WeiboPublishAdapter.prototype as never, 'fillWeiboForm')
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'weibo-publish-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-weibo-video',
        relatedType: 'agent-session',
        type: 'platform-publish-video',
        platform: 'weibo',
        accountId: '6',
        payload: {
          platform: '微博',
          platformType: 6,
          title: '微博视频测试',
          accountId: '6',
          materialFiles: ['/tmp/video.mp4'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'weibo',
      accountId: '6',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
  });

  it('routes weibo image-text publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://weibo.com'),
      locator: jest.fn().mockReturnValue(fileInput),
      evaluate: jest.fn().mockResolvedValue({ done: true, failed: false, sample: '' }),
      click: jest.fn().mockResolvedValue(undefined),
      keyboard: { type: jest.fn().mockResolvedValue(undefined) },
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'weibo-6',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(WeiboPublishAdapter.prototype as never, 'fillWeiboForm')
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        WeiboPublishAdapter.prototype as never,
        'waitWeiboPublishReadback',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'weibo-image-text-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-weibo-image',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'weibo',
        accountId: '6',
        payload: {
          platform: '微博',
          platformType: 6,
          title: '微博图文测试',
          accountId: '6',
          materialFiles: ['/tmp/image.png'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
  });

  it('routes zhihu image-text publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://zhuanlan.zhihu.com/write'),
      locator: jest.fn().mockReturnValue(fileInput),
      evaluate: jest.fn().mockResolvedValue({ done: true, failed: false, sample: '' }),
      click: jest.fn().mockResolvedValue(undefined),
      keyboard: { type: jest.fn().mockResolvedValue(undefined) },
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'zhihu-7',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(ZhihuPublishAdapter.prototype as never, 'fillZhihuForm')
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        ZhihuPublishAdapter.prototype as never,
        'waitZhihuPublishReadback',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'zhihu-image-text-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-zhihu',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'zhihu',
        accountId: '7',
        payload: {
          platform: '知乎',
          platformType: 7,
          title: '知乎图文测试',
          accountId: '7',
          materialFiles: ['/tmp/image.png'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'zhihu',
      accountId: '7',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
  });

  it('routes toutiao image-text publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://mp.toutiao.com/profile_v4/graphic/publish'),
      locator: jest.fn().mockReturnValue(fileInput),
      evaluate: jest.fn().mockResolvedValue({ done: true, failed: false, sample: '' }),
      click: jest.fn().mockResolvedValue(undefined),
      keyboard: { type: jest.fn().mockResolvedValue(undefined) },
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'toutiao-8',
      page,
    });

    const service = new PlatformPublishService(
      browser as never,
      buildRegistry(),
    );
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest
      .spyOn(ToutiaoPublishAdapter.prototype as never, 'fillToutiaoForm')
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(
        ToutiaoPublishAdapter.prototype as never,
        'waitToutiaoPublishReadback',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(service as never, 'captureEvidence').mockResolvedValue([
      {
        type: 'screenshot',
        label: 'toutiao-image-text-success',
        path: '/tmp/evidence.png',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ]);

    const result = await service.execute(
      {
        relatedId: 'publish-toutiao',
        relatedType: 'agent-session',
        type: 'platform-publish-image-text',
        platform: 'toutiao',
        accountId: '8',
        payload: {
          platform: '头条',
          platformType: 8,
          title: '头条图文测试',
          accountId: '8',
          materialFiles: ['/tmp/image.png'],
        },
      },
      { riskContext: {}, sendMode: 'auto-send' },
    );

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'toutiao',
      accountId: '8',
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
  });
});
