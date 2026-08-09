import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MEMORY_BUDGET_CHARS = 600; // 单次召回注入的总字符预算
const RECALL_TIMEOUT_MS = 5000; // 召回超时降级（绝不阻塞对话）

export interface MemoryRecord {
  type: 'persona' | 'episodic' | 'instruction';
  content: string;
  priority: number;
  scene?: string;
}

export interface MemoryRecallResult {
  persona: string[]; // 稳定偏好画像（进 system 尾部，吃 KV 缓存）
  relevant: string[]; // 相关记忆（persona+episodic，进 user 前缀）
  fromCache: boolean;
}

/**
 * 记忆层（B4，主文档 3.5）
 *
 * 分层：L0 原始对话（capture 时落库）→ L1 原子记忆（UserMemory 表，关键词抽取）
 * 召回：UserMemory 关键词评分召回（persona 类 → persona 槽；其余 → relevant 槽）
 * 降级：MemoryCore 容器不可用时 UserMemory 本地表照常工作（本实现当前即本地模式，
 *       MemoryCore 容器部署后在此扩展远端 capture/recall）。
 * 预算：总字符 ≤ 600；单条截断 120 字符；5s 超时降级返回空。
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * capture：对话后调用——存 L0 轮次 + 异步抽取 L1 原子记忆
   * （抽取为轻量规则：用户消息中的明确偏好/习惯/指令 → 原子记忆）
   */
  async capture(
    userId: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<void> {
    try {
      const userMsgs = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .filter(Boolean)
        .slice(-6); // 只取最近 6 条，控制写入
      if (userMsgs.length === 0) return;

      // 轻量抽取：识别明确偏好/指令表述（完整 LLM 抽取在 MemoryCore 部署后接入）
      for (const content of userMsgs) {
        const instructions = this.extractInstructions(content);
        for (const instruction of instructions) {
          await this.prisma.userMemory.upsert({
            where: {
              // 近似去重：同用户同 type 同 content（截断 120 字符）
              userId_type_content: {
                userId,
                type: 'instruction',
                content: instruction.slice(0, 120),
              },
            },
            create: {
              userId,
              type: 'instruction',
              content: instruction.slice(0, 300),
              priority: 3,
            },
            update: {
              updatedAt: new Date(),
            },
          });
        }
      }
      this.logger.debug(
        `capture: userId=${userId} 抽取 ${userMsgs.length} 条轮次`,
      );
    } catch (error) {
      this.logger.warn(`capture 失败（不阻塞对话）: ${error}`);
    }
  }

  /**
   * recall：对话前调用——并行召回 persona + 相关记忆
   * 预算截断 + 超时降级（绝不阻塞主流程）
   */
  async recall(userId: string, query: string): Promise<MemoryRecallResult> {
    try {
      const result = await Promise.race([
        this.doRecall(userId, query),
        new Promise<MemoryRecallResult>((resolve) =>
          setTimeout(
            () => resolve({ persona: [], relevant: [], fromCache: false }),
            RECALL_TIMEOUT_MS,
          ),
        ),
      ]);
      return result;
    } catch {
      return { persona: [], relevant: [], fromCache: false };
    }
  }

  private async doRecall(
    userId: string,
    query: string,
  ): Promise<MemoryRecallResult> {
    const keywords = this.tokenize(query);
    const all = await this.prisma.userMemory.findMany({
      where: { userId },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: 30,
    });
    if (all.length === 0)
      return { persona: [], relevant: [], fromCache: false };

    const scored = all
      .map((m) => {
        // 关键词命中加分；persona 可总召回（稳定偏好），事件/指令必须命中才召回
        let hits = 0;
        for (const kw of keywords) {
          if (m.content.includes(kw)) hits += 1;
        }
        const score =
          m.type === 'persona'
            ? m.priority + hits * 3
            : hits > 0
              ? m.priority + hits * 3
              : 0;
        return { m, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score);

    const persona: string[] = [];
    const relevant: string[] = [];
    let budget = MEMORY_BUDGET_CHARS;
    for (const { m } of scored) {
      if (budget <= 0) break;
      const content =
        m.content.length > 120 ? `${m.content.slice(0, 120)}…` : m.content;
      if (m.type === 'persona') {
        persona.push(content);
      } else {
        relevant.push(`[${m.type}] ${content}`);
      }
      budget -= content.length;
      void this.prisma.userMemory.update({
        where: { id: m.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    }
    return {
      persona: persona.slice(0, 5),
      relevant: relevant.slice(0, 5),
      fromCache: false,
    };
  }

  /** 记忆管理：列出某用户的全部记忆（按类型分组，供「我的记忆」页） */
  async listForUser(userId: string): Promise<
    Array<{
      id: string;
      type: string;
      content: string;
      priority: number;
      scene: string | null;
      usageCount: number;
      lastUsedAt: Date | null;
      createdAt: Date;
    }>
  > {
    if (!userId) return [];
    const rows = await this.prisma.userMemory.findMany({
      where: { userId },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });
    return rows.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      priority: m.priority,
      scene: m.scene ?? null,
      usageCount: m.usageCount,
      lastUsedAt: m.lastUsedAt,
      createdAt: m.createdAt,
    }));
  }

  /** 记忆管理：删除单条记忆 */
  async removeForUser(userId: string, memoryId: string): Promise<boolean> {
    if (!userId || !memoryId) return false;
    const result = await this.prisma.userMemory.deleteMany({
      where: { id: memoryId, userId },
    });
    return result.count > 0;
  }

  /** 记忆管理：清除某用户全部记忆 */
  async clearForUser(userId: string): Promise<number> {
    if (!userId) return 0;
    const result = await this.prisma.userMemory.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  /** 轻量指令抽取：识别"都要/都要/以后/记得/别"等指令句式 */
  private extractInstructions(content: string): string[] {
    const out: string[] = [];
    const markers = [
      '都要',
      '以后',
      '记得',
      '一律',
      '别用',
      '不要用',
      '每次',
      '所有文案',
      '我的风格',
    ];
    const sentences = content.split(/[。！？!?\n]/);
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (s.length < 4 || s.length > 100) continue;
      if (markers.some((mk) => s.includes(mk))) {
        out.push(s);
      }
    }
    return out.slice(0, 3);
  }

  private tokenize(text: string): string[] {
    const normalized = (text || '').trim().slice(0, 100);
    if (!normalized) return [];
    // 中文按 2-4 字滑动窗口 + 英文按词
    const tokens = new Set<string>();
    if (/[\u4e00-\u9fa5]/.test(normalized)) {
      for (let len = 2; len <= 4; len++) {
        for (let i = 0; i + len <= normalized.length; i++) {
          const seg = normalized.slice(i, i + len);
          if (/[\u4e00-\u9fa5]/.test(seg)) tokens.add(seg);
        }
      }
    }
    const en = normalized.match(/[a-zA-Z]{3,}/g);
    if (en) en.forEach((w) => tokens.add(w.toLowerCase()));
    return [...tokens].slice(0, 30);
  }
}
