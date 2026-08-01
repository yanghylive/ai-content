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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = '服务器内部错误';
    let code: string | undefined;
    let publicDetails: unknown;
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
      }
    }

    const logMessage = `[${requestId}] ${request.method} ${request.url} ${status} - ${JSON.stringify(message)}`;
    if (status >= 500) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : '',
      );
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
