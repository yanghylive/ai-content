import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup as backupSqliteDatabase, DatabaseSync } from 'node:sqlite';
import axios from 'axios';

const mockOssPut = jest.fn();

jest.mock('ali-oss', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ put: mockOssPut })),
}));

import { CommercialReadinessService } from './commercial-readiness.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppMarketService } from '../app-market/app-market.service';
import type { CrmService } from '../crm/crm.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { BillingService } from '../billing/billing.service';

function makePrismaMock() {
  const count = jest.fn().mockResolvedValue(1);
  const $executeRawUnsafe = jest.fn(async (sql: string) => {
    const match = sql.match(/^VACUUM INTO '((?:''|[^'])+)'$/);
    if (!match) return 0;
    const target = match[1].replaceAll("''", "'");
    const sourceValue = process.env.SQLITE_DATABASE_URL || '';
    const sourceFile = decodeURIComponent(sourceValue.replace(/^file:/, ''));
    const source = new DatabaseSync(sourceFile, { readOnly: true });
    try {
      await backupSqliteDatabase(source, target);
    } finally {
      source.close();
    }
    return 0;
  });
  return {
    $executeRawUnsafe,
    user: { count },
    userSession: { count },
    systemLog: { count },
    appInstallState: { count },
    crmCustomer: { count },
    crmCompany: { count },
    crmOpportunity: { count },
    crmTask: { count },
    crmNote: { count },
    crmTimelineEvent: { count },
  } as unknown as jest.Mocked<PrismaService>;
}

function makeAppMarketMock(installed = true) {
  return {
    getCrmState: jest.fn().mockResolvedValue({
      appKey: 'crm',
      name: 'CRM 客户管理',
      description: '',
      priceLabel: '',
      purchaseStatus: installed ? 'purchased' : 'not_purchased',
      installStatus: installed ? 'installed' : 'not_installed',
      purchased: installed,
      installed,
      commercialEntitled: true,
      commercialEntitlementRequired: true,
      entitlementSource: 'kaypal-subscription',
      entitlementPlan: 'ADVANCED',
      commercialBlockers: [],
      commercialWarnings: [],
      canPurchase: false,
      canInstall: false,
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: null,
    }),
  } as unknown as jest.Mocked<AppMarketService>;
}

function makeCrmMock() {
  return {
    createImportDryRun: jest.fn().mockReturnValue({
      rowCount: 1,
      previewRows: [{ displayName: 'Readiness Contact' }],
      writeTables: [],
      requiredFutureGate: '11G',
      proof: { id: 'proof-1', hash: 'hash-1' },
      safety: { requiredFutureGate: '11G', writeTables: [] },
    }),
    getCloserAdvice: jest.fn().mockResolvedValue({
      advice: [{ id: 'advice-1', script: '跟进客户' }],
      safety: {
        autoWrite: false,
        writeTables: [],
        disclaimer: 'read-only no-write',
      },
    }),
    getConnectorReadiness: jest.fn().mockReturnValue({
      connectors: [
        'twenty',
        'hubspot',
        'salesforce',
        'feishu',
        'csv-excel',
      ].map((key) => ({
        key,
        mode: 'contract-only',
      })),
      summaryStats: { requiredFutureGate: '11G' },
      safety: {
        noToken: true,
        noNetwork: true,
        noWrite: true,
        writeTables: [],
      },
      audit: { proofHash: 'connector-proof' },
    }),
  } as unknown as jest.Mocked<CrmService>;
}

function makeBillingMock(
  overrides: Partial<
    Awaited<ReturnType<BillingService['getReadinessEvidence']>>
  > = {},
) {
  return {
    getReadinessEvidence: jest.fn().mockResolvedValue({
      configured: false,
      webhookSecretConfigured: false,
      latestEventAt: null,
      latestEventStatus: null,
      latestProvider: null,
      latestSubscriptionStatus: null,
      latestSubscriptionPlan: null,
      latestInvoiceStatus: null,
      activeSubscriptionCount: 0,
      verifiedWebhookCount: 0,
      processedWebhookCount: 0,
      invoiceAuditCount: 0,
      failedInvoiceCount: 0,
      lifecycleEventCount: 0,
      ...overrides,
    }),
  } as unknown as jest.Mocked<BillingService>;
}

function makeUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    name: 'Tester',
    status: 'active',
    lastLoginAt: null,
    kaypalUserId: 'kaypal-1',
    kaypalPlan: 'ADVANCED',
    kaypalPlanExpired: false,
    kaypalRole: null,
    kaypalPlatformRole: null,
    kaypalPermissionNames: [],
    role: 'admin',
    commercialExecutionAllowed: true,
    planMode: 'commercial',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

describe('CommercialReadinessService', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    mockOssPut.mockReset();
    mockOssPut.mockResolvedValue({});
    process.env = { ...originalEnv };
    [
      'GROWTH_LIVE_READY_EVIDENCE',
      'WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE',
      'WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE',
      'WINDOWS_GATE_GROWTH_SEND_EVIDENCE',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'HUBSPOT_PRIVATE_APP_TOKEN',
      'HUBSPOT_ACCESS_TOKEN',
      'KAYPAL_HUBSPOT_ACCESS_TOKEN',
      'SALESFORCE_CLIENT_ID',
      'SALESFORCE_CLIENT_SECRET',
      'DATABASE_URL',
      'KAYPAL_API_BASE_URL',
      'KAYPAL_CLOUD_API_URL',
      'COMMERCIAL_BACKUP_DATABASE_URL',
      'COMMERCIAL_BACKUP_ROOT',
      'COMMERCIAL_BACKUP_OBJECT_STORE_DIR',
      'COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER',
      'COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID',
      'COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET',
      'COMMERCIAL_BACKUP_OSS_BUCKET',
      'COMMERCIAL_BACKUP_OSS_ENDPOINT',
      'COMMERCIAL_BACKUP_OSS_REGION',
      'COMMERCIAL_BACKUP_OSS_PREFIX',
      'COMMERCIAL_RESTORE_DATABASE_URL',
      'COMMERCIAL_BACKUP_DAEMON',
      'COMMERCIAL_BACKUP_DAEMON_ARMED',
      'COMMERCIAL_BACKUP_RUN_ON_START',
      'COMMERCIAL_BACKUP_INTERVAL_MS',
      'COMMERCIAL_BACKUP_ISOLATED_RESTORE_ON_SCHEDULE',
      'COMMERCIAL_BACKUP_RETENTION_COUNT',
      'COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL',
      'COMMERCIAL_BACKUP_ALERT_PROVIDER',
      'COMMERCIAL_BACKUP_ALERT_ON_SUCCESS',
      'COMMERCIAL_BACKUP_AUTO_PREPARE_RESTORE_DATABASE',
      'COMMERCIAL_RESTORE_ADMIN_DATABASE_URL',
      'COMMERCIAL_RELEASE_DESKTOP_ROOT',
      'COMMERCIAL_RELEASE_DIST_DIRS',
      'PG_DUMP_PATH',
      'PSQL_RESTORE_PATH',
    ].forEach((name) => {
      delete process.env[name];
    });
    tempDir = mkdtempSync(join(tmpdir(), 'commercial-readiness-'));
    process.env.COMMERCIAL_BACKUP_ROOT = join(tempDir, 'backups');
    const sqliteFile = join(tempDir, 'kaypal-ai.sqlite');
    process.env.SQLITE_DATABASE_URL = `file:${sqliteFile}`;
    const sqlite = new DatabaseSync(sqliteFile);
    sqlite.exec(
      'CREATE TABLE readiness_fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
    );
    sqlite
      .prepare('INSERT INTO readiness_fixture (value) VALUES (?)')
      .run('commercial-backup-test');
    sqlite.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns blockers when cloud payment and external CRM are not configured', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const summary = await service.getSummary(makeUser());

    expect(summary.score).toBeLessThan(100);
    expect(
      summary.checks.some((check) => check.key === 'payment.cloud-billing'),
    ).toBe(true);
    expect(
      summary.blockers.some((check) => check.key === 'payment.cloud-billing'),
    ).toBe(true);
  });

  it('lists user cooperation items when live commercial evidence is missing', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const summary = await service.getSummary(makeUser());
    const items = new Map(
      summary.cooperationItems.map((item) => [item.key, item]),
    );

    expect(items.get('growth.douyin-login')?.status).toBe('needed');
    expect(items.get('windows.wechat-contact-sync')?.owner).toBe('user');
    expect(items.get('windows.platform-qr-binding')?.status).toBe('needed');
    expect(items.get('windows.growth-send-readback')?.nextAction).toContain(
      'WINDOWS_GATE_GROWTH_SEND_EVIDENCE',
    );
    expect(items.get('payment.stripe-webhook')?.status).toBe('needed');
    expect(summary.evidence.cooperation).toEqual({
      received: 0,
      needed: 5,
      blocked: 0,
    });
  });

  it('marks cooperation evidence as received when supplied files and Stripe secrets exist', async () => {
    const evidenceFile = join(tempDir, 'windows-commercial-proof.md');
    writeFileSync(evidenceFile, 'Windows proof success');
    process.env.GROWTH_LIVE_READY_EVIDENCE = evidenceFile;
    process.env.WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE = evidenceFile;
    process.env.WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE = evidenceFile;
    process.env.WINDOWS_GATE_GROWTH_SEND_EVIDENCE = evidenceFile;
    process.env.STRIPE_SECRET_KEY = 'sk_test_redacted';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_redacted';

    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const summary = await service.getSummary(makeUser());

    expect(summary.cooperationItems).toHaveLength(5);
    expect(
      summary.cooperationItems.every((item) => item.status === 'received'),
    ).toBe(true);
    expect(summary.evidence.cooperation).toEqual({
      received: 5,
      needed: 0,
      blocked: 0,
    });
  });

  it('passes payment readiness only after verified webhook, active subscription, and invoice audit evidence', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock({
        configured: true,
        webhookSecretConfigured: true,
        latestEventAt: '2026-07-01T12:00:00.000Z',
        latestEventStatus: 'processed',
        latestProvider: 'kaypal',
        latestSubscriptionStatus: 'active',
        latestSubscriptionPlan: 'ADVANCED',
        latestInvoiceStatus: 'paid',
        activeSubscriptionCount: 1,
        verifiedWebhookCount: 1,
        processedWebhookCount: 1,
        invoiceAuditCount: 1,
        failedInvoiceCount: 0,
        lifecycleEventCount: 2,
      }),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const summary = await service.getSummary(makeUser());
    const payment = summary.checks.find(
      (check) => check.key === 'payment.cloud-billing',
    );

    expect(payment?.status).toBe('pass');
    expect(summary.evidence.billing).toMatchObject({
      configured: true,
      processedWebhookCount: 1,
      activeSubscriptionCount: 1,
    });
  });

  it('creates a local sqlite backup manifest', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const result = await service.createLocalBackup(makeUser());

    expect(result.status).toBe('created');
    expect(result.backupKind).toBe('sqlite');
    expect(result.databaseFile).toContain('kaypal-ai.sqlite');
    expect(result.manifestFile).toBeTruthy();
    expect(existsSync(result.manifestFile!)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
    const manifest = JSON.parse(
      readFileSync(result.manifestFile!, 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      verification: {
        integrityCheck: 'ok',
        tableCount: 1,
      },
    });
  });

  it('includes committed WAL data in an online sqlite backup', async () => {
    const sourceFile = join(tempDir, 'kaypal-ai.sqlite');
    const liveDatabase = new DatabaseSync(sourceFile);
    liveDatabase.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
    liveDatabase
      .prepare('INSERT INTO readiness_fixture (value) VALUES (?)')
      .run('committed-in-wal');
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    try {
      const result = await service.createLocalBackup(makeUser());
      const backup = new DatabaseSync(result.databaseFile!, {
        readOnly: true,
      });
      try {
        const row = backup
          .prepare(
            'SELECT COUNT(*) AS count FROM readiness_fixture WHERE value = ?',
          )
          .get('committed-in-wal') as Record<string, unknown>;
        expect(Number(row.count)).toBe(1);
      } finally {
        backup.close();
      }
    } finally {
      liveDatabase.close();
    }
  });

  it('rejects a sqlite backup after its bytes are changed', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const result = await service.createLocalBackup(makeUser());
    appendFileSync(result.databaseFile!, 'tamper');

    const restoreDryRun = service.runBackupRestoreDryRun();

    expect(restoreDryRun.status).toBe('failed');
    expect(restoreDryRun.manifestValid).toBe(false);
  });

  it('rejects a backup manifest that points outside its backup directory', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const result = await service.createLocalBackup(makeUser());
    const manifest = JSON.parse(
      readFileSync(result.manifestFile!, 'utf8'),
    ) as Record<string, unknown>;
    const files = manifest.files as Array<Record<string, unknown>>;
    files[0].path = join(tempDir, 'kaypal-ai.sqlite');
    writeFileSync(result.manifestFile!, JSON.stringify(manifest), 'utf8');

    const restoreDryRun = service.runBackupRestoreDryRun();

    expect(restoreDryRun.status).toBe('failed');
    expect(restoreDryRun.manifestValid).toBe(false);
    expect(restoreDryRun.databaseFile).toBeNull();
  });

  it('uploads sqlite backups to Aliyun OSS when backup OSS credentials are configured', async () => {
    process.env.COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER = 'aliyun-oss';
    process.env.COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID = 'test-access-key';
    process.env.COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET = 'test-secret';
    process.env.COMMERCIAL_BACKUP_OSS_BUCKET = 'kaypal-backups';
    process.env.COMMERCIAL_BACKUP_OSS_ENDPOINT =
      'https://oss-cn-hangzhou.aliyuncs.com';
    process.env.COMMERCIAL_BACKUP_OSS_PREFIX = 'commercial/test';

    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const result = await service.createLocalBackup(makeUser());
    const status = service.getBackupStatus();

    expect(result.status).toBe('created');
    expect(result.objectStoreMirror).toMatchObject({
      enabled: true,
      provider: 'aliyun-oss',
      bucket: 'kaypal-backups',
      prefix: 'commercial/test',
      valid: true,
    });
    expect(result.objectStoreMirror?.manifestFile).toMatch(
      /^oss:\/\/kaypal-backups\/commercial\/test\//,
    );
    expect(result.objectStoreMirror?.uploadedKeys).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/commercial\/test\/.+\/kaypal-ai\.sqlite$/),
        expect.stringMatching(/commercial\/test\/.+\/manifest\.json$/),
      ]),
    );
    expect(mockOssPut).toHaveBeenCalledWith(
      expect.stringMatching(/commercial\/test\/.+\/manifest\.json$/),
      result.manifestFile,
    );
    expect(status.objectStoreMirror.provider).toBe('aliyun-oss');
    expect(status.objectStoreMirror.valid).toBe(true);
  });

  it('does not pretend Aliyun OSS backup is valid when required credentials are missing', async () => {
    process.env.COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER = 'aliyun-oss';
    process.env.COMMERCIAL_BACKUP_OSS_BUCKET = 'kaypal-backups';

    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const result = await service.createLocalBackup(makeUser());

    expect(result.status).toBe('created');
    expect(result.objectStoreMirror).toMatchObject({
      enabled: true,
      provider: 'aliyun-oss',
      valid: false,
    });
    expect(result.objectStoreMirror?.message).toContain('配置不完整');
    expect(mockOssPut).not.toHaveBeenCalled();
  });

  it('reports backup status and passes restore dry-run after a local backup exists', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    await service.createLocalBackup(makeUser());
    const status = service.getBackupStatus();
    const restoreDryRun = service.runBackupRestoreDryRun();

    expect(status.supported).toBe(true);
    expect(status.restoreDryRunReady).toBe(true);
    expect(status.manifestValid).toBe(true);
    expect(restoreDryRun.status).toBe('pass');
    expect(restoreDryRun.manifestValid).toBe(true);
    expect(restoreDryRun.sqliteHeaderValid).toBe(true);
  });

  it('reports release rollback readiness from local Windows installers', () => {
    const desktopRoot = join(tempDir, 'desktop');
    const distRoot = join(desktopRoot, 'dist');
    const scriptsRoot = join(desktopRoot, 'scripts');
    mkdirSync(distRoot, { recursive: true });
    mkdirSync(scriptsRoot, { recursive: true });
    process.env.COMMERCIAL_RELEASE_DESKTOP_ROOT = desktopRoot;
    writeFileSync(
      join(desktopRoot, 'package.json'),
      JSON.stringify({ version: '1.1.40' }),
      'utf8',
    );
    writeFileSync(join(scriptsRoot, 'release.js'), 'console.log("release")');
    writeFileSync(
      join(scriptsRoot, 'verify-oss-release.js'),
      'console.log("verify")',
    );
    const currentInstaller = join(
      distRoot,
      'KaypalAI内容创作平台 Setup 1.1.40.exe',
    );
    const previousInstaller = join(
      distRoot,
      'KaypalAI内容创作平台 Setup 1.1.39.exe',
    );
    writeFileSync(currentInstaller, 'current installer');
    writeFileSync(`${currentInstaller}.blockmap`, 'current blockmap');
    writeFileSync(previousInstaller, 'previous installer');
    writeFileSync(`${previousInstaller}.blockmap`, 'previous blockmap');
    writeFileSync(
      join(distRoot, 'latest.yml'),
      [
        'version: 1.1.40',
        'path: KaypalAI内容创作平台 Setup 1.1.40.exe',
        'sha512: fake-sha512',
        "releaseDate: '2026-07-03T00:27:03.650Z'",
      ].join('\n'),
    );
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const status = service.getReleaseRollbackStatus();

    expect(status.ready).toBe(true);
    expect(status.currentVersion).toBe('1.1.40');
    expect(status.latestFeedVersion).toBe('1.1.40');
    expect(status.currentInstaller?.installerPath).toBe(currentInstaller);
    expect(status.rollbackCandidate?.version).toBe('1.1.39');
    expect(status.rollbackCandidate?.blockmapPath).toBe(
      `${previousInstaller}.blockmap`,
    );
    expect(status.proofHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('runs release rollback dry-run without destructive actions after backup is restorable', async () => {
    const desktopRoot = join(tempDir, 'desktop');
    const distRoot = join(desktopRoot, 'dist');
    const scriptsRoot = join(desktopRoot, 'scripts');
    mkdirSync(distRoot, { recursive: true });
    mkdirSync(scriptsRoot, { recursive: true });
    process.env.COMMERCIAL_RELEASE_DESKTOP_ROOT = desktopRoot;
    writeFileSync(
      join(desktopRoot, 'package.json'),
      JSON.stringify({ version: '1.1.40' }),
      'utf8',
    );
    writeFileSync(join(scriptsRoot, 'release.js'), 'console.log("release")');
    writeFileSync(
      join(scriptsRoot, 'verify-oss-release.js'),
      'console.log("verify")',
    );
    const currentInstaller = join(
      distRoot,
      'KaypalAI内容创作平台 Setup 1.1.40.exe',
    );
    const previousInstaller = join(
      distRoot,
      'KaypalAI内容创作平台 Setup 1.1.39.exe',
    );
    writeFileSync(currentInstaller, 'current installer');
    writeFileSync(`${currentInstaller}.blockmap`, 'current blockmap');
    writeFileSync(previousInstaller, 'previous installer');
    writeFileSync(`${previousInstaller}.blockmap`, 'previous blockmap');
    writeFileSync(
      join(distRoot, 'latest.yml'),
      [
        'version: 1.1.40',
        'path: KaypalAI内容创作平台 Setup 1.1.40.exe',
        'sha512: fake-sha512',
        "releaseDate: '2026-07-03T00:27:03.650Z'",
      ].join('\n'),
    );
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );
    await service.createLocalBackup(makeUser());

    const result = service.runReleaseRollbackDryRun();

    expect(result.status).toBe('pass');
    expect(result.noDestructiveAction).toBe(true);
    expect(result.rollbackTargetVersion).toBe('1.1.39');
    expect(result.rollbackTargetInstaller).toBe(previousInstaller);
    expect(result.backupRestoreDryRunStatus).toBe('pass');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'safety.no-destructive-action',
          status: 'pass',
        }),
      ]),
    );
    expect(result.proofHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps backup scheduler disabled by default', () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const scheduler = service.getBackupSchedulerStatus();

    expect(scheduler.enabled).toBe(false);
    expect(scheduler.armed).toBe(false);
    expect(scheduler.running).toBe(false);
    expect(scheduler.lastRun).toBeNull();
  });

  it('runs a manual scheduled backup and records restore status', async () => {
    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const run = await service.runBackupSchedulerOnce(makeUser());
    const scheduler = service.getBackupSchedulerStatus();

    expect(run.source).toBe('manual');
    expect(run.status).toBe('created');
    expect(run.backupKind).toBe('sqlite');
    expect(run.restoreDryRunStatus).toBe('pass');
    expect(run.manifestFile).toBeTruthy();
    expect(scheduler.lastRun).toMatchObject({
      source: 'manual',
      status: 'created',
      restoreDryRunStatus: 'pass',
    });
  });

  it('applies explicit retention policy after scheduled backup', async () => {
    process.env.COMMERCIAL_BACKUP_RETENTION_COUNT = '1';
    const objectStoreRoot = join(tempDir, 'object-store');
    process.env.COMMERCIAL_BACKUP_OBJECT_STORE_DIR = objectStoreRoot;
    const oldLocalDir = join(
      process.env.COMMERCIAL_BACKUP_ROOT!,
      '2000-01-01T00-00-00-000Z',
    );
    const oldMirrorDir = join(objectStoreRoot, '2000-01-01T00-00-00-000Z');
    mkdirSync(oldLocalDir, { recursive: true });
    mkdirSync(oldMirrorDir, { recursive: true });
    writeFileSync(join(oldLocalDir, 'keep.txt'), 'old', {
      flag: 'w',
    });
    writeFileSync(join(oldMirrorDir, 'keep.txt'), 'old', {
      flag: 'w',
    });

    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const run = await service.runBackupSchedulerOnce(makeUser());

    expect(run.status).toBe('created');
    expect(run.retention.enabled).toBe(true);
    expect(run.retention.keepLatest).toBe(1);
    expect(run.retention.prunedLocalDirs).toContain(oldLocalDir);
    expect(run.retention.prunedMirrorDirs).toContain(oldMirrorDir);
    expect(existsSync(oldLocalDir)).toBe(false);
    expect(existsSync(oldMirrorDir)).toBe(false);
  });

  it('sends a configured backup alert when scheduled backup fails', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ status: 202 });
    process.env.COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL =
      'https://alerts.example.test/commercial-backup';
    process.env.SQLITE_DATABASE_URL = `file:${join(tempDir, 'missing.sqlite')}`;

    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const run = await service.runBackupSchedulerOnce(makeUser());

    expect(run.status).toBe('unsupported');
    expect(run.alert).toMatchObject({
      configured: true,
      sent: true,
      statusCode: 202,
    });
    expect(post).toHaveBeenCalledWith(
      'https://alerts.example.test/commercial-backup',
      expect.objectContaining({
        type: 'commercial_backup_run',
        severity: 'critical',
      }),
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('formats configured backup alerts for WeCom robots', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ status: 200 });
    process.env.COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL =
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test';
    process.env.COMMERCIAL_BACKUP_ALERT_PROVIDER = 'wecom';
    process.env.COMMERCIAL_BACKUP_ALERT_ON_SUCCESS = 'true';

    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const run = await service.runBackupSchedulerOnce(makeUser());

    expect(run.status).toBe('created');
    expect(run.alert).toMatchObject({
      configured: true,
      sent: true,
      provider: 'wecom',
      statusCode: 200,
    });
    expect(post).toHaveBeenCalledWith(
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
      {
        msgtype: 'markdown',
        markdown: {
          content: expect.stringContaining('Commercial backup INFO'),
        },
      },
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('creates a postgres pg_dump backup and passes restore dry-run when pg_dump is available', async () => {
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=30&connection_limit=30';
    process.env.COMMERCIAL_BACKUP_OBJECT_STORE_DIR = join(
      tempDir,
      'object-store',
    );
    process.env.COMMERCIAL_RESTORE_DATABASE_URL =
      'postgresql://postgres:postgres@127.0.0.1:5432/ai_content_restore?pool_timeout=30';
    process.env.COMMERCIAL_BACKUP_AUTO_PREPARE_RESTORE_DATABASE = 'true';
    const fakePgDump = join(tempDir, 'pg_dump');
    const fakePsql = join(tempDir, 'psql');
    writeFileSync(
      fakePgDump,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 16.0"; exit 0; fi',
        'case "$*" in *pool_timeout*|*connection_limit*) echo "bad prisma param" >&2; exit 2;; esac',
        'echo "-- PostgreSQL database dump"',
        'echo "CREATE TABLE test_backup(id integer);"',
      ].join('\n'),
      'utf8',
    );
    chmodSync(fakePgDump, 0o755);
    writeFileSync(
      fakePsql,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "psql (PostgreSQL) 16.0"; exit 0; fi',
        'case "$*" in *ai_content_restore*) exit 0;; *) echo "wrong restore target" >&2; exit 2;; esac',
      ].join('\n'),
      'utf8',
    );
    chmodSync(fakePsql, 0o755);
    process.env.PG_DUMP_PATH = fakePgDump;
    process.env.PSQL_RESTORE_PATH = fakePsql;

    const service = new CommercialReadinessService(
      makePrismaMock(),
      makeAppMarketMock(true),
      makeBillingMock(),
      makeCrmMock(),
      new EntitlementsService(),
    );

    const result = await service.createLocalBackup(makeUser());
    const status = service.getBackupStatus();
    const restoreDryRun = service.runBackupRestoreDryRun();
    const isolatedRestore = service.runBackupIsolatedRestoreDryRun();

    expect(result.status).toBe('created');
    expect(result.backupKind).toBe('postgres');
    expect(result.objectStoreMirror?.enabled).toBe(true);
    expect(result.objectStoreMirror?.valid).toBe(true);
    expect(status.databaseKind).toBe('postgres');
    expect(status.pgDumpAvailable).toBe(true);
    expect(status.objectStoreMirror.valid).toBe(true);
    expect(restoreDryRun.status).toBe('pass');
    expect(restoreDryRun.backupKind).toBe('postgres');
    expect(restoreDryRun.contentValid).toBe(true);
    expect(isolatedRestore.status).toBe('pass');
    expect(isolatedRestore.isolatedRestoreExecuted).toBe(true);
    expect(isolatedRestore.restoreDatabasePrepared).toBe(true);
    expect(isolatedRestore.restoreDatabaseUrl).toContain('ai_content_restore');
  });
});
