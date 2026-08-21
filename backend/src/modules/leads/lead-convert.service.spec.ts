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
    // 未传 task → 按 P2 T03 R1-R4 规则默认建跟进待办（默认 LEAD score80/qualified → R1）
    expect(tx.crmTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '首次跟进：张三',
          customerId: 'cust-1',
          priority: 'high',
          metadata: expect.objectContaining({ ruleId: 'R1' }),
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

// —— P2 T03 自动跟进任务规则（R1-R4）——
describe('P2 自动跟进任务规则', () => {
  it('R1：score>=80 且已联系/合格 → 首次跟进 high 优先级 24h', async () => {
    const { prisma, tx } = makePrisma();
    const svc = makeService(prisma);
    await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
    });
    const call = tx.crmTask.create.mock.calls[0][0];
    expect(call.data.title).toBe('首次跟进：张三');
    expect(call.data.priority).toBe('high');
    expect(call.data.metadata.ruleId).toBe('R1');
    const dueMs = new Date(call.data.dueAt).getTime();
    const expected = Date.now() + 24 * 60 * 60 * 1000;
    expect(Math.abs(dueMs - expected)).toBeLessThan(5000);
  });

  it('R2：私信来源（latestReply 有值）→ 回复私信 48h normal', async () => {
    const { prisma, tx } = makePrisma();
    prisma.$transaction = jest.fn(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    );
    tx.lead.findFirst.mockResolvedValue(
      LEAD({ score: 50, status: 'new', sourceType: 'comment', latestReply: '你好' }),
    );
    const svc = makeService(prisma);
    await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
    });
    const call = tx.crmTask.create.mock.calls[0][0];
    expect(call.data.title).toBe('回复私信并确认需求：张三');
    expect(call.data.priority).toBe('normal');
    expect(call.data.metadata.ruleId).toBe('R2');
  });

  it('R3：评论来源无回复 → 评论转私信 48h', async () => {
    const { prisma, tx } = makePrisma();
    prisma.$transaction = jest.fn(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    );
    tx.lead.findFirst.mockResolvedValue(
      LEAD({ score: 30, status: 'new', sourceType: 'comment', latestReply: null }),
    );
    const svc = makeService(prisma);
    await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
    });
    const call = tx.crmTask.create.mock.calls[0][0];
    expect(call.data.title).toBe('评论转私信推进：张三');
    expect(call.data.metadata.ruleId).toBe('R3');
  });

  it('R4：兜底 → 跟进新客户 24h', async () => {
    const { prisma, tx } = makePrisma();
    prisma.$transaction = jest.fn(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    );
    tx.lead.findFirst.mockResolvedValue(
      LEAD({ score: 10, status: 'new', sourceType: 'search', latestReply: null }),
    );
    const svc = makeService(prisma);
    await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
    });
    const call = tx.crmTask.create.mock.calls[0][0];
    expect(call.data.title).toBe('跟进新客户：张三');
    expect(call.data.metadata.ruleId).toBe('R4');
  });

  it('input.task 显式覆盖 → 用调用方 title 不覆盖 metadata', async () => {
    const { prisma, tx } = makePrisma();
    const svc = makeService(prisma);
    await svc.convert({
      leadId: 'lead-1',
      scope: { userId: 'u-1', tenantId: 'tenant-1' },
      task: { title: '自定义跟进', description: '自定', priority: 'low', dueAt: new Date('2026-09-01') },
    });
    const call = tx.crmTask.create.mock.calls[0][0];
    expect(call.data.title).toBe('自定义跟进');
    expect(call.data.description).toBe('自定');
    expect(call.data.priority).toBe('low');
    expect(call.data.dueAt).toEqual(new Date('2026-09-01'));
    // 未显式覆盖时 metadata 仍带规则信息（用于复盘）
    expect(call.data.metadata.ruleId).toBeTruthy();
  });
});
