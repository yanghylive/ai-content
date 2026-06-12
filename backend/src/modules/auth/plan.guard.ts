import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { KAYPAL_PLANS_KEY } from './roles.decorator';
import { isKaypalPlanAtLeast, normalizeKaypalPlan } from './plan-order';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPlans = this.reflector.getAllAndOverride<string[]>(
      KAYPAL_PLANS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPlans || requiredPlans.length === 0) return true;

    if (this.allowLocalPlanBypass()) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const userPlan = normalizeKaypalPlan(req.kaypalPlan);
    const planExpired = req.kaypalPlanExpired;

    if (planExpired) {
      throw new ForbiddenException(
        `套餐已过期，请续费后使用此功能。当前套餐：${userPlan}`,
      );
    }

    const hasAccess = requiredPlans.some((plan) =>
      isKaypalPlanAtLeast(userPlan, plan),
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        `此功能需要 ${requiredPlans.join(' / ')} 套餐。当前套餐：${userPlan}，请升级后使用。`,
      );
    }
    return true;
  }

  private allowLocalPlanBypass() {
    return this.config.get<string>('KAYPAL_ALLOW_LOCAL_PLAN_BYPASS') === 'true';
  }
}
