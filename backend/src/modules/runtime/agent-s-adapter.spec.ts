import { AgentSExecutorAdapter } from './agent-s-adapter';
import type { AgentSService } from '../agent-s/agent-s.service';
import type {
  ExecutorContext,
  ExecutorTask,
  ExecutorTaskPlatform,
} from './executor.interface';

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

/**
 * 创建可控制的 AgentSService mock，覆盖 Adapter 用到的全部方法。
 */
function createAgentSMock(opts: {
  createSessionResult?: unknown;
  createSessionThrows?: Error;
  runTaskResult?: unknown;
  runTaskThrows?: Error;
  eventsBatches?: Array<{
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
  }>;
  healthResult?: { ok?: boolean; status?: string; version?: string };
  healthThrows?: Error;
}) {
  const createSession = jest.fn();
  if (opts.createSessionThrows) {
    createSession.mockRejectedValue(opts.createSessionThrows);
  } else {
    createSession.mockResolvedValue(
      opts.createSessionResult ?? {
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
      },
    );
  }

  const runTask = jest.fn();
  if (opts.runTaskThrows) {
    runTask.mockRejectedValue(opts.runTaskThrows);
  } else {
    runTask.mockResolvedValue(
      opts.runTaskResult ?? {
        accepted: true,
        session_id: 'session-1',
        run_id: 'run-1',
        status: 'running',
      },
    );
  }

  const getEvents = jest.fn();
  const batches = opts.eventsBatches ?? [
    {
      events: [
        {
          seq: 1,
          session_id: 'session-1',
          event_type: 'TaskCompleted',
          status: 'completed',
          created_at: new Date().toISOString(),
          message: '执行完成',
          payload: {},
        },
      ],
      next_seq: 1,
    },
  ];
  let callIdx = 0;
  getEvents.mockImplementation(() => {
    const batch = batches[Math.min(callIdx, batches.length - 1)];
    callIdx += 1;
    return Promise.resolve({
      session_id: 'session-1',
      after_seq: 0,
      ...batch,
    });
  });

  const health = jest.fn();
  if (opts.healthThrows) {
    health.mockRejectedValue(opts.healthThrows);
  } else {
    health.mockResolvedValue(
      opts.healthResult ?? { ok: true, status: 'ready', version: 'test' },
    );
  }

  return {
    createSession,
    runTask,
    getEvents,
    health,
  } as unknown as AgentSService;
}

describe('AgentSExecutorAdapter', () => {
  // =========================================================================
  // canHandle
  // =========================================================================
  describe('canHandle', () => {
    const adapter = new AgentSExecutorAdapter(createAgentSMock({}));

    it('wechat-desktop 任务返回 ok=true, priority=90', () => {
      const cap = adapter.canHandle(makeTask('wechat-desktop'));
      expect(cap.ok).toBe(true);
      expect(cap.priority).toBe(90);
    });

    it('douyin 任务返回 ok=false（应命中 local-runtime）', () => {
      const cap = adapter.canHandle(makeTask('douyin'));
      expect(cap.ok).toBe(false);
      expect(cap.reason).toContain('local-runtime');
    });

    it('wechat-channel 任务返回 ok=false（浏览器 CDP，应命中 local-runtime）', () => {
      const cap = adapter.canHandle(makeTask('wechat-channel'));
      expect(cap.ok).toBe(false);
      expect(cap.reason).toContain('local-runtime');
    });

    it('mixed 平台返回 ok=true, priority=50（桌面路径兜底）', () => {
      const cap = adapter.canHandle(makeTask('mixed'));
      expect(cap.ok).toBe(true);
      expect(cap.priority).toBe(50);
    });
  });

  // =========================================================================
  // execute - 成功路径
  // =========================================================================
  describe('execute - 成功路径', () => {
    it('createSession + runTask + 轮询到 completed → ok=true, status=success', async () => {
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'TaskCompleted',
                status: 'completed',
                created_at: new Date().toISOString(),
                message: '微信回复发送成功',
              },
            ],
            next_seq: 1,
          },
        ],
      });

      const adapter = new AgentSExecutorAdapter(mock);
      const result = await adapter.execute(makeTask('mixed'), baseCtx);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
      expect(result.reasonCode).toBe('success');
      expect(result.runtime.mode).toBe('agent-s');
      expect(result.runtime.executor).toBe('desktop-agent-s');
      expect(result.runtime.agentSSessionId).toBe('session-1');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].type).toBe('agent-s-action-log');

      expect(mock.createSession).toHaveBeenCalledTimes(1);
      expect(mock.runTask).toHaveBeenCalledTimes(1);
    });

    it('waiting_approval 终止状态 → ok=false, status=blocked, reasonCode=review_required', async () => {
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'ApprovalRequired',
                status: 'waiting_approval',
                created_at: new Date().toISOString(),
                message: '需要人工审批',
              },
            ],
            next_seq: 1,
          },
        ],
      });

      const adapter = new AgentSExecutorAdapter(mock);
      const result = await adapter.execute(makeTask('wechat-desktop'), {
        ...baseCtx,
        sendMode: 'draft-only',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe('blocked');
      expect(result.reasonCode).toBe('review_required');
    });

    it('多轮轮询：第一次 running + 第二次 completed → 真正多轮且 after_seq 正确传递', async () => {
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'StepStarted',
                status: 'running',
                created_at: new Date().toISOString(),
                step_index: 0,
              },
            ],
            next_seq: 1,
          },
          {
            events: [
              {
                seq: 2,
                session_id: 'session-1',
                event_type: 'TaskCompleted',
                status: 'completed',
                created_at: new Date().toISOString(),
                message: '已完成',
              },
            ],
            next_seq: 2,
          },
        ],
      });

      // 短间隔，跑得快
      const adapter = new AgentSExecutorAdapter(mock);
      adapter.pollTimeoutMs = 1000;
      adapter.pollIntervalMs = 1;
      const result = await adapter.execute(makeTask('mixed'), baseCtx);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
      // getEvents 至少被调用 2 次
      expect(mock.getEvents).toHaveBeenCalledTimes(2);
      // 第一次 after_seq 未传；第二次传 1
      expect(mock.getEvents.mock.calls[0][1]).toBeUndefined();
      expect(mock.getEvents.mock.calls[1][1]).toBe(1);
      // 证据中应有 2 条事件
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].raw).toMatchObject({
        collectedCount: 2,
      });
    });

    it('cancelled 终止状态 → ok=false, status=failed, reasonCode=send_failed', async () => {
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'TaskCancelled',
                status: 'cancelled',
                created_at: new Date().toISOString(),
                message: '用户取消',
              },
            ],
            next_seq: 1,
          },
        ],
      });
      const adapter = new AgentSExecutorAdapter(mock);
      adapter.pollTimeoutMs = 1000;
      adapter.pollIntervalMs = 1;
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reasonCode).toBe('send_failed');
      expect(result.userMessage).toContain('被取消');
    });

    it('failed 终止状态 → ok=false, status=failed, reasonCode=send_failed', async () => {
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'TaskFailed',
                status: 'failed',
                created_at: new Date().toISOString(),
                message: '客户不存在',
              },
            ],
            next_seq: 1,
          },
        ],
      });
      const adapter = new AgentSExecutorAdapter(mock);
      adapter.pollTimeoutMs = 1000;
      adapter.pollIntervalMs = 1;
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reasonCode).toBe('send_failed');
    });

    it('failed 终止事件透传 target_not_found reasonCode', async () => {
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'task_failed',
                status: 'failed',
                created_at: new Date().toISOString(),
                message: '自动加好友没有可处理对象',
                payload: { reasonCode: 'target_not_found' },
              },
            ],
            next_seq: 1,
          },
        ],
      });
      const adapter = new AgentSExecutorAdapter(mock);
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reasonCode).toBe('target_not_found');
    });

    it('单 batch 内 terminal 在中间位置（非末位）→ 仍能正确识别 completed', async () => {
      // 验证 Fix 1：scan 整个 batch 找 seq 最大的 terminal
      // 不只看 batch 末位（旧实现漏判）
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'StepStarted',
                status: 'running',
                created_at: new Date().toISOString(),
              },
              {
                seq: 2,
                session_id: 'session-1',
                event_type: 'TaskCompleted',
                status: 'completed',
                created_at: new Date().toISOString(),
                message: '任务完成',
              },
              {
                seq: 3,
                session_id: 'session-1',
                event_type: 'StepStarted',
                status: 'running',
                created_at: new Date().toISOString(),
                step_index: 1,
              },
            ],
            next_seq: 3,
          },
        ],
      });
      const adapter = new AgentSExecutorAdapter(mock);
      adapter.pollTimeoutMs = 1000;
      adapter.pollIntervalMs = 1;
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
      // evidence 应包含全部 3 条事件
      expect(result.evidence[0].raw).toMatchObject({ collectedCount: 3 });
    });

    it('单 batch 内多个 terminal → 取 seq 最大的', async () => {
      // 验证 Fix 1：多 terminal 时取 latest by seq
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'StepStarted',
                status: 'running',
                created_at: new Date().toISOString(),
              },
              {
                seq: 2,
                session_id: 'session-1',
                event_type: 'TaskFailed',
                status: 'failed',
                created_at: new Date().toISOString(),
                message: '中间失败',
              },
              {
                seq: 3,
                session_id: 'session-1',
                event_type: 'TaskCompleted',
                status: 'completed',
                created_at: new Date().toISOString(),
                message: '最终完成',
              },
            ],
            next_seq: 3,
          },
        ],
      });
      const adapter = new AgentSExecutorAdapter(mock);
      adapter.pollTimeoutMs = 1000;
      adapter.pollIntervalMs = 1;
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      // 期望：取 seq=3 的 completed（不是 seq=2 的 failed）
      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
    });

    it('runTask 失败时 evidence 含 session 信息（不再是空）', async () => {
      // 验证 Fix 2：runTask 失败时 evidence 应有 session 标记
      const mock = createAgentSMock({
        runTaskThrows: new Error('runtime/runs 404'),
      });
      const adapter = new AgentSExecutorAdapter(mock);
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reasonCode).toBe('send_failed');
      // 验证 evidence 不为空
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].type).toBe('text');
      expect(result.evidence[0].label).toContain('session-1');
      expect(result.evidence[0].label).toContain('已建');
      expect(result.evidence[0].raw).toMatchObject({
        sessionId: 'session-1',
        failurePhase: 'runTask',
      });
    });

    it('轮询超时 → status=failed + technicalMessage 含超时秒数', async () => {
      // 全部 batch 都给 running（mock 不会终止），用 clamp 拿最后一条
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'StepStarted',
                status: 'running',
                created_at: new Date().toISOString(),
              },
            ],
            next_seq: 1,
          },
        ],
      });
      const adapter = new AgentSExecutorAdapter(mock);
      // 2026-08-23 去 flaky：原来是 30ms/5ms（只有 6 轮预算）。jest 并发跑 40+
      // 套件时单个事件循环 tick 就可能吃掉 30ms，导致只轮询 1 次、`>=2` 假红
      // （实测并发下失败、单跑 3/3 通过）。放宽到 300ms/5ms（约 60 轮预算），
      // 语义不变但对负载抖动免疫。
      adapter.pollTimeoutMs = 300;
      adapter.pollIntervalMs = 5;
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reasonCode).toBe('send_failed');
      expect(result.technicalMessage).toContain('300ms');
      // 至少轮询 2 次
      expect(mock.getEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('non-desktop fallback uses node-agent-runtime without calling legacy AgentSService', async () => {
      const mock = createAgentSMock({
        createSessionThrows: new Error('legacy 17777 should not be called'),
      });
      const nodeRuntime = {
        createSession: jest.fn(() => ({
          session: {
            session_id: 'node-session-1',
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
        })),
        runTask: jest.fn().mockResolvedValue({
          accepted: true,
          session_id: 'node-session-1',
          run_id: 'node-run-1',
          status: 'completed',
        }),
        getEvents: jest.fn(() => ({
          session_id: 'node-session-1',
          after_seq: 0,
          next_seq: 3,
          events: [
            {
              seq: 1,
              session_id: 'node-session-1',
              event_type: 'task_started',
              status: 'running',
              created_at: new Date().toISOString(),
              message: 'started',
              payload: {},
            },
            {
              seq: 3,
              session_id: 'node-session-1',
              event_type: 'task_completed',
              status: 'completed',
              created_at: new Date().toISOString(),
              message: 'Node Runtime 微信发送完成',
              payload: {},
            },
          ],
        })),
        getArtifacts: jest.fn(() => ({
          session_id: 'node-session-1',
          artifacts: [
            {
              artifact_id: 'artifact-1',
              session_id: 'node-session-1',
              kind: 'json',
              filename: 'artifact.json',
              path: 'memory://artifact',
              created_at: '2026-06-16T00:00:00.000Z',
              size_bytes: 100,
              metadata: {},
            },
          ],
        })),
        getArtifact: jest.fn(() => ({
          artifact: {
            artifact_id: 'artifact-1',
            session_id: 'node-session-1',
            kind: 'json',
            filename: 'artifact.json',
            path: 'memory://artifact',
            created_at: '2026-06-16T00:00:00.000Z',
            size_bytes: 100,
            metadata: {},
          },
          content: JSON.stringify({
            result: {
              screenshotPath: '/tmp/wechat-node-runtime.png',
              reply: '测试回复',
              readText: '客户问今天能预约吗',
              replyGeneratedBy: 'ai',
              readbackText: '微信消息已自动发送：KayPal (4) / 测试回复',
              replyVisible: true,
            },
          }),
        })),
      };
      const adapter = new AgentSExecutorAdapter(mock, nodeRuntime as any);
      const result = await adapter.execute(makeTask('mixed'), baseCtx);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
      expect(result.runtime.agentSSessionId).toBe('node-session-1');
      expect(result.userMessage).toBe('Node Runtime 微信发送完成');
      expect(result.readback).toEqual({
        expectedText: '测试回复',
        actualText: '微信消息已自动发送：KayPal (4) / 测试回复',
        matched: true,
      });
      expect(result.sourceText).toBe('客户问今天能预约吗');
      expect(result.targetText).toBe('客户问今天能预约吗');
      expect(result.replyText).toBe('测试回复');
      expect(result.replyGeneratedBy).toBe('ai');
      expect(result.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'screenshot',
            path: '/tmp/wechat-node-runtime.png',
          }),
          expect.objectContaining({
            type: 'agent-s-action-log',
          }),
        ]),
      );
      expect(mock.createSession).not.toHaveBeenCalled();
      expect(nodeRuntime.createSession).toHaveBeenCalledTimes(1);
      expect(nodeRuntime.runTask).toHaveBeenCalledTimes(1);
      expect(nodeRuntime.getEvents).toHaveBeenCalledWith('node-session-1');
      expect(nodeRuntime.getArtifacts).toHaveBeenCalledWith('node-session-1');
      expect(nodeRuntime.getArtifact).toHaveBeenCalledWith(
        'node-session-1',
        'artifact-1',
      );
    });

    it('keeps desktop WeChat on Agent-S even when Node Runtime is injected', async () => {
      const mock = createAgentSMock({
        eventsBatches: [
          {
            events: [
              {
                seq: 1,
                session_id: 'session-1',
                event_type: 'SkillCompleted',
                status: 'completed',
                created_at: new Date().toISOString(),
                message: 'Windows 微信原生执行完成',
                payload: {
                  results: [{ target: '客户甲', ok: true, status: 'success' }],
                },
              },
            ],
            next_seq: 1,
          },
        ],
      });
      const nodeRuntime = {
        createSession: jest.fn(),
        runTask: jest.fn(),
      };
      const adapter = new AgentSExecutorAdapter(mock, nodeRuntime as any);

      const result = await adapter.execute(
        makeTask('wechat-desktop', { type: 'wechat-group-broadcast' }),
        baseCtx,
      );

      expect(result.ok).toBe(true);
      expect(result.result?.results).toEqual([
        expect.objectContaining({ target: '客户甲', ok: true }),
      ]);
      expect(mock.createSession).toHaveBeenCalledTimes(1);
      expect(mock.runTask).toHaveBeenCalledTimes(1);
      expect(nodeRuntime.createSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // execute - 失败路径
  // =========================================================================
  describe('execute - 失败路径', () => {
    it('createSession 抛异常 → reject + agent_s_unavailable', async () => {
      const mock = createAgentSMock({
        createSessionThrows: new Error('sidecar 离线'),
      });

      const adapter = new AgentSExecutorAdapter(mock);
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('agent_s_unavailable');
      expect(result.technicalMessage).toContain('sidecar 离线');
      expect(mock.runTask).not.toHaveBeenCalled();
    });

    it('runTask 抛异常 → status=failed + reasonCode=send_failed（会话已建但任务下发失败）', async () => {
      const mock = createAgentSMock({
        runTaskThrows: new Error('runtime/runs 404'),
      });

      const adapter = new AgentSExecutorAdapter(mock);
      const result = await adapter.execute(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reasonCode).toBe('send_failed');
      expect(result.runtime.agentSSessionId).toBe('session-1');
      expect(result.technicalMessage).toContain('runtime/runs 404');
    });
  });

  // =========================================================================
  // isHealthy
  // =========================================================================
  describe('isHealthy', () => {
    it('health() 返回 ok=true → 转 ok=true', async () => {
      const mock = createAgentSMock({
        healthResult: { ok: true, status: 'ready', version: '1.0.0' },
      });
      const adapter = new AgentSExecutorAdapter(mock);
      const health = await adapter.isHealthy();

      expect(health.ok).toBe(true);
      expect(health.details).toContain('ready');
    });

    it('health() 抛异常 → ok=false + details 含错误信息', async () => {
      const mock = createAgentSMock({
        healthThrows: new Error('connect ECONNREFUSED'),
      });
      const adapter = new AgentSExecutorAdapter(mock);
      const health = await adapter.isHealthy();

      expect(health.ok).toBe(false);
      expect(health.details).toContain('ECONNREFUSED');
    });

    it('Node Runtime 注入时健康检查走 node-agent-runtime，不触发旧 17777 health', async () => {
      const mock = createAgentSMock({
        healthThrows: new Error('legacy 17777 should not be called'),
      });
      const nodeRuntime = {
        health: jest.fn().mockResolvedValue({
          ok: true,
          status: 'ready',
          service: 'node-agent-runtime',
          runner_mode: 'node-playwright',
          capabilities: {
            browserControl: true,
            persistentProfiles: true,
            localQueue: true,
            evidenceStore: true,
            approvalGate: true,
          },
          blockers: [],
          reasons: [],
        }),
      };
      const adapter = new AgentSExecutorAdapter(mock, nodeRuntime as any);
      const health = await adapter.isHealthy();

      expect(health.ok).toBe(true);
      expect(health.details).toContain('node-agent-runtime');
      expect(health.details).toContain('browserControl=true');
      expect(mock.health).not.toHaveBeenCalled();
      expect(nodeRuntime.health).toHaveBeenCalledTimes(1);
    });
  });
});
