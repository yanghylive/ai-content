/**
 * LocalRuntimeEngineClient · 本地 Runtime 引擎 HTTP 客户端
 *
 * 详见 docs/adr/002-copy-first-migration-strategy.md §5 P2-D1
 *
 * 设计原则：
 * 1. 不引用 AutoUploadClient——这是 P3 删存量前的过渡。
 *    重复造这个 client 是 Copy-first 的代价，但 P3 后会有统一封装。
 * 2. URL 从 ConfigService 读（默认 http://127.0.0.1:5409）。
 * 3. 仅暴露 Runtime/Platform/BrowserControl 三个核心方法（其余 API
 *    在 P2-D2 platform service 阶段按需补）。
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LocalRuntimeEngineHealth = {
  online: boolean;
  status: string;
  service: string;
  version: string;
  engineUrl: string;
  checkedAt: string;
};

export type LocalRuntimePreflightInput = {
  platform: string;
  accountId: number;
};

export type LocalRuntimePreflightResult = {
  ok: boolean;
  platform: string;
  accountId: number;
  browserReady: boolean;
  profileReady: boolean;
  loginRequired: boolean;
  blockers: string[];
  message: string;
  nextAction?: string;
};

export type LocalRuntimeBrowserSession = {
  platform: string;
  accountId: string | number;
  profileDir?: string;
  debuggingPort?: number;
  status: string;
  visibleWindow?: boolean;
  currentUrl?: string;
  lastError?: string;
  browser?: string;
  startedAt?: string;
};

@Injectable()
export class LocalRuntimeEngineClient {
  private readonly logger = new Logger(LocalRuntimeEngineClient.name);
  private readonly defaultEngineUrl = 'http://127.0.0.1:5409';
  private readonly defaultTimeoutMs = 3000;

  constructor(private readonly configService: ConfigService) {}

  getEngineUrl(): string {
    return (
      this.configService.get<string>('AUTO_UPLOAD_ENGINE_URL') ||
      this.defaultEngineUrl
    ).replace(/\/$/, '');
  }

  /**
   * 引擎健康检查。
   * 失败抛 ServiceUnavailableException，由 caller 决定如何降级。
   */
  async getHealth(): Promise<LocalRuntimeEngineHealth> {
    const engineUrl = this.getEngineUrl();
    try {
      const response = await fetch(`${engineUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Engine health failed: ${response.status}`);
      }
      const data = (await response.json()) as Partial<LocalRuntimeEngineHealth>;
      return {
        online: true,
        status: data.status || 'ok',
        service: data.service || 'local-runtime',
        version: data.version || 'unknown',
        engineUrl,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Local Runtime engine health check failed: ${message}`);
      throw new ServiceUnavailableException(
        `本地 Runtime 引擎未启动或不可访问：${message}`,
      );
    }
  }

  /**
   * 平台浏览器预检（不抛异常；返回结构化结果，让 caller 决定如何降级）。
   */
  async preflightCheck(
    input: LocalRuntimePreflightInput,
  ): Promise<LocalRuntimePreflightResult> {
    const engineUrl = this.getEngineUrl();
    const checkedAt = new Date().toISOString();
    const params = new URLSearchParams({
      platform: input.platform,
      accountId: String(input.accountId),
    });
    try {
      const response = await fetch(
        `${engineUrl}/interaction/preflight?${params.toString()}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(this.defaultTimeoutMs),
        },
      );
      if (!response.ok) {
        return this.failedPreflight(input, `引擎返回 HTTP ${response.status}`, checkedAt);
      }
      const data = (await response.json()) as Partial<LocalRuntimePreflightResult>;
      return {
        ok: data.ok === true,
        platform: data.platform || input.platform,
        accountId: data.accountId ?? input.accountId,
        browserReady: data.browserReady === true,
        profileReady: data.profileReady === true,
        loginRequired: data.loginRequired === true,
        blockers: Array.isArray(data.blockers) ? data.blockers : [],
        message: data.message || '预检完成',
        nextAction: data.nextAction,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return this.failedPreflight(input, `引擎不可访问：${message}`, checkedAt);
    }
  }

  /**
   * 列出所有活跃浏览器会话（用于诊断）。
   */
  async listCdpSessions(): Promise<LocalRuntimeBrowserSession[]> {
    const engineUrl = this.getEngineUrl();
    try {
      const response = await fetch(`${engineUrl}/cdp/sessions`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
      });
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as { sessions?: LocalRuntimeBrowserSession[] };
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch (error) {
      this.logger.warn(
        `listCdpSessions failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private failedPreflight(
    input: LocalRuntimePreflightInput,
    reason: string,
    checkedAt: string,
  ): LocalRuntimePreflightResult {
    return {
      ok: false,
      platform: input.platform,
      accountId: input.accountId,
      browserReady: false,
      profileReady: false,
      loginRequired: false,
      blockers: [reason],
      message: `预检失败：${reason}`,
      nextAction: '请确认本地 Runtime 引擎已启动且 5409 端口可访问',
    };
  }
}
