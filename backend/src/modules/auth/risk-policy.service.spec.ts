import { ForbiddenException } from '@nestjs/common';
import { RiskPolicyController } from './risk-policy.controller';
import { RiskPolicyService } from './risk-policy.service';

function makePrisma() {
  return {
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
    },
    agentConfirmation: {
      create: jest.fn().mockResolvedValue({
        id: 'approval-server-1',
        action: 'batch-touch',
        riskLevel: 'high',
        target: 'task-1',
        createdAt: new Date('2026-07-11T00:00:00.000Z'),
      }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'approval-server-1',
        tenantId: 'tenant-1',
        operator: '管理员',
        note: '已核对触达范围',
        confirmationJson: {
          kind: 'backend-risk-approval',
          expiresAt: '2099-07-11T00:05:00.000Z',
        },
      }),
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 }),
    },
  } as any;
}

describe('RiskPolicyService high-risk approvals', () => {
  it('issues a server-owned approval bound to the current user and session', async () => {
    const prisma = makePrisma();
    const service = new RiskPolicyService(prisma);

    const result = await service.issueHighRiskApproval(
      {
        action: 'batch-touch',
        riskLevel: 'high',
        target: 'task-1',
      },
      {
        userId: 'user-1',
        sessionId: 'session-1',
        operator: '管理员',
      },
    );

    expect(result).toMatchObject({
      confirmationId: 'approval-server-1',
      singleUse: true,
    });
    expect(prisma.agentConfirmation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          sessionId: 'session-1',
          action: 'batch-touch',
          status: 'approved',
          riskLevel: 'high',
          target: 'task-1',
        }),
      }),
    );
  });

  it('supports an isolated local-desktop tenant without a cloud membership', async () => {
    const prisma = makePrisma();
    prisma.tenantMember.findFirst.mockResolvedValue(null);
    const service = new RiskPolicyService(prisma);

    await service.issueHighRiskApproval(
      {
        action: 'publish',
        riskLevel: 'high',
        target: 'article-1',
      },
      {
        tenantId: 'local-desktop:user-local',
        userId: 'user-local',
        sessionId: 'session-local',
        operator: '本地用户',
      },
    );

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.agentConfirmation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'local-desktop:user-local',
          userId: 'user-local',
          sessionId: 'session-local',
        }),
      }),
    );
  });

  it('consumes a local-desktop approval atomically without a cloud membership', async () => {
    const prisma = makePrisma();
    prisma.tenantMember.findFirst.mockResolvedValue(null);
    prisma.agentConfirmation.findFirst.mockResolvedValue({
      id: 'approval-local-1',
      tenantId: 'local-desktop:user-local',
      operator: '本地用户',
      note: null,
      confirmationJson: {
        kind: 'backend-risk-approval',
        expiresAt: '2099-07-11T00:05:00.000Z',
      },
    });
    const service = new RiskPolicyService(prisma);

    await expect(
      service.consumeHighRiskApproval(
        {
          confirmationId: 'approval-local-1',
          action: 'publish',
          riskLevel: 'high',
          target: 'article-1',
        },
        {
          tenantId: 'local-desktop:user-local',
          userId: 'user-local',
          sessionId: 'session-local',
          operator: '本地用户',
        },
      ),
    ).resolves.toEqual(expect.objectContaining({ confirmed: true }));

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.agentConfirmation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'local-desktop:user-local',
          userId: 'user-local',
          sessionId: 'session-local',
        }),
      }),
    );
    expect(prisma.agentConfirmation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'approval-local-1',
          tenantId: 'local-desktop:user-local',
          status: 'approved',
        }),
      }),
    );
  });

  it('verifies an explicitly requested cloud tenant membership', async () => {
    const prisma = makePrisma();
    const service = new RiskPolicyService(prisma);

    await service.issueHighRiskApproval(
      {
        action: 'publish',
        riskLevel: 'high',
        target: 'article-1',
      },
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
        operator: '管理员',
      },
    );

    expect(prisma.tenantMember.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        status: 'active',
      },
      orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
      select: { tenantId: true },
    });
  });

  it('consumes an approval once and rejects a replay', async () => {
    const prisma = makePrisma();
    const service = new RiskPolicyService(prisma);
    const input = {
      confirmationId: 'approval-server-1',
      action: 'batch-touch',
      riskLevel: 'high',
      target: 'task-1',
      reason: '请求临时改写的原因',
    };
    const actor = {
      userId: 'user-1',
      sessionId: 'session-1',
      operator: '管理员',
    };

    await expect(
      service.consumeHighRiskApproval(input, actor),
    ).resolves.toEqual(
      expect.objectContaining({
        confirmed: true,
        confirmationId: 'approval-server-1',
        reason: '已核对触达范围',
      }),
    );
    await expect(service.consumeHighRiskApproval(input, actor)).rejects.toThrow(
      '已被使用',
    );
    expect(prisma.agentConfirmation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          sessionId: 'session-1',
          action: 'batch-touch',
          riskLevel: 'high',
          target: 'task-1',
        }),
      }),
    );
  });
});

describe('RiskPolicyController administration', () => {
  it('allows only admins to change a policy and keeps the URL action authoritative', async () => {
    const service = {
      upsertPolicy: jest.fn().mockResolvedValue({ action: 'batch-touch' }),
    };
    const controller = new RiskPolicyController(service as any);

    expect(() =>
      controller.upsertPolicy(
        { authUser: { id: 'user-1', role: 'manager' } } as any,
        'batch-touch',
        { action: 'publish', forbidden: true },
      ),
    ).toThrow(ForbiddenException);

    await controller.upsertPolicy(
      { authUser: { id: 'admin-1', role: 'admin' } } as any,
      'batch-touch',
      { action: 'publish', forbidden: true },
    );

    expect(service.upsertPolicy).toHaveBeenCalledWith({
      action: 'batch-touch',
      forbidden: true,
    });
  });
});
