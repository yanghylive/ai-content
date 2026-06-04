/**
 * LocalRuntimeClient · 浏览器 CDP 路径执行器
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md §3.1
 *
 * P2-D2：execute 真正调度到 platform service。
 * - preflight 仍由 BrowserControlService 兜底
 * - 具体互动（comment / DM）由 platforms/* 下的 4 个 service 执行
 */

import { Injectable, Logger } from '@nestjs/common';
import { BrowserControlService } from './browser-control/browser-control.service';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';
import {
  type ExecutorCapability,
  type ExecutorContext,
  type ExecutorEvidence,
  type ExecutorTask,
  type RuntimeExecutionResult,
  type TaskExecutor,
  rejectResult,
} from './executor.interface';
import {
  type PlatformInteractionService,
} from './platforms/platform-interaction.interface';
import { DouyinCommentReplyService } from './platforms/douyin/comment-reply.service';
import { DouyinDirectMessageReplyService } from './platforms/douyin/direct-message-reply.service';
import { WechatChannelCommentReplyService } from './platforms/wechat-channel/comment-reply.service';
import { WechatChannelDirectMessageReplyService } from './platforms/wechat-channel/direct-message-reply.service';

@Injectable()
export class LocalRuntimeClient implements TaskExecutor {
  readonly id = 'local-runtime' as const;

  private readonly logger = new Logger(LocalRuntimeClient.name);

  private readonly platformServices: PlatformInteractionService[];

  constructor(
    private readonly engine: LocalRuntimeEngineClient,
    private readonly browserControl: BrowserControlService,
    douyinComment: DouyinCommentReplyService,
    douyinDm: DouyinDirectMessageReplyService,
    wechatComment: WechatChannelCommentReplyService,
    wechatDm: WechatChannelDirectMessageReplyService,
  ) {
    this.platformServices = [douyinComment, douyinDm, wechatComment, wechatDm];
  }

  canHandle(task: ExecutorTask): ExecutorCapability {
    // wechat-desktop 强护栏：桌面任务必须命中 agent-s
    if (task.platform === 'wechat-desktop') {
      return {
        ok: false,
        priority: 0,
        reason: 'local-runtime 不处理桌面任务，桌面任务应命中 agent-s',
      };
    }

    // 浏览器 CDP 任务：local-runtime 是事实执行器
    if (task.platform === 'douyin' || task.platform === 'wechat-channel') {
      // 如果有 platform service 能处理（comment-reply / dm-reply），ok:true
      // 否则返 false，让 Router 找别的执行器
      const hasService = this.platformServices.some((s) => s.canHandle(task));
      if (!hasService) {
        return {
          ok: false,
          priority: 0,
          reason: `local-runtime 无 ${task.platform}×${task.type} 对应 service`,
        };
      }
      return {
        ok: true,
        priority: 70,
        reason: 'local-runtime 浏览器 CDP 路径主战场',
      };
    }

    // mixed 平台：local-runtime 不处理（桌面路径兜底由 agent-s 承担）
    if (task.platform === 'mixed') {
      return {
        ok: false,
        priority: 0,
        reason: 'mixed 平台由 agent-s 桌面路径兜底',
      };
    }

    return {
      ok: false,
      priority: 0,
      reason: `local-runtime 不识别 platform=${String(task.platform)}`,
    };
  }

  async execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    this.logger.debug(
      `LocalRuntimeClient.execute: task=${task.relatedId} platform=${task.platform} type=${task.type}`,
    );

    // 1. 找对应 platform service
    const service = this.platformServices.find((s) => s.canHandle(task));
    if (!service) {
      return rejectResult(
        'runtime_unavailable',
        `无 platform service 处理 ${task.platform}×${task.type}`,
        `task=${task.relatedId}`,
      );
    }

    // 2. 必填校验
    if (task.accountId == null) {
      return rejectResult(
        'account_not_logged_in',
        '浏览器互动任务必须提供 accountId',
        `task=${task.relatedId} platform=${task.platform} type=${task.type} 缺 accountId`,
      );
    }

    // 3. preflight 验证引擎可达 + 浏览器就绪
    const preflight = await this.browserControl.preflight(
      task.platform,
      task.accountId,
    );

    if (!preflight.ok) {
      const reasonCode = preflight.loginRequired
        ? 'account_not_logged_in'
        : !preflight.browserReady
          ? 'runtime_unavailable'
          : !preflight.profileReady
            ? 'runtime_unavailable'
            : 'runtime_unavailable';
      return rejectResult(
        reasonCode,
        preflight.message,
        `blockers: ${preflight.blockers.join('; ')}`,
      );
    }

    // 4. 调 platform service 真执行互动
    return service.execute(task, ctx);
  }

  async isHealthy(): Promise<{ ok: boolean; details?: string }> {
    try {
      const health = await this.engine.getHealth();
      return {
        ok: health.online,
        details: `engine status=${health.status} version=${health.version} url=${health.engineUrl} platforms=${this.platformServices.length}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        details: `Local Runtime engine health failed: ${message}`,
      };
    }
  }

  /**
   * 子执行器（4 个 platform service）健康检查。
   * 让 ExecutorRouter.healthCheck() 把它们也一并返回，前端能看到 7 个 capability。
   */
  async getPlatformHealths(): Promise<
    Array<{ id: string; ok: boolean; details?: string }>
  > {
    const engineOnline = await this.engine
      .getHealth()
      .then((h) => h.online)
      .catch(() => false);

    return this.platformServices.map((service) => {
      const id = `${service.taskType}`;
      if (!engineOnline) {
        return {
          id,
          ok: false,
          details: 'local-runtime 引擎不可达，子 platform service 不可用',
        };
      }
      return {
        id,
        ok: true,
        details: `${service.platformName} × ${service.taskType} 就绪`,
      };
    });
  }
}
