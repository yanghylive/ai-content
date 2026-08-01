import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalBrowserEngine } from './local-browser-engine.service';

describe('LocalBrowserEngine', () => {
  const roots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createEngine(root: string) {
    const profiles = {
      restoreLegacyProfileSnapshot: jest.fn(),
    };
    return new LocalBrowserEngine(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT')
            return join(root, 'profiles');
          if (key === 'LOCAL_BROWSER_EVIDENCE_ROOT')
            return join(root, 'evidence');
          return undefined;
        }),
      } as any,
      profiles as any,
      {
        resolve: jest.fn().mockReturnValue({
          executablePath:
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          source: 'test',
          exists: true,
          message: 'test browser',
        }),
      } as any,
    );
  }

  it('treats Playwright CDP browser context errors as recoverable launch failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);

    expect(
      (engine as any).isRecoverableCdpLaunchError(
        'browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.',
      ),
    ).toBe(true);
    expect(
      (engine as any).isRecoverableCdpLaunchError(
        'browserType.connectOverCDP: Timeout 30000ms exceeded.',
      ),
    ).toBe(true);
  });

  it('requires a Xiaohongshu creator backend signal before treating a session as logged in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const page = (url: string, text: string) => ({
      url: jest.fn().mockReturnValue(url),
      locator: jest.fn().mockReturnValue({
        innerText: jest.fn().mockResolvedValue(text),
      }),
    });

    await expect(
      (engine as any).pageLooksLoggedIn(
        page(
          'https://creator.xiaohongshu.com/new/skill-hub',
          '小红书创作服务平台 技能中心 笔记管理',
        ),
        'xiaohongshu',
      ),
    ).resolves.toBe(true);
    await expect(
      (engine as any).pageLooksLoggedIn(
        page('https://creator.xiaohongshu.com/login', '扫码登录'),
        'xiaohongshu',
      ),
    ).resolves.toBe(false);
    await expect(
      (engine as any).pageLooksLoggedIn(
        page('https://www.xiaohongshu.com/explore/1', '小红书'),
        'xiaohongshu',
      ),
    ).resolves.toBe(false);
  });

  it('uses the persistent-context fallback for the Windows CDP context-management error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const context = { pages: jest.fn().mockReturnValue([]) };
    jest
      .spyOn(engine as any, 'launchCdpContext')
      .mockRejectedValue(
        new Error(
          'browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.',
        ),
      );
    jest
      .spyOn(engine as any, 'launchPersistentContext')
      .mockResolvedValue(context);
    jest
      .spyOn(engine as any, 'terminateProcessesUsingProfile')
      .mockReturnValue(undefined);
    jest
      .spyOn(engine as any, 'cleanupProfileLockFiles')
      .mockReturnValue(undefined);
    jest
      .spyOn(engine as any, 'shouldFallbackToPersistentContext')
      .mockReturnValue(true);

    await expect(
      (engine as any).launchCdpContextWithRecovery(
        'wechat-channel-4',
        join(root, 'profiles', 'wechat-channel-4'),
        'wechat-channel',
        '4',
      ),
    ).resolves.toEqual({
      context,
      reused: false,
    });
    expect((engine as any).launchPersistentContext).toHaveBeenCalled();
  });

  it('does not inject stale storageState when the persistent Chrome cookie store is newer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const profileDir = join(root, 'profiles', 'wechat-channel-4');
    const cookieStore = join(profileDir, 'Default', 'Cookies');
    const storageState = join(profileDir, '.login-cookies.json');
    mkdirSync(join(profileDir, 'Default'), { recursive: true });
    writeFileSync(cookieStore, Buffer.alloc(40 * 1024, 1));
    writeFileSync(
      storageState,
      JSON.stringify({
        cookies: [
          {
            name: 'sessionid',
            value: 'stale',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
        ],
      }),
    );
    const oldTime = new Date('2026-06-09T07:51:00.000Z');
    const newTime = new Date('2026-06-18T23:10:00.000Z');
    utimesSync(storageState, oldTime, oldTime);
    utimesSync(cookieStore, newTime, newTime);

    const engine = createEngine(root);
    const addCookies = jest.fn();
    (engine as any).sessions.set('wechat-channel-4', {
      key: 'wechat-channel-4',
      profileDir,
      context: { addCookies },
    });

    const loaded = await engine.loadStorageStateCookies({
      sessionKey: 'wechat-channel-4',
      storagePath: storageState,
    });

    expect(loaded).toBe(0);
    expect(addCookies).not.toHaveBeenCalled();
  });

  it('injects legacy profile cookies when they match the current platform', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const profileDir = join(root, 'profiles', 'wechat-channel-4');
    const storageState = join(profileDir, '.login-cookies.json');
    mkdirSync(join(profileDir, 'Default'), { recursive: true });
    writeFileSync(
      join(profileDir, '.legacy-profile-imported.json'),
      JSON.stringify({ importedAt: new Date().toISOString() }),
    );
    writeFileSync(
      storageState,
      JSON.stringify({
        cookies: [
          {
            name: 'wx-session',
            value: 'fresh',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
        ],
      }),
    );

    const engine = createEngine(root);
    const addCookies = jest.fn().mockResolvedValue(undefined);

    await (engine as any).loadProfileCookies(
      { addCookies },
      profileDir,
      'wechat-channel-4',
      'wechat-channel',
    );

    expect(addCookies).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'wx-session',
          value: 'fresh',
          domain: 'channels.weixin.qq.com',
        }),
      ]),
    );
    expect(readFileSync(storageState, 'utf8')).toContain(
      'channels.weixin.qq.com',
    );
  });

  it('reselects the best business page when reusing an existing CDP session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);

    const oldPage = {
      url: jest.fn().mockReturnValue('chrome://new-tab-page/'),
      bringToFront: jest.fn().mockResolvedValue(undefined),
    };
    const businessPage = {
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/private_msg'),
      bringToFront: jest.fn().mockResolvedValue(undefined),
    };
    const context = {
      pages: jest.fn().mockReturnValue([oldPage, businessPage]),
      browser: jest.fn().mockReturnValue({ version: () => 'test' }),
    };
    const engine = createEngine(root);
    (engine as any).sessions.set('wechat-channel-4', {
      key: 'wechat-channel-4',
      accountId: '4',
      platform: 'wechat-channel',
      profileDir: join(root, 'profiles', 'wechat-channel-4'),
      context,
      page: oldPage,
      visibleWindow: true,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    });

    const session = await engine.getOrCreateSession({
      platform: 'wechat-channel',
      accountId: 4,
    });

    expect(session.page).toBe(businessPage);
    expect(businessPage.bringToFront).toHaveBeenCalled();
    expect(oldPage.bringToFront).not.toHaveBeenCalled();
  });

  it('reuses a logged-in same-platform session when the requested account profile is not the logged-in one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);

    const loggedInPage = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/data/following/chat',
        ),
      locator: jest.fn().mockReturnValue({
        innerText: jest
          .fn()
          .mockResolvedValue('抖音创作者中心 私信管理 大壮AI研究员'),
      }),
      bringToFront: jest.fn().mockResolvedValue(undefined),
    };
    const context = {
      pages: jest.fn().mockReturnValue([loggedInPage]),
      browser: jest.fn().mockReturnValue({ version: () => 'test' }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const engine = createEngine(root);
    (engine as any).sessions.set('douyin-1', {
      key: 'douyin-1',
      accountId: '1',
      platform: 'douyin',
      profileDir: join(root, 'profiles', 'douyin-1'),
      context,
      page: loggedInPage,
      visibleWindow: true,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    });

    const session = await engine.getOrCreateSession({
      platform: 'douyin',
      accountId: 4,
    });

    expect(session.key).toBe('douyin-4');
    expect(session.accountId).toBe('4');
    expect(session.sourceAccountId).toBe('1');
    expect(session.profileDir).toBe(join(root, 'profiles', 'douyin-1'));
    expect(loggedInPage.bringToFront).toHaveBeenCalled();
    expect(engine.getSession('douyin-1')).toBeUndefined();
    expect(engine.getSession('douyin-4')).toBe(session);
  });

  it('does not reuse the WeChat Channel marketing landing page as a logged-in session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);

    const marketingPage = {
      url: jest.fn().mockReturnValue('https://channels.weixin.qq.com/'),
      locator: jest.fn().mockReturnValue({
        innerText: jest
          .fn()
          .mockResolvedValue(
            '视频号助手 一站式服务，让创作更简单。多人运营 内容管理 互动管理 数据中心 认证管理',
          ),
      }),
      bringToFront: jest.fn().mockResolvedValue(undefined),
    };
    const context = {
      pages: jest.fn().mockReturnValue([marketingPage]),
      browser: jest.fn().mockReturnValue({ version: () => 'test' }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const engine = createEngine(root);
    (engine as any).sessions.set('wechat-channel-1', {
      key: 'wechat-channel-1',
      accountId: '1',
      platform: 'wechat-channel',
      profileDir: join(root, 'profiles', 'wechat-channel-1'),
      context,
      page: marketingPage,
      visibleWindow: true,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    });
    (engine as any).launchCdpContextWithRecovery = jest
      .fn()
      .mockRejectedValue(new Error('launch blocked in test'));
    (engine as any).profiles.ensureProfileExists = jest
      .fn()
      .mockReturnValue(join(root, 'profiles', 'wechat-channel-4'));
    (engine as any).profiles.ensureProfileCookiesCurrent = jest
      .fn()
      .mockResolvedValue(undefined);

    await expect(
      engine.getOrCreateSession({
        platform: 'wechat-channel',
        accountId: 4,
      }),
    ).rejects.toThrow('launch blocked in test');

    expect(marketingPage.bringToFront).not.toHaveBeenCalled();
  });

  it('reuses a real WeChat Channel backend page as a logged-in session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);

    const loggedInPage = {
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/private_msg'),
      locator: jest.fn().mockReturnValue({
        innerText: jest
          .fn()
          .mockResolvedValue(
            '视频号助手 私信管理 全部私信 全部消息 打招呼消息',
          ),
      }),
      bringToFront: jest.fn().mockResolvedValue(undefined),
    };
    const context = {
      pages: jest.fn().mockReturnValue([loggedInPage]),
      browser: jest.fn().mockReturnValue({ version: () => 'test' }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const engine = createEngine(root);
    (engine as any).sessions.set('wechat-channel-1', {
      key: 'wechat-channel-1',
      accountId: '1',
      platform: 'wechat-channel',
      profileDir: join(root, 'profiles', 'wechat-channel-1'),
      context,
      page: loggedInPage,
      visibleWindow: true,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    });

    const session = await engine.getOrCreateSession({
      platform: 'wechat-channel',
      accountId: 4,
    });

    expect(session.key).toBe('wechat-channel-4');
    expect(session.sourceAccountId).toBe('1');
    expect(loggedInPage.bringToFront).toHaveBeenCalled();
  });

  it('restores the legacy wechat-channel profile before relaunching a login recovery session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);

    const engine = createEngine(root);
    const restoredProfile = join(root, 'profiles', 'wechat-channel-4');
    (engine as any).profiles.restoreLegacyProfileSnapshot.mockReturnValue(
      restoredProfile,
    );
    (engine as any).terminateProcessesUsingProfile = jest.fn();
    (engine as any).cleanupProfileLockFiles = jest.fn();
    const goto = jest.fn().mockResolvedValue(undefined);
    const page = {
      goto,
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/private_msg'),
    };
    (engine as any).getOrCreateSession = jest.fn().mockResolvedValue({
      key: 'wechat-channel-4',
      page,
    });

    await engine.recoverWechatChannelSessionFromLegacyProfile({
      platform: 'wechat-channel',
      accountId: 4,
      taskType: 'direct-message-reply',
    } as any);

    expect(
      (engine as any).profiles.restoreLegacyProfileSnapshot,
    ).toHaveBeenCalledWith('wechat-channel', '4');
    expect((engine as any).terminateProcessesUsingProfile).toHaveBeenCalledWith(
      restoredProfile,
    );
    expect((engine as any).cleanupProfileLockFiles).toHaveBeenCalledWith(
      restoredProfile,
    );
    expect((engine as any).getOrCreateSession).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: 4,
      taskType: 'direct-message-reply',
    });
    expect(goto).toHaveBeenCalledWith(
      'https://channels.weixin.qq.com/platform/private_msg',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
  });

  it('returns null when no legacy profile exists during recovery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);

    const engine = createEngine(root);
    (engine as any).profiles.restoreLegacyProfileSnapshot.mockReturnValue(null);
    (engine as any).getOrCreateSession = jest.fn();

    const recovered = await engine.recoverWechatChannelSessionFromLegacyProfile(
      {
        accountId: 4,
        taskType: 'direct-message-reply',
      },
    );

    expect(recovered).toBeNull();
    expect((engine as any).getOrCreateSession).not.toHaveBeenCalled();
  });

  it('restores a legacy douyin profile when preflight lands on a login page', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);

    const engine = createEngine(root);
    (engine as any).resolvePreflightUrl = jest
      .fn()
      .mockReturnValue('https://creator.douyin.com/');
    (engine as any).isSamePlatformBusinessPage = jest
      .fn()
      .mockReturnValue(true);
    (engine as any).gotoBestEffort = jest.fn().mockResolvedValue(undefined);
    (engine as any).recoverSessionFromLegacyProfile = jest
      .fn()
      .mockResolvedValue({
        page: {
          url: jest.fn().mockReturnValue('https://creator.douyin.com/'),
          locator: jest.fn().mockReturnValue({
            innerText: jest
              .fn()
              .mockResolvedValue('抖音创作者中心 作品发布 数据中心'),
          }),
        },
      });
    (engine as any).getOrCreateSession = jest.fn().mockResolvedValue({
      page: {
        url: jest
          .fn()
          .mockReturnValue(
            'https://creator.douyin.com/creator-micro/content/manage',
          ),
        locator: jest.fn().mockReturnValue({
          innerText: jest
            .fn()
            .mockResolvedValue('扫码登录 验证码登录 登录/注册'),
        }),
      },
    });

    const result = await engine.preflightPlatform({
      platform: 'douyin',
      accountId: 4,
    });

    expect(
      (engine as any).recoverSessionFromLegacyProfile,
    ).toHaveBeenCalledWith({
      accountId: 4,
      platform: 'douyin',
      taskType: undefined,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        loginRequired: false,
      }),
    );
  });
});
