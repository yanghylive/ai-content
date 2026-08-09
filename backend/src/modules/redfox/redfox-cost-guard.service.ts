import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { QueryRedfoxCallLogsDto } from './dto/query-redfox-call-logs.dto';
import { RedfoxCallLogService } from './redfox-call-log.service';
import {
  RedfoxCostSummary,
  RedfoxEffectiveConnection,
  RedfoxScope,
} from './redfox.types';

const DEFAULT_DAILY_USER_LIMIT = 0;
const DEFAULT_DAILY_TENANT_LIMIT = 0;
const DEFAULT_HIGH_COST_CONFIRM_THRESHOLD = 0;

@Injectable()
export class RedfoxCostGuardService {
  constructor(private readonly callLogs: RedfoxCallLogService) {}

  async assertWithinLimits(
    scope: RedfoxScope,
    _connection: RedfoxEffectiveConnection,
    estimatedCostPoints = 1,
    _options: { confirmHighCost?: boolean } = {},
  ) {
    const [userCalls, tenantCalls] = await Promise.all([
      this.callLogs.countTodayForUser(scope),
      this.callLogs.countTodayForTenant(scope),
    ]);
    const dailyUserLimit =
      _connection.dailyUserLimit || DEFAULT_DAILY_USER_LIMIT;
    const dailyTenantLimit =
      _connection.dailyTenantLimit || DEFAULT_DAILY_TENANT_LIMIT;
    const highCostConfirmThreshold =
      _connection.highCostConfirmThreshold ||
      DEFAULT_HIGH_COST_CONFIRM_THRESHOLD;

    const highCost =
      highCostConfirmThreshold > 0 &&
      estimatedCostPoints >= highCostConfirmThreshold;

    if (dailyUserLimit > 0 && userCalls >= dailyUserLimit) {
      throw new HttpException(
        {
          code: 'REDFOX_DAILY_USER_LIMIT_REACHED',
          message: `RedFox 今日用户调用次数已达上限 ${dailyUserLimit}`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (dailyTenantLimit > 0 && tenantCalls >= dailyTenantLimit) {
      throw new HttpException(
        {
          code: 'REDFOX_DAILY_TENANT_LIMIT_REACHED',
          message: `RedFox 今日租户调用次数已达上限 ${dailyTenantLimit}`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return {
      estimatedCostPoints: Math.max(0, estimatedCostPoints),
      highCost,
      userCalls,
      tenantCalls,
      dailyUserLimit,
      dailyTenantLimit,
      highCostConfirmThreshold,
    };
  }

  async getSummary(
    scope: RedfoxScope,
    connection: RedfoxEffectiveConnection,
    query: Pick<QueryRedfoxCallLogsDto, 'from' | 'to'> = {},
  ): Promise<RedfoxCostSummary> {
    const logs = await this.callLogs.listForSummary(scope, query);
    const [userCalls, tenantCalls] = await Promise.all([
      this.callLogs.countTodayForUser(scope),
      this.callLogs.countTodayForTenant(scope),
    ]);
    const totalLatency = logs.reduce((sum, item) => sum + item.latencyMs, 0);
    const byStatus = logs.reduce<Record<string, number>>((map, item) => {
      map[item.status] = (map[item.status] || 0) + 1;
      return map;
    }, {});
    const skillMap = new Map<
      string,
      { skillCode: string; calls: number; costPoints: number; failures: number }
    >();

    for (const item of logs) {
      const skillCode = item.skillCode || 'unknown';
      const current =
        skillMap.get(skillCode) ||
        ({ skillCode, calls: 0, costPoints: 0, failures: 0 } as const);
      skillMap.set(skillCode, {
        skillCode,
        calls: current.calls + 1,
        costPoints: current.costPoints + item.costPoints,
        failures: current.failures + (item.status === 'failed' ? 1 : 0),
      });
    }

    return {
      range: {
        from: query.from || null,
        to: query.to || null,
      },
      totalCalls: logs.length,
      successCalls: byStatus.success || 0,
      failedCalls: byStatus.failed || 0,
      blockedCalls: byStatus.blocked || 0,
      totalCostPoints: logs.reduce((sum, item) => sum + item.costPoints, 0),
      averageLatencyMs: logs.length
        ? Math.round(totalLatency / logs.length)
        : 0,
      todayUsage: {
        userCalls,
        tenantCalls,
        dailyUserLimit: connection.dailyUserLimit,
        dailyTenantLimit: connection.dailyTenantLimit,
      },
      byStatus,
      bySkill: Array.from(skillMap.values()).sort(
        (left, right) => right.costPoints - left.costPoints,
      ),
    };
  }

  readDefaultDailyUserLimit() {
    return DEFAULT_DAILY_USER_LIMIT;
  }

  readDefaultDailyTenantLimit() {
    return DEFAULT_DAILY_TENANT_LIMIT;
  }

  readDefaultHighCostConfirmThreshold() {
    return DEFAULT_HIGH_COST_CONFIRM_THRESHOLD;
  }
}
