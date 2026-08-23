import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentGatewayController } from './agent-gateway.controller';
import { AgentMemoryController } from './agent-memory.controller';
import { AgentGatewayService } from './agent-gateway.service';
import { KaypalAuthGuard } from './kaypal-auth.guard';
import { AgentGatewayExceptionFilter } from './agent-gateway.filter';
import { PrismaIdempotencyStore } from './prisma-store/prisma-idempotency.store';
import { PrismaApprovalStore } from './prisma-store/prisma-approval.store';
import { PrismaUsageSink } from './prisma-store/prisma-usage.sink';
import { PrismaMirror } from './prisma-store/prisma-mirror';
import { PrismaHydrator } from './prisma-store/prisma-hydrator';
import { PrismaOutboxStore } from './prisma-store/prisma-outbox.store';
import { AuthService } from './core/auth';

/**
 * Agent Gateway 模块（3010×Octop 核心引擎 Nest 接线，首批）。
 * 注册 AgentGatewayModule 即挂载 /api/agent/* 控制面 + /api/memory/* 记忆控制面；
 * WS 由 main.ts 在 listen 前 attach。
 */
/**
 * 密钥解析（与原型 requireSecret 严格策略一致，P1）：
 * 仅显式开发/测试环境（NODE_ENV=development|test|dev）允许默认密钥；
 * production / staging / 未设置 NODE_ENV 等一切其他情况，缺 AGENT_GATEWAY_SECRET → 启动失败。
 */
export function resolveAgentSecret(config: ConfigService): string {
  const secret = config.get<string>('AGENT_GATEWAY_SECRET');
  if (secret) return secret;
  const env = process.env.NODE_ENV ?? '';
  const devLike = env === 'development' || env === 'test' || env === 'dev';
  if (!devLike) {
    throw new Error('AGENT_GATEWAY_SECRET 未配置：非开发环境禁止使用默认密钥');
  }
  return 'dev-only-secret-do-not-use-in-prod';
}

@Module({
  controllers: [AgentGatewayController, AgentMemoryController],
  providers: [
    AgentGatewayService,
    KaypalAuthGuard,
    AgentGatewayExceptionFilter,
    PrismaIdempotencyStore,
    PrismaApprovalStore,
    PrismaUsageSink,
    PrismaMirror,
    PrismaHydrator,
    PrismaOutboxStore,
    {
      provide: AuthService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AuthService(resolveAgentSecret(config), {
          // P0-2：Kaypal 正式 access_token 验证（kaypal.cn /api/auth/me）
          baseUrl: config.get<string>('KAYPAL_AUTH_BASE_URL')?.trim() || 'https://kaypal.cn',
          apiKey:
            config.get<string>('KAYPAL_BILLING_API_KEY')?.trim() ||
            config.get<string>('KAYPAL_API_KEY')?.trim() ||
            '',
        }),
    },
  ],
  exports: [AgentGatewayService, AuthService],
})
export class AgentGatewayModule {}
