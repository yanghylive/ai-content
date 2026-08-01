import { RedfoxCallLogService } from './redfox-call-log.service';
import { RedfoxClientService } from './redfox-client.service';
import { RedfoxCostGuardService } from './redfox-cost-guard.service';
import { RedfoxInterfaceCatalogService } from './redfox-interface-catalog.service';
import { RedfoxService } from './redfox.service';
import { RedfoxSkillCatalogService } from './redfox-skill-catalog.service';

function makeConfig(values: Record<string, string | undefined> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function makePrisma() {
  const connections: any[] = [];
  const logs: any[] = [];
  return {
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    redfoxConnection: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          connections.find(
            (item) =>
              item.userId === where.userId &&
              (where.tenantId === undefined ||
                item.tenantId === where.tenantId),
          ) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `conn-${connections.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        connections.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = connections.findIndex((item) => item.id === where.id);
        connections[index] = {
          ...connections[index],
          ...data,
          updatedAt: new Date(),
        };
        return connections[index];
      }),
    },
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
    redfoxSkill: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    redfoxInterface: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({
        id: 'interface-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      update: jest.fn(async ({ data }: any) => ({
        id: 'interface-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
    },
  };
}

function makeService(values: Record<string, string | undefined> = {}) {
  const config = makeConfig(values);
  const prisma = makePrisma();
  const callLogs = new RedfoxCallLogService(prisma as any);
  const costGuard = new RedfoxCostGuardService(config as any, callLogs);
  const client = new RedfoxClientService(callLogs, costGuard);
  const catalog = new RedfoxSkillCatalogService(prisma as any);
  const interfaces = new RedfoxInterfaceCatalogService(prisma as any);
  return {
    service: new RedfoxService(
      config as any,
      prisma as any,
      client,
      catalog,
      interfaces,
      callLogs,
      costGuard,
    ),
    callLogs,
    prisma,
  };
}

describe('RedfoxService', () => {
  it('shows an explicit missing-key connection state by default', async () => {
    const { service } = makeService();

    await expect(service.getConnection()).resolves.toEqual(
      expect.objectContaining({
        configured: false,
        apiKeyMasked: null,
        apiKeySource: 'missing',
        status: 'missing_key',
        timeoutMs: 60000,
        lastError: '系统数据服务暂未开通，请联系管理员处理。',
      }),
    );
  });

  it('persists connection config without exposing the raw API key', async () => {
    const { service, prisma } = makeService();

    const connection = await service.saveConnection(undefined, {
      baseUrl: 'https://redfox.hk/',
      apiKey: 'rf-test-secret-1234567890',
      timeoutMs: 15000,
    });

    expect(connection).toEqual(
      expect.objectContaining({
        baseUrl: 'https://redfox.hk',
        configured: true,
        apiKeySource: 'saved',
        apiKeyMasked: 'rf-t...7890',
        status: 'untested',
        timeoutMs: 15000,
      }),
    );
    const saved = prisma.redfoxConnection.create.mock.calls[0][0].data;
    expect(saved.apiKeyEncrypted).not.toBe('rf-test-secret-1234567890');
    expect(saved.apiKeyMasked).toBe('rf-t...7890');
  });

  it('keeps connection test errors clear when no API key is configured', async () => {
    const { service } = makeService();

    await expect(service.testConnection()).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REDFOX_API_KEY_REQUIRED',
        message: '系统数据服务暂未开通，请联系管理员处理。',
      }),
    });

    await expect(service.getConnection()).resolves.toEqual(
      expect.objectContaining({
        status: 'failed',
        lastError: '系统数据服务暂未开通，请联系管理员处理。',
      }),
    );
  });
});
