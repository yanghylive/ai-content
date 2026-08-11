import { Test } from '@nestjs/testing';
import { CommentAcquisitionService } from './comment-acquisition.service';
import { ReplyEngineService } from './reply-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';

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

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentAcquisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthRequestContextService, useValue: authMock },
        { provide: AutoUploadService, useValue: autoUploadMock },
        { provide: PlatformInteractionExecutor, useValue: executorMock },
        { provide: ReplyEngineService, useValue: replyEngineMock },
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
      expect(prismaMock.$executeRaw).toHaveBeenCalled();
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentAcquisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthRequestContextService, useValue: authMock },
        { provide: AutoUploadService, useValue: autoUploadMock },
        { provide: PlatformInteractionExecutor, useValue: executorMock },
        { provide: ReplyEngineService, useValue: replyEngineMock },
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
