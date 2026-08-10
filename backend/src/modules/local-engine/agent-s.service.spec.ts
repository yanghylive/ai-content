import { AgentSService } from '../agent-s/agent-s.service';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AgentSService approval compatibility', () => {
  function makeService(
    config: Record<string, string | undefined> = {},
    dependencies: {
      aiClient?: Record<string, unknown>;
      defaultModels?: Record<string, unknown>;
      prisma?: Record<string, unknown>;
      authRequestContext?: Record<string, unknown>;
    } = {},
  ) {
    return new AgentSService(
      { get: jest.fn((key: string) => config[key]) } as any,
      (dependencies.aiClient || {}) as any,
      (dependencies.defaultModels || {}) as any,
      dependencies.prisma as any,
      dependencies.authRequestContext as any,
    );
  }

  function createConversationPersistenceHarness() {
    const rows = new Map<string, Record<string, any>>();
    const memberships = new Map([
      ['user-a', 'tenant-a'],
      ['user-b', 'tenant-b'],
    ]);
    const prisma = {
      tenantMember: {
        findFirst: jest.fn(async ({ where }: any) => {
          const tenantId = memberships.get(where.userId);
          return tenantId ? { tenantId } : null;
        }),
      },
      agentSession: {
        findUnique: jest.fn(
          async ({ where }: any) => rows.get(where.id) || null,
        ),
        findMany: jest.fn(async ({ where, take }: any) =>
          [...rows.values()]
            .filter(
              (row) =>
                row.tenantId === where.tenantId &&
                row.userId === where.userId &&
                row.source === where.source,
            )
            .sort(
              (left, right) =>
                new Date(right.updatedAt).getTime() -
                new Date(left.updatedAt).getTime(),
            )
            .slice(0, take),
        ),
        create: jest.fn(async ({ data }: any) => {
          if (rows.has(data.id)) throw new Error('duplicate AgentSession id');
          const row = { ...data };
          rows.set(data.id, row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = rows.get(where.id);
          if (
            !row ||
            row.tenantId !== where.tenantId ||
            row.userId !== where.userId ||
            row.source !== where.source
          ) {
            return { count: 0 };
          }
          rows.set(where.id, { ...row, ...data });
          return { count: 1 };
        }),
      },
    };
    const authFor = (userId: string) => ({
      get: jest.fn(() => ({ user: { id: userId } })),
    });
    const session = (
      sessionId: string,
      metadata: Record<string, unknown> = {},
    ) => {
      const now = new Date().toISOString();
      return {
        session_id: sessionId,
        session_name: '新对话',
        task_type: 'agent.conversation',
        status: 'idle' as const,
        created_at: now,
        updated_at: now,
        completed_at: null,
        metadata: {
          source: 'agent-workbench',
          conversation_mode: true,
          ...metadata,
        },
        labels: ['agent-workbench'],
        run_count: 0,
        active_run_id: null,
        cancellation_requested: false,
        last_error: null,
        last_event_seq: 0,
        artifact_count: 0,
      };
    };
    return { rows, prisma, authFor, session };
  }

  function addRuntimeSession(
    service: AgentSService,
    id: string,
    taskType: string,
  ) {
    (service as any).runtimeSessions.set(id, {
      session_id: id,
      session_name: null,
      task_type: taskType,
      status: 'idle',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      metadata: {},
      labels: [],
      run_count: 0,
      active_run_id: null,
      cancellation_requested: false,
      last_error: null,
      last_event_seq: 0,
      artifact_count: 0,
    });
  }

  it('falls back from /approve to Python sidecar /approval', async () => {
    const service = makeService();
    const post = jest
      .fn()
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 404 },
      })
      .mockResolvedValueOnce({
        data: {
          session_id: 'session-1',
          status: 'completed',
          decision: 'approved',
        },
      });
    (service as any).client = { post };

    const result = await service.approveSession('session-1', {
      decision: 'approved',
      comment: 'ok',
    });

    expect(result).toEqual({
      session_id: 'session-1',
      status: 'completed',
      decision: 'approved',
    });
    expect(post).toHaveBeenNthCalledWith(1, '/sessions/session-1/approve', {
      decision: 'approved',
      comment: 'ok',
    });
    expect(post).toHaveBeenNthCalledWith(2, '/sessions/session-1/approval', {
      decision: 'approved',
      comment: 'ok',
    });
  });

  it('creates a local runtime session when Agent-S sidecar is unavailable', async () => {
    const service = makeService();
    const post = jest.fn().mockRejectedValue({
      isAxiosError: true,
      code: 'ECONNREFUSED',
    });
    (service as any).client = { post };

    const result = await service.createSession({
      session_name: 'RedFox local trial',
      task_type: 'redfox.skillhub.run',
      metadata: { skillCode: 'trending-hub' },
    });

    expect(result.session).toEqual(
      expect.objectContaining({
        session_name: 'RedFox local trial',
        task_type: 'redfox.skillhub.run',
        status: 'idle',
      }),
    );
    expect(
      (service as any).runtimeSessions.has(result.session.session_id),
    ).toBe(true);
  });

  it('returns an empty artifact collection when a model turn has no output', async () => {
    const harness = createConversationPersistenceHarness();
    const service = makeService(
      {},
      {
        prisma: harness.prisma,
        authRequestContext: harness.authFor('user-a'),
        defaultModels: {
          getDefaults: jest.fn().mockResolvedValue({
            articleCreation: '',
            topicSelection: '',
          }),
        },
      },
    );
    const get = jest.fn().mockRejectedValue({
      isAxiosError: true,
      response: { status: 500 },
    });
    (service as any).client = {
      post: jest.fn().mockResolvedValue({
        data: { session: harness.session('conversation-without-artifacts') },
      }),
      get,
    };

    await service.createSession({
      task_type: 'agent.conversation',
      metadata: { source: 'agent-workbench', conversation_mode: true },
      labels: ['agent-workbench'],
    });
    await expect(
      service.runTask('conversation-without-artifacts', {
        instruction: '整理当前信息',
        metadata: {
          conversation_mode: true,
          conversation_purpose: 'general',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.getArtifacts('conversation-without-artifacts'),
    ).resolves.toEqual({
      session_id: 'conversation-without-artifacts',
      artifacts: [],
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('maps a known executor artifact 404 to empty but preserves upstream 500 errors', async () => {
    const harness = createConversationPersistenceHarness();
    const service = makeService(
      {},
      {
        prisma: harness.prisma,
        authRequestContext: harness.authFor('user-a'),
      },
    );
    const notFound = { isAxiosError: true, response: { status: 404 } };
    const serviceFailure = { isAxiosError: true, response: { status: 500 } };
    const get = jest
      .fn()
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(serviceFailure);
    (service as any).client = {
      post: jest.fn().mockResolvedValue({
        data: { session: harness.session('executor-without-artifacts') },
      }),
      get,
    };

    await service.createSession({
      task_type: 'agent.conversation',
      metadata: { source: 'agent-workbench', conversation_mode: true },
      labels: ['agent-workbench'],
    });
    (service as any).conversationSessions.get(
      'executor-without-artifacts',
    ).last_run_kind = 'executor';

    await expect(
      service.getArtifacts('executor-without-artifacts'),
    ).resolves.toEqual({
      session_id: 'executor-without-artifacts',
      artifacts: [],
    });
    await expect(
      service.getArtifacts('executor-without-artifacts'),
    ).rejects.toBe(serviceFailure);
  });

  it('keeps multi-turn Agent workbench history on one Agent-S session', async () => {
    const service = makeService();
    const now = new Date().toISOString();
    const post = jest.fn().mockResolvedValue({
      data: {
        session: {
          session_id: 'conversation-session',
          session_name: '新对话',
          task_type: 'agent.conversation',
          status: 'idle',
          created_at: now,
          updated_at: now,
          completed_at: null,
          metadata: {
            source: 'agent-workbench',
            conversation_mode: true,
            conversation_model_id: 'model-record-1',
          },
          labels: ['agent-workbench'],
          run_count: 0,
          active_run_id: null,
          cancellation_requested: false,
          last_error: null,
          last_event_seq: 0,
          artifact_count: 0,
        },
      },
    });
    (service as any).client = { post };
    (service as any).aiClient = {
      generate: jest
        .fn()
        .mockResolvedValueOnce('第一轮结果')
        .mockResolvedValueOnce('第二轮结果')
        .mockResolvedValueOnce('重试结果'),
    };
    (service as any).defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        articleCreation: 'default-model',
        topicSelection: '',
      }),
    };

    await service.createSession({
      session_name: '新对话',
      task_type: 'agent.conversation',
      metadata: {
        source: 'agent-workbench',
        conversation_mode: true,
        conversation_model_id: 'model-record-1',
      },
      labels: ['agent-workbench'],
    });
    await service.runTask('conversation-session', {
      instruction: '先整理目标',
      metadata: {
        conversation_mode: true,
        conversation_purpose: 'general',
        conversation_model_id: 'model-record-1',
      },
    });
    await service.runTask('conversation-session', {
      instruction: '基于上一轮继续细化',
      metadata: {
        conversation_mode: true,
        conversation_purpose: 'general',
        conversation_model_id: 'model-record-1',
      },
    });
    await service.retryConversationSession('conversation-session');

    const detail = await service.getConversationSession('conversation-session');
    const listed = await service.listConversationSessions();
    expect(detail.session.run_count).toBe(3);
    expect(detail.session.session_name).toBe('先整理目标');
    expect(detail.messages.map((message) => message.content)).toEqual([
      '先整理目标',
      '第一轮结果',
      '基于上一轮继续细化',
      '第二轮结果',
      '基于上一轮继续细化',
      '重试结果',
    ]);
    expect(
      detail.events.filter(
        (event) => event.event_type === 'conversation_result',
      ),
    ).toHaveLength(3);
    expect(listed.sessions[0].session.session_id).toBe('conversation-session');
    expect((service as any).aiClient.generate).toHaveBeenNthCalledWith(
      2,
      'model-record-1',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: '先整理目标' }),
        expect.objectContaining({
          role: 'assistant',
          content: '第一轮结果',
        }),
        expect.objectContaining({
          role: 'user',
          content: '基于上一轮继续细化',
        }),
      ]),
      expect.any(Object),
    );
  });

  it('forces Agent workbench execution turns through approval policy', async () => {
    const service = makeService();
    const now = new Date().toISOString();
    const post = jest
      .fn()
      .mockResolvedValueOnce({
        data: {
          session: {
            session_id: 'execute-conversation',
            session_name: '发送内容',
            task_type: 'agent.conversation.execute',
            status: 'idle',
            created_at: now,
            updated_at: now,
            completed_at: null,
            metadata: {
              source: 'agent-workbench',
              conversation_mode: true,
            },
            labels: ['agent-workbench'],
            run_count: 0,
            active_run_id: null,
            cancellation_requested: false,
            last_error: null,
            last_event_seq: 0,
            artifact_count: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          accepted: true,
          session_id: 'execute-conversation',
          run_id: 'execute-run',
          status: 'waiting_approval',
        },
      });
    (service as any).client = { post };

    await service.createSession({
      session_name: '发送内容',
      task_type: 'agent.conversation.execute',
      metadata: {
        source: 'agent-workbench',
        conversation_mode: true,
      },
      labels: ['agent-workbench'],
    });
    const result = await service.runTask('execute-conversation', {
      instruction: '把这段内容发布出去',
      metadata: {
        conversation_mode: true,
        conversation_purpose: 'execute',
      },
      requires_approval: false,
      risk_level: 'low',
    });

    expect(result.status).toBe('waiting_approval');
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/sessions/execute-conversation/run',
      expect.objectContaining({
        requires_approval: true,
        risk_level: 'high',
        metadata: expect.objectContaining({
          agent_s_execution_policy: 'approval_execute',
          allow_desktop_action_execution: true,
          local_controller_permission_mode: 'custom',
        }),
      }),
    );
    expect(
      (await service.getConversationSession('execute-conversation')).session
        .status,
    ).toBe('waiting_approval');
  });

  it('uses the safe interaction upload path for image conversation turns', async () => {
    const previousLogRoot = process.env.KAYPAL_RUNTIME_LOG_ROOT;
    const logRoot = mkdtempSync(join(tmpdir(), 'agent-s-conversation-'));
    process.env.KAYPAL_RUNTIME_LOG_ROOT = logRoot;
    try {
      const assetDirectory = join(logRoot, 'interaction-assets');
      mkdirSync(assetDirectory, { recursive: true });
      const filepath = join(assetDirectory, 'brief.png');
      writeFileSync(filepath, Buffer.from('safe-image'));
      const service = makeService();
      const now = new Date().toISOString();
      (service as any).client = {
        post: jest.fn().mockResolvedValue({
          data: {
            session: {
              session_id: 'attachment-conversation',
              session_name: '附件分析',
              task_type: 'agent.conversation',
              status: 'idle',
              created_at: now,
              updated_at: now,
              completed_at: null,
              metadata: {
                source: 'agent-workbench',
                conversation_mode: true,
              },
              labels: ['agent-workbench'],
              run_count: 0,
              active_run_id: null,
              cancellation_requested: false,
              last_error: null,
              last_event_seq: 0,
              artifact_count: 0,
            },
          },
        }),
      };
      const generateWithImage = jest.fn().mockResolvedValue('图片分析结果');
      (service as any).aiClient = { generateWithImage };
      (service as any).defaultModels = {
        getDefaults: jest.fn().mockResolvedValue({
          articleCreation: 'vision-model',
          topicSelection: '',
        }),
      };

      await service.createSession({
        session_name: '附件分析',
        task_type: 'agent.conversation',
        metadata: {
          source: 'agent-workbench',
          conversation_mode: true,
        },
        labels: ['agent-workbench'],
      });
      await service.runTask('attachment-conversation', {
        instruction: '分析这张图',
        attachments: [
          {
            filename: 'brief.png',
            filepath,
            mimeType: 'image/png',
            sizeBytes: 10,
            uploadedAt: now,
          },
        ],
        metadata: {
          conversation_mode: true,
          conversation_purpose: 'research',
        },
      });

      expect(generateWithImage).toHaveBeenCalledWith(
        'vision-model',
        expect.objectContaining({
          imageBase64: Buffer.from('safe-image').toString('base64'),
        }),
        expect.objectContaining({ mimeType: 'image/png' }),
      );
      expect(
        (await service.getConversationSession('attachment-conversation'))
          .messages[0].attachments[0].filepath,
      ).toMatch(/interaction-assets\/brief\.png$/);
    } finally {
      if (previousLogRoot === undefined) {
        delete process.env.KAYPAL_RUNTIME_LOG_ROOT;
      } else {
        process.env.KAYPAL_RUNTIME_LOG_ROOT = previousLogRoot;
      }
      rmSync(logRoot, { recursive: true, force: true });
    }
  });

  it('isolates every conversation operation by tenant and hides legacy ownership', async () => {
    const harness = createConversationPersistenceHarness();
    const ownerService = makeService(
      {},
      {
        prisma: harness.prisma,
        authRequestContext: harness.authFor('user-a'),
      },
    );
    (ownerService as any).client = {
      post: jest.fn().mockResolvedValue({
        data: { session: harness.session('tenant-conversation') },
      }),
    };

    await ownerService.createSession({
      task_type: 'agent.conversation',
      metadata: { source: 'agent-workbench', conversation_mode: true },
      labels: ['agent-workbench'],
    });
    harness.rows.set('legacy-unowned-conversation', {
      id: 'legacy-unowned-conversation',
      tenantId: 'tenant-a',
      userId: 'user-a',
      source: 'agent-s-conversation',
      status: 'idle',
      updatedAt: new Date(),
      sessionJson: {
        kind: 'agent-s-conversation-state',
        version: 1,
        session: { session_id: 'legacy-unowned-conversation' },
      },
    });

    const ownerList = await ownerService.listConversationSessions();
    expect(ownerList.sessions.map((item) => item.session.session_id)).toEqual([
      'tenant-conversation',
    ]);
    expect(harness.rows.get('tenant-conversation')).toEqual(
      expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a' }),
    );
    expect(harness.rows.get('tenant-conversation')?.sessionJson).toEqual(
      expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a' }),
    );

    const otherTenantService = makeService(
      {},
      {
        prisma: harness.prisma,
        authRequestContext: harness.authFor('user-b'),
      },
    );
    const externalPost = jest.fn();
    const externalGet = jest.fn();
    (otherTenantService as any).client = {
      post: externalPost,
      get: externalGet,
    };

    await expect(
      otherTenantService.listConversationSessions(),
    ).resolves.toEqual({ sessions: [] });
    await expect(
      otherTenantService.getConversationSession('tenant-conversation'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherTenantService.runTask('tenant-conversation', {
        instruction: '尝试继续会话',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherTenantService.retryConversationSession('tenant-conversation'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherTenantService.cancelSession('tenant-conversation'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherTenantService.approveSession('tenant-conversation', {
        decision: 'approved',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherTenantService.getArtifacts('tenant-conversation'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherTenantService.getArtifact('tenant-conversation', 'artifact-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherTenantService.getEvents('tenant-conversation'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(externalPost).not.toHaveBeenCalled();
    expect(externalGet).not.toHaveBeenCalled();
  });

  it('restores tenant-scoped conversation history after a service restart', async () => {
    const artifactRoot = mkdtempSync(
      join(tmpdir(), 'agent-s-conversation-restart-'),
    );
    const harness = createConversationPersistenceHarness();
    const dependencies = {
      prisma: harness.prisma,
      authRequestContext: harness.authFor('user-a'),
      aiClient: { generate: jest.fn().mockResolvedValue('持久化后的模型结果') },
      defaultModels: {
        getDefaults: jest.fn().mockResolvedValue({
          articleCreation: 'configured-model',
          topicSelection: '',
        }),
      },
    };

    try {
      const firstService = makeService(
        { AI_CONTENT_LOCAL_ARTIFACT_ROOT: artifactRoot },
        dependencies,
      );
      (firstService as any).client = {
        post: jest.fn().mockResolvedValue({
          data: { session: harness.session('restart-conversation') },
        }),
      };
      await firstService.createSession({
        task_type: 'agent.conversation',
        metadata: { source: 'agent-workbench', conversation_mode: true },
        labels: ['agent-workbench'],
      });
      await firstService.runTask('restart-conversation', {
        instruction: '保留这段会话历史',
        metadata: {
          conversation_mode: true,
          conversation_purpose: 'general',
          conversation_model_id: 'configured-model',
        },
      });

      const restartedService = makeService(
        { AI_CONTENT_LOCAL_ARTIFACT_ROOT: artifactRoot },
        dependencies,
      );
      expect((restartedService as any).conversationSessions.size).toBe(0);

      const listed = await restartedService.listConversationSessions();
      const detail = await restartedService.getConversationSession(
        'restart-conversation',
      );
      expect(listed.sessions).toHaveLength(1);
      expect(listed.sessions[0].session.session_id).toBe(
        'restart-conversation',
      );
      expect(detail.messages.map((message) => message.content)).toEqual([
        '保留这段会话历史',
        '持久化后的模型结果',
      ]);
      expect(detail.last_run_input?.instruction).toBe('保留这段会话历史');
      expect(detail.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event_type: 'conversation_result' }),
        ]),
      );
      expect(
        (restartedService as any).localSkillArtifacts.get(
          'restart-conversation',
        ),
      ).toHaveLength(1);
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  });

  it('does not reject moments publish as a removed feature before local execution', async () => {
    const service = makeService();
    jest
      .spyOn(service as any, 'runWechatMomentsPublish')
      .mockResolvedValue({ screenshotPath: '/tmp/moments.png' });

    addRuntimeSession(service, 'moments-session', 'wechat-moments-publish');
    const result = await service.runTask('moments-session', {
      task_type: 'wechat-moments-publish',
      instruction: '朋友圈文案：测试发布',
      metadata: {
        replyText: '测试发布',
        assetPath: '/tmp/material.png',
        wechat_reply_mode: 'approval',
      },
    });

    expect(result.status).toBe('completed');
    expect((service as any).runWechatMomentsPublish).toHaveBeenCalledWith(
      '测试发布',
      'approval',
      '/tmp/material.png',
      '',
      'public',
    );
  });

  it('routes contact add and moments marketing to local commands', async () => {
    const service = makeService();
    jest
      .spyOn(service as any, 'runWechatContactAdd')
      .mockResolvedValue({ screenshotPath: '/tmp/contact-add.png' });
    jest
      .spyOn(service as any, 'runWechatMomentsMarketing')
      .mockResolvedValue({ screenshotPath: '/tmp/moments-marketing.png' });

    addRuntimeSession(service, 'contact-session', 'wechat-contact-add');
    const contactResult = await service.runTask('contact-session', {
      task_type: 'wechat-contact-add',
      instruction: '自动加好友',
      metadata: {
        wechat_contact_add_targets: ['客户A'],
        wechat_contact_add_verify_message: '你好，想了解一下需求。',
        wechat_reply_mode: 'approval',
      },
    });
    addRuntimeSession(service, 'marketing-session', 'wechat-moments-marketing');
    const marketingResult = await service.runTask('marketing-session', {
      task_type: 'wechat-moments-marketing',
      instruction: '朋友圈营销',
      metadata: {
        wechat_moments_marketing_mode: 'targeted',
        wechat_moments_marketing_contacts: ['客户B'],
        wechat_moments_marketing_actions: { like: true, comment: true },
        wechat_moments_marketing_comment_mode: 'fixed',
        wechat_moments_marketing_fixed_comment: '很有启发，想进一步了解。',
        wechat_reply_mode: 'approval',
      },
    });

    expect(contactResult.status).toBe('completed');
    expect(marketingResult.status).toBe('completed');
    expect((service as any).runWechatContactAdd).toHaveBeenCalledWith(
      '客户A',
      '你好，想了解一下需求。',
      'approval',
    );
    expect((service as any).runWechatMomentsMarketing).toHaveBeenCalledWith(
      '客户B',
      '很有启发，想进一步了解。',
      'approval',
      'like-comment',
      1,
    );
  });

  it('applies contact add daily limit and blacklist with summary events', async () => {
    const service = makeService();
    const runWechatContactAdd = jest
      .spyOn(service as any, 'runWechatContactAdd')
      .mockResolvedValue({ screenshotPath: '/tmp/contact-add.png' });

    addRuntimeSession(service, 'contact-limit-session', 'wechat-contact-add');
    const result = await service.runTask('contact-limit-session', {
      task_type: 'wechat-contact-add',
      instruction: '自动加好友',
      metadata: {
        wechat_contact_add_targets: ['客户A', '客户B', '客户C'],
        wechat_contact_add_verify_message: '你好，想了解一下需求。',
        wechat_reply_mode: 'auto-send',
        commercialExecutionRequested: true,
        wechat_contact_add_daily_limit: 1,
        wechat_contact_add_blacklist: ['客户B'],
      },
    });
    const events = await service.getEvents('contact-limit-session');
    const completedEvent = events.events.find(
      (event) => event.event_type === 'SkillCompleted',
    );

    expect(result.status).toBe('completed');
    expect(runWechatContactAdd).toHaveBeenCalledTimes(1);
    expect(runWechatContactAdd).toHaveBeenCalledWith(
      '客户A',
      '你好，想了解一下需求。',
      'auto-send',
    );
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'SkillBlacklistApplied',
          payload: expect.objectContaining({
            skippedByBlacklist: ['客户B'],
            summary: expect.objectContaining({
              requested: 3,
              skipped: 1,
              pending: 1,
              dailyLimit: 1,
            }),
          }),
        }),
        expect.objectContaining({
          event_type: 'SkillRateLimitApplied',
          payload: expect.objectContaining({
            selectedTargets: ['客户A'],
            pendingTargets: ['客户C'],
          }),
        }),
      ]),
    );
    expect(completedEvent?.payload).toEqual(
      expect.objectContaining({
        executedTargets: ['客户A'],
        skippedByBlacklist: ['客户B'],
        pendingTargets: ['客户C'],
        summary: expect.objectContaining({
          requested: 3,
          success: 1,
          failed: 0,
          skipped: 1,
          pending: 1,
        }),
      }),
    );
  });

  it('applies group broadcast daily limit and interval before auto sending', async () => {
    const service = makeService();
    const runWechatAutoReply = jest
      .spyOn(service as any, 'runWechatAutoReply')
      .mockResolvedValue({ screenshotPath: '/tmp/group.png' });
    const delay = jest
      .spyOn(service as any, 'delay')
      .mockResolvedValue(undefined);

    addRuntimeSession(service, 'group-session', 'wechat-group-broadcast');
    const result = await service.runTask('group-session', {
      task_type: 'wechat.group.broadcast',
      instruction: '微信群发\n群发内容：限量文案',
      metadata: {
        skill_id: 'wechat.group.broadcast',
        wechat_group_targets: ['客户A', '客户B', '客户C'],
        wechat_reply_draft: '限量文案',
        wechat_reply_mode: 'auto-send',
        commercialExecutionRequested: true,
        wechat_group_daily_limit: 2,
        wechat_group_interval_seconds: 15,
      },
    });

    expect(result.status).toBe('completed');
    expect(runWechatAutoReply).toHaveBeenCalledTimes(2);
    expect(runWechatAutoReply).toHaveBeenNthCalledWith(
      1,
      '客户A',
      '限量文案',
      'auto-send',
    );
    expect(runWechatAutoReply).toHaveBeenNthCalledWith(
      2,
      '客户B',
      '限量文案',
      'auto-send',
    );
    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(15000);
  });

  it('keeps each personalized group message bound to its target', async () => {
    const service = makeService();
    const runWechatAutoReply = jest
      .spyOn(service as any, 'runWechatAutoReply')
      .mockResolvedValue({ screenshotPath: '/tmp/group.png' });

    addRuntimeSession(
      service,
      'personalized-group-session',
      'wechat-group-broadcast',
    );
    const result = await service.runTask('personalized-group-session', {
      task_type: 'wechat.group.broadcast',
      instruction: '个性化微信群发',
      metadata: {
        skill_id: 'wechat.group.broadcast',
        wechat_group_targets: ['客户甲', '客户乙'],
        wechat_reply_draft: '默认消息',
        wechat_group_messages: [
          { target: '客户甲', message: '甲的专属消息' },
          { target: '客户乙', message: '乙的专属消息' },
        ],
        wechat_reply_mode: 'auto-send',
        commercialExecutionRequested: true,
      },
    });

    expect(result.status).toBe('completed');
    expect(runWechatAutoReply).toHaveBeenNthCalledWith(
      1,
      '客户甲',
      '甲的专属消息',
      'auto-send',
    );
    expect(runWechatAutoReply).toHaveBeenNthCalledWith(
      2,
      '客户乙',
      '乙的专属消息',
      'auto-send',
    );
  });

  it('blocks auto-send when the authenticated account lacks commercial permission', async () => {
    const service = makeService(
      {},
      {
        authRequestContext: {
          get: jest.fn(() => ({
            user: { id: 'trial-user', commercialExecutionAllowed: false },
          })),
        },
      },
    );
    const runWechatAutoReply = jest.spyOn(service as any, 'runWechatAutoReply');
    addRuntimeSession(
      service,
      'commercial-guard-session',
      'wechat-group-broadcast',
    );

    const result = await service.runTask('commercial-guard-session', {
      task_type: 'wechat.group.broadcast',
      instruction: '微信群发',
      metadata: {
        skill_id: 'wechat.group.broadcast',
        wechat_group_targets: ['客户甲'],
        wechat_reply_draft: '测试消息',
        wechat_reply_mode: 'auto-send',
        commercialExecutionRequested: true,
      },
    });

    expect(result.status).toBe('blocked');
    expect(runWechatAutoReply).not.toHaveBeenCalled();
  });

  it('builds native friend acceptance as an explicitly filtered command', () => {
    const service = makeService();
    const input = (service as any).buildWechatNativeSkillInput(
      'friend-accept',
      { instruction: '只处理测试申请' },
      {
        wechat_friend_accept_remark_strategy: 'manual',
        wechat_friend_accept_remark_content: 'Kaypal验收',
        wechat_friend_accept_welcome_message: '欢迎加入测试',
        wechat_friend_accept_match_keywords: ['KAYPAL_TEST_REQUEST'],
        wechat_friend_accept_daily_limit: 1,
      },
    );

    expect(input).toEqual({
      remark: { strategy: 'manual', value: 'Kaypal验收' },
      welcomeMessage: '欢迎加入测试',
      matchKeywords: ['KAYPAL_TEST_REQUEST'],
      dailyLimit: 1,
    });
  });

  it.each([
    {
      taskType: 'wechat-group-broadcast',
      skillId: 'wechat.group.broadcast',
      command: 'group-broadcast',
      metadata: {
        wechat_group_targets: ['客户甲'],
        wechat_reply_draft: '甲的专属消息',
        wechat_group_messages: [{ target: '客户甲', message: '甲的专属消息' }],
      },
      target: '客户甲',
      nativeStatus: 'sent',
    },
    {
      taskType: 'wechat-friend-accept',
      skillId: 'wechat.friend.accept',
      command: 'friend-accept',
      metadata: {
        wechat_friend_accept_match_keywords: ['KAYPAL_TEST_REQUEST'],
        wechat_friend_accept_daily_limit: 1,
      },
      target: '测试好友申请',
      nativeStatus: 'request_submitted',
    },
  ])(
    'routes $taskType through the Windows native runtime without a real send',
    async ({ taskType, skillId, command, metadata, target, nativeStatus }) => {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'win32',
      });
      try {
        const service = makeService();
        addRuntimeSession(service, `native-${command}`, taskType);
        jest
          .spyOn(service as any, 'resolveWechatNativeRuntimePath')
          .mockReturnValue(
            'C:\\Program Files\\Kaypal\\wechat-native-runtime.exe',
          );
        const runNative = jest
          .spyOn(service as any, 'runWindowsWechatNativeCommand')
          .mockResolvedValue({
            ok: true,
            status: 'success',
            output: {
              results: [
                {
                  targetName: target,
                  status: nativeStatus,
                  message: `${target} 模拟完成`,
                  readback: { matched: true, actualText: 'mock readback' },
                },
              ],
              summary: { succeeded: 1, failed: 0 },
            },
            diagnostics: { stage: 'mock-native-completed' },
          });

        const result = await service.runTask(`native-${command}`, {
          task_type: taskType,
          instruction: '仅执行注入的测试 native adapter，不触碰真实微信。',
          metadata: {
            skill_id: skillId,
            wechat_reply_mode: 'auto-send',
            commercialExecutionRequested: true,
            ...metadata,
          },
        });
        const events = await service.getEvents(`native-${command}`);

        expect(result.status).toBe('completed');
        expect(runNative).toHaveBeenCalledWith(
          `native-${command}`,
          command,
          expect.objectContaining({
            command,
            context: expect.objectContaining({
              safety: expect.objectContaining({ sendMode: 'auto-send' }),
            }),
          }),
          expect.any(String),
        );
        expect(events.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event_type: 'SkillCompleted',
              status: 'completed',
              payload: expect.objectContaining({
                results: [expect.objectContaining({ target, ok: true })],
              }),
            }),
          ]),
        );
      } finally {
        if (descriptor) {
          Object.defineProperty(process, 'platform', descriptor);
        }
      }
    },
  );

  it('blocks customer-service no-reply decisions before local WeChat work', async () => {
    const service = makeService();
    const runWechatAutoReply = jest.spyOn(service as any, 'runWechatAutoReply');

    addRuntimeSession(service, 'customer-no-reply', 'wechat-reply-draft');
    const result = await service.runTask('customer-no-reply', {
      task_type: 'wechat.session.auto_reply',
      instruction: '客服回复',
      metadata: {
        skill_id: 'wechat.session.auto_reply',
        wechat_contact_name: '客户甲',
        wechat_reply_draft: '这条内容不应发送',
        customerServiceNoReply: true,
        customerServiceDecision: {
          action: 'no-reply',
          reason: '命中不回复场景：退款',
        },
      },
    });
    const events = await service.getEvents('customer-no-reply');

    expect(result.status).toBe('blocked');
    expect(runWechatAutoReply).not.toHaveBeenCalled();
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'SkillBlocked',
          status: 'blocked',
          message: expect.stringContaining('不自动回复'),
        }),
      ]),
    );
  });

  it('blocks local WeChat execution when current account differs from planned account', async () => {
    const service = makeService();
    const runWechatAutoReply = jest
      .spyOn(service as any, 'runWechatAutoReply')
      .mockResolvedValue({ screenshotPath: '/tmp/group.png' });

    addRuntimeSession(
      service,
      'group-account-mismatch',
      'wechat-group-broadcast',
    );
    const result = await service.runTask('group-account-mismatch', {
      task_type: 'wechat.group.broadcast',
      instruction: '微信群发\n群发内容：保护文案',
      metadata: {
        skill_id: 'wechat.group.broadcast',
        wechat_group_targets: ['客户A'],
        wechat_reply_draft: '保护文案',
        wechat_reply_mode: 'auto-send',
        commercialExecutionRequested: true,
        associatedWeChat: 'seller-planned',
        currentWechatId: 'seller-current',
      },
    });
    const events = await service.getEvents('group-account-mismatch');

    expect(result.status).toBe('failed');
    expect(runWechatAutoReply).not.toHaveBeenCalled();
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'SkillFailed',
          message: expect.stringContaining('微信号保护阻断'),
        }),
      ]),
    );
  });

  it('warns but continues when planned account exists and current account is unreadable', async () => {
    const service = makeService();
    const runWechatAutoReply = jest
      .spyOn(service as any, 'runWechatAutoReply')
      .mockResolvedValue({ screenshotPath: '/tmp/group.png' });

    addRuntimeSession(
      service,
      'group-account-unreadable',
      'wechat-group-broadcast',
    );
    const result = await service.runTask('group-account-unreadable', {
      task_type: 'wechat.group.broadcast',
      instruction: '微信群发\n群发内容：保护文案',
      metadata: {
        skill_id: 'wechat.group.broadcast',
        wechat_group_targets: ['客户A'],
        wechat_reply_draft: '保护文案',
        wechat_reply_mode: 'auto-send',
        commercialExecutionRequested: true,
        associatedWeChat: 'seller-planned',
      },
    });
    const events = await service.getEvents('group-account-unreadable');

    expect(result.status).toBe('completed');
    expect(runWechatAutoReply).toHaveBeenCalledTimes(1);
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'WechatAccountWarning',
          message: expect.stringContaining('当前微信号不可读取'),
        }),
      ]),
    );
  });

  it('blocks RedFox local capability when the official skill script is not installed', async () => {
    const artifactRoot = mkdtempSync(
      join(tmpdir(), 'redfox-skillhub-blocked-'),
    );
    const service = makeService({
      AI_CONTENT_LOCAL_ARTIFACT_ROOT: artifactRoot,
      REDFOX_API_KEY: 'test-key',
    });

    try {
      addRuntimeSession(
        service,
        'redfox-blocked-session',
        'redfox.skillhub.run',
      );
      const result = await service.runTask('redfox-blocked-session', {
        task_type: 'redfox.skillhub.run',
        instruction: '试跑全网热搜',
        metadata: {
          provider: 'redfox-skillhub',
          skillCode: 'missing-trending-hub-test',
          skillName: '未安装热搜测试能力',
          skillNo: 'KJq7uXHY',
          requiresApiKey: true,
          input: { keyword: 'AI 创业' },
          outputObjects: ['IntelligenceItem'],
        },
      });
      const events = await service.getEvents('redfox-blocked-session');
      const artifacts = await service.getArtifacts('redfox-blocked-session');

      expect(result.status).toBe('blocked');
      expect(events.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: 'SkillBlocked',
            status: 'blocked',
            message: expect.stringContaining('本机能力暂未就绪'),
          }),
        ]),
      );
      expect(artifacts.artifacts[0]).toEqual(
        expect.objectContaining({
          kind: 'json',
          filename: 'missing-trending-hub-test-preflight.json',
        }),
      );
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  });

  it('auto-installs a trusted RedFox official SkillHub capability from a local mirror before running it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redfox-skillhub-install-'));
    const sourceRoot = join(root, 'official-source');
    const installRoot = join(root, 'installed-skills');
    const artifactRoot = join(root, 'artifacts');
    const skillCode = 'unit-test-redfox-skill';
    const sourceSkillDir = join(sourceRoot, skillCode);
    mkdirSync(join(sourceSkillDir, 'scripts'), { recursive: true });
    writeFileSync(join(sourceSkillDir, 'SKILL.md'), '# 全网热搜查询\n', 'utf8');
    writeFileSync(
      join(sourceSkillDir, 'scripts', 'run.js'),
      [
        "let input = '';",
        "process.stdin.on('data', (chunk) => input += String(chunk));",
        "process.stdin.on('end', () => {",
        "  const parsed = JSON.parse(input || '{}');",
        "  console.log(JSON.stringify({ items: [{ title: '自动安装热搜', score: 88 }], installedSkill: parsed.skill.skillCode }));",
        '});',
      ].join('\n'),
      'utf8',
    );
    const service = makeService({
      REDFOX_SKILLHUB_OFFICIAL_SOURCE_ROOT: sourceRoot,
      REDFOX_SKILLHUB_INSTALL_ROOT: installRoot,
      AI_CONTENT_LOCAL_ARTIFACT_ROOT: artifactRoot,
      REDFOX_API_KEY: 'test-key',
    });

    try {
      addRuntimeSession(
        service,
        'redfox-install-session',
        'redfox.skillhub.run',
      );
      const result = await service.runTask('redfox-install-session', {
        task_type: 'redfox.skillhub.run',
        instruction: '试跑全网热搜',
        metadata: {
          provider: 'redfox-skillhub',
          skillCode,
          skillName: '全网热搜查询',
          skillNo: 'KJq7uXHY',
          repoUrl: `https://github.com/redfox-data/redfox-community/tree/main/skills/${skillCode}`,
          requiresApiKey: true,
          input: { keyword: 'AI 创业' },
          outputObjects: ['IntelligenceItem'],
        },
      });
      const events = await service.getEvents('redfox-install-session');
      const artifacts = await service.getArtifacts('redfox-install-session');
      const resultArtifact = artifacts.artifacts.find((artifact) =>
        artifact.filename.endsWith('-result.json'),
      );
      const content = await service.getArtifact(
        'redfox-install-session',
        resultArtifact!.artifact_id,
      );
      const parsed = JSON.parse(String(content.content)) as any;
      const manifestPath = join(
        installRoot,
        skillCode,
        '.kaypal-redfox-skillhub-install.json',
      );
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

      expect(result.status).toBe('completed');
      expect(existsSync(join(installRoot, skillCode, 'SKILL.md'))).toBe(true);
      expect(events.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: 'SkillInstallCompleted',
            status: 'running',
            payload: expect.objectContaining({
              install: expect.objectContaining({
                ok: true,
                status: 'installed',
                targetDirectory: join(installRoot, skillCode),
              }),
            }),
          }),
          expect.objectContaining({
            event_type: 'SkillCompleted',
            status: 'completed',
          }),
        ]),
      );
      expect(parsed.output.items).toEqual([
        { title: '自动安装热搜', score: 88 },
      ]);
      expect(parsed.output.installedSkill).toBe(skillCode);
      expect(manifest).toEqual(
        expect.objectContaining({
          provider: 'redfox-skillhub',
          skillCode,
          skillNo: 'KJq7uXHY',
          repoUrl: `https://github.com/redfox-data/redfox-community/tree/main/skills/${skillCode}`,
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs an installed RedFox local capability script and exposes result artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redfox-skillhub-run-'));
    const skillDir = join(root, 'trending-hub');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# 全网热搜查询\n', 'utf8');
    writeFileSync(
      join(skillDir, 'scripts', 'run.js'),
      [
        "let input = '';",
        "process.stdin.on('data', (chunk) => input += String(chunk));",
        "process.stdin.on('end', () => {",
        "  const parsed = JSON.parse(input || '{}');",
        "  console.log(JSON.stringify({ items: [{ title: 'AI 创业热搜', score: 91 }], received: parsed.skill.skillCode, platform: parsed.input.platform, topLevelPlatform: parsed.platform }));",
        '});',
      ].join('\n'),
      'utf8',
    );
    const service = makeService({
      REDFOX_SKILLHUB_ROOT: root,
      AI_CONTENT_LOCAL_ARTIFACT_ROOT: root,
      REDFOX_API_KEY: 'test-key',
    });

    try {
      addRuntimeSession(service, 'redfox-run-session', 'redfox.skillhub.run');
      const result = await service.runTask('redfox-run-session', {
        task_type: 'redfox.skillhub.run',
        instruction: '试跑全网热搜',
        metadata: {
          provider: 'redfox-skillhub',
          skillCode: 'trending-hub',
          skillName: '全网热搜查询',
          skillNo: 'KJq7uXHY',
          requiresApiKey: true,
          input: { keyword: 'AI 创业' },
          outputObjects: ['IntelligenceItem'],
        },
      });
      const events = await service.getEvents('redfox-run-session');
      const artifacts = await service.getArtifacts('redfox-run-session');
      const resultArtifact = artifacts.artifacts.find((artifact) =>
        artifact.filename.endsWith('-result.json'),
      );
      const content = await service.getArtifact(
        'redfox-run-session',
        resultArtifact!.artifact_id,
      );
      const parsed = JSON.parse(String(content.content)) as any;

      expect(result.status).toBe('completed');
      expect(events.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: 'SkillCompleted',
            status: 'completed',
            message: expect.stringContaining('返回 1 条结果'),
          }),
        ]),
      );
      expect(resultArtifact).toEqual(
        expect.objectContaining({
          kind: 'json',
          filename: 'trending-hub-result.json',
        }),
      );
      expect(parsed.output.items).toEqual([
        { title: 'AI 创业热搜', score: 91 },
      ]);
      expect(parsed.output.received).toBe('trending-hub');
      expect(parsed.output.platform).toBe('all');
      expect(parsed.output.topLevelPlatform).toBe('all');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds CLI arguments for RedFox official SkillHub scripts', () => {
    const service = makeService();
    const buildArgs = (service as any).buildRedfoxSkillHubScriptArgs.bind(
      service,
    );
    const baseSpec = {
      provider: 'redfox-skillhub',
      skillCode: 'multi-wordcheck',
      skillName: '多平台违禁词检测',
      requiresApiKey: true,
      input: {
        keyword: '咖啡',
        content: '这是一段发布前检查文案',
        platform: 'douyin',
      },
      outputObjects: ['ComplianceCheck'],
    };

    expect(
      buildArgs(
        { label: 'scripts/fetch_xhs_trends.py' },
        { ...baseSpec, skillCode: 'xiaohongshu-title-score' },
        { apiKey: 'ak_test' },
      ),
    ).toEqual(['--keyword', '咖啡', '--output-format', 'json']);
    expect(
      buildArgs({ label: 'scripts/check_sensitive_words.py' }, baseSpec, {
        apiKey: 'ak_test',
      }),
    ).toEqual(['--content', '这是一段发布前检查文案', '--platform', '抖音']);
    expect(
      buildArgs(
        { label: 'scripts/videogen.py' },
        {
          ...baseSpec,
          skillCode: 'video-prompt-expert',
          input: { prompt: '咖啡新品视频', recordOnly: true },
        },
        { apiKey: 'ak_test' },
      ),
    ).toEqual(['咖啡新品视频', '--record-only']);
    expect(
      buildArgs(
        { label: 'scripts/pdf_text_extractor.py' },
        {
          ...baseSpec,
          skillCode: 'pdf-image-text-extractor',
          input: { filePath: '/tmp/sample.pdf' },
        },
        { apiKey: 'ak_test' },
      ),
    ).toEqual(['/tmp/sample.pdf']);
  });
});
