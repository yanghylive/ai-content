import { XiaohongshuPublishAdapter } from './xiaohongshu-publish.adapter';

describe('XiaohongshuPublishAdapter', () => {
  const deps = {
    cleanTags: jest.fn((tags: string[], max: number) =>
      tags
        .map((t) => String(t || '').trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, max),
    ),
    fillFirstEditable: jest.fn().mockResolvedValue(undefined),
    waitGenericVideoUploaded: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = new XiaohongshuPublishAdapter(deps as never);
  const loginCheck = jest.fn().mockResolvedValue({ ok: true, message: '已登录' });

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
    expect(plan.successUrlPattern.test('https://creator.xiaohongshu.com/publish/success')).toBe(true);
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
    expect(plan.successUrlPattern.test('https://creator.xiaohongshu.com/publish/success')).toBe(true);
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
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    const longTitle = '这是一个超过二十个字的小红书标题需要被截断掉';
    await plan.fill(page as never, longTitle, ['#门店', '打卡']);
    expect(titleFill).toHaveBeenCalledWith(longTitle.slice(0, 20), { timeout: 5000 });
    expect(deps.fillFirstEditable).toHaveBeenCalledWith(
      page,
      '这是一个超过二十个字的小红书标题需要被截断掉 #门店 #打卡',
      '[contenteditable="true"], textarea, div[class*="editor"]',
    );
  });
});
