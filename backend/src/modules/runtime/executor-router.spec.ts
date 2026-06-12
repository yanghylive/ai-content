import { ExecutorRouter } from './executor-router';
import { LocalRuntimeClient } from './local-runtime.client';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import type {
  ExecutorCapability,
  ExecutorContext,
  ExecutorTask,
  RuntimeExecutionResult,
  TaskExecutor,
} from './executor.interface';

/**
 * 创建可控制的 TaskExecutor mock，便于测试 ExecutorRouter 的路由 / 护栏 / 异常处理逻辑。
 */
function createMockExecutor(opts: {
  id: TaskExecutor['id'];
  canHandleResult: ExecutorCapability;
  executeResult?: RuntimeExecutionResult;
  executeThrows?: Error;
  healthOk?: boolean;
}): TaskExecutor & {
  canHandleMock: jest.Mock;
  executeMock: jest.Mock;
} {
  const canHandleMock = jest.fn().mockReturnValue(opts.canHandleResult);
  const executeMock = jest.fn();

  if (opts.executeThrows) {
    executeMock.mockRejectedValue(opts.executeThrows);
  } else {
    executeMock.mockResolvedValue(
      opts.executeResult ??
        ({
          ok: true,
          status: 'success',
          reasonCode: 'success',
          userMessage: 'mock success',
          runtime: {
            mode: opts.id === 'agent-s' ? 'agent-s' : 'local-runtime',
            executor: opts.id === 'agent-s' ? 'desktop-agent-s' : 'browser-cdp',
          },
          evidence: [],
        } as RuntimeExecutionResult),
    );
  }

  return {
    id: opts.id,
    canHandle: canHandleMock as unknown as TaskExecutor['canHandle'],
    execute: executeMock as unknown as TaskExecutor['execute'],
    isHealthy: () => Promise.resolve({ ok: opts.healthOk !== false }),
    canHandleMock,
    executeMock,
  };
}

function makeTask(
  platform: ExecutorTask['platform'],
  type: ExecutorTask['type'] = 'douyin-comment-reply',
): ExecutorTask {
  return {
    relatedId: 'test-task-1',
    relatedType: 'interaction-task',
    type,
    platform,
    accountId: 1,
    payload: {},
  };
}

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

describe('ExecutorRouter', () => {
  /**
   * 通过反射注入 mock executors，避免依赖真实 LocalRuntimeClient / AgentSExecutorAdapter
   * 及它们的下游 AutoUploadService / AgentSService。
   */
  function buildRouter(executors: TaskExecutor[]): ExecutorRouter {
    const router = new ExecutorRouter(
      {} as LocalRuntimeClient,
      {} as never,
      {} as AgentSExecutorAdapter,
      // P2-D4：mock EvidenceService，单测不需要真持久化
      {
        recordExecutionFireAndForget: jest.fn(),
        recordExecution: jest.fn(),
        listByRelatedId: jest.fn().mockResolvedValue([]),
      } as never,
    );
    (router as unknown as { executors: TaskExecutor[] }).executors = executors;
    return router;
  }

  describe('canHandle 全部返回 false 的情况', () => {
    it('没有可用 executor 时返回 runtime_unavailable，不抛异常', async () => {
      const mock = createMockExecutor({
        id: 'local-runtime',
        canHandleResult: {
          ok: false,
          priority: 0,
          reason: 'P1 骨架阶段',
        },
      });

      const router = buildRouter([mock]);
      const result = await router.route(makeTask('douyin'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reasonCode).toBe('runtime_unavailable');
      expect(result.userMessage).toContain('没有可用的执行器');
      expect(result.technicalMessage).toContain('local-runtime: P1 骨架阶段');
      expect(mock.executeMock).not.toHaveBeenCalled();
    });
  });

  describe('微信桌面任务护栏', () => {
    it('wechat-desktop 任务命中 local-runtime 时强制 reject，不调用 execute', async () => {
      // 故意让 local-runtime 声称能处理桌面任务（违反护栏的情况）
      const local = createMockExecutor({
        id: 'local-runtime',
        canHandleResult: { ok: true, priority: 80 },
      });

      const router = buildRouter([local]);
      const result = await router.route(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('agent_s_unavailable');
      expect(result.userMessage).toContain('Agent-S');
      expect(local.executeMock).not.toHaveBeenCalled();
    });

    it('wechat-desktop 任务命中 agent-s 时正常 execute', async () => {
      const local = createMockExecutor({
        id: 'local-runtime',
        canHandleResult: {
          ok: false,
          priority: 0,
          reason: 'not desktop',
        },
      });
      const agentS = createMockExecutor({
        id: 'agent-s',
        canHandleResult: { ok: true, priority: 90 },
      });

      const router = buildRouter([local, agentS]);
      const result = await router.route(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(true);
      expect(result.reasonCode).toBe('success');
      expect(agentS.executeMock).toHaveBeenCalledTimes(1);
      expect(local.executeMock).not.toHaveBeenCalled();
    });
  });

  describe('浏览器任务正常路由', () => {
    it('有可用 executor 时正常调用 execute 并返回结果', async () => {
      const local = createMockExecutor({
        id: 'local-runtime',
        canHandleResult: { ok: true, priority: 70 },
      });

      const router = buildRouter([local]);
      const result = await router.route(makeTask('douyin'), baseCtx);

      expect(result.ok).toBe(true);
      expect(local.executeMock).toHaveBeenCalledTimes(1);
      expect(local.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'douyin' }),
        baseCtx,
      );
    });
  });

  describe('多 executor 优先级排序', () => {
    it('按 priority 降序选择，高优先级执行器先被调用', async () => {
      const low = createMockExecutor({
        id: 'local-runtime',
        canHandleResult: { ok: true, priority: 30 },
      });
      const high = createMockExecutor({
        id: 'agent-s',
        canHandleResult: { ok: true, priority: 90 },
      });

      // 故意把低优先级放前面，验证 sort 起作用
      const router = buildRouter([low, high]);
      await router.route(makeTask('mixed'), baseCtx);

      expect(high.executeMock).toHaveBeenCalledTimes(1);
      expect(low.executeMock).not.toHaveBeenCalled();
    });
  });

  describe('executor 抛异常时 Router 不向上抛', () => {
    it('local-runtime 抛异常 → 返回 runtime_unavailable reject', async () => {
      const local = createMockExecutor({
        id: 'local-runtime',
        canHandleResult: { ok: true, priority: 50 },
        executeThrows: new Error('boom'),
      });

      const router = buildRouter([local]);
      const result = await router.route(makeTask('douyin'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('runtime_unavailable');
      expect(result.technicalMessage).toContain('boom');
    });

    it('agent-s 抛异常 → 返回 agent_s_unavailable reject', async () => {
      const agentS = createMockExecutor({
        id: 'agent-s',
        canHandleResult: { ok: true, priority: 90 },
        executeThrows: new Error('sidecar down'),
      });

      const router = buildRouter([agentS]);
      const result = await router.route(makeTask('wechat-desktop'), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('agent_s_unavailable');
      expect(result.technicalMessage).toContain('sidecar down');
    });
  });

  describe('healthCheck 聚合所有 executor', () => {
    it('返回每个 executor 的健康状态', async () => {
      const local = createMockExecutor({
        id: 'local-runtime',
        canHandleResult: { ok: false, priority: 0 },
        healthOk: true,
      });
      const agentS = createMockExecutor({
        id: 'agent-s',
        canHandleResult: { ok: false, priority: 0 },
        healthOk: false,
      });

      const router = buildRouter([local, agentS]);
      const health = await router.healthCheck();

      expect(health).toHaveLength(2);
      expect(health.find((h) => h.id === 'local-runtime')?.ok).toBe(true);
      expect(health.find((h) => h.id === 'agent-s')?.ok).toBe(false);
    });
  });
});
