export type LocalBridgeErrorCode =
  | "BRIDGE_OFFLINE"
  | "ORIGIN_NOT_TRUSTED"
  | "BRIDGE_VERSION_MISMATCH"
  | "NONCE_REPLAYED"
  | "CONFIRMATION_REQUIRED"
  | "ACCOUNT_NEEDS_LOGIN"
  | "PLATFORM_NOT_SUPPORTED"
  | "ADAPTER_DEGRADED"
  | "SELECTOR_NOT_FOUND"
  | "ASSET_FETCH_FAILED"
  | "PUBLISH_UNCERTAIN"
  | "PUBLISH_REJECTED"
  | "TASK_ALREADY_EXISTS"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "SSR_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export class LocalBridgeError extends Error {
  constructor(
    public readonly code: LocalBridgeErrorCode | string,
    message: string,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = "LocalBridgeError";
  }
}

export function toLocalBridgeError(error: unknown): LocalBridgeError {
  if (error instanceof LocalBridgeError) return error;
  return new LocalBridgeError(
    "UNKNOWN_ERROR",
    error instanceof Error ? error.message : "本地执行器请求失败",
  );
}
