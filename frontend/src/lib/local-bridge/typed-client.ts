import { LOCAL_BRIDGE_ACTIONS } from "./actions";
import { LocalBridgeClient } from "./client";
import type { BridgeStatus } from "./protocol";

export type LocalBridgeStatus = BridgeStatus;

export interface LocalBridgePlatformCapability {
  platform: string;
  displayName: string;
  contentKinds: string[];
  executionModes: string[];
  supportsSchedule: boolean;
  supportsDraft: boolean;
  supportsCover: boolean;
  supportsReadback: boolean;
  supportsAccountDetection: boolean;
  riskLevel: string;
  adapterVersion: string;
}

export interface LocalBridgeAccount {
  id: string;
  platform: string;
  displayName: string;
  accountName: string;
  status: string;
  statusLabel: string;
  avatarUrl: string | null;
  lastCheckedAt: string | null;
}

export interface LocalBridgeTaskStatus {
  taskId: number;
  status: "completed" | "failed" | "waiting";
  result: {
    taskId: number;
    platforms: Array<{
      platform: string;
      accountId: string;
      accountName?: string;
      articleId?: string;
      status: string;
      publishUrl?: string;
      failureReason?: string;
    }>;
    summary: Record<string, number>;
  };
}

export interface ExecutePublishRequest {
  confirmationId: string;
  idempotencyKey: string;
  payloads: Array<{
    type: number;
    title: string;
    tags: string[];
    fileList: string[];
    accountList: string[];
    contentKind?: "article" | "video";
    articleId?: string;
    body?: string;
    coverPath?: string;
    coverPaths?: Record<string, string>;
    enableTimer?: 0 | 1;
    videosPerDay?: number;
    dailyTimes?: string[];
    startDays?: number;
    timeJitterMinutes?: number;
    debugDryRun?: boolean;
    category?: number;
  }>;
}

export interface ExecutePublishResult {
  accepted: true;
  taskId: number;
  status: "waiting";
  idempotencyKey: string;
}

export interface CancelTaskRequest {
  reason?: string;
}

export interface CancelTaskResult {
  cancelled: boolean;
}

export class TypedLocalBridgeClient {
  constructor(private readonly client: LocalBridgeClient) {}

  getStatus(timeoutMs?: number): Promise<LocalBridgeStatus> {
    return this.client.request<LocalBridgeStatus>(
      LOCAL_BRIDGE_ACTIONS.CHECK_STATUS,
      {},
      { timeoutMs },
    );
  }

  listCapabilities(timeoutMs?: number): Promise<LocalBridgePlatformCapability[]> {
    return this.client.request<LocalBridgePlatformCapability[]>(
      LOCAL_BRIDGE_ACTIONS.LIST_CAPABILITIES,
      {},
      { timeoutMs },
    );
  }

  listAccounts(timeoutMs?: number): Promise<LocalBridgeAccount[]> {
    return this.client.request<LocalBridgeAccount[]>(
      LOCAL_BRIDGE_ACTIONS.LIST_ACCOUNTS,
      {},
      { timeoutMs },
    );
  }

  executePublish(
    request: ExecutePublishRequest,
    timeoutMs?: number,
  ): Promise<ExecutePublishResult> {
    return this.client.request<ExecutePublishResult>(
      LOCAL_BRIDGE_ACTIONS.EXECUTE_PUBLISH,
      request,
      { timeoutMs: timeoutMs ?? 10_000 },
    );
  }

  getTaskStatus(
    taskId: number,
    timeoutMs?: number,
  ): Promise<LocalBridgeTaskStatus> {
    return this.client.request<LocalBridgeTaskStatus>(
      LOCAL_BRIDGE_ACTIONS.GET_TASK_STATUS,
      { taskId },
      { timeoutMs },
    );
  }

  cancelTask(
    taskId: number,
    request: CancelTaskRequest = {},
    timeoutMs?: number,
  ): Promise<CancelTaskResult> {
    return this.client.request<CancelTaskResult>(
      LOCAL_BRIDGE_ACTIONS.CANCEL_TASK,
      { taskId, ...request },
      { timeoutMs },
    );
  }
}

export const typedLocalBridge = new TypedLocalBridgeClient(
  // Lazy-import to avoid circular dependency in SSR
  typeof window !== "undefined"
    ? (require("./client") as { localBridge: LocalBridgeClient }).localBridge
    : (undefined as unknown as LocalBridgeClient),
);
