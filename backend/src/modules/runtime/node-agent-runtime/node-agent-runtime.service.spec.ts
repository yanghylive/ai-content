import { NodeAgentRuntimeService } from './node-agent-runtime.service';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));

describe('NodeAgentRuntimeService health semantics', () => {
  const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

  afterEach(() => {
    mockedSpawn.mockReset();
  });

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

  function mockDesktopCommand() {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    mockedSpawn.mockReturnValue(child as any);
    return child;
  }

  function mockProcessPlatform(value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value,
    });
    return () => {
      if (descriptor) {
        Object.defineProperty(process, 'platform', descriptor);
      }
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

  it('returns blocked status immediately for local WeChat tasks with missing required metadata', async () => {
    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );
    const created = service.createSession({
      task_type: 'wechat.contact.add',
      metadata: { skill_id: 'wechat.contact.add' },
    });

    const result = await service.runTask(created.session.session_id, {
      instruction: 'add wechat contacts',
      task_type: 'wechat.contact.add',
      metadata: { skill_id: 'wechat.contact.add' },
      requires_approval: true,
    });
    const events = service.getEvents(created.session.session_id);

    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('target_not_found');
    expect(
      events.events.some((event) => event.event_type === 'task_failed'),
    ).toBe(true);
    expect(events.events[events.events.length - 1]?.message).toContain(
      '缺少加好友对象或验证消息',
    );
    expect(content).toEqual(
      expect.objectContaining({
        status: 'blocked',
        reasonCode: 'target_not_found',
        result: expect.objectContaining({
          errorCode: 'target_missing',
          nextAction: expect.stringContaining('wechat_contact_add_targets'),
        }),
      }),
    );
  });

  it('blocks Windows desktop WeChat native commands before spawning loose scripts', async () => {
    const restorePlatform = mockProcessPlatform('win32');
    try {
      const interactionEngine = makeInteractionEngine(true);
      const interactionExecutor = makeInteractionExecutor(true);
      const service = new NodeAgentRuntimeService(
        interactionEngine as any,
        interactionExecutor as any,
      );
      const created = service.createSession({
        task_type: 'wechat-group-broadcast',
        metadata: { skill_id: 'wechat-group-broadcast' },
      });

      const result = await service.runTask(created.session.session_id, {
        instruction: 'broadcast to wechat groups',
        task_type: 'wechat-group-broadcast',
        metadata: {
          skill_id: 'wechat-group-broadcast',
          wechat_group_targets: ['KayPal (4)'],
          wechat_reply_draft: 'Windows blocked smoke.',
        },
      });
      const events = service.getEvents(created.session.session_id);
      const terminalEvent = events.events[events.events.length - 1];
      const artifact = service.getArtifacts(created.session.session_id)
        .artifacts[0];
      const content = JSON.parse(
        service.getArtifact(created.session.session_id, artifact.artifact_id)
          .content,
      );

      expect(result.status).toBe('blocked');
      expect(result.reasonCode).toBe('not_integrated');
      expect(mockedSpawn).not.toHaveBeenCalled();
      expect(terminalEvent).toEqual(
        expect.objectContaining({
          event_type: 'task_failed',
          status: 'blocked',
          payload: expect.objectContaining({
            reasonCode: 'not_integrated',
            nextAction: expect.stringContaining('人工'),
          }),
        }),
      );
      expect(content.result).toEqual(
        expect.objectContaining({
          status: 'blocked',
          errorCode: 'not_integrated',
          nextAction: expect.stringContaining('人工'),
        }),
      );
    } finally {
      restorePlatform();
    }
  });

  it('runs macOS chat history tasks through the packaged desktop command', async () => {
    const child = mockDesktopCommand();
    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );
    const created = service.createSession({
      task_type: 'chat-history',
      metadata: { skill_id: 'chat-history' },
    });

    const runPromise = service.runTask(created.session.session_id, {
      instruction: 'sync wechat chat history',
      task_type: 'chat-history',
      metadata: {
        skill_id: 'chat-history',
        wechat_chat_session_id: 'session-a',
      },
    });
    child.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        source: 'macos-wechat-rpa-ocr',
        message: '已同步当前可见微信会话 2 条消息。',
        sessions: [{ id: 'session-a', title: '客户A' }],
        messages: [
          { sessionId: 'session-a', content: '你好' },
          { sessionId: 'session-a', content: '请问价格' },
        ],
      }),
    );
    child.emit('close', 0);
    const result = await runPromise;
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );
    expect(result.status).toBe('completed');
    expect(interactionEngine.preflightCheck).not.toHaveBeenCalled();
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\/)wechat-chat-history$/),
      ['--session-id', 'session-a', '--limit', '100'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    expect(content.result).toEqual(
      expect.objectContaining({
        readText: '你好\n请问价格',
        commandOutput: expect.objectContaining({
          source: 'macos-wechat-rpa-ocr',
        }),
      }),
    );
  });

  it('fails local WeChat tasks when the desktop command returns ok false', async () => {
    const child = mockDesktopCommand();

    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );
    const created = service.createSession({
      task_type: 'wechat-contact-add',
      metadata: { skill_id: 'wechat-contact-add' },
    });

    const runPromise = service.runTask(created.session.session_id, {
      instruction: 'add wechat contacts',
      task_type: 'wechat-contact-add',
      metadata: {
        skill_id: 'wechat-contact-add',
        wechat_contact_add_targets: ['用户1196170837'],
        wechat_contact_add_verify_message: '你好',
      },
    });
    child.stdout.emit(
      'data',
      JSON.stringify({
        ok: false,
        status: 'failed',
        message: '未进入好友申请页面',
        screenshotPath: '/tmp/contact-add-failed.png',
      }),
    );
    child.emit('close', 0);

    const result = await runPromise;
    const events = service.getEvents(created.session.session_id);
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('target_not_found');
    expect(events.events[events.events.length - 1]).toEqual(
      expect.objectContaining({
        event_type: 'task_failed',
        message: expect.stringContaining('自动加好友没有可处理对象'),
      }),
    );
    expect(content.result).toEqual(
      expect.objectContaining({
        screenshotPath: '/tmp/contact-add-failed.png',
        results: [
          expect.objectContaining({
            target: '用户1196170837',
            ok: false,
            screenshotPath: '/tmp/contact-add-failed.png',
            result: expect.objectContaining({
              status: 'failed',
              message: '未进入好友申请页面',
            }),
          }),
        ],
      }),
    );
  });

  it('keeps the concrete moments marketing blocker on failed desktop commands', async () => {
    const child = mockDesktopCommand();

    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );
    const created = service.createSession({
      task_type: 'wechat-moments-marketing',
      metadata: { skill_id: 'wechat-moments-marketing' },
    });

    const runPromise = service.runTask(created.session.session_id, {
      instruction: 'moments marketing',
      task_type: 'wechat-moments-marketing',
      metadata: {
        skill_id: 'wechat-moments-marketing',
        wechat_reply_mode: 'auto-send',
        wechat_moments_marketing_mode: 'targeted',
        wechat_moments_marketing_contacts: ['朋友圈第 1 条'],
        wechat_moments_marketing_actions: { like: false, comment: true },
        wechat_moments_marketing_comment_mode: 'fixed',
        wechat_moments_marketing_fixed_comment: '测试评论',
        wechat_moments_marketing_daily_limit: 1,
      },
    });
    child.stdout.emit(
      'data',
      JSON.stringify({
        ok: false,
        status: 'send_failed',
        message: '朋友圈评论发送未通过真实可见回读校验，已阻断。',
        screenshotPath: '/tmp/moments-comment-blocked.png',
      }),
    );
    child.emit('close', 0);

    const result = await runPromise;
    const events = service.getEvents(created.session.session_id);
    const terminalEvent = events.events[events.events.length - 1];
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('failed');
    expect(terminalEvent).toEqual(
      expect.objectContaining({
        event_type: 'task_failed',
        message: expect.stringContaining('未通过真实可见回读校验'),
        payload: expect.objectContaining({
          blockers: [expect.stringContaining('未通过真实可见回读校验')],
        }),
      }),
    );
    expect(content.userMessage).toContain('未通过真实可见回读校验');
    expect(content.technicalMessage).toContain('未通过真实可见回读校验');
    expect(content.blockers).toEqual([
      expect.stringContaining('未通过真实可见回读校验'),
    ]);
  });

  it('keeps target readback and screenshot evidence for successful WeChat contact add tasks', async () => {
    const child = mockDesktopCommand();
    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );
    const created = service.createSession({
      task_type: 'wechat-contact-add',
      metadata: { skill_id: 'wechat-contact-add' },
    });

    const runPromise = service.runTask(created.session.session_id, {
      instruction: 'add wechat contacts',
      task_type: 'wechat-contact-add',
      metadata: {
        skill_id: 'wechat-contact-add',
        wechat_reply_mode: 'auto-send',
        wechat_contact_add_targets: ['用户1196170837'],
        wechat_contact_add_verify_message: '你好，我是 Kaypal 测试账号',
      },
    });
    child.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        mode: 'auto-send',
        target: '用户1196170837',
        screenshotPath: '/tmp/contact-add-success.png',
      }),
    );
    child.emit('close', 0);

    const result = await runPromise;
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('completed');
    expect(content.result).toEqual(
      expect.objectContaining({
        readbackText: expect.stringContaining(
          '自动加好友已自动执行：用户1196170837',
        ),
        replyVisible: true,
        screenshotPath: '/tmp/contact-add-success.png',
      }),
    );
    expect(content.result.results[0]).toEqual(
      expect.objectContaining({
        target: '用户1196170837',
        ok: true,
        screenshotPath: '/tmp/contact-add-success.png',
        result: expect.objectContaining({
          mode: 'auto-send',
          target: '用户1196170837',
        }),
      }),
    );
  });

  it('reads desktop WeChat session and generates AI reply before sending contact reply', async () => {
    const readChild = mockDesktopCommand();
    const sendChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    sendChild.stdout = new EventEmitter();
    sendChild.stderr = new EventEmitter();
    sendChild.kill = jest.fn();
    mockedSpawn
      .mockReturnValueOnce(readChild as any)
      .mockReturnValueOnce(sendChild as any);

    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const aiClient = {
      generate: jest
        .fn()
        .mockResolvedValue('可以的，我先帮您看下今天可预约时间。'),
    };
    const defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        articleCreation: 'model-article',
        topicSelection: '',
      }),
    };
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
      aiClient as any,
      defaultModels as any,
    );
    const created = service.createSession({
      task_type: 'wechat-reply-draft',
      metadata: { skill_id: 'wechat.session.auto_reply' },
    });

    const runPromise = service.runTask(created.session.session_id, {
      instruction: 'reply wechat customer',
      task_type: 'wechat-reply-draft',
      metadata: {
        skill_id: 'wechat.session.auto_reply',
        wechat_reply_mode: 'auto-send',
        wechat_contact_name: '客户A',
      },
    });
    readChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        mode: 'read-only',
        readText: '客户：今天还能预约吗？',
        screenshotPath: '/tmp/wechat-read.png',
      }),
    );
    readChild.emit('close', 0);
    await new Promise((resolve) => setImmediate(resolve));
    sendChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        mode: 'auto-send',
        contact: '客户A',
        screenshotPath: '/tmp/wechat-send.png',
      }),
    );
    sendChild.emit('close', 0);

    const result = await runPromise;
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('completed');
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/(?:^|\/)wechat-live-auto-reply$/),
      ['客户A', 'read-only'],
      expect.any(Object),
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/(?:^|\/)wechat-auto-reply$/),
      ['客户A', '可以的，我先帮您看下今天可预约时间。', 'auto-send'],
      expect.any(Object),
    );
    expect(content.result).toEqual(
      expect.objectContaining({
        sourceText: '客户：今天还能预约吗？',
        targetText: '客户：今天还能预约吗？',
        replyText: '可以的，我先帮您看下今天可预约时间。',
        replyGeneratedBy: 'ai',
        readbackText: '客户：今天还能预约吗？',
      }),
    );
    expect(aiClient.generate).toHaveBeenCalledTimes(1);
  });

  it('routes dashed wechat-reply-draft task_type to the desktop WeChat executor without skill_id', async () => {
    const readChild = mockDesktopCommand();
    const sendChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    sendChild.stdout = new EventEmitter();
    sendChild.stderr = new EventEmitter();
    sendChild.kill = jest.fn();
    mockedSpawn
      .mockReturnValueOnce(readChild as any)
      .mockReturnValueOnce(sendChild as any);

    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const aiClient = {
      generate: jest.fn().mockResolvedValue('好的，我马上安排测试回复。'),
    };
    const defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        articleCreation: 'model-article',
        topicSelection: '',
      }),
    };
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
      aiClient as any,
      defaultModels as any,
    );
    const created = service.createSession({
      task_type: 'wechat-reply-draft',
      metadata: {},
    });

    const runPromise = service.runTask(created.session.session_id, {
      instruction: 'reply wechat customer',
      task_type: 'wechat-reply-draft',
      metadata: {
        wechat_reply_mode: 'auto-send',
        wechat_contact_name: '客户B',
      },
    });
    readChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        mode: 'read-only',
        readText: '客户：可以测试吗？',
        screenshotPath: '/tmp/wechat-read-b.png',
      }),
    );
    readChild.emit('close', 0);
    await new Promise((resolve) => setImmediate(resolve));
    sendChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        mode: 'auto-send',
        contact: '客户B',
        screenshotPath: '/tmp/wechat-send-b.png',
      }),
    );
    sendChild.emit('close', 0);

    const result = await runPromise;
    const events = service.getEvents(created.session.session_id);

    expect(result.status).toBe('completed');
    expect(
      events.events.find((event) => event.event_type === 'task_started')
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        skill_id: 'wechat.session.auto_reply',
      }),
    );
    expect(interactionEngine.preflightCheck).not.toHaveBeenCalled();
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/(?:^|\/)wechat-live-auto-reply$/),
      ['客户B', 'read-only'],
      expect.any(Object),
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/(?:^|\/)wechat-auto-reply$/),
      ['客户B', '好的，我马上安排测试回复。', 'auto-send'],
      expect.any(Object),
    );
  });

  it('writes content and asset readback for successful WeChat moments publish tasks', async () => {
    const child = mockDesktopCommand();
    const interactionEngine = makeInteractionEngine(true);
    const interactionExecutor = makeInteractionExecutor(true);
    const service = new NodeAgentRuntimeService(
      interactionEngine as any,
      interactionExecutor as any,
    );
    const created = service.createSession({
      task_type: 'wechat-moments-publish',
      metadata: { skill_id: 'wechat-moments-publish' },
    });

    const runPromise = service.runTask(created.session.session_id, {
      instruction: 'publish wechat moments',
      task_type: 'wechat-moments-publish',
      metadata: {
        skill_id: 'wechat-moments-publish',
        wechat_reply_mode: 'auto-send',
        wechat_moments_content: 'Kaypal 商用验收朋友圈发布，请忽略。',
        wechat_moments_asset_path: '/tmp/moments-asset.png',
      },
    });
    child.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        mode: 'auto-send',
        assetPath: '/tmp/moments-asset.png',
        screenshotPath: '/tmp/moments-publish-success.png',
      }),
    );
    child.emit('close', 0);

    const result = await runPromise;
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('completed');
    expect(content.result).toEqual(
      expect.objectContaining({
        reply: 'Kaypal 商用验收朋友圈发布，请忽略。',
        readbackText: expect.stringContaining('微信朋友圈已自动发送'),
        replyVisible: true,
        screenshotPath: '/tmp/moments-publish-success.png',
      }),
    );
    expect(content.result.readbackText).toContain('/tmp/moments-asset.png');
    expect(content.result.readbackText).toContain(
      'Kaypal 商用验收朋友圈发布，请忽略。',
    );
  });

  it('sends the matching personalized message to each group target', async () => {
    const service = new NodeAgentRuntimeService(
      makeInteractionEngine(true) as any,
      makeInteractionExecutor(true) as any,
    );
    const runWechatCommand = jest
      .spyOn(service as any, 'runWechatCommand')
      .mockResolvedValue({ message: '模拟完成', screenshotPath: '/tmp/mock.png' });
    const created = service.createSession({
      task_type: 'wechat-group-broadcast',
      metadata: { skill_id: 'wechat-group-broadcast' },
    });

    const result = await service.runTask(created.session.session_id, {
      instruction: 'personalized group broadcast',
      task_type: 'wechat-group-broadcast',
      metadata: {
        skill_id: 'wechat-group-broadcast',
        wechat_reply_mode: 'auto-send',
        wechat_group_targets: ['客户甲', '客户乙'],
        wechat_reply_draft: '默认消息',
        wechat_group_messages: [
          { target: '客户甲', message: '甲的专属消息' },
          { target: '客户乙', message: '乙的专属消息' },
        ],
      },
    });

    expect(result.status).toBe('completed');
    expect(runWechatCommand).toHaveBeenNthCalledWith(
      1,
      'wechat-auto-reply',
      ['客户甲', '甲的专属消息', 'auto-send'],
      expect.any(String),
      90000,
    );
    expect(runWechatCommand).toHaveBeenNthCalledWith(
      2,
      'wechat-auto-reply',
      ['客户乙', '乙的专属消息', 'auto-send'],
      expect.any(String),
      90000,
    );
  });

  it('runs due Moments items independently and keeps future items pending', async () => {
    const service = new NodeAgentRuntimeService(
      makeInteractionEngine(true) as any,
      makeInteractionExecutor(true) as any,
    );
    const runWechatCommand = jest
      .spyOn(service as any, 'runWechatCommand')
      .mockResolvedValue({ message: '模拟完成', screenshotPath: '/tmp/mock.png' });
    const created = service.createSession({
      task_type: 'wechat-moments-publish',
      metadata: { skill_id: 'wechat-moments-publish' },
    });

    const result = await service.runTask(created.session.session_id, {
      instruction: 'publish multiple moments details',
      task_type: 'wechat-moments-publish',
      metadata: {
        skill_id: 'wechat-moments-publish',
        wechat_reply_mode: 'auto-send',
        wechat_moments_details: [
          {
            id: 'first',
            content: '第一条文案',
            attachments: ['/tmp/first.png'],
            additionalComment: '第一条评论',
            visibility: '公开',
            scheduledPublishTime: '2020-01-01T00:00:00.000Z',
          },
          {
            id: 'second',
            content: '第二条文案',
            attachments: ['/tmp/second.mp4'],
            additionalComment: '第二条评论',
            visibility: 'public',
            scheduledPublishTime: '2020-01-01T01:00:00.000Z',
          },
          {
            id: 'future',
            content: '以后发布的文案',
            attachments: ['/tmp/future.png'],
            additionalComment: '以后追加的评论',
            visibility: '公开',
            scheduledPublishTime: '2999-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('completed');
    expect(runWechatCommand).toHaveBeenNthCalledWith(
      1,
      'wechat-moments-publish',
      [
        '第一条文案',
        'auto-send',
        '/tmp/first.png',
        '第一条评论',
        'public',
      ],
      expect.any(String),
      150000,
    );
    expect(runWechatCommand).toHaveBeenNthCalledWith(
      2,
      'wechat-moments-publish',
      [
        '第二条文案',
        'auto-send',
        '/tmp/second.mp4',
        '第二条评论',
        'public',
      ],
      expect.any(String),
      150000,
    );
    expect(content.result).toEqual(
      expect.objectContaining({
        pendingTargets: expect.arrayContaining(['future']),
        details: expect.arrayContaining([
          expect.objectContaining({
            target: 'first',
            content: '第一条文案',
          }),
          expect.objectContaining({
            target: 'second',
            content: '第二条文案',
          }),
          expect.objectContaining({
            target: 'future',
            content: '以后发布的文案',
          }),
        ]),
      }),
    );
  });

  it('registers friend-accept plans without invoking a desktop command', async () => {
    const service = new NodeAgentRuntimeService(
      makeInteractionEngine(true) as any,
      makeInteractionExecutor(true) as any,
    );
    const runWechatCommand = jest.spyOn(service as any, 'runWechatCommand');
    const created = service.createSession({
      task_type: 'wechat-friend-accept',
      metadata: { skill_id: 'wechat.friend.accept' },
    });

    const result = await service.runTask(created.session.session_id, {
      instruction: 'review friend requests',
      task_type: 'wechat-friend-accept',
      metadata: {
        skill_id: 'wechat.friend.accept',
        wechat_friend_accept_match_keywords: ['咨询'],
      },
    });
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('not_integrated');
    expect(content.result).toEqual(
      expect.objectContaining({ registrationOnly: true }),
    );
    expect(runWechatCommand).not.toHaveBeenCalled();
  });

  it('does not invoke a desktop command when customer-service rules say no reply', async () => {
    const service = new NodeAgentRuntimeService(
      makeInteractionEngine(true) as any,
      makeInteractionExecutor(true) as any,
    );
    const runWechatCommand = jest.spyOn(service as any, 'runWechatCommand');
    const created = service.createSession({
      task_type: 'wechat-reply-draft',
      metadata: { skill_id: 'wechat.session.auto_reply' },
    });

    const result = await service.runTask(created.session.session_id, {
      instruction: 'reply to customer',
      task_type: 'wechat-reply-draft',
      metadata: {
        skill_id: 'wechat.session.auto_reply',
        wechat_contact_name: '客户甲',
        customerServiceNoReply: true,
        customerServiceDecision: {
          action: 'no-reply',
          reason: '命中不回复场景：退款',
        },
      },
    });
    const artifact = service.getArtifacts(created.session.session_id)
      .artifacts[0];
    const content = JSON.parse(
      service.getArtifact(created.session.session_id, artifact.artifact_id)
        .content,
    );

    expect(result.status).toBe('blocked');
    expect(content.userMessage).toContain('不自动回复');
    expect(runWechatCommand).not.toHaveBeenCalled();
  });
});
