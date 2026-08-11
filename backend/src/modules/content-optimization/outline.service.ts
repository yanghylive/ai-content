import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { MultimodalService } from '../multimodal/multimodal.service';
import { DeFlavorService } from '../ai-flavor/de-flavor.service';
import { ContentReviewService } from '../content-review/content-review.service';
import type { ContentReviewResult } from '../content-review/content-reviewer';
import { detectAIFlavor } from '../ai-flavor/ai-flavor-detector';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * §3 图文大纲流水线（spec ref-repos-porting-spec-2026-08-11.md §3）
 *
 * 一句话 → 大纲(可编辑) → 逐页出图（SSE 进度）→ 断点重放不重复调 AI
 *
 * - POST /content-optimization/outline    : 一句话生成大纲
 * - POST /content-optimization/generate   : 大纲 → 逐页文案+配图（SSE）
 * - GET  /content-optimization/task/:id   : 重放已完成事件
 */

type OutlinePageType = 'cover' | 'content' | 'summary';

export interface OutlinePage {
  type: OutlinePageType;
  title: string;
  points: string[];
  imagePrompt?: string;
}

export interface GeneratedImagePage {
  index: number;
  type: OutlinePageType;
  heading: string;
  content: string;
  imagePrompt: string;
  imageFilename?: string | null;
  imageUrl?: string | null;
  status: 'pending' | 'done' | 'failed';
  error?: string | null;
}

export interface ImageGenTask {
  id: string;
  tenantId: string | null;
  userId: string;
  topic: string;
  status: 'generating' | 'completed' | 'failed';
  pages: GeneratedImagePage[];
  generated: GeneratedImagePage[];
  failed: GeneratedImagePage[];
  titles: string[];
  tags: string[];
  coverRef?: string | null;
  error?: string | null;
  /** P2 证据链：生成依据（topic/模型/审稿/去AI味/配图统计） */
  evidence?: Record<string, unknown> | null;
  /** P2 dry-run：完整内容快照（发布前预览） */
  preview?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_PAGE_COUNT = 5;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((v) => (typeof v === 'string' ? v : String(v)))
        .filter(Boolean)
    : [];
}

@Injectable()
export class OutlineService {
  private readonly logger = new Logger(OutlineService.name);
  private readonly promptsDir = join(__dirname, 'prompts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly aiClient: AiClientService,
    private readonly multimodal: MultimodalService,
    private readonly deFlavor?: DeFlavorService,
    private readonly contentReview?: ContentReviewService,
  ) {}

  async onModuleInit() {
    await this.ensureImageGenTables();
  }

  // ------------------------------------------------------------------
  // 1. 一句话 → 大纲（可编辑中间表示）
  // ------------------------------------------------------------------

  async generateOutline(
    topic: string,
    pageCount = DEFAULT_PAGE_COUNT,
  ): Promise<{ pages: OutlinePage[] }> {
    const modelId = await this.resolveDefaultModelId();
    const prompt = this.loadPrompt('outline_prompt.txt')
      .replaceAll('{topic}', topic)
      .replaceAll('{pageCount}', String(pageCount));

    const raw = await this.aiClient.generate(
      modelId,
      [
        {
          role: 'system',
          content:
            '你是资深图文内容主编，输出必须严格遵守用户指令的格式要求。',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.8, maxTokens: 3000 },
    );

    const pages = this.parseOutline(raw, pageCount);
    if (pages.length === 0) {
      throw new Error('AI 未返回有效大纲，请调整主题后重试');
    }
    return { pages };
  }

  // ------------------------------------------------------------------
  // 2. 大纲 → 逐页文案 + 配图（SSE 逐事件）
  // ------------------------------------------------------------------

  async generate(
    authUser: AuthenticatedUser,
    input: {
      topic: string;
      outline: OutlinePage[];
      /** P1 去 AI 味：文案生成后做检测+改写（默认开启，成本约 1 次额外 LLM 调用） */
      deFlavor?: boolean;
      /** P2 审稿门禁：生成完成后质量审稿+定向修订（默认开启） */
      review?: boolean;
    },
    response: Response,
  ): Promise<void> {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const send = (payload: unknown) => {
      try {
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* client 已断开 */
      }
    };

    const topic = (input.topic || '').trim();
    const outline = Array.isArray(input.outline) ? input.outline : [];
    if (!topic || outline.length === 0) {
      send({ type: 'error', message: '缺少主题或大纲' });
      response.end();
      return;
    }

    const taskId = `outline-${randomUUID()}`;
    const scope = await this.resolveScope();
    await this.createTask(taskId, scope, topic);

    try {
      const modelId = await this.resolveDefaultModelId();

      // 2a. 调 content_prompt 生成 标题×3 + 文案（每页含 imagePrompt）+ 标签
      send({ type: 'progress', stage: 'content', message: '正在生成文案与配图描述…' });
      const contentPrompt = this.loadPrompt('content_prompt.txt')
        .replaceAll('{topic}', topic)
        .replaceAll(
          '{outline}',
          outline
            .map(
              (p, i) =>
                `页${i + 1}(${p.type}): ${p.title}\n要点: ${(p.points || []).join('；')}`,
            )
            .join('\n'),
        );
      const contentRaw = await this.aiClient.generate(
        modelId,
        [
          {
            role: 'system',
            content: '你是爆款图文文案专家，只输出合法 JSON。',
          },
          { role: 'user', content: contentPrompt },
        ],
        { temperature: 0.9, maxTokens: 4000 },
      );
      const content = this.parseContentJson(contentRaw, outline.length);

      // P1 去 AI 味（可选后处理）：对每页文案做检测+改写，降低平台 AI 检测命中率
      if (input.deFlavor !== false && this.deFlavor) {
        send({ type: 'progress', stage: 'deflavor', message: '正在去除 AI 味，让内容更像真人写的…' });
        const deFlavored: string[] = [];
        for (const page of content.copywriting) {
          if (page.content && page.content.length >= 20) {
            try {
              const res = await this.deFlavor.deFlavor(page.content);
              if (res.pass && res.resultText !== page.content) {
                page.content = res.resultText;
                deFlavored.push(String(page.heading || page.title || ''));
              }
            } catch {
              /* 去 AI 味失败不阻断生成 */
            }
          }
        }
        if (deFlavored.length > 0) {
          this.logger.log(
            `[outline] 去 AI 味完成 ${deFlavored.length}/${content.copywriting.length} 页: ${deFlavored.join('、')}`,
          );
        }
      }

      // 2b. 逐页生图
      const pages: GeneratedImagePage[] = content.copywriting.map(
        (c, i) => ({
          index: i,
          type: c.type,
          heading: c.heading || c.title || '',
          content: c.content || '',
          imagePrompt: c.imagePrompt || '',
          status: 'pending' as const,
        }),
      );

      send({ type: 'titles', titles: content.titles, tags: content.tags });
      await this.updateTask(taskId, {
        titles: content.titles,
        tags: content.tags,
      });

      const generated: GeneratedImagePage[] = [];
      const failed: GeneratedImagePage[] = [];
      const total = pages.length;

      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        send({
          type: 'progress',
          stage: 'image',
          index: i,
          total,
          message: `正在生成第 ${i + 1}/${total} 页配图…`,
        });
        try {
          const result = await this.multimodal.generateImage(authUser, {
            prompt: page.imagePrompt || `${page.heading}，${topic}，精美配图`,
            size: page.type === 'cover' ? '1024*1024' : '768*1024',
          });
          page.imageFilename = result.filename;
          page.imageUrl = result.url;
          page.status = 'done';
          generated.push(page);
          send({
            type: 'page_done',
            index: i,
            page: {
              index: i,
              type: page.type,
              heading: page.heading,
              imageFilename: page.imageFilename,
              imageUrl: page.imageUrl,
            },
          });
        } catch (err) {
          page.status = 'failed';
          page.error = err instanceof Error ? err.message : String(err);
          failed.push(page);
          send({
            type: 'page_error',
            index: i,
            message: page.error,
          });
        }
        await this.updateTask(taskId, { pages, generated, failed });
      }

      const isAllFailed = failed.length === total;

      // P2 审稿门禁：生成完成后质量审稿（可跳过）
      let review: ContentReviewResult | null = null;
      if (input.review !== false && this.contentReview && !isAllFailed) {
        send({ type: 'progress', stage: 'review', message: '正在质量审稿…' });
        const flavorScore = detectAIFlavor(
          pages.map((p) => p.content).join('\n'),
        ).score;
        const result = await this.contentReview.reviewAndRevise({
          titles: content.titles,
          pages: pages.map((p) => ({
            type: p.type,
            heading: p.heading,
            content: p.content,
            imagePrompt: p.imagePrompt,
          })),
          pagesContent: pages.map((p) => p.content),
          pageTypes: pages.map((p) => p.type),
          generatedImageCount: generated.length,
          aiFlavorScore: flavorScore,
        });
        review = result.review;
        // 修订后的内容回写
        if (result.revised) {
          content.titles = result.titles;
          for (let i = 0; i < result.pages.length && i < pages.length; i += 1) {
            if (result.pages[i].content) {
              pages[i].content = result.pages[i].content;
              pages[i].heading = result.pages[i].heading;
            }
          }
        }
        this.logger.log(
          `[outline] 审稿完成: 质量分 ${review.score}${review.pass ? ' ✅' : ' ⚠️ 未达标'}（问题 ${review.issues.length} 条）`,
        );
      }

      // P2 证据链 + dry-run：记录生成依据与完整内容快照（可追溯、发布前预览）
      const evidence = {
        topic,
        generatedAt: new Date().toISOString(),
        modelId,
        pageCount: pages.length,
        deFlavorApplied: input.deFlavor !== false && this.deFlavor ? true : false,
        reviewScore: review?.score ?? null,
        reviewPass: review?.pass ?? null,
        reviewIssues: review?.issues.length ?? 0,
        imageSuccess: generated.length,
        imageFailed: failed.length,
      };
      const preview = {
        topic,
        titles: content.titles,
        tags: content.tags,
        pages: pages.map((p) => ({
          index: p.index,
          type: p.type,
          heading: p.heading,
          content: p.content,
          imageFilename: p.imageFilename ?? null,
          imageUrl: p.imageUrl ?? null,
        })),
      };

      await this.updateTask(taskId, {
        status: isAllFailed ? 'failed' : 'completed',
        pages,
        generated,
        failed,
        coverRef: generated.find((g) => g.type === 'cover')?.imageFilename ?? null,
        error: isAllFailed ? '全部页面配图失败' : null,
        evidence,
        preview,
      });

      send({
        type: 'evidence',
        evidence,
      });
      send({
        type: 'preview',
        preview,
      });

      send({
        type: 'complete',
        taskId,
        generated: generated.map((g) => ({
          index: g.index,
          type: g.type,
          heading: g.heading,
          imageFilename: g.imageFilename,
          imageUrl: g.imageUrl,
        })),
        failed: failed.map((f) => ({
          index: f.index,
          heading: f.heading,
          error: f.error,
        })),
        titles: content.titles,
        tags: content.tags,
        review: review
          ? {
              score: review.score,
              pass: review.pass,
              issues: review.issues.map((i) => ({
                dimension: i.dimension,
                severity: i.severity,
                message: i.message,
              })),
            }
          : undefined,
      });
      send({ type: 'finish' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`图文流水线失败: ${message}`);
      await this.updateTask(taskId, { status: 'failed', error: message });
      send({ type: 'error', message });
      send({ type: 'finish' });
    } finally {
      response.end();
    }
  }

  // ------------------------------------------------------------------
  // 3. 断点重放：GET /task/:id → 返回已落库状态，不重复调 AI
  // ------------------------------------------------------------------

  async getTask(taskId: string): Promise<ImageGenTask> {
    const scope = await this.resolveScope();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        tenant_id: string | null;
        user_id: string;
        topic: string;
        status: string;
        titles: string | null;
        tags: string | null;
        pages: string | null;
        generated: string | null;
        failed: string | null;
        cover_ref: string | null;
        error: string | null;
        evidence: string | null;
        preview: string | null;
        created_at: string | Date;
        updated_at: string | Date;
      }>
    >(Prisma.sql`
      SELECT * FROM image_gen_tasks
      WHERE id = ${taskId}
        AND user_id = ${scope.userId}
        AND ${scope.tenantId === null ? Prisma.sql`tenant_id IS NULL` : Prisma.sql`tenant_id = ${scope.tenantId}`}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) throw new NotFoundException('图文任务不存在');

    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      topic: row.topic,
      status: row.status as ImageGenTask['status'],
      pages: this.safeJson<GeneratedImagePage[]>(row.pages, []),
      generated: this.safeJson<GeneratedImagePage[]>(row.generated, []),
      failed: this.safeJson<GeneratedImagePage[]>(row.failed, []),
      titles: this.safeJson<string[]>(row.titles, []),
      tags: this.safeJson<string[]>(row.tags, []),
      coverRef: row.cover_ref,
      error: row.error,
      evidence: this.safeJson<Record<string, unknown> | null>(
        row.evidence,
        null,
      ),
      preview: this.safeJson<Record<string, unknown> | null>(row.preview, null),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // 解析容错链：直接 json.parse → 提取 ```json 代码块 → 截取首尾 {}
  // ------------------------------------------------------------------

  private parseContentJson(
    raw: string,
    expectedPages: number,
  ): {
    titles: string[];
    tags: string[];
    copywriting: Array<{
      type: OutlinePageType;
      title?: string;
      heading?: string;
      content: string;
      imagePrompt: string;
    }>;
  } {
    const text = raw.trim();
    let data: unknown = null;

    // 第一段：直接 parse
    try {
      data = JSON.parse(text);
    } catch {
      /* 继续下一段 */
    }

    // 第二段：提取 markdown ```json 代码块
    if (!data) {
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) {
        try {
          data = JSON.parse(fence[1].trim());
        } catch {
          /* 继续下一段 */
        }
      }
    }

    // 第三段：截取首尾 {}
    if (!data) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          data = JSON.parse(text.slice(start, end + 1));
        } catch {
          /* 全部失败 */
        }
      }
    }

    if (!data || typeof data !== 'object') {
      throw new Error('AI 文案输出解析失败（JSON 三段容错全部落空）');
    }

    const obj = data as Record<string, unknown>;
    const titles = asStringArray(obj.titles);
    const tags = asStringArray(obj.tags);
    const copywriting = Array.isArray(obj.copywriting)
      ? (obj.copywriting as Array<Record<string, unknown>>).map((c, i) => ({
          type: (c.type as OutlinePageType) || (i === 0 ? 'cover' : 'content'),
          title: typeof c.title === 'string' ? c.title : undefined,
          heading:
            typeof c.heading === 'string'
              ? c.heading
              : typeof c.title === 'string'
                ? c.title
                : '',
          content: typeof c.content === 'string' ? c.content : '',
          imagePrompt:
            typeof c.imagePrompt === 'string' ? c.imagePrompt : '',
        }))
      : [];

    // 页数不足时用大纲补位
    while (copywriting.length < expectedPages) {
      const i = copywriting.length;
      copywriting.push({
        type: i === expectedPages - 1 ? 'summary' : 'content',
        title: undefined,
        heading: `第 ${i + 1} 页`,
        content: '',
        imagePrompt: '',
      });
    }

    return { titles, tags, copywriting };
  }

  private parseOutline(raw: string, pageCount: number): OutlinePage[] {
    const text = raw.trim();
    if (!/<page>/i.test(text)) {
      // 没有 <page> 强分隔符 = 格式完全不符，返回空让上层报错
      return [];
    }
    const blocks = text
      .split(/<page>/i)
      .map((b) => b.trim())
      .filter(Boolean);

    const pages: OutlinePage[] = [];
    for (const block of blocks) {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) continue;

      const first = lines[0] || '';
      let type: OutlinePageType = 'content';
      if (/^\[封面\]/i.test(first)) type = 'cover';
      else if (/^\[总结\]/i.test(first)) type = 'summary';
      else if (/^\[内容\]/i.test(first)) type = 'content';

      const titleLine = lines.find((l) => /^(标题|小标题)[:：]/.test(l));
      const title = titleLine
        ? titleLine.replace(/^(标题|小标题)[:：]\s*/, '')
        : lines[1] || `第 ${pages.length + 1} 页`;

      const points = lines
        .filter((l) => /^(要点|点|内容)\d*[:：]/.test(l))
        .map((l) => l.replace(/^(要点|点|内容)\d*[:：]\s*/, ''));
      const visionLine = lines.find((l) => /^(主视觉|配图|画面)[:：]/.test(l));
      const imagePrompt = visionLine
        ? visionLine.replace(/^(主视觉|配图|画面)[:：]\s*/, '')
        : '';

      pages.push({ type, title, points, imagePrompt });
      if (pages.length >= pageCount) break;
    }

    return pages;
  }

  // ------------------------------------------------------------------
  // DB 辅助
  // ------------------------------------------------------------------

  private async ensureImageGenTables() {
    const databaseUrl = `${process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || ''}`;
    if (!databaseUrl.startsWith('file:')) return;

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS image_gen_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'generating',
        titles JSONB,
        tags JSONB,
        pages JSONB,
        generated JSONB,
        failed JSONB,
        cover_ref TEXT,
        error TEXT,
        evidence JSONB,
        preview JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // 兼容旧库（首次建表后新增的列）
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE image_gen_tasks ADD COLUMN evidence JSONB`,
    ).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE image_gen_tasks ADD COLUMN preview JSONB`,
    ).catch(() => undefined);
  }

  private async createTask(
    id: string,
    scope: { tenantId: string | null; userId: string },
    topic: string,
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO image_gen_tasks (id, tenant_id, user_id, topic, status, created_at, updated_at)
      VALUES (${id}, ${scope.tenantId}, ${scope.userId}, ${topic}, 'generating', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
  }

  private async updateTask(
    id: string,
    patch: {
      status?: string;
      titles?: string[];
      tags?: string[];
      pages?: GeneratedImagePage[];
      generated?: GeneratedImagePage[];
      failed?: GeneratedImagePage[];
      coverRef?: string | null;
      error?: string | null;
      evidence?: unknown;
      preview?: unknown;
    },
  ) {
    await this.prisma.$executeRaw`
      UPDATE image_gen_tasks
      SET
        status = ${patch.status ?? 'generating'},
        titles = ${patch.titles !== undefined ? JSON.stringify(patch.titles) : Prisma.sql`titles`},
        tags = ${patch.tags !== undefined ? JSON.stringify(patch.tags) : Prisma.sql`tags`},
        pages = ${patch.pages !== undefined ? JSON.stringify(patch.pages) : Prisma.sql`pages`},
        generated = ${patch.generated !== undefined ? JSON.stringify(patch.generated) : Prisma.sql`generated`},
        failed = ${patch.failed !== undefined ? JSON.stringify(patch.failed) : Prisma.sql`failed`},
        cover_ref = ${patch.coverRef !== undefined ? patch.coverRef : Prisma.sql`cover_ref`},
        error = ${patch.error !== undefined ? patch.error : Prisma.sql`error`},
        evidence = ${patch.evidence !== undefined ? JSON.stringify(patch.evidence) : Prisma.sql`evidence`},
        preview = ${patch.preview !== undefined ? JSON.stringify(patch.preview) : Prisma.sql`preview`},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `;
  }

  // ------------------------------------------------------------------
  // 通用辅助
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

  private async resolveDefaultModelId(): Promise<string> {
    const model = await this.prisma.aIModel.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (model?.id) return model.id;
    throw new Error('未配置可用的 AI 模型，请在「AI 模型设置」中同步');
  }

  private loadPrompt(filename: string): string {
    try {
      return readFileSync(join(this.promptsDir, filename), 'utf-8');
    } catch {
      throw new Error(`prompt 模板缺失: ${filename}`);
    }
  }

  private safeJson<T>(value: string | null, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
