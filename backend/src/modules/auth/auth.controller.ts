import { Body, Controller, Get, Param, Patch, Post, Req, Res, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AUTH_COOKIE_NAME, AUTH_SESSION_DAYS } from './auth.constants';
import { Public } from './auth.decorator';
import type { AuthenticatedUser } from './auth.types';
import { shouldUseSecureAuthCookie } from './cookie-options';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
};

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
    @Body() body: { username?: string; password?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login({
      username: body.username || '',
      password: body.password || '',
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
  getMe(@Req() request: AuthenticatedRequest) {
    return request.authUser;
  }

  /**
   * 用户与权限管理（仅 admin 角色可访问）
   * GET /api/auth/users — 列出所有用户 + 角色
   * PATCH /api/auth/users/:id/role — 改某用户角色 / 计划模式 / 商用执行权限
   */
  @Get('users')
  async listUsers(@Req() request: AuthenticatedRequest) {
    this.assertAdmin(request.authUser);
    const users = await this.prisma.user.findMany({
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
    @Body() body: {
      role?: string;
      planMode?: string;
      commercialExecutionAllowed?: boolean;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAdmin(request.authUser);
    const allowedRoles = ['operator', 'manager', 'admin'];
    const allowedPlans = ['trial', 'comercial'];

    const data: Record<string, unknown> = {};
    if (body.role !== undefined) {
      if (!allowedRoles.includes(body.role)) {
        throw new BadRequestException(
          `role 必须是 ${allowedRoles.join('/')} 之一`,
        );
      }
      // 不允许最后一个 admin 被降级（防自锁）
      if (body.role !== 'admin' && request.authUser?.id === id) {
        const adminCount = await this.prisma.user.count({
          where: { role: 'admin' },
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
      data.commercialExecutionAllowed = Boolean(body.commercialExecutionAllowed);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('请至少传一个要更新的字段');
    }

    return this.prisma.user.update({
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
  }

  private assertAdmin(user?: AuthenticatedUser) {
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('需要 admin 角色');
    }
  }
}
