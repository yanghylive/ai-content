/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface UploadBrandKnowledgeInput {
  title: string;
  content: string;
  type?: 'brand' | 'product' | 'copy' | 'manual';
  tags?: string[];
  source?: string;
}

const KNOWLEDGE_TYPES = ['brand', 'product', 'copy', 'manual'];

const MAX_CONTENT_LENGTH = 200_000; // 单条知识 ≤ 200KB

/**
 * 品牌知识库（D1）：用户上传产品/品牌资料 → AI 创作时按选题相关度召回引用。
 * 数据按 user 隔离；检索用关键词命中（title/content/tags），返回 Top N。
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upload(
    authUser: AuthenticatedUser,
    input: UploadBrandKnowledgeInput,
  ) {
    const title = input.title?.trim();
    const content = input.content?.trim();
    if (!title) throw new BadRequestException('知识条目标题不能为空');
    if (!content) throw new BadRequestException('知识条目内容不能为空');
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(
        `知识内容过长（最多 ${MAX_CONTENT_LENGTH} 字符）`,
      );
    }
    const type = input.type && KNOWLEDGE_TYPES.includes(input.type)
      ? input.type
      : 'brand';
    const tags = Array.isArray(input.tags)
      ? input.tags.filter((tag) => typeof tag === 'string' && tag.trim()).slice(0, 20)
      : [];

    const row = await this.prisma.brandKnowledge.create({
      data: {
        userId: authUser.id,
        title,
        content,
        type,
        tags,
        source: input.source?.trim() || 'text',
        metadata: { createdAtSource: 'web' },
      },
    });

    return {
      id: row.id,
      title: row.title,
      type: row.type,
      tags: row.tags,
      createdAt: row.createdAt,
    };
  }

  async list(authUser: AuthenticatedUser, options: { type?: string } = {}) {
    const rows = await this.prisma.brandKnowledge.findMany({
      where: {
        userId: authUser.id,
        ...(options.type && KNOWLEDGE_TYPES.includes(options.type)
          ? { type: options.type }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        type: true,
        tags: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows;
  }

  async remove(authUser: AuthenticatedUser, id: string) {
    const row = await this.prisma.brandKnowledge.findUnique({ where: { id } });
    if (!row) throw new BadRequestException('知识条目不存在');
    if (row.userId !== authUser.id) {
      throw new ForbiddenException('无权删除他人的知识条目');
    }
    await this.prisma.brandKnowledge.delete({ where: { id } });
    return { id, message: '知识条目已删除' };
  }

  /**
   * 按选题相关度召回 Top N 知识条目（title/content/tags 关键词命中 + 新鲜度排序）。
   * 供 content_generate 工具与 AI 对话注入使用；命中为空返回空数组。
   */
  async recall(
    authUser: AuthenticatedUser,
    query: string,
    limit = 3,
  ): Promise<
    Array<{ id: string; title: string; content: string; type: string; tags: unknown }>
  > {
    const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0) return [];

    const rows = await this.prisma.brandKnowledge.findMany({
      where: { userId: authUser.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const scored = rows
      .map((row) => {
        const haystack = `${row.title}\n${row.content}\n${Array.isArray(row.tags) ? row.tags.join('\n') : ''}`.toLocaleLowerCase();
        let score = 0;
        for (const keyword of keywords) {
          if (haystack.includes(keyword)) score += keyword.length > 2 ? 2 : 1;
        }
        return { row, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);

    return scored.map(({ row }) => ({
      id: row.id,
      title: row.title,
      content: row.content.slice(0, 2000),
      type: row.type,
      tags: row.tags,
    }));
  }

  private extractKeywords(query: string): string[] {
    const cleaned = query
      .replace(/[，。！？、；：""''（）\n\t]/g, ' ')
      .toLocaleLowerCase();
    const words = cleaned
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2 && word.length <= 24);
    // 去重保序
    return Array.from(new Set(words)).slice(0, 12);
  }
}
