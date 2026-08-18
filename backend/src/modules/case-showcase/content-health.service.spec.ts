import {
  ContentHealthService,
  daysUntil,
  expiryWindowOf,
} from './content-health.service';

const NOW = new Date('2026-08-18T00:00:00.000Z');
const DAY_MS = 24 * 3600 * 1000;

function iso(offsetDays: number): Date {
  return new Date(NOW.getTime() + offsetDays * DAY_MS);
}

describe('content-health 纯函数（30/7 天窗口判定）', () => {
  it('daysUntil：未来/过去日期返回正确自然日（向上取整，负值=逾期）', () => {
    expect(daysUntil(iso(0), NOW)).toBe(0);
    expect(daysUntil(iso(6), NOW)).toBe(6);
    expect(daysUntil(iso(30), NOW)).toBe(30);
    expect(daysUntil(iso(-1), NOW)).toBe(-1);
    expect(daysUntil(null, NOW)).toBe(0);
    expect(daysUntil('invalid', NOW)).toBe(0);
  });

  it('expiryWindowOf：0~7 → 7d，8~30 → 30d，越界/逾期 → null', () => {
    expect(expiryWindowOf(0)).toBe('7d');
    expect(expiryWindowOf(7)).toBe('7d');
    expect(expiryWindowOf(8)).toBe('30d');
    expect(expiryWindowOf(30)).toBe('30d');
    expect(expiryWindowOf(-1)).toBeNull();
    expect(expiryWindowOf(31)).toBeNull();
  });
});

describe('ContentHealthService', () => {
  function makeService(overrides: {
    showcaseAuthorization?: { findMany: jest.Mock };
    showcaseCase?: { findMany: jest.Mock };
    showcaseDemoEndpoint?: { findMany: jest.Mock };
  } = {}) {
    const prisma = {
      showcaseAuthorization: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      showcaseCase: { findMany: jest.fn().mockResolvedValue([]) },
      showcaseDemoEndpoint: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
    return { prisma, service: new ContentHealthService(prisma as never) };
  }

  it('checkAuthorizationExpiry：仅返回 30 天窗口内 approved 且未过期授权，按 7/30 分桶', async () => {
    const { service } = makeService({
      showcaseAuthorization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            caseId: 'c1',
            recordType: 'customer_authorization',
            grantor: '客户A',
            licenseName: null,
            validUntil: iso(5),
          },
          {
            id: 'a2',
            caseId: 'c2',
            recordType: 'oss_license',
            grantor: null,
            licenseName: 'MIT',
            validUntil: iso(20),
          },
          {
            id: 'a3',
            caseId: 'c3',
            recordType: 'customer_authorization',
            grantor: '客户B',
            licenseName: null,
            validUntil: iso(45), // 超 30 天窗口，应被查询层过滤（这里模拟已被过滤不返回）
          },
        ]),
      },
    });

    const result = await service.checkAuthorizationExpiry(NOW);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'a1', window: '7d', daysRemaining: 5 });
    expect(result[1]).toMatchObject({ id: 'a2', window: '30d', daysRemaining: 20 });
  });

  it('checkAuthorizationExpiry：已过期授权（daysRemaining<0）不计入提醒', async () => {
    const { service } = makeService({
      showcaseAuthorization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a4',
            caseId: 'c4',
            recordType: 'customer_authorization',
            grantor: '客户C',
            licenseName: null,
            validUntil: iso(-3),
          },
        ]),
      },
    });

    const result = await service.checkAuthorizationExpiry(NOW);
    expect(result).toHaveLength(0);
  });

  it('checkReviewDue：返回已逾期与 7 天内到期的已发布案例', async () => {
    const { service } = makeService({
      showcaseCase: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            slug: 'case-overdue',
            title: '已逾期案例',
            status: 'published',
            nextReviewAt: iso(-2),
            lastReviewedAt: iso(-92),
            ownerUserId: 'u1',
          },
          {
            id: 'c2',
            slug: 'case-soon',
            title: '临近复核',
            status: 'published',
            nextReviewAt: iso(6),
            lastReviewedAt: null,
            ownerUserId: null,
          },
        ]),
      },
    });

    const result = await service.checkReviewDue(NOW);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'c1', overdue: true, daysRemaining: -2 });
    expect(result[1]).toMatchObject({ id: 'c2', overdue: false, daysRemaining: 6 });
  });

  it('getDemoEndpointHealth：聚合健康度并列出异常入口与负责人', async () => {
    const { service } = makeService({
      showcaseDemoEndpoint: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e1',
            caseId: 'c1',
            endpointType: 'web',
            healthStatus: 'healthy',
            lastCheckedAt: iso(-1),
            ownerUserId: 'u1',
            case: { slug: 'case-a', title: '案例A' },
          },
          {
            id: 'e2',
            caseId: 'c2',
            endpointType: 'h5',
            healthStatus: 'broken',
            lastCheckedAt: iso(-1),
            ownerUserId: 'u2',
            case: { slug: 'case-b', title: '案例B' },
          },
          {
            id: 'e3',
            caseId: 'c3',
            endpointType: 'download',
            healthStatus: 'warning',
            lastCheckedAt: null,
            ownerUserId: null,
            case: { slug: 'case-c', title: '案例C' },
          },
        ]),
      },
    });

    const { summary, anomalies } = await service.getDemoEndpointHealth();
    expect(summary).toMatchObject({
      total: 3,
      healthy: 1,
      broken: 1,
      warning: 1,
      expired: 0,
      unknown: 0,
    });
    expect(anomalies).toHaveLength(2);
    expect(anomalies[0]).toMatchObject({
      endpointId: 'e2',
      caseTitle: '案例B',
      healthStatus: 'broken',
      ownerUserId: 'u2',
    });
  });
});
