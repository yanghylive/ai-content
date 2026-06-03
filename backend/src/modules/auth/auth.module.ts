import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { KaypalAuthClient } from './kaypal-auth.client';
import { KaypalDesktopAuthController } from './kaypal-desktop-auth.controller';
import { KaypalProfileController } from './kaypal-profile.controller';
import { KaypalPermissionGuard } from './permission.guard';
import { PlanGuard } from './plan.guard';
import { RiskPolicyController } from './risk-policy.controller';
import { RiskPolicyService } from './risk-policy.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AuthController,
    KaypalDesktopAuthController,
    KaypalProfileController,
    RiskPolicyController,
  ],
  providers: [
    AuthService,
    KaypalAuthClient,
    RiskPolicyService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PlanGuard,
    },
    {
      provide: APP_GUARD,
      useClass: KaypalPermissionGuard,
    },
  ],
  exports: [AuthService, KaypalAuthClient, RiskPolicyService],
})
export class AuthModule {}
