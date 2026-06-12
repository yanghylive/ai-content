import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CdpBrowserProfileService } from './cdp-browser-profile.service';

describe('CdpBrowserProfileService', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('imports legacy account cookie file from publish account config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-profile-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const legacyRoot = join(root, 'legacy-auto-upload');
    const legacyCookiePath = join(legacyRoot, 'cookiesFile', 'wechat-account.json');
    mkdirSync(join(legacyRoot, 'cookiesFile'), { recursive: true });
    writeFileSync(
      legacyCookiePath,
      JSON.stringify({
        cookies: [
          {
            name: 'wx-session',
            value: 'redacted',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
          {
            name: 'douyin-session',
            value: 'redacted',
            domain: '.douyin.com',
            path: '/',
          },
        ],
        origins: [
          { origin: 'https://channels.weixin.qq.com', localStorage: [] },
          { origin: 'https://creator.douyin.com', localStorage: [] },
        ],
      }),
    );

    const service = new CdpBrowserProfileService(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT') return profileRoot;
          if (key === 'LEGACY_AUTO_UPLOAD_ROOT') return legacyRoot;
          return undefined;
        }),
      } as any,
      {
        publishAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'local-engine-4',
              platform: 'wechat-channel',
              config: {
                engineAccountId: 4,
                filePath: 'wechat-account.json',
                platformType: 2,
              },
              createdAt: new Date(),
            },
          ]),
        },
      } as any,
    );

    await service.ensureProfileCookiesCurrent('wechat-channel', '4');

    const imported = JSON.parse(
      readFileSync(
        join(profileRoot, 'wechat-channel-4', '.login-cookies.json'),
        'utf8',
      ),
    );
    expect(imported.cookies).toHaveLength(1);
    expect(imported.cookies[0].domain).toBe('channels.weixin.qq.com');
    expect(imported.origins).toEqual([
      { origin: 'https://channels.weixin.qq.com', localStorage: [] },
    ]);
  });

  it('rewrites stale mixed cookies with platform-only legacy cookies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-profile-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const legacyRoot = join(root, 'legacy-auto-upload');
    const profileDir = join(profileRoot, 'wechat-channel-4');
    const legacyCookiePath = join(legacyRoot, 'cookiesFile', 'mixed.json');
    mkdirSync(join(legacyRoot, 'cookiesFile'), { recursive: true });
    mkdirSync(profileDir, { recursive: true });

    writeFileSync(
      legacyCookiePath,
      JSON.stringify({
        cookies: [
          {
            name: 'wx-session',
            value: 'redacted',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
          {
            name: 'douyin-session',
            value: 'redacted',
            domain: '.douyin.com',
            path: '/',
          },
        ],
      }),
    );
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [
          {
            name: 'douyin-session',
            value: 'old',
            domain: '.douyin.com',
            path: '/',
          },
        ],
      }),
    );

    const service = new CdpBrowserProfileService(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT') return profileRoot;
          if (key === 'LEGACY_AUTO_UPLOAD_ROOT') return legacyRoot;
          return undefined;
        }),
      } as any,
      {
        publishAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'local-engine-4',
              platform: 'wechat-channel',
              config: {
                engineAccountId: 4,
                filePath: 'mixed.json',
                platformType: 2,
              },
              createdAt: new Date(),
            },
          ]),
        },
      } as any,
    );

    await service.ensureProfileCookiesCurrent('wechat-channel', '4');

    const imported = JSON.parse(
      readFileSync(join(profileDir, '.login-cookies.json'), 'utf8'),
    );
    expect(imported.cookies).toHaveLength(1);
    expect(imported.cookies[0].domain).toBe('channels.weixin.qq.com');
  });

  it('prefers legacy interaction browser profile over generic platform profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-profile-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const legacyRoot = join(root, 'legacy-auto-upload');
    const genericProfile = join(legacyRoot, 'browser-profiles', 'wechat-channel-4');
    const interactionProfile = join(
      legacyRoot,
      'browser-profiles',
      'interaction',
      'wechat-channel',
      '4',
    );

    mkdirSync(join(genericProfile, 'Default'), { recursive: true });
    mkdirSync(join(interactionProfile, 'Default'), { recursive: true });
    writeFileSync(join(genericProfile, 'Local State'), '{}');
    writeFileSync(join(genericProfile, 'Default', 'Preferences'), '{}');
    writeFileSync(join(genericProfile, 'profile-source.txt'), 'generic');
    writeFileSync(join(interactionProfile, 'Local State'), '{}');
    writeFileSync(join(interactionProfile, 'Default', 'Preferences'), '{}');
    writeFileSync(join(interactionProfile, 'profile-source.txt'), 'interaction');

    const service = new CdpBrowserProfileService(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT') return profileRoot;
          if (key === 'LEGACY_AUTO_UPLOAD_ROOT') return legacyRoot;
          return undefined;
        }),
      } as any,
      {
        publishAccount: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as any,
    );

    const restored = service.restoreLegacyProfileSnapshot('wechat-channel', '4');

    expect(restored).toBe(join(profileRoot, 'wechat-channel-4'));
    expect(
      readFileSync(
        join(profileRoot, 'wechat-channel-4', 'profile-source.txt'),
        'utf8',
      ),
    ).toBe('interaction');
    const marker = JSON.parse(
      readFileSync(
        join(profileRoot, 'wechat-channel-4', '.legacy-profile-imported.json'),
        'utf8',
      ),
    ) as { source: string };
    expect(marker.source).toBe(interactionProfile);
  });

  it('does not overwrite cookies after importing a legacy browser profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-profile-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const legacyRoot = join(root, 'legacy-auto-upload');
    const profileDir = join(profileRoot, 'wechat-channel-4');
    const legacyCookiePath = join(legacyRoot, 'cookiesFile', 'wechat-account.json');
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(join(legacyRoot, 'cookiesFile'), { recursive: true });
    writeFileSync(
      join(profileDir, '.legacy-profile-imported.json'),
      JSON.stringify({
        source: join(legacyRoot, 'browser-profiles', 'interaction', 'wechat-channel', '4'),
        importedAt: new Date().toISOString(),
      }),
    );
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [
          {
            name: 'sessionid',
            value: 'profile-cookie',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
        ],
      }),
    );
    writeFileSync(
      legacyCookiePath,
      JSON.stringify({
        cookies: [
          {
            name: 'sessionid',
            value: 'account-cookie',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
        ],
      }),
    );

    const service = new CdpBrowserProfileService(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT') return profileRoot;
          if (key === 'LEGACY_AUTO_UPLOAD_ROOT') return legacyRoot;
          return undefined;
        }),
      } as any,
      {
        publishAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'local-engine-4',
              platform: 'wechat-channel',
              config: {
                engineAccountId: 4,
                filePath: 'wechat-account.json',
                platformType: 2,
              },
              createdAt: new Date(),
            },
          ]),
        },
      } as any,
    );

    await service.ensureProfileCookiesCurrent('wechat-channel', '4');

    const stored = JSON.parse(
      readFileSync(join(profileDir, '.login-cookies.json'), 'utf8'),
    );
    expect(stored.cookies[0].value).toBe('profile-cookie');
  });

  it('does not enqueue account cookie import when ensureProfileExists imports legacy browser profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-profile-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const legacyRoot = join(root, 'legacy-auto-upload');
    const interactionProfile = join(
      legacyRoot,
      'browser-profiles',
      'interaction',
      'wechat-channel',
      '4',
    );
    const legacyCookiePath = join(legacyRoot, 'cookiesFile', 'wechat-account.json');

    mkdirSync(join(interactionProfile, 'Default'), { recursive: true });
    mkdirSync(join(legacyRoot, 'cookiesFile'), { recursive: true });
    writeFileSync(join(interactionProfile, 'Local State'), '{}');
    writeFileSync(join(interactionProfile, 'Default', 'Preferences'), '{}');
    writeFileSync(
      join(interactionProfile, '.login-cookies.json'),
      JSON.stringify({
        cookies: [
          {
            name: 'sessionid',
            value: 'profile-cookie',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
        ],
      }),
    );
    writeFileSync(
      legacyCookiePath,
      JSON.stringify({
        cookies: [
          {
            name: 'sessionid',
            value: 'account-cookie',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
        ],
      }),
    );

    const service = new CdpBrowserProfileService(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT') return profileRoot;
          if (key === 'LEGACY_AUTO_UPLOAD_ROOT') return legacyRoot;
          return undefined;
        }),
      } as any,
      {
        publishAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'local-engine-4',
              platform: 'wechat-channel',
              config: {
                engineAccountId: 4,
                filePath: 'wechat-account.json',
                platformType: 2,
              },
              createdAt: new Date(),
            },
          ]),
        },
      } as any,
    );

    service.ensureProfileExists('wechat-channel', '4');
    await new Promise((resolve) => setImmediate(resolve));

    const stored = JSON.parse(
      readFileSync(
        join(profileRoot, 'wechat-channel-4', '.login-cookies.json'),
        'utf8',
      ),
    );
    expect(stored.cookies[0].value).toBe('profile-cookie');
  });

  it('creates login cookies from legacy account file when imported browser profile has none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-profile-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const legacyRoot = join(root, 'legacy-auto-upload');
    const interactionProfile = join(
      legacyRoot,
      'browser-profiles',
      'interaction',
      'wechat-channel',
      '4',
    );
    const legacyCookiePath = join(legacyRoot, 'cookiesFile', 'wechat-account.json');

    mkdirSync(join(interactionProfile, 'Default'), { recursive: true });
    mkdirSync(join(legacyRoot, 'cookiesFile'), { recursive: true });
    writeFileSync(join(interactionProfile, 'Local State'), '{}');
    writeFileSync(join(interactionProfile, 'Default', 'Preferences'), '{}');
    writeFileSync(
      legacyCookiePath,
      JSON.stringify({
        cookies: [
          {
            name: 'sessionid',
            value: 'account-cookie',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
          {
            name: 'douyin-session',
            value: 'wrong-platform',
            domain: '.douyin.com',
            path: '/',
          },
        ],
      }),
    );

    const service = new CdpBrowserProfileService(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT') return profileRoot;
          if (key === 'LEGACY_AUTO_UPLOAD_ROOT') return legacyRoot;
          return undefined;
        }),
      } as any,
      {
        publishAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'local-engine-4',
              platform: 'wechat-channel',
              config: {
                engineAccountId: 4,
                filePath: 'wechat-account.json',
                platformType: 2,
              },
              createdAt: new Date(),
            },
          ]),
        },
      } as any,
    );

    service.ensureProfileExists('wechat-channel', '4');
    await new Promise((resolve) => setImmediate(resolve));

    const stored = JSON.parse(
      readFileSync(
        join(profileRoot, 'wechat-channel-4', '.login-cookies.json'),
        'utf8',
      ),
    );
    expect(stored.cookies).toHaveLength(1);
    expect(stored.cookies[0].value).toBe('account-cookie');
  });

  it('does not import legacy cookies without explicit legacy root config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-profile-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const legacyRoot = join(root, 'legacy-auto-upload');
    const legacyCookiePath = join(legacyRoot, 'cookiesFile', 'wechat-account.json');
    mkdirSync(join(legacyRoot, 'cookiesFile'), { recursive: true });
    writeFileSync(
      legacyCookiePath,
      JSON.stringify({
        cookies: [
          {
            name: 'wx-session',
            value: 'redacted',
            domain: 'channels.weixin.qq.com',
            path: '/',
          },
        ],
      }),
    );

    const service = new CdpBrowserProfileService(
      {
        get: jest.fn((key: string) => {
          if (key === 'LOCAL_BROWSER_PROFILE_ROOT') return profileRoot;
          return undefined;
        }),
      } as any,
      {
        publishAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'local-engine-4',
              platform: 'wechat-channel',
              config: {
                engineAccountId: 4,
                filePath: 'wechat-account.json',
                platformType: 2,
              },
              createdAt: new Date(),
            },
          ]),
        },
      } as any,
    );

    await service.ensureProfileCookiesCurrent('wechat-channel', '4');

    expect(() =>
      readFileSync(
        join(profileRoot, 'wechat-channel-4', '.login-cookies.json'),
        'utf8',
      ),
    ).toThrow();
  });
});
