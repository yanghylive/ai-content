import { CrmService } from './crm.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppMarketService } from '../app-market/app-market.service';

function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-1',
    ownerId: 'user-1',
    name: '元素企业 AI',
    domain: 'example.com',
    industry: 'AI SaaS',
    phone: null,
    website: null,
    city: '杭州',
    employees: 20,
    annualRevenueCents: 0,
    ownerUserId: null,
    tags: [],
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    _count: {
      customers: 0,
      opportunities: 0,
      tasks: 0,
      notes: 0,
    },
    ...overrides,
  };
}

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'customer-1',
    ownerId: 'user-1',
    displayName: '张三',
    companyId: null,
    company: null,
    title: null,
    email: null,
    phone: null,
    wechat: null,
    status: 'new',
    sourcePlatform: 'manual',
    sourceKeyword: null,
    matchedKeyword: null,
    sourceUrl: null,
    sourceText: null,
    latestReply: null,
    score: 0,
    tags: [],
    profileUrl: null,
    externalUserId: null,
    dedupeKey: 'crm:customer',
    assignedUserId: null,
    firstInteractionTaskId: null,
    latestInteractionTaskId: null,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    _count: {
      timelineEvents: 0,
      tasks: 0,
      notes: 0,
    },
    ...overrides,
  };
}

function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'opportunity-1',
    ownerId: 'user-1',
    name: '企业 AI 商机',
    stage: 'qualified',
    amountCents: 0,
    currency: 'CNY',
    probability: 20,
    companyId: 'company-1',
    company: { id: 'company-1', name: '元素企业 AI' },
    primaryCustomerId: null,
    primaryCustomer: null,
    closeDate: null,
    nextStep: null,
    competitor: null,
    source: 'crm',
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    _count: { tasks: 0, notes: 0, timelineEvents: 0 },
    ...overrides,
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    ownerId: 'user-1',
    title: '跟进商机',
    description: null,
    status: 'open',
    priority: 'normal',
    dueAt: null,
    completedAt: null,
    assigneeId: 'user-1',
    companyId: 'company-1',
    company: { id: 'company-1', name: '元素企业 AI' },
    customerId: null,
    customer: null,
    opportunityId: 'opportunity-1',
    opportunity: { id: 'opportunity-1', name: '企业 AI 商机' },
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    ownerId: 'user-1',
    body: '备注',
    createdBy: 'user-1',
    companyId: 'company-1',
    company: { id: 'company-1', name: '元素企业 AI' },
    customerId: null,
    customer: null,
    opportunityId: 'opportunity-1',
    opportunity: { id: 'opportunity-1', name: '企业 AI 商机' },
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

function makePrismaMock() {
  const prisma = {
    crmCompany: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    crmCustomer: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    crmOpportunity: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    crmTask: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    crmNote: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    crmTimelineEvent: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    interactionTask: {
      findFirst: jest.fn(),
    },
    crmImportBatch: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({
        ...data,
        auditEvents: [],
        createdAt: new Date('2026-06-25T00:00:00.000Z'),
        updatedAt: new Date('2026-06-25T00:00:00.000Z'),
      })),
      update: jest.fn(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
        createdAt: new Date('2026-06-25T00:00:00.000Z'),
        updatedAt: new Date('2026-06-25T00:00:00.000Z'),
      })),
      updateMany: jest.fn(),
    },
    crmAuditEvent: {
      findMany: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({
        id: 'audit-event-1',
        ...data,
        createdAt: new Date('2026-06-25T00:00:00.000Z'),
      })),
      updateMany: jest.fn(),
    },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        role: 'admin',
        permissions: [],
      }),
    },
    growthAccountHealth: {
      findFirst: jest.fn().mockResolvedValue({ id: 'account-health-1' }),
    },
    growthAcquisitionConfig: {
      findFirst: jest.fn().mockResolvedValue({ id: 'growth-config-1' }),
    },
    $executeRaw: jest.fn(), // 参数化 DML
    $executeRawUnsafe: jest.fn(), // 静态 DDL（建表/索引）
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(prisma),
    ),
  } as any;
  return prisma;
}

function makeAppMarketMock(installed = true) {
  return {
    getCrmState: jest.fn().mockResolvedValue({
      purchased: installed,
      installed,
    }),
  } as unknown as jest.Mocked<AppMarketService>;
}

describe('CrmService', () => {
  it('writes CRM records with tenant scope without bulk-rewriting legacy records', async () => {
    const prisma = makePrismaMock();
    const company = makeCompany({ tenantId: 'tenant-1' });
    prisma.tenantMember.findFirst.mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'admin',
      permissions: [],
    });
    prisma.crmCompany.create.mockResolvedValue(company);
    prisma.crmCompany.findFirst.mockResolvedValue(company);
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    await service.createCompany('user-1', { name: '元素企业 AI' });

    expect(prisma.crmCompany.updateMany).not.toHaveBeenCalled();
    expect(prisma.crmCompany.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-1',
          tenantId: 'tenant-1',
          name: '元素企业 AI',
        }),
      }),
    );
    expect(prisma.crmTimelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-1',
          tenantId: 'tenant-1',
          eventType: 'company_created',
        }),
      }),
    );
  });

  it('allows any active tenant member to mutate CRM (all-features-open)', async () => {
    const prisma = makePrismaMock();
    prisma.tenantMember.findFirst.mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'member',
      permissions: ['crm:read'],
    });
    const company = makeCompany();
    prisma.crmCompany.create.mockResolvedValue(company);
    prisma.crmCompany.findFirst.mockResolvedValue(company);
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.createCompany('user-1', { name: '可写公司' });
    expect(result).toBeDefined();
    expect(prisma.crmCompany.create).toHaveBeenCalled();
  });

  it('allows any active tenant member to run CRM acquisition (all-features-open)', async () => {
    const prisma = makePrismaMock();
    prisma.tenantMember.findFirst.mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'member',
      permissions: ['crm:write'],
    });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.captureAutoAcquisitionLeads('user-1', {
      configId: 'config-1',
      recordId: 'record-1',
      taskName: '获客任务',
      trigger: 'manual',
      keyword: '企业获客',
      accountId: 'douyin-account-1',
      status: 'success',
      message: '完成',
      targets: [],
      executionResults: [],
    });
    expect(result).toBeDefined();
  });

  it('creates a company and writes a timeline event', async () => {
    const prisma = makePrismaMock();
    const company = makeCompany();
    prisma.crmCompany.create.mockResolvedValue(company);
    prisma.crmCompany.findFirst.mockResolvedValue(company);
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.createCompany('user-1', {
      name: '元素企业 AI',
      industry: 'AI SaaS',
      city: '杭州',
    });

    expect(result.name).toBe('元素企业 AI');
    expect(prisma.crmCompany.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-1',
          name: '元素企业 AI',
          industry: 'AI SaaS',
          city: '杭州',
        }),
      }),
    );
    expect(prisma.crmTimelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-1',
          companyId: 'company-1',
          eventType: 'company_created',
        }),
      }),
    );
  });

  it('reads CRM collections through tenant scope with owner fallback', async () => {
    const prisma = makePrismaMock();
    prisma.tenantMember.findFirst.mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'admin',
      permissions: [],
    });
    prisma.crmCustomer.findMany.mockResolvedValue([
      makeCustomer({ tenantId: 'tenant-1', displayName: '张三' }),
    ]);
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.listCustomers('user-1', { q: '张三' });

    expect(result).toHaveLength(1);
    expect(prisma.crmCustomer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { tenantId: 'tenant-1' },
                { ownerId: 'user-1', tenantId: null },
              ],
            },
          ],
          OR: expect.arrayContaining([{ displayName: { contains: '张三' } }]),
        }),
      }),
    );
  });

  it('exposes source account continuity from captured and edited customer metadata', async () => {
    const prisma = makePrismaMock();
    prisma.crmCustomer.findMany.mockResolvedValue([
      makeCustomer({
        sourcePlatform: 'douyin',
        metadata: {
          autoAcquisition: {
            accountId: 'douyin-account-1',
            accountName: '品牌主账号',
          },
        },
      }),
    ]);
    prisma.crmCustomer.findFirst.mockResolvedValue(makeCustomer());
    prisma.crmCustomer.update.mockResolvedValue(
      makeCustomer({
        metadata: {
          sourceAccount: {
            id: 'douyin-account-2',
            name: '客服账号',
            platform: 'douyin',
          },
        },
      }),
    );
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const customers = await service.listCustomers('user-1');
    await service.updateCustomer('user-1', 'customer-1', {
      sourcePlatform: 'douyin',
      sourceAccountId: 'douyin-account-2',
      sourceAccountName: '客服账号',
    });

    expect(customers[0].sourceAccount).toEqual({
      id: 'douyin-account-1',
      name: '品牌主账号',
      platform: 'douyin',
    });
    expect(prisma.crmCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1' },
        data: expect.objectContaining({
          sourcePlatform: 'douyin',
          metadata: expect.objectContaining({
            sourceAccount: {
              id: 'douyin-account-2',
              name: '客服账号',
              platform: 'douyin',
            },
          }),
        }),
      }),
    );
  });

  it('returns a customer continuity bundle with customer-scoped follow-ups', async () => {
    const prisma = makePrismaMock();
    prisma.crmCustomer.findFirst.mockResolvedValue(makeCustomer());
    prisma.crmTask.findMany.mockResolvedValue([
      makeTask({
        customerId: 'customer-1',
        customer: { id: 'customer-1', displayName: '张三' },
      }),
    ]);
    prisma.crmNote.findMany.mockResolvedValue([
      makeNote({
        customerId: 'customer-1',
        customer: { id: 'customer-1', displayName: '张三' },
      }),
    ]);
    prisma.crmTimelineEvent.findMany.mockResolvedValue([]);
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.getCustomerContinuity('user-1', 'customer-1');

    expect(result.customer.id).toBe('customer-1');
    expect(result.tasks).toHaveLength(1);
    expect(result.notes).toHaveLength(1);
    expect(prisma.crmTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: 'customer-1' }),
      }),
    );
    expect(prisma.crmNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: 'customer-1',
          NOT: { createdBy: 'crm:welcome-message-template' },
        }),
      }),
    );
  });

  it('stores welcome templates separately from ordinary customer notes', async () => {
    const prisma = makePrismaMock();
    const template = makeNote({
      id: 'template-1',
      body: '你好 {{customer_name}}，欢迎关注。',
      createdBy: 'crm:welcome-message-template',
      companyId: null,
      company: null,
      opportunityId: null,
      opportunity: null,
      metadata: {
        kind: 'welcome_message_template',
        name: '首次咨询',
        channel: 'douyin',
      },
    });
    prisma.crmNote.create.mockResolvedValue(template);
    prisma.crmNote.findMany.mockResolvedValue([]);
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.createWelcomeMessageTemplate('user-1', {
      name: '首次咨询',
      body: '你好 {{customer_name}}，欢迎关注。',
      channel: 'douyin',
    });
    await service.listNotes('user-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'template-1',
        name: '首次咨询',
        channel: 'douyin',
      }),
    );
    expect(prisma.crmNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdBy: 'crm:welcome-message-template',
          metadata: expect.objectContaining({
            kind: 'welcome_message_template',
          }),
        }),
      }),
    );
    expect(prisma.crmNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { createdBy: 'crm:welcome-message-template' },
        }),
      }),
    );
  });

  it('prepares an unsent welcome message and links only a real interaction task', async () => {
    const prisma = makePrismaMock();
    const customer = makeCustomer({
      sourcePlatform: 'douyin',
      sourceKeyword: '企业获客',
      externalUserId: 'douyin-user-1',
      metadata: {
        sourceAccount: {
          id: 'douyin-account-1',
          name: '品牌主账号',
          platform: 'douyin',
        },
      },
    });
    const template = makeNote({
      id: 'template-1',
      body: '你好 {{customer_name}}，看到你在关注 {{source_keyword}}。',
      createdBy: 'crm:welcome-message-template',
      companyId: null,
      company: null,
      opportunityId: null,
      opportunity: null,
      metadata: {
        kind: 'welcome_message_template',
        name: '线索欢迎语',
        channel: 'douyin',
      },
    });
    const preparationEvent = {
      id: 'preparation-1',
      customerId: 'customer-1',
      companyId: null,
      opportunityId: null,
      taskId: null,
      noteId: null,
      relatedInteractionTaskId: null,
      relatedRuntimeExecutionId: null,
      eventType: 'welcome_message_prepared',
      channel: 'douyin',
      content: '欢迎消息测试发送已准备，尚未发送',
      replyContent: '你好 张三，看到你在关注 企业获客。',
      status: 'prepared',
      failureReason: null,
      evidence: {},
      metadata: {
        templateId: 'template-1',
        templateName: '线索欢迎语',
        targetName: 'douyin-user-1',
        accountId: 'douyin-account-1',
        accountName: '品牌主账号',
        sendMode: 'auto-send',
        externalSendRequested: false,
        deliveryConfirmed: false,
        requiresExternalReadback: true,
      },
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
    };
    prisma.crmCustomer.findFirst.mockResolvedValue(customer);
    prisma.crmNote.findFirst.mockResolvedValue(template);
    prisma.crmTimelineEvent.create
      .mockResolvedValueOnce(preparationEvent)
      .mockResolvedValueOnce({ id: 'conversation-event-1' });
    prisma.crmTimelineEvent.findFirst.mockResolvedValue(preparationEvent);
    prisma.interactionTask.findFirst.mockResolvedValue({
      id: 'interaction-task-1',
      taskType: 'DOUYIN_DIRECT_MESSAGE_REPLY',
      accountId: 'douyin-account-1',
      sendMode: 'auto-send',
      status: 'QUEUED',
    });
    prisma.crmCustomer.update.mockResolvedValue(customer);
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const preparation = await service.prepareWelcomeMessage(
      'user-1',
      'customer-1',
      { templateId: 'template-1' },
    );
    const link = await service.linkCustomerConversation(
      'user-1',
      'customer-1',
      {
        preparationId: 'preparation-1',
        interactionTaskId: 'interaction-task-1',
      },
    );

    expect(preparation).toEqual(
      expect.objectContaining({
        message: '你好 张三，看到你在关注 企业获客。',
        status: 'prepared',
        deliveryStatus: 'not_sent',
        externalSendRequested: false,
        deliveryConfirmed: false,
        requiresExternalReadback: true,
      }),
    );
    expect(prisma.crmTimelineEvent.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'welcome_message_prepared',
          status: 'prepared',
          metadata: expect.objectContaining({
            externalSendRequested: false,
            deliveryConfirmed: false,
            requiresExternalReadback: true,
          }),
        }),
      }),
    );
    expect(link).toEqual(
      expect.objectContaining({
        interactionTaskId: 'interaction-task-1',
        status: 'queued',
        deliveryConfirmed: false,
        requiresExternalReadback: true,
      }),
    );
    expect(prisma.interactionTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'interaction-task-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
        },
      }),
    );
    expect(prisma.crmCustomer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: {
        firstInteractionTaskId: 'interaction-task-1',
        latestInteractionTaskId: 'interaction-task-1',
      },
    });
    expect(prisma.crmTimelineEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          relatedInteractionTaskId: 'interaction-task-1',
          status: 'queued',
          metadata: expect.objectContaining({
            externalSendRequested: true,
            deliveryConfirmed: false,
            requiresExternalReadback: true,
          }),
        }),
      }),
    );
  });

  it('captures successful auto acquisition targets into CRM when installed', async () => {
    const prisma = makePrismaMock();
    prisma.crmCustomer.upsert.mockResolvedValue(
      makeCustomer({
        id: 'customer-auto-1',
        displayName: '抖音评论用户：装修获客',
        companyId: null,
        status: 'contacted',
      }),
    );
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-auto-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(true),
    );

    const result = await service.captureAutoAcquisitionLeads('user-1', {
      configId: 'config-1',
      recordId: 'record-1',
      taskName: '自动获客',
      trigger: 'manual',
      keyword: '装修获客',
      status: 'success',
      message: 'ok',
      targets: [
        {
          index: 0,
          targetName: '潜在客户 A',
          text: '想了解装修',
          commentReplyText: '可以交流一下',
          commentTaskEnabled: true,
        },
      ],
      executionResults: [
        {
          index: 0,
          targetName: '潜在客户 A',
          targetText: '想了解装修',
          replyText: '可以交流一下',
          ok: true,
          status: 'sent',
          message: 'sent',
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        enabled: true,
        capturedCount: 1,
        skippedCount: 0,
      }),
    );
    expect(prisma.crmCustomer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ownerId: 'user-1',
          status: 'contacted',
          sourcePlatform: 'douyin',
          sourceKeyword: '装修获客',
          latestReply: '可以交流一下',
        }),
      }),
    );
    expect(prisma.crmTimelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-1',
          customerId: 'customer-auto-1',
          eventType: 'auto_acquisition_comment_replied',
          replyContent: '可以交流一下',
          status: 'sent',
        }),
      }),
    );
  });

  it('captures a growth lead into CRM and returns the linked customer reference', async () => {
    const prisma = makePrismaMock();
    prisma.crmCustomer.upsert.mockResolvedValue(
      makeCustomer({
        id: 'customer-growth-1',
        displayName: '本地装修咨询客户',
        companyId: null,
        status: 'new',
      }),
    );
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-growth-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(true),
    );

    const result = await service.captureGrowthLead('user-1', {
      leadId: 'lead-growth-1',
      platform: 'xiaohongshu',
      sourceType: 'manual-import',
      nickname: '本地装修咨询客户',
      profileUrl: 'https://example.com/profile',
      sourceText: '旧房翻新多少钱',
      sourceUrl: 'https://example.com/post',
      matchedKeywords: ['旧房翻新', '多少钱'],
      score: 88,
      scoreReasons: ['价格需求明确'],
      status: 'new',
      latestReply: '可以先发你一份报价参考。',
      evidenceUrls: ['https://evidence.local/lead.png'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        enabled: true,
        capturedCount: 1,
        skippedCount: 0,
        capturedCustomers: [
          expect.objectContaining({
            leadId: 'lead-growth-1',
            customerId: 'customer-growth-1',
            displayName: '本地装修咨询客户',
          }),
        ],
      }),
    );
    expect(prisma.crmCustomer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ownerId: 'user-1',
          displayName: '本地装修咨询客户',
          sourcePlatform: 'xiaohongshu',
          sourceKeyword: '旧房翻新',
          matchedKeyword: '旧房翻新、多少钱',
          latestReply: '可以先发你一份报价参考。',
          score: 88,
        }),
      }),
    );
    expect(prisma.crmTimelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-1',
          customerId: 'customer-growth-1',
          eventType: 'growth_lead_synced',
          channel: 'xiaohongshu',
          replyContent: '可以先发你一份报价参考。',
          status: 'new',
        }),
      }),
    );
  });

  it('inherits company from related opportunity for tasks and notes', async () => {
    const prisma = makePrismaMock();
    const opportunity = makeOpportunity();
    const task = makeTask();
    const note = makeNote();
    prisma.crmOpportunity.findFirst.mockResolvedValue(opportunity);
    prisma.crmTask.create.mockResolvedValue(task);
    prisma.crmTask.findFirst.mockResolvedValue(task);
    prisma.crmNote.create.mockResolvedValue(note);
    prisma.crmNote.findFirst.mockResolvedValue(note);
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const taskResult = await service.createTask('user-1', {
      title: '跟进商机',
      opportunityId: 'opportunity-1',
    });
    const noteResult = await service.createNote('user-1', {
      body: '备注',
      opportunityId: 'opportunity-1',
    });

    expect(taskResult.companyId).toBe('company-1');
    expect(noteResult.companyId).toBe('company-1');
    expect(prisma.crmTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          opportunityId: 'opportunity-1',
        }),
      }),
    );
    expect(prisma.crmNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          opportunityId: 'opportunity-1',
        }),
      }),
    );
  });

  it('does not write CRM tables when the CRM app is not installed', async () => {
    const prisma = makePrismaMock();
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(false),
    );

    const result = await service.captureAutoAcquisitionLeads('user-1', {
      configId: 'config-1',
      recordId: 'record-1',
      taskName: '自动获客',
      trigger: 'manual',
      keyword: '装修获客',
      status: 'success',
      message: 'ok',
      targets: [{ index: 0, text: '想了解装修' }],
      executionResults: [
        {
          index: 0,
          targetText: '想了解装修',
          ok: true,
          status: 'sent',
          message: 'sent',
        },
      ],
    });

    expect(result.enabled).toBe(false);
    expect(result.capturedCount).toBe(0);
    expect(prisma.crmCustomer.upsert).not.toHaveBeenCalled();
    expect(prisma.crmTimelineEvent.create).not.toHaveBeenCalled();
  });

  it('generates read-only deterministic closer advice from CRM records', async () => {
    const prisma = makePrismaMock();
    prisma.crmCustomer.findMany.mockResolvedValue([
      makeCustomer({
        id: 'customer-1',
        displayName: '张三',
        companyId: 'company-1',
        company: { id: 'company-1', name: '元素企业 AI' },
        score: 88,
        sourceKeyword: '企业获客',
        createdAt: new Date(),
        updatedAt: new Date('2026-06-20T00:00:00.000Z'),
      }),
    ]);
    prisma.crmOpportunity.findMany.mockResolvedValue([
      makeOpportunity({
        id: 'opportunity-1',
        amountCents: 8800000,
        probability: 30,
        closeDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        nextStep: null,
      }),
    ]);
    prisma.crmTask.findMany.mockResolvedValue([
      makeTask({
        id: 'task-1',
        title: '补跟进企业 AI 商机',
        priority: 'high',
        dueAt: new Date('2026-06-01T00:00:00.000Z'),
        customerId: 'customer-1',
        customer: { id: 'customer-1', displayName: '张三' },
      }),
    ]);
    prisma.crmTimelineEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        customerId: 'customer-1',
        companyId: 'company-1',
        opportunityId: 'opportunity-1',
        taskId: null,
        noteId: null,
        eventType: 'note_created',
        channel: 'crm',
        content: '客户关注企业获客',
        replyContent: null,
        status: null,
        failureReason: null,
        evidence: {},
        metadata: {},
        relatedInteractionTaskId: null,
        relatedRuntimeExecutionId: null,
        createdAt: new Date('2026-06-20T00:00:00.000Z'),
      },
    ]);
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.getCloserAdvice('user-1');

    expect(result.noExternalLlm).toBe(true);
    expect(result.safety).toEqual(
      expect.objectContaining({
        autoSend: false,
        autoWrite: false,
        writeTables: [],
      }),
    );
    expect(result.todayFollowUps.length).toBeGreaterThanOrEqual(3);
    expect(result.todayFollowUps[0]).toEqual(
      expect.objectContaining({
        id: expect.stringContaining('closer_'),
        sources: expect.arrayContaining([
          expect.objectContaining({ kind: expect.any(String) }),
        ]),
        script: expect.objectContaining({
          opener: expect.any(String),
          close: expect.any(String),
        }),
      }),
    );
    expect(result.dailySummary).toEqual(
      expect.objectContaining({
        recommendedActionCount: result.todayFollowUps.length,
        overdueTasks: 1,
      }),
    );
    expect(result.audit).toEqual(
      expect.objectContaining({
        deterministic: true,
        externalLlm: false,
        persisted: false,
        proofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(prisma.crmTimelineEvent.create).not.toHaveBeenCalled();
  });

  it('returns connector contracts without token, network, or write access', () => {
    const prisma = makePrismaMock();
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const readiness = service.getConnectorReadiness('user-1');
    const connectorIds = readiness.connectors.map((connector) => connector.id);

    expect(connectorIds).toEqual(
      expect.arrayContaining([
        'twenty',
        'hubspot',
        'salesforce',
        'feishu',
        'csv-excel',
      ]),
    );
    expect(readiness.summaryStats).toEqual(
      expect.objectContaining({
        noTokenRequired: true,
        noNetwork: true,
        noWrite: true,
        writeTables: [],
        requiredFutureGate: '11G',
      }),
    );
    expect(
      readiness.connectors.every(
        (connector) => connector.safetyBoundary.noWrite,
      ),
    ).toBe(true);
    expect(
      readiness.connectors.every(
        (connector) => connector.auth.tokenState === 'no-token',
      ),
    ).toBe(true);

    const hubspot = service.getConnectorContract('user-1', 'hubspot');
    expect(hubspot).toEqual(
      expect.objectContaining({
        id: 'hubspot',
        status: 'contract-only',
        safetyBoundary: expect.objectContaining({
          noToken: true,
          noNetwork: true,
          noWrite: true,
          writeTables: [],
        }),
      }),
    );
  });

  it('stores HubSpot sandbox token in encrypted vault without returning plaintext', async () => {
    const prisma = makePrismaMock();
    prisma.tenantMember.findFirst.mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'admin',
      permissions: [],
    });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );
    const token = 'pat-na1-commercial-sandbox-token-abcdef123456';

    const result = await service.saveHubSpotVaultToken('user-1', {
      token,
      label: 'HubSpot sandbox',
      portalId: '12345',
    });

    expect(result).toEqual(
      expect.objectContaining({
        connectorKey: 'hubspot',
        tokenStored: true,
        plaintextReturned: false,
        safety: expect.objectContaining({
          encryptedSecretPersisted: true,
          noPlaintextSecretPersistence: true,
          externalNetwork: false,
          externalCrmWrite: false,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(prisma.$executeRaw.mock.calls)).not.toContain(
      token,
    );
    expect(prisma.crmAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'crm_connector_secret_vault_record_created',
          externalNetwork: false,
          externalCrmTouched: false,
          writeTables: [
            'crm_connector_vault_records',
            'crm_connector_vault_handles',
            'crm_audit_events',
          ],
        }),
      }),
    );
  });

  it('requires a dedicated HubSpot vault key outside development', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPrimaryKey = process.env.HUBSPOT_CONNECTOR_VAULT_KEY;
    const originalAlternateKey = process.env.CRM_HUBSPOT_VAULT_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.HUBSPOT_CONNECTOR_VAULT_KEY;
    delete process.env.CRM_HUBSPOT_VAULT_KEY;
    const service = new CrmService(
      makePrismaMock() as PrismaService,
      makeAppMarketMock(),
    ) as any;

    try {
      expect(() => service.connectorVaultKeyConfig()).toThrow(
        'HubSpot 连接需要配置独立保管密钥',
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalPrimaryKey === undefined) {
        delete process.env.HUBSPOT_CONNECTOR_VAULT_KEY;
      } else {
        process.env.HUBSPOT_CONNECTOR_VAULT_KEY = originalPrimaryKey;
      }
      if (originalAlternateKey === undefined) {
        delete process.env.CRM_HUBSPOT_VAULT_KEY;
      } else {
        process.env.CRM_HUBSPOT_VAULT_KEY = originalAlternateKey;
      }
    }
  });

  it('blocks HubSpot read-only sandbox when no active vault token exists', async () => {
    const prisma = makePrismaMock();
    prisma.$queryRaw.mockResolvedValue([]);
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    await expect(
      service.runHubSpotReadOnlySandbox('user-1', {
        objects: ['contacts'],
        maxRowsPerObject: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'crm_hubspot_vault_token_required',
      }),
    });
    expect(prisma.crmCustomer.create).not.toHaveBeenCalled();
    expect(prisma.crmCompany.create).not.toHaveBeenCalled();
    expect(prisma.crmOpportunity.create).not.toHaveBeenCalled();
  });

  it('enriches import dry-runs with field suggestions, PII, quality and proof without writes', () => {
    const prisma = makePrismaMock();
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = service.createImportDryRun('user-1', {
      filename: 'leads.csv',
      sourceType: 'csv',
      rows: [
        {
          公司名称: '元素企业 AI',
          客户名称: '张三',
          手机号: '13800138000',
          邮箱: 'bad-email',
          来源备注: '想了解自动获客',
        },
        {
          公司名称: '元素企业 AI',
          客户名称: '张三',
          手机号: '13800138000',
          邮箱: 'bad-email',
          来源备注: '重复线索',
        },
      ],
    });

    expect(result.mapping).toEqual(
      expect.objectContaining({
        companyName: '公司名称',
        displayName: '客户名称',
        phone: '手机号',
        email: '邮箱',
      }),
    );
    expect(result.fieldSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          crmField: 'phone',
          sourceField: '手机号',
          pii: true,
        }),
      ]),
    );
    expect(result.piiDetections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          crmField: 'phone',
          classification: 'personal_contact',
        }),
      ]),
    );
    expect(result.qualityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_email' }),
        expect.objectContaining({ code: 'duplicate_candidate' }),
      ]),
    );
    expect(result.proof).toEqual(
      expect.objectContaining({
        dryRun: true,
        hashAlgorithm: 'sha256',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        writeTables: [],
        requiredFutureGate: '11G',
      }),
    );
    expect(result.audit).toEqual(
      expect.objectContaining({
        dryRun: true,
        persisted: false,
        writeTables: [],
      }),
    );
    expect(result.safety.noWrite).toBe(true);
    expect(prisma.crmCustomer.create).not.toHaveBeenCalled();
    expect(prisma.crmCompany.create).not.toHaveBeenCalled();
    expect(prisma.crmOpportunity.create).not.toHaveBeenCalled();
  });

  it('blocks CRM import commits without the MIGO local write gate', async () => {
    const prisma = makePrismaMock();
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    await expect(
      service.commitImportToLocalCrm('user-1', {
        filename: 'leads.csv',
        sourceType: 'csv',
        commit: true,
        rows: [{ 客户名称: '张三', 手机号: '13800138000' }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'crm_import_commit_gate_required',
      }),
    });
    expect(prisma.crmCustomer.upsert).not.toHaveBeenCalled();
    expect(prisma.crmTimelineEvent.create).not.toHaveBeenCalled();
  });

  it('commits approved imports into local CRM with proof and no external writes', async () => {
    const prisma = makePrismaMock();
    const customer = makeCustomer({
      id: 'customer-import-1',
      displayName: '张三',
      phone: '13800138000',
      sourcePlatform: 'csv',
      sourceText: '想了解自动获客',
      dedupeKey: '13800138000',
    });
    prisma.crmCustomer.upsert.mockResolvedValue(customer);
    prisma.crmCustomer.findFirst.mockResolvedValue(customer);
    prisma.crmTimelineEvent.create.mockResolvedValue({ id: 'event-1' });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.commitImportToLocalCrm('user-1', {
      filename: 'leads.csv',
      sourceType: 'csv',
      commit: true,
      confirmationGate: 'MIGO_LOCAL_CRM_IMPORT_APPROVED',
      dryRunId: 'dryrun_123',
      proofHash: 'dry-proof-hash',
      mapping: {
        客户名称: 'displayName',
        手机号: 'phone',
        来源备注: 'sourceText',
        标签: 'tags',
        评分: 'score',
      },
      rows: [
        {
          客户名称: '张三',
          手机号: '13800138000',
          来源备注: '想了解自动获客',
          标签: '口腔;私域',
          评分: '81',
        },
      ],
    });

    expect(prisma.crmCustomer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ownerId: 'user-1',
          displayName: '张三',
          phone: '13800138000',
          sourcePlatform: 'csv',
          sourceText: '想了解自动获客',
          score: 81,
          tags: ['口腔', '私域'],
          metadata: expect.objectContaining({
            importCommit: expect.objectContaining({
              dryRunId: 'dryrun_123',
              dryRunProofHash: 'dry-proof-hash',
            }),
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'committed',
        mode: 'local-crm-write',
        committedCount: 1,
        externalNetwork: false,
        externalCrmTouched: false,
        writeTables: [
          'crm_customers',
          'crm_companies',
          'crm_timeline_events',
          'crm_import_batches',
          'crm_audit_events',
        ],
        proof: expect.objectContaining({
          gate: 'MIGO_LOCAL_CRM_IMPORT_APPROVED',
          localWrite: true,
          externalWrite: false,
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        rollbackPlan: expect.objectContaining({
          importCommitId: expect.stringMatching(/^crm_import_/),
          rollbackToken: expect.stringMatching(/^rollback_/),
          customerIds: ['customer-import-1'],
        }),
      }),
    );
  });

  it('blocks CRM import rollback when the rollback token is invalid', async () => {
    const prisma = makePrismaMock();
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    await expect(
      service.rollbackLocalCrmImport('user-1', {
        importCommitId: 'crm_import_1234567890abcdef',
        rollbackToken: 'rollback_wrongtoken',
        customerIds: ['customer-1'],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'crm_import_rollback_token_invalid',
      }),
    });
    expect(prisma.crmCustomer.update).not.toHaveBeenCalled();
    expect(prisma.crmTimelineEvent.create).not.toHaveBeenCalled();
  });

  it('rolls back a committed CRM import by archiving only matching customers', async () => {
    const prisma = makePrismaMock();
    prisma.crmImportBatch.findFirst.mockResolvedValue({
      id: 'crm_import_1234567890abcdef',
      ownerId: 'user-1',
      tenantId: null,
      rollbackToken: 'rollback_1234567890abcdef',
      customerIds: ['customer-import-1', 'customer-other-1'],
      metadata: {},
    });
    prisma.crmCustomer.findMany.mockResolvedValue([
      makeCustomer({
        id: 'customer-import-1',
        displayName: '张三',
        companyId: null,
        metadata: {
          importCommit: { id: 'crm_import_1234567890abcdef' },
        },
      }),
      makeCustomer({
        id: 'customer-other-1',
        displayName: '李四',
        companyId: null,
        metadata: {
          importCommit: { id: 'crm_import_otherbatch' },
        },
      }),
    ]);
    prisma.crmCustomer.update.mockResolvedValue(
      makeCustomer({
        id: 'customer-import-1',
        displayName: '张三',
        archivedAt: new Date('2026-06-30T00:00:00.000Z'),
      }),
    );
    prisma.crmTimelineEvent.create.mockResolvedValue({
      id: 'event-rollback-1',
    });
    const service = new CrmService(
      prisma as PrismaService,
      makeAppMarketMock(),
    );

    const result = await service.rollbackLocalCrmImport('user-1', {
      importCommitId: 'crm_import_1234567890abcdef',
      rollbackToken: 'rollback_1234567890abcdef',
      customerIds: [
        'customer-import-1',
        'customer-other-1',
        'missing-customer',
      ],
      reason: 'smoke rollback',
    });

    expect(prisma.crmCustomer.update).toHaveBeenCalledTimes(1);
    expect(prisma.crmCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-import-1' },
        data: expect.objectContaining({
          status: 'archived',
          archivedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.crmTimelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'crm_import_rollback_archived',
          channel: 'crm_import',
          content: '回滚导入批次：crm_import_1234567890abcdef',
          metadata: expect.objectContaining({
            importCommitId: 'crm_import_1234567890abcdef',
            rollbackToken: 'rollback_1234567890abcdef',
            reason: 'smoke rollback',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'rolled_back',
        strategy: 'local-archive',
        archivedCount: 1,
        skippedCount: 2,
        externalNetwork: false,
        externalCrmTouched: false,
        writeTables: [
          'crm_customers',
          'crm_timeline_events',
          'crm_import_batches',
          'crm_audit_events',
        ],
        proof: expect.objectContaining({
          localWrite: true,
          externalWrite: false,
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: 'customer-import-1',
          status: 'archived',
        }),
        expect.objectContaining({
          customerId: 'customer-other-1',
          status: 'blocked',
        }),
        expect.objectContaining({
          customerId: 'missing-customer',
          status: 'not_found',
        }),
      ]),
    );
  });
});
