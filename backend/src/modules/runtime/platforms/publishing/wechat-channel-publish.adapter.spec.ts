import { WechatChannelPublishAdapter } from './wechat-channel-publish.adapter';

describe('WechatChannelPublishAdapter', () => {
  const adapter = new WechatChannelPublishAdapter();
  const loginCheck = jest
    .fn()
    .mockResolvedValue({ ok: true, message: '已登录' });

  it('exposes the wechat-channel capability mirroring the registry contract', () => {
    expect(adapter.capability).toMatchObject({
      platform: 'wechat-channel',
      displayName: '视频号',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    });
  });

  it('builds an image-text publish plan with the wechat-channel config shape', () => {
    const plan = adapter.buildImageTextPublishPlan(loginCheck);
    expect(plan).toMatchObject({
      platform: 'wechat-channel',
      platformName: '视频号',
      publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
      publishButtonText: '发表',
      evidencePrefix: 'wechat-channel-image-text',
    });
    expect(
      plan.successUrlPattern.test(
        'https://channels.weixin.qq.com/platform/post/list',
      ),
    ).toBe(true);
    expect(typeof plan.fill).toBe('function');
    expect(typeof plan.afterClick).toBe('function');
    expect(typeof plan.waitReadback).toBe('function');
    expect(plan.loginCheck).toBe(loginCheck);
  });

  it('builds video publish steps with the wechat-channel urls and evidence labels', () => {
    const steps = adapter.buildVideoPublishSteps();
    expect(steps.publishUrl).toBe(
      'https://channels.weixin.qq.com/platform/post/create',
    );
    expect(steps.loginRequiredEvidence).toBe(
      'wechat-channel-publish-login-required',
    );
    expect(steps.successEvidence).toBe('wechat-channel-publish-success');
    expect(typeof steps.run).toBe('function');
  });

  it('checkWechatChannelLogin reports logged out on passport url', async () => {
    const page = {
      url: () => 'https://channels.weixin.qq.com/login',
      locator: () => ({ innerText: () => Promise.resolve('') }),
    };
    await expect(
      adapter.checkWechatChannelLogin(page as never),
    ).resolves.toEqual({
      ok: false,
      message: '视频号后台账号未登录，不能发布。',
    });
  });

  it('checkWechatChannelLogin reports logged in on normal url and text', async () => {
    const page = {
      url: () => 'https://channels.weixin.qq.com/platform/post/create',
      locator: () => ({ innerText: () => Promise.resolve('发表视频 上传') }),
    };
    await expect(
      adapter.checkWechatChannelLogin(page as never),
    ).resolves.toEqual({
      ok: true,
      message: '已登录',
    });
  });

  it('fillWechatChannelShortTitle keeps letters/numbers and pads to 6 chars', () => {
    const input = { fill: jest.fn().mockResolvedValue(undefined) };
    const page = {
      locator: jest.fn().mockReturnValue({ first: () => input }),
    };
    void adapter['fillWechatChannelShortTitle'](page as never, '视频标题v2');
    // 去非 letter/number/《》""：+?%°，截 16，补到 6（不变，因为原长度 6）
    expect(input.fill).toHaveBeenCalledWith('视频标题v2', { timeout: 5000 });
  });
});
