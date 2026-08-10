/**
 * LocalRuntimeEngineClient · 兼容层：保留旧 API 形状但底层走 in-process engine
 *
 * 2026-06-04 改造：原 LocalRuntimeEngineClient 是 HTTP client 调 5409 引擎；
 * 现在 5409 已下线，改成 in-process 调 LocalInteractionEngineClient。
 * 保留旧方法签名让 LocalRuntimeClient + 4 个 platform service 零改动迁移。
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LocalInteractionEngineClient,
  type LocalRuntimeEngineHealth,
  type LocalRuntimePreflightInput,
  type LocalRuntimePreflightResult,
} from '../local-engine/local-interaction-engine.client';

export type {
  LocalRuntimeEngineHealth,
  LocalRuntimePreflightInput,
  LocalRuntimePreflightResult,
};

/**
 * 5409 旧 LocalRuntimeBrowserSession 类型的兼容 shim。
 * 2026-06-04: 真实数据由 LocalBrowserEngine in-process 管理，类型保留兼容。
 */
export type LocalRuntimeBrowserSession = {
  platform?: string;
  accountId?: string | number;
  browser?: string;
  status?: string;
  startedAt?: string;
  [key: string]: unknown;
};

@Injectable()
export class LocalRuntimeEngineClient {
  private readonly logger = new Logger(LocalRuntimeEngineClient.name);

  constructor(private readonly inProcess: LocalInteractionEngineClient) {}

  getEngineUrl(): string {
    return this.inProcess.getEngineUrl();
  }

  /**
   * 引擎健康检查（替代原 HTTP 调 5409 /health）。
   * 失败抛 ServiceUnavailableException（保旧行为）。
   */
  async getHealth(): Promise<LocalRuntimeEngineHealth> {
    try {
      return await this.inProcess.getHealth();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Local interaction engine health check failed: ${message}`,
      );
      throw new ServiceUnavailableException(
        `本地 in-process 互动引擎未就绪：${message}`,
      );
    }
  }

  /**
   * 平台预检（替代原 HTTP 调 5409 /interaction/preflight）。
   * 不抛异常，返结构化结果。
   */
  async preflightCheck(
    input: LocalRuntimePreflightInput,
  ): Promise<LocalRuntimePreflightResult> {
    return this.inProcess.preflightCheck(input);
  }

  /**
   * 列出活跃浏览器会话（替代原 HTTP 调 5409 /cdp/sessions）。
   */
  listCdpSessions(): unknown[] {
    return this.inProcess.listCdpSessions();
  }

  /**
   * 通用 JSON POST（替代原 HTTP 调 5409 POST endpoints）。
   * 5409 的 send/draft endpoint 现在已 in-process 移到 platform service 内部。
   * 保留此方法只为向后兼容——platform service 已迁到直接调 LocalBrowserEngine。
   */
  // 声明返回 Promise 但内部直接 throw：必须 async，否则同步抛异常调用方拿不到 rejected promise
  async postJson<T>(
    pathname: string,
    body: unknown,
    _timeoutMs = 60_000,
  ): Promise<T> {
    this.logger.warn(
      `postJson(${pathname}) 已废弃 — platform service 应直接用 LocalBrowserEngine`,
    );
    throw new ServiceUnavailableException(
      `postJson 已废弃：5409 引擎已下线，platform service 改用 LocalBrowserEngine`,
    );
  }
}
