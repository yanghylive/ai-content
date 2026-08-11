import type { Page } from 'playwright';
import {
  captureAccountIdentity,
  captureAvatarFromPage,
  detectDisplayNameFromPage,
  fetchDisplayNameFromPlatformApi,
  looksLikeDisplayName,
} from './identity-capture';

/** 最小 Page mock：只实现被测路径用到的成员 */
function makePage(overrides: Record<string, unknown> = {}): Page {
  const locator = (selector: string) => {
    const l = {
      count: jest.fn().mockResolvedValue(0),
      isVisible: jest.fn().mockResolvedValue(false),
      innerText: jest.fn().mockResolvedValue(''),
      hover: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    };
    return {
      ...l,
      first: () => l,
      selector,
    };
  };
  return {
    evaluate: jest.fn().mockResolvedValue(null),
    locator,
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    title: jest.fn().mockResolvedValue(''),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
    ...overrides,
  } as unknown as Page;
}

describe('looksLikeDisplayName', () => {
  it('accepts normal nicknames', () => {
    expect(looksLikeDisplayName('张三')).toBe(true);
    expect(looksLikeDisplayName('张三的店')).toBe(true);
    expect(looksLikeDisplayName('Leo_Wang')).toBe(true);
  });

  it('rejects nav words and file suffixes', () => {
    expect(looksLikeDisplayName('创作中心')).toBe(false);
    expect(looksLikeDisplayName('首页')).toBe(false);
    expect(looksLikeDisplayName('账号管理')).toBe(false);
    expect(looksLikeDisplayName('a.png')).toBe(false);
  });

  it('rejects empty / too long / too short', () => {
    expect(looksLikeDisplayName('')).toBe(false);
    expect(looksLikeDisplayName(null)).toBe(false);
    expect(looksLikeDisplayName('a')).toBe(false);
    expect(looksLikeDisplayName('x'.repeat(40))).toBe(false);
  });
});

describe('fetchDisplayNameFromPlatformApi', () => {
  it('reads douyin user_profile.nick_name', async () => {
    const page = makePage({
      evaluate: jest.fn().mockResolvedValue({
        user_profile: { nick_name: '测试号A' },
      }),
    });
    await expect(fetchDisplayNameFromPlatformApi(page, 3)).resolves.toBe(
      '测试号A',
    );
  });

  it('falls back to next endpoint when first returns null', async () => {
    const page = makePage({
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ user: { nickname: 'B站用户' } }),
    });
    await expect(fetchDisplayNameFromPlatformApi(page, 3)).resolves.toBe(
      'B站用户',
    );
  });

  it('reads bilibili nav uname', async () => {
    const page = makePage({
      evaluate: jest.fn().mockResolvedValue({ data: { uname: 'B站UP主' } }),
    });
    await expect(fetchDisplayNameFromPlatformApi(page, 5)).resolves.toBe(
      'B站UP主',
    );
  });

  it('returns null when platform unsupported', async () => {
    const page = makePage();
    await expect(fetchDisplayNameFromPlatformApi(page, 1)).resolves.toBeNull();
  });
});

describe('captureAvatarFromPage', () => {
  it('captures via platform selector when visible', async () => {
    const visibleLocator = {
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(true),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    };
    const page = makePage({
      locator: jest.fn().mockReturnValue({ first: () => visibleLocator }),
    });
    const avatarDir = '/tmp/identity-capture-test-avatars';
    await expect(
      captureAvatarFromPage(page, 'account_9.png', avatarDir, 3),
    ).resolves.toBe('account_9.png');
    expect(visibleLocator.screenshot).toHaveBeenCalledTimes(1);
  });

  it('falls back to DOM scoring when no selector matches', async () => {
    const invisibleLocator = {
      count: jest.fn().mockResolvedValue(0),
      isVisible: jest.fn().mockResolvedValue(false),
    };
    const scoredLocator = {
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(true),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    };
    const page = makePage({
      locator: jest
        .fn()
        .mockImplementation((selector: string) =>
          selector === '[data-sau-avatar-candidate="1"]'
            ? { first: () => scoredLocator }
            : { first: () => invisibleLocator },
        ),
      evaluate: jest.fn().mockResolvedValue(true),
    });
    const avatarDir = '/tmp/identity-capture-test-avatars';
    await expect(
      captureAvatarFromPage(page, 'account_10.png', avatarDir, 3),
    ).resolves.toBe('account_10.png');
    expect(scoredLocator.screenshot).toHaveBeenCalledTimes(1);
  });

  it('returns null when nothing found', async () => {
    const invisibleLocator = {
      count: jest.fn().mockResolvedValue(0),
      isVisible: jest.fn().mockResolvedValue(false),
    };
    const page = makePage({
      locator: jest.fn().mockReturnValue({ first: () => invisibleLocator }),
      evaluate: jest.fn().mockResolvedValue(false),
    });
    await expect(
      captureAvatarFromPage(page, 'account_11.png', '/tmp/x', 1),
    ).resolves.toBeNull();
  });
});

describe('detectDisplayNameFromPage', () => {
  it('returns api name first (douyin)', async () => {
    const page = makePage({
      evaluate: jest.fn().mockResolvedValue({
        user_profile: { nick_name: 'API昵称' },
      }),
    });
    await expect(detectDisplayNameFromPage(page, 3)).resolves.toBe('API昵称');
  });

  it('falls back to DOM scoring when api and selectors miss', async () => {
    const invisibleLocator = {
      count: jest.fn().mockResolvedValue(0),
      isVisible: jest.fn().mockResolvedValue(false),
    };
    const page = makePage({
      locator: jest.fn().mockReturnValue({ first: () => invisibleLocator }),
      // 第一次 evaluate = 抖音 API → null；第二次 = 抖音 hover 脚本 → null；第三次 = 评分脚本 → 昵称
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('评分昵称'),
    });
    await expect(detectDisplayNameFromPage(page, 3)).resolves.toBe('评分昵称');
  });
});

describe('captureAccountIdentity', () => {
  it('returns avatar file name + display name', async () => {
    const visibleLocator = {
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(true),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    };
    const page = makePage({
      locator: jest.fn().mockReturnValue({ first: () => visibleLocator }),
      evaluate: jest.fn().mockResolvedValue({
        user_profile: { nick_name: '综合昵称' },
      }),
    });
    const result = await captureAccountIdentity(
      page,
      3,
      42,
      '/tmp/identity-capture-test-avatars',
    );
    expect(result.avatarPath).toBe('account_42.png');
    expect(result.userName).toBe('综合昵称');
  });
});
