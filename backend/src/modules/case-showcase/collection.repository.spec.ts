import { CaseRepository } from './case.repository';
import {
  findForbiddenFields,
  ShowcaseCaseRecord,
  toCollectionDto,
} from './field-whitelist';

function caseRecord(
  id: string,
  status: string,
  overrides: Partial<ShowcaseCaseRecord> = {},
): ShowcaseCaseRecord {
  return {
    id,
    slug: `case-${id}`,
    title: `案例 ${id}`,
    subtitle: null,
    provenanceType: 'delivery',
    primaryPlatform: 'wechat',
    industries: ['retail'],
    capabilityTags: ['ai'],
    coverMedia: { url: `https://cdn/${id}.png`, thumbnailUrl: null, altText: '' },
    status,
    updatedAt: new Date('2026-08-18T00:00:00Z'),
    demoEndpoints: [],
    ...overrides,
  } as ShowcaseCaseRecord;
}

describe('CaseRepository.getPublicCollectionBySlug（合集公开查询）', () => {
  it('查询条件：仅 public/link_only、status=published、validUntil 未过期', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { showcaseCollection: { findFirst } };
    const repo = new CaseRepository(prisma as never);

    await repo.getPublicCollectionBySlug('sales-bundle');

    const where = findFirst.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).toMatchObject({
      slug: 'sales-bundle',
      status: 'published',
      visibility: { in: ['public', 'link_only'] },
    });
    expect(where.OR).toEqual([
      { validUntil: null },
      { validUntil: { gt: expect.any(Date) } },
    ]);
  });

  it('下线案例自动过滤：仅返回仍 published 的案例，且保持 sortOrder 有序', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'col-1',
      slug: 'sales-bundle',
      title: '销售合集',
      description: '描述',
      coverMedia: null,
      visibility: 'public',
      validUntil: null,
      updatedAt: new Date('2026-08-18T00:00:00Z'),
      internalCustomerAlias: '某头部零售客户', // 夹带私有字段，验证不进入返回结构
      channelCode: 'CH-SALES-1',
      ownerUserId: 'owner-1',
      status: 'published',
      items: [
        { sortOrder: 0, case: caseRecord('c1', 'published') },
        { sortOrder: 1, case: caseRecord('c2', 'unpublished') },
        { sortOrder: 2, case: caseRecord('c3', 'published') },
      ],
    });
    const prisma = { showcaseCollection: { findFirst } };
    const repo = new CaseRepository(prisma as never);

    const record = await repo.getPublicCollectionBySlug('sales-bundle');

    expect(record).not.toBeNull();
    expect(record!.cases).toHaveLength(2);
    expect(record!.cases.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('internalCustomerAlias / channelCode / ownerUserId 不进入返回结构，公开 DTO 不泄露', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'col-1',
      slug: 'sales-bundle',
      title: '销售合集',
      description: '描述',
      coverMedia: null,
      visibility: 'link_only',
      validUntil: null,
      updatedAt: new Date('2026-08-18T00:00:00Z'),
      internalCustomerAlias: '某头部零售客户',
      channelCode: 'CH-SALES-1',
      ownerUserId: 'owner-1',
      status: 'published',
      items: [{ sortOrder: 0, case: caseRecord('c1', 'published') }],
    });
    const prisma = { showcaseCollection: { findFirst } };
    const repo = new CaseRepository(prisma as never);

    const record = await repo.getPublicCollectionBySlug('sales-bundle');
    expect(record).not.toHaveProperty('internalCustomerAlias');
    expect(record).not.toHaveProperty('channelCode');
    expect(record).not.toHaveProperty('ownerUserId');
    expect(record).not.toHaveProperty('status');

    const dto = toCollectionDto(record!);
    expect(findForbiddenFields(dto)).toEqual([]);
    expect(JSON.stringify(dto)).not.toContain('某头部零售客户');
    expect(JSON.stringify(dto)).not.toContain('CH-SALES-1');
  });

  it('slug 不存在返回 null（controller 转 404）', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { showcaseCollection: { findFirst } };
    const repo = new CaseRepository(prisma as never);

    await expect(
      repo.getPublicCollectionBySlug('not-exist'),
    ).resolves.toBeNull();
  });
});
