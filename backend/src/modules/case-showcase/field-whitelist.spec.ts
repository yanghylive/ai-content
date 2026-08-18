import {
  findForbiddenFields,
  FORBIDDEN_PUBLIC_FIELDS,
  toCaseDetailDto,
  toCaseSummaryDto,
  toCollectionDto,
  toInquiryResponseDto,
  toTaxonomyDto,
  ShowcaseCaseRecord,
  ShowcaseCollectionRecord,
  ShowcaseTaxonomyRecord,
} from './field-whitelist';

/**
 * 构造一个「完整模型」形状的案例记录，故意夹带内部私有字段
 * （checksum / targetUrl / shortCode / ownerUserId / attachment 等），
 * 用于验证白名单映射函数能剥离这些字段。
 */
function fullCaseRecord(): ShowcaseCaseRecord {
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
    capabilityTags: ['增长'],
    businessProblem: '获客成本高',
    solutionSummary: 'AI 获客',
    keyFeatures: [
      { title: '特征1', description: '说明1', extraField: '泄漏点' },
      { title: '特征2', description: '说明2' },
      { title: '特征3', description: '说明3' },
    ],
    resultsSummary: '降本 30%',
    evidenceLevel: 'E1',
    evidenceScope: '客户访谈',
    deliveryModes: ['h5'],
    maturity: 'product',
    techSummary: 'NestJS',
    coverMedia: {
      url: 'https://cdn/x.png',
      thumbnailUrl: 'https://cdn/x_t.png',
      altText: '封面',
      secretToken: '泄漏点',
    },
    seoTitle: 'SEO 标题',
    seoDescription: 'SEO 描述',
    status: 'published',
    publishedAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-18T00:00:00Z'),
    media: [
      {
        id: 'media-1',
        mediaType: 'image',
        fileUrl: 'https://cdn/f.png',
        thumbnailUrl: 'https://cdn/f_t.png',
        altText: '配图',
        deviceFrame: 'mobile',
        sortOrder: 0,
        checksum: 'sha256-abc',
      },
    ],
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
    authorizations: [
      {
        id: 'auth-1',
        recordType: 'customer_authorization',
        grantor: '某客户',
        scope: '公开展示案例内容',
        licenseName: '客户授权',
        sourceUrl: null,
        reviewStatus: 'approved',
        attachment: 'https://private.example.com/contract.pdf',
      },
    ],
  } as unknown as ShowcaseCaseRecord;
}

describe('field-whitelist（公开 DTO 不泄露 private 字段）', () => {
  it('FORBIDDEN_PUBLIC_FIELDS 覆盖四个关键私有字段', () => {
    expect(FORBIDDEN_PUBLIC_FIELDS).toEqual(
      expect.arrayContaining([
        'internalCustomerAlias',
        'attachment',
        'contactValue',
        'targetUrl',
      ]),
    );
  });

  describe('案例摘要 DTO', () => {
    it('不泄露 targetUrl / contactValue / attachment / internalCustomerAlias', () => {
      const dto = toCaseSummaryDto(fullCaseRecord());
      expect(findForbiddenFields(dto)).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain('SECRET');
    });

    it('封面仅保留 url/thumbnailUrl/altText，剥离多余字段', () => {
      const dto = toCaseSummaryDto(fullCaseRecord());
      expect(dto.coverMedia).toEqual({
        url: 'https://cdn/x.png',
        thumbnailUrl: 'https://cdn/x_t.png',
        altText: '封面',
      });
      expect(dto.coverMedia).not.toHaveProperty('secretToken');
    });
  });

  describe('案例详情 DTO', () => {
    it('不泄露演示入口 targetUrl（内部目标地址），但公开短链码用于 /r/:code 跳转', () => {
      const dto = toCaseDetailDto(fullCaseRecord());
      expect(findForbiddenFields(dto)).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain('internal.example.com');
      expect(dto.demoEndpoints[0]).not.toHaveProperty('targetUrl');
      expect(dto.demoEndpoints[0]).not.toHaveProperty('ownerUserId');
      expect(dto.demoEndpoints[0]).not.toHaveProperty('fallbackTarget');
      // 短链码公开（前端跳转走 /r/:code），不暴露完整 targetUrl 配置
      expect(dto.demoEndpoints[0].shortCode).toBe('SHORT-INTERNAL');
      expect(dto.demoEndpoints[0]).toHaveProperty('fallbackType');
    });

    it('不泄露媒体 checksum 等内部字段', () => {
      const dto = toCaseDetailDto(fullCaseRecord());
      expect(dto.media[0]).not.toHaveProperty('checksum');
      expect(JSON.stringify(dto)).not.toContain('sha256-abc');
    });

    it('keyFeatures 结构化序列化：仅保留 title/description，剥离多余字段', () => {
      const dto = toCaseDetailDto(fullCaseRecord());
      expect(dto.keyFeatures).toHaveLength(3);
      expect(dto.keyFeatures[0]).toEqual({
        title: '特征1',
        description: '说明1',
      });
      expect(dto.keyFeatures[0]).not.toHaveProperty('extraField');
      expect(JSON.stringify(dto)).not.toContain('泄漏点');
    });

    it('attribution 仅暴露 grantor/scope/licenseName/sourceUrl，不泄露 attachment 附件', () => {
      const dto = toCaseDetailDto(fullCaseRecord());
      expect(dto).not.toHaveProperty('authorizations');
      expect(findForbiddenFields(dto)).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain('contract.pdf');
      expect(JSON.stringify(dto)).not.toContain('private.example.com');
      expect(dto.attribution).toEqual([
        {
          grantor: '某客户',
          scope: '公开展示案例内容',
          licenseName: '客户授权',
          sourceUrl: null,
        },
      ]);
      expect(dto.attribution[0]).not.toHaveProperty('attachment');
      expect(dto.attribution[0]).not.toHaveProperty('reviewStatus');
    });

    it('不泄露授权 attachment（免责声明不含私有附件信息）', () => {
      const dto = toCaseDetailDto(fullCaseRecord());
      expect(dto.disclaimer).toBeTruthy();
      expect(dto.disclaimer).not.toContain('contract.pdf');
    });
  });

  describe('合集 DTO', () => {
    it('不泄露 internalCustomerAlias（内部客户简称）', () => {
      const record = {
        id: 'col-1',
        slug: 'sales-bundle',
        title: '销售合集',
        description: '描述',
        visibility: 'public',
        cases: [fullCaseRecord()],
        updatedAt: new Date(),
        internalCustomerAlias: '某头部零售客户',
        channelCode: 'CH-SALES-1',
        ownerUserId: 'owner-1',
        status: 'published',
      } as unknown as ShowcaseCollectionRecord;
      const dto = toCollectionDto(record);
      expect(findForbiddenFields(dto)).toEqual([]);
      expect(dto).not.toHaveProperty('internalCustomerAlias');
      expect(dto).not.toHaveProperty('channelCode');
      expect(dto).not.toHaveProperty('ownerUserId');
      expect(dto).not.toHaveProperty('status');
      expect(JSON.stringify(dto)).not.toContain('某头部零售客户');
    });
  });

  describe('咨询响应 DTO', () => {
    it('仅回咨询编号，绝不回显 contactValue', () => {
      const dto = toInquiryResponseDto({
        inquiryId: 'inq-1',
        contactValue: '13800138000',
      });
      expect(dto).toEqual({ inquiryId: 'inq-1' });
      expect(dto).not.toHaveProperty('contactValue');
      expect(findForbiddenFields(dto)).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain('13800138000');
    });
  });

  describe('分类 DTO', () => {
    it('仅暴露白名单字段', () => {
      const dto = toTaxonomyDto({
        id: 'tax-1',
        type: 'industry',
        slug: 'retail',
        name: '零售',
        sortOrder: 1,
        enabled: true,
      } as unknown as ShowcaseTaxonomyRecord);
      expect(dto).toEqual({
        id: 'tax-1',
        type: 'industry',
        slug: 'retail',
        name: '零售',
        sortOrder: 1,
      });
      expect(dto).not.toHaveProperty('enabled');
    });
  });

  describe('findForbiddenFields 递归检测', () => {
    it('嵌套对象中的 targetUrl 也能被检出', () => {
      const hits = findForbiddenFields({
        id: 'x',
        demoEndpoints: [{ targetUrl: 'https://internal/x' }],
      });
      expect(hits).toContain('demoEndpoints[0].targetUrl');
    });

    it('干净对象返回空数组', () => {
      expect(findForbiddenFields({ id: 'x', slug: 'a' })).toEqual([]);
    });
  });
});
