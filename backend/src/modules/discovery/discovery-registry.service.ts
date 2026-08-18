// 发现中心统一 Registry（P1-4，2026-08-17）
// 注册全部平台 adapter，提供能力声明与发现编排，空实现/未授权显式 unsupported。
import { Injectable } from '@nestjs/common';
import type { DiscoveryAdapter } from './discovery.adapter';
import type { DiscoveryCapability, DiscoveryContext, DiscoveryInput, DiscoveryItem } from './discovery.types';
import { DouyinAdapter } from './adapters/douyin.adapter';
import { ManualAdapter } from './adapters/manual.adapter';
import { VideoLinkAdapter } from './adapters/video-link.adapter';
import {
  ShipinhaoAdapter,
  WecomAdapter,
  KuaishouAdapter,
  XiaohongshuAdapter,
} from './adapters/platform-connectors';

@Injectable()
export class DiscoveryRegistry {
  private readonly adapters = new Map<string, DiscoveryAdapter>();

  constructor(
    douyin: DouyinAdapter,
    manual: ManualAdapter,
    videoLink: VideoLinkAdapter,
    shipinhao: ShipinhaoAdapter,
    wecom: WecomAdapter,
    kuaishou: KuaishouAdapter,
    xiaohongshu: XiaohongshuAdapter,
  ) {
    for (const a of [douyin, manual, videoLink, shipinhao, wecom, kuaishou, xiaohongshu]) {
      this.adapters.set(a.platform, a);
    }
  }

  getAdapter(platform: string): DiscoveryAdapter | undefined {
    return this.adapters.get(platform);
  }

  async listCapabilities(): Promise<DiscoveryCapability[]> {
    const rows: DiscoveryCapability[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        rows.push(await adapter.capabilities());
      } catch {
        // 单个 adapter 能力声明失败不阻塞其他平台
      }
    }
    return rows;
  }

  async capabilitiesOf(platform: string): Promise<DiscoveryCapability | null> {
    const adapter = this.adapters.get(platform);
    if (!adapter) return null;
    return adapter.capabilities();
  }

  /** 发现编排：调用对应平台 adapter，收集为数组（limit 上限保护） */
  async collect(input: DiscoveryInput, ctx: DiscoveryContext, maxItems = 50): Promise<DiscoveryItem[]> {
    const adapter = this.adapters.get(input.platform);
    if (!adapter) throw new Error(`unsupported: 平台 ${input.platform} 未注册发现能力`);
    const items: DiscoveryItem[] = [];
    for await (const item of adapter.discover(input, ctx)) {
      items.push(item);
      if (items.length >= maxItems) break;
    }
    return items;
  }
}
