import { Injectable, Logger } from '@nestjs/common';
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
}

const TOOL_ARG_SUMMARY_LEN = 500; // 审计参数摘要长度（避免存大对象）

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
    return {
      chatCount,
      chatLimit,
      toolCount,
      toolLimit,
      chatRemaining: Math.max(chatLimit - chatCount, 0),
      toolRemaining: Math.max(toolLimit - toolCount, 0),
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
