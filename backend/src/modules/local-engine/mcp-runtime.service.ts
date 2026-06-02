import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface McpRuntimeStatus {
  available: boolean;
  serverCount: number;
  toolCount: number;
  resourceCount: number;
  strictMode: boolean;
  servers: Array<{ name: string; status: string; toolCount: number }>;
  message: string;
}

@Injectable()
export class McpRuntimeService {
  constructor(private readonly config: ConfigService) {}

  private getRuntimeUrl(): string {
    return (
      this.config.get<string>('KAYPAL_RUNTIME_URL') || 'http://127.0.0.1:8001'
    ).replace(/\/$/, '');
  }

  async getStatus(): Promise<McpRuntimeStatus> {
    try {
      const token =
        this.config.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') || '';
      const response = await fetch(`${this.getRuntimeUrl()}/governancez`, {
        signal: AbortSignal.timeout(3000),
        headers: {
          Accept: 'application/json',
          'x-kaypal-runtime-token': token,
        },
      });
      if (!response.ok) {
        return this.unavailable(`工具服务运行时返回 ${response.status}`);
      }
      const data = await response.json();
      const bus = data.mcpBus || data.bus || data;
      return {
        available: true,
        serverCount: bus.registeredServerCount || bus.servers?.length || 0,
        toolCount: bus.registeredToolCount || bus.tools?.length || 0,
        resourceCount:
          bus.registeredResourceCount || bus.resources?.length || 0,
        strictMode: bus.strictMode || false,
        servers: (bus.servers || []).map((s: any) => ({
          name: s.display_name || s.server_id || s.name || s.id,
          status: s.enabled ? 'enabled' : 'disabled',
          toolCount: s.toolCount || 0,
        })),
        message: `工具服务运行时在线：${bus.registeredServerCount || 0} 个服务，${bus.registeredToolCount || 0} 个工具`,
      };
    } catch (error) {
      return this.unavailable(
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }

  private unavailable(reason: string): McpRuntimeStatus {
    return {
      available: false,
      serverCount: 0,
      toolCount: 0,
      resourceCount: 0,
      strictMode: false,
      servers: [],
      message: `工具服务运行时不可用：${reason}`,
    };
  }
}
