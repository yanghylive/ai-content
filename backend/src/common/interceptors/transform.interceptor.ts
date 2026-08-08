import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  LOCAL_BRIDGE_ACTIONS,
  type LocalBridgeAction,
} from '../../modules/local-bridge/local-bridge.contract';
import { LOCAL_BRIDGE_ERROR_CODES } from '../../modules/local-bridge/local-bridge.errors';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
}

const LOCAL_BRIDGE_ACTION_SET = new Set<LocalBridgeAction>(
  Object.values(LOCAL_BRIDGE_ACTIONS),
);
const LOCAL_BRIDGE_ERROR_CODE_SET = new Set<string>(
  Object.values(LOCAL_BRIDGE_ERROR_CODES),
);
const LOCAL_BRIDGE_SUCCESS_KEYS = new Set([
  'protocol',
  'version',
  'type',
  'traceId',
  'action',
  'ok',
  'code',
  'message',
  'data',
  'timestamp',
]);
const LOCAL_BRIDGE_ERROR_KEYS = new Set([
  ...LOCAL_BRIDGE_SUCCESS_KEYS,
  'errorCode',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key) as boolean;
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === allowedKeys.size &&
    keys.every((key) => allowedKeys.has(key)) &&
    [...allowedKeys].every((key) => hasOwn(value, key))
  );
}

function isLocalBridgeEnvelope(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const response = value;
  const actionIsValid = LOCAL_BRIDGE_ACTION_SET.has(
    response.action as LocalBridgeAction,
  );
  const baseIsValid =
    response.protocol === 'jiuzhang-local-bridge' &&
    response.version === 1 &&
    response.type === 'response' &&
    typeof response.traceId === 'string' &&
    /^[A-Za-z0-9._:-]{1,80}$/.test(response.traceId) &&
    actionIsValid &&
    typeof response.code === 'number' &&
    Number.isSafeInteger(response.code) &&
    typeof response.message === 'string' &&
    typeof response.timestamp === 'number' &&
    Number.isSafeInteger(response.timestamp) &&
    response.timestamp > 0;

  if (!baseIsValid) return false;
  if (response.ok === true) {
    return (
      hasExactKeys(response, LOCAL_BRIDGE_SUCCESS_KEYS) && response.code === 200
    );
  }
  if (response.ok === false) {
    return (
      hasExactKeys(response, LOCAL_BRIDGE_ERROR_KEYS) &&
      response.code !== 200 &&
      response.data === null &&
      typeof response.errorCode === 'string' &&
      LOCAL_BRIDGE_ERROR_CODE_SET.has(response.errorCode)
    );
  }
  return false;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (isLocalBridgeEnvelope(data)) {
          return data as ApiResponse<T>;
        }
        return {
          success: true,
          data: data as T,
          message: 'ok',
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
