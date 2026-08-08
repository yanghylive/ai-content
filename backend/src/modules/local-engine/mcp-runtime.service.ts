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

  getStatus(): McpRuntimeStatus {
    // 8001 (kaypal-runtime) 已下线；外部 MCP 运行时不再需要
    // 工具调用统一走 3011 进程内的 Node Runtime/CDP/Playwright 链路。
    return {
      available: false,
      serverCount: 0,
      toolCount: 0,
      resourceCount: 0,
      strictMode: false,
      servers: [],
      message:
        'MCP 运行时 (8001) 已下线 — 工具调用走包内 Node Runtime/CDP/Playwright 链路；外部 17777 sidecar 仅保留为旧版兼容项',
    };
  }
}
