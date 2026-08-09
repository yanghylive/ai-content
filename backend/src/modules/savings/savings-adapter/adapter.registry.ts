import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { SavingsAdapter } from '../savings.types';
import { DatokeAdapter } from './datoke.adapter';
import { HaodankuAdapter } from './haodanku.adapter';

/**
 * 供应商适配层注册表（需求清单 V1.1 §5）：
 * 按 CpsVendor 配置路由到对应适配器，支持主备切换（priority）。
 * 业务层通过 resolve(code) 获取适配器，不感知具体供应商。
 *
 * 设计说明：用 ModuleRef 动态获取适配器实例（而非构造注入），
 * 避免接口/具体类类型元数据解析问题，且支持运行时注册新供应商（维易/官方直连二期）。
 */
@Injectable()
export class SavingsAdapterRegistry implements OnModuleInit {
  private readonly adapters = new Map<string, SavingsAdapter>();

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit() {
    // 动态注册全部已配置的适配器（P0 默认大淘客；新增供应商时在此注册并保持可替换）
    const datoke = this.moduleRef.get(DatokeAdapter, { strict: false });
    this.adapters.set(datoke.vendorCode, datoke);
    // P0b 好单库（美团/饿了么 + 万能解析兜底，双供应商拼接）
    const haodanku = this.moduleRef.get(HaodankuAdapter, { strict: false });
    this.adapters.set(haodanku.vendorCode, haodanku);
  }

  /** 按供应商编码获取适配器；未配置的供应商抛 404 提示配置 */
  resolve(vendorCode?: string): SavingsAdapter {
    const code = vendorCode || 'haodanku'; // P0b 起默认好单库（单主力；大淘客保留为备份）
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
