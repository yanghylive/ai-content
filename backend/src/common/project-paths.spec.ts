import { join, resolve } from 'node:path';
import {
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
