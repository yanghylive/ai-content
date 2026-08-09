import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryRedfoxCallLogsDto } from './dto/query-redfox-call-logs.dto';
import {
  RedfoxCallLog,
  RedfoxCallLogInput,
  RedfoxListResult,
  RedfoxScope,
} from './redfox.types';

@Injectable()
export class RedfoxCallLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RedfoxCallLogInput): Promise<RedfoxCallLog> {
    const created = await this.prisma.redfoxCallLog.create({
      data: {
        tenantId: input.scope.tenantId || null,
        userId: input.scope.userId,
        endpoint: input.endpoint,
        method: input.method,
        skillCode: input.skillCode,
        status: input.status,
        costPoints: input.costPoints,
        latencyMs: input.latencyMs,
        requestHash: input.requestHash,
        httpStatus: input.responseStatus,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        requestSummary: input.operation
          ? ({ operation: input.operation } satisfies Prisma.JsonObject)
          : undefined,
        responseSummary: input.responseStatus
          ? ({ status: input.responseStatus } satisfies Prisma.JsonObject)
          : undefined,
        endedAt: new Date(),
      },
    });

    return this.toCallLog(created);
  }

  async list(
    scope: RedfoxScope,
    query: QueryRedfoxCallLogsDto = {},
  ): Promise<RedfoxListResult<RedfoxCallLog>> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    const where = this.buildWhere(scope, query);
    const [items, total] = await Promise.all([
      this.prisma.redfoxCallLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.redfoxCallLog.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toCallLog(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listForSummary(
    scope: RedfoxScope,
    query: Pick<QueryRedfoxCallLogsDto, 'from' | 'to'> = {},
  ): Promise<RedfoxCallLog[]> {
    const logs = await this.prisma.redfoxCallLog.findMany({
      where: this.buildSummaryWhere(scope, query),
      orderBy: { startedAt: 'desc' },
      take: 5000,
    });
    return logs.map((item) => this.toCallLog(item));
  }

  async countTodayForUser(scope: RedfoxScope) {
    return this.prisma.redfoxCallLog.count({
      where: {
        userId: scope.userId,
        startedAt: { gte: this.startOfToday() },
        status: { not: 'blocked' },
      },
    });
  }

  async countTodayForTenant(scope: RedfoxScope) {
    if (!scope.tenantId) {
      return this.countTodayForUser(scope);
    }
    return this.prisma.redfoxCallLog.count({
      where: {
        tenantId: scope.tenantId,
        startedAt: { gte: this.startOfToday() },
        status: { not: 'blocked' },
      },
    });
  }

  private buildWhere(scope: RedfoxScope, query: QueryRedfoxCallLogsDto) {
    const where: Prisma.RedfoxCallLogWhereInput = {
      AND: [this.scopeWhere(scope)],
    };
    if (query.status) where.status = query.status;
    if (query.skillCode?.trim()) {
      where.skillCode = { equals: query.skillCode.trim() };
    }
    if (query.endpoint?.trim()) {
      where.endpoint = { contains: query.endpoint.trim() };
    }
    const range = this.timeRange(query.from, query.to);
    if (range) where.startedAt = range;
    return where;
  }

  private buildSummaryWhere(
    scope: RedfoxScope,
    query: Pick<QueryRedfoxCallLogsDto, 'from' | 'to'>,
  ) {
    const where: Prisma.RedfoxCallLogWhereInput = {
      AND: [
        scope.tenantId
          ? { tenantId: scope.tenantId }
          : { userId: scope.userId },
      ],
    };
    const range = this.timeRange(query.from, query.to);
    if (range) where.startedAt = range;
    return where;
  }

  private scopeWhere(scope: RedfoxScope): Prisma.RedfoxCallLogWhereInput {
    if (scope.tenantId) {
      return {
        OR: [
          { tenantId: scope.tenantId },
          { userId: scope.userId, tenantId: null },
        ],
      };
    }
    return { userId: scope.userId };
  }

  private timeRange(from?: string, to?: string) {
    const gte = this.toDate(from);
    const lte = this.toDate(to);
    if (!gte && !lte) return null;
    return {
      ...(gte ? { gte } : {}),
      ...(lte ? { lte } : {}),
    };
  }

  private toDate(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private startOfToday() {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private toCallLog(
    item: Prisma.RedfoxCallLogGetPayload<object>,
  ): RedfoxCallLog {
    const operation =
      this.readStringFromJson(item.requestSummary, 'operation') ||
      'redfox.request';
    return {
      id: item.id,
      scopeKey: `${item.tenantId || item.userId}:${item.userId}`,
      userId: item.userId,
      tenantId: item.tenantId || item.userId,
      endpoint: item.endpoint,
      method: item.method,
      operation,
      skillCode: item.skillCode,
      status: item.status as RedfoxCallLog['status'],
      costPoints: item.costPoints,
      latencyMs: item.latencyMs || 0,
      requestHash: item.requestHash || '',
      responseStatus: item.httpStatus,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      createdAt: item.startedAt.toISOString(),
    };
  }

  private readStringFromJson(value: Prisma.JsonValue | null, key: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const record = value as Record<string, unknown>;
    return typeof record[key] === 'string' ? String(record[key]) : '';
  }
}
