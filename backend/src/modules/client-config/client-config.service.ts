// 客户端配置中心（client-config）：向桌面端下发功能开关 / 资源地址（OSS 按需分发）
// 借鉴炼刀 app_config 的云端配置下发模式：客户端启动拉配置，资源 URL 可远程更新。

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ClientResourceSpec {
  url: string;
  version: string;
  sha256?: string;
}

export interface ClientConfigSnapshot {
  version: number;
  issuedAt: string;
  features: Record<string, boolean>;
  resources: Record<string, ClientResourceSpec>;
}

const DEFAULT_CLIENT_CONFIG: Omit<ClientConfigSnapshot, 'version' | 'issuedAt'> = {
  features: {
    wechatOcrEnabled: true,
    wxKeyDllEnabled: true,
    wechatDbHelperEnabled: true,
  },
  resources: {
    wechatOcr: {
      // 生产环境由运营在 client_configs 表覆盖为真实 OSS URL；此处为占位
      url: '',
      version: '1.0.0',
    },
    wechatDbHelper: {
      // 微信 DB helper（含 wx_key.dll / wechat-dump-rs.exe / sqlite3.exe）
      // 已从主安装包隔离为云端按需资源；生产环境由运营在 client_configs 覆盖
      url: '',
      version: '1.0.0',
    },
  },
};

@Injectable()
export class ClientConfigService {
  private readonly logger = new Logger('ClientConfigService');

  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(): Promise<ClientConfigSnapshot> {
    const configs = await this.prisma.clientConfig.findMany().catch(() => [] as never[]);
    const overrides: Record<string, string> = {};
    for (const row of configs as Array<{ key: string; value: string }>) {
      overrides[row.key] = row.value;
    }
    const snapshot: ClientConfigSnapshot = {
      ...DEFAULT_CLIENT_CONFIG,
      version: Number(overrides['version'] || 1),
      issuedAt: new Date().toISOString(),
    };
    // features 覆盖：feature.<name> = true|false
    for (const key of Object.keys(DEFAULT_CLIENT_CONFIG.features)) {
      const raw = overrides[`feature.${key}`];
      if (raw === 'true') snapshot.features[key] = true;
      else if (raw === 'false') snapshot.features[key] = false;
    }
    // resources 覆盖：resource.<name>.url / .version / .sha256
    for (const key of Object.keys(DEFAULT_CLIENT_CONFIG.resources)) {
      const url = overrides[`resource.${key}.url`];
      const version = overrides[`resource.${key}.version`];
      const sha256 = overrides[`resource.${key}.sha256`];
      if (url) snapshot.resources[key].url = url;
      if (version) snapshot.resources[key].version = version;
      if (sha256) snapshot.resources[key].sha256 = sha256;
    }
    return snapshot;
  }

  /** 运营写配置（key-value），不存在的 key 也会落库供未来版本使用 */
  async setConfig(key: string, value: string): Promise<{ ok: boolean; key: string }> {
    if (!key?.trim() || value == null) {
      throw new Error('key/value 不能为空');
    }
    await this.prisma.clientConfig.upsert({
      where: { key: key.trim() },
      create: { key: key.trim(), value: String(value) },
      update: { value: String(value) },
    }).catch(() => undefined);
    return { ok: true, key: key.trim() };
  }

  async listConfigs(): Promise<Array<{ key: string; value: string; updatedAt: string }>> {
    const rows = await this.prisma.clientConfig.findMany().catch(() => [] as never[]);
    return (rows as Array<{ key: string; value: string; updatedAt: Date }>).map((r) => ({
      key: r.key,
      value: r.value,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
