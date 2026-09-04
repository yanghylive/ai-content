import { Test } from '@nestjs/testing';
import { CommentAcquisitionService } from './comment-acquisition.service';
import { ReplyEngineService } from './reply-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import { XiaohongshuInteractionExecutor } from '../local-engine/xiaohongshu-interaction.executor';
import { LeadRepository } from '../leads/lead.repository';
import { InteractionAdapterRegistry } from '../interaction/interaction-adapter.registry';
import { InteractionEventStore } from '../interaction/interaction-event.store';

/**
 * 构造互动适配器注册表 mock：get(platform).send 委托回 executorMock.dispatch
 * （抖音/视频号）或 xhsReply（小红书），保持既有断言不变。
 */
function makeRegistryMock(
  executorMock: { dispatch: jest.Mock },
  xhsReply?: jest.Mock,
  autoUploadMock?: {
    readDouyinComments?: jest.Mock;
    readWechatChannelComments?: jest.Mock;
  },
  xhsRead?: jest.Mock,
) {
  return {
    get: (platform: string) => ({
      capability: {
        platform,
        displayName: platform,
        supportedTasks: ['comment-reply', 'direct-message-reply'],
        supportsReadback: true,
        adapterVersion: 'mock',
      },
      read: async (input: {
        platform: string;
        taskType: string;
        accountId: number | string;
        limit?: number;
      }) => {
        if (platform === 'xiaohongshu') {
          const raw =
            (await xhsRead?.({ accountId: input.accountId, limit: input.limit })) ??
            { comments: [] };
          return {
            items: (raw.comments || [])
              .map(
                (c: { text?: string; content?: string; index?: number }) => ({
                  text: String(c.text ?? c.content ?? '').trim(),
                  ref: String(c.index ?? ''),
                }),
              )
              .filter((c: { text: string }) => c.text.length > 0),
            url: raw.url,
            readAt: new Date().toISOString(),
          };
        }
        const readFn =
          platform === 'wechat-channel'
            ? autoUploadMock?.readWechatChannelComments
            : autoUploadMock?.readDouyinComments;
        const raw =
          (await readFn?.({ accountId: input.accountId, limit: input.limit })) ??
          { comments: [] };
        return {
          items: (raw.comments || [])
            .map((c: { text?: string }) => ({ text: String(c.text ?? '').trim() }))
            .filter((c: { text: string }) => c.text.length > 0),
          title: raw.title,
          url: raw.url,
          readAt: new Date().toISOString(),
        };
      },
      send: (input: {
        platform: string;
        taskType: string;
        accountId: number | string;
        targetText: string;
        sourceText?: string;
        videoTitle?: string;
        commentRef?: string;
        replyText: string;
      }) => {
        if (platform === 'xiaohongshu') {
          return (
            xhsReply?.({
              accountId: input.accountId,
              commentIndex: Number(input.commentRef ?? 0),
              content: input.replyText,
            }) ?? { status: 'failed', message: '未实现' }
          );
        }
        if (platform === 'kuaishou') {
          // 模拟快手 adapter 尚未接 RPA 实现：send 抛「待接入」错误
          throw new Error('快手回复执行待接入：账号需 cp.kuaishou.com 实测校准回复 selector');
        }
        return executorMock.dispatch({
          platform,
          taskType: input.taskType,
          action: 'send',
          accountId: input.accountId,
          targetText: input.targetText,
          sourceText: input.sourceText,
          videoTitle: input.videoTitle,
          replyText: input.replyText,
        });
      },
    }),
  };
}

describe('CommentAcquisitionService', () => {
  let service: CommentAcquisitionService;

  const prismaMock = {
    $executeRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    publishAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    },
    sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    })),
    empty: jest.fn(),
    lead: {
      findFirst: jest.fn().mockResolvedValue({
        status: 'approved',
        latestReply: '私信你',
        commentRef: null,
        sourceText: '怎么买',
      }),
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
  const xhsMock = { readComments: jest.fn(), replyComment: jest.fn() };
  const interactionRegistryMock = makeRegistryMock(executorMock, xhsMock.replyComment, autoUploadMock, xhsMock.readComments);
  const replyEngineMock = {
    scoreLeadPotential: jest.fn(),
    generateReply: jest.fn(),
    isHighRisk: jest.fn().mockReturnValue(false),
  };
  const leadRepositoryMock = {
    upsert: jest.fn().mockResolvedValue({
      lead: { id: 'lead-mock-id', userId: 'u1', tenantId: null, dedupeKey: 'lead:mock' },
      created: true,
    }),
    updateReplyStatus: jest.fn().mockResolvedValue(undefined),
  };
  const interactionEventStoreMock = {
    fromInteractionItem: jest.fn((platform, accountId, item, context) => ({
      platform,
      accountId: String(accountId),
      externalEventId: item.ref,
      authorExternalId: item.authorId,
      sourceUrl: context?.sourceUrl,
      body: item.text,
    })),
    ingest: jest.fn().mockResolvedValue({ event: { id: 'event-comment-1' } }),
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
        { provide: InteractionAdapterRegistry, useValue: interactionRegistryMock },
        { provide: InteractionEventStore, useValue: interactionEventStoreMock },
      ],
    }).compile();
    service = moduleRef.get(CommentAcquisitionService);
  });

  describe('scanAccount', () => {
    it('低风险 autoReply 真实外发并计数 replies（P0-3 修复：伪自动→真自动）', async () => {
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
      replyEngineMock.isHighRisk.mockReturnValue(false);
      executorMock.dispatch.mockResolvedValue({
        status: 'sent',
        readbackText: '私信我发你详情～',
      });
      // dispatchReply 的 assertReplyLead 需要 lead.status=approved + sourceText 匹配
      // 两条 lead 依次返回各自 sourceText；用 Once 避免污染后续 dispatchReply 独立测试
      prismaMock.lead.findFirst
        .mockResolvedValueOnce({
          status: 'approved',
          latestReply: '私信我发你详情～',
          commentRef: null,
          sourceText: '这个多少钱？怎么买？',
          sourceType: 'comment',
        })
        .mockResolvedValueOnce({
          status: 'approved',
          latestReply: '私信我发你详情～',
          commentRef: null,
          sourceText: '请问怎么报名？',
          sourceType: 'comment',
        });

      const result = await service.scanAccount({
        platform: 'douyin',
        accountId: 1,
        autoReply: true,
      });

      expect(result.scanned).toBe(3);
      expect(result.leads).toBe(2);
      expect(result.replies).toBe(2); // 两条 lead 均低风险，自动外发成功
      expect(executorMock.dispatch).toHaveBeenCalledTimes(2);
      expect(interactionEventStoreMock.ingest).toHaveBeenCalledTimes(2);
      expect(leadRepositoryMock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceInteractionEventId: 'event-comment-1',
          sourceAccountId: '1',
        }),
      );
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
      executorMock.dispatch.mockResolvedValue({
        status: 'sent',
        readbackText: '私信你',
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

    it('拒绝未审核线索，且不会调用平台发送', async () => {
      prismaMock.lead.findFirst.mockResolvedValueOnce({
        status: 'pending',
        latestReply: '私信你',
        commentRef: null,
        sourceText: '怎么买',
      });

      await expect(
        service.dispatchReply(
          'lead-pending',
          {
            platform: 'douyin',
            accountId: 1,
            commentText: '怎么买',
            replyText: '私信你',
          },
          { tenantId: null, userId: 'u1' },
        ),
      ).rejects.toThrow('线索尚未审核通过');
      expect(executorMock.dispatch).not.toHaveBeenCalled();
    });

    it('线索未生成回复草稿（latestReply 空）时拒绝发送任意内容（P2-2 防篡改）', async () => {
      prismaMock.lead.findFirst.mockResolvedValueOnce({
        status: 'approved',
        latestReply: null,
        commentRef: null,
        sourceText: '怎么买',
      });

      await expect(
        service.dispatchReply(
          'lead-no-draft',
          {
            platform: 'douyin',
            accountId: 1,
            commentText: '怎么买',
            replyText: '随便发点什么',
          },
          { tenantId: null, userId: 'u1' },
        ),
      ).rejects.toThrow('未生成回复草稿');
      expect(executorMock.dispatch).not.toHaveBeenCalled();
    });

    it('无回读或截图证据的 sent 不能标记 replied', async () => {
      executorMock.dispatch.mockResolvedValue({ status: 'sent' });

      const ok = await service.dispatchReply(
        'lead-no-evidence',
        {
          platform: 'douyin',
          accountId: 1,
          commentText: '怎么买',
          replyText: '私信你',
        },
        { tenantId: null, userId: 'u1' },
      );

      expect(ok).toBe(false);
      expect(leadRepositoryMock.updateReplyStatus).toHaveBeenLastCalledWith(
        'lead-no-evidence',
        expect.objectContaining({
          status: 'failed',
          lastError: '平台未提供发送回读或截图证据',
        }),
      );
    });

    it('快手未接入（send 抛「待接入」）落 not_integrated，不记熔断（S2-3 能力门）', async () => {
      prismaMock.lead.findFirst.mockResolvedValueOnce({
        status: 'approved',
        latestReply: '私信你',
        commentRef: null,
        sourceText: '怎么买',
      });

      const ok = await service.dispatchReply(
        'lead-ks',
        {
          platform: 'kuaishou',
          accountId: 1,
          commentText: '怎么买',
          replyText: '私信你',
        },
        { tenantId: null, userId: 'u1' },
      );

      expect(ok).toBe(false);
      expect(leadRepositoryMock.updateReplyStatus).toHaveBeenLastCalledWith(
        'lead-ks',
        expect.objectContaining({ status: 'not_integrated' }),
      );
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
    publishAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    },
    lead: {
      findFirst: jest.fn().mockResolvedValue({
        status: 'approved',
        latestReply: '私信你',
        commentRef: null,
        sourceText: '怎么买',
      }),
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
  const xhsMock = { readComments: jest.fn(), replyComment: jest.fn() };
  const interactionRegistryMock = makeRegistryMock(executorMock, xhsMock.replyComment, autoUploadMock, xhsMock.readComments);
  const replyEngineMock = {
    scoreLeadPotential: jest.fn(),
    generateReply: jest.fn(),
    isHighRisk: jest.fn().mockReturnValue(false),
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
        { provide: InteractionAdapterRegistry, useValue: interactionRegistryMock },
        {
          provide: InteractionEventStore,
          useValue: {
            fromInteractionItem: jest.fn(),
            ingest: jest.fn().mockResolvedValue({ event: { id: 'event-test' } }),
          },
        },
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
    publishAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    },
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
    isHighRisk: jest.fn().mockReturnValue(false),
  };
  const leadRepositoryMock = {
    upsert: jest.fn().mockResolvedValue({
      lead: { id: 'lead-mock-id', userId: 'u1', tenantId: null, dedupeKey: 'lead:mock' },
      created: true,
    }),
    updateReplyStatus: jest.fn().mockResolvedValue(undefined),
  };
  const interactionRegistryMock = makeRegistryMock(executorMock, xhsMock.replyComment, autoUploadMock, xhsMock.readComments);

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
        { provide: InteractionAdapterRegistry, useValue: interactionRegistryMock },
        {
          provide: InteractionEventStore,
          useValue: {
            fromInteractionItem: jest.fn(),
            ingest: jest.fn().mockResolvedValue({ event: { id: 'event-test' } }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(CommentAcquisitionService);
  });

  it('小红书低风险 autoReply 真实调用 replyComment 外发（P0-3 修复）', async () => {
    xhsMock.readComments.mockResolvedValue({
      accountId: 3,
      title: '小红书笔记',
      comments: [{ content: '这个怎么买呀？', index: 0 }],
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
    replyEngineMock.isHighRisk.mockReturnValue(false);
    xhsMock.replyComment.mockResolvedValue({
      status: 'sent',
      message: '评论回复已发送',
      readbackText: '私信我发你详情～',
      evidenceUrl: '/api/local-engine/browser/evidence/xhs.png',
    });
    prismaMock.lead.findFirst.mockResolvedValue({
      status: 'approved',
      latestReply: '私信我发你详情～',
      commentRef: '0',
      sourceText: '这个怎么买呀？',
      sourceType: 'comment',
    });

    const result = await service.scanAccount({
      platform: 'xiaohongshu',
      accountId: 3,
      autoReply: true,
    });

    expect(xhsMock.readComments).toHaveBeenCalled();
    expect(result.leads).toBe(1);
    expect(result.replies).toBe(1); // 低风险自动外发成功
    expect(xhsMock.replyComment).toHaveBeenCalledTimes(1);
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
    publishAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    },
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
    listAccounts: jest.fn(),
  };
  const executorMock = { dispatch: jest.fn() };
  const xhsMock = { readComments: jest.fn(), replyComment: jest.fn() };
  const replyEngineMock = {
    scoreLeadPotential: jest.fn(),
    generateReply: jest.fn(),
    isHighRisk: jest.fn().mockReturnValue(false),
  };
  const leadRepositoryMock = {
    upsert: jest.fn().mockResolvedValue({
      lead: { id: 'lead-mock-id', userId: 'u1', tenantId: null, dedupeKey: 'lead:mock' },
      created: true,
    }),
    updateReplyStatus: jest.fn().mockResolvedValue(undefined),
  };
  const interactionRegistryMock = makeRegistryMock(executorMock, xhsMock.replyComment, autoUploadMock, xhsMock.readComments);

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
        { provide: InteractionAdapterRegistry, useValue: interactionRegistryMock },
        {
          provide: InteractionEventStore,
          useValue: {
            fromInteractionItem: jest.fn(),
            ingest: jest.fn().mockResolvedValue({ event: { id: 'event-test' } }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(CommentAcquisitionService);
  });

  it('私信低风险 autoReply 真实 dispatch direct-message-reply（P0-3 修复）', async () => {
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
    replyEngineMock.isHighRisk.mockReturnValue(false);
    executorMock.dispatch.mockResolvedValue({
      status: 'sent',
      readbackText: '私信你详细报价',
    });
    prismaMock.lead.findFirst.mockResolvedValue({
      status: 'approved',
      latestReply: '私信你详细报价',
      commentRef: null,
      sourceText: '你们的产品怎么收费？',
      sourceType: 'dm',
    });

    const result = await service.scanDm({
      platform: 'douyin',
      accountId: 1,
      autoReply: true,
    });

    expect(result.scanned).toBe(2);
    expect(result.leads).toBe(1);
    expect(result.replies).toBe(1); // 低风险自动外发成功
    expect(executorMock.dispatch).toHaveBeenCalledTimes(1);
  });

  it('私信扫描 platform 漏传且账号推断失败时显式报错（S4-7）', async () => {
    autoUploadMock.listAccounts.mockResolvedValue([]);

    await expect(
      service.scanDm({
        platform: undefined as unknown as 'douyin',
        accountId: 999,
      }),
    ).rejects.toThrow('无法推断私信平台');
    expect(executorMock.dispatch).not.toHaveBeenCalled();
  });
});
