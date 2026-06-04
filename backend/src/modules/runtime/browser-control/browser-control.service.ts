/**
 * BrowserControlService · Runtime 路径下浏览器控制抽象
 *
 * 详见 docs/adr/002-copy-first-migration-strategy.md §5 P2-D1
 *
 * 职责：
 * 1. 把 LocalRuntimeEngineClient 的 HTTP 响应转换为 Runtime 内部表示
 *    （PlatformInteractionStatus / InteractionPreflightResult 形态）
 * 2. 不直接依赖 AutoUploadService 或 CdpBrowserSessionService
 *    （避免循环依赖，Copy-first 阶段 P3 统一）
 * 3. 为 P2-D2 的 platform service 提供 preflight + status 入口
 *
 * P2-D1 阶段只实现 preflight + status；后续按 platform 接入时再补
 * 实际互动方法（comment-reply / dm-reply）。
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  LocalRuntimeBrowserSession,
  LocalRuntimeEngineClient,
  type LocalRuntimePreflightResult,
} from '../local-runtime-engine.client';

export type BrowserControlPreflight = {
  ok: boolean;
  platform: string;
  accountId: number;
  browserReady: boolean;
  profileReady: boolean;
  loginRequired: boolean;
  blockers: string[];
  message: string;
  nextAction?: string;
  checkedAt: string;
};

export type BrowserControlStatus = {
  platform: string;
  accountId: number;
  engineOnline: boolean;
  engineUrl: string;
  session: LocalRuntimeBrowserSession | null;
  message: string;
  checkedAt: string;
};

@Injectable()
export class BrowserControlService {
  private readonly logger = new Logger(BrowserControlService.name);

  constructor(
    private readonly engine: LocalRuntimeEngineClient,
  ) {}

  /**
   * 预检：调用引擎的 preflight 接口并转换为 BrowserControlPreflight 形态。
   * 永不抛异常（即使引擎不可达），全部错误以 ok:false + blockers 表达。
   */
  async preflight(
    platform: string,
    accountId: number,
  ): Promise<BrowserControlPreflight> {
    const result: LocalRuntimePreflightResult = await this.engine.preflightCheck({
      platform: platform as 'douyin' | 'wechat-channel',
      accountId,
    });
    return {
      ...result,
      accountId: typeof result.accountId === 'string' ? Number(result.accountId) : result.accountId,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 平台状态查询：列出该 platform/accountId 对应的浏览器会话。
   * 即使引擎不可达也返回结构化结果（engineOnline:false），不抛异常。
   */
  async getStatus(
    platform: string,
    accountId: number,
  ): Promise<BrowserControlStatus> {
    const engineUrl = this.engine.getEngineUrl();
    const checkedAt = new Date().toISOString();

    let engineOnline = false;
    try {
      await this.engine.getHealth();
      engineOnline = true;
    } catch {
      engineOnline = false;
    }

    let session: LocalRuntimeBrowserSession | null = null;
    if (engineOnline) {
      try {
        const sessions = (await this.engine.listCdpSessions()) as LocalRuntimeBrowserSession[];
        session =
          sessions.find(
            (s: LocalRuntimeBrowserSession) =>
              s.platform === platform &&
              String(s.accountId) === String(accountId),
          ) || null;
      } catch (error) {
        // listCdpSessions 抛错时优雅降级为 session=null
        this.logger.warn(
          `listCdpSessions failed for ${platform}/${accountId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        session = null;
      }
    }

    return {
      platform,
      accountId,
      engineOnline,
      engineUrl,
      session,
      message: engineOnline
        ? session
          ? `${platform} 浏览器会话存在，状态=${session.status}`
          : `${platform} 浏览器未启动`
        : `本地 Runtime 引擎不可达：${engineUrl}`,
      checkedAt,
    };
  }
}
