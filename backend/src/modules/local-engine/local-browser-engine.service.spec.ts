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

  function createEngine(root: string, panelBridge?: unknown) {
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
      panelBridge as any,
    );
  }

  /**
   * 复核 P0-1（账号强绑定）测试基建：绕过 NODE_ENV=test 的面板通道禁用，
   * spy 私有探测/连接方法，让 tryAcquireDesktopPanelSession 走到账号核验分支。
   */
  function spyOnPanelChannel(engine: LocalBrowserEngine) {
    const fakePage = {
      url: jest.fn().mockReturnValue('https://creator.douyin.com/creator-micro/home'),
      isClosed: jest.fn().mockReturnValue(false),
    };
    const fakeContext = { pages: jest.fn().mockReturnValue([fakePage]) };
    const fakeBrowser = { contexts: jest.fn().mockReturnValue([fakeContext]) };
    jest
      .spyOn(engine as any, 'panelCdpHttp')
      .mockReturnValue('http://127.0.0.1:9333');
    jest
      .spyOn(engine as any, 'probeDesktopPanelCdp')
      .mockResolvedValue(true);
    jest
      .spyOn(engine as any, 'connectPanelCdp')
      .mockResolvedValue(fakeBrowser);
    jest.spyOn(engine as any, 'acquirePanelPage').mockResolvedValue({
      context: fakeContext,
      page: fakePage,
    });
    (engine as any).panelSwitchMaxAttempts = 2;
    (engine as any).panelSwitchPollMs = 1;
    return { fakePage, fakeContext, fakeBrowser };
  }

  function makeFakePanelBridge(states: Array<Record<string, unknown> | Error>) {
    let call = 0;
    return {
      panelState: jest.fn().mockImplementation(() => {
        const s = states[Math.min(call, states.length - 1)];
        call += 1;
        if (s instanceof Error) return Promise.reject(s);
        return Promise.resolve(s);
      }),
      panelOpen: jest.fn().mockResolvedValue({ panelId: 'panel-x' }),
      _callCount: () => call,
    };
  }

  it('P0-1 账号强绑定：面板归属与请求账号一致 → 直接复用并登记 desktop-panel 会话', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const bridge = makeFakePanelBridge([
      { hasSession: true, accountId: '4', partition: 'persist:kaypal-browser-local-desktop-4' },
    ]);
    const engine = createEngine(root, bridge);
    const { fakePage } = spyOnPanelChannel(engine as any);

    const session = await (engine as any).tryAcquireDesktopPanelSession(
      { accountId: 4, platform: 'douyin' },
      'douyin-4',
    );
    expect(session).toBeTruthy();
    expect(session.sessionMode).toBe('desktop-panel');
    expect(session.accountId).toBe('4');
    expect(bridge.panelState).toHaveBeenCalledTimes(1);
    expect(bridge.panelOpen).not.toHaveBeenCalled();
    expect(fakePage.url).toHaveBeenCalled();
  });

  it('P0-1 账号强绑定：面板属于账号 B 而请求账号 A → panelOpen 切换 + 轮询核验后才复用', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    // 第一次核验：面板在账号 B(99)；panelOpen 切换后：核验到账号 A(4)
    const bridge = makeFakePanelBridge([
      { hasSession: true, accountId: '99' },
      { hasSession: true, accountId: '4' },
    ]);
    const engine = createEngine(root, bridge);
    spyOnPanelChannel(engine as any);

    const session = await (engine as any).tryAcquireDesktopPanelSession(
      { accountId: 4, platform: 'douyin' },
      'douyin-4',
    );
    expect(session).toBeTruthy();
    expect(session.accountId).toBe('4');
    expect(bridge.panelOpen).toHaveBeenCalledTimes(1);
    expect(bridge.panelOpen).toHaveBeenCalledWith(
      { ownerId: 'local-engine', tenantId: 'local-tenant' },
      expect.objectContaining({ accountId: '4', platform: 'douyin' }),
    );
    expect(bridge.panelState.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('P0-1 账号强绑定：切换后台账始终不匹配 → 拒绝登记（不按平台/URL 猜），返回 null 走兜底', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const bridge = makeFakePanelBridge([
      { hasSession: true, accountId: '99' }, // 一直是他人的账号
      { hasSession: true, accountId: '99' },
      { hasSession: true, accountId: '99' },
    ]);
    const engine = createEngine(root, bridge);
    const { fakeBrowser } = spyOnPanelChannel(engine as any);

    const session = await (engine as any).tryAcquireDesktopPanelSession(
      { accountId: 4, platform: 'douyin' },
      'douyin-4',
    );
    expect(session).toBeNull();
    expect(bridge.panelOpen).toHaveBeenCalledTimes(1);
    expect(engine.getSession('douyin-4')).toBeUndefined();
    expect(fakeBrowser.contexts).not.toHaveBeenCalled();
  });

  it('P0-1 账号强绑定：桥不可用（panel-state 失败）→ 拒绝复用，走兜底 spawn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const bridge = makeFakePanelBridge([new Error('PANEL_UNAVAILABLE')]);
    const engine = createEngine(root, bridge);
    spyOnPanelChannel(engine as any);

    const session = await (engine as any).tryAcquireDesktopPanelSession(
      { accountId: 4, platform: 'douyin' },
      'douyin-4',
    );
    expect(session).toBeNull();
    expect(engine.getSession('douyin-4')).toBeUndefined();
  });

  it('P0-1 账号 A/B 顺序：A 登记后面板被切到 B → A 的会话快路径复核 mismatch → 弃用重建', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const bridge = makeFakePanelBridge([
      { hasSession: true, accountId: '4' },  // A 首次获取
      { hasSession: true, accountId: '4' },  // A 快路径复核通过
      { hasSession: true, accountId: '99' }, // 面板被切到 B → A 快路径复核 mismatch
      { hasSession: true, accountId: '99' }, // A 重建：tryAcquire 核验仍 B → panelOpen 切回
      { hasSession: true, accountId: '4' },  // 切换后核验到 A → 重建登记
    ]);
    (engine as any).panelBridge = bridge;
    spyOnPanelChannel(engine as any);

    // A 首次获取
    const s1 = await (engine as any).tryAcquireDesktopPanelSession(
      { accountId: 4, platform: 'douyin' },
      'douyin-4',
    );
    expect(s1?.accountId).toBe('4');
    // A 再次获取（快路径，归属一致 → 复用）
    const again = await (engine as any).getOrCreateSession({ accountId: 4, platform: 'douyin' });
    expect(again.sessionMode).toBe('desktop-panel');
    // 模拟面板被切到账号 B：A 的快路径复核必须弃用（mismatch → closeSession → 重建）
    const rebuilt = await (engine as any).getOrCreateSession({ accountId: 4, platform: 'douyin' });
    expect(rebuilt.sessionMode).toBe('desktop-panel');
    expect(rebuilt.accountId).toBe('4');
    // panelOpen 在重建路径里被调用（切回账号 A）
    expect(bridge.panelOpen).toHaveBeenCalled();
  });

  // ---- 2026-09-05 复核 P0-1（二轮）：页面级绑定标记 + 并发互斥 ----

  /** 构造带绑定标记的假 page（desktop manager._injectPanelBindingMarker 注入形态） */
  function makeMarkedPanelPage(marker: Record<string, unknown> | null) {
    return {
      url: jest.fn().mockReturnValue('https://creator.douyin.com/creator-micro/home'),
      isClosed: jest.fn().mockReturnValue(false),
      evaluate: jest.fn().mockImplementation((expr: string) => {
        if (String(expr).includes('__kaypalPanelBinding')) {
          return Promise.resolve(marker);
        }
        return Promise.resolve(null);
      }),
    };
  }

  it('P0-1 页面级绑定：page 标记账号与请求不符 → 拒收（核验 A 后拿到 B 的 page 不再可能登记成 A）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    // 页面 URL 是 douyin（URL 初筛通过），但页面自带标记属于账号 99 / panel-b
    // ——模拟 A 核验通过后面板被 B 切走的 interleave：A 必须拒收。
    const pageB = makeMarkedPanelPage({
      panelId: 'panel-b',
      accountId: '99',
      partition: 'persist:kaypal-browser-local-desktop-99',
    });
    const context = { pages: jest.fn().mockReturnValue([pageB]) };
    const browser = { contexts: jest.fn().mockReturnValue([context]) };

    const got = await (engine as any).acquirePanelPage(
      browser,
      'douyin',
      'https://creator.douyin.com/creator-micro/home',
      { wantAccount: '4', panelId: 'panel-a' },
      1, // waitRounds=1 加速测试
    );
    expect(got).toBeNull();
    expect(pageB.evaluate).toHaveBeenCalled();
  });

  it('P0-1 页面级绑定：page 标记与请求账号/panelId 一致 → 收页', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const pageA = makeMarkedPanelPage({
      panelId: 'panel-a',
      accountId: '4',
      partition: 'persist:kaypal-browser-local-desktop-4',
    });
    const context = { pages: jest.fn().mockReturnValue([pageA]) };
    const browser = { contexts: jest.fn().mockReturnValue([context]) };

    const got = await (engine as any).acquirePanelPage(
      browser,
      'douyin',
      'https://creator.douyin.com/creator-micro/home',
      { wantAccount: '4', panelId: 'panel-a' },
      1,
    );
    expect(got).toBeTruthy();
    expect(got.page).toBe(pageA);
  });

  it('P0-1 页面级绑定：标记缺失/evaluate 失败 = 无法证明归属 → 拒收（fail-closed）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const pageNoMarker = makeMarkedPanelPage(null);
    const pageBroken = {
      url: jest.fn().mockReturnValue('https://creator.douyin.com/creator-micro/home'),
      isClosed: jest.fn().mockReturnValue(false),
      evaluate: jest.fn().mockRejectedValue(new Error('Execution context destroyed')),
    };
    const context = { pages: jest.fn().mockReturnValue([pageNoMarker, pageBroken]) };
    const browser = { contexts: jest.fn().mockReturnValue([context]) };

    const got = await (engine as any).acquirePanelPage(
      browser,
      'douyin',
      'https://creator.douyin.com/creator-micro/home',
      { wantAccount: '4', panelId: 'panel-a' },
      1,
    );
    expect(got).toBeNull();
  });

  it('P0-1 并发互斥：A/B 并发获取面板会话时「核验→取页→登记」整体串行（panelState 调用无重叠）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const bridge = makeFakePanelBridge([
      { hasSession: true, accountId: '4', panelId: 'panel-x' },
    ]);
    (engine as any).panelBridge = bridge;
    spyOnPanelChannel(engine as any);

    let inflight = 0;
    let maxInflight = 0;
    bridge.panelState.mockImplementation(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight -= 1;
      return { hasSession: true, accountId: '4', panelId: 'panel-x' };
    });

    // 两个不同 key 的会话并发走面板获取（同一块物理面板）
    const [s1, s2] = await Promise.all([
      (engine as any).tryAcquireDesktopPanelSession(
        { accountId: 4, platform: 'douyin' },
        'douyin-4',
      ),
      (engine as any).tryAcquireDesktopPanelSession(
        { accountId: 4, platform: 'douyin' },
        'douyin-4-b',
      ),
    ]);
    expect(s1).toBeTruthy();
    expect(s2).toBeTruthy();
    expect(maxInflight).toBe(1);
  });

  it('P0-2 引擎面板写闸门：desktop-panel 会话 fill → requestAction（autoApproved）+ consumed 回写', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const bridge = makeFakePanelBridge([]) as any;
    bridge.requestAction = jest.fn().mockResolvedValue({
      actionId: 'act-f1',
      autoApproved: true,
    });
    bridge.markInteractionTicket = jest.fn().mockResolvedValue(undefined);
    (engine as any).panelBridge = bridge;
    const fakePage = { fill: jest.fn().mockResolvedValue(undefined) };
    (engine as any).sessions.set('douyin-4', {
      key: 'douyin-4',
      accountId: '4',
      platform: 'douyin',
      profileDir: '',
      context: {},
      page: fakePage,
      sessionMode: 'desktop-panel',
      lastActivityAt: '',
    });

    await (engine as any).fill('douyin-4', '.editor', 'hello');

    expect(bridge.requestAction).toHaveBeenCalledWith(
      { ownerId: 'local-engine', tenantId: 'local-tenant' },
      expect.objectContaining({ method: 'Input.insertText' }),
    );
    expect(fakePage.fill).toHaveBeenCalled();
    expect(bridge.markInteractionTicket).toHaveBeenCalledWith(
      'act-f1',
      'consumed',
    );
  });

  it('P0-2 引擎面板写闸门：用户接管（非自动批）→ fill 抛需确认（fail-closed），页面未被写入', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const bridge = makeFakePanelBridge([]) as any;
    bridge.requestAction = jest.fn().mockResolvedValue({
      actionId: 'act-f2',
      autoApproved: false,
    });
    bridge.markInteractionTicket = jest.fn().mockResolvedValue(undefined);
    (engine as any).panelBridge = bridge;
    const fakePage = { fill: jest.fn().mockResolvedValue(undefined) };
    (engine as any).sessions.set('douyin-4', {
      key: 'douyin-4',
      accountId: '4',
      platform: 'douyin',
      profileDir: '',
      context: {},
      page: fakePage,
      sessionMode: 'desktop-panel',
      lastActivityAt: '',
    });

    await expect(
      (engine as any).fill('douyin-4', '.editor', 'x'),
    ).rejects.toThrow(/需用户确认/);
    expect(fakePage.fill).not.toHaveBeenCalled();
    expect(bridge.markInteractionTicket).not.toHaveBeenCalled();
  });

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

  it('sweeps detached managed browser processes on shutdown after a crash', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const terminate = jest
      .spyOn(engine as any, 'terminateProcessesUsingProfile')
      .mockImplementation(() => undefined);

    await engine.onModuleDestroy();

    expect(terminate).toHaveBeenCalledWith(join(root, 'profiles'));
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

  it('does NOT steal another account\'s logged-in session for a different account (multi-account isolation)', async () => {
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
    // 请求其他账号（accountId=4）时，必须按账号独立创建 profile，禁止抢占 douyin-1。
    (engine as any).profiles.ensureProfileExists = jest
      .fn()
      .mockReturnValue(join(root, 'profiles', 'douyin-4'));
    (engine as any).profiles.ensureProfileCookiesCurrent = jest
      .fn()
      .mockResolvedValue(undefined);
    (engine as any).launchCdpContextWithRecovery = jest
      .fn()
      .mockRejectedValue(new Error('launch blocked in test'));

    await expect(
      engine.getOrCreateSession({
        platform: 'douyin',
        accountId: 4,
      }),
    ).rejects.toThrow('launch blocked in test');

    // 账号 1 的会话保持不动（未被过户/删除）
    expect(engine.getSession('douyin-1')).toBeDefined();
    expect(loggedInPage.bringToFront).not.toHaveBeenCalled();
    expect(engine.getSession('douyin-4')).toBeUndefined();
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
        reuseLoggedInSession: false,
      }),
    ).rejects.toThrow('launch blocked in test');

    expect(marketingPage.bringToFront).not.toHaveBeenCalled();
  });

  it('does NOT steal a real WeChat Channel backend page session for a different account', async () => {
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
    (engine as any).profiles.ensureProfileExists = jest
      .fn()
      .mockReturnValue(join(root, 'profiles', 'wechat-channel-4'));
    (engine as any).profiles.ensureProfileCookiesCurrent = jest
      .fn()
      .mockResolvedValue(undefined);
    (engine as any).launchCdpContextWithRecovery = jest
      .fn()
      .mockRejectedValue(new Error('launch blocked in test'));

    await expect(
      engine.getOrCreateSession({
        platform: 'wechat-channel',
        accountId: 4,
      }),
    ).rejects.toThrow('launch blocked in test');

    expect(engine.getSession('wechat-channel-1')).toBeDefined();
    expect(loggedInPage.bringToFront).not.toHaveBeenCalled();
  });

  it('treats a WeChat Channel backend URL without login prompts as authenticated while content is loading', async () => {
    const root = mkdtempSync(join(tmpdir(), 'local-browser-engine-'));
    roots.push(root);
    const engine = createEngine(root);
    const page = {
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/private_msg'),
      locator: jest.fn().mockReturnValue({
        innerText: jest.fn().mockResolvedValue('视频号助手 正在加载'),
      }),
    };

    await expect(
      (engine as any).pageLooksLoggedIn(page, 'wechat-channel'),
    ).resolves.toBe(true);
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
