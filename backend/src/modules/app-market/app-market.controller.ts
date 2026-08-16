import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppMarketService } from './app-market.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@Controller('app-market')
export class AppMarketController {
  constructor(private readonly appMarketService: AppMarketService) {}

  @Get('apps')
  listApps(@Req() request: AuthenticatedRequest) {
    return this.appMarketService.listApps(this.getUser(request));
  }

  @Get('apps/:appKey')
  getApp(@Req() request: AuthenticatedRequest, @Param('appKey') appKey: string) {
    return this.appMarketService.getAppState(this.getUser(request), appKey);
  }

  @Get('apps/crm')
  getCrmApp(@Req() request: AuthenticatedRequest) {
    return this.appMarketService.getCrmState(this.getUser(request));
  }

  @Get('apps/crm/status')
  getCrmStatus(@Req() request: AuthenticatedRequest) {
    return this.appMarketService.getCrmState(this.getUser(request));
  }

  @Post('apps/crm/purchase')
  purchaseCrm(@Req() request: AuthenticatedRequest) {
    return this.appMarketService.purchaseCrm(this.getUser(request));
  }

  @Post('apps/crm/install')
  installCrm(@Req() request: AuthenticatedRequest) {
    return this.appMarketService.installCrm(this.getUser(request));
  }

  @Post('apps/crm/uninstall')
  uninstallCrm(@Req() request: AuthenticatedRequest) {
    return this.appMarketService.uninstallCrm(this.getUser(request));
  }

  private getUser(request: AuthenticatedRequest) {
    if (!request.authUser) {
      throw new UnauthorizedException('请先登录');
    }
    return request.authUser;
  }
}
