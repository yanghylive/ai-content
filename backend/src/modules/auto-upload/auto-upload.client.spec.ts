import { AutoUploadClient } from './auto-upload.client';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

describe('AutoUploadClient', () => {
  it('deduplicates restored database rows before validating platform sessions', () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const rows = [
      {
        id: 'legacy-douyin-3',
        platform: 'douyin',
        config: { engineAccountId: 3 },
      },
      {
        id: 'current-douyin-3',
        platform: '抖音',
        config: { engineAccountId: 3 },
      },
      {
        id: 'current-douyin-4',
        platform: 'douyin',
        config: { engineAccountId: 4 },
      },
    ];

    expect((client as any).dedupePublishAccountRows(rows)).toEqual([
      rows[1],
      rows[2],
    ]);
  });

  it('prefers ready local-engine account rows over newer expired duplicates', () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const olderReady = {
      id: 'ready-wechat-channel-1',
      platform: 'wechat-channel',
      status: 'ready',
      config: {
        engineAccountId: 1,
        status: 'ready',
        sessionStatus: 'logged_in',
        lastDispatchOk: true,
      },
      updatedAt: new Date('2026-08-03T00:00:00.000Z'),
    };
    const newerExpired = {
      id: 'expired-wechat-channel-1',
      platform: '视频号',
      status: 'expired',
      config: {
        engineAccountId: 1,
        status: 'expired',
        sessionStatus: 'needs_login',
        lastDispatchOk: false,
      },
      updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    };

    expect(
      (client as any).dedupePublishAccountRows([olderReady, newerExpired]),
    ).toEqual([olderReady]);
  });

  it('keeps an account ready when browser validation has a logged-in signal even if durable row status is stale', () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(
      (client as any).mapPublishAccountToAutoUploadAccount({
        id: 'local-engine-1-wechat-channel',
        platform: 'wechat-channel',
        name: '1111',
        status: 'expired',
        config: {
          platformType: 2,
          engineAccountId: 1,
          filePath: 'wechat-channel.json',
          status: 'expired',
          statusLabel: '登录失效',
          sessionStatus: 'logged_in',
          lastDispatchOk: true,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        id: 1,
        platform: '视频号',
        status: 1,
        statusCode: 'ready',
        statusLabel: '已登录',
      }),
    );
  });

  it('deduplicates desktop runtime restore rows by platform account id', () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const olderExpired = {
      id: 'old-wechat-channel-1',
      platform: 'wechat-channel',
      name: '1111',
      status: 'expired',
      config: {
        source: 'local-engine',
        platformType: 2,
        filePath: 'wechat-channel-old.json',
        engineAccountId: 1,
        status: 'expired',
        sessionStatus: 'needs_login',
        lastDispatchOk: false,
      },
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const newerReady = {
      id: 'ready-wechat-channel-1',
      platform: '视频号',
      name: '1111',
      status: 'ready',
      config: {
        source: 'local-engine',
        platformType: 2,
        filePath: 'wechat-channel-ready.json',
        engineAccountId: 1,
        status: 'ready',
        sessionStatus: 'logged_in',
        lastDispatchOk: true,
      },
      updatedAt: new Date('2026-08-03T00:00:00.000Z'),
    };

    expect(
      (client as any).dedupeDesktopRuntimePublishAccountRows([
        olderExpired,
        newerReady,
      ]),
    ).toEqual([newerReady]);
  });

  it('selects the real login QR image instead of login backgrounds or scan icons', () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(
      (client as any).pickLoginQrImageSrc(
        [
          {
            src: 'data:image/svg+xml;base64,background',
            cls: 'login-card-double-bg',
            width: 800,
            height: 629,
            naturalWidth: 800,
            naturalHeight: 629,
            visible: true,
          },
          {
            src: 'data:image/png;base64,douyin-qr',
            cls: 'qrcode_img-NPVTJs',
            width: 248,
            height: 248,
            naturalWidth: 512,
            naturalHeight: 512,
            visible: true,
          },
        ],
        3,
      ),
    ).toBe('data:image/png;base64,douyin-qr');

    expect(
      (client as any).pickLoginQrImageSrc(
        [
          {
            src: 'data:image/png;base64,xhs-scan-switch',
            cls: 'css-wemwzq',
            width: 64,
            height: 64,
            naturalWidth: 128,
            naturalHeight: 128,
            visible: true,
          },
          {
            src: 'data:image/png;base64,xhs-real-qr',
            cls: 'css-1lhmg90',
            width: 160,
            height: 160,
            naturalWidth: 196,
            naturalHeight: 196,
            visible: true,
          },
        ],
        1,
      ),
    ).toBe('data:image/png;base64,xhs-real-qr');
  });

  it('requires a real Xiaohongshu creator backend page before marking login ready', async () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(
      (client as any).isPlatformPageUrl(
        'xiaohongshu',
        'https://www.example.com/new/note-manager',
      ),
    ).toBe(false);
    expect(
      (client as any).isPlatformPageUrl(
        'xiaohongshu',
        'https://creator.xiaohongshu.com/login',
      ),
    ).toBe(false);
    expect(
      (client as any).isPlatformPageUrl(
        'xiaohongshu',
        'https://creator.xiaohongshu.com/new/skill-hub',
      ),
    ).toBe(true);

    const page = (url: string, text: string) => ({
      url: jest.fn().mockReturnValue(url),
      locator: jest.fn().mockReturnValue({
        innerText: jest.fn().mockResolvedValue(text),
      }),
    });

    await expect(
      (client as any).pageLooksLoggedIn(
        1,
        page(
          'https://creator.xiaohongshu.com/new/skill-hub',
          '小红书创作服务平台 技能中心 笔记管理',
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      (client as any).pageLooksLoggedIn(
        1,
        page('https://creator.xiaohongshu.com/new/skill-hub', '扫码登录'),
      ),
    ).resolves.toBe(false);
    await expect(
      (client as any).pageLooksLoggedIn(
        1,
        page('https://www.xiaohongshu.com/explore/1', '小红书'),
      ),
    ).resolves.toBe(false);
  });

  it('treats a WeChat Channel backend page as logged in even when the visible text is sparse', async () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (client as any).pageLooksLoggedIn(2, {
        url: jest
          .fn()
          .mockReturnValue(
            'https://channels.weixin.qq.com/platform/interaction/comment',
          ),
        locator: jest.fn().mockReturnValue({
          innerText: jest.fn().mockResolvedValue(''),
        }),
      }),
    ).resolves.toBe(true);
  });

  it('extracts WeChat Channel login QR from iframe content', async () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const mainFrame = {
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/login.html'),
      evaluate: jest.fn().mockResolvedValue([
        {
          src: 'https://res.wx.qq.com/logo.png',
          cls: 'logo',
          width: 143,
          height: 64,
          naturalWidth: 143,
          naturalHeight: 64,
          visible: true,
        },
      ]),
    };
    const iframe = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://channels.weixin.qq.com/platform/login-for-iframe?dark_mode=true&host_type=1',
        ),
      evaluate: jest.fn().mockResolvedValue([
        {
          src: 'data:image/png;base64,wechat-channel-qr',
          cls: 'qrcode',
          width: 208,
          height: 208,
          naturalWidth: 1000,
          naturalHeight: 1000,
          visible: true,
        },
      ]),
    };
    const page = {
      frames: jest.fn().mockReturnValue([mainFrame, iframe]),
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/login.html'),
    };

    await expect((client as any).findQrImageSrc(page, 2)).resolves.toBe(
      'data:image/png;base64,wechat-channel-qr',
    );
  });

  it('starts account binding with the requested profile instead of reusing another logged-in profile', async () => {
    const localBrowser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-7',
        page: {},
        context: {},
        profileDir: '/tmp/douyin-7',
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined as any,
      localBrowser as any,
    );
    jest.spyOn(client as any, 'prepareLoginPage').mockResolvedValue(undefined);
    jest
      .spyOn(client as any, 'extractLoginQrData')
      .mockResolvedValue('data:image/png;base64,douyin-login-qr');

    const stream = client.streamAccountLogin({
      type: 3,
      profileName: '抖音重登',
      requestId: 'req-douyin-login',
      update: true,
      recordId: 7,
    });
    const first = await stream.next();
    await stream.return?.(undefined as never);

    expect(first.value).toBe('data:image/png;base64,douyin-login-qr');
    expect(localBrowser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: 7,
      reuseLoggedInSession: false,
    });
  });

  it('keeps WeChat Channel binding alive for visible web login when no QR image is extractable', async () => {
    const page = {};
    const context = {};
    const localBrowser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'wechat-channel-4',
        page,
        context,
        profileDir: '/tmp/wechat-channel-4',
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined as any,
      localBrowser as any,
    );
    jest.spyOn(client as any, 'prepareLoginPage').mockResolvedValue(undefined);
    jest.spyOn(client as any, 'pageLooksLoggedIn').mockResolvedValue(false);
    const extractQr = jest
      .spyOn(client as any, 'extractLoginQrData')
      .mockResolvedValue(null);
    jest
      .spyOn(client as any, 'waitForLoginSuccess')
      .mockResolvedValue('logged_in');
    jest.spyOn(client as any, 'saveVerifiedLoginSession').mockResolvedValue({
      ok: true,
      savedId: 'local-engine-4-wechat-channel',
    });

    const messages: string[] = [];
    for await (const message of client.streamAccountLogin({
      type: 2,
      profileName: '视频号',
      requestId: 'req-wechat-channel-web-login',
      update: true,
      recordId: 4,
    })) {
      messages.push(message);
    }

    expect(extractQr).toHaveBeenCalledWith(page, 2, 5000);
    expect(messages).toEqual([
      'LOGIN_URL:https://channels.weixin.qq.com',
      'ACCOUNT_ID:4',
      '200',
    ]);
  });

  it('keeps the missing-QR failure behavior for non-WeChat platforms', async () => {
    const localBrowser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-4',
        page: {},
        context: {},
        profileDir: '/tmp/douyin-4',
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined as any,
      localBrowser as any,
    );
    jest.spyOn(client as any, 'prepareLoginPage').mockResolvedValue(undefined);
    jest.spyOn(client as any, 'pageLooksLoggedIn').mockResolvedValue(false);
    jest.spyOn(client as any, 'extractLoginQrData').mockResolvedValue(null);

    const messages: string[] = [];
    for await (const message of client.streamAccountLogin({
      type: 3,
      profileName: '抖音',
      requestId: 'req-douyin-no-qr',
      update: true,
      recordId: 4,
    })) {
      messages.push(message);
    }

    expect(messages).toEqual([
      'ERROR: 登录页面加载超时，未获取到二维码。请关闭弹窗后重试，或检查平台登录页是否改版、浏览器是否被拦截。',
      '500',
    ]);
  });

  it('saves WeChat Channel directly when the opened profile is already logged in', async () => {
    const page = {
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/post/create'),
      locator: jest.fn().mockReturnValue({
        innerText: jest
          .fn()
          .mockResolvedValue('视频号助手 发表记录 评论管理 私信管理 数据概览'),
      }),
    };
    const context = {};
    const localBrowser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'wechat-channel-4',
        page,
        context,
        profileDir: '/tmp/wechat-channel-4',
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined as any,
      localBrowser as any,
    );
    jest.spyOn(client as any, 'prepareLoginPage').mockResolvedValue(undefined);
    const extractQr = jest
      .spyOn(client as any, 'extractLoginQrData')
      .mockResolvedValue('data:image/png;base64,wechat-login-qr');
    jest.spyOn(client as any, 'saveVerifiedLoginSession').mockResolvedValue({
      ok: true,
      savedId: 'local-engine-4-wechat-channel',
    });

    const stream = client.streamAccountLogin({
      type: 2,
      profileName: '视频号',
      requestId: 'req-wechat-channel-login',
      update: true,
      recordId: 4,
    });
    const messages: string[] = [];
    for await (const message of stream) {
      messages.push(message);
      if (message === '200') break;
    }

    expect(messages).toEqual(['ACCOUNT_ID:4', '200']);
    expect((client as any).prepareLoginPage).not.toHaveBeenCalled();
    expect(extractQr).not.toHaveBeenCalled();
    expect((client as any).saveVerifiedLoginSession).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'wechat-channel',
        platformType: 2,
        engineAccountId: 4,
        profileName: '视频号',
        context,
        page,
        profileDir: '/tmp/wechat-channel-4',
      }),
    );
  });

  it('does not save WeChat Channel when persisted login validation fails', async () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const saveFilteredStorageState = jest
      .spyOn(client as any, 'saveFilteredStorageState')
      .mockResolvedValue(undefined);
    const validateCookieFile = jest
      .spyOn(client as any, 'validateCookieFile')
      .mockResolvedValue(false);
    const saveLoginPublishAccount = jest
      .spyOn(client as any, 'saveLoginPublishAccount')
      .mockResolvedValue('local-engine-4-wechat-channel');
    jest
      .spyOn(client as any, 'getAccountCookiePath')
      .mockReturnValue('/tmp/wechat-channel-state.json');

    const result = await (client as any).saveVerifiedLoginSession({
      platform: 'wechat-channel',
      platformType: 2,
      engineAccountId: 4,
      profileName: '视频号',
      context: {},
      page: {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
      },
      profileDir: '/tmp/wechat-channel-4',
    });

    expect(result).toEqual({
      ok: false,
      message:
        '视频号登录态保存后校验未通过。请确认浏览器已进入视频号助手后台，不要停在二维码、登录页或营销介绍页，然后重新绑定。',
    });
    expect(saveFilteredStorageState).toHaveBeenCalled();
    expect(validateCookieFile).toHaveBeenCalledWith(
      2,
      '/tmp/wechat-channel-state.json',
    );
    expect(saveLoginPublishAccount).not.toHaveBeenCalled();
  });

  it('retries a transient login-page navigation failure before extracting the QR', async () => {
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const click = jest.fn().mockResolvedValue(undefined);
    const page = {
      goto: jest
        .fn()
        .mockRejectedValueOnce(
          new Error('page.goto: net::ERR_CONNECTION_CLOSED'),
        )
        .mockResolvedValueOnce(undefined),
      url: jest.fn().mockReturnValue('about:blank'),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({ click }),
    };

    await (client as any).prepareLoginPage(page, 1);

    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.goto).toHaveBeenLastCalledWith(
      'https://creator.xiaohongshu.com/login',
      { waitUntil: 'domcontentloaded', timeout: 45000 },
    );
    expect(click).toHaveBeenCalled();
  });

  it('detects the real desktop WeChat process instead of returning the old not-integrated placeholder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-wechat-desktop-'));
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ]) {
      writeFileSync(join(scriptRoot, command), '#!/bin/sh\n', 'utf8');
    }
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_WECHAT_COMMAND_ROOT' ? scriptRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(client as any, 'runAppleScript')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        if (script.includes('exists process "WeChat"')) {
          return 'false';
        }
        if (script.includes('exists process "微信"')) {
          return 'true';
        }
        if (script.includes('get frontmost')) {
          return 'true';
        }
        if (script.includes('titleList as text')) {
          return '九章智能｜客户沟通群(5)';
        }
        throw new Error(`unexpected AppleScript ${script}`);
      });

    const status = await client.getWechatDesktopStatus();
    const alive = await client.checkWechatAlive();
    const windows = await client.listWechatWindows();

    expect(status).toEqual(
      expect.objectContaining({
        available: true,
        running: true,
        appName: '微信',
        currentWindowTitle: '九章智能｜客户沟通群(5)',
        frontmost: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
      }),
    );
    expect(status.message).not.toContain('未接入');
    expect(status.safetyBoundary?.sendsMessages).toBe(true);
    expect(alive.alive).toBe(true);
    expect(windows.windows).toEqual([
      {
        id: 'wechat-window-1',
        title: '九章智能｜客户沟通群(5)',
        isMain: true,
      },
    ]);
  });

  it('falls back to WeChat window title when accessibility name is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-wechat-title-'));
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ]) {
      writeFileSync(join(scriptRoot, command), '#!/bin/sh\n', 'utf8');
    }
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_WECHAT_COMMAND_ROOT' ? scriptRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(client as any, 'runAppleScript')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        if (script.includes('exists process "WeChat"')) {
          return 'true';
        }
        if (script.includes('get frontmost')) {
          return 'false';
        }
        if (
          script.includes('candidateTitle to title of appWindow as text') &&
          script.includes('candidateTitle to description of appWindow as text')
        ) {
          return '微信';
        }
        throw new Error(`unexpected AppleScript ${script}`);
      });

    const status = await client.getWechatDesktopStatus();

    expect(status).toEqual(
      expect.objectContaining({
        available: true,
        running: true,
        appName: 'WeChat',
        currentWindowTitle: '微信',
        windowCount: 1,
        windowTitles: ['微信'],
      }),
    );
    expect(status.permissionHints).not.toContain(
      '已检测到微信进程，但未读取到窗口标题；执行前需要人工确认当前目标窗口。',
    );
  });

  it('aligns a WeChat contact by opening the desktop search result without sending messages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-wechat-align-'));
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ]) {
      writeFileSync(join(scriptRoot, command), '#!/bin/sh\n', 'utf8');
    }
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_WECHAT_COMMAND_ROOT' ? scriptRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(client as any, 'runAppleScript')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        if (script.includes('exists process "WeChat"')) return 'true';
        if (script.includes('get frontmost')) return 'true';
        if (script.includes('titleList as text')) return '微信客户A';
        throw new Error(`unexpected AppleScript ${script}`);
      });
    jest
      .spyOn(client as any, 'runAppleScriptWithArgs')
      .mockResolvedValue(
        [
          'aligned',
          '/tmp/ai-content-wechat-align-test.png',
          '微信客户A',
          '',
          '微信客户A 最近聊天',
        ].join('\n--KAYPAL-WECHAT-ALIGN-FIELD--\n'),
      );

    const result = await client.alignWechatContact('微信客户A');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        stage: 'aligned',
        targetText: '微信客户A',
        matchedTitle: '微信客户A',
        ambiguous: false,
        screenshotPath: '/tmp/ai-content-wechat-align-test.png',
      }),
    );
    expect(result.evidence).toEqual(
      expect.objectContaining({
        type: 'screenshot',
        label: '微信目标对齐截图',
        value: '/tmp/ai-content-wechat-align-test.png',
      }),
    );
  });

  it('captures the WeChat window region for alignment evidence instead of full screen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-wechat-align-crop-'));
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ]) {
      writeFileSync(join(scriptRoot, command), '#!/bin/sh\n', 'utf8');
    }
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_WECHAT_COMMAND_ROOT' ? scriptRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(client as any, 'runAppleScript')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        if (script.includes('exists process "WeChat"')) return 'true';
        if (script.includes('get frontmost')) return 'true';
        if (script.includes('titleList as text')) return '微信客户A';
        throw new Error(`unexpected AppleScript ${script}`);
      });
    jest
      .spyOn(client as any, 'runAppleScriptWithArgs')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        expect(script).toContain('captureWechatWindowScreenshot');
        expect(script).toContain('screencapture -x -R');
        expect(script).not.toContain(
          'do shell script "screencapture -x " & quoted form of screenshotPath',
        );
        return [
          'aligned',
          '/tmp/ai-content-wechat-align-cropped.png',
          '微信客户A',
          '',
          '微信客户A 最近聊天',
        ].join('\n--KAYPAL-WECHAT-ALIGN-FIELD--\n');
      });

    const result = await client.alignWechatContact('微信客户A');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        stage: 'aligned',
        screenshotPath: '/tmp/ai-content-wechat-align-cropped.png',
      }),
    );
  });

  it('does not lock a WeChat target when automation lands on search result content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-wechat-search-'));
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ]) {
      writeFileSync(join(scriptRoot, command), '#!/bin/sh\n', 'utf8');
    }
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_WECHAT_COMMAND_ROOT' ? scriptRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(client as any, 'runAppleScript')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        if (script.includes('exists process "WeChat"')) return 'true';
        if (script.includes('get frontmost')) return 'true';
        if (script.includes('titleList as text')) return '微信';
        throw new Error(`unexpected AppleScript ${script}`);
      });
    jest
      .spyOn(client as any, 'runAppleScriptWithArgs')
      .mockResolvedValue(
        [
          'search_page',
          '/tmp/ai-content-wechat-align-search.png',
          '微信',
          '',
          'AI搜索 搜索网络结果 微信客户A AI for 教师教学',
        ].join('\n--KAYPAL-WECHAT-ALIGN-FIELD--\n'),
      );

    const result = await client.alignWechatContact('微信客户A');

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        stage: 'search_page',
        targetText: '微信客户A',
        matchedTitle: null,
        ambiguous: true,
      }),
    );
    expect(result.matches).toEqual([]);
  });

  it('locks a WeChat target when local OCR confirms the opened conversation title', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-wechat-ocr-align-'));
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ]) {
      writeFileSync(join(scriptRoot, command), '#!/bin/sh\n', 'utf8');
    }
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_WECHAT_COMMAND_ROOT' ? scriptRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(client as any, 'runAppleScript')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        if (script.includes('exists process "WeChat"')) return 'true';
        if (script.includes('get frontmost')) return 'true';
        if (script.includes('titleList as text')) return '微信';
        throw new Error(`unexpected AppleScript ${script}`);
      });
    jest
      .spyOn(client as any, 'runAppleScriptWithArgs')
      .mockResolvedValue(
        [
          'ambiguous',
          '/tmp/ai-content-wechat-align-ocr.png',
          '微信',
          '',
          '关闭按钮 全屏幕按钮 组 最小化按钮',
        ].join('\n--KAYPAL-WECHAT-ALIGN-FIELD--\n'),
      );
    jest
      .spyOn(client as any, 'readLocalImageText')
      .mockResolvedValue('九章智能 | 客户沟通群（5） 07:40 20:31');

    const result = await client.alignWechatContact('九章智能｜客户沟通群(5)');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        stage: 'aligned',
        targetText: '九章智能｜客户沟通群(5)',
        searchedText: '客户沟通群',
        matchedTitle: '九章智能｜客户沟通群(5)',
        ambiguous: false,
      }),
    );
    expect(result.pageTextSample).toContain('OCR:');
  });

  it('does not lock a WeChat target when automation only finds a candidate row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-wechat-candidate-'));
    const scriptRoot = join(root, 'scripts');
    mkdirSync(scriptRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ]) {
      writeFileSync(join(scriptRoot, command), '#!/bin/sh\n', 'utf8');
    }
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_WECHAT_COMMAND_ROOT' ? scriptRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(client as any, 'runAppleScript')
      .mockImplementation(async (lines: string[]) => {
        const script = lines.join('\n');
        if (script.includes('exists process "WeChat"')) return 'true';
        if (script.includes('get frontmost')) return 'true';
        if (script.includes('titleList as text')) return '微信';
        throw new Error(`unexpected AppleScript ${script}`);
      });
    jest
      .spyOn(client as any, 'runAppleScriptWithArgs')
      .mockResolvedValue(
        [
          'candidate_found',
          '/tmp/ai-content-wechat-align-candidate.png',
          '微信',
          '',
          '群聊 九章智能｜客户沟通群 聊天记录 客户沟通群',
        ].join('\n--KAYPAL-WECHAT-ALIGN-FIELD--\n'),
      );
    jest
      .spyOn(client as any, 'readLocalImageText')
      .mockResolvedValue(
        '最常使用 九章智能 | 客户沟通群 聊天记录 搜索网络结果 客户沟通群',
      );

    const result = await client.alignWechatContact('九章智能｜客户沟通群(5)');

    expect((client as any).runAppleScriptWithArgs).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining(['客户沟通群']),
      30000,
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        stage: 'candidate_found',
        targetText: '九章智能｜客户沟通群(5)',
        searchedText: '客户沟通群',
        matchedTitle: null,
        ambiguous: true,
      }),
    );
    expect(result.matches).toEqual([]);
  });

  it('reports needs_login when the latest real interaction task failed on a platform login page', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_COMMENT_REPLY',
            status: 'FAILED',
            config: {
              failureReason:
                '视频号账号未登录，当前页面 https://channels.weixin.qq.com/login.html',
              nextAction: '请重新登录视频号账号。',
            },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const mcp = {
      getStatus: jest.fn().mockReturnValue({
        online: true,
        visibleWindow: true,
        isolated: false,
        profileKey: null,
      }),
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([]),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
    );
    jest
      .spyOn(client as any, 'inspectProfileCdpLoginState')
      .mockResolvedValue(null);

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'needs_login',
        lastError: '平台页面要求重新登录（最近一次真实读取失败）',
      }),
    );
  });

  it('lets a current platform page override a stale login failure after relogin', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
            status: 'FAILED',
            config: { failureReason: '账号未登录，请重新登录。' },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const mcp = {
      getStatus: jest.fn().mockReturnValue({
        online: true,
        visibleWindow: true,
        isolated: false,
        profileKey: 'wechat-channel-4',
      }),
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([
        {
          platform: 'wechat-channel',
          accountId: 4,
          status: 'ready',
          currentUrl: 'https://channels.weixin.qq.com/platform',
          lastActivityAt: new Date(Date.now() + 1000).toISOString(),
        },
      ]),
    };
    const localBrowser = {
      getSession: jest.fn().mockReturnValue({
        page: {
          evaluate: jest.fn().mockResolvedValue({
            url: 'https://channels.weixin.qq.com/platform/private_msg',
            text: '视频号助手 私信管理 全部私信 全部消息',
          }),
        },
      }),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
      {} as any,
      localBrowser as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'ready',
        currentUrl: 'https://channels.weixin.qq.com/platform',
      }),
    );
  });

  it('lets a current interaction backend page override a stale login failure', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
            status: 'FAILED',
            config: { failureReason: '账号未登录，请重新登录。' },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const mcp = {
      getStatus: jest.fn().mockReturnValue({
        online: true,
        visibleWindow: true,
        isolated: false,
        profileKey: 'wechat-channel-4',
      }),
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([
        {
          platform: 'wechat-channel',
          accountId: 4,
          status: 'ready',
          currentUrl:
            'https://channels.weixin.qq.com/platform/interaction/comment',
          debuggingPort: 9253,
          runtimeMode: 'persistent-cdp-browser',
          browserReused: true,
          lastActivityAt: new Date(Date.now() + 1000).toISOString(),
        },
      ]),
    };
    const localBrowser = {
      getSession: jest.fn().mockReturnValue({
        page: {
          evaluate: jest.fn().mockResolvedValue({
            url: 'https://channels.weixin.qq.com/platform/interaction/comment',
            text: '视频号助手 评论管理 全部评论 待回复',
          }),
        },
      }),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
      {} as any,
      localBrowser as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'ready',
        currentUrl:
          'https://channels.weixin.qq.com/platform/interaction/comment',
        debuggingPort: 9253,
        runtimeMode: 'persistent-cdp-browser',
        browserReused: true,
      }),
    );
  });

  it('reuses an already-open profile CDP page after backend restart', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_COMMENT_REPLY',
            status: 'FAILED',
            config: { failureReason: '账号未登录，请重新登录。' },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([]),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      interactionExecutor as any,
      { execute: jest.fn() } as any,
    );
    jest.spyOn(client as any, 'inspectProfileCdpLoginState').mockResolvedValue({
      loginState: 'logged_in',
      currentUrl: 'https://channels.weixin.qq.com/platform/interaction/comment',
      debuggingPort: 9255,
      browser: 'local-browser-engine',
      runtimeMode: 'persistent-cdp-browser',
      browserReused: true,
      lastActivityAt: new Date(Date.now() + 1000).toISOString(),
    });

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'ready',
        currentUrl:
          'https://channels.weixin.qq.com/platform/interaction/comment',
        debuggingPort: 9255,
        runtimeMode: 'persistent-cdp-browser',
        browserReused: true,
        lastError: undefined,
      }),
    );
  });

  it('does not treat a send readback suggestion as a login blocker', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_COMMENT_REPLY',
            status: 'FAILED',
            config: {
              failureReason:
                '视频号评论自动发送失败：已点击发送，但输入框仍保留内容且页面未看到回复，未确认发出。',
              nextAction:
                'isSend=true nextAction=检查视频号评论页面是否加载完成、目标对象是否仍可见、账号是否要求重新登录。',
            },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([
        {
          platform: 'wechat-channel',
          accountId: 4,
          currentUrl:
            'https://channels.weixin.qq.com/platform/interaction/comment',
          debuggingPort: 9255,
          runtimeMode: 'persistent-cdp-browser',
          lastActivityAt: new Date(Date.now() - 10_000).toISOString(),
        },
      ]),
    };
    const localBrowser = {
      getSession: jest.fn().mockReturnValue({
        page: {
          evaluate: jest.fn().mockResolvedValue({
            url: 'https://channels.weixin.qq.com/platform/interaction/comment',
            text: '视频号助手 评论管理 全部评论 待回复',
          }),
        },
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      interactionExecutor as any,
      { execute: jest.fn() } as any,
      {} as any,
      localBrowser as any,
    );
    jest
      .spyOn(client as any, 'inspectProfileCdpLoginState')
      .mockResolvedValue(null);

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'ready',
        lastError: undefined,
      }),
    );
  });

  it('keeps a current login failure visible when the session URL still looks like an interaction page', async () => {
    const loginFailureAt = new Date(Date.now() - 60_000);
    const staleSessionAt = new Date(
      loginFailureAt.getTime() - 20_000,
    ).toISOString();
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            platform: 'douyin',
            name: '抖音账号',
            config: { engineAccountId: 1, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '1',
            taskType: 'DOUYIN_COMMENT_REPLY',
            status: 'FAILED',
            config: {
              failureReason: '抖音账号未登录：抖音账号未登录，不能读取或回复。',
              events: [
                {
                  message:
                    '扫码登录如何扫码打开「抖音APP」点击左上角进行扫一扫',
                },
              ],
            },
            updatedAt: loginFailureAt,
          },
        ]),
      },
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([
        {
          platform: 'douyin',
          accountId: 1,
          currentUrl:
            'https://creator.douyin.com/creator-micro/interactive/comment',
          lastActivityAt: staleSessionAt,
        },
      ]),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      interactionExecutor as any,
      { execute: jest.fn() } as any,
    );
    jest
      .spyOn(client as any, 'inspectProfileCdpLoginState')
      .mockResolvedValue(null);

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'douyin',
        accountId: 1,
        status: 'needs_login',
        currentUrl:
          'https://creator.douyin.com/creator-micro/interactive/comment',
        lastError: '平台页面要求重新登录（最近一次真实读取失败）',
      }),
    );
  });

  it('does not mark a Douyin creator login page as ready just because the URL is on creator.douyin.com', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            platform: 'douyin',
            name: '抖音账号',
            config: { engineAccountId: 1, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([
        {
          platform: 'douyin',
          accountId: 1,
          currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
          lastActivityAt: new Date().toISOString(),
        },
      ]),
    };
    const localBrowser = {
      getSession: jest.fn().mockReturnValue({
        page: {
          evaluate: jest.fn().mockResolvedValue({
            url: 'https://creator.douyin.com/creator-micro/content/manage',
            text: '抖音创作者中心 扫码登录 验证码登录 密码登录 打开「抖音APP」扫一扫 登录/注册',
          }),
        },
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      interactionExecutor as any,
      { execute: jest.fn() } as any,
      {} as any,
      localBrowser as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'douyin',
        accountId: 1,
        status: 'needs_login',
        currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        lastError: '平台页面要求重新登录',
      }),
    );
  });

  it('keeps persisted profile cookies unverified until a platform page proves login', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-auto-upload-'));
    const profileDir = join(root, 'profiles', 'douyin-1');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.douyin.com' }],
        origins: [],
      }),
    );
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'local-engine-1',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              status: 'expired',
              filePath: 'missing.json',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockReturnValue([]),
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'LOCAL_BROWSER_PROFILE_ROOT'
            ? join(root, 'profiles')
            : undefined,
        ),
      } as any,
      prisma as any,
      {} as any,
      interactionExecutor as any,
      { execute: jest.fn() } as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'douyin',
        accountId: 1,
        status: 'unknown',
        profileDir,
        activeProfile: true,
        lastError: undefined,
      }),
    );
  });

  it('keeps account validation fast when a persistent browser profile is already present', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'kaypal-auto-upload-account-fast-'),
    );
    const profileDir = join(root, 'profiles', 'douyin-1');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.douyin.com' }],
        origins: [],
      }),
    );
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              platformType: 3,
              filePath: 'missing.json',
              status: 'expired',
              statusLabel: '登录失效',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'LOCAL_BROWSER_PROFILE_ROOT'
            ? join(root, 'profiles')
            : undefined,
        ),
      } as any,
      prisma as any,
      {} as any,
      {} as any,
      { execute: jest.fn() } as any,
    );
    const validateCookieFile = jest
      .spyOn(client as any, 'validateCookieFile')
      .mockRejectedValue(new Error('should not validate persistent profile'));

    const accounts = await client.listAccounts({ validate: true, force: true });

    expect(validateCookieFile).not.toHaveBeenCalled();
    expect(prisma.publishAccount.update).not.toHaveBeenCalled(); // validate 只读检测不写库
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 1,
        platform: '抖音',
        statusLabel: '已登录',
      }),
    );
  });

  it('restores desktop runtime publish accounts when the active app database is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-runtime-accounts-'));
    const runtimeDb = join(root, 'runtime.sqlite');
    const createdAt = Date.now() - 60_000;
    const updatedAt = Date.now();
    const config = {
      source: 'local-engine',
      status: 'ready',
      statusLabel: '已登录',
      filePath: 'douyin-state.json',
      userName: '抖音创作者中心',
      profileName: '测试抖音',
      platformType: 3,
      engineAccountId: 9,
      sessionStatus: 'logged_in',
      lastDispatchOk: true,
      lastDispatchReason: 'browser_session_ready',
    };
    execFileSync('sqlite3', [
      runtimeDb,
      [
        'create table publish_accounts (id text primary key, platform text not null, name text not null, app_id text, api_token text, config jsonb, created_at datetime not null, updated_at datetime not null);',
        `insert into publish_accounts (id, platform, name, config, created_at, updated_at) values ('local-engine-9-douyin', 'douyin', '测试抖音', '${JSON.stringify(config).replace(/'/g, "''")}', ${createdAt}, ${updatedAt});`,
      ].join(' '),
    ]);
    const prisma = {
      publishAccount: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValueOnce([
          {
            id: 'local-engine-9-douyin',
            platform: 'douyin',
            name: '测试抖音',
            config,
            createdAt: new Date(createdAt),
            updatedAt: new Date(updatedAt),
          },
        ]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'KAYPAL_DESKTOP_RUNTIME_DATABASE' ? runtimeDb : undefined,
        ),
      } as any,
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const accounts = await client.listAccounts();

    expect(prisma.publishAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'local-engine-9-douyin' },
        create: expect.objectContaining({
          id: 'local-engine-9-douyin',
          platform: 'douyin',
          name: '测试抖音',
          config,
        }),
      }),
    );
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 9,
        platform: '抖音',
        status: 1,
        statusLabel: '已登录',
      }),
    );
  });

  it('restores desktop runtime publish accounts from the default user data directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-runtime-user-data-'));
    const runtimeDb = join(root, 'kaypal-ai.sqlite');
    const createdAt = Date.now() - 60_000;
    const updatedAt = Date.now();
    const config = {
      source: 'local-engine',
      status: 'ready',
      statusLabel: '已登录',
      filePath: 'wechat-channel-state.json',
      userName: '视频号助手',
      profileName: '1111',
      platformType: 2,
      engineAccountId: 1,
      sessionStatus: 'logged_in',
      lastDispatchOk: true,
      lastDispatchReason: 'browser_session_ready',
    };
    execFileSync('sqlite3', [
      runtimeDb,
      [
        'create table publish_accounts (id text primary key, platform text not null, name text not null, app_id text, api_token text, config jsonb, created_at datetime not null, updated_at datetime not null);',
        `insert into publish_accounts (id, platform, name, config, created_at, updated_at) values ('local-engine-1-wechat-channel', 'wechat-channel', '1111', '${JSON.stringify(config).replace(/'/g, "''")}', ${createdAt}, ${updatedAt});`,
      ].join(' '),
    ]);
    const previousUserDataDir = process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    process.env.KAYPAL_DESKTOP_USER_DATA_DIR = root;
    const prisma = {
      publishAccount: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValueOnce([
          {
            id: 'local-engine-1-wechat-channel',
            platform: 'wechat-channel',
            name: '1111',
            config,
            createdAt: new Date(createdAt),
            updatedAt: new Date(updatedAt),
          },
        ]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    try {
      const accounts = await client.listAccounts();

      expect(prisma.publishAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'local-engine-1-wechat-channel' },
          create: expect.objectContaining({
            id: 'local-engine-1-wechat-channel',
            platform: 'wechat-channel',
            name: '1111',
            config,
          }),
        }),
      );
      expect(accounts[0]).toEqual(
        expect.objectContaining({
          id: 1,
          platform: '视频号',
          status: 1,
          statusLabel: '已登录',
        }),
      );
    } finally {
      if (previousUserDataDir === undefined) {
        delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
      } else {
        process.env.KAYPAL_DESKTOP_USER_DATA_DIR = previousUserDataDir;
      }
    }
  });

  it('prefers current CDP login-page state over stale persistent profile validation', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'kaypal-auto-upload-account-current-cdp-'),
    );
    const profileDir = join(root, 'profiles', 'wechat-channel-4');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [
          { name: 'session', value: 'abc', domain: '.channels.weixin.qq.com' },
        ],
        origins: [],
      }),
    );
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-wechat-channel',
            platform: 'wechat-channel',
            name: '视频号账号',
            config: {
              engineAccountId: 4,
              platformType: 2,
              filePath: 'wechat-channel.json',
              status: 'ready',
              statusLabel: '已登录',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT')
            return join(root, 'profiles');
          if (key === 'AUTO_UPLOAD_COOKIES_DIR')
            return join(root, 'cookiesFile');
          return undefined;
        }),
      } as any,
      prisma as any,
      {} as any,
      {
        getStatus: jest.fn().mockResolvedValue({
          online: true,
          visibleWindow: true,
          isolated: false,
          message: 'ok',
        }),
        listSessions: jest.fn().mockReturnValue([
          {
            platform: 'wechat-channel',
            accountId: 4,
            status: 'needs_login',
            currentUrl: 'https://channels.weixin.qq.com/login.html',
          },
        ]),
      } as any,
      { execute: jest.fn() } as any,
    );

    const accounts = await client.listAccounts({ validate: true, force: true });

    expect(prisma.publishAccount.update).not.toHaveBeenCalled(); // validate 只读检测不写库
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '视频号',
        status: 0,
        statusLabel: '需要重新登录',
      }),
    );
  });

  it('does not expose an account as logged in when current browser validation needs login', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'local-engine-4-douyin',
            platform: 'douyin',
            name: '抖音本机测试账号',
            config: {
              engineAccountId: 4,
              platformType: 3,
              filePath: 'douyin.json',
              status: 'ready',
              statusLabel: '已登录',
              sessionStatus: 'needs_login',
              lastDispatchOk: false,
              lastDispatchReason: 'browser_session_needs_login',
            },
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {
        getStatus: jest.fn().mockResolvedValue({
          online: true,
          visibleWindow: true,
          isolated: false,
          message: 'ok',
        }),
        listSessions: jest.fn().mockReturnValue([]),
      } as any,
      { execute: jest.fn() } as any,
    );

    const accounts = await client.listAccounts();

    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '抖音',
        status: 0,
        statusLabel: '需要重新登录',
      }),
    );
  });

  it('reopens a persistent profile to validate account login after backend restart', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'kaypal-auto-upload-account-recover-cdp-'),
    );
    const profileDir = join(root, 'profiles', 'wechat-channel-4');
    mkdirSync(profileDir, { recursive: true });
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/post/list'),
      evaluate: jest.fn().mockResolvedValue({
        url: 'https://channels.weixin.qq.com/platform/post/list',
        text: '视频号助手 发表记录 数据概览',
      }),
    };
    const localBrowser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'wechat-channel-4',
        accountId: '4',
        platform: 'wechat-channel',
        profileDir,
        context: {},
        page,
        debuggingPort: 9254,
        browser: '/Applications/Chrome.app',
        browserReused: true,
        visibleWindow: true,
        startedAt: '2026-06-18T00:00:00.000Z',
        lastActivityAt: '2026-06-18T00:00:00.000Z',
      }),
      getSession: jest.fn(() => ({ page })),
    };
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-wechat-channel',
            platform: 'wechat-channel',
            name: '视频号账号',
            config: {
              engineAccountId: 4,
              platformType: 2,
              filePath: 'wechat-channel.json',
              status: 'expired',
              statusLabel: '登录失效',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT')
            return join(root, 'profiles');
          if (key === 'AUTO_UPLOAD_COOKIES_DIR')
            return join(root, 'cookiesFile');
          return undefined;
        }),
      } as any,
      prisma as any,
      {} as any,
      {
        getStatus: jest.fn().mockResolvedValue({
          online: true,
          visibleWindow: true,
          isolated: false,
          message: 'ok',
        }),
        listSessions: jest.fn().mockReturnValue([]),
      } as any,
      { execute: jest.fn() } as any,
      undefined,
      localBrowser as any,
    );

    const accounts = await client.listAccounts({ validate: true, force: true });

    expect(localBrowser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: '4',
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://channels.weixin.qq.com/platform/post/list',
      expect.objectContaining({ waitUntil: 'commit' }),
    );
    expect(prisma.publishAccount.update).not.toHaveBeenCalled(); // validate 只读检测不写库
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '视频号',
        status: 1,
        statusLabel: '已登录',
      }),
    );
  });

  it('does not mark WeChat Channel marketing landing page as a ready login state', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'kaypal-auto-upload-account-marketing-'),
    );
    const profileDir = join(root, 'profiles', 'wechat-channel-4');
    mkdirSync(profileDir, { recursive: true });
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://channels.weixin.qq.com/'),
      evaluate: jest.fn().mockResolvedValue({
        url: 'https://channels.weixin.qq.com/',
        text: '视频号助手 一站式服务，让创作更简单。多人运营 内容管理 互动管理 数据中心 认证管理',
      }),
    };
    const localBrowser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'wechat-channel-4',
        accountId: '4',
        platform: 'wechat-channel',
        profileDir,
        context: {},
        page,
        debuggingPort: 9254,
        browser: '/Applications/Chrome.app',
        browserReused: true,
        visibleWindow: true,
        startedAt: '2026-06-18T00:00:00.000Z',
        lastActivityAt: '2026-06-18T00:00:00.000Z',
      }),
      getSession: jest.fn(() => ({ page })),
    };
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-wechat-channel',
            platform: 'wechat-channel',
            name: '视频号账号',
            config: {
              engineAccountId: 4,
              platformType: 2,
              filePath: 'wechat-channel.json',
              status: 'expired',
              statusLabel: '登录失效',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT')
            return join(root, 'profiles');
          if (key === 'AUTO_UPLOAD_COOKIES_DIR')
            return join(root, 'cookiesFile');
          return undefined;
        }),
      } as any,
      prisma as any,
      {} as any,
      {
        getStatus: jest.fn().mockResolvedValue({
          online: true,
          visibleWindow: true,
          isolated: false,
          message: 'ok',
        }),
        listSessions: jest.fn().mockReturnValue([]),
      } as any,
      { execute: jest.fn() } as any,
      undefined,
      localBrowser as any,
    );

    const accounts = await client.listAccounts({ validate: true, force: true });

    expect(prisma.publishAccount.update).not.toHaveBeenCalled(); // validate 只读检测不写库
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '视频号',
        status: 0,
        statusLabel: '需要重新登录',
      }),
    );
  });

  it('does not mark an account ready from a static profile when runtime validation times out', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'kaypal-auto-upload-account-timeout-'),
    );
    const profileDir = join(root, 'profiles', 'wechat-channel-4');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [
          { name: 'session', value: 'abc', domain: '.channels.weixin.qq.com' },
        ],
        origins: [],
      }),
    );
    const never = new Promise(() => undefined);
    const localBrowser = {
      getOrCreateSession: jest.fn().mockReturnValue(never),
    };
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-wechat-channel',
            platform: 'wechat-channel',
            name: '视频号账号',
            config: {
              engineAccountId: 4,
              platformType: 2,
              filePath: 'wechat-channel.json',
              status: 'ready',
              statusLabel: '已登录',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT')
            return join(root, 'profiles');
          if (key === 'AUTO_UPLOAD_COOKIES_DIR')
            return join(root, 'cookiesFile');
          return undefined;
        }),
      } as any,
      prisma as any,
      {} as any,
      {
        getStatus: jest.fn().mockResolvedValue({
          online: true,
          visibleWindow: true,
          isolated: false,
          message: 'ok',
        }),
        listSessions: jest.fn().mockReturnValue([]),
      } as any,
      { execute: jest.fn() } as any,
      undefined,
      localBrowser as any,
    );
    jest
      .spyOn(client as any, 'withAccountValidationTimeout')
      .mockResolvedValue(null);

    const accounts = await client.listAccounts({ validate: true, force: true });

    expect(prisma.publishAccount.update).not.toHaveBeenCalled(); // validate 只读检测不写库
    // 新行为：运行时验证超时 ≠ 账号失效，保持原状态不降级（防移动端/无浏览器环境误判）
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '视频号',
        status: 1,
        statusLabel: '已登录',
      }),
    );
  });

  it('does not treat stale persistent profile as ready when current CDP state is unverified', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'kaypal-auto-upload-account-unverified-cdp-'),
    );
    const profileDir = join(root, 'profiles', 'douyin-1');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.douyin.com' }],
        origins: [],
      }),
    );
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              platformType: 3,
              filePath: 'douyin.json',
              status: 'ready',
              statusLabel: '已登录',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT')
            return join(root, 'profiles');
          if (key === 'AUTO_UPLOAD_COOKIES_DIR')
            return join(root, 'cookiesFile');
          return undefined;
        }),
      } as any,
      prisma as any,
      {} as any,
      {
        getStatus: jest.fn().mockResolvedValue({
          online: true,
          visibleWindow: true,
          isolated: false,
          message: 'ok',
        }),
        listSessions: jest.fn().mockReturnValue([
          {
            platform: 'douyin',
            accountId: 1,
            status: 'unknown',
            currentUrl: undefined,
          },
        ]),
      } as any,
      { execute: jest.fn() } as any,
    );

    const accounts = await client.listAccounts({ validate: true, force: true });

    expect(prisma.publishAccount.update).not.toHaveBeenCalled(); // validate 只读检测不写库
    // 新行为：CDP 状态 unknown（无法确认失效）→ 保持原状态不降级
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 1,
        platform: '抖音',
        status: 1,
        statusLabel: '已登录',
      }),
    );
  });

  it('keeps a currently verified browser session ready when an older publish login failure exists', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'kaypal-auto-upload-publish-login-failed-'),
    );
    const profileDir = join(root, 'profiles', 'douyin-1');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.douyin.com' }],
        origins: [],
      }),
    );
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              platformType: 3,
              filePath: 'douyin.json',
              status: 'ready',
              statusLabel: '已登录',
              sessionStatus: 'logged_in',
              lastDispatchOk: true,
              lastDispatchReason: 'browser_session_ready',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      runtimeExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            executor: 'platform-publish',
            platform: 'douyin',
            accountId: '1',
            reasonCode: 'account_not_logged_in',
            technicalMessage:
              'url=https://creator.douyin.com/creator-micro/content/post/picture',
            createdAt: new Date(),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT')
            return join(root, 'profiles');
          if (key === 'AUTO_UPLOAD_COOKIES_DIR')
            return join(root, 'cookiesFile');
          return undefined;
        }),
      } as any,
      prisma as any,
      {} as any,
      {
        getStatus: jest.fn().mockResolvedValue({
          online: true,
          visibleWindow: true,
          isolated: false,
          message: 'ok',
        }),
        listSessions: jest.fn().mockReturnValue([
          {
            platform: 'douyin',
            accountId: 1,
            status: 'ready',
            currentUrl:
              'https://creator.douyin.com/creator-micro/interactive/comment',
            lastActivityAt: new Date().toISOString(),
          },
        ]),
      } as any,
      { execute: jest.fn() } as any,
    );

    const accounts = await client.listAccounts({ validate: true, force: true });

    expect(prisma.runtimeExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          executor: 'platform-publish',
          reasonCode: 'account_not_logged_in',
        }),
      }),
    );
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 1,
        platform: '抖音',
        status: 1,
        statusLabel: '已登录',
      }),
    );
  });

  it('opens interaction entries with the account persistent browser profile', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-wechat-channel',
            platform: 'wechat-channel',
            name: '视频号账号',
            config: {
              engineAccountId: 4,
              status: 'ready',
              filePath: 'wechat-channel.json',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
    };
    const mcp = { rpcCall: jest.fn() };
    const localBrowser = {
      getSession: jest.fn().mockReturnValue({
        page: {
          waitForLoadState: jest.fn().mockResolvedValue(undefined),
          waitForTimeout: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue({
            url: 'https://channels.weixin.qq.com/platform',
            title: '视频号助手',
            loggedIn: true,
            pageTextSample: '视频号助手 互动管理 内容管理',
          }),
          url: jest
            .fn()
            .mockReturnValue('https://channels.weixin.qq.com/platform'),
        },
      }),
      captureEvidence: jest.fn().mockResolvedValue({
        path: '/tmp/wechat-entry.png',
        url: '/api/local-engine/browser/evidence/wechat-entry.png',
      }),
    };
    const interactionExecutor = {
      openAccount: jest.fn().mockResolvedValue({
        sessionKey: 'wechat-channel-4',
        currentUrl: 'https://channels.weixin.qq.com/platform',
        profileDir: '/tmp/wechat-channel-4',
        visibleWindow: true,
        cdpPort: 9253,
        browser: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        browserReused: true,
        runtimeMode: 'persistent-cdp-browser',
      }),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
      {} as any,
      localBrowser as any,
    );

    const result = await client.openInteractionEntry({
      accountId: 4,
      entryType: 'wechat-channel:message',
    });

    expect(interactionExecutor.openAccount).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: 4,
      url: 'https://channels.weixin.qq.com/platform',
      storagePath: expect.stringContaining('wechat-channel.json'),
    });
    expect(mcp.rpcCall).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        platformName: '视频号',
        entryName: '视频号私信',
        status: 'opened',
        url: 'https://channels.weixin.qq.com/platform',
        title: '视频号助手',
        loggedIn: true,
        pageTextSample: '视频号助手 互动管理 内容管理',
        runtimeMode: 'persistent-cdp-browser',
        profileDir: '/tmp/wechat-channel-4',
        cdpPort: 9253,
        browserReused: true,
        evidence: expect.objectContaining({
          type: 'screenshot',
          path: '/tmp/wechat-entry.png',
        }),
      }),
    );
  });

  it('opens every platform account that shares the same engine account id', async () => {
    const sessions: Record<string, any> = {
      douyin: {
        context: {},
        profileDir: '/tmp/douyin-profile',
        page: {
          goto: jest.fn().mockResolvedValue(undefined),
          bringToFront: jest.fn().mockResolvedValue(undefined),
        },
      },
      'wechat-channel': {
        context: {},
        profileDir: '/tmp/wechat-channel-profile',
        page: {
          goto: jest.fn().mockResolvedValue(undefined),
          bringToFront: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'local-engine-4-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: { engineAccountId: 4, platformType: 3 },
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
          },
          {
            id: 'local-engine-4-wechat-channel',
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, platformType: 2 },
            createdAt: new Date('2026-06-20T00:00:01.000Z'),
          },
        ]),
      },
    };
    const localBrowser = {
      getOrCreateSession: jest.fn(
        async ({ platform }: { platform: string }) => sessions[platform],
      ),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      { execute: jest.fn() } as any,
      {} as any,
      localBrowser as any,
    );
    jest
      .spyOn(client as any, 'monitorAccountLoginState')
      .mockResolvedValue(undefined);

    const result = await client.openAccounts([4]);

    expect(result.opened).toBe(2);
    expect(result.openedAccounts).toEqual([
      expect.objectContaining({
        id: 'local-engine-4-douyin',
        platform: 'douyin',
        accountId: 4,
      }),
      expect.objectContaining({
        id: 'local-engine-4-wechat-channel',
        platform: 'wechat-channel',
        accountId: 4,
      }),
    ]);
    expect(localBrowser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: 4,
    });
    expect(localBrowser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: 4,
    });
    expect(sessions.douyin.page.goto).toHaveBeenCalledWith(
      'https://creator.douyin.com/creator-micro/content/manage',
      { waitUntil: 'commit', timeout: 30000 },
    );
    expect(sessions['wechat-channel'].page.goto).toHaveBeenCalledWith(
      'https://channels.weixin.qq.com/platform/post/list',
      { waitUntil: 'commit', timeout: 30000 },
    );
  });

  it('opens only the requested platform when shared engine account ids overlap', async () => {
    const sessions: Record<string, any> = {
      douyin: {
        context: {},
        profileDir: '/tmp/douyin-profile',
        page: {
          goto: jest.fn().mockResolvedValue(undefined),
          bringToFront: jest.fn().mockResolvedValue(undefined),
        },
      },
      'wechat-channel': {
        context: {},
        profileDir: '/tmp/wechat-channel-profile',
        page: {
          goto: jest.fn().mockResolvedValue(undefined),
          bringToFront: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'local-engine-4-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: { engineAccountId: 4, platformType: 3 },
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
          },
          {
            id: 'local-engine-4-wechat-channel',
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, platformType: 2 },
            createdAt: new Date('2026-06-20T00:00:01.000Z'),
          },
        ]),
      },
    };
    const localBrowser = {
      getOrCreateSession: jest.fn(
        async ({ platform }: { platform: string }) => sessions[platform],
      ),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      { execute: jest.fn() } as any,
      {} as any,
      localBrowser as any,
    );
    jest
      .spyOn(client as any, 'monitorAccountLoginState')
      .mockResolvedValue(undefined);

    const result = await client.openAccounts([4], {
      platform: 'wechat-channel',
    });

    expect(result.opened).toBe(1);
    expect(result.openedAccounts).toEqual([
      expect.objectContaining({
        id: 'local-engine-4-wechat-channel',
        platform: 'wechat-channel',
        accountId: 4,
      }),
    ]);
    expect(localBrowser.getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(localBrowser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: 4,
    });
    expect(sessions.douyin.page.goto).not.toHaveBeenCalled();
    expect(sessions['wechat-channel'].page.goto).toHaveBeenCalledWith(
      'https://channels.weixin.qq.com/platform/post/list',
      { waitUntil: 'commit', timeout: 30000 },
    );
  });

  it('routes publish requests through Runtime and keeps not_integrated explicit', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              filePath: '/profiles/douyin.json',
              status: 'ready',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
    };
    const runtime = {
      execute: jest.fn().mockResolvedValue({
        ok: false,
        status: 'blocked',
        reasonCode: 'not_integrated',
        userMessage:
          '抖音「测试视频」真实发布执行器尚未迁入 3011 Runtime，未上传到平台。',
        technicalMessage: 'uploader not migrated',
        evidence: [
          {
            type: 'text',
            label: 'publish-not-integrated',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      runtime as any,
    );

    const result = await client.publishBatch([
      {
        type: 3,
        contentKind: 'video',
        title: '测试视频',
        tags: [],
        fileList: ['/tmp/video.mp4'],
        accountIds: [1],
        accountList: ['/profiles/douyin.json'],
      },
    ]);

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'platform-publish-video',
        platform: 'douyin',
        accountId: '1',
        payload: expect.objectContaining({ accountId: '1' }),
      }),
      expect.objectContaining({ sendMode: 'auto-send' }),
    );
    expect(result?.results?.[0]).toEqual(
      expect.objectContaining({
        ok: false,
        notIntegrated: true,
        message: expect.stringContaining('真实发布执行器尚未迁入 3011 Runtime'),
      }),
    );
  });

  it('keeps Runtime publish readback as commercial publish evidence', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              filePath: '/profiles/douyin.json',
              status: 'ready',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
    };
    const runtime = {
      execute: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '抖音「测试视频」已提交发布，并进入发布成功/管理页。',
        technicalMessage:
          'url=https://creator.douyin.com/creator-micro/content/manage',
        evidence: [
          {
            type: 'text',
            label: 'publish-readback',
            value: JSON.stringify({
              currentUrl:
                'https://creator.douyin.com/creator-micro/content/manage',
              title: '测试视频',
            }),
            createdAt: new Date().toISOString(),
          },
        ],
        readback: {
          expectedText: '测试视频',
          actualText: 'https://creator.douyin.com/creator-micro/content/manage',
          matched: true,
        },
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      runtime as any,
    );

    const result = await client.publishBatch([
      {
        type: 3,
        contentKind: 'video',
        title: '测试视频',
        tags: [],
        fileList: ['/tmp/video.mp4'],
        accountIds: [1],
        accountList: ['/profiles/douyin.json'],
      },
    ]);

    expect(result?.reason).toBe('平台已确认全部发布结果。');
    expect(result?.results?.[0]).toEqual(
      expect.objectContaining({
        ok: true,
        notIntegrated: false,
        publishUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        platformUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        evidence: expect.objectContaining({
          source: 'readback',
          readbackOk: true,
          reasonCode: 'success',
          publishUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        }),
      }),
    );
  });

  it('does not report Runtime success when platform readback is unmatched', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              filePath: '/profiles/douyin.json',
              status: 'ready',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
    };
    const runtime = {
      execute: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '平台点击已完成',
        technicalMessage:
          'url=https://creator.douyin.com/creator-micro/content/post/video',
        evidence: [],
        readback: {
          expectedText: '测试视频',
          actualText:
            'https://creator.douyin.com/creator-micro/content/post/video',
          matched: false,
        },
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      runtime as any,
    );

    const result = await client.publishBatch([
      {
        type: 3,
        contentKind: 'video',
        title: '测试视频',
        tags: [],
        fileList: ['/tmp/video.mp4'],
        accountIds: [1],
        accountList: ['/profiles/douyin.json'],
      },
    ]);

    expect(result?.reason).toBe('发布请求已提交，正在等待平台确认。');
    expect(result?.results?.[0]).toEqual(
      expect.objectContaining({
        ok: null,
        message: expect.stringContaining('平台尚未确认结果'),
        evidence: expect.objectContaining({
          readbackOk: false,
          readback: expect.objectContaining({ matched: false }),
        }),
      }),
    );
  });

  it('forwards the source article id, full body and identities to the publish runtime', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'account-a',
            platform: 'douyin',
            name: '品牌抖音',
            config: { engineAccountId: 1 },
            createdAt: new Date('2026-07-11T00:00:00.000Z'),
          },
        ]),
      },
    };
    const runtime = {
      execute: jest.fn().mockResolvedValue({
        ok: false,
        status: 'blocked',
        reasonCode: 'not_integrated',
        userMessage: '当前平台发布暂不可用',
        evidence: [],
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      runtime as any,
    );
    const sourceIdentity = {
      sourceType: 'article' as const,
      sourceId: 'article-a',
      title: '完整文章',
      contentType: 'article',
      contentFormat: 'markdown',
      updatedAt: '2026-07-11T00:00:00.000Z',
    };
    const accountIdentity = {
      id: 'account-a',
      name: '品牌抖音',
      platform: 'douyin',
      status: 'ready',
    };

    await client.publishBatch([
      {
        type: 3,
        contentKind: 'article',
        articleId: 'article-a',
        body: '这里是未经截断的完整正文。',
        sourceIdentity,
        accountIdentity,
        title: '完整文章',
        tags: [],
        fileList: ['/tmp/article.png'],
        accountIds: [1],
        accountList: ['/profiles/douyin.json'],
      },
    ]);

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'platform-publish-image-text',
        payload: expect.objectContaining({
          articleId: 'article-a',
          body: '这里是未经截断的完整正文。',
          sourceIdentity,
          accountIdentity,
        }),
      }),
      expect.anything(),
    );
  });

  it('restores utf8 material names when multipart originalname is decoded as latin1', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'auto-upload-material-name-'));
    process.chdir(root);

    try {
      const client = new AutoUploadClient(
        { get: jest.fn().mockReturnValue(undefined) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const expectedName = '短视频素材-05.mp4';
      const mojibakeName = Buffer.from(expectedName, 'utf8').toString('latin1');

      const uploaded = await client.uploadMaterial({
        file: {
          buffer: Buffer.from('video'),
          originalname: mojibakeName,
        },
      });
      const materials = await client.listMaterials();

      expect(uploaded.filename).toBe(expectedName);
      expect(materials[0]).toEqual(
        expect.objectContaining({
          filename: expectedName,
        }),
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('displays and previews legacy materials saved with latin1 mojibake names', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(
      join(tmpdir(), 'auto-upload-legacy-material-name-'),
    );
    process.chdir(root);

    try {
      const client = new AutoUploadClient(
        { get: jest.fn().mockReturnValue(undefined) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const expectedName = '短视频素材-08.mp4';
      const mojibakeName = Buffer.from(expectedName, 'utf8').toString('latin1');
      const legacySafeName = mojibakeName.replace(/\s+/g, '-');
      const materialDir = join(root, 'data', 'materials');
      mkdirSync(materialDir, { recursive: true });
      writeFileSync(
        join(materialDir, legacySafeName),
        Buffer.from('legacy-video'),
      );
      writeFileSync(
        join(materialDir, 'index.json'),
        JSON.stringify({
          nextId: 2,
          files: [
            {
              id: 1,
              filename: legacySafeName,
              filepath: join(materialDir, legacySafeName),
              uploadedAt: new Date('2026-06-09T00:00:00.000Z').toISOString(),
            },
          ],
        }),
      );

      const materials = await client.listMaterials();
      const preview = await client.fetchMaterialFile(expectedName);

      expect(materials[0]).toEqual(
        expect.objectContaining({
          filename: expectedName,
          filePath: join(materialDir, legacySafeName),
        }),
      );
      expect(preview.buffer.toString()).toBe('legacy-video');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('returns only durable account details owned by the current tenant and user', async () => {
    const context = new AuthRequestContextService();
    const rows = [
      {
        id: 'account-a',
        tenantId: 'tenant-a',
        userId: 'user-a',
        platform: 'douyin',
        name: '租户 A 抖音',
        status: 'ready',
        config: {
          engineAccountId: 1,
          platformType: 3,
          status: 'ready',
          avatarPath: 'account-a.png',
        },
        createdAt: new Date('2026-07-11T00:00:00.000Z'),
      },
      {
        id: 'account-b',
        tenantId: 'tenant-b',
        userId: 'user-b',
        platform: 'douyin',
        name: '租户 B 抖音',
        status: 'expired',
        config: {
          engineAccountId: 1,
          platformType: 3,
          status: 'expired',
          avatarPath: 'account-b.png',
        },
        createdAt: new Date('2026-07-11T00:01:00.000Z'),
      },
    ];
    const prisma = {
      tenantMember: {
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) => [
          {
            tenantId: where.userId === 'user-a' ? 'tenant-a' : 'tenant-b',
          },
        ]),
        findFirst: jest.fn(
          async ({ where }: { where: { userId: string } }) => ({
            tenantId: where.userId === 'user-a' ? 'tenant-a' : 'tenant-b',
          }),
        ),
      },
      publishAccount: {
        count: jest.fn(
          async ({ where }: { where: Record<string, string> }) =>
            rows.filter(
              (row) =>
                row.tenantId === where.tenantId && row.userId === where.userId,
            ).length,
        ),
        findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
          rows.filter(
            (row) =>
              (!where.tenantId || row.tenantId === where.tenantId) &&
              (!where.userId || row.userId === where.userId),
          ),
        ),
      },
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      context,
    );

    const tenantA = await context.run({ user: { id: 'user-a' } }, () =>
      client.listAccounts(),
    );
    const tenantB = await context.run({ user: { id: 'user-b' } }, () =>
      client.listAccounts(),
    );

    expect(tenantA).toEqual([
      expect.objectContaining({
        stableId: 'account-a',
        accountName: '租户 A 抖音',
        platformKey: 'douyin',
        statusCode: 'ready',
      }),
    ]);
    expect(tenantB).toEqual([
      expect.objectContaining({
        stableId: 'account-b',
        accountName: '租户 B 抖音',
        platformKey: 'douyin',
        statusCode: 'expired',
      }),
    ]);
    await expect(
      context.run({ user: { id: 'user-a' } }, () =>
        client.hasAccountAvatar('account-a.png'),
      ),
    ).resolves.toBe(true);
    await expect(
      context.run({ user: { id: 'user-a' } }, () =>
        client.hasAccountAvatar('account-b.png'),
      ),
    ).resolves.toBe(false);
  });
});

describe('AutoUploadClient.resolveLoginEngineAccountId', () => {
  function buildClient(
    rows: Array<{ id: string; platform: string; config?: unknown }>,
    platform = 'wechat-channel',
  ) {
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          // 隔离到临时目录，避免文件系统探测命中真实 browser-profiles 目录
          key === 'LOCAL_BROWSER_PROFILE_ROOT'
            ? mkdtempSync(join(tmpdir(), 'resolve-engine-id-'))
            : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (client as any).prisma = {
      publishAccount: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    (client as any).resolvePublishOwnerScope = jest.fn().mockResolvedValue({});
    (client as any).resolveBrowserPlatformSlug = jest
      .fn()
      .mockReturnValue(platform);
    return client;
  }

  it('returns max+1 when all rows carry config.engineAccountId', async () => {
    const client = buildClient([
      {
        id: 'local-engine-1-wechat-channel',
        platform: 'wechat-channel',
        config: { engineAccountId: 1 },
      },
      {
        id: 'local-engine-2-wechat-channel',
        platform: 'wechat-channel',
        config: { engineAccountId: 2 },
      },
    ]);
    await expect(
      (client as any).resolveLoginEngineAccountId({
        type: 2,
        profileName: '新号',
        requestId: 'r1',
      }),
    ).resolves.toBe(3);
  });

  it('avoids colliding with legacy rows that lack config.engineAccountId (root cause of "bound but not listed")', async () => {
    const client = buildClient([
      // 旧版本创建的视频号账号：config 无 engineAccountId，但主键占用编号 1
      {
        id: 'local-engine-1-wechat-channel',
        platform: 'wechat-channel',
        config: { status: 'ready' },
      },
    ]);
    await expect(
      (client as any).resolveLoginEngineAccountId({
        type: 2,
        profileName: '新号',
        requestId: 'r2',
      }),
    ).resolves.toBe(2);
  });

  it('parses legacy rows with a scoped owner suffix on the primary key', async () => {
    const client = buildClient([
      {
        id: 'local-engine-1-wechat-channel-abc123def456',
        platform: 'wechat-channel',
        config: { status: 'ready' },
      },
    ]);
    await expect(
      (client as any).resolveLoginEngineAccountId({
        type: 2,
        profileName: '新号',
        requestId: 'r3',
      }),
    ).resolves.toBe(2);
  });

  it('returns 1 when the platform has no accounts yet', async () => {
    const client = buildClient([]);
    await expect(
      (client as any).resolveLoginEngineAccountId({
        type: 2,
        profileName: '新号',
        requestId: 'r4',
      }),
    ).resolves.toBe(1);
  });

  it('allocates engineAccountId globally across owners so profiles never collide (root cause of "add second account jumps to the logged-in one")', async () => {
    // 两个桌面登录身份都有 engineAccountId=1 的抖音账号（共用 profile douyin-1）。
    // 修复前按 owner 过滤，新身份 used 为空 → 分到 1 → 打开浏览器直接进已登录账号。
    const client = buildClient(
      [
        {
          id: 'local-engine-aaa1111111111111-1-douyin',
          platform: 'douyin',
          config: { engineAccountId: 1 },
        },
        {
          id: 'local-engine-bbb2222222222222-1-douyin',
          platform: 'douyin',
          config: { engineAccountId: 1 },
        },
        {
          id: 'local-engine-bbb2222222222222-5-douyin',
          platform: 'douyin',
          config: { engineAccountId: 5 },
        },
      ],
      'douyin',
    );
    await expect(
      (client as any).resolveLoginEngineAccountId({
        type: 3,
        profileName: '新号',
        requestId: 'r5',
      }),
    ).resolves.toBe(6);
  });

  it('skips engineAccountIds whose profile dir already exists on disk (legacy/orphan leftovers)', async () => {
    // 数据库无记录，但文件系统 browser-profiles/douyin-1 已被旧版本占用
    const profileRoot = mkdtempSync(join(tmpdir(), 'resolve-engine-id-'));
    mkdirSync(join(profileRoot, 'douyin-1'), { recursive: true });
    mkdirSync(join(profileRoot, 'douyin-2'), { recursive: true });
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'LOCAL_BROWSER_PROFILE_ROOT' ? profileRoot : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (client as any).prisma = {
      publishAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    (client as any).resolvePublishOwnerScope = jest.fn().mockResolvedValue({});
    (client as any).resolveBrowserPlatformSlug = jest
      .fn()
      .mockReturnValue('douyin');
    await expect(
      (client as any).resolveLoginEngineAccountId({
        type: 3,
        profileName: '新号',
        requestId: 'r6',
      }),
    ).resolves.toBe(3);
  });
});
