import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalEngineService } from './local-engine.service';
import { buildBatchSummary } from './local-engine.utils';
import { assertWechatDesktopResultProof } from './local-engine.wechat-command.utils';
import type {
  InteractionBatchTarget,
  InteractionTask,
  InteractionTaskType,
} from './local-engine.types';

describe('LocalEngineService business task type routing', () => {
  const service = Object.create(LocalEngineService.prototype) as any;
  const legacyTestScope = {
    tenantId: 'local-engine-test-tenant',
    userId: 'local-engine-test-user',
  };

  beforeEach(() => {
    jest
      .spyOn(LocalEngineService.prototype as any, 'resolveTenantScope')
      .mockResolvedValue(legacyTestScope);
    jest
      .spyOn(LocalEngineService.prototype as any, 'isInTenantScope')
      .mockImplementation((record: any, scope: typeof legacyTestScope) => {
        if (!record?.tenantId && !record?.userId) return true;
        return (
          record.tenantId === scope.tenantId && record.userId === scope.userId
        );
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps video face swap setup out of the core interaction blockers', () => {
    const capability = LocalEngineService.prototype[
      'mapRuntimeHealthToExecutorCapability'
    ].call(service, {
      id: 'video-face-swap',
      ok: false,
      details: '本机生成环境未就绪，请先完成生成引擎安装。',
    });

    expect(capability).toEqual(
      expect.objectContaining({
        key: 'video-face-swap',
        status: 'optional',
        platformName: '视频工坊',
      }),
    );
    expect(capability.message).toContain('只影响视频换脸页面');
  });

  it('labels skipped evidence and file probes as on-demand checks', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.playwrightMcp = undefined;
    scopedService.useNodeAgentRuntime = jest.fn(() => true);
    scopedService.nodeAgentRuntime = {};
    scopedService.wechatSessionConfirmation = {};
    scopedService.runtimeOrchestrator = {};

    const capabilities = await scopedService['getFastCapabilities'](
      '2026-06-15T00:00:00.000Z',
      { kaypalUserId: 'user-1' },
    );
    const evidence = capabilities.find(
      (capability) => capability.key === 'evidence-replay',
    );
    const files = capabilities.find(
      (capability) => capability.key === 'file-access',
    );

    expect(evidence).toEqual(
      expect.objectContaining({ status: 'optional', required: false }),
    );
    expect(evidence?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '步骤回放', status: 'optional' }),
      ]),
    );
    expect(files).toEqual(
      expect.objectContaining({ status: 'optional', required: false }),
    );
    expect(files?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '目录读写检查', status: 'optional' }),
      ]),
    );
  });

  function makeApprovalService() {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.tasks = new Map<string, InteractionTask>();
    scopedService.wechatSessionConfirmation = {};
    scopedService.ensureTaskStore = jest.fn(async () => undefined);
    scopedService.loadStoredTask = jest.fn(async () => null);
    scopedService.persistTask = jest.fn(async () => undefined);
    scopedService.createId = jest
      .fn()
      .mockImplementation(
        () => `event-${scopedService.createId.mock.calls.length + 1}`,
      );
    scopedService.getDesktopCommercialPreflight = jest
      .fn()
      .mockResolvedValue({ allowed: true, blockers: [], warnings: [] });
    scopedService.captureDesktopScreenshot = jest.fn(async () => ({
      type: 'desktop_screenshot',
      label: '微信草稿填入前截图',
      value: '/tmp/preflight.png',
      artifactUrl: '/tmp/preflight.png',
      capturedAt: new Date().toISOString(),
    }));
    scopedService.rememberDesktopEvidence = jest.fn();
    scopedService.runWechatContactCommand = jest.fn(
      async (
        _command: string,
        target: string,
        message: string,
        mode: string,
      ) => ({
        screenshotPath: '/tmp/sent.png',
        target,
        reply: message,
        mode,
      }),
    );
    scopedService.runWechatDesktopCommand = jest.fn(
      async (command: string, args: string[], target: string) => {
        const reply =
          command === 'wechat-moments-publish'
            ? args[0]
            : command === 'wechat-moments-marketing'
              ? args[1]
              : command === 'wechat-live-auto-reply'
                ? ''
                : args[1] || args[0];
        const mode = args.includes('auto-send')
          ? 'auto-send'
          : args.includes('approval')
            ? 'approval'
            : args[2] || 'auto-send';
        return {
          screenshotPath: '/tmp/sent.png',
          target,
          contact: target,
          reply,
          readText:
            command === 'wechat-live-auto-reply'
              ? '客户问价'
              : `${target} ${reply}`.trim(),
          sourceText: '客户问价',
          message: '微信桌面任务已执行并截图留证。',
          mode,
          status: mode === 'auto-send' ? 'sent' : 'drafted',
        };
      },
    );
    scopedService.autoUploadService = {
      sendWechatReply: jest.fn(
        async ({
          targetText,
          replyText,
        }: {
          targetText?: string;
          replyText: string;
        }) => ({
          status: 'sent',
          sent: true,
          message: '微信回复已由系统自动发出，并确认输入框已清空。',
          targetText,
          replyText,
          evidence: {
            type: 'screenshot',
            label: '微信发送截图',
            value: '/tmp/sent.png',
            path: '/tmp/sent.png',
          },
          readbackText: replyText,
          draftedAt: '2026-06-15T00:00:01.000Z',
          sentAt: '2026-06-15T00:00:02.000Z',
        }),
      ),
    };
    scopedService.optionalTrimmedText =
      LocalEngineService.prototype['optionalTrimmedText'];
    scopedService.normalizeStringList =
      LocalEngineService.prototype['normalizeStringList'];
    scopedService.pickConfiguredFallbackReply =
      LocalEngineService.prototype['pickConfiguredFallbackReply'];
    scopedService.extractReplySubject =
      LocalEngineService.prototype['extractReplySubject'];
    scopedService.resolveSafeReplyClosing =
      LocalEngineService.prototype['resolveSafeReplyClosing'];
    scopedService.replyRule =
      LocalEngineService.prototype['createDefaultReplyRule'].call(
        scopedService,
      );
    scopedService.buildReplyFromRule =
      LocalEngineService.prototype['buildReplyFromRule'];
    scopedService.tryGenerateInteractionReplyWithAi = jest.fn(
      async () => 'AI生成回复：您好，可以发资料。',
    );
    scopedService.buildWechatDesktopReadback =
      LocalEngineService.prototype['buildWechatDesktopReadback'];
    // assertWechatDesktopResultProof 是 wechat-command.utils 的独立导出函数（不在 prototype 上）
    scopedService.assertWechatDesktopResultProof =
      assertWechatDesktopResultProof;
    scopedService.sleep = jest.fn(async () => undefined);
    scopedService.delay = jest.fn(async () => undefined);
    return scopedService;
  }

  function buildBatchTargets(names: string[], replyText: string) {
    return names.map<InteractionBatchTarget>((targetName, index) => ({
      id: `bt-${index + 1}`,
      targetName,
      sourceText: `来源：${targetName}`,
      replyText,
      status: 'queued',
      updatedAt: '2026-06-15T00:00:00.000Z',
    }));
  }

  function buildWaitingTask(
    patch: Partial<InteractionTask> & {
      type: InteractionTaskType;
      replyText: string;
    },
  ): InteractionTask {
    const now = '2026-06-15T00:00:00.000Z';
    return {
      id: 'task-1',
      type: patch.type,
      typeLabel: patch.type,
      status: 'waiting_for_send_confirmation',
      statusLabel: '等待继续执行',
      accountName: '桌面微信',
      platformName: '微信',
      targetName: patch.targetName || '客户A',
      sourceText: patch.sourceText || '客户问价',
      replyText: patch.replyText,
      sendMode: 'approval-send',
      requestedSendMode: 'approval-send',
      riskLevel: 'medium',
      executionMode: 'internal-record',
      runtimeState: 'live_ready',
      associatedWeChat: patch.associatedWeChat,
      currentWechatId: patch.currentWechatId,
      plannedWechatId: patch.plannedWechatId,
      metadata: patch.metadata,
      batchTargets: patch.batchTargets,
      batchSummary: patch.batchTargets
        ? buildBatchSummary(patch.batchTargets)
        : undefined,
      steps: [],
      events: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  const buildRiskConfirmation = (
    riskLevel: 'low' | 'medium' | 'high' = 'medium',
  ) => ({
    confirmed: true,
    confirmedAction: 'interaction-approval' as const,
    confirmedRiskLevel: riskLevel,
    operator: '测试用户',
    reason: '测试环境已确认目标、内容、窗口、联系人和商用风险。',
  });

  const desktopApprovalInput = {
    currentWindowConfirmed: true,
    contactConfirmed: true,
    draftBeforeFillConfirmed: true,
    targetConfirmed: true,
    contentConfirmed: true,
    checklistConfirmed: true,
    commercialPermissionConfirmed: true,
    misfireProtectionConfirmed: true,
    riskConfirmation: buildRiskConfirmation(),
  };

  it('routes generic comment tasks to wechat channel when platform type is video channel', () => {
    expect(
      service.resolveBusinessTaskType('comments', {
        platformType: 2,
        platformName: '视频号',
      }),
    ).toBe('wechat-channel-comment-reply');
  });

  it('routes generic message tasks to wechat channel when platform name is video channel', () => {
    expect(
      service.resolveBusinessTaskType('messages', {
        platformName: '视频号',
      }),
    ).toBe('wechat-channel-direct-message-reply');
  });

  it('keeps generic comment and message tasks on douyin by default', () => {
    expect(service.resolveBusinessTaskType('comments', {})).toBe(
      'douyin-comment-reply',
    );
    expect(service.resolveBusinessTaskType('messages', {})).toBe(
      'douyin-direct-message-reply',
    );
  });

  it('routes AI employee WeChat modules to local interaction task contracts', () => {
    expect(service.resolveBusinessTaskType('wechat', {})).toBe(
      'wechat-reply-draft',
    );
    expect(service.resolveBusinessTaskType('groups', {})).toBe(
      'wechat-group-broadcast',
    );
    expect(service.resolveBusinessTaskType('moments', {})).toBe(
      'wechat-moments-publish',
    );
    expect(service.resolveBusinessTaskType('customers', {})).toBe(
      'customer-follow-up',
    );
    expect(
      service.resolveBusinessTaskType('customers', {
        type: 'wechat-contact-add',
      }),
    ).toBe('wechat-contact-add');
    expect(
      service.resolveBusinessTaskType('customers', {
        type: 'wechat-friend-accept',
      }),
    ).toBe('wechat-friend-accept');
  });

  it('preflights video channel account when engine account id overlaps with Douyin', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.autoUploadService = {
      listAccounts: jest.fn(async () => [
        {
          id: 4,
          type: 3,
          platform: '抖音',
          status: 0,
          profileName: '抖音失效账号 4',
        },
        {
          id: 4,
          type: 2,
          platform: '视频号',
          status: 1,
          profileName: '视频号已登录账号 4',
        },
      ]),
    };
    scopedService.loadExecutorsStatus = jest.fn(async () => ({
      executors: [
        {
          key: 'wechat-channel-comment-reply',
          name: '视频号评论回复',
          platformName: '视频号',
          status: 'ready',
          entryPreflight: true,
          targetRead: true,
          replyGenerate: true,
          controlledSend: true,
          autoSend: true,
          message: 'ready',
          nextAction: '',
        },
      ],
    }));

    const result = await scopedService.assertCreateExecutionPreflight({
      type: 'wechat-channel-comment-reply',
      accountId: 4,
      accountName: '4',
      sendMode: 'auto-send',
    });

    expect(result).toEqual(
      expect.objectContaining({
        accountName: '视频号已登录账号 4',
        platformType: 2,
        platformName: '视频号',
      }),
    );
  });

  it('reports commercial file-selection roots for materials cookies and logs', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.configService = { get: jest.fn(() => undefined) };
    const tempRoot = await mkdtemp(join(tmpdir(), 'local-engine-files-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const status = await scopedService.getFileAccessStatus();
      const rootKeys = status.roots.map((root) => root.key);

      expect(rootKeys).toEqual(
        expect.arrayContaining([
          'auto-upload-materials',
          'auto-upload-cookies',
          'auto-upload-logs',
        ]),
      );
      expect(
        status.roots.filter((root) =>
          [
            'auto-upload-materials',
            'auto-upload-cookies',
            'auto-upload-logs',
          ].includes(root.key),
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'auto-upload-materials',
            exists: true,
            readable: true,
          }),
          expect.objectContaining({
            key: 'auto-upload-cookies',
            exists: true,
            readable: true,
          }),
          expect.objectContaining({
            key: 'auto-upload-logs',
            exists: true,
            readable: true,
          }),
        ]),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('blocks evidence cleanup and WeChat takeover without backend risk confirmation', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;

    await expect(scopedService.cleanupEvidence(0)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('后端风控要求人工确认'),
      }),
    });
    await expect(
      scopedService.takeoverWechatSession({ operator: '测试用户' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('后端风控要求人工确认'),
      }),
    });
  });

  it('creates business tasks through the resolved local task type', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.createTask = jest.fn(async (input) => input);

    await scopedService.createBusinessTask('groups', {
      accountName: '桌面微信',
      replyText: '群发内容',
    });
    await scopedService.createBusinessTask('moments', {
      accountName: '桌面微信',
      replyText: '朋友圈内容',
    });
    await scopedService.createBusinessTask('customers', {
      type: 'wechat-contact-add',
      accountName: '桌面微信',
      replyText: '好友验证语',
    });
    await scopedService.createBusinessTask('moments', {
      type: 'wechat-moments-marketing',
      accountName: '桌面微信',
      replyText: '朋友圈评论',
    });

    expect(scopedService.createTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'wechat-group-broadcast' }),
    );
    expect(scopedService.createTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'wechat-moments-publish' }),
    );
    expect(scopedService.createTask).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ type: 'wechat-contact-add' }),
    );
    expect(scopedService.createTask).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ type: 'wechat-moments-marketing' }),
    );
  });

  it('lists every task type owned by customer and moments business routes', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const tasks: InteractionTask[] = [
      buildWaitingTask({
        type: 'customer-follow-up',
        targetName: '电话跟进',
        replyText: '稍后电话沟通。',
      }),
      {
        ...buildWaitingTask({
          type: 'wechat-contact-add',
          targetName: '新好友',
          replyText: '您好，方便通过一下吗？',
        }),
        id: 'task-2',
      },
      {
        ...buildWaitingTask({
          type: 'wechat-moments-publish',
          targetName: '朋友圈发布',
          replyText: '今天新品上线。',
        }),
        id: 'task-3',
      },
      {
        ...buildWaitingTask({
          type: 'wechat-moments-marketing',
          targetName: '朋友圈运营',
          replyText: '这条内容很有参考价值。',
        }),
        id: 'task-4',
      },
    ];
    scopedService.tasks = new Map(tasks.map((task) => [task.id, task]));
    scopedService.ensureTaskStore = jest.fn(async () => undefined);
    scopedService.listStoredTaskSummaries = jest.fn(async () => []);

    const customerTasks = await scopedService.listBusinessTasks(
      'customers',
      10,
    );
    const momentsTasks = await scopedService.listBusinessTasks('moments', 10);

    expect(customerTasks.map((task) => task.type).sort()).toEqual([
      'customer-follow-up',
      'wechat-contact-add',
    ]);
    expect(momentsTasks.map((task) => task.type).sort()).toEqual([
      'wechat-moments-marketing',
      'wechat-moments-publish',
    ]);
  });

  it('lists task summaries with persisted config but without heavy evidence columns', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const findMany = jest.fn(async () => []);
    scopedService.tasks = new Map<string, InteractionTask>();
    scopedService.ensureTaskStore = jest.fn(async () => undefined);
    scopedService.prisma = {
      interactionTask: {
        findMany,
      },
    };
    scopedService.taskTypeToPrisma = {
      'douyin-comment-reply': 'DOUYIN_COMMENT_REPLY',
    };
    scopedService.taskStatusToPrisma = {
      failed: 'FAILED',
    };

    await scopedService.listTasks(25, {
      type: 'douyin-comment-reply',
      status: 'failed',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ...legacyTestScope,
          taskType: 'DOUYIN_COMMENT_REPLY',
          status: 'FAILED',
        },
        take: 25,
        select: expect.objectContaining({
          id: true,
          taskType: true,
          batchTargets: true,
          batchSummary: true,
          config: true,
        }),
      }),
    );
    const select = findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('events');
    expect(select).not.toHaveProperty('evidence');
  });

  it('keeps evidence count on stored task summaries from persisted config', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.tasks = new Map<string, InteractionTask>();
    scopedService.ensureTaskStore = jest.fn(async () => undefined);
    scopedService.taskTypeToPrisma = {
      'wechat-group-broadcast': 'WECHAT_GROUP_BROADCAST',
    };
    scopedService.taskTypeFromPrisma = {
      WECHAT_GROUP_BROADCAST: 'wechat-group-broadcast',
    };
    scopedService.taskStatusFromPrisma = {
      BLOCKED: 'blocked',
    };
    scopedService.prisma = {
      interactionTask: {
        findMany: jest.fn(async () => [
          {
            id: 'stored-task-1',
            taskType: 'WECHAT_GROUP_BROADCAST',
            accountId: null,
            sendMode: 'auto-send',
            status: 'BLOCKED',
            riskLevel: 'high',
            stage: '账号入口',
            currentTarget: '测试群',
            draftText: '测试群发内容',
            processedCount: 0,
            failedCount: 1,
            skippedCount: 0,
            batchTargets: [
              {
                id: 'bt-1',
                targetName: '测试群',
                sourceText: '群发对象',
                replyText: '测试群发内容',
                status: 'failed',
                evidenceEventIds: ['event-1', 'event-2'],
              },
            ],
            batchSummary: {
              total: 1,
              queued: 0,
              running: 0,
              waitingConfirmation: 0,
              completed: 0,
              failed: 1,
              skipped: 0,
              noTarget: 0,
            },
            config: {
              diagnostics: { evidenceCount: 3 },
              resultSummary: {
                kind: 'failure',
                headline: '失败 1/1',
                detail: '能力未就绪',
                nextAction: '修复后重试',
                evidenceCount: 3,
                recordsHref: '/interaction/records?taskId=stored-task-1',
                evidenceHref: '/local-engine?tab=evidence&taskId=stored-task-1',
                diagnosticsHref:
                  '/local-engine?tab=evidence&taskId=stored-task-1&diagnostics=1',
                counts: {
                  total: 1,
                  completed: 0,
                  failed: 1,
                  skipped: 0,
                  noTarget: 0,
                },
              },
              events: [
                {
                  id: 'event-1',
                  taskId: 'stored-task-1',
                  level: 'warning',
                  message: '缺能力',
                  evidence: {
                    type: 'failure_reason',
                    label: '原因',
                    value: '缺能力',
                  },
                  createdAt: '2026-06-17T00:00:00.000Z',
                },
                {
                  id: 'event-2',
                  taskId: 'stored-task-1',
                  level: 'info',
                  message: '阶段',
                  evidence: { type: 'stage_log', label: '阶段', value: '检查' },
                  createdAt: '2026-06-17T00:00:00.000Z',
                },
                {
                  id: 'event-3',
                  taskId: 'stored-task-1',
                  level: 'info',
                  message: '边界',
                  evidence: {
                    type: 'text',
                    label: '边界',
                    value: '自动发送保护',
                  },
                  createdAt: '2026-06-17T00:00:00.000Z',
                },
              ],
            },
            createdBy: null,
            localTaskId: null,
            requiresDoubleConfirmation: false,
            createdAt: new Date('2026-06-17T00:00:00.000Z'),
            updatedAt: new Date('2026-06-17T00:00:00.000Z'),
          },
        ]),
      },
    };

    const [task] = await scopedService.listBusinessTasks('groups', 10);

    expect(task.id).toBe('stored-task-1');
    expect(task.diagnostics.evidenceCount).toBe(3);
    expect(task.resultSummary.evidenceCount).toBe(3);
  });

  it('keeps AI employee flow metadata on business tasks', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.createTask = jest.fn(async (input) => input);

    await scopedService.createBusinessTask('comments', {
      accountName: '抖音账号',
      sourceText: '想了解加盟多少钱',
      replyText: '可以私信发资料。',
      metadata: {
        aiEmployee: 'kaypal-ai-employee',
        module: 'douyin-follow-up',
        flowId: 'p1-flow-1',
      },
    });

    expect(scopedService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-comment-reply',
        metadata: expect.objectContaining({
          aiEmployee: 'kaypal-ai-employee',
          module: 'douyin-follow-up',
          flowId: 'p1-flow-1',
        }),
      }),
    );
  });

  it('keeps AI employee flow metadata and source context on retried tasks', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getTask = jest.fn(async () => ({
      id: 'task-1',
      type: 'douyin-comment-reply',
      status: 'failed',
      accountId: 'douyin-1',
      accountName: '抖音账号',
      platformType: 99,
      platformName: '抖音',
      targetName: '客户A',
      sourceText: '想了解加盟多少钱',
      replyText: '可以私信发资料。',
      sourceUrl: 'https://www.douyin.com/video/1',
      profileUrl: 'https://www.douyin.com/user/1',
      commentTime: '今天',
      videoTitle: '加盟视频',
      videoUrl: 'https://www.douyin.com/video/1',
      engagementScore: 88,
      sendMode: 'approval-send',
      safetyBoundary: {
        planMode: 'commercial',
        trialLimited: false,
        commercialExecutionAllowed: true,
        permissionStatus: 'allowed',
        requestedCommercialExecution: true,
        message: '正式商用可执行权限已开启。',
        allowedActions: ['draft', 'preflight', 'live-send'],
        blockedActions: [],
      },
      metadata: {
        aiEmployee: 'kaypal-ai-employee',
        module: 'douyin-follow-up',
        flowId: 'p1-flow-1',
      },
      batchTargets: [
        {
          id: 'target-customer-a',
          targetName: '客户A',
          sourceText: '想了解加盟多少钱',
          replyText: '可以私信发资料。',
          sourceUrl: 'https://www.douyin.com/video/1',
          profileUrl: 'https://www.douyin.com/user/1',
          commentTime: '今天',
          videoTitle: '加盟视频',
          videoUrl: 'https://www.douyin.com/video/1',
          engagementScore: 88,
          status: 'failed',
        },
      ],
    }));
    scopedService.createTask = jest.fn(async (input) => ({
      id: 'task-2',
      ...input,
    }));
    scopedService.pushEvent = jest.fn();
    scopedService.persistTask = jest.fn();

    await scopedService.retryTask('task-1');

    expect(scopedService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-comment-reply',
        sourceUrl: 'https://www.douyin.com/video/1',
        profileUrl: 'https://www.douyin.com/user/1',
        commentTime: '今天',
        videoTitle: '加盟视频',
        videoUrl: 'https://www.douyin.com/video/1',
        engagementScore: 88,
        commercialExecutionRequested: true,
        callerCommercialAllowed: true,
        metadata: expect.objectContaining({
          aiEmployee: 'kaypal-ai-employee',
          module: 'douyin-follow-up',
          flowId: 'p1-flow-1',
          retryOfTaskId: 'task-1',
        }),
        batchTargets: [
          expect.objectContaining({
            sourceUrl: 'https://www.douyin.com/video/1',
            profileUrl: 'https://www.douyin.com/user/1',
            commentTime: '今天',
            videoTitle: '加盟视频',
            videoUrl: 'https://www.douyin.com/video/1',
            engagementScore: 88,
          }),
        ],
      }),
    );
  });

  it('retries only failed or queued batch targets by default', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getTask = jest.fn(async () => ({
      id: 'wechat-task-1',
      type: 'wechat-contact-add',
      status: 'failed',
      accountName: '本机微信',
      targetName: '客户A、客户B、客户C',
      sourceText: '添加好友',
      replyText: '你好',
      sendMode: 'auto-send',
      metadata: {},
      batchTargets: [
        {
          id: 'target-failed',
          targetName: '客户A',
          sourceText: '添加好友',
          replyText: '你好',
          status: 'failed',
        },
        {
          id: 'target-queued',
          targetName: '客户B',
          sourceText: '添加好友',
          replyText: '你好',
          status: 'queued',
        },
        {
          id: 'target-completed',
          targetName: '客户C',
          sourceText: '添加好友',
          replyText: '你好',
          status: 'completed',
        },
      ],
    }));
    scopedService.createTask = jest.fn(async (input) => ({
      id: 'wechat-task-retry',
      ...input,
    }));
    scopedService.pushEvent = jest.fn();
    scopedService.persistTask = jest.fn();

    await scopedService.retryTask('wechat-task-1');

    expect(scopedService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        batchTargets: [
          expect.objectContaining({ targetName: '客户A' }),
          expect.objectContaining({ targetName: '客户B' }),
        ],
      }),
    );
  });

  it('marks failed tasks as skipped when the operator skips them', async () => {
    const scopedService = makeApprovalService();
    const task = {
      ...buildWaitingTask({
        type: 'wechat-group-broadcast',
        targetName: '客户A',
        replyText: '群发文案',
        batchTargets: buildBatchTargets(['客户A'], '群发文案'),
      }),
      status: 'failed' as const,
      statusLabel: '失败',
      failureReason: '缺少微信群发对象或群发内容。',
    };
    task.batchTargets![0].status = 'failed';
    task.batchTargets![0].failureReason = '缺少微信群发对象或群发内容。';
    task.batchSummary = buildBatchSummary(task.batchTargets);
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.skipTask(task.id);

    expect(result.status).toBe('skipped');
    expect(result.statusLabel).toBe('已跳过');
    expect(result.nextAction).toContain('任务已跳过');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({ targetName: '客户A', status: 'skipped' }),
    ]);
  });

  it('marks an in-flight target uncertain on pause and keeps only untouched targets resumable', async () => {
    const scopedService = makeApprovalService();
    scopedService.markPausableBatchTargets =
      LocalEngineService.prototype['markPausableBatchTargets'];
    scopedService.setTaskStep = LocalEngineService.prototype['setTaskStep'];
    scopedService.updateTask = LocalEngineService.prototype['updateTask'];
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.buildBatchSummary = buildBatchSummary;
    scopedService.createId = jest
      .fn()
      .mockImplementation(
        () => `event-${scopedService.createId.mock.calls.length + 1}`,
      );

    const task = {
      ...buildWaitingTask({
        type: 'wechat-group-broadcast',
        targetName: '客户A、客户B',
        replyText: '群发文案',
        batchTargets: buildBatchTargets(['客户A', '客户B'], '群发文案'),
      }),
      status: 'running' as const,
      statusLabel: '执行中',
    };
    task.batchTargets![0].status = 'completed';
    task.batchTargets![1].status = 'running';
    task.batchSummary = buildBatchSummary(task.batchTargets);
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.pauseTask(task.id);

    expect(result.status).toBe('paused');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({ targetName: '客户A', status: 'completed' }),
      expect.objectContaining({
        targetName: '客户B',
        status: 'failed',
        failureReason: expect.stringContaining('禁止自动重发'),
      }),
    ]);
    expect(result.batchSummary).toEqual(
      expect.objectContaining({ completed: 1, failed: 1, skipped: 0 }),
    );
  });

  it('blocks direct resume for live executor tasks until approval is renewed', async () => {
    const scopedService = makeApprovalService();
    scopedService.setTaskStep = LocalEngineService.prototype['setTaskStep'];
    scopedService.updateTask = LocalEngineService.prototype['updateTask'];
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.createId = jest
      .fn()
      .mockImplementation(
        () => `event-${scopedService.createId.mock.calls.length + 1}`,
      );
    scopedService.runInteractionTaskLifecycle = jest.fn();

    const task = {
      ...buildWaitingTask({
        type: 'wechat-group-broadcast',
        targetName: '客户A',
        replyText: '群发文案',
        batchTargets: buildBatchTargets(['客户A'], '群发文案'),
      }),
      status: 'paused' as const,
      statusLabel: '已暂停',
      pausedFromStatus: 'running' as const,
      pausedAt: '2026-06-15T00:01:00.000Z',
    };
    scopedService.tasks.set(task.id, task);

    await expect(scopedService.resumeTask(task.id)).rejects.toThrow(
      '请先获取服务端一次性确认',
    );
    expect(scopedService.runInteractionTaskLifecycle).not.toHaveBeenCalled();
  });

  it('treats group broadcast, contact add, moments publish, and moments marketing as live executor tasks', () => {
    expect(service.isLiveExecutorTask('wechat-group-broadcast')).toBe(true);
    expect(service.isLiveExecutorTask('wechat-contact-add')).toBe(true);
    expect(service.isLiveExecutorTask('wechat-moments-publish')).toBe(true);
    expect(service.isLiveExecutorTask('wechat-moments-marketing')).toBe(true);
  });

  it('does not block desktop WeChat preflight only because the browser is currently frontmost', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {
      targetContact: 'KayPal (4)',
      contactConfirmed: true,
    };
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.desktopEvidence = [];

    const status = scopedService.buildDesktopStatus(
      {
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: 'KayPal (4)',
        windowTitles: ['KayPal (4)'],
        frontmost: false,
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        message: '已检测到桌面微信和本机微信执行脚本。',
      },
      '2026-06-15T00:00:00.000Z',
      {
        type: 'screenshot',
        label: '桌面微信窗口状态截图',
        value: '/tmp/wechat.png',
        capturedAt: '2026-06-15T00:00:00.000Z',
      },
    );

    expect(status.blockers).not.toContain('桌面微信不是前台 App。');
    expect(
      status.permissionChecks.find((check) => check.key === 'foreground-app'),
    ).toEqual(expect.objectContaining({ status: 'ready' }));
    expect(status.window.currentWindowLikelyWechatChat).toBe(true);
    expect(status.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('执行脚本会在操作前切回微信'),
      ]),
    );
  });

  it('declares ready controlled-send and auto-send capabilities for desktop WeChat task types', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const desktopStatus = {
      available: true,
      running: true,
      blockers: [],
      permissionChecks: [
        'accessibility',
        'screen-recording',
        'automation',
        'clipboard',
        'screenshot',
        'input-control',
        'click-control',
        'file-selection',
      ].map((key) => ({
        key,
        label: key,
        status: 'ready',
        message: 'ready',
      })),
      window: {
        currentWindowLikelyWechatChat: true,
      },
      message: '已检测到桌面微信和本机微信执行脚本。',
      nextAction: '请确认当前微信窗口、联系人和草稿内容后再填入草稿。',
    };

    const capabilities =
      scopedService.buildWechatDesktopExecutorCapabilities(desktopStatus);
    const expectedTypes = [
      'wechat-reply-draft',
      'wechat-friend-accept',
      'wechat-group-broadcast',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ];

    expect(capabilities.map((capability) => capability.key)).toEqual(
      expectedTypes,
    );
    for (const taskType of expectedTypes) {
      expect(
        capabilities.find((capability) => capability.key === taskType),
      ).toEqual(
        expect.objectContaining({
          status: 'ready',
          entryPreflight: true,
          targetRead: true,
          replyGenerate: true,
          controlledSend: true,
          autoSend: true,
          message: '桌面微信、执行脚本、截图、输入、点击和自动发送能力可用。',
          nextAction:
            '可创建微信任务；auto-send 会调用本机微信脚本执行并保存证据。',
        }),
      );
    }
  });

  it('allows desktop WeChat health with trusted single-window evidence while warning about missing target lock', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const now = '2026-06-15T00:00:00.000Z';

    scopedService.wechatSessionConfirmation = {};
    scopedService.desktopEvidence = [];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];
    scopedService.isDesktopWechatExecutionReady =
      LocalEngineService.prototype['isDesktopWechatExecutionReady'];
    scopedService.summarizeDesktopWechatBlocker =
      LocalEngineService.prototype['summarizeDesktopWechatBlocker'];
    scopedService.detectWechatScreenshotSessionBlocker =
      LocalEngineService.prototype['detectWechatScreenshotSessionBlocker'];
    scopedService.isDesktopWechatExecutionReady =
      LocalEngineService.prototype['isDesktopWechatExecutionReady'];
    scopedService.summarizeDesktopWechatBlocker =
      LocalEngineService.prototype['summarizeDesktopWechatBlocker'];
    scopedService.detectWechatScreenshotSessionBlocker =
      LocalEngineService.prototype['detectWechatScreenshotSessionBlocker'];
    scopedService.useNodeAgentRuntime = jest.fn(() => true);
    scopedService.withCapabilityTimeout = jest.fn(
      async (_label: string, promise: Promise<unknown>) => promise,
    );
    scopedService.checkInteractionCapabilities = jest.fn(async () => ({
      status: 'ready',
      summary: '互动接口能力可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.checkContentPublishingCapability = jest.fn(async () => ({
      status: 'ready',
      summary: '内容发布能力可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.buildKaypalEntitlementCapability = jest.fn(async () => ({
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: 'ready',
      required: true,
      summary: 'Kaypal 会话权益可用。',
      checkedAt: now,
      nextAction: '',
      checks: [],
    }));
    scopedService.checkAiReplyModelConfig = jest.fn(async () => ({
      status: 'ready',
      summary: 'AI 回复模型可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.checkEvidenceReplayCapability = jest.fn(async () => ({
      status: 'ready',
      summary: '证据链可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.checkFileAccess = jest.fn(async () => ({
      status: 'ready',
      summary: '文件访问可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.mcpRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        serverCount: 1,
        toolCount: 1,
        resourceCount: 0,
        strictMode: false,
        servers: [],
        message: 'MCP 可用。',
      })),
    };
    scopedService.getPlaywrightMcpStatusWithCount = jest.fn(async () => ({
      online: true,
      childProcessRunning: true,
      transport: 'streamable-http',
      endpoint: 'http://127.0.0.1:39101/mcp',
      pid: 123,
      toolCount: 4,
      profileKey: 'ai-content',
      profileDir: '/tmp/profile',
      visibleWindow: false,
      isolated: true,
      readyForAutomation: true,
      requiredToolsReady: true,
      missingRequiredTools: [],
      message: 'playwright-mcp 可用。',
    }));
    scopedService.buildNodeAgentRuntimeCapability = jest.fn(async () => ({
      key: 'agent-s-sidecar',
      name: 'Agent-S 执行器',
      status: 'ready',
      required: true,
      summary: 'Node Runtime 可用。',
      checkedAt: now,
      nextAction: '',
      checks: [],
    }));
    scopedService.sandboxRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        platform: 'darwin',
        dockerAvailable: true,
        sandboxType: 'docker',
        message: '沙箱可用。',
      })),
    };
    scopedService.pluginRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        skillDirectory: '/tmp/skills',
        skillhubDirectory: '/tmp/skillhub',
        skillhubSkills: [],
        installedSkillCount: 0,
        skillNames: [],
        runtimeApiAvailable: true,
        message: '插件可用。',
      })),
    };
    scopedService.memoryRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        shortTermAvailable: true,
        dailyAvailable: true,
        longTermAvailable: true,
        runtimeApiAvailable: true,
        message: '记忆可用。',
      })),
    };
    scopedService.readWechatDesktopStatus = jest.fn(async () => ({
      platform: 'wechat',
      available: true,
      running: true,
      appName: 'WeChat',
      bundleId: 'com.tencent.xinWeChat',
      windowCount: 1,
      currentWindowTitle: 'WeChat',
      windowTitles: ['WeChat'],
      frontmost: false,
      screenshotAvailable: true,
      inputControlAvailable: true,
      clickControlAvailable: true,
      fileSelectionAvailable: true,
      message: '已检测到桌面微信和本机微信执行脚本。',
    }));
    scopedService.captureDesktopScreenshot = jest.fn(async () => ({
      type: 'screenshot',
      label: '桌面微信窗口状态截图',
      value: '/tmp/wechat.png',
      capturedAt: now,
      trusted: true,
      textSample: '微信 搜索 KayPal 群聊 发送 语音输入 表情',
    }));

    const capabilities = await scopedService.getCapabilities(now);
    const desktopControl = capabilities.find(
      (capability) => capability.key === 'desktop-control',
    );
    const wechatExecution = capabilities.find(
      (capability) => capability.key === 'wechat-execution',
    );

    expect(desktopControl).toEqual(
      expect.objectContaining({
        status: 'ready',
        summary: expect.stringContaining('桌面微信可控'),
      }),
    );
    expect(wechatExecution).toEqual(
      expect.objectContaining({
        status: 'ready',
        summary: expect.stringContaining('微信会话、回复、群发、加好友'),
      }),
    );
    expect(
      desktopControl?.checks.find((check) => check.name === '屏幕录制权限'),
    ).toEqual(
      expect.objectContaining({
        status: 'ready',
        message: '已保存桌面截图证据。',
      }),
    );
    expect(
      wechatExecution?.checks.find((check) => check.name === '联系人锁定'),
    ).toEqual(
      expect.objectContaining({
        status: 'warning',
        message:
          '已取得可信微信窗口证据；当前未锁定具体联系人，按商用测试账号受控执行风险提示处理。',
      }),
    );
  });

  it('blocks health when desktop WeChat screenshot evidence is untrusted', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const now = '2026-06-17T00:00:00.000Z';

    scopedService.ensureTaskStore = jest.fn(async () => undefined);
    scopedService.tasks = new Map();
    scopedService.startedAt = Date.now();
    scopedService.getCapabilities =
      LocalEngineService.prototype['getCapabilities'];
    scopedService.getFastCapabilities =
      LocalEngineService.prototype['getFastCapabilities'];
    scopedService.withCapabilityTimeout =
      LocalEngineService.prototype['withCapabilityTimeout'];
    scopedService.buildDesktopStatus =
      LocalEngineService.prototype['buildDesktopStatus'];
    scopedService.readDesktopStatusWithEvidence =
      LocalEngineService.prototype['readDesktopStatusWithEvidence'];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];
    scopedService.buildNodeAgentRuntimeCapability = jest.fn(async () => ({
      key: 'agent-s-sidecar',
      name: 'Agent-S 执行能力',
      status: 'ready',
      required: true,
      summary: 'Node Agent Runtime 已就绪。',
      checkedAt: now,
      nextAction: '',
      checks: [],
    }));
    scopedService.buildKaypalEntitlementCapability = jest.fn(async () => ({
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: 'ready',
      required: true,
      summary: 'Kaypal 会话权益可用。',
      checkedAt: now,
      nextAction: '',
      checks: [],
    }));
    scopedService.checkAiReplyModelConfig = jest.fn(async () => ({
      status: 'ready',
      summary: 'AI 模型可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.checkFileAccess = jest.fn(async () => ({
      status: 'ready',
      summary: '文件访问可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.checkEvidenceReplayCapability = jest.fn(async () => ({
      status: 'ready',
      summary: '证据链可用。',
      nextAction: '',
      checks: [],
    }));
    scopedService.mcpRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        serverCount: 1,
        toolCount: 1,
        resourceCount: 0,
        strictMode: false,
        servers: [],
        message: 'MCP 可用。',
      })),
    };
    scopedService.playwrightMcp = {
      getAutomationStatus: jest.fn(async () => ({
        readyForAutomation: true,
        childProcessRunning: true,
        online: true,
        endpoint: '/api/mcp/playwright',
        toolCount: 23,
        requiredToolsReady: true,
        missingRequiredTools: [],
        message: 'playwright-mcp ready',
      })),
      getStatus: jest.fn(() => ({
        childProcessRunning: true,
        pid: 123,
        profileKey: 'shared',
        profileDir: '/tmp/profile',
        visibleWindow: true,
        isolated: false,
      })),
    };
    scopedService.runtimeOrchestrator = {};
    scopedService.useNodeAgentRuntime = jest.fn(() => true);
    scopedService.sandboxRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        platform: 'darwin',
        dockerAvailable: true,
        sandboxType: 'docker',
        message: '沙箱可用。',
      })),
    };
    scopedService.pluginRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        skillDirectory: '/tmp/skills',
        skillhubDirectory: '/tmp/skillhub',
        skillhubSkills: [],
        installedSkillCount: 0,
        skillNames: [],
        runtimeApiAvailable: true,
        message: '插件可用。',
      })),
    };
    scopedService.memoryRuntime = {
      getStatus: jest.fn(async () => ({
        available: true,
        shortTermAvailable: true,
        dailyAvailable: true,
        longTermAvailable: true,
        runtimeApiAvailable: true,
        message: '记忆可用。',
      })),
    };
    scopedService.configService = {
      get: jest.fn(() => undefined),
    };
    scopedService.readWechatDesktopStatus = jest.fn(async () => ({
      platform: 'wechat',
      available: true,
      running: true,
      appName: 'WeChat',
      bundleId: 'com.tencent.xinWeChat',
      windowCount: 1,
      currentWindowTitle: '微信',
      windowTitles: ['微信'],
      frontmost: true,
      screenshotAvailable: true,
      inputControlAvailable: true,
      clickControlAvailable: true,
      fileSelectionAvailable: true,
      message: '已检测到桌面微信和本机微信执行脚本。',
    }));
    scopedService.captureDesktopScreenshot = jest.fn(async () => ({
      type: 'screenshot',
      label: '桌面微信窗口状态截图',
      value: '/tmp/browser.png',
      capturedAt: now,
      trusted: false,
      diagnostic: '当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。',
      textSample: 'codex.maynor1024.live 我的订阅',
    }));
    scopedService.wechatSessionConfirmation = {};
    scopedService.desktopEvidence = [];

    const capabilities = await scopedService.getCapabilities(now);
    const blockers = capabilities
      .filter(
        (capability) =>
          capability.required !== false &&
          ['blocked', 'missing', 'degraded'].includes(capability.status),
      )
      .map((capability) => ({
        capability: capability.name,
        message: capability.summary,
        nextAction: capability.nextAction,
      }));

    expect(blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: '桌面控制',
          message: expect.stringContaining('桌面微信截图证据不可信'),
        }),
      ]),
    );
    const desktopControl = capabilities.find(
      (capability) => capability.key === 'desktop-control',
    );
    expect(desktopControl).toEqual(
      expect.objectContaining({
        status: 'blocked',
        summary: expect.stringContaining('桌面微信截图证据不可信'),
      }),
    );
  });

  it('uses local commercial entitlement when Kaypal billing is temporarily unavailable', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const now = '2026-06-17T00:00:00.000Z';

    scopedService.toRuntimeRecord =
      LocalEngineService.prototype['toRuntimeRecord'];
    scopedService.toRuntimeString =
      LocalEngineService.prototype['toRuntimeString'];
    scopedService.formatCreditBalance =
      LocalEngineService.prototype['formatCreditBalance'];
    scopedService.buildBlockedKaypalEntitlementCapability =
      LocalEngineService.prototype['buildBlockedKaypalEntitlementCapability'];
    scopedService.buildCachedKaypalEntitlementCapability =
      LocalEngineService.prototype['buildCachedKaypalEntitlementCapability'];
    scopedService.buildKaypalEntitlementCapability =
      LocalEngineService.prototype['buildKaypalEntitlementCapability'];
    scopedService.authRequestContext = {
      get: jest.fn(() => undefined),
    };
    scopedService.kaypalClient = {
      getCloudBilling: jest.fn(async () => ({
        subscription: {
          unavailable: true,
          message: 'Kaypal 云端返回 401',
        },
        balance: {
          balance: null,
          unavailable: true,
          message: 'Kaypal 积分接口返回 401',
        },
      })),
    };

    const capability = await scopedService.buildKaypalEntitlementCapability(
      now,
      {
        id: 'user-1',
        kaypalUserId: 'kaypal-1',
        kaypalPlan: 'ADVANCED',
        kaypalPlanExpired: false,
        kaypalDesktopAccessToken: 'local-token',
        planMode: 'commercial',
        commercialExecutionAllowed: true,
      },
    );

    expect(capability).toEqual(
      expect.objectContaining({
        key: 'kaypal-entitlement',
        name: 'Kaypal 账号与权益',
        status: 'ready',
        required: true,
      }),
    );
    expect(capability.summary).toContain('套餐 ADVANCED');
    expect(capability.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '积分余额',
          status: 'warning',
          message: expect.stringContaining('401'),
        }),
      ]),
    );
  });

  it('uses cached Kaypal entitlement when the desktop token is missing', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const now = '2026-06-17T00:00:00.000Z';

    scopedService.toRuntimeString =
      LocalEngineService.prototype['toRuntimeString'];
    scopedService.buildBlockedKaypalEntitlementCapability =
      LocalEngineService.prototype['buildBlockedKaypalEntitlementCapability'];
    scopedService.buildCachedKaypalEntitlementCapability =
      LocalEngineService.prototype['buildCachedKaypalEntitlementCapability'];
    scopedService.buildKaypalEntitlementCapability =
      LocalEngineService.prototype['buildKaypalEntitlementCapability'];
    scopedService.authRequestContext = {
      get: jest.fn(() => undefined),
    };
    scopedService.kaypalClient = {
      getCloudBilling: jest.fn(),
    };

    const capability = await scopedService.buildKaypalEntitlementCapability(
      now,
      {
        id: 'user-1',
        kaypalUserId: 'kaypal-1',
        kaypalPlan: 'ADVANCED',
        kaypalPlanExpired: false,
        kaypalDesktopAccessToken: '',
        planMode: 'commercial',
        commercialExecutionAllowed: true,
      },
    );

    expect(scopedService.kaypalClient.getCloudBilling).not.toHaveBeenCalled();
    expect(capability).toEqual(
      expect.objectContaining({
        key: 'kaypal-entitlement',
        status: 'ready',
        required: true,
      }),
    );
    expect(capability.summary).toContain('套餐 ADVANCED');
    expect(capability.summary).toContain(
      '没有可刷新的 Kaypal desktop access token',
    );
    expect(capability.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '积分余额',
          status: 'warning',
        }),
      ]),
    );
  });

  it('locks the WeChat session only after automatic contact alignment succeeds', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {};
    scopedService.desktopEvidence = [];
    scopedService.rememberDesktopEvidence =
      LocalEngineService.prototype['rememberDesktopEvidence'];
    scopedService.autoUploadService = {
      alignWechatContact: jest.fn(async () => ({
        ok: true,
        stage: 'aligned',
        targetText: '微信客户A',
        matchedTitle: '微信客户A',
        windowTitle: '微信客户A',
        message: '已自动打开目标微信会话。',
        nextAction: '可以继续填入草稿；发送动作仍需确认。',
        screenshotPath: '/tmp/wechat-align.png',
        evidence: {
          type: 'screenshot',
          label: '微信目标对齐截图',
          value: '/tmp/wechat-align.png',
        },
        matches: [{ name: '微信客户A', remark: '微信客户A', id: 'wechat-1' }],
        ambiguous: false,
        alignedAt: '2026-06-15T00:00:00.000Z',
      })),
    };
    scopedService.getWechatSessionStatus = jest.fn(async () => ({
      checkedAt: '2026-06-15T00:00:01.000Z',
      canDraft:
        scopedService.wechatSessionConfirmation.currentWindowConfirmed ===
          true &&
        scopedService.wechatSessionConfirmation.contactConfirmed === true &&
        scopedService.wechatSessionConfirmation.draftBeforeFillConfirmed ===
          true,
      targetContact: scopedService.wechatSessionConfirmation.targetContact,
      alignment: scopedService.wechatSessionConfirmation.alignment,
      lock: {
        locked: true,
        targetContact: scopedService.wechatSessionConfirmation.targetContact,
        windowTitle: scopedService.wechatSessionConfirmation.lockedWindowTitle,
        message: '当前微信窗口和联系人已锁定，可填入草稿，仍不会自动发送。',
      },
      blockers: [],
      warnings: [],
      evidence: scopedService.desktopEvidence,
    }));

    const status = await scopedService.alignWechatSession({
      targetContact: '微信客户A',
      operator: 'spec',
    });

    expect(
      scopedService.autoUploadService.alignWechatContact,
    ).toHaveBeenCalledWith('微信客户A');
    expect(status.canDraft).toBe(true);
    expect(status.alignment).toEqual(
      expect.objectContaining({
        ok: true,
        stage: 'aligned',
        targetText: '微信客户A',
      }),
    );
    expect(scopedService.wechatSessionConfirmation).toEqual(
      expect.objectContaining({
        targetContact: '微信客户A',
        currentWindowConfirmed: true,
        contactConfirmed: true,
        draftBeforeFillConfirmed: true,
        contactAmbiguityResolved: true,
        lockedWindowTitle: '微信客户A',
      }),
    );
  });

  it('does not lock the WeChat session when automatic contact alignment is ambiguous', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {};
    scopedService.desktopEvidence = [];
    scopedService.rememberDesktopEvidence =
      LocalEngineService.prototype['rememberDesktopEvidence'];
    scopedService.autoUploadService = {
      alignWechatContact: jest.fn(async () => ({
        ok: false,
        stage: 'ambiguous',
        targetText: '客户重名',
        windowTitle: '微信',
        message: '已搜索目标，但无法从当前微信窗口回读确认联系人或群名。',
        nextAction: '请检查联系人重名、搜索结果和微信窗口状态后重试。',
        screenshotPath: '/tmp/wechat-align-ambiguous.png',
        evidence: {
          type: 'screenshot',
          label: '微信目标对齐异常截图',
          value: '/tmp/wechat-align-ambiguous.png',
        },
        matches: [],
        ambiguous: true,
        alignedAt: '2026-06-15T00:00:00.000Z',
      })),
    };
    scopedService.getWechatSessionStatus = jest.fn(async () => ({
      checkedAt: '2026-06-15T00:00:01.000Z',
      canDraft: false,
      targetContact: scopedService.wechatSessionConfirmation.targetContact,
      alignment: scopedService.wechatSessionConfirmation.alignment,
      blockers: ['当前窗口或联系人信息存在歧义，请人工核对后再继续。'],
      warnings: [],
      evidence: scopedService.desktopEvidence,
    }));

    const status = await scopedService.alignWechatSession({
      targetContact: '客户重名',
      operator: 'spec',
    });

    expect(status.canDraft).toBe(false);
    expect(status.alignment).toEqual(
      expect.objectContaining({
        ok: false,
        stage: 'ambiguous',
        ambiguous: true,
      }),
    );
    expect(scopedService.wechatSessionConfirmation).toEqual(
      expect.objectContaining({
        targetContact: '客户重名',
        currentWindowConfirmed: false,
        contactConfirmed: false,
        draftBeforeFillConfirmed: false,
        contactAmbiguityResolved: false,
      }),
    );
  });

  it('does not lock the WeChat session when automatic search only finds a candidate', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {};
    scopedService.desktopEvidence = [];
    scopedService.rememberDesktopEvidence =
      LocalEngineService.prototype['rememberDesktopEvidence'];
    scopedService.autoUploadService = {
      alignWechatContact: jest.fn(async () => ({
        ok: false,
        stage: 'candidate_found',
        targetText: '九章智能｜客户沟通群(5)',
        searchedText: '客户沟通群',
        windowTitle: '微信',
        message: '已找到疑似微信会话结果，但还没有确认进入目标会话。',
        nextAction:
          '请核对微信搜索结果；系统下一步需要接入视觉点击后才能自动锁定。',
        screenshotPath: '/tmp/wechat-align-candidate.png',
        evidence: {
          type: 'screenshot',
          label: '微信目标对齐异常截图',
          value: '/tmp/wechat-align-candidate.png',
        },
        matches: [],
        ambiguous: true,
        alignedAt: '2026-06-15T00:00:00.000Z',
      })),
    };
    scopedService.getWechatSessionStatus = jest.fn(async () => ({
      checkedAt: '2026-06-15T00:00:01.000Z',
      canDraft: false,
      targetContact: scopedService.wechatSessionConfirmation.targetContact,
      alignment: scopedService.wechatSessionConfirmation.alignment,
      lock: { locked: false, message: '当前微信会话还未锁定。' },
      blockers: ['当前窗口或联系人信息存在歧义，请人工核对后再继续。'],
      warnings: [],
      evidence: scopedService.desktopEvidence,
    }));

    const status = await scopedService.alignWechatSession({
      targetContact: '九章智能｜客户沟通群(5)',
      operator: 'spec',
    });

    expect(status.canDraft).toBe(false);
    expect(status.alignment).toEqual(
      expect.objectContaining({
        ok: false,
        stage: 'candidate_found',
        targetText: '九章智能｜客户沟通群(5)',
        searchedText: '客户沟通群',
      }),
    );
    expect(scopedService.wechatSessionConfirmation).toEqual(
      expect.objectContaining({
        targetContact: '九章智能｜客户沟通群(5)',
        currentWindowConfirmed: false,
        contactConfirmed: false,
        draftBeforeFillConfirmed: false,
        contactAmbiguityResolved: false,
      }),
    );
  });

  it('does not mark a confirmed locked WeChat target as ambiguous when the window title is generic', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {
      targetContact: 'KayPal (4)',
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      contactAmbiguityResolved: true,
      lockedWindowTitle: 'KayPal (4)',
    };
    scopedService.desktopEvidence = [];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];

    const status = LocalEngineService.prototype['buildDesktopStatus'].call(
      scopedService,
      {
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '微信',
        windowTitles: ['微信'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
      },
      '2026-06-15T00:00:00.000Z',
      {
        type: 'screenshot',
        label: '微信截图',
        value: '/tmp/wechat.png',
        capturedAt: '2026-06-15T00:00:00.000Z',
      },
    );

    expect(status.window.currentWindowLikelyWechatChat).toBe(true);
    expect(status.warnings).not.toContain(
      '联系人信息需要人工核对，避免填错会话。',
    );
  });

  it('allows a confirmed locked WeChat target to pass commercial preflight with a generic single window title', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {
      targetContact: 'KayPal (4)',
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      contactAmbiguityResolved: true,
      lockedWindowTitle: '微信',
      lockCapturedAt: '2026-06-15T00:00:00.000Z',
    };
    scopedService.desktopEvidence = [];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];

    const desktopStatus = LocalEngineService.prototype[
      'buildDesktopStatus'
    ].call(
      scopedService,
      {
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '微信',
        windowTitles: ['微信'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
      },
      '2026-06-15T00:00:00.000Z',
      {
        type: 'screenshot',
        label: '微信截图',
        value: '/tmp/wechat.png',
        capturedAt: '2026-06-15T00:00:00.000Z',
      },
    );

    const preflight = LocalEngineService.prototype[
      'buildDesktopCommercialPreflight'
    ].call(scopedService, desktopStatus);

    expect(desktopStatus.window.currentWindowLikelyWechatChat).toBe(true);
    expect(preflight.allowed).toBe(true);
    expect(preflight.blockers).not.toContain(
      '无法确认当前前台窗口是唯一微信目标会话。',
    );
  });

  it('keeps an aligned WeChat session ready when the current screenshot only has an empty OCR result', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {
      targetContact: 'KayPal (4)',
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      contactAmbiguityResolved: true,
      lockedWindowTitle: '微信',
      lockCapturedAt: '2026-06-15T00:00:00.000Z',
      alignment: {
        ok: true,
        stage: 'aligned',
        targetText: 'KayPal (4)',
        searchedText: 'KayPal',
        matchedTitle: 'KayPal (4)',
        windowTitle: '微信',
        message: '已自动打开目标微信会话。',
        screenshotPath: '/tmp/wechat-align.png',
        pageTextSample: 'KayPal （4） 对不起 发错地了 搜索',
        ambiguous: false,
        alignedAt: '2026-06-15T00:00:00.000Z',
      },
    };
    scopedService.desktopEvidence = [];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];
    scopedService.detectWechatScreenshotSessionBlocker =
      LocalEngineService.prototype['detectWechatScreenshotSessionBlocker'];
    scopedService.hasTrustedWechatAlignmentLock =
      LocalEngineService.prototype['hasTrustedWechatAlignmentLock'];
    scopedService.isWechatScreenshotSoftDiagnostic =
      LocalEngineService.prototype['isWechatScreenshotSoftDiagnostic'];

    const desktopStatus = LocalEngineService.prototype[
      'buildDesktopStatus'
    ].call(
      scopedService,
      {
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '微信',
        windowTitles: ['微信'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
      },
      '2026-06-15T00:00:00.000Z',
      {
        type: 'screenshot',
        label: '微信截图',
        value: '/tmp/wechat-empty-ocr.png',
        capturedAt: '2026-06-15T00:00:00.000Z',
        trusted: false,
        diagnostic:
          '当前微信窗口截图没有识别到可验证内容，不能确认是真实微信会话窗口。',
        textSample: '',
      },
    );

    const preflight = LocalEngineService.prototype[
      'buildDesktopCommercialPreflight'
    ].call(scopedService, desktopStatus);

    expect(desktopStatus.blockers).not.toContain(
      '桌面微信截图证据不可信：当前微信窗口截图没有识别到可验证内容，不能确认是真实微信会话窗口。',
    );
    expect(
      desktopStatus.permissionChecks.find(
        (check) => check.key === 'screenshot',
      ),
    ).toEqual(expect.objectContaining({ status: 'ready' }));
    expect(desktopStatus.window.currentWindowLikelyWechatChat).toBe(true);
    expect(preflight.allowed).toBe(true);
  });

  it('blocks desktop WeChat commercial preflight when screenshot evidence is not a WeChat window', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {
      targetContact: 'KayPal (4)',
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      contactAmbiguityResolved: true,
      lockedWindowTitle: 'KayPal (4)',
    };
    scopedService.desktopEvidence = [];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];

    const desktopStatus = LocalEngineService.prototype[
      'buildDesktopStatus'
    ].call(
      scopedService,
      {
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: 'KayPal (4)',
        windowTitles: ['KayPal (4)'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
      },
      '2026-06-15T00:00:00.000Z',
      {
        type: 'screenshot',
        label: '微信截图',
        value: '/tmp/browser-page.png',
        capturedAt: '2026-06-15T00:00:00.000Z',
        trusted: false,
        diagnostic: '当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。',
        textSample: 'codex.maynor1024.live/subscriptions 我的订阅 API密钥',
      },
    );

    const preflight = LocalEngineService.prototype[
      'buildDesktopCommercialPreflight'
    ].call(scopedService, desktopStatus);

    expect(desktopStatus.window.currentWindowLikelyWechatChat).toBe(true);
    expect(desktopStatus.blockers).toContain(
      '桌面微信截图证据不可信：当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。',
    );
    expect(
      desktopStatus.permissionChecks.find(
        (check) => check.key === 'screenshot',
      ),
    ).toEqual(expect.objectContaining({ status: 'blocked' }));
    expect(
      desktopStatus.permissionChecks.find(
        (check) => check.key === 'screen-recording',
      ),
    ).toEqual(expect.objectContaining({ status: 'ready' }));
    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toEqual(
      expect.arrayContaining([
        '桌面微信截图证据不可信：当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。',
      ]),
    );
  });

  it('classifies a Chrome video account page captured in the WeChat region as screenshot mismatch, not screen-recording loss', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {};
    scopedService.desktopEvidence = [];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];
    scopedService.detectWechatScreenshotSessionBlocker =
      LocalEngineService.prototype['detectWechatScreenshotSessionBlocker'];

    const desktopStatus = LocalEngineService.prototype[
      'buildDesktopStatus'
    ].call(
      scopedService,
      {
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '微信',
        windowTitles: ['微信'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
      },
      '2026-06-19T00:00:00.000Z',
      {
        type: 'screenshot',
        label: '微信截图',
        value: '/tmp/chrome-video-channel.png',
        capturedAt: '2026-06-19T00:00:00.000Z',
        trusted: false,
        diagnostic: '当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。',
        textSample:
          'Chrome 测试版 channels.weixin.qq.com/login.html 视频号助手 微信扫码登录',
      },
    );

    expect(
      desktopStatus.permissionChecks.find(
        (check) => check.key === 'screen-recording',
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'ready',
        message: '屏幕录制可返回截图，但截图内容不是可验证的微信会话窗口。',
      }),
    );
    expect(
      desktopStatus.permissionChecks.find(
        (check) => check.key === 'screenshot',
      ),
    ).toEqual(expect.objectContaining({ status: 'blocked' }));
    expect(desktopStatus.blockers).toContain(
      '桌面微信截图证据不可信：当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。',
    );
  });

  it('blocks desktop WeChat commercial preflight on File Transfer web QR screen', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {};
    scopedService.desktopEvidence = [];
    scopedService.normalizeWindowTitles =
      LocalEngineService.prototype['normalizeWindowTitles'];
    scopedService.isWechatTargetLocked =
      LocalEngineService.prototype['isWechatTargetLocked'];
    scopedService.detectWechatScreenshotSessionBlocker =
      LocalEngineService.prototype['detectWechatScreenshotSessionBlocker'];

    const desktopStatus = LocalEngineService.prototype[
      'buildDesktopStatus'
    ].call(
      scopedService,
      {
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '微信',
        windowTitles: ['微信'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
      },
      '2026-06-19T00:00:00.000Z',
      {
        type: 'screenshot',
        label: '微信截图',
        value: '/tmp/wechat-file-transfer-web.png',
        capturedAt: '2026-06-19T00:00:00.000Z',
        trusted: true,
        textSample: '传输助手，手机电脑轻 微信文件传输助手网页版 二维码',
      },
    );

    const preflight = LocalEngineService.prototype[
      'buildDesktopCommercialPreflight'
    ].call(scopedService, desktopStatus);

    expect(desktopStatus.window.currentWindowLikelyWechatChat).toBe(false);
    expect(desktopStatus.blockers).toEqual(
      expect.arrayContaining([
        '桌面微信不是可发送目标会话：当前是微信文件传输助手网页版二维码，不是桌面微信聊天会话。',
      ]),
    );
    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toEqual(
      expect.arrayContaining([
        '桌面微信不是可发送目标会话：当前是微信文件传输助手网页版二维码，不是桌面微信聊天会话。',
      ]),
    );
  });

  it('captures the WeChat window region instead of the full desktop when a window frame is available', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getProjectRoot = jest.fn(() => '/tmp/kaypal-ai-content');
    scopedService.readWechatWindowFrame = jest.fn(async () => ({
      x: 616,
      y: 251,
      width: 280,
      height: 380,
      windowId: 286131,
    }));
    scopedService.runCommand = jest.fn(async () => undefined);
    scopedService.readDesktopScreenshotText = jest.fn(async () => '进入微信');
    scopedService.detectWechatScreenshotMismatch =
      LocalEngineService.prototype['detectWechatScreenshotMismatch'];

    const evidence = await LocalEngineService.prototype[
      'captureDesktopScreenshot'
    ].call(scopedService, '桌面微信窗口状态截图');

    expect(scopedService.runCommand).toHaveBeenCalledWith(
      'screencapture',
      expect.arrayContaining(['-l', '286131']),
      3000,
    );
    expect(evidence).toEqual(
      expect.objectContaining({
        type: 'screenshot',
        trusted: true,
        textSample: '进入微信',
      }),
    );
  });

  it('falls back to region capture only when a WeChat window id is unavailable', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getProjectRoot = jest.fn(() => '/tmp/kaypal-ai-content');
    scopedService.readWechatWindowFrame = jest.fn(async () => ({
      x: 616,
      y: 251,
      width: 280,
      height: 380,
    }));
    scopedService.runCommand = jest.fn(async () => undefined);
    scopedService.readDesktopScreenshotText = jest.fn(async () => '进入微信');
    scopedService.detectWechatScreenshotMismatch =
      LocalEngineService.prototype['detectWechatScreenshotMismatch'];

    await LocalEngineService.prototype['captureDesktopScreenshot'].call(
      scopedService,
      '桌面微信窗口状态截图',
    );

    expect(scopedService.runCommand).toHaveBeenCalledWith(
      'screencapture',
      expect.arrayContaining(['-R', '616,251,280,380']),
      3000,
    );
  });

  it('rejects a Kaypal browser auth page even when bookmarks mention WeChat', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getProjectRoot = jest.fn(() => '/tmp/kaypal-ai-content');
    scopedService.readWechatWindowFrame = jest.fn(async () => ({
      x: 0,
      y: 34,
      width: 1512,
      height: 885,
    }));
    scopedService.runCommand = jest.fn(async () => undefined);
    scopedService.readDesktopScreenshotText = jest.fn(
      async () =>
        'test.kaypal.cn/api/desktop-auth/authorize 已允许连接 可以回到 Kaypal Desktop 所有书签 微信公众平台 豆包 DeepSeek',
    );
    scopedService.detectWechatScreenshotMismatch =
      LocalEngineService.prototype['detectWechatScreenshotMismatch'];

    const evidence = await LocalEngineService.prototype[
      'captureDesktopScreenshot'
    ].call(scopedService, '桌面微信窗口状态截图');

    expect(evidence).toEqual(
      expect.objectContaining({
        type: 'screenshot',
        trusted: false,
        diagnostic:
          '当前截图识别到 Kaypal 授权页内容，不是可验证的微信会话窗口。',
      }),
    );
  });

  it('does not capture the full desktop when no WeChat window frame is available', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getProjectRoot = jest.fn(() => '/tmp/kaypal-ai-content');
    scopedService.readWechatWindowFrame = jest.fn(async () => null);
    scopedService.runCommand = jest.fn(async () => undefined);
    scopedService.readDesktopScreenshotText = jest.fn(async () => '');

    const evidence = await LocalEngineService.prototype[
      'captureDesktopScreenshot'
    ].call(scopedService, '桌面微信窗口状态截图');

    expect(scopedService.runCommand).not.toHaveBeenCalled();
    expect(evidence).toEqual(
      expect.objectContaining({
        type: 'text',
        trusted: false,
        diagnostic: '未读取到桌面微信主窗口，不能把全屏截图当作微信会话证据。',
      }),
    );
  });

  it('does not capture a WeChat window when macOS reports the content is not shareable', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getProjectRoot = jest.fn(() => '/tmp/kaypal-ai-content');
    scopedService.readWechatWindowFrame = jest.fn(async () => ({
      x: 0,
      y: 34,
      width: 1512,
      height: 885,
      shareable: false,
    }));
    scopedService.runCommand = jest.fn(async () => undefined);
    scopedService.readDesktopScreenshotText = jest.fn(async () => '微信');

    const evidence = await LocalEngineService.prototype[
      'captureDesktopScreenshot'
    ].call(scopedService, '桌面微信窗口状态截图');

    expect(scopedService.runCommand).not.toHaveBeenCalled();
    expect(evidence).toEqual(
      expect.objectContaining({
        type: 'text',
        trusted: false,
        diagnostic:
          '桌面微信主窗口当前禁止屏幕采集或内容不可见，不能确认是真实微信会话窗口。',
      }),
    );
  });

  it('rejects a blank WeChat window screenshot because the session cannot be verified', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.getProjectRoot = jest.fn(() => '/tmp/kaypal-ai-content');
    scopedService.readWechatWindowFrame = jest.fn(async () => ({
      x: 0,
      y: 34,
      width: 1512,
      height: 885,
    }));
    scopedService.runCommand = jest.fn(async () => undefined);
    scopedService.readDesktopScreenshotText = jest.fn(async () => '');
    scopedService.detectWechatScreenshotMismatch =
      LocalEngineService.prototype['detectWechatScreenshotMismatch'];

    const evidence = await LocalEngineService.prototype[
      'captureDesktopScreenshot'
    ].call(scopedService, '桌面微信窗口状态截图');

    expect(evidence).toEqual(
      expect.objectContaining({
        type: 'screenshot',
        trusted: false,
        diagnostic:
          '当前微信窗口截图没有识别到可验证内容，不能确认是真实微信会话窗口。',
      }),
    );
  });

  it('marks manually confirmed WeChat sessions as ambiguity-resolved', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.wechatSessionConfirmation = {};
    scopedService.captureDesktopScreenshot = jest.fn(async () => ({
      type: 'screenshot',
      label: '微信会话确认截图',
      value: '/tmp/wechat-confirm.png',
      capturedAt: '2026-06-15T00:00:00.000Z',
    }));
    scopedService.rememberDesktopEvidence = jest.fn();
    scopedService.getWechatSessionStatus = jest.fn(async () => ({
      canDraft: true,
      targetContact: scopedService.wechatSessionConfirmation.targetContact,
    }));

    await scopedService.confirmWechatSession({
      targetContact: 'KayPal (4)',
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
    });

    expect(scopedService.wechatSessionConfirmation).toEqual(
      expect.objectContaining({
        targetContact: 'KayPal (4)',
        currentWindowConfirmed: true,
        contactConfirmed: true,
        draftBeforeFillConfirmed: true,
        contactAmbiguityResolved: true,
        lockCapturedAt: expect.any(String),
      }),
    );
  });

  it('builds a contextual fallback reply from the customer message', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.replyRule = (scopedService as any).defaultReplyRule
      ? scopedService.defaultReplyRule()
      : {
          fallbackEnabled: true,
          fallbackReplies: ['你把具体内容发我，我按实际情况帮你看。'],
          requireApprovalKeywords: [],
          serviceHighlights: ['按客户具体问题回复'],
          askForContact: true,
          closingText: '你把具体款式、订单或时间发我，我按实际情况帮你看。',
        };
    scopedService.pickConfiguredFallbackReply =
      LocalEngineService.prototype['pickConfiguredFallbackReply'];
    scopedService.normalizeStringList =
      LocalEngineService.prototype['normalizeStringList'];
    scopedService.extractReplySubject =
      LocalEngineService.prototype['extractReplySubject'];
    scopedService.resolveSafeReplyClosing =
      LocalEngineService.prototype['resolveSafeReplyClosing'];

    const reply = LocalEngineService.prototype['buildReplyFromRule'].call(
      scopedService,
      '这个加盟需要多少费用，多久能回本？',
      { targetName: '张总' },
    );

    expect(reply).toContain('张总');
    expect(reply).toContain('价格');
    expect(reply).not.toBe('你把具体内容发我，我按实际情况帮你看。');
  });

  it('keeps structured Douyin lead evidence on normalized task targets', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.createId = jest.fn(() => 'id');
    scopedService.optionalTrimmedText =
      LocalEngineService.prototype['optionalTrimmedText'];
    scopedService.optionalNumber =
      LocalEngineService.prototype['optionalNumber'];
    scopedService.buildReplyFromRule = jest.fn(() => '默认回复');

    const targets = scopedService.normalizeBatchTargets(
      {
        type: 'douyin-comment-reply',
        sourceUrl: 'https://www.douyin.com/video/fallback',
        profileUrl: 'https://www.douyin.com/user/fallback',
        commentTime: '昨天',
        videoTitle: '默认视频',
        videoUrl: 'https://www.douyin.com/video/fallback',
        engagementScore: '120',
        batchTargets: [
          {
            targetName: '高意向客户',
            sourceText: '想了解加盟多少钱',
            replyText: '可以私信发资料。',
            sourceUrl: 'https://www.douyin.com/video/1',
            profileUrl: 'https://www.douyin.com/user/lead-1',
            commentTime: '今天',
            videoTitle: '餐饮加盟案例',
            videoUrl: 'https://www.douyin.com/video/1',
            engagementScore: 9800,
          },
        ],
      },
      '2026-06-14T00:00:00.000Z',
    );

    expect(targets[0]).toMatchObject({
      targetName: '高意向客户',
      sourceUrl: 'https://www.douyin.com/video/1',
      profileUrl: 'https://www.douyin.com/user/lead-1',
      commentTime: '今天',
      videoTitle: '餐饮加盟案例',
      videoUrl: 'https://www.douyin.com/video/1',
      engagementScore: 9800,
      status: 'queued',
    });
  });

  it('continues a confirmed WeChat reply by reading the live session, generating AI text, and sending through the local command', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-reply-draft',
      targetName: '客户A',
      sourceText: '',
      replyText: '',
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(scopedService.runWechatDesktopCommand).toHaveBeenCalledWith(
      'wechat-live-auto-reply',
      ['客户A', 'read-only'],
      '客户A',
    );
    expect(
      scopedService.tryGenerateInteractionReplyWithAi,
    ).toHaveBeenCalledWith(
      '客户问价',
      expect.objectContaining({
        targetName: '客户A',
        accountName: '桌面微信',
      }),
    );
    expect(
      scopedService.autoUploadService.sendWechatReply,
    ).toHaveBeenCalledWith({
      targetText: '客户A',
      replyText: 'AI生成回复：您好，可以发资料。',
    });
    expect(scopedService.runWechatContactCommand).not.toHaveBeenCalledWith(
      'wechat-auto-reply',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result.status).toBe('completed');
    expect(result.sourceText).toBe('客户问价');
    expect(result.replyText).toBe('AI生成回复：您好，可以发资料。');
    expect(result.replyGeneratedBy).toBe('ai');
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'success',
          message: '微信消息已发送给 客户A。',
        }),
      ]),
    );
  });

  it('continues a confirmed WeChat reply with explicit text without requiring live chat OCR', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-reply-draft',
      targetName: '客户A',
      sourceText: '',
      replyText: 'Kaypal微信会话真实自动回复验收，测试内容请忽略。',
      metadata: {
        wechat_reply_draft: 'Kaypal微信会话真实自动回复验收，测试内容请忽略。',
      },
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(scopedService.runWechatDesktopCommand).not.toHaveBeenCalledWith(
      'wechat-live-auto-reply',
      expect.anything(),
      expect.anything(),
    );
    expect(
      scopedService.tryGenerateInteractionReplyWithAi,
    ).not.toHaveBeenCalled();
    expect(
      scopedService.autoUploadService.sendWechatReply,
    ).toHaveBeenCalledWith({
      targetText: '客户A',
      replyText: 'Kaypal微信会话真实自动回复验收，测试内容请忽略。',
    });
    expect(scopedService.runWechatContactCommand).not.toHaveBeenCalledWith(
      'wechat-auto-reply',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result.status).toBe('completed');
    expect(result.replyText).toBe(
      'Kaypal微信会话真实自动回复验收，测试内容请忽略。',
    );
    expect(result.replyGeneratedBy).toBe('fallback');
  });

  it('fails a confirmed WeChat reply when desktop send cannot prove the message was sent', async () => {
    const scopedService = makeApprovalService();
    scopedService.autoUploadService.sendWechatReply = jest.fn(async () => ({
      status: 'draft_not_ready',
      sent: false,
      message: '微信现场联系人还没完全对齐到目标对象，当前不允许真实发送。',
      targetText: '客户A',
      replyText: 'Kaypal微信会话真实自动回复验收，测试内容请忽略。',
      evidence: {
        type: 'screenshot',
        label: '微信发送失败截图',
        value: '/tmp/not-ready.png',
        path: '/tmp/not-ready.png',
      },
      readbackText: '',
      draftedAt: '2026-06-15T00:00:01.000Z',
    }));
    const task = buildWaitingTask({
      type: 'wechat-reply-draft',
      targetName: '客户A',
      sourceText: '',
      replyText: 'Kaypal微信会话真实自动回复验收，测试内容请忽略。',
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('failed');
    expect(result.nextAction).toBe('请检查微信窗口、联系人和发送权限后重试。');
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: '微信现场联系人还没完全对齐到目标对象，当前不允许真实发送。',
        }),
      ]),
    );
  });

  it('continues a confirmed browser interaction by running Runtime in auto-send mode', async () => {
    const scopedService = makeApprovalService();
    const execute = jest.fn(async () => ({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '抖音评论已发送：完成',
      technicalMessage: '已通过页面发送回读。',
      runtime: { mode: 'local-runtime' },
      evidence: [
        {
          type: 'screenshot',
          label: '抖音发送结果',
          path: '/tmp/douyin-sent.png',
          createdAt: '2026-06-15T00:00:01.000Z',
        },
      ],
      readback: {
        expectedText: '可以发资料。',
        actualText: '可以发资料。',
        matched: true,
      },
    }));
    scopedService.runtimeOrchestrator = { execute };
    scopedService.browserInteractionQueues = new Map();
    scopedService.resolveExecutionContract = jest.fn(() => ({ ok: true }));
    scopedService.isDesktopInteractionTask =
      LocalEngineService.prototype['isDesktopInteractionTask'];
    scopedService.setTaskStep = LocalEngineService.prototype['setTaskStep'];
    scopedService.updateTask = LocalEngineService.prototype['updateTask'];
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.markQueuedBatchTargets =
      LocalEngineService.prototype['markQueuedBatchTargets'];
    scopedService.completeQueuedBatchTargets =
      LocalEngineService.prototype['completeQueuedBatchTargets'];
    scopedService.collectRecentEvidenceEventIds =
      LocalEngineService.prototype['collectRecentEvidenceEventIds'];
    scopedService.buildBatchSummary = buildBatchSummary;
    scopedService.isRuntimeAccountEntryBlocker =
      LocalEngineService.prototype['isRuntimeAccountEntryBlocker'];
    scopedService.runBrowserAssistedTaskWithQueue =
      LocalEngineService.prototype['runBrowserAssistedTaskWithQueue'];
    scopedService.preflightBrowserTaskViaRuntime = jest.fn(async () => ({
      ok: true,
      message: 'runtime ready',
      blockers: [],
    }));
    scopedService.ensureBrowserInteractionTarget = jest.fn(async () => true);
    scopedService.markPreparedBrowserInteractionSteps = jest.fn();

    const task = buildWaitingTask({
      type: 'douyin-comment-reply',
      accountId: '1',
      accountName: '抖音账号',
      platformName: '抖音',
      targetName: '候选客户',
      sourceText: '怎么加盟',
      replyText: '可以发资料。',
    });
    task.executionMode = 'browser-assisted';
    task.batchTargets = buildBatchTargets(['候选客户'], '可以发资料。');
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'douyin-comment-reply',
        payload: expect.objectContaining({
          targetText: '怎么加盟',
          replyText: '可以发资料。',
        }),
      }),
      expect.objectContaining({
        sendMode: 'auto-send',
      }),
    );
    expect(result.status).toBe('completed');
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'success',
          message: '抖音评论已发送：完成',
        }),
      ]),
    );
  });

  it('indexes desktop Runtime screenshots as desktop evidence', async () => {
    const scopedService = makeApprovalService();
    scopedService.buildTaskEvidenceIndex =
      LocalEngineService.prototype['buildTaskEvidenceIndex'];
    scopedService.collectTaskEvidence =
      LocalEngineService.prototype['collectTaskEvidence'];
    scopedService.groupTaskEvidenceByType =
      LocalEngineService.prototype['groupTaskEvidenceByType'];
    scopedService.toTaskEvidenceIndexItems =
      LocalEngineService.prototype['toTaskEvidenceIndexItems'];
    scopedService.previewEvidenceValue =
      LocalEngineService.prototype['previewEvidenceValue'];
    scopedService.buildTaskEvidenceIntegrity =
      LocalEngineService.prototype['buildTaskEvidenceIntegrity'];
    scopedService.taskNeedsBrowserEvidence =
      LocalEngineService.prototype['taskNeedsBrowserEvidence'];
    scopedService.taskNeedsDesktopEvidence =
      LocalEngineService.prototype['taskNeedsDesktopEvidence'];

    const task = buildWaitingTask({
      type: 'wechat-moments-marketing',
      accountId: 'local-wechat-desktop',
      accountName: '本机微信',
      platformName: '微信',
      targetName: '朋友圈第 1 条',
      sourceText: '朋友圈评论验收',
      replyText: 'Kaypal朋友圈评论真实验收，请忽略。',
    });
    task.status = 'completed';
    task.sendMode = 'auto-send';
    task.executionMode = 'browser-assisted';
    task.batchTargets = buildBatchTargets(
      ['朋友圈第 1 条'],
      'Kaypal朋友圈评论真实验收，请忽略。',
    );
    task.riskPolicy = {
      level: 'high',
      allowed: true,
      checks: [],
      generatedAt: '2026-06-15T00:00:00.000Z',
    } as any;
    task.nextAction = '朋友圈营销完成：成功 1，失败 0。';
    task.completedAt = '2026-06-15T00:00:02.000Z';
    task.events.push({
      id: 'event-wechat-runtime',
      level: 'success',
      message:
        '朋友圈营销完成：成功 1，失败 0。；自动发送已完成，回读确认：朋友圈评论已发送。',
      createdAt: '2026-06-15T00:00:01.000Z',
      evidence: {
        type: 'screenshot',
        label: 'Node Runtime 微信执行截图 node-runtime-artifact-1',
        value: '/tmp/wechat-moments-sent.png',
        artifactUrl: '/tmp/wechat-moments-sent.png',
        stageKey: 'send-result',
      },
    });
    const evidenceIndex = scopedService.buildTaskEvidenceIndex(task);

    expect(task.status).toBe('completed');
    expect(evidenceIndex.desktop).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactUrl: '/tmp/wechat-moments-sent.png',
        }),
      ]),
    );
    expect(
      scopedService.buildTaskEvidenceIntegrity(task).missing,
    ).not.toContain('缺少桌面证据索引');
  });

  it('marks a confirmed browser interaction as no_target when Runtime cannot find the target', async () => {
    const scopedService = makeApprovalService();
    const execute = jest.fn(async () => ({
      ok: false,
      status: 'failed',
      reasonCode: 'target_not_found',
      userMessage: '抖音目标评论不存在或已被删除',
      technicalMessage:
        'engine: 已扫描可见作品评论，但未找到目标评论，未操作。',
      runtime: { mode: 'local-runtime' },
      evidence: [
        {
          type: 'screenshot',
          label: '抖音无目标证据',
          path: '/tmp/douyin-no-target.png',
          createdAt: '2026-06-15T00:00:01.000Z',
        },
      ],
    }));
    scopedService.runtimeOrchestrator = { execute };
    scopedService.resolveExecutionContract = jest.fn(() => ({ ok: true }));
    scopedService.isDesktopInteractionTask =
      LocalEngineService.prototype['isDesktopInteractionTask'];
    scopedService.setTaskStep = LocalEngineService.prototype['setTaskStep'];
    scopedService.updateTask = LocalEngineService.prototype['updateTask'];
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.createApprovalRecord =
      LocalEngineService.prototype['createApprovalRecord'];
    scopedService.markBatchTargetsForApprovalOutcome =
      LocalEngineService.prototype['markBatchTargetsForApprovalOutcome'];
    scopedService.collectRecentEvidenceEventIds =
      LocalEngineService.prototype['collectRecentEvidenceEventIds'];
    scopedService.buildBatchSummary = buildBatchSummary;

    const task = buildWaitingTask({
      type: 'douyin-comment-reply',
      accountId: '1',
      accountName: '抖音账号',
      platformName: '抖音',
      targetName: '候选客户',
      sourceText: '怎么加盟',
      replyText: '可以发资料。',
    });
    task.executionMode = 'browser-assisted';
    task.batchTargets = buildBatchTargets(['候选客户'], '可以发资料。');
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('no_target');
    expect(result.failureReason).toBeUndefined();
    expect(result.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '候选客户',
        status: 'no_target',
      }),
    ]);
    expect(result.batchSummary).toEqual(
      expect.objectContaining({ failed: 0, noTarget: 1 }),
    );
    expect(result.nextAction).toContain('未找到目标评论');
  });

  it('keeps a confirmed desktop send failure failed instead of completing the target', async () => {
    const scopedService = makeApprovalService();
    scopedService.runWechatDesktopCommand = jest.fn(async () => {
      throw new Error(
        '朋友圈评论发送未通过真实可见回读校验，已阻断，避免把未发出的评论记为完成。',
      );
    });
    scopedService.isDesktopInteractionTask =
      LocalEngineService.prototype['isDesktopInteractionTask'];
    scopedService.setTaskStep = LocalEngineService.prototype['setTaskStep'];
    scopedService.updateTask = LocalEngineService.prototype['updateTask'];
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.createApprovalRecord =
      LocalEngineService.prototype['createApprovalRecord'];
    scopedService.markBatchTargetsForApprovalOutcome =
      LocalEngineService.prototype['markBatchTargetsForApprovalOutcome'];
    scopedService.collectRecentEvidenceEventIds =
      LocalEngineService.prototype['collectRecentEvidenceEventIds'];
    scopedService.buildBatchSummary = buildBatchSummary;

    const task = buildWaitingTask({
      type: 'wechat-moments-marketing',
      accountId: 'local-wechat-desktop',
      accountName: '本机微信',
      platformName: '微信',
      targetName: '朋友圈第 1 条',
      sourceText: '朋友圈评论验收',
      replyText: 'Kaypal朋友圈评论阻断验证，请忽略。',
    });
    task.executionMode = 'browser-assisted';
    task.batchTargets = buildBatchTargets(
      ['朋友圈第 1 条'],
      'Kaypal朋友圈评论阻断验证，请忽略。',
    );
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('朋友圈营销没有任何对象处理成功');
    expect(result.failureReason).toContain('未通过真实可见回读校验');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '朋友圈第 1 条',
        status: 'failed',
      }),
    ]);
    expect(result.batchSummary).toEqual(
      expect.objectContaining({ completed: 0, failed: 1, noTarget: 0 }),
    );
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: expect.stringContaining('未通过真实可见回读校验'),
        }),
      ]),
    );
  });

  it('accepts synthetic random moments target proof when comment text is visible', () => {
    const scopedService = makeApprovalService();

    expect(() =>
      scopedService.assertWechatDesktopResultProof({
        taskType: 'wechat-moments-marketing',
        target: '朋友圈第 1 条',
        expectedText: '这条内容不错',
        result: {
          screenshotPath: '/tmp/moments-random.png',
          reply: '这条内容不错',
          readText: '已点赞，评论：这条内容不错',
          message: '随机朋友圈已处理。',
          status: 'sent',
        },
      }),
    ).not.toThrow();
  });

  it('builds Windows chat session entries from synced contact cache', async () => {
    const scopedService = makeApprovalService();
    scopedService.buildWindowsWechatChatHistoryFromContacts =
      LocalEngineService.prototype['buildWindowsWechatChatHistoryFromContacts'];
    scopedService.readWechatContactsCache = jest.fn(async () => ({
      source: 'windows-wechat-uia',
      items: [
        {
          wxid: 'wxid_a',
          nickname: '客户A',
          remark: '',
          tags: ['老客户'],
          syncedAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
          createdAt: '2026-06-15T00:00:00.000Z',
        },
      ],
      syncedAt: '2026-06-15T00:00:00.000Z',
    }));
    scopedService.getWechatContactDisplay =
      LocalEngineService.prototype['getWechatContactDisplay'];
    scopedService.normalizeWechatChatHistoryCache =
      LocalEngineService.prototype['normalizeWechatChatHistoryCache'];
    scopedService.normalizeWechatChatHistorySource =
      LocalEngineService.prototype['normalizeWechatChatHistorySource'];
    scopedService.normalizeWechatChatSession =
      LocalEngineService.prototype['normalizeWechatChatSession'];
    scopedService.normalizeWechatChatMessage =
      LocalEngineService.prototype['normalizeWechatChatMessage'];
    scopedService.normalizeWechatMessageDirection =
      LocalEngineService.prototype['normalizeWechatMessageDirection'];
    scopedService.normalizeWechatMessageContentType =
      LocalEngineService.prototype['normalizeWechatMessageContentType'];

    const result =
      await scopedService.buildWindowsWechatChatHistoryFromContacts({
        source: 'empty',
        sessions: [],
        messages: [],
        blockers: ['old blocker'],
        warnings: [],
      });

    expect(result.source).toBe('windows-wechat-contact-cache');
    expect(result.blockers).toEqual([]);
    expect(result.sessions).toEqual([
      expect.objectContaining({
        id: 'contact:wxid_a',
        title: '客户A',
        source: 'windows-wechat-contact-cache',
      }),
    ]);
    expect(result.warnings.join('\n')).toContain(
      'Windows 当前先用联系人库生成会话列表',
    );
  });

  it('blocks Windows chat history sync when only contact-cache sessions are available', async () => {
    const scopedService = makeApprovalService();
    scopedService.getRuntimePlatform = jest.fn(() => 'win32');
    scopedService.getProjectRoot = jest.fn(() => '/tmp/kaypal-ai-content');
    scopedService.readWechatChatHistoryCache = jest.fn(async () => ({
      source: 'empty',
      sessions: [],
      messages: [],
      blockers: [],
      warnings: [],
    }));
    scopedService.writeWechatChatHistoryCache = jest.fn(async () => undefined);
    scopedService.readWechatContactsCache = jest.fn(async () => ({
      source: 'windows-wechat-uia',
      items: [
        {
          wxid: 'wxid_a',
          nickname: '客户A',
          remark: '',
          tags: [],
          syncedAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
          createdAt: '2026-06-15T00:00:00.000Z',
        },
      ],
      syncedAt: '2026-06-15T00:00:00.000Z',
    }));

    const result = await scopedService.syncWechatChatHistory({ force: true });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.errorCode).toBe('not_integrated');
    expect(result.sessions).toEqual([
      expect.objectContaining({
        id: 'contact:wxid_a',
        source: 'windows-wechat-contact-cache',
      }),
    ]);
    expect(result.blockers.join('\n')).toContain('无法读取聊天正文');
    expect(result.nextAction).toContain('真实微信 DB');
    expect(scopedService.writeWechatChatHistoryCache).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'windows-wechat-contact-cache',
        blockers: expect.arrayContaining([
          expect.stringContaining('无法读取聊天正文'),
        ]),
      }),
    );
  });

  it('keeps runtime blockers visible on failed browser-assisted tasks', async () => {
    const scopedService = makeApprovalService();
    const execute = jest.fn(async () => ({
      ok: false,
      status: 'failed',
      reasonCode: 'send_failed',
      userMessage: '朋友圈营销没有任何对象处理成功：失败 1 个。',
      blockers: [
        '朋友圈第 1 条: 朋友圈评论发送未通过真实可见回读校验，已阻断。',
      ],
      runtime: { mode: 'local-runtime', executor: 'desktop-agent-s' },
      evidence: [
        {
          type: 'screenshot',
          label: '朋友圈评论阻断证据',
          path: '/tmp/wechat-moments-comment-blocked.png',
          createdAt: '2026-06-15T00:00:01.000Z',
        },
      ],
    }));
    scopedService.runtimeOrchestrator = { execute };
    scopedService.browserInteractionQueues = new Map();
    scopedService.setTaskStep = LocalEngineService.prototype['setTaskStep'];
    scopedService.updateTask = LocalEngineService.prototype['updateTask'];
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.markQueuedBatchTargets =
      LocalEngineService.prototype['markQueuedBatchTargets'];
    scopedService.collectRecentEvidenceEventIds =
      LocalEngineService.prototype['collectRecentEvidenceEventIds'];
    scopedService.buildBatchSummary = buildBatchSummary;
    scopedService.isRuntimeAccountEntryBlocker =
      LocalEngineService.prototype['isRuntimeAccountEntryBlocker'];
    scopedService.runBrowserAssistedTaskWithQueue =
      LocalEngineService.prototype['runBrowserAssistedTaskWithQueue'];
    scopedService.resolveExecutionContract = jest.fn(() => ({ ok: true }));
    scopedService.preflightBrowserTaskViaRuntime = jest.fn(async () => ({
      ok: true,
      message: 'runtime ready',
      blockers: [],
    }));
    scopedService.ensureBrowserInteractionTarget = jest.fn(async () => true);
    scopedService.markPreparedBrowserInteractionSteps = jest.fn();

    const task = buildWaitingTask({
      type: 'wechat-moments-marketing',
      accountId: 'local-wechat-desktop',
      accountName: '本机微信',
      platformName: '微信',
      targetName: '朋友圈第 1 条',
      sourceText: '朋友圈评论验收',
      replyText: 'Kaypal朋友圈评论阻断验证，请忽略。',
    });
    task.status = 'running';
    task.executionMode = 'browser-assisted';
    task.sendMode = 'auto-send';
    task.batchTargets = buildBatchTargets(
      ['朋友圈第 1 条'],
      'Kaypal朋友圈评论阻断验证，请忽略。',
    );
    scopedService.tasks.set(task.id, task);

    await scopedService.runBrowserAssistedTaskWithQueue(task.id);

    expect(task.status).toBe('failed');
    expect(task.failureReason).toContain('没有任何对象处理成功');
    expect(task.failureReason).toContain('未通过真实可见回读校验');
    expect(task.nextAction).toContain('未通过真实可见回读校验');
    expect(task.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '朋友圈第 1 条',
        status: 'failed',
        nextAction: expect.stringContaining('未通过真实可见回读校验'),
      }),
    ]);
  });

  it('keeps per-target desktop failures on completed moments batch tasks', async () => {
    const scopedService = makeApprovalService();
    scopedService.resolveExecutionContract = jest.fn(() => ({ ok: true }));
    scopedService.isDesktopInteractionTask =
      LocalEngineService.prototype['isDesktopInteractionTask'];
    scopedService.sendApprovedWechatTask =
      LocalEngineService.prototype['sendApprovedWechatTask'];
    scopedService.runWechatDesktopCommand = jest.fn(
      async (command: string, args: string[], target: string) => {
        if (
          command === 'wechat-moments-marketing' &&
          target === '朋友圈第 2 条'
        ) {
          throw new Error('评论发送失败');
        }
        return {
          screenshotPath: '/tmp/moments-batch.png',
          target,
          contact: target,
          reply: args[1],
          readText: `${target} ${args[1]}`.trim(),
          message: '朋友圈评论已发送并回读到评论文本。',
          mode: 'auto-send',
          status: 'sent',
        };
      },
    );
    scopedService.setTaskStep = LocalEngineService.prototype['setTaskStep'];
    scopedService.updateTask = LocalEngineService.prototype['updateTask'];
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.createApprovalRecord =
      LocalEngineService.prototype['createApprovalRecord'];
    scopedService.markBatchTargetsForApprovalOutcome =
      LocalEngineService.prototype['markBatchTargetsForApprovalOutcome'];
    scopedService.markBatchTargetsByNames =
      LocalEngineService.prototype['markBatchTargetsByNames'];
    scopedService.collectRecentEvidenceEventIds =
      LocalEngineService.prototype['collectRecentEvidenceEventIds'];
    scopedService.buildBatchSummary = buildBatchSummary;

    const task = buildWaitingTask({
      type: 'wechat-moments-marketing',
      targetName: '朋友圈第 1 条',
      replyText: '评论 A',
      metadata: {
        commentMode: 'ai',
        targetComments: [
          { targetName: '朋友圈第 1 条', commentText: '评论 A' },
          { targetName: '朋友圈第 2 条', commentText: '评论 B' },
        ],
      },
      batchTargets: [
        {
          id: 'bt-1',
          targetName: '朋友圈第 1 条',
          sourceText: '目标 A',
          replyText: '评论 A',
          status: 'queued',
        },
        {
          id: 'bt-2',
          targetName: '朋友圈第 2 条',
          sourceText: '目标 B',
          replyText: '评论 B',
          status: 'queued',
        },
      ],
    });
    task.executionMode = 'browser-assisted';
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('completed');
    expect(scopedService.runWechatDesktopCommand).toHaveBeenCalledTimes(2);
    expect(result.batchSummary).toEqual(
      expect.objectContaining({
        total: 2,
        completed: 1,
        failed: 1,
        queued: 0,
      }),
    );
    expect(result.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '朋友圈第 1 条',
        status: 'completed',
      }),
      expect.objectContaining({
        targetName: '朋友圈第 2 条',
        status: 'failed',
        failureReason: '评论发送失败',
        nextAction: '评论发送失败',
      }),
    ]);
    expect(result.resultSummary).toMatchObject({
      counts: expect.objectContaining({ completed: 1, failed: 1 }),
    });
  });

  it('keeps login failure reason when diagnostics export backfills missing evidence', async () => {
    const scopedService = makeApprovalService();
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.buildTaskEvidenceIndex =
      LocalEngineService.prototype['buildTaskEvidenceIndex'];
    scopedService.collectTaskEvidence =
      LocalEngineService.prototype['collectTaskEvidence'];
    scopedService.collectRecentEvidenceEventIds =
      LocalEngineService.prototype['collectRecentEvidenceEventIds'];
    scopedService.buildTaskEvidenceIntegrity =
      LocalEngineService.prototype['buildTaskEvidenceIntegrity'];
    scopedService.ensureTaskEvidenceForExport =
      LocalEngineService.prototype['ensureTaskEvidenceForExport'];
    scopedService.shouldPreserveEvidenceIntegrityBlocker =
      LocalEngineService.prototype['shouldPreserveEvidenceIntegrityBlocker'];
    scopedService.taskNeedsBrowserEvidence =
      LocalEngineService.prototype['taskNeedsBrowserEvidence'];
    scopedService.taskNeedsDesktopEvidence =
      LocalEngineService.prototype['taskNeedsDesktopEvidence'];
    scopedService.markQueuedBatchTargets = jest.fn();

    const task = buildWaitingTask({
      type: 'douyin-comment-reply',
      accountId: '1',
      accountName: '抖音账号',
      platformName: '抖音',
      targetName: '候选客户',
      sourceText: '怎么加盟',
      replyText: '可以发资料。',
    });
    task.status = 'failed';
    task.statusLabel = '执行失败';
    task.failureReason = '需要登录';
    task.nextAction = '请先在浏览器中完成抖音账号登录。';
    task.riskPolicy = {
      level: 'medium',
      allowed: true,
      checks: [],
      generatedAt: '2026-06-15T00:00:00.000Z',
    } as any;
    task.events.push({
      id: 'event-existing',
      level: 'info',
      message: '读取抖音评论入口',
      createdAt: '2026-06-15T00:00:01.000Z',
      evidence: {
        type: 'screenshot',
        label: '抖音登录页截图',
        value: '/tmp/douyin-login.png',
        artifactUrl: '/tmp/douyin-login.png',
        stageKey: 'target-read',
      },
    });

    await scopedService.ensureTaskEvidenceForExport(task, 'diagnostics-export');

    expect(task.status).toBe('failed');
    expect(task.failureReason).toBe('需要登录');
    expect(task.nextAction).toBe('请先在浏览器中完成抖音账号登录。');
    expect(scopedService.markQueuedBatchTargets).not.toHaveBeenCalled();
    expect(
      task.events.some(
        (event) =>
          event.level === 'warning' && event.message.includes('证据链不完整'),
      ),
    ).toBe(true);
  });

  it('does not turn completed business targets into failed records during evidence export', async () => {
    const scopedService = makeApprovalService();
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.pushEvent = LocalEngineService.prototype['pushEvent'];
    scopedService.buildTaskEvidenceIndex =
      LocalEngineService.prototype['buildTaskEvidenceIndex'];
    scopedService.collectTaskEvidence =
      LocalEngineService.prototype['collectTaskEvidence'];
    scopedService.collectRecentEvidenceEventIds =
      LocalEngineService.prototype['collectRecentEvidenceEventIds'];
    scopedService.buildTaskEvidenceIntegrity =
      LocalEngineService.prototype['buildTaskEvidenceIntegrity'];
    scopedService.ensureTaskEvidenceForExport =
      LocalEngineService.prototype['ensureTaskEvidenceForExport'];
    scopedService.shouldPreserveEvidenceIntegrityBlocker =
      LocalEngineService.prototype['shouldPreserveEvidenceIntegrityBlocker'];
    scopedService.shouldPreserveCompletedBusinessResult =
      LocalEngineService.prototype['shouldPreserveCompletedBusinessResult'];
    scopedService.taskNeedsBrowserEvidence =
      LocalEngineService.prototype['taskNeedsBrowserEvidence'];
    scopedService.taskNeedsDesktopEvidence =
      LocalEngineService.prototype['taskNeedsDesktopEvidence'];
    scopedService.markQueuedBatchTargets = jest.fn();

    const task = buildWaitingTask({
      type: 'wechat-contact-add',
      targetName: '用户1196170837',
      sourceText: '好友申请对象',
      replyText: 'Kaypal加好友真实验收，请忽略。',
      batchTargets: buildBatchTargets(
        ['用户1196170837'],
        'Kaypal加好友真实验收，请忽略。',
      ).map((target) => ({
        ...target,
        status: 'completed',
        nextAction: '自动加好友完成：成功 1，失败 0。',
      })),
    });
    task.status = 'completed';
    task.statusLabel = '已完成';
    task.executionMode = 'browser-assisted';
    task.riskPolicy = {
      level: 'high',
      allowed: true,
      checks: [],
      generatedAt: '2026-06-15T00:00:00.000Z',
    } as any;
    task.batchSummary = {
      total: 1,
      completed: 1,
      failed: 0,
      queued: 0,
      running: 0,
      skipped: 0,
      noTarget: 0,
      waitingConfirmation: 0,
    };
    task.nextAction = '自动加好友完成：成功 1，失败 0。';

    await scopedService.ensureTaskEvidenceForExport(task, 'records-export');

    expect(task.status).toBe('completed');
    expect(task.failureReason).toBeUndefined();
    expect(task.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '用户1196170837',
        status: 'completed',
      }),
    ]);
    expect(task.batchSummary).toEqual(
      expect.objectContaining({ completed: 1, failed: 0 }),
    );
    expect(scopedService.markQueuedBatchTargets).not.toHaveBeenCalled();
    expect(
      task.events.some(
        (event) =>
          event.level === 'warning' && event.message.includes('证据链不完整'),
      ),
    ).toBe(true);
  });

  it('repairs historical evidence-only failed parent records when every target completed', () => {
    const scopedService = makeApprovalService();
    scopedService.resolveStatusLabel =
      LocalEngineService.prototype['resolveStatusLabel'];
    scopedService.buildBatchSummary = buildBatchSummary;
    scopedService.shouldPreserveCompletedBusinessResult =
      LocalEngineService.prototype['shouldPreserveCompletedBusinessResult'];
    scopedService.repairEvidenceIntegrityOnlyFailureTask =
      LocalEngineService.prototype['repairEvidenceIntegrityOnlyFailureTask'];

    const task = buildWaitingTask({
      type: 'wechat-channel-direct-message-reply',
      accountId: '4',
      accountName: '杨宏宇',
      platformName: '视频号',
      targetName: '大壮',
      sourceText: '你好在吗',
      replyText: '大壮你好，我在的。',
      batchTargets: buildBatchTargets(['大壮'], '大壮你好，我在的。').map(
        (target) => ({
          ...target,
          status: 'completed',
          nextAction: '已完成，可在任务证据里查看发送和回读结果。',
        }),
      ),
    });
    task.status = 'failed';
    task.statusLabel = '失败';
    task.failureReason =
      '证据链不完整：缺少证据项、缺少阶段日志、缺少 nextAction';
    task.nextAction =
      '导出证据链不完整，已标记 FAILED；请重新执行任务并确认阶段日志、确认记录和平台证据已生成。';
    task.resultSummary = {
      kind: 'failure',
      counts: {
        total: 1,
        completed: 1,
        failed: 0,
        skipped: 0,
        noTarget: 0,
      },
      detail: '证据链不完整：缺少证据项、缺少阶段日志、缺少 nextAction',
      headline: '失败 1/1',
      nextAction:
        '导出证据链不完整，已标记 FAILED；请重新执行任务并确认阶段日志、确认记录和平台证据已生成。',
      recordsHref: '/interaction/records?taskId=task-1',
      evidenceHref: '/local-engine?tab=evidence&taskId=task-1',
      evidenceCount: 8,
      diagnosticsHref: '/local-engine?tab=evidence&taskId=task-1&diagnostics=1',
    };
    task.batchSummary = {
      total: 1,
      completed: 1,
      failed: 0,
      queued: 0,
      running: 0,
      skipped: 0,
      noTarget: 0,
      waitingConfirmation: 0,
    };

    const repaired = scopedService.repairEvidenceIntegrityOnlyFailureTask(task);

    expect(repaired).toBe(true);
    expect(task.status).toBe('completed');
    expect(task.failureReason).toBeUndefined();
    expect(task.batchSummary).toEqual(
      expect.objectContaining({ completed: 1, failed: 0 }),
    );
    expect(task.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '大壮',
        status: 'completed',
        failureReason: undefined,
      }),
    ]);
  });

  it('continues a confirmed group broadcast with limit and interval', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-group-broadcast',
      targetName: '客户A、客户B、客户C',
      replyText: '群发文案',
      metadata: {
        dailyLimit: 2,
        intervalSeconds: 8,
      },
      batchTargets: buildBatchTargets(['客户A', '客户B', '客户C'], '群发文案'),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(scopedService.runWechatContactCommand).toHaveBeenCalledTimes(2);
    expect(scopedService.runWechatContactCommand).toHaveBeenNthCalledWith(
      1,
      'wechat-auto-reply',
      '客户A',
      '群发文案',
      'auto-send',
      { attachmentPaths: [] },
    );
    expect(scopedService.runWechatContactCommand).toHaveBeenNthCalledWith(
      2,
      'wechat-auto-reply',
      '客户B',
      '群发文案',
      'auto-send',
      { attachmentPaths: [] },
    );
    expect(scopedService.delay).toHaveBeenCalledWith(8000);
    expect(result.status).toBe('completed');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({ targetName: '客户A', status: 'completed' }),
      expect.objectContaining({ targetName: '客户B', status: 'completed' }),
      expect.objectContaining({ targetName: '客户C', status: 'queued' }),
    ]);
    expect(result.nextAction).toContain('还有 1 个对象待继续');
  });

  it('blocks approved group broadcast when current WeChat account differs from the planned account', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-group-broadcast',
      targetName: '客户A',
      replyText: '群发文案',
      associatedWeChat: 'seller-planned',
      metadata: {
        associatedWeChat: 'seller-planned',
        currentWechatId: 'seller-current',
      },
      batchTargets: buildBatchTargets(['客户A'], '群发文案'),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(scopedService.runWechatContactCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('微信号保护阻断');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'send-result',
          status: 'blocked',
          message: expect.stringContaining('微信号保护阻断'),
        }),
      ]),
    );
  });

  it('blocks approved group broadcast when current WeChat account is unreadable', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-group-broadcast',
      targetName: '客户A',
      replyText: '群发文案',
      associatedWeChat: 'seller-planned',
      metadata: {
        associatedWeChat: 'seller-planned',
      },
      batchTargets: buildBatchTargets(['客户A'], '群发文案'),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(scopedService.runWechatContactCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('当前微信号不可读取');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'send-result',
          status: 'blocked',
          message: expect.stringContaining('当前微信号不可读取'),
        }),
      ]),
    );
  });

  it('fails group broadcast when desktop command returns only a screenshot without target readback', async () => {
    const scopedService = makeApprovalService();
    scopedService.runWechatContactCommand = jest.fn(async () => ({
      screenshotPath: '/tmp/sent.png',
    }));
    const task = buildWaitingTask({
      type: 'wechat-group-broadcast',
      targetName: '客户A',
      replyText: '群发文案',
      batchTargets: buildBatchTargets(['客户A'], '群发文案'),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('缺少目标/回读文本');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({ targetName: '客户A', status: 'failed' }),
    ]);
  });

  it('continues confirmed contact add with daily limit and blacklist', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-contact-add',
      targetName: '客户A、客户B、客户C',
      replyText: '你好，想了解一下需求。',
      metadata: {
        dailyLimit: 1,
        blacklist: ['客户B'],
      },
      batchTargets: buildBatchTargets(
        ['客户A', '客户B', '客户C'],
        '你好，想了解一下需求。',
      ),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(scopedService.runWechatContactCommand).toHaveBeenCalledTimes(1);
    expect(scopedService.runWechatContactCommand).toHaveBeenCalledWith(
      'wechat-contact-add',
      '客户A',
      '你好，想了解一下需求。',
      'auto-send',
      { remarkStrategy: 'none', remarkContent: '' },
    );
    expect(result.status).toBe('completed');
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'success',
          message: expect.stringContaining('跳过 1 个，待执行 1 个'),
        }),
      ]),
    );
    expect(result.batchTargets).toEqual([
      expect.objectContaining({ targetName: '客户A', status: 'completed' }),
      expect.objectContaining({
        targetName: '客户B',
        status: 'skipped',
        failureReason: '已按计划规则跳过本次执行。',
      }),
      expect.objectContaining({ targetName: '客户C', status: 'queued' }),
    ]);
    expect(result.batchSummary).toEqual(
      expect.objectContaining({
        total: 3,
        completed: 1,
        failed: 0,
        skipped: 1,
        queued: 1,
      }),
    );
    expect(result.nextAction).toContain('跳过 1 个对象');
    expect(result.nextAction).toContain('还有 1 个对象待继续');
  });

  it('keeps contact add per-target failures recoverable when later targets fail', async () => {
    const scopedService = makeApprovalService();
    scopedService.runWechatContactCommand = jest.fn(
      async (
        _command: string,
        target: string,
        message: string,
        mode: string,
      ) => {
        if (target === '客户B') {
          throw new Error('好友申请按钮不可用');
        }
        return {
          screenshotPath: '/tmp/contact-add.png',
          target,
          reply: message,
          readText: `${target} ${message}`,
          mode,
          status: 'sent',
        };
      },
    );
    const task = buildWaitingTask({
      type: 'wechat-contact-add',
      targetName: '客户A、客户B',
      replyText: '你好，想了解一下需求。',
      metadata: {
        dailyLimit: 2,
        minIntervalSeconds: 1,
        maxIntervalSeconds: 1,
      },
      batchTargets: buildBatchTargets(
        ['客户A', '客户B'],
        '你好，想了解一下需求。',
      ),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('completed');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({ targetName: '客户A', status: 'completed' }),
      expect.objectContaining({
        targetName: '客户B',
        status: 'failed',
        failureReason: '好友申请按钮不可用',
      }),
    ]);
    expect(result.batchSummary).toEqual(
      expect.objectContaining({ completed: 1, failed: 1 }),
    );
    expect(result.nextAction).toContain('失败 1 个对象');
  });

  it('marks contact add as no_target when desktop WeChat cannot open an add-friend form', async () => {
    const scopedService = makeApprovalService();
    scopedService.isWechatNoTargetMessage =
      LocalEngineService.prototype['isWechatNoTargetMessage'];
    scopedService.toWechatDesktopCommandError =
      LocalEngineService.prototype['toWechatDesktopCommandError'];
    scopedService.runWechatContactCommand = jest.fn(async () => {
      const error = new Error(
        '未进入好友申请页面，可能没有找到可添加对象或目标已是联系人。',
      );
      error.name = 'WechatDesktopCommandError';
      (error as any).result = {
        screenshotPath: '/tmp/no-target.png',
        status: 'failed',
      };
      throw error;
    });
    const task = buildWaitingTask({
      type: 'wechat-contact-add',
      targetName: '用户1196170837',
      replyText: 'Kaypal加好友测试，请忽略。',
      batchTargets: buildBatchTargets(
        ['用户1196170837'],
        'Kaypal加好友测试，请忽略。',
      ),
    });
    task.sendMode = 'auto-send';
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('no_target');
    expect(result.failureReason).toBeUndefined();
    expect(result.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '用户1196170837',
        status: 'no_target',
      }),
    ]);
    expect(result.batchSummary).toEqual(
      expect.objectContaining({ noTarget: 1, failed: 0 }),
    );
    expect(result.nextAction).toContain('未成为好友');
  });

  it('marks auto-send desktop contact add runtime no target as no_target', async () => {
    const scopedService = makeApprovalService();
    scopedService.resolveExecutionContract = jest.fn(async () => ({
      ok: true,
    }));
    scopedService.autoSendReplyViaRuntime = jest.fn(async () => ({
      ok: false,
      status: 'comment_missing',
      message: '自动加好友没有可处理对象：1 个对象不可添加或已是联系人。',
      nextAction:
        '自动加好友目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
      evidence: {
        type: 'screenshot',
        label: '微信加好友无可添加对象',
        value: '/tmp/no-target-runtime.png',
        artifactUrl: '/tmp/no-target-runtime.png',
      },
    }));
    scopedService.isDesktopInteractionTask =
      LocalEngineService.prototype['isDesktopInteractionTask'];
    const task = buildWaitingTask({
      type: 'wechat-contact-add',
      targetName: '用户1196170837',
      replyText: 'Kaypal加好友测试，请忽略。',
      batchTargets: buildBatchTargets(
        ['用户1196170837'],
        'Kaypal加好友测试，请忽略。',
      ),
    });
    task.status = 'running';
    task.sendMode = 'auto-send';
    scopedService.tasks.set(task.id, task);

    await scopedService.preflightDesktopInteractionTask(task);

    expect(task.status).toBe('no_target');
    expect(task.failureReason).toBeUndefined();
    expect(task.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '用户1196170837',
        status: 'no_target',
      }),
    ]);
    expect(task.batchSummary).toEqual(
      expect.objectContaining({ noTarget: 1, failed: 0 }),
    );
    expect(scopedService.persistTask).toHaveBeenCalledWith(task);
  });

  it('continues confirmed moments publish through the moments command', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-moments-publish',
      targetName: '朋友圈发布计划',
      replyText: '今天新品上线。',
      metadata: {
        content: '今天新品上线。',
        assetPath: '/tmp/poster.png',
      },
      batchTargets: buildBatchTargets(
        ['朋友圈发布 1', '朋友圈发布 2'],
        '今天新品上线。',
      ),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(scopedService.runWechatDesktopCommand).toHaveBeenCalledWith(
      'wechat-moments-publish',
      ['今天新品上线。', 'auto-send', '/tmp/poster.png', '', 'public'],
      '朋友圈发布 1',
      150000,
    );
    expect(result.status).toBe('completed');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({
        targetName: '朋友圈发布 1',
        status: 'completed',
      }),
      expect.objectContaining({ targetName: '朋友圈发布 2', status: 'queued' }),
    ]);
  });

  it('fails moments publish when the desktop command cannot prove the published content', async () => {
    const scopedService = makeApprovalService();
    scopedService.runWechatDesktopCommand = jest.fn(async () => ({
      screenshotPath: '/tmp/moments.png',
      target: '朋友圈',
      status: 'sent',
    }));
    const task = buildWaitingTask({
      type: 'wechat-moments-publish',
      targetName: '朋友圈发布计划',
      replyText: '今天新品上线。',
      metadata: {
        content: '今天新品上线。',
        assetPath: '/tmp/poster.png',
      },
      batchTargets: buildBatchTargets(['朋友圈发布 1'], '今天新品上线。'),
    });
    scopedService.tasks.set(task.id, task);

    const result = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );

    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('没有回读待发送/待发布文本');
    expect(result.batchTargets).toEqual([
      expect.objectContaining({ targetName: '朋友圈发布 1', status: 'failed' }),
    ]);
  });

  it('continues only remaining batch targets after a limited run', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-group-broadcast',
      targetName: '客户A、客户B、客户C',
      replyText: '群发文案',
      metadata: {
        dailyLimit: 2,
        intervalSeconds: 8,
      },
      batchTargets: buildBatchTargets(['客户A', '客户B', '客户C'], '群发文案'),
    });
    scopedService.tasks.set(task.id, task);

    const completedTask = await scopedService.approveTask(
      task.id,
      desktopApprovalInput,
    );
    scopedService.createTask = jest.fn(async (input) => ({
      ...buildWaitingTask({
        type: input.type,
        targetName: input.targetName,
        sourceText: input.sourceText,
        replyText: input.replyText,
        metadata: input.metadata,
        batchTargets: buildBatchTargets(
          input.batchTargets.map((target) => target.targetName),
          input.replyText,
        ),
      }),
      id: 'continued-task',
      ...input,
    }));
    const nextTask = await scopedService.continueTask(completedTask.id);

    expect(nextTask.id).not.toBe(completedTask.id);
    expect(scopedService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'wechat-group-broadcast',
        targetName: '客户C',
        batchTargets: [
          expect.objectContaining({
            targetName: '客户C',
          }),
        ],
      }),
    );
    expect(nextTask.batchTargets?.map((target) => target.targetName)).toEqual([
      '客户C',
    ]);
    expect(nextTask.metadata).toEqual(
      expect.objectContaining({
        continueOfTaskId: completedTask.id,
      }),
    );
  });

  it('returns group broadcast plan detail list with plan fields', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-group-broadcast',
      targetName: '客户A、客户B',
      replyText: '群发文案',
      batchTargets: buildBatchTargets(['客户A', '客户B'], '群发文案'),
    });
    task.planName = '618 老客群发';
    task.planTime = '2026-06-18 10:00';
    task.planStatus = 'scheduled';
    scopedService.tasks.set(task.id, task);

    const detailList = await scopedService.getGroupBroadcastPlanDetails(
      task.id,
    );

    expect(detailList).toEqual(
      expect.objectContaining({
        taskId: task.id,
        planName: '618 老客群发',
        planStatus: 'scheduled',
        summary: expect.objectContaining({ total: 2 }),
        items: [
          expect.objectContaining({ targetName: '客户A' }),
          expect.objectContaining({ targetName: '客户B' }),
        ],
      }),
    );
  });

  it('creates an edited immediate resend task for selected group targets', async () => {
    const scopedService = makeApprovalService();
    const task = buildWaitingTask({
      type: 'wechat-group-broadcast',
      targetName: '客户A、客户B',
      replyText: '旧群发文案',
      metadata: {
        dailyLimit: 2,
      },
      batchTargets: buildBatchTargets(['客户A', '客户B'], '旧群发文案'),
    });
    task.planName = '老客群发';
    task.dailyLimit = 2;
    scopedService.tasks.set(task.id, task);
    scopedService.createTask = jest.fn(async (input) => ({
      ...buildWaitingTask({
        type: input.type,
        targetName: input.targetName,
        replyText: input.replyText || '',
        metadata: input.metadata,
        batchTargets: buildBatchTargets(
          input.batchTargets?.map((target) => target.targetName || '') || [],
          input.replyText || '',
        ),
      }),
      id: 'resend-task',
      ...input,
      events: [],
    }));

    const resendTask = await scopedService.resendGroupBroadcastPlan(task.id, {
      immediate: true,
      targetNames: ['客户B'],
      replyText: '编辑后的群发文案',
      planName: '老客群发-重发',
      riskConfirmation: buildRiskConfirmation(),
    });

    expect(scopedService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'wechat-group-broadcast',
        sendMode: 'auto-send',
        targetName: '客户B',
        replyText: '编辑后的群发文案',
        planName: '老客群发-重发',
        metadata: expect.objectContaining({
          resendOfPlanId: task.id,
          retryOfTaskId: task.id,
        }),
        batchTargets: [
          expect.objectContaining({
            targetName: '客户B',
            replyText: '编辑后的群发文案',
          }),
        ],
      }),
    );
    expect(resendTask.id).toBe('resend-task');
  });

  it('does not pick Douyin text-node conversation names as direct-message reply targets', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.normalizeStringList = (values: unknown) =>
      Array.isArray(values) ? values : [];
    scopedService.isPlaceholderInteractionText =
      LocalEngineService.prototype['isPlaceholderInteractionText'];
    scopedService.cleanReadableInteractionText =
      LocalEngineService.prototype['cleanReadableInteractionText'];

    const selected = scopedService.pickReadableInteractionCandidate(
      [
        {
          text: '老李会员资料共享群4️⃣',
          source: 'text-node',
          context: '老李会员资料共享群4️⃣',
        },
        {
          text: '嗨！是在留意那些能锁定结果的GEO数据吗？',
          source: 'message-preview',
          context:
            '陌生人消息 06-14 斑马T7(全国多届AI冠军团队): 嗨！是在留意那些能锁定结果的GEO数据吗？',
          contactName: '斑马T7(全国多届AI冠军团队)',
        },
      ],
      {
        type: 'douyin-direct-message-reply',
        sourceText: '等待本机读取真实对象。',
        replyText: '',
      } as InteractionTask,
    );

    expect(selected).toEqual(
      expect.objectContaining({
        text: '嗨！是在留意那些能锁定结果的GEO数据吗？',
      }),
    );
  });

  it('removes billing identity secrets from task display payloads', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    const task = buildWaitingTask({
      type: 'wechat-reply-draft',
      replyText: '您好，可以继续沟通。',
    }) as InteractionTask & {
      billingIdentity?: {
        localUserId: string;
        kaypalUserId: string;
        kaypalDesktopAccessToken: string;
        kaypalDesktopRefreshToken: string;
        capturedAt: string;
      };
    };
    task.billingIdentity = {
      localUserId: 'local-user-1',
      kaypalUserId: 'cloud-user-1',
      kaypalDesktopAccessToken: 'secret-access-token',
      kaypalDesktopRefreshToken: 'secret-refresh-token',
      capturedAt: '2026-06-29T00:00:00.000Z',
    };

    const displayTask = LocalEngineService.prototype[
      'normalizeTaskForDisplay'
    ].call(scopedService, task);
    const serialized = JSON.stringify(displayTask);

    expect(displayTask).not.toHaveProperty('billingIdentity');
    expect(serialized).not.toContain('secret-access-token');
    expect(serialized).not.toContain('secret-refresh-token');
  });

  it('captures only session and account identifiers for task billing identity', () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.authRequestContext = {
      get: jest.fn(() => ({
        sessionId: 'session-1',
        user: {
          id: 'local-user-1',
          kaypalUserId: 'cloud-user-1',
          kaypalDesktopAccessToken: 'secret-access-token',
          kaypalDesktopRefreshToken: 'secret-refresh-token',
          kaypalDesktopDeviceId: 'device-1',
          kaypalDesktopTokenExpiresAt: '2026-06-29T00:30:00.000Z',
          kaypalPlan: 'ADVANCED',
          commercialExecutionAllowed: true,
          planMode: 'commercial',
        },
      })),
    };

    const identity =
      LocalEngineService.prototype[
        'buildCurrentInteractionTaskBillingIdentity'
      ].call(scopedService);
    const serialized = JSON.stringify(identity);

    expect(identity).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        localUserId: 'local-user-1',
        kaypalUserId: 'cloud-user-1',
        kaypalDesktopDeviceId: 'device-1',
      }),
    );
    expect(serialized).not.toContain('secret-access-token');
    expect(serialized).not.toContain('secret-refresh-token');
  });

  it('downgrades missing AI model tables to a run-check warning', async () => {
    const scopedService = Object.create(LocalEngineService.prototype) as any;
    scopedService.prisma = {
      defaultModelConfig: {
        findMany: jest
          .fn()
          .mockRejectedValue(
            new Error(
              'Invalid `prisma.defaultModelConfig.findMany()` invocation: The table `main.default_model_configs` does not exist in the current database.',
            ),
          ),
      },
    };
    scopedService.kaypalModelSync = null;
    scopedService.isPrismaTableMissingError =
      LocalEngineService.prototype['isPrismaTableMissingError'];
    scopedService.withKaypalModelSyncHint =
      LocalEngineService.prototype['withKaypalModelSyncHint'];

    const result = await scopedService.checkAiReplyModelConfig();

    expect(result).toEqual(
      expect.objectContaining({
        status: 'warning',
        summary: expect.stringContaining('微信本机任务可继续'),
      }),
    );
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '默认模型配置读取',
          status: 'warning',
        }),
      ]),
    );
  });
});
