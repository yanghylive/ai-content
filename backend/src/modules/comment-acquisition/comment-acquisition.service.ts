import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import {
  ReplyEngineService,
  type CommentInput,
} from './reply-engine.service';
import { CircuitBreaker } from './circuit-breaker';

/**
 * CommentAcquisitionService —— 评论获客闭环
 *
 * 链路：关键词/账号监控 → 读取评论 → 潜客评分 → ReplyEngine 生成真人感回复
 *      → 审核队列（可选人工）→ 真实回复（CDP 会话）→ 潜客落库（CRM）
 *
 * 复用现有能力（零改动）：
 * - AutoUploadService.readDouyinComments / readWechatChannelComments（评论读取）
 * - PlatformInteractionExecutor.dispatch（真实回复执行）
 * - ReplyEngineService（AI 回复生成，人格池 + 策略）
 */

export type AcquisitionPlatform = 'douyin' | 'wechat-channel';
export type LeadStatus = 'pending' | 'approved' | 'replied' | 'skipped' | 'failed';

export interface AcquisitionLeadRow {
  id: string;
  tenant_id: string | null;
  user_id: string;
  platform: string;
  account_id: string;
  comment_text: string;
  commenter_name?: string | null;
  lead_score: number;
  signals?: string | null;
  reply_text?: string | null;
  persona_id?: string | null;
  status: string;
  error?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
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
  ) {}

  async onModuleInit() {
    await this.ensureAcquisitionTables();
  }

  /**
   * 扫描账号最新评论 → 潜客评分 → 生成回复 → 入库（pending 待审核/自动发）
   */
  async scanAccount(
    input: {
      platform: AcquisitionPlatform;
      accountId: number | string;
      limit?: number;
      autoReply?: boolean;
      minLeadScore?: number;
    },
  ): Promise<{
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
    const platformName =
      input.platform === 'douyin' ? '抖音' : '视频号';
    const minScore = input.minLeadScore ?? 45;
    const autoReply = input.autoReply ?? false;
    const circuitKey = `${input.platform}:${input.accountId}`;
    const circuit = this.circuitBreaker.getStatus(circuitKey);

    // 1. 读取评论（readDouyinComments 需要 number 类型 accountId）
    const numericAccountId = Number(input.accountId);
    const readResult =
      input.platform === 'douyin'
        ? await this.autoUpload.readDouyinComments({
            accountId: numericAccountId,
            limit: input.limit ?? 50,
          })
        : await this.autoUpload.readWechatChannelComments({
            accountId: numericAccountId,
            limit: input.limit ?? 50,
          });

    const comments = (readResult.comments || [])
      .map((c) => ({ text: String(c.text || '').trim() }))
      .filter((c) => c.text.length > 0);

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
      const leadId = `lead-${randomUUID()}`;

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

      // 4. 入库
      await this.prisma.$executeRaw`
        INSERT INTO comment_acquisition_leads (
          id, tenant_id, user_id, platform, account_id, comment_text,
          commenter_name, lead_score, signals, reply_text, persona_id,
          status, created_at, updated_at
        ) VALUES (
          ${leadId}, ${scope.tenantId}, ${scope.userId}, ${input.platform},
          ${String(input.accountId)}, ${comment.text},
          ${null}, ${score}, ${JSON.stringify(signals)}, ${replyText ?? null},
          ${personaId ?? null}, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;

      // 5. 自动回复（可选；熔断中则跳过发送，标记 pending 待人工）
      let status = 'pending';
      if (autoReply && replyText) {
        if (circuit.open) {
          this.logger.warn(
            `[comment-acquisition] ${platformName} 账号 ${input.accountId} 触发风控熔断，跳过自动回复（${circuit.retryAfterSeconds}s 后重试）`,
          );
          status = 'pending';
        } else {
          const dispatched = await this.dispatchReply(
            leadId,
            {
              platform: input.platform,
              accountId: input.accountId,
              commentText: comment.text,
              replyText,
              sourceTitle: readResult.title || undefined,
            },
            scope,
            circuitKey,
          );
          if (dispatched) {
            status = 'replied';
            replies += 1;
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
    },
    scope?: { tenantId: string | null; userId: string },
    circuitKey?: string,
  ): Promise<boolean> {
    const resolvedScope = scope ?? (await this.resolveScope());
    const key = circuitKey ?? `${input.platform}:${input.accountId}`;
    try {
      const result = await this.interactionExecutor.dispatch({
        platform: input.platform,
        taskType: 'comment-reply',
        action: 'send',
        accountId: input.accountId,
        targetText: input.commentText,
        sourceText: input.commentText,
        videoTitle: input.sourceTitle,
        replyText: input.replyText,
      });

      const ok = result.status === 'sent';
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
      await this.prisma.$executeRaw`
        UPDATE comment_acquisition_leads
        SET status = ${ok ? 'replied' : 'failed'},
          error = ${ok ? null : result.message},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${leadId}
          AND user_id = ${resolvedScope.userId}
      `;
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
      await this.prisma.$executeRaw`
        UPDATE comment_acquisition_leads
        SET status = 'failed', error = ${message}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${leadId}
          AND user_id = ${resolvedScope.userId}
      `;
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
    const where = Prisma.sql`
      WHERE user_id = ${scope.userId}
        AND ${scope.tenantId === null ? Prisma.sql`tenant_id IS NULL` : Prisma.sql`tenant_id = ${scope.tenantId}`}
        ${input.platform ? Prisma.sql`AND platform = ${input.platform}` : Prisma.empty}
        ${input.status ? Prisma.sql`AND status = ${input.status}` : Prisma.empty}
    `;

    const rows = await this.prisma.$queryRaw<AcquisitionLeadRow[]>(
      Prisma.sql`SELECT * FROM comment_acquisition_leads ${where} ORDER BY created_at DESC LIMIT ${input.limit ?? 50} OFFSET ${input.offset ?? 0}`,
    );
    const countRows = await this.prisma.$queryRaw<
      Array<{ total: number }>
    >(Prisma.sql`SELECT COUNT(*) as total FROM comment_acquisition_leads ${where}`);

    return { items: rows, total: countRows[0]?.total ?? 0 };
  }

  /** 人工审核：通过 → 待回复；跳过 */
  async reviewLead(
    leadId: string,
    input: { action: 'approve' | 'skip'; replyText?: string },
  ): Promise<{ status: string }> {
    const scope = await this.resolveScope();
    const status = input.action === 'approve' ? 'approved' : 'skipped';
    await this.prisma.$executeRaw`
      UPDATE comment_acquisition_leads
      SET status = ${status},
        reply_text = ${input.replyText ?? Prisma.sql`reply_text`},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${leadId}
        AND user_id = ${scope.userId}
    `;
    return { status };
  }

  // ------------------------------------------------------------------
  // 私有
  // ------------------------------------------------------------------

  private async ensureAcquisitionTables() {
    const databaseUrl = `${process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || ''}`;
    if (!databaseUrl.startsWith('file:')) return;

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS comment_acquisition_leads (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        comment_text TEXT NOT NULL,
        commenter_name TEXT,
        lead_score INTEGER NOT NULL DEFAULT 0,
        signals JSONB,
        reply_text TEXT,
        persona_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS comment_acquisition_leads_user_idx
      ON comment_acquisition_leads(user_id, created_at DESC)
    `);
  }

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
}
