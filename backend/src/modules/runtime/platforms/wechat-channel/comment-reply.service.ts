/**
 * 视频号评论回复 service
 *
 * 详见 docs/adr/002-copy-first-migration-strategy.md §5 P2-D2
 *
 * 引擎端点（仿 AutoUploadClient.draftWechatChannelCommentReply / sendWechatChannelCommentReply）：
 * - draft: POST /interaction/wechat-channel/comments/draft
 * - send:  POST /interaction/wechat-channel/comments/send
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

const SEND_TIMEOUT_MS = 60_000;
const DRAFT_TIMEOUT_MS = 60_000;

@Injectable()
export class WechatChannelCommentReplyService
  implements PlatformInteractionService
{
  readonly platformName = 'wechat-channel';
  readonly taskType = 'wechat-channel-comment-reply';

  private readonly logger = new Logger(WechatChannelCommentReplyService.name);

  constructor(private readonly engine: LocalRuntimeEngineClient) {}

  canHandle(task: ExecutorTask): boolean {
    return (
      task.platform === 'wechat-channel' &&
      task.type === 'wechat-channel-comment-reply'
    );
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
        '视频号评论回复缺少账号',
        `task=${task.relatedId} 缺 accountId`,
      );
    }
    if (!payload?.targetText || !payload?.replyText) {
      return rejectResult(
        'target_not_found',
        '视频号评论回复缺少目标评论或回复文本',
        `task=${task.relatedId} payload=${JSON.stringify(payload)}`,
      );
    }

    const isSend = ctx.sendMode === 'auto-send';
    const endpoint = isSend
      ? '/interaction/wechat-channel/comments/send'
      : '/interaction/wechat-channel/comments/draft';
    const body = {
      accountId,
      targetText: payload.targetText,
      replyText: payload.replyText,
    };

    let result: PlatformInteractionEngineResponse;
    try {
      result = await this.engine.postJson<PlatformInteractionEngineResponse>(
        endpoint,
        body,
        isSend ? SEND_TIMEOUT_MS : DRAFT_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return rejectResult(
        'runtime_unavailable',
        isSend ? '视频号评论自动发送失败' : '视频号评论草稿填入失败',
        `${endpoint} 抛错：${message}`,
      );
    }

    return this.mapResult(task, result, isSend);
  }

  private mapResult(
    task: ExecutorTask,
    result: PlatformInteractionEngineResponse,
    isSend: boolean,
  ): RuntimeExecutionResult {
    const evidence: ExecutorEvidence[] = [];
    if (result.evidence) {
      evidence.push({
        type: result.evidence.type === 'screenshot' ? 'screenshot' : 'text',
        label: result.evidence.label ?? '视频号评论互动证据',
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
          userMessage: `视频号评论已发送：${result.message ?? '完成'}`,
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
          userMessage: `视频号评论草稿已填入：${result.message ?? '待人工确认后发送'}`,
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
          '视频号目标评论不存在或已被删除',
          `engine: ${result.message ?? 'comment_missing'}`,
        );
      case 'editor_missing':
        return rejectResult(
          'runtime_unavailable',
          '视频号编辑器未就绪（账号未登录或浏览器状态异常）',
          `engine: ${result.message ?? 'editor_missing'}`,
        );
      case 'send_failed':
        return rejectResult(
          'send_failed',
          `视频号评论自动发送失败：${result.message ?? '未知'}`,
          `isSend=${isSend} nextAction=${result.nextAction ?? 'n/a'}`,
        );
      default:
        return rejectResult(
          'send_failed',
          `视频号评论互动结果未识别：status=${result.status}`,
          result.message,
        );
    }
  }
}
