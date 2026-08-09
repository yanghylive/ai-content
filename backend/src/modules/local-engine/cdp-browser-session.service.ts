import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type CdpBrowserSession = {
  platform: string;
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

  constructor(private readonly configService: ConfigService) {}

  getHealth(): CdpBrowserHealthResult {
    void this.configService;
    return {
      available: false,
      sessions: [],
      message:
        '旧 5409 CDP 会话接口已下线；浏览器会话由 3011 in-process runtime 管理。',
      checkedAt: new Date().toISOString(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- 方法体当前同步，保留 async 签名以兼容调用方/生命周期/路由契约
  async getSession(
    platform: string,
    accountId: string,
  ): Promise<CdpBrowserSession | null> {
    const health = this.getHealth();
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
