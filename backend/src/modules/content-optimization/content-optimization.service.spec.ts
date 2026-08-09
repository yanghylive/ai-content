import { ContentOptimizationService } from './content-optimization.service';

function createService(options?: { localOnly?: boolean; tenantId?: string }) {
  const tx = {
    contentVersion: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    contentDraft: {
      updateMany: jest.fn(),
    },
    contentEvidenceLog: {
      create: jest.fn(),
    },
  };
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    contentVersion: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    contentManualReview: {
      count: jest.fn(),
    },
  };
  const authRequestContext = {
    get: jest.fn(() => ({
      tenantId: options?.tenantId,
      user: {
        id: 'user-1',
        kaypalLocalOnly: options?.localOnly ?? true,
      },
    })),
    resolveTenantId: jest
      .fn()
      .mockResolvedValue(options?.tenantId || 'tenant-1'),
  };
  const service = new ContentOptimizationService(
    prisma as any,
    authRequestContext as any,
  );
  return { service, prisma, tx, authRequestContext };
}

describe('ContentOptimizationService ownership and publishing guards', () => {
  it('uses the selected tenant for non-local users', async () => {
    const { service, authRequestContext } = createService({
      localOnly: false,
      tenantId: 'tenant-a',
    });

    await expect((service as any).resolveScope()).resolves.toEqual({
      tenantId: 'tenant-a',
      userId: 'user-1',
    });
    expect(authRequestContext.resolveTenantId).toHaveBeenCalled();
  });

  it('rejects a client risk level that does not match the persisted check', async () => {
    const { service, prisma } = createService();
    jest.spyOn(service as any, 'getVersionRow').mockResolvedValue({
      id: 'version-1',
    });
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'check-1',
        user_id: 'user-1',
        tenant_id: null,
        target_id: 'version-1',
        risk_level: 'high',
        risk_score: 90,
        summary: '高风险',
        checked_at: new Date().toISOString(),
        status: 'completed',
      },
    ]);

    await expect(
      service.markVersionCompliance({
        versionId: 'version-1',
        checkId: 'check-1',
        riskLevel: 'pass',
        riskScore: 0,
        summary: '伪造通过',
      }),
    ).rejects.toThrow('合规风险等级与检查记录不一致');
    expect(prisma.contentVersion.updateMany).not.toHaveBeenCalled();
  });

  it('writes compliance fields from the persisted scoped check', async () => {
    const { service, prisma } = createService();
    jest.spyOn(service as any, 'getVersionRow').mockResolvedValue({
      id: 'version-1',
    });
    const checkedAt = new Date('2026-07-21T12:00:00.000Z');
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'check-1',
        user_id: 'user-1',
        tenant_id: null,
        target_id: 'version-1',
        risk_level: 'low',
        risk_score: 12,
        summary: '记录中的低风险结果',
        checked_at: checkedAt,
        status: 'completed',
      },
    ]);
    prisma.contentVersion.updateMany.mockResolvedValue({ count: 1 });

    await service.markVersionCompliance({
      versionId: 'version-1',
      checkId: 'check-1',
      riskLevel: 'low',
      riskScore: 99,
      summary: '客户端摘要不会覆盖真实记录',
    });

    expect(prisma.contentVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'version-1', tenantId: null, userId: 'user-1' },
      data: expect.objectContaining({
        complianceCheckId: 'check-1',
        complianceRiskLevel: 'low',
        complianceRiskScore: 12,
        complianceSummary: '记录中的低风险结果',
      }),
    });
  });

  it('sets one official version inside a transaction', async () => {
    const { service, prisma, tx } = createService();
    tx.contentVersion.findFirst.mockResolvedValue({
      id: 'version-1',
      draftId: 'draft-1',
      title: '正式标题',
      content: '正式正文',
    });
    tx.contentDraft.updateMany.mockResolvedValue({ count: 1 });
    tx.contentVersion.updateMany.mockResolvedValue({ count: 1 });
    tx.contentEvidenceLog.create.mockResolvedValue({ id: 'evidence-1' });
    jest
      .spyOn(service, 'getVersion')
      .mockResolvedValue({ id: 'version-1' } as any);

    await service.setOfficialVersion('version-1', { writeBackDraft: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.contentVersion.updateMany).toHaveBeenCalledWith({
      where: { draftId: 'draft-1', tenantId: null, userId: 'user-1' },
      data: { isOfficial: false },
    });
    expect(tx.contentVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'version-1', draftId: 'draft-1' }),
        data: expect.objectContaining({ isOfficial: true, status: 'official' }),
      }),
    );
  });

  it('returns the same publish preparation when a request is retried', async () => {
    const { service, prisma } = createService();
    jest.spyOn(service as any, 'getVersionRow').mockResolvedValue({
      id: 'version-1',
      is_official: true,
      compliance_risk_level: 'pass',
      compliance_risk_score: 0,
      platform: 'wechat',
      title: '标题',
      content: '正文',
    });
    prisma.$executeRaw.mockResolvedValue(0);
    const getIntent = jest
      .spyOn(service, 'getPublishIntent')
      .mockImplementation(async (id) => ({ id }) as any);
    const evidence = jest
      .spyOn(service as any, 'writeEvidence')
      .mockResolvedValue(undefined);

    const first = await service.createPublishIntent({
      versionId: 'version-1',
      platform: 'wechat',
    });
    const second = await service.createPublishIntent({
      versionId: 'version-1',
      platform: 'wechat',
    });

    expect(first.id).toBe(second.id);
    expect(getIntent.mock.calls[0][0]).toBe(getIntent.mock.calls[1][0]);
    expect(evidence).not.toHaveBeenCalled();
  });
});
