import { AttributionLinkService } from './attribution-link.service';

function makeService(overrides: {
  upsert?: jest.Mock;
  findMany?: jest.Mock;
} = {}) {
  const prisma = {
    attributionLink: {
      upsert: overrides.upsert ?? jest.fn(),
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
    },
  };
  const service = new AttributionLinkService(prisma as never);
  return { service, prisma };
}

const owner = { userId: 'user-1', tenantId: 'tenant-1' };

describe('AttributionLinkService', () => {
  it('link 记录确定归因（默认 deterministic）', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'link-1' });
    const { service } = makeService({ upsert });

    await service.link(
      {
        fromType: 'content',
        fromId: 'article-1',
        toType: 'publish',
        toId: 'pub-1',
      },
      owner,
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fromType_fromId_toType_toId_model: {
            fromType: 'content',
            fromId: 'article-1',
            toType: 'publish',
            toId: 'pub-1',
            model: 'deterministic',
          },
        },
        create: expect.objectContaining({ model: 'deterministic', confidence: 'high' }),
      }),
    );
  });

  it('link 记录推断归因（低置信度）', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'link-2' });
    const { service } = makeService({ upsert });

    await service.link(
      {
        fromType: 'interaction',
        fromId: 'evt-1',
        toType: 'lead',
        toId: 'lead-1',
        model: 'inferred',
        confidence: 'low',
        label: 'influenced_by',
      },
      owner,
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ model: 'inferred', confidence: 'low' }),
      }),
    );
  });

  it('link 非法对象类型抛错', async () => {
    const { service } = makeService();
    await expect(
      service.link(
        { fromType: 'evil' as never, fromId: 'x', toType: 'lead', toId: 'y' },
        owner,
      ),
    ).rejects.toThrow(/不支持的对象类型/);
  });

  it('link 非法归因模型抛错', async () => {
    const { service } = makeService();
    await expect(
      service.link(
        { fromType: 'content', fromId: 'x', toType: 'lead', toId: 'y', model: 'magic' as never },
        owner,
      ),
    ).rejects.toThrow(/不支持的归因模型/);
  });

  it('resolveUpstream 查谁影响了我', async () => {
    const { service, prisma } = makeService();
    await service.resolveUpstream('lead', 'lead-1');
    expect(prisma.attributionLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { toType: 'lead', toId: 'lead-1' } }),
    );
  });

  it('resolveDownstream 查我影响了谁', async () => {
    const { service, prisma } = makeService();
    await service.resolveDownstream('content', 'article-1');
    expect(prisma.attributionLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fromType: 'content', fromId: 'article-1' } }),
    );
  });
});
