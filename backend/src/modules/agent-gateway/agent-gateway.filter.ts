import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { isAppErrorLike, toHttpException } from './kaypal-auth.guard';

/**
 * agent-gateway 契约错误过滤器（controller 级）：
 * 捕获 handler 抛出的 AppError，转为 HttpException 交给全局 AllExceptionsFilter 统一输出
 * （与真实仓库 819 API 的错误格式一致：{success:false, message, code, ...}）。
 * guard 抛出的 AppError 已在 KaypalAuthGuard 内转换，直接走全局 filter。
 *
 * 2026-08-24 修复：未知异常兜底码从 INVALID_PLAN（业务语义，曾误导排障方向）
 * 改为 INTERNAL，并把原始异常打进日志，避免静默吞栈。
 */
@Catch()
export class AgentGatewayExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AgentGatewayExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (isAppErrorLike(exception)) {
      throw toHttpException(exception);
    }
    if (exception instanceof HttpException) {
      throw exception;
    }
    this.logger.error(
      `agent-gateway 未捕获异常（兜底 INTERNAL）：${
        exception instanceof Error
          ? `${exception.message}\n${exception.stack}`
          : String(exception)
      }`,
    );
    // 转为 HttpException 交给全局 AllExceptionsFilter 统一输出，
    // 保证有 requestId / traceId / retryable 等字段（2026-08-26 错误契约修复）
    throw new HttpException(
      { code: 'INTERNAL', message: '内部错误', retryable: false },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
