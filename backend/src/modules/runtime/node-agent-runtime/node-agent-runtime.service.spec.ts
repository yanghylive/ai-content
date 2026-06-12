import { NodeAgentRuntimeService } from './node-agent-runtime.service';

describe('NodeAgentRuntimeService health semantics', () => {
  function makeInteractionEngine(online = true) {
    return {
      getHealth: jest.fn().mockResolvedValue({
        online,
        status: online ? 'ok' : 'down',
        service: 'ai-content-local-interaction',
        version: '0.1.0',
        engineUrl: 'internal://ai-content/local-interaction',
        checkedAt: '2026-06-10T00:00:00.000Z',
      }),
      preflightCheck: jest.fn().mockResolvedValue({
        ok: true,
        platform: 'douyin',
        accountId: 1,
        browserReady: true,
        profileReady: true,
        loginRequired: false,
        blockers: [],
        message: 'ready',
      }),
    };
  }

  function makeInteractionExecutor(online = true) {
    return {
      getStatus: jest.fn().mockResolvedValue({
        online,
        status: online ? 'ok' : 'mcp-down',
        service: 'platform-interaction-executor',
        message: online ? 'ready' : 'playwright-mcp sidecar not running',
      }),
      read: jest.fn(),
      dispatch: jest.fn(),
    };
  }

  it('reports packaged Node/CDP browser execution as ready only when the browser engine and interaction executor are online', async () => {
    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );

    const health = await service.health();
    const status = await service.getStatus();

    expect(health).toEqual(
      expect.objectContaining({
        ok: true,
        status: 'ready',
        service: 'node-agent-runtime',
        runner_mode: 'node-playwright',
      }),
    );
    expect(health.capabilities.browserControl).toBe(true);
    expect(status).toEqual(
      expect.objectContaining({
        phase: 'ready',
        connected: true,
        required: true,
      }),
    );
  });

  it('blocks Agent-S when the local browser engine is not injected', async () => {
    const service = new NodeAgentRuntimeService();

    const health = await service.health();
    const status = await service.getStatus();

    expect(health).toEqual(
      expect.objectContaining({
        ok: false,
        status: 'blocked',
        service: 'node-agent-runtime',
        runner_mode: 'node-playwright',
        nextAction: expect.stringContaining('RuntimeModule/LocalEngineModule'),
      }),
    );
    expect(health.capabilities.browserControl).toBe(false);
    expect(health.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('LocalInteractionEngineClient 未注入'),
      ]),
    );
    expect(status).toEqual(
      expect.objectContaining({
        phase: 'error',
        connected: false,
        required: true,
        nextAction: health.nextAction,
      }),
    );
  });

  it('blocks Agent-S when the interaction executor is not injected', async () => {
    const interactionEngine = makeInteractionEngine(true);
    const service = new NodeAgentRuntimeService(interactionEngine as any);

    const health = await service.health();

    expect(health).toEqual(
      expect.objectContaining({
        ok: false,
        status: 'blocked',
        service: 'node-agent-runtime',
        runner_mode: 'node-playwright',
      }),
    );
    expect(health.capabilities.browserControl).toBe(false);
    expect(health.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('PlatformInteractionExecutor 未注入'),
      ]),
    );
  });

  it('runs a real preflight task instead of completing a synthetic summary', async () => {
    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );
    const created = service.createSession({
      task_type: 'douyin-comment-reply',
      metadata: { platform: 'douyin', accountId: 1 },
    });

    const result = await service.runTask(created.session.session_id, {
      instruction: 'preflight douyin comments',
      task_type: 'douyin-comment-reply',
      action: 'preflight',
    });
    const artifacts = service.getArtifacts(created.session.session_id);

    expect(result.status).toBe('completed');
    expect(interactionEngine.preflightCheck).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: 1,
      taskType: 'comment-reply',
    });
    expect(artifacts.artifacts[0]).toEqual(
      expect.objectContaining({
        kind: 'json',
        metadata: expect.objectContaining({
          browserExecution: true,
          platform: 'douyin',
          accountId: 1,
        }),
      }),
    );
  });
});
