import {
  buildCaseListOrderBy,
  buildCaseListWhere,
  CaseRepository,
  clampLimit,
  computeNextCursor,
  escapeLike,
  RELATED_CASES_LIMIT,
  slicePage,
} from './case.repository';
import {
  findForbiddenFields,
  ShowcaseCaseRecord,
  toCaseDetailDto,
  toCaseSummaryDto,
} from './field-whitelist';

/** 构造夹带私有字段的完整案例记录，验证白名单序列化不泄露 */
function privateCaseRecord(overrides: Partial<ShowcaseCaseRecord> = {}): ShowcaseCaseRecord {
  return {
    id: 'case-1',
    slug: 'retail-growth-hack',
    title: '零售增长案例',
    subtitle: '副标题',
    provenanceType: 'delivery',
    clientVisibility: 'public',
    primaryPlatform: 'wechat',
    platforms: ['wechat', 'douyin'],
    primaryIndustry: 'retail',
    industries: ['retail', 'fmcg'],
    capabilityTags: ['AI 获客', '私域运营'],
    businessProblem: '获客成本高',
    solutionSummary: 'AI 获客',
    keyFeatures: [
      { title: '特征1', description: '说明1' },
      { title: '特征2', description: '说明2' },
      { title: '特征3', description: '说明3' },
    ],
    resultsSummary: '降本 30%',
    evidenceLevel: 'E1',
    evidenceScope: '客户访谈',
    deliveryModes: ['h5'],
    maturity: 'product',
    techSummary: 'NestJS',
    coverMedia: { url: 'https://cdn/x.png', thumbnailUrl: 'https://cdn/x_t.png', altText: '封面', secretToken: '泄漏点' },
    seoTitle: 'SEO 标题',
    seoDescription: 'SEO 描述',
    status: 'published',
    publishedAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-18T00:00:00Z'),
    demoEndpoints: [
      {
        id: 'ep-1',
        endpointType: 'web',
        allowedDevices: ['desktop'],
        iframeAllowed: false,
        accessInstruction: '点击体验',
        healthStatus: 'healthy',
        targetUrl: 'https://internal.example.com/demo?token=SECRET',
        shortCode: 'SHORT-INTERNAL',
        ownerUserId: 'owner-1',
      },
    ],
    ...overrides,
  };
}

describe('case.repository（公开查询层）', () => {
  describe('escapeLike', () => {
    it('转义 % / _ / \\ 通配符', () => {
      expect(escapeLike('100%_fast\\run')).toBe('100\\%\\_fast\\\\run');
    });

    it('普通文本保持不变', () => {
      expect(escapeLike('零售增长')).toBe('零售增长');
    });
  });

  describe('buildCaseListWhere（筛选组合）', () => {
    it('恒含 status=published 过滤', () => {
      expect(buildCaseListWhere({})).toEqual({ status: 'published' });
    });

    it('关键词转义后 OR 匹配四个文本字段', () => {
      const where = buildCaseListWhere({ q: 'a%b' });
      expect(where.OR).toEqual([
        { title: { contains: 'a\\%b' } },
        { subtitle: { contains: 'a\\%b' } },
        { businessProblem: { contains: 'a\\%b' } },
        { solutionSummary: { contains: 'a\\%b' } },
      ]);
    });

    it('空白关键词不产生 OR', () => {
      expect(buildCaseListWhere({ q: '   ' }).OR).toBeUndefined();
    });

    it('平台/行业/能力筛选不落 DB where（SQLite 打包转 Json 后无 hasSome，移到应用层）', () => {
      const where = buildCaseListWhere({
        platforms: ['wechat', 'douyin'],
        industries: ['retail'],
        capabilities: ['ai'],
        provenances: ['delivery', 'open_source'],
      });
      expect(where.platforms).toBeUndefined();
      expect(where.industries).toBeUndefined();
      expect(where.capabilityTags).toBeUndefined();
      expect(where.provenanceType).toEqual({ in: ['delivery', 'open_source'] });
      // published 过滤仍然存在
      expect(where.status).toBe('published');
    });

    it('experience=true 过滤有演示入口的案例', () => {
      expect(buildCaseListWhere({ experience: true }).demoEndpoints).toEqual({
        some: {},
      });
    });

    it('experience=false 过滤无演示入口的案例', () => {
      expect(buildCaseListWhere({ experience: false }).demoEndpoints).toEqual({
        none: {},
      });
    });

    it('experience=null 不施加演示入口过滤', () => {
      expect(buildCaseListWhere({ experience: null }).demoEndpoints).toBeUndefined();
    });
  });

  describe('buildCaseListOrderBy（排序）', () => {
    it('updated 按 updatedAt 降序 + id 兜底', () => {
      expect(buildCaseListOrderBy('updated')).toEqual([
        { updatedAt: 'desc' },
        { id: 'desc' },
      ]);
    });

    it('recommended 与 popular 暂按 publishedAt 降序 + id 兜底', () => {
      expect(buildCaseListOrderBy('recommended')).toEqual([
        { publishedAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(buildCaseListOrderBy('popular')).toEqual([
        { publishedAt: 'desc' },
        { id: 'desc' },
      ]);
    });

    it('未指定排序默认按 publishedAt 降序', () => {
      expect(buildCaseListOrderBy(undefined)).toEqual([
        { publishedAt: 'desc' },
        { id: 'desc' },
      ]);
    });
  });

  describe('clampLimit（limit 钳制）', () => {
    it('小于 1 回默认值', () => {
      expect(clampLimit(0)).toBe(12);
      expect(clampLimit(-5)).toBe(12);
    });

    it('超过上限钳制到 48', () => {
      expect(clampLimit(100)).toBe(48);
    });

    it('合法值原样返回', () => {
      expect(clampLimit(24)).toBe(24);
    });
  });

  describe('computeNextCursor / slicePage（游标分页）', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}` }));

    it('多取到富余数据时返回当前页最后一条 id 作为游标', () => {
      expect(computeNextCursor(rows, 12)).toBe('c11');
      expect(slicePage(rows, 12)).toHaveLength(12);
    });

    it('无富余时 nextCursor 为 null 且不裁剪', () => {
      const exact = rows.slice(0, 12);
      expect(computeNextCursor(exact, 12)).toBeNull();
      expect(slicePage(exact, 12)).toHaveLength(12);
    });
  });

  describe('listCases（应用层数组筛选 + 内存分页）', () => {
    it('数组筛选在应用层生效，返回前 limit 条，nextCursor 为 null', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { id: 'c1', platforms: ['wechat'], industries: ['retail'], capabilityTags: ['ai'] },
        { id: 'c2', platforms: ['douyin'], industries: ['retail'], capabilityTags: ['ai'] },
        { id: 'c3', platforms: ['wechat'], industries: ['edu'], capabilityTags: [] },
      ]);
      const prisma = { showcaseCase: { findMany } };
      const repo = new CaseRepository(prisma as never);

      const page = await repo.listCases({
        limit: 12,
        platforms: ['douyin'],
      });

      // 不再传 cursor/take/skip（数组筛选在应用层，全量查询 + 内存分页）
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'published' } }),
      );
      // 应用层 filter：只保留 platforms 含 'douyin' 的（c2）
      expect(page.cases).toHaveLength(1);
      expect((page.cases[0] as { id: string }).id).toBe('c2');
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('字段白名单不泄露', () => {
    it('摘要序列化不泄露私有字段', () => {
      const dto = toCaseSummaryDto(privateCaseRecord());
      expect(findForbiddenFields(dto)).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain('SECRET');
      expect(JSON.stringify(dto)).not.toContain('internal.example.com');
    });

    it('详情序列化不泄露私有字段', () => {
      const dto = toCaseDetailDto(privateCaseRecord());
      expect(findForbiddenFields(dto)).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain('SECRET');
      expect(JSON.stringify(dto)).not.toContain('internal.example.com');
    });
  });
});

describe('RELATED_CASES_LIMIT', () => {
  it('相关案例条数上限为常量', () => {
    expect(RELATED_CASES_LIMIT).toBe(3);
  });
});
