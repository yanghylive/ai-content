import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KAYPAL_ROLES_KEY } from './roles.decorator';

@Injectable()
export class KaypalPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      KAYPAL_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<{
      kaypalRole?: string;
      kaypalPlatformRole?: string;
      authUser?: { role?: string } | null;
    }>();
    const adminRole = req.kaypalRole;
    const platformRole = req.kaypalPlatformRole;
    const role = req.authUser?.role;

    const hasRole = requiredRoles.some(
      (role) => role === adminRole || role === platformRole,
    );
    // 与 AuthGuard 角色校验对齐（auth.guard.ts）：SUPER_ADMIN 云角色
    // （kaypalRole / kaypalPlatformRole）与本地 super_admin 一并放行。
    const isSuperAdmin =
      adminRole === 'SUPER_ADMIN' ||
      platformRole === 'SUPER_ADMIN' ||
      role === 'super_admin';

    if (!hasRole && !isSuperAdmin) {
      throw new ForbiddenException(
        `此操作需要 ${requiredRoles.join(' / ')} 角色。当前管理角色：${adminRole || '无'}，业务角色：${platformRole || '无'}`,
      );
    }
    return true;
  }
}
