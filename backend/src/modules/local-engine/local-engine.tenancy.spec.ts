import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LocalEngineController } from './local-engine.controller';
import { LocalEngineService } from './local-engine.service';
import type {
  AgentConfirmation,
  AgentSession,
  InteractionReplyRuleConfig,
  InteractionTask,
} from './local-engine.types';

describe('LocalEngineService tenant isolation', () => {
  type AuthUser = {
    id: string;
    kaypalLocalOnly?: boolean;
    kaypalPlan?: string;
    kaypalPlanExpired?: boolean;
    commercialExecutionAllowed?: boolean;
  };

  const tenantByUser = new Map([
    ['user-a', 'tenant-a'],
    ['user-b', 'tenant-b'],
  ]);

  function createHarness() {
    const auth = {
      user: {
        id: 'user-a',
        kaypalPlan: 'STANDARD',
        commercialExecutionAllowed: true,
      } as AuthUser,
    };
    const replyRows: any[] = [];
    const sessionRows: any[] = [];
    const confirmationRows: any[] = [];
    const taskRows: any[] = [];

    const matchesScope = (row: any, where: Record<string, any> = {}) =>
      (!where.id || row.id === where.id) &&
      (!where.tenantId || row.tenantId === where.tenantId) &&
      (!where.userId || row.userId === where.userId) &&
      (!where.botKey || row.botKey === where.botKey) &&
      (!where.sessionId || row.sessionId === where.sessionId) &&
      (!where.revision || row.revision === where.revision);

    const prisma = {
      tenantMember: {
        findFirst: jest.fn(async ({ where }: any) => {
          const tenantId = tenantByUser.get(where.userId);
          return tenantId ? { tenantId } : null;
        }),
      },
      interactionReplyRule: {
        findMany: jest.fn(async ({ where }: any) =>
          replyRows.filter((row) => matchesScope(row, where)),
        ),
        findFirst: jest.fn(
          async ({ where }: any) =>
            replyRows.find((row) => matchesScope(row, where)) || null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            ...data,
            createdAt: data.createdAt || new Date('2026-07-10T10:00:00.000Z'),
            updatedAt: data.updatedAt || new Date('2026-07-10T10:00:00.000Z'),
          };
          replyRows.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = replyRows.find((item) => matchesScope(item, where));
          if (!row) return { count: 0 };
          Object.assign(row, data, {
            updatedAt: new Date('2026-07-10T10:05:00.000Z'),
          });
          return { count: 1 };
        }),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const compound = where.tenantId_userId_botKey;
          let row = replyRows.find((item) => matchesScope(item, compound));
          if (row) {
            Object.assign(row, update, {
              updatedAt: new Date('2026-07-10T10:05:00.000Z'),
            });
          } else {
            row = {
              ...create,
              createdAt: new Date('2026-07-10T10:00:00.000Z'),
              updatedAt: new Date('2026-07-10T10:00:00.000Z'),
            };
            replyRows.push(row);
          }
          return row;
        }),
      },
      agentSession: {
        findMany: jest.fn(async ({ where }: any) =>
          sessionRows.filter((row) => matchesScope(row, where)),
        ),
        findFirst: jest.fn(
          async ({ where }: any) =>
            sessionRows.find((row) => matchesScope(row, where)) || null,
        ),
        upsert: jest.fn(),
      },
      agentConfirmation: {
        findMany: jest.fn(async ({ where }: any) =>
          confirmationRows.filter((row) => matchesScope(row, where)),
        ),
        findFirst: jest.fn(
          async ({ where }: any) =>
            confirmationRows.find((row) => matchesScope(row, where)) || null,
        ),
        upsert: jest.fn(),
      },
      interactionTask: {
        findFirst: jest.fn(
          async ({ where }: any) =>
            taskRows.find((row) => matchesScope(row, where)) || null,
        ),
      },
    };

    const service = Object.create(LocalEngineService.prototype) as any;
    Object.assign(service, {
      authRequestContext: {
        get: () => ({ user: auth.user, sessionId: `session:${auth.user.id}` }),
      },
      prisma,
      configService: { get: jest.fn(() => undefined) },
      taskStoreReady: Promise.resolve(),
      replyRules: new Map<string, InteractionReplyRuleConfig>(),
      agentSessions: new Map<string, AgentSession>(),
      agentConfirmations: new Map<string, AgentConfirmation>(),
      tasks: new Map<string, InteractionTask>(),
      taskPersistQueues: new Map(),
      browserInteractionQueues: new Map(),
      runPrismaTransientRetry: jest.fn(
        async (_label: string, action: () => Promise<unknown>) => action(),
      ),
    });
    service.replyRule = service.createDefaultReplyRule();
    let nextId = 0;
    service.createId = jest.fn(() => `generated-${++nextId}`);

    const addReplyBot = (
      scope: { tenantId: string; userId: string },
      id: string,
      revision = 1,
    ) => {
      const config = {
        ...service.createDefaultReplyRule(),
        botName: `Bot ${id}`,
        revision,
      };
      const row = {
        id,
        ...scope,
        botKey: id,
        configVersion: 1,
        revision,
        name: config.botName,
        enabled: true,
        ruleJson: config,
        escalationRules: config,
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        updatedAt: new Date('2026-07-10T10:00:00.000Z'),
      };
      replyRows.push(row);
      return row;
    };

    return {
      service,
      auth,
      prisma,
      replyRows,
      sessionRows,
      confirmationRows,
      taskRows,
      addReplyBot,
    };
  }

  it('scopes bot lists and denies cross-tenant bot reads', async () => {
    const harness = createHarness();
    harness.addReplyBot({ tenantId: 'tenant-a', userId: 'user-a' }, 'bot-a');
    harness.addReplyBot({ tenantId: 'tenant-b', userId: 'user-b' }, 'bot-b');

    const bots = await harness.service.listReplyBots();
    expect(bots.map((bot: { id: string }) => bot.id)).toContain('bot-a');
    expect(bots.map((bot: { id: string }) => bot.id)).not.toContain('bot-b');
    expect(harness.prisma.interactionReplyRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-a', userId: 'user-a' },
      }),
    );

    harness.auth.user = { id: 'user-b' };
    await expect(harness.service.getReplyBot('bot-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('increments bot revisions and rejects stale updates', async () => {
    const harness = createHarness();
    harness.addReplyBot({ tenantId: 'tenant-a', userId: 'user-a' }, 'bot-a');

    const updated = await harness.service.updateReplyBot('bot-a', {
      botName: 'Updated bot',
      expectedRevision: 1,
    });

    expect(updated.revision).toBe(2);
    expect(updated.config.revision).toBe(2);
    expect(harness.prisma.interactionReplyRule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'bot-a',
          tenantId: 'tenant-a',
          userId: 'user-a',
          revision: 1,
        },
      }),
    );
    await expect(
      harness.service.updateReplyBot('bot-a', {
        tone: 'concise',
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not return another tenant session even when it is cached', async () => {
    const harness = createHarness();
    const sessionA = {
      id: 'agent-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
      title: 'Tenant A session',
      instruction: '整理资料',
      status: 'running',
      statusLabel: '执行中',
      executionScope: 'local-files',
      source: 'agent-console',
      createdAt: '2026-07-10T10:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
      riskLevel: 'low',
      confirmations: [],
      events: [],
    } satisfies AgentSession;
    harness.service.agentSessions.set(sessionA.id, sessionA);
    harness.sessionRows.push({
      ...sessionA,
      sessionJson: sessionA,
      createdAt: new Date(sessionA.createdAt),
      updatedAt: new Date(sessionA.updatedAt),
    });

    harness.auth.user = { id: 'user-b' };
    await expect(
      harness.service.getAgentSession(sessionA.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.prisma.agentSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: sessionA.id,
        tenantId: 'tenant-b',
        userId: 'user-b',
      },
    });
  });

  it('denies cross-tenant confirmation decisions from the in-memory cache', async () => {
    const harness = createHarness();
    const confirmation = {
      id: 'confirmation-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
      sessionId: 'agent-a',
      title: 'Confirm action',
      description: 'Confirm tenant A action',
      actionLabel: 'Continue',
      riskLevel: 'medium',
      status: 'pending',
      requiredChecks: [],
      createdAt: '2026-07-10T10:00:00.000Z',
    } satisfies AgentConfirmation;
    harness.service.agentConfirmations.set(confirmation.id, confirmation);

    harness.auth.user = { id: 'user-b' };
    await expect(
      harness.service.rejectAgentConfirmation(confirmation.id, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.prisma.agentConfirmation.upsert).not.toHaveBeenCalled();
  });

  it('denies cross-tenant task reads from the in-memory cache', async () => {
    const harness = createHarness();
    const task = {
      id: 'task-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
      type: 'customer-follow-up',
      typeLabel: 'Customer follow-up',
      status: 'queued',
      statusLabel: 'Queued',
      accountName: 'Internal account',
      targetName: 'Customer A',
      sourceText: 'Follow up',
      replyText: 'Internal note',
      sendMode: 'auto-send',
      executionMode: 'internal-record',
      createdAt: '2026-07-10T10:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
      events: [],
    } satisfies InteractionTask;
    harness.service.tasks.set(task.id, task);
    harness.taskRows.push({
      id: task.id,
      tenantId: task.tenantId,
      userId: task.userId,
      config: task,
    });

    harness.auth.user = { id: 'user-b' };
    await expect(harness.service.getTask(task.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(harness.prisma.interactionTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: task.id,
        tenantId: 'tenant-b',
        userId: 'user-b',
      },
    });
  });

  it('stamps request scope on Agent sessions and interaction tasks', async () => {
    const harness = createHarness();
    harness.service.persistAgentSession = jest.fn(async () => undefined);
    harness.service.persistTask = jest.fn(async () => undefined);
    harness.service.runInteractionTaskLifecycle = jest.fn();
    harness.service.loadReplyRuleFromStore = jest.fn(async () =>
      harness.service.createDefaultReplyRule(),
    );
    harness.service.buildExecutionContract = jest.fn(() => ({ ok: true }));

    const session = await harness.service.createAgentSession({
      instruction: '整理本地笔记',
    });
    const task = await harness.service.createTask({
      type: 'customer-follow-up',
      accountName: 'Internal account',
      targetName: 'Customer A',
      sourceText: 'Follow up next week',
      replyText: 'Noted for internal follow-up.',
      sendMode: 'auto-send',
      commercialExecutionRequested: true,
    });

    expect(session).toEqual(
      expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a' }),
    );
    expect(task).toEqual(
      expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a' }),
    );
    expect(harness.service.runInteractionTaskLifecycle).toHaveBeenCalledWith(
      task.id,
    );
  });

  it('uses desktop fallback only for an explicit local-only auth context', async () => {
    const harness = createHarness();
    harness.auth.user = { id: 'local-user', kaypalLocalOnly: true };
    await expect(harness.service.resolveTenantScope()).resolves.toEqual({
      tenantId: 'local-desktop:local-user',
      userId: 'local-user',
    });

    harness.auth.user = { id: 'unscoped-user' };
    await expect(harness.service.resolveTenantScope()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('LocalEngineController task type registration', () => {
  it('accepts friend-accept as a filter type without executing it', () => {
    const controller = new LocalEngineController({} as LocalEngineService);
    expect((controller as any).parseTaskType('wechat-friend-accept')).toBe(
      'wechat-friend-accept',
    );
  });
});
