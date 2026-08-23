import { Capabilities, TenantContext } from '../core/types';
import { genId } from '../core/util';

/**
 * Octop 适配层（mock）—— 对齐《整合 PRD》5 / 《补充包》2、8。
 * 真实实现需：启动 Octop v0.9.26、健康检查、token exchange、同源 WS、静态资源、回退。
 * 这里只模拟会话/令牌/能力探测，并提供一个“高级模式”事件流演示。
 */
export interface OctopAdapter {
  createSession(ctx: TenantContext): Promise<{ octopSessionId: string }>;
  tokenExchange(octopSessionId: string): Promise<{ token: string; expiresAt: string }>;
  /** 下发取消/暂停指令给正在执行的 RPA（真实环境经 Octop 控制面） */
  cancelRun(sessionId: string, reason?: string): Promise<{ cancelled: boolean }>;
  getCapabilities(): Capabilities;
  healthy(): boolean;
  setHealthy(v: boolean): void;
}

export class MockOctopAdapter implements OctopAdapter {
  private healthyFlag = true;
  private caps: Capabilities;

  constructor(businessTools: string[] = []) {
    this.caps = {
      browser: { available: true },
      computer: { available: true },
      mobile: { available: true },
      file: { available: true },
      businessTools,
    };
  }

  async createSession(_ctx: TenantContext): Promise<{ octopSessionId: string }> {
    if (!this.healthyFlag) throw new Error('OCTOP_UNAVAILABLE');
    return { octopSessionId: genId('octop') };
  }

  async tokenExchange(octopSessionId: string): Promise<{ token: string; expiresAt: string }> {
    if (!this.healthyFlag) throw new Error('OCTOP_UNAVAILABLE');
    return {
      token: `tok_${octopSessionId}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async cancelRun(_sessionId: string, _reason?: string): Promise<{ cancelled: boolean }> {
    if (!this.healthyFlag) throw new Error('OCTOP_UNAVAILABLE');
    return { cancelled: true };
  }

  getCapabilities(): Capabilities {
    if (!this.healthyFlag) {
      return {
        browser: { available: false, degraded: true, reason: 'Octop 不可用，已降级为 3010 原生工具' },
        computer: { available: false, degraded: true, reason: 'Octop 不可用' },
        mobile: { available: false, degraded: true, reason: 'Octop 不可用' },
        file: { available: false, degraded: true, reason: 'Octop 不可用' },
        businessTools: this.caps.businessTools,
      };
    }
    return this.caps;
  }

  healthy(): boolean {
    return this.healthyFlag;
  }

  setHealthy(v: boolean): void {
    this.healthyFlag = v;
  }
}
