import {
  BadRequestException,
  UnauthorizedException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ForbiddenException,
  HttpException,
  HttpStatus,
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
import { getPlanSeatRule } from './plan-order';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { Logger } from '@nestjs/common';

/** 登录限流：同账号+IP 连续失败 N 次锁定，防爆破 */
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000; // 15 分钟窗口
const LOGIN_MAX_FAILS = 5; // 窗口内最多 5 次失败
const loginFailRecords = new Map<string, { count: number; firstAt: number }>();

function loginFailKey(username: string, ip: string) {
  return `${username.toLowerCase()}|${ip}`;
}

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
};

/** 微信登录回跳目标白名单（只允许站内路径） */
export function normalizeWechatNext(value: string | undefined): string {
  // v1.1.105（登录跳转修复）：wechat/start 与 wechatQr 生成 callbackUrl 时对 next
  // 做了 encodeURIComponent——callback 收到的 query.next 是编码串（如 %2Fagent），
  // 直接按原始编码串做 startsWith('/') 白名单校验必然失败 → fallback '/' →
  // 登录成功跳到根路径而非用户原目标页。这里先安全解码一次再校验。
  let decoded = value;
  if (value) {
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value; // 非法编码原样，走白名单校验
    }
  }
  const fallback = '/';
  if (!decoded) return fallback;
  if (
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    decoded.includes('\\')
  ) {
    return fallback;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded)) return fallback;
  return decoded;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

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
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      !body ||
      typeof body.username !== 'string' ||
      typeof body.password !== 'string'
    ) {
      throw new BadRequestException('账号和密码不能为空');
    }

    // 登录限流：同账号+IP 连续失败 5 次锁定 15 分钟
    const ip = String(request.ip || request.socket?.remoteAddress || '');
    const key = loginFailKey(body.username, ip);
    const now = Date.now();
    const rec = loginFailRecords.get(key);
    if (rec && now - rec.firstAt < LOGIN_FAIL_WINDOW_MS) {
      if (rec.count >= LOGIN_MAX_FAILS) {
        throw new HttpException(
          '登录失败次数过多，请 15 分钟后再试',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } else if (rec) {
      loginFailRecords.delete(key); // 窗口过期重置
    }

    let result: Awaited<ReturnType<AuthService['login']>>;
    try {
      result = await this.authService.login({
        username: body.username,
        password: body.password,
      });
    } catch (err) {
      // 登录失败：累加计数（仅对认证失败类错误，不吞网络/内部错误）
      const cur = loginFailRecords.get(key) ?? { count: 0, firstAt: now };
      loginFailRecords.set(key, { count: cur.count + 1, firstAt: cur.firstAt });
      throw err;
    }
    loginFailRecords.delete(key); // 登录成功清零

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

  /** App 内微信一键登录（2026-08-11）：微信 SDK code → 建会话（需企业资质 AppID） */
  @Public()
  @Post('wechat-app-login')
  async wechatAppLogin(
    @Body() body: { code?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.wechatAppLogin(body?.code ?? '');
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
  wechatStart(
    @Req() request: Request,
    @Res() response: Response,
    @Query('next') next?: string,
    @Query('origin') origin?: string,
  ) {
    // 根治（2026-08-12）：回调 returnUrl 必须与用户当前访问 origin 一致。
    // 前端登录按钮显式传 window.location.origin（?origin=），后端按它回跳并种
    // 会话 cookie —— 用户从 localhost 还是 127.0.0.1 访问都不会再出现
    // 「cookie 种到错误域 → 登录完又回登录页」。
    // 无 origin 参数时退化为请求 host（loopback 动态跟随），生产域名走 PUBLIC_ORIGIN。
    const safeOrigin = this.getCallbackOrigin(request, origin);
    const callbackUrl = `${safeOrigin}/api/auth/wechat/callback?next=${encodeURIComponent(
      normalizeWechatNext(next),
    )}${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`;
    const kaypalUrlEndpoint = this.authService.getWechatUrlEndpoint();
    return response.redirect(
      302,
      `${kaypalUrlEndpoint}?returnUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }

  /**
   * 注册：302 跳转 kaypal.cn 账号自助注册，注册完成回跳本地登录页（?registered=1）。
   * 共用 kaypal.cn 账号体系，本地零注册逻辑。
   */
  @Public()
  @Get('register-redirect')
  registerRedirect(
    @Req() request: Request,
    @Res() response: Response,
    @Query('next') next?: string,
    @Query('origin') origin?: string,
  ) {
    const safeOrigin = this.getCallbackOrigin(request, origin);
    const returnUrl = `${safeOrigin}/login?registered=1${
      next ? `&next=${encodeURIComponent(normalizeWechatNext(next))}` : ''
    }`;
    return response.redirect(
      302,
      `${this.authService.getKaypalBaseUrl()}/zh-CN/auth/register?returnUrl=${encodeURIComponent(
        returnUrl,
      )}`,
    );
  }

  /**
   * 忘记密码：302 跳转 kaypal.cn 账号自助找回密码，改密完成回跳本地登录页（?passwordReset=1）。
   */
  @Public()
  @Get('forgot-password-redirect')
  forgotPasswordRedirect(
    @Req() request: Request,
    @Res() response: Response,
    @Query('next') next?: string,
    @Query('origin') origin?: string,
  ) {
    const safeOrigin = this.getCallbackOrigin(request, origin);
    const returnUrl = `${safeOrigin}/login?passwordReset=1${
      next ? `&next=${encodeURIComponent(normalizeWechatNext(next))}` : ''
    }`;
    return response.redirect(
      302,
      `${this.authService.getKaypalBaseUrl()}/zh-CN/auth/forgot-password?returnUrl=${encodeURIComponent(
        returnUrl,
      )}`,
    );
  }

  /**
   * 获取微信扫码地址给登录页生成二维码。
   * 这里由后端向 Kaypal 请求授权地址，避免前端直接跳走；扫码后的回调
   * 仍然复用 /auth/wechat/callback，成功后回到当前前端页面并建立会话。
   */
  @Public()
  @Get('wechat/qr')
  async wechatQr(
    @Req() request: Request,
    @Query('next') next?: string,
    @Query('origin') origin?: string,
  ) {
    const safeOrigin = this.getCallbackOrigin(request, origin);
    const callbackUrl = `${safeOrigin}/api/auth/wechat/callback?next=${encodeURIComponent(
      normalizeWechatNext(next),
    )}${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`;
    const result =
      await this.authService.getWechatLoginWithCookies(callbackUrl);
    return { url: result.url };
  }

  /** 微信扫码回调（kaypal 回跳带 kaypalToken）：换用户建会话后 302 回前端 */
  @Public()
  @Get('wechat/callback')
  async wechatCallback(
    @Req() request: Request,
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: Response,
  ) {
    let handled:
      | { sessionToken: string; expiresAt: Date; user: unknown }
      | { sessionToken: null; error: string };
    const cbOrigin = () => this.getCallbackOrigin(request, query.origin);
    try {
      handled = await this.authService.handleWechatCallback(query);
    } catch (error) {
      // 防御：service 内部任何异常都转为可读错误，避免回调 500 白屏
      const message =
        error instanceof Error ? error.message : '微信登录处理失败';
      this.logger.error(
        `微信回调处理异常: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      response.redirect(
        302,
        `${cbOrigin()}/login?error=${encodeURIComponent(
          `微信登录处理失败：${message.slice(0, 80)}`,
        )}`,
      );
      return;
    }
    if (!handled || !('sessionToken' in handled) || !handled.sessionToken) {
      response.redirect(
        302,
        `${cbOrigin()}/login?error=${encodeURIComponent(
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
    // 登录成功跳转必须用完整前端 origin URL，不能用相对 /agent：
    // 相对路径基于浏览器当前 URL 解析，回调若发生在后端端口(3011)会跳到
    // 后端的 /agent → 404「Cannot GET /agent」（2026-08-12 根治）。
    const redirectTo = `${this.getCallbackOrigin(request, query.origin)}${normalizeWechatNext(query.next) || ''}`;
    response.redirect(302, redirectTo);
    return;
  }

  private getPublicOrigin() {
    const configured = this.authService.getConfiguredPublicOrigin();
    return configured || 'http://127.0.0.1:3011';
  }

  /** 微信回调 origin：优先前端显式传入的 ?origin=（loopback 或与 PUBLIC_ORIGIN 同源才信任），
   *  否则退化为请求 host（loopback 动态跟随），生产域名走 PUBLIC_ORIGIN */
  private getCallbackOrigin(request: Request, origin?: string) {
    if (origin) {
      try {
        const u = new URL(origin);
        const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(
          `${u.hostname}${u.port ? `:${u.port}` : ''}`,
        );
        if (isLoopback || u.origin === this.getPublicOrigin()) {
          return u.origin;
        }
      } catch {
        /* 非法 origin 忽略，走 fallback */
      }
    }
    return this.getRequestOrigin(request);
  }

  private getRequestOrigin(request: Request) {
    const host = String(
      request.headers['x-forwarded-host'] || request.headers.host || '',
    );
    const proto = String(
      request.headers['x-forwarded-proto'] || request.protocol || 'http',
    );
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) {
      return `${proto}://${host}`;
    }
    return this.getPublicOrigin();
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

  /**
   * 个人资料编辑（对标炼刀 /user/edit）：昵称/头像
   * PATCH /api/auth/me
   */
  @Patch('me')
  async updateMe(
    @Req() request: AuthenticatedRequest,
    @Body() body: { name?: string; avatar?: string },
  ) {
    const user = request.authUser;
    if (!user?.id) {
      throw new UnauthorizedException('请先登录');
    }
    const name = body.name?.trim();
    const avatar = body.avatar?.trim();
    if (name !== undefined && !name) {
      throw new BadRequestException('昵称不能为空');
    }
    if (name === undefined && avatar === undefined) {
      throw new BadRequestException('没有可更新的字段');
    }
    const updated = await this.prisma.system.user.update({
      where: { id: user.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(avatar !== undefined ? { avatar: avatar || null } : {}),
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        avatar: true,
      },
    });
    return updated;
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
    const memberships = await this.prisma.system.tenantMember.findMany({
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
    const users = await this.prisma.system.user.findMany({
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
    const targetMembership = await this.prisma.system.tenantMember.findFirst({
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
        const adminCount = await this.prisma.system.tenantMember.count({
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

    return this.prisma.system.$transaction(async (tx) => {
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

  /**
   * 邀请成员（仅 admin）：按 email 或 username 将用户加入当前租户。
   * POST /api/auth/members
   * 租户内角色：member（普通成员）| admin（管理员）。
   */
  @Post('members')
  async inviteMember(
    @Body()
    body: {
      email?: string;
      username?: string;
      role?: 'member' | 'admin';
    },
    @Req() request: AuthenticatedRequest,
  ) {
    const tenantId = await this.requireAdminTenant(request);
    const email = body.email?.trim().toLowerCase();
    const username = body.username?.trim();
    if (!email && !username) {
      throw new BadRequestException('请提供 email 或 username');
    }

    const targetUser = await this.prisma.system.user.findFirst({
      where: {
        ...(email ? { email } : {}),
        ...(username ? { username } : {}),
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        status: true,
      },
    });
    if (!targetUser) {
      throw new BadRequestException(
        '未找到该用户，请确认 email/username 是否正确',
      );
    }
    if (targetUser.status !== 'active') {
      throw new BadRequestException('该账号已被停用');
    }
    if (targetUser.id === request.authUser?.id) {
      throw new BadRequestException('不能邀请自己');
    }

    const role = body.role === 'admin' ? 'admin' : 'member';
    const existing = await this.prisma.system.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId: targetUser.id } },
    });
    if (existing && existing.status === 'active') {
      throw new BadRequestException('该用户已是组织成员');
    }

    // A 档席位硬校验（2026-08-16）：建成员前校验当前 plan 的席位上限
    await this.assertSeatAvailable(tenantId);

    const member = existing
      ? await this.prisma.system.tenantMember.update({
          where: { id: existing.id },
          data: { role, status: 'active' },
          select: { id: true, role: true, status: true },
        })
      : await this.prisma.system.tenantMember.create({
          data: { tenantId, userId: targetUser.id, role },
          select: { id: true, role: true, status: true },
        });

    return {
      userId: targetUser.id,
      username: targetUser.username,
      email: targetUser.email,
      name: targetUser.name,
      role: member.role,
      status: member.status,
    };
  }

  /**
   * 移除成员（仅 admin）：软删租户成员关系（status → removed）。
   * DELETE /api/auth/members/:userId
   */
  @Delete('members/:userId')
  async removeMember(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const tenantId = await this.requireAdminTenant(request);
    const membership = await this.prisma.system.tenantMember.findFirst({
      where: { tenantId, userId, status: 'active' },
      select: { id: true, role: true },
    });
    if (!membership) {
      throw new ForbiddenException('只能管理当前组织内的用户');
    }
    if (request.authUser?.id === userId) {
      throw new ForbiddenException('不能移除自己，请使用退出组织功能');
    }
    // 防自锁：不能移除最后一个 admin/owner
    if (membership.role === 'admin' || membership.role === 'owner') {
      const adminCount = await this.prisma.system.tenantMember.count({
        where: {
          tenantId,
          status: 'active',
          role: { in: ['admin', 'owner'] },
        },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException('不能移除最后一个管理员');
      }
    }

    await this.prisma.system.tenantMember.update({
      where: { id: membership.id },
      data: { status: 'removed' },
    });
    return { userId, removed: true };
  }

  private async requireAdminTenant(request: AuthenticatedRequest) {
    this.assertAdmin(request.authUser);
    const requestedTenantHeader = request.headers?.['x-tenant-id'];
    const requestedTenantId = Array.isArray(requestedTenantHeader)
      ? requestedTenantHeader[0]
      : requestedTenantHeader;
    const membership = await this.prisma.system.tenantMember.findFirst({
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

  /**
   * A 档席位硬校验（2026-08-16）：建成员前检查当前 plan 席位上限。
   * seatRule 来自 kaypal subscription-catalog（getPlanSeatRule 映射），
   * single→1、shared(ADVANCED)→10、per_seat(FLAGSHIP)→min 1；custom 不限。
   */
  private async assertSeatAvailable(tenantId: string): Promise<void> {
    const [entitlement, tenant] = await Promise.all([
      this.prisma.system.tenantEntitlement.findFirst({
        where: { tenantId, status: 'active' },
        orderBy: { updatedAt: 'desc' },
        select: { plan: true },
      }),
      this.prisma.system.tenant.findUnique({
        where: { id: tenantId },
        select: { ownerUserId: true },
      }),
    ]);
    const seatRule = getPlanSeatRule(entitlement?.plan);
    if (seatRule.maxSeats == null) return; // custom/不限额

    // Bug 修复（2026-08-17）：owner 也写进 tenantMember（tenants.service upsert），
    // 若不排除，single 方案（maxSeats=1）owner 占满唯一席位 → 永远无法邀请成员。
    const activeCount = await this.prisma.system.tenantMember.count({
      where: {
        tenantId,
        status: 'active',
        ...(tenant?.ownerUserId ? { userId: { not: tenant.ownerUserId } } : {}),
      },
    });
    if (activeCount >= seatRule.maxSeats) {
      throw new BadRequestException(
        `当前方案席位已达上限（${seatRule.maxSeats} 个），无法添加新成员。升级方案或移除闲置成员后再试。`,
      );
    }
  }
}
