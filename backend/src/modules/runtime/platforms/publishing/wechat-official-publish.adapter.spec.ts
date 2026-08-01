import { WechatOfficialPublishAdapter } from './wechat-official-publish.adapter';

describe('WechatOfficialPublishAdapter', () => {
  const adapter = new WechatOfficialPublishAdapter();

  it('exposes the correct platform capability', () => {
    expect(adapter.capability).toMatchObject({
      platform: 'wechat-official',
      displayName: '微信公众号',
      contentKinds: ['article'],
      executionModes: ['cdp'],
      supportsDraft: true,
      supportsCover: true,
      supportsReadback: true,
      riskLevel: 'high',
    });
  });

  it('builds an image-text publish plan with WeChat mp selectors', () => {
    const loginCheck = jest.fn();
    const plan = adapter.buildImageTextPublishPlan(loginCheck);

    expect(plan.platform).toBe('wechat-official');
    expect(plan.platformName).toBe('微信公众号');
    expect(plan.publishUrl).toContain('mp.weixin.qq.com');
    expect(plan.uploadSelector).toContain('input[type="file"]');
    expect(plan.successUrlPattern).toBeInstanceOf(RegExp);
    expect(plan.evidencePrefix).toBe('wechat-official');
    expect(plan.loginCheck).toBe(loginCheck);
    expect(plan.fill).toBeDefined();
    expect(plan.beforeUpload).toBeDefined();
    expect(plan.afterClick).toBeDefined();
    expect(plan.waitReadback).toBeDefined();
  });
});
