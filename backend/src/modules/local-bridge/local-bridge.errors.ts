export const LOCAL_BRIDGE_ERROR_CODES = {
  UNAUTHORIZED_ORIGIN: 'UNAUTHORIZED_ORIGIN',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  ENGINE_UNAVAILABLE: 'ENGINE_UNAVAILABLE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  CANCELLATION_UNSUPPORTED: 'CANCELLATION_UNSUPPORTED',
  WRITE_PATH_NOT_READY: 'WRITE_PATH_NOT_READY',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type LocalBridgeErrorCode =
  (typeof LOCAL_BRIDGE_ERROR_CODES)[keyof typeof LOCAL_BRIDGE_ERROR_CODES];

export class LocalBridgeError extends Error {
  constructor(
    readonly errorCode: LocalBridgeErrorCode,
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = LocalBridgeError.name;
  }
}
