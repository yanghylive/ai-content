import { Test, TestingModule } from '@nestjs/testing';
import { ExecutorRouter } from './executor-router';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { LocalRuntimeClient } from './local-runtime.client';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
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

function buildAutoUploadMock() {
  return {
    healthCheck: jest.fn().mockResolvedValue({ ok: false }),
    upload: jest.fn(),
    listConfigs: jest.fn().mockReturnValue([]),
  } as unknown as AutoUploadService;
}

describe('Runtime Integration: ExecutorRouter + AgentSExecutorAdapter', () => {
  let router: ExecutorRouter;
  let agentSMock: ReturnType<typeof buildAgentSMock>;
  let autoUploadMock: ReturnType<typeof buildAutoUploadMock>;

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
    autoUploadMock = buildAutoUploadMock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutorRouter,
        AgentSExecutorAdapter,
        LocalRuntimeClient,
        { provide: AgentSService, useValue: agentSMock },
        { provide: AutoUploadService, useValue: autoUploadMock },
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

  it('douyin 任务在 P1 阶段无人能 handle → runtime_unavailable', async () => {
    const result = await router.route(makeTask('douyin'), baseCtx);

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('runtime_unavailable');
    // 关键：AgentSService 不应被调用（路径分流正确）
    expect(agentSMock.createSession).not.toHaveBeenCalled();
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

  it('healthCheck 串联两个执行器，agent-s 真实健康', async () => {
    const healths = await router.healthCheck();
    const agentSHealth = healths.find((h) => h.id === 'agent-s');
    const localHealth = healths.find((h) => h.id === 'local-runtime');
    expect(agentSHealth).toBeDefined();
    expect(agentSHealth?.ok).toBe(true);
    expect(localHealth).toBeDefined();
    // local-runtime stub 返回 false
    expect(localHealth?.ok).toBe(false);
  });
});
