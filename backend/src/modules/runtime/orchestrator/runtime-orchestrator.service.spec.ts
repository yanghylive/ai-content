import { RuntimeOrchestrator } from './runtime-orchestrator.service';
import { ExecutorRouter } from '../executor-router';
import {
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
} from '../executor.interface';

function makeTask(overrides: Partial<ExecutorTask> = {}): ExecutorTask {
  return {
    relatedId: 'task-1',
    relatedType: 'interaction-task',
    type: 'wechat-reply-draft',
    platform: 'wechat-desktop',
    accountId: 1,
    payload: {},
    ...overrides,
  };
}

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

function makeResult(overrides: Partial<RuntimeExecutionResult> = {}): RuntimeExecutionResult {
  return {
    ok: true,
    status: 'success',
    reasonCode: 'success',
    userMessage: 'test',
    runtime: { mode: 'agent-s', executor: 'desktop-agent-s' },
    evidence: [],
    ...overrides,
  };
}

function makeRouterMock(overrides: {
  routeResult?: RuntimeExecutionResult;
  healthCheckResult?: Array<{ id: string; ok: boolean; details?: string }>;
} = {}) {
  return {
    route: jest.fn().mockResolvedValue(
      overrides.routeResult ?? makeResult(),
    ),
    healthCheck: jest.fn().mockResolvedValue(
      overrides.healthCheckResult ?? [
        { id: 'agent-s', ok: true, details: 'mocked' },
        { id: 'local-runtime', ok: false, details: 'mocked' },
      ],
    ),
  } as unknown as ExecutorRouter;
}

describe('RuntimeOrchestrator', () => {
  describe('execute', () => {
    it('委派给 ExecutorRouter.route() 并返结果', async () => {
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(router);

      const result = await orchestrator.execute(
        makeTask({ relatedId: 'orch-1' }),
        baseCtx,
      );

      expect(router.route).toHaveBeenCalledTimes(1);
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({ relatedId: 'orch-1' }),
        baseCtx,
      );
      expect(result.ok).toBe(true);
    });

    it('Router 返 reject result 时透传', async () => {
      const router = makeRouterMock({
        routeResult: makeResult({
          ok: false,
          status: 'failed',
          reasonCode: 'runtime_unavailable',
          userMessage: 'no executor',
        }),
      });
      const orchestrator = new RuntimeOrchestrator(router);

      const result = await orchestrator.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('runtime_unavailable');
    });
  });

  describe('healthCheck', () => {
    it('委派给 ExecutorRouter.healthCheck() 并返所有执行器状态', async () => {
      const router = makeRouterMock({
        healthCheckResult: [
          { id: 'agent-s', ok: true, details: 'ready' },
          { id: 'local-runtime', ok: true, details: 'engine up' },
        ],
      });
      const orchestrator = new RuntimeOrchestrator(router);

      const healths = await orchestrator.healthCheck();

      expect(router.healthCheck).toHaveBeenCalledTimes(1);
      expect(healths).toHaveLength(2);
      expect(healths[0].id).toBe('agent-s');
      expect(healths[1].id).toBe('local-runtime');
    });
  });

  describe('薄壳契约', () => {
    it('不持有额外状态：所有行为都来自 ExecutorRouter', async () => {
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(router);

      // 多次调用都只走 Router
      await orchestrator.execute(makeTask(), baseCtx);
      await orchestrator.execute(makeTask(), baseCtx);
      await orchestrator.healthCheck();

      expect(router.route).toHaveBeenCalledTimes(2);
      expect(router.healthCheck).toHaveBeenCalledTimes(1);
    });
  });
});
