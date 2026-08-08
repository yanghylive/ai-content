import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import OSS from 'ali-oss';
import { safeText } from '../../common/text.utils';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveProjectDataPath,
  resolveProjectRoot,
} from '../../common/project-paths';
import { AppMarketService } from '../app-market/app-market.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { isKaypalPlanAtLeast } from '../auth/plan-order';
import { BillingService } from '../billing/billing.service';
import type { BillingReadinessEvidence } from '../billing/billing.types';
import { CrmService } from '../crm/crm.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { EffectiveEntitlement } from '../entitlements/entitlements.types';
import { COMMERCIAL_BACKUP_REQUIRED_PLANS } from './commercial-readiness.constants';
import type {
  CommercialBackupResult,
  CommercialBackupIsolatedRestoreDryRunResult,
  CommercialBackupObjectStoreMirror,
  CommercialBackupRestoreDryRunResult,
  CommercialBackupAlertResult,
  CommercialBackupRetentionResult,
  CommercialBackupScheduledRunResult,
  CommercialBackupSchedulerStatus,
  CommercialBackupStatus,
  CommercialReleaseRollbackCandidate,
  CommercialReleaseRollbackDryRunResult,
  CommercialReleaseRollbackStatus,
  CommercialReadinessCooperationItem,
  CommercialReadinessCheck,
  CommercialReadinessSummary,
} from './commercial-readiness.types';

type ReleaseLatestMetadata = {
  filePath: string;
  version: string | null;
  path: string | null;
  sha512: string | null;
  releaseDate: string | null;
};

@Injectable()
export class CommercialReadinessService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CommercialReadinessService.name);
  private backupDaemon?: ReturnType<typeof setInterval>;
  private backupDaemonRunning = false;
  private latestScheduledBackupRun: CommercialBackupScheduledRunResult | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appMarket: AppMarketService,
    private readonly billing: BillingService,
    private readonly crm: CrmService,
    private readonly entitlements: EntitlementsService,
  ) {}

  onModuleInit() {
    this.startBackupSchedulerIfConfigured();
  }

  onModuleDestroy() {
    if (this.backupDaemon) {
      clearInterval(this.backupDaemon);
      this.backupDaemon = undefined;
    }
  }

  async getSummary(
    user: AuthenticatedUser,
  ): Promise<CommercialReadinessSummary> {
    const [
      userCount,
      activeSessionCount,
      systemLogCount,
      appInstallCount,
      crmCustomerCount,
      crmCompanyCount,
      crmOpportunityCount,
      crmTaskCount,
      crmNoteCount,
      crmTimelineCount,
      crmApp,
    ] = await Promise.all([
      this.safeCount(() => this.prisma.user.count()),
      this.safeCount(() =>
        this.prisma.userSession.count({
          where: { expiresAt: { gt: new Date() } },
        }),
      ),
      this.safeCount(() => this.prisma.systemLog.count()),
      this.safeCount(() => this.prisma.appInstallState.count()),
      this.safeCount(() =>
        this.prisma.crmCustomer.count({ where: { ownerId: user.id } }),
      ),
      this.safeCount(() =>
        this.prisma.crmCompany.count({ where: { ownerId: user.id } }),
      ),
      this.safeCount(() =>
        this.prisma.crmOpportunity.count({ where: { ownerId: user.id } }),
      ),
      this.safeCount(() =>
        this.prisma.crmTask.count({ where: { ownerId: user.id } }),
      ),
      this.safeCount(() =>
        this.prisma.crmNote.count({ where: { ownerId: user.id } }),
      ),
      this.safeCount(() =>
        this.prisma.crmTimelineEvent.count({ where: { ownerId: user.id } }),
      ),
      this.appMarket.getCrmState(user).catch(() => null),
    ]);

    const entitlement =
      await this.entitlements.getEffectiveEntitlementForUser(user);
    const backupExportGate = this.buildBackupExportGate(entitlement);
    const [
      crmImportDryRun,
      crmCloserAdvice,
      crmConnectorReadiness,
      billingReadiness,
    ] = await Promise.all([
      this.safeValue(() =>
        Promise.resolve(
          this.crm.createImportDryRun(user.id, {
            filename: 'commercial-readiness-crm-dry-run.csv',
            sourceType: 'commercial-readiness',
            rows: [
              {
                company: 'Readiness Demo Co',
                contact: 'Readiness Contact',
                phone: '13800000000',
                note: 'commercial readiness dry-run sample',
              },
            ],
          }),
        ),
      ),
      this.safeValue(() => this.crm.getCloserAdvice(user.id)),
      this.safeValue(() =>
        Promise.resolve(this.crm.getConnectorReadiness(user.id)),
      ),
      this.safeValue(() => this.billing.getReadinessEvidence()),
    ]);
    const crmImportGate = this.buildCrmImportSafeDryRunGate(crmImportDryRun);
    const crmCloserGate = this.buildCrmCloserReadOnlyGate(crmCloserAdvice);
    const crmConnectorGate = this.buildCrmConnectorContractOnlyGate(
      crmConnectorReadiness,
    );
    const databaseTarget = this.resolveDatabaseTarget();
    const backup = this.latestBackupSnapshot();
    const backupStatus = this.buildBackupStatus();
    const backupSchedulerStatus = this.getBackupSchedulerStatus();
    const releaseRollbackStatus = this.getReleaseRollbackStatus();
    const backupDatabaseExists = backupStatus.databaseExists;
    const backupSnapshotReady =
      backupStatus.supported &&
      backup.exists &&
      backup.manifestValid &&
      backupStatus.restoreDryRunReady;
    const backupMirrorReady = Boolean(
      backupStatus.objectStoreMirror?.enabled &&
      backupStatus.objectStoreMirror.valid,
    );
    const windows = this.windowsPackagingSnapshot();
    const billingEvidence =
      this.normalizeBillingReadinessEvidence(billingReadiness);
    const cooperationItems = this.buildCooperationItems(billingEvidence);
    const externalCrmConfigured = this.hasAnyEnv([
      'HUBSPOT_PRIVATE_APP_TOKEN',
      'HUBSPOT_ACCESS_TOKEN',
      'KAYPAL_HUBSPOT_ACCESS_TOKEN',
      'SALESFORCE_CLIENT_ID',
      'SALESFORCE_CLIENT_SECRET',
    ]);
    const paymentConfigured = billingEvidence.configured;
    const paymentSecretConfigured =
      billingEvidence.webhookSecretConfigured ||
      this.hasAnyEnv([
        'KAYPAL_API_BASE_URL',
        'KAYPAL_CLOUD_API_URL',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
      ]);
    const acceptanceGateExists = existsSync(
      join(resolveProjectRoot(), 'scripts', 'commercial-acceptance-gate.mjs'),
    );

    const checks: CommercialReadinessCheck[] = [
      {
        key: 'auth.entitlement',
        title: '登录与订阅授权',
        status: entitlement.cloudSubscriptionActive ? 'pass' : 'blocker',
        summary: entitlement.cloudSubscriptionActive
          ? `已绑定 Kaypal 用户，订阅为 ${entitlement.plan}`
          : '缺少有效 Kaypal 订阅授权，不能按商用 SaaS 交付',
        evidence: {
          ...entitlement.evidence,
          source: entitlement.source,
          features: entitlement.features,
          blockers: entitlement.blockers,
          activeSessionCount,
          userCount,
        },
        nextAction: '继续把支付、应用市场和本地执行都接到统一 entitlement 服务',
      },
      {
        key: 'license.local-commercial-mode',
        title: '本地商用执行权限',
        status: entitlement.localCommercialAllowed ? 'pass' : 'warn',
        summary: entitlement.localCommercialAllowed
          ? '当前用户已打开商用执行权限'
          : '当前用户仍处于试点/受控执行模式',
        evidence: {
          role: entitlement.role,
          planMode: entitlement.planMode,
          commercialExecutionAllowed: entitlement.commercialExecutionAllowed,
          entitlementSource: entitlement.source,
        },
        nextAction: '上线前把商用执行权限和订阅状态绑定，避免仅靠本地开关',
      },
      {
        key: 'app-market.crm',
        title: 'CRM 应用购买与安装',
        status: crmApp?.purchased && crmApp?.installed ? 'pass' : 'blocker',
        summary:
          crmApp?.purchased && crmApp?.installed
            ? 'CRM 已购买并安装'
            : 'CRM 没有完成购买/安装闭环',
        evidence: crmApp ? { ...crmApp } : { available: false },
        nextAction: '应用市场必须保留购买、安装、卸载和 entitlement 审计',
      },
      {
        key: 'crm.data-closed-loop',
        title: 'CRM 数据闭环',
        status: crmCustomerCount > 0 && crmTimelineCount > 0 ? 'pass' : 'warn',
        summary:
          crmCustomerCount > 0 && crmTimelineCount > 0
            ? 'CRM 已有客户和时间线数据'
            : 'CRM 数据模型已在，但还缺真实业务数据闭环',
        evidence: {
          customers: crmCustomerCount,
          companies: crmCompanyCount,
          opportunities: crmOpportunityCount,
          tasks: crmTaskCount,
          notes: crmNoteCount,
          timelineEvents: crmTimelineCount,
        },
        nextAction: '继续把自动获客、导入、外部 CRM 同步统一写入 CRM 时间线',
      },
      {
        key: 'crm.import.safe-dry-run',
        title: 'CRM 受控导入安全干跑',
        status: crmImportGate.status,
        summary: crmImportGate.summary,
        evidence: crmImportGate.evidence,
        nextAction:
          '保持 preview/dry-run no-write；本地 CRM commit 必须走显式 gate、proof、rollback。',
      },
      {
        key: 'crm.closer.read-only-advice',
        title: 'Closer 只读销售建议',
        status: crmCloserGate.status,
        summary: crmCloserGate.summary,
        evidence: crmCloserGate.evidence,
        nextAction:
          '补齐人工确认后写备注/建任务的受控动作，不允许 AI 建议直接外发或直接写正式客户表。',
      },
      {
        key: 'crm.connectors.contract-only',
        title: 'Existing CRM Connector 合同边界',
        status: crmConnectorGate.status,
        summary: crmConnectorGate.summary,
        evidence: crmConnectorGate.evidence,
        nextAction:
          'Phase 1 保持 no-token/no-network/no-write；真实 OAuth/read-only sandbox 进入下一阶段。',
      },
      {
        key: 'tenant.isolation',
        title: '多租户隔离',
        status: 'warn',
        summary:
          entitlement.tenant.source === 'persisted-default'
            ? '已建立持久化默认租户和成员关系，但业务表还没有全面迁到 tenantId'
            : '当前只有临时租户上下文，还没有完整 tenant/org 持久化模型',
        evidence: {
          ...entitlement.tenant,
          isolationKey: entitlement.tenant.tenantId,
          tenantModelPresent: entitlement.tenant.source === 'persisted-default',
        },
        nextAction:
          '把 CRM、应用市场、增长任务从 userId 逐步迁到 tenantId + actorUserId 双维度',
      },
      {
        key: 'payment.cloud-billing',
        title: '支付与计费回调',
        status: paymentConfigured
          ? 'pass'
          : paymentSecretConfigured
            ? 'warn'
            : 'blocker',
        summary: paymentConfigured
          ? '已处理签名支付 webhook，并形成 active 订阅与租户授权快照'
          : paymentSecretConfigured
            ? '已发现支付/云授权配置，但还缺签名 webhook 落库和 active 订阅证据'
            : '未发现支付/云授权配置，不能宣称商用 SaaS 计费闭环',
        evidence: {
          ...billingEvidence,
          kaypalPlan: entitlement.plan,
          entitlementSource: entitlement.source,
        },
        nextAction: paymentConfigured
          ? '继续接真实支付失败/取消/续费场景和发票审计'
          : '接真实支付回调、订单表、订阅状态同步和失败降级策略',
      },
      {
        key: 'ops.backup',
        title: '备份与恢复',
        status: backupSnapshotReady
          ? backupMirrorReady
            ? 'pass'
            : 'warn'
          : backupDatabaseExists
            ? 'warn'
            : 'blocker',
        summary: backupSnapshotReady
          ? backupMirrorReady
            ? `${backupStatus.databaseKind} 数据库已有可恢复备份，并已镜像到对象存储兼容目录`
            : `${backupStatus.databaseKind} 数据库已有可恢复备份，但还没有对象存储/异地镜像`
          : backupDatabaseExists
            ? `检测到 ${backupStatus.databaseKind} 数据库，但还没有可恢复备份快照`
            : '当前运行库未检测到可备份数据库，需先接数据库备份策略',
        evidence: {
          databaseKind: backupStatus.databaseKind,
          databaseFile:
            databaseTarget.file ?? databaseTarget.redactedDatabaseUrl,
          databaseExists: backupDatabaseExists,
          latestBackup: backup,
          backupStatus,
        },
        nextAction:
          '上线前继续接定时备份、云对象存储凭据和定期隔离恢复演练告警',
      },
      {
        key: 'ops.backup-scheduler',
        title: '后台定时备份',
        status: backupSchedulerStatus.enabled
          ? backupSchedulerStatus.armed
            ? backupSchedulerStatus.lastRun?.status === 'created'
              ? 'pass'
              : 'warn'
            : 'warn'
          : 'warn',
        summary: backupSchedulerStatus.enabled
          ? backupSchedulerStatus.armed
            ? backupSchedulerStatus.lastRun
              ? `后台备份 daemon 已接通，最近一次结果为 ${backupSchedulerStatus.lastRun.status}`
              : '后台备份 daemon 已 armed，但还没有执行记录'
            : '后台备份 daemon 已配置但未 armed，不会无人值守执行'
          : '后台备份 daemon 未开启，当前仍主要依赖手动触发',
        evidence: backupSchedulerStatus as unknown as Record<string, unknown>,
        nextAction:
          '生产环境设置 COMMERCIAL_BACKUP_DAEMON=true、COMMERCIAL_BACKUP_DAEMON_ARMED=true，并接监控告警。',
      },
      {
        key: 'license.backup-export-gate',
        title: '本地备份导出授权',
        status: backupExportGate.allowed ? 'pass' : 'blocker',
        summary: backupExportGate.allowed
          ? '本地备份导出已接入 STANDARD+ entitlement gate'
          : '当前授权不能导出本地业务备份',
        evidence: backupExportGate,
        nextAction: '升级到 STANDARD+ 或启用受控本地商用授权后再导出备份',
      },
      {
        key: 'ops.monitoring',
        title: '监控与验收证据',
        status: acceptanceGateExists && systemLogCount >= 0 ? 'pass' : 'warn',
        summary: acceptanceGateExists
          ? '商用验收脚本和系统日志表可用'
          : '缺商用验收脚本入口',
        evidence: {
          systemLogCount,
          acceptanceGateExists,
        },
        nextAction: '把 readiness 结果写入发布前 Gate，并接运行日志告警',
      },
      {
        key: 'ops.release-rollback',
        title: '发布回滚演练',
        status: releaseRollbackStatus.ready
          ? 'pass'
          : releaseRollbackStatus.rollbackCandidate
            ? 'warn'
            : 'blocker',
        summary: releaseRollbackStatus.message,
        evidence: releaseRollbackStatus as unknown as Record<string, unknown>,
        nextAction: releaseRollbackStatus.ready
          ? '发布前继续跑回滚干跑，真实回滚仍必须人工执行安装包替换。'
          : '补齐 latest.yml、上一版安装包、blockmap 和备份恢复演练后再发布。',
      },
      {
        key: 'external-crm.integration',
        title: '外部 CRM 集成',
        status:
          crmConnectorGate.status === 'pass'
            ? 'pass'
            : externalCrmConfigured
              ? 'warn'
              : 'blocker',
        summary:
          crmConnectorGate.status === 'pass'
            ? 'Phase 1 已具备外部 CRM contract-only 证明；真实同步/OAuth 仍未开放'
            : externalCrmConfigured
              ? '发现外部 CRM 配置，但还需要受控导入/推广合同闭环'
              : '未发现 HubSpot/Salesforce 配置，外部 CRM 同步未上线',
        evidence: {
          configured: externalCrmConfigured,
          phase1ContractOnlyReady: crmConnectorGate.status === 'pass',
          supportedTargets: [
            'twenty',
            'hubspot',
            'salesforce',
            'feishu',
            'csv-excel',
          ],
          connectorEvidence: crmConnectorGate.evidence,
        },
        nextAction:
          '按 MIGO 11e/11f 接只读导入、staging review；正式写回另走 11G',
      },
      {
        key: 'windows.package-regression',
        title: 'Windows 安装包回归',
        status:
          windows.installerFound && windows.buildScriptFound
            ? 'warn'
            : 'blocker',
        summary: windows.installerFound
          ? '检测到 Windows 安装包产物，但仍需干净 Windows 机回归'
          : '没有检测到最新 Windows 安装包产物',
        evidence: windows,
        nextAction:
          '用 Windows 构建机打包，并跑安装、首启、微信/抖音核心链路回归',
      },
    ];

    const blockers = checks.filter((check) => check.status === 'blocker');
    const warnings = checks.filter((check) => check.status === 'warn');
    const cooperationNextActions = cooperationItems
      .filter((item) => item.status !== 'received')
      .map((item) => item.nextAction);
    const score = Math.round(
      checks.reduce((total, check) => {
        if (check.status === 'pass') return total + 100;
        if (check.status === 'warn') return total + 55;
        return total;
      }, 0) / checks.length,
    );

    return {
      generatedAt: new Date().toISOString(),
      overallStatus:
        blockers.length > 0
          ? 'blocked'
          : warnings.length > 0
            ? 'warning'
            : 'ready',
      score,
      checks,
      blockers,
      warnings,
      cooperationItems,
      nextActions: [
        ...cooperationNextActions,
        ...[...blockers, ...warnings]
          .map((check) => check.nextAction)
          .filter((action): action is string => Boolean(action)),
      ],
      evidence: {
        appInstallCount,
        crmAppInstalled: Boolean(crmApp?.installed),
        databaseMode: databaseTarget.kind,
        backupExport: backupExportGate,
        backupStatus,
        backupSchedulerStatus,
        releaseRollbackStatus,
        cooperation: {
          received: cooperationItems.filter(
            (item) => item.status === 'received',
          ).length,
          needed: cooperationItems.filter((item) => item.status === 'needed')
            .length,
          blocked: cooperationItems.filter((item) => item.status === 'blocked')
            .length,
        },
        effectiveEntitlement: {
          source: entitlement.source,
          plan: entitlement.plan,
          commercialExecutionAllowed: entitlement.commercialExecutionAllowed,
          cloudSubscriptionActive: entitlement.cloudSubscriptionActive,
          localCommercialAllowed: entitlement.localCommercialAllowed,
          planExpired: entitlement.planExpired,
          blockers: entitlement.blockers,
          tenantId: entitlement.tenant.tenantId,
        },
        billing: billingEvidence,
      },
    };
  }

  async createLocalBackup(
    user: AuthenticatedUser,
  ): Promise<CommercialBackupResult> {
    const generatedAt = new Date();
    const databaseTarget = this.resolveDatabaseTarget();
    if (databaseTarget.kind === 'postgres') {
      return this.createPostgresBackup(
        user,
        generatedAt,
        databaseTarget.databaseUrl,
      );
    }

    const sqliteDb = this.resolveSqliteDatabaseFile();
    if (!sqliteDb.file || !sqliteDb.exists) {
      return {
        generatedAt: generatedAt.toISOString(),
        status: 'unsupported',
        backupKind: 'unsupported',
        backupDir: null,
        databaseFile: sqliteDb.file,
        manifestFile: null,
        sizeBytes: 0,
        objectStoreMirror: this.disabledObjectStoreMirror(),
        message:
          '当前运行库不是可复制的本地 SQLite，云数据库备份需要接对象存储/快照策略。',
      };
    }

    const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
    const backupDir = this.resolveBackupRoot(stamp);
    mkdirSync(backupDir, { recursive: true });
    const backupFile = join(backupDir, basename(sqliteDb.file));
    let sqliteVerification: { tableCount: number; integrityCheck: string };
    try {
      sqliteVerification = await this.createConsistentSqliteBackup(
        sqliteDb.file,
        backupFile,
      );
    } catch (error) {
      return {
        generatedAt: generatedAt.toISOString(),
        status: 'unsupported',
        backupKind: 'sqlite',
        backupDir,
        databaseFile: backupFile,
        manifestFile: null,
        sizeBytes: 0,
        objectStoreMirror: this.disabledObjectStoreMirror(),
        message: `SQLite 在线备份失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const sizeBytes = statSync(backupFile).size;
    const sha256 = this.hashFile(backupFile);
    const manifestFile = join(backupDir, 'manifest.json');
    const manifest = {
      schemaVersion: 2,
      backupType: 'commercial-readiness-local-sqlite',
      generatedAt: generatedAt.toISOString(),
      generatedBy: {
        userId: user.id,
        email: user.email,
        kaypalUserId: user.kaypalUserId ?? null,
      },
      source: {
        databaseFile: sqliteDb.file,
        sizeBytes: statSync(sqliteDb.file).size,
      },
      restore: {
        dryRunSupported: true,
        destructiveRestoreSupported: false,
        note: '恢复演练校验 manifest、SHA-256 和 SQLite integrity_check；真实覆盖恢复必须离线人工执行。',
      },
      verification: {
        sha256,
        integrityCheck: sqliteVerification.integrityCheck,
        tableCount: sqliteVerification.tableCount,
      },
      files: [
        {
          path: backupFile,
          sizeBytes,
          sha256,
          kind: 'sqlite-database',
        },
      ],
      warning:
        '本地 SQLite 备份包含业务数据和可能的授权快照，请按商用密钥策略保存。',
    };
    writeFileSync(
      manifestFile,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    const objectStoreMirror = await this.mirrorBackupToObjectStore(
      backupDir,
      stamp,
    );
    const manifestWithMirror = { ...manifest, objectStoreMirror };
    writeFileSync(
      manifestFile,
      `${JSON.stringify(manifestWithMirror, null, 2)}\n`,
      'utf8',
    );
    await this.syncManifestToMirror(manifestFile, objectStoreMirror);

    return {
      generatedAt: generatedAt.toISOString(),
      status: 'created',
      backupKind: 'sqlite',
      backupDir,
      databaseFile: backupFile,
      manifestFile,
      sizeBytes,
      objectStoreMirror,
      message: '本地 SQLite 备份已创建。',
    };
  }

  private async createPostgresBackup(
    user: AuthenticatedUser,
    generatedAt: Date,
    databaseUrl: string,
  ): Promise<CommercialBackupResult> {
    const pgDumpCommand = this.resolvePgDumpCommand();
    if (!pgDumpCommand.available || !pgDumpCommand.command) {
      return {
        generatedAt: generatedAt.toISOString(),
        status: 'unsupported',
        backupKind: 'postgres',
        backupDir: null,
        databaseFile: this.redactDatabaseUrl(databaseUrl),
        manifestFile: null,
        sizeBytes: 0,
        objectStoreMirror: this.disabledObjectStoreMirror(),
        message:
          '当前运行库是 Postgres，但没有找到 pg_dump。请安装 PostgreSQL client 或配置 PG_DUMP_PATH。',
      };
    }

    const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
    const backupDir = this.resolveBackupRoot(stamp);
    mkdirSync(backupDir, { recursive: true });
    const dumpFile = join(backupDir, 'postgres-dump.sql');
    const dumpDatabaseUrl = this.toPgDumpCompatibleDatabaseUrl(databaseUrl);
    const result = spawnSync(
      pgDumpCommand.command,
      ['--format=plain', '--no-owner', '--no-privileges', dumpDatabaseUrl],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 100,
      },
    );

    if (result.error || result.status !== 0) {
      return {
        generatedAt: generatedAt.toISOString(),
        status: 'unsupported',
        backupKind: 'postgres',
        backupDir,
        databaseFile: this.redactDatabaseUrl(dumpDatabaseUrl),
        manifestFile: null,
        sizeBytes: 0,
        objectStoreMirror: this.disabledObjectStoreMirror(),
        message: `Postgres 备份失败：${result.error?.message || result.stderr || 'pg_dump exited non-zero'}`,
      };
    }

    writeFileSync(dumpFile, result.stdout || '', 'utf8');
    const sizeBytes = statSync(dumpFile).size;
    const manifestFile = join(backupDir, 'manifest.json');
    const manifest = {
      schemaVersion: 1,
      backupType: 'commercial-readiness-postgres-pgdump',
      generatedAt: generatedAt.toISOString(),
      generatedBy: {
        userId: user.id,
        email: user.email,
        kaypalUserId: user.kaypalUserId ?? null,
      },
      source: {
        databaseUrl: this.redactDatabaseUrl(dumpDatabaseUrl),
        sizeBytes,
      },
      command: {
        name: 'pg_dump',
        path: pgDumpCommand.command,
        args: [
          '--format=plain',
          '--no-owner',
          '--no-privileges',
          '<redacted-database-url>',
        ],
      },
      restore: {
        dryRunSupported: true,
        destructiveRestoreSupported: false,
        note: '恢复演练只校验 manifest 和 SQL dump 内容；真实恢复必须在隔离库中执行 psql restore。',
      },
      files: [
        {
          path: dumpFile,
          sizeBytes,
          kind: 'postgres-plain-sql',
        },
      ],
      warning: 'Postgres dump 包含业务数据和授权快照，请按商用密钥策略保存。',
    };
    writeFileSync(
      manifestFile,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    const objectStoreMirror = await this.mirrorBackupToObjectStore(
      backupDir,
      stamp,
    );
    const manifestWithMirror = { ...manifest, objectStoreMirror };
    writeFileSync(
      manifestFile,
      `${JSON.stringify(manifestWithMirror, null, 2)}\n`,
      'utf8',
    );
    await this.syncManifestToMirror(manifestFile, objectStoreMirror);

    return {
      generatedAt: generatedAt.toISOString(),
      status: 'created',
      backupKind: 'postgres',
      backupDir,
      databaseFile: dumpFile,
      manifestFile,
      sizeBytes,
      objectStoreMirror,
      message: 'Postgres SQL 备份已通过 pg_dump 创建。',
    };
  }

  getBackupStatus(): CommercialBackupStatus {
    return this.buildBackupStatus();
  }

  runBackupRestoreDryRun(): CommercialBackupRestoreDryRunResult {
    const generatedAt = new Date().toISOString();
    const snapshot = this.latestBackupSnapshot();
    const databaseTarget = this.resolveDatabaseTarget();

    if (databaseTarget.kind === 'unknown') {
      return {
        generatedAt,
        status: 'unsupported',
        backupKind: 'unknown',
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile: null,
        sizeBytes: 0,
        manifestValid: false,
        contentValid: false,
        sqliteHeaderValid: false,
        sourceDatabaseFile: null,
        message: '无法识别当前数据库类型，恢复演练需要明确 DATABASE_URL。',
      };
    }

    if (!snapshot.latestDir || !snapshot.latestManifest || !snapshot.exists) {
      return {
        generatedAt,
        status: 'failed',
        backupKind: databaseTarget.kind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile: null,
        sizeBytes: 0,
        manifestValid: false,
        contentValid: false,
        sqliteHeaderValid: false,
        sourceDatabaseFile:
          databaseTarget.file ?? databaseTarget.redactedDatabaseUrl,
        message: '没有找到可用于恢复演练的备份 manifest。',
      };
    }

    const manifest = this.readBackupManifest(snapshot.latestManifest);
    const manifestValid = this.isBackupManifestValid(
      manifest,
      snapshot.latestDir,
    );
    const databaseFile = this.databaseFileFromManifest(
      manifest,
      snapshot.latestDir,
    );
    const backupKind = this.backupKindFromManifest(manifest);
    if (backupKind !== databaseTarget.kind) {
      const sizeBytes =
        databaseFile && existsSync(databaseFile)
          ? statSync(databaseFile).size
          : 0;
      return {
        generatedAt,
        status: 'failed',
        backupKind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile,
        sizeBytes,
        manifestValid,
        contentValid: false,
        sqliteHeaderValid: false,
        sourceDatabaseFile:
          databaseTarget.file ?? databaseTarget.redactedDatabaseUrl,
        message: `恢复演练失败：备份类型 ${backupKind} 与当前数据库类型 ${databaseTarget.kind} 不一致。`,
      };
    }
    const sqliteHeaderValid =
      backupKind === 'sqlite' && databaseFile
        ? this.hasSqliteHeader(databaseFile)
        : false;
    const sqliteIntegrityValid =
      backupKind === 'sqlite' && databaseFile
        ? this.verifySqliteIntegrity(databaseFile).integrityCheck === 'ok'
        : false;
    const contentValid =
      backupKind === 'sqlite'
        ? sqliteHeaderValid && sqliteIntegrityValid
        : backupKind === 'postgres' && databaseFile
          ? this.hasPostgresDumpContent(databaseFile)
          : false;
    const sizeBytes =
      databaseFile && existsSync(databaseFile)
        ? statSync(databaseFile).size
        : 0;
    const passed = manifestValid && contentValid && sizeBytes > 0;

    return {
      generatedAt,
      status: passed ? 'pass' : 'failed',
      backupKind,
      backupDir: snapshot.latestDir,
      manifestFile: snapshot.latestManifest,
      databaseFile,
      sizeBytes,
      manifestValid,
      contentValid,
      sqliteHeaderValid,
      sourceDatabaseFile:
        databaseTarget.file ?? databaseTarget.redactedDatabaseUrl,
      message: passed
        ? '恢复演练通过：manifest 可读，备份内容格式有效。'
        : '恢复演练失败：manifest 或备份内容校验未通过。',
    };
  }

  runBackupIsolatedRestoreDryRun(): CommercialBackupIsolatedRestoreDryRunResult {
    const generatedAt = new Date().toISOString();
    const snapshot = this.latestBackupSnapshot();
    const databaseTarget = this.resolveDatabaseTarget();
    const restoreDatabaseUrl =
      process.env.COMMERCIAL_RESTORE_DATABASE_URL?.trim() || '';
    const psql = this.resolvePsqlCommand();

    if (!snapshot.latestDir || !snapshot.latestManifest || !snapshot.exists) {
      return {
        generatedAt,
        status: 'failed',
        backupKind: databaseTarget.kind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile: null,
        sizeBytes: 0,
        manifestValid: false,
        contentValid: false,
        isolatedRestoreExecuted: false,
        restoreDatabaseUrl: restoreDatabaseUrl
          ? this.redactDatabaseUrl(restoreDatabaseUrl)
          : null,
        psqlCommand: psql.command,
        message: '没有找到可用于隔离恢复演练的备份 manifest。',
      };
    }

    const manifest = this.readBackupManifest(snapshot.latestManifest);
    const manifestValid = this.isBackupManifestValid(
      manifest,
      snapshot.latestDir,
    );
    const databaseFile = this.databaseFileFromManifest(
      manifest,
      snapshot.latestDir,
    );
    const backupKind = this.backupKindFromManifest(manifest);
    const sizeBytes =
      databaseFile && existsSync(databaseFile)
        ? statSync(databaseFile).size
        : 0;
    const contentValid =
      backupKind === 'postgres' && databaseFile
        ? this.hasPostgresDumpContent(databaseFile)
        : false;

    if (backupKind !== 'postgres') {
      return {
        generatedAt,
        status: 'unsupported',
        backupKind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile,
        sizeBytes,
        manifestValid,
        contentValid,
        isolatedRestoreExecuted: false,
        restoreDatabaseUrl: restoreDatabaseUrl
          ? this.redactDatabaseUrl(restoreDatabaseUrl)
          : null,
        psqlCommand: psql.command,
        message: '当前只支持 Postgres SQL dump 的隔离恢复演练。',
      };
    }

    if (!manifestValid || !contentValid || !databaseFile) {
      return {
        generatedAt,
        status: 'failed',
        backupKind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile,
        sizeBytes,
        manifestValid,
        contentValid,
        isolatedRestoreExecuted: false,
        restoreDatabaseUrl: restoreDatabaseUrl
          ? this.redactDatabaseUrl(restoreDatabaseUrl)
          : null,
        psqlCommand: psql.command,
        message: '隔离恢复演练失败：manifest 或 SQL dump 内容校验未通过。',
      };
    }

    if (!restoreDatabaseUrl) {
      return {
        generatedAt,
        status: 'unsupported',
        backupKind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile,
        sizeBytes,
        manifestValid,
        contentValid,
        isolatedRestoreExecuted: false,
        restoreDatabaseUrl: null,
        psqlCommand: psql.command,
        message:
          '未配置 COMMERCIAL_RESTORE_DATABASE_URL，无法执行隔离库 restore。',
      };
    }

    if (
      databaseTarget.databaseUrl &&
      this.isSamePostgresDatabase(
        databaseTarget.databaseUrl,
        restoreDatabaseUrl,
      )
    ) {
      return {
        generatedAt,
        status: 'unsupported',
        backupKind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile,
        sizeBytes,
        manifestValid,
        contentValid,
        isolatedRestoreExecuted: false,
        restoreDatabaseUrl: this.redactDatabaseUrl(restoreDatabaseUrl),
        psqlCommand: psql.command,
        message: '隔离恢复库不能等于当前运行库，已拒绝执行。',
      };
    }

    if (!psql.available || !psql.command) {
      return {
        generatedAt,
        status: 'unsupported',
        backupKind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile,
        sizeBytes,
        manifestValid,
        contentValid,
        isolatedRestoreExecuted: false,
        restoreDatabaseUrl: this.redactDatabaseUrl(restoreDatabaseUrl),
        psqlCommand: psql.command,
        message:
          '没有找到 psql。请安装 PostgreSQL client 或配置 PSQL_RESTORE_PATH。',
      };
    }

    const restorePreparation = this.prepareRestoreDatabaseIfConfigured(
      restoreDatabaseUrl,
      psql.command,
    );
    if (restorePreparation.status === 'failed') {
      return {
        generatedAt,
        status: 'failed',
        backupKind,
        backupDir: snapshot.latestDir,
        manifestFile: snapshot.latestManifest,
        databaseFile,
        sizeBytes,
        manifestValid,
        contentValid,
        isolatedRestoreExecuted: false,
        restoreDatabasePrepared: false,
        restoreDatabaseUrl: this.redactDatabaseUrl(restoreDatabaseUrl),
        psqlCommand: psql.command,
        message: restorePreparation.message,
      };
    }

    const restoreUrl = this.toPgDumpCompatibleDatabaseUrl(restoreDatabaseUrl);
    const result = spawnSync(
      psql.command,
      [restoreUrl, '-v', 'ON_ERROR_STOP=1', '-f', databaseFile],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 100,
      },
    );
    const passed = !result.error && result.status === 0;

    return {
      generatedAt,
      status: passed ? 'pass' : 'failed',
      backupKind,
      backupDir: snapshot.latestDir,
      manifestFile: snapshot.latestManifest,
      databaseFile,
      sizeBytes,
      manifestValid,
      contentValid,
      isolatedRestoreExecuted: true,
      restoreDatabasePrepared: restorePreparation.prepared,
      restoreDatabaseUrl: this.redactDatabaseUrl(restoreUrl),
      psqlCommand: psql.command,
      message: passed
        ? restorePreparation.prepared
          ? '隔离恢复演练通过：隔离库已自动重建，SQL dump 已成功 restore。'
          : '隔离恢复演练通过：SQL dump 已成功 restore 到隔离库。'
        : `隔离恢复演练失败：${result.error?.message || result.stderr || 'psql exited non-zero'}`,
    };
  }

  getBackupSchedulerStatus(): CommercialBackupSchedulerStatus {
    const enabled = this.isBackupSchedulerEnabled();
    const armed = this.isBackupSchedulerArmed();
    return {
      generatedAt: new Date().toISOString(),
      enabled,
      armed,
      runOnStart: this.isBackupSchedulerRunOnStartEnabled(),
      intervalMs: this.backupSchedulerIntervalMs(),
      retentionKeepLatest: this.backupRetentionKeepLatest(),
      alertConfigured: this.isBackupAlertConfigured(),
      running: this.backupDaemonRunning,
      lastRun: this.latestScheduledBackupRun,
      nextAction: enabled
        ? armed
          ? this.latestScheduledBackupRun
            ? '后台备份 daemon 已接通，继续接云对象存储凭据和告警。'
            : '后台备份 daemon 已启动，等待下一次执行或手动 run-once 验证。'
          : '已配置后台备份 daemon，但缺少 COMMERCIAL_BACKUP_DAEMON_ARMED=true，不会无人值守执行。'
        : '未开启后台备份 daemon；设置 COMMERCIAL_BACKUP_DAEMON=true 并显式 armed 后才会自动执行。',
    };
  }

  async runBackupSchedulerOnce(
    user: AuthenticatedUser,
  ): Promise<CommercialBackupScheduledRunResult> {
    return this.runScheduledBackup('manual', user);
  }

  getReleaseRollbackStatus(): CommercialReleaseRollbackStatus {
    return this.buildReleaseRollbackStatus();
  }

  runReleaseRollbackDryRun(): CommercialReleaseRollbackDryRunResult {
    const generatedAt = new Date().toISOString();
    const status = this.buildReleaseRollbackStatus();
    const backupRestoreDryRun = this.runBackupRestoreDryRun();
    const steps: CommercialReleaseRollbackDryRunResult['steps'] = [
      {
        key: 'release.script',
        status: status.releaseScriptFound ? 'pass' : 'failed',
        message: status.releaseScriptFound
          ? '发布脚本存在。'
          : '没有找到 desktop/scripts/release.js。',
      },
      {
        key: 'release.verifier',
        status: status.verifierScriptFound ? 'pass' : 'failed',
        message: status.verifierScriptFound
          ? '发布校验脚本存在。'
          : '没有找到 desktop/scripts/verify-oss-release.js。',
      },
      {
        key: 'release.current-installer',
        status: status.currentInstaller ? 'pass' : 'failed',
        message: status.currentInstaller
          ? `当前版本 ${status.currentInstaller.version} 安装包存在。`
          : '没有找到当前版本安装包。',
        evidence: status.currentInstaller
          ? {
              installerPath: status.currentInstaller.installerPath,
              sizeBytes: status.currentInstaller.sizeBytes,
              blockmapPath: status.currentInstaller.blockmapPath,
            }
          : undefined,
      },
      {
        key: 'release.rollback-candidate',
        status:
          status.rollbackCandidate &&
          status.rollbackCandidate.blockers.length === 0
            ? 'pass'
            : 'failed',
        message: status.rollbackCandidate
          ? `可回滚到 ${status.rollbackCandidate.version}。`
          : '没有找到可回滚的上一版安装包。',
        evidence: status.rollbackCandidate
          ? {
              installerPath: status.rollbackCandidate.installerPath,
              sizeBytes: status.rollbackCandidate.sizeBytes,
              blockmapPath: status.rollbackCandidate.blockmapPath,
              blockers: status.rollbackCandidate.blockers,
            }
          : undefined,
      },
      {
        key: 'release.latest-metadata',
        status: status.latestMetadataFound ? 'pass' : 'failed',
        message: status.latestMetadataFound
          ? `latest.yml 可读，版本 ${status.latestFeedVersion ?? '-'}。`
          : '没有找到 Windows latest.yml，自动更新/回滚元数据不可验证。',
      },
      {
        key: 'data.restore-dry-run',
        status: backupRestoreDryRun.status === 'pass' ? 'pass' : 'failed',
        message: backupRestoreDryRun.message,
        evidence: {
          status: backupRestoreDryRun.status,
          backupKind: backupRestoreDryRun.backupKind,
          manifestFile: backupRestoreDryRun.manifestFile,
          sizeBytes: backupRestoreDryRun.sizeBytes,
        },
      },
      {
        key: 'safety.no-destructive-action',
        status: 'pass',
        message:
          '本次只做发布回滚干跑，不执行卸载、安装、覆盖数据库或远端写入。',
      },
    ];
    const failed = steps.filter((step) => step.status === 'failed');
    const proofHash = this.hashProof({
      kind: 'commercial-release-rollback-dry-run',
      generatedAt,
      statusProofHash: status.proofHash,
      backupRestoreDryRunStatus: backupRestoreDryRun.status,
      steps: steps.map(({ key, status: stepStatus, message }) => ({
        key,
        status: stepStatus,
        message,
      })),
    });

    return {
      generatedAt,
      status: failed.length === 0 ? 'pass' : 'failed',
      noDestructiveAction: true,
      currentVersion: status.currentVersion,
      rollbackTargetVersion: status.rollbackCandidate?.version ?? null,
      rollbackTargetInstaller: status.rollbackCandidate?.installerPath ?? null,
      backupRestoreDryRunStatus: backupRestoreDryRun.status,
      steps,
      proofHash,
      message:
        failed.length === 0
          ? '发布回滚干跑通过：安装包、latest 元数据、上一版候选和数据恢复演练均可验证。'
          : `发布回滚干跑未通过：${failed.map((step) => step.message).join('；')}`,
    };
  }

  private async runScheduledBackup(
    source: CommercialBackupScheduledRunResult['source'],
    user = this.systemBackupUser(),
  ): Promise<CommercialBackupScheduledRunResult> {
    const startedAt = new Date().toISOString();
    if (this.backupDaemonRunning) {
      const skipped: CommercialBackupScheduledRunResult = {
        source,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'failed',
        backupKind: 'unsupported',
        backupDir: null,
        manifestFile: null,
        sizeBytes: 0,
        mirrorValid: false,
        restoreDryRunStatus: null,
        isolatedRestoreStatus: null,
        retention: this.disabledBackupRetentionResult(),
        alert: this.disabledBackupAlertResult(),
        message: '已有备份任务正在执行，本次调度跳过。',
      };
      skipped.alert = await this.sendBackupAlertIfNeeded(skipped);
      this.latestScheduledBackupRun = skipped;
      return skipped;
    }

    this.backupDaemonRunning = true;
    try {
      const backup = await this.createLocalBackup(user);
      const restoreDryRun =
        backup.status === 'created' ? this.runBackupRestoreDryRun() : null;
      const isolatedRestore =
        backup.status === 'created' &&
        this.isBackupSchedulerIsolatedRestoreEnabled()
          ? this.runBackupIsolatedRestoreDryRun()
          : null;
      const retention =
        backup.status === 'created'
          ? this.applyBackupRetention()
          : this.disabledBackupRetentionResult();
      const run: CommercialBackupScheduledRunResult = {
        source,
        startedAt,
        completedAt: new Date().toISOString(),
        status:
          backup.status === 'created' && restoreDryRun?.status !== 'pass'
            ? 'failed'
            : backup.status,
        backupKind: backup.backupKind,
        backupDir: backup.backupDir,
        manifestFile: backup.manifestFile,
        sizeBytes: backup.sizeBytes,
        mirrorValid: Boolean(backup.objectStoreMirror?.valid),
        restoreDryRunStatus: restoreDryRun?.status ?? null,
        isolatedRestoreStatus: isolatedRestore?.status ?? null,
        retention,
        alert: this.disabledBackupAlertResult(),
        message:
          isolatedRestore && isolatedRestore.status !== 'pass'
            ? isolatedRestore.message
            : restoreDryRun && restoreDryRun.status !== 'pass'
              ? restoreDryRun.message
              : backup.message,
      };
      run.alert = await this.sendBackupAlertIfNeeded(run);
      this.latestScheduledBackupRun = run;
      return run;
    } catch (error) {
      const run: CommercialBackupScheduledRunResult = {
        source,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'failed',
        backupKind: 'unsupported',
        backupDir: null,
        manifestFile: null,
        sizeBytes: 0,
        mirrorValid: false,
        restoreDryRunStatus: null,
        isolatedRestoreStatus: null,
        retention: this.disabledBackupRetentionResult(),
        alert: this.disabledBackupAlertResult(),
        message: error instanceof Error ? error.message : String(error),
      };
      run.alert = await this.sendBackupAlertIfNeeded(run);
      this.latestScheduledBackupRun = run;
      return run;
    } finally {
      this.backupDaemonRunning = false;
    }
  }

  private startBackupSchedulerIfConfigured() {
    if (!this.isBackupSchedulerEnabled()) return;
    if (!this.isBackupSchedulerArmed()) {
      this.logger.warn(
        'Commercial backup daemon configured but not armed. Set COMMERCIAL_BACKUP_DAEMON_ARMED=true to allow unattended backups.',
      );
      return;
    }
    if (this.backupDaemon) return;

    const intervalMs = this.backupSchedulerIntervalMs();
    this.backupDaemon = setInterval(() => {
      void this.runScheduledBackup('interval');
    }, intervalMs);
    this.backupDaemon.unref?.();
    this.logger.log(`Commercial backup daemon started (tick=${intervalMs}ms)`);

    if (this.isBackupSchedulerRunOnStartEnabled()) {
      void this.runScheduledBackup('startup');
    }
  }

  private isBackupSchedulerEnabled() {
    return this.envFlag('COMMERCIAL_BACKUP_DAEMON');
  }

  private isBackupSchedulerArmed() {
    return this.envFlag('COMMERCIAL_BACKUP_DAEMON_ARMED');
  }

  private isBackupSchedulerRunOnStartEnabled() {
    return this.envFlag('COMMERCIAL_BACKUP_RUN_ON_START');
  }

  private isBackupSchedulerIsolatedRestoreEnabled() {
    return this.envFlag('COMMERCIAL_BACKUP_ISOLATED_RESTORE_ON_SCHEDULE');
  }

  private backupSchedulerIntervalMs() {
    const configured = Number(process.env.COMMERCIAL_BACKUP_INTERVAL_MS);
    if (Number.isFinite(configured) && configured >= 60_000) {
      return Math.floor(configured);
    }
    return 6 * 60 * 60 * 1000;
  }

  private envFlag(name: string) {
    return /^(1|true|yes|on)$/i.test(process.env[name]?.trim() ?? '');
  }

  private backupRetentionKeepLatest() {
    const configured = Number(process.env.COMMERCIAL_BACKUP_RETENTION_COUNT);
    if (Number.isFinite(configured) && configured >= 1) {
      return Math.floor(configured);
    }
    return null;
  }

  private applyBackupRetention(): CommercialBackupRetentionResult {
    const keepLatest = this.backupRetentionKeepLatest();
    if (!keepLatest) return this.disabledBackupRetentionResult();

    const prunedLocalDirs = this.pruneBackupRoot(
      this.resolveBackupRoot(),
      keepLatest,
    );
    const mirrorRoot = this.resolveObjectStoreMirrorRoot();
    const prunedMirrorDirs = mirrorRoot
      ? this.pruneBackupRoot(mirrorRoot, keepLatest)
      : [];

    return {
      enabled: true,
      keepLatest,
      prunedLocalDirs,
      prunedMirrorDirs,
      message:
        prunedLocalDirs.length + prunedMirrorDirs.length > 0
          ? `已按保留策略清理 ${prunedLocalDirs.length} 个本地备份目录、${prunedMirrorDirs.length} 个镜像目录。`
          : `保留策略已启用，当前备份数量未超过最近 ${keepLatest} 份。`,
    };
  }

  private disabledBackupRetentionResult(): CommercialBackupRetentionResult {
    return {
      enabled: false,
      keepLatest: null,
      prunedLocalDirs: [],
      prunedMirrorDirs: [],
      message:
        '未配置 COMMERCIAL_BACKUP_RETENTION_COUNT，后台备份不会自动删除历史备份。',
    };
  }

  private pruneBackupRoot(root: string, keepLatest: number) {
    if (!existsSync(root)) return [];
    const dirs = readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
    const pruned: string[] = [];
    for (const dir of dirs.slice(keepLatest)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        pruned.push(dir);
      } catch (error) {
        this.logger.warn(
          `Failed to prune backup directory ${dir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return pruned;
  }

  private isBackupAlertConfigured() {
    return Boolean(process.env.COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL?.trim());
  }

  private disabledBackupAlertResult(): CommercialBackupAlertResult {
    return {
      configured: this.isBackupAlertConfigured(),
      sent: false,
      provider: this.backupAlertProvider(),
      statusCode: null,
      message: this.isBackupAlertConfigured()
        ? '本次备份无需发送告警。'
        : '未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。',
    };
  }

  private async sendBackupAlertIfNeeded(
    run: CommercialBackupScheduledRunResult,
  ): Promise<CommercialBackupAlertResult> {
    const webhookUrl =
      process.env.COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL?.trim() || '';
    if (!webhookUrl) return this.disabledBackupAlertResult();

    const shouldAlert =
      this.envFlag('COMMERCIAL_BACKUP_ALERT_ON_SUCCESS') ||
      run.status !== 'created' ||
      run.restoreDryRunStatus !== 'pass' ||
      run.isolatedRestoreStatus === 'failed' ||
      !run.mirrorValid;
    if (!shouldAlert) {
      return {
        configured: true,
        sent: false,
        provider: this.backupAlertProvider(),
        statusCode: null,
        message: '本次备份通过，且未开启成功通知。',
      };
    }

    try {
      const parsed = new URL(webhookUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('webhook URL must use http or https');
      }
      const { alert: _alert, ...runWithoutAlert } = run;
      const provider = this.backupAlertProvider();
      const response = await axios.post(
        webhookUrl,
        this.buildBackupAlertPayload(provider, runWithoutAlert),
        { timeout: 5000 },
      );
      return {
        configured: true,
        sent: true,
        provider,
        statusCode: response.status,
        message: `备份告警已发送，HTTP ${response.status}。`,
      };
    } catch (error) {
      return {
        configured: true,
        sent: false,
        provider: this.backupAlertProvider(),
        statusCode: null,
        message: `备份告警发送失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private backupAlertProvider(): NonNullable<
    CommercialBackupAlertResult['provider']
  > {
    const provider = process.env.COMMERCIAL_BACKUP_ALERT_PROVIDER?.trim();
    if (provider === 'wecom' || provider === 'feishu' || provider === 'slack') {
      return provider;
    }
    return 'generic';
  }

  private buildBackupAlertPayload(
    provider: NonNullable<CommercialBackupAlertResult['provider']>,
    run: Omit<CommercialBackupScheduledRunResult, 'alert'>,
  ) {
    const severity = run.status === 'created' ? 'info' : 'critical';
    const generatedAt = new Date().toISOString();
    if (provider === 'wecom') {
      return {
        msgtype: 'markdown',
        markdown: {
          content: this.formatBackupAlertText(run),
        },
      };
    }
    if (provider === 'feishu') {
      return {
        msg_type: 'text',
        content: {
          text: this.formatBackupAlertText(run),
        },
      };
    }
    if (provider === 'slack') {
      return {
        text: this.formatBackupAlertText(run),
      };
    }
    return {
      type: 'commercial_backup_run',
      severity,
      generatedAt,
      run,
    };
  }

  private formatBackupAlertText(
    run: Omit<CommercialBackupScheduledRunResult, 'alert'>,
  ) {
    const severity = run.status === 'created' ? 'INFO' : 'CRITICAL';
    return [
      `Commercial backup ${severity}`,
      `source: ${run.source}`,
      `status: ${run.status}`,
      `backupKind: ${run.backupKind}`,
      `restoreDryRun: ${run.restoreDryRunStatus ?? '-'}`,
      `isolatedRestore: ${run.isolatedRestoreStatus ?? '-'}`,
      `mirrorValid: ${run.mirrorValid ? 'true' : 'false'}`,
      `manifest: ${run.manifestFile ?? '-'}`,
      `message: ${run.message}`,
    ].join('\n');
  }

  private systemBackupUser(): AuthenticatedUser {
    const now = new Date();
    return {
      id: 'system-commercial-backup',
      username: 'system-commercial-backup',
      email: 'system-commercial-backup@local',
      name: 'Commercial Backup Daemon',
      status: 'active',
      lastLoginAt: null,
      kaypalUserId: 'system-commercial-backup',
      kaypalPlan: 'ENTERPRISE',
      kaypalPlanExpired: false,
      kaypalRole: 'system',
      kaypalPlatformRole: 'system',
      kaypalPermissionNames: [],
      role: 'admin',
      commercialExecutionAllowed: true,
      planMode: 'commercial',
      createdAt: now,
      updatedAt: now,
    };
  }

  private async safeCount(action: () => Promise<number>) {
    try {
      return await action();
    } catch {
      return 0;
    }
  }

  private async safeValue<T>(
    action: () => Promise<T>,
    fallback: T | null = null,
  ) {
    try {
      return await action();
    } catch {
      return fallback;
    }
  }

  private buildCrmImportSafeDryRunGate(
    value: unknown,
  ): CommercialReadinessCheck {
    const data = this.asRecord(value);
    const writeTables = this.collectWriteTables(data);
    const proof = this.asRecord(data.proof);
    const safety = this.asRecord(data.safety);
    const requiredFutureGate = safeText(
      data.requiredFutureGate || safety.requiredFutureGate || '11G',
    );
    const hasProof = Boolean(proof.hash || proof.id || data.proofId);
    const noWrite = writeTables.length === 0;
    const futureGateOk = requiredFutureGate === '11G';
    const ok = Boolean(data) && hasProof && noWrite && futureGateOk;
    return {
      key: 'crm.import.safe-dry-run',
      title: 'CRM 受控导入安全干跑',
      status: ok ? 'pass' : 'blocker',
      summary: ok
        ? '导入 dry-run 返回 proof，且 writeTables=[]、requiredFutureGate=11G'
        : '导入 dry-run 没有形成可验证的 no-write/proof/11G 边界',
      evidence: {
        proofId: proof.id || data.proofId || null,
        proofHash: proof.hash || null,
        rowCount: data.rowCount ?? null,
        previewRows: Array.isArray(data.previewRows)
          ? data.previewRows.length
          : null,
        writeTables,
        requiredFutureGate,
        hasProof,
      },
    };
  }

  private buildCrmCloserReadOnlyGate(value: unknown): CommercialReadinessCheck {
    const data = this.asRecord(value);
    const advice = Array.isArray(data.advice)
      ? data.advice
      : Array.isArray(data.todayFollowUps)
        ? data.todayFollowUps
        : [];
    const summary = this.asRecord(data.summary);
    const safety = this.asRecord(data.safety);
    const text = JSON.stringify(data);
    const writeTables = this.collectWriteTables(data);
    const noWrite =
      writeTables.length === 0 &&
      (safety.autoWrite === false ||
        /不自动外发|read-only|只读|不写|no-write/i.test(text));
    const hasAdviceSurface =
      advice.length > 0 ||
      Boolean(
        summary.disclaimer ||
        data.disclaimer ||
        data.dailyReport ||
        data.dailySummary,
      );
    const ok = Boolean(data) && hasAdviceSurface && noWrite;
    return {
      key: 'crm.closer.read-only-advice',
      title: 'Closer 只读销售建议',
      status: ok ? 'pass' : 'warn',
      summary: ok
        ? 'Closer 建议基于本地 CRM 数据生成，当前证明为只读/no-write'
        : 'Closer 建议页面/API 可用性不足，或只读边界证据不完整',
      evidence: {
        adviceCount: advice.length,
        writeTables,
        noWrite,
        disclaimer:
          summary.disclaimer || data.disclaimer || safety.disclaimer || null,
        auditId: data.auditId || null,
      },
    };
  }

  private buildCrmConnectorContractOnlyGate(
    value: unknown,
  ): CommercialReadinessCheck {
    const data = this.asRecord(value);
    const connectors = Array.isArray(data.connectors) ? data.connectors : [];
    const writeTables = this.collectWriteTables(data);
    const text = JSON.stringify(data);
    const requiredFutureGate = safeText(
      data.requiredFutureGate ||
        this.asRecord(data.summaryStats).requiredFutureGate ||
        '11G',
    );
    const noWrite = writeTables.length === 0;
    const contractOnly =
      connectors.length >= 5 &&
      /contract-only|dry-run-only|no-token|noNetwork|不收 token|不联网/i.test(
        text,
      );
    const safetyOk =
      noWrite &&
      requiredFutureGate === '11G' &&
      /noWrite|no-write|不写/i.test(text) &&
      /noToken|no-token|不收 token/i.test(text) &&
      /noNetwork|no-network|不联网/i.test(text);
    const ok = Boolean(data) && contractOnly && safetyOk;
    return {
      key: 'crm.connectors.contract-only',
      title: 'Existing CRM Connector 合同边界',
      status: ok ? 'pass' : 'blocker',
      summary: ok
        ? '外部 CRM connector 处于 contract-only/dry-run-only，证明 no-token/no-network/no-write'
        : '外部 CRM connector 合同边界证据不完整',
      evidence: {
        connectorCount: connectors.length,
        writeTables,
        requiredFutureGate,
        noWrite,
        contractOnly,
        proofHash: this.asRecord(data.audit).proofHash || null,
      },
    };
  }

  private collectWriteTables(value: unknown) {
    const found: string[] = [];
    const visit = (candidate: unknown, key = '') => {
      if (key === 'writeTables' && Array.isArray(candidate)) {
        for (const item of candidate) {
          const table = typeof item === 'string' ? item.trim() : '';
          if (table) found.push(table);
        }
      }
      if (!candidate || typeof candidate !== 'object') return;
      if (Array.isArray(candidate)) {
        candidate.forEach((item, index) => visit(item, String(index)));
        return;
      }
      for (const [nextKey, nextValue] of Object.entries(candidate)) {
        visit(nextValue, nextKey);
      }
    };
    visit(value);
    return Array.from(new Set(found));
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private hasAnyEnv(names: string[]) {
    return names.some((name) => Boolean(process.env[name]?.trim()));
  }

  private hasAllEnv(names: string[]) {
    return names.every((name) => Boolean(process.env[name]?.trim()));
  }

  private buildCooperationItems(
    billingEvidence?: BillingReadinessEvidence,
  ): CommercialReadinessCooperationItem[] {
    const douyinLiveReady = this.evidenceFileFromEnv(
      'GROWTH_LIVE_READY_EVIDENCE',
    );
    const wechatContactSync = this.evidenceFileFromEnv(
      'WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE',
    );
    const accountQrBinding = this.evidenceFileFromEnv(
      'WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE',
    );
    const windowsGrowthSend = this.evidenceFileFromEnv(
      'WINDOWS_GATE_GROWTH_SEND_EVIDENCE',
    );
    const stripeSecretConfigured = Boolean(
      process.env.STRIPE_SECRET_KEY?.trim(),
    );
    const stripeWebhookConfigured = Boolean(
      process.env.STRIPE_WEBHOOK_SECRET?.trim(),
    );
    const stripeReady =
      billingEvidence?.configured === true ||
      this.hasAllEnv(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);

    return [
      {
        key: 'growth.douyin-login',
        title: '抖音账号重新登录与可执行状态',
        status: douyinLiveReady.exists ? 'received' : 'needed',
        owner: 'user',
        summary: douyinLiveReady.exists
          ? '已收到抖音账号可执行状态证据文件。'
          : '还缺抖音账号在线且可执行的证据，不能把本地安全模式当成真实商用可用。',
        nextAction:
          '请在当前机器重新登录抖音账号，刷新账号健康状态，并导出一份可执行证据；如走发布 Gate，设置 GROWTH_LIVE_READY_EVIDENCE=<证据文件>。',
        evidence: douyinLiveReady,
      },
      {
        key: 'windows.wechat-contact-sync',
        title: 'Windows 微信通讯录同步真机证据',
        status: wechatContactSync.exists ? 'received' : 'needed',
        owner: 'user',
        summary: wechatContactSync.exists
          ? '已收到 Windows 微信通讯录同步证据文件。'
          : '还缺 Windows 真机微信通讯录同步证据，不能只看错误提示是否消失。',
        nextAction:
          '请在 Windows 真机执行随机联系人同步和全量同步，导出诊断、截图和结果文件，并设置 WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE=<证据文件>。',
        evidence: wechatContactSync,
      },
      {
        key: 'windows.platform-qr-binding',
        title: 'Windows 平台扫码绑定真机证据',
        status: accountQrBinding.exists ? 'received' : 'needed',
        owner: 'user',
        summary: accountQrBinding.exists
          ? '已收到平台扫码绑定证据文件。'
          : '还缺 Windows 真机平台扫码绑定、重启后仍保持可用的证据。',
        nextAction:
          '请在 Windows 真机完成至少一个平台账号扫码绑定，重启应用后证明账号仍可用，并设置 WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE=<证据文件>。',
        evidence: accountQrBinding,
      },
      {
        key: 'windows.growth-send-readback',
        title: 'Windows 自动获客发送与回读证据',
        status: windowsGrowthSend.exists ? 'received' : 'needed',
        owner: 'user',
        summary: windowsGrowthSend.exists
          ? '已收到 Windows 自动获客发送与回读证据文件。'
          : '还缺 Windows 真机自动获客“发出去并回读到评论区”的证据。',
        nextAction:
          '请在 Windows 真机跑一轮受控自动获客，证明内容没有留在搜索框，包含 runId、contactedCount、截图和回读结果，并设置 WINDOWS_GATE_GROWTH_SEND_EVIDENCE=<证据文件>。',
        evidence: windowsGrowthSend,
      },
      {
        key: 'payment.stripe-webhook',
        title: '真实支付与 webhook 配置',
        status: stripeReady ? 'received' : 'needed',
        owner: 'user',
        summary: stripeReady
          ? '已检测到支付配置，或已经处理过签名计费 webhook。'
          : '还缺真实支付密钥和 webhook secret，当前只能算支付/授权 foundation。',
        nextAction:
          '请提供 Stripe/Kaypal 测试或生产环境的 webhook secret，并跑一条签名订阅事件完成授权落库。',
        evidence: {
          stripeSecretConfigured,
          stripeWebhookConfigured,
          billingWebhookSecretConfigured:
            billingEvidence?.webhookSecretConfigured ?? false,
          processedWebhookCount: billingEvidence?.processedWebhookCount ?? 0,
          activeSubscriptionCount:
            billingEvidence?.activeSubscriptionCount ?? 0,
          invoiceAuditCount: billingEvidence?.invoiceAuditCount ?? 0,
          failedInvoiceCount: billingEvidence?.failedInvoiceCount ?? 0,
        },
      },
    ];
  }

  private normalizeBillingReadinessEvidence(
    value: BillingReadinessEvidence | null,
  ): BillingReadinessEvidence {
    return (
      value ?? {
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
      }
    );
  }

  private evidenceFileFromEnv(envName: string) {
    const value = process.env[envName]?.trim() ?? '';
    const file = value
      ? isAbsolute(value)
        ? value
        : resolve(resolveProjectRoot(), value)
      : null;
    return {
      envName,
      configured: Boolean(value),
      file,
      exists: Boolean(file && existsSync(file)),
    };
  }

  private buildBackupExportGate(entitlement: EffectiveEntitlement) {
    const planAllowed = COMMERCIAL_BACKUP_REQUIRED_PLANS.some((plan) =>
      isKaypalPlanAtLeast(entitlement.plan, plan),
    );
    const blockers = [
      ...entitlement.blockers,
      ...(!planAllowed ? ['insufficient-plan-for-backup-export'] : []),
    ];
    return {
      allowed:
        entitlement.commercialExecutionAllowed &&
        !entitlement.planExpired &&
        planAllowed,
      requiredPlans: [...COMMERCIAL_BACKUP_REQUIRED_PLANS],
      plan: entitlement.plan,
      entitlementSource: entitlement.source,
      commercialExecutionAllowed: entitlement.commercialExecutionAllowed,
      cloudSubscriptionActive: entitlement.cloudSubscriptionActive,
      localCommercialAllowed: entitlement.localCommercialAllowed,
      planExpired: entitlement.planExpired,
      blockers,
    };
  }

  private resolveSqliteDatabaseFile() {
    const databaseUrl = this.resolveBackupDatabaseUrl();
    const file = this.sqliteFileFromUrl(databaseUrl);
    return {
      file,
      exists: Boolean(file && existsSync(file)),
    };
  }

  private resolveDatabaseTarget() {
    const databaseUrl = this.resolveBackupDatabaseUrl();
    const sqliteFile = this.sqliteFileFromUrl(databaseUrl);
    if (sqliteFile) {
      return {
        kind: 'sqlite' as const,
        file: sqliteFile,
        exists: existsSync(sqliteFile),
        databaseUrl,
        redactedDatabaseUrl: null,
      };
    }
    if (
      databaseUrl.startsWith('postgres://') ||
      databaseUrl.startsWith('postgresql://')
    ) {
      return {
        kind: 'postgres' as const,
        file: null,
        exists: true,
        databaseUrl,
        redactedDatabaseUrl: this.redactDatabaseUrl(databaseUrl),
      };
    }
    return {
      kind: 'unknown' as const,
      file: null,
      exists: false,
      databaseUrl,
      redactedDatabaseUrl: null,
    };
  }

  private resolveBackupDatabaseUrl() {
    const databaseUrl =
      process.env.COMMERCIAL_BACKUP_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.SQLITE_DATABASE_URL ||
      '';
    return databaseUrl.trim();
  }

  private resolvePgDumpCommand() {
    const configured = process.env.PG_DUMP_PATH?.trim();
    const candidates = configured ? [configured] : ['pg_dump'];
    for (const command of candidates) {
      const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
      if (!result.error && result.status === 0) {
        return { available: true, command };
      }
    }
    return { available: false, command: configured || 'pg_dump' };
  }

  private resolvePsqlCommand() {
    const configured = process.env.PSQL_RESTORE_PATH?.trim();
    const candidates = configured ? [configured] : ['psql'];
    for (const command of candidates) {
      const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
      if (!result.error && result.status === 0) {
        return { available: true, command };
      }
    }
    return { available: false, command: configured || 'psql' };
  }

  private redactDatabaseUrl(databaseUrl: string) {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.password) parsed.password = '***';
      if (parsed.username) parsed.username = parsed.username ? '***' : '';
      return parsed.toString();
    } catch {
      return databaseUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://***:***@');
    }
  }

  private toPgDumpCompatibleDatabaseUrl(databaseUrl: string) {
    try {
      const parsed = new URL(databaseUrl);
      for (const key of [
        'pool_timeout',
        'connection_limit',
        'socket_timeout',
        'pgbouncer',
      ]) {
        parsed.searchParams.delete(key);
      }
      return parsed.toString();
    } catch {
      return databaseUrl
        .replace(/([?&])pool_timeout=[^&]*&?/g, '$1')
        .replace(/([?&])connection_limit=[^&]*&?/g, '$1')
        .replace(/[?&]$/, '');
    }
  }

  private isSamePostgresDatabase(leftUrl: string, rightUrl: string) {
    try {
      const left = new URL(this.toPgDumpCompatibleDatabaseUrl(leftUrl));
      const right = new URL(this.toPgDumpCompatibleDatabaseUrl(rightUrl));
      return (
        left.protocol === right.protocol &&
        left.hostname === right.hostname &&
        (left.port || '5432') === (right.port || '5432') &&
        left.pathname.replace(/\/+$/, '') === right.pathname.replace(/\/+$/, '')
      );
    } catch {
      return leftUrl === rightUrl;
    }
  }

  private prepareRestoreDatabaseIfConfigured(
    restoreDatabaseUrl: string,
    psqlCommand: string,
  ):
    | { status: 'skipped'; prepared: false; message: string }
    | { status: 'pass'; prepared: true; message: string }
    | { status: 'failed'; prepared: false; message: string } {
    if (!this.envFlag('COMMERCIAL_BACKUP_AUTO_PREPARE_RESTORE_DATABASE')) {
      return {
        status: 'skipped',
        prepared: false,
        message:
          '未启用 COMMERCIAL_BACKUP_AUTO_PREPARE_RESTORE_DATABASE，跳过恢复库自动清理。',
      };
    }

    const restoreInfo =
      this.resolveRestoreDatabaseAdminTarget(restoreDatabaseUrl);
    if (!restoreInfo.ok) {
      return {
        status: 'failed',
        prepared: false,
        message: restoreInfo.message,
      };
    }

    const commands = [
      `DROP DATABASE IF EXISTS ${this.quotePgIdentifier(restoreInfo.databaseName)} WITH (FORCE);`,
      `CREATE DATABASE ${this.quotePgIdentifier(restoreInfo.databaseName)};`,
    ];
    for (const sql of commands) {
      const result = spawnSync(
        psqlCommand,
        [restoreInfo.adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql],
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 20,
        },
      );
      if (result.error || result.status !== 0) {
        return {
          status: 'failed',
          prepared: false,
          message: `隔离恢复库自动准备失败：${
            result.error?.message || result.stderr || 'psql exited non-zero'
          }`,
        };
      }
    }

    return {
      status: 'pass',
      prepared: true,
      message: `隔离恢复库 ${restoreInfo.databaseName} 已自动重建。`,
    };
  }

  private resolveRestoreDatabaseAdminTarget(
    restoreDatabaseUrl: string,
  ):
    | { ok: true; adminUrl: string; databaseName: string }
    | { ok: false; message: string } {
    try {
      const restore = new URL(
        this.toPgDumpCompatibleDatabaseUrl(restoreDatabaseUrl),
      );
      const databaseName = decodeURIComponent(
        restore.pathname.replace(/^\/+/, ''),
      );
      if (!databaseName) {
        return { ok: false, message: '恢复库 URL 缺少 database name。' };
      }
      if (['postgres', 'template0', 'template1'].includes(databaseName)) {
        return {
          ok: false,
          message: `拒绝自动重建系统数据库 ${databaseName}。`,
        };
      }
      const configuredAdminUrl =
        process.env.COMMERCIAL_RESTORE_ADMIN_DATABASE_URL?.trim();
      if (configuredAdminUrl) {
        return {
          ok: true,
          adminUrl: this.toPgDumpCompatibleDatabaseUrl(configuredAdminUrl),
          databaseName,
        };
      }
      restore.pathname = '/postgres';
      restore.search = '';
      return {
        ok: true,
        adminUrl: restore.toString(),
        databaseName,
      };
    } catch (error) {
      return {
        ok: false,
        message: `无法解析恢复库 URL：${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private quotePgIdentifier(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private sqliteFileFromUrl(databaseUrl: string) {
    if (!databaseUrl.startsWith('file:')) return null;
    const raw = databaseUrl.slice('file:'.length);
    if (raw.startsWith('./') || raw.startsWith('../')) {
      return resolve(process.cwd(), raw);
    }
    try {
      return fileURLToPath(databaseUrl);
    } catch {
      return raw ? resolve(raw) : null;
    }
  }

  private latestBackupSnapshot() {
    const root = this.resolveBackupRoot();
    if (!existsSync(root)) {
      return {
        exists: false,
        root,
        latestDir: null,
        latestManifest: null,
        latestAt: null,
        latestSizeBytes: 0,
        manifestValid: false,
      };
    }
    const dirs = readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
    const latestDir = dirs[0] ?? null;
    const latestManifest = latestDir ? join(latestDir, 'manifest.json') : null;
    const manifest = latestManifest
      ? this.readBackupManifest(latestManifest)
      : null;
    const databaseFile = latestDir
      ? this.databaseFileFromManifest(manifest, latestDir)
      : null;
    const latestSizeBytes =
      databaseFile && existsSync(databaseFile)
        ? statSync(databaseFile).size
        : 0;
    const manifestValid =
      Boolean(latestManifest && existsSync(latestManifest)) &&
      this.isBackupManifestValid(manifest, latestDir);
    return {
      exists: Boolean(latestManifest && existsSync(latestManifest)),
      root,
      latestDir,
      latestManifest,
      latestAt: latestDir ? basename(latestDir) : null,
      latestSizeBytes,
      manifestValid,
    };
  }

  private resolveBackupRoot(...segments: string[]) {
    const configured = process.env.COMMERCIAL_BACKUP_ROOT?.trim();
    const root = configured
      ? isAbsolute(configured)
        ? configured
        : resolve(resolveProjectRoot(), configured)
      : resolveProjectDataPath('backups', 'commercial-readiness');
    return join(root, ...segments);
  }

  private resolveObjectStoreMirrorRoot(...segments: string[]) {
    const configured = process.env.COMMERCIAL_BACKUP_OBJECT_STORE_DIR?.trim();
    if (!configured) return null;
    const root = isAbsolute(configured)
      ? configured
      : resolve(resolveProjectRoot(), configured);
    return join(root, ...segments);
  }

  private disabledObjectStoreMirror(): CommercialBackupObjectStoreMirror {
    return {
      enabled: false,
      provider: 'unsupported',
      root: null,
      mirrorDir: null,
      manifestFile: null,
      bucket: null,
      prefix: null,
      uploadedKeys: [],
      fileCount: 0,
      sizeBytes: 0,
      valid: false,
      message:
        '未配置 COMMERCIAL_BACKUP_OBJECT_STORE_DIR 或 COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER，备份仅保存在本机目录。',
    };
  }

  private async mirrorBackupToObjectStore(
    backupDir: string,
    stamp: string,
  ): Promise<CommercialBackupObjectStoreMirror> {
    const provider = this.backupObjectStoreProvider();
    if (provider === 'aliyun-oss') {
      return this.mirrorBackupToAliyunOss(backupDir, stamp);
    }
    if (provider === 'unsupported') {
      return {
        ...this.disabledObjectStoreMirror(),
        enabled: true,
        message: `不支持的对象存储 provider：${process.env.COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER?.trim()}`,
      };
    }
    return this.mirrorBackupToLocalObjectStoreDir(backupDir, stamp);
  }

  private backupObjectStoreProvider():
    | 'local-dir'
    | 'aliyun-oss'
    | 'unsupported'
    | null {
    const configured =
      process.env.COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER?.trim();
    if (configured) {
      if (configured === 'local-dir' || configured === 'local') {
        return 'local-dir';
      }
      if (configured === 'aliyun-oss' || configured === 'oss') {
        return 'aliyun-oss';
      }
      return 'unsupported';
    }
    if (process.env.COMMERCIAL_BACKUP_OBJECT_STORE_DIR?.trim()) {
      return 'local-dir';
    }
    if (
      [
        'COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID',
        'COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET',
        'COMMERCIAL_BACKUP_OSS_BUCKET',
        'COMMERCIAL_BACKUP_OSS_ENDPOINT',
        'ALIYUN_OSS_ACCESS_KEY_ID',
        'ALIYUN_OSS_ACCESS_KEY_SECRET',
        'ALIYUN_OSS_BUCKET',
        'ALIYUN_OSS_ENDPOINT',
      ].some((name) => process.env[name]?.trim())
    ) {
      return 'aliyun-oss';
    }
    return null;
  }

  private mirrorBackupToLocalObjectStoreDir(
    backupDir: string,
    stamp: string,
  ): CommercialBackupObjectStoreMirror {
    const mirrorDir = this.resolveObjectStoreMirrorRoot(stamp);
    const root = this.resolveObjectStoreMirrorRoot();
    if (!mirrorDir || !root) return this.disabledObjectStoreMirror();

    try {
      mkdirSync(mirrorDir, { recursive: true });
      const files = this.backupFilesInDir(backupDir);
      for (const file of files) {
        cpSync(file, join(mirrorDir, basename(file)));
      }
      const mirroredFiles = readdirSync(mirrorDir)
        .map((name) => join(mirrorDir, name))
        .filter((path) => {
          try {
            return statSync(path).isFile();
          } catch {
            return false;
          }
        });
      const sizeBytes = mirroredFiles.reduce((total, file) => {
        try {
          return total + statSync(file).size;
        } catch {
          return total;
        }
      }, 0);
      const manifestFile = join(mirrorDir, 'manifest.json');
      return {
        enabled: true,
        provider: 'local-dir',
        root,
        mirrorDir,
        manifestFile,
        bucket: null,
        prefix: null,
        uploadedKeys: [],
        fileCount: mirroredFiles.length,
        sizeBytes,
        valid: existsSync(manifestFile) && mirroredFiles.length > 1,
        message: '备份已镜像到对象存储兼容目录。',
      };
    } catch (error) {
      return {
        enabled: true,
        provider: 'local-dir',
        root,
        mirrorDir,
        manifestFile: join(mirrorDir, 'manifest.json'),
        bucket: null,
        prefix: null,
        uploadedKeys: [],
        fileCount: 0,
        sizeBytes: 0,
        valid: false,
        message: `对象存储镜像失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async mirrorBackupToAliyunOss(
    backupDir: string,
    stamp: string,
  ): Promise<CommercialBackupObjectStoreMirror> {
    const config = this.backupAliyunOssConfig();
    const missing = [
      ['COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID', config.accessKeyId],
      ['COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET', config.accessKeySecret],
      ['COMMERCIAL_BACKUP_OSS_BUCKET', config.bucket],
      [
        'COMMERCIAL_BACKUP_OSS_ENDPOINT 或 COMMERCIAL_BACKUP_OSS_REGION',
        config.endpoint || config.region,
      ],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    const manifestKey = this.joinOssKey(config.prefix, stamp, 'manifest.json');
    const root = config.bucket ? `oss://${config.bucket}` : null;
    if (missing.length > 0) {
      return {
        enabled: true,
        provider: 'aliyun-oss',
        root,
        mirrorDir: null,
        manifestFile: config.bucket
          ? `oss://${config.bucket}/${manifestKey}`
          : null,
        bucket: config.bucket || null,
        prefix: config.prefix,
        uploadedKeys: [],
        fileCount: 0,
        sizeBytes: 0,
        valid: false,
        message: `阿里云 OSS 备份配置不完整，缺少：${missing.join('、')}。`,
      };
    }

    try {
      const client = this.createBackupAliyunOssClient(config);
      const files = this.backupFilesInDir(backupDir);
      const uploadedKeys: string[] = [];
      let sizeBytes = 0;
      for (const file of files) {
        const key = this.joinOssKey(config.prefix, stamp, basename(file));
        await client.put(key, file);
        uploadedKeys.push(key);
        sizeBytes += statSync(file).size;
      }
      return {
        enabled: true,
        provider: 'aliyun-oss',
        root,
        mirrorDir: null,
        manifestFile: `oss://${config.bucket}/${manifestKey}`,
        bucket: config.bucket,
        prefix: config.prefix,
        uploadedKeys,
        fileCount: uploadedKeys.length,
        sizeBytes,
        valid:
          uploadedKeys.some((key) => key.endsWith('/manifest.json')) &&
          uploadedKeys.length > 1,
        message: '备份已上传到阿里云 OSS。',
      };
    } catch (error) {
      return {
        enabled: true,
        provider: 'aliyun-oss',
        root,
        mirrorDir: null,
        manifestFile: `oss://${config.bucket}/${manifestKey}`,
        bucket: config.bucket,
        prefix: config.prefix,
        uploadedKeys: [],
        fileCount: 0,
        sizeBytes: 0,
        valid: false,
        message: `阿里云 OSS 备份上传失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async syncManifestToMirror(
    manifestFile: string,
    mirror: CommercialBackupObjectStoreMirror,
  ) {
    if (!mirror.enabled || !mirror.manifestFile) return;
    try {
      if (mirror.provider === 'aliyun-oss') {
        if (!mirror.valid) return;
        const config = this.backupAliyunOssConfig();
        if (!config.bucket || !mirror.manifestFile.startsWith('oss://')) return;
        const key = mirror.manifestFile.replace(`oss://${config.bucket}/`, '');
        const client = this.createBackupAliyunOssClient(config);
        await client.put(key, manifestFile);
        return;
      }
      if (!mirror.mirrorDir) return;
      copyFileSync(manifestFile, mirror.manifestFile);
    } catch {
      // Mirror status already captures the copy attempt; keep backup creation non-destructive.
    }
  }

  private backupFilesInDir(dir: string) {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      });
  }

  private backupAliyunOssConfig() {
    const prefix =
      process.env.COMMERCIAL_BACKUP_OSS_PREFIX?.trim() ||
      process.env.ALIYUN_OSS_BACKUP_PREFIX?.trim() ||
      'commercial-readiness-backups';
    return {
      accessKeyId:
        process.env.COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID?.trim() ||
        process.env.ALIYUN_OSS_ACCESS_KEY_ID?.trim() ||
        '',
      accessKeySecret:
        process.env.COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET?.trim() ||
        process.env.ALIYUN_OSS_ACCESS_KEY_SECRET?.trim() ||
        '',
      bucket:
        process.env.COMMERCIAL_BACKUP_OSS_BUCKET?.trim() ||
        process.env.ALIYUN_OSS_BUCKET?.trim() ||
        '',
      endpoint:
        process.env.COMMERCIAL_BACKUP_OSS_ENDPOINT?.trim() ||
        process.env.ALIYUN_OSS_ENDPOINT?.trim() ||
        '',
      region:
        process.env.COMMERCIAL_BACKUP_OSS_REGION?.trim() ||
        process.env.ALIYUN_OSS_REGION?.trim() ||
        '',
      prefix: prefix.replace(/^\/+|\/+$/g, ''),
    };
  }

  private createBackupAliyunOssClient(config: {
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    endpoint: string;
    region: string;
  }) {
    return new OSS({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucket,
      endpoint: config.endpoint || undefined,
      region: config.region || undefined,
      secure: true,
      timeout: 600000,
    });
  }

  private joinOssKey(...segments: string[]) {
    return segments
      .filter((segment) => segment.length > 0)
      .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
      .filter((segment) => segment.length > 0)
      .join('/');
  }

  private buildBackupStatus(): CommercialBackupStatus {
    const generatedAt = new Date().toISOString();
    const databaseTarget = this.resolveDatabaseTarget();
    const pgDump =
      databaseTarget.kind === 'postgres'
        ? this.resolvePgDumpCommand()
        : { available: false, command: null };
    const snapshot = this.latestBackupSnapshot();
    const manifest = snapshot.latestManifest
      ? this.readBackupManifest(snapshot.latestManifest)
      : null;
    const objectStoreMirror = this.objectStoreMirrorFromManifest(manifest);
    const supported =
      (databaseTarget.kind === 'sqlite' && databaseTarget.exists) ||
      (databaseTarget.kind === 'postgres' && pgDump.available);
    const restoreDryRunReady =
      supported && snapshot.exists && snapshot.manifestValid;

    return {
      generatedAt,
      supported,
      databaseKind: databaseTarget.kind,
      databaseFile: databaseTarget.file ?? databaseTarget.redactedDatabaseUrl,
      databaseExists: databaseTarget.exists,
      pgDumpAvailable: pgDump.available,
      pgDumpCommand: pgDump.command,
      backupRoot: snapshot.root,
      latestBackupDir: snapshot.latestDir,
      latestManifestFile: snapshot.latestManifest,
      latestBackupAt: snapshot.latestAt,
      latestSizeBytes: snapshot.latestSizeBytes,
      manifestValid: snapshot.manifestValid,
      restoreDryRunReady,
      objectStoreMirror,
      message:
        databaseTarget.kind === 'postgres' && !pgDump.available
          ? '当前运行库是 Postgres，但没有找到 pg_dump；请安装 PostgreSQL client 或配置 PG_DUMP_PATH。'
          : !supported
            ? '当前数据库类型暂不支持本地备份导出，需接云数据库备份策略。'
            : restoreDryRunReady
              ? '已找到可演练恢复的本地备份。'
              : '还没有可演练恢复的本地备份。',
    };
  }

  private readBackupManifest(manifestFile: string | null) {
    if (!manifestFile || !existsSync(manifestFile)) return null;
    try {
      return JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }

  private objectStoreMirrorFromManifest(
    manifest: Record<string, unknown> | null,
  ): CommercialBackupObjectStoreMirror {
    const value = this.asRecord(manifest?.objectStoreMirror);
    if (!value.enabled) return this.disabledObjectStoreMirror();
    const provider =
      value.provider === 'aliyun-oss' || value.provider === 'local-dir'
        ? value.provider
        : 'local-dir';
    const mirrorDir =
      typeof value.mirrorDir === 'string' ? value.mirrorDir : null;
    const manifestFile =
      typeof value.manifestFile === 'string' ? value.manifestFile : null;
    const uploadedKeys = Array.isArray(value.uploadedKeys)
      ? value.uploadedKeys.filter(
          (key): key is string => typeof key === 'string',
        )
      : [];
    const bucket = typeof value.bucket === 'string' ? value.bucket : null;
    const prefix = typeof value.prefix === 'string' ? value.prefix : null;
    const valid =
      provider === 'aliyun-oss'
        ? Boolean(
            value.valid && bucket && manifestFile && uploadedKeys.length > 1,
          )
        : Boolean(
            value.valid &&
            mirrorDir &&
            manifestFile &&
            existsSync(mirrorDir) &&
            existsSync(manifestFile),
          );
    return {
      enabled: true,
      provider,
      root: typeof value.root === 'string' ? value.root : null,
      mirrorDir,
      manifestFile,
      bucket,
      prefix,
      uploadedKeys,
      fileCount: typeof value.fileCount === 'number' ? value.fileCount : 0,
      sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : 0,
      valid,
      message:
        typeof value.message === 'string'
          ? value.message
          : '对象存储镜像状态未知。',
    };
  }

  private isBackupManifestValid(
    manifest: Record<string, unknown> | null,
    backupDir: string | null,
  ) {
    if (!manifest || !backupDir) return false;
    const backupKind = this.backupKindFromManifest(manifest);
    if (backupKind === 'unknown') return false;
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const databaseFile = this.databaseFileFromManifest(manifest, backupDir);
    if (files.length === 0 || !databaseFile || !existsSync(databaseFile)) {
      return false;
    }
    const databaseEntry = files
      .map((item) => this.asRecord(item))
      .find(
        (item) =>
          item.kind === 'sqlite-database' || item.kind === 'postgres-plain-sql',
      );
    const expectedHash =
      typeof databaseEntry?.sha256 === 'string'
        ? databaseEntry.sha256.trim().toLowerCase()
        : '';
    return !expectedHash || this.hashFile(databaseFile) === expectedHash;
  }

  private backupKindFromManifest(manifest: Record<string, unknown> | null) {
    if (manifest?.backupType === 'commercial-readiness-local-sqlite') {
      return 'sqlite' as const;
    }
    if (manifest?.backupType === 'commercial-readiness-postgres-pgdump') {
      return 'postgres' as const;
    }
    return 'unknown' as const;
  }

  private databaseFileFromManifest(
    manifest: Record<string, unknown> | null,
    backupDir: string,
  ) {
    if (!manifest) return null;
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const file = files
      .map((item) => this.asRecord(item))
      .find(
        (item) =>
          item.kind === 'sqlite-database' || item.kind === 'postgres-plain-sql',
      );
    const rawPath = typeof file?.path === 'string' ? file.path : null;
    if (!rawPath) return null;
    const resolvedPath = isAbsolute(rawPath)
      ? rawPath
      : resolve(backupDir, rawPath);
    const relativePath = relative(resolve(backupDir), resolvedPath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
    return resolvedPath;
  }

  private hasSqliteHeader(databaseFile: string) {
    if (!existsSync(databaseFile)) return false;
    try {
      const header = readFileSync(databaseFile)
        .subarray(0, 16)
        .toString('binary');
      return header === 'SQLite format 3\u0000';
    } catch {
      return false;
    }
  }

  private async createConsistentSqliteBackup(
    sourceFile: string,
    backupFile: string,
  ) {
    if (backupFile.includes('\u0000')) {
      throw new Error('backup path contains a null byte');
    }
    const escapedBackupFile = backupFile.replaceAll("'", "''");
    await this.prisma.$executeRawUnsafe(`VACUUM INTO '${escapedBackupFile}'`);
    const verification = this.verifySqliteIntegrity(backupFile);
    if (
      !this.hasSqliteHeader(backupFile) ||
      verification.integrityCheck.startsWith('error:')
    ) {
      throw new Error(
        `integrity_check=${verification.integrityCheck || 'unknown'}`,
      );
    }
    return verification;
  }

  private verifySqliteIntegrity(databaseFile: string) {
    if (!existsSync(databaseFile)) {
      return { integrityCheck: 'missing', tableCount: 0 };
    }
    const sqliteCommand = this.resolveSqliteCommand();
    if (!sqliteCommand) {
      return {
        integrityCheck: this.hasSqliteHeader(databaseFile)
          ? 'header-only'
          : 'error: invalid SQLite header',
        tableCount: 0,
      };
    }
    const result = spawnSync(
      sqliteCommand,
      [
        databaseFile,
        "PRAGMA integrity_check; SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';",
      ],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
      },
    );
    if (result.error || result.status !== 0) {
      return {
        integrityCheck: `error: ${result.error?.message || result.stderr || 'sqlite3 exited non-zero'}`,
        tableCount: 0,
      };
    }
    const lines = `${result.stdout || ''}`
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      integrityCheck: lines[0] || 'error: empty sqlite3 output',
      tableCount: Number(lines.at(-1) || 0),
    };
  }

  private resolveSqliteCommand() {
    const configured =
      process.env.SQLITE3_PATH?.trim() ||
      process.env.AI_CONTENT_SQLITE_EXE?.trim();
    const candidates = configured ? [configured] : ['sqlite3'];
    for (const command of candidates) {
      const result = spawnSync(command, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      if (!result.error && result.status === 0) return command;
    }
    return null;
  }

  private hashFile(file: string) {
    const hash = createHash('sha256');
    const descriptor = openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let bytesRead = 0;
      do {
        bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      closeSync(descriptor);
    }
    return hash.digest('hex');
  }

  private hasPostgresDumpContent(databaseFile: string) {
    if (!existsSync(databaseFile)) return false;
    try {
      const content = readFileSync(databaseFile, 'utf8').slice(0, 4096);
      return /PostgreSQL database dump|CREATE TABLE|COPY .* FROM stdin|SET statement_timeout/i.test(
        content,
      );
    } catch {
      return false;
    }
  }

  private buildReleaseRollbackStatus(): CommercialReleaseRollbackStatus {
    const generatedAt = new Date().toISOString();
    const desktopRoot = this.resolveReleaseDesktopRoot();
    const distRoots = this.resolveReleaseDistRoots(desktopRoot);
    const packageJson = this.readJsonFile(join(desktopRoot, 'package.json'));
    const currentVersion =
      typeof packageJson?.version === 'string' ? packageJson.version : null;
    const releaseScriptFound = existsSync(
      join(desktopRoot, 'scripts', 'release.js'),
    );
    const verifierScriptFound = existsSync(
      join(desktopRoot, 'scripts', 'verify-oss-release.js'),
    );
    const latestMetadata = this.readReleaseLatestMetadata(distRoots);
    const candidates = this.collectReleaseRollbackCandidates(
      distRoots,
      currentVersion,
      latestMetadata.byDir,
    );
    const currentInstaller =
      (currentVersion
        ? candidates.find((candidate) => candidate.version === currentVersion)
        : null) ??
      candidates[0] ??
      null;
    const rollbackCandidate =
      candidates.find(
        (candidate) =>
          candidate.rollbackEligible && candidate.blockers.length === 0,
      ) ?? null;
    const blockers = [
      !currentVersion ? '没有读取到 desktop/package.json 当前版本。' : '',
      !releaseScriptFound ? '缺少 desktop/scripts/release.js。' : '',
      !verifierScriptFound
        ? '缺少 desktop/scripts/verify-oss-release.js。'
        : '',
      !latestMetadata.latest ? '缺少 Windows latest.yml。' : '',
      !currentInstaller ? '缺少当前版本 Windows 安装包。' : '',
      currentInstaller && currentInstaller.blockers.length > 0
        ? `当前版本安装包不可作为发布基线：${currentInstaller.blockers.join('、')}`
        : '',
      !rollbackCandidate ? '缺少可回滚的上一版 Windows 安装包。' : '',
    ].filter(Boolean);
    const warnings = [
      currentVersion &&
      latestMetadata.latest?.version &&
      latestMetadata.latest.version !== currentVersion
        ? `desktop/package.json=${currentVersion} 与 latest.yml=${latestMetadata.latest.version} 不一致。`
        : '',
      ...candidates
        .filter((candidate) => candidate.blockers.length > 0)
        .slice(0, 3)
        .map(
          (candidate) =>
            `${candidate.version} 候选未完全可用：${candidate.blockers.join('、')}`,
        ),
    ].filter(Boolean);
    const ready = blockers.length === 0;
    const proofHash = this.hashProof({
      kind: 'commercial-release-rollback-status',
      generatedAt,
      currentVersion,
      latestFeedVersion: latestMetadata.latest?.version ?? null,
      currentInstaller: currentInstaller
        ? {
            version: currentInstaller.version,
            installerPath: currentInstaller.installerPath,
            sizeBytes: currentInstaller.sizeBytes,
          }
        : null,
      rollbackCandidate: rollbackCandidate
        ? {
            version: rollbackCandidate.version,
            installerPath: rollbackCandidate.installerPath,
            sizeBytes: rollbackCandidate.sizeBytes,
          }
        : null,
      blockers,
      warnings,
    });

    return {
      generatedAt,
      ready,
      currentVersion,
      latestFeedVersion: latestMetadata.latest?.version ?? null,
      desktopRoot,
      distRoots,
      releaseScriptFound,
      verifierScriptFound,
      latestMetadataFound: Boolean(latestMetadata.latest),
      currentInstaller,
      rollbackCandidate,
      candidates: candidates.slice(0, 12),
      blockers,
      warnings,
      proofHash,
      message: ready
        ? `发布回滚就绪：当前 ${currentVersion}，可回滚到 ${rollbackCandidate?.version}。`
        : `发布回滚未就绪：${blockers.join('；')}`,
    };
  }

  private resolveReleaseDesktopRoot() {
    const configured = process.env.COMMERCIAL_RELEASE_DESKTOP_ROOT?.trim();
    if (!configured) return join(resolveProjectRoot(), 'desktop');
    return isAbsolute(configured)
      ? configured
      : resolve(resolveProjectRoot(), configured);
  }

  private resolveReleaseDistRoots(desktopRoot: string) {
    const configured = process.env.COMMERCIAL_RELEASE_DIST_DIRS?.trim();
    if (configured) {
      return configured
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) =>
          isAbsolute(value) ? value : resolve(resolveProjectRoot(), value),
        );
    }
    const roots = [join(desktopRoot, 'dist')];
    try {
      for (const name of readdirSync(desktopRoot)) {
        if (name.startsWith('dist-windows')) {
          roots.push(join(desktopRoot, name));
        }
      }
    } catch {
      // Missing desktop folder is captured by the release rollback blockers.
    }
    return Array.from(new Set(roots));
  }

  private collectReleaseRollbackCandidates(
    distRoots: string[],
    currentVersion: string | null,
    metadataByDir: Map<string, ReleaseLatestMetadata>,
  ): CommercialReleaseRollbackCandidate[] {
    const seen = new Set<string>();
    const candidates: CommercialReleaseRollbackCandidate[] = [];
    for (const distRoot of distRoots) {
      for (const installerPath of this.findExeFiles(distRoot)) {
        if (seen.has(installerPath)) continue;
        seen.add(installerPath);
        const version = this.versionFromInstallerName(basename(installerPath));
        if (!version) continue;
        const stat = statSync(installerPath);
        const blockmapPath = `${installerPath}.blockmap`;
        const latestMetadata = metadataByDir.get(resolve(distRoot));
        const latestMetadataPath = latestMetadata?.filePath ?? null;
        const latestMetadataMatches = Boolean(
          latestMetadata &&
          latestMetadata.path &&
          basename(latestMetadata.path) === basename(installerPath),
        );
        const blockers = [
          stat.size <= 0 ? '安装包大小为 0。' : '',
          !existsSync(blockmapPath) ? '缺少 blockmap。' : '',
        ].filter(Boolean);
        candidates.push({
          version,
          installerPath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          blockmapPath: existsSync(blockmapPath) ? blockmapPath : null,
          latestMetadataPath,
          latestMetadataMatches,
          releaseDate: latestMetadata?.releaseDate ?? null,
          rollbackEligible: currentVersion
            ? this.compareVersions(version, currentVersion) < 0
            : false,
          blockers,
        });
      }
    }
    return candidates.sort((left, right) => {
      const versionCompare = this.compareVersions(right.version, left.version);
      if (versionCompare !== 0) return versionCompare;
      return Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt);
    });
  }

  private readReleaseLatestMetadata(distRoots: string[]) {
    const byDir = new Map<string, ReleaseLatestMetadata>();
    for (const distRoot of distRoots) {
      const filePath = join(distRoot, 'latest.yml');
      const parsed = this.parseLatestYml(filePath);
      if (parsed) byDir.set(resolve(distRoot), parsed);
    }
    const latest =
      byDir.get(resolve(distRoots[0] ?? '')) ??
      Array.from(byDir.values()).sort((left, right) => {
        const leftDate = Date.parse(left.releaseDate ?? '') || 0;
        const rightDate = Date.parse(right.releaseDate ?? '') || 0;
        return rightDate - leftDate;
      })[0] ??
      null;
    return { latest, byDir };
  }

  private parseLatestYml(filePath: string): ReleaseLatestMetadata | null {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf8');
    const pick = (pattern: RegExp) => {
      const match = content.match(pattern);
      return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
    };
    return {
      filePath,
      version: pick(/^\s*version:\s*([^\r\n#]+)\s*$/m),
      path: pick(/^\s*path:\s*([^\r\n#]+)\s*$/m),
      sha512: pick(/^\s*sha512:\s*([^\r\n#]+)\s*$/m),
      releaseDate: pick(/^\s*releaseDate:\s*([^\r\n#]+)\s*$/m),
    };
  }

  private readJsonFile(filePath: string): Record<string, unknown> | null {
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }

  private versionFromInstallerName(fileName: string) {
    return fileName.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  }

  private compareVersions(left: string, right: string) {
    const leftParts = left.split('.').map((part) => Number(part) || 0);
    const rightParts = right.split('.').map((part) => Number(part) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
      if (delta !== 0) return delta;
    }
    return 0;
  }

  private hashProof(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private windowsPackagingSnapshot() {
    const desktopRoot = this.resolveReleaseDesktopRoot();
    const buildScript = join(desktopRoot, 'scripts', 'build-win-full.js');
    const packager = join(desktopRoot, 'packager.json');
    const candidates = this.resolveReleaseDistRoots(desktopRoot);
    const installers = candidates.flatMap((dir) => this.findExeFiles(dir));
    return {
      buildScriptFound: existsSync(buildScript),
      packagerFound: existsSync(packager),
      installerFound: installers.length > 0,
      installers: installers.slice(0, 8),
    };
  }

  private findExeFiles(dir: string) {
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir)
        .filter((name) => name.toLowerCase().endsWith('.exe'))
        .map((name) => join(dir, name));
    } catch {
      return [];
    }
  }
}
