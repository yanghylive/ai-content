import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { AUTH_COOKIE_NAME } from '../../modules/auth/auth.constants';
import { shouldUseSecureAuthCookie } from '../../modules/auth/cookie-options';
import { reportError } from './error-report';

/** §10.2 可重试语义：瞬时错误可安全重试（429/503/504） */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 防御：响应已发送（如 redirect 后二次异常）直接放弃写响应，避免 ERR_HTTP_HEADERS_SENT 二次报错
    if (response.headersSent) {
      this.logger.warn(
        `异常发生在响应已发送后（headersSent），跳过响应写入: ${request.method} ${request.url}`,
      );
      return;
    }

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = '服务器内部错误';
    let code: string | undefined;
    let publicDetails: unknown;
    let retryableFromError: boolean | undefined;
    const requestId = this.resolveRequestId(request);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        const record = exceptionResponse as Record<string, unknown>;
        const responseMessage = record.message;
        message =
          typeof responseMessage === 'string' || Array.isArray(responseMessage)
            ? (responseMessage as string | string[])
            : exception.message;
        if (typeof record.code === 'string' && record.code.trim()) {
          code = record.code.trim().slice(0, 100);
        }
        if (record.publicDetails !== undefined) {
          publicDetails = record.publicDetails;
        }
        if (typeof record.retryable === 'boolean') {
          retryableFromError = record.retryable;
        }
      }
    }

    const logMessage = `[${requestId}] ${request.method} ${request.url} ${status} - ${JSON.stringify(message)}`;
    if (status >= 500) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : '',
      );
      // 自动错误上报（v1.1.89+）：500 级错误 fire-and-forget 传 OSS error-reports/，
      // 无需用户手动收集日志；失败静默。
      reportError({
        requestId,
        method: request.method,
        url: request.url,
        status,
        message: Array.isArray(message) ? message.join('; ') : message,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn(logMessage);
    }

    if (
      status === 401 &&
      request.headers.cookie?.includes(`${AUTH_COOKIE_NAME}=`)
    ) {
      response.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureAuthCookie(),
        path: '/',
      });
    }

    response.setHeader('X-Request-Id', requestId);
    response.status(status).json({
      success: false,
      data: null,
      message: Array.isArray(message) ? message.join('; ') : message,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
      traceId: requestId, // §10.2 链路追踪字段（与 X-Request-Id 对齐）
      retryable:
        retryableFromError !== undefined
          ? retryableFromError
          : isRetryableStatus(status), // 业务错误 retryable 优先，否则按状态码兜底
      ...(code ? { code } : {}),
      ...(publicDetails !== undefined ? { details: publicDetails } : {}),
    });
  }

  private resolveRequestId(request: Request) {
    const header = request.headers['x-request-id'];
    const value = Array.isArray(header) ? header[0] : header;
    return value && /^[A-Za-z0-9._:-]{1,80}$/.test(value)
      ? value
      : randomUUID();
  }
}
