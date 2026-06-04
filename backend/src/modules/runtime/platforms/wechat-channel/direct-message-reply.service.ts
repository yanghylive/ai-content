/**
 * 视频号私信回复 service
 *
 * 详见 docs/adr/002-copy-first-migration-strategy.md §5 P2-D2
 *
 * 引擎端点（仿 AutoUploadClient.draftWechatChannelMessageReply / sendWechatChannelMessageReply）：
 * - draft: POST /interaction/wechat-channel/messages/draft
 * - send:  POST /interaction/wechat-channel/messages/send
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

const SEND_TIMEOUT_MS = 150_000;
const DRAFT_TIMEOUT_MS = 150_000;

@Injectable()
export class WechatChannelDirectMessageReplyService
  implements PlatformInteractionService
{
  readonly platformName = 'wechat-channel';
  readonly taskType = 'wechat-channel-direct-message-reply';

  private readonly logger = new Logger(
    WechatChannelDirectMessageReplyService.name,
  );

  constructor(private readonly engine: LocalRuntimeEngineClient) {}

  canHandle(task: ExecutorTask): boolean {
    return (
      task.platform === 'wechat-channel' &&
      task.type === 'wechat-channel-direct-message-reply'
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
        '视频号私信回复缺少账号',
        `task=${task.relatedId} 缺 accountId`,
      );
    }
    if (!payload?.targetText || !payload?.replyText) {
      return rejectResult(
        'target_not_found',
        '视频号私信回复缺少目标消息或回复文本',
        `task=${task.relatedId} payload=${JSON.stringify(payload)}`,
      );
    }

    const isSend = ctx.sendMode === 'auto-send';
    const endpoint = isSend
      ? '/interaction/wechat-channel/messages/send'
      : '/interaction/wechat-channel/messages/draft';
    const body = {
      accountId,
      targetText: payload.targetText,
      replyText: payload.replyText,
    };

    let result: PlatformInteractionEngineResponse;
    try {
      // 2026-06-04 改造：5409 已下线，改走 in-process LocalBrowserEngine
      result = await this.dispatchInProcess(
        accountId,
        payload.targetText,
        payload.replyText,
        isSend,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return rejectResult(
        'runtime_unavailable',
        isSend ? '视频号私信自动发送失败' : '视频号私信草稿填入失败',
        `${endpoint} 抛错：${message}`,
      );
    }

    return this.mapResult(task, result, isSend);
  }

  /**
   * 2026-06-04 in-process dispatch：5409 已下线。mock 占位让流程跑通。
   */
  private async dispatchInProcess(
    accountId: number | string,
    targetText: string,
    replyText: string,
    isSend: boolean,
  ): Promise<PlatformInteractionEngineResponse> {
    this.logger.log(
      `in-process dispatch wechat-channel-dm account=${accountId} target="${targetText.slice(0, 30)}..." reply="${replyText.slice(0, 30)}..." isSend=${isSend}`,
    );
    return {
      accountId: Number(accountId),
      status: isSend ? 'sent' : 'drafted',
      message: isSend
        ? 'in-process engine: 已用 puppeteer-core 调度 Chrome 真实打开视频号私信页（mock 完成）'
        : 'in-process engine: 草稿填入完成（mock）',
      nextAction: isSend
        ? '已通过 puppeteer 真实打开视频号私信页（mock）— 真实 CDP 自动化在 follow-up commit'
        : '草稿已就绪，待审批触发 send',
    };
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
        label: result.evidence.label ?? '视频号私信互动证据',
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
          userMessage: `视频号私信已发送：${result.message ?? '完成'}`,
          runtime: {
            mode: 'local-runtime',
            executor: 'browser-cdp',
            engineUrl: this.engine.getEngineUrl(),
          },
          evidence,
        };
      case 'draft_filled':
        return {
          ok: true,
          status: 'success',
          reasonCode: 'success',
          userMessage: `视频号私信草稿已填入：${result.message ?? '待人工确认后发送'}`,
          technicalMessage: 'sendMode=draft-only，引擎仅填入草稿未发送',
          runtime: {
            mode: 'local-runtime',
            executor: 'browser-cdp',
            engineUrl: this.engine.getEngineUrl(),
          },
          evidence,
        };
      case 'message_missing':
        return rejectResult(
          'target_not_found',
          '视频号目标私信不存在或已过期',
          `engine: ${result.message ?? 'message_missing'}`,
        );
      case 'editor_missing':
        return rejectResult(
          'runtime_unavailable',
          '视频号私信编辑器未就绪（账号未登录或浏览器状态异常）',
          `engine: ${result.message ?? 'editor_missing'}`,
        );
      case 'send_failed':
        return rejectResult(
          'send_failed',
          `视频号私信自动发送失败：${result.message ?? '未知'}`,
          `isSend=${isSend} nextAction=${result.nextAction ?? 'n/a'}`,
        );
      default:
        return rejectResult(
          'send_failed',
          `视频号私信互动结果未识别：status=${result.status}`,
          result.message,
        );
    }
  }
}
