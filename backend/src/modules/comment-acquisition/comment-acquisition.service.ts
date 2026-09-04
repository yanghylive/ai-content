import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import { ReplyEngineService } from './reply-engine.service';
import { CircuitBreaker } from './circuit-breaker';
import { LeadRepository } from '../leads/lead.repository';
import { InteractionAdapterRegistry } from '../interaction/interaction-adapter.registry';
import type {
  InteractionItem,
  InteractionReadResult,
  InteractionSendResult,
} from '../interaction/interaction-adapter.interface';
import { InteractionEventStore } from '../interaction/interaction-event.store';
import { DiscoveryBrowserRunner } from '../discovery/discovery-browser-runner';
import { AccountTouchQuotaService } from '../account-touch-quota/account-touch-quota.service';

/**
 * CommentAcquisitionService —— 评论获客闭环
 *
 * 链路：关键词/账号监控 → 读取评论 → 潜客评分 → ReplyEngine 生成真人感回复
 *      → 审核队列（可选人工）→ 真实回复（CDP 会话）→ 潜客落库（CRM）
 *
 * 复用现有能力（零改动）：
 * - InteractionAdapterRegistry（统一互动契约，按平台读写评论/回复）
 * - PlatformInteractionExecutor.dispatch（抖音/视频号真实回复执行，经 adapter 委托）
 * - ReplyEngineService（AI 回复生成，人格池 + 策略）
 */

export type AcquisitionPlatform =
  'douyin' | 'wechat-channel' | 'xiaohongshu' | 'kuaishou';
export type LeadStatus =
  'pending' | 'approved' | 'replied' | 'skipped' | 'failed' | 'not_integrated';

export interface AcquisitionLeadRow {
  id: string;
  tenantId: string | null;
  userId: string;
  platform: string;
  accountId: string;
  commentText: string;
  commenterName?: string | null;
  leadScore: number;
  signals?: string | null;
  replyText?: string | null;
  personaId?: string | null;
  status: string;
  error?: string | null;
  commentRef?: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CommentAcquisitionService {
  private readonly logger = new Logger(CommentAcquisitionService.name);
  /** 评论回复风控断路器（内存，按 平台:账号 维度） */
  private readonly circuitBreaker = new CircuitBreaker();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly autoUpload: AutoUploadService,
    private readonly interactionExecutor: PlatformInteractionExecutor,
    private readonly replyEngine: ReplyEngineService,
    private readonly leadRepository: LeadRepository,
    private readonly interactionRegistry: InteractionAdapterRegistry,
    private readonly interactionEventStore: InteractionEventStore,
    private readonly discoveryRunner: DiscoveryBrowserRunner,
    private readonly accountTouchQuota: AccountTouchQuotaService,
  ) {}

  /**
   * 扫描账号最新评论 → 潜客评分 → 生成回复 → 入库（pending 待审核/自动发）
   */
  async scanAccount(input: {
    platform: AcquisitionPlatform;
    accountId: number | string;
    limit?: number;
    autoReply?: boolean;
    minLeadScore?: number;
    /** 关键词搜索模式（快手/小红书）：keyword → 搜账号 → 读作品 → 读评论（拿 contentUrl） */
    keyword?: string;
  }): Promise<{
    scanned: number;
    leads: number;
    replies: number;
    circuitOpen: boolean;
    retryAfterSeconds: number;
    items: Array<{
      leadId: string;
      comment: string;
      score: number;
      status: string;
      replyText?: string;
      personaName?: string;
    }>;
  }> {
    const scope = await this.resolveScope();
    // 归一化账号 ID：兼容纯数字（auto-upload 数字 id，前端表单形式）与 stableId（publish_accounts 主键）
    const normalizedAccount = this.normalizeAccountId(input.accountId);
    await this.assertAccountOwnership(input.accountId, scope, input.platform);
    const platformName =
      input.platform === 'douyin'
        ? '抖音'
        : input.platform === 'xiaohongshu'
          ? '小红书'
          : input.platform === 'kuaishou'
            ? '快手'
            : '视频号';
    const minScore = input.minLeadScore ?? 45;
    const autoReply = input.autoReply ?? false;
    const circuitKey = `${input.platform}:${input.accountId}`;
    const circuit = this.circuitBreaker.getStatus(circuitKey);

    // 1. 读取评论：统一走互动适配器契约（registry.read），消除三平台分支。
    //    关键词搜索模式（快手/小红书，keyword 非空）：先走 runner 三段式发现
    //    （搜账号 → 读作品拿 contentUrl → 读评论），拿带 contentUrl 的评论，
    //    喂给后续评分/回复链路（回复时 adapter.send 传 contentUrl 定位评论区）。
    const keywordMode = Boolean(input.keyword?.trim());
    const adapter = this.interactionRegistry.get(input.platform);
    if (!adapter.read) {
      throw new Error(`平台 ${input.platform} 的互动适配器不支持读取评论`);
    }
    let readResult: InteractionReadResult;
    let keywordContentUrls: string[] = [];
    if (
      keywordMode &&
      (input.platform === 'kuaishou' || input.platform === 'xiaohongshu')
    ) {
      readResult = await this.discoverByKeyword(
        input,
        normalizedAccount.numericId ?? input.accountId,
      );
      // 记录每条评论的来源详情页 URL（供 dispatchReply 透传 contentUrl）
      keywordContentUrls = (readResult.items ?? []).map(
        (it) => it.videoUrl ?? '',
      );
    } else {
      readResult = await adapter.read({
        platform: input.platform,
        taskType: 'comment-reply',
        accountId: normalizedAccount.numericId ?? input.accountId,
        limit: input.limit ?? 50,
      });
    }

    const comments = (readResult.items ?? [])
      .map((item, i) => ({
        item,
        text: item.text.trim(),
        // 小红书通知条目序号（回复定位用）；其他平台无此概念
        commentIndex:
          input.platform === 'xiaohongshu' ? Number(item.ref ?? i) : undefined,
        // 关键词搜索模式的来源详情页 URL（快手/小红书回复定位评论区用）
        contentUrl: item.videoUrl ?? keywordContentUrls[i] ?? undefined,
      }))
      .filter((c) => c.text.length > 0);
    const sourceAttribution = await this.resolveCommentSourceAttribution(
      scope,
      input.platform,
      input.accountId,
      readResult.url,
    );

    this.logger.log(
      `[comment-acquisition] ${platformName} account=${input.accountId} 扫描到 ${comments.length} 条评论`,
    );

    const items: Array<{
      leadId: string;
      comment: string;
      score: number;
      status: string;
      replyText?: string;
      personaName?: string;
    }> = [];

    let leads = 0;
    let replies = 0;

    for (const comment of comments) {
      // 2. 潜客评分
      const { score, signals } = this.replyEngine.scoreLeadPotential(comment);
      if (score < minScore) continue;

      leads += 1;

      // 3. 生成回复
      let replyText: string | undefined;
      let personaId: string | undefined;
      let personaName: string | undefined;
      try {
        const reply = await this.replyEngine.generateReply(comment, {
          platformName,
          bindKey: `${input.platform}:${input.accountId}`,
          content: {
            title: readResult.title || undefined,
          },
        });
        replyText = reply.replyText;
        personaId = reply.personaId;
        personaName = reply.personaName;
      } catch (error) {
        this.logger.warn(
          `[comment-acquisition] 回复生成失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // 4. 先记录不可变的互动事实，再把真实事件 ID 写入 Lead。评论扫描
      // 不能只产生一条文本线索，否则内容 -> 发布 -> 互动 -> 线索的归因链会断。
      const interaction = await this.interactionEventStore.ingest({
        ...this.interactionEventStore.fromInteractionItem(
          input.platform,
          input.accountId,
          comment.item,
          {
            sourceUrl: comment.item.videoUrl ?? sourceAttribution.sourceUrl,
            sourceArticleId: sourceAttribution.sourceArticleId ?? undefined,
            publishRecordId:
              sourceAttribution.sourcePublishRecordId ?? undefined,
          },
        ),
        tenantId: scope.tenantId ?? 'legacy-local-desktop',
        userId: scope.userId,
      });

      // 5. 单写统一 leads 表（去重写入，返回 lead.id 供后续回复/状态更新）
      const { lead } = await this.leadRepository.upsert({
        userId: scope.userId,
        tenantId: scope.tenantId,
        platform: input.platform,
        sourceType: 'comment',
        sourceAccountId: String(input.accountId),
        sourceInteractionEventId: interaction.event.id,
        sourceUrl: comment.item.videoUrl ?? sourceAttribution.sourceUrl,
        sourceArticleId: sourceAttribution.sourceArticleId,
        sourcePublishRecordId: sourceAttribution.sourcePublishRecordId,
        sourceText: comment.text,
        externalUserId: comment.item.authorId ?? null,
        nickname: comment.item.authorName ?? null,
        commentRef:
          comment.commentIndex !== undefined
            ? String(comment.commentIndex)
            : null,
        score,
        signals,
        latestReply: replyText ?? null,
        replyPersonaId: personaId ?? null,
      });
      const leadId = lead.id;

      // 6. 自动回复：低风险自动真实外发（留审批痕迹），高风险进人工审核
      let status = 'pending';
      if (autoReply && replyText) {
        const highRisk = this.replyEngine.isHighRisk(comment);
        if (highRisk) {
          status = 'pending';
          this.logger.log(
            `[comment-acquisition] lead=${leadId} 命中高风险词，进人工审核（不自动发送）`,
          );
        } else if (circuit.open) {
          this.logger.warn(
            `[comment-acquisition] ${platformName} 账号 ${input.accountId} 触发风控熔断，跳过自动回复（${circuit.retryAfterSeconds}s 后重试）`,
          );
          status = 'pending';
        } else {
          // 低风险自动审批留痕（autoApprovedAt 写入 notes，审计可复验）
          await this.prisma.lead.updateMany({
            where: {
              id: leadId,
              userId: scope.userId,
              ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
            },
            data: {
              status: 'approved',
              notes: {
                autoApprovedAt: new Date().toISOString(),
                source: 'auto-reply',
              },
            },
          });
          const sent = await this.dispatchReply(leadId, {
            platform: input.platform,
            accountId: input.accountId,
            commentText: comment.text,
            replyText,
            sourceTitle: readResult.title,
            commentIndex: comment.commentIndex,
            contentUrl: comment.contentUrl,
            keyword: input.keyword?.trim() || undefined,
          });
          if (sent) {
            replies += 1;
            status = 'replied';
          } else {
            status = 'failed';
          }
        }
      }

      items.push({
        leadId,
        comment: comment.text,
        score,
        status,
        replyText,
        personaName,
      });
    }

    return {
      scanned: comments.length,
      leads,
      replies,
      circuitOpen: circuit.open,
      retryAfterSeconds: circuit.retryAfterSeconds,
      items,
    };
  }

  /**
   * 关键词搜索发现（快手/小红书）：keyword → 搜内容（拿 contentUrl）→ 读评论。
   * 复用 DiscoveryBrowserRunner 两段式（searchByKeyword → readComments）。
   *
   * 为什么是两段式而非「搜账号→作品→评论」三段式（2026-09-05 真机验证坐实）：
   * runner.searchAccounts（关键词→账号）只有抖音实现，快手/小红书 behavior 均未实现
   * （platform-behaviors.ts：DouyinBehavior 有 searchAccounts，KuaishouBehavior/XhsBehavior 没有），
   * 小红书连 listAccountWorks 也抛「暂未实现」。三段式对快手/小红书第一段就撞
   * 「平台不支持账号搜索」。
   * 而 searchByKeyword（关键词→内容）是快手/小红书都已实现的真实链路（behavior.discover），
   * 返回的内容自带 url，可直接喂 readComments 读评论。改走两段式，与平台真实能力对齐。
   */
  private async discoverByKeyword(
    input: { platform: AcquisitionPlatform; accountId: number | string; limit?: number; keyword?: string },
    accountId: string | number | undefined,
  ): Promise<InteractionReadResult> {
    const platform = input.platform as 'kuaishou' | 'xiaohongshu';
    const keyword = (input.keyword ?? '').trim();
    if (!keyword) {
      throw new Error('关键词搜索模式需要非空 keyword');
    }
    // 1. 搜内容（关键词 → 内容列表，每个带 url）
    const contents = await this.discoveryRunner.searchByKeyword({
      platform,
      accountId: accountId ?? input.accountId,
      keyword,
      limit: 3,
    });
    if (contents.length === 0) {
      return { items: [], readAt: new Date().toISOString() };
    }
    // 2. 逐个内容读评论（取第一个能读到评论的内容，避免全量扫）
    const items: InteractionItem[] = [];
    let title: string | undefined;
    let url: string | undefined;
    for (const content of contents.slice(0, 3)) {
      const contentUrl = content.sourceContent?.url ?? '';
      if (!contentUrl) continue;
      try {
        const comments = await this.discoveryRunner.readComments({
          platform,
          accountId: accountId ?? input.accountId,
          contentUrl,
          keyword,
          limit: input.limit ?? 50,
        });
        for (const c of comments) {
          const ev = c.interactionEvents?.[0];
          const text = String(ev?.text ?? '').trim();
          if (!text) continue;
          items.push({
            text,
            authorName: c.identityHint?.nickname,
            authorId: ev?.authorExternalId ?? c.identityHint?.externalUserId,
            ref: ev?.externalEventId,
            videoUrl: contentUrl,
            videoTitle: c.sourceContent?.title,
          });
          if (!title) title = c.sourceContent?.title;
          if (!url) url = contentUrl;
        }
        // 拿到评论即停（避免对多个内容重复读评论）
        if (items.length > 0) break;
      } catch {
        // 单个内容读评论失败不阻断整体，继续下一个内容
        continue;
      }
    }
    return { items, title, url, readAt: new Date().toISOString() };
  }

  /**
   * 私信获客：扫描私信 → 潜客评分 → 生成回复 → 入库 → 可选自动回复
   * （复用 AutoUploadService.readDouyinMessages/readWechatChannelMessages + dispatch direct-message-reply）
   */
  async scanDm(input: {
    platform: 'douyin' | 'wechat-channel';
    accountId: number | string;
    limit?: number;
    autoReply?: boolean;
    minLeadScore?: number;
  }): Promise<{
    scanned: number;
    leads: number;
    replies: number;
    circuitOpen: boolean;
    retryAfterSeconds: number;
    items: Array<{
      leadId: string;
      message: string;
      score: number;
      status: string;
      replyText?: string;
      personaName?: string;
    }>;
  }> {
    const scope = await this.resolveScope();
    // 归一化账号 ID（同 scanAccount：兼容数字 id 与 stableId）
    const normalizedAccount = this.normalizeAccountId(input.accountId);
    // 平台归一：DTO 类型虽约束 douyin/wechat-channel，但 @Body() 运行时可能漏传
    // undefined，此处按账号 type 推断（2=视频号、其余=抖音）。
    // 推断失败时显式报错，不再静默兜底成抖音（S4-7：避免掩盖真实错误）。
    let platform: 'douyin' | 'wechat-channel' | undefined =
      input.platform === 'douyin'
        ? 'douyin'
        : input.platform === 'wechat-channel'
          ? 'wechat-channel'
          : undefined;
    if (!platform) {
      const accounts = await this.autoUpload.listAccounts({
        ids: [normalizedAccount.numericId ?? Number(input.accountId)],
      });
      const inferred = accounts?.[0]?.type === 2 ? 'wechat-channel' : 'douyin';
      if (!accounts || accounts.length === 0) {
        throw new NotFoundException(
          `无法推断私信平台：账号 ${input.accountId} 无对应账号记录，请显式传入 platform（douyin/wechat-channel）`,
        );
      }
      platform = inferred;
    }
    // P1 复核（全面审查）：scanDm 真实发私信前必须账号归属校验——
    // 对齐 scanAccount，防凭他人 accountId 读私信并对他人账号自动回复
    await this.assertAccountOwnership(input.accountId, scope, platform);
    const platformName = platform === 'douyin' ? '抖音' : '视频号';
    const minScore = input.minLeadScore ?? 45;
    const autoReply = input.autoReply ?? false;
    const circuitKey = `${platform}:${input.accountId}`;
    const circuit = this.circuitBreaker.getStatus(circuitKey);

    const numericAccountId =
      normalizedAccount.numericId ?? Number(input.accountId);
    const readResult =
      platform === 'douyin'
        ? await this.autoUpload.readDouyinMessages({
            accountId: numericAccountId,
            limit: input.limit ?? 50,
          })
        : await this.autoUpload.readWechatChannelMessages({
            accountId: numericAccountId,
            limit: input.limit ?? 50,
          });

    const messages = (readResult.messages || [])
      .map((m) => ({ text: String(m.text || '').trim() }))
      .filter((m) => m.text.length > 0);

    this.logger.log(
      `[comment-acquisition] ${platformName} 私信 account=${input.accountId} 扫描到 ${messages.length} 条`,
    );

    const items: Array<{
      leadId: string;
      message: string;
      score: number;
      status: string;
      replyText?: string;
      personaName?: string;
    }> = [];

    let leads = 0;
    let replies = 0;

    for (const message of messages) {
      const { score, signals } = this.replyEngine.scoreLeadPotential(message);
      if (score < minScore) continue;

      leads += 1;

      let replyText: string | undefined;
      let personaId: string | undefined;
      let personaName: string | undefined;
      try {
        const reply = await this.replyEngine.generateReply(message, {
          platformName,
          bindKey: `${platform}:${input.accountId}`,
          content: { title: readResult.title || undefined },
        });
        replyText = reply.replyText;
        personaId = reply.personaId;
        personaName = reply.personaName;
      } catch (error) {
        this.logger.warn(
          `[comment-acquisition] 私信回复生成失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // 单写统一 leads 表（去重写入，返回 lead.id）
      const { lead } = await this.leadRepository.upsert({
        userId: scope.userId,
        tenantId: scope.tenantId,
        platform: input.platform,
        sourceType: 'dm',
        sourceAccountId: String(input.accountId),
        sourceText: message.text,
        score,
        signals,
        latestReply: replyText ?? null,
        replyPersonaId: personaId ?? null,
      });
      const leadId = lead.id;

      let status = 'pending';
      // 私信自动回复：低风险自动真实外发（留审批痕迹），高风险进人工审核
      if (autoReply && replyText) {
        const highRisk = this.replyEngine.isHighRisk(message);
        if (highRisk) {
          status = 'pending';
          this.logger.log(
            `[comment-acquisition] lead=${leadId} 私信命中高风险词，进人工审核（不自动发送）`,
          );
        } else if (circuit.open) {
          status = 'pending';
        } else {
          await this.prisma.lead.updateMany({
            where: {
              id: leadId,
              userId: scope.userId,
              ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
            },
            data: {
              status: 'approved',
              notes: {
                autoApprovedAt: new Date().toISOString(),
                source: 'auto-reply',
              },
            },
          });
          const sent = await this.dispatchReply(leadId, {
            platform: input.platform,
            accountId: input.accountId,
            commentText: message.text,
            replyText,
          });
          if (sent) {
            replies += 1;
            status = 'replied';
          } else {
            status = 'failed';
          }
        }
      }

      items.push({
        leadId,
        message: message.text,
        score,
        status,
        replyText,
        personaName,
      });
    }

    return {
      scanned: messages.length,
      leads,
      replies,
      circuitOpen: circuit.open,
      retryAfterSeconds: circuit.retryAfterSeconds,
      items,
    };
  }

  /**
   * 执行真实回复（CDP 会话 dispatch）。成功 → 标记 replied + 熔断器记成功。
   * 失败 → 标记 failed + 熔断器记失败（窗口内 ≥3 次触发熔断）。
   */
  async dispatchReply(
    leadId: string,
    input: {
      platform: AcquisitionPlatform;
      accountId: number | string;
      commentText: string;
      replyText: string;
      sourceTitle?: string;
      /** 小红书通知条目序号（xiaohongshu 平台回复定位用；缺省时从 lead 行 comment_ref 读） */
      commentIndex?: number;
      /** 内容详情页 URL（关键词搜索模式，快手/小红书回复定位评论区） */
      contentUrl?: string;
      /** 搜索关键词（小红书从搜索页点击进详情页必需） */
      keyword?: string;
    },
    scope?: { tenantId: string | null; userId: string },
    circuitKey?: string,
  ): Promise<boolean> {
    const resolvedScope = scope ?? (await this.resolveScope());
    const stableId = await this.assertAccountOwnership(
      input.accountId,
      resolvedScope,
      input.platform,
    );
    const lead = await this.assertReplyLead(leadId, input, resolvedScope);
    // 防止调用方篡改回复内容：已审核线索的回复只能使用当前落库版本。
    const replyText = input.replyText.trim();
    const approvedReply = (lead.latestReply ?? '').trim();
    if (!approvedReply) {
      // 线索未生成回复草稿（latestReply 为空）时，禁止发送任意内容（防篡改空文本绕过）
      throw new UnauthorizedException('该线索未生成回复草稿，无法发送');
    }
    if (!replyText || approvedReply !== replyText) {
      throw new UnauthorizedException('回复内容与已审核线索不一致');
    }
    const key = circuitKey ?? `${input.platform}:${input.accountId}`;

    // 小红书手动回复：commentIndex 缺省时从 lead 行读取（自动回复已显式传入）
    let xhsIndex = input.commentIndex;
    if (input.platform === 'xiaohongshu' && xhsIndex === undefined) {
      const leadRow = await this.prisma.lead.findFirst({
        where: {
          id: leadId,
          userId: resolvedScope.userId,
          ...(resolvedScope.tenantId
            ? { tenantId: resolvedScope.tenantId }
            : {}),
        },
        select: { commentRef: true },
      });
      const ref = leadRow?.commentRef;
      if (ref !== undefined && ref !== null && ref !== '') {
        xhsIndex = Number(ref);
      }
    }

    try {
      // 统一互动契约：按平台从 registry 取 adapter 调用，消除平台分支。
      // 小红书 send 用 commentRef 定位通知条目；抖音/视频号 send 走 dispatch。
      // 2026-08-20 修复：私信线索（sourceType='dm'）必须走 direct-message-reply，
      // 此前硬编码 comment-reply 导致私信回复被发到评论区路径。
      const adapter = this.interactionRegistry.get(input.platform);
      const taskType =
        lead.sourceType === 'dm' ? 'direct-message-reply' : 'comment-reply';

      // 能力门（S2-3）：发送前预检真实能力，未接入/不支持时明确拦截，
      // 不把「平台未接入」误判为「发送失败」去污染熔断统计。
      const capability = adapter.capability;
      if (
        capability &&
        !capability.supportedTasks.includes(taskType)
      ) {
        const msg = `平台 ${input.platform} 不支持互动类型 ${taskType}`;
        this.logger.warn(`[comment-acquisition] ${msg}`);
        await this.leadRepository.updateReplyStatus(leadId, {
          userId: resolvedScope.userId,
          status: 'not_integrated',
          lastError: msg,
        });
        return false;
      }

      // 账号维度日触达配额：扣减成功才允许真实发送；扣减失败（今日额度用尽）
      // 直接拦截，不再调用 adapter.send，避免私信/评论链路无限触达突破平台风控阈值。
      const consumed = await this.accountTouchQuota.tryConsume(
        resolvedScope.userId,
        input.platform,
        stableId,
      );
      if (!consumed) {
        const msg = '今日账号触达额度已用尽';
        this.logger.warn(`[comment-acquisition] ${input.platform}:${stableId} ${msg}`);
        await this.leadRepository.updateReplyStatus(leadId, {
          userId: resolvedScope.userId,
          status: 'failed',
          lastError: msg,
        });
        return false;
      }

      let result: InteractionSendResult;
      try {
        result = (await adapter.send?.({
          platform: input.platform,
          taskType,
          accountId: input.accountId,
          targetText: input.commentText,
          sourceText: input.commentText,
          videoTitle: input.sourceTitle,
          commentRef: xhsIndex !== undefined ? String(xhsIndex) : undefined,
          contentUrl: input.contentUrl,
          keyword: input.keyword,
          replyText,
        })) ?? {
          status: 'failed' as const,
          message: '该平台未实现回复能力',
          evidenceUrl: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 平台真实能力未接入（如快手 adapter 尚未接 RPA 实现）时，不算发送失败，
        // 不记熔断，lead 落 not_integrated，避免把「能力缺失」误判成「平台失败」。
        if (/待接入|未实现|未接入|not\s*implemented|not\s*integrated/i.test(message)) {
          this.logger.warn(
            `[comment-acquisition] ${input.platform} 回复能力未接入: ${message}`,
          );
          await this.leadRepository.updateReplyStatus(leadId, {
            userId: resolvedScope.userId,
            status: 'not_integrated',
            lastError: message,
          });
          return false;
        }
        throw error;
      }

      // sent 只是适配器声明动作完成；没有回读文本或截图证据时不得形成
      // replied，避免平台实际失败却被记录为假成功。
      const hasVerifiedReadback = Boolean(
        result.readbackText?.includes(replyText),
      );
      const hasEvidence =
        hasVerifiedReadback || Boolean(result.evidenceUrl?.trim());
      const ok = result.status === 'sent' && hasEvidence;
      const resultMessage = ok
        ? null
        : result.message ||
          (result.status === 'sent'
            ? '平台未提供发送回读或截图证据'
            : '平台回复失败');
      if (ok) {
        this.circuitBreaker.recordSuccess(key);
      } else {
        const opened = this.circuitBreaker.recordFailure(key);
        if (opened) {
          this.logger.warn(
            `[comment-acquisition] ${key} 触发风控熔断：窗口内失败 ≥3 次，暂停自动回复 30 分钟`,
          );
        }
      }
      await this.leadRepository.updateReplyStatus(leadId, {
        userId: resolvedScope.userId,
        status: ok ? 'replied' : 'failed',
        lastError: resultMessage,
        repliedAt: ok ? new Date() : null,
        evidenceUrls: result.evidenceUrl ? [result.evidenceUrl] : undefined,
      });
      return ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const opened = this.circuitBreaker.recordFailure(key);
      if (opened) {
        this.logger.warn(
          `[comment-acquisition] ${key} 触发风控熔断：窗口内失败 ≥3 次，暂停自动回复 30 分钟`,
        );
      }
      this.logger.error(
        `[comment-acquisition] 回复执行失败 lead=${leadId}: ${message}`,
      );
      await this.leadRepository.updateReplyStatus(leadId, {
        userId: resolvedScope.userId,
        status: 'failed',
        lastError: message,
      });
      return false;
    }
  }

  /** 潜客列表 */
  async listLeads(input: {
    platform?: AcquisitionPlatform;
    status?: LeadStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AcquisitionLeadRow[]; total: number }> {
    const scope = await this.resolveScope();
    const where: Prisma.LeadWhereInput = {
      userId: scope.userId,
      tenantId: scope.tenantId,
      sourceType: { in: ['comment', 'dm'] },
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.status ? { status: input.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: input.offset ?? 0,
        take: input.limit ?? 50,
      }),
      this.prisma.lead.count({ where }),
    ]);

    // 统一 leads 表 → 评论获客前端字段（camelCase，对齐前端 AcquisitionLead）
    const items: AcquisitionLeadRow[] = rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      platform: row.platform,
      accountId: row.sourceAccountId ?? '',
      commentText: row.sourceText ?? '',
      commenterName: row.nickname,
      leadScore: row.score,
      signals: row.signals ? JSON.stringify(row.signals) : null,
      replyText: row.latestReply,
      personaId: row.replyPersonaId,
      status: row.status,
      error: row.lastError,
      commentRef: row.commentRef,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return { items, total };
  }

  /** 人工审核：通过 → 待回复；跳过 */
  async reviewLead(
    leadId: string,
    input: { action: 'approve' | 'skip'; replyText?: string },
  ): Promise<{ status: string }> {
    const scope = await this.resolveScope();
    const status = input.action === 'approve' ? 'approved' : 'skipped';
    const result = await this.prisma.lead.updateMany({
      where: {
        id: leadId,
        userId: scope.userId,
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      },
      data: {
        status,
        ...(input.replyText !== undefined
          ? { latestReply: input.replyText }
          : {}),
        updatedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException('线索不存在或无权操作');
    }
    return { status };
  }

  // ------------------------------------------------------------------
  // 私有
  // ------------------------------------------------------------------

  private async resolveScope(): Promise<{
    tenantId: string | null;
    userId: string;
  }> {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('缺少登录上下文，请先登录。');
    }
    if (context?.user?.kaypalLocalOnly === true) {
      return { tenantId: null, userId };
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  /** S0-3 安全锁：校验账号归属，防读/发他人账号 */
  private async assertAccountOwnership(
    accountId: number | string,
    scope: { tenantId: string | null; userId: string },
    platform?: string,
  ): Promise<string> {
    const id = String(accountId);
    // 兼容两种账号 ID 形式：
    // 1. stableId 精确匹配（publish_accounts 主键，如 local-engine-xxx-6-douyin）
    // 2. 纯数字 id 按平台后缀匹配（auto-upload 数字 id，前端表单提示"如 3"）
    const whereId = platform
      ? {
          OR: [{ id }, { id: { endsWith: `-${id}-${platform}` } }],
        }
      : { id };
    const account = await this.prisma.publishAccount.findFirst({
      where: {
        ...whereId,
        userId: scope.userId,
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('发布账号不存在或无权操作');
    }
    // 返回 stableId（publish_accounts 主键），供账号维度配额计数器作 key。
    return account.id;
  }

  /**
   * 归一化账号 ID：兼容纯数字（auto-upload 数字 id，如 6）与
   * stableId（publish_accounts 主键，如 local-engine-75b30f6c26f5fffe-6-douyin）。
   * 修复契约断裂：前端表单提示输入数字，但 ownership 校验查 stableId、
   * 适配器 Number() 解析——三种形式此前互不兼容。
   */
  private normalizeAccountId(accountId: number | string): {
    raw: string;
    numericId: number | null;
  } {
    const raw = String(accountId).trim();
    if (/^\d+$/.test(raw)) {
      return { raw, numericId: Number(raw) };
    }
    const m = raw.match(/-(\d+)-[a-z][a-z0-9-]*$/i);
    return { raw, numericId: m ? Number(m[1]) : null };
  }

  /**
   * 回复前的最终授权门禁：线索必须属于当前用户/租户、来自同一平台账号，
   * 且已经明确审核通过。扫描参数和前端状态都不构成发送授权。
   */
  private async assertReplyLead(
    leadId: string,
    input: {
      platform: AcquisitionPlatform;
      accountId: number | string;
      commentText: string;
    },
    scope: { tenantId: string | null; userId: string },
  ): Promise<{
    status: string;
    latestReply: string | null;
    commentRef: string | null;
    sourceType?: string | null;
  }> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        userId: scope.userId,
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
        platform: input.platform,
        sourceAccountId: String(input.accountId),
        // 2026-08-20 修复：对齐列表查询（559 行）——私信线索 sourceType='dm'，
        // 硬编码 'comment' 会导致私信回复永远查不到线索
        sourceType: { in: ['comment', 'dm'] },
      },
      select: {
        status: true,
        latestReply: true,
        commentRef: true,
        sourceText: true,
        sourceType: true,
      },
    });
    if (!lead) {
      throw new NotFoundException('线索不存在或无权操作');
    }
    if (lead.status !== 'approved') {
      throw new UnauthorizedException('线索尚未审核通过，不能发送回复');
    }
    if ((lead.sourceText ?? '').trim() !== input.commentText.trim()) {
      throw new UnauthorizedException('回复目标与已审核线索不一致');
    }
    return lead;
  }

  /**
   * 当评论页正是本系统发布出去的内容时，按受控的平台 URL 反查发布记录和
   * 文章 ID。查询没有命中并不伪造主键，仍保留 sourceUrl 作为弱归因证据。
   */
  private async resolveCommentSourceAttribution(
    scope: { tenantId: string | null; userId: string },
    platform: AcquisitionPlatform,
    accountId: number | string,
    sourceUrl?: string,
  ): Promise<{
    sourceUrl?: string;
    sourceArticleId?: string | null;
    sourcePublishRecordId?: string | null;
  }> {
    const normalizedUrl = sourceUrl?.trim();
    if (!normalizedUrl) return {};
    const publishRecord = (
      this.prisma as unknown as {
        publishRecord?: {
          findFirst?: (args: unknown) => Promise<{
            id: string;
            articleId: string;
          } | null>;
        };
      }
    ).publishRecord;
    if (!publishRecord?.findFirst) return { sourceUrl: normalizedUrl };

    const published = await publishRecord.findFirst({
      where: {
        userId: scope.userId,
        tenantId: scope.tenantId ?? 'legacy-local-desktop',
        platform,
        accountId: String(accountId),
        publishUrl: normalizedUrl,
      },
      select: { id: true, articleId: true },
    });
    return {
      sourceUrl: normalizedUrl,
      sourceArticleId: published?.articleId ?? null,
      sourcePublishRecordId: published?.id ?? null,
    };
  }
}
