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
import { AuthService } from './core/auth';

/**
 * Agent Gateway 模块（3010×Octop 核心引擎 Nest 接线，首批）。
 * 注册 AgentGatewayModule 即挂载 /api/agent/* 控制面 + /api/memory/* 记忆控制面；
 * WS 由 main.ts 在 listen 前 attach。
 */
@Module({
  controllers: [AgentGatewayController, AgentMemoryController],
  providers: [
    AgentGatewayService,
    KaypalAuthGuard,
    AgentGatewayExceptionFilter,
    PrismaIdempotencyStore,
    PrismaApprovalStore,
    PrismaUsageSink,
    {
      provide: AuthService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('AGENT_GATEWAY_SECRET');
        if (secret) return new AuthService(secret);
        // P1-2：生产环境缺密钥 → 启动失败；开发/test 用 dev 默认（受控部署）
        const env = process.env.NODE_ENV ?? '';
        if (env === 'production') {
          throw new Error('AGENT_GATEWAY_SECRET 未配置：生产环境禁止使用默认密钥');
        }
        return new AuthService('dev-only-secret-do-not-use-in-prod');
      },
    },
  ],
  exports: [AgentGatewayService, AuthService],
})
export class AgentGatewayModule {}
