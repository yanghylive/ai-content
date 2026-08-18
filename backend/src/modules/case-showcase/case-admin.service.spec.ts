import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaseValidationService } from './case-validation.service';
import { CaseAdminService } from './case-admin.service';
import { CaseAdminInputDto } from './dto/case-admin.dto';

function validInput(overrides: Partial<CaseAdminInputDto> = {}): CaseAdminInputDto {
  return {
    title: '制造业知识库案例',
    slug: 'manufacturing-knowledge-base',
    provenanceType: 'prototype',
    keyFeatures: [
      { title: '特性一', description: '描述一' },
      { title: '特性二', description: '描述二' },
      { title: '特性三', description: '描述三' },
    ],
    ...overrides,
  };
}

describe('CaseAdminService（后台案例管理）', () => {
  function makeService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      showcaseCase: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      showcaseCaseReview: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      showcaseCollection: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      showcaseCollectionItem: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
      ...overrides,
    };
    return {
      prisma,
      service: new CaseAdminService(
        prisma as never,
        new CaseValidationService(),
      ),
    };
  }

  it('createCase：生成草稿并自动补默认字段', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        create: jest.fn().mockResolvedValue({ id: 'case-1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'case-1',
          slug: 'manufacturing-knowledge-base',
          title: '制造业知识库案例',
        }),
      },
    });

    await service.createCase(validInput(), 'user-1');

    const createArg = prisma.showcaseCase.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data).toMatchObject({
      title: '制造业知识库案例',
      slug: 'manufacturing-knowledge-base',
      status: 'draft',
      provenanceType: 'prototype',
      platforms: [],
      industries: [],
      capabilityTags: [],
      deliveryModes: [],
      ownerUserId: 'user-1',
    });
  });

  it('createCase：slug 非法被拒绝', async () => {
    const { service } = makeService();
    await expect(
      service.createCase(validInput({ slug: 'Invalid Slug!' }), 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submitForReview：draft → submitted，落审核记录', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'case-1', status: 'draft' })
          .mockResolvedValue({ id: 'case-1', status: 'submitted' }),
        update: jest.fn().mockResolvedValue({ id: 'case-1' }),
      },
    });

    await service.submitForReview('case-1', 'user-1');

    expect(prisma.showcaseCase.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: { status: 'submitted', reviewerUserId: null },
    });
    expect(prisma.showcaseCaseReview.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        reviewType: 'submit',
        submittedBy: 'user-1',
        decision: 'pending',
      },
    });
  });

  it('submitForReview：非草稿状态被拒绝（状态机）', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'case-1', status: 'published' }),
        update: jest.fn(),
      },
    });

    await expect(service.submitForReview('case-1', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.showcaseCase.update).not.toHaveBeenCalled();
  });

  it('review：approved → 已批准；rejected → 退回草稿', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'case-1', status: 'submitted' })
          .mockResolvedValue({ id: 'case-1', status: 'approved' }),
        update: jest.fn().mockResolvedValue({ id: 'case-1' }),
      },
    });

    await service.review('case-1', { decision: 'approved', comments: '通过' }, 'reviewer-1');

    expect(prisma.showcaseCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'approved' }),
      }),
    );
    expect(prisma.showcaseCaseReview.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        reviewType: 'approve',
        reviewedBy: 'reviewer-1',
        decision: 'approved',
        comments: '通过',
      },
    });
  });

  it('review：已发布案例拒绝审批被拒（状态机）', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'case-1', status: 'published' }),
        update: jest.fn(),
      },
    });

    await expect(
      service.review('case-1', { decision: 'approved' }, 'reviewer-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.showcaseCase.update).not.toHaveBeenCalled();
  });

  it('publishCase：approved → published，写 publishedAt + 审计', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'case-1',
            status: 'approved',
            publishedAt: null,
          })
          .mockResolvedValue({ id: 'case-1', status: 'published' }),
        update: jest.fn().mockResolvedValue({ id: 'case-1' }),
      },
    });

    await service.publishCase('case-1', 'admin-1');

    expect(prisma.showcaseCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case-1' },
        data: expect.objectContaining({
          status: 'published',
          publishedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.showcaseCaseReview.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        reviewType: 'publish',
        reviewedBy: 'admin-1',
        decision: 'approved',
        comments: null,
      },
    });
  });

  it('publishCase：非 approved 状态被拒绝（状态机）', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'case-1', status: 'draft', publishedAt: null }),
        update: jest.fn(),
      },
    });

    await expect(service.publishCase('case-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.showcaseCase.update).not.toHaveBeenCalled();
  });

  it('unpublishCase：缺少原因被拒绝', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'case-1', status: 'published' }),
        update: jest.fn(),
      },
    });

    await expect(
      service.unpublishCase('case-1', '   ', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.showcaseCase.update).not.toHaveBeenCalled();
  });

  it('unpublishCase：published → unpublished，落审计记录含原因', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'case-1', status: 'published' })
          .mockResolvedValue({ id: 'case-1', status: 'unpublished' }),
        update: jest.fn().mockResolvedValue({ id: 'case-1' }),
      },
    });

    await service.unpublishCase('case-1', '授权到期，紧急下线', 'admin-1');

    expect(prisma.showcaseCase.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: { status: 'unpublished' },
    });
    expect(prisma.showcaseCaseReview.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        reviewType: 'unpublish',
        reviewedBy: 'admin-1',
        decision: 'unpublished',
        comments: '授权到期，紧急下线',
      },
    });
  });

  it('setFeatured：校验不存在案例 + 有序覆盖', async () => {
    const { prisma, service } = makeService({
      showcaseCase: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'case-a' },
          { id: 'case-b' },
        ]),
      },
      showcaseCollection: {
        upsert: jest.fn().mockResolvedValue({ id: 'coll-featured' }),
        findFirst: jest.fn().mockResolvedValue({
          items: [
            { caseId: 'case-a', sortOrder: 0, case: { slug: 'a', title: 'A', status: 'published' } },
            { caseId: 'case-b', sortOrder: 1, case: { slug: 'b', title: 'B', status: 'published' } },
          ],
        }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    });

    const result = await service.setFeatured(['case-a', 'case-b', 'case-a']);

    expect(prisma.showcaseCollectionItem.deleteMany).toHaveBeenCalledWith({
      where: { collectionId: 'coll-featured' },
    });
    expect(prisma.showcaseCollectionItem.create).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ caseId: 'case-a', sortOrder: 0 });
  });

  it('setFeatured：包含不存在案例被拒绝', async () => {
    const { service } = makeService({
      showcaseCase: {
        findMany: jest.fn().mockResolvedValue([{ id: 'case-a' }]),
      },
    });

    await expect(service.setFeatured(['case-a', 'ghost'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getAudit：返回审核记录 + 案例标题/状态变更', async () => {
    const { service } = makeService({
      showcaseCaseReview: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'r1',
            caseId: 'case-1',
            reviewType: 'approve',
            submittedBy: null,
            reviewedBy: 'reviewer-1',
            decision: 'approved',
            comments: null,
            changedFields: ['status'],
            createdAt: new Date('2026-08-18T00:00:00.000Z'),
            case: { slug: 'case-a', title: '案例A' },
          },
        ]),
      },
    });

    const result = await service.getAudit();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'r1',
      caseSlug: 'case-a',
      caseTitle: '案例A',
      decision: 'approved',
    });
  });

  it('getCase：不存在抛 NotFound', async () => {
    const { service } = makeService({
      showcaseCase: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.getCase('ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('completenessHints：缺失字段返回提示清单', () => {
    const { service } = makeService();
    const hints = service.completenessHints(
      validInput({
        title: '',
        keyFeatures: [],
        media: [],
        demoEndpoints: [],
      }),
    );
    expect(hints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('标题'),
        expect.stringContaining('关键特性'),
        expect.stringContaining('媒体'),
        expect.stringContaining('演示体验入口'),
      ]),
    );
  });
});
