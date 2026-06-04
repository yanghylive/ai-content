/**
 * 抖音评论回复 service
 *
 * 详见 docs/adr/002-copy-first-migration-strategy.md §5 P2-D2
 *
 * 引擎端点（仿 AutoUploadClient.draftDouyinCommentReply / sendDouyinCommentReply）：
 * - draft: POST /interaction/douyin/comments/draft
 * - send:  POST /interaction/douyin/comments/send
 *
 * sendMode 决定走 draft 还是 send：
 * - auto-send   → send  引擎写入并真实发送
 * - draft-only  → draft 引擎只填入草稿不发送（默认行为；后续审批可触发 send）
 */

import { Injectable, Logger } from '@nestjs/common';
import { LocalRuntimeEngineClient } from '../../local-runtime-engine.client';
import {
  type ExecutorContext,
  type ExecutorEvidence,
  type ExecutorTask,
  type RuntimeExecutionResult,
  rejectResult,
} from '../../executor.interface';
import {
  type PlatformInteractionEngineResponse,
  type PlatformInteractionService,
} from '../platform-interaction.interface';
import { PlatformInteractionExecutor } from '../../../local-engine/platform-interaction-executor.service';

const SEND_TIMEOUT_MS = 60_000;
const DRAFT_TIMEOUT_MS = 60_000;

@Injectable()
export class DouyinCommentReplyService implements PlatformInteractionService {
  readonly platformName = 'douyin';
  readonly taskType = 'douyin-comment-reply';

  private readonly logger = new Logger(DouyinCommentReplyService.name);

  constructor(
    private readonly engine: LocalRuntimeEngineClient,
    private readonly executor: PlatformInteractionExecutor,
  ) {}

  canHandle(task: ExecutorTask): boolean {
    return task.platform === 'douyin' && task.type === 'douyin-comment-reply';
  }

  async execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    const payload = task.payload as {
      targetText?: string;
      replyText?: string;
    };
    const accountId = task.accountId;

    if (accountId == null) {
      return rejectResult(
        'account_not_logged_in',
        '抖音评论回复缺少账号',
        `task=${task.relatedId} platform=douyin type=douyin-comment-reply 缺 accountId`,
      );
    }
    if (!payload?.targetText || !payload?.replyText) {
      return rejectResult(
        'target_not_found',
        '抖音评论回复缺少目标评论或回复文本',
        `task=${task.relatedId} payload=${JSON.stringify(payload)}`,
      );
    }

    const isSend = ctx.sendMode === 'auto-send';
    const endpoint = isSend
      ? '/interaction/douyin/comments/send'
      : '/interaction/douyin/comments/draft';
    const body: Record<string, unknown> = {
      accountId,
      targetText: payload.targetText,
      replyText: payload.replyText,
    };
    if (isSend && (task.payload as { parsingRules?: unknown }).parsingRules) {
      body.parsingRules = (task.payload as { parsingRules?: unknown }).parsingRules;
    }

    let result: PlatformInteractionEngineResponse;
    try {
      // 2026-06-04 改造: 5409 已下线, 改走 in-process PlatformInteractionExecutor
      // 用 playwright 真实打开 douyin 评论页 -> 填入回复 -> 截图
      const dispatchResult = await this.executor.dispatch({
        platform: 'douyin',
        taskType: 'comment-reply',
        action: isSend ? 'send' : 'draft',
        accountId,
        targetText: payload.targetText,
        replyText: payload.replyText,
      });
      result = {
        accountId: accountId,
        status: dispatchResult.status === 'failed' ? 'send_failed' : dispatchResult.status,
        message: dispatchResult.message,
        evidence: dispatchResult.evidencePath
          ? {
              type: 'screenshot',
              label: dispatchResult.message.slice(0, 50),
              path: dispatchResult.evidencePath,
              capturedAt: new Date().toISOString(),
            }
          : null,
        nextAction: dispatchResult.nextAction,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return rejectResult(
        'runtime_unavailable',
        isSend ? '抖音评论自动发送失败' : '抖音评论草稿填入失败',
        `${endpoint} 抛错：${message}`,
      );
    }

    return this.mapResult(task, ctx, result, isSend);
  }

  private mapResult(
    task: ExecutorTask,
    _ctx: ExecutorContext,
    result: PlatformInteractionEngineResponse,
    isSend: boolean,
  ): RuntimeExecutionResult {
    const evidence: ExecutorEvidence[] = [];
    if (result.evidence) {
      evidence.push({
        type: result.evidence.type === 'screenshot' ? 'screenshot' : 'text',
        label: result.evidence.label ?? '抖音评论互动证据',
        path: result.evidence.path,
        value: result.evidence.value,
        createdAt: result.evidence.capturedAt ?? new Date().toISOString(),
      });
    }

    switch (result.status) {
      case 'sent':
        return {
          ok: true,
          status: 'success',
          reasonCode: 'success',
          userMessage: `抖音评论已发送：${result.message ?? '完成'}`,
          runtime: {
            mode: 'local-runtime',
            executor: 'browser-cdp',
            engineUrl: this.engine.getEngineUrl(),
          },
          evidence,
          readback: result.readbackText
            ? {
                expectedText: (task.payload as { replyText?: string }).replyText,
                actualText: result.readbackText,
                matched: result.readbackText === (task.payload as { replyText?: string }).replyText,
              }
            : undefined,
        };
      case 'draft_filled':
        return {
          ok: true,
          status: 'success',
          reasonCode: 'success',
          userMessage: `抖音评论草稿已填入：${result.message ?? '待人工确认后发送'}`,
          technicalMessage: 'sendMode=draft-only，引擎仅填入草稿未发送',
          runtime: {
            mode: 'local-runtime',
            executor: 'browser-cdp',
            engineUrl: this.engine.getEngineUrl(),
          },
          evidence,
        };
      case 'comment_missing':
        return rejectResult(
          'target_not_found',
          '抖音目标评论不存在或已被删除',
          `engine: ${result.message ?? 'comment_missing'}`,
        );
      case 'editor_missing':
        return rejectResult(
          'runtime_unavailable',
          '抖音编辑器未就绪（账号未登录或浏览器状态异常）',
          `engine: ${result.message ?? 'editor_missing'}`,
        );
      case 'send_failed':
        return rejectResult(
          'send_failed',
          `抖音评论自动发送失败：${result.message ?? '未知'}`,
          `isSend=${isSend} nextAction=${result.nextAction ?? 'n/a'}`,
        );
      default:
        return rejectResult(
          'send_failed',
          `抖音评论互动结果未识别：status=${result.status}`,
          result.message,
        );
    }
  }

  /**
   * 2026-06-04 in-process dispatch：5409 已下线，走 LocalBrowserEngine。
   * 当前阶段用 mock 模式：返 success + 截图占位证据，真实 CDP 操作在 follow-up commit。
   * 设计目标：让前端流程跑通（任务建 → 状态流转 → 证据可见），不卡在 5409 不可达。
   */
  private async dispatchInProcess(
    _accountId: string,
    _targetText: string,
    _replyText: string,
    _isSend: boolean,
  ): Promise<PlatformInteractionEngineResponse> {
    // 已迁移到 PlatformInteractionExecutor.dispatch()；本方法保留为空兼容旧调用方
    throw new Error('已废弃：用 this.executor.dispatch() 替代');
  }
}
