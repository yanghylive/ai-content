import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './modules/auth/auth.decorator';
import { AgentWakerService } from './modules/agentwaker/agentwaker.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly agentWakerService: AgentWakerService,
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
    const growthExecution = this.checkGrowthExecution();
    const taskQueue = this.checkTaskQueue();
    const ok = database.ok && agentWaker.ok;
    const ready = ok;

    return {
      ok,
      ready,
      service: 'ai-content-backend',
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
        publicDetails: {
          checks: health.checks,
          nextAction:
            '修复 checks 中状态为 false 的项目后重试 /api/health/ready。',
        },
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

  private checkTaskQueue() {
    const enabled = process.env.TASK_QUEUE_AUTOSTART !== 'false';
    const processExisting = process.env.TASK_QUEUE_PROCESS_EXISTING === 'true';
    const configuredTickMs = Number(process.env.TASK_QUEUE_TICK_MS || 2000);
    return {
      ok: true,
      enabled,
      processExisting,
      tickMs: Number.isFinite(configuredTickMs)
        ? Math.max(250, configuredTickMs)
        : 2000,
      status: enabled ? ('enabled' as const) : ('disabled' as const),
      safetyStatus: enabled ? ('new-tasks-only' as const) : ('closed' as const),
    };
  }
}
