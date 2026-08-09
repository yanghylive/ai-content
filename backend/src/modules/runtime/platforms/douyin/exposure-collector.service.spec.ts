import { DouyinExposureCollector } from './exposure-collector.service';
import type { LocalBrowserEngine } from '../../../local-engine/local-browser-engine.service';

function makeBrowserMock(snapshot: {
  url?: string;
  title?: string;
  textSample?: string;
}) {
  const page = {
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
    locator: jest.fn(() => ({
      evaluateAll: jest.fn().mockResolvedValue([]),
    })),
  };
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'douyin-account-1',
      page,
    }),
    open: jest
      .fn()
      .mockResolvedValue(snapshot.url || 'https://www.douyin.com/video/1'),
    readPageSnapshot: jest.fn().mockResolvedValue({
      url: snapshot.url || 'https://www.douyin.com/video/1',
      title: snapshot.title || 'test video',
      textSample:
        snapshot.textSample ||
        '评论\n想了解一下\n刚刚\n回复\n这个多少钱\n2分钟前\n点赞',
      evidencePath: '/tmp/douyin.png',
      evidenceUrl: '/api/local-engine/browser/evidence/douyin.png',
    }),
  } as unknown as jest.Mocked<LocalBrowserEngine>;
}

function makeBrowserSequenceMock(
  snapshots: Array<{
    url?: string;
    title?: string;
    textSample?: string;
  }>,
) {
  const page = {
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
    locator: jest.fn((selector: string) => {
      if (selector.includes('a[href]')) {
        return {
          evaluateAll: jest.fn().mockResolvedValue([
            {
              href: 'https://www.douyin.com/video/10',
              text: '普通餐饮视频 点赞 200 评论 20',
            },
            {
              href: 'https://www.douyin.com/video/11',
              text: '一般餐饮视频 点赞 300 评论 30',
            },
            {
              href: 'https://www.douyin.com/video/99',
              text: '餐饮加盟案例 点赞 12.3万 评论 3000 分享 800',
            },
          ]),
        };
      }
      return {
        evaluateAll: jest.fn().mockResolvedValue([]),
      };
    }),
  };
  let snapshotIndex = 0;
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'douyin-account-1',
      page,
    }),
    open: jest.fn().mockResolvedValue(''),
    readPageSnapshot: jest
      .fn()
      .mockImplementation(({ label }: { label: string }) => {
        const snapshot =
          snapshots[Math.min(snapshotIndex, snapshots.length - 1)] || {};
        snapshotIndex += 1;
        return Promise.resolve({
          url:
            snapshot.url || 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE',
          title: snapshot.title || '抖音页面',
          textSample: snapshot.textSample || '搜索\n综合\n视频\n装修案例',
          evidencePath: `/tmp/${label}.png`,
          evidenceUrl: `/api/local-engine/browser/evidence/${label}.png`,
        });
      }),
  } as unknown as jest.Mocked<LocalBrowserEngine>;
}

function makeBrowserSequenceWithSearchCardsMock(
  snapshots: Array<{
    url?: string;
    title?: string;
    textSample?: string;
  }>,
) {
  const page = {
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
    locator: jest.fn(() => ({
      evaluateAll: jest.fn().mockResolvedValue([
        {
          href: '',
          videoId: '7390000000000000011',
          text: '本地生活爆款获客案例 点赞 1.2万 评论 450 分享 90',
        },
        {
          href: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE?modal_id=7390000000000000099',
          text: '餐饮招商爆款案例 点赞 8.6万 评论 2100 分享 700',
        },
      ]),
    })),
  };
  let snapshotIndex = 0;
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'douyin-account-1',
      page,
    }),
    open: jest.fn().mockResolvedValue(''),
    readPageSnapshot: jest
      .fn()
      .mockImplementation(({ label }: { label: string }) => {
        const snapshot =
          snapshots[Math.min(snapshotIndex, snapshots.length - 1)] || {};
        snapshotIndex += 1;
        return Promise.resolve({
          url:
            snapshot.url || 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
          title: snapshot.title || '抖音页面',
          textSample: snapshot.textSample || '搜索\n综合\n视频\n餐饮招商',
          evidencePath: `/tmp/${label}.png`,
          evidenceUrl: `/api/local-engine/browser/evidence/${label}.png`,
        });
      }),
  } as unknown as jest.Mocked<LocalBrowserEngine>;
}

function makeBrowserSequenceWithWaterfallCardsMock(
  snapshots: Array<{
    url?: string;
    title?: string;
    textSample?: string;
  }>,
) {
  const page = {
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
    locator: jest.fn(() => ({
      evaluateAll: jest.fn().mockResolvedValue([
        {
          href: '',
          text: '01:07348县级城市100平方门店，每天6万到8万营业额，你们感觉怎么样#李姑婆',
          videoId: '7422969238031322379',
        },
        {
          href: '',
          text: '03:5584252026年将会大火的几个品类#餐饮创业 #开店创业 #餐饮加盟@辉哥聊餐饮',
          videoId: '7548045828628221225',
        },
      ]),
    })),
  };
  let snapshotIndex = 0;
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'douyin-account-1',
      page,
    }),
    open: jest.fn().mockResolvedValue(''),
    readPageSnapshot: jest
      .fn()
      .mockImplementation(({ label }: { label: string }) => {
        const snapshot =
          snapshots[Math.min(snapshotIndex, snapshots.length - 1)] || {};
        snapshotIndex += 1;
        return Promise.resolve({
          url:
            snapshot.url || 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
          title: snapshot.title || '抖音页面',
          textSample: snapshot.textSample || '搜索\n综合\n视频\n餐饮加盟',
          evidencePath: `/tmp/${label}.png`,
          evidenceUrl: `/api/local-engine/browser/evidence/${label}.png`,
        });
      }),
  } as unknown as jest.Mocked<LocalBrowserEngine>;
}

function makeTargetedBrowserMock() {
  const page = {
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
    evaluate: jest.fn().mockResolvedValue([
      {
        targetName: '明确意向客户',
        text: '想了解同款服务和报价',
        commentTime: '今天',
        y: 100,
        authorTagged: false,
      },
    ]),
    locator: jest.fn((selector: string) => ({
      evaluateAll: jest.fn().mockResolvedValue(
        selector.includes('/user/')
          ? [
              {
                href: 'https://www.douyin.com/user/MS4wLjABAAAA-target-001',
                text: '目标装修达人 粉丝 1.2万 获赞 8.6万 作品 120',
              },
            ]
          : [
              {
                href: 'https://www.douyin.com/video/7390000000000000088',
                text: '目标账号装修案例 点赞 1200 评论 80',
              },
            ],
      ),
    })),
  };
  const snapshots = [
    {
      url: 'https://www.douyin.com/search/%E7%9B%AE%E6%A0%87%E8%A3%85%E4%BF%AE%E8%BE%BE%E4%BA%BA?type=user',
      title: '账号搜索',
      textSample: '搜索 用户 目标装修达人 粉丝 1.2万 获赞 8.6万',
    },
    {
      url: 'https://www.douyin.com/user/MS4wLjABAAAA-target-001',
      title: '目标装修达人 - 抖音',
      textSample: '目标装修达人 粉丝 1.2万 获赞 8.6万 作品 120',
    },
    {
      url: 'https://www.douyin.com/video/7390000000000000088',
      title: '目标账号装修案例',
      textSample: '全部评论 明确意向客户 想了解同款服务和报价 今天 回复',
    },
  ];
  let snapshotIndex = 0;
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'douyin-account-1',
      page,
    }),
    open: jest.fn().mockResolvedValue(''),
    readPageSnapshot: jest.fn().mockImplementation(({ label }) => {
      const snapshot = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
      snapshotIndex += 1;
      return Promise.resolve({
        ...snapshot,
        evidencePath: `/tmp/${label}.png`,
        evidenceUrl: `/api/local-engine/browser/evidence/${label}.png`,
      });
    }),
  } as unknown as jest.Mocked<LocalBrowserEngine>;
}

function makeBrowserWithSearchAccountLinksMock(snapshot: {
  url?: string;
  title?: string;
  textSample?: string;
}) {
  const page = {
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
    locator: jest.fn((selector: string) => {
      if (selector.includes('/user/') || selector.includes('sec_uid')) {
        return {
          evaluateAll: jest.fn().mockResolvedValue([
            {
              href: 'https://www.douyin.com/user/MS4wLjABAAAAaA1bB2cC3dD4eE5fF6gG',
              text: '装修获客官方1.2万粉丝8.6万获赞作品 120 专注本地家装获客',
              userId: 'MS4wLjABAAAAaA1bB2cC3dD4eE5fF6gG',
            },
            {
              href: 'https://www.douyin.com/user/MS4wLjABAAAAbB1cC2dD3eE4fF5gG6hH',
              text: '装修黑名单\n粉丝 10\n获赞 20\n作品 3',
              userId: 'MS4wLjABAAAAbB1cC2dD3eE4fF5gG6hH',
            },
          ]),
        };
      }
      return {
        evaluateAll: jest.fn().mockResolvedValue([]),
      };
    }),
  };
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'douyin-account-1',
      page,
    }),
    open: jest.fn().mockResolvedValue(snapshot.url || ''),
    readPageSnapshot: jest.fn().mockResolvedValue({
      url: snapshot.url || 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE',
      title: snapshot.title || '抖音搜索',
      textSample:
        snapshot.textSample ||
        '搜索\n综合\n用户\n为你找到以下结果\n装修获客官方\n粉丝 1.2万\n获赞 8.6万',
      evidencePath: '/tmp/douyin-search.png',
      evidenceUrl: '/api/local-engine/browser/evidence/douyin-search.png',
    }),
  } as unknown as jest.Mocked<LocalBrowserEngine>;
}

describe('DouyinExposureCollector', () => {
  it('opens the first link read-only and extracts comment candidates', async () => {
    const browser = makeBrowserMock({});
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectFromLinks({
      accountId: '1',
      links: ['https://v.douyin.com/test/'],
      limit: 5,
      filters: { commentTimeMatch: '7days' },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('collected');
    expect(result.candidates.map((item) => item.text)).toEqual(
      expect.arrayContaining(['想了解一下', '这个多少钱']),
    );
    expect(browser.open).toHaveBeenCalledWith(
      'douyin-account-1',
      'https://v.douyin.com/test/',
      {
        waitUntil: 'domcontentloaded',
      },
    );
    expect(browser.readPageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'douyin-account-1',
        label: 'douyin-link-exposure-read',
      }),
    );
  });

  it('returns account_not_logged_in when page is login gated', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://sso.douyin.com/login',
        textSample: '扫码登录 验证码登录',
      }),
    );

    const result = await collector.collectFromLinks({
      accountId: '1',
      links: ['https://v.douyin.com/test/'],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('account_not_logged_in');
    expect(result.candidates).toEqual([]);
  });

  it('returns captcha_required when Douyin shows a safety challenge', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        textSample: '评论 安全验证 请拖动滑块完成验证码',
      }),
    );

    const result = await collector.collectFromLinks({
      accountId: '1',
      links: ['https://v.douyin.com/test/'],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('captcha_required');
  });

  it('rejects empty links before opening browser', async () => {
    const browser = makeBrowserMock({});
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectFromLinks({
      accountId: '1',
      links: [],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('target_not_found');
    expect(browser.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('opens Douyin search and extracts account candidates', async () => {
    const browser = makeBrowserSequenceMock([
      {
        url: 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE',
        textSample:
          '搜索\n综合\n视频\n用户\n装修案例分享\n粉丝 12.3万\n老房改造日记\n获赞 88万',
      },
    ]);
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['装修'],
      limit: 5,
      filters: { resultLimit: 5 },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('collected');
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        text: '装修案例分享',
        kind: 'search-result',
      }),
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      1,
      'douyin-account-1',
      'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE?type=user',
      {
        waitUntil: 'domcontentloaded',
      },
    );
    expect(browser.open).toHaveBeenCalledTimes(1);
    expect(browser.readPageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'douyin-account-1',
        label: 'douyin-search-exposure-read',
      }),
    );
  });

  it('prefers linked account cards and keeps profile urls for follow-up', async () => {
    const browser = makeBrowserWithSearchAccountLinksMock({
      url: 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE%E8%8E%B7%E5%AE%A2',
    });
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['装修获客'],
      limit: 5,
      filters: {
        nicknameKeywords: ['装修'],
        blacklistNicknames: ['黑名单'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        text: '装修获客官方',
        targetName: '装修获客官方',
        kind: 'search-result',
        profileUrl:
          'https://www.douyin.com/user/MS4wLjABAAAAaA1bB2cC3dD4eE5fF6gG',
        engagementScore: 172000,
        likeCount: 86000,
        commentCount: 120,
      }),
    ]);
    expect(result.raw).toEqual(
      expect.objectContaining({ accountLinkCount: 2 }),
    );
  });

  it('does not treat Douyin navigation text as search candidates', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample: [
          '搜索',
          '综合',
          '视频',
          '用户',
          '精选',
          '开启读屏标签',
          '读屏标签已关闭',
          '关注',
          '打开抖音',
          '用户服务协议',
          '隐私政策',
          '加载中',
        ].join('\n'),
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['餐饮'],
      limit: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('target_not_found');
    expect(result.candidates).toEqual([]);
  });

  it('does not treat Douyin sidebar and footer text as search candidates', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE%E5%8A%A0%E7%9B%9F',
        textSample: [
          '精选 推荐 搜索 关注 朋友 12 我的 直播 放映厅 短剧 下载抖音精选',
          '2026 © 抖音 京ICP备16016397号-3 京公网安备 11000002002046号',
          '广播电视节目制作经营许可证 （京）字第11313号',
          '网络谣言曝光台 网上有害信息举报 违法和不良信息举报',
          '广告投放 用户服务协议 隐私政策 账号找回 联系我们 加入我们',
          '营业执照 友情链接 站点地图 下载抖音 抖音电商 搜索 充值 客户端 壁纸 通知 私信 投稿',
        ].join('\n'),
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['餐饮加盟'],
      limit: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('target_not_found');
    expect(result.candidates).toEqual([]);
  });

  it('rejects combined Douyin chrome text even when it is rendered as a long single line', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample:
          '精选 推荐 搜索 关注 朋友 12 我的 直播 放映厅 短剧 下载抖音精选 打开抖音 用户服务协议 隐私政策 营业执照 友情链接 站点地图 客户端 壁纸 通知 私信 投稿',
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['餐饮'],
      limit: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('target_not_found');
    expect(result.candidates).toEqual([]);
  });

  it('rejects support phone, email aliases and related-search fragments before real results load', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE%E8%8E%B7%E5%AE%A2',
        textSample: [
          '精选 推荐 搜索 关注 朋友 25 我的 直播 放映厅 短剧 下载抖音精选',
          '400-140-2108 feedback@douyin.com 算法推荐专项举报 sfjubao@bytedance.com 体育饭圈专项举报 tyfq@bytedance.com',
          '广告投放 用户服务协议 隐私政策 营业执照 友情链接 站点地图',
          '综合 视频 用户 直播 多列 单列 筛选',
          '全部个人ip日常文案短视频巡店对标账号vlog口播创业拍抖音人设讲故事搞笑段子',
        ].join('\n'),
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['餐饮获客'],
      limit: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('target_not_found');
    expect(result.candidates).toEqual([]);
  });

  it('skips Douyin footer text before the search result section', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE%E5%8A%A0%E7%9B%9F',
        textSample: [
          '精选 推荐 搜索 关注 朋友 我的 直播 放映厅 短剧 下载抖音精选',
          '京ICP备16016397号-3 京公网安备 11000002002046号',
          '京B2-20170846 京（2025）0000017 药品医疗器械网络信息服务备案',
          '为你找到以下结果',
          '00:32 569 加盟不是短期生意，而是长期事业！禧酉记邀您加入 #餐饮加盟 @禧酉记大块牛肉饭',
          '2025年12月8日',
          '00:57 1.0万 餐食加盟，无需大厨，外卖+堂食，一店多营 @鲍厨娘官方账号',
          '6月12日',
        ].join('\n'),
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['餐饮加盟'],
      limit: 3,
    });

    expect(result.ok).toBe(true);
    expect(result.candidates.map((candidate) => candidate.text)).toEqual([
      '加盟不是短期生意，而是长期事业！禧酉记邀您加入',
      '餐食加盟，无需大厨，外卖+堂食，一店多营',
    ]);
  });

  it('normalizes real search result text into usable account leads', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserSequenceMock([
        {
          url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE%E8%8E%B7%E5%AE%A2',
          textSample: [
            '为你找到以下结果',
            '大壮AI研究员 粉丝 1.2万 获赞 8.6万',
            'Kaypal内容工作台 粉丝 963 获赞 4500',
            '相关搜索',
          ].join('\n'),
        },
      ]),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['餐饮获客'],
      limit: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '大壮AI研究员',
          kind: 'search-result',
        }),
        expect.objectContaining({
          text: 'Kaypal内容工作台',
          kind: 'search-result',
        }),
      ]),
    );
  });

  it('filters search account leads by nickname keywords and blacklist', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserSequenceMock([
        {
          url: 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE',
          textSample: [
            '为你找到以下结果',
            '装修小王 粉丝 1.2万 获赞 8.6万',
            '装修黑名单 粉丝 963 获赞 4500',
            '餐饮老板 粉丝 2万 获赞 5万',
          ].join('\n'),
        },
      ]),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['装修'],
      limit: 5,
      filters: {
        nicknameKeywords: ['装修'],
        blacklistNicknames: ['黑名单'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.candidates.map((candidate) => candidate.text)).toEqual([
      '装修小王',
    ]);
  });

  it('honors enterprise-only search account filter', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserSequenceMock([
        {
          url: 'https://www.douyin.com/search/%E8%A3%85%E4%BF%AE',
          textSample: [
            '为你找到以下结果',
            '装修企业号官方 粉丝 1.2万 获赞 8.6万',
            '装修达人小王 粉丝 963 获赞 4500',
          ].join('\n'),
        },
      ]),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['装修'],
      limit: 5,
      filters: {
        nicknameKeywords: ['装修'],
        enterpriseOnly: true,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.candidates.map((candidate) => candidate.text)).toEqual([
      '装修企业号官方',
    ]);
  });

  it('keeps targeted search scoped to the requested account metrics', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://www.douyin.com/search/%E5%A4%B1%E4%B8%BB%E8%81%92%E5%99%AA',
        textSample: [
          '为你找到以下结果，问问AI',
          '你是不是想找：施主聒噪',
          '01:25 70 #一位被惊扰美梦的警官 @武曲⭐',
          '施主聒噪 粉丝：401 获赞：1000',
          '00:05 20 今天又捡到了一个手机，应该怎么办 @睥睨',
        ].join('\n'),
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['失主聒噪'],
      limit: 3,
      filters: { targetedMode: true, targetAccounts: ['失主聒噪'] },
    });

    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        text: '施主聒噪',
        targetName: '施主聒噪',
        profileUrl:
          'https://www.douyin.com/search/%E5%A4%B1%E4%B8%BB%E8%81%92%E5%99%AA',
        engagementScore: 1401,
      }),
    ]);
  });

  it('does not return ordinary video copy for targeted account mode', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://www.douyin.com/search/%E5%A4%B1%E4%B8%BB%E8%81%92%E5%99%AA',
        textSample: [
          '搜索',
          '综合',
          '视频',
          '为你找到以下结果',
          '01:25 70 #一位被惊扰美梦的警官 @武曲⭐',
          '00:05 20 今天又捡到了一个手机，应该怎么办 @睥睨',
        ].join('\n'),
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['失主聒噪'],
      limit: 3,
      filters: { targetedMode: true, targetAccounts: ['失主聒噪'] },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('target_not_found');
    expect(result.candidates).toEqual([]);
  });

  it('returns account_not_logged_in when search page is login gated', async () => {
    const collector = new DouyinExposureCollector(
      makeBrowserMock({
        url: 'https://sso.douyin.com/login',
        textSample: '扫码登录 请先登录后搜索',
      }),
    );

    const result = await collector.collectFromSearch({
      accountId: '1',
      searchKeywords: ['装修'],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('account_not_logged_in');
    expect(result.candidates).toEqual([]);
  });

  it('opens a hot video search result and extracts comments from the video page', async () => {
    const browser = makeBrowserSequenceMock([
      {
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample: '搜索\n综合\n视频\n餐饮加盟案例\n粉丝 12.3万',
      },
      {
        url: 'https://www.douyin.com/video/99',
        title: '爆款餐饮视频',
        textSample:
          '评论\n这个项目怎么加盟\n今天\n回复\n想了解费用\n3小时前\n点赞',
      },
    ]);
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectHotVideos({
      accountId: '1',
      searchKeywords: ['餐饮'],
      limit: 2,
      filters: { resultLimit: 2, commentTimeMatch: 'today' },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('collected');
    expect(result.currentUrl).toBe('https://www.douyin.com/video/99');
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '这个项目怎么加盟',
          kind: 'hot-video-comment',
          targetName: '',
          commentTime: '今天',
          videoTitle: '餐饮加盟案例',
          videoUrl: 'https://www.douyin.com/video/99',
          engagementScore: 133600,
        }),
        expect.objectContaining({
          text: '想了解费用',
          kind: 'hot-video-comment',
        }),
      ]),
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      1,
      'douyin-account-1',
      'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
      { waitUntil: 'domcontentloaded' },
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      2,
      'douyin-account-1',
      'https://www.douyin.com/video/99',
      { waitUntil: 'domcontentloaded' },
    );
  });

  it('spreads larger hot-video batches across multiple search result videos', async () => {
    const browser = makeBrowserSequenceMock([
      {
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample: '搜索\n综合\n视频\n餐饮加盟案例\n粉丝 12.3万',
      },
      {
        url: 'https://www.douyin.com/video/99',
        title: '爆款餐饮视频',
        textSample:
          '评论\n这个项目怎么加盟\n今天\n回复\n想了解费用\n3小时前\n点赞',
      },
      {
        url: 'https://www.douyin.com/video/11',
        title: '一般餐饮视频',
        textSample: '评论\n加盟政策发一下\n今天\n回复\n怎么合作\n2小时前\n点赞',
      },
      {
        url: 'https://www.douyin.com/video/10',
        title: '普通餐饮视频',
        textSample: '评论\n有门店模型吗\n今天\n回复\n想看资料\n1小时前\n点赞',
      },
    ]);
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectHotVideos({
      accountId: '1',
      searchKeywords: ['餐饮'],
      limit: 6,
      filters: { resultLimit: 6, commentTimeMatch: 'today' },
    });

    const videoUrls = [
      ...new Set(result.candidates.map((item) => item.videoUrl)),
    ];
    expect(result.ok).toBe(true);
    expect(result.status).toBe('collected');
    expect(result.candidates).toHaveLength(6);
    expect(videoUrls).toEqual([
      'https://www.douyin.com/video/99',
      'https://www.douyin.com/video/11',
      'https://www.douyin.com/video/10',
    ]);
    expect(result.candidates.slice(0, 3).map((item) => item.videoUrl)).toEqual(
      videoUrls,
    );
    expect(result.raw).toEqual(
      expect.objectContaining({
        openedVideoCount: 3,
        candidateVideoCount: 3,
        commentsPerVideoLimit: 3,
        videoLinkCount: 3,
      }),
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      2,
      'douyin-account-1',
      'https://www.douyin.com/video/99',
      { waitUntil: 'domcontentloaded' },
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      3,
      'douyin-account-1',
      'https://www.douyin.com/video/11',
      { waitUntil: 'domcontentloaded' },
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      4,
      'douyin-account-1',
      'https://www.douyin.com/video/10',
      { waitUntil: 'domcontentloaded' },
    );
  });

  it('applies exposure blacklist to hot video comment targets', async () => {
    const page = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
      locator: jest.fn((selector: string) => {
        if (selector.includes('a[href]')) {
          return {
            evaluateAll: jest.fn().mockResolvedValue([
              {
                href: 'https://www.douyin.com/video/99',
                text: '餐饮加盟案例 点赞 12.3万 评论 3000 分享 800',
              },
            ]),
          };
        }
        return {
          evaluateAll: jest.fn().mockResolvedValue([]),
        };
      }),
      evaluate: jest.fn().mockResolvedValue([
        {
          targetName: '小糯人工智能002',
          text: '想了解加盟费用',
          commentTime: '今天',
          y: 100,
          authorTagged: false,
        },
        {
          targetName: '意向客户A',
          text: '怎么合作',
          commentTime: '今天',
          y: 200,
          authorTagged: false,
        },
      ]),
    };
    const browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-account-1',
        page,
      }),
      open: jest.fn().mockResolvedValue(''),
      readPageSnapshot: jest
        .fn()
        .mockResolvedValueOnce({
          url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
          title: '抖音搜索',
          textSample: '搜索\n综合\n视频\n餐饮加盟案例',
          evidencePath: '/tmp/search.png',
          evidenceUrl: '/api/local-engine/browser/evidence/search.png',
        })
        .mockResolvedValueOnce({
          url: 'https://www.douyin.com/video/99',
          title: '餐饮加盟案例',
          textSample: '评论\n想了解加盟费用\n今天\n回复\n怎么合作\n今天\n回复',
          evidencePath: '/tmp/video.png',
          evidenceUrl: '/api/local-engine/browser/evidence/video.png',
        }),
    } as unknown as jest.Mocked<LocalBrowserEngine>;
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectHotVideos({
      accountId: '1',
      searchKeywords: ['餐饮'],
      limit: 3,
      filters: {
        resultLimit: 3,
        commentTimeMatch: 'today',
        blacklistNicknames: ['小糯人工智能002'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.candidates.map((item) => item.targetName)).toEqual([
      '意向客户A',
    ]);
    expect(result.candidates.map((item) => item.text)).toEqual(['怎么合作']);
  });

  it('opens hot videos from Douyin search cards that only expose modal or aweme ids', async () => {
    const browser = makeBrowserSequenceWithSearchCardsMock([
      {
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample: '搜索\n综合\n视频\n餐饮招商爆款案例\n获赞 8.6万',
      },
      {
        url: 'https://www.douyin.com/video/7390000000000000099',
        title: '餐饮招商爆款案例',
        textSample: '评论\n想了解加盟政策\n今天\n回复\n怎么合作\n1小时前\n点赞',
      },
    ]);
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectHotVideos({
      accountId: '1',
      searchKeywords: ['餐饮招商'],
      limit: 2,
      filters: { commentTimeMatch: 'today' },
    });

    expect(result.ok).toBe(true);
    expect(result.currentUrl).toBe(
      'https://www.douyin.com/video/7390000000000000099',
    );
    expect(result.raw).toEqual(
      expect.objectContaining({
        selectedVideoUrl: 'https://www.douyin.com/video/7390000000000000099',
        videoLinkCount: 2,
      }),
    );
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '想了解加盟政策',
          videoTitle: '餐饮招商爆款案例',
          videoUrl: 'https://www.douyin.com/video/7390000000000000099',
          engagementScore: 93700,
        }),
      ]),
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      2,
      'douyin-account-1',
      'https://www.douyin.com/video/7390000000000000099',
      { waitUntil: 'domcontentloaded' },
    );
  });

  it('opens hot videos from Douyin selected waterfall cards that expose ids only in wrapper ids', async () => {
    const browser = makeBrowserSequenceWithWaterfallCardsMock([
      {
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample: '搜索\n综合\n视频\n餐饮加盟\n2026年将会大火的几个品类',
      },
      {
        url: 'https://www.douyin.com/video/7548045828628221225',
        title: '2026年将会大火的几个品类',
        textSample: '评论\n想了解加盟资料\n今天\n回复\n怎么合作\n2小时前\n点赞',
      },
    ]);
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectHotVideos({
      accountId: '1',
      searchKeywords: ['餐饮加盟'],
      limit: 2,
      filters: { commentTimeMatch: 'today' },
    });

    expect(result.ok).toBe(true);
    expect(result.currentUrl).toBe(
      'https://www.douyin.com/video/7548045828628221225',
    );
    expect(result.raw).toEqual(
      expect.objectContaining({
        selectedVideoUrl: 'https://www.douyin.com/video/7548045828628221225',
        videoLinkCount: 2,
      }),
    );
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '想了解加盟资料',
          videoTitle: '2026年将会大火的几个品类#餐饮创业 #开店创业 #餐饮加盟',
          videoUrl: 'https://www.douyin.com/video/7548045828628221225',
          engagementScore: 8425,
        }),
      ]),
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      2,
      'douyin-account-1',
      'https://www.douyin.com/video/7548045828628221225',
      { waitUntil: 'domcontentloaded' },
    );
  });

  it('applies comment time filters when extracting link comments', async () => {
    const browser = makeBrowserMock({
      textSample:
        '评论\n今天还想了解\n今天\n昨天也咨询过\n昨天\n7天前的评论\n7天前',
    });
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectFromLinks({
      accountId: '1',
      links: ['https://v.douyin.com/test/'],
      limit: 10,
      filters: { commentTimeMatch: 'today' },
    });

    expect(result.ok).toBe(true);
    expect(result.candidates.map((item) => item.text)).toEqual([
      '今天还想了解',
    ]);
  });

  it('extracts comments when Douyin renders comment text and time on one line', async () => {
    const browser = makeBrowserMock({
      textSample: [
        '全部评论',
        '孙总你好、好想加入这个大家庭、可我没做过餐饮、连生意都没做过、能行吗 1年前·江西 158 分享 回复 展开8条回复',
        '可不可以一起玩游戏 ... 怎么加盟 3天前·山东 0 分享 回复',
        '深圳找达人探店 1月前·广东 1 分享 回复',
      ].join('\n'),
    });
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectFromLinks({
      accountId: '1',
      links: ['https://www.douyin.com/video/1'],
      limit: 10,
      filters: { commentTimeMatch: '7days' },
    });

    expect(result.ok).toBe(true);
    expect(result.candidates.map((item) => item.text)).toEqual(['怎么加盟']);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        commentTime: '3天前·山东',
      }),
    );
  });

  it('does not mark a loaded video page as logged out only because chrome text contains login words', async () => {
    const browser = makeBrowserSequenceWithWaterfallCardsMock([
      {
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample: '搜索\n综合\n视频\n餐饮加盟\n2026年将会大火的几个品类',
      },
      {
        url: 'https://www.douyin.com/video/7548045828628221225',
        title: '餐饮视频',
        textSample: [
          '开启读屏标签',
          '登录',
          '通知',
          '私信',
          '投稿',
          '00:01 / 01:49',
          '全部评论',
          '留下你的精彩评论吧',
          '可不可以一起玩游戏 ... 怎么加盟 1周前·山东 0 分享 回复',
        ].join('\n'),
      },
    ]);
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectHotVideos({
      accountId: '1',
      searchKeywords: ['餐饮加盟'],
      limit: 2,
      filters: { commentTimeMatch: '7days' },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('collected');
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        text: '怎么加盟',
        commentTime: '1周前·山东',
      }),
    );
  });

  it('does not treat Douyin navigation and footer text as hot video lead comments', async () => {
    const browser = makeBrowserSequenceWithWaterfallCardsMock([
      {
        url: 'https://www.douyin.com/search/%E9%A4%90%E9%A5%AE',
        textSample: '搜索\n综合\n视频\n餐饮加盟\n2026年将会大火的几个品类',
      },
      {
        url: 'https://www.douyin.com/video/7548045828628221225',
        title: '餐饮视频',
        textSample: [
          '开启读屏标签',
          '读屏标签已关闭',
          '精选',
          '推荐',
          '搜索',
          '关注',
          '朋友',
          '我的',
          '全部评论',
          '留下你的精彩评论吧',
          '大家都在搜： 桂林郭淑芬鲜切自助老火锅',
          '加载中',
          '广告投放',
          '用户服务协议',
          '京ICP备16016397号-3',
        ].join('\n'),
      },
    ]);
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectHotVideos({
      accountId: '1',
      searchKeywords: ['餐饮加盟'],
      limit: 5,
      filters: { commentTimeMatch: '7days' },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('target_not_found');
    expect(result.candidates).toEqual([]);
  });

  it('drops Douyin author-tagged comment rows from DOM candidates', async () => {
    const collector = new DouyinExposureCollector({} as LocalBrowserEngine);
    const page = {
      evaluate: jest.fn().mockResolvedValue([
        {
          targetName: '一颗酸枣核',
          text: '您好，怎么联系 作者回复过',
          commentTime: '1周前·内蒙古',
          y: 100,
        },
        {
          targetName: '徐sir是个编导',
          text: '需要思维导图给我要',
          commentTime: '1周前·山东',
          y: 200,
          authorTagged: true,
        },
      ]),
    };

    const result = await (collector as any).extractDomCommentCandidates(page, {
      sourceUrl: 'https://www.douyin.com/video/1',
      limit: 10,
      filters: { commentTimeMatch: '7days' },
      videoUrl: 'https://www.douyin.com/video/1',
    });

    expect(
      result.map((item: { targetName: string }) => item.targetName),
    ).toEqual(['一颗酸枣核']);
    expect(result.map((item: { text: string }) => item.text)).toEqual([
      '您好，怎么联系',
    ]);
  });

  it('enters an explicitly targeted account work and returns only attributable customer comments', async () => {
    const browser = makeTargetedBrowserMock();
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectTargetedComments({
      accountId: '1',
      searchKeywords: ['目标装修达人'],
      limit: 3,
      filters: {
        targetAccounts: ['目标装修达人'],
        perTargetLimit: 1,
        commentTimeMatch: '7days',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'collected',
      candidates: [
        expect.objectContaining({
          kind: 'targeted-comment',
          targetName: '明确意向客户',
          text: '想了解同款服务和报价',
          videoUrl: 'https://www.douyin.com/video/7390000000000000088',
        }),
      ],
      evidence: expect.objectContaining({
        label: 'douyin-targeted-comment-read',
      }),
    });
    expect(browser.open).toHaveBeenNthCalledWith(
      1,
      'douyin-account-1',
      expect.stringContaining('/search/'),
      { waitUntil: 'domcontentloaded' },
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      2,
      'douyin-account-1',
      'https://www.douyin.com/user/MS4wLjABAAAA-target-001',
      { waitUntil: 'domcontentloaded' },
    );
    expect(browser.open).toHaveBeenNthCalledWith(
      3,
      'douyin-account-1',
      'https://www.douyin.com/video/7390000000000000088',
      { waitUntil: 'domcontentloaded' },
    );
  });

  it('rejects retention free text instead of turning account search results into customers', async () => {
    const browser = makeBrowserMock({});
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectRetentionCandidates({
      accountId: '1',
      searchKeywords: ['活动表单线索'],
      retentionSourceId: '活动表单线索',
      limit: 3,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'target_not_found',
      candidates: [],
      message: expect.stringContaining('不能用普通搜索结果冒充客户'),
    });
    expect(browser.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('turns an explicit retention customer profile into a messageable candidate with evidence', async () => {
    const profileUrl = 'https://www.douyin.com/user/MS4wLjABAAAA-retention-001';
    const browser = makeBrowserMock({
      url: profileUrl,
      title: '已留资装修客户 - 抖音',
      textSample: '已留资装修客户 粉丝 20 获赞 30 作品 2',
    });
    const collector = new DouyinExposureCollector(browser);

    const result = await collector.collectRetentionCandidates({
      accountId: '1',
      searchKeywords: [],
      retentionSourceId: profileUrl,
      limit: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'collected',
      candidates: [
        expect.objectContaining({
          kind: 'retention-contact',
          targetName: '已留资装修客户',
          profileUrl,
        }),
      ],
      evidence: expect.objectContaining({
        label: 'douyin-retention-contact-read',
      }),
    });
  });
});
