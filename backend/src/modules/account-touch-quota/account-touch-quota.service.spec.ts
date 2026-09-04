import { AccountTouchQuotaService } from './account-touch-quota.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AccountTouchQuotaService', () => {
  let service: AccountTouchQuotaService;
  let prisma: {
    $executeRaw: jest.Mock;
    publishAccount: { findFirst: jest.Mock };
    accountTouchQuota: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $executeRaw: jest.fn(),
      publishAccount: { findFirst: jest.fn() },
      accountTouchQuota: { findUnique: jest.fn() },
    };
    service = new AccountTouchQuotaService(prisma as unknown as PrismaService);
  });

  describe('tryConsume', () => {
    it('首次扣减：INSERT 桶 + 条件自增 affectedRows===1 → 成功', async () => {
      // 第一次调用是 INSERT ON CONFLICT DO NOTHING，第二次是条件 UPDATE
      prisma.$executeRaw
        .mockResolvedValueOnce(0) // INSERT
        .mockResolvedValueOnce(1); // UPDATE 影响 1 行
      const ok = await service.tryConsume('u1', 'douyin', 'stable-id', 20);
      expect(ok).toBe(true);
      // 验证两次都调用，且 UPDATE 带 touch_count < daily_limit 条件
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('额度用尽：条件自增 affectedRows===0 → 拦截（false）', async () => {
      prisma.$executeRaw
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0); // UPDATE 影响 0 行 = 已到上限
      const ok = await service.tryConsume('u1', 'douyin', 'stable-id', 20);
      expect(ok).toBe(false);
    });

    it('dailyLimit 默认 20，可传自定义上限', async () => {
      prisma.$executeRaw
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      const ok = await service.tryConsume('u1', 'douyin', 'stable-id', 50);
      expect(ok).toBe(true);
    });
  });

  describe('resolveStableId', () => {
    it('stableId 精确匹配返回 publishAccount.id', async () => {
      prisma.publishAccount.findFirst.mockResolvedValue({
        id: 'local-engine-xxx-6-douyin',
      });
      const id = await service.resolveStableId(
        'local-engine-xxx-6-douyin',
        { tenantId: null, userId: 'u1' },
        'douyin',
      );
      expect(id).toBe('local-engine-xxx-6-douyin');
    });

    it('纯数字 id 按平台后缀匹配', async () => {
      prisma.publishAccount.findFirst.mockResolvedValue({
        id: 'local-engine-xxx-6-douyin',
      });
      const id = await service.resolveStableId(
        '6',
        { tenantId: null, userId: 'u1' },
        'douyin',
      );
      expect(id).toBe('local-engine-xxx-6-douyin');
      // 应带 endsWith 后缀匹配条件
      const where = prisma.publishAccount.findFirst.mock.calls[0][0].where;
      expect(where.OR).toBeDefined();
    });

    it('账号不存在抛错', async () => {
      prisma.publishAccount.findFirst.mockResolvedValue(null);
      await expect(
        service.resolveStableId(
          '999',
          { tenantId: null, userId: 'u1' },
          'douyin',
        ),
      ).rejects.toThrow('发布账号不存在或无权操作');
    });
  });

  describe('getTodayUsage', () => {
    it('无记录时返回默认上限 20、计数 0', async () => {
      prisma.accountTouchQuota.findUnique.mockResolvedValue(null);
      const usage = await service.getTodayUsage('u1', 'douyin', 'stable-id');
      expect(usage).toEqual(
        expect.objectContaining({ dailyLimit: 20, touchCount: 0 }),
      );
    });

    it('有记录时返回落库值', async () => {
      prisma.accountTouchQuota.findUnique.mockResolvedValue({
        dailyLimit: 50,
        touchCount: 12,
        touchDate: service['today'](),
      });
      const usage = await service.getTodayUsage('u1', 'douyin', 'stable-id');
      expect(usage).toEqual(
        expect.objectContaining({ dailyLimit: 50, touchCount: 12 }),
      );
    });
  });
});
