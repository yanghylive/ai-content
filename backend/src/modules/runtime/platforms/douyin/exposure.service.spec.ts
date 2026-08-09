import { DouyinExposureService } from './exposure.service';
import type { ExecutorContext, ExecutorTask } from '../../executor.interface';
import type { DouyinExposureCollector } from './exposure-collector.service';

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

function makeTask(overrides: Partial<ExecutorTask> = {}): ExecutorTask {
  return {
    relatedId: 'exposure-task-1',
    relatedType: 'agent-session',
    type: 'douyin-link-exposure',
    platform: 'douyin',
    accountId: 'douyin-account-1',
    payload: { links: ['https://v.douyin.com/test/'] },
    ...overrides,
  };
}

describe('DouyinExposureService', () => {
  function makeCollectorMock(
    overrides: Partial<
      Awaited<ReturnType<DouyinExposureCollector['collectFromLinks']>>
    > = {},
  ) {
    return {
      collectFromLinks: jest.fn().mockResolvedValue({
        ok: true,
        status: 'collected',
        message: '已采集 1 条候选评论',
        currentUrl: 'https://www.douyin.com/video/1',
        title: 'test video',
        candidates: [
          {
            sourceUrl: 'https://www.douyin.com/video/1',
            text: '想了解一下',
            index: 0,
          },
        ],
        evidence: {
          type: 'screenshot',
          label: 'douyin-link-exposure-read',
          path: '/tmp/douyin-link.png',
          url: '/api/local-engine/browser/evidence/douyin-link.png',
          capturedAt: new Date().toISOString(),
        },
        raw: { textSample: '评论 想了解一下' },
        ...overrides,
      }),
      collectFromSearch: jest.fn().mockResolvedValue({
        ok: true,
        status: 'collected',
        message: '已采集 1 条搜索结果候选',
        currentUrl: 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE',
        title: '抖音搜索',
        candidates: [
          {
            sourceUrl: 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE',
            text: '装修案例分享',
            index: 0,
            kind: 'search-result',
          },
        ],
        evidence: {
          type: 'screenshot',
          label: 'douyin-search-exposure-read',
          path: '/tmp/douyin-search.png',
          url: '/api/local-engine/browser/evidence/douyin-search.png',
          capturedAt: new Date().toISOString(),
        },
        raw: { textSample: '搜索 装修案例分享' },
      }),
      collectHotVideos: jest.fn().mockResolvedValue({
        ok: true,
        status: 'collected',
        message: '已打开爆款视频并采集 1 条候选评论',
        currentUrl: 'https://www.douyin.com/video/99',
        title: '爆款视频',
        candidates: [
          {
            sourceUrl: 'https://www.douyin.com/video/99',
            text: '这个项目怎么加盟',
            index: 0,
            kind: 'hot-video-comment',
          },
        ],
        evidence: {
          type: 'screenshot',
          label: 'douyin-hot-video-comment-read',
          path: '/tmp/douyin-hot-video.png',
          url: '/api/local-engine/browser/evidence/douyin-hot-video.png',
          capturedAt: new Date().toISOString(),
        },
        raw: { textSample: '评论 这个项目怎么加盟' },
      }),
      collectTargetedComments: jest.fn().mockResolvedValue({
        ok: true,
        status: 'collected',
        message: '已进入指定账号作品并读取 1 条客户评论',
        currentUrl: 'https://www.douyin.com/video/88',
        title: '指定账号作品',
        candidates: [
          {
            sourceUrl: 'https://www.douyin.com/video/88',
            text: '想了解同款服务',
            targetName: '目标客户',
            index: 0,
            kind: 'targeted-comment',
          },
        ],
        evidence: {
          type: 'screenshot',
          label: 'douyin-targeted-comment-read',
          path: '/tmp/douyin-targeted.png',
          url: '/api/local-engine/browser/evidence/douyin-targeted.png',
          capturedAt: new Date().toISOString(),
        },
        raw: { targetCount: 1 },
      }),
      collectRetentionCandidates: jest.fn().mockResolvedValue({
        ok: true,
        status: 'collected',
        message: '已从明确互动来源读取 1 条可跟进评论',
        currentUrl: 'https://www.douyin.com/video/77',
        title: '留资互动来源',
        candidates: [
          {
            sourceUrl: 'https://www.douyin.com/video/77',
            text: '请发我详细资料',
            targetName: '留资客户',
            index: 0,
            kind: 'retention-comment',
          },
        ],
        evidence: {
          type: 'screenshot',
          label: 'douyin-retention-comment-read',
          path: '/tmp/douyin-retention.png',
          url: '/api/local-engine/browser/evidence/douyin-retention.png',
          capturedAt: new Date().toISOString(),
        },
        raw: { retentionSourceType: 'video-interaction' },
      }),
    } as unknown as jest.Mocked<DouyinExposureCollector>;
  }

  it('handles only integrated read-only Douyin exposure task types on douyin platform', () => {
    const service = new DouyinExposureService(makeCollectorMock());

    expect(service.canHandle(makeTask({ type: 'douyin-link-exposure' }))).toBe(
      true,
    );
    expect(
      service.canHandle(
        makeTask({
          type: 'douyin-search-account-exposure',
          payload: { searchKeywords: ['装修'] },
        }),
      ),
    ).toBe(true);
    expect(
      service.canHandle(
        makeTask({
          type: 'douyin-hot-video-exposure',
          payload: { searchKeywords: ['装修'] },
        }),
      ),
    ).toBe(true);
    expect(
      service.canHandle(
        makeTask({
          type: 'douyin-targeted-exposure',
          payload: { targetAccounts: ['account-a'] },
        }),
      ),
    ).toBe(true);
    expect(
      service.canHandle(
        makeTask({
          type: 'douyin-retention-exposure',
          payload: { retentionSourceId: 'lead-source-1' },
        }),
      ),
    ).toBe(true);
    expect(service.canHandle(makeTask({ platform: 'wechat-channel' }))).toBe(
      false,
    );
    expect(service.canHandle(makeTask({ type: 'douyin-comment-reply' }))).toBe(
      false,
    );
  });

  it('validates link exposure payload and returns collected candidates without sending anything', async () => {
    const service = new DouyinExposureService(makeCollectorMock());

    const result = await service.execute(makeTask(), baseCtx);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('success');
    expect(result.reasonCode).toBe('success');
    expect(result.runtime.engineUrl).toBe('internal://runtime/douyin-exposure');
    expect(result.evidence[1]).toMatchObject({
      type: 'text',
      label: 'douyin-exposure-runtime-contract',
    });
    expect(result.evidence[1].value).toContain('"linkCount":1');
    expect(result.evidence[1].value).toContain(
      '"executionKind":"candidate_read"',
    );
    expect(result.evidence[1].value).toContain('"platformAction":false');
    expect(result.readback?.matched).toBe(true);
  });

  it('blocks customer actions at the read-only exposure boundary', async () => {
    const collector = makeCollectorMock();
    const service = new DouyinExposureService(collector);

    const result = await service.execute(
      makeTask({
        payload: {
          links: ['https://v.douyin.com/test/'],
          exposureExecutionKind: 'customer_action',
        },
      }),
      baseCtx,
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      reasonCode: 'not_integrated',
      userMessage: expect.stringContaining('商业互动执行器'),
    });
    expect(collector.collectFromLinks).not.toHaveBeenCalled();
    expect(collector.collectFromSearch).not.toHaveBeenCalled();
    expect(collector.collectHotVideos).not.toHaveBeenCalled();
  });

  it('does not report candidate-read completion without page evidence', async () => {
    const collector = makeCollectorMock({ evidence: undefined });
    const service = new DouyinExposureService(collector);

    const result = await service.execute(makeTask(), baseCtx);

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      reasonCode: 'readback_failed',
      readback: { matched: false },
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        label: 'douyin-exposure-runtime-contract',
      }),
    ]);
  });

  it('returns every collected candidate to the AI employee planner', async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      sourceUrl: 'https://www.douyin.com/video/1',
      text: `想了解第 ${index + 1} 条`,
      index,
      kind: 'comment',
    }));
    const service = new DouyinExposureService(
      makeCollectorMock({
        message: '已采集 8 条候选评论',
        candidates,
      }),
    );

    const result = await service.execute(makeTask(), baseCtx);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.readback?.actualText || '[]')).toHaveLength(8);
  });

  it('rejects missing account before accepting exposure payload', async () => {
    const service = new DouyinExposureService(makeCollectorMock());

    const result = await service.execute(
      makeTask({ accountId: undefined }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('account_not_logged_in');
  });

  it('rejects missing required payload per exposure task type', async () => {
    const service = new DouyinExposureService(makeCollectorMock());

    await expect(
      service.execute(makeTask({ payload: {} }), baseCtx),
    ).resolves.toMatchObject({
      ok: false,
      reasonCode: 'target_not_found',
      userMessage: '抖音链接曝光至少需要一条视频链接',
    });

    await expect(
      service.execute(
        makeTask({
          type: 'douyin-search-account-exposure',
          payload: {},
        }),
        baseCtx,
      ),
    ).resolves.toMatchObject({
      ok: false,
      reasonCode: 'target_not_found',
      userMessage: '抖音搜索账号曝光至少需要一个搜索关键词',
    });
  });

  it('runs search account exposure through the read-only search collector', async () => {
    const collector = makeCollectorMock();
    const service = new DouyinExposureService(collector);

    const result = await service.execute(
      makeTask({
        type: 'douyin-search-account-exposure',
        payload: { searchKeywords: ['装修'], filters: { resultLimit: 5 } },
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe('success');
    expect(result.reasonCode).toBe('success');
    expect(result.readback).toMatchObject({
      expectedText: 'candidate-search-results',
      matched: true,
    });
    expect(collector.collectFromSearch).toHaveBeenCalledWith({
      accountId: 'douyin-account-1',
      searchKeywords: ['装修'],
      limit: 5,
      filters: { resultLimit: 5 },
    });
  });

  it('runs hot video exposure through the hot video collector with hot video readback', async () => {
    const collector = makeCollectorMock();
    const service = new DouyinExposureService(collector);

    const result = await service.execute(
      makeTask({
        type: 'douyin-hot-video-exposure',
        payload: {
          searchKeywords: ['餐饮加盟'],
          filters: { resultLimit: 8, preferVideoResults: true },
        },
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.readback).toMatchObject({
      expectedText: 'candidate-hot-videos',
      matched: true,
    });
    expect(result.evidence[1].value).toContain('"hotVideoMode":true');
    expect(collector.collectHotVideos).toHaveBeenCalledWith({
      accountId: 'douyin-account-1',
      searchKeywords: ['餐饮加盟'],
      limit: 8,
      filters: { resultLimit: 8, preferVideoResults: true },
    });
    expect(collector.collectFromSearch).not.toHaveBeenCalled();
  });

  it('keeps hot video exposure usable when videos opened but no comments matched', async () => {
    const collector = makeCollectorMock();
    collector.collectHotVideos.mockResolvedValueOnce({
      ok: false,
      status: 'target_not_found',
      message: '已打开 2 个爆款视频，但未识别到符合时间筛选的候选评论',
      currentUrl: 'https://www.douyin.com/video/99',
      title: '爆款视频',
      candidates: [],
      evidence: {
        type: 'screenshot',
        label: 'douyin-hot-video-search-read',
        path: '/tmp/douyin-hot-video-empty.png',
        url: '/api/local-engine/browser/evidence/douyin-hot-video-empty.png',
        capturedAt: new Date().toISOString(),
      },
      raw: {
        openedVideos: [
          {
            url: 'https://www.douyin.com/video/99',
            title: '餐饮加盟案例',
            candidateCount: 0,
          },
        ],
      },
    });
    const service = new DouyinExposureService(collector);

    const result = await service.execute(
      makeTask({
        type: 'douyin-hot-video-exposure',
        payload: {
          searchKeywords: ['餐饮加盟'],
          filters: { resultLimit: 8, preferVideoResults: true },
        },
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe('success');
    expect(result.readback).toMatchObject({
      expectedText: 'candidate-hot-videos',
      actualText: '[]',
      matched: true,
    });
    expect(result.evidence[0].raw).toMatchObject({
      openedVideos: [
        expect.objectContaining({ url: 'https://www.douyin.com/video/99' }),
      ],
    });
  });

  it('runs targeted exposure through specified-account comment collector', async () => {
    const collector = makeCollectorMock();
    const service = new DouyinExposureService(collector);

    const result = await service.execute(
      makeTask({
        type: 'douyin-targeted-exposure',
        payload: {
          targetAccounts: ['account-a', 'account-b'],
          filters: { resultLimit: 6 },
        },
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.readback).toMatchObject({
      expectedText: 'candidate-targeted-results',
      matched: true,
    });
    expect(collector.collectFromLinks).not.toHaveBeenCalled();
    expect(collector.collectTargetedComments).toHaveBeenCalledWith({
      accountId: 'douyin-account-1',
      searchKeywords: ['account-a', 'account-b'],
      limit: 6,
      filters: {
        resultLimit: 6,
        targetedMode: true,
        targetAccounts: ['account-a', 'account-b'],
      },
    });
    expect(collector.collectHotVideos).not.toHaveBeenCalled();
  });

  it('runs retention exposure through explicit-source candidate collector', async () => {
    const collector = makeCollectorMock();
    const service = new DouyinExposureService(collector);

    const result = await service.execute(
      makeTask({
        type: 'douyin-retention-exposure',
        payload: {
          retentionSourceId: '表单线索',
          searchKeywords: ['装修留资'],
          filters: { resultLimit: 4 },
        },
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.readback).toMatchObject({
      expectedText: 'candidate-retention-results',
      matched: true,
    });
    expect(collector.collectRetentionCandidates).toHaveBeenCalledWith({
      accountId: 'douyin-account-1',
      searchKeywords: ['装修留资', '表单线索'],
      retentionSourceId: '表单线索',
      limit: 4,
      filters: {
        resultLimit: 4,
        retentionMode: true,
        retentionSourceId: '表单线索',
      },
    });
  });

  it('maps collector account login failure to account_not_logged_in', async () => {
    const service = new DouyinExposureService(
      makeCollectorMock({
        ok: false,
        status: 'account_not_logged_in',
        message: '抖音账号未登录，不能采集评论区。',
        candidates: [],
      }),
    );

    const result = await service.execute(makeTask(), baseCtx);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('account_not_logged_in');
  });
});
