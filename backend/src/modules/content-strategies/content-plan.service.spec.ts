import { ContentPlanService } from './content-plan.service';

function makeService(overrides: {
  create?: jest.Mock;
  findMany?: jest.Mock;
  findUnique?: jest.Mock;
  update?: jest.Mock;
  delete?: jest.Mock;
} = {}) {
  const prisma = {
    contentPlan: {
      create: overrides.create ?? jest.fn(),
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      findUnique: overrides.findUnique ?? jest.fn(),
      update: overrides.update ?? jest.fn(),
      delete: overrides.delete ?? jest.fn(),
    },
  };
  const service = new ContentPlanService(prisma as never);
  return { service, prisma };
}

const owner = { userId: 'user-1', tenantId: 'tenant-1' };

describe('ContentPlanService', () => {
  it('create 校验 goal 白名单并写入', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'plan-1' });
    const { service } = makeService({ create });

    const result = await service.create(
      {
        name: '会员权益科普',
        goal: '留资',
        audience: '企业主',
        successMetric: '留资数',
      },
      owner,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ goal: '留资', userId: 'user-1' }),
      }),
    );
    expect(result).toEqual({ id: 'plan-1' });
  });

  it('create 非法 goal 抛错', async () => {
    const { service } = makeService();
    await expect(
      service.create({ name: 'x', goal: '不存在的目标' }, owner),
    ).rejects.toThrow(/不支持的内容目标/);
  });

  it('list 按 userId + 可选 status 过滤', async () => {
    const { service, prisma } = makeService();
    await service.list(owner, 'active');
    expect(prisma.contentPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: 'active' },
      }),
    );
  });

  it('findOne 不存在抛 404', async () => {
    const { service } = makeService({
      findUnique: jest.fn().mockResolvedValue(null),
    });
    await expect(service.findOne('missing')).rejects.toThrow(/不存在/);
  });

  it('activate 设置 status=active', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'plan-1' });
    const update = jest.fn().mockResolvedValue({ id: 'plan-1', status: 'active' });
    const { service } = makeService({ findUnique, update });

    await service.activate('plan-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { status: 'active' },
    });
  });
});
