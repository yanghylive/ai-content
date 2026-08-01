export type CommercialCheckStatus = 'pass' | 'warn' | 'blocker';

export interface CommercialReadinessCheck {
  key: string;
  title: string;
  status: CommercialCheckStatus;
  summary: string;
  evidence?: Record<string, unknown>;
  nextAction?: string;
}

export type CommercialCooperationStatus = 'received' | 'needed' | 'blocked';
export type CommercialCooperationOwner = 'user' | 'operator' | 'engineering';

export interface CommercialReadinessCooperationItem {
  key: string;
  title: string;
  status: CommercialCooperationStatus;
  owner: CommercialCooperationOwner;
  summary: string;
  nextAction: string;
  evidence?: Record<string, unknown>;
}

export interface CommercialReadinessSummary {
  generatedAt: string;
  overallStatus: 'ready' | 'warning' | 'blocked';
  score: number;
  checks: CommercialReadinessCheck[];
  blockers: CommercialReadinessCheck[];
  warnings: CommercialReadinessCheck[];
  cooperationItems: CommercialReadinessCooperationItem[];
  nextActions: string[];
  evidence: CommercialReadinessEvidence;
}

export interface CommercialReadinessBackupExportGate {
  allowed: boolean;
  requiredPlans: string[];
  plan: string;
  entitlementSource: string;
  commercialExecutionAllowed: boolean;
  cloudSubscriptionActive: boolean;
  localCommercialAllowed: boolean;
  planExpired: boolean;
  blockers: string[];
}

export interface CommercialReadinessEffectiveEntitlement {
  source: string;
  plan: string;
  commercialExecutionAllowed: boolean;
  cloudSubscriptionActive: boolean;
  localCommercialAllowed: boolean;
  planExpired: boolean;
  blockers: string[];
  tenantId: string;
}

export interface CommercialReadinessEvidence extends Record<string, unknown> {
  appInstallCount: number;
  crmAppInstalled: boolean;
  databaseMode: string;
  backupExport: CommercialReadinessBackupExportGate;
  effectiveEntitlement: CommercialReadinessEffectiveEntitlement;
}

export interface CommercialBackupResult {
  generatedAt: string;
  status: 'created' | 'unsupported';
  backupKind: 'sqlite' | 'postgres' | 'unsupported';
  backupDir: string | null;
  databaseFile: string | null;
  manifestFile: string | null;
  sizeBytes: number;
  objectStoreMirror?: CommercialBackupObjectStoreMirror;
  message: string;
}

export interface CommercialBackupStatus {
  generatedAt: string;
  supported: boolean;
  databaseKind: 'sqlite' | 'postgres' | 'unknown';
  databaseFile: string | null;
  databaseExists: boolean;
  pgDumpAvailable: boolean;
  pgDumpCommand: string | null;
  backupRoot: string;
  latestBackupDir: string | null;
  latestManifestFile: string | null;
  latestBackupAt: string | null;
  latestSizeBytes: number;
  manifestValid: boolean;
  restoreDryRunReady: boolean;
  objectStoreMirror: CommercialBackupObjectStoreMirror;
  message: string;
}

export interface CommercialBackupRestoreDryRunResult {
  generatedAt: string;
  status: 'pass' | 'unsupported' | 'failed';
  backupKind: 'sqlite' | 'postgres' | 'unknown';
  backupDir: string | null;
  manifestFile: string | null;
  databaseFile: string | null;
  sizeBytes: number;
  manifestValid: boolean;
  contentValid: boolean;
  sqliteHeaderValid: boolean;
  sourceDatabaseFile: string | null;
  message: string;
}

export interface CommercialBackupObjectStoreMirror {
  enabled: boolean;
  provider?: 'local-dir' | 'aliyun-oss' | 'unsupported';
  root: string | null;
  mirrorDir: string | null;
  manifestFile: string | null;
  bucket?: string | null;
  prefix?: string | null;
  uploadedKeys?: string[];
  fileCount: number;
  sizeBytes: number;
  valid: boolean;
  message: string;
}

export interface CommercialBackupIsolatedRestoreDryRunResult {
  generatedAt: string;
  status: 'pass' | 'unsupported' | 'failed';
  backupKind: 'sqlite' | 'postgres' | 'unknown';
  backupDir: string | null;
  manifestFile: string | null;
  databaseFile: string | null;
  sizeBytes: number;
  manifestValid: boolean;
  contentValid: boolean;
  isolatedRestoreExecuted: boolean;
  restoreDatabasePrepared?: boolean;
  restoreDatabaseUrl: string | null;
  psqlCommand: string | null;
  message: string;
}

export interface CommercialBackupRetentionResult {
  enabled: boolean;
  keepLatest: number | null;
  prunedLocalDirs: string[];
  prunedMirrorDirs: string[];
  message: string;
}

export interface CommercialBackupAlertResult {
  configured: boolean;
  sent: boolean;
  provider?: 'generic' | 'wecom' | 'feishu' | 'slack';
  statusCode: number | null;
  message: string;
}

export interface CommercialBackupScheduledRunResult {
  source: 'startup' | 'interval' | 'manual';
  startedAt: string;
  completedAt: string;
  status: 'created' | 'unsupported' | 'failed';
  backupKind: 'sqlite' | 'postgres' | 'unsupported';
  backupDir: string | null;
  manifestFile: string | null;
  sizeBytes: number;
  mirrorValid: boolean;
  restoreDryRunStatus: CommercialBackupRestoreDryRunResult['status'] | null;
  isolatedRestoreStatus:
    | CommercialBackupIsolatedRestoreDryRunResult['status']
    | null;
  retention: CommercialBackupRetentionResult;
  alert: CommercialBackupAlertResult;
  message: string;
}

export interface CommercialBackupSchedulerStatus {
  generatedAt: string;
  enabled: boolean;
  armed: boolean;
  runOnStart: boolean;
  intervalMs: number;
  retentionKeepLatest: number | null;
  alertConfigured: boolean;
  running: boolean;
  lastRun: CommercialBackupScheduledRunResult | null;
  nextAction: string;
}

export interface CommercialReleaseRollbackCandidate {
  version: string;
  installerPath: string;
  sizeBytes: number;
  modifiedAt: string;
  blockmapPath: string | null;
  latestMetadataPath: string | null;
  latestMetadataMatches: boolean;
  releaseDate: string | null;
  rollbackEligible: boolean;
  blockers: string[];
}

export interface CommercialReleaseRollbackStatus {
  generatedAt: string;
  ready: boolean;
  currentVersion: string | null;
  latestFeedVersion: string | null;
  desktopRoot: string;
  distRoots: string[];
  releaseScriptFound: boolean;
  verifierScriptFound: boolean;
  latestMetadataFound: boolean;
  currentInstaller: CommercialReleaseRollbackCandidate | null;
  rollbackCandidate: CommercialReleaseRollbackCandidate | null;
  candidates: CommercialReleaseRollbackCandidate[];
  blockers: string[];
  warnings: string[];
  proofHash: string;
  message: string;
}

export interface CommercialReleaseRollbackDryRunStep {
  key: string;
  status: 'pass' | 'failed' | 'warn';
  message: string;
  evidence?: Record<string, unknown>;
}

export interface CommercialReleaseRollbackDryRunResult {
  generatedAt: string;
  status: 'pass' | 'failed';
  noDestructiveAction: true;
  currentVersion: string | null;
  rollbackTargetVersion: string | null;
  rollbackTargetInstaller: string | null;
  backupRestoreDryRunStatus: CommercialBackupRestoreDryRunResult['status'];
  steps: CommercialReleaseRollbackDryRunStep[];
  proofHash: string;
  message: string;
}
