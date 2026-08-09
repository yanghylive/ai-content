import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from '../auth/auth.decorator';
import { ClientConfigService } from './client-config.service';

@Controller('commercial/client-config')
export class ClientConfigController {
  constructor(private readonly clientConfigService: ClientConfigService) {}

  /** 客户端启动拉取配置（公开只读，配置本身不敏感） */
  @Public()
  @Get()
  getSnapshot() {
    return this.clientConfigService.getSnapshot();
  }

  /** 运营写配置 */
  @Post()
  setConfig(@Body() body: { key?: string; value?: string }) {
    if (!body?.key) {
      return { ok: false, message: '缺少 key' };
    }
    return this.clientConfigService.setConfig(body.key, body.value ?? '');
  }

  @Get('list')
  listConfigs() {
    return this.clientConfigService.listConfigs();
  }
}
