import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth.decorator';
import {
  ShortLinkService,
  ShortLinkUnavailableReason,
} from './short-link.service';
import { InquiryService } from './inquiry.service';
import { CaseListResponseDto } from './dto/case-list-response.dto';
import { CaseDetailResponseDto } from './dto/case-detail-response.dto';
import { TaxonomyResponseDto } from './dto/taxonomy-response.dto';
import { CollectionDto } from './dto/collection.dto';
import { InquiryDto } from './dto/inquiry.dto';
import { ListCasesQueryDto } from './dto/list-cases-query.dto';
import {
  CaseRepository,
  CASE_LIST_DEFAULT_LIMIT,
  CaseListSort,
} from './case.repository';
import { PROVENANCE_TYPES } from './enums';
import {
  toCaseDetailDto,
  toCaseSummaryDto,
  toCollectionDto,
  toInquiryResponseDto,
  toTaxonomyDto,
} from './field-whitelist';

/**
 * 案例展示中心 · 公开 API。
 *
 * 公开端完全匿名：类级 @Public() 跳过全局 AuthGuard，不使用任何登录/角色 guard。
 * 路由经全局前缀 api 映射为 /api/v1/* 与 /api/r/:code。
 *
 * 白名单硬约束：公开响应必须经 field-whitelist.ts 显式 pick 允许字段，
 * 绝不整体序列化 Prisma model。列表/详情/分类于 M2 接入真实查询；
 * 短链（r/:code）M4、咨询（inquiries）M5、合集（collections）M5 实现。
 */
@ApiTags('case-showcase')
@Public()
@Controller()
export class CaseShowcaseController {
  constructor(
    private readonly repository: CaseRepository,
    private readonly shortLinkService: ShortLinkService,
    private readonly inquiryService: InquiryService,
  ) {}

  @Get('v1/cases')
  @ApiOperation({ summary: '公开案例列表（搜索/筛选/排序/游标分页）' })
  async listCases(
    @Query() query: ListCasesQueryDto,
  ): Promise<CaseListResponseDto> {
    // 首页精选：按运营精选位排序返回（复用 M2 listCases 之外的专用查询）
    if (query.featured === 'true') {
      const cases = await this.repository.listFeaturedCases();
      return { data: cases.map(toCaseSummaryDto), nextCursor: null };
    }

    const page = await this.repository.listCases({
      q: query.q,
      platforms: this.splitCsv(query.platform),
      industries: this.splitCsv(query.industry),
      capabilities: this.splitCsv(query.capability),
      provenances: this.onlyKnownProvenance(this.splitCsv(query.provenance)),
      experience: this.parseExperience(query.experience),
      sort: (query.sort as CaseListSort) ?? 'recommended',
      cursor: query.cursor,
      limit: query.limit ?? CASE_LIST_DEFAULT_LIMIT,
    });

    return {
      data: page.cases.map(toCaseSummaryDto),
      nextCursor: page.nextCursor,
    };
  }

  @Get('v1/cases/:slug')
  @ApiOperation({ summary: '公开案例详情（含相关案例）' })
  async getCase(@Param('slug') slug: string): Promise<CaseDetailResponseDto> {
    const record = await this.repository.getPublishedCaseBySlug(slug);
    if (!record) {
      throw new NotFoundException('案例不存在或尚未发布');
    }

    const related = await this.repository.listRelatedCases(record);
    return {
      ...toCaseDetailDto(record),
      relatedCases: related.map(toCaseSummaryDto),
    };
  }

  @Get('v1/taxonomies')
  @ApiOperation({ summary: '公开分类（平台/行业/能力）' })
  async listTaxonomies(): Promise<TaxonomyResponseDto> {
    const rows = await this.repository.listEnabledTaxonomies();
    const dtos = rows.map(toTaxonomyDto);
    return {
      platform: dtos.filter((d) => d.type === 'platform'),
      industry: dtos.filter((d) => d.type === 'industry'),
      capability: dtos.filter((d) => d.type === 'capability'),
    };
  }

  @Get('v1/collections/:slug')
  @ApiOperation({ summary: '公开合集信息 + 有效案例摘要（M5 实现）' })
  async getCollection(@Param('slug') slug: string): Promise<CollectionDto> {
    const record = await this.repository.getPublicCollectionBySlug(slug);
    if (!record) {
      throw new NotFoundException('合集不存在、已下线或链接已过期');
    }
    // 白名单映射：绝不泄露 internalCustomerAlias / channelCode / ownerUserId / status
    return toCollectionDto(record);
  }

  @Get('r/:code')
  @ApiOperation({
    summary: '短链跳转（302 重定向 + 聚合事件 + 防开放重定向）',
  })
  async resolveShortLink(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.shortLinkService.resolveShortLink(code);

    if (result.kind === 'redirect') {
      res.redirect(result.statusCode, result.url);
      return;
    }

    res
      .status(statusForUnavailable(result.reason))
      .type('html')
      .send(renderUnavailablePage(result.reason));
  }

  @Post('v1/inquiries')
  @ApiOperation({ summary: '提交咨询（M5：落 Lead + 幂等去重 + 来源归因）' })
  async submitInquiry(
    @Body() dto: InquiryDto,
    @Req() req: Request,
  ): Promise<{ inquiryId: string | null }> {
    const record = await this.inquiryService.submit({
      dto,
      ip: req?.ip,
    });
    // 响应仅回咨询编号，绝不回显 contactValue（架构 §4.4）
    return toInquiryResponseDto(record);
  }

  /** 逗号分隔字符串 → 去空白去空项的数组 */
  private splitCsv(value?: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /** 仅保留已知来源类型，静默丢弃非法值（防御，白名单校验之外再兜底） */
  private onlyKnownProvenance(values: string[]): string[] {
    return values.filter((value) => PROVENANCE_TYPES.includes(value));
  }

  private parseExperience(value?: string): boolean | null {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
  }
}

/** 不可用原因 → HTTP 状态码（not_found 用 404，其余用 410 Gone） */
function statusForUnavailable(reason: ShortLinkUnavailableReason): number {
  return reason === 'not_found' ? 404 : 410;
}

const UNAVAILABLE_MESSAGES: Record<ShortLinkUnavailableReason, string> = {
  not_found: '链接不存在或已被移除',
  disabled: '该链接已停用',
  expired: '该链接已过期',
  invalid_target: '该链接目标无效',
};

/** 品牌化说明页（PRD §9.8：过期/停用链接不显示系统错误页，绝不回显堆栈） */
function renderUnavailablePage(reason: ShortLinkUnavailableReason): string {
  const message = UNAVAILABLE_MESSAGES[reason];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>链接已失效 · 九章</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center;
      justify-content: center; font-family: -apple-system, BlinkMacSystemFont,
      "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f6f6f8; color: #2b2b33;
    }
    .card {
      max-width: 420px; width: calc(100% - 48px); text-align: center;
      background: #fff; border: 1px solid #ececf0; border-radius: 16px;
      padding: 40px 28px; box-shadow: 0 12px 40px rgba(0,0,0,.06);
    }
    .brand { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
    .brand span { color: #722ed1; }
    .title { margin: 20px 0 8px; font-size: 18px; font-weight: 600; }
    .desc { margin: 0; font-size: 14px; color: #71717a; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">九章<span>智能</span></div>
    <h1 class="title">链接已失效</h1>
    <p class="desc">${message}。<br />如需帮助，请通过九章官网或联系您的对接人获取最新入口。</p>
  </div>
</body>
</html>`;
}
