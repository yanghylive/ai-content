import { ApprovalGateService, computeInputHash } from './approval-gate.service';
import type { LeadActionInput } from './action-contract';

function makePrisma(overrides: Record<string, unknown> = {}) {
  const approvals: Array<Record<string, unknown>> = [];
  return {
    approval: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        return approvals.find((a) => a.inputHash === where.inputHash && a.status === 'pending') ?? null;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return approvals.find((a) => a.id === where.id) ?? null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const row = { id: `appr-${approvals.length + 1}`, ...data, status: 'pending' };
        approvals.push(row);
        return row;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const row = approvals.find((a) => a.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as never;
}

function input(over: Partial<LeadActionInput> = {}): LeadActionInput {
  return {
    tenantId: 't1',
    userId: 'u1',
    leadId: 'l1',
    action: 'send_reply',
    reason: '用户明确询价，发送回复',
    evidenceIds: ['ev-1'],
    idempotencyKey: 'k-1',
    payload: { text: '您好，价格 999' },
    ...over,
  };
}

describe('computeInputHash', () => {
  it('内容变化 → hash 变化（自动失效依据）', () => {
    const a = computeInputHash(input({ payload: { text: 'A' } }));
    const b = computeInputHash(input({ payload: { text: 'B' } }));
    expect(a).not.toBe(b);
  });

  it('evidenceIds 顺序不影响 hash', () => {
    const a = computeInputHash(input({ evidenceIds: ['x', 'y'] }));
    const b = computeInputHash(input({ evidenceIds: ['y', 'x'] }));
    expect(a).toBe(b);
  });
});

describe('ApprovalGateService', () => {
  it('low 风险（draft_reply/create_task）自动放行，不落审批表', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r = await svc.check(input({ action: 'draft_reply' }));
    expect(r.needApproval).toBe(false);
    expect(prisma.approval.create).not.toHaveBeenCalled();
  });

  it('high 风险（send_reply）强制审批，创建审批记录', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r = await svc.check(input({ action: 'send_reply' }));
    expect(r.needApproval).toBe(true);
    expect(r.riskLevel).toBe('high');
    expect(r.approvalId).toBeTruthy();
  });

  it('同 inputHash 幂等：重复 check 复用同一 pending 审批', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r1 = await svc.check(input({ action: 'send_reply' }));
    const r2 = await svc.check(input({ action: 'send_reply' }));
    expect(r2.approvalId).toBe(r1.approvalId);
    expect(prisma.approval.create).toHaveBeenCalledTimes(1);
  });

  it('approve 时内容未变 → 通过并记录 appliedAt', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r = await svc.check(input({ action: 'send_reply' }));
    const out = await svc.act({
      tenantId: 't1',
      approvalId: r.approvalId!,
      action: 'approve',
      approverId: 'approver-1',
      currentInput: input({ action: 'send_reply' }),
    });
    expect(out.status).toBe('approved');
    expect(out.appliedAt).toBeTruthy();
  });

  it('approve 时内容已变（inputHash 不匹配）→ 自动失效，抛错要求 resubmit', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r = await svc.check(input({ action: 'send_reply' }));
    await expect(
      svc.act({
        tenantId: 't1',
        approvalId: r.approvalId!,
        action: 'approve',
        approverId: 'approver-1',
        currentInput: input({ action: 'send_reply', payload: { text: '改过的文本' } }),
      }),
    ).rejects.toThrow('自动失效');
  });

  it('reject / request_changes / expire 可追溯', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r = await svc.check(input({ action: 'send_reply' }));

    const rejected = await svc.act({ tenantId: 't1', approvalId: r.approvalId!, action: 'reject', approverId: 'a1', reason: '内容不符' });
    expect(rejected.status).toBe('rejected');

    const r2 = await svc.check(input({ action: 'send_reply', reason: '再次发送，理由更充分一些' }));
    await svc.act({ tenantId: 't1', approvalId: r2.approvalId!, action: 'request_changes', approverId: 'a1' });
    await expect(
      svc.act({ tenantId: 't1', approvalId: r2.approvalId!, action: 'approve', approverId: 'a1' }),
    ).rejects.toThrow('已处理');
  });

  it('resubmit 更新 inputHash，旧审批可重新审批', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r = await svc.check(input({ action: 'send_reply' }));
    const resub = await svc.act({
      tenantId: 't1',
      approvalId: r.approvalId!,
      action: 'resubmit',
      approverId: 'a1',
      currentInput: input({ action: 'send_reply', payload: { text: 'v2 文本' } }),
    });
    expect(resub.status).toBe('resubmitted');
    // resubmit 后状态不再 pending，approve 应抛「已处理」
    await expect(
      svc.act({ tenantId: 't1', approvalId: r.approvalId!, action: 'approve', approverId: 'a1' }),
    ).rejects.toThrow('已处理');
  });

  it('跨租户审批 → 拒绝', async () => {
    const prisma = makePrisma();
    const svc = new ApprovalGateService(prisma);
    const r = await svc.check(input({ action: 'send_reply' }));
    await expect(
      svc.act({ tenantId: 'other-tenant', approvalId: r.approvalId!, action: 'approve', approverId: 'a1' }),
    ).rejects.toThrow('不在当前租户');
  });
});
