import { TopicsService } from './topics.service';

describe('TopicsService stale generating recovery', () => {
  const createPrismaMock = () => ({
    topic: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    material: {
      findMany: jest.fn(),
    },
  });

  it('should reset stale generating topic with score back to completed', async () => {
    const prisma = createPrismaMock();
    const service = new TopicsService(prisma as any);
    const now = new Date('2026-03-11T10:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    prisma.topic.findMany
      .mockResolvedValueOnce([
        {
          id: 'topic-1',
          title: 'stale-scored-topic',
          status: 'generating',
          isPublished: false,
          aiScore: 88,
          scoreDetails: { audienceFit: 18 },
          updatedAt: new Date(now.getTime() - 31 * 60 * 1000),
          articles: [],
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.topic.count.mockResolvedValue(0);

    await service.findAll({ page: 1, limit: 20 });

    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: 'topic-1' },
      data: {
        status: 'completed',
        isPublished: false,
      },
    });

    jest.useRealTimers();
  });

  it('should mark stale generating topic with article as published completed', async () => {
    const prisma = createPrismaMock();
    const service = new TopicsService(prisma as any);
    const now = new Date('2026-03-11T10:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    prisma.topic.findMany
      .mockResolvedValueOnce([
        {
          id: 'topic-2',
          title: 'stale-article-topic',
          status: 'generating',
          isPublished: false,
          aiScore: null,
          scoreDetails: null,
          updatedAt: new Date(now.getTime() - 45 * 60 * 1000),
          articles: [{ id: 'article-1' }],
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.topic.count.mockResolvedValue(0);

    await service.findAll({ page: 1, limit: 20 });

    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: 'topic-2' },
      data: {
        status: 'completed',
        isPublished: true,
      },
    });

    jest.useRealTimers();
  });

  it('should ignore missing material links when listing topics', async () => {
    const prisma = createPrismaMock();
    const service = new TopicsService(prisma as any);

    prisma.topic.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'topic-with-orphan',
        title: 'topic with missing material',
        materials: [
          { materialId: 'missing-material' },
          { materialId: 'material-1' },
        ],
      },
    ]);
    prisma.topic.count.mockResolvedValue(1);
    prisma.material.findMany.mockResolvedValue([
      { id: 'material-1', title: 'existing material', platform: 'rss' },
    ]);

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.items[0].materials).toEqual([
      { id: 'material-1', title: 'existing material', platform: 'rss' },
    ]);
  });
});
