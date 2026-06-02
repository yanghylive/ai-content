import { Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { KaypalModelSyncService } from './kaypal-model-sync.service';

@Controller('ai-models/kaypal')
export class KaypalModelSyncController {
  constructor(private readonly service: KaypalModelSyncService) {}

  @Get('status')
  getStatus(@Req() request: Request) {
    return this.service.getStatus(request);
  }

  @Post('sync')
  sync(@Req() request: Request) {
    return this.service.sync(request);
  }
}
