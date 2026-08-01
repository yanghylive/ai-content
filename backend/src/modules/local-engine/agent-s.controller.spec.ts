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
      getEvents: jest.fn().mockResolvedValue({
        session_id: 'legacy-session',
        events: [],
      }),
      getArtifacts: jest.fn().mockResolvedValue({
        session_id: 'legacy-session',
        artifacts: [],
      }),
      listConversationSessions: jest.fn().mockReturnValue({ sessions: [] }),
      getConversationSession: jest.fn().mockReturnValue({
        session: { session_id: 'legacy-session' },
        messages: [],
        events: [],
      }),
      retryConversationSession: jest.fn().mockResolvedValue({
        accepted: true,
        session_id: 'legacy-session',
        run_id: 'retry-run',
        status: 'running',
      }),
      isConversationSession: jest.fn().mockResolvedValue(false),
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
      runTask: jest.fn().mockReturnValue({
        accepted: true,
        session_id: 'node-session',
        run_id: 'node-run',
        status: 'completed',
      }),
      getEvents: jest.fn().mockReturnValue({
        session_id: 'node-session',
        events: [],
      }),
      getArtifacts: jest.fn().mockReturnValue({
        session_id: 'node-session',
        artifacts: [],
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

    expect(health).toEqual(
      expect.objectContaining({ service: 'agent-s-sidecar' }),
    );
    expect(created.session.session_id).toBe('legacy-session');
    expect(legacy.health).toHaveBeenCalledTimes(1);
    expect(legacy.createSession).toHaveBeenCalledTimes(1);
    expect(nodeRuntime.health).not.toHaveBeenCalled();
    expect(nodeRuntime.createSession).not.toHaveBeenCalled();
  });

  it('keeps Node Agent Runtime calls on the Node path for empty instructions', async () => {
    const { controller, legacy, nodeRuntime } = createController('1');

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

  it('routes RedFox SkillHub sessions to AgentSService even when Node runtime is enabled', async () => {
    const { controller, legacy, nodeRuntime } = createController('1');
    legacy.createSession.mockResolvedValue({
      session: { session_id: 'legacy-redfox-session' },
    });
    legacy.runTask.mockResolvedValue({
      accepted: true,
      session_id: 'legacy-redfox-session',
      run_id: 'legacy-redfox-run',
      status: 'blocked',
    });

    const created = await controller.createSession({
      task_type: 'redfox.skillhub.run',
      metadata: {
        provider: 'redfox-skillhub',
        skillCode: 'trending-hub',
      },
    });
    const result = await controller.runTask('legacy-redfox-session', {
      instruction: '试跑全网热搜',
      task_type: 'redfox.skillhub.run',
      metadata: {
        provider: 'redfox-skillhub',
        skillCode: 'trending-hub',
      },
    });
    await controller.getEvents('legacy-redfox-session');
    await controller.getArtifacts('legacy-redfox-session');

    expect(created.session.session_id).toBe('legacy-redfox-session');
    expect(result.session_id).toBe('legacy-redfox-session');
    expect(legacy.createSession).toHaveBeenCalledTimes(1);
    expect(legacy.runTask).toHaveBeenCalledTimes(1);
    expect(legacy.getEvents).toHaveBeenCalledWith(
      'legacy-redfox-session',
      undefined,
    );
    expect(legacy.getArtifacts).toHaveBeenCalledWith('legacy-redfox-session');
    expect(nodeRuntime.createSession).not.toHaveBeenCalled();
    expect(nodeRuntime.runTask).not.toHaveBeenCalled();
    expect(nodeRuntime.getEvents).not.toHaveBeenCalled();
    expect(nodeRuntime.getArtifacts).not.toHaveBeenCalled();
  });

  it('keeps Agent workbench conversations on AgentSService contracts', async () => {
    const { controller, legacy, nodeRuntime } = createController('1');
    legacy.createSession.mockResolvedValue({
      session: { session_id: 'agent-conversation-session' },
    });
    legacy.runTask.mockResolvedValue({
      accepted: true,
      session_id: 'agent-conversation-session',
      run_id: 'agent-conversation-run',
      status: 'waiting_approval',
    });
    legacy.getConversationSession.mockReturnValue({
      session: { session_id: 'agent-conversation-session' },
      messages: [],
      events: [],
    });

    const created = await controller.createSession({
      task_type: 'agent.conversation',
      metadata: {
        source: 'agent-workbench',
        conversation_mode: true,
      },
      labels: ['agent-workbench'],
    });
    const run = await controller.runTask('agent-conversation-session', {
      instruction: '发布这段内容',
      task_type: 'agent.conversation.execute',
      metadata: {
        source: 'agent-workbench',
        conversation_mode: true,
        conversation_purpose: 'execute',
      },
    });
    const detail = await controller.getConversationSession(
      'agent-conversation-session',
    );
    await controller.retryConversationSession('agent-conversation-session');

    expect(created.session.session_id).toBe('agent-conversation-session');
    expect(run.status).toBe('waiting_approval');
    expect(detail.session.session_id).toBe('agent-conversation-session');
    expect(legacy.createSession).toHaveBeenCalledTimes(1);
    expect(legacy.runTask).toHaveBeenCalledTimes(1);
    expect(legacy.getEvents).toHaveBeenCalledWith('agent-conversation-session');
    expect(legacy.retryConversationSession).toHaveBeenCalledWith(
      'agent-conversation-session',
    );
    expect(nodeRuntime.createSession).not.toHaveBeenCalled();
    expect(nodeRuntime.runTask).not.toHaveBeenCalled();
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
