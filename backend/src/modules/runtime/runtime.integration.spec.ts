import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutorRouter } from './executor-router';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { LocalRuntimeClient } from './local-runtime.client';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';
import { BrowserControlService } from './browser-control/browser-control.service';
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

function buildConfigServiceMock(engineUrl = 'http://127.0.0.1:5409') {
  return {
    get: jest.fn((key: string) => (key === 'AUTO_UPLOAD_ENGINE_URL' ? engineUrl : undefined)),
  } as unknown as ConfigService;
}

function buildEngineClientMock(overrides: {
  preflightOk?: boolean;
  engineReachable?: boolean;
} = {}) {
  const preflightOk = overrides.preflightOk ?? true;
  const engineReachable = overrides.engineReachable ?? true;
  return {
    getEngineUrl: jest.fn().mockReturnValue('http://127.0.0.1:5409'),
    getHealth: jest.fn().mockImplementation(() => {
      if (engineReachable) {
        return Promise.resolve({
          online: true,
          status: 'ok',
          service: 'local-runtime',
          version: 'test',
          engineUrl: 'http://127.0.0.1:5409',
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
  } as unknown as LocalRuntimeEngineClient;
}

describe('Runtime Integration: ExecutorRouter + AgentSExecutorAdapter', () => {
  let router: ExecutorRouter;
  let agentSMock: ReturnType<typeof buildAgentSMock>;
  let engineMock: ReturnType<typeof buildEngineClientMock>;

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

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutorRouter,
        AgentSExecutorAdapter,
        LocalRuntimeClient,
        BrowserControlService,
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

  it('mixed 平台任务 → 走 Adapter（priority 50 兜底）', async () => {
    const result = await router.route(
      makeTask('mixed', { type: 'wechat-reply-draft' }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.runtime.mode).toBe('agent-s');
    expect(agentSMock.createSession).toHaveBeenCalledTimes(1);
  });

  it('douyin 任务在 P2-D1 阶段命中 local-runtime → preflight 通过则 success', async () => {
    const result = await router.route(
      makeTask('douyin', { accountId: 1 }),
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
  });

  it('douyin 任务 preflight 不通过 → runtime_unavailable', async () => {
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
      makeTask('douyin', { accountId: 1 }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('runtime_unavailable');
  });

  it('douyin 任务缺 accountId → account_not_logged_in', async () => {
    const result = await router.route(
      makeTask('douyin', { accountId: undefined }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('account_not_logged_in');
    // preflight 都不应该被调
    expect(engineMock.preflightCheck).not.toHaveBeenCalled();
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
    expect(agentSHealth).toBeDefined();
    expect(agentSHealth?.ok).toBe(true);
    expect(localHealth).toBeDefined();
    // 引擎可达，local-runtime 报健康
    expect(localHealth?.ok).toBe(true);
  });
});
