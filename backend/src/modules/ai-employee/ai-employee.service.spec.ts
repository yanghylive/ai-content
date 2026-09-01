import {
  AiEmployeeService,
  type P2WechatReadinessInput,
} from './ai-employee.service';
import type { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import type { LocalEngineService } from '../local-engine/local-engine.service';
import type { AuthRequestContextService } from '../../common/auth-request-context.service';
import type { CrmService } from '../crm/crm.service';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeRuntimeMock() {
  return {
    execute: jest.fn().mockResolvedValue({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '已采集 1 条候选评论',
      technicalMessage: 'read-only done',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
      },
      evidence: [
        {
          type: 'screenshot',
          label: 'douyin-link-exposure-read',
          value: '/api/local-engine/browser/evidence/test.png',
          path: '/tmp/test.png',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ],
      readback: {
        expectedText: 'candidate-comments',
        actualText: JSON.stringify([
          {
            sourceUrl: 'https://www.douyin.com/video/1',
            text: '想了解一下',
            index: 0,
            kind: 'comment',
          },
        ]),
        matched: true,
      },
    }),
  } as unknown as jest.Mocked<RuntimeOrchestrator>;
}

function makeLocalEngineMock() {
  return {
    listAgentSessions: jest.fn().mockResolvedValue([]),
    createAgentSession: jest.fn(),
    getAgentSession: jest.fn(),
    stopAgentSession: jest.fn(),
    archiveAgentSession: jest.fn(),
    getReadiness: jest.fn().mockResolvedValue({
      ready: false,
      summary: { blockers: 1, warnings: 0 },
      blockers: [
        {
          nextAction: '请先完成本机检查。',
        },
      ],
      warnings: [],
    }),
    getExecutorsStatus: jest.fn().mockResolvedValue({
      executors: [],
    }),
  } as unknown as LocalEngineService;
}

function makeVideoWorkshopMock() {
  return {
    clipWithTemplate: jest.fn().mockResolvedValue({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      message: '已生成剪辑结果：/tmp/out.mp4',
      evidence: [],
      candidates: [],
    }),
  };
}

function makeCrmServiceMock() {
  return {
    captureAutoAcquisitionLeads: jest.fn().mockResolvedValue({
      enabled: true,
      capturedCount: 1,
      skippedCount: 0,
      message: '已沉淀 1 条自动获客线索到 CRM',
    }),
  } as unknown as jest.Mocked<CrmService>;
}

function makeAutoUploadServiceMock(accounts: unknown[]) {
  return {
    listAccounts: jest.fn().mockResolvedValue(accounts),
  };
}

function makeAuthRequestContextMock(userId = 'operator-1') {
  return {
    get: jest.fn(() => ({
      user: {
        id: userId,
        kaypalUserId: 'kaypal-user-1',
        kaypalDesktopAccessToken: 'desktop-token',
      },
    })),
  } as unknown as jest.Mocked<AuthRequestContextService>;
}

function makeConfigMock(values: Record<string, string>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function mockKaypalBillingFetch() {
  const fetchMock = jest.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes('/api/billing/reserve')) {
      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'credit-reservation-1',
          amount: 30,
          balance: 1000,
          frozenBalance: 30,
          availableBalance: 970,
          billing: {
            amount: 30,
            policyVersion: 'commercial-credit-v1-2026-06-29',
          },
        }),
      });
    }
    if (url.includes('/api/billing/capture')) {
      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'entropy-transaction-1',
          amount: 17,
          balanceAfter: 983,
          billing: {
            amount: 17,
            policyVersion: 'commercial-credit-v1-2026-06-29',
          },
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: 'credit-reservation-1',
        amount: 30,
        status: 'released',
      }),
    });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function waitForRuntimeCalls(
  runtime: jest.Mocked<RuntimeOrchestrator>,
  count: number,
) {
  for (let index = 0; index < 50; index += 1) {
    if (runtime.execute.mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function readyP2Input(
  overrides: Partial<P2WechatReadinessInput> = {},
): P2WechatReadinessInput {
  return {
    desktopOnline: true,
    agentConnected: true,
    sessionReadable: true,
    sessionConfirmed: true,
    contactName: '张三',
    latestMessageCount: 2,
    replyText: '您好，我先发您资料。',
    replyTaskCount: 1,
    replyCompletedCount: 1,
    groupTargetCount: 3,
    groupTagCount: 1,
    groupDailyLimit: 20,
    groupIntervalSeconds: 30,
    groupMessage: '今天有活动。',
    groupTaskCount: 1,
    groupPausedCount: 0,
    groupResumableCount: 0,
    groupCompletedCount: 1,
    groupFailedCount: 0,
    contactTaskCount: 1,
    contactCompletedCount: 1,
    contactTargetCount: 2,
    contactDailyLimit: 10,
    contactFailedCount: 0,
    momentsPublishTaskCount: 1,
    momentsPublishCompletedCount: 1,
    momentsPublishFailedCount: 0,
    momentsPublishRemainingCount: 0,
    momentsContent: '新品活动开始了。',
    momentsAssetPath: '/tmp/moments.jpg',
    momentsDailyCount: 1,
    momentsMarketingTaskCount: 1,
    momentsMarketingCompletedCount: 1,
    momentsMarketingFailedCount: 0,
    momentsMarketingRemainingCount: 0,
    momentsMarketingDailyLimit: 20,
    momentsMarketingMode: 'random',
    videoClipTaskCount: 1,
    videoClipCompletedCount: 1,
    videoClipFailedCount: 0,
    videoMaterialPath: '/tmp/materials',
    videoTemplateName: '产品种草模板',
    videoOutputPath: '/tmp/output.mp4',
    publishAccountCount: 1,
    publishMaterialPath: '/tmp/output.mp4',
    publishTitle: '新品活动',
    publishCopy: '新品活动开始了。',
    publishDailyLimit: 1,
    publishDailyTimes: ['10:00'],
    publishPreflightOk: true,
    publishResultCount: 1,
    publishFailedCount: 0,
    publishSuccessCount: 1,
    publishPendingCount: 0,
    evidenceCount: 5,
    ...overrides,
  };
}

function makeVideoWorkshopMock() {
  return {
    clipWithTemplate: jest.fn().mockResolvedValue({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      message: '已生成剪辑结果：/tmp/out.mp4',
      evidence: [],
      candidates: [],
    }),
  };
}

describe('AiEmployeeService', () => {
  const originalGrowthExecutionEnabled = process.env.GROWTH_EXECUTION_ENABLED;
  const originalLegacyScheduler =
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
  const originalGrowthRealDaemonAllowed =
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
    delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
    delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    mockKaypalBillingFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalGrowthExecutionEnabled === undefined) {
      delete process.env.GROWTH_EXECUTION_ENABLED;
    } else {
      process.env.GROWTH_EXECUTION_ENABLED = originalGrowthExecutionEnabled;
    }
    if (originalLegacyScheduler === undefined) {
      delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
    } else {
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER =
        originalLegacyScheduler;
    }
    if (originalGrowthRealDaemonAllowed === undefined) {
      delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    } else {
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED =
        originalGrowthRealDaemonAllowed;
    }
  });

  it('blocks legacy auto acquisition execution when the real-touch switch is off', async () => {
    delete process.env.GROWTH_EXECUTION_ENABLED;
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    await expect(
      service.executeAutoAcquisitionConfig('legacy-config'),
    ).rejects.toThrow('真实触达总开关未开启');
  });

  it('keeps the legacy auto acquisition scheduler unarmed without explicit real daemon permission', () => {
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER = 'true';
    delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    service.onModuleInit();

    expect((service as any).autoAcquisitionScheduler).toBeUndefined();
  });

  it('lists AI employee history by metadata instead of title keyword', async () => {
    const runtime = makeRuntimeMock();
    const localEngine =
      makeLocalEngineMock() as jest.Mocked<LocalEngineService>;
    localEngine.listAgentSessions.mockResolvedValue([
      {
        id: 'session-without-title-keyword',
        title: '朋友圈发布计划',
        instruction: 'publish moments',
        status: 'waiting_for_confirmation',
        statusLabel: '待继续',
        executionScope: 'desktop',
        source: 'interaction',
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
        targetApp: '微信',
        riskLevel: 'high',
        metadata: { aiEmployee: 'kaypal-ai-employee' },
        confirmations: [],
        events: [],
      },
      {
        id: 'ordinary-interaction',
        title: 'AI员工 字样但不是本模块',
        instruction: 'not ai employee metadata',
        status: 'running',
        statusLabel: '运行中',
        executionScope: 'mixed',
        source: 'interaction',
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
        targetApp: '其它',
        riskLevel: 'medium',
        metadata: {},
        confirmations: [],
        events: [],
      },
    ] as any);
    const service = new AiEmployeeService(runtime, localEngine);

    const sessions = await service.listSessions(10);

    expect(localEngine.listAgentSessions).toHaveBeenCalledWith(30, {
      source: 'interaction',
    });
    expect(sessions.map((session) => session.id)).toEqual([
      'session-without-title-keyword',
    ]);
  });

  it('persists a runnable workflow definition without creating a session or executing it', async () => {
    const previousStorePath = process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-workflow-'));
    process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH = join(
      storeDir,
      'workflows.json',
    );
    const localEngine =
      makeLocalEngineMock() as jest.Mocked<LocalEngineService>;
    localEngine.getExecutorsStatus.mockResolvedValue({
      executors: [
        {
          key: 'douyin-link-exposure',
          name: '抖音获客',
          status: 'ready',
          message: '可用',
          nextAction: '读取候选。',
        },
      ],
    } as any);
    const runtime = makeRuntimeMock();
    const service = new AiEmployeeService(runtime, localEngine);

    try {
      const result = await service.prepareWorkflow({
        title: '每日链接线索读取',
        accountId: 'douyin-1',
        workflow: {
          platform: 'douyin',
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
        },
      });

      expect(result).toMatchObject({
        taskType: 'workflow.auto',
        executionMode: 'configured',
        displayStatus: 'ready',
        message: '工作流已保存，可以启动。',
        definition: { status: 'ready' },
      });
      expect(result.steps).toEqual([
        expect.objectContaining({
          capabilityKey: 'douyin-link-exposure',
          actionKind: 'candidate_read',
          availability: 'available',
        }),
      ]);
      expect(localEngine.createAgentSession).not.toHaveBeenCalled();
      expect(runtime.execute).not.toHaveBeenCalled();
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('uses the commercial executor capability for workflow customer actions', async () => {
    const previousStorePath = process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-workflow-action-'));
    process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH = join(
      storeDir,
      'workflows.json',
    );
    const localEngine =
      makeLocalEngineMock() as jest.Mocked<LocalEngineService>;
    localEngine.getExecutorsStatus.mockResolvedValue({
      executors: [
        {
          key: 'douyin-link-exposure',
          name: '候选读取',
          status: 'missing',
          message: '候选读取不可用',
          nextAction: '修复候选读取',
        },
        {
          key: 'douyin-comment-reply',
          name: '抖音评论',
          status: 'ready',
          message: '评论执行器可用',
          nextAction: '确认后发送',
        },
      ],
    } as any);
    const service = new AiEmployeeService(makeRuntimeMock(), localEngine);

    try {
      const result = await service.prepareWorkflow({
        title: '抖音客户评论',
        accountId: 'douyin-1',
        workflow: {
          platform: 'douyin',
          exposureMode: 'link',
          exposureExecutionKind: 'customer_action',
          customerAction: {
            action: 'comment',
            targetName: '潜在客户',
            targetText: '想了解报价',
            sourceUrl: 'https://www.douyin.com/video/1',
            replyText: '可以发你一份报价参考。',
          },
        },
      });

      expect(result.definition.status).toBe('ready');
      expect(result.steps[0]).toMatchObject({
        capabilityKey: 'douyin-comment-reply',
        actionKind: 'customer_action',
        availability: 'available',
        taskType: 'douyin-comment-reply',
      });
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('runs Douyin link leads through RuntimeOrchestrator and returns candidates', async () => {
    const runtime = makeRuntimeMock();
    const videoWorkshop = makeVideoWorkshopMock();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      videoWorkshop as never,
    );

    const result = await service.findDouyinLeadsByLink({
      accountId: 'douyin-1',
      link: 'https://v.douyin.com/test/',
      limit: 5,
    });

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-link-exposure',
        platform: 'douyin',
        accountId: 'douyin-1',
        payload: expect.objectContaining({
          links: ['https://v.douyin.com/test/'],
          filters: expect.objectContaining({
            commentLimit: 5,
            commentTimeMatch: '7days',
          }),
        }),
      }),
      expect.objectContaining({
        sendMode: 'draft-only',
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([
      expect.objectContaining({ text: '想了解一下', kind: 'comment' }),
    ]);
    expect(result.evidence[0]).toMatchObject({
      type: 'screenshot',
      url: '/api/local-engine/browser/evidence/test.png',
    });
  });

  it('normalizes invalid Douyin candidate numbers before returning them', async () => {
    const runtime = makeRuntimeMock();
    runtime.execute.mockResolvedValueOnce({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '已采集 1 条候选评论',
      technicalMessage: 'read-only done',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
      },
      evidence: [],
      readback: {
        expectedText: 'candidate-comments',
        actualText: JSON.stringify([
          {
            text: '想了解加盟费用',
            index: Number.POSITIVE_INFINITY,
            engagementScore: 'NaN',
            likeCount: -3,
            commentCount: 4.8,
            shareCount: 'bad',
            score: Number.NaN,
          },
        ]),
        matched: true,
      },
    });
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    const result = await service.findDouyinLeadsByLink({
      accountId: 'douyin-1',
      link: 'https://v.douyin.com/test/',
      limit: 5,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        text: '想了解加盟费用',
        index: 0,
        engagementScore: 0,
        likeCount: 0,
        commentCount: 4,
        shareCount: 0,
        score: 0,
      }),
    ]);
  });

  it('runs Douyin keyword leads through RuntimeOrchestrator', async () => {
    const runtime = makeRuntimeMock();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    await service.findDouyinLeadsByKeyword({
      accountId: 'douyin-1',
      keyword: '装修',
      limit: 3,
      commentTimeMatch: 'today',
    });

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-search-account-exposure',
        payload: expect.objectContaining({
          searchKeywords: ['装修'],
          filters: expect.objectContaining({
            resultLimit: 3,
            commentTimeMatch: 'today',
          }),
        }),
      }),
      expect.objectContaining({
        sendMode: 'draft-only',
      }),
    );
  });

  it('runs Douyin hot video leads through RuntimeOrchestrator', async () => {
    const runtime = makeRuntimeMock();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    await service.findDouyinHotVideoLeads({
      accountId: 'douyin-1',
      keyword: '餐饮加盟',
      limit: 8,
      commentTimeMatch: 'bad-value',
      blacklistNicknames: ['小糯人工智能002'],
    });

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-hot-video-exposure',
        platform: 'douyin',
        payload: expect.objectContaining({
          searchKeywords: ['餐饮加盟'],
          filters: expect.objectContaining({
            resultLimit: 8,
            preferVideoResults: true,
            preferHighEngagement: true,
            commentTimeMatch: '7days',
            blacklistNicknames: ['小糯人工智能002'],
          }),
        }),
      }),
      expect.objectContaining({
        sendMode: 'draft-only',
      }),
    );
  });

  it('runs Douyin targeted and retention leads through RuntimeOrchestrator', async () => {
    const runtime = makeRuntimeMock();
    const service = new AiEmployeeService(runtime, makeLocalEngineMock());

    await service.findDouyinTargetedLeads({
      accountId: 'douyin-1',
      targetAccounts: ['客户A', '客户B'],
      limit: 6,
      commentTimeMatch: 'yesterday',
    });
    await service.findDouyinRetentionLeads({
      accountId: 'douyin-1',
      retentionSourceId: '表单线索',
      keyword: '装修留资',
      limit: 4,
      commentTimeMatch: '30days',
    });

    expect(runtime.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'douyin-targeted-exposure',
        platform: 'douyin',
        payload: expect.objectContaining({
          targetAccounts: ['客户A', '客户B'],
          searchKeywords: ['客户A', '客户B'],
          filters: expect.objectContaining({
            resultLimit: 6,
            commentTimeMatch: 'yesterday',
            targetedMode: true,
          }),
        }),
      }),
      expect.objectContaining({ sendMode: 'draft-only' }),
    );
    expect(runtime.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'douyin-retention-exposure',
        platform: 'douyin',
        payload: expect.objectContaining({
          retentionSourceId: '表单线索',
          searchKeywords: ['装修留资'],
          filters: expect.objectContaining({
            resultLimit: 4,
            commentTimeMatch: '30days',
            retentionMode: true,
          }),
        }),
      }),
      expect.objectContaining({ sendMode: 'draft-only' }),
    );
  });

  it('builds a P1 Douyin follow-up plan with scoring, copy and daily limit', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '爆款视频获客',
      sourceText: '餐饮加盟',
      accountName: '测试抖音',
      privateMessage: '可以发你加盟资料。',
      commentTemplates: ['评论模板：{topic} / {comment}'],
      messageTemplates: ['私信模板：{message} / {topic} / {comment}'],
      dailyLimit: 2,
      maxTargets: 3,
      candidates: [
        {
          text: '想了解加盟多少钱，怎么联系',
          sourceUrl: 'https://www.douyin.com/video/1',
          targetName: '高意向客户',
          profileUrl: 'https://www.douyin.com/user/lead-1',
          commentTime: '今天',
          videoTitle: '餐饮加盟案例',
          videoUrl: 'https://www.douyin.com/video/1',
          engagementScore: 9800,
          kind: 'comment',
          index: 0,
        },
        {
          text: '想了解加盟多少钱，怎么联系',
          sourceUrl: 'https://www.douyin.com/video/1',
          kind: 'comment',
          index: 1,
        },
        {
          text: '需要资料，怎么报名',
          sourceUrl: 'https://www.douyin.com/video/2',
          kind: 'comment',
          index: 2,
        },
        {
          text: '哈哈',
          sourceUrl: 'https://www.douyin.com/video/3',
          kind: 'comment',
          index: 3,
        },
      ],
    });

    expect(plan.summary).toMatchObject({
      totalCandidates: 4,
      selectedCount: 2,
      skippedCount: 2,
      commentTaskCount: 2,
      messageTaskCount: 0,
      commentTemplateCount: 1,
      messageTemplateCount: 1,
    });
    expect(plan.targets.map((target) => target.text)).toEqual([
      '想了解加盟多少钱，怎么联系',
      '需要资料，怎么报名',
    ]);
    expect(plan.targets[0]).toMatchObject({
      targetName: '高意向客户',
      profileUrl: 'https://www.douyin.com/user/lead-1',
      commentTime: '今天',
      videoTitle: '餐饮加盟案例',
      videoUrl: 'https://www.douyin.com/video/1',
      engagementScore: 9800,
    });
    expect(plan.targets[0].followUpActions).toEqual(['comment']);
    expect(plan.targets[0].messageTaskEnabled).toBe(false);
    expect(plan.targets[0].directMessageBlockedReason).toContain(
      '评论区线索不是已有私信会话',
    );
    expect(plan.targets[0].commentReplyText).toContain('评论模板：餐饮加盟');
    expect(plan.targets[0].directMessageText).toContain(
      '私信模板：可以发你加盟资料',
    );
    expect(plan.targets[0].sourceText).toContain('目标：高意向客户');
    expect(plan.targets[0].sourceText).toContain('评论时间：今天');
    expect(plan.targets[0].sourceText).toContain('视频互动分：9800');
    expect(plan.targets[0].sourceText).toContain('筛选原因');
    expect(plan.commentTemplates).toEqual(['评论模板：{topic} / {comment}']);
    expect(plan.messageTemplates).toEqual([
      '私信模板：{message} / {topic} / {comment}',
    ]);
    expect(plan.skipped.map((item) => item.text)).toContain('哈哈');
  });

  it('rotates Douyin public-comment follow-up targets across videos', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '短视频评论获客',
      sourceText: '豆包装修',
      commentTemplates: ['可以交流一下'],
      dailyLimit: 4,
      maxTargets: 4,
      includeKeywords: ['豆包'],
      minScore: 0,
      candidates: [
        {
          text: '豆包装修',
          targetName: '客户A',
          videoUrl: 'https://www.douyin.com/video/1',
          sourceUrl: 'https://www.douyin.com/video/1',
          kind: 'comment',
          index: 0,
        },
        {
          text: '豆包装修',
          targetName: '客户B',
          videoUrl: 'https://www.douyin.com/video/1',
          sourceUrl: 'https://www.douyin.com/video/1',
          kind: 'comment',
          index: 1,
        },
        {
          text: '豆包装修',
          targetName: '客户C',
          videoUrl: 'https://www.douyin.com/video/2',
          sourceUrl: 'https://www.douyin.com/video/2',
          kind: 'comment',
          index: 2,
        },
        {
          text: '豆包装修',
          targetName: '客户D',
          videoUrl: 'https://www.douyin.com/video/3',
          sourceUrl: 'https://www.douyin.com/video/3',
          kind: 'comment',
          index: 3,
        },
        {
          text: '豆包装修',
          targetName: '客户E',
          videoUrl: 'https://www.douyin.com/video/2',
          sourceUrl: 'https://www.douyin.com/video/2',
          kind: 'comment',
          index: 4,
        },
      ],
    });

    expect(plan.targets.map((target) => target.videoUrl)).toEqual([
      'https://www.douyin.com/video/1',
      'https://www.douyin.com/video/2',
      'https://www.douyin.com/video/3',
      'https://www.douyin.com/video/1',
    ]);
    expect(plan.targets.map((target) => target.targetName)).toEqual([
      '客户A',
      '客户C',
      '客户D',
      '客户B',
    ]);
  });

  it('only creates a Douyin message follow-up when the candidate is a reachable private message', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '私信跟进',
      sourceText: '餐饮加盟',
      privateMessage: '可以发你加盟资料。',
      dailyLimit: 2,
      maxTargets: 2,
      candidates: [
        {
          text: '想了解加盟资料',
          kind: 'message',
          sourceUrl:
            'https://creator.douyin.com/creator-micro/data/following/chat',
          targetName: '私信客户',
          index: 0,
        },
      ],
    });

    expect(plan.summary).toMatchObject({
      selectedCount: 1,
      commentTaskCount: 0,
      messageTaskCount: 1,
    });
    expect(plan.targets[0].followUpActions).toEqual(['message']);
    expect(plan.targets[0].messageTaskEnabled).toBe(true);
    expect(plan.targets[0].directMessageBlockedReason).toBeUndefined();
  });

  it('does not treat Douyin search account exposure candidates as customers to message', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '短视频评论获客',
      sourceText: '装修获客',
      accountName: '测试抖音',
      privateMessage: '你好，想和你交流装修获客。',
      messageTemplates: ['私信模板：{message} / {topic} / {comment}'],
      commentTemplates: [],
      dailyLimit: 10,
      maxTargets: 10,
      includeKeywords: ['装修', '家装'],
      candidates: [
        {
          text: '装修设计企业号 粉丝: 1.2万 获赞: 8.8万',
          sourceUrl:
            'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE%E8%8E%B7%E5%AE%A2',
          kind: 'search-result',
          index: 0,
          score: 0,
        },
      ],
    });

    expect(plan.summary).toMatchObject({
      totalCandidates: 1,
      selectedCount: 0,
      commentTaskCount: 0,
      messageTaskCount: 0,
    });
    expect(plan.targets).toHaveLength(0);
    expect(plan.skipped[0].reason).toContain('命中高意向词');
  });

  it('executes Douyin auto acquisition as public comment replies, not creator DMs', async () => {
    const runtime = makeRuntimeMock();
    const billingFetch = mockKaypalBillingFetch();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    const result = await service.executeDouyinFollowUp({
      accountId: 'douyin-1',
      autoSend: true,
      targets: [
        {
          text: '想了解装修报价',
          sourceText: '目标：潜在客户\n想了解装修报价',
          sourceUrl: 'https://www.douyin.com/video/1',
          videoUrl: 'https://www.douyin.com/video/1',
          kind: 'hot-video-comment',
          targetName: '潜在客户',
          commentReplyText: '可以发你一份报价参考。',
          commentTaskEnabled: true,
          index: 0,
        },
      ],
    });

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-comment-reply',
        platform: 'douyin',
        accountId: 'douyin-1',
        payload: expect.objectContaining({
          targetName: '潜在客户',
          targetText: '想了解装修报价',
          sourceUrl: 'https://www.douyin.com/video/1',
          replyText: '可以发你一份报价参考。',
        }),
      }),
      expect.objectContaining({ sendMode: 'auto-send' }),
    );
    expect(result.summary).toMatchObject({
      attemptedCount: 1,
      successCount: 1,
      failedCount: 0,
      sendMode: 'auto-send',
    });
    expect(result.billing).toMatchObject({
      status: 'charged',
      amount: 17,
      reservationId: 'credit-reservation-1',
    });
    expect(billingFetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/billing/reserve' }),
      expect.any(Object),
    );
    expect(billingFetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/billing/capture' }),
      expect.any(Object),
    );
  });

  it('plans an explicit retention customer profile as a message action only', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '留资曝光',
      sourceText: '活动表单已确认客户主页',
      commentTemplates: ['评论模板'],
      messageTemplates: ['你好，看到你提交了咨询，我把资料发给你。'],
      dailyLimit: 2,
      maxActionsPerTarget: 1,
      candidates: [
        {
          text: '明确留资客户：装修咨询客户',
          targetName: '装修咨询客户',
          profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-retention-001',
          sourceUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-retention-001',
          kind: 'retention-contact',
          index: 0,
          score: 90,
        },
      ],
    });

    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({
      targetName: '装修咨询客户',
      commentTaskEnabled: false,
      messageTaskEnabled: true,
      followUpActions: ['message'],
    });
  });

  it('executes an explicit retention customer through the direct-message runtime with source capability metadata', async () => {
    const runtime = makeRuntimeMock();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    const result = await service.executeDouyinFollowUp({
      accountId: 'douyin-1',
      autoSend: true,
      maxTargets: 1,
      sourceCapability: 'douyin-retention-exposure',
      targets: [
        {
          text: '明确留资客户：装修咨询客户',
          targetName: '装修咨询客户',
          profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-retention-001',
          sourceUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-retention-001',
          kind: 'retention-contact',
          directMessageText: '你好，看到你提交了咨询，我把资料发给你。',
          commentTaskEnabled: false,
          messageTaskEnabled: true,
          followUpActions: ['message'],
          index: 0,
        },
      ],
    });

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-direct-message-reply',
        payload: expect.objectContaining({
          aiEmployeeCapability: 'douyin-retention-exposure',
          followUpAction: 'message',
          targetName: '装修咨询客户',
          replyText: '你好，看到你提交了咨询，我把资料发给你。',
        }),
      }),
      expect.objectContaining({ sendMode: 'auto-send' }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'success',
      summary: { attemptedCount: 1, successCount: 1 },
      results: [expect.objectContaining({ action: 'message', ok: true })],
    });
  });

  it('does not count a Douyin customer action as successful without evidence', async () => {
    const runtime = makeRuntimeMock();
    runtime.execute.mockResolvedValueOnce({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '执行器声称已发送',
      runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
      evidence: [],
      readback: {
        expectedText: '可以发你一份报价参考。',
        actualText: '可以发你一份报价参考。',
        matched: true,
      },
    });
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    const result = await service.executeDouyinFollowUp({
      accountId: 'douyin-1',
      autoSend: true,
      targets: [
        {
          text: '想了解装修报价',
          sourceUrl: 'https://www.douyin.com/video/1',
          targetName: '潜在客户',
          commentReplyText: '可以发你一份报价参考。',
          commentTaskEnabled: true,
          index: 0,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      summary: { successCount: 0, failedCount: 1 },
      results: [
        expect.objectContaining({
          ok: false,
          status: 'failed',
          reasonCode: 'readback_failed',
          message: expect.stringContaining('没有返回可核验的执行证据'),
        }),
      ],
    });
  });

  it('isolates legacy auto acquisition configs by tenant and user', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const previousGrowthExecution = process.env.GROWTH_EXECUTION_ENABLED;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-scope-'));
    const storePath = join(storeDir, 'store.json');
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = storePath;
    process.env.GROWTH_EXECUTION_ENABLED = 'true';

    let currentUser = {
      id: 'user-a',
      kaypalLocalOnly: false,
    };
    const authRequestContext = {
      get: jest.fn(() => ({ user: currentUser })),
    } as unknown as AuthRequestContextService;
    const prisma = {
      system: {
            tenantMember: {
              findFirst: jest.fn(
                async ({ where }: { where: { userId: string } }) => ({
                  tenantId: where.userId === 'user-c' ? 'tenant-c' : 'tenant-shared',
                }),
              ),
            },
      },
    };
    const runtime = makeRuntimeMock();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      authRequestContext,
      undefined,
      undefined,
      undefined,
      prisma as never,
    );

    try {
      const configA = await service.createAutoAcquisitionConfig({
        id: 'shared-config-id',
        taskName: '用户 A 配置',
        accountId: 'douyin-a',
        searchKeywords: '装修',
        enabled: true,
      });

      currentUser = { id: 'user-b', kaypalLocalOnly: false };
      const configB = await service.createAutoAcquisitionConfig({
        id: 'shared-config-id',
        taskName: '用户 B 配置',
        accountId: 'douyin-b',
        searchKeywords: '家装',
        enabled: true,
      });
      const snapshotB = await service.listAutoAcquisition();

      expect(configB.id).not.toBe(configA.id);
      expect(snapshotB.configs).toHaveLength(1);
      expect(snapshotB.configs[0]).toMatchObject({
        tenantId: 'tenant-shared',
        userId: 'user-b',
        taskName: '用户 B 配置',
      });
      await expect(
        service.updateAutoAcquisitionConfig(configA.id, {
          taskName: '越权修改',
        }),
      ).rejects.toThrow('自动获客配置不存在');
      await expect(
        service.deleteAutoAcquisitionConfig(configA.id),
      ).rejects.toThrow('自动获客配置不存在');
      await expect(
        service.executeAutoAcquisitionConfig(configA.id),
      ).rejects.toThrow('自动获客配置不存在');
      await service.updateAutoAcquisitionConfig(configB.id, {
        taskName: '用户 B 已更新配置',
      });
      await expect(
        service.executeAutoAcquisitionConfig(
          configB.id,
          'manual',
          configB.updatedAt,
        ),
      ).rejects.toThrow('自动获客配置已更新，请重新确认后执行');
      expect(runtime.execute).not.toHaveBeenCalled();

      currentUser = { id: 'user-a', kaypalLocalOnly: false };
      const snapshotA = await service.listAutoAcquisition();
      expect(snapshotA.configs).toHaveLength(1);
      expect(snapshotA.configs[0]).toMatchObject({
        tenantId: 'tenant-shared',
        userId: 'user-a',
        taskName: '用户 A 配置',
      });

      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
        version: number;
        configs: Array<{ tenantId: string; userId: string }>;
      };
      expect(persisted.version).toBe(2);
      expect(persisted.configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tenantId: 'tenant-shared',
            userId: 'user-a',
          }),
          expect.objectContaining({
            tenantId: 'tenant-shared',
            userId: 'user-b',
          }),
        ]),
      );
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      if (previousGrowthExecution === undefined) {
        delete process.env.GROWTH_EXECUTION_ENABLED;
      } else {
        process.env.GROWTH_EXECUTION_ENABLED = previousGrowthExecution;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('quarantines unowned v1 auto acquisition data from commercial users', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const previousGrowthExecution = process.env.GROWTH_EXECUTION_ENABLED;
    const previousLegacyScheduler =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
    const previousRealDaemon = process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-legacy-scope-'));
    const storePath = join(storeDir, 'store.json');
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = storePath;
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER = 'true';
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';
    await writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        configs: [
          {
            id: 'legacy-config',
            taskName: '未归属旧配置',
            accountId: 'douyin-legacy',
            searchKeywords: '旧关键词',
            status: 'enabled',
          },
        ],
        records: [
          {
            id: 'legacy-record',
            configId: 'legacy-config',
            taskName: '未归属旧配置',
            status: 'success',
          },
        ],
        dedupe: { 'legacy-config': ['candidate-1'] },
      }),
      'utf8',
    );
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
      undefined,
      undefined,
      {
        get: jest.fn(() => ({
          user: { id: 'commercial-user', kaypalLocalOnly: false },
        })),
      } as unknown as AuthRequestContextService,
      undefined,
      undefined,
      undefined,
      {
        system: {
          tenantMember: {
            findFirst: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
          },
        },
      } as never,
    );

    try {
      const snapshot = await service.listAutoAcquisition();
      expect(snapshot.configs).toEqual([]);
      expect(snapshot.records).toEqual([]);
      await expect(
        service.updateAutoAcquisitionConfig('legacy-config', {
          taskName: '不能认领',
        }),
      ).rejects.toThrow('自动获客配置不存在');
      await (
        service as unknown as {
          runAutoAcquisitionScheduler: (source: 'startup') => Promise<void>;
        }
      ).runAutoAcquisitionScheduler('startup');
      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
        records: unknown[];
      };
      expect(persisted.records).toHaveLength(1);
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      if (previousGrowthExecution === undefined) {
        delete process.env.GROWTH_EXECUTION_ENABLED;
      } else {
        process.env.GROWTH_EXECUTION_ENABLED = previousGrowthExecution;
      }
      if (previousLegacyScheduler === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER =
          previousLegacyScheduler;
      }
      if (previousRealDaemon === undefined) {
        delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
      } else {
        process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = previousRealDaemon;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('persists backend auto acquisition configs and records around execution', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-acquisition-'));
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = join(
      storeDir,
      'store.json',
    );
    const runtime = makeRuntimeMock();
    runtime.execute
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已采集 1 条候选评论',
        technicalMessage: 'read-only done',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-hot-video-comment-read',
            value: '/api/local-engine/browser/evidence/read.png',
            path: '/tmp/read.png',
            createdAt: '2026-06-22T00:00:00.000Z',
          },
        ],
        readback: {
          expectedText: 'candidate-comments',
          actualText: JSON.stringify([
            {
              text: '想了解装修报价',
              sourceUrl: 'https://www.douyin.com/video/1',
              videoUrl: 'https://www.douyin.com/video/1',
              kind: 'hot-video-comment',
              targetName: '潜在客户',
              index: 0,
            },
          ]),
          matched: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已自动执行 1 条评论回复',
        technicalMessage: 'sent',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-comment-reply',
            value: '/api/local-engine/browser/evidence/sent.png',
            path: '/tmp/sent.png',
            createdAt: '2026-06-22T00:01:00.000Z',
          },
        ],
        readback: {
          expectedText: '可以交流一下',
          actualText: '可以交流一下',
          matched: true,
        },
      });
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    try {
      const config = await service.createAutoAcquisitionConfig({
        taskName: '后端自动获客',
        accountId: 'douyin-1',
        account: '抖音账号 1',
        searchKeywords: '装修获客',
        keywords: '装修, 报价',
        contents: '可以交流一下',
        dailyLimit: 3,
        beginTime: '09:00',
        enabled: true,
        deduplicate: true,
      });

      const execution = await service.executeAutoAcquisitionConfig(config.id);
      const snapshot = await service.listAutoAcquisition();

      expect(execution.record).toMatchObject({
        configId: config.id,
        trigger: 'manual',
        candidateCount: 1,
        selectedCount: 1,
        status: 'success',
      });
      expect(execution.record.executionSummary).toMatchObject({
        attemptedCount: 1,
        successCount: 1,
        failedCount: 0,
      });
      expect(execution.record.billing).toMatchObject({
        status: 'charged',
        amount: 17,
        balanceAfter: 983,
      });
      expect(snapshot.records[0].id).toBe(execution.record.id);
      expect(snapshot.configs[0]).toMatchObject({
        id: config.id,
        exposureCount: 1,
        status: 'enabled',
      });
      expect(runtime.execute).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'douyin-comment-reply',
          payload: expect.objectContaining({
            targetName: '潜在客户',
            targetText: '想了解装修报价',
          }),
        }),
        expect.objectContaining({ sendMode: 'auto-send' }),
      );
    } finally {
      service.onModuleDestroy();
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('blocks auto acquisition before touching Douyin when the bound platform account is expired', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-acquisition-'));
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = join(
      storeDir,
      'store.json',
    );
    const runtime = makeRuntimeMock();
    const autoUpload = makeAutoUploadServiceMock([
      {
        id: 4,
        type: 3,
        platform: '抖音',
        status: 0,
        profileName: '抖音账号 4',
        userName: '抖音创作者中心',
        statusLabel: '需要重新登录',
        sessionStatus: 'needs_login',
        lastDispatchOk: false,
        lastDispatchReason: 'browser_session_needs_login',
      },
    ]);
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
      undefined,
      autoUpload as never,
    );

    try {
      const config = await service.createAutoAcquisitionConfig({
        taskName: '过期账号阻断',
        accountId: '4',
        account: '抖音账号 4',
        searchKeywords: '装修获客',
        keywords: '装修, 报价',
        contents: '可以交流一下',
        dailyLimit: 3,
        beginTime: '09:00',
        enabled: true,
      });

      const execution = await service.executeAutoAcquisitionConfig(config.id);
      const snapshot = await service.listAutoAcquisition();

      expect(autoUpload.listAccounts).toHaveBeenCalledWith({
        validate: true,
        force: true,
        ids: ['4'],
      });
      expect(runtime.execute).not.toHaveBeenCalled();
      expect(execution.record).toMatchObject({
        configId: config.id,
        trigger: 'manual',
        status: 'skipped',
        candidateCount: 0,
        selectedCount: 0,
        message: expect.stringContaining('需要重新登录'),
      });
      expect(snapshot.configs[0]).toMatchObject({
        id: config.id,
        exposureCount: 0,
        status: 'enabled',
        reason: expect.stringContaining('需要重新登录'),
      });
      expect(snapshot.records[0].message).toContain('发布中心-平台账号');
    } finally {
      service.onModuleDestroy();
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('keeps failed auto acquisition touches visible without increasing exposure or dedupe', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-acquisition-'));
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = join(
      storeDir,
      'store.json',
    );
    const runtime = makeRuntimeMock();
    runtime.execute
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已采集 1 条候选评论',
        technicalMessage: 'read-only done',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-hot-video-comment-read',
            path: '/tmp/read.png',
            createdAt: '2026-06-22T00:00:00.000Z',
          },
        ],
        readback: {
          expectedText: 'candidate-comments',
          actualText: JSON.stringify([
            {
              text: '想了解装修报价',
              sourceUrl: 'https://www.douyin.com/video/1',
              videoUrl: 'https://www.douyin.com/video/1',
              kind: 'hot-video-comment',
              targetName: '潜在客户',
              profileUrl: 'https://www.douyin.com/user/customer-1',
              index: 0,
            },
          ]),
          matched: true,
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 'failed',
        reasonCode: 'readback_failed',
        userMessage: '评论发送后未读回到目标文案',
        technicalMessage: 'readback failed',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-hot-video-comment-read',
            path: '/tmp/crm-read.png',
            createdAt: '2026-06-22T00:00:00.000Z',
          },
        ],
        readback: {
          expectedText: '可以交流一下',
          actualText: '',
          matched: false,
        },
      });
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    try {
      const config = await service.createAutoAcquisitionConfig({
        taskName: '失败不掩盖',
        accountId: 'douyin-1',
        account: '抖音账号 1',
        searchKeywords: '装修获客',
        keywords: '装修, 报价',
        contents: '可以交流一下',
        dailyLimit: 3,
        beginTime: '09:00',
        enabled: true,
        deduplicate: true,
      });

      const execution = await service.executeAutoAcquisitionConfig(config.id);
      const snapshot = await service.listAutoAcquisition();

      expect(execution.record).toMatchObject({
        configId: config.id,
        trigger: 'manual',
        candidateCount: 1,
        selectedCount: 1,
        status: 'failed',
        message: '已执行 1 条评论回复，成功 0 条，失败 1 条',
      });
      expect(execution.record.executionSummary).toMatchObject({
        attemptedCount: 1,
        successCount: 0,
        failedCount: 1,
      });
      expect(execution.record.executionResults?.[0]).toMatchObject({
        ok: false,
        status: 'failed',
        message: '评论发送后未读回到目标文案',
      });
      expect(snapshot.configs[0]).toMatchObject({
        id: config.id,
        exposureCount: 0,
        status: 'enabled',
      });
      const persistedStore = JSON.parse(
        await readFile(
          process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH as string,
          'utf8',
        ),
      );
      expect(persistedStore.dedupe?.[config.id]).toBeUndefined();
    } finally {
      service.onModuleDestroy();
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('captures successful auto acquisition replies into CRM when CRM is installed', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-acquisition-'));
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = join(
      storeDir,
      'store.json',
    );
    const runtime = makeRuntimeMock();
    runtime.execute
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已采集 1 条候选评论',
        technicalMessage: 'read-only done',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-comment-reply',
            path: '/tmp/crm-sent.png',
            createdAt: '2026-06-22T00:01:00.000Z',
          },
        ],
        readback: {
          expectedText: 'candidate-comments',
          actualText: JSON.stringify([
            {
              text: '想了解装修报价',
              sourceUrl: 'https://www.douyin.com/video/1',
              videoUrl: 'https://www.douyin.com/video/1',
              kind: 'hot-video-comment',
              targetName: '潜在客户',
              profileUrl: 'https://www.douyin.com/user/customer-1',
              index: 0,
            },
          ]),
          matched: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已自动执行 1 条评论回复',
        technicalMessage: 'sent',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-video-comment',
            path: '/tmp/video-comment-sent.png',
            createdAt: '2026-06-22T00:01:00.000Z',
          },
        ],
        readback: {
          expectedText: '可以交流一下',
          actualText: '可以交流一下',
          matched: true,
        },
      });
    const crmService = makeCrmServiceMock();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      crmService,
      makeAuthRequestContextMock('operator-1'),
    );

    try {
      const config = await service.createAutoAcquisitionConfig({
        taskName: 'CRM 自动沉淀',
        accountId: 'douyin-1',
        account: '抖音账号 1',
        searchKeywords: '装修获客',
        keywords: '装修, 报价',
        contents: '可以交流一下',
        dailyLimit: 3,
        beginTime: '09:00',
        enabled: true,
        deduplicate: true,
      });

      const execution = await service.executeAutoAcquisitionConfig(config.id);

      expect(crmService.captureAutoAcquisitionLeads).toHaveBeenCalledTimes(1);
      expect(crmService.captureAutoAcquisitionLeads).toHaveBeenCalledWith(
        'operator-1',
        expect.objectContaining({
          configId: config.id,
          recordId: execution.record.id,
          taskName: 'CRM 自动沉淀',
          keyword: '装修获客',
          accountId: 'douyin-1',
          targets: expect.arrayContaining([
            expect.objectContaining({
              targetName: '潜在客户',
              profileUrl: 'https://www.douyin.com/user/customer-1',
              commentReplyText: '可以交流一下',
            }),
          ]),
          executionResults: expect.arrayContaining([
            expect.objectContaining({
              index: 0,
              ok: true,
              targetName: '潜在客户',
              replyText: '可以交流一下',
            }),
          ]),
        }),
      );
      expect(execution.record.crmCapture).toMatchObject({
        enabled: true,
        capturedCount: 1,
        skippedCount: 0,
      });
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('falls back to direct video comments when hot videos have no matching comments', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-acquisition-'));
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = join(
      storeDir,
      'store.json',
    );
    const runtime = makeRuntimeMock();
    runtime.execute
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已打开 1 个爆款视频，但未识别到符合时间筛选的候选评论',
        technicalMessage: 'read-only done',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-hot-video-search-read',
            value: '/api/local-engine/browser/evidence/read.png',
            path: '/tmp/read.png',
            createdAt: '2026-06-22T00:00:00.000Z',
            raw: {
              openedVideos: [
                {
                  url: 'https://www.douyin.com/video/99',
                  title: '装修案例视频',
                  candidateCount: 0,
                  engagementScore: 88,
                },
              ],
            },
          },
        ],
        readback: {
          expectedText: 'candidate-hot-videos',
          actualText: '[]',
          matched: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '抖音评论已发送：视频评论已点击发送',
        technicalMessage: 'sent',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-video-comment',
            path: '/tmp/video-comment-keyword-sent.png',
            createdAt: '2026-06-22T00:01:00.000Z',
          },
        ],
        readback: {
          expectedText: '可以交流一下',
          actualText: '可以交流一下',
          matched: true,
        },
      });
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    try {
      const config = await service.createAutoAcquisitionConfig({
        taskName: '无评论直评获客',
        accountId: 'douyin-1',
        account: '抖音账号 1',
        searchKeywords: '装修获客',
        keywords: '装修, 获客',
        contents: '可以交流一下',
        dailyLimit: 3,
        beginTime: '09:00',
        enabled: true,
        deduplicate: true,
      });

      const execution = await service.executeAutoAcquisitionConfig(config.id);

      expect(execution.record).toMatchObject({
        candidateCount: 1,
        selectedCount: 1,
        status: 'success',
      });
      expect(runtime.execute).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'douyin-comment-reply',
          payload: expect.objectContaining({
            commentMode: 'video-comment',
            videoUrl: 'https://www.douyin.com/video/99',
            targetText: expect.stringContaining('装修案例视频'),
            replyText: '可以交流一下',
          }),
        }),
        expect.objectContaining({ sendMode: 'auto-send' }),
      );
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('falls back to direct video comments when comments do not match configured keywords', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-acquisition-'));
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = join(
      storeDir,
      'store.json',
    );
    const runtime = makeRuntimeMock();
    runtime.execute
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已打开 1 个爆款视频并采集 1 条候选评论',
        technicalMessage: 'read-only done',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-hot-video-comment-read',
            value: '/api/local-engine/browser/evidence/read.png',
            path: '/tmp/read.png',
            createdAt: '2026-06-22T00:00:00.000Z',
            raw: {
              openedVideos: [
                {
                  url: 'https://www.douyin.com/video/100',
                  title: '企业AI案例视频',
                  candidateCount: 1,
                  engagementScore: 92,
                },
              ],
            },
          },
        ],
        readback: {
          expectedText: 'candidate-comments',
          actualText: JSON.stringify([
            {
              text: '路过看看',
              sourceUrl: 'https://www.douyin.com/video/100',
              videoUrl: 'https://www.douyin.com/video/100',
              kind: 'hot-video-comment',
              targetName: '普通用户',
              index: 0,
              score: 0,
              reason: '未命中关键词',
            },
          ]),
          matched: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '抖音评论已发送：视频评论已点击发送',
        technicalMessage: 'sent',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-hot-video-comment-read',
            path: '/tmp/scheduled-read.png',
            createdAt: '2026-06-22T00:00:00.000Z',
          },
        ],
        readback: {
          expectedText: '可以交流一下',
          actualText: '可以交流一下',
          matched: true,
        },
      });
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    try {
      const config = await service.createAutoAcquisitionConfig({
        taskName: '未命中关键词直评获客',
        accountId: 'douyin-1',
        account: '抖音账号 1',
        searchKeywords: '企业AI',
        keywords: '咨询, 价格',
        contents: '可以交流一下',
        dailyLimit: 3,
        beginTime: '09:00',
        enabled: true,
        deduplicate: true,
      });

      const execution = await service.executeAutoAcquisitionConfig(config.id);

      expect(execution.record).toMatchObject({
        candidateCount: 1,
        selectedCount: 1,
        status: 'success',
      });
      expect(execution.record.targets?.[0]).toMatchObject({
        commentMode: 'video-comment',
        reason: '评论区没有命中匹配关键词，改为直接在视频下评论。',
      });
      expect(runtime.execute).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'douyin-comment-reply',
          payload: expect.objectContaining({
            commentMode: 'video-comment',
            videoUrl: 'https://www.douyin.com/video/100',
            targetText: expect.stringContaining('企业AI案例视频'),
            replyText: '可以交流一下',
          }),
        }),
        expect.objectContaining({ sendMode: 'auto-send' }),
      );
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('keeps a backend record visible while scheduled auto acquisition is running', async () => {
    const previousStorePath =
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
    const storeDir = await mkdtemp(join(tmpdir(), 'ai-auto-acquisition-'));
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = join(
      storeDir,
      'store.json',
    );
    const runtime = makeRuntimeMock();
    let resolveSend: (value: unknown) => void = () => undefined;
    const sendPromise = new Promise((resolve) => {
      resolveSend = resolve;
    });
    runtime.execute
      .mockResolvedValueOnce({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已采集 1 条候选评论',
        technicalMessage: 'read-only done',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-comment-reply',
            path: '/tmp/scheduled-sent.png',
            createdAt: '2026-06-22T00:01:00.000Z',
          },
        ],
        readback: {
          expectedText: 'candidate-comments',
          actualText: JSON.stringify([
            {
              text: '想了解装修报价',
              sourceUrl: 'https://www.douyin.com/video/1',
              videoUrl: 'https://www.douyin.com/video/1',
              kind: 'hot-video-comment',
              targetName: '潜在客户',
              index: 0,
            },
          ]),
          matched: true,
        },
      })
      .mockImplementationOnce(() => sendPromise as any);
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER = 'true';
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      undefined,
      undefined,
      makeAuthRequestContextMock(),
    );

    try {
      const config = await service.createAutoAcquisitionConfig({
        taskName: '后台定时自动获客',
        accountId: 'douyin-1',
        account: '抖音账号 1',
        searchKeywords: '装修获客',
        keywords: '装修, 报价',
        contents: '可以交流一下',
        dailyLimit: 3,
        beginTime: '09:00',
        enabled: true,
      });

      const executionPromise = service.executeAutoAcquisitionConfig(
        config.id,
        'schedule',
      );
      await waitForRuntimeCalls(runtime, 2);
      const runningSnapshot = await service.listAutoAcquisition();

      expect(runningSnapshot.configs[0]).toMatchObject({
        id: config.id,
        status: 'running',
        reason: '后台定时执行中',
      });
      expect(runningSnapshot.records[0]).toMatchObject({
        configId: config.id,
        trigger: 'schedule',
        status: 'running',
        message: '后台定时执行中',
      });
      await expect(
        service.updateAutoAcquisitionConfig(config.id, {
          taskName: '执行中不能修改',
        }),
      ).rejects.toThrow('这条自动获客配置正在执行，暂时不能修改');

      resolveSend({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '已自动执行 1 条评论回复',
        technicalMessage: 'sent',
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'screenshot',
            label: 'douyin-comment-reply',
            path: '/tmp/scheduled-sent.png',
            createdAt: '2026-06-22T00:01:00.000Z',
          },
        ],
        readback: {
          expectedText: '可以交流一下',
          actualText: '可以交流一下',
          matched: true,
        },
      });
      const execution = await executionPromise;
      const completedSnapshot = await service.listAutoAcquisition();

      expect(completedSnapshot.records).toHaveLength(1);
      expect(completedSnapshot.records[0]).toMatchObject({
        id: runningSnapshot.records[0].id,
        status: 'success',
        message: '已自动执行 1 条评论回复',
      });
      expect(execution.record.id).toBe(runningSnapshot.records[0].id);
      expect(completedSnapshot.configs[0]).toMatchObject({
        status: 'enabled',
        exposureCount: 1,
      });
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH;
      } else {
        process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH = previousStorePath;
      }
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('treats Douyin daily limit as total comment and message actions', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '爆款视频获客',
      sourceText: '餐饮加盟',
      privateMessage: '可以发你加盟资料。',
      commentTemplates: ['评论模板：{topic} / {comment}'],
      dailyLimit: 3,
      maxTargets: 10,
      candidates: [
        { text: '想了解价格，怎么联系', kind: 'comment', index: 0 },
        { text: '需要资料，怎么报名', kind: 'comment', index: 1 },
        { text: '电话多少', kind: 'comment', index: 2 },
      ],
    });

    expect(plan.targets).toHaveLength(3);
    expect(plan.targets[0].followUpActions).toEqual(['comment']);
    expect(plan.targets[1].followUpActions).toEqual(['comment']);
    expect(plan.targets[2].followUpActions).toEqual(['comment']);
    expect(
      plan.summary.commentTaskCount + plan.summary.messageTaskCount,
    ).toBeLessThanOrEqual(3);
  });

  it('applies configurable Douyin intent keywords, blacklist and minimum score', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '爆款视频',
      sourceText: '装修',
      privateMessage: '可以发你案例',
      commentTemplates: ['评论模板：{topic} / {comment}'],
      dailyLimit: 5,
      includeKeywords: ['报价'],
      blacklistKeywords: ['同行'],
      minScore: 60,
      candidates: [
        {
          text: '想看装修报价，怎么联系',
          sourceUrl: 'https://www.douyin.com/video/1',
          kind: 'comment',
          index: 0,
        },
        {
          text: '同行路过看看',
          sourceUrl: 'https://www.douyin.com/video/2',
          kind: 'comment',
          index: 1,
        },
        {
          text: '不错',
          sourceUrl: 'https://www.douyin.com/video/3',
          kind: 'comment',
          index: 2,
        },
      ],
    });

    expect(plan.targets.map((target) => target.text)).toEqual([
      '想看装修报价，怎么联系',
    ]);
    expect(plan.targets[0].reason).toContain('报价');
    expect(
      plan.skipped.find((item) => item.text === '同行路过看看')?.reason,
    ).toContain('同行');
    expect(plan.skipped.find((item) => item.text === '不错')?.reason).toContain(
      '60',
    );
  });

  it('keeps upstream rejected or negative Douyin comments out of auto follow-up', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '爆款视频获客',
      sourceText: '餐饮加盟',
      dailyLimit: 2,
      candidates: [
        {
          text: '自从朋友加盟你们以后赔得内裤都穿不上了',
          sourceUrl: 'https://www.douyin.com/video/7501715840678022415',
          kind: 'hot-video-comment',
          index: 0,
          score: 0,
        },
        {
          text: '加盟以后亏了很多，怎么投诉',
          sourceUrl: 'https://www.douyin.com/video/2',
          kind: 'comment',
          index: 1,
        },
      ],
    });

    expect(plan.summary).toMatchObject({
      selectedCount: 0,
      skippedCount: 2,
      commentTaskCount: 0,
      messageTaskCount: 0,
    });
    expect(plan.summary.nextAction).toBe('本次候选评论没有达到跟进条件。');
    expect(plan.skipped.map((item) => item.text)).toEqual([
      '自从朋友加盟你们以后赔得内裤都穿不上了',
      '加盟以后亏了很多，怎么投诉',
    ]);
    expect(plan.skipped[0].reason).toContain('采集阶段');
    expect(plan.skipped[1].reason).toContain('负面');
  });

  it('rescues zero-score Douyin comments when they match acquisition keywords', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '短视频评论获客',
      sourceText: '装修获客',
      commentTemplates: ['可以交流一下'],
      dailyLimit: 2,
      includeKeywords: ['装修', '获客'],
      minScore: 0,
      candidates: [
        {
          text: '您好，怎么联系',
          sourceUrl: 'https://www.douyin.com/video/1',
          videoUrl: 'https://www.douyin.com/video/1',
          kind: 'hot-video-comment',
          index: 0,
          score: 0,
        },
      ],
    });

    expect(plan.summary).toMatchObject({
      selectedCount: 1,
      commentTaskCount: 1,
    });
    expect(plan.targets[0]).toMatchObject({
      text: '您好，怎么联系',
      commentTaskEnabled: true,
      messageTaskEnabled: false,
    });
  });

  it('keeps promotional long comments out of automatic Douyin follow-up targets', async () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const plan = await service.planDouyinFollowUp({
      sourceLabel: '短视频评论获客',
      sourceText: '装修获客',
      commentTemplates: ['可以交流一下'],
      dailyLimit: 5,
      includeKeywords: ['装修', '获客'],
      minScore: 0,
      candidates: [
        {
          targetName: '一颗酸枣核',
          text: '您好，怎么联系',
          sourceUrl: 'https://www.douyin.com/video/1',
          videoUrl: 'https://www.douyin.com/video/1',
          kind: 'hot-video-comment',
          index: 0,
          score: 0,
        },
        {
          targetName: '不一样的我',
          text: '看到20万曝光换76个有效客资，说明内容和精准度都在提升！我们系统用的是行业垂直训练的AI模型，能结合装修业主行为特征做动态识别，不是简单关键词抓取——数据全程加密、不碰平台敏感字段，更新也按平台规范来，稳扎稳打才走得远～',
          sourceUrl: 'https://www.douyin.com/video/1',
          videoUrl: 'https://www.douyin.com/video/1',
          kind: 'hot-video-comment',
          index: 1,
          score: 0,
        },
        {
          targetName: '不一样的我',
          text: '我们帮不少装企优化过内容策略，核心是用AI辅助选题+脚本结构化，让每条视频既符合平台推荐逻辑，又能精准戳中业主痛点。数据安全和风控机制也按行业规范做了多层加固，放心用～',
          sourceUrl: 'https://www.douyin.com/video/2',
          videoUrl: 'https://www.douyin.com/video/2',
          kind: 'hot-video-comment',
          index: 2,
          score: 0,
        },
      ],
    });

    expect(plan.targets.map((target) => target.targetName)).toEqual([
      '一颗酸枣核',
    ]);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetName: '不一样的我',
          reason: expect.stringContaining('推广长评'),
        }),
      ]),
    );
  });

  it('rejects missing Douyin account before starting runtime work', async () => {
    const runtime = makeRuntimeMock();
    const service = new AiEmployeeService(runtime, makeLocalEngineMock());

    await expect(
      service.findDouyinLeadsByLink({
        link: 'https://v.douyin.com/test/',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('blocks P1 closure readiness until real candidates are read', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: 'https://www.douyin.com/video/1',
      candidateCount: 0,
      followUpTaskCount: 0,
      followUpCompletedCount: 0,
      followUpEvidenceCount: 0,
      evidenceCount: 0,
      commentTemplateCount: 1,
      messageTemplateCount: 1,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 1,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00'],
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.status).toBe('blocked');
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'candidate-read',
          nextAction: '先执行一次曝光读取，拿到真实评论或搜索结果。',
        }),
        expect.objectContaining({
          key: 'follow-up-task',
        }),
        expect.objectContaining({
          key: 'evidence-log',
        }),
        expect.objectContaining({
          key: 'publish-preflight',
        }),
        expect.objectContaining({
          key: 'publish-result',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when follow-up tasks are only created', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 0,
      followUpEvidenceCount: 0,
      evidenceCount: 2,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 0,
      publishPendingCount: 2,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'follow-up-task',
          nextAction:
            '先执行评论或私信跟进任务，并确认任务完成、留下证据，且没有失败任务。',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when follow-up has completed evidence but also failed tasks', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 1,
      followUpCompletedCount: 5,
      followUpEvidenceCount: 5,
      evidenceCount: 5,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 2,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'follow-up-task',
          message: '已创建 6 条跟进任务，完成 5 条，证据 5 条，失败 1 条',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when completed follow-up tasks have no evidence', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 1,
      followUpEvidenceCount: 0,
      evidenceCount: 2,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 2,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'follow-up-task',
          message: expect.stringContaining('证据 0 条'),
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when follow-up tasks are only partially completed', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 1,
      followUpEvidenceCount: 1,
      evidenceCount: 2,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 2,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'follow-up-task',
          message: '已创建 6 条跟进任务，完成 1 条，证据 1 条，失败 0 条',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when publish results are only pending', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 6,
      followUpEvidenceCount: 6,
      evidenceCount: 6,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 0,
      publishPendingCount: 2,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'publish-result',
          nextAction:
            '点击创建发布任务，并核对所有平台都有真实成功结果，没有待回执或失败。',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when publish has success but still pending results', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 6,
      followUpEvidenceCount: 6,
      evidenceCount: 6,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 1,
      publishPendingCount: 1,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'publish-result',
          message:
            '已选择 2 个发布账号，已创建 2 个平台发布结果，成功 1 个，待回执 1 个，失败 0 个',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when publish success count does not cover every result', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 6,
      followUpEvidenceCount: 6,
      evidenceCount: 6,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 1,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'publish-result',
          message:
            '已选择 2 个发布账号，已创建 2 个平台发布结果，成功 1 个，待回执 0 个，失败 0 个',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when publish results do not cover every selected account', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 6,
      followUpEvidenceCount: 6,
      evidenceCount: 6,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 1,
      publishFailedCount: 0,
      publishSuccessCount: 1,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'publish-result',
          message:
            '已选择 2 个发布账号，已创建 1 个平台发布结果，成功 1 个，待回执 0 个，失败 0 个',
        }),
      ]),
    );
  });

  it('blocks P1 closure readiness when follow-up or publish schedule values are invalid', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 6,
      followUpEvidenceCount: 6,
      evidenceCount: 6,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 0,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 0,
      publishDailyTimes: ['99:99', 'bad'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 2,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'follow-up-limit',
          message: '每日上限未设置或格式不正确',
        }),
        expect.objectContaining({
          key: 'publish-schedule',
          message: '发布时间未设置或格式不正确',
        }),
      ]),
    );
  });

  it('normalizes invalid P1 closure counters before evaluating readiness', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: Number.POSITIVE_INFINITY,
      followUpTaskCount: 'bad' as any,
      followUpFailedCount: -2,
      followUpCompletedCount: Number.NaN,
      followUpEvidenceCount: Number.POSITIVE_INFINITY,
      evidenceCount: 'bad' as any,
      commentTemplateCount: Number.POSITIVE_INFINITY,
      messageTemplateCount: 'bad' as any,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: Number.POSITIVE_INFINITY,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: Number.POSITIVE_INFINITY,
      publishFailedCount: -1,
      publishSuccessCount: 'bad' as any,
      publishPendingCount: Number.NaN,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'candidate-read',
          message: '还没有读取到候选评论',
        }),
        expect.objectContaining({
          key: 'follow-up-task',
          message: '还没有创建评论或私信跟进任务',
        }),
        expect.objectContaining({
          key: 'copy-pool',
          message: '评论文案 0 条，私信文案 0 条',
        }),
        expect.objectContaining({
          key: 'publish-result',
          message: '还没有创建发布任务',
        }),
      ]),
    );
  });

  it('normalizes one-digit publish hours before marking P1 closure ready', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 6,
      followUpEvidenceCount: 6,
      evidenceCount: 6,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['9:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 2,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(true);
    expect(
      readiness.steps.find((step) => step.key === 'publish-schedule'),
    ).toEqual(
      expect.objectContaining({
        message: '每日 1 条，09:30',
      }),
    );
  });

  it('marks P1 closure readiness ready when account, leads, copy and successful publish result exist', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP1ClosureReadiness({
      douyinAccountId: 'douyin-1',
      douyinAccountName: '测试抖音',
      sourceText: '餐饮加盟',
      candidateCount: 3,
      followUpTaskCount: 6,
      followUpFailedCount: 0,
      followUpCompletedCount: 6,
      followUpEvidenceCount: 6,
      evidenceCount: 6,
      commentTemplateCount: 2,
      messageTemplateCount: 2,
      privateMessage: '可以发你资料',
      dailyLimit: 3,
      publishAccountCount: 2,
      publishMaterialPath: '/tmp/product.mp4',
      publishTitle: '产品介绍',
      publishCopy: '产品正文',
      publishDailyLimit: 1,
      publishDailyTimes: ['10:00', '18:30'],
      publishPreflightOk: true,
      publishPreflightSummary: '发布 preflight 通过',
      publishResultCount: 2,
      publishFailedCount: 0,
      publishSuccessCount: 2,
      publishPendingCount: 0,
    });

    expect(readiness.ok).toBe(true);
    expect(readiness.status).toBe('ready');
    expect(readiness.blockers).toEqual([]);
    expect(readiness.steps.every((step) => step.status === 'ready')).toBe(true);
  });

  it('blocks P2 WeChat readiness until desktop, session, tasks and evidence exist', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness({
      ...readyP2Input(),
      desktopOnline: false,
      agentConnected: false,
      sessionReadable: false,
      sessionConfirmed: false,
      contactName: '',
      latestMessageCount: 0,
      replyText: '',
      replyTaskCount: 0,
      replyCompletedCount: 0,
      groupTargetCount: 0,
      groupTagCount: 0,
      groupDailyLimit: 0,
      groupIntervalSeconds: 0,
      groupMessage: '',
      groupTaskCount: 0,
      groupPausedCount: 0,
      groupResumableCount: 0,
      groupCompletedCount: 0,
      groupFailedCount: 0,
      contactTaskCount: 0,
      contactCompletedCount: 0,
      contactTargetCount: 0,
      contactDailyLimit: 0,
      contactFailedCount: 0,
      momentsPublishTaskCount: 0,
      momentsPublishCompletedCount: 0,
      momentsPublishFailedCount: 0,
      momentsPublishRemainingCount: 0,
      momentsContent: '',
      momentsAssetPath: '',
      momentsDailyCount: 0,
      momentsMarketingTaskCount: 0,
      momentsMarketingCompletedCount: 0,
      momentsMarketingFailedCount: 0,
      momentsMarketingRemainingCount: 0,
      momentsMarketingDailyLimit: 0,
      videoClipTaskCount: 0,
      videoClipCompletedCount: 0,
      videoClipFailedCount: 0,
      videoOutputPath: '',
      publishAccountCount: 0,
      publishMaterialPath: '',
      publishTitle: '',
      publishCopy: '',
      publishDailyLimit: 0,
      publishDailyTimes: [],
      publishPreflightOk: false,
      publishResultCount: 0,
      publishFailedCount: 0,
      publishSuccessCount: 0,
      publishPendingCount: 0,
      evidenceCount: 0,
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.status).toBe('blocked');
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'wechat-desktop' }),
        expect.objectContaining({ key: 'wechat-session' }),
        expect.objectContaining({ key: 'latest-message' }),
        expect.objectContaining({ key: 'reply-task' }),
        expect.objectContaining({ key: 'group-plan' }),
        expect.objectContaining({ key: 'group-control' }),
        expect.objectContaining({ key: 'contact-plan' }),
        expect.objectContaining({ key: 'moments-publish' }),
        expect.objectContaining({ key: 'moments-marketing' }),
        expect.objectContaining({ key: 'video-clip' }),
        expect.objectContaining({ key: 'aggregate-publish' }),
        expect.objectContaining({ key: 'wechat-evidence' }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when group tasks have failures', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        groupPausedCount: 0,
        groupCompletedCount: 1,
        groupFailedCount: 1,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'group-control',
          message: '完成 1 条，暂停 0 条，可恢复 0 条，失败 1 条',
        }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when group tasks are created but not completed', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        groupCompletedCount: 0,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'group-control',
          message: '完成 0 条，暂停 0 条，可恢复 0 条，失败 0 条',
        }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when group tags or pacing are missing', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        groupTagCount: 0,
        groupDailyLimit: 0,
        groupIntervalSeconds: 0,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'group-plan',
          nextAction:
            '填写群发对象、客户标签、群发文案、每天上限和每次间隔，创建群发任务。',
        }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when contact add tasks have failures', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        contactFailedCount: 1,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact-plan',
          message:
            '已创建 1 条加好友任务，完成 1 条，目标 2 个，每日上限 10，失败 1 条',
        }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when contact add tasks are created but not completed', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        contactCompletedCount: 0,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact-plan',
          message:
            '已创建 1 条加好友任务，完成 0 条，目标 2 个，每日上限 10，失败 0 条',
        }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when moments tasks are created but not completed', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        momentsPublishCompletedCount: 0,
        momentsMarketingCompletedCount: 0,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'moments-publish',
          message:
            '已创建 1 条朋友圈发布计划，完成 0 条，待继续 0 条，失败 0 条',
        }),
        expect.objectContaining({
          key: 'moments-marketing',
          message:
            '已创建 1 条朋友圈营销计划，完成 0 条，待继续 0 条，失败 0 条',
        }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when reply text exists but recent chat is missing', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        latestMessageCount: 0,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'latest-message',
          message: '已填写回复内容，但还没有聊天记录',
          nextAction: '读取或粘贴最近聊天记录，再生成回复内容。',
        }),
      ]),
    );
  });

  it('blocks P2 WeChat readiness when moments, video clip or aggregate publish is missing', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({
        momentsPublishTaskCount: 0,
        momentsContent: '',
        momentsAssetPath: '',
        momentsMarketingTaskCount: 0,
        videoClipTaskCount: 0,
        videoClipCompletedCount: 0,
        videoOutputPath: '',
        publishAccountCount: 0,
        publishMaterialPath: '',
        publishTitle: '',
        publishCopy: '',
        publishDailyLimit: 0,
        publishDailyTimes: [],
        publishPreflightOk: false,
        publishResultCount: 0,
        publishSuccessCount: 0,
      }),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'moments-publish' }),
        expect.objectContaining({ key: 'moments-marketing' }),
        expect.objectContaining({ key: 'video-clip' }),
        expect.objectContaining({ key: 'aggregate-publish' }),
      ]),
    );
  });

  it('marks P2 WeChat readiness ready after confirmed session, reply, controllable group send and contact plan exist', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(readyP2Input());

    expect(readiness.ok).toBe(true);
    expect(readiness.status).toBe('ready');
    expect(readiness.blockers).toEqual([]);
    expect(readiness.acceptanceFlow).toEqual(
      expect.arrayContaining([
        '读取桌面微信登录和当前窗口',
        '暂停、恢复或重试群发任务',
        '创建朋友圈发布和朋友圈营销计划',
        '生成视频剪辑结果并带入聚合发布',
      ]),
    );
  });

  it('accepts zero-second group interval for immediate small-batch P2 send', () => {
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
    );

    const readiness = service.checkP2WechatReadiness(
      readyP2Input({ groupIntervalSeconds: 0 }),
    );

    expect(readiness.ok).toBe(true);
    expect(readiness.steps.find((step) => step.key === 'group-plan')).toEqual(
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('runs video template clips through the shared VideoWorkshopService', async () => {
    const runtime = makeRuntimeMock();
    const videoWorkshop = makeVideoWorkshopMock();
    const service = new AiEmployeeService(
      runtime,
      makeLocalEngineMock(),
      videoWorkshop as never,
    );

    await service.clipVideoWithTemplate({
      materialPath: '/tmp/materials/product.mp4',
      templateName: '产品卖点模板',
      titlePrompt: '突出卖点',
      outputName: 'product-output.mp4',
    });

    expect(runtime.execute).not.toHaveBeenCalled();
    expect(videoWorkshop.clipWithTemplate).toHaveBeenCalledWith({
      materialPath: '/tmp/materials/product.mp4',
      templateName: '产品卖点模板',
      titlePrompt: '突出卖点',
      outputName: 'product-output.mp4',
      source: 'ai-employee',
    });
  });

  it('deducts external data credits with server billing key when desktop token is missing', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: 'external-data-transaction-1',
        billing: {
          amount: 3,
          policyVersion: 'commercial-credit-v1-2026-06-29',
          balanceAfter: 997,
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const authRequestContext = {
      get: jest.fn(() => ({
        user: {
          id: 'operator-1',
          kaypalUserId: 'kaypal-user-1',
          kaypalDesktopAccessToken: '',
        },
      })),
    } as unknown as AuthRequestContextService;
    const config = makeConfigMock({
      KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
      KAYPAL_API_KEY: 'server-billing-key',
      KAYPAL_RUNTIME_BILLING_TIMEOUT_MS: '8000',
    });
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
      undefined,
      undefined,
      authRequestContext,
      config,
    );

    const result = await service.deductExternalDataCredits({
      idempotencyKey: 'ai-content:redfox:search:1',
      mode: 'redfox_search',
      taskType: 'douyin_post_search',
      amount: 3,
      runtimeMinutes: 1,
      replies: 0,
      platformActions: 1,
      leads: 0,
      evidences: 1,
      metadata: {
        endpoint: 'POST /story/api/dyData/searchArticle',
      },
    });

    const [, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://test.kaypal.cn/api/billing/deduct',
    );
    expect(request.headers).toEqual(
      expect.objectContaining({
        'x-kaypal-api-key': 'server-billing-key',
        'x-kaypal-user-id': 'kaypal-user-1',
      }),
    );
    expect(request.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(request.body))).toEqual(
      expect.objectContaining({
        user_id: 'kaypal-user-1',
        amount: 3,
        service_type: 'ai_content_workbench',
        resource_type: 'redfox_external_data',
        metadata: expect.objectContaining({
          billingAuthSource: 'server-api-key',
          idempotencyKey: 'ai-content:redfox:search:1',
          endpoint: 'POST /story/api/dyData/searchArticle',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'charged',
        amount: 3,
        transactionId: 'external-data-transaction-1',
        balanceAfter: 997,
        policyVersion: 'commercial-credit-v1-2026-06-29',
      }),
    );
  });

  it('retries external data credit deduction with server billing key when desktop token is stale', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: jest.fn().mockResolvedValue({ error: 'Please login first.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'external-data-transaction-2',
          billing: {
            amount: 2,
            balanceAfter: 998,
          },
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const authRequestContext = {
      get: jest.fn(() => ({
        user: {
          id: 'operator-1',
          kaypalUserId: 'kaypal-user-1',
          kaypalDesktopAccessToken: 'expired-token',
        },
      })),
    } as unknown as AuthRequestContextService;
    const config = makeConfigMock({
      KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
      KAYPAL_API_KEY: 'server-billing-key',
      KAYPAL_RUNTIME_BILLING_TIMEOUT_MS: '8000',
    });
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
      undefined,
      undefined,
      authRequestContext,
      config,
    );

    const result = await service.deductExternalDataCredits({
      idempotencyKey: 'ai-content:redfox:comment:1',
      mode: 'redfox_comment',
      taskType: 'douyin_comment_search',
      amount: 2,
      runtimeMinutes: 1,
      replies: 0,
      platformActions: 1,
      leads: 0,
      evidences: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstRequest] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const [, secondRequest] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(firstRequest.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer expired-token',
      }),
    );
    expect(secondRequest.headers).toEqual(
      expect.objectContaining({
        'x-kaypal-api-key': 'server-billing-key',
        'x-kaypal-user-id': 'kaypal-user-1',
      }),
    );
    expect(JSON.parse(String(secondRequest.body))).toEqual(
      expect.objectContaining({
        user_id: 'kaypal-user-1',
        amount: 2,
        metadata: expect.objectContaining({
          billingAuthSource: 'server-api-key',
          idempotencyKey: 'ai-content:redfox:comment:1',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'charged',
        amount: 2,
        transactionId: 'external-data-transaction-2',
        balanceAfter: 998,
      }),
    );
  });

  it('retries external data credit deduction with server billing key when desktop token request times out', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('The operation was aborted due to timeout'),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'external-data-transaction-3',
          billing: {
            amount: 80,
            balanceAfter: 920,
          },
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const authRequestContext = {
      get: jest.fn(() => ({
        user: {
          id: 'operator-1',
          kaypalUserId: 'kaypal-user-1',
          kaypalDesktopAccessToken: 'timeout-token',
        },
      })),
    } as unknown as AuthRequestContextService;
    const config = makeConfigMock({
      KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
      KAYPAL_API_KEY: 'server-billing-key',
      KAYPAL_RUNTIME_BILLING_TIMEOUT_MS: '8000',
    });
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
      undefined,
      undefined,
      authRequestContext,
      config,
    );

    const result = await service.deductExternalDataCredits({
      idempotencyKey: 'ai-content:redfox:comment:timeout',
      mode: 'redfox_comment',
      taskType: 'douyin_comment_search',
      amount: 1,
      runtimeMinutes: 1,
      replies: 0,
      platformActions: 1,
      leads: 0,
      evidences: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondRequest] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(secondRequest.headers).toEqual(
      expect.objectContaining({
        'x-kaypal-api-key': 'server-billing-key',
        'x-kaypal-user-id': 'kaypal-user-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'charged',
        amount: 80,
        transactionId: 'external-data-transaction-3',
        balanceAfter: 920,
      }),
    );
  });

  it('reports external data insufficient credits as a payment-required business error', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: jest.fn().mockResolvedValue({ error: 'INSUFFICIENT_CREDITS' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const authRequestContext = {
      get: jest.fn(() => ({
        user: {
          id: 'operator-1',
          kaypalUserId: 'kaypal-user-1',
          kaypalDesktopAccessToken: '',
        },
      })),
    } as unknown as AuthRequestContextService;
    const config = makeConfigMock({
      KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
      KAYPAL_API_KEY: 'server-billing-key',
      KAYPAL_RUNTIME_BILLING_TIMEOUT_MS: '8000',
    });
    const service = new AiEmployeeService(
      makeRuntimeMock(),
      makeLocalEngineMock(),
      undefined,
      undefined,
      authRequestContext,
      config,
    );

    await expect(
      service.deductExternalDataCredits({
        idempotencyKey: 'ai-content:redfox:search:insufficient',
        mode: 'redfox_search',
        taskType: 'douyin_post_search',
        amount: 80,
        runtimeMinutes: 1,
        replies: 0,
        platformActions: 1,
        leads: 0,
        evidences: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_CREDITS',
        message: '积分余额不足，请充值或调整任务消耗后再试。',
      }),
      status: 402,
    });
  });
});
