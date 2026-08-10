import { DouyinPublishAdapter } from './douyin-publish.adapter';

describe('DouyinPublishAdapter', () => {
  const VALID_VIDEO = '/tmp/accept-valid-test.mp4';
  beforeAll(() => {
    const { writeFileSync } = require('node:fs');
    // 合法 mp4 头：ftyp box + 填充 >1KB（满足大小与魔数校验）
    const head = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.alloc(4096, 0x00),
    ]);
    writeFileSync(VALID_VIDEO, head);
  });

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
      videoPath: VALID_VIDEO,
    });
    expect(publishButton.click).toHaveBeenCalledWith({ timeout: 15000 });
    expect(page.waitForURL).toHaveBeenCalledWith(
      '**/creator-micro/content/manage**',
      { timeout: 120000 },
    );
    expect(currentUrl).toContain('content/manage');
    expect(calls).toEqual([]);
  });

  // ---------- 安全移植（social-auto-upload 坑位图，限次/幂等/回落） ----------

  const createVideoRunPage = (opts: {
    urlValue?: string;
    evalResults?: Array<
      | { started: boolean; done: boolean; failed: boolean; sample: string }
      | { reject?: boolean; [k: string]: unknown }
    >;
  }) => {
    const urlValue =
      opts.urlValue ??
      'https://creator.douyin.com/creator-micro/content/post/video';
    const evalResults = opts.evalResults ?? [
      { started: true, done: true, failed: false, sample: '' },
    ];
    let evalCount = 0;
    const inputMock = { setInputFiles: jest.fn().mockResolvedValue(undefined) };
    const publishButton = { click: jest.fn().mockResolvedValue(undefined) };
    const page = {
      url: () => urlValue,
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({
        first: () => ({
          fill: jest.fn().mockResolvedValue(undefined),
          waitFor: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined),
          setInputFiles: inputMock.setInputFiles,
        }),
      }),
      evaluate: jest.fn().mockImplementation(() => {
        const spec = evalResults[Math.min(evalCount, evalResults.length - 1)];
        evalCount += 1;
        if (spec && (spec as { reject?: boolean }).reject) {
          return Promise.reject(new Error('evaluate rejected'));
        }
        return Promise.resolve(spec);
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
    return { page, inputMock, publishButton };
  };

  const FAILED = { started: false, done: false, failed: true, sample: '上传失败' };
  const STARTED = { started: true, done: false, failed: false, sample: '' };
  const DONE = { started: true, done: true, failed: false, sample: '' };

  it('uploads retries once after a failed state and continues', async () => {
    const { page, inputMock, publishButton } = createVideoRunPage({
      evalResults: [FAILED, STARTED, DONE],
    });
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: 't',
      tags: ['a'],
      videoPath: VALID_VIDEO,
    });
    expect(inputMock.setInputFiles).toHaveBeenCalledTimes(2);
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  it('throws with retry count when upload keeps failing (no infinite loop)', async () => {
    const { page, inputMock } = createVideoRunPage({
      evalResults: [FAILED, FAILED],
    });
    const steps = adapter.buildVideoPublishSteps();
    await expect(
      steps.run(page as never, {
        title: 't',
        tags: ['a'],
        videoPath: VALID_VIDEO,
      }),
    ).rejects.toThrow('已重试 1 次');
    expect(inputMock.setInputFiles).toHaveBeenCalledTimes(2);
  });

  it('caps upload retry attempts at one by default', () => {
    expect(DouyinPublishAdapter.UPLOAD_RETRY_LIMIT).toBe(1);
  });

  it('detects version_1 publish page without navigation', async () => {
    const { page, publishButton } = createVideoRunPage({
      urlValue:
        'https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page',
      evalResults: [STARTED, DONE],
    });
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: 't',
      tags: ['a'],
      videoPath: VALID_VIDEO,
    });
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  it('detects version_2 publish page and proceeds', async () => {
    const { page, publishButton } = createVideoRunPage({
      urlValue:
        'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page',
      evalResults: [STARTED, DONE],
    });
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: 't',
      tags: ['a'],
      videoPath: VALID_VIDEO,
    });
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  it('falls back silently when publish page URL is not detected within probe window', async () => {
    const { page, publishButton } = createVideoRunPage({
      urlValue: 'https://creator.douyin.com/creator-micro/content/upload',
      evalResults: [STARTED, DONE],
    });
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: 't',
      tags: ['a'],
      videoPath: VALID_VIDEO,
    });
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  it('overlay cleanup failure is ignored and publish continues', async () => {
    const { page, publishButton } = createVideoRunPage({
      evalResults: [STARTED, DONE, { reject: true }],
    });
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: 't',
      tags: ['a'],
      videoPath: VALID_VIDEO,
    });
    expect(publishButton.click).toHaveBeenCalledTimes(1);
  });

  it('clears overlays before clicking publish (evaluate called with shepherd selectors)', async () => {
    const { page, publishButton } = createVideoRunPage({
      evalResults: [STARTED, DONE, { ok: 1 }],
    });
    const steps = adapter.buildVideoPublishSteps();
    await steps.run(page as never, {
      title: 't',
      tags: ['a'],
      videoPath: VALID_VIDEO,
    });
    expect(publishButton.click).toHaveBeenCalledTimes(1);
    const evaluate = page.evaluate as jest.Mock;
    const lastCallArg = evaluate.mock.calls[evaluate.mock.calls.length - 1]?.[0];
    expect(typeof lastCallArg).toBe('function');
    // 浮层清理在点击前执行：evaluate 总调用数 ≥3（upload 状态 ×2 + clear）
    expect(evaluate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects tiny placeholder video files before upload', async () => {
    const placeholder = '/tmp/accept-tiny-placeholder.mp4';
    const { writeFileSync } = require('node:fs');
    writeFileSync(placeholder, Buffer.alloc(300, 0));
    const steps = adapter.buildVideoPublishSteps();
    await expect(
      steps.run({} as never, {
        title: 't',
        tags: ['a'],
        videoPath: placeholder,
      }),
    ).rejects.toThrow('过小');
  });

  it('rejects non-mp4 files with wrong magic bytes before upload', async () => {
    const fake = '/tmp/accept-fake-magic.mp4';
    const { writeFileSync } = require('node:fs');
    const buf = Buffer.alloc(2048, 0x41); // 'A' * 2048，无 ftyp 魔数
    buf.write('NOTMP4', 0, 'ascii');
    writeFileSync(fake, buf);
    const steps = adapter.buildVideoPublishSteps();
    await expect(
      steps.run({} as never, {
        title: 't',
        tags: ['a'],
        videoPath: fake,
      }),
    ).rejects.toThrow('魔数');
  });
});
