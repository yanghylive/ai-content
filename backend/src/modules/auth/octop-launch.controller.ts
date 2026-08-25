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

    // 用户级 SSO（审计 #2）：由**后端**从已登录 Kaypal 用户确定性派生 Octop 身份，
    // per-user 模式首次访问自动开号 → 每用户独立 Octop 浏览器会话/cookie。
    // 刻意不接受前端传 Octop 用户名/密码：凭据进 URL 会落到访问日志与浏览器历史。
    let token: string | null = null;
    let isolated = false;
    try {
      const r = await this.bridge.loginOctop({ kaypalUserId: user.id });
      token = r.token;
      isolated = r.isolated === true;
    } catch {
      token = null;
    }

    // isolated=false 表示回退到共享 Octop 账号（单机单用户场景可接受；
    // 多用户部署下代表会话/cookie 会跨用户共享，前端据此提示运维配置）。
    return { octopBaseUrl: octopBase, healthy, token, isolated };
  }
}
