import { IntelligenceImportService } from './intelligence-import.service';
import { IntelligenceNormalizerService } from './intelligence-normalizer.service';
import { IntelligenceService } from './intelligence.service';

const skill = {
  id: 'skill-1',
  skillNo: '1001',
  code: 'xhs-hot-notes',
  name: '小红书爆款笔记查询',
  platform: 'xiaohongshu',
  category: 'content',
};

function makeItem(data: Record<string, unknown>) {
  const now = new Date('2026-06-30T00:00:00.000Z');
  return {
    id: data.id || 'item-1',
    tenantId: data.tenantId ?? 'tenant-1',
    userId: data.userId || 'user-1',
    sourceId: null,
    redfoxSkillId: data.redfoxSkillId || null,
    redfoxSkill: data.redfoxSkillId ? skill : null,
    redfoxCallLogId: data.redfoxCallLogId || null,
    redfoxCallLog: null,
    materialId: data.materialId || null,
    topicId: data.topicId || null,
    growthLeadId: data.growthLeadId || null,
    platform: data.platform || '小红书',
    type: data.type || 'viral',
    title: data.title || '爆款笔记',
    content: data.content || null,
    summary: data.summary || null,
    sourceUrl: data.sourceUrl || null,
    sourceExternalId: data.sourceExternalId || null,
    author: data.author || null,
    authorUrl: data.authorUrl || null,
    publishDate: data.publishDate || null,
    metrics: data.metrics || {},
    keywords: data.keywords || [],
    raw: data.raw || null,
    status: data.status || 'new',
    dedupeKey: data.dedupeKey || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

function makeMonitor(data: Record<string, unknown>) {
  const now = new Date('2026-06-30T00:00:00.000Z');
  return {
    id: data.id || 'monitor-1',
    tenantId: data.tenantId ?? 'tenant-1',
    userId: data.userId || 'user-1',
    skillInstallId: data.skillInstallId || null,
    type: data.type || 'keyword',
    platform: data.platform || '小红书',
    keyword: data.keyword || null,
    accountExternalId: data.accountExternalId || null,
    industry: data.industry || null,
    schedule: data.schedule || '0 */6 * * *',
    status: data.status || 'active',
    config: data.config || null,
    costLimitPoints: data.costLimitPoints || null,
    lastRunAt: data.lastRunAt || null,
    nextRunAt: data.nextRunAt || null,
    lastError: data.lastError || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

function makePrisma() {
  const items: any[] = [];
  const monitors: any[] = [];
  const complianceChecks: any[] = [];
  const benchmarkAccounts: any[] = [];
  const commentInsights: any[] = [];
  const intelligenceReports: any[] = [];
  const growthLeads: any[] = [];
  const prisma = {
    redfoxSkill: {
      findFirst: jest.fn(async () => skill),
    },
    intelligenceItem: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) {
          return items.find((item) => item.id === where.id) || null;
        }
        if (where.dedupeKey) {
          return (
            items.find((item) => item.dedupeKey === where.dedupeKey) || null
          );
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const item = makeItem({
          ...data,
          id: `item-${items.length + 1}`,
          redfoxSkill: data.redfoxSkillId ? skill : null,
        });
        items.push(item);
        return item;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = items.findIndex((item) => item.id === where.id);
        items[index] = {
          ...items[index],
          ...data,
          redfoxSkill: data.redfoxSkillId ? skill : items[index].redfoxSkill,
          updatedAt: new Date('2026-06-30T00:10:00.000Z'),
        };
        return items[index];
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matched = items.filter((item) => item.id === where.id);
        for (const item of matched) {
          Object.assign(item, data, {
            updatedAt: new Date('2026-06-30T00:40:00.000Z'),
          });
        }
        return { count: matched.length };
      }),
      findMany: jest.fn(async () => items),
      count: jest.fn(async () => items.length),
      groupBy: jest.fn(async () => []),
    },
    complianceCheck: {
      create: jest.fn(async ({ data }: any) => {
        const record = {
          id: `compliance-${complianceChecks.length + 1}`,
          ...data,
          createdAt: new Date('2026-06-30T00:30:00.000Z'),
          updatedAt: new Date('2026-06-30T00:30:00.000Z'),
        };
        complianceChecks.push(record);
        return record;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        return complianceChecks.find((item) => item.id === where.id) || null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = complianceChecks.findIndex(
          (item) => item.id === where.id,
        );
        complianceChecks[index] = {
          ...complianceChecks[index],
          ...data,
          updatedAt: new Date('2026-06-30T00:41:00.000Z'),
        };
        return complianceChecks[index];
      }),
      findMany: jest.fn(async () => complianceChecks),
      count: jest.fn(async () => complianceChecks.length),
    },
    benchmarkAccount: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) {
          return benchmarkAccounts.find((item) => item.id === where.id) || null;
        }
        const target = where.AND?.find(
          (part: any) => part.platform && part.externalUserId,
        );
        if (!target) return null;
        return (
          benchmarkAccounts.find(
            (item) =>
              item.platform === target.platform &&
              item.externalUserId === target.externalUserId,
          ) || null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const record = {
          id: `benchmark-${benchmarkAccounts.length + 1}`,
          ...data,
          createdAt: new Date('2026-06-30T00:31:00.000Z'),
          updatedAt: new Date('2026-06-30T00:31:00.000Z'),
        };
        benchmarkAccounts.push(record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = benchmarkAccounts.findIndex(
          (item) => item.id === where.id,
        );
        benchmarkAccounts[index] = {
          ...benchmarkAccounts[index],
          ...data,
          updatedAt: new Date('2026-06-30T00:32:00.000Z'),
        };
        return benchmarkAccounts[index];
      }),
      findMany: jest.fn(async () => benchmarkAccounts),
      count: jest.fn(async () => benchmarkAccounts.length),
    },
    commentInsight: {
      create: jest.fn(async ({ data }: any) => {
        const record = {
          id: `comment-insight-${commentInsights.length + 1}`,
          ...data,
          createdAt: new Date('2026-06-30T00:33:00.000Z'),
          updatedAt: new Date('2026-06-30T00:33:00.000Z'),
        };
        commentInsights.push(record);
        return record;
      }),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const record =
          commentInsights.find((item) => item.id === where.id) || null;
        if (!record || !include?.intelligenceItem) return record;
        return {
          ...record,
          intelligenceItem:
            items.find((item) => item.id === record.intelligenceItemId) || null,
        };
      }),
      update: jest.fn(async ({ where, data, include }: any) => {
        const index = commentInsights.findIndex((item) => item.id === where.id);
        commentInsights[index] = {
          ...commentInsights[index],
          ...data,
          updatedAt: new Date('2026-06-30T00:42:00.000Z'),
        };
        if (!include?.intelligenceItem) return commentInsights[index];
        return {
          ...commentInsights[index],
          intelligenceItem:
            items.find(
              (item) => item.id === commentInsights[index].intelligenceItemId,
            ) || null,
        };
      }),
      findMany: jest.fn(async () => commentInsights),
      count: jest.fn(async () => commentInsights.length),
    },
    intelligenceReport: {
      create: jest.fn(async ({ data }: any) => {
        const record = {
          id: `report-${intelligenceReports.length + 1}`,
          ...data,
          createdAt: new Date('2026-06-30T00:50:00.000Z'),
          updatedAt: new Date('2026-06-30T00:50:00.000Z'),
        };
        intelligenceReports.push(record);
        return record;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        return intelligenceReports.find((item) => item.id === where.id) || null;
      }),
      findMany: jest.fn(async () => intelligenceReports),
      count: jest.fn(async () => intelligenceReports.length),
      update: jest.fn(async ({ where, data }: any) => {
        const index = intelligenceReports.findIndex(
          (item) => item.id === where.id,
        );
        intelligenceReports[index] = {
          ...intelligenceReports[index],
          ...data,
          updatedAt: new Date('2026-06-30T00:51:00.000Z'),
        };
        return intelligenceReports[index];
      }),
    },
    growthLead: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const index = growthLeads.findIndex((item) => item.id === where.id);
        if (index >= 0) {
          growthLeads[index] = {
            ...growthLeads[index],
            ...update,
            updatedAt: new Date('2026-06-30T00:43:00.000Z'),
          };
          return growthLeads[index];
        }
        growthLeads.push(create);
        return create;
      }),
    },
    intelligenceMonitor: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) {
          return monitors.find((monitor) => monitor.id === where.id) || null;
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const monitor = makeMonitor({
          ...data,
          id: `monitor-${monitors.length + 1}`,
        });
        monitors.push(monitor);
        return monitor;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = monitors.findIndex((monitor) => monitor.id === where.id);
        monitors[index] = {
          ...monitors[index],
          ...data,
          updatedAt: new Date('2026-06-30T00:20:00.000Z'),
        };
        return monitors[index];
      }),
      count: jest.fn(async () => monitors.length),
      findMany: jest.fn(async () => monitors),
    },
  };

  return {
    prisma,
    items,
    monitors,
    complianceChecks,
    benchmarkAccounts,
    commentInsights,
    intelligenceReports,
    growthLeads,
  };
}

function makeService() {
  const {
    prisma,
    items,
    monitors,
    complianceChecks,
    benchmarkAccounts,
    commentInsights,
    intelligenceReports,
    growthLeads,
  } = makePrisma();
  const scope = {
    key: 'tenant-1:user-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
  };
  const redfoxService = {
    resolveScope: jest.fn(async () => scope),
    getConnection: jest.fn(async () => ({ status: 'missing_key' })),
    listSkills: jest.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 6,
    })),
    getCostSummary: jest.fn(async () => ({ totalCalls: 0 })),
  };
  const importService = {
    importItemToMaterial: jest.fn(),
    generateTopicFromItem: jest.fn(),
  };
  const service = new IntelligenceService(
    prisma as any,
    redfoxService as any,
    importService as unknown as IntelligenceImportService,
    new IntelligenceNormalizerService(),
  );

  return {
    service,
    prisma,
    redfoxService,
    importService,
    scope,
    items,
    monitors,
    complianceChecks,
    benchmarkAccounts,
    commentInsights,
    intelligenceReports,
    growthLeads,
  };
}

describe('IntelligenceService', () => {
  it('normalizes RedFox payloads and upserts duplicate source records', async () => {
    const { service, items } = makeService();

    const first = await service.ingestRedfoxItems({ id: 'user-1' } as any, {
      platform: '小红书',
      type: 'viral',
      redfoxSkillCode: 'xhs-hot-notes',
      rawItems: [
        {
          id: 'note-1',
          title: '旧标题',
          url: 'https://example.com/note-1',
          nickname: '作者A',
          likeCount: 12,
          keywords: ['获客'],
        },
      ],
    });

    expect(first).toEqual(
      expect.objectContaining({
        received: 1,
        normalized: 1,
        created: 1,
        updated: 0,
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].dedupeKey).toMatch(/^[a-f0-9]{64}$/);
    expect(items[0].redfoxSkillId).toBe('skill-1');

    const second = await service.ingestRedfoxItems({ id: 'user-1' } as any, {
      platform: '小红书',
      type: 'viral',
      redfoxSkillCode: 'xhs-hot-notes',
      rawItems: [
        {
          id: 'note-1',
          title: '新标题',
          url: 'https://example.com/note-1',
          nickname: '作者A',
          likeCount: 30,
        },
      ],
    });

    expect(second).toEqual(
      expect.objectContaining({
        received: 1,
        normalized: 1,
        created: 0,
        updated: 1,
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('新标题');
    expect(items[0].metrics).toEqual({ likeCount: 30 });
  });

  it('passes user and tenant scope into material and topic actions', async () => {
    const { service, importService, scope } = makeService();

    await service.importItemToMaterial({ id: 'user-1' } as any, 'item-1', {});
    await service.generateTopicFromItem({ id: 'user-1' } as any, 'item-1', {});

    expect(importService.importItemToMaterial).toHaveBeenCalledWith(
      scope,
      'item-1',
      {},
    );
    expect(importService.generateTopicFromItem).toHaveBeenCalledWith(
      scope,
      'item-1',
      {},
    );
  });

  it('dispatches high-risk intelligence items into compliance review', async () => {
    const { service, items, complianceChecks, scope } = makeService();
    items.push(
      makeItem({
        id: 'item-risk',
        title: '高风险标题',
        summary: '标题刺激性较高',
        raw: {
          evidence: ['标题存在夸大表达'],
          riskBoundary: '不直接进入内容生产。',
        },
        metrics: { riskScore: 88 },
      }),
    );

    const result = await service.dispatchItem(
      { id: 'user-1' } as any,
      'item-risk',
      {
        action: 'risk_review',
        label: '送风险审核',
        target: '风险审核',
        href: '/intelligence/risks',
        risk: 'high',
        reason: '风险分高，需要合规确认。',
      },
    );

    expect(complianceChecks).toHaveLength(1);
    expect(complianceChecks[0]).toEqual(
      expect.objectContaining({
        tenantId: scope.tenantId,
        userId: scope.userId,
        targetType: 'intelligence_item',
        targetId: 'item-risk',
        riskLevel: 'high',
        status: 'pending_review',
      }),
    );
    expect(items[0].status).toBe('pending_compliance');
    expect(result).toEqual(
      expect.objectContaining({
        action: 'risk_review',
        recordType: 'compliance_check',
        recordId: 'compliance-1',
      }),
    );
  });

  it('dispatches account intelligence into benchmark account pool', async () => {
    const { service, items, benchmarkAccounts } = makeService();
    items.push(
      makeItem({
        id: 'item-account',
        type: 'account',
        title: '老板 IP 账号样本',
        author: '老板 IP 账号',
        authorUrl: 'https://example.com/account',
        sourceExternalId: 'account-1',
        metrics: { followerCount: 1200 },
      }),
    );

    const result = await service.dispatchItem(
      { id: 'user-1' } as any,
      'item-account',
      {
        action: 'benchmark_account',
        label: '进入对标',
        target: '对标账号',
        href: '/intelligence/accounts',
        risk: 'low',
      },
    );

    expect(benchmarkAccounts).toHaveLength(1);
    expect(benchmarkAccounts[0]).toEqual(
      expect.objectContaining({
        intelligenceItemId: 'item-account',
        nickname: '老板 IP 账号',
        externalUserId: 'account-1',
        status: 'watching',
      }),
    );
    expect(items[0].status).toBe('benchmarked_account');
    expect(result.recordType).toBe('benchmark_account');
  });

  it('dispatches comment intelligence into lead insight records', async () => {
    const { service, items, commentInsights } = makeService();
    items.push(
      makeItem({
        id: 'item-comment',
        type: 'comment',
        title: '评论集中问价格',
        summary: '用户关心报价和到店流程',
        keywords: ['价格', '到店'],
        raw: {
          painPoints: ['价格不清楚'],
          intentKeywords: ['报价'],
        },
      }),
    );

    const result = await service.dispatchItem(
      { id: 'user-1' } as any,
      'item-comment',
      {
        action: 'comment_insight',
        label: '线索洞察',
        target: '线索洞察',
        href: '/intelligence/leads',
        risk: 'medium',
        reason: '评论问题集中。',
      },
    );

    expect(commentInsights).toHaveLength(1);
    expect(commentInsights[0]).toEqual(
      expect.objectContaining({
        intelligenceItemId: 'item-comment',
        platform: '小红书',
      }),
    );
    expect(commentInsights[0].intentKeywords).toEqual(['价格', '到店', '报价']);
    expect(items[0].status).toBe('comment_insight');
    expect(result.recordType).toBe('comment_insight');
  });

  it('lists dispatched records by business target', async () => {
    const { service, complianceChecks, benchmarkAccounts, commentInsights } =
      makeService();
    complianceChecks.push({
      id: 'compliance-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      targetType: 'intelligence_item',
      targetId: 'item-risk',
      platform: '小红书',
      riskLevel: 'high',
      status: 'pending_review',
      findings: ['证据 1'],
      suggestions: ['先审核'],
      raw: { title: '风险对象', intelligenceItemId: 'item-risk' },
      createdAt: new Date('2026-06-30T00:30:00.000Z'),
      updatedAt: new Date('2026-06-30T00:30:00.000Z'),
    });
    benchmarkAccounts.push({
      id: 'benchmark-1',
      intelligenceItemId: 'item-account',
      platform: '小红书',
      nickname: '对标账号',
      externalUserId: 'account-1',
      profileUrl: '',
      metrics: {},
      reason: '值得长期观察',
      diagnosis: { evidence: ['账号栏目稳定'] },
      status: 'watching',
      raw: {},
      createdAt: new Date('2026-06-30T00:31:00.000Z'),
      updatedAt: new Date('2026-06-30T00:31:00.000Z'),
    });
    commentInsights.push({
      id: 'comment-insight-1',
      intelligenceItemId: 'item-comment',
      intelligenceItem: null,
      platform: '小红书',
      painPoints: ['价格不清楚'],
      demandSignals: ['想要报价'],
      objections: [],
      replySuggestions: ['人工确认'],
      raw: {},
      analyzedAt: new Date('2026-06-30T00:32:00.000Z'),
      createdAt: new Date('2026-06-30T00:32:00.000Z'),
      updatedAt: new Date('2026-06-30T00:32:00.000Z'),
    });

    const risks = await service.listDispatchRecords(
      { id: 'user-1' } as any,
      'risks',
      { page: 1, limit: 20 },
    );
    const accounts = await service.listDispatchRecords(
      { id: 'user-1' } as any,
      'accounts',
      { page: 1, limit: 20 },
    );
    const leads = await service.listDispatchRecords(
      { id: 'user-1' } as any,
      'leads',
      { page: 1, limit: 20 },
    );

    expect(risks.items[0]).toEqual(
      expect.objectContaining({
        id: 'compliance-1',
        recordType: 'risk_review',
        title: '风险对象',
      }),
    );
    expect(accounts.items[0]).toEqual(
      expect.objectContaining({
        id: 'benchmark-1',
        recordType: 'benchmark_account',
      }),
    );
    expect(leads.items[0]).toEqual(
      expect.objectContaining({
        id: 'comment-insight-1',
        recordType: 'comment_insight',
      }),
    );
  });

  it('processes dispatched records through business actions', async () => {
    const {
      service,
      items,
      complianceChecks,
      benchmarkAccounts,
      commentInsights,
      growthLeads,
    } = makeService();
    items.push(
      makeItem({
        id: 'item-lead',
        title: '评论问报价',
        summary: '用户明确询问价格和预约方式',
        sourceUrl: 'https://example.com/comment',
        author: '潜在线索 A',
        sourceExternalId: 'comment-1',
      }),
    );
    complianceChecks.push(
      {
        id: 'risk-record',
        tenantId: 'tenant-1',
        userId: 'user-1',
        targetType: 'intelligence_item',
        targetId: 'item-lead',
        platform: '小红书',
        riskLevel: 'high',
        status: 'pending_review',
        findings: ['标题需复核'],
        suggestions: ['人工确认'],
        raw: { title: '风险记录', intelligenceItemId: 'item-lead' },
        createdAt: new Date('2026-06-30T00:30:00.000Z'),
        updatedAt: new Date('2026-06-30T00:30:00.000Z'),
      },
      {
        id: 'rule-record',
        tenantId: 'tenant-1',
        userId: 'user-1',
        targetType: 'intelligence_rule_seed',
        targetId: 'item-lead',
        platform: '小红书',
        riskLevel: 'medium',
        status: 'rule_seeded',
        findings: ['避免绝对化表达'],
        suggestions: ['发布为规则'],
        raw: { title: '规则记录', intelligenceItemId: 'item-lead' },
        createdAt: new Date('2026-06-30T00:31:00.000Z'),
        updatedAt: new Date('2026-06-30T00:31:00.000Z'),
      },
    );
    benchmarkAccounts.push({
      id: 'benchmark-record',
      tenantId: 'tenant-1',
      userId: 'user-1',
      intelligenceItemId: 'item-lead',
      platform: '小红书',
      nickname: '对标账号',
      externalUserId: 'account-1',
      profileUrl: 'https://example.com/account',
      metrics: {},
      reason: '值得跟踪',
      diagnosis: { evidence: ['栏目稳定'] },
      status: 'watching',
      raw: {},
      createdAt: new Date('2026-06-30T00:32:00.000Z'),
      updatedAt: new Date('2026-06-30T00:32:00.000Z'),
    });
    commentInsights.push({
      id: 'comment-record',
      tenantId: 'tenant-1',
      userId: 'user-1',
      intelligenceItemId: 'item-lead',
      platform: '小红书',
      sourceUrl: 'https://example.com/comment',
      sourceExternalId: 'comment-1',
      painPoints: ['价格不清楚'],
      intentKeywords: ['报价', '预约'],
      demandSignals: ['想要报价'],
      objections: ['担心流程复杂'],
      replySuggestions: ['先人工确认需求'],
      raw: {},
      analyzedAt: new Date('2026-06-30T00:33:00.000Z'),
      createdAt: new Date('2026-06-30T00:33:00.000Z'),
      updatedAt: new Date('2026-06-30T00:33:00.000Z'),
    });

    const risk = await service.processDispatchRecord(
      { id: 'user-1', role: 'manager' } as any,
      'risks',
      'risk-record',
      { action: 'approve', note: '可以进入后续链路' },
    );
    const rule = await service.processDispatchRecord(
      { id: 'user-1', role: 'manager' } as any,
      'rules',
      'rule-record',
      { action: 'publish_rule' },
    );
    const account = await service.processDispatchRecord(
      { id: 'user-1' } as any,
      'accounts',
      'benchmark-record',
      { action: 'watch_priority' },
    );
    const lead = await service.processDispatchRecord(
      { id: 'user-1' } as any,
      'leads',
      'comment-record',
      { action: 'create_growth_lead' },
    );

    expect(risk.record.status).toBe('approved');
    expect(rule.record.status).toBe('active_rule');
    expect(account.record.status).toBe('priority');
    expect(lead.record.status).toBe('lead_created');
    expect(growthLeads).toHaveLength(1);
    expect(growthLeads[0]).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        sourceType: 'intelligence-comment',
        nickname: '潜在线索 A',
      }),
    );
    expect(commentInsights[0].growthLeadId).toBe(growthLeads[0].id);
    expect(items[0].growthLeadId).toBe(growthLeads[0].id);

    const approved = await service.processDispatchRecord(
      { id: 'user-1', role: 'operator' } as any,
      'risks',
      'risk-record',
      { action: 'approve' },
    );
    expect(approved.status).toBe('approved');
  });

  it('persists intelligence reports and enforces report workflow roles', async () => {
    const { service, intelligenceReports } = makeService();

    const created = await service.createReport(
      { id: 'user-1', role: 'operator' } as any,
      {
        kind: 'daily',
        title: '今日情报简报',
        audience: '运营负责人',
        owner: '运营负责人',
        rangeKey: '7d',
        status: 'draft',
        completeness: 82,
        findings: ['新增高价值情报 3 条'],
        evidence: ['爆款笔记 A'],
        markdown: '# 今日情报简报',
        metadata: { targetHref: '/intelligence/inbox' },
      },
    );

    expect(created).toEqual(
      expect.objectContaining({
        title: '今日情报简报',
        status: 'draft',
        completeness: 82,
        findings: ['新增高价值情报 3 条'],
      }),
    );

    const list = await service.listReports({ id: 'user-1' } as any, {
      page: 1,
      limit: 10,
      keyword: '情报',
    });
    expect(list.total).toBe(1);

    const submitted = await service.processReport(
      { id: 'user-1', role: 'operator' } as any,
      created.id,
      { action: 'submit_review' },
    );
    expect(submitted.report.status).toBe('in_review');

    const delivered = await service.processReport(
      { id: 'user-1', role: 'operator' } as any,
      created.id,
      { action: 'mark_delivered', note: '全功能开放直接交付' },
    );
    expect(delivered.report.status).toBe('delivered');
    expect(intelligenceReports[0].metadata.lastAction).toBe('mark_delivered');
  });

  it('builds scoped filters for list queries', async () => {
    const { service, prisma, scope } = makeService();

    await service.listItems({ id: 'user-1' } as any, {
      page: 1,
      limit: 20,
      status: 'new',
      platform: '小红书',
      keyword: '老板 IP',
    });

    expect(prisma.intelligenceItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { tenantId: scope.tenantId },
                { userId: scope.userId, tenantId: null },
              ],
            },
          ]),
          status: 'new',
          platform: '小红书',
        }),
      }),
    );
  });

  it('creates monitor configs with tenant and user scope', async () => {
    const { service, prisma, scope } = makeService();

    const monitor = await service.createMonitor({ id: 'user-1' } as any, {
      type: 'keyword',
      platform: '小红书',
      keyword: '老板 IP',
      schedule: '0 */2 * * *',
      costLimitPoints: 300,
      nextRunAt: '2026-07-01T00:00:00.000Z',
      config: { guardrail: 'human_review' },
    });

    expect(prisma.intelligenceMonitor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: scope.tenantId,
          userId: scope.userId,
          type: 'keyword',
          keyword: '老板 IP',
          schedule: '0 */2 * * *',
          status: 'active',
          costLimitPoints: 300,
        }),
      }),
    );
    expect(monitor).toEqual(
      expect.objectContaining({
        keyword: '老板 IP',
        nextRunAt: '2026-07-01T00:00:00.000Z',
      }),
    );
  });

  it('builds scoped filters for monitor list queries', async () => {
    const { service, prisma, scope } = makeService();

    await service.listMonitors({ id: 'user-1' } as any, {
      page: 1,
      limit: 20,
      status: 'active',
      platform: '小红书',
      keyword: '老板',
    });

    expect(prisma.intelligenceMonitor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { tenantId: scope.tenantId },
                { userId: scope.userId, tenantId: null },
              ],
            },
            expect.objectContaining({
              OR: expect.arrayContaining([{ keyword: { contains: '老板' } }]),
            }),
          ]),
          status: 'active',
          platform: '小红书',
        }),
      }),
    );
  });

  it('updates and archives monitors through scoped lookup', async () => {
    const { service, prisma, monitors, scope } = makeService();
    monitors.push(makeMonitor({ id: 'monitor-1' }));

    const updated = await service.updateMonitor(
      { id: 'user-1' } as any,
      'monitor-1',
      {
        status: 'paused',
        schedule: '0 9 * * *',
      },
    );
    const archived = await service.archiveMonitor(
      { id: 'user-1' } as any,
      'monitor-1',
    );

    expect(prisma.intelligenceMonitor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'monitor-1',
          AND: expect.arrayContaining([
            {
              OR: [
                { tenantId: scope.tenantId },
                { userId: scope.userId, tenantId: null },
              ],
            },
          ]),
        }),
      }),
    );
    expect(updated.status).toBe('paused');
    expect(updated.schedule).toBe('0 9 * * *');
    expect(archived.status).toBe('archived');
  });
});
