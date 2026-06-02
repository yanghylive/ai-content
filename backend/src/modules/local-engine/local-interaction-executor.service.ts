import { Injectable, Logger } from '@nestjs/common';
import {
  type AutoUploadInteractionCapabilities,
  type AutoUploadInteractionEvidence,
} from '../auto-upload/auto-upload.client';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { CloudApiService } from '../cloud-api/cloud-api.service';
import { existsSync } from 'fs';
import {
  type InteractionExecutorDraftResult,
  type InteractionExecutorPreflightResult,
  type InteractionReplyRuleConfig,
  type InteractionTask,
  type InteractionTaskEvent,
  type InteractionTaskRuntimePort,
  type InteractionTaskType,
  type LocalEngineExecutorCapability,
  type LocalEngineExecutorsStatus,
  type WechatDesktopPreflightResult,
} from './local-engine.types';

type DouyinReadableItem = {
  text?: string | null;
  handled?: boolean;
  skipped?: boolean;
  skipReason?: string | null;
};

type AiSelectedDouyinTarget<T extends DouyinReadableItem> = {
  item: T;
  replyText: string;
  generatedBy: 'ai' | 'fallback';
  reason?: string;
};

type CustomerServiceIntent =
  | 'location'
  | 'purchase'
  | 'price'
  | 'appointment'
  | 'after_sale'
  | 'bad_review'
  | 'contact'
  | 'thanks'
  | 'other';

type DouyinReadResult = {
  url: string;
  pageTextSample?: string | null;
  summary?: {
    totalCandidates?: number;
    usableCount?: number;
    emptyReason?: string | null;
    blocked?: boolean;
    blockedReason?: string | null;
    nextAction?: string | null;
  };
  evidence?: AutoUploadInteractionEvidence | null;
};

type WechatDesktopPreflightInternal = {
  readyForDraft: boolean;
  currentWindowTitle?: string | null;
  blockers: string[];
  message: string;
  nextAction: string;
};

type AutoSendVerificationInput = {
  status?: string;
  sent?: boolean;
  runtimeMode?: string | null;
  targetText?: string | null;
  replyText?: string | null;
  readbackText?: string | null;
  editorCleared?: boolean | null;
  replyVisible?: boolean | null;
  nextAction?: string | null;
  evidence?: AutoUploadInteractionEvidence | null;
};

type AutoSendVerificationResult = {
  ok: boolean;
  sentSignal: boolean;
  reasons: string[];
  nextAction: string;
};

type CdpCommercialPreflightResult = {
  ok: boolean;
  blockers: string[];
  nextAction: string;
};

const DEFAULT_INTERACTION_REPLY_RULE: InteractionReplyRuleConfig = {
  industryName: '本地生活/电商服务',
  tone: 'warm',
  defaultSendMode: 'auto-send',
  askForContact: true,
  requireApprovalKeywords: [
    '投诉',
    '退款',
    '售后',
    '差评',
    '发票',
    '转账',
    '支付',
    '维权',
  ],
  blockedKeywords: ['保证治好', '最低价', '绝对有效', '返现', '私下转账'],
  serviceHighlights: [
    '按客户具体问题回复',
    '不编造价格和承诺',
    '必要时转人工核实',
  ],
  closingText: '你把具体款式、订单或时间发我，我按实际情况帮你看。',
  updatedAt: new Date(0).toISOString(),
};

@Injectable()
export class LocalInteractionExecutorService {
  private readonly logger = new Logger(LocalInteractionExecutorService.name);

  constructor(
    private readonly autoUploadService: AutoUploadService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
    private readonly cloudApi: CloudApiService,
  ) {}

  async getStatus(): Promise<LocalEngineExecutorsStatus> {
    const checkedAt = new Date().toISOString();
    const capabilityByKey = await this.readCapabilityMatrix();
    const wechatDesktopPreflight = await this.getWechatDesktopPreflight();
    const agentSStatus = await this.checkAgentSStatus();
    const executors: LocalEngineExecutorCapability[] =
      this.getExecutorDefinitions().map((executor) => {
        const capability = capabilityByKey.get(executor.key);
        const stages = capability?.stages || [];
        const isWechatType =
          executor.key === 'wechat-reply-draft' ||
          executor.key === 'wechat-group-broadcast' ||
          executor.key === 'wechat-moments-publish';
        const isBrowserInteractionType =
          executor.key === 'douyin-comment-reply' ||
          executor.key === 'douyin-direct-message-reply' ||
          executor.key === 'wechat-channel-comment-reply' ||
          executor.key === 'wechat-channel-direct-message-reply';
        const entryPreflightAvailable = this.hasTaskStage(stages, 'open-entry');
        const canReadTarget =
          (isBrowserInteractionType && stages.includes('target-read')) ||
          (isWechatType && wechatDesktopPreflight.readyForDraft);
        const canDraftAfterApproval = isWechatType
          ? wechatDesktopPreflight.readyForDraft
          : stages.includes('draft-fill');
        const canAutoSend = isWechatType
          ? stages.includes('auto-send') && wechatDesktopPreflight.readyForDraft
          : stages.includes('auto-send');
        const ready =
          entryPreflightAvailable &&
          canReadTarget &&
          (canDraftAfterApproval || canAutoSend);
        return {
          key: executor.key,
          name: executor.name,
          platformName: executor.platformName,
          status: ready
            ? 'ready'
            : entryPreflightAvailable && !agentSStatus.available
              ? 'preflight_only'
              : entryPreflightAvailable
                ? 'preflight_only'
                : 'missing',
          entryPreflight: entryPreflightAvailable,
          targetRead: canReadTarget,
          replyGenerate: canReadTarget,
          controlledSend: canDraftAfterApproval,
          autoSend: canAutoSend,
          message: ready
            ? isWechatType
              ? canAutoSend
                ? '已支持打开微信入口并完成桌面微信 preflight；自动发送会在目标、窗口和草稿回读通过后直接发送。'
                : '已支持打开微信入口并完成桌面微信 preflight；确认后只把草稿粘贴到当前会话，仍不自动发送。'
              : canAutoSend
                ? `已支持打开${executor.platformName}入口、只读扫描${executor.targetLabel}、填入回复并自动点击发送。`
                : `已支持打开${executor.platformName}入口、只读扫描${executor.targetLabel}并在确认后填入回复草稿。`
            : entryPreflightAvailable
              ? `已支持打开${executor.platformName}入口；缺少 ${this.describeMissingStages(executor.key, stages, wechatDesktopPreflight)}。`
              : `${executor.name}能力暂未声明；请先启动本地发布服务。`,
          nextAction: ready
            ? isWechatType
              ? canAutoSend
                ? '请先在桌面微信停到目标会话；自动发送会在桌面 preflight 和目标锁定通过后执行。'
                : '请先在桌面微信停到目标会话；确认后系统粘贴草稿。'
              : canAutoSend
                ? '从浏览器控制选择账号发起预检；自动发送模式会在真实对象、输入框、发送按钮和回复回读通过后直接发送。'
                : '从浏览器控制选择账号发起预检；确认后发送模式会先停在待确认。'
            : entryPreflightAvailable
              ? isWechatType
                ? wechatDesktopPreflight.nextAction
                : executor.nextAction
              : '请先启动本地发布服务，确保 /interaction/capabilities 声明该任务类型。',
        };
      });

    return {
      checkedAt,
      summary: {
        total: executors.length,
        ready: executors.filter((executor) => executor.status === 'ready')
          .length,
        preflightOnly: executors.filter(
          (executor) => executor.status === 'preflight_only',
        ).length,
        missing: executors.filter((executor) => executor.status === 'missing')
          .length,
      },
      executors,
    };
  }

  async preflightTask(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
  ): Promise<InteractionExecutorPreflightResult> {
    const capability = await this.resolveTaskCapability(task);
    if (!capability.ok) {
      runtime.setTaskStep(
        task,
        'account-entry',
        'blocked',
        capability.failureReason,
      );
      runtime.setTaskStep(
        task,
        'target-read',
        'blocked',
        '真实能力预检未通过，不能读取目标对象。',
      );
      runtime.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        '未读取真实对象，不能生成回复。',
      );
      runtime.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '真实能力缺失，不能进入发送确认。',
      );
      runtime.pushEvent(task, 'error', capability.failureReason, {
        type: 'failure_reason',
        label: '浏览器执行能力',
        value: capability.diagnostic,
      });
      return {
        state: 'executor_missing',
        terminalStatus: 'failed',
        failureReason: capability.failureReason,
        nextAction: capability.nextAction,
      };
    }

    if (!this.isDesktopInteractionTask(task.type) && !task.accountId) {
      const message = '未选择本地平台账号，不能执行真实互动任务。';
      runtime.pushEvent(task, 'error', message);
      runtime.setTaskStep(task, 'account-entry', 'blocked', message);
      return {
        state: 'executor_missing',
        failureReason: message,
        nextAction: '请先选择已登录的平台账号。',
      };
    }

    const accountId = Number(task.accountId);
    if (
      !this.isDesktopInteractionTask(task.type) &&
      (!Number.isInteger(accountId) || accountId <= 0)
    ) {
      const message = `账号 ID 无效：${task.accountId}`;
      runtime.pushEvent(task, 'warning', message);
      runtime.setTaskStep(task, 'account-entry', 'blocked', message);
      return {
        state: 'executor_missing',
        failureReason: message,
        nextAction: '请重新选择一个有效的本地平台账号。',
      };
    }

    try {
      runtime.setTaskStep(
        task,
        'account-entry',
        'running',
        `正在打开平台账号后台：${task.accountName}`,
      );
      runtime.pushEvent(
        task,
        'info',
        `正在打开平台账号后台：${task.accountName}`,
      );
      return await this.preflightInteractionEntry(task, runtime);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      runtime.setTaskStep(
        task,
        'account-entry',
        'blocked',
        `平台账号后台打开失败：${message}`,
      );
      runtime.pushEvent(
        task,
        'error',
        `平台账号后台打开失败：${task.accountName}，原因：${message}`,
        {
          type: 'text',
          label: '失败阶段',
          value: 'open-account-browser',
        },
      );
      return {
        state: 'executor_missing',
        failureReason: `平台账号后台打开失败：${message}`,
        nextAction: '请到本地能力 / 浏览器控制检查账号状态后重试。',
      };
    }
  }

  async draftApprovedReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    const commercialBlocker = this.blockUnreleasedWechatCommercialTask(task);
    if (commercialBlocker) {
      return commercialBlocker;
    }

    const capability = await this.resolveTaskCapability(task);
    if (!capability.ok) {
      return {
        ok: false,
        status: 'unsupported',
        message: capability.failureReason,
        evidence: {
          type: 'failure_reason',
          label: '浏览器执行能力',
          value: capability.diagnostic,
        },
        nextAction: capability.nextAction,
      };
    }
    if (
      task.type === 'douyin-comment-reply' ||
      task.type === 'douyin-direct-message-reply' ||
      task.type === 'wechat-channel-comment-reply' ||
      task.type === 'wechat-channel-direct-message-reply'
    ) {
      const sendCapability = await this.resolveSendCapability(
        task,
        'draft-fill',
      );
      if (!sendCapability.ok) {
        return {
          ok: false,
          status: 'unsupported',
          message: sendCapability.failureReason,
          evidence: {
            type: 'failure_reason',
            label: '浏览器发送能力',
            value: sendCapability.diagnostic,
          },
          nextAction: sendCapability.nextAction,
        };
      }
    }

    if (task.type === 'wechat-reply-draft') {
      return this.draftWechatReply(task);
    }

    if (task.type === 'douyin-direct-message-reply') {
      return this.draftDouyinMessageReply(task);
    }

    if (task.type === 'wechat-channel-direct-message-reply') {
      return this.draftWechatChannelMessageReply(task);
    }

    if (task.type === 'wechat-channel-comment-reply') {
      return this.draftWechatChannelCommentReply(task);
    }

    if (task.type !== 'douyin-comment-reply') {
      return {
        ok: false,
        status: 'unsupported',
        message: '当前任务类型还未接入草稿填入执行器。',
        nextAction: '请等待对应平台的输入框定位和草稿填充能力接入。',
      };
    }

    const accountId = Number(task.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return {
        ok: false,
        status: 'unsupported',
        message: '缺少有效本地账号，无法填入草稿。',
        nextAction: '请重新选择一个有效的抖音账号。',
      };
    }

    let result: Awaited<
      ReturnType<AutoUploadService['draftDouyinCommentReply']>
    >;
    try {
      result = await this.autoUploadService.draftDouyinCommentReply({
        accountId,
        targetText: task.sourceText,
        replyText: task.replyText,
      });
    } catch (error) {
      return this.handleDouyinDraftFailure('评论', error);
    }

    if (!result) {
      return {
        ok: false,
        status: 'unsupported',
        message: '缺少真实执行阶段，当前不能填入评论草稿。',
        nextAction: '请补齐 发布服务 的评论草稿填入能力后重试。',
      };
    }

    return {
      ok: result.status === 'draft_filled',
      status: result.status,
      message: result.message,
      evidence: this.normalizeEngineEvidence(
        result.evidence,
        result.status === 'draft_filled' ? '草稿页面截图' : '草稿失败截图',
      ) || {
        type: 'text',
        label: result.status === 'draft_filled' ? '草稿页面' : '草稿失败',
        value: result.url,
      },
      nextAction:
        result.status === 'draft_filled'
          ? '回复草稿已填入平台页面，请在本机浏览器中人工检查后点击发送。'
          : '请确认评论仍在当前评论管理页，并检查回复输入框是否可见。',
    };
  }

  async autoSendReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    const commercialBlocker = this.blockUnreleasedWechatCommercialTask(task);
    if (commercialBlocker) {
      return commercialBlocker;
    }

    const capability = await this.resolveTaskCapability(task);
    if (!capability.ok) {
      return {
        ok: false,
        status: 'unsupported',
        message: capability.failureReason,
        evidence: {
          type: 'failure_reason',
          label: '浏览器执行能力',
          value: capability.diagnostic,
        },
        nextAction: capability.nextAction,
      };
    }
    const sendCapability = await this.resolveSendCapability(task, 'auto-send');
    if (!sendCapability.ok) {
      return {
        ok: false,
        status: 'unsupported',
        message: sendCapability.failureReason,
        evidence: {
          type: 'failure_reason',
          label: '自动发送能力',
          value: sendCapability.diagnostic,
        },
        nextAction: sendCapability.nextAction,
      };
    }

    if (task.type === 'douyin-direct-message-reply') {
      return this.sendDouyinMessageReply(task);
    }

    if (task.type === 'douyin-comment-reply') {
      return this.sendDouyinCommentReply(task);
    }

    if (task.type === 'wechat-channel-direct-message-reply') {
      return this.sendWechatChannelMessageReply(task);
    }

    if (task.type === 'wechat-channel-comment-reply') {
      return this.sendWechatChannelCommentReply(task);
    }

    if (task.type === 'wechat-reply-draft') {
      return this.sendWechatReply(task);
    }

    return {
      ok: false,
      status: 'unsupported',
      message: `${task.typeLabel}尚未接入真实自动发送执行器。`,
      evidence: {
        type: 'failure_reason',
        label: '自动发送能力',
        value: task.type,
      },
      nextAction: '请先接入该平台的真实发送按钮点击、回读和失败识别能力。',
    };
  }

  private blockUnreleasedWechatCommercialTask(
    task: InteractionTask,
  ): InteractionExecutorDraftResult | null {
    if (
      task.type !== 'wechat-group-broadcast' &&
      task.type !== 'wechat-moments-publish'
    ) {
      return null;
    }

    const label =
      task.type === 'wechat-group-broadcast' ? '微信群发' : '朋友圈发布';
    return {
      ok: false,
      status: 'unsupported',
      message: `${label}还没有完成商用保护，当前禁止执行。`,
      evidence: {
        type: 'failure_reason',
        label: `${label}商用保护`,
        value:
          '未完成目标确认、页面/桌面回读、误触保护和结果证据闭环前，不能真实执行。',
      },
      nextAction: `等${label}商用保护开发完成后再开放执行。`,
    };
  }

  private async draftDouyinMessageReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    const accountId = Number(task.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return {
        ok: false,
        status: 'unsupported',
        message: '缺少有效本地账号，无法填入私信草稿。',
        nextAction: '请重新选择一个有效的抖音账号。',
      };
    }

    let result: Awaited<
      ReturnType<AutoUploadService['draftDouyinMessageReply']>
    >;
    try {
      result = await this.autoUploadService.draftDouyinMessageReply({
        accountId,
        targetText: task.sourceText,
        replyText: task.replyText,
      });
    } catch (error) {
      return this.handleDouyinDraftFailure('私信', error);
    }

    return {
      ok: result.status === 'draft_filled',
      status: result.status,
      message: result.message,
      evidence: this.normalizeEngineEvidence(
        result.evidence,
        result.status === 'draft_filled' ? '私信草稿截图' : '私信草稿失败截图',
      ) || {
        type: 'text',
        label:
          result.status === 'draft_filled' ? '私信草稿页面' : '私信草稿失败',
        value: result.url,
      },
      nextAction:
        result.status === 'draft_filled'
          ? '私信回复草稿已填入平台页面，请在本机浏览器中人工检查后点击发送。'
          : '请确认私信会话仍在当前页面，并检查回复输入框是否可见。',
    };
  }

  private async sendDouyinCommentReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    const accountId = Number(task.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return {
        ok: false,
        status: 'unsupported',
        message: '缺少有效本地账号，无法自动发送评论回复。',
        nextAction: '请重新选择一个有效的抖音账号。',
      };
    }

    let result: Awaited<
      ReturnType<AutoUploadService['sendDouyinCommentReply']>
    >;
    try {
      result = await this.autoUploadService.sendDouyinCommentReply({
        accountId,
        targetText: task.sourceText,
        replyText: task.replyText,
      });
    } catch (error) {
      return this.handleDouyinSendFailure('评论', error);
    }

    const verification = this.verifyBrowserAutoSend(result, '评论');

    return {
      ok: verification.ok,
      status: verification.ok
        ? 'sent'
        : result.status === 'comment_missing'
          ? 'comment_missing'
          : 'send_failed',
      message: result.message,
      evidence: this.normalizeEngineEvidence(
        result.evidence,
        verification.ok ? '评论发送截图' : '评论发送失败截图',
      ) || {
        type: 'text',
        label: verification.ok ? '评论发送结果' : '评论发送失败',
        value: verification.ok ? result.url : verification.reasons.join('；'),
      },
      nextAction: verification.ok
        ? '评论回复已由系统自动发出，可在执行记录查看证据。'
        : result.status === 'comment_missing'
          ? '评论对象已不存在或已处理，本次无需继续发送。'
          : verification.nextAction,
      readbackText: result.readbackText,
      replyVisible: result.replyVisible,
    };
  }

  private async sendDouyinMessageReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    const accountId = Number(task.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return {
        ok: false,
        status: 'unsupported',
        message: '缺少有效本地账号，无法自动发送私信回复。',
        nextAction: '请重新选择一个有效的抖音账号。',
      };
    }

    let result: Awaited<
      ReturnType<AutoUploadService['sendDouyinMessageReply']>
    >;
    try {
      result = await this.autoUploadService.sendDouyinMessageReply({
        accountId,
        targetText: task.sourceText,
        replyText: task.replyText,
      });
    } catch (error) {
      return this.handleDouyinSendFailure('私信', error);
    }

    const verification = this.verifyBrowserAutoSend(result, '私信');

    return {
      ok: verification.ok,
      status: verification.ok
        ? 'sent'
        : result.status === 'message_missing'
          ? 'message_missing'
          : 'send_failed',
      message: result.message,
      evidence: this.normalizeEngineEvidence(
        result.evidence,
        verification.ok ? '私信发送截图' : '私信发送失败截图',
      ) || {
        type: 'text',
        label: verification.ok ? '私信发送结果' : '私信发送失败',
        value: verification.ok ? result.url : verification.reasons.join('；'),
      },
      nextAction: verification.ok
        ? '私信回复已由系统自动发出，可在执行记录查看证据。'
        : result.status === 'message_missing'
          ? '私信会话已不存在或已处理，本次无需继续发送。'
          : verification.nextAction,
      readbackText: result.readbackText,
      replyVisible: result.replyVisible,
    };
  }

  private async draftWechatChannelCommentReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    return this.runWechatChannelReply(task, '评论', false);
  }

  private async draftWechatChannelMessageReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    return this.runWechatChannelReply(task, '私信', false);
  }

  private async sendWechatChannelCommentReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    return this.runWechatChannelReply(task, '评论', true);
  }

  private async sendWechatChannelMessageReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    return this.runWechatChannelReply(task, '私信', true);
  }

  private async runWechatChannelReply(
    task: InteractionTask,
    targetLabel: '评论' | '私信',
    send: boolean,
  ): Promise<InteractionExecutorDraftResult> {
    const accountId = Number(task.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return {
        ok: false,
        status: 'unsupported',
        message: `缺少有效本地账号，无法${send ? '自动发送' : '填入'}视频号${targetLabel}回复。`,
        nextAction: '请重新选择一个有效的视频号账号。',
      };
    }

    try {
      const result =
        targetLabel === '评论'
          ? send
            ? await this.autoUploadService.sendWechatChannelCommentReply({
                accountId,
                targetText: task.sourceText,
                replyText: task.replyText,
              })
            : await this.autoUploadService.draftWechatChannelCommentReply({
                accountId,
                targetText: task.sourceText,
                replyText: task.replyText,
              })
          : send
            ? await this.autoUploadService.sendWechatChannelMessageReply({
                accountId,
                targetText: task.sourceText,
                replyText: task.replyText,
              })
            : await this.autoUploadService.draftWechatChannelMessageReply({
                accountId,
                targetText: task.sourceText,
                replyText: task.replyText,
              });

      const verification = send
        ? this.verifyBrowserAutoSend(result, `视频号${targetLabel}`)
        : null;
      const sent = verification?.ok === true;
      const drafted = result.status === 'draft_filled';
      const missing =
        result.status === 'comment_missing' ||
        result.status === 'message_missing';
      return {
        ok: send ? sent : drafted,
        status: send
          ? sent
            ? 'sent'
            : missing
              ? result.status
              : 'send_failed'
          : result.status,
        message: result.message,
        evidence: this.normalizeEngineEvidence(
          result.evidence,
          send
            ? sent
              ? `视频号${targetLabel}发送截图`
              : `视频号${targetLabel}发送失败截图`
            : drafted
              ? `视频号${targetLabel}草稿截图`
              : `视频号${targetLabel}草稿失败截图`,
        ) || {
          type: 'text',
          label: send
            ? sent
              ? `视频号${targetLabel}发送结果`
              : `视频号${targetLabel}发送失败`
            : drafted
              ? `视频号${targetLabel}草稿页面`
              : `视频号${targetLabel}草稿失败`,
          value:
            send && verification && !verification.ok
              ? verification.reasons.join('；')
              : result.url,
        },
        nextAction: send
          ? sent
            ? `视频号${targetLabel}回复已由系统自动发出，可在执行记录查看证据。`
            : missing
              ? `${targetLabel}对象已不存在或已处理，本次无需继续发送。`
              : verification?.nextAction ||
                '请检查视频号助手后台是否拦截发送，或切到确认后发送人工处理。'
          : drafted
            ? `视频号${targetLabel}回复草稿已填入平台页面，请在本机浏览器中人工检查后点击发送。`
            : `请确认视频号${targetLabel}仍在当前页面，并检查回复输入框是否可见。`,
        readbackText:
          send && 'readbackText' in result ? result.readbackText : undefined,
        replyVisible:
          send && 'replyVisible' in result ? result.replyVisible : undefined,
      };
    } catch (error) {
      return send
        ? this.handlePlatformSendFailure('视频号', targetLabel, error)
        : this.handlePlatformDraftFailure('视频号', targetLabel, error);
    }
  }

  private async sendWechatReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    const preflight = await this.preflightWechatDesktop();
    if (!preflight.ready) {
      return {
        ok: false,
        status: 'desktop_permission_missing',
        message: preflight.reason || '微信桌面预检未通过',
        evidence: {
          type: 'text',
          label: '微信桌面预检',
          value: preflight.reason || '微信桌面预检未通过',
        },
        nextAction:
          '请打开桌面微信目标会话，确保本系统有辅助功能、屏幕录制、点击和输入权限。',
      };
    }

    let result: Awaited<ReturnType<AutoUploadService['sendWechatReply']>>;
    try {
      result = await this.autoUploadService.sendWechatReply({
        targetText: task.targetName || task.sourceText,
        replyText: task.replyText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        ok: false,
        status: 'send_failed',
        message,
        evidence: {
          type: 'failure_reason',
          label: '微信自动发送失败',
          value: message,
        },
        nextAction:
          '请确认微信当前会话就是目标联系人，并检查桌面控制权限后重试。',
      };
    }

    const verification = this.verifyDesktopAutoSend(result, '微信');

    return {
      ok: verification.ok,
      status: verification.ok ? 'sent' : 'send_failed',
      message: result.message,
      evidence: this.normalizeEngineEvidence(
        result.evidence,
        verification.ok ? '微信发送截图' : '微信发送失败截图',
      ) || {
        type: 'text',
        label: verification.ok ? '微信发送结果' : '微信发送失败',
        value: verification.ok
          ? result.readbackText || result.message
          : verification.reasons.join('；'),
      },
      nextAction: verification.ok
        ? '微信回复已由系统自动发出，可在执行记录查看证据。'
        : verification.nextAction,
    };
  }

  private async preflightInteractionEntry(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
  ): Promise<InteractionExecutorPreflightResult> {
    if (task.type === 'douyin-comment-reply') {
      return this.preflightDouyinComment(task, runtime);
    }

    if (task.type === 'douyin-direct-message-reply') {
      if (task.platformType && task.platformType !== 3) {
        runtime.pushEvent(
          task,
          'warning',
          `当前选择的是 ${task.platformName || `平台 ${task.platformType}`} 账号，不是抖音账号，无法进入抖音私信预检。`,
          {
            type: 'text',
            label: '预检阶段',
            value: 'douyin-direct-message-preflight',
          },
        );
        return {
          state: 'executor_missing',
          failureReason: '平台账号类型不匹配',
          nextAction: '请选择抖音账号后再创建私信回复任务。',
        };
      }

      const commercialPreflight = await this.runCdpCommercialPreflight(
        task,
        runtime,
        'douyin',
        '抖音私信',
      );
      if (!commercialPreflight.ok) {
        return {
          state: 'executor_missing',
          terminalStatus: 'failed',
          failureReason: commercialPreflight.blockers.join('；'),
          nextAction: commercialPreflight.nextAction,
        };
      }

      const result = await this.openInteractionEntry(
        task,
        'douyin-direct-message-reply',
      );
      const loginState =
        result.loggedIn === false ? '页面疑似未登录' : '入口页面已打开';
      runtime.setTaskStep(
        task,
        'account-entry',
        'completed',
        `${loginState}：${result.entryName}。`,
      );
      runtime.pushEvent(
        task,
        'success',
        `已调用发布服务打开${result.entryName}：${result.platformName} / ${result.accountName}`,
        {
          type: 'text',
          label: '预检页面',
          value: result.url,
        },
      );
      this.pushEngineEvidence(runtime, task, result.evidence, '入口页面截图');
      runtime.pushEvent(
        task,
        result.loggedIn === false ? 'warning' : 'info',
        this.buildEntryProbeMessage(result),
        {
          type: 'page_snapshot',
          label: result.title || '页面片段',
          value: result.pageTextSample || result.url,
        },
      );
      if (result.loggedIn === false) {
        runtime.setTaskStep(
          task,
          'target-read',
          'blocked',
          '抖音私信入口疑似未登录。',
        );
        return {
          state: 'executor_missing',
          failureReason: '抖音私信入口疑似未登录',
          nextAction:
            '请在打开的本机浏览器中重新登录抖音账号，再返回系统重试私信回复任务。',
        };
      }

      runtime.setTaskStep(
        task,
        'target-read',
        'running',
        '正在打开真实抖音私信页，读取会话列表和 IM 网络响应。',
      );
      runtime.pushEvent(
        task,
        'info',
        '正在读取抖音私信：先看页面会话列表；如果页面转圈，会读取抖音 IM 接口返回的真实文本。',
      );
      let messagesResult: Awaited<
        ReturnType<AutoUploadService['readDouyinMessages']>
      >;
      try {
        messagesResult = await this.autoUploadService.readDouyinMessages({
          accountId: Number(task.accountId),
          limit: 10,
        });
      } catch (error) {
        return this.handleDouyinReadFailure(task, runtime, '私信', error);
      }

      this.pushEngineEvidence(
        runtime,
        task,
        messagesResult.evidence,
        '私信读取截图',
      );
      if (messagesResult.summary?.blocked || messagesResult.loadBlocked) {
        const loaderCount = messagesResult.pageLoadState?.visibleLoaders ?? 0;
        const scannedTabs = (messagesResult.scannedTabs || [])
          .map(
            (tab) =>
              `${tab.label || '未知'}${tab.loading ? ` 转圈${tab.loading}` : ''}`,
          )
          .join('；');
        runtime.setTaskStep(
          task,
          'target-read',
          'blocked',
          messagesResult.loadBlockedReason ||
            messagesResult.summary?.emptyReason ||
            '抖音私信列表没有进入可读取状态。',
        );
        runtime.setTaskStep(
          task,
          'reply-generate',
          'blocked',
          '没有读到真实可回复私信，不能生成回复。',
        );
        runtime.setTaskStep(
          task,
          'send-approval',
          'blocked',
          '没有读到真实可回复私信，不能进入发送。',
        );
        runtime.setTaskStep(
          task,
          'send-result',
          'blocked',
          messagesResult.loadBlockedReason ||
            messagesResult.summary?.emptyReason ||
            '抖音私信列表持续加载，未发送。',
        );
        runtime.pushEvent(
          task,
          'warning',
          `抖音私信后台已打开，但 IM 会话列表还在加载，暂时没有可回复对象。当前加载标记 ${loaderCount} 个${scannedTabs ? `；检查过：${scannedTabs}` : ''}。`,
          {
            type: 'page_snapshot',
            label: '抖音私信页面状态',
            value: messagesResult.pageTextSample || messagesResult.url,
          },
        );
        return {
          state: 'executor_missing',
          terminalStatus: 'failed',
          failureReason:
            messagesResult.loadBlockedReason ||
            messagesResult.summary?.emptyReason ||
            '抖音私信列表持续加载',
          nextAction:
            messagesResult.summary?.nextAction ||
            '请确认本机打开的抖音创作者后台私信列表能正常显示，再重新开始私信回复。',
        };
      }
      runtime.pushEvent(
        task,
        'info',
        `抖音私信读取完成：页面候选 ${messagesResult.summary?.totalCandidates ?? messagesResult.messages.length} 条，可用 ${messagesResult.messages.length} 条。`,
        {
          type: 'text',
          label: '私信读取结果',
          value:
            messagesResult.messages
              .map((item) => item.text)
              .filter(Boolean)
              .slice(0, 5)
              .join('；') ||
            messagesResult.pageTextSample ||
            messagesResult.url,
        },
      );
      const firstMessage = await this.selectDouyinTargetWithAi(
        messagesResult.messages,
        '私信',
        { brandName: task.accountName },
      );

      if (!firstMessage) {
        return this.handleNoDouyinTarget(task, runtime, '私信', messagesResult);
      }

      const replyText = firstMessage.replyText;
      runtime.setTaskStep(
        task,
        'target-read',
        'completed',
        `AI 已识别私信：${firstMessage.item.text}`,
      );
      runtime.setTaskStep(
        task,
        'reply-generate',
        'completed',
        this.replyGeneratedStepMessage(
          firstMessage.generatedBy,
          '真实私信内容',
        ),
      );
      runtime.setTaskStep(
        task,
        'send-approval',
        task.sendMode === 'auto-send' ? 'skipped' : 'running',
        task.sendMode === 'auto-send'
          ? '自动发送模式跳过人工确认，准备执行真实发送。'
          : '已生成私信回复，等待人工确认；暂不执行真实发送。',
      );
      runtime.pushEvent(
        task,
        'success',
        `AI 已识别抖音私信：${firstMessage.item.text}`,
        {
          ...(this.normalizeEngineEvidence(
            messagesResult.evidence,
            '私信来源',
          ) || {
            type: 'page_snapshot' as const,
            label: '私信来源',
            value: messagesResult.url,
          }),
        },
      );
      runtime.pushEvent(
        task,
        task.sendMode === 'auto-send' ? 'info' : 'warning',
        `${task.sendMode === 'auto-send' ? '自动发送私信回复' : '待确认私信回复'}：${replyText}`,
        {
          type: 'text',
          label: this.replyGeneratedEvidenceLabel(firstMessage.generatedBy),
          value: replyText,
        },
      );
      return {
        state: 'preflight_only',
        targetText: firstMessage.item.text,
        replyText,
        replyGeneratedBy: firstMessage.generatedBy,
        readyForApproval: task.sendMode !== 'auto-send',
        nextAction:
          task.sendMode === 'auto-send'
            ? '已读取真实私信候选并生成回复；系统将继续调用真实发送执行器。'
            : '已读取真实私信候选并生成草稿；确认后只填入草稿，不会自动点击发送。',
      };
    }

    if (task.type === 'wechat-channel-comment-reply') {
      return this.preflightWechatChannelComment(task, runtime);
    }

    if (task.type === 'wechat-channel-direct-message-reply') {
      return this.preflightWechatChannelMessage(task, runtime);
    }

    if (task.platformType && task.platformType !== 2) {
      runtime.pushEvent(
        task,
        'warning',
        `当前选择的是 ${task.platformName || `平台 ${task.platformType}`} 账号，不是视频号/微信账号，无法进入微信回复预检。`,
        {
          type: 'text',
          label: '预检阶段',
          value: 'wechat-draft-preflight',
        },
      );
      return {
        state: 'executor_missing',
        failureReason: '平台账号类型不匹配',
        nextAction: '请选择视频号/微信账号后再创建微信回复任务。',
      };
    }

    const result = await this.openInteractionEntry(task, 'wechat-reply-draft');
    const loginState =
      result.loggedIn === false ? '页面疑似未登录' : '入口页面已打开';
    runtime.setTaskStep(
      task,
      'account-entry',
      'completed',
      `${loginState}：${result.entryName}。`,
    );
    runtime.pushEvent(
      task,
      'success',
      `已调用发布服务打开${result.entryName}：${result.platformName} / ${result.accountName}`,
      {
        type: 'text',
        label: '预检页面',
        value: result.url,
      },
    );
    this.pushEngineEvidence(runtime, task, result.evidence, '入口页面截图');
    runtime.pushEvent(
      task,
      result.loggedIn === false ? 'warning' : 'info',
      this.buildEntryProbeMessage(result),
      {
        type: 'page_snapshot',
        label: result.title || '页面片段',
        value: result.pageTextSample || result.url,
      },
    );
    if (result.loggedIn === false) {
      runtime.setTaskStep(
        task,
        'target-read',
        'blocked',
        '视频号/微信入口疑似未登录。',
      );
      return {
        state: 'executor_missing',
        failureReason: '视频号/微信入口疑似未登录',
        nextAction:
          '请在打开的本机浏览器中重新登录视频号/微信账号，再返回系统重试微信回复任务。',
      };
    }

    const desktop = await this.autoUploadService.getWechatDesktopStatus();
    const desktopPreflight = this.evaluateWechatDesktopPreflight(desktop);
    if (!desktopPreflight.readyForDraft) {
      runtime.setTaskStep(
        task,
        'target-read',
        'blocked',
        desktopPreflight.message,
      );
      runtime.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        '桌面微信 preflight 未通过，不能生成微信草稿。',
      );
      runtime.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '桌面微信窗口或权限不确定，不能进入发送确认。',
      );
      runtime.pushEvent(task, 'warning', desktopPreflight.message, {
        type: 'text',
        label: '桌面微信',
        value:
          desktopPreflight.blockers.join('；') ||
          desktop.appName ||
          'not-running',
      });
      return {
        state: 'executor_missing',
        terminalStatus: 'failed',
        failureReason: desktopPreflight.message,
        nextAction: desktopPreflight.nextAction,
      };
    }

    runtime.setTaskStep(
      task,
      'target-read',
      'completed',
      '已检测到桌面微信，使用当前会话作为草稿目标。',
    );
    runtime.setTaskStep(
      task,
      'reply-generate',
      'completed',
      '已生成微信回复草稿。',
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      'running',
      '等待人工确认；确认后只把草稿粘贴到当前微信会话，不自动发送。',
    );
    runtime.pushEvent(task, 'success', desktop.message, {
      type: 'text',
      label: '桌面微信',
      value: `${desktop.appName || '微信'} / ${desktop.windowCount} 个窗口 / ${desktopPreflight.currentWindowTitle || '未读取窗口标题'}`,
    });
    runtime.pushEvent(task, 'warning', `待确认微信草稿：${task.replyText}`, {
      type: 'text',
      label: '回复草稿',
      value: task.replyText,
    });
    return {
      state: 'preflight_only',
      targetText: task.sourceText,
      replyText: task.replyText,
      readyForApproval: true,
      nextAction: '确认目标会话无误后点击确认，系统只粘贴草稿，不会点击发送。',
    };
  }

  async preflightWechatDesktop(): Promise<WechatDesktopPreflightResult> {
    try {
      const aliveResult = await this.autoUploadService.checkWechatAlive();
      if (!aliveResult.alive) {
        return {
          ready: false,
          reason: aliveResult.reason || '微信未登录或不可用',
        };
      }
    } catch (error) {
      return {
        ready: false,
        reason: `微信存活检测失败：${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }

    try {
      const windowsResult = await this.autoUploadService.listWechatWindows();
      if (!windowsResult.windows || windowsResult.windows.length === 0) {
        return {
          ready: false,
          reason: '未检测到微信窗口',
        };
      }
      const mainWindow =
        windowsResult.windows.find((w) => w.isMain) || windowsResult.windows[0];

      try {
        const popupResult = await this.autoUploadService.dismissWechatPopup();
        if (popupResult.dismissed) {
          this.logger.log(
            `已关闭微信弹窗：${popupResult.popupType || 'unknown'}`,
          );
        }
        return {
          ready: true,
          windowId: mainWindow.id,
          popupDismissed: popupResult.dismissed,
        };
      } catch {
        return {
          ready: true,
          windowId: mainWindow.id,
          popupDismissed: false,
        };
      }
    } catch (error) {
      return {
        ready: false,
        reason: `微信窗口列表读取失败：${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }

  private async draftWechatReply(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult> {
    const preflight = await this.preflightWechatDesktop();
    if (!preflight.ready) {
      return {
        ok: false,
        status: 'desktop_permission_missing',
        message: preflight.reason || '微信桌面预检未通过',
        evidence: {
          type: 'text',
          label: '微信桌面预检',
          value: preflight.reason || '微信桌面预检未通过',
        },
        nextAction: '请检查桌面微信状态后重试。',
      };
    }

    if (task.targetName) {
      try {
        const contactResult = await this.autoUploadService.resolveWechatContact(
          task.targetName,
        );
        if (contactResult.ambiguous) {
          return {
            ok: false,
            status: 'desktop_permission_missing',
            message: `联系人 "${task.targetName}" 存在多个匹配，请人工确认后重试。匹配列表：${contactResult.matches.map((m) => `${m.name}${m.remark ? `(${m.remark})` : ''}`).join('、')}`,
            evidence: {
              type: 'text',
              label: '联系人歧义',
              value: JSON.stringify(contactResult.matches),
            },
            nextAction: '请在微信中确认目标联系人后重试。',
          };
        }
      } catch {}
    }

    const desktop = await this.autoUploadService.getWechatDesktopStatus();
    const desktopPreflight = this.evaluateWechatDesktopPreflight(desktop);
    if (!desktopPreflight.readyForDraft) {
      return {
        ok: false,
        status: 'desktop_permission_missing',
        message: desktopPreflight.message,
        evidence: {
          type: 'text',
          label: '微信桌面 preflight',
          value:
            desktopPreflight.blockers.join('；') || desktopPreflight.message,
        },
        nextAction: desktopPreflight.nextAction,
      };
    }

    const result = await this.autoUploadService.draftWechatReply({
      targetText: task.sourceText,
      replyText: task.replyText,
    });

    return {
      ok: result.status === 'draft_filled',
      status: result.status,
      message: result.message,
      evidence: {
        type: 'text',
        label: result.status === 'draft_filled' ? '微信草稿' : '微信草稿失败',
        value: result.desktop?.appName || result.message,
      },
      nextAction:
        result.status === 'draft_filled'
          ? '微信草稿已粘贴到当前会话输入框，请人工检查后手动发送。'
          : '请打开桌面微信并进入目标客户会话，同时确认系统辅助功能权限已开启。',
    };
  }

  async executeWechatGroupBroadcast(task: InteractionTask): Promise<{
    ok: boolean;
    status: string;
    message: string;
    results: Array<{
      targetName: string;
      status: 'success' | 'failed' | 'skipped';
      message: string;
    }>;
    summary: {
      total: number;
      success: number;
      failed: number;
      skipped: number;
    };
  }> {
    const preflight = await this.preflightWechatDesktop();
    if (!preflight.ready) {
      return {
        ok: false,
        status: 'desktop_permission_missing',
        message: preflight.reason || '微信桌面预检未通过',
        results: [],
        summary: { total: 0, success: 0, failed: 0, skipped: 0 },
      };
    }

    const targets = task.batchTargets || [];
    if (targets.length === 0) {
      return {
        ok: false,
        status: 'no_target',
        message: '群发任务没有目标联系人。',
        results: [],
        summary: { total: 0, success: 0, failed: 0, skipped: 0 },
      };
    }

    const results: Array<{
      targetName: string;
      status: 'success' | 'failed' | 'skipped';
      message: string;
    }> = [];

    for (const target of targets) {
      try {
        const targetText = target.sourceText || target.targetName;
        const replyText = target.replyText || task.replyText;
        const draftResult =
          task.sendMode === 'auto-send'
            ? await this.autoUploadService.sendWechatReply({
                targetText,
                replyText,
              })
            : await this.autoUploadService.draftWechatReply({
                targetText,
                replyText,
              });

        if (
          draftResult.status === 'draft_filled' ||
          draftResult.status === 'sent'
        ) {
          results.push({
            targetName: target.targetName,
            status: 'success',
            message:
              task.sendMode === 'auto-send'
                ? `消息已发送到 ${target.targetName}。`
                : `草稿已填入 ${target.targetName} 的会话。`,
          });
        } else {
          results.push({
            targetName: target.targetName,
            status: 'failed',
            message:
              draftResult.message || `草稿填入 ${target.targetName} 失败。`,
          });
        }
      } catch (error) {
        results.push({
          targetName: target.targetName,
          status: 'failed',
          message: error instanceof Error ? error.message : '草稿填入失败',
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;

    return {
      ok: successCount > 0,
      status:
        successCount === targets.length
          ? 'all_completed'
          : successCount > 0
            ? 'partial_completed'
            : 'all_failed',
      message: `群发完成：成功 ${successCount}，失败 ${failedCount}，跳过 ${skippedCount}。`,
      results,
      summary: {
        total: targets.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
      },
    };
  }

  async executeWechatMomentsPublish(task: InteractionTask): Promise<{
    ok: boolean;
    status: string;
    message: string;
    evidence?: { type: string; label: string; value: string };
  }> {
    const preflight = await this.preflightWechatDesktop();
    if (!preflight.ready) {
      return {
        ok: false,
        status: 'desktop_permission_missing',
        message: preflight.reason || '微信桌面预检未通过',
        evidence: {
          type: 'text',
          label: '微信桌面预检',
          value: preflight.reason || '微信桌面预检未通过',
        },
      };
    }

    const assetPath = task.sourceText?.trim();
    if (!assetPath || !existsSync(assetPath)) {
      return {
        ok: false,
        status: 'moments_publish_failed',
        message: 'Mac 微信朋友圈当前需要真实图片素材路径，缺少素材不能发布。',
        evidence: {
          type: 'text',
          label: '朋友圈素材缺失',
          value: assetPath || 'empty',
        },
      };
    }

    try {
      const result = await this.runWechatMomentsPublishCommand(
        task.replyText || task.sourceText,
        task.sendMode === 'auto-send' ? 'auto-send' : 'approval',
        assetPath,
      );

      return {
        ok: true,
        status: task.sendMode === 'auto-send' ? 'sent' : 'draft_filled',
        message:
          task.sendMode === 'auto-send'
            ? '朋友圈已通过桌面微信执行发表。'
            : '朋友圈文案已填入，停在发表前。',
        evidence: {
          type: 'text',
          label:
            task.sendMode === 'auto-send' ? '朋友圈发布结果' : '朋友圈草稿',
          value: result.screenshotPath || task.replyText,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        ok: false,
        status: 'moments_publish_failed',
        message: `朋友圈发布草稿填入失败：${message}`,
        evidence: {
          type: 'text',
          label: '朋友圈草稿失败',
          value: message,
        },
      };
    }
  }

  private runWechatMomentsPublishCommand(
    content: string,
    mode: 'auto-send' | 'approval',
    assetPath: string,
  ): Promise<{ screenshotPath?: string }> {
    return new Promise((resolve, reject) => {
      const { spawn } =
        require('child_process') as typeof import('child_process');
      const child = spawn(
        'wechat-moments-publish',
        [content, mode, assetPath],
        {
          env: {
            ...process.env,
            PATH: `${process.env.PATH || ''}:/Users/yanghy/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('wechat-moments-publish 执行超时'));
      }, 90000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          const output = stdout.trim();
          if (!output) {
            resolve({});
            return;
          }
          try {
            const parsed = JSON.parse(output) as { screenshotPath?: unknown };
            resolve({
              screenshotPath:
                typeof parsed.screenshotPath === 'string'
                  ? parsed.screenshotPath
                  : undefined,
            });
          } catch {
            resolve({});
          }
          return;
        }
        reject(
          new Error(
            (
              stderr ||
              stdout ||
              `wechat-moments-publish 退出码 ${code}`
            ).trim(),
          ),
        );
      });
    });
  }

  private async preflightDouyinComment(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
  ): Promise<InteractionExecutorPreflightResult> {
    if (task.platformType && task.platformType !== 3) {
      runtime.pushEvent(
        task,
        'warning',
        `当前选择的是 ${task.platformName || `平台 ${task.platformType}`} 账号，不是抖音账号，无法进入抖音评论预检。`,
        {
          type: 'text',
          label: '预检阶段',
          value: 'douyin-comment-preflight',
        },
      );
      return {
        state: 'executor_missing',
        failureReason: '平台账号类型不匹配',
        nextAction: '请选择抖音账号后再创建评论回复任务。',
      };
    }

    runtime.pushEvent(task, 'info', '准备打开抖音评论管理预检页。', {
      type: 'text',
      label: '预检阶段',
      value: 'douyin-comment-preflight',
    });

    const commercialPreflight = await this.runCdpCommercialPreflight(
      task,
      runtime,
      'douyin',
      '抖音评论',
    );
    if (!commercialPreflight.ok) {
      return {
        state: 'executor_missing',
        terminalStatus: 'failed',
        failureReason: commercialPreflight.blockers.join('；'),
        nextAction: commercialPreflight.nextAction,
      };
    }

    const result = await this.openInteractionEntry(
      task,
      'douyin-comment-reply',
    );
    const loginState =
      result.loggedIn === false ? '页面疑似未登录' : '入口页面已打开';
    runtime.setTaskStep(
      task,
      'account-entry',
      'completed',
      `${loginState}：${result.entryName}。`,
    );
    runtime.pushEvent(
      task,
      'success',
      `已调用发布服务打开${result.entryName}：${result.platformName} / ${result.accountName}`,
      {
        type: 'text',
        label: '预检页面',
        value: result.url,
      },
    );
    this.pushEngineEvidence(runtime, task, result.evidence, '入口页面截图');
    runtime.pushEvent(
      task,
      result.loggedIn === false ? 'warning' : 'info',
      this.buildEntryProbeMessage(result),
      {
        type: 'page_snapshot',
        label: result.title || '页面片段',
        value: result.pageTextSample || result.url,
      },
    );
    if (result.loggedIn === false) {
      runtime.setTaskStep(
        task,
        'target-read',
        'blocked',
        '抖音评论入口疑似未登录。',
      );
      return {
        state: 'executor_missing',
        failureReason: '抖音评论入口疑似未登录',
        nextAction:
          '请在打开的本机浏览器中重新登录抖音账号，再返回系统重试评论回复任务。',
      };
    }

    runtime.setTaskStep(
      task,
      'target-read',
      'running',
      '正在打开真实抖音评论管理页，读取作品评论。',
    );
    runtime.pushEvent(
      task,
      'info',
      '正在读取抖音评论：会自动进入评论管理并在作品里查找真实客户评论。',
    );
    let commentsResult: Awaited<
      ReturnType<AutoUploadService['readDouyinComments']>
    >;
    try {
      commentsResult = await this.autoUploadService.readDouyinComments({
        accountId: Number(task.accountId),
        limit: 10,
      });
    } catch (error) {
      return this.handleDouyinReadFailure(task, runtime, '评论', error);
    }

    this.pushEngineEvidence(
      runtime,
      task,
      commentsResult.evidence,
      '评论读取截图',
    );
    runtime.pushEvent(
      task,
      'info',
      `抖音评论读取完成：页面候选 ${commentsResult.summary?.totalCandidates ?? commentsResult.comments.length} 条，可用 ${commentsResult.comments.length} 条。`,
      {
        type: 'text',
        label: '评论读取结果',
        value:
          commentsResult.comments
            .map((item) => item.text)
            .filter(Boolean)
            .slice(0, 5)
            .join('；') ||
          commentsResult.pageTextSample ||
          commentsResult.url,
      },
    );
    const firstComment = await this.selectDouyinTargetWithAi(
      commentsResult.comments,
      '评论',
      { brandName: task.accountName },
    );

    if (!firstComment) {
      return this.handleNoDouyinTarget(task, runtime, '评论', commentsResult);
    }

    const replyText = firstComment.replyText;
    runtime.setTaskStep(
      task,
      'target-read',
      'completed',
      `AI 已识别评论：${firstComment.item.text}`,
    );
    runtime.setTaskStep(
      task,
      'reply-generate',
      'completed',
      this.replyGeneratedStepMessage(firstComment.generatedBy, '真实评论内容'),
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      task.sendMode === 'auto-send' ? 'skipped' : 'running',
      task.sendMode === 'auto-send'
        ? '自动发送模式跳过人工确认，准备执行真实发送。'
        : '已生成回复，等待人工确认；暂不执行真实发送。',
    );
    runtime.pushEvent(
      task,
      'success',
      `AI 已识别抖音评论：${firstComment.item.text}`,
      {
        ...(this.normalizeEngineEvidence(
          commentsResult.evidence,
          '评论来源',
        ) || {
          type: 'page_snapshot' as const,
          label: '评论来源',
          value: commentsResult.url,
        }),
      },
    );
    runtime.pushEvent(
      task,
      task.sendMode === 'auto-send' ? 'info' : 'warning',
      `${task.sendMode === 'auto-send' ? '自动发送回复' : '待确认回复'}：${replyText}`,
      {
        type: 'text',
        label: this.replyGeneratedEvidenceLabel(firstComment.generatedBy),
        value: replyText,
      },
    );
    return {
      state: 'preflight_only',
      targetText: firstComment.item.text,
      replyText,
      replyGeneratedBy: firstComment.generatedBy,
      readyForApproval: task.sendMode !== 'auto-send',
      nextAction:
        task.sendMode === 'auto-send'
          ? '已读取真实评论并生成回复；系统将继续调用真实发送执行器。'
          : '已读取真实评论并生成草稿；确认后只填入草稿，不会自动点击发送。',
    };
  }

  private async preflightWechatChannelComment(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
  ): Promise<InteractionExecutorPreflightResult> {
    if (task.platformType && task.platformType !== 2) {
      runtime.pushEvent(
        task,
        'warning',
        `当前选择的是 ${task.platformName || `平台 ${task.platformType}`} 账号，不是视频号账号，无法进入视频号评论预检。`,
        {
          type: 'text',
          label: '预检阶段',
          value: 'wechat-channel-comment-preflight',
        },
      );
      return {
        state: 'executor_missing',
        failureReason: '平台账号类型不匹配',
        nextAction: '请选择视频号账号后再创建评论回复任务。',
      };
    }

    runtime.pushEvent(task, 'info', '准备打开视频号评论管理预检页。', {
      type: 'text',
      label: '预检阶段',
      value: 'wechat-channel-comment-preflight',
    });

    const commercialPreflight = await this.runCdpCommercialPreflight(
      task,
      runtime,
      'wechat-channel',
      '视频号评论',
    );
    if (!commercialPreflight.ok) {
      return {
        state: 'executor_missing',
        terminalStatus: 'failed',
        failureReason: commercialPreflight.blockers.join('；'),
        nextAction: commercialPreflight.nextAction,
      };
    }

    const result = await this.openInteractionEntry(
      task,
      'wechat-channel-comment-reply',
    );
    const loginState =
      result.loggedIn === false ? '页面疑似未登录' : '入口页面已打开';
    runtime.setTaskStep(
      task,
      'account-entry',
      'completed',
      `${loginState}：${result.entryName}。`,
    );
    runtime.pushEvent(
      task,
      'success',
      `已调用发布服务打开${result.entryName}：${result.platformName} / ${result.accountName}`,
      {
        type: 'text',
        label: '预检页面',
        value: result.url,
      },
    );
    this.pushEngineEvidence(runtime, task, result.evidence, '入口页面截图');
    runtime.pushEvent(
      task,
      result.loggedIn === false ? 'warning' : 'info',
      this.buildEntryProbeMessage(result),
      {
        type: 'page_snapshot',
        label: result.title || '页面片段',
        value: result.pageTextSample || result.url,
      },
    );
    if (result.loggedIn === false) {
      runtime.setTaskStep(
        task,
        'target-read',
        'blocked',
        '视频号评论入口疑似未登录。',
      );
      return {
        state: 'executor_missing',
        failureReason: '视频号评论入口疑似未登录',
        nextAction:
          '请在打开的本机浏览器中重新登录视频号账号，再返回系统重试评论回复任务。',
      };
    }

    runtime.setTaskStep(
      task,
      'target-read',
      'running',
      '正在只读扫描视频号评论候选。',
    );
    let commentsResult: Awaited<
      ReturnType<AutoUploadService['readWechatChannelComments']>
    >;
    try {
      commentsResult = await this.autoUploadService.readWechatChannelComments({
        accountId: Number(task.accountId),
        limit: 10,
      });
    } catch (error) {
      return this.handlePlatformReadFailure(
        task,
        runtime,
        '视频号',
        '评论',
        error,
      );
    }

    this.pushEngineEvidence(
      runtime,
      task,
      commentsResult.evidence,
      '视频号评论读取截图',
    );
    const firstComment = await this.selectDouyinTargetWithAi(
      commentsResult.comments,
      '评论',
      { brandName: task.accountName },
    );

    if (!firstComment) {
      return this.handleNoPlatformTarget(
        task,
        runtime,
        '视频号',
        '评论',
        commentsResult,
      );
    }

    const replyText = firstComment.replyText;
    runtime.setTaskStep(
      task,
      'target-read',
      'completed',
      `AI 已识别视频号评论：${firstComment.item.text}`,
    );
    runtime.setTaskStep(
      task,
      'reply-generate',
      'completed',
      this.replyGeneratedStepMessage(
        firstComment.generatedBy,
        '真实视频号评论内容',
      ),
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      task.sendMode === 'auto-send' ? 'skipped' : 'running',
      task.sendMode === 'auto-send'
        ? '自动发送模式跳过人工确认，准备执行真实发送。'
        : '已生成视频号评论回复，等待人工确认；暂不执行真实发送。',
    );
    runtime.pushEvent(
      task,
      'success',
      `AI 已识别视频号评论：${firstComment.item.text}`,
      {
        ...(this.normalizeEngineEvidence(
          commentsResult.evidence,
          '视频号评论来源',
        ) || {
          type: 'page_snapshot' as const,
          label: '视频号评论来源',
          value: commentsResult.url,
        }),
      },
    );
    runtime.pushEvent(
      task,
      task.sendMode === 'auto-send' ? 'info' : 'warning',
      `${task.sendMode === 'auto-send' ? '自动发送视频号评论回复' : '待确认视频号评论回复'}：${replyText}`,
      {
        type: 'text',
        label: this.replyGeneratedEvidenceLabel(firstComment.generatedBy),
        value: replyText,
      },
    );
    return {
      state: 'preflight_only',
      targetText: firstComment.item.text,
      replyText,
      replyGeneratedBy: firstComment.generatedBy,
      readyForApproval: task.sendMode !== 'auto-send',
      nextAction:
        task.sendMode === 'auto-send'
          ? '已读取真实视频号评论并生成回复；系统将继续调用真实发送执行器。'
          : '已读取真实视频号评论并生成草稿；确认后只填入草稿，不会自动点击发送。',
    };
  }

  private async preflightWechatChannelMessage(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
  ): Promise<InteractionExecutorPreflightResult> {
    if (task.platformType && task.platformType !== 2) {
      runtime.pushEvent(
        task,
        'warning',
        `当前选择的是 ${task.platformName || `平台 ${task.platformType}`} 账号，不是视频号账号，无法进入视频号私信预检。`,
        {
          type: 'text',
          label: '预检阶段',
          value: 'wechat-channel-message-preflight',
        },
      );
      return {
        state: 'executor_missing',
        failureReason: '平台账号类型不匹配',
        nextAction: '请选择视频号账号后再创建私信回复任务。',
      };
    }

    runtime.pushEvent(task, 'info', '准备打开视频号私信管理预检页。', {
      type: 'text',
      label: '预检阶段',
      value: 'wechat-channel-message-preflight',
    });

    const commercialPreflight = await this.runCdpCommercialPreflight(
      task,
      runtime,
      'wechat-channel',
      '视频号私信',
    );
    if (!commercialPreflight.ok) {
      return {
        state: 'executor_missing',
        terminalStatus: 'failed',
        failureReason: commercialPreflight.blockers.join('；'),
        nextAction: commercialPreflight.nextAction,
      };
    }

    const result = await this.openInteractionEntry(
      task,
      'wechat-channel-direct-message-reply',
    );
    const loginState =
      result.loggedIn === false ? '页面疑似未登录' : '入口页面已打开';
    runtime.setTaskStep(
      task,
      'account-entry',
      'completed',
      `${loginState}：${result.entryName}。`,
    );
    runtime.pushEvent(
      task,
      'success',
      `已调用发布服务打开${result.entryName}：${result.platformName} / ${result.accountName}`,
      {
        type: 'text',
        label: '预检页面',
        value: result.url,
      },
    );
    this.pushEngineEvidence(runtime, task, result.evidence, '入口页面截图');
    runtime.pushEvent(
      task,
      result.loggedIn === false ? 'warning' : 'info',
      this.buildEntryProbeMessage(result),
      {
        type: 'page_snapshot',
        label: result.title || '页面片段',
        value: result.pageTextSample || result.url,
      },
    );
    if (result.loggedIn === false) {
      runtime.setTaskStep(
        task,
        'target-read',
        'blocked',
        '视频号私信入口疑似未登录。',
      );
      return {
        state: 'executor_missing',
        failureReason: '视频号私信入口疑似未登录',
        nextAction:
          '请在打开的本机浏览器中重新登录视频号账号，再返回系统重试私信回复任务。',
      };
    }

    runtime.setTaskStep(
      task,
      'target-read',
      'running',
      '正在只读扫描视频号私信候选。',
    );
    let messagesResult: Awaited<
      ReturnType<AutoUploadService['readWechatChannelMessages']>
    >;
    try {
      messagesResult = await this.autoUploadService.readWechatChannelMessages({
        accountId: Number(task.accountId),
        limit: 10,
      });
    } catch (error) {
      return this.handlePlatformReadFailure(
        task,
        runtime,
        '视频号',
        '私信',
        error,
      );
    }

    this.pushEngineEvidence(
      runtime,
      task,
      messagesResult.evidence,
      '视频号私信读取截图',
    );
    const firstMessage = await this.selectDouyinTargetWithAi(
      messagesResult.messages,
      '私信',
      { brandName: task.accountName },
    );

    if (!firstMessage) {
      return this.handleNoPlatformTarget(
        task,
        runtime,
        '视频号',
        '私信',
        messagesResult,
      );
    }

    const replyText = firstMessage.replyText;
    runtime.setTaskStep(
      task,
      'target-read',
      'completed',
      `AI 已识别视频号私信：${firstMessage.item.text}`,
    );
    runtime.setTaskStep(
      task,
      'reply-generate',
      'completed',
      this.replyGeneratedStepMessage(
        firstMessage.generatedBy,
        '真实视频号私信内容',
      ),
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      task.sendMode === 'auto-send' ? 'skipped' : 'running',
      task.sendMode === 'auto-send'
        ? '自动发送模式跳过人工确认，准备执行真实发送。'
        : '已生成视频号私信回复，等待人工确认；暂不执行真实发送。',
    );
    runtime.pushEvent(
      task,
      'success',
      `AI 已识别视频号私信：${firstMessage.item.text}`,
      {
        ...(this.normalizeEngineEvidence(
          messagesResult.evidence,
          '视频号私信来源',
        ) || {
          type: 'page_snapshot' as const,
          label: '视频号私信来源',
          value: messagesResult.url,
        }),
      },
    );
    runtime.pushEvent(
      task,
      task.sendMode === 'auto-send' ? 'info' : 'warning',
      `${task.sendMode === 'auto-send' ? '自动发送视频号私信回复' : '待确认视频号私信回复'}：${replyText}`,
      {
        type: 'text',
        label: this.replyGeneratedEvidenceLabel(firstMessage.generatedBy),
        value: replyText,
      },
    );
    return {
      state: 'preflight_only',
      targetText: firstMessage.item.text,
      replyText,
      replyGeneratedBy: firstMessage.generatedBy,
      readyForApproval: task.sendMode !== 'auto-send',
      nextAction:
        task.sendMode === 'auto-send'
          ? '已读取真实视频号私信并生成回复；系统将继续调用真实发送执行器。'
          : '已读取真实视频号私信并生成草稿；确认后只填入草稿，不会自动点击发送。',
    };
  }

  private pickReadableTarget<T extends DouyinReadableItem>(items: T[]) {
    return items.find((item) => {
      const text = item.text?.trim();
      return (
        Boolean(text) &&
        item.handled !== true &&
        item.skipped !== true &&
        this.isCustomerInteractionText(text)
      );
    });
  }

  private async selectDouyinTargetWithAi<T extends DouyinReadableItem>(
    items: T[],
    targetLabel: '评论' | '私信',
    config: { brandName?: string },
  ): Promise<AiSelectedDouyinTarget<T> | null> {
    const candidates = items
      .map((item, index) => ({
        item,
        index,
        text: item.text?.replace(/\s+/g, ' ').trim() || '',
      }))
      .filter(
        ({ item, text }) =>
          text &&
          item.handled !== true &&
          item.skipped !== true &&
          this.isCustomerInteractionText(text),
      );

    if (!candidates.length) {
      return null;
    }

    try {
      const defaults = await this.defaultModels.getDefaults();
      const modelId = defaults.articleCreation || defaults.topicSelection;
      if (!modelId) {
        throw new Error('AI 模型未配置');
      }

      const systemPrompt = [
        '你是抖音商家后台客户互动助手。',
        `当前对象类型：${targetLabel}`,
        `品牌/账号：${config.brandName || '未指定'}`,
        '你的任务：从候选文本里选择最像真实客户留言、真实客户评论或真实客户私信的一条，并生成可直接发送的中文回复。',
        '不要选择导航、按钮、作品标题、发布时间、系统通知、满意度弹窗、空状态提示、平台公告。',
        '如果没有真实客户内容，返回 shouldReply=false。',
        '先判断客户场景：售前咨询、售后问题、退款、差评/投诉、催付/购买、升级人工、普通闲聊。',
        '售前要围绕客户问的商品、地址、时间、价格或入口给一个具体下一步；信息不够时只问一个关键问题。',
        '售后、退款、差评和投诉只能安抚、要订单/照片/具体问题并说明按平台流程核实，不承诺赔付、退款、疗效、最低价或结果。',
        '禁止套话：收到留言、专人跟进、马上安排、马上帮您安排、给您合适方案、亲亲、亲、亲爱的、感谢咨询、欢迎了解、方便留个联系方式、留下联系方式。',
        '回复必须贴合对方内容，不编造价格、库存、优惠、承诺、疗效或无法确认的信息。',
        '回复控制在 12-70 个中文字符，像真人商家即时回复，只输出要发送的话。',
        '只输出 JSON，不要解释。格式：{"shouldReply":true,"index":0,"replyText":"...","intent":"pre_sale","riskLevel":"low","reason":"..."}',
      ].join('\n');

      const userPrompt = candidates
        .map(({ index, text }) => `[${index}] ${text}`)
        .join('\n');

      const raw = await this.aiClient.generate(
        modelId,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `候选文本：\n${userPrompt}` },
        ],
        { temperature: 0.2, maxTokens: 500 },
      );

      const parsed = this.parseAiJson(raw);
      const selectedIndex = Number(parsed?.index);
      const selected = candidates.find(
        (candidate) => candidate.index === selectedIndex,
      );
      const replyText =
        typeof parsed?.replyText === 'string'
          ? this.cleanGeneratedReply(parsed.replyText)
          : '';
      const shouldReply =
        parsed?.shouldReply === true || parsed?.shouldReply === 'true';

      if (shouldReply && selected && replyText) {
        const usedFallback =
          this.isLowQualityReply(replyText) ||
          this.isContextMismatchReply(selected.text, replyText);
        const safeReplyText = usedFallback
          ? this.buildServiceReply(selected.text)
          : replyText;
        return {
          item: selected.item,
          replyText: safeReplyText,
          generatedBy: usedFallback ? 'fallback' : 'ai',
          reason:
            typeof parsed?.reason === 'string' ? parsed.reason : undefined,
        };
      }
    } catch (error) {
      this.logger.warn(
        `AI target selection failed for Douyin ${targetLabel}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const fallbackTarget = this.pickReadableTarget(items);
    if (fallbackTarget?.text) {
      const generated = await this.generateAiReply(
        fallbackTarget.text,
        { brandName: config.brandName },
        DEFAULT_INTERACTION_REPLY_RULE,
      );
      return {
        item: fallbackTarget,
        replyText: generated.replyText,
        generatedBy: generated.generatedBy,
        reason:
          generated.generatedBy === 'ai'
            ? 'AI 选择接口未返回目标，已用规则锁定真实客户内容后生成回复。'
            : 'AI 不可用，已用保守客服话术回复。',
      };
    }

    return null;
  }

  private parseAiJson(raw: string): any {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  private isCustomerInteractionText(text?: string | null) {
    const normalized = text?.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    const platformPrompts = [
      /请打开抖音\s*app\s*查看/i,
      /你收到一条新类型消息/i,
      /当前版本暂不支持/i,
      /该消息类型暂不支持/i,
      /暂不支持查看/i,
      /新增「共创中心」模块/,
      /管理你的共创作品/,
      /加载中，请稍候/,
      /KAYPAL REAL PUB/i,
      /KAYPAL COMMERCIAL/i,
      /#kaypal|#commercial|#realtest/i,
      /发布于20\d{2}年/,
      /作品列表|共\d+个视频/,
      /抖音社区自律公约|账号授权协议|用户服务协议|隐私政策|账号找回|联系我们/,
      /京ICP|京B2|北京抖音科技有限公司|网络文化经营许可证|举报邮箱|举报中心/,
      /^(通知|网址|抖音|首页|高清发布|内容管理|作品管理|互动管理|评论管理|私信管理|弹幕管理|关注管理|粉丝管理|数据中心|变现中心|创作中心|在线客服|回复|删除|发送|我知道了|加载中|加载中，请稍候\.\.\.)$/,
      /^\d{1,2}:\d{2}$/,
      /^\d+\s*(分钟前|小时前|天前)$/,
      /^刚刚$/,
      /^\d+$/,
      /系统通知/,
      /官方通知/,
      /服务通知/,
    ];

    if (platformPrompts.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (
      /\d{1,2}:\d{2}.*(请打开抖音\s*app\s*查看|你收到一条新类型消息)/i.test(
        normalized,
      )
    ) {
      return false;
    }

    return true;
  }

  private handleNoDouyinTarget(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
    targetLabel: '评论' | '私信',
    result: DouyinReadResult,
  ): InteractionExecutorPreflightResult {
    if (result.summary?.blocked === true) {
      const reason =
        result.summary.emptyReason ||
        `抖音${targetLabel}页面未进入可读取状态。`;
      runtime.setTaskStep(task, 'target-read', 'blocked', reason);
      runtime.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        `未读取到${targetLabel}，不能生成回复。`,
      );
      runtime.setTaskStep(
        task,
        'send-approval',
        'blocked',
        `未生成${targetLabel}回复，不能进入发送。`,
      );
      runtime.pushEvent(task, 'error', reason, {
        type: 'page_snapshot',
        label: `${targetLabel}读取阻断`,
        value: result.pageTextSample || result.url,
      });

      return {
        state: 'executor_missing',
        terminalStatus: 'failed',
        failureReason: reason,
        nextAction:
          result.summary.nextAction ||
          `请打开抖音创作者后台${targetLabel}页确认列表能正常显示，再回到系统重试。`,
      };
    }

    const totalCandidates = result.summary?.totalCandidates ?? 0;
    const emptyReason = result.summary?.emptyReason?.trim();
    const reason =
      emptyReason ||
      (totalCandidates > 0
        ? `读取到 ${totalCandidates} 条${targetLabel}候选，但都为空、已处理或被规则跳过。`
        : `当前账号没有可处理${targetLabel}。`);

    runtime.setTaskStep(
      task,
      'target-read',
      'skipped',
      `AI 未识别到可回复的真实客户${targetLabel}。`,
    );
    runtime.setTaskStep(
      task,
      'reply-generate',
      'skipped',
      `无真实客户${targetLabel}对象，不生成回复。`,
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      'skipped',
      `无${targetLabel}对象，不进入发送确认。`,
    );
    runtime.pushEvent(
      task,
      'warning',
      `AI 未识别到可回复的真实客户${targetLabel}：${reason}`,
      {
        type: 'page_snapshot',
        label: `${targetLabel}读取结果`,
        value: result.pageTextSample || result.url,
      },
    );

    return {
      state: 'preflight_only',
      terminalStatus: 'no_target',
      failureReason: undefined,
      nextAction: `AI 已检查当前抖音后台，本次没有识别到需要回复的真实客户${targetLabel}；如确认页面有新${targetLabel}，请刷新抖音创作者后台后重试。`,
    };
  }

  private handleDouyinReadFailure(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
    targetLabel: '评论' | '私信',
    error: unknown,
  ): InteractionExecutorPreflightResult {
    const message = error instanceof Error ? error.message : 'unknown error';
    const loggedOut = /登录|login|unauthori[sz]ed|401|403|扫码/i.test(message);
    const failureReason = loggedOut
      ? `抖音${targetLabel}读取时疑似登录失效`
      : `抖音${targetLabel}读取失败：${message}`;

    runtime.setTaskStep(task, 'target-read', 'blocked', failureReason);
    runtime.setTaskStep(
      task,
      'reply-generate',
      'blocked',
      `未读取到${targetLabel}，不能生成回复。`,
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      'blocked',
      `未生成${targetLabel}回复，不能进入确认。`,
    );
    runtime.pushEvent(task, 'error', failureReason, {
      type: 'failure_reason',
      label: `${targetLabel}读取失败`,
      value: message,
    });

    return {
      state: 'executor_missing',
      terminalStatus: 'failed',
      failureReason,
      nextAction: loggedOut
        ? '请在本机浏览器重新登录抖音账号，再回到任务中重试。'
        : '请检查 发布服务日志、浏览器页面和抖音后台结构后重试。',
    };
  }

  private handleNoPlatformTarget(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
    platformName: string,
    targetLabel: '评论' | '私信',
    result: DouyinReadResult,
  ): InteractionExecutorPreflightResult {
    const totalCandidates = result.summary?.totalCandidates ?? 0;
    const emptyReason = result.summary?.emptyReason?.trim();
    const reason =
      emptyReason ||
      (totalCandidates > 0
        ? `读取到 ${totalCandidates} 条${targetLabel}候选，但 AI 未识别到真实客户内容。`
        : `当前账号没有可处理${targetLabel}。`);

    runtime.setTaskStep(
      task,
      'target-read',
      'skipped',
      `AI 未识别到可回复的真实客户${platformName}${targetLabel}。`,
    );
    runtime.setTaskStep(
      task,
      'reply-generate',
      'skipped',
      `无真实客户${targetLabel}对象，不生成回复。`,
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      'skipped',
      `无${targetLabel}对象，不进入发送确认。`,
    );
    runtime.pushEvent(
      task,
      'warning',
      `AI 未识别到可回复的真实客户${platformName}${targetLabel}：${reason}`,
      {
        type: 'page_snapshot',
        label: `${platformName}${targetLabel}读取结果`,
        value: result.pageTextSample || result.url,
      },
    );

    return {
      state: 'preflight_only',
      terminalStatus: 'no_target',
      failureReason: undefined,
      nextAction: `AI 已检查当前${platformName}后台，本次没有识别到需要回复的真实客户${targetLabel}；如确认页面有新${targetLabel}，请刷新${platformName}后台后重试。`,
    };
  }

  private handlePlatformReadFailure(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
    platformName: string,
    targetLabel: '评论' | '私信',
    error: unknown,
  ): InteractionExecutorPreflightResult {
    const message = error instanceof Error ? error.message : 'unknown error';
    const loggedOut =
      /登录|login|unauthori[sz]ed|401|403|扫码|账号|cookie/i.test(message);
    const failureReason = loggedOut
      ? `${platformName}${targetLabel}读取时疑似登录失效`
      : `${platformName}${targetLabel}读取失败：${message}`;

    runtime.setTaskStep(task, 'target-read', 'blocked', failureReason);
    runtime.setTaskStep(
      task,
      'reply-generate',
      'blocked',
      `未读取到${targetLabel}，不能生成回复。`,
    );
    runtime.setTaskStep(
      task,
      'send-approval',
      'blocked',
      `未生成${targetLabel}回复，不能进入确认。`,
    );
    runtime.pushEvent(task, 'error', failureReason, {
      type: 'failure_reason',
      label: `${platformName}${targetLabel}读取失败`,
      value: message,
    });

    return {
      state: 'executor_missing',
      terminalStatus: 'failed',
      failureReason,
      nextAction: loggedOut
        ? `请在本机浏览器重新登录${platformName}账号，再回到系统重试。`
        : `请检查 ${platformName} 后台页面、本地发布服务日志后重试。`,
    };
  }

  private handlePlatformDraftFailure(
    platformName: string,
    targetLabel: '评论' | '私信',
    error: unknown,
  ): InteractionExecutorDraftResult {
    const message = error instanceof Error ? error.message : 'unknown error';
    const loggedOut =
      /登录|login|unauthori[sz]ed|401|403|扫码|账号|cookie/i.test(message);
    return {
      ok: false,
      status: targetLabel === '评论' ? 'comment_missing' : 'message_missing',
      message: loggedOut
        ? `${platformName}${targetLabel}草稿填入时疑似登录态失效`
        : `${platformName}${targetLabel}草稿填入失败：${message}`,
      evidence: {
        type: 'failure_reason',
        label: `${platformName}${targetLabel}草稿填入失败`,
        value: message,
      },
      nextAction: loggedOut
        ? `请在本机浏览器重新登录${platformName}账号，再回到任务中重试草稿填入。`
        : `请检查 ${platformName} 后台页面、输入框状态和发布服务日志后重试。`,
    };
  }

  private handlePlatformSendFailure(
    platformName: string,
    targetLabel: '评论' | '私信',
    error: unknown,
  ): InteractionExecutorDraftResult {
    const message = error instanceof Error ? error.message : 'unknown error';
    const loggedOut =
      /登录|login|unauthori[sz]ed|401|403|扫码|账号|cookie/i.test(message);
    const missingEndpoint =
      /404|not found|Cannot POST|未接入|unsupported/i.test(message);
    return {
      ok: false,
      status: 'send_failed',
      message: loggedOut
        ? `${platformName}${targetLabel}自动发送时疑似登录态失效`
        : missingEndpoint
          ? `${platformName}${targetLabel}自动发送能力未接入：${message}`
          : `${platformName}${targetLabel}自动发送失败：${message}`,
      evidence: {
        type: 'failure_reason',
        label: `${platformName}${targetLabel}自动发送失败`,
        value: message,
      },
      nextAction: loggedOut
        ? `请在本机浏览器重新登录${platformName}账号，再回到任务中重试自动发送。`
        : missingEndpoint
          ? '请先升级本地发布服务，接入真实发送按钮点击、回读和失败识别接口。'
          : `请检查发布服务日志、浏览器页面和${platformName}发送按钮状态后重试。`,
    };
  }

  private handleDouyinDraftFailure(
    targetLabel: '评论' | '私信',
    error: unknown,
  ): InteractionExecutorDraftResult {
    const message = error instanceof Error ? error.message : 'unknown error';
    const loggedOut =
      /登录|login|unauthori[sz]ed|401|403|扫码|账号|cookie/i.test(message);
    const failureReason = loggedOut
      ? `抖音${targetLabel}草稿填入时疑似登录态失效`
      : `抖音${targetLabel}草稿填入失败：${message}`;

    return {
      ok: false,
      status: targetLabel === '评论' ? 'comment_missing' : 'message_missing',
      message: failureReason,
      evidence: {
        type: 'failure_reason',
        label: `${targetLabel}草稿填入失败`,
        value: message,
      },
      nextAction: loggedOut
        ? '请在本机浏览器重新登录抖音账号，再回到任务中重试草稿填入。'
        : '请检查 发布服务日志、浏览器页面和抖音输入框状态后重试。',
    };
  }

  private handleDouyinSendFailure(
    targetLabel: '评论' | '私信',
    error: unknown,
  ): InteractionExecutorDraftResult {
    const message = error instanceof Error ? error.message : 'unknown error';
    const loggedOut =
      /登录|login|unauthori[sz]ed|401|403|扫码|账号|cookie/i.test(message);
    const missingEndpoint =
      /404|not found|Cannot POST|未接入|unsupported/i.test(message);
    const failureReason = loggedOut
      ? `抖音${targetLabel}自动发送时疑似登录态失效`
      : missingEndpoint
        ? `抖音${targetLabel}自动发送能力未接入：${message}`
        : `抖音${targetLabel}自动发送失败：${message}`;

    return {
      ok: false,
      status: 'send_failed',
      message: failureReason,
      evidence: {
        type: 'failure_reason',
        label: `${targetLabel}自动发送失败`,
        value: message,
      },
      nextAction: loggedOut
        ? '请在本机浏览器重新登录抖音账号，再回到任务中重试自动发送。'
        : missingEndpoint
          ? '请先升级本地发布服务，接入真实发送按钮点击、回读和失败识别接口。'
          : '请检查发布服务日志、浏览器页面和抖音发送按钮状态后重试。',
    };
  }

  private async openInteractionEntry(
    task: InteractionTask,
    entryType: InteractionTaskType,
  ) {
    if (!task.accountId) {
      throw new Error('缺少本地账号 ID');
    }

    return this.autoUploadService.openInteractionEntry({
      accountId: Number(task.accountId),
      entryType,
    });
  }

  private async readInteractionCapabilities(): Promise<AutoUploadInteractionCapabilities | null> {
    try {
      return await this.autoUploadService.getInteractionCapabilities();
    } catch {
      return null;
    }
  }

  private async readCapabilityMatrix() {
    const capabilities = await this.readInteractionCapabilities();
    return this.mapSupportedTaskTypes(capabilities);
  }

  private mapSupportedTaskTypes(
    capabilities: AutoUploadInteractionCapabilities | null,
  ) {
    const matrix = new Map<
      InteractionTaskType,
      AutoUploadInteractionCapabilities['supportedTaskTypes'][number]
    >();
    for (const taskType of capabilities?.supportedTaskTypes || []) {
      if (this.isSupportedInteractionTaskType(taskType.key)) {
        matrix.set(taskType.key, taskType);
      }
    }
    return matrix;
  }

  private async resolveTaskCapability(task: InteractionTask): Promise<{
    ok: boolean;
    failureReason: string;
    nextAction: string;
    diagnostic: string;
  }> {
    try {
      const matrix = this.mapSupportedTaskTypes(
        await this.autoUploadService.getInteractionCapabilities(),
      );
      const capability = this.resolveDeclaredCapability(matrix, task.type);
      if (!capability) {
        return {
          ok: false,
          failureReason: `${task.typeLabel}未在 发布服务互动能力清单中声明，任务已阻断。`,
          nextAction:
            '请升级或重启 本地发布服务，并确认 /interaction/capabilities 包含该任务类型。',
          diagnostic: `${task.type} missing from /interaction/capabilities`,
        };
      }

      const stages = capability.stages || [];
      const missing = this.missingRequiredStagesForTask(task.type, stages);
      if (missing.length) {
        return {
          ok: false,
          failureReason: `${task.typeLabel}缺少真实执行阶段：${missing.join('、')}，任务已阻断。`,
          nextAction: '请补齐 发布服务对应读取/草稿填入接口后再重试。',
          diagnostic: `${task.type} missing stages: ${missing.join(',')}`,
        };
      }

      return {
        ok: true,
        failureReason: '',
        nextAction: '',
        diagnostic: `${task.type} stages=${stages.join(',')}`,
      };
    } catch (error) {
      return {
        ok: false,
        failureReason: `发布服务互动能力检查失败：${error instanceof Error ? error.message : 'unknown error'}`,
        nextAction:
          '请先启动 本地发布服务，确认 /interaction/capabilities 可访问后重试。',
        diagnostic: 'capability endpoint unavailable',
      };
    }
  }

  private async resolveSendCapability(
    task: InteractionTask,
    stage: 'draft-fill' | 'auto-send',
  ): Promise<{
    ok: boolean;
    failureReason: string;
    nextAction: string;
    diagnostic: string;
  }> {
    try {
      const matrix = this.mapSupportedTaskTypes(
        await this.autoUploadService.getInteractionCapabilities(),
      );
      const capability = this.resolveDeclaredCapability(matrix, task.type);
      const stages = capability?.stages || [];
      const ok =
        stage === 'auto-send'
          ? stages.includes('auto-send') || capability?.autoSend === true
          : this.hasTaskStage(stages, 'draft-fill') ||
            capability?.controlledSend === true;
      if (ok) {
        return {
          ok: true,
          failureReason: '',
          nextAction: '',
          diagnostic: `${task.type} sendStage=${stage} stages=${stages.join(',')}`,
        };
      }
      return {
        ok: false,
        failureReason: `${task.typeLabel}缺少真实执行阶段：${stage}，任务已阻断。`,
        nextAction:
          stage === 'auto-send'
            ? '请补齐真实自动发送能力，或切到确认后发送。'
            : '请补齐 发布服务 的草稿填入能力后重试。',
        diagnostic: `${task.type} missing send stage: ${stage}; stages=${stages.join(',')}`,
      };
    } catch (error) {
      return {
        ok: false,
        failureReason: `发送能力检查失败：${error instanceof Error ? error.message : 'unknown error'}`,
        nextAction: '请确认 发布服务互动能力清单可读取后重试。',
        diagnostic: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  private async getWechatDesktopPreflight(): Promise<WechatDesktopPreflightInternal> {
    // Kaypal Runtime 只能证明桌面控制桥存在，不能替代窗口/截图/输入/点击的目标 preflight。
    const kaypalCapability = await this.checkKaypalLocalController();

    try {
      const status = await this.autoUploadService.getWechatDesktopStatus();
      return this.evaluateWechatDesktopPreflight(status);
    } catch {
      if (kaypalCapability.available) {
        return {
          readyForDraft: false,
          message:
            'Kaypal Runtime local-controller 已就绪，但缺少桌面微信窗口、截图、输入和点击 preflight。',
          nextAction:
            '请打开桌面微信目标会话，并确认本机窗口、截图、输入和点击能力可检测后重试。',
          blockers: ['桌面微信目标 preflight 未完成'],
        };
      }
      return {
        readyForDraft: false,
        message:
          '桌面控制能力不可用：Kaypal Runtime local-controller 未就绪，5409 引擎本地检查也失败。',
        nextAction:
          '请确保 Kaypal Runtime (8001) 已启动并配置 local-controller，或启动 5409 引擎并授予辅助功能权限。',
        blockers: ['桌面控制能力不可用'],
      };
    }
  }

  private async checkKaypalLocalController(): Promise<{
    available: boolean;
    capabilities: string[];
  }> {
    try {
      const response = await fetch('http://localhost:8001/healthz', {
        headers: {
          'x-kaypal-runtime-token':
            process.env.KAYPAL_RUNTIME_SHARED_SECRET || '',
        },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        this.logger.warn(`Kaypal Runtime healthz returned ${response.status}`);
        return { available: false, capabilities: [] };
      }
      const data = await response.json();
      const configured =
        data.deerflowLocalControllerToolConfigured === true ||
        data.deerflowLocalControllerToolConfigured === 'true';
      const bridgeConfigured =
        data.deerflowLocalControllerBridgeConfigured === true ||
        data.deerflowLocalControllerBridgeConfigured === 'true';
      const capabilities = (
        data.localControllerRuntimeAppControlCapabilities || ''
      )
        .split(',')
        .filter(Boolean);
      this.logger.log(
        `Kaypal local-controller: configured=${configured}, bridgeConfigured=${bridgeConfigured}, capabilities=${capabilities.length}`,
      );
      return {
        available: configured || bridgeConfigured,
        capabilities,
      };
    } catch (error) {
      this.logger.warn(
        `Kaypal Runtime healthz failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { available: false, capabilities: [] };
    }
  }

  private async checkAgentSStatus(): Promise<{
    available: boolean;
    message: string;
    nextAction: string;
  }> {
    try {
      const response = await fetch('http://localhost:8001/healthz', {
        headers: {
          'x-kaypal-runtime-token':
            process.env.KAYPAL_RUNTIME_SHARED_SECRET || '',
        },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        return {
          available: false,
          message: `Kaypal Runtime 返回 ${response.status}`,
          nextAction: '请检查 Kaypal Runtime (8001) 是否正常运行',
        };
      }
      const data = await response.json();
      const engineMode = data.engineMode || 'unknown';
      const engineReady = data.engineSelectionStatus === 'ready';
      const deerflowReady =
        data.deerflowConfigured === 'true' &&
        data.deerflowImportable === 'true';
      const mockReady = data.mockEngineAvailable === 'true';

      const available = engineReady && (deerflowReady || mockReady);

      if (available) {
        this.logger.log(
          `Agent-S: engine=${engineMode}, deerflow=${deerflowReady}, mock=${mockReady}`,
        );
        return {
          available: true,
          message: `Agent-S 执行引擎就绪 (模式: ${engineMode})`,
          nextAction: '',
        };
      } else {
        const reason = !engineReady
          ? '引擎选择状态未就绪'
          : !deerflowReady && !mockReady
            ? 'deerflow 和 mock 引擎均不可用'
            : '未知原因';
        this.logger.warn(
          `Agent-S: engine=${engineMode}, ready=${engineReady}, deerflow=${deerflowReady}, mock=${mockReady}, reason=${reason}`,
        );
        return {
          available: false,
          message: `Agent-S 执行引擎不可用: ${reason}`,
          nextAction:
            '请检查 Kaypal Runtime 的引擎配置，确保 deerflow 或 mock 引擎可用',
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Agent-S health check failed: ${message}`);
      return {
        available: false,
        message: `Agent-S 健康检查失败: ${message}`,
        nextAction: '请检查 Kaypal Runtime (8001) 是否可访问',
      };
    }
  }

  private evaluateWechatDesktopPreflight(desktop: {
    available?: boolean;
    running?: boolean;
    appName?: string | null;
    windowCount?: number;
    currentWindowTitle?: string | null;
    windowTitle?: string | null;
    windowTitles?: string[];
    frontmost?: boolean;
    permissionHints?: string[];
    screenshotAvailable?: boolean;
    inputControlAvailable?: boolean;
    clickControlAvailable?: boolean;
    fileSelectionAvailable?: boolean;
    message?: string;
  }): WechatDesktopPreflightInternal {
    const hints = desktop.permissionHints || [];
    const windowTitles = [
      ...(Array.isArray(desktop.windowTitles) ? desktop.windowTitles : []),
      desktop.currentWindowTitle,
      desktop.windowTitle,
    ]
      .map((value) => value?.trim())
      .filter(Boolean) as string[];
    const currentWindowTitle =
      desktop.currentWindowTitle ||
      desktop.windowTitle ||
      windowTitles[0] ||
      null;
    const available = desktop.available === true && desktop.running === true;
    const frontmost = desktop.frontmost !== false;
    const windowCount = desktop.windowCount || 0;
    const permissionHintText = hints.join('；');
    const hasPermissionHint =
      /权限|辅助|屏幕|录制|输入|点击|accessibility|screen|input|click/i.test(
        permissionHintText,
      );
    const screenshotOk = desktop.screenshotAvailable === true;
    const inputOk = desktop.inputControlAvailable === true;
    const clickOk = desktop.clickControlAvailable === true;
    const fileSelectionOk = desktop.fileSelectionAvailable === true;
    const titleAmbiguous =
      !currentWindowTitle ||
      /搜索|通讯录|微信|WeChat$/i.test(currentWindowTitle);
    const blockers = [
      !desktop.running ? '桌面微信未运行' : '',
      !available ? desktop.message || '桌面微信不可用' : '',
      !frontmost ? '桌面微信不是前台 App' : '',
      windowCount !== 1 ? `微信窗口数量不是 1：${windowCount}` : '',
      titleAmbiguous ? '当前微信窗口标题无法确认是目标会话' : '',
      hasPermissionHint ? `权限提示：${permissionHintText}` : '',
      !screenshotOk ? '截图能力不可用' : '',
      !inputOk ? '输入/粘贴能力不可用' : '',
      !clickOk ? '点击/聚焦能力不可用' : '',
      !fileSelectionOk ? '文件选择能力不可用' : '',
    ].filter(Boolean);

    return {
      readyForDraft: blockers.length === 0,
      currentWindowTitle,
      blockers,
      message: blockers.length
        ? `桌面微信 preflight 未通过：${blockers.join('；')}`
        : desktop.message ||
          '桌面微信 preflight 通过，可在人工确认后填入草稿。',
      nextAction: blockers.length
        ? '请打开桌面微信目标会话，授予辅助功能/屏幕录制权限，并确保只有一个目标微信窗口在前台。'
        : '确认目标会话无误后点击确认，系统只粘贴草稿，不会点击发送。',
    };
  }

  private buildServiceReply(commentText: string) {
    const normalized = commentText.replace(/\s+/g, ' ').trim();
    const intent = this.detectCustomerServiceIntent(normalized);

    if (intent === 'location') {
      return '你想找门店地址还是商品入口？我按你要的给你发。';
    }
    if (intent === 'purchase') {
      return '可以，你想看哪一款？把名称或截图发我，我帮你对应到具体入口。';
    }
    if (intent === 'price') {
      return '价格要看具体款式和需求，你把想看的那款发我，我按实际情况帮你核一下。';
    }
    if (intent === 'appointment') {
      return '可以约，你把大概时间和要办的事发我，我先帮你看下能不能排上。';
    }
    if (intent === 'after_sale') {
      return '先别急，你把订单号和问题照片发我，我核实后按平台售后流程处理。';
    }
    if (intent === 'bad_review') {
      return '抱歉让你体验不好了。你把具体问题和订单信息发我，我先核实处理。';
    }
    if (intent === 'contact') {
      return '可以，你直接私信发具体需求就行，我先看内容，再告诉你下一步怎么处理。';
    }
    if (intent === 'thanks') {
      return '不客气，有具体问题直接发我就行。';
    }
    return '你说的是哪一款或哪件事？把具体内容发我，我按实际情况帮你看。';
  }

  private detectCustomerServiceIntent(text: string): CustomerServiceIntent {
    if (
      /退款|退货|售后|坏了|破损|发错|没收到|少发|漏发|质量|订单|物流|快递|发票/.test(
        text,
      )
    ) {
      return 'after_sale';
    }
    if (
      /投诉|差评|不满意|垃圾|骗子|曝光|举报|拉黑|太差|生气|坑人|维权/.test(text)
    ) {
      return 'bad_review';
    }
    if (/价格|多少钱|收费|费用|报价|贵不贵|怎么卖|几块|多少米/.test(text)) {
      return 'price';
    }
    if (
      /预约|预定|时间|几点|营业|排期|今天|明天|后天|周末|上门|到店/.test(text)
    ) {
      return 'appointment';
    }
    if (
      /怎么买|购买|下单|链接|入口|橱窗|商品|有吗|还有吗|库存|现货/.test(text)
    ) {
      return 'purchase';
    }
    if (/在哪|哪里|地址|位置|怎么去|导航|门店/.test(text)) {
      return 'location';
    }
    if (/电话|联系|微信|私信|加我|客服|人工/.test(text)) {
      return 'contact';
    }
    if (/谢谢|感谢|好的|好嘞|ok|OK|收到|明白/.test(text)) {
      return 'thanks';
    }
    return 'other';
  }

  private cleanGeneratedReply(raw: string) {
    const parsed = this.parseAiJson(raw);
    const maybeJsonReply =
      typeof parsed?.replyText === 'string' ? parsed.replyText : raw;
    return maybeJsonReply
      .replace(/```[\s\S]*?```/g, (block) =>
        block.replace(/```(?:json)?|```/gi, ''),
      )
      .replace(/^(回复|客服回复|发送内容|话术)[:：]\s*/i, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/^(亲亲|亲爱的|亲)[，,、\s]*/g, '')
      .replace(/[~～]+$/g, '')
      .replace(/尊敬的客户[，,、\s]*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
  }

  private isLowQualityReply(replyText: string) {
    return /收到(您的)?(留言|咨询)|专人跟进|马上(帮您)?安排|给您合适方案|感谢咨询|欢迎了解|亲亲|亲爱的|^亲[，,、\s]|尊敬的客户|方便留个联系方式|留下联系方式|留个联系方式|私信我们吗|[~～]/.test(
      replyText,
    );
  }

  private isContextMismatchReply(sourceText: string, replyText: string) {
    const intent = this.detectCustomerServiceIntent(
      sourceText.replace(/\s+/g, ' ').trim(),
    );
    if (
      intent === 'price' &&
      /订单号|订单信息|售后|破损|退款/.test(replyText)
    ) {
      return true;
    }
    if (
      intent === 'purchase' &&
      /直达链接|发(个|一下)?链接|链接给您|已经发|店铺首页就能下单/.test(
        replyText,
      )
    ) {
      return true;
    }
    if (
      !/电话|联系|微信|私信|加我|客服|人工/.test(sourceText) &&
      /联系方式|电话|微信号|加微信/.test(replyText)
    ) {
      return true;
    }
    return false;
  }

  private resolvePromptClosingText(closingText?: string | null) {
    const cleaned = this.cleanGeneratedReply(closingText || '');
    if (
      !cleaned ||
      this.isLowQualityReply(cleaned) ||
      /留下联系方式|马上帮您安排|方便留个联系方式|私信我们吗/.test(cleaned)
    ) {
      return DEFAULT_INTERACTION_REPLY_RULE.closingText;
    }
    return cleaned;
  }

  async generateAiReply(
    sourceText: string,
    config: { brandName?: string },
    rule: InteractionReplyRuleConfig,
  ): Promise<{ replyText: string; generatedBy: 'ai' | 'fallback' }> {
    try {
      const defaults = await this.defaultModels.getDefaults();
      const modelId = defaults.articleCreation || defaults.topicSelection;
      if (!modelId) {
        return {
          replyText: this.buildServiceReply(sourceText),
          generatedBy: 'fallback',
        };
      }

      const forbiddenWords = rule.blockedKeywords.join(', ');
      const closingText = this.resolvePromptClosingText(rule.closingText);
      const systemPrompt = [
        '你是商用客户互动客服助手，参考客服话术库的售前、售后、退款、差评、升级人工流程。',
        `行业：${rule.industryName}`,
        `语气：${rule.tone === 'concise' ? '简洁' : rule.tone === 'professional' ? '专业' : '自然亲切'}`,
        `收尾目标：${closingText}`,
        `禁止词：${forbiddenWords || '无'}`,
        `品牌/账号：${config.brandName || '未指定'}`,
        '先判断客户场景：售前咨询、售后问题、退款、差评/投诉、催付/购买、升级人工、普通闲聊。',
        '普通咨询要直接回应对方问的点；信息不够时只问一个最关键的问题。',
        '售后、退款、差评和投诉只能安抚、索取订单/照片/具体问题并说明按平台流程核实，不承诺退款、赔付、疗效、最低价或结果。',
        '不要说：收到留言、专人跟进、马上安排、马上帮您安排、给您合适方案、亲亲、亲、亲爱的、感谢咨询、欢迎了解、方便留个联系方式、留下联系方式，也不要用波浪线。',
        '不要答非所问，不要编造价格、库存、优惠、承诺、疗效或无法确认的信息。',
        '回复长度控制在 12-70 个中文字符，像真人商家即时回复，只输出要发送给客户的一句话或两句话。',
      ].join('\n');

      const userPrompt = `客户原话：${sourceText}`;

      const replyText = await this.aiClient.generate(
        modelId,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.7, maxTokens: 500 },
      );

      if (this.isLowQualityReply(String(replyText || ''))) {
        return {
          replyText: this.buildServiceReply(sourceText),
          generatedBy: 'fallback',
        };
      }
      const cleaned = this.cleanGeneratedReply(replyText || '');
      if (
        !cleaned ||
        this.isLowQualityReply(cleaned) ||
        this.isContextMismatchReply(sourceText, cleaned)
      ) {
        return {
          replyText: this.buildServiceReply(sourceText),
          generatedBy: 'fallback',
        };
      }

      return { replyText: cleaned, generatedBy: 'ai' };
    } catch (error) {
      this.logger.warn(
        `AI reply generation failed, falling back to rule-based reply: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return {
        replyText: this.buildServiceReply(sourceText),
        generatedBy: 'fallback',
      };
    }
  }

  private buildEntryProbeMessage(result: {
    entryName: string;
    title?: string | null;
    loggedIn?: boolean | null;
    url: string;
  }) {
    const loginText =
      result.loggedIn === false
        ? '疑似未登录'
        : result.loggedIn === true
          ? '登录态可用'
          : '登录态未确认';
    return `${result.entryName}预检结果：${loginText}，页面标题：${result.title || '未读取到标题'}。`;
  }

  private replyGeneratedStepMessage(
    generatedBy: 'ai' | 'fallback' | undefined,
    targetLabel: string,
  ) {
    return generatedBy === 'fallback'
      ? `规则兜底已按${targetLabel}生成保守回复，不能算 AI 生成闭环。`
      : `AI 已按${targetLabel}生成回复。`;
  }

  private replyGeneratedEvidenceLabel(
    generatedBy: 'ai' | 'fallback' | undefined,
  ) {
    return generatedBy === 'fallback' ? '规则兜底回复' : 'AI 识别并生成回复';
  }

  private normalizeEngineEvidence(
    evidence: AutoUploadInteractionEvidence | null | undefined,
    fallbackLabel: string,
  ): InteractionTaskEvent['evidence'] | undefined {
    if (!evidence?.value) {
      return undefined;
    }

    const type =
      evidence.type === 'screenshot'
        ? 'screenshot'
        : evidence.type === 'snapshot'
          ? 'page_snapshot'
          : evidence.type === 'text'
            ? 'text'
            : 'text';

    return {
      type,
      label: evidence.label || fallbackLabel,
      value: evidence.value,
    };
  }

  private verifyBrowserAutoSend(
    result: AutoSendVerificationInput,
    targetLabel: string,
  ): AutoSendVerificationResult {
    return this.verifyAutoSendResult(result, targetLabel, {
      requirePersistentBrowser: true,
      fallbackNextAction: `请检查${targetLabel}后台是否拦截发送，或切到确认后发送人工处理。`,
    });
  }

  private verifyDesktopAutoSend(
    result: AutoSendVerificationInput,
    targetLabel: string,
  ): AutoSendVerificationResult {
    return this.verifyAutoSendResult(result, targetLabel, {
      requirePersistentBrowser: false,
      fallbackNextAction:
        '微信没有完成真实发送，请确认目标会话、草稿内容和桌面权限后重试。',
    });
  }

  private verifyAutoSendResult(
    result: AutoSendVerificationInput,
    targetLabel: string,
    options: {
      requirePersistentBrowser: boolean;
      fallbackNextAction: string;
    },
  ): AutoSendVerificationResult {
    const sentSignal = result.status === 'sent' && result.sent === true;
    const reasons: string[] = [];

    if (!sentSignal) {
      reasons.push('发送接口未同时返回 status=sent 和 sent=true');
    }

    if (
      options.requirePersistentBrowser &&
      result.runtimeMode !== 'persistent-cdp-browser'
    ) {
      reasons.push('发送结果缺少 persistent-cdp-browser 运行模式证明');
    }

    const readbackText =
      typeof result.readbackText === 'string' ? result.readbackText.trim() : '';
    const replyText =
      typeof result.replyText === 'string' ? result.replyText.trim() : '';
    if (!replyText) {
      reasons.push('发送结果缺少本次回复文本，不能校验回读是否对应本次任务');
    }
    const hasReadback = readbackText.length > 0;
    const readbackMatchesReply =
      hasReadback &&
      replyText.length > 0 &&
      (readbackText.includes(replyText) || replyText.includes(readbackText));
    const editorCleared = result.editorCleared === true;
    const replyVisible = result.replyVisible === true;
    const hasCommercialReadbackProof = readbackMatchesReply;

    if (!hasCommercialReadbackProof) {
      reasons.push(`${targetLabel}发送后缺少可匹配本次回复内容的页面回读证明`);
    } else if (hasReadback && !readbackMatchesReply) {
      reasons.push(`${targetLabel}发送后回读内容和本次回复不匹配`);
    }

    return {
      ok: sentSignal && reasons.length === 0,
      sentSignal,
      reasons,
      nextAction:
        result.nextAction?.trim() ||
        (editorCleared && !hasCommercialReadbackProof
          ? `请补齐${targetLabel}发送后的本次回复文本回读；输入框清空只能作为辅助信号。`
          : replyVisible && !hasCommercialReadbackProof
            ? `请补齐${targetLabel}发送后的本次回复文本回读；replyVisible 只能作为辅助信号。`
            : hasCommercialReadbackProof
              ? options.fallbackNextAction
              : `请补齐${targetLabel}发送后的本次回复文本回读，再重试自动发送。`),
    };
  }

  private async runCdpCommercialPreflight(
    task: InteractionTask,
    runtime: InteractionTaskRuntimePort,
    platform: 'douyin' | 'wechat-channel',
    label: string,
  ): Promise<CdpCommercialPreflightResult> {
    const accountId = Number(task.accountId);
    const blockers: string[] = [];

    if (!Number.isInteger(accountId) || accountId <= 0) {
      blockers.push(`${label}缺少有效平台账号`);
    }

    let cdpHealthMessage = '';
    if (Number.isInteger(accountId) && accountId > 0) {
      try {
        const cdpSessions = await this.autoUploadService.getCdpSessions();
        cdpHealthMessage = cdpSessions.message || '';
        const matchingSession = cdpSessions.sessions.find(
          (session) =>
            session.platform === platform &&
            String(session.accountId) === String(accountId),
        );

        if (!cdpSessions.available) {
          blockers.push(
            cdpHealthMessage || 'CDP 会话接口不可用或没有在线浏览器会话',
          );
        }
        if (!matchingSession) {
          blockers.push(`${label}没有匹配当前账号的 CDP 会话`);
        } else if (matchingSession.status !== 'ready') {
          blockers.push(
            `${label}CDP 会话未 ready：${matchingSession.status || 'unknown'}${matchingSession.lastError ? `，${matchingSession.lastError}` : ''}`,
          );
        }
      } catch (error) {
        blockers.push(
          `CDP/互动能力预检失败：${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }

      try {
        const accounts = await this.autoUploadService.listAccounts({
          validate: true,
          force: false,
          ids: [accountId],
        });
        const account = accounts.find((item) => Number(item.id) === accountId);
        if (!account) {
          blockers.push(`${label}账号不存在或本地发布服务没有返回该账号`);
        } else if (account.status !== 1) {
          blockers.push(
            `${label}账号未登录或登录态已过期：${account.statusLabel || `status=${account.status}`}`,
          );
        }
      } catch (error) {
        blockers.push(
          `${label}账号登录态校验失败：${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    if (blockers.length > 0) {
      runtime.setTaskStep(
        task,
        'account-entry',
        'blocked',
        blockers.join('；'),
      );
      runtime.setTaskStep(
        task,
        'target-read',
        'blocked',
        'CDP/账号预检未通过，禁止继续读取客户内容。',
      );
      runtime.setTaskStep(
        task,
        'send-result',
        'blocked',
        'CDP/账号预检未通过，禁止进入发送。',
      );
      runtime.pushEvent(
        task,
        'error',
        `${label}商用预检阻断：${blockers.join('；')}`,
        {
          type: 'failure_reason',
          label: `${label}CDP/账号预检`,
          value: JSON.stringify(
            { platform, accountId: task.accountId, cdpHealthMessage, blockers },
            null,
            2,
          ),
        },
      );
    }

    return {
      ok: blockers.length === 0,
      blockers,
      nextAction:
        blockers.length === 0
          ? 'CDP 和账号登录态预检通过。'
          : '请先启动对应平台的 CDP 浏览器，完成账号登录并确认会话状态 ready 后重试。',
    };
  }

  private pushEngineEvidence(
    runtime: InteractionTaskRuntimePort,
    task: InteractionTask,
    evidence: AutoUploadInteractionEvidence | null | undefined,
    fallbackLabel: string,
  ) {
    const normalizedEvidence = this.normalizeEngineEvidence(
      evidence,
      fallbackLabel,
    );
    if (!normalizedEvidence) {
      return;
    }

    runtime.pushEvent(
      task,
      'info',
      `已保存${normalizedEvidence.label}。`,
      normalizedEvidence,
    );
  }

  private getExecutorDefinitions() {
    return [
      {
        key: 'douyin-comment-reply' as const,
        name: '抖音评论回复',
        platformName: '抖音',
        targetLabel: '评论读取',
        nextAction:
          '接入 Kaypal Desktop/Playwright 评论列表读取、回复填充和发送确认执行器。',
      },
      {
        key: 'douyin-direct-message-reply' as const,
        name: '抖音私信回复',
        platformName: '抖音',
        targetLabel: '私信读取',
        nextAction:
          '接入 Kaypal Desktop/Playwright 私信会话读取、回复填充和队列处理执行器。',
      },
      {
        key: 'wechat-channel-comment-reply' as const,
        name: '视频号评论回复',
        platformName: '视频号',
        targetLabel: '评论读取',
        nextAction: '接入视频号助手评论列表读取、回复填充和发送确认执行器。',
      },
      {
        key: 'wechat-channel-direct-message-reply' as const,
        name: '视频号私信回复',
        platformName: '视频号',
        targetLabel: '私信读取',
        nextAction: '接入视频号助手私信读取、回复填充和队列处理执行器。',
      },
      {
        key: 'wechat-reply-draft' as const,
        name: '微信回复草稿',
        platformName: '微信',
        targetLabel: '微信会话读取',
        nextAction:
          '接入桌面微信窗口定位、会话读取、草稿填充和人工确认发送执行器。',
      },
      {
        key: 'wechat-group-broadcast' as const,
        name: '微信群发',
        platformName: '微信',
        targetLabel: '群发对象读取',
        nextAction:
          '微信群发需要真实群对象读取、节奏/限流、逐条证据和人工确认执行器；未接入前保持阻断。',
      },
      {
        key: 'wechat-moments-publish' as const,
        name: '朋友圈发布',
        platformName: '微信',
        targetLabel: '朋友圈素材读取',
        nextAction:
          '朋友圈发布需要真实素材/可见范围读取、节奏/限流、发布前证据和人工确认执行器；未接入前保持阻断。',
      },
    ];
  }

  private requiredStagesForTask(type: InteractionTaskType) {
    if (
      type === 'douyin-comment-reply' ||
      type === 'douyin-direct-message-reply' ||
      type === 'wechat-channel-comment-reply' ||
      type === 'wechat-channel-direct-message-reply'
    ) {
      return ['open-entry', 'target-read'];
    }
    if (type === 'wechat-reply-draft') {
      return ['desktop-status'];
    }
    if (type === 'wechat-group-broadcast') {
      return ['desktop-status'];
    }
    if (type === 'wechat-moments-publish') {
      return ['desktop-status'];
    }
    return ['open-entry', 'target-read', 'draft-fill'];
  }

  private resolveDeclaredCapability(
    matrix: Map<
      InteractionTaskType,
      AutoUploadInteractionCapabilities['supportedTaskTypes'][number]
    >,
    type: InteractionTaskType,
  ) {
    return matrix.get(type);
  }

  private missingRequiredStagesForTask(
    type: InteractionTaskType,
    stages: string[],
  ) {
    return this.requiredStagesForTask(type).filter(
      (stage) => !this.hasTaskStage(stages, stage),
    );
  }

  private hasTaskStage(stages: string[], stage: string) {
    if (stage === 'open-entry') {
      return (
        stages.includes('open-entry') ||
        stages.includes('entry-preflight') ||
        stages.includes('desktop-status')
      );
    }
    if (stage === 'desktop-status') {
      return (
        stages.includes('desktop-status') ||
        stages.includes('entry-preflight') ||
        stages.includes('open-entry')
      );
    }
    if (stage === 'draft-fill') {
      return (
        stages.includes('draft-fill') || stages.includes('desktop-draft-fill')
      );
    }
    return stages.includes(stage);
  }

  private describeMissingStages(
    type: InteractionTaskType,
    stages: string[],
    wechatDesktopPreflight: WechatDesktopPreflightInternal,
  ) {
    const missing = this.missingRequiredStagesForTask(type, stages);
    if (
      type === 'wechat-reply-draft' &&
      !wechatDesktopPreflight.readyForDraft
    ) {
      missing.push('desktop-wechat');
    }
    return missing.length ? missing.join('、') : '真实执行器状态未知';
  }

  private isSupportedInteractionTaskType(
    value: string,
  ): value is InteractionTaskType {
    return [
      'douyin-comment-reply',
      'douyin-direct-message-reply',
      'wechat-channel-comment-reply',
      'wechat-channel-direct-message-reply',
      'wechat-reply-draft',
      'wechat-group-broadcast',
      'wechat-moments-publish',
      'customer-follow-up',
    ].includes(value);
  }

  private isDesktopInteractionTask(type: InteractionTaskType) {
    return [
      'wechat-reply-draft',
      'wechat-group-broadcast',
      'wechat-moments-publish',
    ].includes(type);
  }
}
