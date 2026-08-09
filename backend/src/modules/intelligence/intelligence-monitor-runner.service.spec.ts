import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { IntelligenceMonitorRunnerService } from './intelligence-monitor-runner.service';

const now = new Date('2026-06-30T00:00:00.000Z');

function makeMonitor(data: Record<string, unknown> = {}) {
  return {
    id: data.id || 'monitor-1',
    tenantId: data.tenantId ?? 'tenant-1',
    userId: data.userId || 'user-1',
    skillInstallId: data.skillInstallId || 'install-1',
    type: data.type || 'keyword',
    platform: data.platform || '小红书',
    keyword: data.keyword || '老板 IP',
    accountExternalId: data.accountExternalId || null,
    industry: data.industry || null,
    schedule: data.schedule || '0 */2 * * *',
    status: data.status || 'active',
    config: Object.prototype.hasOwnProperty.call(data, 'config')
      ? data.config
      : { endpoint: '/story/web/api/search' },
    costLimitPoints: data.costLimitPoints || 300,
    lastRunAt: data.lastRunAt || null,
    nextRunAt: data.nextRunAt || now,
    lastError: data.lastError || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    skillInstall: data.skillInstall ?? {
      id: 'install-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      skillId: 'skill-1',
      enabled: true,
      scenario: 'search',
      config: null,
      usagePolicy: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      skill: {
        id: 'skill-1',
        skillNo: '1001',
        code: 'xhs-search',
        name: '小红书搜索',
        platform: 'xiaohongshu',
        category: 'search',
        tags: [],
        summary: '',
        description: '',
        inputSchema: null,
        outputSchema: null,
        status: 'active',
        raw: null,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}

function makeRunner(overrides: Record<string, unknown> = {}) {
  const monitor = makeMonitor(overrides.monitor as Record<string, unknown>);
  const prisma = {
    commentInsight: {
      findMany: jest.fn(async () => []),
    },
    publishAccount: {
      findFirst: jest.fn(async () => null),
    },
    intelligenceMonitor: {
      findFirst: jest.fn(async () => monitor),
      findMany: jest.fn(async () => [monitor]),
      update: jest.fn(async ({ data }: any) => ({ ...monitor, ...data })),
    },
    redfoxSkillInstall: {
      update: jest.fn(async ({ data }: any) => ({
        ...monitor.skillInstall,
        ...data,
      })),
    },
    intelligenceItem: {
      findFirst: jest.fn(async () => null),
    },
    redfoxCallLog: {
      findFirst: jest.fn(async () => null),
    },
  };
  const config = {
    get: jest.fn(() => undefined),
  };
  const scope = {
    key: 'tenant-1:user-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
  };
  const redfoxService = {
    resolveScope: jest.fn(async () => scope),
    getEffectiveConnection: jest.fn(async () => ({
      baseUrl: 'https://redfox.hk',
      apiKey: 'rf-test',
      apiKeySource: 'saved',
      timeoutMs: 30000,
      enabled: true,
      dailyUserLimit: 200,
      dailyTenantLimit: 2000,
      highCostConfirmThreshold: 1,
      status: 'connected',
      updatedAt: now.toISOString(),
    })),
  };
  const redfoxClient = {
    request: jest.fn(async (_scope: any, _connection: any, options: any) => {
      options.onCallLogRecorded?.({
        id: 'log-1',
        scopeKey: scope.key,
        userId: scope.userId,
        tenantId: scope.tenantId,
        endpoint: options.path,
        method: options.method,
        operation: options.operation,
        skillCode: options.skillCode,
        status: 'success',
        costPoints: 1,
        latencyMs: 10,
        requestHash: 'hash-1',
        responseStatus: 200,
        errorCode: null,
        errorMessage: null,
        createdAt: now.toISOString(),
      });
      return { data: { items: [{ id: 'note-1', title: '爆款样本' }] } };
    }),
  };
  const redfoxInterfaces = {
    isBlockedMonitorPath: jest.fn(
      (path: string) => path === '/story/web/api/home/hot',
    ),
    list: jest.fn(async () => ({
      items: [
        {
          platformCode: 'douyin',
          platformName: '抖音',
          path: '/story/api/dyData/searchArticle',
          method: 'POST',
          scenario: 'search_article',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    })),
  };
  const intelligenceService = {
    ingestRedfoxItemsForScope: jest.fn(async () => ({
      received: 1,
      normalized: 1,
      created: 1,
      updated: 0,
      items: [],
    })),
  };
  const runner = new IntelligenceMonitorRunnerService(
    prisma as any,
    config as any,
    redfoxService as any,
    redfoxClient as any,
    redfoxInterfaces as any,
    intelligenceService as any,
  );
  return {
    runner,
    prisma,
    redfoxClient,
    redfoxService,
    redfoxInterfaces,
    intelligenceService,
    config,
    scope,
    monitor,
  };
}

describe('IntelligenceMonitorRunnerService', () => {
  it('executes a monitor, ingests normalized RedFox items, and updates runtime fields', async () => {
    const { runner, prisma, redfoxClient, intelligenceService, scope } =
      makeRunner();

    const result = await runner.runMonitor(
      { id: 'user-1' } as any,
      'monitor-1',
    );

    expect(redfoxClient.request).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/web/api/search',
        method: 'GET',
        skillCode: 'xhs-search',
      }),
    );
    expect(intelligenceService.ingestRedfoxItemsForScope).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        redfoxCallLogId: 'log-1',
        redfoxSkillId: 'skill-1',
        rawItems: [{ id: 'note-1', title: '爆款样本' }],
      }),
    );
    expect(prisma.intelligenceMonitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'monitor-1' },
        data: expect.objectContaining({
          status: 'active',
          lastError: null,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        monitorId: 'monitor-1',
        status: 'success',
        callLogId: 'log-1',
        created: 1,
      }),
    );
  });

  it('marks the monitor as error when no executable endpoint can be resolved', async () => {
    const { runner, prisma, redfoxClient } = makeRunner({
      monitor: {
        skillInstallId: null,
        skillInstall: null,
        type: 'keyword',
        config: null,
      },
    });

    await expect(
      runner.runMonitor({ id: 'user-1' } as any, 'monitor-1'),
    ).rejects.toThrow(BadRequestException);

    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(prisma.intelligenceMonitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'monitor-1' },
        data: expect.objectContaining({
          status: 'error',
          lastError: expect.stringContaining(
            '监控未绑定可执行 RedFox 正式平台接口',
          ),
        }),
      }),
    );
  });

  it('blocks the RedFox home hot endpoint from production monitor execution', async () => {
    const { runner, prisma, redfoxClient } = makeRunner({
      monitor: {
        config: { endpoint: '/story/web/api/home/hot' },
      },
    });

    await expect(
      runner.runMonitor({ id: 'user-1' } as any, 'monitor-1'),
    ).rejects.toThrow(BadRequestException);

    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(prisma.intelligenceMonitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'monitor-1' },
        data: expect.objectContaining({
          status: 'error',
          lastError: expect.stringContaining('不能作为正式采集入口'),
        }),
      }),
    );
  });

  it('runs due monitors in a bounded batch', async () => {
    const { runner, prisma } = makeRunner();

    const result = await runner.runDueMonitors({ id: 'user-1' } as any, {
      limit: 3,
    });

    expect(prisma.intelligenceMonitor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        where: expect.objectContaining({
          status: 'active',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        scanned: 1,
        executed: 1,
        succeeded: 1,
        failed: 0,
      }),
    );
  });

  it('runs one-off RedFox search through official interface endpoints', async () => {
    const {
      runner,
      redfoxClient,
      redfoxInterfaces,
      intelligenceService,
      scope,
    } = makeRunner();

    const result = await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'AI创业',
      platform: 'douyin',
      target: 'post',
      limit: 5,
    });

    expect(redfoxInterfaces.list).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'douyin',
        scenario: 'search_article',
        status: 'online',
      }),
    );
    expect(redfoxClient.request).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/dyData/searchArticle',
        method: 'POST',
        operation: 'intelligence.search.manual',
      }),
    );
    expect(intelligenceService.ingestRedfoxItemsForScope).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        platform: 'douyin',
        type: 'keyword',
        rawItems: [{ id: 'note-1', title: '爆款样本' }],
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        keyword: 'AI创业',
        received: 1,
        normalized: 1,
        created: 1,
        endpoints: [
          expect.objectContaining({
            endpoint: '/story/api/dyData/searchArticle',
            status: 'success',
          }),
        ],
      }),
    );
  });

  it('falls back to built-in official search endpoints when the local catalog is empty', async () => {
    const {
      runner,
      redfoxClient,
      redfoxInterfaces,
      intelligenceService,
      scope,
    } = makeRunner();
    redfoxInterfaces.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const result = await runner.runSearch({ id: 'user-1' } as any, {
      keyword: '咖啡店获客',
      platform: 'xiaohongshu',
      target: 'post',
      limit: 5,
    });

    expect(redfoxClient.request).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/xhsUser/searchArticle',
        method: 'POST',
        operation: 'intelligence.search.manual',
      }),
    );
    expect(intelligenceService.ingestRedfoxItemsForScope).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        platform: 'xiaohongshu',
        type: 'keyword',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        keyword: '咖啡店获客',
        platform: 'xiaohongshu',
        received: 1,
        endpoints: [
          expect.objectContaining({
            endpoint: '/story/api/xhsUser/searchArticle',
            status: 'success',
          }),
        ],
      }),
    );
  });

  it('normalizes user-facing platform labels before resolving search endpoints', async () => {
    const { runner, redfoxClient, redfoxInterfaces, scope } = makeRunner();
    redfoxInterfaces.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    await runner.runSearch(
      { id: 'user-1' } as any,
      {
        keyword: '无人机',
        platform: '全网',
        target: '作品',
        limit: 5,
      } as any,
    );

    expect(redfoxInterfaces.list).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'douyin',
        scenario: 'search_article',
      }),
    );
    expect(redfoxClient.request).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/dyData/searchArticle',
        method: 'POST',
      }),
    );
  });

  it('returns an insufficient-credit business error when all search endpoints are blocked by billing', async () => {
    const { runner, redfoxClient, redfoxInterfaces } = makeRunner();
    redfoxInterfaces.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    redfoxClient.request.mockRejectedValue(
      new HttpException(
        {
          code: 'INSUFFICIENT_CREDITS',
          message: '积分余额不足，请充值或调整任务消耗后再试。',
        },
        HttpStatus.PAYMENT_REQUIRED,
      ),
    );

    await expect(
      runner.runSearch({ id: 'user-1' } as any, {
        keyword: '无人机',
        platform: 'all',
        target: 'post',
        limit: 5,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_CREDITS',
        message: '积分余额不足，请充值或调整任务消耗后再试。',
        publicDetails: {
          failures: expect.arrayContaining([
            expect.objectContaining({
              platform: 'douyin',
              errorCode: 'INSUFFICIENT_CREDITS',
            }),
          ]),
        },
      }),
      status: 402,
    });
  });

  it('returns traceable platform failures when every data source is unavailable', async () => {
    const { runner, redfoxClient, redfoxInterfaces, scope } = makeRunner();
    redfoxInterfaces.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    let callIndex = 0;
    redfoxClient.request.mockImplementation(
      async (_scope: any, _connection: any, options: any) => {
        callIndex += 1;
        options.onCallLogRecorded?.({
          id: `failed-log-${callIndex}`,
          scopeKey: scope.key,
          userId: scope.userId,
          tenantId: scope.tenantId,
          endpoint: options.path,
          method: options.method,
          operation: options.operation,
          skillCode: options.skillCode,
          status: 'failed',
          costPoints: 0,
          latencyMs: 30,
          requestHash: `failed-hash-${callIndex}`,
          responseStatus: 504,
          errorCode: 'REDFOX_TIMEOUT',
          errorMessage: '系统数据服务请求超时，请稍后重试。',
          createdAt: now.toISOString(),
        });
        throw new HttpException(
          {
            code: 'REDFOX_TIMEOUT',
            message: '系统数据服务请求超时，请稍后重试。',
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      },
    );

    await expect(
      runner.runSearch({ id: 'user-1' } as any, {
        keyword: '私域获客',
        platform: 'all',
        target: 'post',
        limit: 20,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INTELLIGENCE_SEARCH_ALL_SOURCES_FAILED',
        publicDetails: {
          failures: expect.arrayContaining([
            expect.objectContaining({
              platform: 'douyin',
              platformLabel: '抖音',
              error: '数据服务响应超时，请稍后重试。',
              errorCode: 'REDFOX_TIMEOUT',
              callLogId: 'failed-log-1',
            }),
          ]),
        },
      }),
      status: 503,
    });
    expect(redfoxClient.request).toHaveBeenCalledTimes(4);
  });

  it('runs WeChat article engagement through the official article detail endpoint', async () => {
    const {
      runner,
      redfoxClient,
      redfoxInterfaces,
      intelligenceService,
      scope,
    } = makeRunner();
    redfoxClient.request.mockImplementation(
      async (_scope: any, _connection: any, options: any) => {
        options.onCallLogRecorded?.({
          id: 'log-gzh-engagement-1',
          scopeKey: scope.key,
          userId: scope.userId,
          tenantId: scope.tenantId,
          endpoint: options.path,
          method: options.method,
          operation: options.operation,
          skillCode: options.skillCode,
          status: 'success',
          costPoints: 1,
          latencyMs: 10,
          requestHash: 'hash-gzh-engagement-1',
          responseStatus: 200,
          errorCode: null,
          errorMessage: null,
          createdAt: now.toISOString(),
        });
        return {
          code: 2000,
          data: {
            workUuid: 'gzh-work-1',
            title: 'AI 创业者如何做私域',
            summary: '公众号文章摘要',
            workUrl: 'https://mp.weixin.qq.com/s/example',
            publishTime: '2026-06-30 10:00:00',
            author: '增长实验室',
            readCount: 50000,
            watchCount: 1200,
            likeCount: 3500,
            commentCount: 280,
            collectCount: 500,
            shareCount: 150,
            rewardCount: 30,
          },
        };
      },
    );

    const result = await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'https://mp.weixin.qq.com/s/example#rd',
      platform: 'wechat',
      target: 'engagement',
      limit: 5,
    });

    expect(redfoxInterfaces.list).not.toHaveBeenCalled();
    expect(redfoxClient.request).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/gzhData/queryArticleDetail',
        method: 'POST',
        operation: 'intelligence.article_engagement.manual',
        skillCode: 'gzh-query-article',
        estimatedCostPoints: 80,
        body: { url: 'https://mp.weixin.qq.com/s/example' },
      }),
    );
    expect(intelligenceService.ingestRedfoxItemsForScope).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        platform: 'gongzhonghao',
        type: 'article_engagement',
        redfoxSkillCode: 'gzh-query-article',
        redfoxCallLogId: 'log-gzh-engagement-1',
        rawItems: [
          expect.objectContaining({
            title: 'AI 创业者如何做私域',
            rawType: 'wechat_article_engagement',
            metrics: expect.objectContaining({
              readCount: 50000,
              commentCount: 280,
            }),
          }),
        ],
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        target: 'engagement',
        endpoints: [
          expect.objectContaining({
            endpoint: '/story/api/gzhData/queryArticleDetail',
            status: 'success',
            source: 'official_interface',
            estimatedCostPoints: 80,
            costPoints: 1,
          }),
        ],
      }),
    );
  });

  it('reuses cached WeChat article engagement results without charging again', async () => {
    const { runner, prisma, redfoxClient, redfoxService, intelligenceService } =
      makeRunner();
    prisma.intelligenceItem.findFirst.mockResolvedValueOnce({
      id: 'item-gzh-cached-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      platform: 'gongzhonghao',
      type: 'article_engagement',
      title: '已缓存公众号文章',
      content: null,
      summary: '历史互动指标',
      sourceUrl: 'https://mp.weixin.qq.com/s/example',
      sourceExternalId: 'gzh-work-1',
      author: '增长实验室',
      authorUrl: null,
      publishDate: now,
      metrics: { readCount: 123 },
      keywords: ['私域'],
      raw: {},
      status: 'new',
      dedupeKey: 'dedupe-gzh',
      redfoxSkill: null,
      redfoxCallLogId: 'log-cached-1',
      materialId: null,
      topicId: null,
      growthLeadId: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'https://mp.weixin.qq.com/s/example',
      platform: 'wechat',
      target: 'engagement',
      limit: 5,
    });

    expect(redfoxService.getEffectiveConnection).not.toHaveBeenCalled();
    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(
      intelligenceService.ingestRedfoxItemsForScope,
    ).not.toHaveBeenCalled();
    expect(prisma.redfoxCallLog.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        target: 'engagement',
        created: 0,
        updated: 0,
        endpoints: [
          expect.objectContaining({
            status: 'cached',
            source: 'local_cache',
            callLogId: 'log-cached-1',
            estimatedCostPoints: 0,
            costPoints: 0,
            message: '已复用这篇文章的历史互动指标，本次未再次扣积分。',
          }),
        ],
        items: [
          expect.objectContaining({
            id: 'item-gzh-cached-1',
            keywords: ['私域'],
          }),
        ],
      }),
    );
  });

  it('reuses cached empty WeChat article engagement results without charging again', async () => {
    const { runner, prisma, redfoxClient, redfoxService, intelligenceService } =
      makeRunner();
    prisma.redfoxCallLog.findFirst.mockResolvedValueOnce({
      id: 'log-empty-cached-1',
      startedAt: now,
    });

    const result = await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'https://mp.weixin.qq.com/s/unknown',
      platform: 'wechat',
      target: 'engagement',
      limit: 5,
    });

    expect(prisma.redfoxCallLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.any(Object),
            expect.objectContaining({
              requestHash: expect.any(String),
              skillCode: 'gzh-query-article',
              status: 'success',
              httpStatus: 200,
              intelligenceItems: { none: {} },
            }),
          ],
        },
      }),
    );
    expect(redfoxService.getEffectiveConnection).not.toHaveBeenCalled();
    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(
      intelligenceService.ingestRedfoxItemsForScope,
    ).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        target: 'engagement',
        created: 0,
        updated: 0,
        endpoints: [
          expect.objectContaining({
            status: 'empty',
            source: 'local_cache',
            callLogId: 'log-empty-cached-1',
            estimatedCostPoints: 0,
            costPoints: 0,
            message:
              '这篇文章此前没有返回可用互动指标，本次未再次调用外部数据，也没有扣积分。',
          }),
        ],
        items: [],
      }),
    );
  });

  it('does not ingest empty WeChat article engagement payloads', async () => {
    const { runner, redfoxClient, intelligenceService, scope } = makeRunner();
    redfoxClient.request.mockImplementation(
      async (_scope: any, _connection: any, options: any) => {
        options.onCallLogRecorded?.({
          id: 'log-gzh-empty-1',
          scopeKey: scope.key,
          userId: scope.userId,
          tenantId: scope.tenantId,
          endpoint: options.path,
          method: options.method,
          operation: options.operation,
          skillCode: options.skillCode,
          status: 'success',
          costPoints: 80,
          latencyMs: 10,
          requestHash: 'hash-gzh-empty-1',
          responseStatus: 200,
          errorCode: null,
          errorMessage: null,
          createdAt: now.toISOString(),
        });
        return {
          code: 2000,
          data: {
            workUrl: 'https://mp.weixin.qq.com/s/unknown',
          },
        };
      },
    );

    const result = await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'https://mp.weixin.qq.com/s/unknown',
      platform: 'wechat',
      target: 'engagement',
      limit: 5,
    });

    expect(
      intelligenceService.ingestRedfoxItemsForScope,
    ).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        target: 'engagement',
        created: 0,
        endpoints: [
          expect.objectContaining({
            status: 'empty',
            callLogId: 'log-gzh-empty-1',
            estimatedCostPoints: 80,
            costPoints: 80,
            message: '公众号文章详情接口没有返回可入库文章指标。',
          }),
        ],
        items: [],
      }),
    );
  });

  it('runs Douyin comment search through the RedFox comment skill', async () => {
    const {
      runner,
      redfoxClient,
      redfoxInterfaces,
      intelligenceService,
      scope,
    } = makeRunner();
    redfoxClient.request.mockImplementation(
      async (_scope: any, _connection: any, options: any) => {
        options.onCallLogRecorded?.({
          id: 'log-comment-1',
          scopeKey: scope.key,
          userId: scope.userId,
          tenantId: scope.tenantId,
          endpoint: options.path,
          method: options.method,
          operation: options.operation,
          skillCode: options.skillCode,
          status: 'success',
          costPoints: 1,
          latencyMs: 10,
          requestHash: 'hash-comment-1',
          responseStatus: 200,
          errorCode: null,
          errorMessage: null,
          createdAt: now.toISOString(),
        });
        return {
          code: 2000,
          data: {
            commentList: [
              {
                commentId: 'comment-1',
                text: '怎么收费，想看看案例',
                authorName: '意向客户A',
                authorUid: 'user-1',
                likeCount: 3,
                replyCount: 1,
                publishTime: '2026-06-30 10:00:00',
                ipLocation: '广东',
              },
            ],
            hasMore: false,
          },
        };
      },
    );

    const result = await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'https://www.douyin.com/video/7131700643076623629',
      platform: 'douyin',
      target: 'comment',
      limit: 5,
    });

    expect(redfoxInterfaces.list).not.toHaveBeenCalled();
    expect(redfoxClient.request).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/dy/work/comment',
        method: 'POST',
        operation: 'intelligence.comment.skill',
        skillCode: 'douyin-comment',
        body: expect.objectContaining({
          videoId: '7131700643076623629',
        }),
      }),
    );
    expect(intelligenceService.ingestRedfoxItemsForScope).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        platform: 'douyin',
        type: 'comment',
        redfoxSkillCode: 'douyin-comment',
        redfoxCallLogId: 'log-comment-1',
        rawItems: [
          expect.objectContaining({
            title: '抖音评论 1',
            content: '怎么收费，想看看案例',
            rawType: 'redfox_comment_skill',
          }),
        ],
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        target: 'comment',
        endpoints: [
          expect.objectContaining({
            endpoint: 'douyin-comment',
            status: 'success',
            source: 'redfox_skill',
          }),
        ],
      }),
    );
  });

  it('runs Xiaohongshu comment search through the RedFox comment skill', async () => {
    const { runner, redfoxClient, intelligenceService, scope } = makeRunner();
    redfoxClient.request.mockImplementation(
      async (_scope: any, _connection: any, options: any) => {
        options.onCallLogRecorded?.({
          id: 'log-xhs-comment-1',
          scopeKey: scope.key,
          userId: scope.userId,
          tenantId: scope.tenantId,
          endpoint: options.path,
          method: options.method,
          operation: options.operation,
          skillCode: options.skillCode,
          status: 'success',
          costPoints: 1,
          latencyMs: 10,
          requestHash: 'hash-xhs-comment-1',
          responseStatus: 200,
          errorCode: null,
          errorMessage: null,
          createdAt: now.toISOString(),
        });
        return {
          code: 2000,
          data: {
            commentList: [
              {
                commentId: 'xhs-comment-1',
                commentText: '这个方案适合小团队吗',
                userName: '小红书用户A',
                thumbCount: 8,
                replyCount: 2,
                ipRegion: '上海',
              },
            ],
          },
        };
      },
    );

    await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'https://www.xiaohongshu.com/explore/65ab12cd34ef56ab78cd90ef',
      platform: 'xiaohongshu',
      target: 'comment',
      limit: 5,
    });

    expect(redfoxClient.request).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/xhs/ability/commentList',
        skillCode: 'xiaohongshu-comment',
        body: expect.objectContaining({
          noteId: '65ab12cd34ef56ab78cd90ef',
        }),
      }),
    );
    expect(intelligenceService.ingestRedfoxItemsForScope).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        platform: 'xiaohongshu',
        type: 'comment',
        redfoxSkillCode: 'xiaohongshu-comment',
      }),
    );
  });

  it('runs Bilibili comment search through submit and result RedFox skill endpoints', async () => {
    const { runner, redfoxClient, intelligenceService, scope } = makeRunner();
    redfoxClient.request.mockImplementation(
      async (_scope: any, _connection: any, options: any) => {
        options.onCallLogRecorded?.({
          id:
            options.path === '/story/api/bili/commentResult'
              ? 'log-bili-result'
              : 'log-bili-submit',
          scopeKey: scope.key,
          userId: scope.userId,
          tenantId: scope.tenantId,
          endpoint: options.path,
          method: options.method,
          operation: options.operation,
          skillCode: options.skillCode,
          status: 'success',
          costPoints: 1,
          latencyMs: 10,
          requestHash: 'hash-bili-comment',
          responseStatus: 200,
          errorCode: null,
          errorMessage: null,
          createdAt: now.toISOString(),
        });
        if (options.path === '/story/api/bili/commentSubmit') {
          return { code: 2000, data: { taskId: 'task-1' } };
        }
        return {
          code: 2000,
          data: {
            commentList: [
              {
                commentId: 'bili-comment-1',
                content: '这个教程有源码吗',
                nickname: 'B站用户A',
                likeNum: 12,
              },
            ],
          },
        };
      },
    );

    await runner.runSearch({ id: 'user-1' } as any, {
      keyword: 'https://www.bilibili.com/video/BV1xx411c7mD',
      platform: 'bilibili',
      target: 'comment',
      limit: 5,
    });

    expect(redfoxClient.request).toHaveBeenNthCalledWith(
      1,
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/bili/commentSubmit',
        skillCode: 'bilibili-comment',
        body: expect.objectContaining({
          opusId: 'BV1xx411c7mD',
        }),
      }),
    );
    expect(redfoxClient.request).toHaveBeenNthCalledWith(
      2,
      scope,
      expect.any(Object),
      expect.objectContaining({
        path: '/story/api/bili/commentResult',
        bodyEncoding: 'form',
        skillCode: 'bilibili-comment',
      }),
    );
    expect(intelligenceService.ingestRedfoxItemsForScope).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        platform: 'bilibili',
        type: 'comment',
        redfoxSkillCode: 'bilibili-comment',
        redfoxCallLogId: 'log-bili-result',
      }),
    );
  });

  it('rejects unsupported comment platforms instead of pretending fallback data is real', async () => {
    const { runner, redfoxClient, redfoxInterfaces, intelligenceService } =
      makeRunner();

    await expect(
      runner.runSearch({ id: 'user-1' } as any, {
        keyword: 'AI创业',
        platform: 'wechat',
        target: 'comment',
        limit: 5,
      }),
    ).rejects.toThrow('评论分析当前只支持抖音、小红书和 B站');

    expect(redfoxInterfaces.list).not.toHaveBeenCalled();
    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(
      intelligenceService.ingestRedfoxItemsForScope,
    ).not.toHaveBeenCalled();
  });

  it('rejects comment search without a work link or work id', async () => {
    const { runner, redfoxClient, redfoxInterfaces, intelligenceService } =
      makeRunner();

    await expect(
      runner.runSearch({ id: 'user-1' } as any, {
        keyword: 'AI创业',
        platform: 'douyin',
        target: 'comment',
        limit: 5,
      }),
    ).rejects.toThrow('评论分析需要作品链接或作品 ID');

    expect(redfoxInterfaces.list).not.toHaveBeenCalled();
    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(
      intelligenceService.ingestRedfoxItemsForScope,
    ).not.toHaveBeenCalled();
  });
});
