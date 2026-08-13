import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditToolInput {
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  resultOk: boolean;
  errorMsg?: string;
  durationMs: number;
  confirmed?: boolean;
}

export interface QuotaStatus {
  chatCount: number;
  chatLimit: number;
  toolCount: number;
  toolLimit: number;
  chatRemaining: number;
  toolRemaining: number;
  tokenCount: number;
  tokenLimit: number;
  tokenRemaining: number;
}

const TOOL_ARG_SUMMARY_LEN = 500; // 审计参数摘要长度（避免存大对象）
const COMPLETION_SNAPSHOT_LEN = 2000; // AI 回复快照截断长度（质量评估够用，避免存大文本）

/**
 * AI 审计 + 配额（B6/P3，主文档 3.8 安全契约）
 *
 * 审计：ai_chat_logs（会话）+ ai_tool_call_logs（工具调用，含参数摘要/结果/耗时）
 * 配额：ai_usage_quotas 每用户每日对话/工具次数，超限返回配额状态供上层拒绝
 * Key 管理：千问/RedFox Key 仅存后端 env（现有约定，无需改）
 */
@Injectable()
export class AiAuditService {
  private readonly logger = new Logger(AiAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 记录一次对话会话（开始时可先占位，结束时补全） */
  async recordChat(input: {
    userId: string;
    sessionId?: string;
    model?: string;
    platform?: string;
    messages: number;
    toolCalls: number;
    status: 'ok' | 'error';
    errorMsg?: string;
    durationMs: number;
  }): Promise<void> {
    try {
      await this.prisma.aiChatLog.create({ data: input });
      await this.bumpChatCount(input.userId);
    } catch (error) {
      this.logger.warn(`记录对话审计失败: ${error}`);
    }
  }

  /** 记录一次工具调用 */
  async recordTool(input: AuditToolInput): Promise<void> {
    try {
      await this.prisma.aiToolCallLog.create({
        data: {
          userId: input.userId,
          tool: input.tool,
          argsJson: JSON.stringify(input.args ?? {}).slice(
            0,
            TOOL_ARG_SUMMARY_LEN,
          ),
          resultOk: input.resultOk,
          errorMsg: input.errorMsg ?? null,
          durationMs: input.durationMs,
          confirmed: input.confirmed ?? false,
        },
      });
      await this.bumpToolCount(input.userId);
    } catch (error) {
      this.logger.warn(`记录工具审计失败: ${error}`);
    }
  }

  /** 查配额状态（无记录则默认） */
  async getQuota(userId: string): Promise<QuotaStatus> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const row = await this.prisma.aiUsageQuota.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    const chatCount = row?.chatCount ?? 0;
    const chatLimit = row?.chatLimit ?? 50;
    const toolCount = row?.toolCount ?? 0;
    const toolLimit = row?.toolLimit ?? 100;
    const tokenCount = row?.tokenCount ?? 0;
    const tokenLimit = row?.tokenLimit ?? 2_000_000;
    return {
      chatCount,
      chatLimit,
      toolCount,
      toolLimit,
      chatRemaining: Math.max(chatLimit - chatCount, 0),
      toolRemaining: Math.max(toolLimit - toolCount, 0),
      tokenCount,
      tokenLimit,
      tokenRemaining: Math.max(tokenLimit - tokenCount, 0),
    };
  }

  /** 对话是否可用（配额检查，不扣减——由 recordChat 扣） */
  async canChat(userId: string): Promise<{ ok: boolean; quota: QuotaStatus }> {
    const quota = await this.getQuota(userId);
    return { ok: quota.chatRemaining > 0, quota };
  }

  /** 工具是否可用 */
  async canUseTool(
    userId: string,
  ): Promise<{ ok: boolean; quota: QuotaStatus }> {
    const quota = await this.getQuota(userId);
    return { ok: quota.toolRemaining > 0, quota };
  }

  /** Token 预检：预计消耗 estimatedTokens 是否在额度内（对标炼刀 /token/rpa/use/pre_check） */
  async canUseTokens(
    userId: string,
    estimatedTokens: number,
  ): Promise<{ ok: boolean; quota: QuotaStatus }> {
    const quota = await this.getQuota(userId);
    const need = Math.max(Math.floor(estimatedTokens), 0);
    return { ok: quota.tokenRemaining >= need, quota };
  }

  /** 记录 Token 消耗并上报（对标炼刀 /token/rpa/use/report） */
  async recordTokenUsage(input: {
    userId: string;
    tokens: number;
    tool?: string;
    scene?: string;
    refType?: string;
    refId?: string;
  }): Promise<void> {
    const tokens = Math.max(Math.floor(input.tokens), 0);
    try {
      if (tokens > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await this.prisma.aiUsageQuota.upsert({
          where: { userId_date: { userId: input.userId, date: today } },
          create: {
            userId: input.userId,
            date: today,
            tokenCount: tokens,
          },
          update: { tokenCount: { increment: tokens }, updatedAt: new Date() },
        });
      }
      // 明细：写入工具调用日志（带 token 消耗 + 场景），可追溯
      await this.prisma.aiToolCallLog.create({
        data: {
          userId: input.userId,
          tool: input.tool ?? 'token-usage',
          argsJson: JSON.stringify({
            scene: input.scene ?? 'unknown',
            refType: input.refType ?? null,
            refId: input.refId ?? null,
            tokens,
          }).slice(0, TOOL_ARG_SUMMARY_LEN),
          resultOk: true,
          durationMs: 0,
          tokensUsed: tokens,
        },
      });
    } catch (error) {
      this.logger.warn(`记录 Token 用量失败: ${error}`);
    }
  }

  /**
   * 记录一次 LLM 推理调用追踪（二期 P1：AI 质量观测）。
   * 补上「AI 回复缺量化评估」缺口——记录 prompt/completion 快照、模型、
   * 耗时、成败，供质量评估与失败原因排查。不阻塞主流程。
   */
  async recordTrace(input: {
    userId: string;
    tenantId?: string | null;
    scene: string;
    modelId?: string | null;
    modelName?: string | null;
    promptJson?: Prisma.InputJsonValue;
    completion?: string | null;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
    success?: boolean;
    errorMsg?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.aiCallTrace.create({
        data: {
          userId: input.userId,
          tenantId: input.tenantId ?? null,
          scene: input.scene,
          modelId: input.modelId ?? null,
          modelName: input.modelName ?? null,
          promptJson: input.promptJson ?? [],
          completion: input.completion
            ? input.completion.slice(0, COMPLETION_SNAPSHOT_LEN)
            : null,
          promptTokens: input.promptTokens ?? 0,
          completionTokens: input.completionTokens ?? 0,
          totalTokens: input.totalTokens ?? 0,
          latencyMs: input.latencyMs ?? 0,
          success: input.success ?? true,
          errorMsg: input.errorMsg ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`记录 AI 调用追踪失败: ${error}`);
    }
  }

  private async bumpChatCount(userId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.aiUsageQuota.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, chatCount: 1 },
      update: { chatCount: { increment: 1 }, updatedAt: new Date() },
    });
  }

  private async bumpToolCount(userId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.aiUsageQuota.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, toolCount: 1 },
      update: { toolCount: { increment: 1 }, updatedAt: new Date() },
    });
  }
}
