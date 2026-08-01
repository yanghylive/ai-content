import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { BadRequestException } from '@nestjs/common';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalEngineService } from './local-engine.service';

describe('LocalEngineService WeChat contacts cache', () => {
  let root: string;
  let service: any;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'local-engine-wechat-contacts-'));
    service = Object.create(LocalEngineService.prototype);
    service.getProjectRoot = jest.fn(() => root);
    service.getRuntimePlatform = jest.fn(() => 'darwin');
    service.resolveWechatContactSyncScriptPath = jest.fn(() =>
      join(root, 'wechat-contact-sync.py'),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads legacy string contacts as structured items', async () => {
    const cachePath = join(root, '.local-logs', 'wechat-contacts.json');
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        source: 'legacy-cache',
        contacts: ['客户A', '客户A', '客户B'],
        syncedAt: '2026-06-22T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await service.getWechatContacts();

    expect(result.source).toBe('legacy-cache');
    expect(result.contacts).toEqual(['客户A', '客户B']);
    expect(result.items).toEqual([
      expect.objectContaining({ wxid: '客户A', nickname: '客户A', tags: [] }),
      expect.objectContaining({ wxid: '客户B', nickname: '客户B', tags: [] }),
    ]);
    expect(result.count).toBe(2);
  });

  it('hides accountless legacy runtime contacts instead of showing a stale switched-account cache', async () => {
    const cachePath = join(root, '.local-logs', 'wechat-contacts.json');
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        source: 'windows-wechat-db-decrypted',
        items: Array.from({ length: 455 }, (_, index) => ({
          wxid: `legacy_${index}`,
          nickname: `旧号联系人${index}`,
        })),
        contacts: Array.from(
          { length: 455 },
          (_, index) => `旧号联系人${index}`,
        ),
        syncedAt: '2026-06-25T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await service.getWechatContacts();

    expect(result.count).toBe(0);
    expect(result.contacts).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        stage: 'legacy-cache-without-account-id',
        failureReason: expect.stringContaining('旧版本联系人缓存没有微信账号标识'),
      }),
    );
  });

  it('keeps runtime contacts when diagnostics identify the selected WeChat account', async () => {
    const cachePath = join(root, '.local-logs', 'wechat-contacts.json');
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        source: 'windows-wechat-db-decrypted',
        items: [{ wxid: 'wxid_a', nickname: '客户A' }],
        contacts: ['客户A'],
        syncedAt: '2026-07-02T00:00:00.000Z',
        diagnostics: {
          selectedDbAccountFolder: 'yanghylive_ddd3',
          selectedDbBaseWxid: 'yanghylive_ddd3',
        },
      }),
      'utf8',
    );

    const result = await service.getWechatContacts();

    expect(result.count).toBe(1);
    expect(result.currentWechatId).toBe('yanghylive_ddd3');
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        wxid: 'wxid_a',
        currentWechatId: 'yanghylive_ddd3',
      }),
    );
  });

  it('filters polluted OCR cache entries before returning contacts', async () => {
    const cachePath = join(root, '.local-logs', 'wechat-contacts.json');
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        source: 'legacy-cache',
        contacts: [
          '客户A',
          '服务号',
          '微信小店助手：直',
          'A new version of Dock',
          'Upgrade plan',
          '大 星标朋友',
          '客户B',
        ],
        syncedAt: '2026-06-22T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await service.getWechatContacts();

    expect(result.contacts).toEqual(['客户A', '客户B']);
    expect(result.count).toBe(2);
  });

  it('treats a mostly polluted OCR cache as empty instead of showing stale contacts', async () => {
    const cachePath = join(root, '.local-logs', 'wechat-contacts.json');
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        source: 'macos-wechat-ocr',
        contacts: [
          '［又件」椰茧入物',
          '腾讯新闻',
          '网友称在茉莉奶E',
          '服务号',
          '微信小店助手：直',
          '歪马福利小管',
          '张庄（时惠叭）',
          '河东（时惠叭）',
          '东方甄选',
          'A new version of Dock',
          'Upgrade plan',
          'Engine starting',
          '田團',
        ],
        syncedAt: '2026-06-23T06:15:21.958Z',
      }),
      'utf8',
    );

    const result = await service.getWechatContacts();

    expect(result.contacts).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('detects polluted contact batches without rejecting mixed real contacts', () => {
    expect(
      service.isPollutedWechatContactCandidateBatch(
        ['通讯录', '腾讯新闻', '微信小店助手：直', '服务通知'],
        'windows-wechat-ocr',
      ),
    ).toBe(true);
    expect(
      service.isPollutedWechatContactCandidateBatch(
        ['客户A', '服务号', '微信小店助手：直', '客户B'],
        'windows-wechat-ocr',
      ),
    ).toBe(false);
  });

  it('resolves the project root from either repo root or backend cwd', () => {
    const cwdSpy = jest.spyOn(process, 'cwd');

    cwdSpy.mockReturnValue(root);
    expect(service.getProjectRoot()).toBe(root);

    cwdSpy.mockReturnValue(join(root, 'backend'));
    expect(service.getProjectRoot()).toBe(root);

    cwdSpy.mockRestore();
  });

  it('upserts, removes, clears and exports structured contacts', async () => {
    await service.upsertWechatContact({
      wxid: 'wxid_a',
      nickname: '客户A',
      remark: 'A 备注',
      tags: ['vip', 'vip', '复购'],
      currentWechatId: 'seller_1',
      plannedWechatId: 'seller_2',
    });
    await service.upsertWechatContact({
      wxid: 'wxid_b',
      nickname: '客户B',
    });

    const upserted = await service.getWechatContacts();
    expect(upserted.count).toBe(2);
    expect(upserted.contacts).toEqual(['A 备注', '客户B']);
    expect(upserted.items[0]).toEqual(
      expect.objectContaining({
        wxid: 'wxid_a',
        nickname: '客户A',
        remark: 'A 备注',
        tags: ['vip', '复购'],
        currentWechatId: 'seller_1',
        plannedWechatId: 'seller_2',
      }),
    );

    const exported = await service.exportWechatContacts();
    expect(exported.exportStatus).toBe('OK');
    expect(JSON.parse(exported.content).items).toHaveLength(2);

    const removed = await service.removeWechatContact('wxid_a');
    expect(removed.contacts).toEqual(['客户B']);

    const cleared = await service.clearWechatContacts();
    expect(cleared.count).toBe(0);

    const raw = JSON.parse(
      await readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    );
    expect(raw.contacts).toEqual([]);
    expect(raw.items).toEqual([]);
  });

  it('rejects OCR results that look like a non-WeChat page before writing cache', async () => {
    service.runWechatContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'macos-wechat-ocr',
      contacts: ['发布中心', '抖音评论', '客户A'],
      screenshotPath: '/tmp/wrong-window.png',
    }));

    await expect(service.syncWechatContacts(true)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.syncWechatContacts(true)).rejects.toThrow(
      '非微信页面内容',
    );

    await expect(
      readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('drops WeChat navigation and public-account noise from sync results', async () => {
    service.runWechatContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'macos-wechat-ocr',
      currentWechatId: 'mac-dev-wechat',
      contacts: ['客户A', '服务号', '微信小店助手：直', '客户B'],
      screenshotPath: '/tmp/wechat.png',
    }));

    const result = await service.syncWechatContacts(true);

    expect(result.contacts).toEqual(['客户A', '客户B']);
    const raw = JSON.parse(
      await readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    );
    expect(raw.contacts).toEqual(['客户A', '客户B']);
    expect(raw.currentWechatId).toBe('mac-dev-wechat');
  });

  it('keeps clean cached contacts when macOS OCR cannot identify the WeChat window', async () => {
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contacts.json'),
      JSON.stringify({
        source: 'macos-wechat-ocr',
        currentWechatId: 'mac-dev-wechat',
        contacts: ['客户A', '客户B'],
        items: [
          { wxid: 'wxid_a', nickname: '客户A', tags: [] },
          { wxid: 'wxid_b', nickname: '客户B', tags: [] },
        ],
        syncedAt: '2026-06-28T00:00:00.000Z',
      }),
      'utf8',
    );
    service.runWechatContactSyncScript = jest.fn(async () => {
      throw new Error(
        '没有识别到微信窗口特征，已拒绝同步通讯录。请把微信桌面客户端打开到主窗口后重试。',
      );
    });

    const result = await service.syncWechatContacts(true);

    expect(result.cached).toBe(true);
    expect(result.syncFallbackReason).toContain('没有识别到微信窗口特征');
    expect(result.contacts).toEqual(['客户A', '客户B']);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        source: 'wechat-contact-cache-fallback',
        stage: 'sync-cache-fallback',
      }),
    );

    const diagnostics = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(diagnostics.fallback).toBe('cache');
    expect(diagnostics.cachedCount).toBe(2);
  });

  it('syncs contacts through the Windows UIA collector on win32', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatContactSyncScript = jest.fn();
    service.runWechatWindowsContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'windows-wechat-uia',
      contacts: ['客户A', '客户B'],
      screenshotPath: '',
    }));

    const result = await service.syncWechatContacts(true);

    expect(service.runWechatContactSyncScript).not.toHaveBeenCalled();
    expect(service.runWechatWindowsContactSyncScript).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('windows-wechat-uia');
    expect(result.contacts).toEqual(['客户A', '客户B']);
    expect(result.count).toBe(2);

    const raw = JSON.parse(
      await readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    );
    expect(raw.source).toBe('windows-wechat-uia');
    expect(raw.items).toHaveLength(2);
  });

  it('supports full contact sync on macOS and keeps the result scoped to the active account', async () => {
    service.getRuntimePlatform = jest.fn(() => 'darwin');
    service.runWechatContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'macos-wechat-ocr',
      currentWechatId: 'seller-current',
      contacts: ['客户A', '客户B', '客户C', '客户D', '客户E'],
      count: 5,
    }));

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'all',
    });

    expect(service.runWechatContactSyncScript).toHaveBeenCalledWith(
      join(root, 'wechat-contact-sync.py'),
      'all',
    );
    expect(result.count).toBe(5);
    expect(result.currentWechatId).toBe('seller-current');
    const cache = JSON.parse(
      await readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    );
    expect(cache.currentWechatId).toBe('seller-current');
  });

  it('rejects accountless macOS OCR contacts instead of writing a cache that is hidden on the next read', async () => {
    service.getRuntimePlatform = jest.fn(() => 'darwin');
    service.runWechatContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'macos-wechat-ocr',
      contacts: ['客户A', '客户B', '客户C', '客户D', '客户E'],
      count: 5,
      diagnostics: {
        source: 'macos-wechat-ocr',
        stage: 'macos-ocr-completed',
      },
    }));

    await expect(
      service.syncWechatContacts({ force: true, mode: 'random' }),
    ).rejects.toThrow('没有微信账号标识');

    await expect(
      readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const diagnostics = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(diagnostics).toEqual(
      expect.objectContaining({
        ok: false,
        fallback: 'blocked',
        mode: 'random',
        error: expect.stringContaining('没有微信账号标识'),
      }),
    );
  });

  it('syncs structured contacts through the Windows database collector on win32', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatContactSyncScript = jest.fn();
    service.runWechatWindowsContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'windows-wechat-db',
      items: [
        {
          wxid: 'wxid_customer_a',
          nickname: '客户A',
          remark: 'A 备注',
          tags: [],
        },
        {
          wxid: 'wxid_customer_b',
          nickname: '客户B',
          remark: '',
          tags: [],
        },
      ],
      contacts: [],
      diagnostics: {
        stage: 'completed-db',
        attemptedSources: ['windows-db'],
        dbContactCount: 2,
        selectedDbAccountFolder: 'yanghylive_ddd3',
        selectedDbBaseWxid: 'yanghylive_ddd3',
        dbPaths: [
          'C:\\Users\\me\\Documents\\xwechat_files\\wxid\\db_storage\\contact\\contact.db',
        ],
      },
    }));

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'all',
    });

    expect(service.runWechatContactSyncScript).not.toHaveBeenCalled();
    expect(service.runWechatWindowsContactSyncScript).toHaveBeenCalledWith(
      'all',
    );
    expect(result.source).toBe('windows-wechat-db');
    expect(result.contacts).toEqual(['A 备注', '客户B']);
    expect(result.currentWechatId).toBe('yanghylive_ddd3');
    expect(result.items).toEqual([
      expect.objectContaining({
        wxid: 'wxid_customer_a',
        currentWechatId: 'yanghylive_ddd3',
      }),
      expect.objectContaining({
        wxid: 'wxid_customer_b',
        currentWechatId: 'yanghylive_ddd3',
      }),
    ]);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        stage: 'completed-db',
        dbContactCount: 2,
        selectedDbAccountFolder: 'yanghylive_ddd3',
      }),
    );

    const raw = JSON.parse(
      await readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    );
    expect(raw.source).toBe('windows-wechat-db');
    expect(raw.currentWechatId).toBe('yanghylive_ddd3');
    expect(raw.items).toEqual([
      expect.objectContaining({ wxid: 'wxid_customer_a', remark: 'A 备注' }),
      expect.objectContaining({ wxid: 'wxid_customer_b', nickname: '客户B' }),
    ]);
  });

  it('does not expose cached contacts when the latest diagnostics point to another WeChat account', async () => {
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contacts.json'),
      JSON.stringify({
        source: 'windows-wechat-db',
        currentWechatId: 'dazhuang_old',
        contacts: ['旧号客户A', '旧号客户B'],
        items: [
          { wxid: 'old_a', nickname: '旧号客户A', tags: [] },
          { wxid: 'old_b', nickname: '旧号客户B', tags: [] },
        ],
        syncedAt: '2026-07-01T00:00:00.000Z',
      }),
      'utf8',
    );
    await writeFile(
      join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
      JSON.stringify({
        diagnostics: {
          selectedDbAccountFolder: 'yanghylive_ddd3',
          selectedDbBaseWxid: 'yanghylive_ddd3',
          stage: 'native-db-blocked',
        },
      }),
      'utf8',
    );

    const result = await service.getWechatContacts();

    expect(result.count).toBe(0);
    expect(result.contacts).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        source: 'wechat-contact-cache-account-guard',
        stage: 'cache-account-mismatch',
        selectedDbAccountFolder: 'yanghylive_ddd3',
      }),
    );
  });

  it('keeps same-account cache when Windows DB/helper is blocked and no fresh contacts are available', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.tryRunWechatContactVisionFallback = jest.fn(async () => null);
    service.runWechatWindowsContactSyncScript = jest.fn(async () => {
      const error = new Error(
        '数据库/helper 主链路没有拿到联系人，已跳过 UIA/OCR 屏幕采集。',
      ) as Error & { diagnostics?: unknown };
      error.diagnostics = {
        source: 'kaypal-wechat-native-runtime',
        stage: 'native-db-helper-blocked',
        selectedDbAccountFolder: 'dazhuang_old',
        selectedDbBaseWxid: 'dazhuang_old',
        dbStatus: 'encrypted-or-locked',
        dbKeyStatus: 'encrypted-or-locked',
        uiaStatus: 'skipped-db-helper-required',
        attemptedSources: ['native-db', 'native-db-helper-contract'],
        keyHelperStatus: 'memory-key-missing',
        decryptionStatus: 'failed',
        externalKeyToolIncompatible: true,
        externalKeyToolUnsupported: true,
        blockedReasons: [
          'encrypted-or-key-missing',
          'current-account-db-key-missing',
        ],
        wechatProcessArchitectures: [
          {
            processName: 'Weixin.exe',
            processId: 5364,
            architecture: 'x64',
          },
        ],
        externalKeyToolCompatibility: [
          {
            toolPath: 'DbkeyHookCMD.exe',
            toolArchitecture: 'x86',
            status: 'incompatible',
            reason: 'tool-process-architecture-mismatch',
          },
        ],
        externalDbKeyAttempts: [
          {
            toolPath: 'DbkeyHookCMD.exe',
            status: 'tool-incompatible',
            reason: 'tool-process-architecture-mismatch',
          },
        ],
        externalDumpRsPidAttempts: [
          {
            toolPath: 'wechat-dump-rs.exe',
            status: 'unsupported-wechat-profile-layout',
          },
        ],
        decryptAttempts: [
          {
            status: 'blocked',
            reason: 'external-key-tool-architecture-mismatch',
          },
        ],
        failureReason:
          '数据库/helper 主链路没有拿到联系人，已跳过 UIA/OCR 屏幕采集。',
      };
      throw error;
    });
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contacts.json'),
      JSON.stringify({
        source: 'windows-wechat-db',
        currentWechatId: 'dazhuang_old',
        contacts: ['旧号客户A'],
        items: [{ wxid: 'old_a', nickname: '旧号客户A', tags: [] }],
        syncedAt: '2026-07-01T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'all',
    });

    expect(result.cached).toBe(true);
    expect(result.count).toBe(1);
    expect(result.contacts).toEqual(['旧号客户A']);
    expect(result.currentWechatId).toBe('dazhuang_old');
    expect(result.syncFallbackReason).toContain('电脑微信已登录');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        source: 'wechat-contact-cache-fallback',
        stage: 'sync-cache-fallback',
        selectedDbAccountFolder: 'dazhuang_old',
        uiaStatus: 'skipped-db-helper-required',
        externalKeyToolIncompatible: true,
        externalKeyToolUnsupported: true,
        blockedReasons: [
          'encrypted-or-key-missing',
          'current-account-db-key-missing',
        ],
        wechatProcessArchitectures: [
          expect.objectContaining({
            processName: 'Weixin.exe',
            architecture: 'x64',
          }),
        ],
        externalDbKeyAttempts: [
          expect.objectContaining({
            status: 'tool-incompatible',
          }),
        ],
      }),
    );

    const diagnostics = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(diagnostics.fallback).toBe('cache');
    expect(diagnostics.cachedCount).toBe(1);
  });

  it('keeps same-account cache when the Windows key provider is incompatible and no fresh contacts are available', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.tryRunWechatContactVisionFallback = jest.fn(async () => null);
    service.runWechatWindowsContactSyncScript = jest.fn(async () => {
      const error = new Error(
        '微信联系人数据库未解密，无法确认当前账号通讯录。',
      ) as Error & { diagnostics?: unknown };
      error.diagnostics = {
        source: 'kaypal-wechat-native-runtime',
        stage: 'completed',
        selectedDbAccountFolder: 'yanghylive_ddd3',
        selectedDbBaseWxid: 'yanghylive_ddd3',
        dbStatus: 'encrypted-or-locked',
        dbKeyStatus: 'encrypted-or-locked',
        keyHelperStatus: 'native-key-helper-blocked',
        decryptionStatus: 'failed',
        externalKeyToolIncompatible: true,
        externalKeyToolUnsupported: true,
        memoryScanStatus: 'skipped-deterministic-tool-failure',
        blockedReasons: [
          'encrypted-or-key-missing',
          'current-account-db-key-missing',
        ],
        decryptAttempts: [
          {
            status: 'skipped',
            method: 'process-memory-key-scan',
            reason: 'slow-memory-scan-disabled-after-deterministic-tool-failure',
          },
        ],
        externalDbKeyAttempts: [
          {
            toolPath: 'DbkeyHookCMD.exe',
            status: 'tool-incompatible',
            reason: 'tool-process-architecture-mismatch',
          },
        ],
      };
      throw error;
    });
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contacts.json'),
      JSON.stringify({
        source: 'windows-wechat-db',
        currentWechatId: 'yanghylive_ddd3',
        contacts: ['旧缓存客户A'],
        items: [{ wxid: 'old_a', nickname: '旧缓存客户A', tags: [] }],
        syncedAt: '2026-07-01T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'all',
    });

    expect(result.cached).toBe(true);
    expect(result.count).toBe(1);
    expect(result.contacts).toEqual(['旧缓存客户A']);
    expect(result.syncFallbackReason).toContain('数据库未解密');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        keyHelperStatus: 'native-key-helper-blocked',
        externalKeyToolIncompatible: true,
        externalKeyToolUnsupported: true,
        memoryScanStatus: 'skipped-deterministic-tool-failure',
      }),
    );

    const diagnostics = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(diagnostics.fallback).toBe('cache');
    expect(diagnostics.cachedCount).toBe(1);
  });

  it('blocks stale cache when the current Windows account DB is unreadable', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.tryRunWechatContactVisionFallback = jest.fn(async () => null);
    service.runWechatWindowsContactSyncScript = jest.fn(async () => {
      const error = new Error(
        '当前微信账号通讯录数据库不可读，已拒绝使用旧账号名单。',
      ) as Error & { diagnostics?: unknown };
      error.diagnostics = {
        source: 'kaypal-wechat-native-runtime',
        stage: 'completed',
        selectedDbPath:
          'C:\\Users\\signer\\Documents\\xwechat_files\\yanghylive_ddd3\\db_storage\\contact\\contact.db',
        selectedDbAccountFolder: 'yanghylive_ddd3',
        selectedDbBaseWxid: 'yanghylive_ddd3',
        currentAccountDbBlocked: true,
        dbStatus: 'completed-empty',
        dbKeyStatus: 'plaintext-readable',
        blockedReasons: ['current-account-db-unreadable'],
        dbErrors: [
          {
            path: 'C:\\Users\\signer\\Documents\\xwechat_files\\yanghylive_ddd3\\db_storage\\contact\\contact.db',
            status: 'blocked',
            reason: 'current-account-db-unreadable',
          },
        ],
      };
      throw error;
    });
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contacts.json'),
      JSON.stringify({
        source: 'windows-wechat-db-decrypted',
        currentWechatId: 'yanghylive_ddd3',
        contacts: ['旧缓存客户A'],
        items: [{ wxid: 'old_a', nickname: '旧缓存客户A', tags: [] }],
        syncedAt: '2026-07-01T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'all',
    });

    expect(result.cached).toBe(false);
    expect(result.count).toBe(0);
    expect(result.contacts).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        currentAccountDbBlocked: true,
        blockedReasons: ['current-account-db-unreadable'],
        dbErrors: [
          expect.objectContaining({
            reason: 'current-account-db-unreadable',
          }),
        ],
      }),
    );

    const diagnostics = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(diagnostics.fallback).toBe('blocked');
    expect(diagnostics.cachedCount).toBe(0);
  });

  it('rejects fresh Windows DB contacts without account identity instead of inheriting stale cache identity', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatWindowsContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'windows-wechat-db-decrypted',
      contacts: ['新号客户A'],
      items: [{ wxid: 'new_a', nickname: '新号客户A', tags: [] }],
      count: 1,
      diagnostics: {
        stage: 'completed-db',
        dbStatus: 'completed',
        dbContactCount: 1,
      },
    }));
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contacts.json'),
      JSON.stringify({
        source: 'windows-wechat-db',
        currentWechatId: 'dazhuang_old',
        contacts: ['旧号客户A'],
        items: [{ wxid: 'old_a', nickname: '旧号客户A', tags: [] }],
        syncedAt: '2026-07-01T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'all',
    });

    expect(result.count).toBe(0);
    expect(result.contacts).toEqual([]);
    expect(result.cached).toBe(false);
    expect(result.currentWechatId).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        failureReason: expect.stringContaining('没有微信账号标识'),
        source: 'windows-wechat-db-decrypted',
      }),
    );
  });

  it('persists Windows contact sync diagnostics with the contacts cache', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatWindowsContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'windows-wechat-hybrid',
      contacts: ['客户A', '客户B'],
      screenshotPath: 'C:\\Temp\\wechat-contacts.png',
      diagnostics: {
        stage: 'completed',
        pagesScanned: 3,
        uiaContactCount: 1,
        ocrContactCount: 2,
        rawTextCount: 12,
        screenshotPath: 'C:\\Temp\\wechat-contacts.png',
        attemptedSources: ['windows-uia', 'windows-ocr'],
        ocrPreview: ['客户A', '客户B'],
      },
    }));

    const result = await service.syncWechatContacts(true);

    expect(result.source).toBe('windows-wechat-hybrid');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        stage: 'completed',
        pagesScanned: 3,
        ocrContactCount: 2,
        screenshotPath: 'C:\\Temp\\wechat-contacts.png',
      }),
    );

    const raw = JSON.parse(
      await readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    );
    expect(raw.diagnostics.attemptedSources).toEqual([
      'windows-uia',
      'windows-ocr',
    ]);
  });

  it('rejects Windows shell labels before writing contacts cache', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatWindowsContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'windows-wechat-uia',
      contacts: ['Weixin'],
      screenshotPath: '',
    }));

    await expect(service.syncWechatContacts(true)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.syncWechatContacts(true)).rejects.toThrow(
      '窗口标题或导航文本',
    );

    await expect(
      readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a clear BadRequestException when the Windows collector fails', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatWindowsContactSyncScript = jest.fn(async () => {
      throw new Error('没有找到已登录的 Windows 微信主窗口。');
    });

    await expect(service.syncWechatContacts(true)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.syncWechatContacts(true)).rejects.toThrow(
      'Windows 微信通讯录同步失败：没有找到已登录的 Windows 微信主窗口。',
    );
  });

  it('extracts the final JSON payload from noisy Windows PowerShell output', () => {
    const output = [
      'Windows PowerShell',
      'warning: preflight text',
      '{"ok":false,"error":"old","contacts":[]}',
      'verbose text after first payload',
      '{"ok":true,"contacts":["客户A"],"count":1}',
    ].join('\r\n');

    expect(service.findLastJsonLine(output)).toBe(
      '{"ok":true,"contacts":["客户A"],"count":1}',
    );
  });

  it('formats Windows diagnostics into a readable failure detail', () => {
    const detail = service.formatWechatContactsDiagnosticsForError({
      stage: 'collect-page-1-ocr',
      failureReason: '当前焦点不是微信通讯录窗口',
      windowTitle: '微信',
      rawTextCount: 8,
      ocrPreview: ['通讯录', '客户A'],
      screenshotPath: 'C:\\Temp\\wechat-contacts.png',
    });

    expect(detail).toContain('阶段 collect-page-1-ocr');
    expect(detail).toContain('失败原因 当前焦点不是微信通讯录窗口');
    expect(detail).toContain('UIA原文 8 条');
    expect(detail).toContain('OCR预览 通讯录 / 客户A');
    expect(detail).toContain('截图 C:\\Temp\\wechat-contacts.png');
  });

  it('normalizes macOS assistive access errors into a user-facing message', () => {
    const error = service.toWechatContactsSyncException(
      new Error(
        '120:136: execution error: “System Events”遇到一个错误：“osascript”不允许辅助访问。 (-25211)',
      ),
      'darwin',
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain('本机没有授权桌面控制权限');
    expect(error.message).not.toContain('osascript');
  });

  it('compacts long Windows contact sync shell output for user-facing errors', () => {
    const output = `line-1\n${'x'.repeat(1500)}\nline-last`;

    const detail = service.compactWechatContactSyncOutput(output, 120);

    expect(detail.length).toBeLessThanOrEqual(120);
    expect(detail).toContain('line-last');
  });

  it('does not filter customer-style contact names in the Windows script', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).not.toContain('小时|客户|专业');
    expect(script).toContain('Wheel-Down');
  });

  it('writes a standalone Windows contact sync diagnostic file', async () => {
    await service.writeWechatContactSyncDiagnostics({
      ok: false,
      error: 'OCR failed',
      diagnostics: {
        stage: 'collect-page-1-ocr',
        ocrPreview: ['客户A'],
      },
    });

    const raw = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(raw.error).toBe('OCR failed');
    expect(raw.diagnostics.ocrPreview).toEqual(['客户A']);
    expect(raw.failureRecord).toEqual(
      expect.objectContaining({
        command: 'contacts',
        runner: 'wechat-contact-sync',
        platform: 'darwin',
        screenshotPath: '',
        nextAction: expect.any(String),
        rawSummary: expect.stringContaining('ocrPreview=客户A'),
      }),
    );
    expect(raw.evidencePackage.failureRecords[0]).toEqual(raw.failureRecord);
    expect(raw.evidencePackage.validation.ok).toBe(true);
  });

  it('keeps Windows no-output diagnostics actionable', async () => {
    await service.writeWechatContactSyncDiagnostics({
      ok: false,
      code: 1,
      mode: 'all',
      error: 'Windows 微信联系人同步没有返回结果',
      stderrTail: 'PowerShell failed',
      stdoutTail: '',
      outputTail: 'PowerShell failed',
    });

    const raw = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(raw.mode).toBe('all');
    expect(raw.code).toBe(1);
    expect(raw.stderrTail).toContain('PowerShell failed');
    expect(raw.failureRecord).toEqual(
      expect.objectContaining({
        command: 'contacts',
        runner: 'wechat-contact-sync',
        platform: 'darwin',
        rawSummary: expect.stringContaining('PowerShell failed'),
        nextAction: expect.stringContaining('截图'),
      }),
    );
  });

  it('exports the standalone Windows contact sync diagnostic file', async () => {
    await service.writeWechatContactSyncDiagnostics({
      ok: false,
      error: 'window mismatch',
    });

    const result = await service.exportWechatContactSyncDiagnostics();

    expect(result.exists).toBe(true);
    expect(result.filename).toMatch(/^wechat-contact-sync-diagnostics-/);
    expect(JSON.parse(result.content).error).toBe('window mismatch');
    expect(JSON.parse(result.content).failureRecord).toEqual(
      expect.objectContaining({
        command: 'contacts',
        runner: 'wechat-contact-sync',
        platform: 'darwin',
        rawSummary: expect.stringContaining('window mismatch'),
        nextAction: expect.any(String),
      }),
    );
  });

  it('keeps Windows window selection and OCR sizing safeguards in the script', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).toContain(
      '$candidates = New-Object System.Collections.Generic.List[object]',
    );
    expect(script).toContain('Sort-Object');
    expect(script).toContain('MaxImageDimension');
    expect(script).toContain('$maxOcrDimension = 2200');
  });

  it('does not use indentation-sensitive PowerShell here-strings', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).not.toContain('@"');
    expect(script).not.toContain('"@');
    expect(script).toContain('Add-Type -TypeDefinition $kaypalWin32Type');
  });

  it('does not pipe window diagnostics through ForEach-Object or Int32 area casts', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).not.toContain('$candidates | ForEach-Object');
    expect(script).not.toContain('[int]$_.Area');
    expect(script).not.toContain('[int64]$candidate.Area');
    expect(script).toContain(
      '$candidatePreview = New-Object System.Collections.Generic.List[string]',
    );
    expect(script).toContain('$candidateArea = [string]$candidate.Area');
  });

  it('supports random and all contact sync scan modes in the Windows script', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).toContain('AI_CONTENT_WECHAT_CONTACT_SYNC_MODE');
    expect(script).toContain('function Reset-ContactsToTop');
    expect(script).toContain("$syncMode = 'all'");
    expect(script).toContain('$pages = 200');
    expect(script).toContain('$staleLimit = 5');
    expect(script).toContain('$pages = 8');
    expect(script).toContain('$staleLimit = 2');
  });

  it('does not OCR every scrolled page unless explicitly enabled', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).toContain('$ocrEveryPage = $false');
    expect(script).toContain(
      "AI_CONTENT_WECHAT_CONTACT_OCR_EACH_PAGE -match '^(1|true|yes)$'",
    );
    expect(script).toContain('已跳过滚动页 OCR');
    expect(script).not.toContain(
      "AI_CONTENT_WECHAT_CONTACT_OCR_EACH_PAGE -match '^(0|false|no)$'",
    );
  });

  it('stops Windows contact sync when page text is clearly not WeChat', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).toContain('function Test-NonWechatPageText');
    expect(script).toContain('AI员工TOS');
    expect(script).toContain('Test-NonWechatPageText $batchRawText');
    expect(script).toContain('当前焦点离开微信通讯录窗口');
    expect(script).toContain('已停止并拒绝写入通讯录缓存');
  });

  it('tries the Windows WeChat database channel before UI scanning', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).toContain('function Try-CollectContactsByDatabase');
    expect(script).toContain('function New-ContactBatch');
    expect(script).toContain('function Convert-ContactListToArray');
    expect(script).toContain('AI_CONTENT_WECHAT_DB_HELPER');
    expect(script).toContain('AI_CONTENT_SQLITE_EXE');
    expect(script).toContain('wechat-dump-rs');
    expect(script).toContain('Find-ContactDbPathsFromHelperOutput');
    expect(script).toContain('KaypalWechatDbDecryptor');
    expect(script).toContain('DecryptWithMemoryKey');
    expect(script).toContain('Try-DecryptWeChatContactDbs');
    expect(script).toContain('$script:KaypalDecryptedDbSourceMap');
    expect(script).toContain('function Resolve-OriginalWeChatDbPath');
    expect(script).toContain("Set-Diagnostic 'selectedDbAccountFolder'");
    expect(script).toContain("Set-Diagnostic 'selectedDbBaseWxid'");
    expect(script).toContain(
      "New-ContactBatch $decryptedBatch['Items'] 'windows-wechat-db-decrypted'",
    );
    expect(script).toContain('AI_CONTENT_WECHAT_CONTACT_DB_ONLY');
    expect(script).toContain("Set-Diagnostic 'stage' 'db-sync-blocked'");
    expect(script).toContain("Add-AttemptedSource 'windows-db'");
    expect(script).toContain("Set-Diagnostic 'stage' 'completed-db'");
    expect(script).toContain("Set-Diagnostic 'stage' 'find-window'");
    expect(
      script.indexOf('Try-CollectContactsBySqliteCli $dbPaths'),
    ).toBeLessThan(script.indexOf('Try-DecryptWeChatContactDbs $dbPaths'));
    expect(script.indexOf('Try-CollectContactsByDatabase')).toBeLessThan(
      script.indexOf("Set-Diagnostic 'stage' 'find-window'"),
    );
    expect(script.indexOf('AI_CONTENT_WECHAT_CONTACT_DB_ONLY')).toBeLessThan(
      script.indexOf("Set-Diagnostic 'stage' 'find-window'"),
    );
  });

  it('keeps the native runtime fenced to the first ranked current-account DB', async () => {
    const runtime = await readFile(
      join(
        process.cwd(),
        '..',
        'desktop',
        'runtime',
        'wechat-native-runtime',
        'kaypal-wechat-native-runtime.js',
      ),
      'utf8',
    );

    expect(runtime).toContain('isFirstRankedContactDb');
    expect(runtime).toContain('currentAccountDbBlocked');
    expect(runtime).toContain('current-account-db-key-missing');
    expect(runtime).toContain('current-account-db-unreadable');
    expect(runtime).toContain('refused stale-account fallback');
    expect(runtime).toContain("'^(Weixin|WeChat)\\.exe$'");
    expect(runtime).not.toContain("'^(Weixin|WeChat)\\\\.exe$'");
  });

  it('keeps the DB helper fenced to the first ranked current-account DB', async () => {
    const helper = await readFile(
      join(
        process.cwd(),
        '..',
        'desktop',
        'runtime',
        'wechat-db-helper',
        'wechat-db-helper.js',
      ),
      'utf8',
    );

    expect(helper).toContain('isFirstRankedContactDb');
    expect(helper).toContain('currentAccountDbBlocked');
    expect(helper).toContain('current-account-db-key-missing');
    expect(helper).toContain('current-account-db-unreadable');
    expect(helper).toContain('refused stale-account fallback');
  });

  it('keeps memory-key scan enabled after external key tools fail unless explicitly disabled', async () => {
    const helper = await readFile(
      join(
        process.cwd(),
        '..',
        'desktop',
        'runtime',
        'wechat-db-helper',
        'wechat-db-helper.js',
      ),
      'utf8',
    );

    expect(helper).toContain(
      "process.env.AI_CONTENT_WECHAT_SKIP_MEMORY_SCAN_AFTER_EXTERNAL_FAILURE === '1'",
    );
    expect(helper).toContain(
      "process.env.AI_CONTENT_WECHAT_ALLOW_SLOW_MEMORY_SCAN !== '1'",
    );
    expect(helper).not.toContain(
      "deterministicExternalFailure &&\n    process.env.AI_CONTENT_WECHAT_ALLOW_SLOW_MEMORY_SCAN !== '1'",
    );
  });

  it('prefers the backend bundled decryptor before the helper fallback decryptor', async () => {
    const helper = await readFile(
      join(
        process.cwd(),
        '..',
        'desktop',
        'runtime',
        'wechat-db-helper',
        'wechat-db-helper.js',
      ),
      'utf8',
    );

    expect(helper.indexOf('for (const candidate of backendBundleCandidates(input))')).toBeGreaterThanOrEqual(
      0,
    );
    expect(helper.indexOf("diagnostics.decryptorSource = 'helper-fallback'")).toBeGreaterThanOrEqual(
      0,
    );
    expect(helper.indexOf('for (const candidate of backendBundleCandidates(input))')).toBeLessThan(
      helper.indexOf("diagnostics.decryptorSource = 'helper-fallback'"),
    );
  });

  it('keeps a same-account decrypted SQLite snapshot fallback before stale-account fallback', async () => {
    const helper = await readFile(
      join(
        process.cwd(),
        '..',
        'desktop',
        'runtime',
        'wechat-db-helper',
        'wechat-db-helper.js',
      ),
      'utf8',
    );

    expect(helper).toContain('function decryptedSnapshotCandidates');
    expect(helper).toContain('windows-wechat-db-decrypted-cache');
    expect(helper).toContain('current-account-db-key-missing-used-decrypted-cache');
    expect(helper.indexOf('const snapshots = decryptedSnapshotCandidates(dbPath, details)')).toBeLessThan(
      helper.indexOf("diagnostics.currentAccountDbBlocked = true"),
    );
    expect(helper).toContain('const currentDbHasResult = isFirstRankedContactDb');
    expect(helper).toContain('if (currentDbHasResult) {');
  });

  it('keeps Windows database batch returns and field access PowerShell-safe', () => {
    const script = service.getWechatWindowsContactSyncScript();

    expect(script).not.toContain('return @{ Items = @($items); Error =');
    expect(script).not.toContain('return @{ Items = @($helperBatch.Items);');
    expect(script).not.toContain('return @{ Items = @($sqliteBatch.Items);');
    expect(script).not.toContain('$helperBatch.Items');
    expect(script).not.toContain('$sqliteBatch.Items');
    expect(script).not.toContain('$decryptedBatch.Items');
    expect(script).not.toContain('$dbBatch.Items');
    expect(script).toContain("$helperBatch['Items']");
    expect(script).toContain("$sqliteBatch['Items']");
    expect(script).toContain("$dbBatch['Items']");
  });

  it('auto-discovers bundled Windows database helpers when present', async () => {
    const helperDir = join(root, 'vendor', 'wechat-db-helper');
    const sqliteDir = join(root, 'vendor', 'sqlite-tools');
    await mkdir(helperDir, { recursive: true });
    await mkdir(sqliteDir, { recursive: true });
    const helperPath = join(helperDir, 'wechat-db-helper.exe');
    const sqlitePath = join(sqliteDir, 'sqlite3.exe');
    await writeFile(helperPath, 'helper', 'utf8');
    await writeFile(sqlitePath, 'sqlite', 'utf8');

    expect(service.resolveWechatDbHelperPath()).toBe(helperPath);
    expect(service.resolveWechatSqliteCliPath()).toBe(sqlitePath);
  });

  it('auto-discovers wechat-dump-rs as a Windows database helper fallback', async () => {
    const helperDir = join(root, 'vendor', 'wechat-db-helper');
    await mkdir(helperDir, { recursive: true });
    const helperPath = join(helperDir, 'wechat-dump-rs.exe');
    await writeFile(helperPath, 'helper', 'utf8');

    expect(service.resolveWechatDbHelperPath()).toBe(helperPath);
  });

  it('prefers the JSON contract helper over raw dump/key tools', async () => {
    const helperDir = join(root, 'desktop', 'runtime', 'wechat-db-helper');
    await mkdir(helperDir, { recursive: true });
    const jsonHelperPath = join(helperDir, 'wechat-db-helper.js');
    const rawDumpToolPath = join(helperDir, 'wechat-dump-rs.exe');
    const rawDbKeyToolPath = join(helperDir, 'DbkeyHookCMD.exe');
    await writeFile(jsonHelperPath, 'json-helper', 'utf8');
    await writeFile(rawDumpToolPath, 'raw-dump-tool', 'utf8');
    await writeFile(rawDbKeyToolPath, 'raw-key-tool', 'utf8');

    expect(service.resolveWechatDbHelperPath()).toBe(jsonHelperPath);
  });

  it('returns Windows contact sync readiness with runtime, helper, cache, and last diagnostics', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.probeWechatNativeContactRuntime = jest.fn(async () => ({
      stage: 'native-diagnose',
      source: 'kaypal-wechat-native-runtime',
      windowStatus: 'ready',
      dbStatus: 'ready',
      helperStatus: 'ready',
      uiaStatus: 'ready',
      externalCommandRunners: {
        'group-broadcast': { status: 'ready', path: 'group.exe' },
        'contact-add': { status: 'ready', path: 'add.exe' },
        'friend-accept': { status: 'ready', path: 'accept.exe' },
        'moments-publish': { status: 'ready', path: 'publish.exe' },
        'moments-marketing': { status: 'ready', path: 'marketing.exe' },
        'chat-history': { status: 'ready', path: 'history.exe' },
      },
    }));
    const nativeRuntimeDir = join(
      root,
      'desktop',
      'runtime',
      'wechat-native-runtime',
    );
    const engineDir = join(root, 'desktop', 'runtime', 'wechat-engine');
    const helperDir = join(root, 'vendor', 'wechat-db-helper');
    const sqliteDir = join(root, 'vendor', 'sqlite-tools');
    await mkdir(nativeRuntimeDir, { recursive: true });
    await mkdir(engineDir, { recursive: true });
    await mkdir(helperDir, { recursive: true });
    await mkdir(sqliteDir, { recursive: true });
    const nativeRuntimePath = join(
      nativeRuntimeDir,
      'kaypal-wechat-native-runtime.js',
    );
    const enginePath = join(engineDir, 'kaypal-wechat-engine.js');
    const helperPath = join(helperDir, 'wechat-db-helper.exe');
    const sqlitePath = join(sqliteDir, 'sqlite3.exe');
    await writeFile(nativeRuntimePath, 'runtime', 'utf8');
    await writeFile(enginePath, 'engine', 'utf8');
    await writeFile(helperPath, 'helper', 'utf8');
    await writeFile(sqlitePath, 'sqlite', 'utf8');
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contacts.json'),
      JSON.stringify({
        source: 'windows-wechat-native-db',
        currentWechatId: 'seller-current',
        contacts: ['客户A'],
        items: [{ wxid: 'wxid_a', nickname: '客户A', tags: [] }],
        syncedAt: '2026-06-27T00:00:00.000Z',
      }),
      'utf8',
    );
    await writeFile(
      join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
      JSON.stringify({
        ok: false,
        error: 'helper not configured',
        diagnostics: {
          stage: 'db-sync',
          source: 'windows-wechat-db',
          failureReason: 'helper not configured',
        },
      }),
      'utf8',
    );

    const result = await service.getWechatContactsReadiness();

    expect(result.platform).toBe('win32');
    expect(result.ready).toBe(true);
    expect(result.status).toBe('warning');
    expect(result.modeSupport).toEqual({ random: true, all: true });
    expect(result.cached.count).toBe(1);
    expect(result.paths).toEqual(
      expect.objectContaining({
        nativeRuntimePath,
        enginePath,
        sqlitePath,
        dbHelperPath: helperPath,
      }),
    );
    expect(result.checks.map((item: { key: string }) => item.key)).toEqual(
      expect.arrayContaining([
        'platform',
        'native-runtime',
        'legacy-engine',
        'sqlite-cli',
        'db-helper',
        'native-diagnose',
        'wechat-command-runners',
        'cached-contacts',
        'last-failure',
      ]),
    );
    expect(
      result.checks.find(
        (item: { key: string }) => item.key === 'wechat-command-runners',
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'ready',
        details: expect.objectContaining({
          configuredCount: 6,
          requiredCount: 6,
        }),
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        stage: 'db-sync',
        failureReason: 'helper not configured',
      }),
    );
  });

  it('does not expose [object Object] when latest contact sync failure stores structured error data', async () => {
    await mkdir(join(root, '.local-logs'), { recursive: true });
    await writeFile(
      join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
      JSON.stringify({
        ok: false,
        error: {
          code: 'platform-gate',
          detail: 'structured error should not be stringified',
        },
        diagnostics: {
          stage: 'sync-platform-gate',
          source: 'wechat-contact-platform-gate',
          failureReason:
            '当前是 macOS，本机只支持开发环境下的随机抽样读取；完整好友同步必须在 Windows 桌面微信环境中执行。',
        },
      }),
      'utf8',
    );

    const result = await service.getWechatContactsReadiness();
    const lastFailureCheck = result.checks.find(
      (item: { key: string }) => item.key === 'last-failure',
    );

    expect(lastFailureCheck?.message).toContain('当前是 macOS');
    expect(lastFailureCheck?.message).not.toContain('[object Object]');
  });

  it('warns when non-contact WeChat command runners are not configured', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');

    const result = await service.getWechatContactsReadiness();

    const runnerCheck = result.checks.find(
      (item: { key: string }) => item.key === 'wechat-command-runners',
    );
    expect(runnerCheck).toEqual(
      expect.objectContaining({
        status: 'warning',
        message: expect.stringContaining('尚未安装'),
        nextAction: expect.stringContaining('完整桌面版'),
        details: expect.objectContaining({
          configuredCount: 0,
          requiredCount: 6,
        }),
      }),
    );
  });

  it('reports packaged macOS commands but keeps friend acceptance explicitly unsupported', async () => {
    service.getRuntimePlatform = jest.fn(() => 'darwin');
    const commandRoot = join(
      root,
      'desktop',
      'runtime',
      'wechat-macos',
      'bin',
    );
    await mkdir(commandRoot, { recursive: true });
    for (const command of [
      'wechat-auto-reply',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
      'wechat-chat-history',
    ]) {
      await writeFile(join(commandRoot, command), '#!/bin/sh\n', 'utf8');
    }

    const result = await service.getWechatContactsReadiness();
    const runnerCheck = result.checks.find(
      (item: { key: string }) => item.key === 'wechat-command-runners',
    );

    expect(result.modeSupport).toEqual({ random: true, all: true });
    expect(result.checks.map((item: { key: string }) => item.key)).not.toEqual(
      expect.arrayContaining([
        'native-runtime',
        'legacy-engine',
        'sqlite-cli',
        'db-helper',
      ]),
    );
    expect(runnerCheck).toEqual(
      expect.objectContaining({
        status: 'warning',
        message: expect.stringContaining('通过好友'),
        nextAction: expect.stringContaining('辅助功能和屏幕录制'),
        details: expect.objectContaining({
          configuredCount: 5,
          requiredCount: 6,
          commands: expect.arrayContaining([
            expect.objectContaining({
              command: 'friend-accept',
              status: 'missing',
            }),
          ]),
        }),
      }),
    );
  });

  it('blocks contact sync readiness on unsupported desktop platforms', async () => {
    service.getRuntimePlatform = jest.fn(() => 'linux');

    const result = await service.getWechatContactsReadiness();

    expect(result.ready).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'platform',
          status: 'blocked',
        }),
      ]),
    );
  });

  it.each(['random', 'all'] as const)(
    'prefers the Windows WeChat native runtime before the sidecar engine in %s mode',
    async (mode) => {
      const previousNativeRuntime =
        process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      const previousEngine = process.env.AI_CONTENT_WECHAT_ENGINE;
      delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      delete process.env.AI_CONTENT_WECHAT_ENGINE;
      const nativeRuntimeDir = join(
        root,
        'desktop',
        'runtime',
        'wechat-native-runtime',
      );
      const engineDir = join(root, 'desktop', 'runtime', 'wechat-engine');
      const helperDir = join(root, 'vendor', 'wechat-db-helper');
      await mkdir(nativeRuntimeDir, { recursive: true });
      await mkdir(engineDir, { recursive: true });
      await mkdir(helperDir, { recursive: true });
      const nativeRuntimePath = join(
        nativeRuntimeDir,
        'kaypal-wechat-native-runtime.js',
      );
      const enginePath = join(engineDir, 'kaypal-wechat-engine.js');
      const helperPath = join(helperDir, 'wechat-db-helper.exe');
      try {
        await writeFile(helperPath, 'helper', 'utf8');
        await writeFile(
          nativeRuntimePath,
          [
            'console.log(JSON.stringify({',
            '  ok: true,',
            "  source: 'windows-wechat-native-db',",
            "  contacts: ['客户A'],",
            "  items: [{ wxid: 'wxid_a', nickname: '客户A' }],",
            '  count: 1,',
            "  currentWechatId: 'seller-current',",
            "  diagnostics: { stage: 'native-db-completed', engine: 'kaypal-wechat-native-runtime', engineVersion: 'test', runtimeCapabilities: ['db', 'uia'], pagesScanned: 2, uiaNodeCount: 45 }",
            '}));',
          ].join('\n'),
          'utf8',
        );
        await writeFile(
          enginePath,
          [
            'console.log(JSON.stringify({',
            '  ok: true,',
            "  source: 'windows-wechat-engine-db',",
            "  contacts: ['客户B'],",
            "  items: [{ wxid: 'wxid_b', nickname: '客户B' }],",
            '  count: 1,',
            "  currentWechatId: 'seller-current'",
            '}));',
          ].join('\n'),
          'utf8',
        );

        const result = await service.runWechatWindowsContactSyncScript(mode);

        expect(result.source).toBe('windows-wechat-native-db');
        expect(result.contacts).toEqual(['客户A']);
        expect(result.diagnostics).toEqual(
          expect.objectContaining({
            stage: 'native-db-completed',
            engine: 'kaypal-wechat-native-runtime',
            nativeRuntimePath,
            decryptionHelperPath: helperPath,
            runtimeCapabilities: ['db', 'uia'],
            pagesScanned: 2,
            uiaNodeCount: 45,
          }),
        );
      } finally {
        if (previousNativeRuntime === undefined) {
          delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
        } else {
          process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME = previousNativeRuntime;
        }
        if (previousEngine === undefined) {
          delete process.env.AI_CONTENT_WECHAT_ENGINE;
        } else {
          process.env.AI_CONTENT_WECHAT_ENGINE = previousEngine;
        }
      }
    },
  );

  it.each(['random', 'all'] as const)(
    'falls back to the sidecar engine when the native runtime returns no contacts in %s mode',
    async (mode) => {
      const previousNativeRuntime =
        process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      const previousEngine = process.env.AI_CONTENT_WECHAT_ENGINE;
      delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      delete process.env.AI_CONTENT_WECHAT_ENGINE;
      const nativeRuntimeDir = join(
        root,
        'desktop',
        'runtime',
        'wechat-native-runtime',
      );
      const engineDir = join(root, 'desktop', 'runtime', 'wechat-engine');
      const helperDir = join(root, 'vendor', 'wechat-db-helper');
      await mkdir(nativeRuntimeDir, { recursive: true });
      await mkdir(engineDir, { recursive: true });
      await mkdir(helperDir, { recursive: true });
      const nativeRuntimePath = join(
        nativeRuntimeDir,
        'kaypal-wechat-native-runtime.js',
      );
      const enginePath = join(engineDir, 'kaypal-wechat-engine.js');
      const helperPath = join(helperDir, 'wechat-db-helper.exe');
      try {
        await writeFile(helperPath, 'helper', 'utf8');
        await writeFile(
          nativeRuntimePath,
          [
            'console.log(JSON.stringify({',
            '  ok: true,',
            "  source: 'windows-wechat-native-db',",
            '  contacts: [],',
            '  items: [],',
            '  count: 0,',
            "  diagnostics: { stage: 'native-no-contacts', engine: 'kaypal-wechat-native-runtime', runtimeCapabilities: ['db'], pagesScanned: 1, uiaNodeCount: 12 }",
            '}));',
          ].join('\n'),
          'utf8',
        );
        await writeFile(
          enginePath,
          [
            'console.log(JSON.stringify({',
            '  ok: true,',
            "  source: 'windows-wechat-engine-db',",
            "  contacts: ['客户B'],",
            "  items: [{ wxid: 'wxid_b', nickname: '客户B' }],",
            '  count: 1,',
            "  currentWechatId: 'seller-current',",
            "  diagnostics: { stage: 'engine-db-completed', engine: 'kaypal-wechat-engine' }",
            '}));',
          ].join('\n'),
          'utf8',
        );

        const result = await service.runWechatWindowsContactSyncScript(mode);

        expect(result.source).toBe('windows-wechat-engine-db');
        expect(result.contacts).toEqual(['客户B']);
        expect(result.diagnostics).toEqual(
          expect.objectContaining({
            stage: 'engine-db-completed',
            engine: 'kaypal-wechat-engine',
            nativeRuntimePath,
            decryptionHelperPath: helperPath,
            runtimeCapabilities: ['db'],
            pagesScanned: 1,
            uiaNodeCount: 12,
            fallbackReason:
              'Native runtime 没有读到联系人，已自动回退到 legacy wechat-engine。',
          }),
        );
      } finally {
        if (previousNativeRuntime === undefined) {
          delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
        } else {
          process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME = previousNativeRuntime;
        }
        if (previousEngine === undefined) {
          delete process.env.AI_CONTENT_WECHAT_ENGINE;
        } else {
          process.env.AI_CONTENT_WECHAT_ENGINE = previousEngine;
        }
      }
    },
  );

  it('continues to fallback collectors when native runtime DB/helper is blocked in random mode',
    async () => {
      const mode = 'random' as const;
      const previousNativeRuntime =
        process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      const previousEngine = process.env.AI_CONTENT_WECHAT_ENGINE;
      delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      delete process.env.AI_CONTENT_WECHAT_ENGINE;
      const nativeRuntimeDir = join(
        root,
        'desktop',
        'runtime',
        'wechat-native-runtime',
      );
      const engineDir = join(root, 'desktop', 'runtime', 'wechat-engine');
      const helperDir = join(root, 'vendor', 'wechat-db-helper');
      await mkdir(nativeRuntimeDir, { recursive: true });
      await mkdir(engineDir, { recursive: true });
      await mkdir(helperDir, { recursive: true });
      const nativeRuntimePath = join(
        nativeRuntimeDir,
        'kaypal-wechat-native-runtime.js',
      );
      const enginePath = join(engineDir, 'kaypal-wechat-engine.js');
      const helperPath = join(helperDir, 'wechat-db-helper.js');
      try {
        await writeFile(helperPath, 'helper', 'utf8');
        await writeFile(
          nativeRuntimePath,
          [
            'console.log(JSON.stringify({',
            '  ok: false,',
            "  error: 'Windows 微信联系人同步失败：数据库/helper 主链路没有拿到联系人，已跳过 UIA/OCR 屏幕采集',",
            '  diagnostics: {',
            "    stage: 'native-db-helper-blocked',",
            "    engine: 'kaypal-wechat-native-runtime',",
            "    dbStatus: 'encrypted-or-locked',",
            "    helperStatus: 'failed',",
            "    uiaStatus: 'skipped-db-helper-required',",
            "    failureLayer: 'helper',",
            "    failureReason: 'DB/helper did not return contacts; UIA/OCR screen collection is disabled by default',",
            "    warnings: ['UIA/OCR screen collection was skipped; WeChat contacts must come from the database/helper chain.']",
            '  }',
            '}));',
          ].join('\n'),
          'utf8',
        );
        await writeFile(
          enginePath,
          [
            'console.log(JSON.stringify({',
            '  ok: true,',
            "  source: 'windows-wechat-native-uia-scroll',",
            "  contacts: ['屏幕采集联系人'],",
            "  items: [{ wxid: 'screen_a', nickname: '屏幕采集联系人' }],",
            '  count: 1',
            '}));',
          ].join('\n'),
          'utf8',
        );

        const result = await service.runWechatWindowsContactSyncScript(mode);

        expect(result.source).toBe('windows-wechat-native-uia-scroll');
        expect(result.contacts).toEqual(['屏幕采集联系人']);
        expect(result.diagnostics).toEqual(
          expect.objectContaining({
            attemptedSources: expect.arrayContaining([
              'native-runtime',
              'wechat-engine',
            ]),
            stage: 'native-db-helper-blocked',
            engine: 'kaypal-wechat-engine',
            helperStatus: 'failed',
            nativeRuntimePath,
            enginePath,
          }),
        );
      } finally {
        if (previousNativeRuntime === undefined) {
          delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
        } else {
          process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME = previousNativeRuntime;
        }
        if (previousEngine === undefined) {
          delete process.env.AI_CONTENT_WECHAT_ENGINE;
        } else {
          process.env.AI_CONTENT_WECHAT_ENGINE = previousEngine;
        }
      }
    },
  );

  it.each(['random', 'all'] as const)(
    'falls back to the sidecar engine when the native runtime fails in %s mode',
    async (mode) => {
      const previousNativeRuntime =
        process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      const previousEngine = process.env.AI_CONTENT_WECHAT_ENGINE;
      delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      delete process.env.AI_CONTENT_WECHAT_ENGINE;
      const nativeRuntimeDir = join(
        root,
        'desktop',
        'runtime',
        'wechat-native-runtime',
      );
      const engineDir = join(root, 'desktop', 'runtime', 'wechat-engine');
      const helperDir = join(root, 'vendor', 'wechat-db-helper');
      await mkdir(nativeRuntimeDir, { recursive: true });
      await mkdir(engineDir, { recursive: true });
      await mkdir(helperDir, { recursive: true });
      const nativeRuntimePath = join(
        nativeRuntimeDir,
        'kaypal-wechat-native-runtime.js',
      );
      const enginePath = join(engineDir, 'kaypal-wechat-engine.js');
      const helperPath = join(helperDir, 'wechat-db-helper.exe');
      try {
        await writeFile(helperPath, 'helper', 'utf8');
        await writeFile(
          nativeRuntimePath,
          [
            'console.log(JSON.stringify({',
            '  ok: false,',
            "  error: 'Failed to fetch',",
            "  diagnostics: { stage: 'native-fetch-failed', engine: 'kaypal-wechat-native-runtime', runtimeCapabilities: ['db', 'uia'], pagesScanned: 4, uiaNodeCount: 88 }",
            '}));',
          ].join('\n'),
          'utf8',
        );
        await writeFile(
          enginePath,
          [
            'console.log(JSON.stringify({',
            '  ok: true,',
            "  source: 'windows-wechat-engine-db',",
            "  contacts: ['客户B'],",
            "  items: [{ wxid: 'wxid_b', nickname: '客户B' }],",
            '  count: 1,',
            "  currentWechatId: 'seller-current',",
            "  diagnostics: { stage: 'engine-db-completed', engine: 'kaypal-wechat-engine' }",
            '}));',
          ].join('\n'),
          'utf8',
        );

        const result = await service.runWechatWindowsContactSyncScript(mode);

        expect(result.source).toBe('windows-wechat-engine-db');
        expect(result.contacts).toEqual(['客户B']);
        expect(result.diagnostics).toEqual(
          expect.objectContaining({
            stage: 'engine-db-completed',
            engine: 'kaypal-wechat-engine',
            nativeRuntimePath,
            decryptionHelperPath: helperPath,
            runtimeCapabilities: ['db', 'uia'],
            pagesScanned: 4,
            uiaNodeCount: 88,
            fallbackReason:
              '本机微信通讯录同步服务暂时不可用，请确认本地运行时已启动并允许后端访问。',
          }),
        );
        expect(JSON.stringify(result.diagnostics)).not.toContain(
          'Failed to fetch',
        );

        const rawDiagnostics = JSON.parse(
          await readFile(
            join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
            'utf8',
          ),
        );
        expect(rawDiagnostics.error).toBe(
          '本机微信通讯录同步服务暂时不可用，请确认本地运行时已启动并允许后端访问。',
        );
        expect(JSON.stringify(rawDiagnostics)).not.toContain('Failed to fetch');
      } finally {
        if (previousNativeRuntime === undefined) {
          delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
        } else {
          process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME = previousNativeRuntime;
        }
        if (previousEngine === undefined) {
          delete process.env.AI_CONTENT_WECHAT_ENGINE;
        } else {
          process.env.AI_CONTENT_WECHAT_ENGINE = previousEngine;
        }
      }
    },
  );

  it('falls back when Windows full UIA sync returns a low-confidence single contact', async () => {
    const previousNativeRuntime = process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
    const previousEngine = process.env.AI_CONTENT_WECHAT_ENGINE;
    delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
    delete process.env.AI_CONTENT_WECHAT_ENGINE;
    const nativeRuntimeDir = join(
      root,
      'desktop',
      'runtime',
      'wechat-native-runtime',
    );
    const engineDir = join(root, 'desktop', 'runtime', 'wechat-engine');
    const helperDir = join(root, 'vendor', 'wechat-db-helper');
    await mkdir(nativeRuntimeDir, { recursive: true });
    await mkdir(engineDir, { recursive: true });
    await mkdir(helperDir, { recursive: true });
    const nativeRuntimePath = join(
      nativeRuntimeDir,
      'kaypal-wechat-native-runtime.js',
    );
    const enginePath = join(engineDir, 'kaypal-wechat-engine.js');
    const helperPath = join(helperDir, 'wechat-db-helper.exe');
    const engineContacts = [
      '客户B',
      '客户C',
      '客户D',
      '客户E',
      '客户F',
      '客户G',
    ];
    try {
      await writeFile(helperPath, 'helper', 'utf8');
      await writeFile(
        nativeRuntimePath,
        [
          'console.log(JSON.stringify({',
          '  ok: true,',
          "  source: 'windows-wechat-native-uia-scroll',",
          "  contacts: ['海选007'],",
          "  items: [{ wxid: '海选007', nickname: '海选007' }],",
          '  count: 1,',
          "  diagnostics: { stage: 'native-uia-scroll-completed', engine: 'kaypal-wechat-native-runtime', uiaStatus: 'completed', uiaStopReason: 'no-scrollable-container', pagesScanned: 6, uiaContactCount: 1, dbKeyStatus: 'encrypted-or-locked', helperStatus: 'missing' }",
          '}));',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        enginePath,
        [
          'console.log(JSON.stringify({',
          '  ok: true,',
          "  source: 'windows-wechat-engine-db',",
          `  contacts: ${JSON.stringify(engineContacts)},`,
          `  items: ${JSON.stringify(engineContacts.map((name, index) => ({ wxid: `wxid_${index}`, nickname: name })))},`,
          `  count: ${engineContacts.length},`,
          "  currentWechatId: 'seller-current',",
          "  diagnostics: { stage: 'engine-db-completed', engine: 'kaypal-wechat-engine' }",
          '}));',
        ].join('\n'),
        'utf8',
      );

      const result = await service.runWechatWindowsContactSyncScript('all');

      expect(result.source).toBe('windows-wechat-engine-db');
      expect(result.contacts).toEqual(engineContacts);
      expect(result.diagnostics).toEqual(
        expect.objectContaining({
          nativeRuntimePath,
          decryptionHelperPath: helperPath,
          fallbackReason: expect.stringContaining('只识别到 1 个联系人'),
        }),
      );
    } finally {
      if (previousNativeRuntime === undefined) {
        delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      } else {
        process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME = previousNativeRuntime;
      }
      if (previousEngine === undefined) {
        delete process.env.AI_CONTENT_WECHAT_ENGINE;
      } else {
        process.env.AI_CONTENT_WECHAT_ENGINE = previousEngine;
      }
    }
  });

  it('returns diagnostics for a final low-confidence Windows full sync result without overwriting the cache', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatWindowsContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'windows-wechat-native-uia-scroll',
      contacts: ['海选007'],
      items: [{ wxid: '海选007', nickname: '海选007' }],
      count: 1,
      diagnostics: {
        stage: 'native-uia-scroll-completed',
        engine: 'kaypal-wechat-native-runtime',
        uiaStatus: 'completed',
        uiaStopReason: 'no-scrollable-container',
        pagesScanned: 6,
        uiaContactCount: 1,
        dbKeyStatus: 'encrypted-or-locked',
        helperStatus: 'missing',
      },
    }));

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'all',
    });

    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.cached).toBe(false);
    expect(result.syncFallbackReason).toContain('只识别到 1 个联系人');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        failureLayer: 'quality-gate',
        fallbackReason: expect.stringContaining('只识别到 1 个联系人'),
      }),
    );
    await expect(
      readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('accepts Windows visible contact sync when DB/helper is blocked but UIA returns contacts', async () => {
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.runWechatWindowsContactSyncScript = jest.fn(async () => ({
      ok: true,
      source: 'windows-wechat-native-uia',
      contacts: ['客户A', '客户B', '客户C'],
      items: [
        { wxid: '客户A', nickname: '客户A', source: 'wechat-native-uia' },
        { wxid: '客户B', nickname: '客户B', source: 'wechat-native-uia' },
        { wxid: '客户C', nickname: '客户C', source: 'wechat-native-uia' },
      ],
      count: 3,
      diagnostics: {
        stage: 'native-uia-visible-completed',
        engine: 'kaypal-wechat-native-runtime',
        uiaStatus: 'completed',
        pagesScanned: 1,
        uiaContactCount: 3,
        dbKeyStatus: 'encrypted-or-locked',
        helperStatus: 'failed',
      },
    }));

    const result = await service.syncWechatContacts({
      force: true,
      mode: 'random',
    });

    expect(result.count).toBe(3);
    expect(result.cached).toBe(false);
    expect(result.source).toBe('windows-wechat-native-uia');
    expect(result.contacts).toEqual(['客户A', '客户B', '客户C']);
    expect(result.syncFallbackReason).toBeUndefined();
    const cache = JSON.parse(
      await readFile(join(root, '.local-logs', 'wechat-contacts.json'), 'utf8'),
    );
    expect(cache.contacts).toEqual(['客户A', '客户B', '客户C']);
  });

  it('prefers the Windows WeChat sidecar engine before the legacy PowerShell scanner', async () => {
    const previousEngine = process.env.AI_CONTENT_WECHAT_ENGINE;
    const previousNativeRuntime = process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
    delete process.env.AI_CONTENT_WECHAT_ENGINE;
    delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
    const engineDir = join(root, 'desktop', 'runtime', 'wechat-engine');
    await mkdir(engineDir, { recursive: true });
    const enginePath = join(engineDir, 'kaypal-wechat-engine.js');
    try {
      await writeFile(
        enginePath,
        [
          'console.log(JSON.stringify({',
          '  ok: true,',
          "  source: 'windows-wechat-engine-db',",
          "  contacts: ['客户A', '客户B'],",
          "  items: [{ wxid: 'wxid_a', nickname: '客户A' }, { wxid: 'wxid_b', nickname: '客户B' }],",
          '  count: 2,',
          "  currentWechatId: 'seller-current',",
          "  diagnostics: { stage: 'engine-db-completed', engine: 'kaypal-wechat-engine', engineVersion: 'test' }",
          '}));',
        ].join('\n'),
        'utf8',
      );

      const result = await service.runWechatWindowsContactSyncScript('all');

      expect(result.source).toBe('windows-wechat-engine-db');
      expect(result.count).toBe(2);
      expect(result.diagnostics).toEqual(
        expect.objectContaining({
          stage: 'engine-db-completed',
          engine: 'kaypal-wechat-engine',
        }),
      );
    } finally {
      if (previousEngine === undefined) {
        delete process.env.AI_CONTENT_WECHAT_ENGINE;
      } else {
        process.env.AI_CONTENT_WECHAT_ENGINE = previousEngine;
      }
      if (previousNativeRuntime === undefined) {
        delete process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME;
      } else {
        process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME = previousNativeRuntime;
      }
    }
  });

  it('uses cloud vision fallback after Windows local contact sync fails with a screenshot', async () => {
    const screenshotPath = join(root, 'wechat-contact-screen.png');
    await writeFile(screenshotPath, 'fake image bytes', 'utf8');
    service.getRuntimePlatform = jest.fn(() => 'win32');
    service.configService = {
      get: jest.fn((key: string) =>
        key === 'AI_CONTENT_WECHAT_CONTACT_VISION_FALLBACK' ? 'true' : '',
      ),
    };
    service.defaultModels = {
      getDefaults: jest.fn(async () => ({ articleCreation: 'model_vision' })),
    };
    service.aiClient = {
      generateWithImage: jest.fn(async () =>
        JSON.stringify({ contacts: ['客户A', '客户B'], warnings: [] }),
      ),
    };
    const error = new Error('local failed') as Error & {
      diagnostics?: unknown;
    };
    error.diagnostics = {
      stage: 'collect-page-1-ocr',
      screenshotPath,
      attemptedSources: ['windows-uia', 'windows-ocr'],
    };
    service.runWechatWindowsContactSyncScript = jest.fn(async () => {
      throw error;
    });

    const result = await service.syncWechatContacts(true);

    expect(result.source).toBe('windows-wechat-vision');
    expect(result.contacts).toEqual(['客户A', '客户B']);
    expect(result.diagnostics?.attemptedSources).toContain('cloud-vision');
    expect(service.aiClient.generateWithImage).toHaveBeenCalledWith(
      'model_vision',
      expect.objectContaining({ imageBase64: expect.any(String) }),
      expect.objectContaining({ detail: 'high' }),
    );
  });

  it('parses markdown-wrapped vision contact JSON', () => {
    expect(
      service.parseWechatVisionContactsOutput(
        '```json\n{"contacts":["客户A"],"warnings":["低清"]}\n```',
      ),
    ).toEqual({ contacts: ['客户A'], warnings: ['低清'] });
  });

  it('skips cloud vision fallback when diagnostics show a non-WeChat page', async () => {
    const screenshotPath = join(root, 'not-wechat.png');
    await writeFile(screenshotPath, 'fake image bytes', 'utf8');
    service.configService = {
      get: jest.fn((key: string) =>
        key === 'AI_CONTENT_WECHAT_CONTACT_VISION_FALLBACK' ? 'true' : '',
      ),
    };
    service.defaultModels = {
      getDefaults: jest.fn(async () => ({ articleCreation: 'model_vision' })),
    };
    service.aiClient = {
      generateWithImage: jest.fn(),
    };
    const error = new Error('non wechat') as Error & { diagnostics?: unknown };
    error.diagnostics = {
      stage: 'collect-page-124-ocr',
      screenshotPath,
      failureReason: '当前焦点不是微信通讯录窗口',
      ocrPreview: ['惠通尿里', '新的朋友', '公众号', '发布中心'],
    };

    await expect(
      service.tryRunWechatContactVisionFallback(error),
    ).resolves.toBeNull();
    expect(service.aiClient.generateWithImage).not.toHaveBeenCalled();

    const raw = JSON.parse(
      await readFile(
        join(root, '.local-logs', 'wechat-contact-sync-diagnostics.json'),
        'utf8',
      ),
    );
    expect(raw.skipped).toBe(true);
    expect(raw.reason).toContain('当前焦点不是微信通讯录窗口');
  });

  it('rejects unsupported platforms with a clear desktop support message', async () => {
    service.getRuntimePlatform = jest.fn(() => 'linux');

    await expect(service.syncWechatContacts(true)).rejects.toThrow(
      '仅支持 macOS/Windows 微信桌面版',
    );
  });
});
