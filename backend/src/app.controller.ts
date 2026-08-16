import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './modules/auth/auth.decorator';
import { RequireKaypalRoles } from './modules/auth/roles.decorator';
import { AgentWakerService } from './modules/agentwaker/agentwaker.service';
import { TaskQueueProcessor } from './modules/runtime/task-queue-processor.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly agentWakerService: AgentWakerService,
    private readonly taskQueueProcessor: TaskQueueProcessor,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  async getHealth() {
    const database = await this.checkDatabase();
    const agentWaker = this.checkAgentWaker();
    const taskQueue = this.taskQueueProcessor.getHealth();
    const ok = database.ok && agentWaker.ok && taskQueue.ok;

    // P2-4：对外只暴露存活状态，不暴露 database/growth/taskQueue 等内部运行态
    return {
      ok,
      ready: ok,
      service: 'ai-content-backend',
      timestamp: new Date().toISOString(),
    };
  }

  /** 运维诊断（仅平台管理员）：返回各组件的详细检查结果 */
  @RequireKaypalRoles('admin', 'owner')
  @Get('ops/diagnostics')
  async getDiagnostics() {
    const database = await this.checkDatabase();
    const agentWaker = this.checkAgentWaker();
    const growthExecution = this.checkGrowthExecution();
    const taskQueue = this.taskQueueProcessor.getHealth();
    return {
      ok: database.ok && agentWaker.ok && taskQueue.ok,
      timestamp: new Date().toISOString(),
      checks: { database, agentWaker, growthExecution, taskQueue },
    };
  }

  @Public()
  @Get('health/ready')
  async getReadiness() {
    const health = await this.getHealth();
    if (!health.ready) {
      throw new ServiceUnavailableException({
        code: 'HEALTH_GATE_BLOCKED',
        message: '运行健康门禁未通过，请检查数据库连接和 AgentWaker 角色包。',
      });
    }
    return health;
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { ok: true, status: 'connected' as const };
    } catch {
      return { ok: false, status: 'unavailable' as const };
    }
  }

  private checkAgentWaker() {
    try {
      const health = this.agentWakerService.getRolePackageHealth();
      return {
        ...health,
        status: health.ok ? ('available' as const) : ('missing' as const),
      };
    } catch {
      return {
        ok: false,
        status: 'unavailable' as const,
        roles: [],
      };
    }
  }

  private checkGrowthExecution() {
    const enabled = process.env.GROWTH_EXECUTION_ENABLED === 'true';
    const schedulerDaemonEnabled =
      process.env.GROWTH_SCHEDULER_DAEMON === 'true';
    const realDaemonAllowed =
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED === 'true';
    return {
      ok: true,
      enabled,
      value: process.env.GROWTH_EXECUTION_ENABLED || 'missing',
      schedulerDaemonEnabled,
      realDaemonAllowed,
      schedulerArmed: enabled && schedulerDaemonEnabled && realDaemonAllowed,
      status: enabled ? ('enabled' as const) : ('disabled' as const),
      safetyStatus: enabled
        ? ('manual-execution-open' as const)
        : ('closed' as const),
    };
  }
}
