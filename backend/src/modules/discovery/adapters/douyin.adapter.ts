// 抖音 adapter（开发文档 §7.1-7.2 + 大王方案 2026-08-16）
// 三模式：keyword / video-link / target-account。
// 数据来源（无官方 API 授权时的浏览器会话方案）：
//   - keyword / target-account → DiscoveryBrowserRunner（用户登录的 Playwright 会话内辅助采集）
//   - video-link → URL 解析（无需登录）
// 铁律：不用 MediaCrawler stealth/签名/代理；不用 Cookie/验证码绕过替代授权；
// 遇验证码/风控 → 结构化原因码转人工，不伪装成功。
import { createHash } from 'node:crypto';
import type { DiscoveryAdapter } from '../discovery.adapter';
import type {
  DiscoveryCapability,
  DiscoveryContext,
  DiscoveryInput,
  DiscoveryItem,
  ExternalContentRef,
} from '../discovery.types';
import { BrowserDiscoverError, DiscoveryBrowserRunner } from '../discovery-browser-runner';

export class DouyinAdapter implements DiscoveryAdapter {
  readonly platform = 'douyin';

  constructor(
    private readonly runner?: DiscoveryBrowserRunner,
    private readonly config: {
      /** 浏览器会话是否启用（默认启用——有 runner 即可用） */
      browserEnabled?: boolean;
      dailyQuota?: number;
    } = {},
  ) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const browserReady = this.config.browserEnabled !== false && Boolean(this.runner);
    return {
      platform: 'douyin',
      modes: ['keyword', 'video-link', 'target-account'],
      supportsComment: browserReady,
      supportsDm: browserReady,
      publishMode: browserReady ? 'manual' : 'collect-only',
      dailyQuota: browserReady ? (this.config.dailyQuota ?? 200) : 0,
      remainingQuota: browserReady ? (this.config.dailyQuota ?? 200) : 0,
      ...(browserReady
        ? {}
        : {
            unavailableReason:
              '抖音无官方 API 授权，且浏览器会话未启用。启用 auto-upload 浏览器会话后可进行关键词搜索/账号主页发现（用户登录态内辅助采集，遇验证码转人工）。',
          }),
    };
  }

  async *discover(
    input: DiscoveryInput,
    _ctx: DiscoveryContext,
  ): AsyncIterable<DiscoveryItem> {
    const mode = input.mode;
    if (mode === 'video-link') {
      // 视频链接：URL 解析（无需登录/浏览器会话）
      const url = typeof input.input?.url === 'string' ? input.input.url : '';
      if (!url) return;
      const rawHash = createHash('sha256').update(url).digest('hex');
      yield {
        platform: 'douyin',
        accountId: input.accountId,
        sourceContent: {
          externalContentId: url.split('/').filter(Boolean).pop() ?? 'douyin-link',
          url,
          contentType: 'video',
          rawHash,
        },
      };
      return;
    }

    if (!this.runner) {
      throw new BrowserDiscoverError('no_browser_session', '抖音浏览器会话未启用（无官方 API 授权，需浏览器会话进行发现）');
    }

    if (mode === 'keyword') {
      const keyword = typeof input.input?.keyword === 'string' ? input.input.keyword : '';
      if (!keyword?.trim()) {
        throw new BrowserDiscoverError('parse_failed', '关键词模式需要 keyword 参数');
      }
      const items = await this.runner.searchByKeyword({
        platform: 'douyin',
        accountId: input.accountId,
        keyword,
        limit: input.limit,
      });
      for (const item of items) yield item;
      return;
    }

    if (mode === 'target-account') {
      const targetId =
        typeof input.input?.targetId === 'string'
          ? input.input.targetId
          : typeof input.input?.targetAccountId === 'string'
            ? input.input.targetAccountId
            : '';
      if (!targetId?.trim()) {
        throw new BrowserDiscoverError('parse_failed', '目标账号模式需要 targetId 参数');
      }
      const items = await this.runner.listAccountWorks({
        platform: 'douyin',
        accountId: input.accountId,
        targetId,
        limit: input.limit,
      });
      for (const item of items) yield item;
      return;
    }

    throw new BrowserDiscoverError('parse_failed', `不支持的发现模式：${mode}`);
  }

  async fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    return {
      externalContentId:
        ref.externalContentId ?? createHash('sha1').update(ref.url ?? 'douyin').digest('hex').slice(0, 24),
      url: ref.url ?? '',
      contentType: 'video',
      rawHash: createHash('sha256').update(JSON.stringify(ref)).digest('hex'),
    };
  }

  async *fetchInteractions(
    _ref: ExternalContentRef,
    _ctx: DiscoveryContext,
  ): AsyncIterable<never> {
    // 评论抓取走 interaction adapter（autoUpload.readDouyinComments），此处不重复实现
    return;
  }
}
