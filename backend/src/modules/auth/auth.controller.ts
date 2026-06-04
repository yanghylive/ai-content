import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AUTH_COOKIE_NAME, AUTH_SESSION_DAYS } from './auth.constants';
import { Public } from './auth.decorator';
import type { AuthenticatedUser } from './auth.types';
import { shouldUseSecureAuthCookie } from './cookie-options';

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
