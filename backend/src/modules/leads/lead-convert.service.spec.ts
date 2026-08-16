import { NotFoundException } from '@nestjs/common';
import { LeadConvertService } from './lead-convert.service';

const LEAD = (partial: Record<string, unknown> = {}) => ({
  id: 'lead-1',
  userId: 'u-1',
  tenantId: 'tenant-1',
  platform: 'douyin',
  sourceType: 'comment',
  nickname: '张三',
  externalUserId: 'ext-1',
  sourceUrl: 'https://douyin/item/1',
  sourceText: '怎么收费？',
  latestReply: null,
  profileUrl: null,
  score: 80,
  status: 'qualified',
  customerId: null,
  ...partial,
});

function makePrisma(overrides: Record<string, unknown> = {}) {
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn(tx);
  });
  const tx = {
    lead: {
      findFirst: jest.fn().mockResolvedValue(LEAD()),
      update: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'lead-1',
        ...data,
      })),
    },
    crmCustomer: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({
        id: 'cust-1',
        displayName: '张三',
        status: 'new',
      }),
      create: jest.fn().mockResolvedValue({
        id: 'cust-1',
        displayName: '张三',
        status: 'new',
      }),
      update: jest.fn().mockResolvedValue({
        id: 'cust-1',
        displayName: '张三',
        status: 'new',
      }),
    },
    crmTimelineEvent: {
      create: jest.fn().mockResolvedValue({ id: 'tl-1' }),
    },
    ...overrides,
  };
  const prisma = {
    $transaction: transaction,
    ...tx,
  };
  return { prisma, tx, transaction };
}

function makeService(prisma: unknown) {
  return new LeadConvertService(prisma as never);
}

describe('LeadConvertService', () => {
  it('事务内 建客户 + 写 timeline + 更新线索', async () => {
    const { prisma, tx } = makePrisma();
    const svc = makeService(prisma);

    const result = await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
    });

    expect(result.created).toBe(true);
    expect(result.customer.displayName).toBe('张三');
    expect(tx.crmTimelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'lead_converted',
          customerId: 'cust-1',
        }),
      }),
    );
    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'converted' }),
      }),
    );
  });

  it('已转客户（customerId 存在）→ 幂等返回，不重复建客户', async () => {
    const { prisma, tx } = makePrisma({
      lead: {
        findFirst: jest
          .fn()
          .mockResolvedValue(LEAD({ customerId: 'cust-1', status: 'converted' })),
        update: jest.fn(),
      },
      crmCustomer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cust-1',
          displayName: '张三',
          status: 'new',
        }),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const svc = makeService(prisma);

    const result = await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
    });

    expect(result.alreadyConverted).toBe(true);
    expect(result.created).toBe(false);
    expect(tx.crmTimelineEvent.create).not.toHaveBeenCalled();
  });

  it('线索不存在/越权 → 抛 404', async () => {
    const { prisma } = makePrisma({
      lead: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    });
    const svc = makeService(prisma);

    await expect(
      svc.convert({ leadId: 'lead-x', scope: { userId: 'u-1', tenantId: 'tenant-1' } }),
    ).rejects.toThrow(NotFoundException);
  });

  it('复用已有客户（同 dedupeKey）不重复创建', async () => {
    const { prisma, tx } = makePrisma({
      crmCustomer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cust-exists',
          displayName: '张三',
          status: 'contacting',
          sourceText: null,
          latestReply: null,
          score: 10,
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: 'cust-exists',
          displayName: '张三',
          status: 'contacting',
        }),
      },
    });
    const svc = makeService(prisma);

    const result = await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
    });

    expect(result.created).toBe(false);
    expect(tx.crmCustomer.create).not.toHaveBeenCalled();
    expect(tx.crmCustomer.update).toHaveBeenCalled();
  });
});
