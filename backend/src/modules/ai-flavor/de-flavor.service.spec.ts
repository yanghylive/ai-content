import { Test } from '@nestjs/testing';
import { DeFlavorService } from './de-flavor.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DeFlavorService', () => {
  let service: DeFlavorService;
  const aiClientMock = { generate: jest.fn() };
  const prismaMock = {
    aIModel: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
      // 2026-08-23 Stage 1B：默认模型改为按能力确定性选取（pickDefaultModel 用 findMany）
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          modelId: 'deepseek-v4-flash',
          name: 'DeepSeek Flash',
          platformId: 'p1',
        },
      ]),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeFlavorService,
        { provide: AiClientService, useValue: aiClientMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(DeFlavorService);
  });

  it('自然文本直接通过，不调 LLM', async () => {
    const result = await service.deFlavor(
      '哈哈哈这个真得试试，我之前也踩过坑。说实话一开始没抱希望。',
    );
    expect(result.pass).toBe(true);
    expect(result.retries).toBe(0);
    expect(aiClientMock.generate).not.toHaveBeenCalled();
  });

  it('AI 味文本改写并通过复检', async () => {
    aiClientMock.generate.mockResolvedValue(
      '说实话一开始没抱希望，结果用了两周真的不一样了。\n价格也不贵，你说是不是？',
    );
    const result = await service.deFlavor(
      '值得注意的是，综上所述我们需要赋能业务闭环。首先我们要提升颗粒度，其次我们要实现底层逻辑的破局，最后毫无疑问这是非常重要的。同时我们还应该注意，不可否认这个方案具有重要意义。',
    );
    expect(result.originalScore).toBeGreaterThanOrEqual(30);
    expect(result.resultText).toContain('说实话');
    expect(result.retries).toBeGreaterThanOrEqual(1);
    expect(aiClientMock.generate).toHaveBeenCalled();
    // prompt 里带了命中信号
    const [, messages] = aiClientMock.generate.mock.calls[0];
    expect(messages[1].content).toContain('改写');
  });

  it('改写后仍未达标时保留最优结果并标注', async () => {
    aiClientMock.generate.mockResolvedValue(
      '值得注意的是，综上所述还是有很多值得关注的要点。首先我们来看第一个方面，其次我们来看第二个方面。',
    );
    const result = await service.deFlavor(
      '值得注意的是，综上所述我们需要赋能业务闭环。首先我们要提升颗粒度，其次我们要实现底层逻辑的破局，最后毫无疑问这是非常重要的。同时我们还应该注意，不可否认这个方案具有重要意义。',
    );
    expect(result.retries).toBeGreaterThanOrEqual(1);
    expect(typeof result.pass).toBe('boolean');
  });

  it('无 AI Client 降级：原文返回', async () => {
    const fallback = new DeFlavorService(undefined, undefined);
    const result = await fallback.deFlavor(
      '值得注意的是，综上所述，我们需要赋能业务闭环。首先我们要提升颗粒度，其次我们要实现底层逻辑的破局，最后毫无疑问这是非常重要的。',
    );
    expect(result.resultText).toContain('值得注意的是');
    expect(result.pass).toBe(false);
  });
});
