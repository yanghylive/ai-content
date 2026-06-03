/**
 * LocalRuntimeClient · 浏览器 CDP 路径执行器
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md §3.1
 *
 * P2-D1：canHandle 改为返 ok=true（针对浏览器 platform）；
 * execute 先调 BrowserControlService.preflight 验证可用性。
 * 实际互动逻辑（comment-reply / dm-reply）由 P2-D2 platform services 提供。
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

@Injectable()
export class LocalRuntimeClient implements TaskExecutor {
  readonly id = 'local-runtime' as const;

  private readonly logger = new Logger(LocalRuntimeClient.name);

  constructor(
    private readonly engine: LocalRuntimeEngineClient,
    private readonly browserControl: BrowserControlService,
  ) {}

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

    // P2-D1 阶段：先 preflight 验证。
    // P2-D2 阶段：preflight 通过后调对应 platform service 执行具体互动。
    if (task.accountId == null) {
      return rejectResult(
        'account_not_logged_in',
        '浏览器互动任务必须提供 accountId',
        `task=${task.relatedId} platform=${task.platform} type=${task.type} 缺 accountId`,
      );
    }

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

    // P2-D1：preflight 通过但 platform service 尚未实现。
    // 占位返 success，附 preflight 证据。等 P2-D2 接入 platform service 后替换。
    const evidence: ExecutorEvidence[] = [
      {
        type: 'text',
        label: `Preflight 通过 ${preflight.platform} 账号 ${preflight.accountId}`,
        value: preflight.message,
        createdAt: preflight.checkedAt,
        raw: {
          platform: preflight.platform,
          accountId: preflight.accountId,
          browserReady: preflight.browserReady,
          profileReady: preflight.profileReady,
          loginRequired: preflight.loginRequired,
          blockers: preflight.blockers,
          // 标记这是 P2-D1 占位
          phase: 'P2-D1-preflight-only',
        },
      },
    ];

    return {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: `${task.platform} 预检通过（实际互动由 P2-D2 接入 platform service）`,
      technicalMessage:
        'P2-D1 stage: preflight passed; platform service not yet wired. 3010 前端 UI 应将本结果视为预检占位。',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
        engineUrl: this.engine.getEngineUrl(),
      },
      evidence,
    };
  }

  async isHealthy(): Promise<{ ok: boolean; details?: string }> {
    try {
      const health = await this.engine.getHealth();
      return {
        ok: health.online,
        details: `engine status=${health.status} version=${health.version} url=${health.engineUrl}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        details: `Local Runtime engine health failed: ${message}`,
      };
    }
  }
}
