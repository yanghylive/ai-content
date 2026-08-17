// 抖音 adapter（开发文档 §7.1-7.2，Sprint 5 T5.1）
// 三模式：keyword / video-link / target-account。
// 铁律：不用 MediaCrawler stealth/签名/代理；不用 Cookie/验证码绕过替代授权；
// 账号掉线/验证码/风控返回结构化 reason code，不伪装成功。
import { createHash } from 'node:crypto';
import type { DiscoveryAdapter } from '../discovery.adapter';
import type {
  DiscoveryCapability,
  DiscoveryContext,
  DiscoveryInput,
  DiscoveryItem,
  ExternalContentRef,
} from '../discovery.types';

/** 平台调用失败的结构化原因码（前端据此置灰/提示，不报假成功） */
export type DouyinReasonCode =
  | 'ok'
  | 'unauthorized' // 未授权/授权过期
  | 'login_required' // 需要登录
  | 'captcha_required' // 验证码
  | 'risk_control' // 风控限制
  | 'account_disabled' // 账号封禁
  | 'quota_exhausted' // 额度用尽
  | 'unsupported_mode' // 模式不支持
  | 'network_error'; // 网络异常

export class DouyinAdapter implements DiscoveryAdapter {
  readonly platform = 'douyin';

  constructor(
    private readonly config: {
      /** 官方/授权 API 是否已接入（未接入 → unavailableReason 明确置灰） */
      authorized?: boolean;
      dailyQuota?: number;
    } = {},
  ) {}

  async capabilities(): Promise<DiscoveryCapability> {
    const authorized = this.config.authorized ?? false;
    return {
      platform: 'douyin',
      modes: ['keyword', 'video-link', 'target-account'],
      supportsComment: authorized,
      supportsDm: authorized,
      publishMode: authorized ? 'manual' : 'collect-only',
      dailyQuota: authorized ? (this.config.dailyQuota ?? 200) : 0,
      remainingQuota: authorized ? (this.config.dailyQuota ?? 200) : 0,
      ...(authorized
        ? {}
        : {
            unavailableReason:
              '抖音官方/授权 API 未接入（不采用 Cookie/签名/代理绕过）。接入后可启用 keyword/video-link/target-account 三模式。',
          }),
    };
  }

  async *discover(
    input: DiscoveryInput,
    _ctx: DiscoveryContext,
  ): AsyncIterable<DiscoveryItem> {
    // 未授权：明确报原因码，不产出任何条目（不伪装空数组成功）
    const reason = await this.checkReady(input.mode);
    if (reason !== 'ok') {
      throw new DouyinAdapterError(reason, `抖音 ${input.mode} 模式不可用：${reason}`);
    }
    // —— 授权接入后在此实现三模式发现（keyword 搜索 / video-link 解析 / target-account 主页）——
    return;
  }

  async fetchContent(ref: ExternalContentRef, _ctx: DiscoveryContext) {
    const reason = await this.checkReady('video-link');
    if (reason !== 'ok') {
      throw new DouyinAdapterError(reason, `抖音内容抓取不可用：${reason}`);
    }
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
    const reason = await this.checkReady('keyword');
    if (reason !== 'ok') {
      throw new DouyinAdapterError(reason, `抖音评论抓取不可用：${reason}`);
    }
    return;
  }

  /** 模式可用性检查：未授权一律不可用（结构化原因码） */
  private async checkReady(_mode: string): Promise<DouyinReasonCode> {
    if (!this.config.authorized) return 'unauthorized';
    // 授权接入后：检查登录态/风控/额度，映射为原因码
    return 'ok';
  }
}

/** 平台调用失败（带结构化原因码，前端据此展示，不伪装成功） */
export class DouyinAdapterError extends Error {
  constructor(
    public readonly reasonCode: DouyinReasonCode,
    message: string,
  ) {
    super(message);
    this.name = 'DouyinAdapterError';
  }
}
