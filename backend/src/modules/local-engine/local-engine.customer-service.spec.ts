import { LocalEngineService } from './local-engine.service';
import type { InteractionReplyRuleConfig } from './local-engine.types';

describe('LocalEngineService customer-service decisions', () => {
  function makeService() {
    return Object.create(LocalEngineService.prototype) as any;
  }

  function defaultRule(service: any): InteractionReplyRuleConfig {
    return LocalEngineService.prototype['createDefaultReplyRule'].call(service);
  }

  function decide(
    service: any,
    rule: InteractionReplyRuleConfig,
    input: Record<string, unknown>,
  ) {
    return LocalEngineService.prototype[
      'evaluateCustomerServiceReplyDecision'
    ].call(service, rule, {
      sourceText: '请问今天可以预约吗？',
      accountName: '微信客服号',
      targetName: '张先生',
      platform: 'wechat',
      contactLabels: ['老客户'],
      commercialExecutionAllowed: true,
      knowledge: { scope: 'none', available: true },
      now: new Date('2026-07-11T12:00:00.000Z'),
      ...input,
    });
  }

  it('uses no-reply scenarios before generation or task creation', () => {
    const service = makeService();
    const rule = {
      ...defaultRule(service),
      noReplyScenarios: ['退款'],
      blockedKeywords: [],
      whitelist: [],
      knowledgeScope: 'none' as const,
    };

    const decision = decide(service, rule, {
      sourceText: '我要退款，请不要再联系我。',
    });

    expect(decision).toEqual(
      expect.objectContaining({
        action: 'no-reply',
        sendMode: 'draft-only',
        canGenerate: false,
        canCreateTask: false,
        matchedRules: expect.objectContaining({ noReply: ['退款'] }),
      }),
    );
  });

  it('applies account binding, contact scope, whitelist, delay and file rules together', () => {
    const service = makeService();
    const rule = {
      ...defaultRule(service),
      authorizedAccounts: ['微信客服号'],
      contactScope: 'wechat' as const,
      whitelist: ['老客户'],
      noReplyScenarios: [],
      blockedKeywords: [],
      requireApprovalKeywords: [],
      replyDelay: '20-45 秒',
      fileRequestPolicy: '客户要求文件时先转人工确认。',
      knowledgeScope: 'none' as const,
    };

    const accepted = decide(service, rule, {});
    expect(accepted.contact).toEqual({
      platform: 'wechat',
      accountBound: true,
      scopeMatched: true,
      whitelisted: true,
    });
    expect(accepted.delay).toEqual({
      minSeconds: 20,
      maxSeconds: 45,
      selectedSeconds: 20,
      notBefore: '2026-07-11T12:00:20.000Z',
    });

    const fileRequest = decide(service, rule, {
      sourceText: '请把报价单文件发给我。',
    });
    expect(fileRequest).toEqual(
      expect.objectContaining({
        action: 'review',
        sendMode: 'approval-send',
        fileRequest: true,
      }),
    );

    const outsideScope = decide(service, rule, {
      accountName: '抖音门店号',
      platform: 'douyin',
      contactLabels: ['新客户'],
    });
    expect(outsideScope.action).toBe('no-reply');
    expect(outsideScope.contact).toEqual({
      platform: 'douyin',
      accountBound: false,
      scopeMatched: false,
      whitelisted: false,
    });
  });

  it('does not call AI when the shared decision path says no reply', async () => {
    const service = makeService();
    const rule = {
      ...defaultRule(service),
      noReplyScenarios: ['退款'],
      blockedKeywords: [],
      whitelist: [],
      knowledgeScope: 'none' as const,
    };
    service.ensureTaskStore = jest.fn(async () => undefined);
    service.loadReplyRuleFromStore = jest.fn(async () => rule);
    service.currentActorCommercialAllowed = jest.fn(() => true);
    service.allowLocalPlanBypass = jest.fn(() => false);
    service.tryGenerateInteractionReplyWithAi = jest.fn(async () => '不应生成');

    const result = await service.generateInteractionReply({
      sourceText: '我要退款。',
      accountName: '微信客服号',
      platform: 'wechat',
    });

    expect(result.replyText).toBe('');
    expect(result.decision.action).toBe('no-reply');
    expect(service.tryGenerateInteractionReplyWithAi).not.toHaveBeenCalled();
  });

  it('uses only the selected knowledge item when selected scope is configured', async () => {
    const service = makeService();
    const rule = {
      ...defaultRule(service),
      authorizedAccounts: [],
      whitelist: [],
      noReplyScenarios: [],
      blockedKeywords: [],
      requireApprovalKeywords: [],
      replyDelay: '立即',
      knowledgeScope: 'selected' as const,
      selectedKnowledgeId: 'knowledge-1',
    };
    service.ensureTaskStore = jest.fn(async () => undefined);
    service.loadReplyRuleFromStore = jest.fn(async () => rule);
    service.currentActorCommercialAllowed = jest.fn(() => true);
    service.allowLocalPlanBypass = jest.fn(() => false);
    service.prisma = {
      material: {
        findFirst: jest.fn(async () => ({
          id: 'knowledge-1',
          title: '门店营业说明',
          content: '门店周一到周五营业，周末需提前预约。',
          summary: '',
        })),
      },
    };
    service.defaultModels = {
      getDefaults: jest.fn(async () => ({ articleCreation: 'model-1' })),
    };
    service.aiClient = {
      generate: jest.fn(async () => '周末可以预约，请告诉我您方便的时间。'),
    };

    const result = await service.generateInteractionReply({
      sourceText: '周末营业吗？',
      accountName: '微信客服号',
      platform: 'wechat',
      contactLabels: ['老客户'],
    });

    expect(result.replyText).toBe('周末可以预约，请告诉我您方便的时间。');
    expect(result.decision.knowledge).toEqual(
      expect.objectContaining({
        scope: 'selected',
        selectedKnowledgeId: 'knowledge-1',
        selectedKnowledgeTitle: '门店营业说明',
        available: true,
      }),
    );
    expect(service.aiClient.generate).toHaveBeenCalledWith(
      'model-1',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('门店周一到周五营业'),
        }),
      ]),
      expect.objectContaining({
        knowledgeMode: 'off',
        knowledgeQuery: undefined,
      }),
    );
  });

  it('blocks the direct desktop path before any WeChat work for no-reply or delay', async () => {
    const service = makeService();
    service.tryRunWindowsWechatNativeControlledTask = jest.fn();

    await expect(
      service.sendApprovedWechatTask({
        metadata: {
          customerServiceNoReply: true,
          customerServiceDecision: { action: 'no-reply' },
        },
      }),
    ).rejects.toThrow('不自动回复');
    expect(
      service.tryRunWindowsWechatNativeControlledTask,
    ).not.toHaveBeenCalled();

    await expect(
      service.sendApprovedWechatTask({
        metadata: {
          customerServiceNotBefore: '2999-01-01T00:00:00.000Z',
        },
      }),
    ).rejects.toThrow('本次没有发送');
    expect(
      service.tryRunWindowsWechatNativeControlledTask,
    ).not.toHaveBeenCalled();
  });
});
