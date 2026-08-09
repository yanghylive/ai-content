import {
  AI_EMPLOYEE_CAPABILITIES,
  AI_EMPLOYEE_PHASE0_SPIKES,
  buildAiEmployeeExecutorTask,
  listRouteableAiEmployeeCapabilities,
} from './ai-employee.contract';

describe('AI Employee Phase 0 contract', () => {
  it('covers the six AI employee automation domains requested for 3010', () => {
    const domains = new Set(
      AI_EMPLOYEE_CAPABILITIES.map((item) => item.domain),
    );

    expect(domains).toEqual(
      new Set([
        'douyin-acquisition',
        'wechat-service',
        'wechat-broadcast',
        'wechat-moments',
        'video-creation',
        'multi-platform-publish',
      ]),
    );
  });

  it('declares the five Phase 0 spikes with proof and exit criteria', () => {
    expect(AI_EMPLOYEE_PHASE0_SPIKES.map((item) => item.id)).toEqual([
      'P0-S1',
      'P0-S2',
      'P0-S3',
      'P0-S4',
      'P0-S5',
    ]);

    for (const spike of AI_EMPLOYEE_PHASE0_SPIKES) {
      expect(spike.capabilityKeys.length).toBeGreaterThan(0);
      expect(spike.proofRequired.length).toBeGreaterThan(0);
      expect(spike.exitCriteria.length).toBeGreaterThan(0);
    }
  });

  it('maps routeable capabilities to existing Runtime executor task types', () => {
    const routeable = listRouteableAiEmployeeCapabilities();
    expect(routeable.length).toBeGreaterThanOrEqual(8);

    for (const capability of routeable) {
      expect(capability.executorTaskType).toBeDefined();
      expect(capability.runtimePath).not.toBe('not-integrated');
    }

    const task = buildAiEmployeeExecutorTask({
      capabilityKey: 'publish-douyin-video',
      relatedId: 'ai-employee-phase0-test',
      relatedType: 'agent-session',
      accountId: 'douyin-account-1',
      payload: { title: 'Phase 0 smoke', platformType: 3 },
    });

    expect(task).toMatchObject({
      relatedId: 'ai-employee-phase0-test',
      relatedType: 'agent-session',
      type: 'platform-publish-video',
      platform: 'douyin',
      accountId: 'douyin-account-1',
      payload: {
        aiEmployeeCapability: 'publish-douyin-video',
        aiEmployeeDomain: 'multi-platform-publish',
        title: 'Phase 0 smoke',
        platformType: 3,
      },
    });
  });

  it('routes targeted and retention Douyin exposure through read-only runtime tasks', () => {
    const routeableKeys = new Set(
      listRouteableAiEmployeeCapabilities().map((item) => item.key),
    );

    expect(routeableKeys.has('douyin-targeted-exposure')).toBe(true);
    expect(routeableKeys.has('douyin-retention-exposure')).toBe(true);

    const targetedTask = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-targeted-exposure',
      relatedId: 'targeted-contract',
      relatedType: 'agent-session',
      accountId: 'douyin-account-1',
      payload: { targetAccounts: ['account-a'] },
    });
    const retentionTask = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-retention-exposure',
      relatedId: 'retention-contract',
      relatedType: 'agent-session',
      accountId: 'douyin-account-1',
      payload: { retentionSourceId: '表单线索' },
    });

    expect(targetedTask).toMatchObject({
      type: 'douyin-targeted-exposure',
      platform: 'douyin',
      payload: {
        aiEmployeeCapability: 'douyin-targeted-exposure',
        aiEmployeeDomain: 'douyin-acquisition',
        targetAccounts: ['account-a'],
      },
    });
    expect(retentionTask).toMatchObject({
      type: 'douyin-retention-exposure',
      platform: 'douyin',
      payload: {
        aiEmployeeCapability: 'douyin-retention-exposure',
        aiEmployeeDomain: 'douyin-acquisition',
        retentionSourceId: '表单线索',
      },
    });
  });

  it('routes Douyin exposure and video clip contracts to runtime tasks', () => {
    const exposureTask = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-link-exposure',
      relatedId: 'exposure-contract',
      relatedType: 'agent-session',
      accountId: 'douyin-account-1',
      payload: { links: ['https://v.douyin.com/test/'] },
    });

    expect(exposureTask).toMatchObject({
      type: 'douyin-link-exposure',
      platform: 'douyin',
      accountId: 'douyin-account-1',
      payload: {
        aiEmployeeCapability: 'douyin-link-exposure',
        aiEmployeeDomain: 'douyin-acquisition',
        links: ['https://v.douyin.com/test/'],
      },
    });

    const videoTask = buildAiEmployeeExecutorTask({
      capabilityKey: 'video-template-clip',
      relatedId: 'video-contract',
      relatedType: 'agent-session',
      payload: {
        materialPath: '/tmp/material.mp4',
        templateName: '产品卖点模板',
      },
    });

    expect(videoTask).toMatchObject({
      type: 'video-template-clip',
      platform: 'mixed',
      payload: {
        aiEmployeeCapability: 'video-template-clip',
        aiEmployeeDomain: 'video-creation',
        materialPath: '/tmp/material.mp4',
        templateName: '产品卖点模板',
      },
    });

    const contactAddTask = buildAiEmployeeExecutorTask({
      capabilityKey: 'wechat-contact-add',
      relatedId: 'wechat-contact-add-contract',
      relatedType: 'agent-session',
      payload: {
        targets: ['客户A'],
        verifyMessage: '你好，想了解一下你的需求',
      },
    });

    expect(contactAddTask).toMatchObject({
      type: 'wechat-contact-add',
      platform: 'wechat-desktop',
      payload: {
        aiEmployeeCapability: 'wechat-contact-add',
        aiEmployeeDomain: 'wechat-broadcast',
      },
    });

    const momentsMarketingTask = buildAiEmployeeExecutorTask({
      capabilityKey: 'wechat-moments-marketing',
      relatedId: 'wechat-moments-marketing-contract',
      relatedType: 'agent-session',
      payload: {
        mode: 'targeted',
      },
    });

    expect(momentsMarketingTask).toMatchObject({
      type: 'wechat-moments-marketing',
      platform: 'wechat-desktop',
      payload: {
        aiEmployeeCapability: 'wechat-moments-marketing',
        aiEmployeeDomain: 'wechat-moments',
      },
    });

    const hotVideoTask = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-hot-video-exposure',
      relatedId: 'douyin-hot-video-contract',
      relatedType: 'agent-session',
      accountId: 'douyin-account-1',
      payload: {
        searchKeywords: ['装修'],
      },
    });

    expect(hotVideoTask).toMatchObject({
      type: 'douyin-hot-video-exposure',
      platform: 'douyin',
      accountId: 'douyin-account-1',
      payload: {
        aiEmployeeCapability: 'douyin-hot-video-exposure',
        aiEmployeeDomain: 'douyin-acquisition',
        searchKeywords: ['装修'],
      },
    });
  });
});
