import { PlatformComplianceAuditService } from './platform-compliance-audit.service';

describe('PlatformComplianceAuditService', () => {
  it('审计 6 项 × 6 平台，输出结构化报告', async () => {
    const prisma = {
      complianceCheck: { create: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const svc = new PlatformComplianceAuditService(prisma as never);
    const report = await svc.audit();

    expect(report.platforms).toHaveLength(6); // douyin/xhs/kuaishou/wechat-channel/wechat/manual
    const douyin = report.platforms.find((p) => p.platform === 'douyin');
    expect(douyin?.findings).toHaveLength(6);
    // 退订/删除/同意 = compliant（有 suppression/archive/approval 机制）
    const unsubscribe = douyin?.findings.find((f) => f.item === 'unsubscribe');
    expect(unsubscribe?.status).toBe('compliant');
    expect(unsubscribe?.evidence).toContain('suppression.service');
    const consent = douyin?.findings.find((f) => f.item === 'consent');
    expect(consent?.status).toBe('compliant');
    // 授权 = partial（浏览器会话，非官方 API）
    const auth = douyin?.findings.find((f) => f.item === 'authorization');
    expect(auth?.status).toBe('partial');
    // 无阻断性 gap
    expect(report.summary.gap).toBe(0);
    expect(douyin?.blocked).toBe(false);
  });

  it('auditAndPersist 落库 + 返回报告', async () => {
    const prisma = {
      complianceCheck: { create: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const svc = new PlatformComplianceAuditService(prisma as never);
    const report = await svc.auditAndPersist('u-1');
    expect(prisma.complianceCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u-1',
          targetType: 'platform-compliance-audit',
        }),
      }),
    );
    expect(report.generatedAt).toBeTruthy();
  });
});
