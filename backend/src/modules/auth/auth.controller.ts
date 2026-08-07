import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AUTH_COOKIE_NAME, AUTH_SESSION_DAYS } from './auth.constants';
import { Public } from './auth.decorator';
import type {
  AuthenticatedUser,
  AuthenticatedUserResponse,
} from './auth.types';
import { shouldUseSecureAuthCookie } from './cookie-options';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
};

/** 微信登录回跳目标白名单（只允许站内路径） */
function normalizeWechatNext(value: string | undefined): string {
  const fallback = '/';
  if (!value) return fallback;
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return fallback;
  return value;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('setup-status')
  getSetupStatus() {
    return this.authService.getSetupStatus();
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      !body ||
      typeof body.username !== 'string' ||
      typeof body.password !== 'string'
    ) {
      throw new BadRequestException('账号和密码不能为空');
    }
    const result = await this.authService.login({
      username: body.username,
      password: body.password,
    });

    response.cookie(AUTH_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureAuthCookie(),
      maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return {
      user: result.user,
      expiresAt: result.expiresAt,
    };
  }

  /**
   * 微信登录入口（kaypal 认证服务原生支持微信扫码）：
   * 直接 302 到 kaypal 微信授权 URL（浏览器走 kaypal 域，
   * state cookie 由 kaypal 设置），扫码成功后由 kaypal 回跳
   * 到我们 /auth/wechat/callback（带 kaypalToken）。
   */
  @Public()
  @Get('wechat/start')
  async wechatStart(@Res() response: Response, @Query('next') next?: string) {
    const callbackUrl = `${this.getPublicOrigin()}/api/auth/wechat/callback?next=${encodeURIComponent(
      normalizeWechatNext(next),
    )}`;
    const kaypalUrlEndpoint = await this.authService.getWechatUrlEndpoint();
    return response.redirect(
      302,
      `${kaypalUrlEndpoint}?returnUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }

  /** 微信扫码回调（kaypal 回跳带 kaypalToken）：换用户建会话后 302 回前端 */
  @Public()
  @Get('wechat/callback')
  async wechatCallback(
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const handled = await this.authService.handleWechatCallback(query);
    if (!handled || !('sessionToken' in handled) || !handled.sessionToken) {
      response.redirect(
        302,
        `/login?error=${encodeURIComponent(
          handled && 'error' in handled && handled.error
            ? handled.error
            : '微信登录失败',
        )}`,
      );
      return; // passthrough 模式下不得 return response 对象（headers 已发会二次写）
    }
    response.cookie(AUTH_COOKIE_NAME, handled.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureAuthCookie(),
      maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });
    response.redirect(302, normalizeWechatNext(query.next) || '/');
    return;
  }

  private getPublicOrigin() {
    const configured = this.authService.getConfiguredPublicOrigin();
    return configured || 'http://127.0.0.1:3011';
  }

  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.authSessionId);
    response.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureAuthCookie(),
      path: '/',
    });
    return { success: true };
  }

  @Get('me')
  getMe(
    @Req() request: AuthenticatedRequest,
  ): AuthenticatedUserResponse | undefined {
    const user = request.authUser;
    if (!user) {
      return undefined;
    }

    const { kaypalDesktopAccessToken, kaypalDesktopRefreshToken, ...safeUser } =
      user;
    return {
      ...safeUser,
      hasKaypalDesktopSession: Boolean(
        user.kaypalUserId &&
        (kaypalDesktopAccessToken || kaypalDesktopRefreshToken),
      ),
    };
  }

  @Get('tenants')
  async listCurrentUserTenants(@Req() request: AuthenticatedRequest) {
    const user = request.authUser;
    if (!user) return [];
    const memberships = await this.prisma.tenantMember.findMany({
      where: {
        userId: user.id,
        status: 'active',
        tenant: { status: 'active' },
      },
      select: {
        tenantId: true,
        role: true,
        tenant: { select: { name: true, slug: true } },
      },
      orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!memberships.length && user.kaypalLocalOnly === true) {
      return [
        {
          tenantId: `local-desktop:${user.id}`,
          name: '本机工作区',
          slug: 'local-desktop',
          role: 'owner',
        },
      ];
    }
    return memberships.map((membership) => ({
      tenantId: membership.tenantId,
      name: membership.tenant.name,
      slug: membership.tenant.slug,
      role: membership.role,
    }));
  }

  /**
   * 用户与权限管理（仅 admin 角色可访问）
   * GET /api/auth/users — 列出所有用户 + 角色
   * PATCH /api/auth/users/:id/role — 改某用户角色 / 计划模式 / 商用执行权限
   */
  @Get('users')
  async listUsers(@Req() request: AuthenticatedRequest) {
    const tenantId = await this.requireAdminTenant(request);
    const users = await this.prisma.user.findMany({
      where: {
        tenantMemberships: {
          some: { tenantId, status: 'active' },
        },
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        status: true,
        role: true,
        commercialExecutionAllowed: true,
        planMode: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return users;
  }

  @Patch('users/:id/role')
  async updateUserRole(
    @Param('id') id: string,
    @Body()
    body: {
      role?: string;
      planMode?: string;
      commercialExecutionAllowed?: boolean;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    const tenantId = await this.requireAdminTenant(request);
    const targetMembership = await this.prisma.tenantMember.findFirst({
      where: { tenantId, userId: id, status: 'active' },
      select: { id: true, role: true },
    });
    if (!targetMembership) {
      throw new ForbiddenException('只能管理当前组织内的用户');
    }
    const allowedRoles = ['operator', 'manager', 'admin'];
    const allowedPlans = ['trial', 'commercial'];

    const data: Record<string, unknown> = {};
    if (body.role !== undefined) {
      if (!allowedRoles.includes(body.role)) {
        throw new BadRequestException(
          `role 必须是 ${allowedRoles.join('/')} 之一`,
        );
      }
      // 不允许最后一个 admin 被降级（防自锁）
      if (
        body.role !== 'admin' &&
        request.authUser?.id === id &&
        targetMembership.role === 'admin'
      ) {
        const adminCount = await this.prisma.tenantMember.count({
          where: { tenantId, status: 'active', role: 'admin' },
        });
        if (adminCount <= 1) {
          throw new ForbiddenException('不能降级最后一个 admin 角色');
        }
      }
      data.role = body.role;
    }
    if (body.planMode !== undefined) {
      if (!allowedPlans.includes(body.planMode)) {
        throw new BadRequestException(
          `planMode 必须是 ${allowedPlans.join('/')} 之一`,
        );
      }
      data.planMode = body.planMode;
    }
    if (body.commercialExecutionAllowed !== undefined) {
      data.commercialExecutionAllowed = Boolean(
        body.commercialExecutionAllowed,
      );
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('请至少传一个要更新的字段');
    }

    return this.prisma.$transaction(async (tx) => {
      if (body.role !== undefined) {
        await tx.tenantMember.update({
          where: { id: targetMembership.id },
          data: {
            role: body.role === 'operator' ? 'member' : body.role,
          },
        });
      }
      return tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          commercialExecutionAllowed: true,
          planMode: true,
          updatedAt: true,
        },
      });
    });
  }

  private async requireAdminTenant(request: AuthenticatedRequest) {
    this.assertAdmin(request.authUser);
    const requestedTenantHeader = request.headers?.['x-tenant-id'];
    const requestedTenantId = Array.isArray(requestedTenantHeader)
      ? requestedTenantHeader[0]
      : requestedTenantHeader;
    const membership = await this.prisma.tenantMember.findFirst({
      where: {
        userId: request.authUser!.id,
        status: 'active',
        role: { in: ['admin', 'owner'] },
        tenant: { status: 'active' },
        ...(requestedTenantId ? { tenantId: requestedTenantId } : {}),
      },
      orderBy: { joinedAt: 'asc' },
      select: { tenantId: true },
    });
    if (!membership) {
      throw new ForbiddenException('需要当前组织的管理员权限');
    }
    return membership.tenantId;
  }

  private assertAdmin(user?: AuthenticatedUser) {
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('需要 admin 角色');
    }
  }
}
