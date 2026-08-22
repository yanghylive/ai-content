import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { KAYPAL_PLANS_KEY } from './roles.decorator';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { AuthenticatedUser } from './auth.types';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlans = this.reflector.getAllAndOverride<string[]>(
      KAYPAL_PLANS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPlans || requiredPlans.length === 0) return true;

    if (this.allowLocalPlanBypass()) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      authUser?: AuthenticatedUser | null;
    }>();
    const result = await this.entitlements.meetsAnyPlanForUser(
      req.authUser,
      requiredPlans,
    );
    const userPlan = result.entitlement.plan;

    if (result.reason === 'expired') {
      throw new ForbiddenException(
        `套餐已过期，请续费后使用此功能。当前套餐：${userPlan}`,
      );
    }

    if (result.reason === 'missing-commercial-entitlement') {
      throw new ForbiddenException(
        `缺少有效商用授权，请登录 Kaypal 订阅账号或启用受控本地商用授权后使用此功能。当前套餐：${userPlan}`,
      );
    }

    if (!result.ok) {
      throw new ForbiddenException(
        `此功能需要 ${requiredPlans.join(' / ')} 套餐。当前套餐：${userPlan}，请升级后使用。`,
      );
    }
    return true;
  }

  /**
   * P1（P5 门禁 2026-08-22）：本地套餐门禁旁路只在开发环境生效——
   * 仅检查环境变量会导致生产配置误继承后**所有套餐门禁被绕过**。
   * 加双条件：bypass 开关 = true 且 NODE_ENV 为 development/test；
   * 生产（production/空→视为生产）一律走真实授权检查。
   */
  private allowLocalPlanBypass() {
    if (this.config.get<string>('KAYPAL_ALLOW_LOCAL_PLAN_BYPASS') !== 'true') {
      return false;
    }
    const nodeEnv = (process.env.NODE_ENV ?? '').trim();
    return nodeEnv === 'development' || nodeEnv === 'test';
  }
}
