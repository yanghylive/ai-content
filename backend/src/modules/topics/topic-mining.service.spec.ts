import { TopicMiningService } from './topic-mining.service';

describe('TopicMiningService', () => {
  const createService = () => {
    const prisma = {
      source: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      material: {
        findMany: jest.fn(),
      },
      topic: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const aiClient = {
      generate: jest.fn(),
    };
    const defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        topicSelection: 'model-topic',
      }),
    };
    const systemLogsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const contentStrategiesService = {
      getDefaultStrategy: jest.fn().mockResolvedValue({
        name: 'AI 增长内容策略',
        industry: 'AI / 数字化增长',
        targetAudience:
          '想用 AI 提升效率、获客或打造一人业务的创业者、运营和小团队负责人',
        commercialGoal:
          '通过内容吸引目标用户，建立专业认知，并进一步转化为咨询、服务、课程或社群成交',
        corePainPoints: '不会选题、内容太空泛、缺少转化钩子',
        writingAngles: '趋势解读、痛点拆解、认知反转、实操方法、案例拆解',
        toneAndStyle: '务实、通俗、带结论',
      }),
    };
    const crawlerRegistry = {
      getCrawler: jest.fn().mockReturnValue(null),
    };
    const rssCrawler = {
      crawl: jest.fn(),
      saveResults: jest.fn(),
    };

    const service = new TopicMiningService(
      prisma as any,
      aiClient as any,
      defaultModels as any,
      systemLogsService as any,
      contentStrategiesService as any,
      crawlerRegistry as any,
      rssCrawler as any,
    );

    return {
      service,
      prisma,
      aiClient,
      defaultModels,
      systemLogsService,
      contentStrategiesService,
      crawlerRegistry,
      rssCrawler,
    };
  };

  it('会基于用户输入生成 3-5 个不同切入点的候选选题并入库', async () => {
    const {
      service,
      prisma,
      aiClient,
      systemLogsService,
      contentStrategiesService,
    } = createService();

    aiClient.generate
      .mockResolvedValueOnce(
        JSON.stringify({
          normalizedSeed: '私域运营',
          intent: '围绕私域运营挖掘可直接创作的内容方向',
          audience: '门店经营者',
          keywords: ['私域运营', '复购', '用户留存'],
          searchQueries: ['私域运营怎么提升复购', '门店私域怎么做'],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            title: '门店私域做不起来，问题往往不在加好友',
            angle: '认知反转',
            summary: '拆解私域运营常见误区，解释为什么承接设计比拉新更关键。',
            score: 89,
            dimension_scores: {
              audienceFit: 18,
              emotionalValue: 17,
              simplificationPotential: 18,
              networkVolume: 17,
              contentValue: 19,
            },
            reasoning: '适合先做长文，再延展成小红书拆解卡片。',
            keywords: ['私域运营', '门店复购'],
            search_queries: ['私域运营误区有哪些'],
            material_ids: ['m-1', 'm-2'],
          },
          {
            title: '餐饮门店提升复购，可以先从这 3 个私域动作下手',
            angle: '实操方法',
            summary: '给出三个低成本动作，帮助用户理解如何把私域真正落地。',
            score: 86,
            dimension_scores: {
              audienceFit: 17,
              emotionalValue: 16,
              simplificationPotential: 18,
              networkVolume: 16,
              contentValue: 19,
            },
            reasoning: '适合做成操作型文章或图文清单。',
            keywords: ['餐饮私域', '复购'],
            search_queries: ['餐饮私域怎么做'],
            material_ids: ['m-2'],
          },
        ]),
      );

    prisma.material.findMany
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          title: '某品牌开始用会员社群提升复购',
          summary: '通过社群承接和优惠券联动提升老客复购。',
          content: null,
          platform: '36Kr',
          collectDate: new Date('2026-03-17T00:00:00.000Z'),
        },
        {
          id: 'm-2',
          title: '餐饮私域讨论升温',
          summary: '越来越多门店在讨论如何做私域留存。',
          content: null,
          platform: '小红书',
          collectDate: new Date('2026-03-16T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'm-1', title: '某品牌开始用会员社群提升复购', platform: '36Kr' },
        { id: 'm-2', title: '餐饮私域讨论升温', platform: '小红书' },
      ]);

    prisma.topic.create
      .mockResolvedValueOnce({ id: 'topic-1' })
      .mockResolvedValueOnce({ id: 'topic-2' });
    prisma.topic.findMany.mockResolvedValue([
      {
        id: 'topic-2',
        title: '餐饮门店提升复购，可以先从这 3 个私域动作下手',
        sourceType: '智能挖掘',
        summary: '给出三个低成本动作，帮助用户理解如何把私域真正落地。',
        reasoning: '切入点：实操方法\n适合做成操作型文章或图文清单。',
        keywords: ['餐饮私域', '复购'],
        searchQueries: ['餐饮私域怎么做'],
        aiScore: 86,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-03-17T00:00:00.000Z'),
        updatedAt: new Date('2026-03-17T00:00:00.000Z'),
        materials: [{ materialId: 'm-2' }],
      },
      {
        id: 'topic-1',
        title: '门店私域做不起来，问题往往不在加好友',
        sourceType: '智能挖掘',
        summary: '拆解私域运营常见误区，解释为什么承接设计比拉新更关键。',
        reasoning: '切入点：认知反转\n适合先做长文，再延展成小红书拆解卡片。',
        keywords: ['私域运营', '门店复购'],
        searchQueries: ['私域运营误区有哪些'],
        aiScore: 89,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-03-17T00:00:00.000Z'),
        updatedAt: new Date('2026-03-17T00:00:00.000Z'),
        materials: [{ materialId: 'm-1' }, { materialId: 'm-2' }],
      },
    ]);

    const result =
      await service.discoverTopicsFromSeed('想写私域运营，尤其是门店复购方向');

    expect(aiClient.generate).toHaveBeenCalledTimes(2);
    expect(prisma.topic.create).toHaveBeenCalledTimes(2);
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: '智能挖掘',
          title: '门店私域做不起来，问题往往不在加好友',
        }),
      }),
    );
    expect(result.created).toBe(2);
    expect(result.analysis.normalizedSeed).toBe('私域运营');
    expect(result.retrieval).toEqual({
      scannedSources: 0,
      fetchedCount: 0,
      candidateCount: 0,
      matchedCount: 0,
      rejectedCount: 0,
      savedCount: 0,
    });
    expect(result.topics[0].sourceType).toBe('智能挖掘');
    expect(contentStrategiesService.getDefaultStrategy).toHaveBeenCalled();
    expect(systemLogsService.record).toHaveBeenCalled();
  });

  it('云端授权失效时会降级为本地规则挖题，不把 Unauthorized 直接抛给前端', async () => {
    const { service, prisma, aiClient, systemLogsService } = createService();

    aiClient.generate.mockRejectedValue(
      new Error('云端扣积分失败: Unauthorized'),
    );

    prisma.material.findMany
      .mockResolvedValueOnce([
        {
          id: 'm-local-1',
          title: '一家门店用 AI 客服把复购率做起来',
          summary: '门店通过自动回复和会员提醒降低人力成本。',
          content: null,
          platform: '小红书',
          collectDate: new Date('2026-06-28T00:00:00.000Z'),
        },
        {
          id: 'm-local-2',
          title: '小团队开始用 AI 做私域内容运营',
          summary: 'AI 帮助运营人员整理素材、生成选题和复盘。',
          content: null,
          platform: '36Kr',
          collectDate: new Date('2026-06-27T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'm-local-1',
          title: '一家门店用 AI 客服把复购率做起来',
          platform: '小红书',
        },
        {
          id: 'm-local-2',
          title: '小团队开始用 AI 做私域内容运营',
          platform: '36Kr',
        },
      ]);

    prisma.topic.create
      .mockResolvedValueOnce({ id: 'topic-local-1' })
      .mockResolvedValueOnce({ id: 'topic-local-2' });
    prisma.topic.findMany.mockResolvedValue([
      {
        id: 'topic-local-1',
        title:
          'AI私域运营的关键问题，藏在「一家门店用 AI 客服把复购率做起来」里',
        sourceType: '智能挖掘',
        summary: '本地规则生成的候选选题',
        reasoning:
          '本地规则降级：云端授权暂不可用，系统按素材相关度、内容策略和标题质量生成候选。',
        keywords: ['AI私域运营'],
        searchQueries: ['AI私域运营 痛点拆解'],
        aiScore: 88,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        updatedAt: new Date('2026-06-28T00:00:00.000Z'),
        materials: [{ materialId: 'm-local-1' }],
      },
      {
        id: 'topic-local-2',
        title:
          'AI私域运营怎么落地：从「小团队开始用 AI 做私域内容运营」拆 3 个动作',
        sourceType: '智能挖掘',
        summary: '本地规则生成的候选选题',
        reasoning:
          '本地规则降级：云端授权暂不可用，系统按素材相关度、内容策略和标题质量生成候选。',
        keywords: ['AI私域运营'],
        searchQueries: ['AI私域运营 实操方法'],
        aiScore: 85,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        updatedAt: new Date('2026-06-28T00:00:00.000Z'),
        materials: [{ materialId: 'm-local-2' }],
      },
    ]);

    const result = await service.discoverTopicsFromSeed('AI私域运营');

    expect(result.message).toContain('云端模型暂不可用');
    expect(result.created).toBe(2);
    expect(prisma.topic.create).toHaveBeenCalledTimes(2);
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasoning: expect.stringContaining('本地规则降级'),
          sourceType: '智能挖掘',
        }),
      }),
    );
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('云端模型暂不可用'),
      'success',
    );
  });

  it('Kaypal 模型台返回积分不足时会降级为本地规则挖题', async () => {
    const { service, prisma, aiClient, systemLogsService } = createService();

    aiClient.generate.mockRejectedValue(
      new Error('AI 服务暂时不可用：402 INSUFFICIENT_CREDITS'),
    );

    prisma.material.findMany
      .mockResolvedValueOnce([
        {
          id: 'm-credit-1',
          title: '外墙无人机清洗开始被商场采用',
          summary: '高空清洗服务用无人机降低人工风险。',
          content: null,
          platform: '行业媒体',
          collectDate: new Date('2026-07-06T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'm-credit-1',
          title: '外墙无人机清洗开始被商场采用',
          platform: '行业媒体',
        },
      ]);
    prisma.topic.create.mockResolvedValueOnce({ id: 'topic-credit-1' });
    prisma.topic.findMany.mockResolvedValue([
      {
        id: 'topic-credit-1',
        title:
          '外墙无人机清洗怎么落地：从「外墙无人机清洗开始被商场采用」拆 3 个动作',
        sourceType: '智能挖掘',
        summary: '本地规则生成的候选选题',
        reasoning:
          '本地规则降级：云端模型暂不可用，系统按素材相关度、内容策略和标题质量生成候选。',
        keywords: ['外墙无人机清洗'],
        searchQueries: ['外墙无人机清洗 实操方法'],
        aiScore: 85,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-07-06T00:00:00.000Z'),
        updatedAt: new Date('2026-07-06T00:00:00.000Z'),
        materials: [{ materialId: 'm-credit-1' }],
      },
    ]);

    const result = await service.discoverTopicsFromSeed('外墙无人机清洗');

    expect(result.message).toContain('云端模型暂不可用');
    expect(result.created).toBe(1);
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasoning: expect.stringContaining('本地规则降级'),
          sourceType: '智能挖掘',
        }),
      }),
    );
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('云端模型暂不可用'),
      'success',
    );
  });

  it('模型台服务端授权未放行时也会降级为本地规则挖题', async () => {
    const { service, prisma, aiClient } = createService();

    aiClient.generate.mockRejectedValue(
      new Error(
        'Kaypal 模型台服务端授权未放行，请确认 test.kaypal.cn 已部署 billing/AI proxy 服务端 key 配置。',
      ),
    );

    prisma.material.findMany
      .mockResolvedValueOnce([
        {
          id: 'm-key-1',
          title: '一个小团队用 AI 选题提升内容产能',
          summary: '团队用本地素材和规则先跑出候选选题。',
          content: null,
          platform: '小红书',
          collectDate: new Date('2026-06-28T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'm-key-1',
          title: '一个小团队用 AI 选题提升内容产能',
          platform: '小红书',
        },
      ]);
    prisma.topic.create.mockResolvedValueOnce({ id: 'topic-key-1' });
    prisma.topic.findMany.mockResolvedValue([
      {
        id: 'topic-key-1',
        title:
          'AI选题怎么落地：从「一个小团队用 AI 选题提升内容产能」拆 3 个动作',
        sourceType: '智能挖掘',
        summary: '本地规则生成的候选选题',
        reasoning:
          '本地规则降级：云端授权暂不可用，系统按素材相关度、内容策略和标题质量生成候选。',
        keywords: ['AI选题'],
        searchQueries: ['AI选题 实操方法'],
        aiScore: 85,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        updatedAt: new Date('2026-06-28T00:00:00.000Z'),
        materials: [{ materialId: 'm-key-1' }],
      },
    ]);

    const result = await service.discoverTopicsFromSeed('AI选题');

    expect(result.message).toContain('云端模型暂不可用');
    expect(result.created).toBe(1);
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasoning: expect.stringContaining('本地规则降级'),
        }),
      }),
    );
  });
});
