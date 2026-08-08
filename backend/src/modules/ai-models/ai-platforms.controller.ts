import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiPlatformsService } from './ai-platforms.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';

type AuthenticatedRequest = Request & {
  authUser?: { role?: string };
};

@ApiTags('AI 平台管理')
@Controller('ai-platforms')
export class AiPlatformsController {
  constructor(private readonly service: AiPlatformsService) {}

  /** 全局 AI 平台配置含 apiKey，仅管理员可改 */
  private assertAdmin(request: AuthenticatedRequest) {
    if (request.authUser?.role !== 'admin') {
      throw new ForbiddenException('需要 admin 角色');
    }
  }

  /** apiKey 脱敏（HTTP 响应不泄露明文密钥） */
  private maskPlatform<T extends { apiKey?: string }>(platform: T): T {
    if (!platform) return platform;
    return {
      ...platform,
      apiKey: platform.apiKey ? '********' : '',
    };
  }

  @Get()
  @ApiOperation({ summary: '获取所有 AI 平台（apiKey 脱敏）' })
  async findAll() {
    const platforms = await this.service.findAll();
    return (platforms as Array<{ apiKey?: string }>).map((p) =>
      this.maskPlatform(p),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个 AI 平台（apiKey 脱敏）' })
  async findOne(@Param('id') id: string) {
    return this.maskPlatform(await this.service.findOne(id));
  }

  @Post()
  @ApiOperation({ summary: '创建 AI 平台（仅管理员）' })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreatePlatformDto) {
    this.assertAdmin(request);
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新 AI 平台（仅管理员）' })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformDto,
  ) {
    this.assertAdmin(request);
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除 AI 平台（仅管理员）' })
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    this.assertAdmin(request);
    return this.service.remove(id);
  }
}
