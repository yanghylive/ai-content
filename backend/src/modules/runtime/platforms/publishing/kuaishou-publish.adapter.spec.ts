import { KuaishouPublishAdapter } from './kuaishou-publish.adapter';

describe('KuaishouPublishAdapter', () => {
  const adapter = new KuaishouPublishAdapter();
  const loginCheck = jest
    .fn()
    .mockResolvedValue({ ok: true, message: '已登录' });

  it('exposes the kuaishou capability mirroring the registry contract', () => {
    expect(adapter.capability).toMatchObject({
      platform: 'kuaishou',
      displayName: '快手',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    });
  });

  it('builds a video publish plan with the kuaishou config shape', () => {
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    expect(plan).toMatchObject({
      platform: 'kuaishou',
      platformName: '快手',
      publishUrl: 'https://cp.kuaishou.com/article/publish/video',
      publishButtonText: '发布',
      evidencePrefix: 'kuaishou',
    });
    expect(
      plan.successUrlPattern.test(
        'https://cp.kuaishou.com/article/manage/video',
      ),
    ).toBe(true);
    expect(typeof plan.fill).toBe('function');
    expect(typeof plan.waitUploaded).toBe('function');
    expect(typeof plan.afterClick).toBe('function');
    expect(plan.loginCheck).toBe(loginCheck);
  });

  it('builds an image-text publish plan with the kuaishou config shape', () => {
    const plan = adapter.buildImageTextPublishPlan(loginCheck);
    expect(plan).toMatchObject({
      platform: 'kuaishou',
      platformName: '快手',
      publishUrl: 'https://cp.kuaishou.com/article/publish/picture',
      publishButtonText: '发布',
      evidencePrefix: 'kuaishou-image-text',
    });
    expect(
      plan.successUrlPattern.test('https://cp.kuaishou.com/article/manage'),
    ).toBe(true);
    expect(typeof plan.fill).toBe('function');
    expect(typeof plan.afterClick).toBe('function');
    expect(plan.waitReadback).toBeUndefined();
    expect(plan.loginCheck).toBe(loginCheck);
  });

  it('fill joins title and cleaned hashtags into the editable', async () => {
    const insertText = jest.fn().mockResolvedValue(undefined);
    const editor = {
      waitFor: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      locator: jest.fn().mockReturnValue({ first: () => editor }),
      keyboard: {
        press: jest.fn().mockResolvedValue(undefined),
        insertText,
      },
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    await plan.fill(page as never, '快手标题', ['#门店', ' 打卡 ', '#']);
    // cleanTags 去 #/trim/去空，最多 6 个，前缀补 #
    expect(insertText).toHaveBeenCalledWith('快手标题 #门店 #打卡');
  });

  it('afterClick clicks the 确认发布 button only when visible', async () => {
    const click = jest.fn().mockResolvedValue(undefined);
    const confirmButton = {
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(true),
      click,
    };
    const page = {
      getByText: jest.fn().mockReturnValue({ last: () => confirmButton }),
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    await plan.afterClick?.(page as never);
    expect(page.getByText).toHaveBeenCalledWith('确认发布');
    expect(click).toHaveBeenCalledWith({ timeout: 8000 });
  });

  it('afterClick skips the click when the confirm button is absent', async () => {
    const click = jest.fn();
    const confirmButton = {
      count: jest.fn().mockResolvedValue(0),
      isVisible: jest.fn().mockResolvedValue(false),
      click,
    };
    const page = {
      getByText: jest.fn().mockReturnValue({ last: () => confirmButton }),
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    await plan.afterClick?.(page as never);
    expect(click).not.toHaveBeenCalled();
  });
});
