import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppMarketService } from '../app-market/app-market.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@Injectable()
export class CrmAppGuard implements CanActivate {
  constructor(private readonly appMarketService: AppMarketService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authUser?.id) {
      throw new UnauthorizedException('请先登录');
    }
    await this.appMarketService.assertCrmInstalled(request.authUser);
    return true;
  }
}
