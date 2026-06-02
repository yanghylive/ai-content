import { LocalInteractionExecutorService } from './local-interaction-executor.service';
import {
  type InteractionTask,
  type InteractionTaskStepStatus,
  type InteractionReplyRuleConfig,
} from './local-engine.types';

describe('LocalInteractionExecutorService', () => {
  const fullCapabilities = {
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
        controlledSend: false,
        evidence: ['snapshot', 'screenshot'],
      },
      {
        key: 'douyin-direct-message-reply',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-direct-message-reply',
        stages: ['entry-preflight', 'target-read', 'draft-fill'],
        controlledSend: false,
        evidence: ['snapshot', 'screenshot'],
      },
      {
        key: 'wechat-reply-draft',
        platformType: 2,
        platformName: '微信',
        entryType: 'wechat-reply-draft',
        stages: ['entry-preflight', 'desktop-draft-fill', 'auto-send'],
        controlledSend: true,
        autoSend: true,
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

  function createTask(patch?: Partial<InteractionTask>): InteractionTask {
    const now = new Date().toISOString();
    return {
      id: 'task-1',
      type: 'douyin-comment-reply',
      typeLabel: '抖音评论回复',
      status: 'running',
      statusLabel: '执行中',
      accountId: '12',
      accountName: '抖音账号',
      platformType: 3,
      platformName: '抖音',
      targetName: '评论用户',
      sourceText: '多少钱',
      replyText: '您好，可以私信了解详情。',
      sendMode: 'approval-send',
      executionMode: 'browser-assisted',
      runtimeState: 'preflight_only',
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          key: 'account-entry',
          label: '账号入口',
          status: 'pending',
          message: '等待打开本地账号后台。',
          updatedAt: now,
        },
        {
          key: 'target-read',
          label: '读取评论',
          status: 'pending',
          message: '等待定位目标对象。',
          updatedAt: now,
        },
        {
          key: 'reply-generate',
          label: '生成回复',
          status: 'pending',
          message: '等待生成回复。',
          updatedAt: now,
        },
        {
          key: 'send-approval',
          label: '发送确认',
          status: 'pending',
          message: '等待发送前确认。',
          updatedAt: now,
        },
      ],
      events: [],
      ...patch,
    };
  }

  function createRuntime(task: InteractionTask) {
    return {
      setTaskStep: jest.fn(
        (
          target: InteractionTask,
          key: string,
          status: InteractionTaskStepStatus,
          message: string,
        ) => {
          const step = target.steps?.find((item) => item.key === key);
          if (step) {
            step.status = status;
            step.message = message;
          }
        },
      ),
      pushEvent: jest.fn(
        (target: InteractionTask, level, message, evidence) => {
          const event = {
            id: `event-${target.events.length + 1}`,
            taskId: target.id,
            level,
            message,
            evidence,
            createdAt: new Date().toISOString(),
          };
          target.events.push(event);
          return event;
        },
      ),
      task,
    };
  }

  function withReadyDouyinPreflight<T extends Record<string, any>>(
    service: T,
    accountId = 12,
  ): T {
    return {
      getCdpSessions: jest.fn().mockResolvedValue({
        available: true,
        message: 'CDP 浏览器在线：1 个会话',
        checkedAt: new Date().toISOString(),
        sessions: [
          {
            platform: 'douyin',
            accountId,
            status: 'ready',
            debuggingPort: 9290,
            visibleWindow: true,
          },
        ],
      }),
      listAccounts: jest.fn().mockResolvedValue([
        {
          id: accountId,
          type: 3,
          platform: '抖音',
          filePath: 'douyin.json',
          userName: '抖音账号',
          status: 1,
          statusLabel: '正常',
        },
      ]),
      ...service,
    };
  }

  it('marks browser executors ready and keeps desktop executor preflight-only when desktop is unavailable', async () => {
    const service = new LocalInteractionExecutorService(
      {
        getInteractionCapabilities: jest
          .fn()
          .mockResolvedValue(fullCapabilities),
        getHealth: jest.fn().mockResolvedValue({ online: true }),
        openInteractionEntry: jest.fn(),
        readDouyinComments: jest.fn(),
        readDouyinMessages: jest.fn(),
        getWechatDesktopStatus: jest.fn().mockResolvedValue({
          available: false,
        }),
      } as any,
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

    const status = await service.getStatus();

    expect(status.summary).toEqual({
      total: 7,
      ready: 2,
      preflightOnly: 1,
      missing: 4,
    });
    expect(status.executors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'douyin-comment-reply',
          entryPreflight: true,
          targetRead: true,
          replyGenerate: true,
          controlledSend: true,
        }),
        expect.objectContaining({
          key: 'wechat-reply-draft',
          status: 'preflight_only',
          entryPreflight: true,
          targetRead: false,
          controlledSend: false,
        }),
      ]),
    );
  });

  it('exposes WeChat group broadcast and moments through desktop preflight while capabilities stay undeclared', async () => {
    const service = new LocalInteractionExecutorService(
      {
        getInteractionCapabilities: jest
          .fn()
          .mockResolvedValue(fullCapabilities),
        getWechatDesktopStatus: jest.fn().mockResolvedValue({
          available: true,
          running: true,
          appName: 'WeChat',
          windowCount: 1,
          currentWindowTitle: '张先生',
          frontmost: true,
          permissionHints: [],
          screenshotAvailable: true,
          inputControlAvailable: true,
          clickControlAvailable: true,
          fileSelectionAvailable: true,
        }),
      } as any,
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

    const status = await service.getStatus();

    expect(status.summary).toEqual({
      total: 7,
      ready: 3,
      preflightOnly: 0,
      missing: 4,
    });
    expect(status.executors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'wechat-group-broadcast',
          status: 'missing',
          entryPreflight: false,
          targetRead: true,
          replyGenerate: true,
          controlledSend: true,
        }),
        expect.objectContaining({
          key: 'wechat-moments-publish',
          status: 'missing',
          entryPreflight: false,
          targetRead: true,
          replyGenerate: true,
          controlledSend: true,
        }),
      ]),
    );
  });

  it('opens the Douyin comment entry and reads a real comment candidate without sending', async () => {
    const aiReply = '您好，费用需要看具体项目，您方便私信说下需求吗？';
    const aiGenerate = jest.fn().mockResolvedValue(
      JSON.stringify({
        shouldReply: true,
        index: 0,
        replyText: aiReply,
        reason: '客户询价',
      }),
    );
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      getHealth: jest.fn(),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        entryName: '评论管理预检',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 评论管理',
        status: 'opening',
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
      draftDouyinCommentReply: jest.fn(),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
      { generate: aiGenerate } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ articleCreation: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );
    const task = createTask();
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(autoUploadService.openInteractionEntry).toHaveBeenCalledWith({
      accountId: 12,
      entryType: 'douyin-comment-reply',
    });
    expect(autoUploadService.readDouyinComments).toHaveBeenCalledWith({
      accountId: 12,
      limit: 10,
    });
    expect(result.state).toBe('preflight_only');
    expect(result.targetText).toBe('现在预约多少钱？');
    expect(result.replyText).toBe(aiReply);
    expect(result.readyForApproval).toBe(true);
    expect(
      task.steps?.find((step) => step.key === 'account-entry')?.status,
    ).toBe('completed');
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'completed',
    );
    expect(
      task.events.some((event) => event.message.includes('待确认回复')),
    ).toBe(true);
  });

  it('generates Douyin comment replies with AI from the real comment text', async () => {
    const aiReply = '您好，可以预约。您方便说下明天下午的时间段和服务需求吗？';
    const aiGenerate = jest.fn().mockResolvedValue(
      JSON.stringify({
        shouldReply: true,
        index: 0,
        replyText: aiReply,
        reason: '客户询问上门时间',
      }),
    );
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        entryName: '评论管理预检',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 评论管理',
        status: 'opened',
      }),
      readDouyinComments: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '评论管理',
        comments: [{ text: '明天下午可以上门吗？', looksLikeComment: true }],
        readAt: new Date().toISOString(),
      }),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
      { generate: aiGenerate } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ articleCreation: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );
    const task = createTask();
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);
    const [, messages] = aiGenerate.mock.calls[0] as [
      string,
      Array<{ role: string; content: string }>,
      unknown,
    ];

    expect(aiGenerate).toHaveBeenCalledTimes(1);
    expect(messages[0].content).toContain('先判断客户场景');
    expect(messages[0].content).toContain('售后');
    expect(messages[0].content).toContain('退款');
    expect(messages[0].content).toContain('差评');
    expect(messages[1].content).toContain('[0] 明天下午可以上门吗？');
    expect(result.replyText).toBe(aiReply);
    expect(
      task.steps?.find((step) => step.key === 'reply-generate')?.message,
    ).toBe('AI 已按真实评论内容生成回复。');
    expect(task.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: expect.objectContaining({
            label: 'AI 识别并生成回复',
            value: aiReply,
          }),
        }),
      ]),
    );
  });

  it('falls back to concrete customer-service replies when AI is unavailable', async () => {
    const service = new LocalInteractionExecutorService(
      {} as any,
      {
        generate: jest.fn().mockRejectedValue(new Error('AI not available')),
      } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ articleCreation: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );
    const rule: InteractionReplyRuleConfig = {
      industryName: '本地生活/电商服务',
      tone: 'warm',
      defaultSendMode: 'auto-send',
      askForContact: true,
      requireApprovalKeywords: ['退款'],
      blockedKeywords: ['最低价'],
      serviceHighlights: [],
      closingText: '您方便留下联系方式或私信我们吗？我们马上帮您安排。',
      updatedAt: new Date().toISOString(),
    };

    await expect(
      service.generateAiReply(
        '这个能退款吗？包装破了',
        { brandName: '抖音账号' },
        rule,
      ),
    ).resolves.toEqual({
      replyText: expect.stringContaining('订单号'),
      generatedBy: 'fallback',
    });

    const reply = await service.generateAiReply(
      '这个多少钱？',
      { brandName: '抖音账号' },
      rule,
    );

    expect(reply.replyText).toContain('具体款式');
    expect(reply.replyText).not.toContain('专人跟进');
    expect(reply.replyText).not.toContain('合适方案');
    expect(reply.replyText).not.toContain('联系方式');
  });

  it('rejects generic AI customer-service templates and uses a concrete fallback', async () => {
    const service = new LocalInteractionExecutorService(
      {} as any,
      {
        generate: jest
          .fn()
          .mockResolvedValue(
            '亲，能告诉我您看的是哪款商品吗？我帮您查下价格～',
          ),
      } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ articleCreation: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );

    const result = await service.generateAiReply(
      '这个多少钱？',
      { brandName: '抖音账号' },
      {
        industryName: '本地生活/电商服务',
        tone: 'warm',
        defaultSendMode: 'auto-send',
        askForContact: true,
        requireApprovalKeywords: [],
        blockedKeywords: [],
        serviceHighlights: [],
        closingText: '您方便留下联系方式或私信我们吗？我们马上帮您安排。',
        updatedAt: new Date().toISOString(),
      },
    );

    expect(result.generatedBy).toBe('fallback');
    expect(result.replyText).toBe(
      '价格要看具体款式和需求，你把想看的那款发我，我按实际情况帮你核一下。',
    );
  });

  it('marks AI-selected target replies as fallback when the generated reply is replaced by rules', async () => {
    const service = new LocalInteractionExecutorService(
      {} as any,
      {
        generate: jest.fn().mockResolvedValue(
          JSON.stringify({
            shouldReply: true,
            index: 0,
            replyText: '收到留言，专人跟进，马上帮您安排。',
            intent: 'pre_sale',
            riskLevel: 'low',
            reason: 'customer asked price',
          }),
        ),
      } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ articleCreation: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );

    const result = await (service as any).selectDouyinTargetWithAi(
      [{ text: '这个多少钱？', looksLikeComment: true }],
      '评论',
      { brandName: '抖音账号' },
    );

    expect(result).toEqual(
      expect.objectContaining({
        replyText:
          '价格要看具体款式和需求，你把想看的那款发我，我按实际情况帮你核一下。',
        generatedBy: 'fallback',
      }),
    );
  });

  it('rejects replies that invent links or ask for unrelated order information', async () => {
    const aiGenerate = jest
      .fn()
      .mockResolvedValueOnce(
        '您说的是哪款商品？把具体款式或订单号发我，我帮您查价格。',
      )
      .mockResolvedValueOnce('您在我们店铺首页就能下单，我发个直达链接给您。');
    const service = new LocalInteractionExecutorService(
      {} as any,
      { generate: aiGenerate } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ articleCreation: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );
    const rule: InteractionReplyRuleConfig = {
      industryName: '本地生活/电商服务',
      tone: 'warm',
      defaultSendMode: 'auto-send',
      askForContact: true,
      requireApprovalKeywords: [] as string[],
      blockedKeywords: [] as string[],
      serviceHighlights: [] as string[],
      closingText: '你把具体款式、订单或时间发我，我按实际情况帮你看。',
      updatedAt: new Date().toISOString(),
    };

    await expect(
      service.generateAiReply('这个多少钱？', { brandName: '抖音账号' }, rule),
    ).resolves.toEqual({
      replyText:
        '价格要看具体款式和需求，你把想看的那款发我，我按实际情况帮你核一下。',
      generatedBy: 'fallback',
    });
    await expect(
      service.generateAiReply(
        '在哪下单？有链接吗？',
        { brandName: '抖音账号' },
        rule,
      ),
    ).resolves.toEqual({
      replyText: '可以，你想看哪一款？把名称或截图发我，我帮你对应到具体入口。',
      generatedBy: 'fallback',
    });
  });

  it('blocks Douyin comment tasks when the browser entry looks logged out', async () => {
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        available: true,
      }),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        entryName: '评论管理预检',
        url: 'https://creator.douyin.com/login',
        title: '抖音创作者服务中心',
        loggedIn: false,
        pageTextSample: '扫码登录 手机号登录 密码登录',
        status: 'opened',
        evidence: {
          type: 'snapshot',
          label: '登录页快照',
          value: '扫码登录 手机号登录 密码登录',
        },
      }),
      readDouyinComments: jest.fn(),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask();
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(autoUploadService.readDouyinComments).not.toHaveBeenCalled();
    expect(result.failureReason).toBe('抖音评论入口疑似未登录');
    expect(result.nextAction).toContain('重新登录抖音账号');
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'blocked',
    );
    expect(
      task.events.some((event) => event.message.includes('疑似未登录')),
    ).toBe(true);
    expect(
      task.events.some((event) => event.evidence?.label === '登录页快照'),
    ).toBe(true);
  });

  it('blocks Douyin comment tasks before opening the browser when target read capability is missing', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue({
        ...fullCapabilities,
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
      openInteractionEntry: jest.fn(),
      readDouyinComments: jest.fn(),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask();
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(autoUploadService.openInteractionEntry).not.toHaveBeenCalled();
    expect(autoUploadService.readDouyinComments).not.toHaveBeenCalled();
    expect(result.terminalStatus).toBe('failed');
    expect(result.failureReason).toContain('缺少真实执行阶段');
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'blocked',
    );
    expect(
      task.events.some((event) => event.evidence?.label === '浏览器执行能力'),
    ).toBe(true);
  });

  it('fills a Douyin comment reply draft without sending it', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
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
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      status: 'waiting_for_send_confirmation',
      sourceText: '现在预约多少钱？',
      replyText: '您好，具体费用需要看您的实际需求。',
    });

    const result = await service.draftApprovedReply(task);

    expect(autoUploadService.draftDouyinCommentReply).toHaveBeenCalledWith({
      accountId: 12,
      targetText: '现在预约多少钱？',
      replyText: '您好，具体费用需要看您的实际需求。',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('draft_filled');
    expect(result.nextAction).toContain('人工检查后点击发送');
  });

  it('fills a Douyin direct message reply draft without sending it', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      draftDouyinMessageReply: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/data/following/chat',
        status: 'draft_filled',
        message: '私信回复草稿已填入，未点击发送。',
        targetText: '想预约明天下午护理',
        replyText: '您好，可以预约。您方便说下大概时间和需求吗？',
        draftedAt: new Date().toISOString(),
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
      status: 'waiting_for_send_confirmation',
      sourceText: '想预约明天下午护理',
      replyText: '您好，可以预约。您方便说下大概时间和需求吗？',
    });

    const result = await service.draftApprovedReply(task);

    expect(autoUploadService.draftDouyinMessageReply).toHaveBeenCalledWith({
      accountId: 12,
      targetText: '想预约明天下午护理',
      replyText: '您好，可以预约。您方便说下大概时间和需求吗？',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('draft_filled');
    expect(result.nextAction).toContain('人工检查后点击发送');
  });

  it('blocks draft filling when the required browser capability disappears before approval execution', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue({
        ...fullCapabilities,
        supportedTaskTypes: [
          {
            key: 'douyin-comment-reply',
            platformType: 3,
            platformName: '抖音',
            entryType: 'douyin-comment-reply',
            stages: ['entry-preflight', 'target-read'],
            controlledSend: false,
            evidence: ['snapshot'],
          },
        ],
      }),
      draftDouyinCommentReply: jest.fn(),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      status: 'waiting_for_send_confirmation',
      sourceText: '现在预约多少钱？',
      replyText: '您好，具体费用需要看您的实际需求。',
    });

    const result = await service.draftApprovedReply(task);

    expect(autoUploadService.draftDouyinCommentReply).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe('unsupported');
    expect(result.message).toContain('缺少真实执行阶段');
    expect(result.nextAction).toContain('补齐 发布服务');
  });

  it('blocks unreleased WeChat group broadcast and moments execution at executor level', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      executeWechatGroupBroadcast: jest.fn(),
      executeWechatMomentsPublish: jest.fn(),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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

    const groupTask = createTask({
      type: 'wechat-group-broadcast',
      typeLabel: '微信群发',
      sendMode: 'auto-send',
    });
    const momentsTask = createTask({
      type: 'wechat-moments-publish',
      typeLabel: '朋友圈发布',
      sendMode: 'auto-send',
    });

    const groupDraft = await service.draftApprovedReply(groupTask);
    const groupSend = await service.autoSendReply(groupTask);
    const momentsDraft = await service.draftApprovedReply(momentsTask);
    const momentsSend = await service.autoSendReply(momentsTask);

    expect(groupDraft).toEqual(
      expect.objectContaining({
        ok: false,
        status: 'unsupported',
        message: expect.stringContaining('微信群发还没有完成商用保护'),
      }),
    );
    expect(groupSend.status).toBe('unsupported');
    expect(momentsDraft).toEqual(
      expect.objectContaining({
        ok: false,
        status: 'unsupported',
        message: expect.stringContaining('朋友圈发布还没有完成商用保护'),
      }),
    );
    expect(momentsSend.status).toBe('unsupported');
    expect(autoUploadService.executeWechatGroupBroadcast).not.toHaveBeenCalled();
    expect(autoUploadService.executeWechatMomentsPublish).not.toHaveBeenCalled();
  });

  it('fails Douyin direct message draft filling with relogin guidance when login expires after approval', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      draftDouyinMessageReply: jest
        .fn()
        .mockRejectedValue(new Error('403 login expired')),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
      status: 'waiting_for_send_confirmation',
      sourceText: '想预约明天下午护理',
      replyText: '您好，可以预约。您方便说下大概时间和需求吗？',
    });

    const result = await service.draftApprovedReply(task);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('message_missing');
    expect(result.message).toBe('抖音私信草稿填入时疑似登录态失效');
    expect(result.nextAction).toContain('重新登录抖音账号');
    expect(result.evidence).toEqual(
      expect.objectContaining({
        type: 'failure_reason',
        label: '私信草稿填入失败',
        value: '403 login expired',
      }),
    );
  });

  it('opens the Douyin direct message entry and reads a message candidate without sending', async () => {
    const aiReply = '您好，可以预约。您方便说下明天下午大概几点吗？';
    const aiGenerate = jest.fn().mockResolvedValue(
      JSON.stringify({
        shouldReply: true,
        index: 0,
        replyText: aiReply,
        reason: '客户要预约',
      }),
    );
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-direct-message-reply',
        entryName: '私信入口预检',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 消息 私信',
        status: 'opened',
      }),
      readDouyinMessages: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        messages: [{ text: '想预约明天下午护理', looksLikeMessage: true }],
        pageTextSample: '创作者服务中心 消息 私信 想预约明天下午护理',
        readAt: new Date().toISOString(),
      }),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
      { generate: aiGenerate } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ topicSelection: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );
    const task = createTask({
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(autoUploadService.openInteractionEntry).toHaveBeenCalledWith({
      accountId: 12,
      entryType: 'douyin-direct-message-reply',
    });
    expect(autoUploadService.readDouyinMessages).toHaveBeenCalledWith({
      accountId: 12,
      limit: 10,
    });
    expect(result.state).toBe('preflight_only');
    expect(result.targetText).toBe('想预约明天下午护理');
    expect(result.replyText).toBe(aiReply);
    expect(result.readyForApproval).toBe(true);
    expect(
      task.events.some((event) => event.evidence?.value.includes('消息 私信')),
    ).toBe(true);
    expect(
      task.events.some((event) => event.message.includes('待确认私信回复')),
    ).toBe(true);
  });

  it('generates Douyin direct message replies with AI from the real message text', async () => {
    const aiReply = '您好，可以安排。您方便说下明天下午大概几点和具体需求吗？';
    const aiGenerate = jest.fn().mockResolvedValue(
      JSON.stringify({
        shouldReply: true,
        index: 0,
        replyText: aiReply,
        reason: '客户预约护理',
      }),
    );
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-direct-message-reply',
        entryName: '私信入口预检',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 消息 私信',
        status: 'opened',
      }),
      readDouyinMessages: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        messages: [{ text: '我想约明天下午做护理', looksLikeMessage: true }],
        pageTextSample: '创作者服务中心 消息 私信 我想约明天下午做护理',
        readAt: new Date().toISOString(),
      }),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
      { generate: aiGenerate } as any,
      {
        getDefaults: jest
          .fn()
          .mockResolvedValue({ topicSelection: 'model-commercial' }),
      } as any,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ reply: 'test', shouldSend: true }),
      } as any,
    );
    const task = createTask({
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);
    const [, messages] = aiGenerate.mock.calls[0] as [
      string,
      Array<{ role: string; content: string }>,
      unknown,
    ];

    expect(aiGenerate).toHaveBeenCalledTimes(1);
    expect(messages[1].content).toContain('[0] 我想约明天下午做护理');
    expect(result.replyText).toBe(aiReply);
    expect(
      task.steps?.find((step) => step.key === 'reply-generate')?.message,
    ).toBe('AI 已按真实私信内容生成回复。');
    expect(task.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: expect.objectContaining({
            label: 'AI 识别并生成回复',
            value: aiReply,
          }),
        }),
      ]),
    );
  });

  it('marks Douyin comment tasks as no target when only empty or skipped candidates are found', async () => {
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-comment-reply',
        entryName: '评论管理预检',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 评论管理',
        status: 'opened',
      }),
      readDouyinComments: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/creator-micro/content/manage',
        title: '作品管理',
        comments: [{ text: '   ' }, { text: '已处理用户', handled: true }],
        summary: {
          totalCandidates: 2,
          usableCount: 0,
          emptyReason: '评论为空或已经处理',
        },
        pageTextSample: '暂无新的评论需要处理',
        readAt: new Date().toISOString(),
      }),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask();
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.state).toBe('preflight_only');
    expect(result.terminalStatus).toBe('no_target');
    expect(result.nextAction).toContain('没有识别到需要回复的真实客户评论');
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'skipped',
    );
    expect(
      task.steps?.find((step) => step.key === 'send-approval')?.status,
    ).toBe('skipped');
    expect(
      task.events.some((event) =>
        event.message.includes('AI 未识别到可回复的真实客户评论'),
      ),
    ).toBe(true);
    expect(
      task.steps?.find((step) => step.key === 'target-read')?.message,
    ).toBe('AI 未识别到可回复的真实客户评论。');
  });

  it('marks Douyin direct message tasks as no target when no readable message is found', async () => {
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-direct-message-reply',
        entryName: '私信入口预检',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 消息 私信',
        status: 'opened',
      }),
      readDouyinMessages: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        messages: [],
        pageTextSample: '创作者服务中心 消息 私信',
        readAt: new Date().toISOString(),
      }),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.state).toBe('preflight_only');
    expect(result.terminalStatus).toBe('no_target');
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'skipped',
    );
    expect(
      task.events.some((event) =>
        event.message.includes('未扫描到可用私信文本'),
      ),
    ).toBe(false);
    expect(
      task.events.some((event) =>
        event.message.includes('AI 未识别到可回复的真实客户私信'),
      ),
    ).toBe(true);
    expect(
      task.steps?.find((step) => step.key === 'target-read')?.message,
    ).toBe('AI 未识别到可回复的真实客户私信。');
  });

  it('does not treat Douyin platform prompts as customer direct messages', async () => {
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-direct-message-reply',
        entryName: '私信入口预检',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 消息 私信',
        status: 'opened',
      }),
      readDouyinMessages: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        messages: [
          {
            text: '老李会员资料共享群4️⃣ 04:00 你收到一条新类型消息，请打开抖音app查看',
            looksLikeMessage: true,
          },
        ],
        summary: {
          totalCandidates: 1,
          usableCount: 1,
        },
        pageTextSample:
          '老李会员资料共享群4️⃣ 04:00 你收到一条新类型消息，请打开抖音app查看',
        readAt: new Date().toISOString(),
      }),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
      sendMode: 'auto-send',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.terminalStatus).toBe('no_target');
    expect(result.targetText).toBeUndefined();
    expect(result.replyText).toBeUndefined();
    expect(
      task.steps?.find((step) => step.key === 'reply-generate')?.status,
    ).toBe('skipped');
    expect(
      task.steps?.find((step) => step.key === 'send-approval')?.status,
    ).toBe('skipped');
    expect(
      task.events.some((event) => event.message.includes('自动发送私信回复')),
    ).toBe(false);
  });

  it('fails Douyin direct message tasks with relogin guidance when read throws login expired', async () => {
    const autoUploadService = withReadyDouyinPreflight({
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 12,
        accountName: '抖音账号',
        platformType: 3,
        platformName: '抖音',
        entryType: 'douyin-direct-message-reply',
        entryName: '私信入口预检',
        url: 'https://creator.douyin.com/',
        title: '抖音创作者服务中心',
        loggedIn: true,
        pageTextSample: '创作者服务中心 消息 私信',
        status: 'opened',
      }),
      readDouyinMessages: jest
        .fn()
        .mockRejectedValue(new Error('401 login expired')),
    });
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.state).toBe('executor_missing');
    expect(result.terminalStatus).toBe('failed');
    expect(result.failureReason).toBe('抖音私信读取时疑似登录失效');
    expect(result.nextAction).toContain('重新登录抖音账号');
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'blocked',
    );
    expect(
      task.steps?.find((step) => step.key === 'send-approval')?.status,
    ).toBe('blocked');
  });

  it('marks WeChat entry preflight as login blocked when the page looks logged out', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 22,
        accountName: '视频号账号',
        platformType: 2,
        platformName: '视频号',
        entryType: 'wechat-reply-draft',
        entryName: '微信/视频号互动入口预检',
        url: 'https://channels.weixin.qq.com/platform/login',
        title: '视频号助手',
        loggedIn: false,
        pageTextSample: '扫码登录 手机登录 密码登录',
        status: 'opened',
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '22',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复草稿',
      platformType: 2,
      platformName: '视频号',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.failureReason).toBe('视频号/微信入口疑似未登录');
    expect(result.nextAction).toContain('重新登录视频号/微信账号');
    expect(
      task.events.some((event) => event.message.includes('疑似未登录')),
    ).toBe(true);
  });

  it('preflights WeChat desktop draft tasks when desktop WeChat is available', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 22,
        accountName: '视频号账号',
        platformType: 2,
        platformName: '视频号',
        entryType: 'wechat-reply-draft',
        entryName: '微信/视频号互动入口预检',
        url: 'https://channels.weixin.qq.com/platform',
        title: '视频号助手',
        loggedIn: true,
        pageTextSample: '视频号助手',
        status: 'opened',
      }),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'Darwin',
        available: true,
        running: true,
        appName: 'WeChat',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        permissionHints: [],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        message:
          '已检测到桌面微信进程，确认后可把草稿粘贴到当前微信会话输入框。',
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '22',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复草稿',
      platformType: 2,
      platformName: '视频号',
      sourceText: '方便发一下门店地址吗？',
      replyText: '您好，可以的，我们把地址发您。',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.state).toBe('preflight_only');
    expect(result.readyForApproval).toBe(true);
    expect(autoUploadService.getWechatDesktopStatus).toHaveBeenCalled();
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'completed',
    );
    expect(
      task.events.some((event) => event.message.includes('待确认微信草稿')),
    ).toBe(true);
  });

  it('blocks WeChat draft preflight when desktop permissions or window are uncertain', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 22,
        accountName: '视频号账号',
        platformType: 2,
        platformName: '视频号',
        entryType: 'wechat-reply-draft',
        entryName: '微信/视频号互动入口预检',
        url: 'https://channels.weixin.qq.com/platform',
        title: '视频号助手',
        loggedIn: true,
        pageTextSample: '视频号助手',
        status: 'opened',
      }),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'Darwin',
        available: true,
        running: true,
        appName: 'WeChat',
        windowCount: 2,
        currentWindowTitle: '微信',
        frontmost: false,
        permissionHints: ['缺少辅助功能权限', '缺少屏幕录制权限'],
        screenshotAvailable: false,
        inputControlAvailable: false,
        clickControlAvailable: false,
        message: '桌面微信窗口不确定',
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '22',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复草稿',
      platformType: 2,
      platformName: '视频号',
      sourceText: '方便发一下门店地址吗？',
      replyText: '您好，可以的，我们把地址发您。',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.state).toBe('executor_missing');
    expect(result.terminalStatus).toBe('failed');
    expect(result.failureReason).toContain('桌面微信 preflight 未通过');
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'blocked',
    );
    expect(
      task.steps?.find((step) => step.key === 'send-approval')?.status,
    ).toBe('blocked');
    expect(
      task.events.some((event) => event.evidence?.label === '桌面微信'),
    ).toBe(true);
  });

  it('fails WeChat draft preflight when the desktop engine omits required control capabilities', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      openInteractionEntry: jest.fn().mockResolvedValue({
        accountId: 22,
        accountName: '视频号账号',
        platformType: 2,
        platformName: '视频号',
        entryType: 'wechat-reply-draft',
        entryName: '微信/视频号互动入口预检',
        url: 'https://channels.weixin.qq.com/platform',
        title: '视频号助手',
        loggedIn: true,
        pageTextSample: '视频号助手',
        status: 'opened',
      }),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'Darwin',
        available: true,
        running: true,
        appName: 'WeChat',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        permissionHints: [],
        screenshotAvailable: false,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: false,
        message: '旧版桌面状态只声明窗口，不声明截图/输入/点击/文件选择。',
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '22',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复草稿',
      platformType: 2,
      platformName: '视频号',
      sourceText: '方便发一下门店地址吗？',
      replyText: '您好，可以的，我们把地址发您。',
    });
    const runtime = createRuntime(task);

    const result = await service.preflightTask(task, runtime);

    expect(result.state).toBe('executor_missing');
    expect(result.terminalStatus).toBe('failed');
    expect(result.failureReason).toContain('截图能力不可用');
    expect(
      task.events.some((event) =>
        String(event.evidence?.value || '').includes('文件选择能力不可用'),
      ),
    ).toBe(true);
    expect(task.steps?.find((step) => step.key === 'target-read')?.status).toBe(
      'blocked',
    );
    expect(
      task.steps?.find((step) => step.key === 'reply-generate')?.status,
    ).toBe('blocked');
  });

  it('pastes a WeChat draft without sending it', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'Darwin',
        available: true,
        running: true,
        appName: 'WeChat',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        permissionHints: [],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        message: '已检测到桌面微信进程。',
      }),
      checkWechatAlive: jest.fn().mockResolvedValue({ alive: true }),
      listWechatWindows: jest.fn().mockResolvedValue({
        windows: [{ id: 'w1', title: '张先生', isMain: true }],
      }),
      dismissWechatPopup: jest.fn().mockResolvedValue({ dismissed: false }),
      resolveWechatContact: jest.fn().mockResolvedValue({
        matches: [{ name: '张先生', remark: '', id: 'c1' }],
        ambiguous: false,
      }),
      draftWechatReply: jest.fn().mockResolvedValue({
        status: 'draft_filled',
        message: '微信回复草稿已粘贴到当前会话输入框，未点击发送。',
        targetText: '方便发一下门店地址吗？',
        replyText: '您好，可以的，我们把地址发您。',
        desktop: {
          platform: 'Darwin',
          available: true,
          running: true,
          appName: 'WeChat',
          windowCount: 1,
          currentWindowTitle: '张先生',
          message: '已检测到桌面微信进程。',
        },
        draftedAt: new Date().toISOString(),
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '22',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复草稿',
      status: 'waiting_for_send_confirmation',
      platformType: 2,
      platformName: '视频号',
      sourceText: '方便发一下门店地址吗？',
      replyText: '您好，可以的，我们把地址发您。',
    });

    const result = await service.draftApprovedReply(task);

    expect(autoUploadService.draftWechatReply).toHaveBeenCalledWith({
      targetText: '方便发一下门店地址吗？',
      replyText: '您好，可以的，我们把地址发您。',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('draft_filled');
    expect(result.nextAction).toContain('手动发送');
  });

  it('auto sends a WeChat reply through the real desktop sender when enabled', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'Darwin',
        available: true,
        running: true,
        appName: 'WeChat',
        windowCount: 1,
        currentWindowTitle: '张先生',
        frontmost: true,
        permissionHints: [],
        screenshotAvailable: true,
        inputControlAvailable: true,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        message: '已检测到桌面微信进程。',
      }),
      checkWechatAlive: jest.fn().mockResolvedValue({ alive: true }),
      listWechatWindows: jest.fn().mockResolvedValue({
        windows: [{ id: 'w1', title: '张先生', isMain: true }],
      }),
      dismissWechatPopup: jest.fn().mockResolvedValue({ dismissed: false }),
      sendWechatReply: jest.fn().mockResolvedValue({
        status: 'sent',
        sent: true,
        message: '微信回复已由系统自动发出，并确认输入框已清空。',
        targetText: '张先生',
        replyText: '您好，可以的，我们把地址发您。',
        evidence: {
          type: 'screenshot',
          label: '微信发送截图',
          value: '/tmp/wechat-send.png',
        },
        draftedAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        readbackText: '您好，可以的，我们把地址发您。',
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '22',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复',
      status: 'running',
      platformType: 2,
      platformName: '微信',
      targetName: '张先生',
      sourceText: '张先生',
      replyText: '您好，可以的，我们把地址发您。',
      sendMode: 'auto-send',
    });

    const result = await service.autoSendReply(task);

    expect(autoUploadService.sendWechatReply).toHaveBeenCalledWith({
      targetText: '张先生',
      replyText: '您好，可以的，我们把地址发您。',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(result.nextAction).toContain('自动发出');
  });

  it('auto sends a Douyin direct message through the persistent browser sender', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue({
        ...fullCapabilities,
        supportedTaskTypes: fullCapabilities.supportedTaskTypes.map((item) =>
          item.key === 'douyin-direct-message-reply'
            ? {
                ...item,
                stages: [
                  'entry-preflight',
                  'target-read',
                  'draft-fill',
                  'auto-send',
                ],
                autoSend: true,
              }
            : item,
        ),
      }),
      sendDouyinMessageReply: jest.fn().mockResolvedValue({
        status: 'sent',
        sent: true,
        message: '私信回复已点击发送，回复输入框已清空或关闭。',
        targetText: '在哪',
        replyText: '您好，店铺入口在抖音主页。',
        evidence: {
          type: 'screenshot',
          label: '私信发送截图',
          value: '/tmp/douyin-message-send.png',
        },
        draftedAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        runtimeMode: 'persistent-cdp-browser',
        readbackText: '您好，店铺入口在抖音主页。',
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '1',
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
      sourceText: '在哪',
      replyText: '您好，店铺入口在抖音主页。',
      sendMode: 'auto-send',
    });

    const result = await service.autoSendReply(task);

    expect(autoUploadService.sendDouyinMessageReply).toHaveBeenCalledWith({
      accountId: 1,
      targetText: '在哪',
      replyText: '您好，店铺入口在抖音主页。',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(result.nextAction).toContain('自动发出');
  });

  it('does not treat a Douyin screenshot-only send result as commercial success', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue({
        ...fullCapabilities,
        supportedTaskTypes: fullCapabilities.supportedTaskTypes.map((item) =>
          item.key === 'douyin-direct-message-reply'
            ? {
                ...item,
                stages: [
                  'entry-preflight',
                  'target-read',
                  'draft-fill',
                  'auto-send',
                ],
                autoSend: true,
              }
            : item,
        ),
      }),
      sendDouyinMessageReply: jest.fn().mockResolvedValue({
        status: 'sent',
        sent: true,
        message: '私信回复已点击发送，回复输入框已清空或关闭。',
        targetText: '在哪',
        replyText: '您好，店铺入口在抖音主页。',
        evidence: {
          type: 'screenshot',
          label: '私信发送截图',
          value: '/tmp/douyin-message-send.png',
        },
        draftedAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        runtimeMode: 'persistent-cdp-browser',
        editorCleared: true,
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '1',
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
      sourceText: '在哪',
      replyText: '您好，店铺入口在抖音主页。',
      sendMode: 'auto-send',
    });

    const result = await service.autoSendReply(task);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('send_failed');
    expect(result.nextAction).toContain('输入框清空只能作为辅助信号');
  });

  it('does not treat replyVisible without matching readback text as commercial success', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue({
        ...fullCapabilities,
        supportedTaskTypes: fullCapabilities.supportedTaskTypes.map((item) =>
          item.key === 'douyin-direct-message-reply'
            ? {
                ...item,
                stages: [
                  'entry-preflight',
                  'target-read',
                  'draft-fill',
                  'auto-send',
                ],
                autoSend: true,
              }
            : item,
        ),
      }),
      sendDouyinMessageReply: jest.fn().mockResolvedValue({
        status: 'sent',
        sent: true,
        message: '私信回复已点击发送，页面显示有新消息。',
        targetText: '在哪',
        replyText: '您好，店铺入口在抖音主页。',
        evidence: {
          type: 'screenshot',
          label: '私信发送截图',
          value: '/tmp/douyin-message-send.png',
        },
        draftedAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        runtimeMode: 'persistent-cdp-browser',
        replyVisible: true,
      }),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '1',
      type: 'douyin-direct-message-reply',
      typeLabel: '抖音私信回复',
      sourceText: '在哪',
      replyText: '您好，店铺入口在抖音主页。',
      sendMode: 'auto-send',
    });

    const result = await service.autoSendReply(task);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('send_failed');
    expect(result.nextAction).toContain('replyVisible 只能作为辅助信号');
  });

  it('refuses to paste a WeChat draft when desktop preflight fails', async () => {
    const autoUploadService = {
      getInteractionCapabilities: jest.fn().mockResolvedValue(fullCapabilities),
      getWechatDesktopStatus: jest.fn().mockResolvedValue({
        platform: 'Darwin',
        available: true,
        running: true,
        appName: 'WeChat',
        windowCount: 1,
        currentWindowTitle: '微信',
        frontmost: true,
        permissionHints: ['缺少辅助功能权限'],
        screenshotAvailable: true,
        inputControlAvailable: false,
        clickControlAvailable: true,
        fileSelectionAvailable: true,
        message: '权限不足',
      }),
      checkWechatAlive: jest
        .fn()
        .mockResolvedValue({ alive: false, reason: '微信未登录' }),
      listWechatWindows: jest.fn().mockResolvedValue({ windows: [] }),
      dismissWechatPopup: jest.fn().mockResolvedValue({ dismissed: false }),
      resolveWechatContact: jest
        .fn()
        .mockResolvedValue({ matches: [], ambiguous: false }),
      draftWechatReply: jest.fn(),
    };
    const service = new LocalInteractionExecutorService(
      autoUploadService as any,
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
    const task = createTask({
      accountId: '22',
      type: 'wechat-reply-draft',
      typeLabel: '微信回复草稿',
      status: 'waiting_for_send_confirmation',
      platformType: 2,
      platformName: '视频号',
      sourceText: '方便发一下门店地址吗？',
      replyText: '您好，可以的，我们把地址发您。',
    });

    const result = await service.draftApprovedReply(task);

    expect(autoUploadService.draftWechatReply).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe('desktop_permission_missing');
    expect(result.message).toContain('微信未登录');
  });
});
