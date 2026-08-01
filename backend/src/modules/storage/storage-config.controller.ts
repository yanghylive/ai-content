import { Controller, Get, Put, Post, Body } from '@nestjs/common';
import { StorageService, type StorageConfig } from './storage.service';

@Controller('storage')
export class StorageConfigController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * 读取当前存储配置（SecretKey 脱敏返回）
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
      accessKey: config.accessKey,
      secretKey: config.secretKey ? '********' : '', // SecretKey 脱敏
      bucket: config.bucket,
      domain: config.domain,
      endpoint: config.endpoint || '',
      region: config.region || '',
    };
  }

  /**
   * 保存存储配置
   */
  @Put('config')
  async updateConfig(@Body() body: StorageConfig) {
    // 如果 secretKey 传入的是脱敏占位符，不覆盖原始值
    if (body.secretKey === '********') {
      const existing = await this.storageService.getConfig();
      body.secretKey = existing?.secretKey || '';
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
   * 测试对象存储连接
   */
  @Post('config/test')
  async testConnection() {
    return this.storageService.testConnection();
  }
}
