// 视频号 adapter（开发文档 §7.3 顺序 3，Sprint 5 T5.3）
// 官方授权内容/评论/账号 + 人工链接导入；不用个人微信 UI 自动化。
import type { DiscoveryAdapter } from '../discovery.adapter';
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
    return; // 人工链接导入见 VideoLinkAdapter；官方授权后实现
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
    return;
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

  constructor(private readonly config: { authorized?: boolean } = {}) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const authorized = this.config.authorized ?? false;
    return {
      platform: 'kuaishou',
      modes: ['video-link', 'target-account'],
      supportsComment: authorized,
      supportsDm: false,
      publishMode: authorized ? 'manual' : 'collect-only',
      dailyQuota: authorized ? 200 : 0,
      ...(authorized ? {} : {
        unavailableReason: '快手需官方允许的账号/内容/关系链接入。未授权时仅支持人工链接导入。',
      }),
    };
  }

  async *discover(_input: DiscoveryInput, _ctx: DiscoveryContext): AsyncIterable<DiscoveryItem> {
    return;
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

  constructor(private readonly config: { authorized?: boolean } = {}) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const authorized = this.config.authorized ?? false;
    return {
      platform: 'xiaohongshu',
      modes: ['video-link', 'target-account'],
      supportsComment: authorized,
      supportsDm: false,
      publishMode: authorized ? 'manual' : 'collect-only',
      dailyQuota: authorized ? 200 : 0,
      ...(authorized ? {} : {
        unavailableReason: '小红书按 capability 允许的 connector 接入；未授权时 unsupported 置灰，不报假成功。',
      }),
    };
  }

  async *discover(_input: DiscoveryInput, _ctx: DiscoveryContext): AsyncIterable<DiscoveryItem> {
    return;
  }

  async fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    return { externalContentId: ref.externalContentId ?? ref.url ?? 'xhs', url: ref.url ?? '', contentType: 'note', rawHash: `xhs-${ref.url ?? ref.externalContentId ?? ''}` };
  }

  async *fetchInteractions(_ref: ExternalContentRef, _ctx: DiscoveryContext): AsyncIterable<never> {
    return;
  }
}
