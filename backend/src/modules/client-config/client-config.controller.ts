import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from '../auth/auth.decorator';
import { RequireKaypalRoles } from '../auth/roles.decorator';
import { ClientConfigService } from './client-config.service';

@Controller('commercial/client-config')
export class ClientConfigController {
  constructor(private readonly clientConfigService: ClientConfigService) {}

  /** 客户端启动拉取配置（公开只读，返回脱敏 snapshot，不含原始 key/value） */
  @Public()
  @Get()
  getSnapshot() {
    return this.clientConfigService.getSnapshot();
  }

  /** 运营写配置（仅平台管理员，阻断任意登录用户改写远程 helper 下载来源） */
  @RequireKaypalRoles('admin', 'owner')
  @Post()
  setConfig(@Body() body: { key?: string; value?: string }) {
    if (!body?.key) {
      return { ok: false, message: '缺少 key' };
    }
    return this.clientConfigService.setConfig(body.key, body.value ?? '');
  }

  /** 配置全量列表（含原始 key/value，仅平台管理员可见） */
  @RequireKaypalRoles('admin', 'owner')
  @Get('list')
  listConfigs() {
    return this.clientConfigService.listConfigs();
  }
}
