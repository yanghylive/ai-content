// 视频号 adapter（开发文档 §7.3 顺序 3，Sprint 5 T5.3）
// 官方授权内容/评论/账号 + 人工链接导入；不用个人微信 UI 自动化。
import type { DiscoveryAdapter } from '../discovery.adapter';
import { DiscoveryBrowserRunner } from '../discovery-browser-runner';
import type { DiscoveryCapability, DiscoveryContext, DiscoveryInput, DiscoveryItem, ExternalContentRef } from '../discovery.types';

export class ShipinhaoAdapter implements DiscoveryAdapter {
  readonly platform = 'wechat-channel';

  constructor(private readonly config: { authorized?: boolean } = {}) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const authorized = this.config.authorized ?? false;
    return {
      platform: 'wechat-channel',
      modes: ['video-link', 'manual-import'],
      supportsComment: authorized,
      supportsDm: false,
      publishMode: authorized ? 'manual' : 'collect-only',
      dailyQuota: authorized ? 100 : 0,
      ...(authorized ? {} : {
        unavailableReason:
          '视频号需官方授权（内容/评论/账号）。不用个人微信 UI 自动化批量获客。未授权时仅支持人工链接导入。',
      }),
    };
  }

  async *discover(_input: DiscoveryInput, _ctx: DiscoveryContext): AsyncIterable<DiscoveryItem> {
    // P1-4（2026-08-17）：空实现不再伪装成功，显式抛 unsupported
    throw new Error('unsupported: 视频号无官方授权时仅支持人工链接导入（VideoLinkAdapter）');
  }

  async fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    return { externalContentId: ref.externalContentId ?? ref.url ?? 'shipinhao', url: ref.url ?? '', contentType: 'video', rawHash: `sp-${ref.url ?? ref.externalContentId ?? ''}` };
  }

  async *fetchInteractions(_ref: ExternalContentRef, _ctx: DiscoveryContext): AsyncIterable<never> {
    return;
  }
}

export class WecomAdapter implements DiscoveryAdapter {
  readonly platform = 'wecom';

  constructor(private readonly config: { authorized?: boolean } = {}) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const authorized = this.config.authorized ?? false;
    return {
      platform: 'wecom',
      modes: ['manual-import'],
      supportsComment: authorized,
      supportsDm: authorized,
      publishMode: authorized ? 'manual' : 'collect-only',
      dailyQuota: authorized ? 500 : 0,
      ...(authorized ? {} : {
        unavailableReason:
          '企微需企业主体授权（客户联系/群聊事件）。未授权时仅支持人工导入。',
      }),
    };
  }

  async *discover(_input: DiscoveryInput, _ctx: DiscoveryContext): AsyncIterable<DiscoveryItem> {
    throw new Error('unsupported: 企微无企业授权时仅支持人工导入');
  }

  async fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    return { externalContentId: ref.externalContentId ?? ref.url ?? 'wecom', url: ref.url ?? '', contentType: 'message', rawHash: `wecom-${ref.url ?? ref.externalContentId ?? ''}` };
  }

  async *fetchInteractions(_ref: ExternalContentRef, _ctx: DiscoveryContext): AsyncIterable<never> {
    return;
  }
}

export class KuaishouAdapter implements DiscoveryAdapter {
  readonly platform = 'kuaishou';

  constructor(
    private readonly config: { authorized?: boolean } = {},
    private readonly runner?: DiscoveryBrowserRunner,
  ) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const browserReady = Boolean(this.runner);
    return {
      platform: 'kuaishou',
      modes: browserReady ? ['keyword', 'video-link', 'target-account'] : ['video-link'],
      supportsComment: browserReady,
      supportsDm: false,
      publishMode: browserReady ? 'manual' : 'collect-only',
      dailyQuota: browserReady ? 200 : 0,
      ...(browserReady ? {} : {
        unavailableReason: '快手需浏览器会话（用户登录态）或官方授权。未启用时仅支持人工链接导入。',
      }),
    };
  }

  async *discover(input: DiscoveryInput, _ctx: DiscoveryContext): AsyncIterable<DiscoveryItem> {
    if (!this.runner) throw new Error('unsupported: 快手浏览器会话未启用');
    if (input.mode === 'keyword') {
      const keyword = typeof input.input?.keyword === 'string' ? input.input.keyword : '';
      if (!keyword?.trim()) throw new Error('关键词模式需要 keyword 参数');
      const items = await this.runner.searchByKeyword({ platform: 'kuaishou', accountId: input.accountId, keyword, limit: input.limit });
      for (const item of items) yield item;
      return;
    }
    if (input.mode === 'target-account') {
      const targetId = typeof input.input?.targetId === 'string' ? input.input.targetId : '';
      if (!targetId?.trim()) throw new Error('目标账号模式需要 targetId 参数');
      const items = await this.runner.listAccountWorks({ platform: 'kuaishou', accountId: input.accountId, targetId, limit: input.limit });
      for (const item of items) yield item;
      return;
    }
    throw new Error(`unsupported: 快手不支持的发现模式 ${input.mode}`);
  }

  async fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    return { externalContentId: ref.externalContentId ?? ref.url ?? 'kuaishou', url: ref.url ?? '', contentType: 'video', rawHash: `ks-${ref.url ?? ref.externalContentId ?? ''}` };
  }

  async *fetchInteractions(_ref: ExternalContentRef, _ctx: DiscoveryContext): AsyncIterable<never> {
    return;
  }
}

export class XiaohongshuAdapter implements DiscoveryAdapter {
  readonly platform = 'xiaohongshu';

  constructor(
    private readonly config: { authorized?: boolean } = {},
    private readonly runner?: DiscoveryBrowserRunner,
  ) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const browserReady = Boolean(this.runner);
    return {
      platform: 'xiaohongshu',
      modes: browserReady ? ['keyword', 'video-link', 'target-account'] : ['video-link'],
      supportsComment: browserReady,
      supportsDm: false,
      publishMode: browserReady ? 'manual' : 'collect-only',
      dailyQuota: browserReady ? 200 : 0,
      ...(browserReady ? {} : {
        unavailableReason: '小红书需浏览器会话（用户登录态）或官方 connector 接入；未启用时仅支持人工链接导入。',
      }),
    };
  }

  async *discover(input: DiscoveryInput, _ctx: DiscoveryContext): AsyncIterable<DiscoveryItem> {
    if (!this.runner) throw new Error('unsupported: 小红书浏览器会话未启用');
    if (input.mode === 'keyword') {
      const keyword = typeof input.input?.keyword === 'string' ? input.input.keyword : '';
      if (!keyword?.trim()) throw new Error('关键词模式需要 keyword 参数');
      const items = await this.runner.searchByKeyword({ platform: 'xiaohongshu', accountId: input.accountId, keyword, limit: input.limit });
      for (const item of items) yield item;
      return;
    }
    if (input.mode === 'target-account') {
      const targetId = typeof input.input?.targetId === 'string' ? input.input.targetId : '';
      if (!targetId?.trim()) throw new Error('目标账号模式需要 targetId 参数');
      const items = await this.runner.listAccountWorks({ platform: 'xiaohongshu', accountId: input.accountId, targetId, limit: input.limit });
      for (const item of items) yield item;
      return;
    }
    throw new Error(`unsupported: 小红书不支持的发现模式 ${input.mode}`);
  }

  async fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    return { externalContentId: ref.externalContentId ?? ref.url ?? 'xhs', url: ref.url ?? '', contentType: 'note', rawHash: `xhs-${ref.url ?? ref.externalContentId ?? ''}` };
  }

  async *fetchInteractions(_ref: ExternalContentRef, _ctx: DiscoveryContext): AsyncIterable<never> {
    return;
  }
}
