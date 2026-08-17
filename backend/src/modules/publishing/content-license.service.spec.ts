import { ContentLicenseService } from './content-license.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    contentVariant: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(async ({ where, data }) => ({
        id: where.id,
        ...data,
      })),
    },
    ...overrides,
  } as never;
}

describe('ContentLicenseService', () => {
  it('unauthorized → 禁止发布（带原因）', async () => {
    const prisma = makePrisma({
      contentVariant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'v1', licenseStatus: 'unauthorized', copyrightNotice: '素材来自商业图库未授权',
        }),
      },
    });
    const svc = new ContentLicenseService(prisma);
    const r = await svc.checkLicense({ tenantId: 't1', variantId: 'v1' });
    expect(r.allowedToPublish).toBe(false);
    expect(r.reason).toContain('未获授权');
  });

  it('authorized → 放行', async () => {
    const prisma = makePrisma({
      contentVariant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'v1', licenseStatus: 'authorized', copyrightNotice: null }),
      },
    });
    const svc = new ContentLicenseService(prisma);
    const r = await svc.checkLicense({ tenantId: 't1', variantId: 'v1' });
    expect(r.allowedToPublish).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('pending → 禁止发布（审核中）', async () => {
    const prisma = makePrisma({
      contentVariant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'v1', licenseStatus: 'pending', copyrightNotice: null }),
      },
    });
    const svc = new ContentLicenseService(prisma);
    const r = await svc.checkLicense({ tenantId: 't1', variantId: 'v1' });
    expect(r.allowedToPublish).toBe(false);
    expect(r.reason).toContain('审核中');
  });

  it('unknown/不存在 → 警告但放行（不阻断旧流程）', async () => {
    const prisma = makePrisma();
    const svc = new ContentLicenseService(prisma);
    const r = await svc.checkLicense({ tenantId: 't1', variantId: 'v1' });
    expect(r.allowedToPublish).toBe(true);
    expect(r.reason).toContain('建议补录');
  });

  it('setLicense 登记 + 校验生效', async () => {
    const prisma = makePrisma({
      contentVariant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'v1' }),
        update: jest.fn().mockImplementation(async ({ where, data }) => ({
          id: where.id,
          ...data,
        })),
      },
    });
    const svc = new ContentLicenseService(prisma);
    await svc.setLicense({ tenantId: 't1', variantId: 'v1', status: 'authorized', notice: '客户授权商用' });
    expect(prisma.contentVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ licenseStatus: 'authorized', copyrightNotice: '客户授权商用' }),
      }),
    );
  });

  it('checkMany：批量检查统计 blocked', async () => {
    const prisma = makePrisma({
      contentVariant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v-ok', licenseStatus: 'authorized', copyrightNotice: null },
          { id: 'v-bad', licenseStatus: 'unauthorized', copyrightNotice: null },
        ]),
      },
    });
    const svc = new ContentLicenseService(prisma);
    const r = await svc.checkMany({ tenantId: 't1', variantIds: ['v-ok', 'v-bad'] });
    expect(r.blockedCount).toBe(1);
    expect(r.results[1].variantId).toBe('v-bad');
  });
});
