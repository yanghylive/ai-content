import { NotFoundException } from '@nestjs/common';
import { PoiService } from './poi.service';

describe('PoiService', () => {
  let prisma: any;
  let service: PoiService;

  beforeEach(() => {
    const store: any[] = [];
    prisma = {
      poiStore: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `poi-${store.length + 1}`,
            status: 'active', // DB 层 @default("active")，mock 补默认
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          store.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) =>
          store.find((r) => r.id === where.id),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const idx = store.findIndex((r) => r.id === where.id);
          store[idx] = { ...store[idx], ...data };
          return store[idx];
        }),
        findMany: jest.fn(async ({ where, skip, take }: any) => {
          let rows = store.filter((r) => {
            for (const [k, v] of Object.entries(where ?? {})) {
              if (k === 'OR') continue;
              if (v !== undefined && (r as any)[k] !== v) return false;
            }
            return true;
          });
          if (where?.OR) {
            rows = rows.filter((r) =>
              (where.OR as any[]).some((cond) =>
                Object.entries(cond).every(([k, v]: any) => {
                  if (v && typeof v === 'object' && 'contains' in v) {
                    return String((r as any)[k] ?? '').includes(v.contains);
                  }
                  return (r as any)[k] === v;
                }),
              ),
            );
          }
          if (skip) rows = rows.slice(skip);
          if (take) rows = rows.slice(0, take);
          return rows;
        }),
        count: jest.fn(async ({ where }: any) =>
          store.filter((r) => {
            for (const [k, v] of Object.entries(where ?? {})) {
              if (k === 'OR') continue;
              if (v !== undefined && (r as any)[k] !== v) return false;
            }
            return true;
          }).length,
        ),
        delete: jest.fn(async ({ where }: any) => {
          const idx = store.findIndex((r) => r.id === where.id);
          store.splice(idx, 1);
          return { id: where.id };
        }),
        groupBy: jest.fn(async ({ by }: any) => []),
      },
    };
    const authContext = {
      get: () => ({ user: { id: 'user-1' } }),
      resolveTenantId: async () => 'tenant-1',
    };
    service = new PoiService(prisma, authContext as any);
  });

  it('create 校验空名称', async () => {
    await expect(
      service.create({
        tenantId: 't',
        userId: 'u',
        name: '  ',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create 成功并入库', async () => {
    const created = await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      name: '老王火锅',
      city: '成都',
      category: '餐饮',
    });
    expect(created.id).toBe('poi-1');
    expect(prisma.poiStore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '老王火锅',
        city: '成都',
        category: '餐饮',
      }),
    });
  });

  it('update 不存在抛 NotFound', async () => {
    await expect(
      service.update('missing', {
        tenantId: 't',
        userId: 'u',
        name: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list 支持分页过滤', async () => {
    await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      name: 'A店',
      city: '成都',
    });
    await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      name: 'B店',
      city: '重庆',
    });
    const result = await service.list({
      tenantId: 'tenant-1',
      userId: 'user-1',
      city: '成都',
    });
    expect(result.total).toBe(1);
    expect(result.rows[0].name).toBe('A店');
  });

  it('remove 不存在抛 NotFound，存在则删除', async () => {
    await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      name: '待删店',
    });
    const removed = await service.remove('poi-1', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(removed.deleted).toBe(true);
    await expect(
      service.remove('poi-1', { tenantId: 'tenant-1', userId: 'user-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('report 汇总总数/活跃/城市/分类', async () => {
    await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      name: '店A',
      city: '成都',
      category: '餐饮',
    });
    await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      name: '店B',
      city: '重庆',
      category: '美容',
    });
    prisma.poiStore.groupBy.mockImplementation(async ({ by }: any) => {
      if (by[0] === 'city') {
        return [
          { city: '成都', _count: { _all: 1 } },
          { city: '重庆', _count: { _all: 1 } },
        ];
      }
      return [
        { category: '餐饮', _count: { _all: 1 } },
        { category: '美容', _count: { _all: 1 } },
      ];
    });
    const report = await service.report({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(report.total).toBe(2);
    expect(report.active).toBe(2);
    expect(report.byCity).toHaveLength(2);
    expect(report.byCategory).toHaveLength(2);
  });
});
