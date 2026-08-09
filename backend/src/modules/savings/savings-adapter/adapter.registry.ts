import { Injectable, NotFoundException } from '@nestjs/common';
import type { SavingsAdapter } from '../savings.types';

/**
 * 供应商适配层注册表（需求清单 V1.1 §5）：
 * 按 CpsVendor 配置路由到对应适配器，支持主备切换（priority）。
 * 业务层通过 resolve(code) 获取适配器，不感知具体供应商。
 */
@Injectable()
export class SavingsAdapterRegistry {
  private readonly adapters = new Map<string, SavingsAdapter>();

  constructor(datoke: SavingsAdapter) {
    // 注册全部适配器（P0 默认大淘客；维易/官方直连二期接入时在此注册）
    this.adapters.set(datoke.vendorCode, datoke);
  }

  /** 按供应商编码获取适配器；未配置的供应商抛 404 提示配置 */
  resolve(vendorCode?: string): SavingsAdapter {
    const code = vendorCode || 'datoke'; // P0 默认大淘客
    const adapter = this.adapters.get(code);
    if (!adapter) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_CONFIGURED',
        message: `CPS 供应商「${code}」未注册，请先在后台配置供应商（CpsVendor）`,
      });
    }
    return adapter;
  }

  /** 全部已注册供应商（管理端展示） */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}
