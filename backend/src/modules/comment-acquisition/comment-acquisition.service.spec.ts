import { Test } from '@nestjs/testing';
import { CommentAcquisitionService } from './comment-acquisition.service';
import { ReplyEngineService } from './reply-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import { XiaohongshuInteractionExecutor } from '../local-engine/xiaohongshu-interaction.executor';
import { LeadRepository } from '../leads/lead.repository';

describe('CommentAcquisitionService', () => {
  let service: CommentAcquisitionService;

  const prismaMock = {
    $executeRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    })),
    empty: jest.fn(),
    lead: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const authMock = {
    get: jest.fn(() => ({
      user: { id: 'u1', kaypalLocalOnly: true },
    })),
    resolveTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
  const autoUploadMock = {
    readDouyinComments: jest.fn(),
    readWechatChannelComments: jest.fn(),
  };
  const executorMock = {
    dispatch: jest.fn(),
  };
  const replyEngineMock = {
    scoreLeadPotential: jest.fn(),
    generateReply: jest.fn(),
  };
  const leadRepositoryMock = {
    upsert: jest.fn().mockResolvedValue({
      lead: { id: 'lead-mock-id', userId: 'u1', tenantId: null, dedupeKey: 'lead:mock' },
      created: true,
    }),
    updateReplyStatus: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentAcquisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthRequestContextService, useValue: authMock },
        { provide: AutoUploadService, useValue: autoUploadMock },
        { provide: PlatformInteractionExecutor, useValue: executorMock },
        {
          provide: XiaohongshuInteractionExecutor,
          useValue: { readComments: jest.fn(), replyComment: jest.fn() },
        },
        { provide: ReplyEngineService, useValue: replyEngineMock },
        { provide: LeadRepository, useValue: leadRepositoryMock },
      ],
    }).compile();
    service = moduleRef.get(CommentAcquisitionService);
  });

  describe('scanAccount', () => {
    it('读取评论 → 评分 → 生成回复 → 入库 → 自动回复', async () => {
      autoUploadMock.readDouyinComments.mockResolvedValue({
        accountId: 1,
        title: '测试视频',
        comments: [
          { text: '这个多少钱？怎么买？' },
          { text: '哈哈' }, // 低分跳过
          { text: '请问怎么报名？' },
        ],
      });
      replyEngineMock.scoreLeadPotential.mockImplementation(
        (c: { text: string }) => {
          const score = c.text.includes('怎么') ? 60 : 5;
          return { score, signals: score > 50 ? ['强意向'] : [] };
        },
      );
      replyEngineMock.generateReply.mockResolvedValue({
        replyText: '私信我发你详情～',
        personaId: 'casual_friend',
        personaName: 'casual 朋友',
        retries: 0,
      });
      executorMock.dispatch.mockResolvedValue({ status: 'sent' });

      const result = await service.scanAccount({
        platform: 'douyin',
        accountId: 1,
        autoReply: true,
      });

      expect(result.scanned).toBe(3);
      expect(result.leads).toBe(2);
      expect(result.replies).toBe(2);
      expect(executorMock.dispatch).toHaveBeenCalledTimes(2);
      expect(executorMock.dispatch.mock.calls[0][0]).toMatchObject({
        platform: 'douyin',
        taskType: 'comment-reply',
        action: 'send',
        replyText: '私信我发你详情～',
      });
    });

    it('autoReply=false 时只入库不发送', async () => {
      autoUploadMock.readDouyinComments.mockResolvedValue({
        accountId: 1,
        title: '测试',
        comments: [{ text: '多少钱' }],
      });
      replyEngineMock.scoreLeadPotential.mockReturnValue({
        score: 55,
        signals: ['强意向'],
      });
      replyEngineMock.generateReply.mockResolvedValue({
        replyText: '详情私信',
        personaId: 'x',
        personaName: 'x',
        retries: 0,
      });

      const result = await service.scanAccount({
        platform: 'douyin',
        accountId: 1,
        autoReply: false,
      });

      expect(result.leads).toBe(1);
      expect(result.replies).toBe(0);
      expect(executorMock.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('dispatchReply', () => {
    it('发送成功标记 replied', async () => {
      executorMock.dispatch.mockResolvedValue({ status: 'sent' });
      const ok = await service.dispatchReply(
        'lead-1',
        {
          platform: 'douyin',
          accountId: 1,
          commentText: '怎么买',
          replyText: '私信你',
        },
        { tenantId: null, userId: 'u1' },
      );
      expect(ok).toBe(true);
      expect(leadRepositoryMock.updateReplyStatus).toHaveBeenCalled();
    });

    it('发送失败标记 failed 并返回 false', async () => {
      executorMock.dispatch.mockResolvedValue({
        status: 'send_failed',
        message: '平台拦截',
      });
      const ok = await service.dispatchReply(
        'lead-1',
        {
          platform: 'douyin',
          accountId: 1,
          commentText: '怎么买',
          replyText: '私信你',
        },
        { tenantId: null, userId: 'u1' },
      );
      expect(ok).toBe(false);
    });
  });
});

describe('CommentAcquisitionService 风控断路器', () => {
  let service: CommentAcquisitionService;
  const prismaMock = {
    $executeRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    sql: jest.fn(),
    empty: jest.fn(),
    lead: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const authMock = {
    get: jest.fn(() => ({ user: { id: 'u1', kaypalLocalOnly: true } })),
    resolveTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
  const autoUploadMock = {
    readDouyinComments: jest.fn(),
    readWechatChannelComments: jest.fn(),
  };
  const executorMock = { dispatch: jest.fn() };
  const replyEngineMock = {
    scoreLeadPotential: jest.fn(),
    generateReply: jest.fn(),
  };
  const leadRepositoryMock = {
    upsert: jest.fn().mockResolvedValue({
      lead: { id: 'lead-mock-id', userId: 'u1', tenantId: null, dedupeKey: 'lead:mock' },
      created: true,
    }),
    updateReplyStatus: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentAcquisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthRequestContextService, useValue: authMock },
        { provide: AutoUploadService, useValue: autoUploadMock },
        { provide: PlatformInteractionExecutor, useValue: executorMock },
        {
          provide: XiaohongshuInteractionExecutor,
          useValue: { readComments: jest.fn(), replyComment: jest.fn() },
        },
        { provide: ReplyEngineService, useValue: replyEngineMock },
        { provide: LeadRepository, useValue: leadRepositoryMock },
      ],
    }).compile();
    service = moduleRef.get(CommentAcquisitionService);
  });

  it('失败 3 次后触发熔断，scan 自动回复被跳过', async () => {
    // 前 3 次 dispatch 全失败 → 熔断
    executorMock.dispatch.mockResolvedValue({
      status: 'send_failed',
      message: '平台拦截',
    });
    for (let i = 0; i < 3; i += 1) {
      await service.dispatchReply(
        `lead-fail-${i}`,
        {
          platform: 'douyin',
          accountId: 1,
          commentText: '怎么买',
          replyText: '私信你',
        },
        { tenantId: null, userId: 'u1' },
      );
    }

    // 熔断后 scan autoReply=true 应跳过发送
    autoUploadMock.readDouyinComments.mockResolvedValue({
      accountId: 1,
      title: '测试',
      comments: [{ text: '多少钱' }],
    });
    replyEngineMock.scoreLeadPotential.mockReturnValue({
      score: 60,
      signals: ['强意向'],
    });
    replyEngineMock.generateReply.mockResolvedValue({
      replyText: '详情私信',
      personaId: 'x',
      personaName: 'x',
      retries: 0,
    });

    const result = await service.scanAccount({
      platform: 'douyin',
      accountId: 1,
      autoReply: true,
    });

    expect(result.circuitOpen).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.replies).toBe(0);
    // dispatch 仍只被调用 3 次（熔断后没有第 4 次）
    expect(executorMock.dispatch).toHaveBeenCalledTimes(3);
  });
});

describe('CommentAcquisitionService 小红书获客', () => {
  let service: CommentAcquisitionService;
  const prismaMock = {
    $executeRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    sql: jest.fn(),
    empty: jest.fn(),
    lead: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const authMock = {
    get: jest.fn(() => ({ user: { id: 'u1', kaypalLocalOnly: true } })),
    resolveTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
  const autoUploadMock = {
    readDouyinComments: jest.fn(),
    readWechatChannelComments: jest.fn(),
  };
  const executorMock = { dispatch: jest.fn() };
  const xhsMock = {
    readComments: jest.fn(),
    replyComment: jest.fn(),
  };
  const replyEngineMock = {
    scoreLeadPotential: jest.fn(),
    generateReply: jest.fn(),
  };
  const leadRepositoryMock = {
    upsert: jest.fn().mockResolvedValue({
      lead: { id: 'lead-mock-id', userId: 'u1', tenantId: null, dedupeKey: 'lead:mock' },
      created: true,
    }),
    updateReplyStatus: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentAcquisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthRequestContextService, useValue: authMock },
        { provide: AutoUploadService, useValue: autoUploadMock },
        { provide: PlatformInteractionExecutor, useValue: executorMock },
        { provide: XiaohongshuInteractionExecutor, useValue: xhsMock },
        { provide: ReplyEngineService, useValue: replyEngineMock },
        { provide: LeadRepository, useValue: leadRepositoryMock },
      ],
    }).compile();
    service = moduleRef.get(CommentAcquisitionService);
  });

  it('小红书扫描走 xhs executor，自动回复走 replyComment', async () => {
    xhsMock.readComments.mockResolvedValue({
      accountId: 3,
      title: '小红书笔记',
      comments: [
        { content: '这个怎么买呀？', index: 0 },
        { content: '多少钱', index: 1 },
      ],
    });
    replyEngineMock.scoreLeadPotential.mockReturnValue({
      score: 60,
      signals: ['强意向'],
    });
    replyEngineMock.generateReply.mockResolvedValue({
      replyText: '私信我发你详情～',
      personaId: 'x',
      personaName: 'x',
      retries: 0,
    });
    xhsMock.replyComment.mockResolvedValue({ status: 'sent', message: 'sent' });

    const result = await service.scanAccount({
      platform: 'xiaohongshu',
      accountId: 3,
      autoReply: true,
    });

    expect(xhsMock.readComments).toHaveBeenCalled();
    expect(result.leads).toBe(2);
    expect(result.replies).toBe(2);
    // 回复走小红书 executor，带评论 index
    expect(xhsMock.replyComment).toHaveBeenCalledTimes(2);
    expect(xhsMock.replyComment.mock.calls[0][0]).toMatchObject({
      commentIndex: 0,
      content: '私信我发你详情～',
    });
    // 不走通用 dispatch
    expect(executorMock.dispatch).not.toHaveBeenCalled();
  });
});

describe('CommentAcquisitionService 私信获客', () => {
  let service: CommentAcquisitionService;
  const prismaMock = {
    $executeRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    sql: jest.fn(),
    empty: jest.fn(),
    lead: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const authMock = {
    get: jest.fn(() => ({ user: { id: 'u1', kaypalLocalOnly: true } })),
    resolveTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
  const autoUploadMock = {
    readDouyinMessages: jest.fn(),
    readWechatChannelMessages: jest.fn(),
  };
  const executorMock = { dispatch: jest.fn() };
  const xhsMock = { readComments: jest.fn(), replyComment: jest.fn() };
  const replyEngineMock = {
    scoreLeadPotential: jest.fn(),
    generateReply: jest.fn(),
  };
  const leadRepositoryMock = {
    upsert: jest.fn().mockResolvedValue({
      lead: { id: 'lead-mock-id', userId: 'u1', tenantId: null, dedupeKey: 'lead:mock' },
      created: true,
    }),
    updateReplyStatus: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentAcquisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthRequestContextService, useValue: authMock },
        { provide: AutoUploadService, useValue: autoUploadMock },
        { provide: PlatformInteractionExecutor, useValue: executorMock },
        { provide: XiaohongshuInteractionExecutor, useValue: xhsMock },
        { provide: ReplyEngineService, useValue: replyEngineMock },
        { provide: LeadRepository, useValue: leadRepositoryMock },
      ],
    }).compile();
    service = moduleRef.get(CommentAcquisitionService);
  });

  it('私信扫描走 readDouyinMessages + dispatch direct-message-reply', async () => {
    autoUploadMock.readDouyinMessages.mockResolvedValue({
      accountId: 1,
      title: '抖音私信',
      messages: [{ text: '你们的产品怎么收费？' }, { text: '哈哈哈' }],
    });
    replyEngineMock.scoreLeadPotential.mockImplementation(
      (m: { text: string }) => {
        const score = m.text.includes('收费') ? 70 : 5;
        return { score, signals: score > 50 ? ['强意向'] : [] };
      },
    );
    replyEngineMock.generateReply.mockResolvedValue({
      replyText: '私信你详细报价',
      personaId: 'x',
      personaName: 'x',
      retries: 0,
    });
    executorMock.dispatch.mockResolvedValue({ status: 'sent' });

    const result = await service.scanDm({
      platform: 'douyin',
      accountId: 1,
      autoReply: true,
    });

    expect(result.scanned).toBe(2);
    expect(result.leads).toBe(1);
    expect(result.replies).toBe(1);
    expect(executorMock.dispatch).toHaveBeenCalledTimes(1);
    expect(executorMock.dispatch.mock.calls[0][0]).toMatchObject({
      taskType: 'direct-message-reply',
      replyText: '私信你详细报价',
    });
  });
});
