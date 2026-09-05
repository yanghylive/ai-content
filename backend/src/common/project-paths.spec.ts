import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  resolveDesktopUserDataDir,
  resolveProjectDataPath,
  resolveProjectLogPath,
  resolveRuntimeStateRoot,
} from './project-paths';

describe('project runtime paths', () => {
  const originalStateRoot = process.env.KAYPAL_RUNTIME_STATE_ROOT;
  const originalLogRoot = process.env.KAYPAL_RUNTIME_LOG_ROOT;
  const originalUserDataDir = process.env.KAYPAL_DESKTOP_USER_DATA_DIR;

  afterEach(() => {
    if (originalStateRoot === undefined) {
      delete process.env.KAYPAL_RUNTIME_STATE_ROOT;
    } else {
      process.env.KAYPAL_RUNTIME_STATE_ROOT = originalStateRoot;
    }
    if (originalLogRoot === undefined) {
      delete process.env.KAYPAL_RUNTIME_LOG_ROOT;
    } else {
      process.env.KAYPAL_RUNTIME_LOG_ROOT = originalLogRoot;
    }
    if (originalUserDataDir === undefined) {
      delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    } else {
      process.env.KAYPAL_DESKTOP_USER_DATA_DIR = originalUserDataDir;
    }
  });

  it('keeps writable state and logs under explicit desktop roots', () => {
    process.env.KAYPAL_RUNTIME_STATE_ROOT = '/tmp/kaypal-runtime-state';
    process.env.KAYPAL_RUNTIME_LOG_ROOT = '/tmp/kaypal-runtime-logs';

    expect(
      resolveRuntimeStateRoot(
        '/Applications/Kaypal.app/Contents/Resources/backend',
      ),
    ).toBe(resolve('/tmp/kaypal-runtime-state'));
    expect(resolveProjectDataPath('growth', 'growth-store.json')).toBe(
      join('/tmp/kaypal-runtime-state', 'growth', 'growth-store.json'),
    );
    expect(resolveProjectLogPath('evidence', 'desktop.png')).toBe(
      join('/tmp/kaypal-runtime-logs', 'evidence', 'desktop.png'),
    );
  });

  // 防回归：Windows Program Files 安装下 UAC 拒写 resources/data（真机 EPERM P0，
  // commit cb2213b3）。桌面端注入 KAYPAL_DESKTOP_USER_DATA_DIR 后，状态与日志
  // 必须全部落到用户数据目录，绝不落安装目录。
  it('routes state and logs under desktop user-data dir when injected', () => {
    delete process.env.KAYPAL_RUNTIME_STATE_ROOT;
    delete process.env.KAYPAL_RUNTIME_LOG_ROOT;
    process.env.KAYPAL_DESKTOP_USER_DATA_DIR =
      'C:\\Users\\demo\\AppData\\Roaming\\ai-content-desktop';

    const backendCwd =
      'D:\\Program Files\\ai-content-desktop\\resources\\backend';
    expect(resolveRuntimeStateRoot(backendCwd)).toBe(
      join(
        'C:\\Users\\demo\\AppData\\Roaming\\ai-content-desktop',
        'data',
      ),
    );
    // growth store 快照（EPERM 报错点）必须落在用户数据目录
    expect(
      resolveProjectDataPath('growth', 'growth-store.json'),
    ).not.toContain('Program Files');
    expect(resolveProjectDataPath('growth', 'growth-store.json')).toBe(
      join(
        'C:\\Users\\demo\\AppData\\Roaming\\ai-content-desktop',
        'data',
        'growth',
        'growth-store.json',
      ),
    );
    expect(resolveProjectLogPath('backend-launch.log')).toBe(
      join(
        'C:\\Users\\demo\\AppData\\Roaming\\ai-content-desktop',
        'data',
        '.local-logs',
        'backend-launch.log',
      ),
    );
  });

  it('falls back to project root only without desktop env (dev mode)', () => {
    delete process.env.KAYPAL_RUNTIME_STATE_ROOT;
    delete process.env.KAYPAL_RUNTIME_LOG_ROOT;
    delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;

    const devBackendCwd = '/Users/demo/proj/backend';
    const expectedRoot = resolve(devBackendCwd, '..', 'data');
    expect(resolveRuntimeStateRoot(devBackendCwd)).toBe(expectedRoot);
  });
});

// 2026-09-05 复核五轮（大王打回）：resolveDesktopUserDataDir 此前无任何单测。
// 覆盖：env 优先 / 三平台默认推导 / 目录不存在 fail-closed / HOME 缺失 fail-closed。
describe('resolveDesktopUserDataDir', () => {
  const originalPlatform = process.platform;
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfig = process.env.XDG_CONFIG_HOME;
  const originalUserDataDir = process.env.KAYPAL_DESKTOP_USER_DATA_DIR;

  const setPlatform = (p: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', { value: p });
  };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (originalXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfig;
    if (originalUserDataDir === undefined) delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    else process.env.KAYPAL_DESKTOP_USER_DATA_DIR = originalUserDataDir;
  });

  it('env KAYPAL_DESKTOP_USER_DATA_DIR wins over any platform default', () => {
    process.env.KAYPAL_DESKTOP_USER_DATA_DIR = '/explicit/user-data';
    setPlatform('darwin');
    expect(resolveDesktopUserDataDir()).toBe('/explicit/user-data');
  });

  it('darwin: derives ~/Library/Application Support/ai-content-desktop when it exists', () => {
    delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    const home = mkdtempSync(join(tmpdir(), 'kaypal-home-darwin-'));
    try {
      const expected = join(home, 'Library', 'Application Support', 'ai-content-desktop');
      mkdirSync(expected, { recursive: true });
      process.env.HOME = home;
      delete process.env.APPDATA;
      setPlatform('darwin');
      expect(resolveDesktopUserDataDir()).toBe(expected);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('win32: derives %APPDATA%\\ai-content-desktop when it exists', () => {
    delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    const appData = mkdtempSync(join(tmpdir(), 'kaypal-appdata-win-'));
    try {
      const expected = join(appData, 'ai-content-desktop');
      mkdirSync(expected, { recursive: true });
      delete process.env.HOME;
      process.env.APPDATA = appData;
      setPlatform('win32');
      expect(resolveDesktopUserDataDir()).toBe(expected);
    } finally {
      rmSync(appData, { recursive: true, force: true });
    }
  });

  it('linux: derives $XDG_CONFIG_HOME/ai-content-desktop, falling back to ~/.config', () => {
    delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    const home = mkdtempSync(join(tmpdir(), 'kaypal-home-linux-'));
    try {
      const expected = join(home, '.config', 'ai-content-desktop');
      mkdirSync(expected, { recursive: true });
      process.env.HOME = home;
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.APPDATA;
      setPlatform('linux');
      expect(resolveDesktopUserDataDir()).toBe(expected);

      // XDG 覆盖默认 ~/.config
      const xdg = mkdtempSync(join(tmpdir(), 'kaypal-xdg-linux-'));
      try {
        const expectedXdg = join(xdg, 'ai-content-desktop');
        mkdirSync(expectedXdg, { recursive: true });
        process.env.XDG_CONFIG_HOME = xdg;
        expect(resolveDesktopUserDataDir()).toBe(expectedXdg);
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fail-closed: returns null when the derived directory does not exist', () => {
    delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    const home = mkdtempSync(join(tmpdir(), 'kaypal-home-empty-'));
    try {
      process.env.HOME = home; // 目录存在但 ai-content-desktop 不存在
      delete process.env.APPDATA;
      delete process.env.XDG_CONFIG_HOME;
      setPlatform('darwin');
      expect(resolveDesktopUserDataDir()).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fail-closed: returns null when HOME is missing on unix', () => {
    delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    delete process.env.HOME;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
    setPlatform('darwin');
    expect(resolveDesktopUserDataDir()).toBeNull();
  });
});

