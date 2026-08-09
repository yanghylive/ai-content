import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateContentVersionCommentDto,
  CreateContentVersionFeedbackDto,
  CreateContentDraftDto,
  CreatePublishIntentDto,
  ManualReviewVersionDto,
  QueryContentVersionsDto,
  SaveContentVersionDto,
  SetOfficialVersionDto,
} from './dto/content-version.dto';
import { RewriteDto } from './dto/rewrite.dto';
import { TitleScoreDto } from './dto/title-score.dto';
import { XhsNoteOptimizeDto } from './dto/xhs-note-optimize.dto';
import type {
  OptimizationHitItem,
  OptimizationPlatform,
  RewriteResult,
  RewriteVariant,
  TitleQualityLevel,
  TitleScoreResult,
  WorkflowTrace,
  XhsNoteOptimizationResult,
} from './content-optimization.types';

const HOOK_TERMS = [
  '避坑',
  '清单',
  '方法',
  '复盘',
  '对比',
  '指南',
  '模板',
  '案例',
  '新手',
  '低粉',
  '爆款',
];
const TITLE_RISK_TERMS = [
  '最',
  '第一',
  '绝对',
  '保证',
  '稳赚',
  '根治',
  '全网唯一',
];
const XHS_DEFAULT_TAGS = ['小红书运营', '内容创作', '获客增长', 'AI工具'];
const CONTENT_RISK_LEVELS = ['pass', 'low', 'medium', 'high'] as const;

type ContentOwnerScope = {
  tenantId: string | null;
  userId: string;
};

type RawContentDraftRow = {
  id: string;
  tenant_id?: string | null;
  user_id: string;
  source_type?: string | null;
  source_id?: string | null;
  title: string;
  content: string;
  platform: OptimizationPlatform;
  target_type: string;
  status: string;
  official_version_id?: string | null;
  metadata?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type RawContentVersionRow = {
  id: string;
  draft_id: string;
  run_id?: string | null;
  tenant_id?: string | null;
  user_id: string;
  mode: string;
  mode_label: string;
  title: string;
  content: string;
  platform: OptimizationPlatform;
  target_type: string;
  version_no: number;
  status: string;
  is_official: number | boolean;
  source_workflow_id?: string | null;
  source_summary?: string | null;
  compliance_check_id?: string | null;
  compliance_risk_level?: string | null;
  compliance_risk_score?: number | null;
  compliance_summary?: string | null;
  compliance_checked_at?: string | Date | null;
  manual_review_count?: bigint | number | null;
  manual_review_note?: string | null;
  manual_reviewed_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type RawPublishIntentRow = {
  id: string;
  version_id: string;
  tenant_id?: string | null;
  user_id: string;
  platform: OptimizationPlatform;
  title: string;
  content: string;
  status: string;
  scheduled_at?: string | Date | null;
  metadata?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type RawComplianceVerificationRow = {
  id: string;
  tenant_id?: string | null;
  user_id: string;
  target_id?: string | null;
  risk_level: string;
  risk_score?: number | null;
  summary?: string | null;
  checked_at: string | Date;
  status: string;
};

type RawVersionFeedbackRow = {
  id: string;
  version_id: string;
  publish_intent_id?: string | null;
  tenant_id?: string | null;
  user_id: string;
  platform: OptimizationPlatform;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  leads: number;
  note?: string | null;
  metadata?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type RawVersionCommentRow = {
  id: string;
  version_id: string;
  tenant_id?: string | null;
  user_id: string;
  body: string;
  author_name?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

@Injectable()
export class ContentOptimizationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  async onModuleInit() {
    await this.ensureCommercialTables();
  }

  scoreTitle(dto: TitleScoreDto): TitleScoreResult {
    const title = this.clean(dto.title);
    const platform = this.normalizePlatform(dto.platform);
    const keywords = this.normalizeList(dto.keywords);
    const lengthScore = this.scoreTitleLength(title, platform);
    const keywordScore = this.scoreKeywordCoverage(title, keywords);
    const hookScore = this.scoreHook(title);
    const clarityScore = this.scoreClarity(title);
    const riskScore = this.scoreTitleRisk(title);
    const overallScore = this.clamp(
      Math.round(
        lengthScore * 0.24 +
          keywordScore * 0.2 +
          hookScore * 0.24 +
          clarityScore * 0.22 +
          riskScore * 0.1,
      ),
    );
    const hitItems = this.buildTitleHitItems(title, keywords);

    return {
      workflowId: this.makeWorkflowId('title-score'),
      platform,
      originalTitle: title,
      overallScore,
      qualityLevel: this.toQualityLevel(overallScore),
      dimensions: [
        {
          key: 'length',
          label: '长度适配',
          score: lengthScore,
          evidence: this.titleLengthEvidence(title, platform),
        },
        {
          key: 'keywords',
          label: '关键词覆盖',
          score: keywordScore,
          evidence: keywords.length
            ? `命中 ${this.countKeywordHits(title, keywords)}/${keywords.length} 个目标词`
            : '未传入目标关键词，按通用搜索意图评分',
        },
        {
          key: 'hook',
          label: '点击钩子',
          score: hookScore,
          evidence: this.findHookTerms(title).length
            ? `包含 ${this.findHookTerms(title).join('、')}`
            : '缺少清晰钩子词或结构承诺',
        },
        {
          key: 'clarity',
          label: '表达清晰度',
          score: clarityScore,
          evidence:
            title.includes('，') || title.includes('：')
              ? '标题有明确停顿或结构分层'
              : '标题可以补充对象、场景或结果',
        },
        {
          key: 'platformRisk',
          label: '平台风险',
          score: riskScore,
          evidence: this.findRiskTerms(title).length
            ? `疑似夸大词：${this.findRiskTerms(title).join('、')}`
            : '未发现明显夸大承诺词',
        },
      ],
      hitItems,
      suggestions: this.buildTitleSuggestions(title, keywords, platform),
      rewriteCandidates: this.buildTitleCandidates(title, keywords, dto.goal),
      workflow: this.workflow(
        '小红书/公众号标题生成与评分',
        'ContentOptimizationService.scoreTitle',
      ),
    };
  }

  rewrite(dto: RewriteDto): RewriteResult {
    const content = this.cleanMultiline(dto.content);
    const platform = this.normalizePlatform(dto.platform);
    const tone = this.clean(dto.tone || this.defaultTone(platform));
    const goals = this.normalizeList(dto.goals);
    const primary = this.buildRewrite(content, tone, platform, goals);
    const variants: RewriteVariant[] = [
      {
        label: '稳健转化版',
        title: '先讲结果，再给路径',
        content: primary,
        highlight: '适合文章、公众号和销售承接页，表达更克制。',
      },
      {
        label: '小红书种草版',
        title: '痛点开场 + 清单式建议',
        content: this.buildRewrite(
          content,
          '真实经验分享',
          'xiaohongshu',
          goals,
        ),
        highlight: '适合笔记草稿，用场景和体验增强可信度。',
      },
      {
        label: '短视频口播版',
        title: '前三秒抛问题',
        content: this.buildRewrite(content, '短句口播', 'douyin', goals),
        highlight: '适合视频脚本，句子更短，节奏更快。',
      },
    ];

    return {
      workflowId: this.makeWorkflowId('rewrite'),
      platform,
      originalContent: content,
      rewrittenContent: primary,
      variants,
      changes: [
        '将开头改成问题或结果导向，降低用户理解成本',
        '把长句拆成可扫描段落，方便多平台复用',
        dto.keepFacts === false
          ? '允许表达重组，事实仍需人工复核'
          : '保留原始事实信息，只优化表达顺序和语气',
      ],
      suggestions: [
        '可继续生成更贴近目标平台的表达版本',
        '发布前建议做一次风险检查，避免夸大承诺和诱导私信表达',
      ],
      workflow: this.workflow(
        '多平台文案风格改写',
        'ContentOptimizationService.rewrite',
      ),
    };
  }

  optimizeXhsNote(dto: XhsNoteOptimizeDto): XhsNoteOptimizationResult {
    const content = this.cleanMultiline(dto.content);
    const originalTitle = this.clean(dto.title || '');
    const hashtags = this.normalizeList(dto.hashtags);
    const targetAudience = this.clean(
      dto.targetAudience || '正在寻找实操方法的内容运营者',
    );
    const goal = this.clean(dto.optimizationGoal || '收藏和咨询');
    const titleBase =
      originalTitle ||
      this.extractFirstSentence(content) ||
      '这套内容优化方法值得收藏';
    const optimizedTitle = this.makeXhsTitle(titleBase, goal);
    const opening = `如果你也在纠结「${targetAudience}」到底该怎么把内容做出效果，先看这 3 个检查点。`;
    const body = [
      `1. 先明确用户当下的问题：${this.extractPainPoint(content)}`,
      '2. 再把解决方案写成可执行步骤，避免只讲概念。',
      '3. 最后补上适合评论区承接的问题，让用户知道下一步可以问什么。',
      '',
      this.trimForNote(content),
    ].join('\n');
    const optimizedTags = this.unique([...hashtags, ...XHS_DEFAULT_TAGS]).slice(
      0,
      8,
    );

    return {
      workflowId: this.makeWorkflowId('xhs-note-optimize'),
      original: {
        title: originalTitle || undefined,
        content,
        hashtags,
      },
      optimized: {
        title: optimizedTitle,
        opening,
        body,
        hashtags: optimizedTags,
        callToAction:
          '想要我帮你把现有文案拆成可发布的小红书结构，可以把主题打在评论区，我来给你一个优化方向。',
      },
      score: {
        overall: 82,
        coverHook: 84,
        searchKeyword: optimizedTags.length >= 4 ? 86 : 72,
        trustBuilding: content.length > 120 ? 80 : 68,
        interactionIntent: 88,
      },
      hitItems: [
        {
          type: 'structure',
          text: '痛点开场',
          reason: '先承接用户问题，再进入方法，降低跳出率',
        },
        {
          type: 'keyword',
          text: optimizedTags.slice(0, 3).join('、'),
          reason: '补充平台搜索和推荐可识别标签',
        },
        { type: 'hook', text: goal, reason: '围绕优化目标强化收藏或咨询动作' },
      ],
      suggestions: [
        '封面建议使用“问题 + 数字清单”结构，例如：内容没转化？先查这 3 点',
        '正文每段保持 2-3 行，重点词可以单独成行',
        '发布前建议结合账号定位再做一次标题和标签确认',
      ],
      workflow: this.workflow(
        '小红书笔记优化助手',
        'ContentOptimizationService.optimizeXhsNote',
      ),
    };
  }

  async createDraft(dto: CreateContentDraftDto) {
    const scope = await this.resolveScope();
    const id = this.makeCommercialId('draft');
    const platform = this.normalizePlatform(dto.platform);
    const targetType = this.clean(dto.targetType || 'article');
    const now = new Date().toISOString();

    await this.prisma.$executeRaw`
      INSERT INTO content_drafts (
        id, tenant_id, user_id, source_type, source_id, title, content,
        platform, target_type, status, metadata, created_at, updated_at
      )
      VALUES (
        ${id}, ${scope.tenantId}, ${scope.userId}, ${dto.sourceType || null},
        ${dto.sourceId || null}, ${this.clean(dto.title)}, ${this.cleanMultiline(dto.content)},
        ${platform}, ${targetType}, 'draft', ${JSON.stringify({})}, ${now}, ${now}
      )
    `;

    await this.writeEvidence('content_draft', id, 'create_draft', {
      title: dto.title,
      platform,
      targetType,
    });

    return this.getDraft(id);
  }

  async getDraft(id: string) {
    const scope = await this.resolveScope();
    const rows =
      scope.tenantId === null
        ? await this.prisma.$queryRaw<RawContentDraftRow[]>`
            SELECT * FROM content_drafts
            WHERE id = ${id} AND user_id = ${scope.userId} AND tenant_id IS NULL
            LIMIT 1
          `
        : await this.prisma.$queryRaw<RawContentDraftRow[]>`
            SELECT * FROM content_drafts
            WHERE id = ${id} AND user_id = ${scope.userId} AND tenant_id = ${scope.tenantId}
            LIMIT 1
          `;
    const row = rows[0];
    if (!row) throw new NotFoundException('草稿不存在');
    return this.mapDraft(row);
  }

  async listVersions(query: QueryContentVersionsDto = {}) {
    const scope = await this.resolveScope();
    const conditions: Prisma.Sql[] = [
      Prisma.sql`v.user_id = ${scope.userId}`,
      scope.tenantId === null
        ? Prisma.sql`v.tenant_id IS NULL`
        : Prisma.sql`v.tenant_id = ${scope.tenantId}`,
      scope.tenantId === null
        ? Prisma.sql`d.tenant_id IS NULL`
        : Prisma.sql`d.tenant_id = ${scope.tenantId}`,
    ];

    if (query.draftId) {
      conditions.push(Prisma.sql`v.draft_id = ${query.draftId}`);
    }

    if (query.sourceType) {
      conditions.push(Prisma.sql`d.source_type = ${query.sourceType}`);
    }

    if (query.sourceId) {
      conditions.push(Prisma.sql`d.source_id = ${query.sourceId}`);
    }

    if (query.platform) {
      conditions.push(Prisma.sql`v.platform = ${query.platform}`);
    }

    if (query.status) {
      conditions.push(Prisma.sql`v.status = ${query.status}`);
    }

    const rows = await this.prisma.$queryRaw<RawContentVersionRow[]>(Prisma.sql`
      SELECT
        v.*,
        (
          SELECT COUNT(*)
          FROM content_manual_reviews r
          WHERE r.version_id = v.id AND r.user_id = v.user_id
        ) AS manual_review_count,
        (
          SELECT r.note
          FROM content_manual_reviews r
          WHERE r.version_id = v.id AND r.user_id = v.user_id
          ORDER BY r.created_at DESC
          LIMIT 1
        ) AS manual_review_note,
        (
          SELECT r.created_at
          FROM content_manual_reviews r
          WHERE r.version_id = v.id AND r.user_id = v.user_id
          ORDER BY r.created_at DESC
          LIMIT 1
        ) AS manual_reviewed_at
      FROM content_versions v
      INNER JOIN content_drafts d
        ON d.id = v.draft_id
        AND d.user_id = v.user_id
        AND (
          d.tenant_id = v.tenant_id
          OR (d.tenant_id IS NULL AND v.tenant_id IS NULL)
        )
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY v.updated_at DESC
      LIMIT 50
    `);

    return {
      items: rows.map((row) => this.mapVersion(row)),
      total: rows.length,
    };
  }

  async getVersion(id: string) {
    const row = await this.getVersionRow(id);
    return this.mapVersion(row);
  }

  async saveVersion(dto: SaveContentVersionDto) {
    const scope = await this.resolveScope();
    const platform = this.normalizePlatform(dto.platform);
    const targetType = this.clean(dto.targetType || 'article');
    const draftId =
      dto.draftId ||
      (
        await this.createDraft({
          title: dto.originalTitle || dto.title,
          content: dto.originalContent || dto.content,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          platform,
          targetType,
        })
      ).id;
    const draft = await this.getDraft(draftId);
    const runId = this.makeCommercialId('optimization');
    const versionId = this.makeCommercialId('version');
    const now = new Date().toISOString();
    const versionNo = await this.nextVersionNo(draftId, scope);

    await this.prisma.$executeRaw`
      INSERT INTO content_optimization_runs (
        id, draft_id, tenant_id, user_id, mode, platform, input, result,
        source_workflow_id, source_summary, status, created_at, updated_at
      )
      VALUES (
        ${runId}, ${draftId}, ${scope.tenantId}, ${scope.userId}, ${this.clean(dto.mode)},
        ${platform}, ${JSON.stringify({ draftId, targetType })},
        ${JSON.stringify({ title: dto.title, content: dto.content })},
        ${dto.sourceWorkflowId || null}, ${dto.sourceSummary || null},
        'completed', ${now}, ${now}
      )
    `;

    await this.prisma.$executeRaw`
      INSERT INTO content_versions (
        id, draft_id, run_id, tenant_id, user_id, mode, mode_label, title,
        content, platform, target_type, version_no, status, is_official,
        source_workflow_id, source_summary, created_at, updated_at
      )
      VALUES (
        ${versionId}, ${draftId}, ${runId}, ${scope.tenantId}, ${scope.userId},
        ${this.clean(dto.mode)}, ${this.clean(dto.modeLabel)}, ${this.clean(dto.title)},
        ${this.cleanMultiline(dto.content)}, ${platform}, ${targetType}, ${versionNo},
        'saved', ${false}, ${dto.sourceWorkflowId || null}, ${dto.sourceSummary || null},
        ${now}, ${now}
      )
    `;

    await this.writeEvidence('content_version', versionId, 'save_version', {
      draftId: draft.id,
      title: dto.title,
      mode: dto.mode,
      platform,
      versionNo,
    });

    return this.getVersion(versionId);
  }

  async setOfficialVersion(id: string, dto: SetOfficialVersionDto = {}) {
    const scope = await this.resolveScope();
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const version = await tx.contentVersion.findFirst({
        where: { id, ...this.scopeWhere(scope) },
      });
      if (!version) throw new NotFoundException('版本不存在');

      // Updating the draft first serializes competing official-version changes
      // for the same draft on both PostgreSQL and SQLite.
      const lockedDraft = await tx.contentDraft.updateMany({
        where: { id: version.draftId, ...this.scopeWhere(scope) },
        data: { updatedAt: now },
      });
      if (lockedDraft.count !== 1) {
        throw new NotFoundException('草稿不存在');
      }

      await tx.contentVersion.updateMany({
        where: { draftId: version.draftId, ...this.scopeWhere(scope) },
        data: { isOfficial: false },
      });
      await tx.contentVersion.updateMany({
        where: {
          draftId: version.draftId,
          status: 'official',
          ...this.scopeWhere(scope),
        },
        data: { status: 'saved' },
      });
      const promoted = await tx.contentVersion.updateMany({
        where: {
          id: version.id,
          draftId: version.draftId,
          ...this.scopeWhere(scope),
        },
        data: { isOfficial: true, status: 'official', updatedAt: now },
      });
      if (promoted.count !== 1) {
        throw new NotFoundException('版本不存在');
      }

      await tx.contentDraft.updateMany({
        where: { id: version.draftId, ...this.scopeWhere(scope) },
        data: {
          ...(dto.writeBackDraft !== false
            ? { title: version.title, content: version.content }
            : {}),
          status: 'official',
          officialVersionId: version.id,
          updatedAt: now,
        },
      });
      await tx.contentEvidenceLog.create({
        data: {
          id: this.makeCommercialId('evidence'),
          ...this.scopeWhere(scope),
          targetType: 'content_version',
          targetId: version.id,
          action: 'set_official',
          snapshot: {
            draftId: version.draftId,
            writeBackDraft: dto.writeBackDraft !== false,
          },
          createdAt: now,
        },
      });
    });

    return this.getVersion(id);
  }

  async getVersionDiff(id: string) {
    const scope = await this.resolveScope();
    const version = await this.getVersionRow(id, scope);
    const draftRows =
      scope.tenantId === null
        ? await this.prisma.$queryRaw<RawContentDraftRow[]>`
            SELECT * FROM content_drafts
            WHERE id = ${version.draft_id}
              AND user_id = ${scope.userId}
              AND tenant_id IS NULL
            LIMIT 1
          `
        : await this.prisma.$queryRaw<RawContentDraftRow[]>`
            SELECT * FROM content_drafts
            WHERE id = ${version.draft_id}
              AND user_id = ${scope.userId}
              AND tenant_id = ${scope.tenantId}
            LIMIT 1
          `;
    const draft = draftRows[0];
    if (!draft) throw new NotFoundException('草稿不存在');

    return {
      versionId: version.id,
      draftId: version.draft_id,
      summary: this.buildDiffSummary(draft.content, version.content),
      original: {
        title: draft.title,
        content: draft.content,
      },
      version: {
        title: version.title,
        content: version.content,
      },
    };
  }

  async manualReviewVersion(id: string, dto: ManualReviewVersionDto = {}) {
    const scope = await this.resolveScope();
    const version = await this.getVersionRow(id, scope);
    const reviewId = this.makeCommercialId('review');
    const now = new Date().toISOString();
    const note = this.clean(dto.note || '');

    await this.prisma.$executeRaw`
      INSERT INTO content_manual_reviews (
        id, version_id, tenant_id, user_id, risk_level, note, reviewer_name, created_at
      )
      VALUES (
        ${reviewId}, ${version.id}, ${scope.tenantId}, ${scope.userId},
        ${version.compliance_risk_level || null}, ${note || null}, ${scope.userId}, ${now}
      )
    `;

    await this.prisma.$executeRaw`
      UPDATE content_versions
      SET status = CASE WHEN is_official THEN 'reviewed' ELSE status END,
        updated_at = ${now}
      WHERE id = ${version.id}
        AND user_id = ${scope.userId}
        AND ${scope.tenantId === null ? Prisma.sql`tenant_id IS NULL` : Prisma.sql`tenant_id = ${scope.tenantId}`}
    `;

    await this.writeEvidence('content_version', version.id, 'manual_review', {
      riskLevel: version.compliance_risk_level,
      note,
    });

    return this.getVersion(version.id);
  }

  async listVersionFeedback(id: string) {
    const scope = await this.resolveScope();
    await this.getVersionRow(id, scope);
    const rows =
      scope.tenantId === null
        ? await this.prisma.$queryRaw<RawVersionFeedbackRow[]>`
            SELECT * FROM content_publish_feedback
            WHERE version_id = ${id}
              AND user_id = ${scope.userId}
              AND tenant_id IS NULL
            ORDER BY created_at DESC
            LIMIT 20
          `
        : await this.prisma.$queryRaw<RawVersionFeedbackRow[]>`
            SELECT * FROM content_publish_feedback
            WHERE version_id = ${id}
              AND user_id = ${scope.userId}
              AND tenant_id = ${scope.tenantId}
            ORDER BY created_at DESC
            LIMIT 20
          `;
    return {
      items: rows.map((row) => this.mapVersionFeedback(row)),
      total: rows.length,
    };
  }

  async createVersionFeedback(
    id: string,
    dto: CreateContentVersionFeedbackDto,
  ) {
    const scope = await this.resolveScope();
    const version = await this.getVersionRow(id, scope);
    const feedbackId = this.makeCommercialId('feedback');
    const now = new Date().toISOString();
    const platform = this.normalizePlatform(dto.platform || version.platform);

    await this.prisma.$executeRaw`
      INSERT INTO content_publish_feedback (
        id, version_id, publish_intent_id, tenant_id, user_id, platform,
        views, likes, comments, saves, leads, note, metadata, created_at, updated_at
      )
      VALUES (
        ${feedbackId}, ${version.id}, ${dto.publishIntentId || null},
        ${scope.tenantId}, ${scope.userId}, ${platform},
        ${this.toCount(dto.views)}, ${this.toCount(dto.likes)},
        ${this.toCount(dto.comments)}, ${this.toCount(dto.saves)},
        ${this.toCount(dto.leads)}, ${this.clean(dto.note || '') || null},
        ${JSON.stringify({})}, ${now}, ${now}
      )
    `;

    await this.writeEvidence(
      'content_version',
      version.id,
      'publish_feedback',
      {
        platform,
        views: this.toCount(dto.views),
        likes: this.toCount(dto.likes),
        comments: this.toCount(dto.comments),
        saves: this.toCount(dto.saves),
        leads: this.toCount(dto.leads),
      },
    );

    const rows = await this.prisma.$queryRaw<RawVersionFeedbackRow[]>`
      SELECT * FROM content_publish_feedback WHERE id = ${feedbackId} LIMIT 1
    `;
    return this.mapVersionFeedback(rows[0]);
  }

  async listVersionComments(id: string) {
    const scope = await this.resolveScope();
    await this.getVersionRow(id, scope);
    const rows =
      scope.tenantId === null
        ? await this.prisma.$queryRaw<RawVersionCommentRow[]>`
            SELECT * FROM content_version_comments
            WHERE version_id = ${id}
              AND user_id = ${scope.userId}
              AND tenant_id IS NULL
            ORDER BY created_at DESC
            LIMIT 20
          `
        : await this.prisma.$queryRaw<RawVersionCommentRow[]>`
            SELECT * FROM content_version_comments
            WHERE version_id = ${id}
              AND user_id = ${scope.userId}
              AND tenant_id = ${scope.tenantId}
            ORDER BY created_at DESC
            LIMIT 20
          `;
    return {
      items: rows.map((row) => this.mapVersionComment(row)),
      total: rows.length,
    };
  }

  async createVersionComment(id: string, dto: CreateContentVersionCommentDto) {
    const scope = await this.resolveScope();
    const version = await this.getVersionRow(id, scope);
    const body = this.cleanMultiline(dto.body);
    if (!body) throw new BadRequestException('请填写备注内容');

    const commentId = this.makeCommercialId('comment');
    const now = new Date().toISOString();
    await this.prisma.$executeRaw`
      INSERT INTO content_version_comments (
        id, version_id, tenant_id, user_id, body, author_name, created_at, updated_at
      )
      VALUES (
        ${commentId}, ${version.id}, ${scope.tenantId}, ${scope.userId},
        ${body}, '成员', ${now}, ${now}
      )
    `;

    await this.writeEvidence('content_version', version.id, 'version_comment', {
      body,
    });

    const rows = await this.prisma.$queryRaw<RawVersionCommentRow[]>`
      SELECT * FROM content_version_comments WHERE id = ${commentId} LIMIT 1
    `;
    return this.mapVersionComment(rows[0]);
  }

  async createPublishIntent(dto: CreatePublishIntentDto) {
    const scope = await this.resolveScope();
    const version = await this.getVersionRow(dto.versionId, scope);
    if (!this.toBoolean(version.is_official)) {
      throw new BadRequestException('请先将该版本设为正式稿');
    }

    if (!version.compliance_risk_level) {
      throw new BadRequestException('请先完成发布前检查');
    }

    if (
      version.compliance_risk_level === 'medium' ||
      version.compliance_risk_level === 'high'
    ) {
      const reviewed = await this.hasManualReview(version.id, scope);
      if (!reviewed) {
        throw new BadRequestException(
          '当前内容需要负责人复核后才能进入发布准备',
        );
      }
    }

    const platform = this.normalizePlatform(dto.platform || version.platform);
    const scheduledAt = dto.scheduledAt || null;
    const id = `publish-${createHash('sha256')
      .update(
        JSON.stringify([
          scope.tenantId,
          scope.userId,
          version.id,
          platform,
          scheduledAt,
        ]),
      )
      .digest('hex')
      .slice(0, 24)}`;
    const now = new Date().toISOString();
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO content_publish_intents (
        id, version_id, tenant_id, user_id, platform, title, content,
        status, scheduled_at, metadata, created_at, updated_at
      )
      VALUES (
        ${id}, ${version.id}, ${scope.tenantId}, ${scope.userId}, ${platform},
        ${version.title}, ${version.content}, 'ready',
        ${scheduledAt},
        ${JSON.stringify({
          complianceRiskLevel: version.compliance_risk_level,
          complianceRiskScore: version.compliance_risk_score,
        })},
        ${now}, ${now}
      )
      ON CONFLICT(id) DO NOTHING
    `;

    if (inserted > 0) {
      await this.writeEvidence('publish_intent', id, 'create_publish_intent', {
        versionId: version.id,
        platform,
      });
    }

    return this.getPublishIntent(id, scope);
  }

  async getPublishIntent(id: string, existingScope?: ContentOwnerScope) {
    const scope = existingScope || (await this.resolveScope());
    const rows =
      scope.tenantId === null
        ? await this.prisma.$queryRaw<RawPublishIntentRow[]>`
            SELECT * FROM content_publish_intents
            WHERE id = ${id}
              AND user_id = ${scope.userId}
              AND tenant_id IS NULL
            LIMIT 1
          `
        : await this.prisma.$queryRaw<RawPublishIntentRow[]>`
            SELECT * FROM content_publish_intents
            WHERE id = ${id}
              AND user_id = ${scope.userId}
              AND tenant_id = ${scope.tenantId}
            LIMIT 1
          `;
    const row = rows[0];
    if (!row) throw new NotFoundException('发布准备任务不存在');

    return this.mapPublishIntent(row);
  }

  async markVersionCompliance(input: {
    versionId: string;
    checkId: string;
    riskLevel: string;
    riskScore: number;
    summary: string;
    checkedAt?: string;
  }) {
    const scope = await this.resolveScope();
    await this.getVersionRow(input.versionId, scope);
    if (
      !CONTENT_RISK_LEVELS.includes(
        input.riskLevel as (typeof CONTENT_RISK_LEVELS)[number],
      )
    ) {
      throw new BadRequestException('合规风险等级无效');
    }

    const checks =
      scope.tenantId === null
        ? await this.prisma.$queryRaw<RawComplianceVerificationRow[]>`
            SELECT id, tenant_id, user_id, target_id, risk_level, risk_score,
              summary, checked_at, status
            FROM compliance_checks
            WHERE id = ${input.checkId}
              AND user_id = ${scope.userId}
              AND tenant_id IS NULL
              AND target_id = ${input.versionId}
              AND status = 'completed'
            LIMIT 1
          `
        : await this.prisma.$queryRaw<RawComplianceVerificationRow[]>`
            SELECT id, tenant_id, user_id, target_id, risk_level, risk_score,
              summary, checked_at, status
            FROM compliance_checks
            WHERE id = ${input.checkId}
              AND user_id = ${scope.userId}
              AND tenant_id = ${scope.tenantId}
              AND target_id = ${input.versionId}
              AND status = 'completed'
            LIMIT 1
          `;
    const check = checks[0];
    if (!check) {
      throw new BadRequestException('未找到与当前版本匹配的真实合规检查');
    }
    if (check.risk_level !== input.riskLevel) {
      throw new BadRequestException('合规风险等级与检查记录不一致');
    }

    const now = new Date().toISOString();
    const updated = await this.prisma.contentVersion.updateMany({
      where: { id: input.versionId, ...this.scopeWhere(scope) },
      data: {
        complianceCheckId: check.id,
        complianceRiskLevel: check.risk_level,
        complianceRiskScore: Number(check.risk_score || 0),
        complianceSummary: check.summary || input.summary,
        complianceCheckedAt: new Date(
          input.checkedAt || this.toIso(check.checked_at) || now,
        ),
        updatedAt: new Date(now),
      },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('版本不存在');
    }
  }

  private async ensureCommercialTables() {
    const databaseUrl = `${process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || ''}`;
    if (!databaseUrl.startsWith('file:')) return;

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_drafts (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        source_type TEXT,
        source_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'all',
        target_type TEXT NOT NULL DEFAULT 'article',
        status TEXT NOT NULL DEFAULT 'draft',
        official_version_id TEXT,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_optimization_runs (
        id TEXT PRIMARY KEY NOT NULL,
        draft_id TEXT NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'all',
        input JSONB,
        result JSONB,
        source_workflow_id TEXT,
        source_summary TEXT,
        cost_points INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_versions (
        id TEXT PRIMARY KEY NOT NULL,
        draft_id TEXT NOT NULL,
        run_id TEXT,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        mode_label TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'all',
        target_type TEXT NOT NULL DEFAULT 'article',
        version_no INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'saved',
        is_official BOOLEAN NOT NULL DEFAULT false,
        source_workflow_id TEXT,
        source_summary TEXT,
        compliance_check_id TEXT,
        compliance_risk_level TEXT,
        compliance_risk_score INTEGER,
        compliance_summary TEXT,
        compliance_checked_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_publish_intents (
        id TEXT PRIMARY KEY NOT NULL,
        version_id TEXT NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        scheduled_at DATETIME,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_manual_reviews (
        id TEXT PRIMARY KEY NOT NULL,
        version_id TEXT NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        risk_level TEXT,
        note TEXT,
        reviewer_name TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_publish_feedback (
        id TEXT PRIMARY KEY NOT NULL,
        version_id TEXT NOT NULL,
        publish_intent_id TEXT,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'all',
        views INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0,
        comments INTEGER NOT NULL DEFAULT 0,
        saves INTEGER NOT NULL DEFAULT 0,
        leads INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_version_comments (
        id TEXT PRIMARY KEY NOT NULL,
        version_id TEXT NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        author_name TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_evidence_logs (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        snapshot JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_drafts_user_updated_idx ON content_drafts(user_id, updated_at)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_versions_user_updated_idx ON content_versions(user_id, updated_at)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_versions_draft_idx ON content_versions(draft_id, version_no)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_publish_intents_version_idx ON content_publish_intents(version_id)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_manual_reviews_version_idx ON content_manual_reviews(version_id, created_at)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_publish_feedback_version_idx ON content_publish_feedback(version_id, created_at)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_version_comments_version_idx ON content_version_comments(version_id, created_at)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_evidence_logs_target_idx ON content_evidence_logs(target_type, target_id)`,
    );
  }

  private async resolveScope(): Promise<ContentOwnerScope> {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('缺少登录上下文，不能管理内容版本。');
    }
    if (context?.user?.kaypalLocalOnly === true) {
      return { tenantId: null, userId };
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return {
      tenantId,
      userId,
    };
  }

  private scopeWhere(scope: ContentOwnerScope) {
    return { tenantId: scope.tenantId, userId: scope.userId };
  }

  private async nextVersionNo(draftId: string, scope: ContentOwnerScope) {
    const count = await this.prisma.contentVersion.count({
      where: { draftId, ...this.scopeWhere(scope) },
    });
    return count + 1;
  }

  private async getVersionRow(id: string, existingScope?: ContentOwnerScope) {
    const scope = existingScope || (await this.resolveScope());
    const select = Prisma.sql`SELECT
        v.*,
        (
          SELECT COUNT(*)
          FROM content_manual_reviews r
          WHERE r.version_id = v.id
            AND r.user_id = v.user_id
            AND (r.tenant_id = v.tenant_id OR (r.tenant_id IS NULL AND v.tenant_id IS NULL))
        ) AS manual_review_count,
        (
          SELECT r.note
          FROM content_manual_reviews r
          WHERE r.version_id = v.id
            AND r.user_id = v.user_id
            AND (r.tenant_id = v.tenant_id OR (r.tenant_id IS NULL AND v.tenant_id IS NULL))
          ORDER BY r.created_at DESC
          LIMIT 1
        ) AS manual_review_note,
        (
          SELECT r.created_at
          FROM content_manual_reviews r
          WHERE r.version_id = v.id
            AND r.user_id = v.user_id
            AND (r.tenant_id = v.tenant_id OR (r.tenant_id IS NULL AND v.tenant_id IS NULL))
          ORDER BY r.created_at DESC
          LIMIT 1
        ) AS manual_reviewed_at
      FROM content_versions v`;
    const rows =
      scope.tenantId === null
        ? await this.prisma.$queryRaw<RawContentVersionRow[]>(Prisma.sql`
            ${select}
            WHERE v.id = ${id}
              AND v.user_id = ${scope.userId}
              AND v.tenant_id IS NULL
            LIMIT 1
          `)
        : await this.prisma.$queryRaw<RawContentVersionRow[]>(Prisma.sql`
            ${select}
            WHERE v.id = ${id}
              AND v.user_id = ${scope.userId}
              AND v.tenant_id = ${scope.tenantId}
            LIMIT 1
          `);
    const row = rows[0];
    if (!row) throw new NotFoundException('版本不存在');
    return row;
  }

  private async hasManualReview(versionId: string, scope: ContentOwnerScope) {
    const count = await this.prisma.contentManualReview.count({
      where: { versionId, ...this.scopeWhere(scope) },
    });
    return count > 0;
  }

  private async writeEvidence(
    targetType: string,
    targetId: string,
    action: string,
    snapshot: Record<string, unknown>,
  ) {
    const scope = await this.resolveScope();
    await this.prisma.$executeRaw`
      INSERT INTO content_evidence_logs (
        id, tenant_id, user_id, target_type, target_id, action, snapshot, created_at
      )
      VALUES (
        ${this.makeCommercialId('evidence')}, ${scope.tenantId}, ${scope.userId},
        ${targetType}, ${targetId}, ${action}, ${JSON.stringify(snapshot)}, ${new Date().toISOString()}
      )
    `;
  }

  private mapDraft(row: RawContentDraftRow) {
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      title: row.title,
      content: row.content,
      platform: row.platform,
      targetType: row.target_type,
      status: row.status,
      officialVersionId: row.official_version_id,
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private mapVersion(row: RawContentVersionRow) {
    return {
      id: row.id,
      draftId: row.draft_id,
      mode: row.mode,
      modeLabel: row.mode_label,
      title: row.title,
      content: row.content,
      platform: row.platform,
      targetType: row.target_type,
      versionNo: Number(row.version_no || 1),
      status: row.status,
      isOfficial: this.toBoolean(row.is_official),
      sourceWorkflowId: row.source_workflow_id || undefined,
      sourceSummary: row.source_summary || undefined,
      compliance: row.compliance_risk_level
        ? {
            checkId: row.compliance_check_id || '',
            checkedAt: this.toIso(row.compliance_checked_at),
            riskLevel: row.compliance_risk_level,
            riskScore: Number(row.compliance_risk_score || 0),
            summary: row.compliance_summary || '',
          }
        : undefined,
      manualReview: Number(row.manual_review_count || 0)
        ? {
            reviewed: true,
            note: row.manual_review_note || '',
            reviewedAt: this.toIso(row.manual_reviewed_at),
          }
        : undefined,
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private mapPublishIntent(row?: RawPublishIntentRow) {
    if (!row) throw new NotFoundException('发布准备任务不存在');
    return {
      id: row.id,
      versionId: row.version_id,
      platform: row.platform,
      title: row.title,
      content: row.content,
      status: row.status,
      scheduledAt: row.scheduled_at ? this.toIso(row.scheduled_at) : null,
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private mapVersionFeedback(row?: RawVersionFeedbackRow) {
    if (!row) throw new NotFoundException('发布复盘不存在');
    return {
      id: row.id,
      versionId: row.version_id,
      publishIntentId: row.publish_intent_id || undefined,
      platform: row.platform,
      views: Number(row.views || 0),
      likes: Number(row.likes || 0),
      comments: Number(row.comments || 0),
      saves: Number(row.saves || 0),
      leads: Number(row.leads || 0),
      note: row.note || '',
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private mapVersionComment(row?: RawVersionCommentRow) {
    if (!row) throw new NotFoundException('协作备注不存在');
    return {
      id: row.id,
      versionId: row.version_id,
      body: row.body,
      authorName:
        row.author_name && row.author_name !== row.user_id
          ? row.author_name
          : '成员',
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private buildDiffSummary(original: string, version: string) {
    const originalLines = original.split('\n').filter(Boolean).length;
    const versionLines = version.split('\n').filter(Boolean).length;
    return {
      originalLength: original.length,
      versionLength: version.length,
      originalLines,
      versionLines,
      lengthDelta: version.length - original.length,
      lineDelta: versionLines - originalLines,
    };
  }

  private makeCommercialId(prefix: string) {
    return `${prefix}-${randomUUID()}`;
  }

  private toBoolean(value: number | boolean | null | undefined) {
    return value === true || value === 1;
  }

  private toIso(value?: string | Date | null) {
    if (!value) return new Date().toISOString();
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private workflow(plannedSkill: string, hook: string): WorkflowTrace {
    return {
      source: 'local_scoring',
      status: 'local_scoring',
      plannedSkill,
      redfoxClientHook: `平台增强能力可继续补充 ${hook} 的风格建议和处理记录`,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildTitleHitItems(
    title: string,
    keywords: string[],
  ): OptimizationHitItem[] {
    const hooks = this.findHookTerms(title).map((term) => ({
      type: 'hook' as const,
      text: term,
      reason: '标题包含明确内容承诺或情绪钩子',
    }));
    const keywordHits = keywords
      .filter((keyword) => title.includes(keyword))
      .map((keyword) => ({
        type: 'keyword' as const,
        text: keyword,
        reason: '命中目标关键词',
      }));
    const risks = this.findRiskTerms(title).map((term) => ({
      type: 'risk' as const,
      text: term,
      reason: '可能触发平台夸大承诺风险',
    }));
    return [...hooks, ...keywordHits, ...risks];
  }

  private buildTitleSuggestions(
    title: string,
    keywords: string[],
    platform: OptimizationPlatform,
  ): string[] {
    const suggestions = ['补充具体人群、场景或收益，避免标题只停留在抽象概念'];
    if (!this.findHookTerms(title).length)
      suggestions.push('加入清单、避坑、对比、复盘等结构词，提高点击预期');
    if (keywords.length && this.countKeywordHits(title, keywords) === 0)
      suggestions.push(
        `至少自然加入一个目标关键词：${keywords.slice(0, 3).join('、')}`,
      );
    if (this.findRiskTerms(title).length)
      suggestions.push('弱化绝对化承诺，改成经验、案例或检查项表达');
    if (platform === 'xiaohongshu')
      suggestions.push(
        '小红书标题建议控制在 12-24 个中文字符，并保留一个强钩子',
      );
    return suggestions;
  }

  private buildTitleCandidates(
    title: string,
    keywords: string[],
    goal?: string,
  ): string[] {
    const keyword = keywords[0] || this.extractKeyword(title) || '内容优化';
    const cleanGoal = this.clean(goal || '提升转化');
    return [
      `${keyword}没效果？先检查这 3 个细节`,
      `我用一套清单，把${keyword}从“能看”改到“能转化”`,
      `${cleanGoal}之前，先避开这 5 个${keyword}误区`,
    ];
  }

  private buildRewrite(
    content: string,
    tone: string,
    platform: OptimizationPlatform,
    goals: string[],
  ): string {
    const goalText = goals.length
      ? `目标：${goals.join('、')}。`
      : '目标：让用户更快理解价值并愿意继续互动。';
    const platformText = platform === 'all' ? '多平台' : platform;
    const summary = this.trimSentence(content, 90);
    return [
      `先说结论：${summary}`,
      '',
      `这版文案会按「${tone}」语气适配${platformText}，重点不是堆卖点，而是把用户最关心的问题讲清楚。${goalText}`,
      '',
      '建议这样表达：',
      `- 用户现在遇到的核心问题是什么`,
      `- 你提供的方法为什么可信`,
      `- 用户下一步可以怎么行动`,
      '',
      content,
    ].join('\n');
  }

  private scoreTitleLength(title: string, platform: OptimizationPlatform) {
    const length = [...title].length;
    const [min, max] = platform === 'xiaohongshu' ? [12, 24] : [10, 32];
    if (length >= min && length <= max) return 92;
    if (length < min) return this.clamp(62 + length);
    return this.clamp(92 - (length - max) * 3);
  }

  private scoreKeywordCoverage(title: string, keywords: string[]) {
    if (!keywords.length) return 76;
    return this.clamp(58 + this.countKeywordHits(title, keywords) * 18);
  }

  private scoreHook(title: string) {
    return this.findHookTerms(title).length
      ? 88
      : title.includes('?') || title.includes('？')
        ? 78
        : 62;
  }

  private scoreClarity(title: string) {
    if (title.includes('：') || title.includes(':')) return 88;
    if (title.includes('，') || title.includes(',')) return 80;
    return [...title].length > 8 ? 72 : 58;
  }

  private scoreTitleRisk(title: string) {
    return this.findRiskTerms(title).length ? 48 : 92;
  }

  private toQualityLevel(score: number): TitleQualityLevel {
    if (score >= 88) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'needs_improvement';
    return 'weak';
  }

  private titleLengthEvidence(title: string, platform: OptimizationPlatform) {
    return `${platform === 'xiaohongshu' ? '小红书' : '通用'}标题长度 ${[...title].length} 个字符`;
  }

  private findHookTerms(title: string) {
    return HOOK_TERMS.filter((term) => title.includes(term));
  }

  private findRiskTerms(title: string) {
    return TITLE_RISK_TERMS.filter((term) => title.includes(term));
  }

  private countKeywordHits(title: string, keywords: string[]) {
    return keywords.filter((keyword) => keyword && title.includes(keyword))
      .length;
  }

  private makeXhsTitle(title: string, goal: string) {
    const seed = this.trimSentence(title, 18);
    return `${seed}：想要${goal}先看这 3 点`;
  }

  private extractPainPoint(content: string) {
    if (content.includes('转化')) return '内容有人看，但没有稳定转化';
    if (content.includes('获客')) return '不知道如何把内容浏览变成可跟进线索';
    if (content.includes('选题')) return '选题容易重复，缺少能持续更新的角度';
    return '内容表达不够具体，用户看完不知道下一步做什么';
  }

  private trimForNote(content: string) {
    return content.length > 280 ? `${content.slice(0, 280)}...` : content;
  }

  private extractKeyword(title: string) {
    return title
      .replace(/[？?！!：:,，。]/g, ' ')
      .split(/\s+/)
      .find((part) => part.length >= 2);
  }

  private extractFirstSentence(content: string) {
    return (
      content
        .split(/[。！？\n]/)
        .map((item) => item.trim())
        .find(Boolean) || ''
    );
  }

  private trimSentence(content: string, maxLength: number) {
    const first = this.extractFirstSentence(content) || content;
    return first.length > maxLength ? `${first.slice(0, maxLength)}...` : first;
  }

  private defaultTone(platform: OptimizationPlatform) {
    if (platform === 'xiaohongshu') return '真实经验分享';
    if (platform === 'douyin') return '短句口播';
    return '专业但容易理解';
  }

  private normalizePlatform(
    platform?: OptimizationPlatform,
  ): OptimizationPlatform {
    return platform || 'all';
  }

  private normalizeList(value?: string[]) {
    return this.unique(
      (value || []).map((item) => this.clean(item)).filter(Boolean),
    );
  }

  private clean(value: string) {
    return String(value || '').trim();
  }

  private cleanMultiline(value: string) {
    return String(value || '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  private toCount(value?: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.round(Number(value)));
  }

  private unique(values: string[]) {
    return [...new Set(values)];
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, value));
  }

  private makeWorkflowId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
