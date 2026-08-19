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
import { InteractionEventStore } from '../interaction/interaction-event.store';

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
  'pending' | 'approved' | 'replied' | 'skipped' | 'failed';

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
    await this.assertAccountOwnership(input.accountId, scope);
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

    // 1. 读取评论：统一走互动适配器契约（registry.read），消除三平台分支
    const adapter = this.interactionRegistry.get(input.platform);
    if (!adapter.read) {
      throw new Error(`平台 ${input.platform} 的互动适配器不支持读取评论`);
    }
    const readResult = await adapter.read({
      platform: input.platform,
      taskType: 'comment-reply',
      accountId: input.accountId,
      limit: input.limit ?? 50,
    });

    const comments = (readResult.items ?? [])
      .map((item, i) => ({
        item,
        text: item.text.trim(),
        // 小红书通知条目序号（回复定位用）；其他平台无此概念
        commentIndex:
          input.platform === 'xiaohongshu' ? Number(item.ref ?? i) : undefined,
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
    const replies = 0;

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

      // 6. 自动回复（可选；熔断中则跳过发送，标记 pending 待人工）
      let status = 'pending';
      // 扫描阶段只允许生成待审核线索；真实外发必须由 approved Lead 经过
      // dispatchReply 的后端门禁触发。autoReply 仅保留兼容参数，不得绕过审批。
      if (autoReply && replyText) {
        if (circuit.open) {
          this.logger.warn(
            `[comment-acquisition] ${platformName} 账号 ${input.accountId} 触发风控熔断，跳过自动回复（${circuit.retryAfterSeconds}s 后重试）`,
          );
          status = 'pending';
        } else {
          this.logger.log(
            `[comment-acquisition] lead=${leadId} 已生成回复，等待人工审核后发送`,
          );
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
    // 平台兜底：未传 platform 时按账号 type 推断（2=视频号、其余=抖音），
    // 避免前端漏传导致误走视频号分支报「视频号账号未登录」。
    let platform: 'douyin' | 'wechat-channel' =
      input.platform === 'douyin'
        ? 'douyin'
        : input.platform === 'wechat-channel'
          ? 'wechat-channel'
          : (undefined as unknown as 'douyin');
    if (!platform) {
      const accounts = await this.autoUpload.listAccounts({
        ids: [Number(input.accountId)],
      });
      platform = accounts?.[0]?.type === 2 ? 'wechat-channel' : 'douyin';
    }
    // P1 复核（全面审查）：scanDm 真实发私信前必须账号归属校验——
    // 对齐 scanAccount（94 行），防凭他人 accountId 读私信并对他人账号自动回复
    await this.assertAccountOwnership(input.accountId, scope);
    const platformName = platform === 'douyin' ? '抖音' : '视频号';
    const minScore = input.minLeadScore ?? 45;
    const autoReply = input.autoReply ?? false;
    const circuitKey = `${platform}:${input.accountId}`;
    const circuit = this.circuitBreaker.getStatus(circuitKey);

    const numericAccountId = Number(input.accountId);
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
    const replies = 0;

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
      // 私信扫描同样不得因 autoReply 参数绕过人工审批。
      if (autoReply && replyText) {
        if (circuit.open) {
          status = 'pending';
        } else {
          this.logger.log(
            `[comment-acquisition] lead=${leadId} 已生成私信回复，等待人工审核后发送`,
          );
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

  /** 私信回复执行（走通用 dispatch direct-message-reply） */
  private async dispatchDm(
    leadId: string,
    input: {
      platform: 'douyin' | 'wechat-channel';
      accountId: number | string;
      messageText: string;
      replyText: string;
    },
    scope: { tenantId: string | null; userId: string },
    circuitKey: string,
  ): Promise<boolean> {
    try {
      const result = await this.interactionExecutor.dispatch({
        platform: input.platform,
        taskType: 'direct-message-reply',
        action: 'send',
        accountId: input.accountId,
        targetText: input.messageText,
        sourceText: input.messageText,
        replyText: input.replyText,
      });

      const ok = result.status === 'sent';
      if (ok) {
        this.circuitBreaker.recordSuccess(circuitKey);
      } else {
        const opened = this.circuitBreaker.recordFailure(circuitKey);
        if (opened) {
          this.logger.warn(
            `[comment-acquisition] ${circuitKey} 私信触发风控熔断：窗口内失败 ≥3 次`,
          );
        }
      }
      await this.leadRepository.updateReplyStatus(leadId, {
        userId: scope.userId,
        status: ok ? 'replied' : 'failed',
        lastError: ok ? null : (result.message ?? null),
        repliedAt: ok ? new Date() : null,
      });
      return ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.circuitBreaker.recordFailure(circuitKey);
      this.logger.error(
        `[comment-acquisition] 私信回复执行失败 lead=${leadId}: ${message}`,
      );
      await this.leadRepository.updateReplyStatus(leadId, {
        userId: scope.userId,
        status: 'failed',
        lastError: message,
      });
      return false;
    }
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
    },
    scope?: { tenantId: string | null; userId: string },
    circuitKey?: string,
  ): Promise<boolean> {
    const resolvedScope = scope ?? (await this.resolveScope());
    await this.assertAccountOwnership(input.accountId, resolvedScope);
    const lead = await this.assertReplyLead(leadId, input, resolvedScope);
    // 防止调用方篡改回复内容：已审核线索的回复只能使用当前落库版本。
    const replyText = input.replyText.trim();
    if (
      !replyText ||
      (lead.latestReply && lead.latestReply.trim() !== replyText)
    ) {
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
      const adapter = this.interactionRegistry.get(input.platform);
      const result = (await adapter.send?.({
        platform: input.platform,
        taskType: 'comment-reply',
        accountId: input.accountId,
        targetText: input.commentText,
        sourceText: input.commentText,
        videoTitle: input.sourceTitle,
        commentRef: xhsIndex !== undefined ? String(xhsIndex) : undefined,
        replyText,
      })) ?? {
        status: 'failed' as const,
        message: '该平台未实现回复能力',
        evidenceUrl: undefined,
      };

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
  ): Promise<void> {
    const id = String(accountId);
    const account = await this.prisma.publishAccount.findFirst({
      where: {
        id,
        userId: scope.userId,
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('发布账号不存在或无权操作');
    }
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
  }> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        userId: scope.userId,
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
        platform: input.platform,
        sourceAccountId: String(input.accountId),
        sourceType: 'comment',
      },
      select: {
        status: true,
        latestReply: true,
        commentRef: true,
        sourceText: true,
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
