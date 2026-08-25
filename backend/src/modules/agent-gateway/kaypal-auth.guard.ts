import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, requireAuth } from './core/auth';
import { AppError } from './core/types';
import { errorSpec, makeError } from './contracts/error-codes';
import { PrismaService } from '../../prisma/prisma.service';

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
 *
 * 4.4 多工作区标签壳：可选地从 x-workspace-id header 读 workspaceId 并注入 ctx。
 * 校验：workspace 必须存在且 userId 匹配 ctx.userId，否则 403（避免误用他人 workspaceId）。
 * 无 PrismaService（旧环境/测试）时跳过校验，纯透传——只检查格式非空。
 */
@Injectable()
export class KaypalAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.header('authorization') ?? req.header('x-kaypal-ctx');
    try {
      const ctx = await requireAuth(this.auth, token);
      const workspaceId = req.header('x-workspace-id');
      if (workspaceId) {
        const verified = await this.verifyWorkspace(ctx.userId, workspaceId);
        if (!verified.ok) {
          throw toHttpException(
            makeError('FORBIDDEN', {
              details: {
                workspaceId,
                reason: verified.reason,
                message: 'workspace 不属于当前用户',
              },
            }),
          );
        }
        if (verified.workspaceId) {
          (ctx as { workspaceId?: string }).workspaceId = verified.workspaceId;
        }
      }
      (req as { ctx?: import('./core/types').TenantContext }).ctx = ctx;
      return true;
    } catch (e) {
      if (isAppErrorLike(e)) throw toHttpException(e);
      throw e;
    }
  }

  private async verifyWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<{ ok: boolean; workspaceId?: string; reason?: string }> {
    if (!this.prisma)
      return { ok: true, workspaceId, reason: 'no-prisma-skip-verify' };
    try {
      const ws = await this.prisma.workspace.findFirst({
        where: { id: workspaceId, userId, status: 'active' },
        select: { id: true },
      });
      if (!ws) return { ok: false, reason: 'workspace 不存在或不属于当前用户' };
      return { ok: true, workspaceId: ws.id };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
}
