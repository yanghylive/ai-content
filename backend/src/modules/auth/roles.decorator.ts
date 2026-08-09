import { SetMetadata } from '@nestjs/common';

export const KAYPAL_PLANS_KEY = 'kaypalPlans';
export const KAYPAL_ROLES_KEY = 'kaypalRoles';

export const RequirePlans = (...plans: string[]) =>
  SetMetadata(KAYPAL_PLANS_KEY, plans);
export const RequireKaypalRoles = (...roles: string[]) =>
  SetMetadata(KAYPAL_ROLES_KEY, roles);
