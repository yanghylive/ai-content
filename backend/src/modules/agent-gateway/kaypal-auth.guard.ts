import { CanActivate, ExecutionContext, Injectable, HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, requireAuth } from './core/auth';
import { AppError } from './core/types';
import { errorSpec } from './contracts/error-codes';

/** 把契约 AppError 转成真实仓库全局格式的 HttpException（扁平 code/message，由全局 AllExceptionsFilter 统一输出） */
export function toHttpException(err: AppError): HttpException {
  return new HttpException(
    { code: err.code, message: err.message, publicDetails: err.details },
    errorSpec(err.code).httpStatus,
  );
}

export function isAppErrorLike(e: unknown): e is AppError {
  return !!e && typeof e === 'object' && 'code' in e && 'retryable' in e;
}

/**
 * Kaypal 身份守卫（agent-gateway 专用）：
 * 从 Authorization: Bearer <token> 或 x-kaypal-ctx（HMAC 签名令牌）解析 tenant/user/agent，
 * 挂到 request['ctx']。缺 token / 篡改 / 缺 exp → 转 HttpException(401) 由全局 filter 输出。
 */
@Injectable()
export class KaypalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.header('authorization') ?? req.header('x-kaypal-ctx');
    try {
      const ctx = requireAuth(this.auth, token);
      (req as { ctx?: import('./core/types').TenantContext }).ctx = ctx;
      return true;
    } catch (e) {
      if (isAppErrorLike(e)) throw toHttpException(e);
      throw e;
    }
  }
}
