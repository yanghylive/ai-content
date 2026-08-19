import { DiscoveryBrowserRunner, BrowserDiscoverError } from './discovery-browser-runner';
import type { LocalBrowserEngine } from '../local-engine/local-browser-engine.service';
import type { AcquisitionQuotaService } from './acquisition-quota.service';

/**
 * DiscoveryBrowserRunner D 阶段适配：
 * - 抖音 keyword 搜索走行为式（首页搜索框输入+回车，绕 /search/ 直开验证码）
 * - 抖音 jingxuan 新版卡片解析（douyinpic 封面 img + 时长 + 标题，无 a[href*=video]）
 * - 非抖音平台保持 a[href] 老解析
 */
describe('DiscoveryBrowserRunner D 阶段适配（抖音行为式搜索 + jingxuan 解析）', () => {
  function makePage(overrides: Record<string, unknown> = {}) {
    return {
      url: jest.fn().mockReturnValue('https://www.douyin.com/'),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
      evaluate: jest
        .fn()
        .mockImplementation((fn: unknown, ..._args: unknown[]) => {
          // 页面文本：默认正常（无登录/验证码标记）
          if (typeof fn === 'function' && /innerText/.test(fn.toString())) {
            return Promise.resolve('正常页面内容 搜索 结果');
          }
          if (typeof fn === 'function' && /querySelectorAll/.test(fn.toString())) {
            return Promise.resolve([]);
          }
          return Promise.resolve({});
        }),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnThis(),
        fill: jest.fn().mockResolvedValue(undefined),
        press: jest.fn().mockResolvedValue(undefined),
      }),
      ...overrides,
    } as any;
  }

  function makeBrowser(page: unknown) {
    return {
      getOrCreateSession: jest.fn().mockResolvedValue({ page }),
    } as unknown as LocalBrowserEngine;
  }

  function makeQuota(overrides: Record<string, unknown> = {}) {
    return {
      assertCanDiscover: jest.fn().mockResolvedValue(undefined),
      recordDiscover: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as AcquisitionQuotaService;
  }

  it('抖音 keyword 搜索 → 行为式（先开首页再输入回车），不直开 /search/ URL', async () => {
    const page = makePage({
      evaluate: jest.fn().mockImplementation((fn: unknown) => {
        const src = typeof fn === 'function' ? fn.toString() : String(fn);
        if (/search-content-area/.test(src)) {
          // 模拟 jingxuan 卡片
          return Promise.resolve([
            { title: '02:22 19.8万 千呼万唤的一镜到底来啦～', img: 'https://p3-pc-sign.douyinpic.com/tos-cn/v1' },
            { title: '01:34 9.2万 奶油风客厅改造', img: 'https://p3-pc-sign.douyinpic.com/tos-cn/v2' },
          ]);
        }
        if (/innerText/.test(src)) {
          return Promise.resolve('正常页面内容');
        }
        return Promise.resolve([]);
      }),
    });
    const runner = new DiscoveryBrowserRunner(
      makeBrowser(page),
      makeQuota(),
    );

    const items = await runner.searchByKeyword({
      platform: 'douyin',
      accountId: 'douyin-11',
      keyword: '装修',
      limit: 10,
      userId: 'user-1',
    });

    // 先开首页（非搜索 URL）
    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      'https://www.douyin.com/',
      expect.anything(),
    );
    // 搜索框输入 + 回车
    expect(page.locator).toHaveBeenCalled();
    const box = page.locator.mock.results[0].value;
    expect(box.fill).toHaveBeenCalledWith('装修');
    expect(box.press).toHaveBeenCalledWith('Enter');
    // 等待结果区
    expect(page.waitForSelector).toHaveBeenCalledWith(
      '#search-content-area',
      expect.anything(),
    );
    // 解析出 2 条候选
    expect(items).toHaveLength(2);
    expect(items[0].sourceContent?.title).toContain('一镜到底');
    expect(items[0].sourceContent?.url).toContain('douyinpic');
    expect(items[0].sourceContent?.externalContentId).toBeTruthy();
  });

  it('小红书 → 行为式搜索（首页搜索框输入+回车，不直开固定搜索 URL）（P1-8）', async () => {
    const page = makePage({
      evaluate: jest.fn().mockImplementation((fn: unknown) => {
        const src = typeof fn === 'function' ? fn.toString() : String(fn);
        if (/note-item/.test(src)) {
          // 小红书 note-item 卡片
          return Promise.resolve([
            { title: '坐标秦皇岛100平米的房子', url: 'https://www.xiaohongshu.com/explore/abc123', img: 'https://sns-webpic.xhscdn.com/x.jpg' },
          ]);
        }
        if (/innerText/.test(src)) {
          return Promise.resolve('正常页面内容');
        }
        return Promise.resolve([]);
      }),
    });
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    const items = await runner.searchByKeyword({
      platform: 'xiaohongshu',
      accountId: 'xhs-1',
      keyword: '装修',
      limit: 10,
      userId: 'user-1',
    });

    expect(page.goto).toHaveBeenCalledWith(
      'https://www.xiaohongshu.com/',
      expect.anything(),
    );
    // P1-8 复核：真实用户路径——首页搜索框输入关键词 + 回车，不直开 search_result URL
    expect(page.goto).not.toHaveBeenCalledWith(
      expect.stringContaining('search_result'),
      expect.anything(),
    );
    expect(page.locator).toHaveBeenCalled();
    expect(items).toHaveLength(1);
    expect(items[0].sourceContent?.url).toContain('/explore/');
    expect(items[0].sourceContent?.contentType).toBe('note');
  });

  it('快手 → 真实搜索不渲染 → 降级 new-reco 推荐流并标注（Sprint 5）', async () => {
    const page = makePage({
      evaluate: jest.fn().mockImplementation((fn: unknown) => {
        const src = typeof fn === 'function' ? fn.toString() : String(fn);
        // Sprint 5 降级判定：不在搜索态（new-reco）→ 触发推荐流降级
        if (/location\.href/.test(src)) {
          return Promise.resolve(false);
        }
        if (/querySelectorAll/.test(src)) {
          // 快手 new-reco：video src 提取 id
          return Promise.resolve([
            { id: '5214324149605659158', title: '@作者 装修案例', text: '@作者 装修案例' },
          ]);
        }
        if (/innerText/.test(src)) {
          return Promise.resolve('正常页面内容');
        }
        return Promise.resolve([]);
      }),
    });
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    const items = await runner.searchByKeyword({
      platform: 'kuaishou',
      accountId: 'ks-1',
      keyword: '装修',
      limit: 10,
      userId: 'user-1',
    });

    // Sprint 5：先尝试真实搜索（首页行为式）→ 搜索区不渲染 → 降级 new-reco 推荐流
    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      'https://www.kuaishou.com/',
      expect.anything(),
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      'https://www.kuaishou.com/new-reco',
      expect.anything(),
    );
    // 等 video 出现
    expect(page.waitForSelector).toHaveBeenCalledWith(
      'video',
      expect.anything(),
    );
    expect(items).toHaveLength(1);
    // 降级推荐流如实标注（不冒充关键词搜索结果）
    expect(items[0].recommendedFallback).toBe(true);
  });

  it('行为式搜索后页面被验证码拦截 → 抛 captcha_required（不绕过）', async () => {
    const page = makePage({
      evaluate: jest.fn().mockImplementation(() => {
        return Promise.resolve('安全验证 请完成验证 拖动滑块');
      }),
    });
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    await expect(
      runner.searchByKeyword({
        platform: 'douyin',
        accountId: 'douyin-11',
        keyword: '装修',
        limit: 10,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ reasonCode: 'captcha_required' });
  });

  it('行为式搜索打开首页失败 → 抛 network_error（转人工，不伪装）', async () => {
    const page = makePage({
      goto: jest.fn().mockRejectedValue(new Error('net down')),
    });
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    await expect(
      runner.searchByKeyword({
        platform: 'douyin',
        accountId: 'douyin-11',
        keyword: '装修',
        limit: 10,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ reasonCode: 'network_error' });
  });

  it('jingxuan 解析无结果 → 抛 parse_failed（页面未找到 ≠ 空结果）', async () => {
    const page = makePage({
      evaluate: jest.fn().mockImplementation((fn: unknown) => {
        if (typeof fn === 'function' && /querySelectorAll/.test(fn.toString())) {
          return Promise.resolve([]);
        }
        return Promise.resolve('正常页面内容');
      }),
    });
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    await expect(
      runner.searchByKeyword({
        platform: 'douyin',
        accountId: 'douyin-11',
        keyword: '装修',
        limit: 10,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ reasonCode: 'parse_failed' });
  });

  it('配额超限 → 抛 quota_exceeded（不静默降级）', async () => {
    const page = makePage();
    const quota = makeQuota({
      assertCanDiscover: jest.fn().mockRejectedValue(
        Object.assign(new Error('当日配额已用尽'), { name: 'AcquisitionQuotaExceededError' }),
      ),
    });
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), quota);

    await expect(
      runner.searchByKeyword({
        platform: 'douyin',
        accountId: 'douyin-11',
        keyword: '装修',
        limit: 10,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ reasonCode: 'quota_exceeded' });
  });
});

describe('DiscoveryBrowserRunner 评论身份三要素提取（P1 复核）', () => {
  function makeCommentPage(evaluateImpl: jest.Mock) {
    return {
      url: jest.fn().mockReturnValue('https://www.xiaohongshu.com/explore/note1'),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
      evaluate: evaluateImpl,
    } as any;
  }

  function makeBrowser(page: unknown) {
    return {
      getOrCreateSession: jest.fn().mockResolvedValue({ page }),
    } as unknown as LocalBrowserEngine;
  }

  function makeQuota() {
    return {
      assertCanDiscover: jest.fn().mockResolvedValue(undefined),
      recordDiscover: jest.fn().mockResolvedValue(undefined),
    } as unknown as AcquisitionQuotaService;
  }

  it('小红书评论：提取 profileUrl/externalUserId/commentId 并透传（identityHint + externalEventId 用真实值）', async () => {
    const evaluateImpl = jest.fn().mockResolvedValue({
      comments: [
        {
          nick: '装修小能手',
          text: '这个价格怎么算？',
          profileUrl: 'https://www.xiaohongshu.com/user/profile/5f2b9a1c',
          externalUserId: '5f2b9a1c',
          commentId: 'comment_abc123',
        },
      ],
      title: '奶油风客厅改造',
    });
    const page = makeCommentPage(evaluateImpl);
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    const items = await runner.extractXhsComments(page);

    expect(items).toHaveLength(1);
    expect(items[0].identityHint).toEqual({
      nickname: '装修小能手',
      externalUserId: '5f2b9a1c',
      profileUrl: 'https://www.xiaohongshu.com/user/profile/5f2b9a1c',
    });
    expect(items[0].interactionEvents?.[0]).toEqual(
      expect.objectContaining({
        // 有真实评论 ID → externalEventId 用真实值（跨会话可去重）
        externalEventId: 'comment_abc123',
        authorExternalId: '5f2b9a1c',
      }),
    );
  });

  it('小红书评论：无评论 ID 时不伪造 → externalEventId 为 undefined、身份字段留空（P1-6 不合成锚点）', async () => {
    const evaluateImpl = jest.fn().mockResolvedValue({
      comments: [{ nick: '路人甲', text: '好看', profileUrl: '', externalUserId: '', commentId: '' }],
      title: '奶油风客厅改造',
    });
    const page = makeCommentPage(evaluateImpl);
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    const items = await runner.extractXhsComments(page);

    expect(items).toHaveLength(1);
    expect(items[0].identityHint?.externalUserId).toBeUndefined();
    expect(items[0].identityHint?.profileUrl).toBeUndefined();
    // P1-6 复核：无真实评论 ID → externalEventId=undefined（不合成内容锚点冒充事件 ID）
    expect(items[0].interactionEvents?.[0]?.externalEventId).toBeUndefined();
    expect(items[0].interactionEvents?.[0]?.authorExternalId).toBeUndefined();
  });

  it('快手评论：同样提取身份三要素（author-name + profile 链接）', async () => {
    const evaluateImpl = jest.fn().mockResolvedValue({
      comments: [
        {
          nick: '东北老铁',
          text: '这房子装修得真板正',
          profileUrl: 'https://www.kuaishou.com/profile/3x9yy',
          externalUserId: '3x9yy',
          commentId: 'comment_ks_42',
        },
      ],
      title: '装修实拍',
    });
    const page = makeCommentPage(evaluateImpl);
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    const items = await runner.extractKuaishouComments(page);

    expect(items).toHaveLength(1);
    expect(items[0].identityHint).toEqual({
      nickname: '东北老铁',
      externalUserId: '3x9yy',
      profileUrl: 'https://www.kuaishou.com/profile/3x9yy',
    });
    expect(items[0].interactionEvents?.[0]?.externalEventId).toBe('comment_ks_42');
  });
});

describe('DiscoveryBrowserRunner replyComment 安全门禁（P0-3 复核）', () => {
  function makeReplyPage(replyEntryFound: boolean) {
    // 模拟：目标评论存在，但平台回复入口（"回复"按钮）不存在
    const basePage = {
      url: jest.fn().mockReturnValue('https://www.kuaishou.com/short-video/v1'),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      mouse: {
        move: jest.fn().mockResolvedValue(undefined),
        wheel: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
      },
      locator: jest.fn().mockImplementation((sel: string) => {
        // 目标评论永远命中
        if (sel.includes('comment-item')) {
          return {
            first: jest.fn().mockReturnValue({
              boundingBox: jest.fn().mockResolvedValue({
                x: 100, y: 200, width: 500, height: 80,
              }),
            }),
          };
        }
        // 回复入口：按 mock 参数决定是否命中
        const hasReply = replyEntryFound ? { x: 120, y: 220, width: 60, height: 24 } : null;
        return {
          first: jest.fn().mockReturnValue({
            boundingBox: jest.fn().mockResolvedValue(hasReply),
          }),
        };
      }),
    };
    return basePage as any;
  }

  function makeBrowser(page: unknown) {
    return {
      getOrCreateSession: jest.fn().mockResolvedValue({ page }),
    } as unknown as LocalBrowserEngine;
  }

  function makeQuota() {
    return {
      assertCanDiscover: jest.fn().mockResolvedValue(undefined),
      recordDiscover: jest.fn().mockResolvedValue(undefined),
    } as unknown as AcquisitionQuotaService;
  }

  it('无平台回复入口 → parse_failed 阻断，禁止发新评论代替回复（P0-3）', async () => {
    const page = makeReplyPage(false);
    const runner = new DiscoveryBrowserRunner(makeBrowser(page), makeQuota());

    await expect(
      runner.replyComment({
        platform: 'kuaishou',
        accountId: 'ks-1',
        contentUrl: 'https://www.kuaishou.com/short-video/v1',
        targetText: '怎么收费',
        replyText: '可以交流一下',
        dryRun: false,
      } as never),
    ).rejects.toMatchObject({
      name: 'BrowserDiscoverError',
      reasonCode: 'parse_failed',
      message: expect.stringContaining('禁止发新评论代替回复'),
    });
    // 未执行任何鼠标点击（发送入口未被触发）
    expect(page.mouse.click).not.toHaveBeenCalled();
  });
});

describe('DiscoveryBrowserRunner 会话关闭验证（P0-7 复核）', () => {
  function makeQuota() {
    return {
      assertCanDiscover: jest.fn().mockResolvedValue(undefined),
      recordDiscover: jest.fn().mockResolvedValue(undefined),
    } as unknown as AcquisitionQuotaService;
  }

  it('引擎 closeSession 返回 false → 抛 close_failed（不静默当成功）', async () => {
    const page = {
      url: jest.fn().mockReturnValue('https://www.kuaishou.com/'),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
      evaluate: jest.fn().mockResolvedValue({}),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnThis(),
        fill: jest.fn().mockResolvedValue(undefined),
        press: jest.fn().mockResolvedValue(undefined),
      }),
    } as any;
    const browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({ page }),
      closeSession: jest.fn().mockResolvedValue(false), // 关闭未确认
    } as unknown as LocalBrowserEngine;
    const runner = new DiscoveryBrowserRunner(browser, makeQuota());

    await expect(
      runner.closeSession('kuaishou', 'ks-1'),
    ).rejects.toMatchObject({
      name: 'BrowserDiscoverError',
      reasonCode: 'close_failed',
    });
  });

  it('引擎 closeSession 返回 true → 正常关闭', async () => {
    const browser = {
      closeSession: jest.fn().mockResolvedValue(true),
    } as unknown as LocalBrowserEngine;
    const runner = new DiscoveryBrowserRunner(browser, makeQuota());

    await expect(
      runner.closeSession('kuaishou', 'ks-1'),
    ).resolves.toBeUndefined();
  });
});

describe('DiscoveryBrowserRunner 小红书目标匹配门禁（P1-7 复核）', () => {
  function makeTargetPage(targetFound: boolean) {
    return {
      url: jest.fn().mockReturnValue('https://www.xiaohongshu.com/search_result'),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForURL: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockImplementation((fn: unknown) => {
        if (typeof fn === 'function' && /innerText/.test(fn.toString())) {
          return Promise.resolve('正常内容 搜索 结果');
        }
        return Promise.resolve({});
      }),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockImplementation((sel: string) => {
        // 目标笔记卡片：按 mock 参数决定命中/未命中
        const hit = targetFound;
        return {
          first: jest.fn().mockReturnValue({
            waitFor: jest.fn().mockImplementation((opts: { state: string }) =>
              hit
                ? Promise.resolve(undefined)
                : opts.state === 'attached'
                  ? Promise.reject(new Error('not attached'))
                  : Promise.resolve(undefined),
            ),
            boundingBox: jest.fn().mockResolvedValue({
              x: 10, y: 20, width: 200, height: 100,
            }),
            scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          }),
        };
      }),
      mouse: { click: jest.fn().mockResolvedValue(undefined) },
    } as any;
  }

  function makeRunner(page: unknown) {
    return new DiscoveryBrowserRunner(
      {
        getOrCreateSession: jest.fn().mockResolvedValue({ page }),
      } as unknown as LocalBrowserEngine,
      {
        assertCanDiscover: jest.fn().mockResolvedValue(undefined),
        recordDiscover: jest.fn().mockResolvedValue(undefined),
      } as unknown as AcquisitionQuotaService,
    );
  }

  it('目标笔记不在搜索结果 → page_not_found 中止（禁止回退第一张卡）', async () => {
    const page = makeTargetPage(false);
    const runner = makeRunner(page);

    await expect(
      runner.openXhsNoteViaSearchClick(
        page,
        'https://www.xiaohongshu.com/explore/target-note-123',
        '装修',
      ),
    ).rejects.toMatchObject({
      name: 'BrowserDiscoverError',
      reasonCode: 'page_not_found',
      message: expect.stringContaining('禁止将其他笔记的评论归因'),
    });
    // 未点击任何卡片（没有读到错误内容的评论）
    expect(page.mouse.click).not.toHaveBeenCalled();
  });

  it('目标笔记命中 → 正常点击进入', async () => {
    const page = makeTargetPage(true);
    const runner = makeRunner(page);

    await expect(
      runner.openXhsNoteViaSearchClick(
        page,
        'https://www.xiaohongshu.com/explore/target-note-123',
        '装修',
      ),
    ).resolves.toBeUndefined();
    expect(page.mouse.click).toHaveBeenCalled();
  });

  it('缺少搜索关键词 → parse_failed（不再默认搜索「小红书」）', async () => {
    const page = makeTargetPage(true);
    const runner = makeRunner(page);

    await expect(
      runner.openXhsNoteViaSearchClick(
        page,
        'https://www.xiaohongshu.com/explore/target-note-123',
        undefined,
      ),
    ).rejects.toMatchObject({
      name: 'BrowserDiscoverError',
      reasonCode: 'parse_failed',
      message: expect.stringContaining('需提供来源关键词'),
    });
  });
});
