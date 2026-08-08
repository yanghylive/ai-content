import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { StorageService, type StorageConfig } from './storage.service';

type AuthenticatedRequest = Request & {
  authUser?: { role?: string };
};

@Controller('storage')
export class StorageConfigController {
  constructor(private readonly storageService: StorageService) {}

  /** 全局对象存储凭证，仅管理员可改 */
  private assertAdmin(request: AuthenticatedRequest) {
    if (request.authUser?.role !== 'admin') {
      throw new ForbiddenException('需要 admin 角色');
    }
  }

  /**
   * 读取当前存储配置（SecretKey/AccessKey 脱敏返回）
   */
  @Get('config')
  async getConfig() {
    const config = await this.storageService.getConfig();
    if (!config) {
      return {
        provider: 'local',
        accessKey: '',
        secretKey: '',
        bucket: '',
        domain: '',
        endpoint: '',
        region: '',
      };
    }
    return {
      provider: config.provider,
      accessKey: config.accessKey ? '********' : '', // AccessKey 脱敏
      secretKey: config.secretKey ? '********' : '', // SecretKey 脱敏
      bucket: config.bucket,
      domain: config.domain,
      endpoint: config.endpoint || '',
      region: config.region || '',
    };
  }

  /**
   * 保存存储配置（仅管理员）
   */
  @Put('config')
  async updateConfig(
    @Req() request: AuthenticatedRequest,
    @Body() body: StorageConfig,
  ) {
    this.assertAdmin(request);
    // 如果 accessKey/secretKey 传入的是脱敏占位符，不覆盖原始值
    const existing = await this.storageService.getConfig();
    if (body.secretKey === '********') {
      body.secretKey = existing?.secretKey || '';
    }
    if (body.accessKey === '********') {
      body.accessKey = existing?.accessKey || '';
    }
    await this.storageService.saveConfig({
      provider: body.provider || 'local',
      accessKey: body.accessKey || '',
      secretKey: body.secretKey || '',
      bucket: body.bucket || '',
      domain: body.domain || '',
      endpoint: body.endpoint || '',
      region: body.region || '',
    });
    return { success: true, message: '存储配置已保存' };
  }

  /**
   * 测试对象存储连接（仅管理员）
   */
  @Post('config/test')
  async testConnection(@Req() request: AuthenticatedRequest) {
    this.assertAdmin(request);
    return this.storageService.testConnection();
  }
}
