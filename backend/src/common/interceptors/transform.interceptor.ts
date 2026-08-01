import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { LOCAL_BRIDGE_ERROR_CODES } from '../../modules/local-bridge/local-bridge.errors';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
}

const LOCAL_BRIDGE_ERROR_CODE_SET = new Set<string>(
  Object.values(LOCAL_BRIDGE_ERROR_CODES),
);

function isLocalBridgeEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  const actionIsValid =
    response.action === 'JZ_BRIDGE_CHECK_STATUS' ||
    response.action === 'JZ_BRIDGE_LIST_CAPABILITIES' ||
    response.action === 'JZ_BRIDGE_LIST_ACCOUNTS';
  const baseIsValid =
    response.protocol === 'jiuzhang-local-bridge' &&
    response.version === 1 &&
    response.type === 'response' &&
    typeof response.traceId === 'string' &&
    response.traceId.length > 0 &&
    actionIsValid &&
    typeof response.code === 'number' &&
    typeof response.message === 'string' &&
    typeof response.timestamp === 'number' &&
    Number.isFinite(response.timestamp) &&
    'data' in response;

  if (!baseIsValid) return false;
  if (response.ok === true) {
    return response.code === 200 && !('errorCode' in response);
  }
  if (response.ok === false) {
    return (
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
          data,
          message: 'ok',
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
