import {
  CaseValidationService,
  CasePublishValidationInput,
} from './case-validation.service';

describe('case-validation.service（发布前校验）', () => {
  const service = new CaseValidationService();

  function baseInput(
    overrides: Partial<CasePublishValidationInput> = {},
  ): CasePublishValidationInput {
    return {
      slug: 'retail-growth-hack',
      provenanceType: 'delivery',
      evidenceLevel: 'E0',
      keyFeatures: [
        { title: '特性1', description: '说明1' },
        { title: '特性2', description: '说明2' },
        { title: '特性3', description: '说明3' },
      ],
      nextReviewAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      ownerUserId: 'owner-1',
      reviewerUserId: 'reviewer-1',
      media: [{ id: 'm1' }],
      demoEndpoints: [{ endpointType: 'web', fallbackType: 'media' }],
      authorizations: [{ recordType: 'customer_authorization', reviewStatus: 'approved' }],
      ...overrides,
    };
  }

  it('全字段合法时通过', () => {
    const result = service.validateForPublish(baseInput());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  describe('slug 格式', () => {
    it.each(['Uppercase', '含 空格', 'trailing-', '-leading', 'under_score', ''])(
      '拒绝非法 slug：%s',
      (slug) => {
        const result = service.validateForPublish(baseInput({ slug }));
        expect(result.ok).toBe(false);
        expect(result.errors.some((e) => e.includes('slug'))).toBe(true);
      },
    );

    it('接受合法 slug', () => {
      expect(service.isValidSlug('a-b-c-123')).toBe(true);
      expect(service.isValidSlug('abc')).toBe(true);
    });
  });

  describe('provenanceType 合法', () => {
    it('拒绝未知来源类型', () => {
      const result = service.validateForPublish(
        baseInput({ provenanceType: 'unknown' }),
      );
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('provenanceType'))).toBe(true);
    });
  });

  describe('四类来源必要条件', () => {
    it('九章交付：无授权记录 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({ authorizations: [] }),
      );
      expect(result.errors.some((e) => e.includes('授权'))).toBe(true);
    });

    it('九章交付：授权未审核通过（内部证明缺失）→ 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          authorizations: [{ recordType: 'customer_authorization', reviewStatus: 'pending' }],
        }),
      );
      expect(result.errors.some((e) => e.includes('审核通过'))).toBe(true);
    });

    it('开源演示：缺上游地址 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          provenanceType: 'open_source',
          authorizations: [
            { recordType: 'oss_license', licenseName: 'MIT', versionOrCommit: 'v1.0' },
          ],
        }),
      );
      expect(result.errors.some((e) => e.includes('上游源码地址'))).toBe(true);
    });

    it('开源演示：缺许可证 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          provenanceType: 'open_source',
          authorizations: [
            { recordType: 'oss_license', sourceUrl: 'https://github.com/x/y', versionOrCommit: 'v1.0' },
          ],
        }),
      );
      expect(result.errors.some((e) => e.includes('许可证'))).toBe(true);
    });

    it('开源演示：缺版本 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          provenanceType: 'open_source',
          authorizations: [
            { recordType: 'oss_license', sourceUrl: 'https://github.com/x/y', licenseName: 'MIT' },
          ],
        }),
      );
      expect(result.errors.some((e) => e.includes('版本'))).toBe(true);
    });

    it('开源演示：三要素齐全 → 通过来源校验', () => {
      const result = service.validateForPublish(
        baseInput({
          provenanceType: 'open_source',
          authorizations: [
            {
              recordType: 'oss_license',
              sourceUrl: 'https://github.com/x/y',
              licenseName: 'MIT',
              versionOrCommit: 'v1.0',
            },
          ],
        }),
      );
      expect(result.errors.some((e) => e.includes('开源'))).toBe(false);
    });

    it('原型：缺演示数据声明 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({ provenanceType: 'prototype', demoDataDeclaration: false }),
      );
      expect(result.errors.some((e) => e.includes('演示数据'))).toBe(true);
    });

    it('模板：有演示数据声明 → 通过来源校验', () => {
      const result = service.validateForPublish(
        baseInput({ provenanceType: 'template', demoDataDeclaration: true }),
      );
      expect(result.errors.some((e) => e.includes('演示数据'))).toBe(false);
    });
  });

  describe('evidenceLevel / evidenceScope', () => {
    it('evidenceLevel=E1 但缺 evidenceScope → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({ evidenceLevel: 'E1', evidenceScope: null }),
      );
      expect(result.errors.some((e) => e.includes('evidenceScope'))).toBe(true);
    });

    it('evidenceLevel=E1 且有 evidenceScope → 通过', () => {
      const result = service.validateForPublish(
        baseInput({ evidenceLevel: 'E1', evidenceScope: '客户访谈记录' }),
      );
      expect(result.errors.some((e) => e.includes('evidenceScope'))).toBe(false);
    });

    it('evidenceLevel=E0 无需 evidenceScope', () => {
      const result = service.validateForPublish(
        baseInput({ evidenceLevel: 'E0', evidenceScope: null }),
      );
      expect(result.errors.some((e) => e.includes('evidenceScope'))).toBe(false);
    });
  });

  describe('keyFeatures（结构化）', () => {
    it('少于 3 项 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          keyFeatures: [
            { title: 'a', description: 'b' },
            { title: 'c', description: 'd' },
          ],
        }),
      );
      expect(result.errors.some((e) => e.includes('关键特性'))).toBe(true);
    });

    it('某项目 title 为空 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          keyFeatures: [
            { title: '', description: '说明1' },
            { title: '特性2', description: '说明2' },
            { title: '特性3', description: '说明3' },
          ],
        }),
      );
      expect(result.errors.some((e) => e.includes('title'))).toBe(true);
    });

    it('某项目 description 为空 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          keyFeatures: [
            { title: '特性1', description: '说明1' },
            { title: '特性2', description: '   ' },
            { title: '特性3', description: '说明3' },
          ],
        }),
      );
      expect(result.errors.some((e) => e.includes('description'))).toBe(true);
    });

    it('3 项且 title/description 齐全 → 通过', () => {
      const result = service.validateForPublish(baseInput());
      expect(result.errors.some((e) => e.includes('关键特性'))).toBe(false);
      expect(result.errors.some((e) => e.includes('title'))).toBe(false);
    });
  });

  describe('媒体 + 体验/回退', () => {
    it('无媒体 → 阻断', () => {
      const result = service.validateForPublish(baseInput({ media: [] }));
      expect(result.errors.some((e) => e.includes('媒体'))).toBe(true);
    });

    it('无演示入口 → 阻断', () => {
      const result = service.validateForPublish(baseInput({ demoEndpoints: [] }));
      expect(result.errors.some((e) => e.includes('演示体验入口'))).toBe(true);
    });

    it('演示入口无回退（fallbackType=none）→ 阻断', () => {
      const result = service.validateForPublish(
        baseInput({
          demoEndpoints: [{ endpointType: 'web', fallbackType: 'none' }],
        }),
      );
      expect(result.errors.some((e) => e.includes('回退'))).toBe(true);
    });
  });

  describe('nextReviewAt', () => {
    it('缺 nextReviewAt → 阻断', () => {
      const result = service.validateForPublish(baseInput({ nextReviewAt: null }));
      expect(result.errors.some((e) => e.includes('nextReviewAt'))).toBe(true);
    });

    it('nextReviewAt 早于当前时间 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({ nextReviewAt: new Date(Date.now() - 1000) }),
      );
      expect(result.errors.some((e) => e.includes('晚于当前时间'))).toBe(true);
    });
  });

  describe('职责分离', () => {
    it('创建者即审核人 → 阻断', () => {
      const result = service.validateForPublish(
        baseInput({ ownerUserId: 'same-user', reviewerUserId: 'same-user' }),
      );
      expect(result.errors.some((e) => e.includes('职责分离'))).toBe(true);
    });

    it('创建者与审核人不同 → 通过', () => {
      const result = service.validateForPublish(
        baseInput({ ownerUserId: 'owner-1', reviewerUserId: 'reviewer-1' }),
      );
      expect(result.errors.some((e) => e.includes('职责分离'))).toBe(false);
    });
  });
});
