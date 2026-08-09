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
    }>();
    const adminRole = req.kaypalRole;
    const platformRole = req.kaypalPlatformRole;

    const hasRole = requiredRoles.some(
      (role) => role === adminRole || role === platformRole,
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `此操作需要 ${requiredRoles.join(' / ')} 角色。当前管理角色：${adminRole || '无'}，业务角色：${platformRole || '无'}`,
      );
    }
    return true;
  }
}
