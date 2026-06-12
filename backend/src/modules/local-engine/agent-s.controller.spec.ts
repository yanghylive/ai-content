import { AgentSController } from './agent-s.controller';
import { IS_PUBLIC_KEY } from '../auth/auth.decorator';

describe('AgentSController runtime switch', () => {
  function createController(flag: string | undefined) {
    const legacy = {
      health: jest.fn().mockResolvedValue({
        ok: true,
        service: 'agent-s-sidecar',
      }),
      createSession: jest.fn().mockResolvedValue({
        session: { session_id: 'legacy-session' },
      }),
      runTask: jest.fn().mockResolvedValue({
        accepted: true,
        session_id: 'legacy-session',
        run_id: 'legacy-run',
        status: 'completed',
      }),
    };
    const nodeRuntime = {
      health: jest.fn().mockResolvedValue({
        ok: true,
        status: 'ready',
        service: 'node-agent-runtime',
        runner_mode: 'node-playwright',
        capabilities: { browserControl: true },
        blockers: [],
        nextAction: '',
      }),
      createSession: jest.fn().mockReturnValue({
        session: { session_id: 'node-session' },
      }),
    };
    const config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'KAYPAL_NODE_AGENT_RUNTIME') return flag;
        return undefined;
      }),
    };

    return {
      controller: new AgentSController(
        legacy as any,
        nodeRuntime as any,
        config as any,
      ),
      legacy,
      nodeRuntime,
    };
  }

  it('uses Node Agent Runtime by default', async () => {
    const { controller, legacy, nodeRuntime } = createController(undefined);

    const health = await controller.health();
    const created = await controller.createSession({ task_type: 'smoke' });

    expect(health).toEqual(
      expect.objectContaining({
        ok: true,
        service: 'node-agent-runtime',
        runner_mode: 'node-playwright',
      }),
    );
    expect(created.session.session_id).toBe('node-session');
    expect(nodeRuntime.health).toHaveBeenCalledTimes(1);
    expect(nodeRuntime.createSession).toHaveBeenCalledTimes(1);
    expect(legacy.health).not.toHaveBeenCalled();
    expect(legacy.createSession).not.toHaveBeenCalled();
  });

  it('uses Node Agent Runtime when KAYPAL_NODE_AGENT_RUNTIME=1', async () => {
    const { controller, legacy, nodeRuntime } = createController('1');

    const health = await controller.health();
    const created = await controller.createSession({ task_type: 'smoke' });

    expect(health).toEqual(
      expect.objectContaining({
        ok: true,
        status: 'ready',
        service: 'node-agent-runtime',
        runner_mode: 'node-playwright',
      }),
    );
    expect(created.session.session_id).toBe('node-session');
    expect(nodeRuntime.health).toHaveBeenCalledTimes(1);
    expect(nodeRuntime.createSession).toHaveBeenCalledTimes(1);
    expect(legacy.health).not.toHaveBeenCalled();
    expect(legacy.createSession).not.toHaveBeenCalled();
  });

  it('uses legacy AgentSService only when KAYPAL_NODE_AGENT_RUNTIME=0', async () => {
    const { controller, legacy, nodeRuntime } = createController('0');

    const health = await controller.health();
    const created = await controller.createSession({ task_type: 'smoke' });

    expect(health).toEqual(expect.objectContaining({ service: 'agent-s-sidecar' }));
    expect(created.session.session_id).toBe('legacy-session');
    expect(legacy.health).toHaveBeenCalledTimes(1);
    expect(legacy.createSession).toHaveBeenCalledTimes(1);
    expect(nodeRuntime.health).not.toHaveBeenCalled();
    expect(nodeRuntime.createSession).not.toHaveBeenCalled();
  });

  it('keeps Node Agent Runtime calls on the Node path for empty instructions', async () => {
    const { controller, legacy, nodeRuntime } = createController('1');
    nodeRuntime.runTask = jest.fn().mockReturnValue({
      accepted: true,
      session_id: 'node-session',
      run_id: 'node-run',
      status: 'completed',
    });

    const result = await controller.runTask('node-session', {
      instruction: '',
      task_type: 'smoke',
    });

    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        session_id: 'node-session',
      }),
    );
    expect(nodeRuntime.runTask).toHaveBeenCalledWith('node-session', {
      instruction: '',
      task_type: 'smoke',
    });
    expect(legacy.runTask).not.toHaveBeenCalled();
  });

  it('keeps read-only health endpoints public for local package self-checks', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, AgentSController.prototype.getStatus),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, AgentSController.prototype.health),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, AgentSController.prototype.runTask),
    ).toBeUndefined();
  });
});
