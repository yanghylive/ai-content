import { PlatformPublishService } from './platform-publish.service';

describe('PlatformPublishService', () => {
  const browser = {
    getOrCreateSession: jest.fn(),
    captureEvidence: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps unsupported platform publish explicit as not_integrated', async () => {
    const service = new PlatformPublishService(browser as never);

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
    const service = new PlatformPublishService(browser as never);

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

  it('routes xiaohongshu image-text publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://creator.xiaohongshu.com/publish/success?note_id=1'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'xiaohongshu-2',
      page,
    });

    const service = new PlatformPublishService(browser as never);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest.spyOn(service as never, 'waitGenericImagesReady').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'fillXiaohongshuDescription').mockResolvedValue(undefined);
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
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.readback?.matched).toBe(true);
    expect(result.evidence.some((item) => item.label === 'publish-readback')).toBe(true);
  });

  it('routes wechat-channel image-text publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://channels.weixin.qq.com/platform/post/list'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'wechat-channel-4',
      page,
    });

    const service = new PlatformPublishService(browser as never);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkWechatChannelLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest.spyOn(service as never, 'waitGenericImagesReady').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'fillWechatChannelDescription').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'waitWechatChannelImageTextReadback').mockResolvedValue(true);
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

  it('blocks douyin video publish without material before opening browser', async () => {
    const service = new PlatformPublishService(browser as never);

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
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://creator.douyin.com/creator-micro/content/manage'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'douyin-1',
      page,
    });

    const service = new PlatformPublishService(browser as never);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkDouyinLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest.spyOn(service as never, 'fillDouyinDescription').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitDouyinVideoUploaded').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'setDouyinCoverIfNeeded').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'setDouyinScheduleTime').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitDouyinPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'waitDouyinPublishReadback').mockResolvedValue(undefined);
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
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.runtime.executor).toBe('platform-publish');
    expect(result.readback?.matched).toBe(true);
    expect(result.evidence.some((item) => item.label === 'publish-readback')).toBe(true);
  });

  it('routes wechat-channel video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://channels.weixin.qq.com/platform/post/list'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'wechat-channel-4',
      page,
    });

    const service = new PlatformPublishService(browser as never);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkWechatChannelLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest.spyOn(service as never, 'fillWechatChannelDescription').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'fillWechatChannelShortTitle').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'setWechatChannelCoverIfNeeded').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'setWechatChannelScheduleTime').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitWechatChannelVideoUploaded').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitWechatChannelPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'waitWechatChannelPublishReadback').mockResolvedValue(undefined);
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
    expect(result.evidence.some((item) => item.label === 'publish-readback')).toBe(true);
  });

  it('routes xiaohongshu video publish through local browser and returns readback evidence', async () => {
    const fileInput = {
      first: jest.fn().mockReturnThis(),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      url: jest.fn().mockReturnValue('https://creator.xiaohongshu.com/publish/success?note_id=1'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'xiaohongshu-2',
      page,
    });

    const service = new PlatformPublishService(browser as never);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest.spyOn(service as never, 'waitGenericVideoUploaded').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'fillXiaohongshuDescription').mockResolvedValue(undefined);
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
      url: jest.fn().mockReturnValue('https://cp.kuaishou.com/article/manage/video?status=2&from=publish'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
      getByText: jest.fn().mockReturnValue({ last: jest.fn().mockReturnValue({ count: jest.fn().mockResolvedValue(0) }) }),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'kuaishou-3',
      page,
    });

    const service = new PlatformPublishService(browser as never);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest.spyOn(service as never, 'waitGenericVideoUploaded').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'fillKuaishouDescription').mockResolvedValue(undefined);
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
      url: jest.fn().mockReturnValue('https://member.bilibili.com/platform/upload/video/frame'),
      locator: jest.fn().mockReturnValue(fileInput),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    browser.getOrCreateSession.mockResolvedValue({
      key: 'bilibili-5',
      page,
    });

    const service = new PlatformPublishService(browser as never);
    jest.spyOn(service as never, 'gotoBestEffort').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'checkGenericLogin').mockResolvedValue({
      ok: true,
      message: '已登录',
    });
    jest.spyOn(service as never, 'waitBilibiliVideoUploaded').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'fillBilibiliForm').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'waitGenericPublishButton').mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as never, 'waitBilibiliPublishReadback').mockResolvedValue(true);
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
});
