import type {
  ExecutorEvidence,
  ExecutorReasonCode,
  ExecutorSendMode,
  ExecutorTaskPlatform,
  ExecutorTaskType,
} from '../runtime/executor.interface';

export type AiEmployeeExposureMode =
  | 'link'
  | 'search_account'
  | 'hot_video'
  | 'targeted'
  | 'retention';

export type AiEmployeeExposureExecutionKind =
  | 'candidate_read'
  | 'customer_action';

export type AiEmployeeWorkflowStepActionKind =
  | 'local_operation'
  | 'candidate_read'
  | 'customer_action'
  | 'platform_action';

export type AiEmployeeWorkflowStepAvailability = 'available' | 'blocked';

export type AiEmployeeWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type AiEmployeeWorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export type AiEmployeeWorkflowRunTrigger = 'manual' | 'retry' | 'schedule';

export interface AiEmployeeWorkflowConfirmationMetadata {
  auditId: string;
  confirmationId: string;
  action: string;
  riskLevel: 'low' | 'medium' | 'high';
  operator: string;
  operatorId?: string;
  reason?: string;
  confirmedAt: string;
  appliedAt: string;
  source: AiEmployeeWorkflowRunTrigger;
  parentAuditId?: string;
  checklist?: Record<string, boolean>;
}

export interface AiEmployeeWorkflowSchedule {
  enabled: true;
  frequency: string;
  timeWindow: string;
  timezone: string;
  status: 'awaiting_confirmation' | 'active';
  nextRunAt?: string;
  lastScheduledAt?: string;
  authorization?: AiEmployeeWorkflowConfirmationMetadata;
}

export interface AiEmployeeWorkflowPreparationInput {
  title?: string;
  accountId?: string;
  workflow?: Record<string, unknown>;
}

export interface AiEmployeeWorkflowCapabilityInput {
  key: string;
  title: string;
  status: 'real' | 'simulated' | 'needs_config' | 'unavailable';
  message: string;
  nextAction: string;
}

export interface AiEmployeeWorkflowStepDefinition {
  id: string;
  capabilityKey: string;
  title: string;
  actionKind: AiEmployeeWorkflowStepActionKind;
  exposureMode?: AiEmployeeExposureMode;
  taskType?: ExecutorTaskType;
  platform: ExecutorTaskPlatform;
  accountId?: string;
  payload: Record<string, unknown>;
  sendMode: ExecutorSendMode;
  dependencies: string[];
  availability: AiEmployeeWorkflowStepAvailability;
  capabilityStatus: AiEmployeeWorkflowCapabilityInput['status'];
  message: string;
  nextAction: string;
  requiresEvidence: true;
  requiresReadback: boolean;
}

export interface AiEmployeeWorkflowExecutionPolicy {
  defaultSendMode: 'auto-send';
  hasCustomerActions: boolean;
  hasPlatformActions: boolean;
  requiresConfirmation: boolean;
}

export interface AiEmployeeWorkflowDefinition {
  id: string;
  tenantId: string;
  userId: string;
  version: number;
  title: string;
  accountId?: string;
  platform: ExecutorTaskPlatform;
  config: Record<string, unknown>;
  status: 'ready' | 'partially_ready' | 'blocked';
  steps: AiEmployeeWorkflowStepDefinition[];
  blockers: AiEmployeeWorkflowBlocker[];
  executionPolicy: AiEmployeeWorkflowExecutionPolicy;
  schedule?: AiEmployeeWorkflowSchedule;
  createdAt: string;
  updatedAt: string;
}

export interface AiEmployeeWorkflowBlocker {
  code: string;
  stepId?: string;
  title: string;
  message: string;
  nextAction: string;
}

export interface AiEmployeeWorkflowStepTransition {
  from: AiEmployeeWorkflowStepStatus | null;
  to: AiEmployeeWorkflowStepStatus;
  at: string;
  attempt: number;
  message: string;
}

export interface AiEmployeeWorkflowStepRun {
  stepId: string;
  capabilityKey: string;
  title: string;
  actionKind: AiEmployeeWorkflowStepActionKind;
  exposureMode?: AiEmployeeExposureMode;
  taskType?: ExecutorTaskType;
  status: AiEmployeeWorkflowStepStatus;
  attempt: number;
  transitions: AiEmployeeWorkflowStepTransition[];
  message: string;
  nextAction?: string;
  reasonCode?: ExecutorReasonCode;
  technicalMessage?: string;
  evidence: ExecutorEvidence[];
  readback?: {
    expectedText?: string;
    actualText?: string;
    matched: boolean;
  };
  output?: {
    candidateCount?: number;
    candidates?: Array<Record<string, unknown>>;
    runtime?: Record<string, unknown>;
  };
  startedAt?: string;
  finishedAt?: string;
}

export interface AiEmployeeWorkflowAggregate {
  totalSteps: number;
  pendingSteps: number;
  runningSteps: number;
  completedSteps: number;
  blockedSteps: number;
  failedSteps: number;
  cancelledSteps: number;
  evidenceCount: number;
  candidateCount: number;
  readbacks: Array<{
    stepId: string;
    title: string;
    matched: boolean;
    expectedText?: string;
    actualText?: string;
  }>;
}

export interface AiEmployeeWorkflowRun {
  id: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  workflowVersion: number;
  title: string;
  status: AiEmployeeWorkflowRunStatus;
  trigger: AiEmployeeWorkflowRunTrigger;
  executionPolicy: AiEmployeeWorkflowExecutionPolicy;
  confirmation?: AiEmployeeWorkflowConfirmationMetadata;
  confirmations: AiEmployeeWorkflowConfirmationMetadata[];
  steps: AiEmployeeWorkflowStepRun[];
  aggregate: AiEmployeeWorkflowAggregate;
  cancelRequestedAt?: string;
  cancellationMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  recovery?: {
    recoveredAt: string;
    previousStatus: 'queued' | 'running' | 'cancelling';
    message: string;
  };
}

export interface AiEmployeeWorkflowPreparationResult {
  taskType: 'workflow.auto';
  executionMode: 'configured';
  displayStatus: 'ready' | 'partially_ready' | 'configuration_required';
  message: string;
  nextAction: string;
  definition: AiEmployeeWorkflowDefinition;
  steps: AiEmployeeWorkflowStepDefinition[];
  blockers: AiEmployeeWorkflowBlocker[];
}

export interface AiEmployeeWorkflowRetryInput {
  stepIds?: string[];
}

export interface AiEmployeeWorkflowSnapshot {
  definitions: AiEmployeeWorkflowDefinition[];
  runs: AiEmployeeWorkflowRun[];
}

export interface AiEmployeeWorkflowStore {
  version: number;
  definitions: AiEmployeeWorkflowDefinition[];
  runs: AiEmployeeWorkflowRun[];
}
