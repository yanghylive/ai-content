import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import { DiscoveryBrowserRunner } from '../discovery/discovery-browser-runner';
import {
  InteractionAdapter,
  InteractionCapability,
  InteractionItem,
  InteractionReadInput,
  InteractionReadResult,
  InteractionSendInput,
  InteractionSendResult,
} from './interaction-adapter.interface';
import { InteractionAdapterRegistry } from './interaction-adapter.registry';

/**
 * 内置互动适配器（一期落地）。
 *
 * 把现有执行器包装成统一 InteractionAdapter 契约：
 *  - 抖音/视频号 → PlatformInteractionExecutor.dispatch / AutoUploadService.read*
 *  - 小红书/快手 → DiscoveryBrowserRunner.readComments / replyComment（关键词搜索模式真实现）
 *
 * 上层 comment-acquisition 通过 InteractionAdapterRegistry 按平台查询、
 * 按能力调用，不再写 `platform === 'xiaohongshu' ? ... : ...` 平台分支。
 */

/** 统一 dispatch 返回的 status 到 InteractionSendResult.status */
function mapDispatchStatus(status?: string): InteractionSendResult['status'] {
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
    const items: InteractionItem[] = [];
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
        if (text)
          items.push({
            text,
            authorName: c.authorName,
            authorId: c.authorId,
            commentTime: c.commentTime,
            ref: c.ref,
          });
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
      evidenceUrl: result.evidenceUrl,
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
    const items: InteractionItem[] = [];
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
        if (text)
          items.push({
            text,
            authorName: c.authorName,
            authorId: c.authorId,
            commentTime: c.commentTime,
            ref: c.ref,
          });
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
      evidenceUrl: result.evidenceUrl,
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

  constructor(private readonly runner: DiscoveryBrowserRunner) {}

  async read(input: InteractionReadInput): Promise<InteractionReadResult> {
    // 小红书评论获客：走 DiscoveryBrowserRunner.readComments（关键词搜索模式）。
    // 详情页必须从搜索页真实点击进入（直开 404），故 keyword 必需，contentUrl 来自发现层产出。
    const items = await this.runner.readComments({
      platform: 'xiaohongshu',
      accountId: input.accountId,
      contentUrl: input.contentUrl ?? '',
      keyword: input.keyword,
      limit: input.limit ?? 50,
    });
    return {
      items: items
        .map((d) => {
          const ev = d.interactionEvents?.[0];
          return {
            text: String(ev?.text ?? '').trim(),
            authorName: d.identityHint?.nickname,
            authorId: ev?.authorExternalId ?? d.identityHint?.externalUserId,
            ref: ev?.externalEventId,
            videoUrl: ev?.sourceUrl ?? d.sourceContent?.url,
          };
        })
        .filter((c) => c.text.length > 0),
      url: items[0]?.sourceContent?.url,
      title: items[0]?.sourceContent?.title,
      readAt: new Date().toISOString(),
    };
  }

  async send(input: InteractionSendInput): Promise<InteractionSendResult> {
    const result = await this.runner.replyComment({
      platform: 'xiaohongshu',
      accountId: input.accountId,
      contentUrl: input.contentUrl ?? '',
      keyword: input.keyword,
      targetText: input.targetText,
      replyText: input.replyText,
    });
    return {
      status: result.sent ? 'sent' : 'failed',
      message: result.message,
      evidenceUrl: result.evidenceUrl,
    };
  }
}

@Injectable()
export class KuaishouInteractionAdapter implements InteractionAdapter {
  readonly capability: InteractionCapability = {
    platform: 'kuaishou',
    displayName: '快手',
    supportedTasks: ['comment-reply'],
    supportsReadback: true,
    adapterVersion: '1.0.0',
  };

  constructor(private readonly runner: DiscoveryBrowserRunner) {}

  async read(input: InteractionReadInput): Promise<InteractionReadResult> {
    // 快手评论获客：走 DiscoveryBrowserRunner.readComments（关键词搜索模式发现层产出 contentUrl）。
    // 无 contentUrl 时如实失败（runner 内部会抛 parse_failed），不再 throw 假「待接入」。
    const items = await this.runner.readComments({
      platform: 'kuaishou',
      accountId: input.accountId,
      contentUrl: input.contentUrl ?? '',
      keyword: input.keyword,
      limit: input.limit ?? 50,
    });
    return {
      items: items
        .map((d) => {
          const ev = d.interactionEvents?.[0];
          return {
            text: String(ev?.text ?? '').trim(),
            authorName: d.identityHint?.nickname,
            authorId: ev?.authorExternalId ?? d.identityHint?.externalUserId,
            ref: ev?.externalEventId,
            videoUrl: ev?.sourceUrl ?? d.sourceContent?.url,
          };
        })
        .filter((c) => c.text.length > 0),
      url: items[0]?.sourceContent?.url,
      title: items[0]?.sourceContent?.title,
      readAt: new Date().toISOString(),
    };
  }

  async send(input: InteractionSendInput): Promise<InteractionSendResult> {
    const result = await this.runner.replyComment({
      platform: 'kuaishou',
      accountId: input.accountId,
      contentUrl: input.contentUrl ?? '',
      keyword: input.keyword,
      targetText: input.targetText,
      replyText: input.replyText,
    });
    return {
      status: result.sent ? 'sent' : 'failed',
      message: result.message,
      evidenceUrl: result.evidenceUrl,
    };
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
    private readonly kuaishou: KuaishouInteractionAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this.douyin);
    this.registry.register(this.wechatChannel);
    this.registry.register(this.xiaohongshu);
    this.registry.register(this.kuaishou);
    this.logger.log(
      `互动适配器已注册: ${this.registry.listPlatforms().join(', ')}`,
    );
  }
}
