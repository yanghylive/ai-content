import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AgentSidecarStatus {
  available: boolean;
  version: string | null;
  sessionProtocol: boolean;
  eventStream: boolean;
  screenshotArtifacts: boolean;
  executionControl: boolean;
  message: string;
}

@Injectable()
export class AgentSidecarService {
  constructor(private readonly config: ConfigService) {}

  private getRuntimeUrl(): string {
    return (
      this.config.get<string>('KAYPAL_RUNTIME_URL') || 'http://127.0.0.1:8001'
    ).replace(/\/$/, '');
  }

  async getStatus(): Promise<AgentSidecarStatus> {
    try {
      const token =
        this.config.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') || '';
      const response = await fetch(`${this.getRuntimeUrl()}/healthz`, {
        signal: AbortSignal.timeout(3000),
        headers: {
          Accept: 'application/json',
          'x-kaypal-runtime-token': token,
        },
      });
      if (!response.ok) {
        return this.unavailable(`桌面自动化运行时返回 ${response.status}`);
      }
      const data = await response.json();
      const hasDesktop =
        data.capabilities?.desktop || data.desktopSupport || false;
      const hasSessions =
        data.capabilities?.sessions || data.sessionSupport || true;
      return {
        available: true,
        version: data.version || null,
        sessionProtocol: hasSessions,
        eventStream: true,
        screenshotArtifacts: hasDesktop,
        executionControl: true,
        message: `桌面自动化运行时在线${data.version ? ` (v${data.version})` : ''}${hasDesktop ? '，支持桌面执行' : ''}`,
      };
    } catch (error) {
      return this.unavailable(
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }

  private unavailable(reason: string): AgentSidecarStatus {
    return {
      available: false,
      version: null,
      sessionProtocol: false,
      eventStream: false,
      screenshotArtifacts: false,
      executionControl: false,
      message: `桌面自动化运行时不可用：${reason}`,
    };
  }
}
