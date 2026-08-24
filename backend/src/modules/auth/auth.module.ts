import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { KaypalAuthClient } from './kaypal-auth.client';
// 4.4 多工作区标签壳：前端会话 → kaypal 令牌桥接，复用 agent-gateway 的 HMAC AuthService（同密钥）
import { AuthService as AgentGatewayAuthService } from '../agent-gateway/core/auth';
import { resolveAgentSecret } from '../agent-gateway/agent-gateway.module';
import { WorkspaceTokenController } from './workspace-token.controller';
// 双工作区方案：桌面端连接本机 Octop 的拉起端点，复用 KaypalOctopBridge 取 Octop 服务令牌
import { KaypalOctopBridge } from '../agent-gateway/kaypal-octop-bridge';
import { OctopLaunchController } from './octop-launch.controller';
import { KaypalDesktopAuthController } from './kaypal-desktop-auth.controller';
import { KaypalProfileController } from './kaypal-profile.controller';
import { KaypalPermissionGuard } from './permission.guard';
import { PlanGuard } from './plan.guard';
import { RiskPolicyController } from './risk-policy.controller';
import { RiskPolicyService } from './risk-policy.service';

@Module({
  imports: [PrismaModule, EntitlementsModule],
  controllers: [
    AuthController,
    KaypalDesktopAuthController,
    KaypalProfileController,
    RiskPolicyController,
    WorkspaceTokenController,
    OctopLaunchController,
  ],
  providers: [
    AuthService,
    KaypalAuthClient,
    RiskPolicyService,
    CredentialEnvelopeService,
    // 双工作区方案：为 OctopLaunchController 提供 KaypalOctopBridge（取 Octop 服务令牌）
    KaypalOctopBridge,
    // 4.4 多工作区标签壳：与 agent-gateway 同密钥的 HMAC AuthService，仅用于为前端签发 kaypal 令牌
    {
      provide: 'AGENT_GATEWAY_AUTH_SERVICE',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AgentGatewayAuthService(resolveAgentSecret(config), {
          baseUrl:
            config.get<string>('KAYPAL_AUTH_BASE_URL')?.trim() ||
            'https://kaypal.cn',
          apiKey:
            config.get<string>('KAYPAL_BILLING_API_KEY')?.trim() ||
            config.get<string>('KAYPAL_API_KEY')?.trim() ||
            '',
        }),
    },
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
