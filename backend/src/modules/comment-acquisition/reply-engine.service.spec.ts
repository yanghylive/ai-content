import { Test } from '@nestjs/testing';
import {
  PersonaBinder,
  ReplyEngineService,
} from './reply-engine.service';
import {
  REPLY_PERSONAS,
  detectForbiddenWords,
  pickReplyPersona,
} from './personas';
import { AiClientService } from '../ai-models/ai-client.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ReplyEngineService', () => {
  let service: ReplyEngineService;

  const aiClientMock = {
    generate: jest.fn(),
  };
  const prismaMock = {
    aIModel: {
      findFirst: jest.fn().mockResolvedValue({ id: 'model-1' }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReplyEngineService,
        { provide: AiClientService, useValue: aiClientMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(ReplyEngineService);
  });

  describe('人格池', () => {
    it('7 种人格齐全且有唯一 id', () => {
      const ids = new Set(REPLY_PERSONAS.map((p) => p.id));
      expect(ids.size).toBe(7);
      expect(REPLY_PERSONAS.every((p) => p.weight > 0)).toBe(true);
      expect(
        REPLY_PERSONAS.every((p) => p.forbiddenWords.length > 0),
      ).toBe(true);
    });

    it('pickReplyPersona 排除指定人格', () => {
      const excludeAll = REPLY_PERSONAS.map((p) => p.id);
      const persona = pickReplyPersona(excludeAll.slice(0, 6));
      expect(excludeAll.slice(0, 6)).not.toContain(persona.id);
    });
  });

  describe('PersonaBinder', () => {
    it('同一 key 复用同人格', () => {
      const binder = new PersonaBinder();
      const p1 = binder.bind('k1');
      const p2 = binder.bind('k1');
      expect(p1.id).toBe(p2.id);
    });

    it('不同 key 不强制同人格（排除最近用过的）', () => {
      const binder = new PersonaBinder();
      const p1 = binder.bind('k1');
      const p2 = binder.bind('k2');
      expect(p1.id).not.toBe(p2.id);
    });

    it('forcePersonaId 强制绑定', () => {
      const binder = new PersonaBinder();
      const p = binder.bind('k1', { forcePersonaId: 'humor_maker' });
      expect(p.id).toBe('humor_maker');
    });
  });

  describe('禁词检测', () => {
    it('命中 AI 味禁词', () => {
      const persona = REPLY_PERSONAS[0];
      const hit = detectForbiddenWords('综上所述，这个方案很好', persona);
      expect(hit).toBe('综上所述');
    });

    it('无禁词返回 null', () => {
      const persona = REPLY_PERSONAS[0];
      const hit = detectForbiddenWords('哈哈哈这也太真实了', persona);
      expect(hit).toBeNull();
    });
  });

  describe('generateReply', () => {
    it('调 LLM 生成并返回人格信息', async () => {
      aiClientMock.generate.mockResolvedValue('哈哈哈真的假的，我也试试');
      const result = await service.generateReply(
        { text: '这个怎么用啊？' },
        {
          platformName: '抖音',
          bindKey: 'douyin:1',
          content: { title: '测试视频' },
        },
      );
      expect(result.replyText).toBe('哈哈哈真的假的，我也试试');
      expect(result.personaId).toBeTruthy();
      expect(result.personaName).toBeTruthy();
      expect(aiClientMock.generate).toHaveBeenCalledTimes(1);
      // prompt 里包含评论原文（上下文隔离正确注入）
      const [, messages] = aiClientMock.generate.mock.calls[0];
      expect(messages[1].content).toContain('这个怎么用啊？');
      expect(messages[1].content).toContain('测试视频');
    });

    it('命中禁词时换人格重试', async () => {
      aiClientMock.generate
        .mockResolvedValueOnce('综上所述，这个确实不错')
        .mockResolvedValueOnce('哈哈哈真的假的，我也去试试');
      const result = await service.generateReply(
        { text: '看起来不错' },
        {
          platformName: '小红书',
          bindKey: 'xhs:1',
        },
      );
      expect(result.replyText).toContain('哈哈哈');
      expect(result.retries).toBe(1);
      expect(aiClientMock.generate).toHaveBeenCalledTimes(2);
    });

    it('无 AI Client 时返回占位回复', async () => {
      const fallback = new ReplyEngineService(undefined, undefined);
      const result = await fallback.generateReply(
        { text: '怎么买' },
        { platformName: '抖音', bindKey: 'k' },
      );
      expect(result.replyText.length).toBeGreaterThan(0);
    });
  });

  describe('潜客评分', () => {
    it('强意向词高分', () => {
      const { score, signals } = service.scoreLeadPotential({
        text: '这个多少钱？怎么买？',
      });
      expect(score).toBeGreaterThanOrEqual(50);
      expect(signals.some((s) => s.includes('强意向'))).toBe(true);
    });

    it('负面评论低分', () => {
      const { score } = service.scoreLeadPotential({
        text: '骗子，别信，太坑了',
      });
      expect(score).toBeLessThan(20);
    });

    it('shouldReply 阈值判断', () => {
      expect(service.shouldReply({ text: '怎么报名？' })).toBe(true);
      expect(service.shouldReply({ text: '哈哈' })).toBe(false);
    });
  });
});
