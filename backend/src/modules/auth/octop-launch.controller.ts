import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { KaypalOctopBridge } from '../agent-gateway/kaypal-octop-bridge';
import type { AuthenticatedUser } from './auth.types';

type ReqWithUser = Request & { authUser?: AuthenticatedUser };

/**
 * 桌面端 Octop 高级模式拉起端点（双工作区方案：连接本机已运行的 Octop）。
 *
 * 链路：3010 登录态（全局 AuthGuard 会话）→ 本端点用 KaypalOctopBridge 取 Octop 服务令牌
 * → 返回 { octopBaseUrl, healthy, token } 给桌面端 → 桌面端注入 Octop WebContentsView 实现免登录。
 *
 * 商用策略（大王 2026-08-24 拍板）：**不按订阅/角色限制**——利润来自算力差价，
 * 任何已登录用户（含 trial）均可使用 Octop 高级模式；用量由 agent-gateway 计费链路结算。
 *
 * 不依赖 OCTOP_ENABLED（桌面端始终尝试连接本机 Octop）；Octop 未运行 → healthy=false、
 * 凭据未配 → token=null，桌面端据此显示降级态。
 */
@Controller('octop')
export class OctopLaunchController {
  constructor(private readonly bridge: KaypalOctopBridge) {}

  @Get('launch')
  async launch(@Req() req: ReqWithUser) {
    const user = req.authUser;
    if (!user) throw new UnauthorizedException('请先登录');

    const octopBase =
      process.env.OCTOP_BASE_URL?.trim() || 'http://127.0.0.1:8088';

    let healthy = false;
    try {
      const r = await fetch(`${octopBase}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      healthy = r.ok;
    } catch {
      healthy = false;
    }
    // Octop 未运行：短路返回，不再白等 loginOctop（最多 5s）
    if (!healthy) {
      return { octopBaseUrl: octopBase, healthy: false, token: null };
    }

    let token: string | null = null;
    try {
      const r = await this.bridge.loginOctop();
      token = r.token;
    } catch {
      token = null;
    }

    return { octopBaseUrl: octopBase, healthy, token };
  }
}
