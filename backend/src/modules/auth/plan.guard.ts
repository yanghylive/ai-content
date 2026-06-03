import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { KAYPAL_PLANS_KEY } from './roles.decorator';

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

    if (this.isLocalCommercialMode()) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const userPlan = req.kaypalPlan || 'FREE';
    const planExpired = req.kaypalPlanExpired;

    if (planExpired) {
      throw new ForbiddenException(
        `套餐已过期，请续费后使用此功能。当前套餐：${userPlan}`,
      );
    }

    const planOrder = [
      'FREE',
      'STUDY',
      'STANDARD',
      'PRO',
      'ADVANCED',
      'FLAGSHIP',
    ];
    const userPlanIndex = planOrder.indexOf(userPlan);

    const hasAccess = requiredPlans.some(
      (plan) => planOrder.indexOf(plan) <= userPlanIndex,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        `此功能需要 ${requiredPlans.join(' / ')} 套餐。当前套餐：${userPlan}，请升级后使用。`,
      );
    }
    return true;
  }

  private isLocalCommercialMode() {
    return (
      this.config.get<string>('LOCAL_ENGINE_PLAN_MODE') === 'commercial' ||
      this.config.get<string>('AI_CONTENT_PLAN') === 'commercial'
    );
  }
}
