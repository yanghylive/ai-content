export const LOCAL_BRIDGE_ERROR_CODES = {
  UNAUTHORIZED_ORIGIN: 'UNAUTHORIZED_ORIGIN',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  ENGINE_UNAVAILABLE: 'ENGINE_UNAVAILABLE',
  INVALID_REQUEST: 'INVALID_REQUEST',
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
