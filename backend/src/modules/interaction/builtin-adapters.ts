import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import { XiaohongshuInteractionExecutor } from '../local-engine/xiaohongshu-interaction.executor';
import {
  InteractionAdapter,
  InteractionCapability,
  InteractionReadInput,
  InteractionReadResult,
  InteractionSendInput,
  InteractionSendResult,
} from './interaction-adapter.interface';
import { InteractionAdapterRegistry } from './interaction-adapter.registry';

/**
 * 内置互动适配器（一期落地）。
 *
 * 把现有两套执行器包装成统一 InteractionAdapter 契约：
 *  - 抖音/视频号 → PlatformInteractionExecutor.dispatch / AutoUploadService.read*
 *  - 小红书     → XiaohongshuInteractionExecutor.readComments / replyComment
 *
 * 上层 comment-acquisition 通过 InteractionAdapterRegistry 按平台查询、
 * 按能力调用，不再写 `platform === 'xiaohongshu' ? ... : ...` 平台分支。
 */

/** 统一 dispatch 返回的 status 到 InteractionSendResult.status */
function mapDispatchStatus(status?: string): InteractionSendResult['status'] {
  return status === 'sent' ? 'sent' : 'failed';
}

/** 统一小红书 replyComment 返回的 status */
function mapXhsStatus(status?: string): InteractionSendResult['status'] {
  return status === 'sent' ? 'sent' : 'failed';
}

@Injectable()
export class DouyinInteractionAdapter implements InteractionAdapter {
  readonly capability: InteractionCapability = {
    platform: 'douyin',
    displayName: '抖音',
    supportedTasks: ['comment-reply', 'direct-message-reply'],
    supportsReadback: true,
    adapterVersion: '1.0.0',
  };

  constructor(
    private readonly autoUpload: AutoUploadService,
    private readonly interactionExecutor: PlatformInteractionExecutor,
  ) {}

  async read(input: InteractionReadInput): Promise<InteractionReadResult> {
    const accountId = Number(input.accountId);
    const items: { text: string }[] = [];
    let title: string | undefined;
    let url: string | undefined;
    if (input.taskType === 'comment-reply') {
      const raw = await this.autoUpload.readDouyinComments({
        accountId,
        limit: input.limit ?? 50,
      });
      title = raw.title || undefined;
      url = raw.url || undefined;
      for (const c of raw.comments || []) {
        const text = String(c.text || '').trim();
        if (text) items.push({ text });
      }
    } else {
      const raw = await this.autoUpload.readDouyinMessages({
        accountId,
        limit: input.limit ?? 50,
      });
      title = raw.title || undefined;
      url = raw.url || undefined;
      for (const m of raw.messages || []) {
        const text = String(m.text || '').trim();
        if (text) items.push({ text });
      }
    }
    return { items, title, url, readAt: new Date().toISOString() };
  }

  async send(input: InteractionSendInput): Promise<InteractionSendResult> {
    const result = await this.interactionExecutor.dispatch({
      platform: this.capability.platform as 'douyin',
      taskType: input.taskType,
      action: 'send',
      accountId: input.accountId,
      targetText: input.targetText,
      sourceText: input.sourceText ?? input.targetText,
      videoTitle: input.videoTitle,
      replyText: input.replyText,
    });
    return {
      status: mapDispatchStatus(result.status),
      message: result.message,
      readbackText: result.readbackText,
    };
  }
}

@Injectable()
export class WechatChannelInteractionAdapter implements InteractionAdapter {
  readonly capability: InteractionCapability = {
    platform: 'wechat-channel',
    displayName: '视频号',
    supportedTasks: ['comment-reply', 'direct-message-reply'],
    supportsReadback: true,
    adapterVersion: '1.0.0',
  };

  constructor(
    private readonly autoUpload: AutoUploadService,
    private readonly interactionExecutor: PlatformInteractionExecutor,
  ) {}

  async read(input: InteractionReadInput): Promise<InteractionReadResult> {
    const accountId = Number(input.accountId);
    const items: { text: string }[] = [];
    let title: string | undefined;
    let url: string | undefined;
    if (input.taskType === 'comment-reply') {
      const raw = await this.autoUpload.readWechatChannelComments({
        accountId,
        limit: input.limit ?? 50,
      });
      title = raw.title || undefined;
      url = raw.url || undefined;
      for (const c of raw.comments || []) {
        const text = String(c.text || '').trim();
        if (text) items.push({ text });
      }
    } else {
      const raw = await this.autoUpload.readWechatChannelMessages({
        accountId,
        limit: input.limit ?? 50,
      });
      title = raw.title || undefined;
      url = raw.url || undefined;
      for (const m of raw.messages || []) {
        const text = String(m.text || '').trim();
        if (text) items.push({ text });
      }
    }
    return { items, title, url, readAt: new Date().toISOString() };
  }

  async send(input: InteractionSendInput): Promise<InteractionSendResult> {
    const result = await this.interactionExecutor.dispatch({
      platform: this.capability.platform as 'wechat-channel',
      taskType: input.taskType,
      action: 'send',
      accountId: input.accountId,
      targetText: input.targetText,
      sourceText: input.sourceText ?? input.targetText,
      videoTitle: input.videoTitle,
      replyText: input.replyText,
    });
    return {
      status: mapDispatchStatus(result.status),
      message: result.message,
      readbackText: result.readbackText,
    };
  }
}

@Injectable()
export class XiaohongshuInteractionAdapter implements InteractionAdapter {
  readonly capability: InteractionCapability = {
    platform: 'xiaohongshu',
    displayName: '小红书',
    supportedTasks: ['comment-reply'],
    supportsReadback: true,
    adapterVersion: '1.0.0',
  };

  constructor(
    private readonly xhsInteraction: XiaohongshuInteractionExecutor,
  ) {}

  async read(input: InteractionReadInput): Promise<InteractionReadResult> {
    const result = await this.xhsInteraction.readComments({
      accountId: input.accountId,
      limit: input.limit ?? 50,
    });
    const list = result.comments || [];
    return {
      items: list
        .map((c) => {
          const raw = c as {
            content?: unknown;
            text?: unknown;
            index?: number;
          };
          const text = String(
            typeof raw.text === 'string' && raw.text
              ? raw.text
              : typeof raw.content === 'string'
                ? raw.content
                : '',
          ).trim();
          return { text, ref: String(raw.index ?? '') };
        })
        .filter((c) => c.text.length > 0),
      url: result.url || undefined,
      readAt: new Date().toISOString(),
    };
  }

  async send(input: InteractionSendInput): Promise<InteractionSendResult> {
    const result = await this.xhsInteraction.replyComment({
      accountId: input.accountId,
      commentIndex: Number(input.commentRef ?? 0),
      content: input.replyText,
    });
    return { status: mapXhsStatus(result.status), message: result.message };
  }
}

/** 启动时把内置 adapter 注册进 registry */
@Injectable()
export class InteractionAdapterRegistrar implements OnModuleInit {
  private readonly logger = new Logger(InteractionAdapterRegistrar.name);

  constructor(
    private readonly registry: InteractionAdapterRegistry,
    private readonly douyin: DouyinInteractionAdapter,
    private readonly wechatChannel: WechatChannelInteractionAdapter,
    private readonly xiaohongshu: XiaohongshuInteractionAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this.douyin);
    this.registry.register(this.wechatChannel);
    this.registry.register(this.xiaohongshu);
    this.logger.log(
      `互动适配器已注册: ${this.registry.listPlatforms().join(', ')}`,
    );
  }
}
