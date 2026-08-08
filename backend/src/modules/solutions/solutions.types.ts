import type { RedfoxSkillRunResult } from '../redfox/redfox.types';
import type { RedfoxSkillHubRef } from '../redfox/redfox-skill-mapping.catalog';

export type SolutionPackageCategory = 'core' | 'redfox_pool';

export type SolutionImplementationState = 'connected' | 'partial' | 'planned';

export type SolutionConfigurationFieldType =
  | 'text'
  | 'textarea'
  | 'tags'
  | 'select'
  | 'number';

export interface SolutionConfigurationField {
  key: string;
  label: string;
  type: SolutionConfigurationFieldType;
  required: boolean;
  placeholder: string;
  helper: string;
  options?: string[];
  defaultValue?: string | number | string[];
}

export interface SolutionIndustryTemplate {
  code: string;
  name: string;
  industry: string;
  scenario: string;
  defaultInput: Record<string, unknown>;
  expectedOutcome: string;
  rolloutDays: number;
}

export interface SolutionCaseStudy {
  title: string;
  companyProfile: string;
  before: string;
  after: string;
  result: string;
  evidence: string[];
}

export interface SolutionRoiMetric {
  key: string;
  label: string;
  unit: string;
  baseline: number;
  target: number;
  description: string;
}

export interface SolutionPermissionPolicy {
  requiredRoles: string[];
  approvalRoles: string[];
  auditEvents: string[];
  externalExecutionPolicy: string;
}

export interface SolutionProductizationProfile {
  deliverables: string[];
  resultModules: string[];
  configurationFields: SolutionConfigurationField[];
  templates: SolutionIndustryTemplate[];
  caseStudies: SolutionCaseStudy[];
  roiMetrics: SolutionRoiMetric[];
  permissionPolicy: SolutionPermissionPolicy;
  operatingCadence: string[];
}

export interface SolutionPackageDefinition {
  code: string;
  name: string;
  category: SolutionPackageCategory;
  implementationState: SolutionImplementationState;
  summary: string;
  customerValue: string;
  entryPath: string;
  connectedEntryPath?: string;
  ownerGroups: string[];
  redfoxSkills: string[];
  workflow: string[];
  dataObjects: string[];
  acceptance: string[];
  estimatedWorkdays: number;
  productization?: SolutionProductizationProfile;
}

export interface SolutionPackageSummary {
  total: number;
  core: number;
  redfoxPool: number;
  connected: number;
  partial: number;
  planned: number;
  redfoxSkillCount: number;
  estimatedWorkdays: number;
  ownerGroups: string[];
}

export interface SolutionPackageListResult {
  items: SolutionPackageDefinition[];
  summary: SolutionPackageSummary;
}

export interface SolutionRedfoxMappingCoverageItem {
  packageCode: string;
  packageName: string;
  skillName: string;
  mapped: boolean;
  integrationReady: boolean;
  executionReady: boolean;
  executionStatus:
    | 'verified_api_path'
    | 'verified_skillhub'
    | 'contract_only'
    | 'unmapped';
  mappingCode: string | null;
  skillCode: string | null;
  normalizedSkillName: string | null;
  platform: string | null;
  scenario: string | null;
  path: string | null;
  skillHubRefs: RedfoxSkillHubRef[];
  outputObjects: string[];
  missingReason: string | null;
}

export interface SolutionRedfoxMappingCoverageResult {
  totalPackageSkillRefs: number;
  mappedPackageSkillRefs: number;
  verifiedApiPathRefs: number;
  verifiedSkillHubRefs: number;
  contractOnlyRefs: number;
  unmappedPackageSkillRefs: number;
  uniqueSkillCount: number;
  uniqueMappedSkillCount: number;
  uniqueVerifiedApiPathSkillCount: number;
  uniqueVerifiedSkillHubSkillCount: number;
  uniqueContractOnlySkillCount: number;
  uniqueUnmappedSkillCount: number;
  mappingCatalogSize: number;
  unmappedSkills: string[];
  contractOnlySkills: string[];
  items: SolutionRedfoxMappingCoverageItem[];
}

export interface SolutionRunPlanStep {
  order: number;
  name: string;
  ownerGroup: string;
  inputs: string[];
  outputs: string[];
  redfoxSkills: string[];
  businessCheckpoint: string;
  deliverables: string[];
  requiresApproval: boolean;
  estimatedMinutes: number;
}

export interface SolutionRunPlan {
  packageCode: string;
  packageName: string;
  generatedAt: string;
  status: 'ready_for_mapping';
  ownerGroups: string[];
  requiredDataObjects: string[];
  steps: SolutionRunPlanStep[];
  acceptance: string[];
  warnings: string[];
}

export interface CreateSolutionRunRequest {
  trigger?: string;
  source?: string;
  input?: Record<string, unknown>;
  dryRun?: boolean;
  riskLevel?: string;
  confirmationPolicy?: string;
  sendMode?: string;
  maxCostPoints?: number;
}

export interface SolutionRunTaskRecord {
  id: string;
  runId: string;
  stepKey: string;
  order: number;
  name: string;
  type: string;
  executorKind: string;
  status: string;
  targetObject: string | null;
  output: unknown;
  reasonCode: string | null;
  errorMessage: string | null;
  redfoxCallLogId: string | null;
  runtimeExecutionId: string | null;
  agentConfirmationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SolutionRunResultRecord {
  id: string;
  runId: string;
  taskId: string | null;
  kind: string;
  status: string;
  businessObjectRefs: unknown;
  counts: unknown;
  nextAction: string | null;
  failureReason: string | null;
  acceptedAt: string | null;
  approvedBy: string | null;
  payloadSummary: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface RunSolutionTaskRedfoxRequest {
  skillCode?: string;
  skillName?: string;
  input?: Record<string, unknown>;
  path?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  bodyEncoding?: 'json' | 'form';
  operation?: string;
  estimatedCostPoints?: number;
  idempotencyKey?: string;
  confirmRealExecution?: string;
  approvalNote?: string;
}

export interface ConfirmSolutionOutputDraftsRequest {
  confirmPersistence?: string;
  objectTypes?: string[];
  dedupeKeys?: string[];
  maxObjects?: number;
}

export interface ConfirmSolutionOutputDraftsResult {
  runId: string;
  resultId: string;
  status: string;
  createdRefs: Array<{
    objectType: string;
    dedupeKey: string;
    refId: string;
    source: string;
  }>;
  skippedRefs: Array<{
    objectType: string;
    dedupeKey: string;
    reason: string;
  }>;
  businessObjectRefs: unknown;
  counts: unknown;
}

export type SolutionResultActionKind =
  | 'monitor'
  | 'crm_task'
  | 'intelligence_report'
  | 'crm_lead'
  | 'publish_preparation';

export interface ExecuteSolutionResultActionRequest {
  kind: SolutionResultActionKind;
  label: string;
  targetModule: string;
  description?: string;
  actionKey?: string;
  entryPath?: string;
  configuredInput?: Record<string, unknown>;
}

export interface ExecuteSolutionResultActionResult {
  runId: string;
  actionKey: string;
  kind: SolutionResultActionKind;
  status: 'created' | 'reused';
  message: string;
  href: string;
  objectType: string;
  refId: string;
  source: string;
  result: SolutionRunResultRecord;
}

export interface SolutionTaskRedfoxDryRunResult {
  run: SolutionRunRecord;
  task: SolutionRunTaskRecord;
  redfoxRun: RedfoxSkillRunResult;
}

export interface SolutionTaskRedfoxExecutionResult {
  run: SolutionRunRecord;
  task: SolutionRunTaskRecord;
  redfoxRun: RedfoxSkillRunResult;
}

export interface ApproveSolutionManualTaskRequest {
  approvalNote?: string;
  evidenceUrl?: string;
  businessResult?: Record<string, unknown>;
}

export interface ApproveSolutionManualTaskResult {
  run: SolutionRunRecord;
  task: SolutionRunTaskRecord;
  result: SolutionRunResultRecord;
}

export interface SolutionRunRecord {
  id: string;
  tenantId: string | null;
  userId: string;
  packageCode: string;
  packageName: string;
  packageVersion: string;
  trigger: string;
  source: string;
  status: string;
  progress: number;
  dryRun: boolean;
  riskLevel: string;
  confirmationPolicy: string;
  sendMode: string;
  estimatedCostPoints: number;
  maxCostPoints: number;
  actualCostPoints: number;
  costStatus: string;
  input: unknown;
  resolvedPlan: unknown;
  summary: unknown;
  outputRefs: unknown;
  acceptanceChecks: unknown;
  tasks: SolutionRunTaskRecord[];
  results: SolutionRunResultRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface SolutionRunListResult {
  items: SolutionRunRecord[];
  total: number;
}
