import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AgentSidecarStatus {
  available: boolean;
  version: string | null;
  runnerMode: string | null;
  sessionProtocol: boolean;
  eventStream: boolean;
  screenshotArtifacts: boolean;
  executionControl: boolean;
  message: string;
}

@Injectable()
export class AgentSidecarService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Agent-S sidecar URL（17777 端口）
   * 之前错读 KAYPAL_RUNTIME_URL（8001，本地 Runtime 引擎），导致 UI 上
   * "agent-s-sidecar" capability 一直 401（8001 是别的项目）。
   * 现在改成查 AGENT_S_BASE_URL，真对应桌面自动化 sidecar。
   */
  private getAgentSUrl(): string {
    return (
      this.config.get<string>('AGENT_S_BASE_URL') || 'http://127.0.0.1:17777'
    ).replace(/\/$/, '');
  }

  async getStatus(): Promise<AgentSidecarStatus> {
    try {
      const token =
        this.config.get<string>('KAYPAL_AGENT_S_TOKEN') ||
        this.config.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') ||
        '';
      const response = await fetch(`${this.getAgentSUrl()}/healthz`, {
        signal: AbortSignal.timeout(3000),
        headers: token
          ? {
              Accept: 'application/json',
              'x-kaypal-agent-s-token': token,
            }
          : { Accept: 'application/json' },
      });
      if (!response.ok) {
        return this.unavailable(`Agent-S sidecar 不可达，HTTP ${response.status}`);
      }
      const data = await response.json();
      const isReady = data.status === 'ok' || data.ok === true;
      // Agent-S sidecar 能力：session protocol、event stream、execution control 都支持
      // screenshot artifacts 取决于 runner_mode（real 时才有）
      const hasDesktop = data.runner_mode === 'real';
      return {
        available: isReady,
        version: data.version || null,
        runnerMode: data.runner_mode || null,
        sessionProtocol: isReady,
        eventStream: isReady,
        screenshotArtifacts: hasDesktop,
        executionControl: isReady,
        message: isReady
          ? `Agent-S sidecar 在线 (${data.runner_mode || 'unknown'} mode, ${data.session_count ?? 0} sessions)`
          : `Agent-S sidecar 状态异常：${JSON.stringify(data).slice(0, 100)}`,
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
      runnerMode: null,
      sessionProtocol: false,
      eventStream: false,
      screenshotArtifacts: false,
      executionControl: false,
      message: `Agent-S sidecar 不可用：${reason}`,
    };
  }
}
