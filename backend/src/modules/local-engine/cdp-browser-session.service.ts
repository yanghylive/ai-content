import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type CdpBrowserSession = {
  platform:
    | 'douyin'
    | 'wechat-channel'
    | 'xiaohongshu'
    | 'bilibili'
    | 'kuaishou'
    | string;
  accountId: string;
  profileDir: string;
  debuggingPort: number;
  status: 'starting' | 'ready' | 'needs_login' | 'blocked' | 'stopped';
  visibleWindow: boolean;
  currentUrl?: string;
  lastError?: string;
  browser?: string;
  startedAt?: string;
};

export type CdpBrowserSessionListResult = {
  sessions: CdpBrowserSession[];
  checkedAt: string;
};

export type CdpBrowserHealthResult = {
  available: boolean;
  sessions: CdpBrowserSession[];
  message: string;
  checkedAt: string;
};

@Injectable()
export class CdpBrowserSessionService {
  private readonly logger = new Logger(CdpBrowserSessionService.name);
  private readonly engineUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.engineUrl = (
      this.configService.get<string>('AUTO_UPLOAD_ENGINE_URL') ||
      'http://127.0.0.1:5409'
    ).replace(/\/$/, '');
  }

  async getHealth(): Promise<CdpBrowserHealthResult> {
    try {
      const response = await fetch(
        `${this.engineUrl}/interaction/cdp/sessions`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        },
      );

      if (!response.ok) {
        return {
          available: false,
          sessions: [],
          message: `CDP 会话接口不可用：${response.status}`,
          checkedAt: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as {
        code?: number;
        data?: Record<string, CdpBrowserSession>;
      };
      if (data.code !== 200 || !data.data) {
        return {
          available: false,
          sessions: [],
          message: 'CDP 会话接口返回异常',
          checkedAt: new Date().toISOString(),
        };
      }

      const sessions = Object.values(data.data);
      return {
        available: sessions.length > 0,
        sessions,
        message:
          sessions.length > 0
            ? `CDP 浏览器在线：${sessions.length} 个会话`
            : 'CDP 浏览器未启动，需要时会自动启动',
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        available: false,
        sessions: [],
        message: `CDP 浏览器健康检查失败：${message}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async getSession(
    platform: string,
    accountId: string,
  ): Promise<CdpBrowserSession | null> {
    const health = await this.getHealth();
    return (
      health.sessions.find(
        (s) =>
          s.platform === platform && String(s.accountId) === String(accountId),
      ) || null
    );
  }

  async checkCdpPort(
    port: number,
  ): Promise<{ responding: boolean; version?: string }> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        return { responding: false };
      }
      const data = (await response.json()) as {
        Browser?: string;
        webSocketDebuggerUrl?: string;
      };
      return {
        responding: Boolean(data.webSocketDebuggerUrl),
        version: data.Browser,
      };
    } catch {
      return { responding: false };
    }
  }

  buildSessionFromRuntimeFields(fields: {
    runtimeMode?: string;
    profileDir?: string | null;
    cdpPort?: number | null;
    browser?: string | null;
    browserReused?: boolean | null;
  }): CdpBrowserSession | null {
    if (fields.runtimeMode !== 'persistent-cdp-browser' || !fields.cdpPort) {
      return null;
    }
    return {
      platform: 'unknown',
      accountId: 'unknown',
      profileDir: fields.profileDir || '',
      debuggingPort: fields.cdpPort,
      status: 'ready',
      visibleWindow: true,
      browser: fields.browser || undefined,
    };
  }
}
