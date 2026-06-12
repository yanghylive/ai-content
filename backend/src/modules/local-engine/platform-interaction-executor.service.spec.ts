import { PlatformInteractionExecutor } from './platform-interaction-executor.service';

describe('PlatformInteractionExecutor', () => {
  it('opens account entries through the persistent CDP session and loads cookiesFile state', async () => {
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://creator.douyin.com/creator-micro/content/manage'),
    };
    const browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-1',
        accountId: '1',
        platform: 'douyin',
        page,
        profileDir: '/profiles/douyin-1',
        visibleWindow: true,
        debuggingPort: 9233,
        browser: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        browserReused: true,
        lastActivityAt: 'old',
      }),
      loadStorageStateCookies: jest.fn().mockResolvedValue(3),
    };
    const executor = new PlatformInteractionExecutor({} as any, browser as any);

    const result = await executor.openAccount({
      platform: 'douyin',
      accountId: 1,
      url: 'https://creator.douyin.com/creator-micro/content/manage',
      storagePath: '/cookies/douyin.json',
    });

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: 1,
    });
    expect(browser.loadStorageStateCookies).toHaveBeenCalledWith({
      sessionKey: 'douyin-1',
      storagePath: '/cookies/douyin.json',
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://creator.douyin.com/creator-micro/content/manage',
      { waitUntil: 'domcontentloaded', timeout: 30000 },
    );
    expect(result).toEqual(
      expect.objectContaining({
        sessionKey: 'douyin-1',
        currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        profileDir: '/profiles/douyin-1',
        cdpPort: 9233,
        browserReused: true,
        runtimeMode: 'persistent-cdp-browser',
        loadedCookieCount: 3,
      }),
    );
  });
});
