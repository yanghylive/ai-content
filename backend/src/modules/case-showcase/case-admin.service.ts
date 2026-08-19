import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CaseValidationService } from './case-validation.service';
import { CaseStatus } from './enums';
import { FEATURED_COLLECTION_SLUG } from './case.repository';
import { transitionError } from './state-machine';
import {
  CaseAdminInputDto,
  DemoEndpointInputDto,
  MediaInputDto,
  ReviewCaseDto,
} from './dto/case-admin.dto';

/**
 * 后台案例管理服务（M6 · PRD §9.13 审核与发布 + §9.1 首页精选 + 审计）。
 *
 * 让内容运营无需依赖研发即可维护案例：列表/编辑/提交审核/审核决策/精选位/审计。
 * 仅后台权限接口调用（controller 类级 @RequireKaypalRoles），公开响应仍经白名单。
 */

/** 精选位最大条数（防运营误配过多拖垮首页） */
export const FEATURED_MAX_ITEMS = 20;

/** 标题 → 候选 slug（小写字母/数字/连字符） */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `case-${randomBytes(4).toString('hex')}`;
}

function toDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapMediaInput(item: MediaInputDto) {
  return {
    mediaType: item.mediaType ?? 'image',
    fileUrl: item.fileUrl ?? null,
    externalUrl: item.externalUrl ?? null,
    thumbnailUrl: item.thumbnailUrl ?? null,
    title: item.title ?? null,
    caption: item.caption ?? null,
    altText: item.altText ?? '',
    deviceFrame: item.deviceFrame ?? null,
    sortOrder: item.sortOrder ?? 0,
  };
}

function mapDemoInput(item: DemoEndpointInputDto) {
  return {
    endpointType: item.endpointType,
    targetUrl: item.targetUrl ?? null,
    shortCode: item.shortCode ?? null,
    allowedDevices: item.allowedDevices ?? [],
    iframeAllowed: item.iframeAllowed ?? false,
    accessInstruction: item.accessInstruction ?? null,
    validFrom: toDate(item.validFrom),
    validUntil: toDate(item.validUntil),
    fallbackType: item.fallbackType ?? 'media',
    fallbackTarget: item.fallbackTarget ?? null,
    ownerUserId: item.ownerUserId ?? null,
  };
}

@Injectable()
export class CaseAdminService {
  private readonly logger = new Logger(CaseAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: CaseValidationService,
  ) {}

  /** 后台案例列表（含草稿/审核中，全量字段，供表格展示） */
  async listCases() {
    return this.prisma.showcaseCase.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { demoEndpoints: { select: { id: true } } },
    });
  }

  /** 后台案例详情（含 media/demoEndpoints 完整字段；授权附件不外泄） */
  async getCase(id: string) {
    const record = await this.prisma.showcaseCase.findUnique({
      where: { id },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        demoEndpoints: true,
        // 授权仅取审核所需字段，attachment 附件不在编辑表单内使用，刻意不取
        authorizations: {
          select: {
            id: true,
            recordType: true,
            grantor: true,
            scope: true,
            licenseName: true,
            sourceUrl: true,
            versionOrCommit: true,
            reviewStatus: true,
            validFrom: true,
            validUntil: true,
            restrictionNotes: true,
          },
        },
      },
    });
    if (!record) throw new NotFoundException('案例不存在');
    return record;
  }

  /** 新建案例（草稿） */
  async createCase(dto: CaseAdminInputDto, byUserId?: string) {
    const slug = (dto.slug ?? '').trim() || slugify(dto.title);
    if (!this.validation.isValidSlug(slug)) {
      throw new BadRequestException(
        'slug 格式非法：仅允许小写字母/数字/连字符，且不能以连字符开头或结尾',
      );
    }
    if (
      dto.provenanceType &&
      !this.validation.isValidProvenanceType(dto.provenanceType)
    ) {
      throw new BadRequestException(
        `provenanceType 非法：${dto.provenanceType}`,
      );
    }

    try {
      const record = await this.prisma.showcaseCase.create({
        data: {
          title: dto.title.trim(),
          slug,
          subtitle: dto.subtitle?.trim() || null,
          provenanceType: dto.provenanceType ?? 'prototype',
          clientVisibility: dto.clientVisibility ?? 'public',
          primaryPlatform: dto.primaryPlatform?.trim() || null,
          platforms: dto.platforms ?? [],
          primaryIndustry: dto.primaryIndustry?.trim() || null,
          industries: dto.industries ?? [],
          capabilityTags: dto.capabilityTags ?? [],
          businessProblem: dto.businessProblem ?? null,
          solutionSummary: dto.solutionSummary ?? null,
          keyFeatures: (dto.keyFeatures ??
            []) as unknown as Prisma.InputJsonValue,
          resultsSummary: dto.resultsSummary ?? null,
          evidenceLevel: dto.evidenceLevel ?? 'E0',
          evidenceScope: dto.evidenceScope ?? null,
          deliveryModes: dto.deliveryModes ?? [],
          maturity: dto.maturity ?? 'concept',
          techSummary: dto.techSummary ?? null,
          coverMedia: (dto.coverMedia as Prisma.InputJsonValue) ?? undefined,
          seoTitle: dto.seoTitle?.trim() || null,
          seoDescription: dto.seoDescription ?? null,
          status: 'draft',
          ownerUserId: byUserId ?? null,
          reviewerUserId: null,
          media: dto.media
            ? { create: dto.media.map(mapMediaInput) }
            : undefined,
          demoEndpoints: dto.demoEndpoints
            ? { create: dto.demoEndpoints.map(mapDemoInput) }
            : undefined,
        },
      });
      return this.getCase(record.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('slug 已存在，请更换');
      }
      throw error;
    }
  }

  /** 更新案例（保留草稿状态；媒体/演示入口整体替换） */
  async updateCase(id: string, dto: CaseAdminInputDto) {
    const existing = await this.prisma.showcaseCase.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('案例不存在');

    if (dto.slug && !this.validation.isValidSlug(dto.slug.trim())) {
      throw new BadRequestException(
        'slug 格式非法：仅允许小写字母/数字/连字符，且不能以连字符开头或结尾',
      );
    }
    if (
      dto.provenanceType &&
      !this.validation.isValidProvenanceType(dto.provenanceType)
    ) {
      throw new BadRequestException(
        `provenanceType 非法：${dto.provenanceType}`,
      );
    }

    try {
      await this.prisma.showcaseCase.update({
        where: { id },
        data: {
          title: dto.title.trim(),
          ...(dto.slug ? { slug: dto.slug.trim() } : {}),
          ...(dto.subtitle !== undefined
            ? { subtitle: dto.subtitle?.trim() || null }
            : {}),
          ...(dto.provenanceType ? { provenanceType: dto.provenanceType } : {}),
          ...(dto.clientVisibility
            ? { clientVisibility: dto.clientVisibility }
            : {}),
          ...(dto.primaryPlatform !== undefined
            ? { primaryPlatform: dto.primaryPlatform?.trim() || null }
            : {}),
          ...(dto.platforms !== undefined ? { platforms: dto.platforms } : {}),
          ...(dto.primaryIndustry !== undefined
            ? { primaryIndustry: dto.primaryIndustry?.trim() || null }
            : {}),
          ...(dto.industries !== undefined
            ? { industries: dto.industries }
            : {}),
          ...(dto.capabilityTags !== undefined
            ? { capabilityTags: dto.capabilityTags }
            : {}),
          ...(dto.businessProblem !== undefined
            ? { businessProblem: dto.businessProblem }
            : {}),
          ...(dto.solutionSummary !== undefined
            ? { solutionSummary: dto.solutionSummary }
            : {}),
          ...(dto.keyFeatures !== undefined
            ? {
                keyFeatures:
                  dto.keyFeatures as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(dto.resultsSummary !== undefined
            ? { resultsSummary: dto.resultsSummary }
            : {}),
          ...(dto.evidenceLevel ? { evidenceLevel: dto.evidenceLevel } : {}),
          ...(dto.evidenceScope !== undefined
            ? { evidenceScope: dto.evidenceScope }
            : {}),
          ...(dto.deliveryModes !== undefined
            ? { deliveryModes: dto.deliveryModes }
            : {}),
          ...(dto.maturity ? { maturity: dto.maturity } : {}),
          ...(dto.techSummary !== undefined
            ? { techSummary: dto.techSummary }
            : {}),
          ...(dto.coverMedia !== undefined
            ? { coverMedia: dto.coverMedia as Prisma.InputJsonValue }
            : {}),
          ...(dto.seoTitle !== undefined
            ? { seoTitle: dto.seoTitle?.trim() || null }
            : {}),
          ...(dto.seoDescription !== undefined
            ? { seoDescription: dto.seoDescription }
            : {}),
          media: dto.media
            ? { deleteMany: {}, create: dto.media.map(mapMediaInput) }
            : undefined,
          demoEndpoints: dto.demoEndpoints
            ? { deleteMany: {}, create: dto.demoEndpoints.map(mapDemoInput) }
            : undefined,
        },
      });
      return this.getCase(id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('slug 已存在，请更换');
      }
      throw error;
    }
  }

  /** 表单完整性提示：复用发布校验规则子集（slug/provenance/keyFeatures/media/demo） */
  completenessHints(dto: CaseAdminInputDto): string[] {
    const hints: string[] = [];

    if (!dto.title?.trim()) {
      hints.push('缺少标题');
    }
    const slug = (dto.slug ?? '').trim();
    if (!slug) {
      hints.push('建议填写公开 slug（URL 标识）');
    } else if (!this.validation.isValidSlug(slug)) {
      hints.push('slug 格式非法：仅允许小写字母/数字/连字符');
    }
    if (!dto.provenanceType) {
      hints.push('缺少来源类型（交付/开源/原型/模板）');
    }
    if (!dto.primaryPlatform) {
      hints.push('建议填写主平台');
    }
    if (!dto.primaryIndustry) {
      hints.push('建议填写主行业');
    }
    if (!dto.businessProblem?.trim()) {
      hints.push('建议填写业务问题');
    }
    if (!dto.solutionSummary?.trim()) {
      hints.push('建议填写方案摘要');
    }

    const features = dto.keyFeatures ?? [];
    if (features.length < 3) {
      hints.push('关键特性至少 3 项（当前 ' + features.length + ' 项）');
    } else if (
      features.some((f) => !f?.title?.trim() || !f?.description?.trim())
    ) {
      hints.push('每个关键特性的标题与描述都必须非空');
    }

    if ((dto.media ?? []).length === 0) {
      hints.push('缺少媒体（至少 1 条图片/视频）');
    }
    const demos = dto.demoEndpoints ?? [];
    if (demos.length === 0) {
      hints.push('缺少演示体验入口（至少 1 个）');
    } else if (
      !demos.some((d) => d.fallbackType && d.fallbackType !== 'none')
    ) {
      hints.push('演示入口需配置回退方案（fallbackType 不能为 none）');
    }

    return hints;
  }

  /** 提交审核：draft → submitted，并落审核记录 */
  async submitForReview(id: string, byUserId?: string) {
    const current = await this.prisma.showcaseCase.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('案例不存在');

    const error = transitionError(
      current.status as CaseStatus,
      CaseStatus.Submitted,
    );
    if (error) throw new BadRequestException(error);

    await this.prisma.showcaseCase.update({
      where: { id },
      data: { status: CaseStatus.Submitted, reviewerUserId: null },
    });
    await this.prisma.showcaseCaseReview.create({
      data: {
        caseId: id,
        reviewType: 'submit',
        submittedBy: byUserId ?? null,
        decision: 'pending',
      },
    });
    return this.getCase(id);
  }

  /** 审核决策：approved → 已批准；rejected/requested_changes → 退回草稿 */
  async review(id: string, dto: ReviewCaseDto, byUserId?: string) {
    const current = await this.prisma.showcaseCase.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('案例不存在');

    const targetStatus =
      dto.decision === 'approved' ? CaseStatus.Approved : CaseStatus.Draft;
    const error = transitionError(current.status as CaseStatus, targetStatus);
    if (error) throw new BadRequestException(error);

    await this.prisma.showcaseCase.update({
      where: { id },
      data: {
        status: targetStatus,
        reviewerUserId: byUserId ?? null,
        ...(dto.decision === 'approved' ? { lastReviewedAt: new Date() } : {}),
      },
    });
    await this.prisma.showcaseCaseReview.create({
      data: {
        caseId: id,
        reviewType: dto.decision === 'approved' ? 'approve' : 'reject',
        reviewedBy: byUserId ?? null,
        decision: dto.decision,
        comments: dto.comments ?? null,
      },
    });
    return this.getCase(id);
  }

  /**
   * 独立「发布」动作：approved → published（PRD §9.13「发布」是独立步骤）。
   * 状态机 canTransition 校验（同时放行 unpublished → published 的重新上线），
   * 写 publishedAt（首次发布时间，重发不覆盖），落 publish 审计记录并标记缓存失效。
   *
   * 说明：ShowcaseCase 无 scheduledPublishAt 字段，定时发布不在本方法范围，
   * 仅支持立即发布（后续如补字段，可在本方法内解析 scheduledPublishAt）。
   */
  async publishCase(id: string, byUserId?: string) {
    const current = await this.prisma.showcaseCase.findUnique({
      where: { id },
      select: { id: true, status: true, publishedAt: true },
    });
    if (!current) throw new NotFoundException('案例不存在');

    const error = transitionError(
      current.status as CaseStatus,
      CaseStatus.Published,
    );
    if (error) throw new BadRequestException(error);

    await this.prisma.showcaseCase.update({
      where: { id },
      data: {
        status: CaseStatus.Published,
        publishedAt: current.publishedAt ?? new Date(),
      },
    });
    await this.prisma.showcaseCaseReview.create({
      data: {
        caseId: id,
        reviewType: 'publish',
        reviewedBy: byUserId ?? null,
        decision: 'approved',
        comments: null,
      },
    });
    this.invalidatePublicCache(id);
    return this.getCase(id);
  }

  /**
   * 紧急下线：published → unpublished（PRD §9.13 管理员紧急下线无需等待审核，
   * 但必须填写原因）。落 unpublish 审计记录（原因存 comments）并标记缓存失效。
   */
  async unpublishCase(id: string, reason: string, byUserId?: string) {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('下线原因不能为空');
    }

    const current = await this.prisma.showcaseCase.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('案例不存在');

    const error = transitionError(
      current.status as CaseStatus,
      CaseStatus.Unpublished,
    );
    if (error) throw new BadRequestException(error);

    await this.prisma.showcaseCase.update({
      where: { id },
      data: { status: CaseStatus.Unpublished },
    });
    await this.prisma.showcaseCaseReview.create({
      data: {
        caseId: id,
        reviewType: 'unpublish',
        reviewedBy: byUserId ?? null,
        decision: 'unpublished',
        comments: trimmed,
      },
    });
    this.invalidatePublicCache(id);
    return this.getCase(id);
  }

  /**
   * 最小缓存失效标记：M1~M7 无独立公开缓存层，按 PRD §13「公开缓存必须在
   * 案例下线后及时失效」以日志落标记，供外层缓存/网关/CDN 消费。
   */
  private invalidatePublicCache(caseId: string): void {
    this.logger.log(
      `[cache-invalidate] showcase case ${caseId} status changed, public cache should be invalidated`,
    );
  }

  /** 审计查询：审核记录 + 状态变更（复用 ShowcaseCaseReview） */
  async getAudit(limit = 100) {
    const rows = await this.prisma.showcaseCaseReview.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      include: { case: { select: { slug: true, title: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      caseSlug: r.case.slug,
      caseTitle: r.case.title,
      reviewType: r.reviewType,
      submittedBy: r.submittedBy,
      reviewedBy: r.reviewedBy,
      decision: r.decision,
      comments: r.comments,
      changedFields: r.changedFields,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** 当前精选位（有序） */
  async getFeatured() {
    const collection = await this.prisma.showcaseCollection.findFirst({
      where: { slug: FEATURED_COLLECTION_SLUG },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            case: {
              select: { id: true, slug: true, title: true, status: true },
            },
          },
        },
      },
    });
    if (!collection) return [];
    return collection.items.map((item) => ({
      caseId: item.caseId,
      slug: item.case.slug,
      title: item.case.title,
      status: item.case.status,
      sortOrder: item.sortOrder,
    }));
  }

  /** 设置精选位（有序覆盖），校验案例存在 */
  async setFeatured(caseIds: string[]) {
    const ordered = [...new Set(caseIds)].slice(0, FEATURED_MAX_ITEMS);
    const cases = await this.prisma.showcaseCase.findMany({
      where: { id: { in: ordered } },
      select: { id: true },
    });
    const found = new Set(cases.map((c) => c.id));
    const missing = ordered.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `精选位包含不存在的案例：${missing.join(', ')}`,
      );
    }

    const collection = await this.prisma.showcaseCollection.upsert({
      where: { slug: FEATURED_COLLECTION_SLUG },
      update: {},
      create: {
        slug: FEATURED_COLLECTION_SLUG,
        title: '首页精选',
        visibility: 'internal',
        status: 'published',
      },
    });

    await this.prisma.$transaction([
      this.prisma.showcaseCollectionItem.deleteMany({
        where: { collectionId: collection.id },
      }),
      ...ordered.map((caseId, index) =>
        this.prisma.showcaseCollectionItem.create({
          data: { collectionId: collection.id, caseId, sortOrder: index },
        }),
      ),
    ]);

    return this.getFeatured();
  }
}
