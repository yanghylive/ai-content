import { BaseRpaDriver } from './base-rpa.driver';
import type { RpaSession, RpaStepResult } from './rpa.types';

/**
 * 微信系 RPA 驱动（视频号/微信/企微，§7.3 顺序 3-4）。
 *
 * 视频号无独立网页搜索入口、微信/企微需桌面客户端——当前仅支持人工导入
 * （manual-import），其余动作 capabilities() 显式 unsupported（不用手工模式
 * 伪装成自动完成）。这是 §7.4 铁律：不支持就说不支持。
 */
export class WechatFamilyRpaDriver extends BaseRpaDriver {
  readonly platform: string;
  readonly displayName: string;
  readonly driverVersion = '1.0.0';

  constructor(
    platform: 'wechat-channel' | 'wechat' | 'wecom',
    displayName: string,
    private readonly unsupportedDetail: string,
  ) {
    super();
    this.platform = platform;
    this.displayName = displayName;
  }

  protected runtimeReady(): boolean {
    return false;
  }

  protected declareActions() {
    return [
      {
        action: 'discover-keyword' as const,
        supported: false,
        unavailableReason: this.unsupportedDetail,
        unavailableReasonCode: 'no_web_search_entry' as const,
      },
      {
        action: 'discover-account-works' as const,
        supported: false,
        unavailableReason: this.unsupportedDetail,
        unavailableReasonCode: 'no_web_search_entry' as const,
      },
      {
        action: 'read-comments' as const,
        supported: false,
        unavailableReason: `${this.displayName}读评论需桌面客户端或官方授权，暂未实现`,
        unavailableReasonCode: 'unsupported' as const,
      },
      {
        action: 'reply-comment' as const,
        supported: false,
        unavailableReason: `${this.displayName}回复需桌面客户端或官方授权，暂未实现`,
        unavailableReasonCode: 'unsupported' as const,
      },
      {
        action: 'send-direct-message' as const,
        supported: false,
        unavailableReason: `${this.displayName}私信需桌面客户端或官方授权，暂未实现`,
        unavailableReasonCode: 'unsupported' as const,
      },
    ];
  }

  protected runStep(
    _session: RpaSession,
    action: string,
    _input: Record<string, unknown>,
  ): Promise<RpaStepResult> {
    const startedAt = Date.now();
    return Promise.resolve(
      this.stepResult(action, 'failed', 'unsupported', startedAt, {
        message: this.unsupportedDetail,
      }),
    );
  }

  openSession(): Promise<RpaSession> {
    return Promise.reject(new Error(`unsupported: ${this.unsupportedDetail}`));
  }
}
