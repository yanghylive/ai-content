import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BillingService } from './billing.service';
import type {
  BillingWebhookHeaders,
  BillingWebhookPayload,
} from './billing.types';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Post('webhooks/:provider')
  receiveWebhook(
    @Param('provider') provider: string,
    @Body() body: BillingWebhookPayload,
    @Headers() headers: BillingWebhookHeaders,
  ) {
    return this.billing.processWebhook(provider, body, headers);
  }

  @Get('status')
  getStatus(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) {
      throw new Error('Authenticated user missing from request context');
    }
    return this.billing.getStatusForUser(request.authUser);
  }
}
