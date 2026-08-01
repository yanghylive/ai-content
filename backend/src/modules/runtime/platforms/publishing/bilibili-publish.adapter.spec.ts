import { BilibiliPublishAdapter } from './bilibili-publish.adapter';

describe('BilibiliPublishAdapter', () => {
  const adapter = new BilibiliPublishAdapter();
  const loginCheck = jest.fn().mockResolvedValue({ ok: true, message: '已登录' });

  it('exposes the bilibili capability mirroring the registry contract', () => {
    expect(adapter.capability).toMatchObject({
      platform: 'bilibili',
      displayName: 'B站',
      contentKinds: ['video'],
      executionModes: ['cdp'],
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    });
  });

  it('builds a video publish plan with the bilibili config shape', () => {
    const plan = adapter.buildVideoPublishPlan(
      { biliTitle: '自定义标题', biliDesc: '简介' },
      loginCheck,
    );
    expect(plan).toMatchObject({
      platform: 'bilibili',
      platformName: 'B站',
      publishUrl:
        'https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload',
      publishButtonText: '立即投稿',
      evidencePrefix: 'bilibili',
    });
    expect(plan.successUrlPattern).toBeInstanceOf(RegExp);
    expect(plan.successUrlPattern.test('https://member.bilibili.com/x')).toBe(true);
    expect(typeof plan.fill).toBe('function');
    expect(typeof plan.waitUploaded).toBe('function');
    expect(typeof plan.waitReadback).toBe('function');
    expect(plan.loginCheck).toBe(loginCheck);
  });

  it('fill uses the biliTitle override and fills title/tags/desc', async () => {
    const inputFill = jest.fn().mockResolvedValue(undefined);
    const tagInput = {
      count: jest.fn().mockResolvedValue(1),
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
    };
    const locator = jest.fn().mockImplementation((selector: string) => {
      if (selector.includes('稿件标题') || selector.includes('标题')) {
        return { first: () => ({ fill: inputFill }) };
      }
      if (selector.includes('标签')) {
        return { first: () => tagInput };
      }
      return { first: () => ({ fill: jest.fn().mockResolvedValue(undefined) }) };
    });
    const page = {
      locator,
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    const plan = adapter.buildVideoPublishPlan(
      { biliTitle: '覆盖标题', biliDesc: 'B站简介' },
      loginCheck,
    );
    await plan.fill(page as never, '默认标题', ['#门店', ' 打卡 ']);

    expect(inputFill).toHaveBeenCalledWith('覆盖标题', { timeout: 30000 });
    // cleanTags 去 #、trim，最多 10 个
    expect(tagInput.fill).toHaveBeenCalledWith('门店');
    expect(tagInput.fill).toHaveBeenCalledWith('打卡');
  });

  it('fill falls back to the default title when biliTitle is absent', async () => {
    const inputFill = jest.fn().mockResolvedValue(undefined);
    const page = {
      locator: jest.fn().mockReturnValue({
        first: () => ({ fill: inputFill, count: jest.fn().mockResolvedValue(0) }),
      }),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const plan = adapter.buildVideoPublishPlan({}, loginCheck);
    await plan.fill(page as never, '默认标题', []);
    expect(inputFill).toHaveBeenCalledWith('默认标题', { timeout: 30000 });
  });
});
