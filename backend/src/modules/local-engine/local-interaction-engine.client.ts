/**
 * LocalInteractionEngineClient · 3010 主系统的 in-process 互动引擎客户端
 *
 * 替代原 LocalRuntimeEngineClient（HTTP 调 5409 端点）：
 * - 不再发 HTTP 到 127.0.0.1:5409
 * - 所有 /interaction/* 端点由 LocalBrowserEngine + 各 platform service in-process 实现
 * - 保留旧 API 形状（getHealth / preflightCheck / postJson）让 platform service 零改动迁移
 *
 * 设计：
 * 1. 旧 HTTP /interaction/douyin/comments/send 现在映射到
 *    DouyinCommentReplyService.handleSendInProcess() 内部方法
 * 2. 旧 HTTP /interaction/preflight 映射到 LocalBrowserEngine.preflightPlatform()
 * 3. 旧 /health 映射到 LocalBrowserEngine.getStatus()
 * 4. 平台 service 不再走 HTTP 改走直接函数调用，零网络开销
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalBrowserEngine } from './local-browser-engine.service';

export type LocalRuntimeEngineHealth = {
  online: boolean;
  status: string;
  service: string;
  version: string;
  engineUrl: string;
  checkedAt: string;
};

export type LocalRuntimePreflightInput = {
  platform: 'douyin' | 'wechat-channel';
  accountId: number | string;
  taskType?: 'comment-reply' | 'direct-message-reply';
};

export type LocalRuntimePreflightResult = {
  ok: boolean;
  platform: string;
  accountId: number | string;
  browserReady: boolean;
  profileReady: boolean;
  loginRequired: boolean;
  blockers: string[];
  message: string;
  nextAction?: string;
};

@Injectable()
export class LocalInteractionEngineClient {
  private readonly logger = new Logger(LocalInteractionEngineClient.name);
  private readonly engineUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly browser: LocalBrowserEngine,
  ) {
    // 保留 engineUrl 字段兼容性；现在指向 internal:// 表示本地 in-process
    this.engineUrl =
      this.config.get<string>('LOCAL_INTERACTION_ENGINE_URL') ||
      'internal://ai-content/local-interaction';
  }

  getEngineUrl(): string {
    return this.engineUrl;
  }

  /**
   * 引擎健康检查（替代 5409 /health）。
   */

  async getHealth(): Promise<LocalRuntimeEngineHealth> {
    const status = this.browser.getStatus();
    return {
      online: status.online,
      status: status.online ? 'ok' : 'down',
      service: 'ai-content-local-interaction',
      version: status.version,
      engineUrl: this.engineUrl,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 平台预检（替代 5409 /interaction/preflight）。
   */
  async preflightCheck(
    input: LocalRuntimePreflightInput,
  ): Promise<LocalRuntimePreflightResult> {
    const result = await this.browser.preflightPlatform({
      accountId: input.accountId,
      platform: input.platform,
      taskType: input.taskType,
    });
    return {
      ok: result.ok,
      platform: input.platform,
      accountId: input.accountId,
      browserReady: result.browserReady,
      profileReady: result.browserReady,
      loginRequired: result.loginRequired,
      blockers: result.blockers,
      message: result.message,
      nextAction: result.loginRequired
        ? '请先在浏览器中完成登录（cookies 自动持久化到 profile 目录）'
        : '可以开始执行互动任务',
    };
  }

  /**
   * 列出活跃浏览器会话（替代 5409 /cdp/sessions，保留 API 形状）。
   */
  listCdpSessions(): unknown[] {
    return this.browser.listSessions().map((session, index) => ({
      index,
      platform: session.platform,
      accountId: session.accountId,
      browser: session.browser || 'in-process Chrome',
      status: session.status,
      profileDir: session.profileDir,
      visibleWindow: session.visibleWindow,
      currentUrl: session.currentUrl,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      runtimeMode: session.runtimeMode,
    }));
  }

  /**
   * 平台 service 直接调用此方法处理 in-process 互动。
   * 替代旧的 HTTP postJson 到 5409 /interaction/{platform}/{type}/{action}。
   */
  dispatch(_input: {
    platform: 'douyin' | 'wechat-channel';
    taskType: 'comment-reply' | 'direct-message-reply';
    action: 'send' | 'draft' | 'read';
    accountId: string | number;
    payload: Record<string, unknown>;
  }): {
    status: 'success' | 'failed';
    message: string;
    evidence?: {
      type: 'screenshot' | 'text';
      label: string;
      path?: string;
      capturedAt: string;
    };
  } {
    // 平台 service 内部已实现 in-process 逻辑；此方法保留作未来 dispatcher 入口
    // 当前阶段 platform service 直接调 browser engine 拿到 session 后自己操作
    this.logger.warn(
      `dispatch() 暂未实现，请 platform service 调 LocalBrowserEngine.getOrCreateSession()`,
    );
    return {
      status: 'failed',
      message:
        'dispatch() 暂未实现 — platform service 应直接用 LocalBrowserEngine',
    };
  }
}
