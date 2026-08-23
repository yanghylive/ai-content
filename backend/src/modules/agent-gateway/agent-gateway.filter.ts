import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { isAppErrorLike, toHttpException } from './kaypal-auth.guard';

/**
 * agent-gateway 契约错误过滤器（controller 级）：
 * 捕获 handler 抛出的 AppError，转为 HttpException 交给全局 AllExceptionsFilter 统一输出
 * （与真实仓库 819 API 的错误格式一致：{success:false, message, code, ...}）。
 * guard 抛出的 AppError 已在 KaypalAuthGuard 内转换，直接走全局 filter。
 */
@Catch()
export class AgentGatewayExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (isAppErrorLike(exception)) {
      throw toHttpException(exception);
    }
    if (exception instanceof HttpException) {
      throw exception;
    }
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      data: null,
      message: '内部错误',
      code: 'INVALID_PLAN',
    });
  }
}
