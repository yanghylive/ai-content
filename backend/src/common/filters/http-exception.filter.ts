import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || exception.message;
    }

    // 记录错误日志
    this.logger.error(
      `${request.method} ${request.url} ${status} - ${JSON.stringify(message)}`,
      exception instanceof Error ? exception.stack : '',
    );

    if (
      status === HttpStatus.UNAUTHORIZED &&
      request.headers.cookie?.includes(`${AUTH_COOKIE_NAME}=`)
    ) {
      response.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureAuthCookie(),
        path: '/',
      });
    }

    response.status(status).json({
      success: false,
      data: null,
      message: Array.isArray(message) ? message.join('; ') : message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
