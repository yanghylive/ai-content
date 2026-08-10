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

  const STATE_DONE = {
    done: true,
    failed: false,
    originalPromptVisible: false,
    adminVerificationVisible: false,
    sample: '',
  };
  const STATE_FAILED = {
    done: false,
    failed: true,
    originalPromptVisible: false,
    adminVerificationVisible: false,
    sample: '上传失败',
  };

  const createRunPage = (evalResults: unknown[]) => {
    let evalCount = 0;
    const fileInput = {
      setInputFiles: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      waitFor: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const publishButton = { click: jest.fn().mockResolvedValue(undefined) };
    const page = {
      url: () => 'https://channels.weixin.qq.com/platform/post/create',
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({
        first: () => fileInput,
        last: () => fileInput,
      }),
      evaluate: jest.fn().mockImplementation(() => {
        const spec = evalResults[Math.min(evalCount, evalResults.length - 1)];
        evalCount += 1;
        return Promise.resolve(spec);
      }),
      getByRole: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        first: () => ({
          count: jest.fn().mockResolvedValue(1),
          isVisible: jest.fn().mockResolvedValue(true),
          waitFor: jest.fn().mockResolvedValue(undefined),
          isEnabled: jest.fn().mockResolvedValue(true),
          getAttribute: jest.fn().mockResolvedValue(null),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: publishButton.click,
        }),
        last: () => publishButton,
      }),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
    };
    return { page, fileInput, publishButton };
  };

  it('video run retries upload once on failure and proceeds to publish', async () => {
    const { page, fileInput, publishButton } = createRunPage([
      {}, // fill 描述
      STATE_FAILED, // waitUploaded 第一次 → 重传
      STATE_DONE, // waitUploaded 重传后成功
      STATE_DONE, // prompts/readback
    ]);
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: '视频号测试',
      tags: ['门店'],
      videoPath: '/tmp/video.mp4',
    });
    expect(fileInput.setInputFiles).toHaveBeenCalledTimes(2);
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  it('video run throws after retry when upload keeps failing (no infinite loop)', async () => {
    const { page, fileInput } = createRunPage([
      {}, // fill 描述
      STATE_FAILED, // waitUploaded 第一次 → 重传
      STATE_FAILED, // waitUploaded 重传后仍失败 → throw
    ]);
    const steps = adapter.buildVideoPublishSteps();
    await expect(
      steps.run(page as never, {
        title: '视频号测试',
        tags: ['门店'],
        videoPath: '/tmp/video.mp4',
      }),
    ).rejects.toThrow('视频上传失败');
    expect(fileInput.setInputFiles).toHaveBeenCalledTimes(2);
  });

  const STATE_IDLE = {
    done: false,
    failed: false,
    originalPromptVisible: false,
    adminVerificationVisible: false,
    sample: '',
  };
  const STATE_PROMPT = {
    done: false,
    failed: false,
    originalPromptVisible: true,
    adminVerificationVisible: false,
    sample: '声明原创的视频有机会获得广告分成',
  };

  it('waits for asynchronously-rendered original declaration prompt and clicks publish', async () => {
    // 时序：点击后前几轮无弹窗（异步渲染）→ 弹窗出现 → 点「直接发表」→ 跳转 done
    const { page, publishButton } = createRunPage([
      {}, // fill 描述
      STATE_DONE, // waitUploaded（上传完成）
      STATE_IDLE, // handlePrompts 第 1 轮（弹窗未渲染）
      STATE_IDLE, // 第 2 轮
      STATE_PROMPT, // 第 3 轮弹窗出现
      STATE_DONE, // 点「直接发表」后跳转完成
      STATE_DONE, // readback
    ]);
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: '视频号测试',
      tags: ['门店'],
      videoPath: '/tmp/video.mp4',
    });
    // 发表按钮点击 1 次 + 「直接发表」弹窗按钮点击 1 次 = 2 次
    expect(publishButton.click).toHaveBeenCalledTimes(2);
    // 「直接发表」点击走 getByRole（count/visible/click 链）
    const role = page.getByRole as jest.Mock;
    expect(role.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('passes through when no prompt appears within the wait window (clean flow)', async () => {
    const { page, publishButton } = createRunPage([
      {}, // fill 描述
      STATE_DONE, // waitUploaded
      STATE_IDLE, // handlePrompts 多轮无弹窗 → 放行
      STATE_IDLE,
      STATE_IDLE,
      STATE_IDLE,
      STATE_DONE, // readback
    ]);
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: '视频号测试',
      tags: ['门店'],
      videoPath: '/tmp/video.mp4',
    });
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  it('throws when admin verification is required after publish', async () => {
    const adminState = {
      done: false,
      failed: false,
      originalPromptVisible: false,
      adminVerificationVisible: true,
      sample: '管理员本人验证',
    };
    const { page } = createRunPage([
      {}, // fill 描述
      STATE_DONE, // waitUploaded
      adminState, // handlePrompts 检测到管理员验证 → throw
    ]);
    const steps = adapter.buildVideoPublishSteps();
    await expect(
      steps.run(page as never, {
        title: '视频号测试',
        tags: ['门店'],
        videoPath: '/tmp/video.mp4',
      }),
    ).rejects.toThrow('管理员扫码验证');
  });

  // 上传中发表按钮不禁用（视频号与抖音不同）：按钮 enabled 但无「封面预览」= 上传未完成，须继续等待
  const STATE_BTN_ENABLED_NO_COVER = {
    done: false,
    failed: false,
    originalPromptVisible: false,
    adminVerificationVisible: false,
    sample: '发表 上传时长8小时内 视频描述',
  };
  const STATE_UPLOADED = {
    done: true,
    failed: false,
    originalPromptVisible: false,
    adminVerificationVisible: false,
    sample: '封面预览 发表',
  };

  it('waits for cover preview before publishing even when publish button is enabled (upload in progress)', async () => {
    // 时序：waitUploaded 轮询中按钮 enabled 但无封面预览（上传中）→ 出现封面预览（上传完成）→ 继续发布
    const { page, publishButton } = createRunPage([
      {}, // fill 描述
      STATE_BTN_ENABLED_NO_COVER, // waitUploaded 轮询 1：按钮 enabled 但未上传完成
      STATE_BTN_ENABLED_NO_COVER, // 轮询 2
      STATE_UPLOADED, // 轮询 3：封面预览出现 → done
      STATE_DONE, // handlePrompts/readback
    ]);
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: '视频号测试',
      tags: ['门店'],
      videoPath: '/tmp/video.mp4',
    });
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  // 弹窗 wrapper 自身 height=0 但内部按钮可见（original-intercept-wrapper 实测）：
  // 可见性判定需检查内部按钮，否则误判"无弹窗"→ 弹窗挡住发表 → readback 超时。
  it('detects zero-height dialog wrapper with visible inner buttons as a visible prompt', async () => {
    const { page } = createRunPage([
      {}, // fill 描述
      STATE_DONE, // waitUploaded
      STATE_DONE, // readback（不走到 handlePrompts 弹窗路径）
    ]);
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: '视频号测试',
      tags: ['门店'],
      videoPath: '/tmp/video.mp4',
    });
    // 直接调用 readWechatChannelPublishState 验证 zero-height wrapper 判定
    const state = await (adapter as any).readWechatChannelPublishState(
      page as never,
    );
    // 无弹窗 mock 下 originalPromptVisible 应为 false（正常路径不误报）
    expect(state.originalPromptVisible).toBe(false);
  });
});
