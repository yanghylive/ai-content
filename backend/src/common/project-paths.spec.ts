import { join, resolve } from 'node:path';
import {
  resolveProjectDataPath,
  resolveProjectLogPath,
  resolveRuntimeStateRoot,
} from './project-paths';

describe('project runtime paths', () => {
  const originalStateRoot = process.env.KAYPAL_RUNTIME_STATE_ROOT;
  const originalLogRoot = process.env.KAYPAL_RUNTIME_LOG_ROOT;

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
  });

  it('keeps writable state and logs under explicit desktop roots', () => {
    process.env.KAYPAL_RUNTIME_STATE_ROOT = '/tmp/kaypal-runtime-state';
    process.env.KAYPAL_RUNTIME_LOG_ROOT = '/tmp/kaypal-runtime-logs';

    expect(resolveRuntimeStateRoot('/Applications/Kaypal.app/Contents/Resources/backend')).toBe(
      resolve('/tmp/kaypal-runtime-state'),
    );
    expect(resolveProjectDataPath('growth', 'growth-store.json')).toBe(
      join('/tmp/kaypal-runtime-state', 'growth', 'growth-store.json'),
    );
    expect(resolveProjectLogPath('evidence', 'desktop.png')).toBe(
      join('/tmp/kaypal-runtime-logs', 'evidence', 'desktop.png'),
    );
  });
});
