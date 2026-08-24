import {
  executeSavingsConfirmation,
  approveAgentConfirmation,
} from './local-engine.agent.mixin';

// 风控闸门在本单测中放行（只验证 Stage 2 储蓄闭环路由，不重复测风控）
jest.mock('../auth/risk-control', () => ({
  assertBackendRiskGate: jest.fn(() => ({ ok: true, decision: 'allow' })),
}));

function baseConfirmation(over: Record<string, unknown> = {}): any {
  return {
    id: 'cf-1',
    sessionId: 'sess-1',
    tenantId: 'legacy-local-desktop',
    userId: 'legacy-local-user',
    title: 'AI 额度兑换',
    description: '兑换',
    actionLabel: '兑换 ¥10 → AI 额度',
    riskLevel: 'high',
    status: 'pending',
    requiredChecks: [],
    createdAt: new Date().toISOString(),
    savings: {
      tool: 'savings.exchange',
      amount: 10,
      idempotencyKey: 'idem-1',
      source: 'ai-assistant',
    },
    ...over,
  };
}

function makeHost(savings: Record<string, unknown> = {}): any {
  const host: any = {
    savingsExchange: savings.savingsExchange,
    savingsWithdrawal: savings.savingsWithdrawal,
    prisma: {},
    authRequestContext: { get: () => ({ user: { id: 'legacy-local-user' } }) },
    agentConfirmations: new Map(),
    resolveTenantScope: jest.fn(async () => ({
      tenantId: 'local-desktop:legacy-local-user',
      userId: 'legacy-local-user',
    })),
    isInTenantScope: jest.fn(() => false),
    getAgentConfirmation: jest.fn(),
    syncAgentConfirmationIntoSession: jest.fn(),
    recordRemoteAudit: jest.fn(),
    pushAgentEvent: jest.fn(),
    persistAgentConfirmation: jest.fn(async () => undefined),
    persistAgentSession: jest.fn(async () => undefined),
    resumeAgentSessionAfterApproval: jest.fn(async () => undefined),
    createSyntheticSessionForConfirmation: jest.fn((c: any) => ({
      id: c.sessionId,
      status: 'running',
      statusLabel: '执行中',
      nextAction: '',
      events: [],
    })),
  };
  host.executeSavingsConfirmation = executeSavingsConfirmation;
  host.approveAgentConfirmation = approveAgentConfirmation;
  return host;
}

describe('Stage 2 返利/提现 AI 工具闭环', () => {
  it('兑换确认审批后真实调用 exchange 并标记成功', async () => {
    const exchange = jest.fn(async ({ amount, idempotencyKey }: any) => ({
      exchangeId: 'ex-1',
      rebateAmount: amount,
      rate: 33.4,
      creditAmount: Number((amount * 33.4).toFixed(2)),
      status: 'SUCCESS',
    }));
    const host = makeHost({ savingsExchange: { exchange } });
    const confirmation = baseConfirmation();
    const session = await executeSavingsConfirmation.call(host, confirmation, {
      operator: '用户',
    });
    expect(exchange).toHaveBeenCalledWith({
      amount: 10,
      idempotencyKey: 'idem-1',
    });
    expect(confirmation.status).toBe('approved');
    expect(session.status).toBe('completed');
    expect(session.nextAction).toContain('兑换成功');
  });

  it('提现确认（mock 渠道）审批后真实调用 withdraw 并标记成功', async () => {
    const withdraw = jest.fn(
      async ({ amount, channel, accountMask, idempotencyKey }: any) => ({
        withdrawalId: 'wd-1',
        status: 'PROCESSING',
        amount,
        channel,
        accountMask,
        idempotencyKey,
      }),
    );
    const host = makeHost({ savingsWithdrawal: { withdraw } });
    const confirmation = baseConfirmation({
      savings: {
        tool: 'savings.withdraw',
        amount: 10,
        channel: 'mock',
        accountMask: '尾号8868',
        idempotencyKey: 'idem-2',
        source: 'ai-assistant',
      },
    });
    const session = await executeSavingsConfirmation.call(host, confirmation, {
      operator: '用户',
    });
    expect(withdraw).toHaveBeenCalledWith({
      amount: 10,
      channel: 'mock',
      accountMask: '尾号8868',
      idempotencyKey: 'idem-2',
    });
    expect(confirmation.status).toBe('approved');
    expect(session.status).toBe('completed');
  });

  it('真实服务抛错（渠道未开通/余额不足/实名缺失）时回写 rejected 且会话失败，绝不伪造成功', async () => {
    const withdraw = jest.fn(async () => {
      throw new Error('提现渠道「alipay」未开通');
    });
    const host = makeHost({ savingsWithdrawal: { withdraw } });
    const confirmation = baseConfirmation({
      savings: {
        tool: 'savings.withdraw',
        amount: 10,
        channel: 'alipay',
        accountMask: '尾号8868',
        idempotencyKey: 'idem-3',
        source: 'ai-assistant',
      },
    });
    const session = await executeSavingsConfirmation.call(host, confirmation, {
      operator: '用户',
    });
    expect(withdraw).toHaveBeenCalled();
    expect(confirmation.status).toBe('rejected');
    expect(session.status).toBe('failed');
    expect(session.nextAction).toContain('储蓄操作失败');
  });

  it('approveAgentConfirmation 对 savings 确认走真实服务分支，不续跑本机会话', async () => {
    const exchange = jest.fn(async ({ amount, idempotencyKey }: any) => ({
      exchangeId: 'ex-1',
      rebateAmount: amount,
      rate: 33.4,
      creditAmount: Number((amount * 33.4).toFixed(2)),
      status: 'SUCCESS',
    }));
    const host = makeHost({ savingsExchange: { exchange } });
    const confirmation = baseConfirmation();
    const sessionObj = { id: 'sess-1', executionScope: 'browser', status: 'running' };
    host.getAgentConfirmation.mockResolvedValue({ confirmation, session: sessionObj });
    const session = await approveAgentConfirmation.call(
      host,
      'cf-1',
      { operator: '用户' },
      {},
    );
    expect(exchange).toHaveBeenCalledWith({
      amount: 10,
      idempotencyKey: 'idem-1',
    });
    expect(host.resumeAgentSessionAfterApproval).not.toHaveBeenCalled();
    expect(session.status).toBe('completed');
  });

  it('重复确认（status 非 pending）直接返回，不二次执行', async () => {
    const exchange = jest.fn(async () => ({
      exchangeId: 'ex-1',
      rebateAmount: 10,
      rate: 33.4,
      creditAmount: 334,
      status: 'SUCCESS',
    }));
    const host = makeHost({ savingsExchange: { exchange } });
    const confirmation = baseConfirmation({ status: 'approved' });
    const sessionObj = { id: 'sess-1', executionScope: 'browser', status: 'running' };
    host.getAgentConfirmation.mockResolvedValue({ confirmation, session: sessionObj });
    await approveAgentConfirmation.call(host, 'cf-1', { operator: '用户' }, {});
    expect(exchange).not.toHaveBeenCalled();
  });

  it('确认过期（status=expired）不执行', async () => {
    const exchange = jest.fn(async () => ({
      exchangeId: 'ex-1',
      rebateAmount: 10,
      rate: 33.4,
      creditAmount: 334,
      status: 'SUCCESS',
    }));
    const host = makeHost({ savingsExchange: { exchange } });
    const confirmation = baseConfirmation({ status: 'expired' });
    const sessionObj = { id: 'sess-1', executionScope: 'browser', status: 'running' };
    host.getAgentConfirmation.mockResolvedValue({ confirmation, session: sessionObj });
    await approveAgentConfirmation.call(host, 'cf-1', { operator: '用户' }, {});
    expect(exchange).not.toHaveBeenCalled();
  });
});
