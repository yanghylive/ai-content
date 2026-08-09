import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MEMORY_BUDGET_CHARS = 600; // 单次召回注入的总字符预算
const RECALL_TIMEOUT_MS = 5000; // 召回超时降级（绝不阻塞对话）

// ── MemoryCore（TencentDB Agent Memory 容器）远端记忆配置 ──────────
// 部署后注入：MEMORY_CORE_BASE_URL（如 http://127.0.0.1:8420）+
// MEMORY_CORE_USER_KEY（admin user_key，sk-mem-xxx）。未配置 → 本地模式。
const MEMORY_CORE_BASE_URL = (process.env.MEMORY_CORE_BASE_URL || '').replace(
  /\/+$/,
  '',
);
const MEMORY_CORE_USER_KEY = process.env.MEMORY_CORE_USER_KEY || '';
const MEMORY_CORE_ENABLED = Boolean(
  MEMORY_CORE_BASE_URL && MEMORY_CORE_USER_KEY,
);
const MEMORY_CORE_TIMEOUT_MS = 3500; // 远端调用超时（< RECALL_TIMEOUT_MS，保住本地降级）
const MEMORY_CORE_SERVICE_ID = 'default';

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
 *
 * 双模架构（2026-08-09 扩展）：
 *   - 配置 MEMORY_CORE_BASE_URL + MEMORY_CORE_USER_KEY → 远端模式：
 *     capture 双写（本地规则 + 远端 L0），recall 远端优先（LLM 抽取的 L1 原子记忆），
 *     远端失败/超时自动降级本地。
 *   - 未配置 → 纯本地模式（原行为不变）。
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * capture：对话后调用——存 L0 轮次 + 异步抽取 L1 原子记忆
   * （本地为轻量规则抽取；配置 MemoryCore 时双写远端，由远端 LLM 抽取 L1）
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
      // MemoryCore 远端双写（LLM 抽取 L1；失败/超时不阻塞对话）
      if (MEMORY_CORE_ENABLED) {
        void this.memoryCoreCapture(userId, userMsgs).catch((e) =>
          this.logger.warn(`MemoryCore capture 失败（已忽略）: ${e}`),
        );
      }
    } catch (error) {
      this.logger.warn(`capture 失败（不阻塞对话）: ${error}`);
    }
  }

  /**
   * recall：对话前调用——并行召回 persona + 相关记忆
   * 远端优先（MemoryCore LLM 抽取的 L1），失败/超时降级本地
   * 预算截断 + 超时降级（绝不阻塞主流程）
   */
  async recall(userId: string, query: string): Promise<MemoryRecallResult> {
    try {
      const result = await Promise.race([
        this.doRecallWithRemote(userId, query),
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

  /** 远端优先召回；远端不可用/无结果 → 降级本地 */
  private async doRecallWithRemote(
    userId: string,
    query: string,
  ): Promise<MemoryRecallResult> {
    if (MEMORY_CORE_ENABLED) {
      try {
        const remote = await this.memoryCoreRecall(userId, query);
        if (remote.persona.length > 0 || remote.relevant.length > 0) {
          return remote;
        }
        this.logger.debug('MemoryCore 无召回结果，降级本地');
      } catch (e) {
        this.logger.warn(`MemoryCore recall 失败，降级本地: ${e}`);
      }
    }
    return this.doRecall(userId, query);
  }

  // ═══ MemoryCore（TencentDB Agent Memory）远端访问 ═══════════════

  /** 远端 L0 写入：session_id 用 userId 隔离，MessagesCore 内部异步抽 L1 */
  private async memoryCoreCapture(
    userId: string,
    userMsgs: string[],
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEMORY_CORE_TIMEOUT_MS);
    try {
      const resp = await fetch(`${MEMORY_CORE_BASE_URL}/v2/conversation/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MEMORY_CORE_USER_KEY}`,
          'x-tdai-service-id': MEMORY_CORE_SERVICE_ID,
        },
        body: JSON.stringify({
          session_id: `user:${userId}`,
          messages: userMsgs.map((content) => ({
            role: 'user',
            content: content.slice(0, 8000),
          })),
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        this.logger.warn(
          `MemoryCore capture HTTP ${resp.status}: ${(await resp.text()).slice(0, 120)}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** 远端召回：搜 L0 原始对话（BM25 评分），映射 persona/relevant */
  private async memoryCoreRecall(
    userId: string,
    query: string,
  ): Promise<MemoryRecallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEMORY_CORE_TIMEOUT_MS);
    try {
      const resp = await fetch(
        `${MEMORY_CORE_BASE_URL}/v2/conversation/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MEMORY_CORE_USER_KEY}`,
            'x-tdai-service-id': MEMORY_CORE_SERVICE_ID,
          },
          body: JSON.stringify({
            query,
            session_id: `user:${userId}`,
            limit: 6,
          }),
          signal: controller.signal,
        },
      );
      if (!resp.ok) {
        throw new Error(`MemoryCore recall HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as {
        data?: { messages?: Array<{ content?: string; role?: string }> };
      };
      const hits = (json.data?.messages ?? [])
        .map((m) => (m.content || '').trim())
        .filter((c) => c.length >= 4)
        .slice(0, 6);
      if (hits.length === 0) {
        return { persona: [], relevant: [], fromCache: false };
      }
      // 远端结果按原文召回（L0），进 relevant 槽；budget 截断 120 字符
      const relevant: string[] = [];
      let budget = MEMORY_BUDGET_CHARS;
      for (const c of hits) {
        if (budget <= 0) break;
        const content = c.length > 120 ? `${c.slice(0, 120)}…` : c;
        relevant.push(content);
        budget -= content.length;
      }
      return { persona: [], relevant: relevant.slice(0, 5), fromCache: false };
    } finally {
      clearTimeout(timer);
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

  /** 记忆：写入用户行业画像（onboarding 用，persona 类型） */
  async savePersona(userId: string, industry: string): Promise<void> {
    if (!userId || !industry) return;
    const content = `用户行业：${industry}`;
    await this.prisma.userMemory.upsert({
      where: {
        userId_type_content: {
          userId,
          type: 'persona',
          content,
        },
      },
      create: {
        userId,
        type: 'persona',
        content,
        scene: 'onboarding',
        priority: 5,
      },
      update: { scene: 'onboarding', priority: 5 },
    });
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
