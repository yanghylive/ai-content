import { ConfigService } from '@nestjs/config';
import { existsSync, rmSync } from 'node:fs';
import { LocalInteractionExecutorService } from './local-interaction-executor.service';
import { LocalEngineService } from './local-engine.service';

describe('LocalEngineService', () => {
  const readyAccounts = [
    {
      id: 2,
      type: 2,
      platform: '微信',
      filePath: '/tmp/wechat.json',
      userName: '微信账号',
      profileName: '微信账号',
      avatarPath: null,
      avatarUrl: null,
      status: 1,
      statusLabel: '正常',
    },
    {
      id: 12,
      type: 3,
      platform: '抖音',
      filePath: '/tmp/douyin-comment.json',
      userName: '抖音账号',
      profileName: '抖音账号',
      avatarPath: null,
      avatarUrl: null,
      status: 1,
      statusLabel: '正常',
    },
    {
      id: 13,
      type: 3,
      platform: '抖音',
      filePath: '/tmp/douyin-message.json',
      userName: '抖音私信号',
      profileName: '抖音私信号',
      avatarPath: null,
      avatarUrl: null,
      status: 1,
      statusLabel: '正常',
    },
  ];

  const fullInteractionCapabilities = {
    service: 'auto-upload',
    version: 'test',
    checkedAt: new Date().toISOString(),
    supportedTaskTypes: [
      {
        key: 'douyin-comment-reply',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        stages: ['entry-preflight', 'target-read', 'draft-fill'],
        controlledSend: true,
        evidence: ['snapshot', 'screenshot'],
      },
      {
        key: 'douyin-direct-message-reply',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-direct-message-reply',
        stages: ['entry-preflight', 'target-read', 'draft-fill'],
        controlledSend: true,
        evidence: ['snapshot', 'screenshot'],
      },
      {
        key: 'wechat-reply-draft',
        platformType: 2,
        platformName: '微信',
        entryType: 'wechat-reply-draft',
        stages: ['entry-preflight'],
        controlledSend: false,
        evidence: ['desktop'],
      },
      {
        key: 'wechat-group-broadcast',
        platformType: 2,
        platformName: '微信',
        entryType: 'wechat-group-broadcast',
        stages: ['entry-preflight'],
        controlledSend: false,
        evidence: ['desktop'],
      },
      {
        key: 'wechat-moments-publish',
        platformType: 2,
        platformName: '微信',
        entryType: 'wechat-moments-publish',
        stages: ['entry-preflight'],
        controlledSend: false,
        evidence: ['desktop'],
      },
    ],
    evidence: {
      directory: '/tmp/evidence',
      urlPrefix: '/interaction/evidence',
      fileCount: 0,
      totalBytes: 0,
    },
    screenshotCleanup: {
      recommendation: 'ok',
      retentionDays: 7,
      maxFiles: 100,
      safePattern: '*.png',
      suggestedCommand: 'cleanup',
    },
    safetyBoundary: {
      host: 'local',
      network: 'local',
      dataLocality: 'local',
      browserAutomation: 'manual',
      sendPolicy: 'draft only',
      pathAccess: [],
    },
  };

  const readyWechatDesktopStatus = {
    platform: 'wechat',
    available: true,
    running: true,
    appName: '微信',
    windowCount: 1,
    currentWindowTitle: '张先生',
    frontmost: true,
    windowTitles: ['张先生'],
    screenshotAvailable: true,
    inputControlAvailable: true,
    clickControlAvailable: true,
    fileSelectionAvailable: true,
    permissionHints: [],
    requiresManualTarget: true,
    safetyBoundary: {
      draftOnly: true,
      readsPrivateChats: false,
      readsContacts: false,
      sendsMessages: false,
      targeting: 'manual',
      manualSteps: [],
    },
    message: '微信窗口已识别',
  };

  function createInteractionExecutor(autoUploadService: any) {
    return new LocalInteractionExecutorService(
      autoUploadService,
      {
        generate: jest.fn().mockRejectedValue(new Error('AI not available')),
      } as any,
      { getDefaults: jest.fn().mockResolvedValue({}) } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );
  }

  function listReadyAccounts() {
    return jest.fn(async (options?: { ids?: number[] }) => {
      if (options?.ids?.length) {
        return readyAccounts.filter((account) =>
          options.ids?.includes(account.id),
        );
      }
      return readyAccounts;
    });
  }

  function listReadyCdpSessions(
    sessions: Array<{ platform: string; accountId: number | string }>,
  ) {
    return jest.fn().mockResolvedValue({
      available: true,
      sessions: sessions.map((session) => ({
        ...session,
        status: 'ready',
        lastError: null,
      })),
      message: null,
    });
  }

  function mockDesktopScreenshot(service: LocalEngineService) {
    jest.spyOn(service as any, 'captureDesktopScreenshot').mockResolvedValue({
      type: 'text',
      label: '测试桌面截图',
      value: 'mock-desktop-screenshot',
      capturedAt: new Date().toISOString(),
    });
  }

  function createPrismaMock(opts?: {
    taskRows?: any[];
    ruleRows?: any[];
    sessionRows?: any[];
    confirmationRows?: any[];
    defaultModelRows?: any[];
    aiModelRows?: any[];
  }) {
    const taskRows: any[] = opts?.taskRows ?? [];
    const ruleRows: any[] = opts?.ruleRows ?? [];
    const sessionRows: any[] = opts?.sessionRows ?? [];
    const confirmationRows: any[] = opts?.confirmationRows ?? [];
    const defaultModelRows: any[] = opts?.defaultModelRows ?? [
      {
        id: 'default-model-config-1',
        purpose: 'article_creation',
        modelId: 'ai-model-1',
      },
    ];
    const aiModelRows: any[] = opts?.aiModelRows ?? [
      {
        id: 'ai-model-1',
        name: '测试文本模型',
        modelId: 'test-model',
        enabled: true,
        platformId: 'platform-1',
        platform: {
          id: 'platform-1',
          name: '测试平台',
          baseUrl: 'http://127.0.0.1/v1',
          apiKey: 'test-key',
          enabled: true,
        },
      },
    ];
    return {
      defaultModelConfig: {
        findMany: jest.fn(async ({ where }: any = {}) => {
          const purposes = where?.purpose?.in;
          if (Array.isArray(purposes)) {
            return defaultModelRows.filter((row) =>
              purposes.includes(row.purpose),
            );
          }
          return defaultModelRows;
        }),
      },
      aIModel: {
        findMany: jest.fn(async ({ where }: any = {}) => {
          const ids = where?.id?.in;
          if (Array.isArray(ids)) {
            return aiModelRows.filter((row) => ids.includes(row.id));
          }
          return aiModelRows;
        }),
      },
      interactionTask: {
        upsert: jest.fn(async ({ create, where }: any) => {
          const idx = taskRows.findIndex((r: any) => r.id === where.id);
          if (idx >= 0) taskRows[idx] = create;
          else taskRows.push(create);
          return create;
        }),
        findMany: jest.fn(async () => taskRows),
        findUnique: jest.fn(
          async ({ where }: any) =>
            taskRows.find((r: any) => r.id === where.id) ?? null,
        ),
      },
      interactionReplyRule: {
        upsert: jest.fn(async ({ create, where }: any) => {
          const idx = ruleRows.findIndex((r: any) => r.id === where.id);
          if (idx >= 0) ruleRows[idx] = create;
          else ruleRows.push(create);
          return create;
        }),
        findUnique: jest.fn(
          async ({ where }: any) =>
            ruleRows.find((r: any) => r.id === where.id) ?? null,
        ),
      },
      agentSession: {
        upsert: jest.fn(async ({ create, where }: any) => {
          const idx = sessionRows.findIndex((r: any) => r.id === where.id);
          if (idx >= 0) sessionRows[idx] = create;
          else sessionRows.push(create);
          return create;
        }),
        findMany: jest.fn(async () => sessionRows),
        findUnique: jest.fn(
          async ({ where }: any) =>
            sessionRows.find((r: any) => r.id === where.id) ?? null,
        ),
      },
      agentConfirmation: {
        upsert: jest.fn(async ({ create, where }: any) => {
          const idx = confirmationRows.findIndex((r: any) => r.id === where.id);
          if (idx >= 0) confirmationRows[idx] = create;
          else confirmationRows.push(create);
          return create;
        }),
        findMany: jest.fn(async () => confirmationRows),
        findUnique: jest.fn(
          async ({ where }: any) =>
            confirmationRows.find((r: any) => r.id === where.id) ?? null,
        ),
      },
    };
  }

  function mockWechatExecutorReady(executor: LocalInteractionExecutorService) {
    jest.spyOn(executor, 'getStatus').mockResolvedValue({
      checkedAt: new Date().toISOString(),
      summary: {
        total: 1,
        ready: 1,
        preflightOnly: 0,
        missing: 0,
      },
      executors: [
        {
          key: 'wechat-reply-draft',
          name: '微信回复草稿',
          platformName: '微信',
          status: 'ready',
          entryPreflight: true,
          targetRead: true,
          replyGenerate: true,
          controlledSend: true,
          message: '桌面微信 preflight 已通过。',
          nextAction: '确认后只填入草稿，不自动发送。',
        },
      ],
    });
  }

  function mockDouyinExecutorReady(executor: LocalInteractionExecutorService) {
    jest.spyOn(executor, 'getStatus').mockResolvedValue({
      checkedAt: new Date().toISOString(),
      summary: {
        total: 1,
        ready: 1,
        preflightOnly: 0,
        missing: 0,
      },
      executors: [
        {
          key: 'douyin-comment-reply',
          name: '抖音评论回复',
          platformName: '抖音',
          status: 'ready',
          entryPreflight: true,
          targetRead: true,
          replyGenerate: true,
          controlledSend: true,
          message: '抖音评论执行器已就绪。',
          nextAction: '读取评论并生成回复。',
        },
      ],
    });
  }

  function createMcpRuntimeMock() {
    return {
      getStatus: jest.fn().mockResolvedValue({
        available: false,
        serverCount: 0,
        toolCount: 0,
        resourceCount: 0,
        strictMode: false,
        servers: [],
        message: 'MCP 运行时不可用：mock',
      }),
    };
  }

  function createAgentSidecarMock() {
    return {
      getStatus: jest.fn().mockResolvedValue({
        available: false,
        version: null,
        sessionProtocol: false,
        eventStream: false,
        screenshotArtifacts: false,
        executionControl: false,
        message: 'Agent-S 运行时不可用：mock',
      }),
    };
  }

  function createSandboxRuntimeMock() {
    return {
      getStatus: jest.fn().mockResolvedValue({
        available: false,
        platform: 'darwin',
        dockerAvailable: false,
        sandboxType: 'native',
        message: '沙箱运行时可用：macOS native 模式',
      }),
    };
  }

  function createPluginRuntimeMock() {
    return {
      getStatus: jest.fn().mockResolvedValue({
        available: false,
        skillDirectory: null,
        skillhubDirectory: null,
        skillhubSkills: [],
        installedSkillCount: 0,
        skillNames: [],
        runtimeApiAvailable: false,
        message: 'test',
      }),
    };
  }

  function createMemoryRuntimeMock() {
    return {
      getStatus: jest
        .fn()
        .mockResolvedValue({ available: false, message: 'test' }),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function settleInteractionLifecycle() {
    await jest.runAllTimersAsync();
  }

  async function settleBrowserAssistedLifecycle() {
    await jest.runAllTimersAsync();
  }

  it('persists created interaction tasks and hydrates them back into memory', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createTask({
      type: 'customer-follow-up',
      accountName: '测试账号',
      targetName: '测试客户',
      sourceText: '想预约明天',
      replyText: '可以，我帮您登记。',
      sendMode: 'draft-only',
    });

    const listed = await service.listTasks();

    expect(prisma.interactionTask.upsert).toHaveBeenCalled();
    expect(listed[0].id).toBe(task.id);
    expect(listed[0].targetName).toBe('测试客户');
  });

  it('hydrates stored tasks before building queue health', async () => {
    const storedTask = {
      id: 'stored-task-1',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复草稿',
      status: 'completed',
      statusLabel: '已完成',
      accountName: '测试账号',
      targetName: '测试客户',
      sourceText: '想预约明天',
      replyText: '可以，我帮您登记。',
      sendMode: 'draft-only',
      executionMode: 'internal-record',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      events: [],
    };
    const prisma = createPrismaMock({
      taskRows: [
        {
          id: storedTask.id,
          config: storedTask,
          taskType: 'WECHAT_REPLY_DRAFT',
          status: 'COMPLETED',
          updatedAt: new Date(),
        },
      ],
    });
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn().mockResolvedValue({ online: false }),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const health = await service.getHealth();

    expect(health.queue.completed).toBe(1);
  });

  it('applies editable reply rules to new interaction tasks', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const rule = await service.updateReplyRule({
      industryName: '家政服务',
      tone: 'professional',
      defaultSendMode: 'draft-only',
      askForContact: true,
      serviceHighlights: ['可上门评估'],
      requireApprovalKeywords: ['多少钱'],
      closingText: '您方便留个电话吗？我们安排顾问联系您。',
    });
    const task = await service.createTask({
      type: 'customer-follow-up',
      accountName: '抖音账号',
      targetName: '客户',
      sourceText: '保洁多少钱？',
    });

    expect(rule.industryName).toBe('家政服务');
    expect(task.sendMode).toBe('draft-only');
    expect(task.replyText).toContain('多少钱');
    expect(task.replyText).toContain('可上门评估');
    expect(task.replyText).toContain('留个电话');
    expect(
      task.events.some((event) => event.message.includes('家政服务')),
    ).toBe(true);
  });

  it('keeps wechat auto-send requests as real auto-send tasks', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest
        .fn()
        .mockResolvedValue(readyWechatDesktopStatus),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockWechatExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );
    mockDesktopScreenshot(service);

    const task = await service.createBusinessTask('wechat', {
      accountId: '2',
      accountName: '微信账号',
      platformType: 2,
      platformName: '视频号 / 微信',
      targetName: '微信客户',
      sourceText: '请发一下地址',
      replyText: '您好，地址稍后发您。',
      sendMode: 'auto-send',
    });

    expect(task.sendMode).toBe('auto-send');
    expect(task.executionMode).toBe('browser-assisted');
    expect(
      task.events.some((event) => event.message.includes('自动发送模式')),
    ).toBe(true);
    expect(
      task.events.some((event) => event.message.includes('不允许自动发送')),
    ).toBe(false);
  });

  it('keeps wechat draft tasks behind target, rate limit, manual approval, evidence, stop and takeover protections', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest
        .fn()
        .mockResolvedValue(readyWechatDesktopStatus),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockWechatExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );
    mockDesktopScreenshot(service);

    const task = await service.createBusinessTask('wechat', {
      accountId: '2',
      accountName: '微信账号',
      platformType: 2,
      platformName: '视频号 / 微信',
      targetName: '微信客户',
      sourceText: '请发一下地址',
      replyText: '您好，地址稍后发您。',
      sendMode: 'approval-send',
    });
    const preflight = await service.getDesktopCommercialPreflight();

    expect(task.requiresDoubleConfirmation).toBe(true);
    expect(task.misfireProtection).toMatchObject({
      sendProtected: true,
      targetLockRequired: true,
      contentPreviewRequired: true,
    });
    expect(task.riskChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'target', required: true }),
        expect.objectContaining({ key: 'content', required: true }),
        expect.objectContaining({ key: 'window', required: true }),
        expect.objectContaining({
          key: 'rate-limit',
          required: true,
          status: 'warning',
          hint: expect.stringContaining('每次只允许锁定一个当前会话'),
        }),
      ]),
    );
    expect(task.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: expect.objectContaining({
            type: 'stage_log',
            stageKey: 'create-task',
          }),
        }),
        expect.objectContaining({
          message: expect.stringContaining('只填入草稿'),
        }),
      ]),
    );
    expect(preflight.requiredFor).toEqual([
      'wechat-reply-draft',
      'wechat-group-broadcast',
      'wechat-moments-publish',
    ]);
    expect(preflight.takeoverReady).toBe(true);
    expect(preflight.stopReady).toBe(true);
  });

  it('locks wechat desktop session only after window contact and draft confirmations', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        windowTitles: ['张先生'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
        requiresManualTarget: true,
        safetyBoundary: {
          draftOnly: true,
          readsPrivateChats: false,
          readsContacts: false,
          sendsMessages: false,
          targeting: 'manual',
          manualSteps: [],
        },
        message: '微信窗口已识别',
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );
    mockDesktopScreenshot(service);

    const before = await service.getWechatSessionStatus();
    expect(before.canDraft).toBe(false);
    expect(before.warnings).toContain('目标联系人为空，无法锁定当前会话。');

    const confirmed = await service.confirmWechatSession({
      targetContact: '张先生',
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      contactAmbiguityResolved: true,
      popupCleared: true,
      loggedInConfirmed: true,
      currentWindowTitle: '张先生',
      operator: '测试用户',
    });

    expect(confirmed.canDraft).toBe(true);
    expect(confirmed.lock.locked).toBe(true);
    expect(confirmed.lock.targetContact).toBe('张先生');
    expect(confirmed.lock.windowTitle).toBe('张先生');
    expect(confirmed.evidence.length).toBeGreaterThan(0);
  });

  it('blocks wechat desktop session when login popup or ambiguous contacts are not cleared', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 2,
        currentWindowTitle: '微信',
        frontmost: true,
        windowTitles: ['微信', '张先生'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: ['检测到登录已失效弹窗'],
        requiresManualTarget: true,
        safetyBoundary: {
          draftOnly: true,
          readsPrivateChats: false,
          readsContacts: false,
          sendsMessages: false,
          targeting: 'manual',
          manualSteps: [],
        },
        message: '登录已失效，请重新登录',
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );
    mockDesktopScreenshot(service);

    const status = await service.confirmWechatSession({
      targetContact: '张先生',
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      currentWindowTitle: '微信',
      operator: '测试用户',
    });

    expect(status.canDraft).toBe(false);
    expect(status.anomalySummary.loggedOut).toBe(true);
    expect(status.anomalySummary.popupDetected).toBe(true);
    expect(status.anomalySummary.contactAmbiguous).toBe(true);
    expect(status.blockers.join('；')).toContain('掉线');
    expect(status.blockers.join('；')).toContain('弹窗');
  });

  it('blocks wechat desktop takeover without backend risk confirmation', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: jest.fn(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        windowTitles: ['张先生'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        permissionHints: [],
        requiresManualTarget: true,
        safetyBoundary: {
          draftOnly: true,
          readsPrivateChats: false,
          readsContacts: false,
          sendsMessages: false,
          targeting: 'manual',
          manualSteps: [],
        },
        message: '微信窗口已识别',
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );
    mockDesktopScreenshot(service);

    await expect(
      service.takeoverWechatSession({
        operator: '测试用户',
        reason: '用户检查联系人',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        riskAudit: expect.objectContaining({
          action: 'remote-control',
          riskLevel: 'high',
          status: 'approval_required',
        }),
      }),
    });

    const status = await service.getWechatSessionStatus();
    expect(status.takeoverActive).toBe(false);
    expect(status.evidence.some((item) => item.label === '微信人工接管')).toBe(
      false,
    );
  });

  it('records manual takeover and stop evidence for wechat desktop sessions', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        windowTitles: ['张先生'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        permissionHints: [],
        requiresManualTarget: true,
        safetyBoundary: {
          draftOnly: true,
          readsPrivateChats: false,
          readsContacts: false,
          sendsMessages: false,
          targeting: 'manual',
          manualSteps: [],
        },
        message: '微信窗口已识别',
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );
    mockDesktopScreenshot(service);

    const takeover = await service.takeoverWechatSession({
      operator: '测试用户',
      reason: '用户检查联系人',
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'remote-control',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
    });
    expect(takeover.takeoverActive).toBe(true);
    expect(takeover.canDraft).toBe(false);
    expect(
      takeover.evidence.some((item) => item.label === '微信人工接管'),
    ).toBe(true);
    expect(
      takeover.evidence.some((item) => item.label === '后端风控审计'),
    ).toBe(true);

    const stopped = await service.stopWechatSession({
      operator: '测试用户',
      reason: '微信弹窗异常',
    });
    expect(stopped.stopped).toBe(true);
    expect(stopped.stopReason).toBe('微信弹窗异常');
    expect(stopped.blockers).toContain('微信弹窗异常');
    expect(stopped.evidence.some((item) => item.label === '微信会话停止')).toBe(
      true,
    );
  });

  it('returns a blocking desktop commercial preflight when permissions, screenshot, window, or input are uncertain', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 2,
        currentWindowTitle: '微信',
        frontmost: false,
        windowTitles: ['微信', '张先生'],
        screenshotAvailable: false,
        inputControlAvailable: false,
        clickControlAvailable: false,
        permissionHints: ['缺少辅助功能权限', '缺少屏幕录制权限'],
        requiresManualTarget: true,
        message: '微信窗口不确定',
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const preflight = await service.getDesktopCommercialPreflight();
    const session = await service.getWechatSessionStatus();

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers.join('；')).toContain('辅助功能权限不可用');
    expect(preflight.blockers.join('；')).toContain('输入能力不可用');
    expect(preflight.window.frontmost).toBe(false);
    expect(preflight.window.windowTitles).toEqual(['微信', '张先生']);
    expect(session.canDraft).toBe(false);
    expect(session.anomalySummary.permissionBlocked).toBe(true);
  });

  it('blocks desktop commercial preflight when file selection capability is not declared', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'wechat',
        available: true,
        running: true,
        appName: '微信',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        windowTitles: ['张先生'],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        permissionHints: [],
        requiresManualTarget: true,
        message: '微信窗口已识别，但未声明文件选择能力',
      }),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const preflight = await service.getDesktopCommercialPreflight();

    expect(preflight.allowed).toBe(false);
    expect(preflight.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'file-selection',
          status: 'blocked',
        }),
      ]),
    );
    expect(preflight.blockers.join('；')).toContain('文件选择能力不可用');
  });

  it('filters interaction tasks for independent business routes and records', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest
        .fn()
        .mockResolvedValue(readyWechatDesktopStatus),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const commentTask = await service.createBusinessTask('comments', {
      accountId: '12',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '评论用户',
      sourceText: '评论内容',
      sendMode: 'draft-only',
    });
    const messageTask = await service.createBusinessTask('messages', {
      accountId: '13',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '私信用户',
      sourceText: '私信内容',
      sendMode: 'draft-only',
    });
    const wechatTask = await service.createBusinessTask('wechat', {
      accountId: '2',
      accountName: '微信账号',
      platformType: 2,
      platformName: '视频号 / 微信',
      targetName: '微信用户',
      sourceText: '微信内容',
      sendMode: 'draft-only',
    });

    await service.failTask(commentTask.id, '测试失败记录');

    const comments = await service.listBusinessTasks('comments');
    const messages = await service.listBusinessTasks('messages');
    const records = await service.listTasks(50, { recordsOnly: true });

    expect(commentTask.type).toBe('douyin-comment-reply');
    expect(messageTask.type).toBe('douyin-direct-message-reply');
    expect(wechatTask.type).toBe('wechat-reply-draft');
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(commentTask.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(messageTask.id);
    expect(records.map((task) => task.id)).toEqual([commentTask.id]);
  });

  it('exports filtered interaction records as csv with summary', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      getWechatDesktopStatus: jest
        .fn()
        .mockResolvedValue(readyWechatDesktopStatus),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const commentTask = await service.createBusinessTask('comments', {
      accountId: '12',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '评论用户',
      sourceText: '价格多少',
      replyText: '您好，可以私信了解。',
      sendMode: 'draft-only',
    });
    await service.createBusinessTask('messages', {
      accountId: '13',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '私信用户',
      sourceText: '想预约',
      replyText: '您好，可以预约。',
      sendMode: 'draft-only',
    });
    await service.failTask(commentTask.id, '测试失败记录');

    const exported = await service.exportRecords(20, {
      type: 'douyin-comment-reply',
      status: 'failed',
    });

    expect(exported.filename).toMatch(/^interaction-records-/);
    expect(exported.mimeType).toContain('text/csv');
    expect(exported.exportStatus).toBe('FAILED');
    expect(exported.summary.total).toBe(1);
    expect(exported.content).toContain('任务ID');
    expect(exported.content).toContain('阶段日志');
    expect(exported.content).toContain('浏览器证据索引');
    expect(exported.content).toContain('风险审计');
    expect(exported.content).toContain('导出完整性');
    expect(exported.content).toContain('FAILED:');
    expect(exported.content).toContain('测试失败记录');
    expect(exported.content).toContain('您好，可以私信了解。');
    expect(exported.content).not.toContain('私信用户');
  });

  it('creates batch interaction draft tasks and exports target-level rows', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockWechatExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createBusinessTask('customers', {
      accountName: '抖音门店号',
      sendMode: 'draft-only',
      batchTargets: [
        { targetName: '张女士', sourceText: '今天还能预约吗？' },
        {
          targetName: '李先生',
          sourceText: '保洁费用咨询',
          replyText: '您好，费用要看面积。',
        },
        { targetName: '王女士', sourceText: '周末营业吗？' },
      ],
    });

    await settleInteractionLifecycle();
    const updated = await service.getTask(task.id);

    expect(updated.status).toBe('waiting_for_send_confirmation');
    expect(updated.batchTargets).toHaveLength(3);
    expect(updated.batchSummary).toEqual({
      total: 3,
      queued: 0,
      running: 0,
      waitingConfirmation: 3,
      completed: 0,
      failed: 0,
      skipped: 0,
      noTarget: 0,
    });
    expect(
      updated.events.some(
        (event) =>
          event.message.includes('等待人工完成') ||
          event.message.includes('待确认跟进'),
      ),
    ).toBe(true);
  });

  it('creates retry tasks from failed or skipped tasks', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createBusinessTask('messages', {
      accountId: '13',
      accountName: '抖音私信号',
      platformType: 3,
      platformName: '抖音',
      sendMode: 'draft-only',
      batchTargets: [
        { targetName: '客户 A', sourceText: '想预约' },
        { targetName: '客户 B', sourceText: '想看价格' },
      ],
    });
    await service.failTask(task.id, '测试失败');

    const retry = await service.retryTask(task.id);

    expect(retry.id).not.toBe(task.id);
    expect(retry.type).toBe('douyin-direct-message-reply');
    expect(retry.status).toBe('queued');
    expect(retry.batchTargets).toHaveLength(2);
    expect(retry.batchSummary).toEqual({
      total: 2,
      queued: 2,
      running: 0,
      waitingConfirmation: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      noTarget: 0,
    });
    expect(retry.events.some((event) => event.message.includes(task.id))).toBe(
      true,
    );
    expect(
      (await service.getTask(task.id)).events.some((event) =>
        event.message.includes(retry.id),
      ),
    ).toBe(true);
  });

  it('blocks wechat group broadcast and moments publish until commercial safeguards are complete', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const groupTask = await service.createBusinessTask('groups', {
      accountId: '2',
      accountName: '微信账号',
      platformType: 2,
      platformName: '微信',
      targetName: '客户群',
      sourceText: '本周活动提醒',
      replyText: '欢迎预约。',
      sendMode: 'draft-only',
    });
    const momentsTask = await service.createBusinessTask('moments', {
      accountId: '2',
      accountName: '微信账号',
      platformType: 2,
      platformName: '微信',
      targetName: '朋友圈可见范围',
      sourceText: '案例图片',
      replyText: '朋友圈文案',
      sendMode: 'approval-send',
    });
    const customerTask = await service.createBusinessTask('customers', {
      targetName: '客户 A',
      sourceText: '客户咨询过价格',
      replyText: '您好，继续跟进一下需求。',
      sendMode: 'draft-only',
    });

    await jest.advanceTimersByTimeAsync(2200);
    const records = await service.listRecords(20);

    expect(customerTask.type).toBe('customer-follow-up');
    expect(customerTask.status).toBe('waiting_for_send_confirmation');
    expect(groupTask.status).toBe('blocked');
    expect(momentsTask.status).toBe('blocked');
    expect(autoUploadService.openInteractionEntry).not.toHaveBeenCalled();
    expect(records.summary.byType['customer-follow-up'] || 0).toBe(0);
  });

  it('exports a single task diagnostic package', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn().mockResolvedValue({
        online: true,
        service: 'auto-upload',
        version: 'test',
      }),
      listAccounts: listReadyAccounts().mockResolvedValue([]),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createBusinessTask('customers', {
      accountName: '诊断测试账号',
      targetName: '诊断客户',
      sourceText: '诊断测试',
      sendMode: 'draft-only',
    });
    await settleInteractionLifecycle();

    const exported = await service.exportTaskDiagnostics(task.id);
    const content = JSON.parse(exported.content);

    expect(exported.filename).toContain(task.id);
    expect(exported.mimeType).toContain('application/json');
    expect(exported.exportStatus).toBe('OK');
    expect(content.exportStatus).toBe('OK');
    expect(content.integrity.status).toBe('OK');
    expect(content.task.id).toBe(task.id);
    expect(content.task.steps.length).toBeGreaterThan(0);
    expect(content.task.events.length).toBeGreaterThan(0);
    expect(content.task.evidence.length).toBeGreaterThan(0);
    expect(content.task.evidenceIndex).toEqual(
      expect.objectContaining({
        stageLogs: expect.any(Array),
        failureReasons: expect.any(Array),
        riskAudits: expect.any(Array),
        confirmations: expect.any(Array),
        browser: expect.any(Array),
        desktop: expect.any(Array),
        text: expect.any(Array),
      }),
    );
    expect(content.task.evidenceIndex.stageLogs.length).toBeGreaterThan(0);
    expect(content.task.evidenceIndex.text.length).toBeGreaterThan(0);
    expect(content.runtime).toBeDefined();
    expect(content.readiness).toBeDefined();
    expect(content.supportHint).toContain('task.diagnostics');
  });

  it('finishes browser-assisted tasks as no target when live reader returns an empty list', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      getCdpSessions: listReadyCdpSessions([
        { platform: 'douyin', accountId: 12 },
      ]),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        entryName: '评论管理预检',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        status: 'opening',
        loggedIn: true,
      }),
      readDouyinComments: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '作品管理',
        comments: [],
        pageTextSample: '暂无评论',
        readAt: new Date().toISOString(),
      }),
      draftDouyinCommentReply: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/interactive/comment',
        status: 'draft_filled',
        message: '回复草稿已填入，未点击发送。',
        targetText: '现在预约多少钱？',
        replyText: '您好，具体费用需要看您的实际需求。',
        draftedAt: new Date().toISOString(),
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createTask({
      type: 'douyin-comment-reply',
      accountId: '12',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '评论用户',
      sourceText: '多少钱',
      replyText: '您好，可以私信了解详情。',
      sendMode: 'approval-send',
    });

    await settleBrowserAssistedLifecycle();
    const updated = await service.getTask(task.id);

    expect(updated.status).toBe('no_target');
    expect(updated.runtimeState).toBe('preflight_only');
    expect(
      updated.steps?.find((step) => step.key === 'target-read')?.status,
    ).toBe('skipped');
    expect(
      updated.steps?.find((step) => step.key === 'send-approval')?.status,
    ).toBe('skipped');
    expect(
      updated.steps?.find((step) => step.key === 'send-result')?.status,
    ).toBe('skipped');
    expect(updated.diagnostics).toMatchObject({
      status: 'no_target',
      account: '抖音账号',
      platform: '抖音',
    });
    expect(updated.batchSummary?.noTarget).toBe(1);
    expect(updated.diagnostics?.summary).toBeDefined();
    expect(updated.nextAction).toBeDefined();
  });

  it('moves a browser-assisted Douyin comment task to approval after reading a comment', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      getCdpSessions: listReadyCdpSessions([
        { platform: 'douyin', accountId: 12 },
      ]),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        entryName: '评论管理预检',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        status: 'opening',
        loggedIn: true,
      }),
      readDouyinComments: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '作品管理',
        comments: [{ text: '现在预约多少钱？', looksLikeComment: true }],
        readAt: new Date().toISOString(),
      }),
      draftDouyinCommentReply: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/interactive/comment',
        status: 'draft_filled',
        message: '回复草稿已填入，未点击发送。',
        targetText: '现在预约多少钱？',
        replyText: '您好，具体费用需要看您的实际需求。',
        draftedAt: new Date().toISOString(),
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createTask({
      type: 'douyin-comment-reply',
      accountId: '12',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '评论用户',
      sourceText: '占位评论',
      replyText: '占位回复',
      sendMode: 'approval-send',
    });

    await settleBrowserAssistedLifecycle();
    const updated = await service.getTask(task.id);

    expect(updated.status).toBe('waiting_for_send_confirmation');
    expect(updated.runtimeState).toBe('preflight_only');
    expect(updated.sourceText).toBe('现在预约多少钱？');
    expect(updated.replyText).toBeDefined();
    expect(updated.diagnostics?.status).toBe('waiting');
    expect(updated.diagnostics?.summary).toBeDefined();
    expect(
      updated.steps?.find((step) => step.key === 'target-read')?.status,
    ).toBe('completed');
    expect(
      updated.steps?.find((step) => step.key === 'send-approval')?.status,
    ).toBe('running');
    expect(autoUploadService.draftDouyinCommentReply).not.toHaveBeenCalled();
  });

  it('marks browser-assisted replies as fallback when AI model is unavailable', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      getCdpSessions: listReadyCdpSessions([
        { platform: 'douyin', accountId: 12 },
      ]),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        entryName: '评论管理预检',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        status: 'opened',
        loggedIn: true,
      }),
      readDouyinComments: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '作品管理',
        comments: [{ text: '现在预约多少钱？', looksLikeComment: true }],
        readAt: new Date().toISOString(),
      }),
    };
    const executor = createInteractionExecutor(autoUploadService);
    mockDouyinExecutorReady(executor);
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      executor,
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createTask({
      type: 'douyin-comment-reply',
      accountId: '12',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '评论用户',
      sourceText: '占位评论',
      sendMode: 'approval-send',
    });

    await settleBrowserAssistedLifecycle();
    const updated = await service.getTask(task.id);

    expect(updated.status).toBe('waiting_for_send_confirmation');
    expect(updated.replyGeneratedBy).toBe('fallback');
    expect(
      updated.steps?.find((step) => step.key === 'reply-generate')?.message,
    ).toContain('规则兜底');
    expect(
      updated.events.some((event) => event.evidence?.label === '规则兜底回复'),
    ).toBe(true);
  });

  it('rejects real interaction tasks without a selected local account', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    await expect(
      service.createTask({
        type: 'douyin-comment-reply',
        accountName: '抖音账号',
        targetName: '评论用户',
        sourceText: '多少钱',
        replyText: '您好，可以私信了解详情。',
      }),
    ).rejects.toThrow('需要选择已登录的本地账号');
  });

  it('rejects browser-assisted comment tasks before persistence when 5409 does not declare read and draft capabilities', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue({
        ...fullInteractionCapabilities,
        supportedTaskTypes: [
          {
            key: 'douyin-comment-reply',
            platformType: 3,
            platformName: '抖音',
            entryType: 'douyin-comment-reply',
            stages: ['entry-preflight'],
            controlledSend: false,
            evidence: ['snapshot'],
          },
        ],
      }),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      readDouyinComments: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createTask({
      type: 'douyin-comment-reply',
      accountId: '12',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '评论用户',
      sourceText: '多少钱',
      replyText: '您好，可以私信了解详情。',
    });

    expect(autoUploadService.openInteractionEntry).not.toHaveBeenCalled();
    expect(autoUploadService.readDouyinComments).not.toHaveBeenCalled();
    expect(task.status).toBe('blocked');
    expect(task.failureReason).toContain('执行能力未就绪');
    expect(prisma.interactionTask.upsert).toHaveBeenCalled();
  });

  it('blocks backend-only approvals and local file cleanup without risk confirmation', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
      cleanupInteractionEvidence: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createBusinessTask('customers', {
      accountName: '抖音门店号',
      targetName: '客户 A',
      sourceText: '想预约',
      replyText: '您好，可以安排。',
      sendMode: 'approval-send',
    });
    await jest.advanceTimersByTimeAsync(2000);

    await expect(service.approveTask(task.id)).rejects.toMatchObject({
      response: expect.objectContaining({
        riskAudit: expect.objectContaining({
          action: 'interaction-approval',
          riskLevel: 'medium',
          status: 'approval_required',
        }),
      }),
    });
    await expect(service.cleanupEvidence(7)).rejects.toMatchObject({
      response: expect.objectContaining({
        riskAudit: expect.objectContaining({
          action: 'local-file-delete',
          riskLevel: 'high',
          status: 'approval_required',
        }),
      }),
    });
    expect(autoUploadService.cleanupInteractionEvidence).not.toHaveBeenCalled();
  });

  it('rejects unsupported live task types instead of persisting unsupported execution', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const task = await service.createTask({
      type: 'wechat-group-broadcast',
      accountId: '2',
      accountName: '微信账号',
      platformType: 2,
      platformName: '微信',
      targetName: '客户群',
      sourceText: '本周活动提醒',
      replyText: '欢迎预约。',
    });

    expect(task.status).toBe('blocked');
    expect(prisma.interactionTask.upsert).toHaveBeenCalled();
    expect(autoUploadService.openInteractionEntry).not.toHaveBeenCalled();
  });

  it('keeps agent sessions operable across filters confirmations evidence export and stop', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const session = await service.createAgentSession({
      instruction: '请打开浏览器发布这条内容',
      source: 'web',
      targetApp: '抖音后台',
      dryRun: true,
    });
    const pending = await service.listAgentConfirmations('pending');
    const blockedContinue = await service.continueAgentSession(session.id, {
      operator: '测试用户',
    });
    const evidence = await service.listAgentSessionEvidence(session.id);
    const exported = await service.exportAgentSessionEvidence(session.id);
    const exportedContent = JSON.parse(exported.content);

    expect(pending).toHaveLength(1);
    expect(pending[0].session?.id).toBe(session.id);
    expect(pending[0].riskPolicy).toEqual(
      expect.objectContaining({
        targetName: '抖音后台',
        targetWhitelisted: expect.any(Boolean),
        forbiddenActions: expect.any(Array),
        forbiddenActionHits: expect.any(Array),
      }),
    );
    expect(blockedContinue.status).toBe('waiting_for_confirmation');
    expect(blockedContinue.nextAction).toContain('确认项未处理');
    expect(evidence.evidenceCount).toBeGreaterThan(0);
    expect(exported.timelineCount).toBeGreaterThan(0);
    expect(exported.exportStatus).toBe('FAILED');
    expect(exportedContent.exportStatus).toBe('FAILED');
    expect(exportedContent.integrity.missing).toContain('缺少浏览器证据索引');
    expect(exportedContent.evidenceIndex).toEqual(
      expect.objectContaining({
        stageLogs: expect.any(Array),
        failureReasons: expect.any(Array),
        riskAudits: expect.any(Array),
        confirmations: expect.any(Array),
        browser: expect.any(Array),
        desktop: expect.any(Array),
        text: expect.any(Array),
      }),
    );
    expect(exportedContent.replay.summary.pendingConfirmations).toBe(1);
    expect(exportedContent.summary).toEqual(
      expect.objectContaining({
        totalEvidence: expect.any(Number),
        byType: expect.objectContaining({
          text: expect.any(Number),
          stage_log: expect.any(Number),
          failure_reason: expect.any(Number),
        }),
        stageLogCount: expect.any(Number),
      }),
    );
    expect(exportedContent.evidenceByType).toEqual(
      expect.objectContaining({
        text: expect.any(Number),
        stage_log: expect.any(Number),
      }),
    );
    expect(exportedContent.auditTrail).toEqual(expect.any(Array));
    expect(exportedContent.failureAnalysis).toEqual(
      expect.objectContaining({
        failed: expect.any(Boolean),
        reasons: expect.any(Array),
      }),
    );

    const approved = await service.approveAgentConfirmation(pending[0].id, {
      operator: '测试用户',
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'agent-confirmation-approve',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
      confirmedChecks: Object.fromEntries(
        pending[0].requiredChecks.map((check) => [check.key, true]),
      ),
    });
    expect(approved.status).toBe('running');
    const approvedExport = JSON.parse(
      (await service.exportAgentSessionEvidence(session.id)).content,
    );
    const riskAudit = approvedExport.evidence.find(
      (item: any) => item.label === '后端风控审计',
    );
    expect(JSON.parse(riskAudit.value)).toEqual(
      expect.objectContaining({
        action: 'agent-confirmation-approve',
        riskLevel: 'high',
        account: expect.objectContaining({ name: expect.any(String) }),
        device: expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
        }),
        confirmationRecord: expect.objectContaining({ operator: '测试用户' }),
      }),
    );
    expect(approvedExport.auditTrail.map((item: any) => item.action)).toEqual(
      expect.arrayContaining(['approved']),
    );
    expect(
      (
        await service.listAgentSessions(20, {
          source: 'web',
          executionScope: 'browser',
          hasPendingConfirmation: false,
          hasEvidence: true,
          targetApp: '抖音',
        })
      ).map((item) => item.id),
    ).toContain(session.id);

    const stopCandidate = await service.createAgentSession({
      instruction: '请发送一条微信消息',
      source: 'web',
      dryRun: true,
    });
    const stopped = await service.stopAgentSession(stopCandidate.id);
    const stoppedExport = JSON.parse(
      (await service.exportAgentSessionEvidence(stopCandidate.id)).content,
    );
    expect(stopped.status).toBe('cancelled');
    expect(
      stopped.confirmations.every(
        (confirmation) => confirmation.status !== 'pending',
      ),
    ).toBe(true);
    expect(stoppedExport.failureAnalysis.failed).toBe(true);
    expect(
      stoppedExport.failureAnalysis.rejectedConfirmations.length,
    ).toBeGreaterThan(0);
  });

  it('marks empty agent evidence exports as failed instead of returning an empty package', async () => {
    const emptySession = {
      id: 'empty-agent-session',
      title: '空证据会话',
      instruction: '只创建了壳，没有事件',
      status: 'completed',
      statusLabel: '已完成',
      executionScope: 'browser',
      source: 'web',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      nextAction: '原本为空',
      targetApp: '抖音后台',
      riskLevel: 'medium',
      requiresDoubleConfirmation: false,
      riskPolicy: {
        planMode: 'trial',
        requiredRole: 'operator',
        approverRoles: ['manager'],
        targetName: '抖音后台',
        targetWhitelisted: false,
        whitelistTargets: [],
        forbiddenActions: [],
        forbiddenActionHits: [],
        remoteTakeoverAuditRequired: false,
        remoteAudit: [],
        message: '测试风险策略',
      },
      confirmations: [],
      events: [],
    };
    const prisma = createPrismaMock({
      sessionRows: [
        {
          id: emptySession.id,
          scope: emptySession,
          status: 'completed',
          updatedAt: new Date(),
          events: [],
          confirmations: [],
        },
      ],
    });
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    const exported = await service.exportAgentSessionEvidence(emptySession.id);
    const content = JSON.parse(exported.content);
    const failedSession = await service.getAgentSession(emptySession.id);

    expect(exported.exportStatus).toBe('FAILED');
    expect(exported.evidenceCount).toBeGreaterThan(0);
    expect(content.exportStatus).toBe('FAILED');
    expect(content.evidenceIndex.failureReasons.length).toBeGreaterThan(0);
    expect(content.integrity.missing).toEqual(
      expect.arrayContaining(['缺少浏览器证据索引', '缺少文本证据索引']),
    );
    expect(failedSession.status).toBe('failed');
    expect(failedSession.nextAction).toContain('证据链为空');
  });

  it('saves real image assets for wechat moments and rejects non-images', async () => {
    const prisma = createPrismaMock();
    const autoUploadService = {
      getInteractionCapabilities: jest
        .fn()
        .mockResolvedValue(fullInteractionCapabilities),
      getHealth: jest.fn(),
      listAccounts: listReadyAccounts(),
      openInteractionEntry: jest.fn(),
    };
    const service = new LocalEngineService(
      new ConfigService(),
      autoUploadService as any,
      prisma as any,
      createInteractionExecutor(autoUploadService),
      createMcpRuntimeMock() as any,
      createAgentSidecarMock() as any,
      createSandboxRuntimeMock() as any,
      createPluginRuntimeMock() as any,
      createMemoryRuntimeMock() as any,
    );

    await expect(
      service.saveInteractionAsset({
        buffer: Buffer.from('not-image'),
        originalname: 'note.txt',
        mimetype: 'text/plain',
      }),
    ).rejects.toThrow('朋友圈素材必须是图片文件');

    const saved = await service.saveInteractionAsset({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      originalname: 'moments-test.png',
      mimetype: 'image/png',
    });

    expect(saved.filename).toContain('moments-test');
    expect(saved.filepath).toContain('interaction-assets');
    expect(saved.mimeType).toBe('image/png');
    expect(saved.sizeBytes).toBe(4);
    expect(existsSync(saved.filepath)).toBe(true);

    rmSync(saved.filepath, { force: true });
  });
});
