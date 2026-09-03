import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CapabilityDirectoryService } from './capability-directory.service';

/**
 * 全量能力目录（手机 App / Web 通用，登录用户可访问）：
 * GET /api/capability-directory → 聚合 AI 助手工具 + AI 员工能力快照。
 */
@ApiTags('能力目录')
@Controller('capability-directory')
export class CapabilityDirectoryController {
  constructor(private readonly directory: CapabilityDirectoryService) {}

  @Get()
  @ApiOperation({ summary: '全量能力目录（AI 助手 + AI 员工；登录用户通用）' })
  async getDirectory(@Req() request: Request) {
    const authUser = (request as Request & { authUser?: unknown }).authUser;
    if (!authUser) throw new UnauthorizedException('请先登录');
    return this.directory.buildDirectory();
  }
}
