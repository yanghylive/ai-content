import { api } from './client';

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
  cooperationItems?: CommercialReadinessCooperationItem[];
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
  appInstallCount?: number;
  crmAppInstalled?: boolean;
  databaseMode?: string;
  backupExport?: CommercialReadinessBackupExportGate;
  effectiveEntitlement?: CommercialReadinessEffectiveEntitlement;
}

export interface CommercialBackupResult {
  generatedAt: string;
  status: 'created' | 'unsupported';
  backupKind: 'sqlite' | 'postgres' | 'unsupported';
  backupDir: string | null;
  databaseFile: string | null;
  manifestFile: string | null;
  sizeBytes: number;
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

export const commercialReadinessApi = {
  summary() {
    return api.get<CommercialReadinessSummary>('/commercial-readiness/summary');
  },
  backupStatus() {
    return api.get<CommercialBackupStatus>('/commercial-readiness/backup/status');
  },
  exportBackup() {
    return api.post<CommercialBackupResult>('/commercial-readiness/backup/export', {});
  },
  restoreDryRun() {
    return api.post<CommercialBackupRestoreDryRunResult>(
      '/commercial-readiness/backup/restore-dry-run',
      {},
    );
  },
  releaseRollbackStatus() {
    return api.get<CommercialReleaseRollbackStatus>(
      '/commercial-readiness/release-rollback/status',
    );
  },
  releaseRollbackDryRun() {
    return api.post<CommercialReleaseRollbackDryRunResult>(
      '/commercial-readiness/release-rollback/dry-run',
      {},
    );
  },
};
