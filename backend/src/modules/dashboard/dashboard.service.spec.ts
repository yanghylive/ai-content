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
