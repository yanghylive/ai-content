import { Test } from '@nestjs/testing';
import { ContentReviewService } from './content-review.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ContentReviewService', () => {
  let service: ContentReviewService;
  const aiClientMock = { generate: jest.fn() };
  const prismaMock = {
    aIModel: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
  };

  const goodInput = {
    titles: ['一个人到35岁才明白的3个道理'],
    pages: [
      { type: 'cover', heading: '封面', content: '深夜书桌前的中年人背影。三十五岁那年的某个深夜，我关掉电脑屏幕，突然意识到时间已经不站在我这边了。', imagePrompt: 'x' },
      { type: 'content', heading: '道理一', content: '道理一：把时间花在复利的事上。每天读30页书，一年就是20本，比刷短视频强十倍。技能是越老越值钱的资产，熬夜加班不是。建立自己的作品集，哪怕从一条朋友圈开始。坚持一年回头看，你会感谢今天开始行动的自己。', imagePrompt: 'x' },
      { type: 'content', heading: '道理二', content: '道理二：主动选择圈子。和优秀的人在一起，认知会被拉高。远离消耗你的人，把精力留给值得的事。你的收入约等于身边五个朋友的平均值，这句话虽然扎心但确实有道理。', imagePrompt: 'x' },
      { type: 'content', heading: '道理三', content: '道理三：身体是最大的复利。坚持锻炼两年，你会发现精力充沛带来的改变是全方位的。工作状态、情绪管理、甚至是家庭关系都会跟着变好。运动是最廉价的抗衰老投资，没有之一。', imagePrompt: 'x' },
      { type: 'summary', heading: '总结', content: '现在开始，永远不晚。种一棵树最好的时间是十年前，其次是现在。点个关注，我们下期聊聊怎么找到自己的复利赛道。', imagePrompt: 'x' },
    ],
    pagesContent: [
      '深夜书桌前的中年人背影。三十五岁那年的某个深夜，我关掉电脑屏幕，突然意识到时间已经不站在我这边了。',
      '道理一：把时间花在复利的事上。每天读30页书，一年就是20本，比刷短视频强十倍。技能是越老越值钱的资产，熬夜加班不是。建立自己的作品集，哪怕从一条朋友圈开始。坚持一年回头看，你会感谢今天开始行动的自己。',
      '道理二：主动选择圈子。和优秀的人在一起，认知会被拉高。远离消耗你的人，把精力留给值得的事。你的收入约等于身边五个朋友的平均值，这句话虽然扎心但确实有道理。',
      '道理三：身体是最大的复利。坚持锻炼两年，你会发现精力充沛带来的改变是全方位的。工作状态、情绪管理、甚至是家庭关系都会跟着变好。运动是最廉价的抗衰老投资，没有之一。',
      '现在开始，永远不晚。种一棵树最好的时间是十年前，其次是现在。点个关注，我们下期聊聊怎么找到自己的复利赛道。',
    ],
    pageTypes: ['cover', 'content', 'content', 'content', 'summary'],
    generatedImageCount: 5,
    aiFlavorScore: 10,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContentReviewService,
        { provide: AiClientService, useValue: aiClientMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(ContentReviewService);
  });

  it('优质内容审稿通过，不调 LLM', async () => {
    const result = await service.reviewAndRevise(goodInput);
    expect(result.review.pass).toBe(true);
    expect(result.revised).toBe(false);
    expect(aiClientMock.generate).not.toHaveBeenCalled();
  });

  it('不达标内容触发定向修订并复检', async () => {
    aiClientMock.generate.mockResolvedValue(
      [
        '一个人到35岁才明白的3个道理，第三点最扎心',
        'cover|封面|深夜书桌前的中年人背影。',
        'content|道理一|每天读30页书，一年就是20本。技能是越老越值钱的资产，建立自己的作品集。',
        'content|道理二|和优秀的人在一起，认知会被拉高。远离消耗你的人。',
        'content|道理三|坚持锻炼两年，精力充沛带来的改变是全方位的。',
        'summary|总结|现在开始，永远不晚。点个关注，下期聊聊复利赛道。',
      ].join('\n---\n'),
    );
    const badInput = {
      ...goodInput,
      titles: ['短'],
    };
    const result = await service.reviewAndRevise(badInput);
    expect(result.revised).toBe(true);
    expect(result.titles[0]).toContain('扎心');
    expect(aiClientMock.generate).toHaveBeenCalledTimes(1);
    // prompt 里带问题清单
    const [, messages] = aiClientMock.generate.mock.calls[0];
    expect(messages[1].content).toContain('title');
  });

  it('无 AI Client 降级：不修订返回原文', async () => {
    const fallback = new ContentReviewService(undefined, undefined);
    const result = await fallback.reviewAndRevise({
      ...goodInput,
      titles: ['短'],
    });
    expect(result.revised).toBe(false);
    expect(result.review.pass).toBe(false);
  });

  it('修订解析失败时回退原文', async () => {
    aiClientMock.generate.mockResolvedValue('完全无法解析的输出!!!');
    const result = await service.reviewAndRevise({
      ...goodInput,
      titles: ['短'],
    });
    expect(result.revised).toBe(true);
    expect(result.titles).toEqual(['短']); // 解析失败回退当前输入标题
  });
});
