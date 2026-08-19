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
    // Sprint 4 T4.1 新增依赖表
    domainEventOutbox: {
      create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    },
    interactionEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    crmCompany: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
    },
    crmOpportunity: {
      create: jest.fn().mockResolvedValue({ id: 'opp-1' }),
    },
    crmTask: {
      create: jest.fn().mockResolvedValue({ id: 'task-1' }),
    },
    crmNote: {
      create: jest.fn().mockResolvedValue({ id: 'note-1' }),
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
    // 未传 task → 默认建「跟进新客户」待办，让商户在 CRM 待办里看到新客户
    expect(tx.crmTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '跟进新客户：张三',
          customerId: 'cust-1',
        }),
      }),
    );
  });

  it('task 传 null → 不建默认待办', async () => {
    const { prisma, tx } = makePrisma();
    const svc = makeService(prisma);

    await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
      task: null,
    });

    expect(tx.crmTask.create).not.toHaveBeenCalled();
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

  it('T4.1：一步建 Company/Opportunity/Task/Note + 写 outbox + timeline 带归因链', async () => {
    const { prisma, tx } = makePrisma({
      lead: {
        findFirst: jest.fn().mockResolvedValue(
          LEAD({
            sourceArticleId: 'art-1',
            sourcePublishRecordId: 'pub-1',
            sourceInteractionEventId: 'ev-1',
          }),
        ),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'lead-1',
          ...data,
        })),
      },
      interactionEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ev-1',
          identityId: 'pid-1',
          platform: 'douyin',
          accountId: 'acc-1',
        }),
      },
    });
    const svc = makeService(prisma);

    const result = await svc.convert({
      leadId: 'lead-1',
      idempotencyKey: 'conv-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
      company: { name: '测试公司', industry: 'SaaS' },
      opportunity: { stage: 'qualified', expectedAmount: 10000 },
      task: { title: '跟进报价', dueAt: new Date('2026-09-01') },
      note: { body: '客户询问价格' },
    });

    expect(result.companyId).toBe('comp-1');
    expect(result.opportunityId).toBe('opp-1');
    expect(result.taskId).toBe('task-1');
    expect(result.noteId).toBe('note-1');
    expect(result.identityId).toBe('pid-1');
    expect(tx.crmCompany.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '测试公司' }),
      }),
    );
    expect(tx.crmOpportunity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stage: 'qualified',
          amountCents: 1000000, // 10000 元 → cents
          primaryCustomerId: 'cust-1',
        }),
      }),
    );
    expect(tx.crmTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: '跟进报价' }),
      }),
    );
    expect(tx.crmNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: '客户询问价格' }),
      }),
    );
    // timeline 带归因主键链
    expect(tx.crmTimelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            sourceArticleId: 'art-1',
            sourcePublishRecordId: 'pub-1',
            sourceInteractionEventId: 'ev-1',
            identityId: 'pid-1',
          }),
        }),
      }),
    );
    // outbox 已写（幂等键同输入）
    expect(tx.domainEventOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'lead.action.executed',
          idempotencyKey: 'conv-1',
        }),
      }),
    );
  });

  it('T4.1：任何一步失败 → 事务回滚（抛错，不残留）', async () => {
    const { prisma } = makePrisma({
      crmCompany: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(new Error('company create failed')),
      },
    });
    const svc = makeService(prisma);

    await expect(
      svc.convert({
        leadId: 'lead-1',
        scope: { userId: 'u-1', tenantId: 'tenant-1' },
        company: { name: 'X' },
      }),
    ).rejects.toThrow('company create failed');
    // 事务内后续步骤未执行（customer 已建但事务回滚 → 不产生 timeline）
    expect(prisma.crmTimelineEvent.create).not.toHaveBeenCalled();
  });
});
