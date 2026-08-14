import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { RedfoxCallLogService } from './redfox-call-log.service';
import { RedfoxClientService } from './redfox-client.service';
import type { RedfoxEffectiveConnection, RedfoxScope } from './redfox.types';

function makePrisma() {
  const logs: any[] = [];
  return {
    redfoxCallLog: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `log-${logs.length + 1}`,
          startedAt: new Date(),
          createdAt: new Date(),
          ...data,
        };
        logs.unshift(row);
        return row;
      }),
      findMany: jest.fn(async () => logs),
      count: jest.fn(async () => logs.length),
    },
  };
}

describe('RedfoxClientService', () => {
  const scope: RedfoxScope = {
    key: 'tenant-1:user-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
  };

  function makeConnection(
    overrides: Partial<RedfoxEffectiveConnection> = {},
  ): RedfoxEffectiveConnection {
    return {
      baseUrl: 'https://redfox.hk',
      apiKey: '',
      apiKeySource: 'missing',
      timeoutMs: 30000,
      enabled: true,
      dailyUserLimit: 200,
      dailyTenantLimit: 2000,
      highCostConfirmThreshold: 1,
      status: 'missing_key',
      lastTestAt: null,
      lastError: null,
      updatedAt: new Date(0).toISOString(),
      ...overrides,
    };
  }

  it('returns a clear missing-key error and records a failed call log', async () => {
    const prisma = makePrisma();
    const callLogs = new RedfoxCallLogService(prisma as any);
    const costGuard = { assertWithinLimits: jest.fn() };
    const client = new RedfoxClientService(callLogs, costGuard as any);

    await expect(
      client.request(scope, makeConnection(), {
        path: '/story/web/api/doc/platforms',
        operation: 'connection.test',
        estimatedCostPoints: 0,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(costGuard.assertWithinLimits).not.toHaveBeenCalled();
    const logs = (await callLogs.list(scope, { page: 1, limit: 10 })).items;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(
      expect.objectContaining({
        operation: 'connection.test',
        status: 'failed',
        errorCode: 'REDFOX_API_KEY_REQUIRED',
        errorMessage: '情报数据服务尚未配置，请到「设置」添加数据源后使用。',
      }),
    );
  });

  it('deducts Kaypal credits for billable intelligence calls after RedFox succeeds', async () => {
    const prisma = makePrisma();
    const callLogs = new RedfoxCallLogService(prisma as any);
    const costGuard = { assertWithinLimits: jest.fn() };
    const billing = {
      deductExternalDataCredits: jest.fn(async () => ({
        status: 'charged',
        amount: 80,
        transactionId: 'transaction-1',
        idempotencyKey: 'redfox-billing-1',
      })),
    };
    const client = new RedfoxClientService(
      callLogs,
      costGuard as any,
      billing as any,
    );
    const requestSpy = jest.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
      headers: { 'x-redfox-cost-points': '2' },
    } as any);

    await expect(
      client.request(scope, makeConnection({ apiKey: 'ak_live' }), {
        method: 'POST',
        path: '/story/api/dyData/searchArticle',
        operation: 'intelligence.search.manual',
        skillCode: 'douyin-ai-feed',
        estimatedCostPoints: 1,
        requireApiKey: true,
        body: { keyword: '装修' },
      }),
    ).resolves.toEqual({ ok: true });

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ak_live',
          'X-API-Key': 'ak_live',
          REDFOX_API_KEY: 'ak_live',
        }),
      }),
    );
    expect(billing.deductExternalDataCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'intelligence_redfox',
        taskType: 'redfox_external_data',
        amount: 2,
        metadata: expect.objectContaining({
          redfoxCostPoints: 2,
        }),
      }),
    );
    const logs = (await callLogs.list(scope, { page: 1, limit: 10 })).items;
    expect(logs[0]).toEqual(
      expect.objectContaining({
        status: 'success',
        costPoints: 80,
        skillCode: 'douyin-ai-feed',
      }),
    );
    requestSpy.mockRestore();
  });

  it('keeps insufficient-credit billing failures as a business error after RedFox succeeds', async () => {
    const prisma = makePrisma();
    const callLogs = new RedfoxCallLogService(prisma as any);
    const costGuard = { assertWithinLimits: jest.fn() };
    const billing = {
      deductExternalDataCredits: jest.fn(async () => {
        throw new HttpException(
          {
            code: 'INSUFFICIENT_CREDITS',
            message: '积分余额不足，请充值或调整任务消耗后再试。',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }),
    };
    const client = new RedfoxClientService(
      callLogs,
      costGuard as any,
      billing as any,
    );
    const requestSpy = jest.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
      headers: { 'x-redfox-cost-points': '80' },
    } as any);

    await expect(
      client.request(scope, makeConnection({ apiKey: 'ak_live' }), {
        method: 'POST',
        path: '/story/api/dyData/searchArticle',
        operation: 'intelligence.search.manual',
        skillCode: 'douyin-ai-feed',
        estimatedCostPoints: 1,
        requireApiKey: true,
        body: { keyword: '无人机' },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_CREDITS',
        message: '积分余额不足，请充值或调整任务消耗后再试。',
      }),
      status: 402,
    });

    expect(requestSpy).toHaveBeenCalled();
    const logs = (await callLogs.list(scope, { page: 1, limit: 10 })).items;
    expect(logs[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        costPoints: 0,
        errorCode: 'INSUFFICIENT_CREDITS',
        errorMessage: '积分余额不足，请充值或调整任务消耗后再试。',
      }),
    );
    requestSpy.mockRestore();
  });
});
