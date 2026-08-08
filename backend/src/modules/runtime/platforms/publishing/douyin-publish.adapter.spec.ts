import { DouyinPublishAdapter } from './douyin-publish.adapter';

describe('DouyinPublishAdapter', () => {
  const deps = {
    gotoBestEffort: jest.fn().mockResolvedValue(undefined),
    waitGenericPublishButton: jest.fn(),
  };
  const adapter = new DouyinPublishAdapter(deps as never);
  const loginCheck = jest
    .fn()
    .mockResolvedValue({ ok: true, message: '已登录' });

  it('exposes the douyin capability mirroring the registry contract', () => {
    expect(adapter.capability).toMatchObject({
      platform: 'douyin',
      displayName: '抖音',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    });
  });

  it('builds an image-text publish plan with the douyin config shape', () => {
    const plan = adapter.buildImageTextPublishPlan(loginCheck);
    expect(plan).toMatchObject({
      platform: 'douyin',
      platformName: '抖音',
      publishUrl:
        'https://creator.douyin.com/creator-micro/content/post/picture?enter_from=publish_page',
      publishButtonText: '发布',
      evidencePrefix: 'douyin-image-text',
    });
    expect(
      plan.successUrlPattern.test(
        'https://creator.douyin.com/creator-micro/content/manage',
      ),
    ).toBe(true);
    expect(typeof plan.beforeUpload).toBe('function');
    expect(typeof plan.beforeClick).toBe('function');
    expect(typeof plan.afterClick).toBe('function');
    expect(typeof plan.fill).toBe('function');
    expect(typeof plan.waitReadback).toBe('function');
    expect(plan.loginCheck).toBe(loginCheck);
  });

  it('builds video publish steps with the douyin urls and evidence labels', () => {
    const steps = adapter.buildVideoPublishSteps();
    expect(steps.publishUrl).toBe(
      'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page',
    );
    expect(steps.loginRequiredEvidence).toBe('douyin-publish-login-required');
    expect(steps.successEvidence).toBe('douyin-publish-success');
    expect(typeof steps.run).toBe('function');
  });

  it('checkDouyinLogin reports logged out on passport url', async () => {
    const page = {
      url: () => 'https://creator.douyin.com/login',
      locator: () => ({ innerText: () => Promise.resolve('') }),
    };
    await expect(adapter.checkDouyinLogin(page as never)).resolves.toEqual({
      ok: false,
      message: '抖音创作者中心账号未登录，不能发布。',
    });
  });

  it('checkDouyinLogin reports logged in on normal url and text', async () => {
    const page = {
      url: () => 'https://creator.douyin.com/creator-micro/content/post/video',
      locator: () => ({ innerText: () => Promise.resolve('发布视频 上传') }),
    };
    await expect(adapter.checkDouyinLogin(page as never)).resolves.toEqual({
      ok: true,
      message: '已登录',
    });
  });

  it('video run uploads, fills, waits, and clicks publish', async () => {
    const calls: string[] = [];
    const publishButton = { click: jest.fn().mockResolvedValue(undefined) };
    const page = {
      url: () => 'https://creator.douyin.com/creator-micro/content/manage',
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({
        first: () => ({
          fill: jest.fn().mockResolvedValue(undefined),
          waitFor: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined),
          setInputFiles: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      evaluate: jest.fn().mockResolvedValue({
        started: true,
        done: true,
        failed: false,
        sample: '',
      }),
      keyboard: {
        press: jest.fn().mockResolvedValue(undefined),
        insertText: jest.fn().mockResolvedValue(undefined),
      },
      getByRole: jest.fn().mockReturnValue({
        last: () => ({
          waitFor: jest.fn().mockResolvedValue(undefined),
          isEnabled: jest.fn().mockResolvedValue(true),
          getAttribute: jest.fn().mockResolvedValue(null),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: publishButton.click,
        }),
      }),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    const steps = adapter.buildVideoPublishSteps();
    const { currentUrl } = await steps.run(page as never, {
      title: '标题',
      tags: ['门店'],
      videoPath: '/tmp/video.mp4',
    });
    expect(publishButton.click).toHaveBeenCalledWith({ timeout: 15000 });
    expect(page.waitForURL).toHaveBeenCalledWith(
      '**/creator-micro/content/manage**',
      { timeout: 120000 },
    );
    expect(currentUrl).toContain('content/manage');
    expect(calls).toEqual([]);
  });
});
