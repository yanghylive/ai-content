import { Injectable } from '@nestjs/common';
import type { RpaDriver } from './rpa-driver.interface';

/**
 * RPA 驱动注册表（复核#1）。
 *
 * 六个平台统一从这里按 platform 取驱动；不支持的动作由驱动自身
 * capabilities() 显式声明（不伪装完成）。
 */
@Injectable()
export class RpaDriverRegistry {
  private readonly drivers = new Map<string, RpaDriver>();

  /** 直接入表（带重复检测），避免 onModuleInit 顺序导致空表 */
  register(driver: RpaDriver): void {
    if (this.drivers.has(driver.platform)) {
      throw new Error(`RPA driver 重复注册: ${driver.platform}`);
    }
    this.drivers.set(driver.platform, driver);
  }

  get(platform: string): RpaDriver | null {
    return this.drivers.get(platform) ?? null;
  }

  listPlatforms(): string[] {
    return [...this.drivers.keys()];
  }

  async listCapabilities() {
    const rows: Awaited<ReturnType<RpaDriver['capabilities']>>[] = [];
    for (const driver of this.drivers.values()) {
      rows.push(await driver.capabilities());
    }
    return rows;
  }
}
