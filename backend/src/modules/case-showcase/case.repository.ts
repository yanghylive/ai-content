import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ShowcaseCaseRecord,
  ShowcaseCollectionRecord,
  ShowcaseTaxonomyRecord,
} from './field-whitelist';

/**
 * 案例展示中心 · 公开只读查询层（M2）。
 *
 * 安全边界：
 *   - 列表/详情查询强制 status='published'，未发布/下线案例不可见；
 *   - 返回原始记录后必须经 field-whitelist.ts 显式 pick 才可进入公开 DTO，
 *     本层不做序列化，只负责「查什么、怎么排、怎么分页」。
 *
 * 分页：游标分页（keyset）。orderBy 恒以 id 降序作为最终 tiebreaker，
 * 保证 updatedAt/publishedAt 相同时结果仍稳定有序；cursor 为案例 id。
 */

/** 列表默认每页条数 */
export const CASE_LIST_DEFAULT_LIMIT = 12;
/** 列表每页上限（服务端钳制，防大 limit 拖垮查询） */
export const CASE_LIST_MAX_LIMIT = 48;
/** 详情页相关案例条数 */
export const RELATED_CASES_LIMIT = 3;

/**
 * 首页精选位复用 ShowcaseCollection 表：保留 slug `featured` 的合集承载
 * 「精选 + 排序」语义（ShowcaseCase 无 featured 字段，见 PRD §9.1 首页精选）。
 * 该合集 visibility=internal，不会出现在公开合集列表，仅精选位接口可读。
 */
export const FEATURED_COLLECTION_SLUG = 'featured';

export type CaseListSort = 'recommended' | 'updated' | 'popular';

export interface CaseListFilters {
  /** 搜索关键词：模糊匹配 title/subtitle/businessProblem/solutionSummary */
  q?: string;
  /** 平台代码（同一维度内 OR） */
  platforms?: string[];
  /** 行业代码（同一维度内 OR） */
  industries?: string[];
  /** 能力标签（同一维度内 OR） */
  capabilities?: string[];
  /** 来源类型（同一维度内 OR） */
  provenances?: string[];
  /** 体验可用：true=有演示入口 / false=无演示入口 / null=不限 */
  experience?: boolean | null;
}

export interface CaseListQuery extends CaseListFilters {
  sort?: CaseListSort;
  cursor?: string;
  limit: number;
}

export interface CaseListPage {
  cases: ShowcaseCaseRecord[];
  nextCursor: string | null;
}

/**
 * 转义 LIKE 通配符（% / _ / \）。
 * Prisma `contains` 生成的 SQL 为 LIKE '%value%'，用户输入中的
 * % 与 _ 会被当作通配符，必须转义后才是字面匹配。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 组装列表 where：恒含 status='published'；维度内 OR、维度间 AND */
export function buildCaseListWhere(
  filters: CaseListFilters,
): Prisma.ShowcaseCaseWhereInput {
  const where: Prisma.ShowcaseCaseWhereInput = { status: 'published' };

  const q = filters.q?.trim();
  if (q) {
    const needle = escapeLike(q);
    where.OR = [
      { title: { contains: needle } },
      { subtitle: { contains: needle } },
      { businessProblem: { contains: needle } },
      { solutionSummary: { contains: needle } },
    ];
  }

  // platforms / industries / capabilityTags 的数组筛选（PG hasSome）在 SQLite 打包下不可用
  // （prepare-sqlite-schema 把 String[] 转 Json，Json 无 hasSome）。改为 listCases 内
  // 应用层 filter（matchesArrayFilters），案例数据量小（每页 ≤48），性能可接受。

  if (filters.provenances && filters.provenances.length > 0) {
    where.provenanceType = { in: filters.provenances };
  }

  if (filters.experience === true) {
    where.demoEndpoints = { some: {} };
  } else if (filters.experience === false) {
    where.demoEndpoints = { none: {} };
  }

  return where;
}

/**
 * 组装列表排序。
 *
 * 已知偏差：ShowcaseCase 无 score / openCount 字段（openCount 位于
 * ShowcaseShortLink 表，且 Prisma orderBy 无法对关系字段求和聚合）。
 * M2 阶段 recommended / popular 均以 publishedAt 降序近似；updated 以
 * updatedAt 降序。待 M6 运营「精选位 / 热度」字段落 ShowcaseCase 后替换。
 */
export function buildCaseListOrderBy(
  sort?: CaseListSort,
): Prisma.ShowcaseCaseOrderByWithRelationInput[] {
  if (sort === 'updated') {
    return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }
  return [{ publishedAt: 'desc' }, { id: 'desc' }];
}

/** 服务端钳制 limit：<1 回默认，>上限回上限 */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return CASE_LIST_DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), CASE_LIST_MAX_LIMIT);
}

/** 多取一条后判定下一页游标：有富余则返回当前页最后一条 id，否则 null */
export function computeNextCursor(
  rows: { id: string }[],
  limit: number,
): string | null {
  return rows.length > limit ? rows[limit - 1].id : null;
}

/** 去掉为探测下一页而多取的一条 */
export function slicePage<T>(rows: T[], limit: number): T[] {
  return rows.length > limit ? rows.slice(0, limit) : rows;
}

@Injectable()
export class CaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 公开案例列表（搜索/筛选/排序/游标分页） */
  async listCases(query: CaseListQuery): Promise<CaseListPage> {
    const limit = clampLimit(query.limit);

    // SQLite 打包把 platforms/industries/capabilityTags 转 Json（无 hasSome），
    // 数组筛选改为应用层 filter；案例数据量小，全量查询 + 内存分页（不做游标）。
    const rows = await this.prisma.showcaseCase.findMany({
      where: buildCaseListWhere(query),
      orderBy: buildCaseListOrderBy(query.sort),
      // 仅取 id 即可判定体验可用性（experienceStatus），避免拉取私有 targetUrl
      include: { demoEndpoints: { select: { id: true } } },
    });

    const includeAny = (value: unknown, targets: string[] | undefined) =>
      !targets?.length ||
      targets.some((t) =>
        Array.isArray(value) ? (value as string[]).includes(t) : false,
      );

    const filtered = rows.filter(
      (row) =>
        includeAny(row.platforms, query.platforms) &&
        includeAny(row.industries, query.industries) &&
        includeAny(row.capabilityTags, query.capabilities),
    );

    // 游标分页：从 cursor 之后取 limit 条（案例数据量小，全量查 + 内存分页）
    let startIndex = 0;
    if (query.cursor) {
      const idx = filtered.findIndex((row) => row.id === query.cursor);
      if (idx >= 0) startIndex = idx + 1;
    }
    const pageRows = filtered.slice(startIndex);
    const cases = pageRows.slice(0, limit);
    const nextCursor = pageRows.length > limit ? pageRows[limit - 1].id : null;
    return { cases: cases as ShowcaseCaseRecord[], nextCursor };
  }

  /** 首页精选案例：按运营配置的精选位排序，仅返回仍已发布的案例 */
  async listFeaturedCases(): Promise<ShowcaseCaseRecord[]> {
    const collection = await this.prisma.showcaseCollection.findFirst({
      where: { slug: FEATURED_COLLECTION_SLUG },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            case: {
              include: { demoEndpoints: { select: { id: true } } },
            },
          },
        },
      },
    });
    if (!collection) return [];
    return (collection.items ?? [])
      .filter((item) => item.case?.status === 'published')
      .map((item) => item.case) as ShowcaseCaseRecord[];
  }

  /** 按 slug 查询已发布案例详情（含媒体 + 演示入口，供白名单序列化） */
  async getPublishedCaseBySlug(
    slug: string,
  ): Promise<ShowcaseCaseRecord | null> {
    const record = await this.prisma.showcaseCase.findFirst({
      where: { slug, status: 'published' },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        demoEndpoints: true,
        // 授权记录在查询层即 select 白名单字段，attachment 附件不进内存（深度防御）
        authorizations: {
          select: {
            grantor: true,
            scope: true,
            licenseName: true,
            sourceUrl: true,
          },
        },
      },
    });
    return record as ShowcaseCaseRecord | null;
  }

  /** 相关案例：同主行业 或 能力标签交集 的前 N 个已发布案例（排除自身） */
  async listRelatedCases(
    caseRecord: ShowcaseCaseRecord,
  ): Promise<ShowcaseCaseRecord[]> {
    const primaryIndustry = caseRecord.primaryIndustry ?? null;
    const tags = (caseRecord.capabilityTags ?? []).filter(Boolean);
    if (!primaryIndustry && tags.length === 0) return [];

    // 相关案例：同主行业 或 能力标签有交集。capabilityTags 的 hasSome 在 SQLite 打包下
    // 不可用（Json 无 hasSome），改为应用层 filter；数据量小，全量查询 + 内存取前 N。
    const rows = await this.prisma.showcaseCase.findMany({
      where: {
        status: 'published',
        id: { not: caseRecord.id },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { demoEndpoints: { select: { id: true } } },
    });

    const related = rows
      .filter((row) => {
        if (primaryIndustry && row.primaryIndustry === primaryIndustry) {
          return true;
        }
        if (tags.length > 0) {
          const rowTags = Array.isArray(row.capabilityTags)
            ? row.capabilityTags
            : [];
          return tags.some((t) => rowTags.includes(t));
        }
        return false;
      })
      .slice(0, RELATED_CASES_LIMIT);
    return related as ShowcaseCaseRecord[];
  }

  /**
   * 按 slug 查询公开合集（M5）。
   *
   * 仅返回 visibility ∈ {public, link_only}、status='published'、validUntil 未过期
   * 的合集；internalCustomerAlias/channelCode/ownerUserId 等内部字段不进返回结构，
   * 由 controller 经 toCollectionDto 白名单映射后输出。
   *
   * 合集内案例按 sortOrder 有序，且仅保留仍 published 的案例（下线案例自动过滤），
   * 每条案例带 demoEndpoints 供 toCaseSummaryDto 计算 experienceStatus。
   */
  async getPublicCollectionBySlug(
    slug: string,
  ): Promise<ShowcaseCollectionRecord | null> {
    const record = await this.prisma.showcaseCollection.findFirst({
      where: {
        slug,
        status: 'published',
        visibility: { in: ['public', 'link_only'] },
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            case: {
              include: { demoEndpoints: { select: { id: true } } },
            },
          },
        },
      },
    });
    if (!record) return null;

    // 下线案例自动过滤（合集不复制案例内容，案例下线后隐藏该项）
    const cases = (record.items ?? [])
      .filter((item) => item.case?.status === 'published')
      .map((item) => item.case);

    return {
      id: record.id,
      slug: record.slug,
      title: record.title,
      description: record.description,
      coverMedia: record.coverMedia,
      visibility: record.visibility,
      validUntil: record.validUntil,
      updatedAt: record.updatedAt,
      cases: cases as ShowcaseCaseRecord[],
    };
  }

  /** 已启用分类（platform/industry/capability），按类型 + 排序号输出 */
  async listEnabledTaxonomies(): Promise<ShowcaseTaxonomyRecord[]> {
    const rows = await this.prisma.showcaseTaxonomy.findMany({
      where: { enabled: true },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows;
  }
}
