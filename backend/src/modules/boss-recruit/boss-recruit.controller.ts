import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BossRecruitService } from './boss-recruit.service';
import type {
  BossHelloInput,
  BossSyncPositionsInput,
} from './boss-recruit.types';

type AuthenticatedRequest = Request & {
  authUser?: { id?: string; name?: string; username?: string; role?: string };
};

@Controller('boss-recruit')
export class BossRecruitController {
  constructor(private readonly bossRecruitService: BossRecruitService) {}

  @Get('state')
  getState(@Req() request: AuthenticatedRequest) {
    return this.bossRecruitService.getState(this.getUserId(request));
  }

  @Post('cookie')
  saveCookie(
    @Req() request: AuthenticatedRequest,
    @Body() body: { storageState?: Record<string, unknown> },
  ) {
    if (!body?.storageState) {
      return { ok: false, message: '缺少 storageState（Boss 登录态 JSON）' };
    }
    return this.bossRecruitService.saveCookie(
      this.getUserId(request),
      body.storageState,
    );
  }

  @Post('accounts/:id/check-login')
  checkLogin(
    @Req() request: AuthenticatedRequest,
    @Param('id') accountId: string,
  ) {
    return this.bossRecruitService.checkLogin(
      this.getUserId(request),
      accountId,
    );
  }

  @Post('positions/refresh')
  refreshPositions(
    @Req() request: AuthenticatedRequest,
    @Body() body: BossSyncPositionsInput,
  ) {
    return this.bossRecruitService.refreshPositions(
      this.getUserId(request),
      body,
    );
  }

  @Post('hello')
  sendHello(
    @Req() request: AuthenticatedRequest,
    @Body() body: BossHelloInput,
  ) {
    return this.bossRecruitService.sendHello(this.getUserId(request), body);
  }

  @Get('candidates')
  listCandidates(@Req() request: AuthenticatedRequest) {
    return this.bossRecruitService.listCandidates(this.getUserId(request));
  }

  @Get('tasks')
  listTasks(@Req() request: AuthenticatedRequest) {
    return this.bossRecruitService.listTasks(this.getUserId(request));
  }

  private getUserId(request: AuthenticatedRequest): string {
    return request.authUser?.id || 'local-user';
  }
}
