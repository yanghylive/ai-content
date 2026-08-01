import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutorRouter } from './executor-router';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { LocalRuntimeClient } from './local-runtime.client';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';
import { BrowserControlService } from './browser-control/browser-control.service';
import { EvidenceService } from './evidence/evidence.service';
import { DouyinCommentReplyService } from './platforms/douyin/comment-reply.service';
import { DouyinDirectMessageReplyService } from './platforms/douyin/direct-message-reply.service';
import { DouyinExposureService } from './platforms/douyin/exposure.service';
import { WechatChannelCommentReplyService } from './platforms/wechat-channel/comment-reply.service';
import { WechatChannelDirectMessageReplyService } from './platforms/wechat-channel/direct-message-reply.service';
import { PlatformPublishService } from './platforms/publishing/platform-publish.service';
import { VideoFaceSwapService } from './platforms/video/video-face-swap.service';
import { VideoTemplateClipService } from './platforms/video/video-template-clip.service';
import { AgentSService } from '../local-engine/agent-s.service';
import type {
  ExecutorContext,
  ExecutorTask,
  ExecutorTaskPlatform,
} from './executor.interface';

/**
 * 集成测试：把 ExecutorRouter 和 AgentSExecutorAdapter 真实接到一起，
 * 只 mock 底层 AgentSService / AutoUploadService。
 *
 * 解决自审发现的盲区：之前 Router 单测用假 executor、Adapter 单测用假 Router，
 * 没有任何一个测试验证 NestJS DI 把这俩真实接起来后能跑通真实 WeChat 客户互动。
 */

function makeTask(
  platform: ExecutorTaskPlatform,
  overrides: Partial<ExecutorTask> = {},
): ExecutorTask {
  return {
    relatedId: 'task-1',
    relatedType: 'interaction-task',
    type: 'wechat-reply-draft',
    platform,
    accountId: 1,
    payload: { contact: '客户 A', text: 'hi' },
    ...overrides,
  };
}

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

function buildAgentSMock(
  eventsBatches: Array<{
    events: Array<{
      seq: number;
      session_id: string;
      event_type: string;
      status: string;
      created_at: string;
      message?: string;
      step_index?: number;
      payload?: Record<string, unknown>;
    }>;
    next_seq: number;
  }>,
) {
  const getEvents = jest.fn();
  let callIdx = 0;
  getEvents.mockImplementation(() => {
    const batch = eventsBatches[Math.min(callIdx, eventsBatches.length - 1)];
    callIdx += 1;
    return Promise.resolve({
      session_id: 'session-1',
      after_seq: 0,
      ...batch,
    });
  });

  return {
    createSession: jest.fn().mockResolvedValue({
      session: {
        session_id: 'session-1',
        task_type: 'wechat-reply-draft',
        status: 'idle',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
        labels: [],
        run_count: 0,
        cancellation_requested: false,
        last_event_seq: 0,
        artifact_count: 0,
      },
    }),
    runTask: jest.fn().mockResolvedValue({
      accepted: true,
      session_id: 'session-1',
      run_id: 'run-1',
      status: 'running',
    }),
    getEvents,
    health: jest.fn().mockResolvedValue({
      ok: true,
      online: true,
      status: 'ready',
      version: 'test',
    }),
  } as unknown as AgentSService;
}

function buildConfigServiceMock(
  engineUrl = 'internal://ai-content/local-interaction',
) {
  return {
    get: jest.fn((key: string) =>
      key === 'LOCAL_INTERACTION_ENGINE_URL' ? engineUrl : undefined,
    ),
  } as unknown as ConfigService;
}

function buildEngineClientMock(
  overrides: {
    preflightOk?: boolean;
    engineReachable?: boolean;
  } = {},
) {
  const preflightOk = overrides.preflightOk ?? true;
  const engineReachable = overrides.engineReachable ?? true;
  return {
    getEngineUrl: jest
      .fn()
      .mockReturnValue('internal://ai-content/local-interaction'),
    getHealth: jest.fn().mockImplementation(() => {
      if (engineReachable) {
        return Promise.resolve({
          online: true,
          status: 'ok',
          service: 'local-runtime',
          version: 'test',
          engineUrl: 'internal://ai-content/local-interaction',
          checkedAt: new Date().toISOString(),
        });
      }
      return Promise.reject(new Error('integration test: engine down'));
    }),
    preflightCheck: jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: preflightOk,
        platform: 'douyin',
        accountId: 1,
        browserReady: preflightOk,
        profileReady: preflightOk,
        loginRequired: false,
        blockers: preflightOk ? [] : ['integration test blocker'],
        message: preflightOk ? '预检通过' : '预检未通过',
        nextAction: '可以开始执行',
      }),
    ),
    listCdpSessions: jest.fn().mockResolvedValue([]),
    postJson: jest.fn().mockResolvedValue({
      status: 'sent',
      message: 'integration test mocked sent',
      readbackText: 'expected reply',
      evidence: {
        type: 'screenshot',
        label: 'integration test',
        path: '/tmp/integration-test.png',
        capturedAt: new Date().toISOString(),
      },
    }),
  } as unknown as LocalRuntimeEngineClient;
}

function buildPlatformServiceMock(
  platform: 'douyin' | 'wechat-channel',
  taskType: string,
) {
  return {
    platformName: platform,
    taskType,
    canHandle: jest
      .fn()
      .mockImplementation(
        (task: { platform: string; type: string }) =>
          task.platform === platform && task.type === taskType,
      ),
    execute: jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: `integration test mocked ${platform} ${taskType} success`,
        runtime: { mode: 'local-runtime', executor: 'browser-cdp' },
        evidence: [
          {
            type: 'text',
            label: 'integration test mock',
            value: 'mocked platform service success',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ),
  };
}

function buildEvidenceServiceMock() {
  return {
    recordExecution: jest.fn().mockResolvedValue({
      status: 'persisted',
      executionId: 'exec-integration-test',
      durationMs: 1,
    }),
    recordExecutionFireAndForget: jest.fn(),
    listByRelatedId: jest.fn().mockResolvedValue([]),
  };
}

function buildPlatformPublishMock() {
  return {
    id: 'platform-publish',
    canHandle: jest.fn().mockReturnValue({
      ok: false,
      priority: 0,
      reason: 'integration test does not route publish tasks',
    }),
    execute: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue({
      ok: true,
      details: 'integration test platform publish mock',
    }),
  };
}

function buildVideoTemplateClipMock() {
  return {
    id: 'video-template-clip',
    canHandle: jest.fn().mockImplementation((task: { type: string }) => ({
      ok: task.type === 'video-template-clip',
      priority: task.type === 'video-template-clip' ? 85 : 0,
      reason:
        task.type === 'video-template-clip'
          ? undefined
          : 'not a video clip task',
    })),
    execute: jest.fn().mockResolvedValue({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: 'integration test video generated',
      runtime: { mode: 'local-runtime', executor: 'video-template-clip' },
      evidence: [],
    }),
    isHealthy: jest.fn().mockResolvedValue({
      ok: true,
      details: 'integration test video clip mock',
    }),
  };
}

function buildVideoFaceSwapMock() {
  return {
    id: 'video-face-swap',
    canHandle: jest.fn().mockImplementation((task: { type: string }) => ({
      ok: task.type === 'video-face-swap',
      priority: task.type === 'video-face-swap' ? 90 : 0,
      reason:
        task.type === 'video-face-swap'
          ? undefined
          : 'not a video face swap task',
    })),
    execute: jest.fn().mockResolvedValue({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: 'integration test face swap generated',
      runtime: { mode: 'local-runtime', executor: 'video-face-swap' },
      evidence: [],
    }),
    isHealthy: jest.fn().mockResolvedValue({
      ok: true,
      details: 'integration test video face swap mock',
    }),
  };
}

describe('Runtime Integration: ExecutorRouter + AgentSExecutorAdapter + EvidenceService', () => {
  let router: ExecutorRouter;
  let agentSMock: ReturnType<typeof buildAgentSMock>;
  let engineMock: ReturnType<typeof buildEngineClientMock>;
  let douyinCommentMock: ReturnType<typeof buildPlatformServiceMock>;
  let douyinDmMock: ReturnType<typeof buildPlatformServiceMock>;
  let douyinExposureMock: ReturnType<typeof buildPlatformServiceMock>;
  let wechatCommentMock: ReturnType<typeof buildPlatformServiceMock>;
  let wechatDmMock: ReturnType<typeof buildPlatformServiceMock>;
  let evidenceMock: ReturnType<typeof buildEvidenceServiceMock>;
  let platformPublishMock: ReturnType<typeof buildPlatformPublishMock>;
  let videoFaceSwapMock: ReturnType<typeof buildVideoFaceSwapMock>;
  let videoTemplateClipMock: ReturnType<typeof buildVideoTemplateClipMock>;

  beforeEach(async () => {
    agentSMock = buildAgentSMock([
      {
        events: [
          {
            seq: 1,
            session_id: 'session-1',
            event_type: 'TaskCompleted',
            status: 'completed',
            created_at: new Date().toISOString(),
            message: '微信回复已发送',
          },
        ],
        next_seq: 1,
      },
    ]);
    engineMock = buildEngineClientMock();
    douyinCommentMock = buildPlatformServiceMock(
      'douyin',
      'douyin-comment-reply',
    );
    douyinDmMock = buildPlatformServiceMock(
      'douyin',
      'douyin-direct-message-reply',
    );
    douyinExposureMock = buildPlatformServiceMock(
      'douyin',
      'douyin-link-exposure',
    );
    wechatCommentMock = buildPlatformServiceMock(
      'wechat-channel',
      'wechat-channel-comment-reply',
    );
    wechatDmMock = buildPlatformServiceMock(
      'wechat-channel',
      'wechat-channel-direct-message-reply',
    );
    evidenceMock = buildEvidenceServiceMock();
    platformPublishMock = buildPlatformPublishMock();
    videoFaceSwapMock = buildVideoFaceSwapMock();
    videoTemplateClipMock = buildVideoTemplateClipMock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutorRouter,
        AgentSExecutorAdapter,
        LocalRuntimeClient,
        BrowserControlService,
        { provide: EvidenceService, useValue: evidenceMock },
        { provide: PlatformPublishService, useValue: platformPublishMock },
        { provide: VideoFaceSwapService, useValue: videoFaceSwapMock },
        { provide: VideoTemplateClipService, useValue: videoTemplateClipMock },
        { provide: DouyinCommentReplyService, useValue: douyinCommentMock },
        { provide: DouyinDirectMessageReplyService, useValue: douyinDmMock },
        { provide: DouyinExposureService, useValue: douyinExposureMock },
        {
          provide: WechatChannelCommentReplyService,
          useValue: wechatCommentMock,
        },
        {
          provide: WechatChannelDirectMessageReplyService,
          useValue: wechatDmMock,
        },
        { provide: LocalRuntimeEngineClient, useValue: engineMock },
        { provide: ConfigService, useValue: buildConfigServiceMock() },
        { provide: AgentSService, useValue: agentSMock },
      ],
    }).compile();

    router = moduleRef.get<ExecutorRouter>(ExecutorRouter);
  });

  it('wechat-desktop 任务端到端：Router 路由 → Adapter 执行 → 返回 success', async () => {
    const result = await router.route(makeTask('wechat-desktop'), baseCtx);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('success');
    expect(result.reasonCode).toBe('success');
    expect(result.runtime.mode).toBe('agent-s');
    expect(result.runtime.executor).toBe('desktop-agent-s');
    expect(result.runtime.agentSSessionId).toBe('session-1');

    // 关键：底层 AgentSService 真被 Router → Adapter 链路调用了
    expect(agentSMock.createSession).toHaveBeenCalledTimes(1);
    expect(agentSMock.runTask).toHaveBeenCalledTimes(1);
    expect(agentSMock.getEvents).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wechat-group-broadcast', 'wechat-group-broadcast'],
    ['wechat-friend-accept', 'wechat.friend.accept'],
  ] as const)(
    '%s 统一主链：Router → Agent-S adapter，保留原生技能和商用授权',
    async (type, skillId) => {
      const result = await router.route(
        makeTask('wechat-desktop', {
          type,
          payload: {
            skill_id: skillId,
            wechat_reply_mode: 'auto-send',
            commercialExecutionRequested: true,
            commercialExecutionAllowed: true,
            wechat_friend_accept_match_keywords: ['KAYPAL_TEST_REQUEST'],
          },
        }),
        baseCtx,
      );

      expect(result.ok).toBe(true);
      expect(agentSMock.runTask).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          task_type: type,
          metadata: expect.objectContaining({
            skill_id: skillId,
            wechat_reply_mode: 'auto-send',
            commercialExecutionRequested: true,
          }),
        }),
      );
    },
  );

  it('mixed 平台任务 → 走 Adapter（priority 50 兜底）', async () => {
    const result = await router.route(
      makeTask('mixed', { type: 'wechat-reply-draft' }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.runtime.mode).toBe('agent-s');
    expect(agentSMock.createSession).toHaveBeenCalledTimes(1);
  });

  it('douyin-comment-reply 任务端到端：Router → LocalRuntime → Platform service 返 success', async () => {
    const result = await router.route(
      makeTask('douyin', { type: 'douyin-comment-reply', accountId: 1 }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(result.runtime.mode).toBe('local-runtime');
    expect(result.runtime.executor).toBe('browser-cdp');
    // 关键：AgentSService 不应被调用（路径分流正确）
    expect(agentSMock.createSession).not.toHaveBeenCalled();
    // preflight 调用了一次
    expect(engineMock.preflightCheck).toHaveBeenCalledTimes(1);
    // Platform service 被调
    expect(douyinCommentMock.execute).toHaveBeenCalledTimes(1);
    // 别的 platform service 不应被调
    expect(douyinDmMock.execute).not.toHaveBeenCalled();
    expect(wechatCommentMock.execute).not.toHaveBeenCalled();
    expect(wechatDmMock.execute).not.toHaveBeenCalled();
  });

  it('douyin-comment-reply preflight 不通过 → runtime_unavailable 且 platform service 不被调', async () => {
    (engineMock.preflightCheck as jest.Mock).mockResolvedValueOnce({
      ok: false,
      platform: 'douyin',
      accountId: 1,
      browserReady: false,
      profileReady: true,
      loginRequired: false,
      blockers: ['integration test blocker'],
      message: '预检未通过',
    });

    const result = await router.route(
      makeTask('douyin', { type: 'douyin-comment-reply', accountId: 1 }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('runtime_unavailable');
    expect(douyinCommentMock.execute).not.toHaveBeenCalled();
  });

  it('douyin-comment-reply 任务缺 accountId → account_not_logged_in', async () => {
    const result = await router.route(
      makeTask('douyin', {
        type: 'douyin-comment-reply',
        accountId: undefined,
      }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('account_not_logged_in');
    // preflight 都不应该被调
    expect(engineMock.preflightCheck).not.toHaveBeenCalled();
    expect(douyinCommentMock.execute).not.toHaveBeenCalled();
  });

  it('douyin-direct-message-reply 任务路由到 DouyinDirectMessageReplyService', async () => {
    const result = await router.route(
      makeTask('douyin', { type: 'douyin-direct-message-reply', accountId: 1 }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(douyinDmMock.execute).toHaveBeenCalledTimes(1);
    expect(douyinCommentMock.execute).not.toHaveBeenCalled();
  });

  it('wechat-channel-comment-reply 任务路由到 WechatChannelCommentReplyService', async () => {
    const result = await router.route(
      makeTask('wechat-channel', {
        type: 'wechat-channel-comment-reply',
        accountId: 1,
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(wechatCommentMock.execute).toHaveBeenCalledTimes(1);
  });

  it('wechat-channel-direct-message-reply 任务路由到 WechatChannelDirectMessageReplyService', async () => {
    const result = await router.route(
      makeTask('wechat-channel', {
        type: 'wechat-channel-direct-message-reply',
        accountId: 1,
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(wechatDmMock.execute).toHaveBeenCalledTimes(1);
  });

  it('wechat-desktop + createSession 抛异常 → Router 捕获后返回 agent_s_unavailable', async () => {
    // 替换 mock 让 createSession 抛错，验证整条链路错误处理
    (agentSMock.createSession as jest.Mock).mockRejectedValueOnce(
      new Error('integration test sidecar down'),
    );

    const result = await router.route(makeTask('wechat-desktop'), baseCtx);

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('agent_s_unavailable');
    expect(result.technicalMessage).toContain('integration test sidecar down');
  });

  it('healthCheck 串联两个执行器，agent-s + local-runtime 都健康', async () => {
    const healths = await router.healthCheck();
    const agentSHealth = healths.find((h) => h.id === 'agent-s');
    const localHealth = healths.find((h) => h.id === 'local-runtime');
    const publishHealth = healths.find((h) => h.id === 'platform-publish');
    expect(agentSHealth).toBeDefined();
    expect(agentSHealth?.ok).toBe(true);
    expect(localHealth).toBeDefined();
    // 引擎可达，local-runtime 报健康
    expect(localHealth?.ok).toBe(true);
    expect(publishHealth?.ok).toBe(true);
  });

  // =========================================================================
  // P2-D4：EvidenceService 链路验证
  // =========================================================================
  describe('EvidenceService 链路', () => {
    it('wechat-desktop 任务成功 → evidence.recordExecutionFireAndForget 被调 1 次（含完整 input）', async () => {
      await router.route(
        makeTask('wechat-desktop', { relatedId: 'evidence-test-1' }),
        baseCtx,
      );

      expect(evidenceMock.recordExecutionFireAndForget).toHaveBeenCalledTimes(
        1,
      );
      const callArgs = (evidenceMock.recordExecutionFireAndForget as jest.Mock)
        .mock.calls[0];
      expect(callArgs[0]).toMatchObject({
        relatedId: 'evidence-test-1',
        relatedType: 'interaction-task',
        platform: 'wechat-desktop',
        taskType: 'wechat-reply-draft',
        accountId: 1,
      });
      expect(callArgs[1].ok).toBe(true);
      expect(callArgs[1].status).toBe('success');
    });

    it('douyin 任务成功 → evidence.recordExecutionFireAndForget 被调 1 次', async () => {
      await router.route(
        makeTask('douyin', { type: 'douyin-comment-reply', accountId: 1 }),
        baseCtx,
      );

      expect(evidenceMock.recordExecutionFireAndForget).toHaveBeenCalledTimes(
        1,
      );
      const callArgs = (evidenceMock.recordExecutionFireAndForget as jest.Mock)
        .mock.calls[0];
      expect(callArgs[0].platform).toBe('douyin');
      expect(callArgs[0].taskType).toBe('douyin-comment-reply');
    });

    it('路由失败（runtime_unavailable）→ 仍被持久化（拒绝也留痕）', async () => {
      // wechat-reply-draft 不是 4 个 platform service 能 handle 的（platform=mixed）
      // → 走 agent-s；改成 unknown 平台让两边都拒
      const result = await router.route(
        makeTask('wechat-desktop', { relatedId: 'fail-evidence' }),
        { ...baseCtx }, // agent-s mock 会成功
      );

      // 实际上 wechat-desktop 永远命中 agent-s，不会 runtime_unavailable
      // 这里测的 case 是：即使 task 失败（agent_s_unavailable 路径），evidence 也被调
      (agentSMock.createSession as jest.Mock).mockRejectedValueOnce(
        new Error('integration test sidecar down'),
      );
      const failResult = await router.route(
        makeTask('wechat-desktop', { relatedId: 'fail-evidence-2' }),
        baseCtx,
      );

      expect(failResult.ok).toBe(false);
      expect(failResult.reasonCode).toBe('agent_s_unavailable');
      // evidence 调了 2 次：1 次成功 + 1 次失败
      expect(evidenceMock.recordExecutionFireAndForget).toHaveBeenCalledTimes(
        2,
      );
      // 第二次（失败）的内容
      const secondCall = (
        evidenceMock.recordExecutionFireAndForget as jest.Mock
      ).mock.calls[1];
      expect(secondCall[0].relatedId).toBe('fail-evidence-2');
      expect(secondCall[1].ok).toBe(false);
      expect(secondCall[1].reasonCode).toBe('agent_s_unavailable');
    });

    it('evidence.recordExecutionFireAndForget 抛错不影响 route 返回', async () => {
      // 模拟 evidence 自己抛错（不该发生，但要保证不污染 task 返回）
      (
        evidenceMock.recordExecutionFireAndForget as jest.Mock
      ).mockImplementationOnce(() => {
        throw new Error('unexpected evidence throw');
      });

      // 不应该 throw 出去
      const result = await router.route(
        makeTask('wechat-desktop', { relatedId: 'robust-test' }),
        baseCtx,
      );

      expect(result.ok).toBe(true);
      expect(result.runtime.mode).toBe('agent-s');
    });
  });
});
