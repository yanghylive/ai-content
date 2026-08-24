import {
  Controller,
  Post,
  Req,
  HttpCode,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { Inject } from "@nestjs/common";
import { AuthService } from "../agent-gateway/core/auth";
import type { AuthenticatedUser } from "./auth.types";

/**
 * 4.4 多工作区标签壳 · 会话 → kaypal 令牌桥接。
 *
 * 前端（React 切换器）只持有 session cookie，没有 kaypal HMAC 令牌，
 * 而 /api/workspaces 由 KaypalAuthGuard 保护（需要 kaypal 令牌）。
 * 本端点用全局 AuthGuard 校验 session cookie 拿到登录用户，再以与
 * agent-gateway 完全相同的密钥签发一张 kaypal HMAC 令牌返回，供前端
 * 调用 /api/workspaces（list/create）以及未来工作区作用域的接口。
 *
 * 设计要点：
 * - 身份只用服务端派生值：tenantId = userId = kaypalUserId || 本地 user.id，
 *   与 /api/workspaces 创建/查询时使用的身份完全一致（scope 一致）。
 * - agentId 仅用于令牌合法性（verify 要求非空），不影响 workspace 隔离。
 * - 该令牌为前端调用凭据，按 1h 过期；前端自行缓存并在鉴权失败时刷新。
 */
const WORKSPACE_TOKEN_TTL_MS = 3_600_000;

type WorkspaceTokenRequest = Request & { authUser?: AuthenticatedUser };

@Controller("auth")
export class WorkspaceTokenController {
  constructor(
    @Inject("AGENT_GATEWAY_AUTH_SERVICE")
    private readonly agentAuth: AuthService,
  ) {}

  @Post("workspace-token")
  @HttpCode(200)
  issueWorkspaceToken(@Req() req: WorkspaceTokenRequest) {
    const user = req.authUser;
    if (!user) {
      throw new UnauthorizedException("请先登录");
    }
    const identity =
      (user.kaypalUserId && user.kaypalUserId.trim()) || user.id;
    if (!identity) {
      throw new UnauthorizedException("无法签发工作区令牌：用户身份缺失");
    }
    const token = this.agentAuth.issue(
      { tenantId: identity, userId: identity, agentId: "desktop-shell" },
      WORKSPACE_TOKEN_TTL_MS,
    );
    return { token };
  }
}
