import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { WecomAssistantService } from './wecom-assistant.service';
import type { WecomAssistantSettingsDto } from './wecom-assistant.types';

type AuthenticatedRequest = Request & { authUser?: { id?: string } };

@Controller('wecom-assistant')
export class WecomAssistantController {
  constructor(private readonly wecomAssistantService: WecomAssistantService) {}

  @Get()
  getState(@Req() request: AuthenticatedRequest) {
    return this.wecomAssistantService.getState(this.getUserId(request));
  }

  @Post('test')
  test(@Body() body: { webhookUrl?: string; webhook_url?: string }) {
    return this.wecomAssistantService.testWebhook(
      body.webhookUrl || body.webhook_url || '',
    );
  }

  @Post('install')
  install(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      name?: string;
      webhookUrl?: string;
      webhook_url?: string;
      settings?: WecomAssistantSettingsDto;
    },
  ) {
    return this.wecomAssistantService.install(this.getUserId(request), {
      name: body.name,
      webhookUrl: body.webhookUrl || body.webhook_url,
      settings: body.settings,
    });
  }

  @Post('retest')
  retest(@Req() request: AuthenticatedRequest) {
    return this.wecomAssistantService.retest(this.getUserId(request));
  }

  @Patch('settings')
  updateSettings(
    @Req() request: AuthenticatedRequest,
    @Body() body: WecomAssistantSettingsDto,
  ) {
    return this.wecomAssistantService.updateSettings(
      this.getUserId(request),
      body,
    );
  }

  @Patch('status')
  setEnabled(
    @Req() request: AuthenticatedRequest,
    @Body() body: { enabled?: boolean },
  ) {
    return this.wecomAssistantService.setEnabled(
      this.getUserId(request),
      body.enabled !== false,
    );
  }

  @Post('suggest')
  suggest(
    @Req() request: AuthenticatedRequest,
    @Body() body: { customerMessage?: string; customer_message?: string },
  ) {
    return this.wecomAssistantService.suggest(
      this.getUserId(request),
      body.customerMessage || body.customer_message || '',
    );
  }

  @Delete()
  remove(@Req() request: AuthenticatedRequest) {
    return this.wecomAssistantService.remove(this.getUserId(request));
  }

  private getUserId(request: AuthenticatedRequest) {
    return request.authUser?.id || 'local-user';
  }
}
