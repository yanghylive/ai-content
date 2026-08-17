// 发现适配器契约（开发文档 §7.1，统一开发计划 §六）
// 各平台实现此接口；平台 unsupported 时 capabilities() 返回 unavailableReason 而非空数组。
import type {
  DiscoveryCapability,
  DiscoveryContext,
  DiscoveryInput,
  DiscoveryItem,
  ExternalContentRef,
} from './discovery.types';

export interface DiscoveryAdapter {
  readonly platform: string;

  /** 平台/模式能力声明（含额度、冷却、最近同步） */
  capabilities(): Promise<DiscoveryCapability>;

  /** 发现候选（AsyncIterable 流式产出，支持 cursor 恢复） */
  discover(
    input: DiscoveryInput,
    ctx: DiscoveryContext,
  ): AsyncIterable<DiscoveryItem>;

  /** 抓取单条来源内容 */
  fetchContent(
    ref: ExternalContentRef,
    ctx: DiscoveryContext,
  ): Promise<{
    externalContentId: string;
    url: string;
    contentType: string;
    authorIdentityId?: string;
    title?: string;
    text?: string;
    rawHash: string;
  }>;

  /** 抓取来源内容的互动事件 */
  fetchInteractions(
    ref: ExternalContentRef,
    ctx: DiscoveryContext,
  ): AsyncIterable<{
    externalEventId: string;
    type: string;
    authorExternalId?: string;
    text?: string;
    sourceUrl?: string;
    occurredAt: string;
    evidenceUrl?: string;
  }>;
}
