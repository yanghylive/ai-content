import { DashboardService } from './dashboard.service';

function makeService(rows: unknown[]) {
  const prisma = {
    systemLog: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
  const systemLogsService = {
    getRecent: jest.fn(),
  };
  return {
    service: new DashboardService(prisma as never, systemLogsService as never),
    prisma,
  };
}

describe('DashboardService risk audit evidence', () => {
  it('parses single material delete audit logs into evidence records', async () => {
    const { service, prisma } = makeService([
      {
        id: 'log-1',
        level: 'warning',
        content: '素材删除已确认：测试素材（id=material-1, audit=risk_abc123）',
        createdAt: new Date('2026-07-02T17:50:00.000Z'),
      },
    ]);

    const result = await service.getRiskAuditEvidence(20);

    expect(prisma.systemLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { content: { contains: 'audit=risk_' } },
        take: 40,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        auditId: 'risk_abc123',
        action: 'material-delete',
        actionLabel: '删除素材',
        riskLevel: 'medium',
        status: 'allowed',
        targetLabel: '测试素材',
        targetId: 'material-1',
        affectedCount: 1,
        sourceLogId: 'log-1',
      }),
    ]);
  });

  it('parses batch material delete audit logs into evidence records', async () => {
    const { service } = makeService([
      {
        id: 'log-2',
        level: 'warning',
        content:
          '素材批量删除已确认：请求 3 条，实际删除 2 条（audit=risk_batch）',
        createdAt: new Date('2026-07-02T17:55:00.000Z'),
      },
    ]);

    const result = await service.getRiskAuditEvidence(20);

    expect(result).toEqual([
      expect.objectContaining({
        auditId: 'risk_batch',
        action: 'material-batch-delete',
        actionLabel: '批量删除素材',
        riskLevel: 'high',
        targetLabel: '2 条素材',
        requestedCount: 3,
        affectedCount: 2,
      }),
    ]);
  });

  it('parses generic high-risk audit logs into evidence records', async () => {
    const details = Buffer.from(
      JSON.stringify([
        {
          type: 'audit-confirmation',
          label: '人工确认记录',
          summary: '测试用户 已确认 high 风险动作',
          operator: '测试用户',
          confirmedAt: '2026-07-02T17:59:30.000Z',
          confirmedAction: 'publish',
          confirmedRiskLevel: 'high',
          checklist: [{ label: '已确认平台账号', checked: true }],
        },
        {
          type: 'publish-payload',
          label: '抖音 · 门店视频',
          summary: '1 个账号，1 个素材，0 个封面',
          platform: '抖音',
          accountId: '/accounts/douyin.json',
          contentKind: 'video',
          title: '门店视频',
          materialCount: 1,
          coverCount: 0,
          tagCount: 0,
          scheduleSummary: '立即发布',
          dryRun: false,
        },
        {
          type: 'publish-preflight',
          label: '发布前检查',
          summary: '发布前检查通过',
          ok: true,
          checkedAt: '2026-07-02T17:59:40.000Z',
          issueCount: 0,
          payloadCount: 1,
          accountCount: 1,
          materialCount: 1,
          issues: [],
        },
        {
          type: 'publish-platform',
          label: '抖音 · /accounts/douyin.json',
          platform: '抖音',
          accountId: '/accounts/douyin.json',
          status: 'success',
          statusLabel: '已发布',
          summary: '平台发布证据已确认',
          publishTaskId: '45',
          publishUrl: 'https://www.douyin.com/video/45',
          evidenceSource: 'platform-api',
        },
      ]),
      'utf8',
    ).toString('base64url');
    const { service } = makeService([
      {
        id: 'log-4',
        level: 'warning',
        content: `风险审计已确认：真实发布（action=publish, target=门店视频, audit=risk_publish, risk=high, status=allowed, detail=submitted=1;blocked=0, details=${details}）`,
        createdAt: new Date('2026-07-02T18:00:00.000Z'),
      },
    ]);

    const result = await service.getRiskAuditEvidence(20);

    expect(result).toEqual([
      expect.objectContaining({
        auditId: 'risk_publish',
        action: 'publish',
        actionLabel: '真实发布',
        riskLevel: 'high',
        status: 'allowed',
        targetLabel: '门店视频',
        detail: 'submitted=1;blocked=0',
        details: [
          expect.objectContaining({
            type: 'audit-confirmation',
            operator: '测试用户',
            confirmedAt: '2026-07-02T17:59:30.000Z',
            confirmedAction: 'publish',
            confirmedRiskLevel: 'high',
            checklist: [{ label: '已确认平台账号', checked: true }],
          }),
          expect.objectContaining({
            type: 'publish-payload',
            platform: '抖音',
            accountId: '/accounts/douyin.json',
            contentKind: 'video',
            title: '门店视频',
            materialCount: 1,
            coverCount: 0,
            tagCount: 0,
            scheduleSummary: '立即发布',
            dryRun: false,
          }),
          expect.objectContaining({
            type: 'publish-preflight',
            ok: true,
            checkedAt: '2026-07-02T17:59:40.000Z',
            issueCount: 0,
            payloadCount: 1,
            accountCount: 1,
            materialCount: 1,
          }),
          expect.objectContaining({
            type: 'publish-platform',
            label: '抖音 · /accounts/douyin.json',
            platform: '抖音',
            accountId: '/accounts/douyin.json',
            status: 'success',
            statusLabel: '已发布',
            publishTaskId: '45',
            publishUrl: 'https://www.douyin.com/video/45',
            evidenceSource: 'platform-api',
          }),
        ],
        summary: '已确认真实发布：门店视频',
      }),
    ]);
  });

  it('returns generic risk evidence for unknown audit logs', async () => {
    const { service } = makeService([
      {
        id: 'log-3',
        level: 'warning',
        content: '其他动作已确认（audit=risk_unknown）',
        createdAt: new Date('2026-07-02T17:58:00.000Z'),
      },
    ]);

    const result = await service.getRiskAuditEvidence(20);

    expect(result).toEqual([
      expect.objectContaining({
        auditId: 'risk_unknown',
        action: 'unknown-risk-audit',
        actionLabel: '风险审计',
        riskLevel: 'unknown',
        summary: '其他动作已确认（audit=risk_unknown）',
      }),
    ]);
  });
});

describe('DashboardService 归因链', () => {
  it('resolveContentAttribution 从内容查发布记录 + 互动任务', async () => {
    const prisma = {
      article: {
        findUnique: jest.fn().mockResolvedValue({ id: 'article-1', title: '品牌手册' }),
      },
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'pub-1', articleId: 'article-1' },
          { id: 'pub-2', articleId: 'article-1' },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'it-1', sourceArticleId: 'article-1', sourceUrl: 'https://douyin.com/comment/1' },
        ]),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'lead-1', sourceUrl: 'https://douyin.com/comment/1' },
        ]),
      },
    };
    const systemLogsService = { getRecent: jest.fn() };
    const service = new DashboardService(prisma as never, systemLogsService as never);

    const result = await service.resolveContentAttribution('article-1');

    expect(prisma.publishRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { articleId: 'article-1' } }),
    );
    expect(prisma.interactionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceArticleId: 'article-1' } }),
    );
    // 互动 → 线索：sourceUrl 匹配
    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceUrl: { in: ['https://douyin.com/comment/1'] } },
      }),
    );
    expect(result.publishCount).toBe(2);
    expect(result.interactionCount).toBe(1);
    expect(result.leadCount).toBe(1);
    expect(result.article).toMatchObject({ id: 'article-1' });
  });

  it('unifiedTaskCenter 聚合四模块任务并归一状态', async () => {
    const prisma = {
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'pub-1', status: 'failed', accountId: 'acc-1', publishUrl: null, updatedAt: new Date('2026-08-16T12:00:00Z') },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'it-1', status: 'WAITING_FOR_SEND_CONFIRMATION', taskType: 'comment-reply', currentTarget: null, updatedAt: new Date('2026-08-16T11:00:00Z') },
        ]),
      },
      runtimeExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: 're-1', status: 'running', taskType: 'browser', userMessage: '打开网页', updatedAt: new Date('2026-08-16T10:00:00Z') },
        ]),
      },
    };
    const systemLogsService = { getRecent: jest.fn() };
    const videoWorkshop = {
      listTasks: jest.fn().mockResolvedValue([
        { id: 'vw-1', kind: 'render', status: 'succeeded', stage: '渲染中', updatedAt: '2026-08-16T09:00:00.000Z' },
      ]),
    };
    const service = new DashboardService(
      prisma as never,
      systemLogsService as never,
      videoWorkshop as never,
    );

    const result = await service.unifiedTaskCenter(20);

    expect(result.total).toBe(4);
    // 各模块状态归一：failed→failed、WAITING_FOR_SEND_CONFIRMATION→waiting、
    // running→running、succeeded(video-workshop)→completed
    const statuses = result.items.map((i) => i.status).sort();
    expect(statuses).toEqual(['completed', 'failed', 'running', 'waiting']);
    const videoItem = result.items.find((i) => i.module === 'video-workshop');
    expect(videoItem).toMatchObject({
      id: 'vw-1',
      status: 'completed',
      title: '渲染中',
    });
  });

  it('unifiedTaskCenter 未注入 videoWorkshop 时不报错（@Optional）', async () => {
    const prisma = {
      publishRecord: { findMany: jest.fn().mockResolvedValue([]) },
      interactionTask: { findMany: jest.fn().mockResolvedValue([]) },
      runtimeExecution: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const systemLogsService = { getRecent: jest.fn() };
    const service = new DashboardService(prisma as never, systemLogsService as never);

    const result = await service.unifiedTaskCenter(20);

    expect(result.total).toBe(0);
  });

  it('getWeeklyReport 聚合内容→发布→互动→线索→成交指标', async () => {
    const prisma = {
      article: { count: jest.fn().mockResolvedValue(10) },
      publishRecord: { count: jest.fn().mockResolvedValue(8) },
      interactionTask: { count: jest.fn().mockResolvedValue(30) },
      lead: {
        count: jest
          .fn()
          .mockResolvedValueOnce(6) // leadCount
          .mockResolvedValueOnce(2) // convertedCount
          .mockResolvedValueOnce(3), // qualifiedLeadCount
      },
      crmOpportunity: { count: jest.fn().mockResolvedValue(1) },
    };
    const systemLogsService = { getRecent: jest.fn() };
    const service = new DashboardService(prisma as never, systemLogsService as never);

    const result = await service.getWeeklyReport(7);

    expect(result.contentCount).toBe(10);
    expect(result.publishCount).toBe(8);
    expect(result.interactionCount).toBe(30);
    expect(result.leadCount).toBe(6);
    expect(result.convertedCount).toBe(2);
    expect(result.wonCount).toBe(1);
    expect(result.qualifiedLeadCount).toBe(3);
    expect(result.periodDays).toBe(7);
  });
});
