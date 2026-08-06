import type {
  AutoUploadPublishBatchResult,
  AutoUploadPublishPayload,
} from '../auto-upload/auto-upload.publish.types';
import type { LocalBridgeErrorCode } from './local-bridge.errors';

export const LOCAL_BRIDGE_PROTOCOL = 'jiuzhang-local-bridge' as const;
export const LOCAL_BRIDGE_VERSION = 1 as const;

export const LOCAL_BRIDGE_ACTIONS = {
  CHECK_STATUS: 'JZ_BRIDGE_CHECK_STATUS',
  LIST_CAPABILITIES: 'JZ_BRIDGE_LIST_CAPABILITIES',
  LIST_ACCOUNTS: 'JZ_BRIDGE_LIST_ACCOUNTS',
  OPEN_ACCOUNTS: 'JZ_BRIDGE_OPEN_ACCOUNTS',
  REFRESH_ACCOUNTS: 'JZ_BRIDGE_REFRESH_ACCOUNTS',
  EXECUTE_PUBLISH: 'JZ_BRIDGE_EXECUTE_PUBLISH',
  GET_TASK_STATUS: 'JZ_BRIDGE_GET_TASK_STATUS',
  CANCEL_TASK: 'JZ_BRIDGE_CANCEL_TASK',
  LIST_PUBLISH_HISTORY: 'JZ_BRIDGE_LIST_PUBLISH_HISTORY',
  RETRY_PUBLISH: 'JZ_BRIDGE_RETRY_PUBLISH',
  DELETE_PUBLISH_RECORD: 'JZ_BRIDGE_DELETE_PUBLISH_RECORD',
  SCRAPE_ARTICLE: 'JZ_BRIDGE_SCRAPE_ARTICLE',
} as const;

export type LocalBridgeAction =
  (typeof LOCAL_BRIDGE_ACTIONS)[keyof typeof LOCAL_BRIDGE_ACTIONS];

export interface LocalBridgeRequest<T = unknown> {
  protocol: typeof LOCAL_BRIDGE_PROTOCOL;
  version: typeof LOCAL_BRIDGE_VERSION;
  type: 'request';
  traceId: string;
  action: LocalBridgeAction;
  timestamp: number;
  nonce: string;
  data: T;
}

interface LocalBridgeResponseBase {
  protocol: typeof LOCAL_BRIDGE_PROTOCOL;
  version: typeof LOCAL_BRIDGE_VERSION;
  type: 'response';
  traceId: string;
  action: LocalBridgeAction;
  message: string;
  timestamp: number;
}

export interface LocalBridgeSuccessResponse<
  T = unknown,
> extends LocalBridgeResponseBase {
  ok: true;
  code: 200;
  data: T;
}

export interface LocalBridgeErrorResponse extends LocalBridgeResponseBase {
  ok: false;
  code: number;
  errorCode: LocalBridgeErrorCode;
  data: null;
}

export type LocalBridgeResponse<T = unknown> =
  | LocalBridgeSuccessResponse<T>
  | LocalBridgeErrorResponse;

export type LocalBridgeContentKind = 'article' | 'video';
export type LocalBridgeExecutionMode = 'cdp';

export interface LocalBridgeStatus {
  online: boolean;
  status: string;
  service: string;
  version: string;
  protocolVersion: typeof LOCAL_BRIDGE_VERSION;
  actions: LocalBridgeAction[];
  checkedAt: string;
}

export interface LocalBridgePlatformCapability {
  platform: string;
  displayName: string;
  contentKinds: LocalBridgeContentKind[];
  executionModes: LocalBridgeExecutionMode[];
  supportsSchedule: boolean;
  supportsDraft: boolean;
  supportsCover: boolean;
  supportsReadback: boolean;
  supportsAccountDetection: boolean;
  riskLevel: 'high';
  adapterVersion: string;
}

export type LocalBridgeAccountStatus =
  | 'ready'
  | 'needs_login'
  | 'error'
  | 'unknown';

export interface LocalBridgeAccount {
  id: string;
  platform: string;
  displayName: string;
  accountName: string;
  status: LocalBridgeAccountStatus;
  statusLabel: string;
  avatarUrl: string | null;
  lastCheckedAt: string | null;
}

export interface LocalBridgeExecutePublishRequest {
  confirmationId: string;
  idempotencyKey: string;
  payloads: AutoUploadPublishPayload[];
}

export interface LocalBridgeExecutePublishAcceptedResult {
  accepted: true;
  taskId: number;
  status: 'waiting';
  idempotencyKey: string;
}

export type LocalBridgeTaskState = 'completed' | 'failed' | 'waiting';

export interface LocalBridgeTaskStatus {
  taskId: number;
  status: LocalBridgeTaskState;
  result: AutoUploadPublishBatchResult;
}

export interface LocalBridgeCancelTaskRequest {
  reason?: string;
}

export interface LocalBridgeCancelTaskResult {
  taskId: number;
  cancelled: boolean;
  status: LocalBridgeTaskState;
}
