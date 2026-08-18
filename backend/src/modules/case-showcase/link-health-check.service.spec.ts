import {
  computeHealthStatus,
  FAILURE_THRESHOLD,
  isExpired,
  LinkHealthCheckService,
  seedFailureCount,
  SLOW_RESPONSE_MS,
} from './link-health-check.service';

describe('link-health-check.service（链接健康度）', () => {
  describe('computeHealthStatus（状态机 healthy→warning→broken）', () => {
    const okProbe = { ok: true, httpStatus: 200, responseTimeMs: 100 };

    it('探测成功且无异常 → healthy，重置失败计数', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'warning',
          consecutiveFailures: 2,
          validUntil: null,
          probe: okProbe,
        }),
      ).toEqual({ healthStatus: 'healthy', consecutiveFailures: 0 });
    });

    it('第一次失败 → warning（计数 1）', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'healthy',
          consecutiveFailures: 0,
          validUntil: null,
          probe: { ok: false, error: 'dns' },
        }),
      ).toEqual({ healthStatus: 'warning', consecutiveFailures: 1 });
    });

    it('第二次失败 → 仍 warning（计数 2）', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'warning',
          consecutiveFailures: 1,
          validUntil: null,
          probe: { ok: false, error: 'timeout' },
        }),
      ).toEqual({ healthStatus: 'warning', consecutiveFailures: 2 });
    });

    it('连续失败达阈值 → broken', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'warning',
          consecutiveFailures: FAILURE_THRESHOLD - 1,
          validUntil: null,
          probe: { ok: false, error: 'timeout' },
        }),
      ).toEqual({
        healthStatus: 'broken',
        consecutiveFailures: FAILURE_THRESHOLD,
      });
    });

    it('超过阈值的失败持续保持 broken', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'broken',
          consecutiveFailures: FAILURE_THRESHOLD,
          validUntil: null,
          probe: { ok: false, error: 'timeout' },
        }),
      ).toEqual({
        healthStatus: 'broken',
        consecutiveFailures: FAILURE_THRESHOLD + 1,
      });
    });

    it('响应慢 → warning', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'healthy',
          consecutiveFailures: 0,
          validUntil: null,
          probe: {
            ok: true,
            httpStatus: 200,
            responseTimeMs: SLOW_RESPONSE_MS + 1,
          },
        }),
      ).toEqual({ healthStatus: 'warning', consecutiveFailures: 0 });
    });

    it('证书临近到期 → warning', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'healthy',
          consecutiveFailures: 0,
          validUntil: null,
          probe: {
            ok: true,
            httpStatus: 200,
            responseTimeMs: 100,
            certExpiringSoon: true,
          },
        }),
      ).toEqual({ healthStatus: 'warning', consecutiveFailures: 0 });
    });

    it('重定向到非白名单目标 → broken（高优先级风险）', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'healthy',
          consecutiveFailures: 0,
          validUntil: null,
          probe: { ok: false, redirectTargetUnsafe: true },
        }),
      ).toEqual({ healthStatus: 'broken', consecutiveFailures: 1 });
    });

    it('已过期 → expired（优先级最高）', () => {
      expect(
        computeHealthStatus({
          previousStatus: 'healthy',
          consecutiveFailures: 0,
          validUntil: new Date(Date.now() - 1000),
          probe: okProbe,
        }),
      ).toEqual({ healthStatus: 'expired', consecutiveFailures: 0 });
    });
  });

  describe('isExpired', () => {
    it('null/undefined 视为永久有效', () => {
      expect(isExpired(null)).toBe(false);
      expect(isExpired(undefined)).toBe(false);
    });
    it('过去时间 → 过期，未来时间 → 未过期', () => {
      expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
      expect(isExpired(new Date(Date.now() + 86400_000))).toBe(false);
    });
  });

  describe('seedFailureCount（进程重启后延续语义）', () => {
    it('broken 播种阈值、warning 播种 1、其余播种 0', () => {
      expect(seedFailureCount('broken')).toBe(FAILURE_THRESHOLD);
      expect(seedFailureCount('warning')).toBe(1);
      expect(seedFailureCount('healthy')).toBe(0);
      expect(seedFailureCount('unknown')).toBe(0);
      expect(seedFailureCount(null)).toBe(0);
    });
  });

  describe('checkAllEndpoints（遍历 + 状态回写）', () => {
    let service: LinkHealthCheckService;
    let prisma: {
      showcaseDemoEndpoint: {
        findMany: jest.Mock;
        update: jest.Mock;
      };
    };

    beforeEach(() => {
      prisma = {
        showcaseDemoEndpoint: {
          findMany: jest.fn(),
          update: jest.fn(),
        },
      };
      service = new LinkHealthCheckService(prisma as never);
      jest
        .spyOn(service, 'probeUrl')
        .mockResolvedValue({ ok: true, httpStatus: 200, responseTimeMs: 100 });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('遍历有 targetUrl 的端点并更新 healthStatus + lastCheckedAt', async () => {
      prisma.showcaseDemoEndpoint.findMany.mockResolvedValue([
        { id: 'ep-1', endpointType: 'web', targetUrl: 'https://a.com', healthStatus: 'unknown', validUntil: null },
        { id: 'ep-2', endpointType: 'wechat_mini_program', targetUrl: null, healthStatus: 'unknown', validUntil: null },
        { id: 'ep-3', endpointType: 'h5', targetUrl: 'https://b.com', healthStatus: 'healthy', validUntil: null },
      ]);
      prisma.showcaseDemoEndpoint.update.mockResolvedValue({});

      const summary = await service.checkAllEndpoints();

      expect(summary.checked).toBe(2);
      expect(summary.changed).toBe(1); // ep-1 unknown→healthy，ep-3 不变
      expect(prisma.showcaseDemoEndpoint.update).toHaveBeenCalledTimes(2);
      expect(prisma.showcaseDemoEndpoint.update).toHaveBeenCalledWith({
        where: { id: 'ep-1' },
        data: { healthStatus: 'healthy', lastCheckedAt: expect.any(Date) },
      });
      expect(prisma.showcaseDemoEndpoint.update).toHaveBeenCalledWith({
        where: { id: 'ep-3' },
        data: { healthStatus: 'healthy', lastCheckedAt: expect.any(Date) },
      });
    });

    it('连续失败跨多次调用推进 broken（进程内存计数器）', async () => {
      const endpoint = {
        id: 'ep-1',
        endpointType: 'web',
        targetUrl: 'https://a.com',
        healthStatus: 'healthy',
        validUntil: null,
      };
      prisma.showcaseDemoEndpoint.findMany.mockResolvedValue([endpoint]);
      prisma.showcaseDemoEndpoint.update.mockResolvedValue({});

      const failProbe = jest
        .spyOn(service, 'probeUrl')
        .mockResolvedValue({ ok: false, error: 'timeout' });

      const statuses: string[] = [];
      for (let i = 0; i < FAILURE_THRESHOLD + 1; i += 1) {
        await service.checkAllEndpoints();
        const call = prisma.showcaseDemoEndpoint.update.mock.calls[i][0];
        statuses.push(call.data.healthStatus);
      }

      // healthy → warning(1) → warning(2) → broken(3) → broken(4)
      expect(statuses).toEqual([
        'warning',
        'warning',
        'broken',
        'broken',
      ]);
      expect(failProbe).toHaveBeenCalledTimes(FAILURE_THRESHOLD + 1);
    });
  });
});
