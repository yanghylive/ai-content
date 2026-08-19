// 视频链接通用 adapter（开发文档 §7.3 顺序 2，Sprint 5 T5.2）
// 最低风险模式：粘贴视频/笔记链接 → 解析平台 + 外部内容 ID → 产出 DiscoveryItem。
// 评论抓取需要各平台官方 connector（unsupported 时明确返回，不假报成功）。
import { createHash } from 'node:crypto';
import type { DiscoveryAdapter } from '../discovery.adapter';
import type {
  DiscoveryCapability,
  DiscoveryContext,
  DiscoveryInput,
  DiscoveryItem,
  ExternalContentRef,
} from '../discovery.types';
import { asyncIterableFromArray, emptyAsyncIterable } from './async-iterable';

/** 常见平台 URL 模式 → { platform, externalContentId } */
const URL_PATTERNS: Array<{
  platform: string;
  test: RegExp;
  extract: (url: string) => string | null;
}> = [
  {
    platform: 'douyin',
    test: /douyin\.com\/video\//,
    extract: (u) => {
      const m = u.match(/douyin\.com\/video\/(\d+)/);
      return m ? m[1] : null;
    },
  },
  {
    platform: 'xiaohongshu',
    test: /xiaohongshu\.com\/(explore|discovery\/item)\//,
    extract: (u) => {
      const m = u.match(/\/(?:explore|discovery\/item)\/([0-9a-zA-Z]+)/);
      return m ? m[1] : null;
    },
  },
  {
    platform: 'bilibili',
    test: /bilibili\.com\/video\//,
    extract: (u) => {
      const m = u.match(/\/video\/(BV[0-9A-Za-z]+)/);
      return m ? m[1] : null;
    },
  },
  {
    platform: 'kuaishou',
    test: /kuaishou\.com\/short-video\//,
    extract: (u) => {
      const m = u.match(/short-video\/(\w+)/);
      return m ? m[1] : null;
    },
  },
];

export function parseVideoUrl(
  url: string,
): { platform: string; externalContentId: string } | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  for (const p of URL_PATTERNS) {
    if (p.test.test(u)) {
      const id = p.extract(u);
      if (id) return { platform: p.platform, externalContentId: id };
    }
  }
  return null;
}

export class VideoLinkAdapter implements DiscoveryAdapter {
  readonly platform = 'video-link';

  capabilities(): Promise<DiscoveryCapability> {
    return Promise.resolve<DiscoveryCapability>({
      platform: 'video-link',
      modes: ['video-link'],
      supportsComment: false, // 评论需平台官方 connector
      supportsDm: false,
      publishMode: 'collect-only',
      dailyQuota: 500,
      unavailableReason:
        '视频链接可解析来源内容；评论/私信抓取需对应平台的官方授权 connector',
    });
  }

  discover(
    input: DiscoveryInput,
    _ctx: DiscoveryContext,
  ): AsyncIterable<DiscoveryItem> {
    const url = typeof input.input?.url === 'string' ? input.input.url : '';
    const parsed = parseVideoUrl(url);
    if (!parsed) return emptyAsyncIterable();
    const rawHash = createHash('sha256').update(url).digest('hex');
    return asyncIterableFromArray([
      {
        platform: parsed.platform,
        accountId: input.accountId,
        sourceContent: {
          externalContentId: parsed.externalContentId,
          url,
          contentType: 'video',
          rawHash,
        },
      },
    ]);
  }

  fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    const url = ref.url ?? '';
    const parsed = parseVideoUrl(url);
    return Promise.resolve({
      externalContentId:
        ref.externalContentId ??
        parsed?.externalContentId ??
        createHash('sha1').update(url).digest('hex').slice(0, 24),
      url,
      contentType: 'video',
      rawHash: createHash('sha256').update(JSON.stringify(ref)).digest('hex'),
    });
  }

  fetchInteractions(
    _ref: ExternalContentRef,
    _ctx: DiscoveryContext,
  ): AsyncIterable<never> {
    // 评论抓取需要平台官方 connector；此处明确不产出，避免假数据
    return emptyAsyncIterable();
  }
}
