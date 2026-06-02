import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryTopicDto } from './dto/query-topic.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { Prisma } from '@prisma/client';

const STALE_GENERATING_TIMEOUT_MS = 30 * 60 * 1000;

@Injectable()
export class TopicsService {
  private readonly logger = new Logger(TopicsService.name);

  constructor(private prisma: PrismaService) {}

  // 分页查询选题列表
  async findAll(query: QueryTopicDto) {
    await this.recoverStaleGeneratingTopics();

    const { page = 1, limit = 20, keyword, status, isPublished, sortBy = 'date-desc' } = query;

    const where: Prisma.TopicWhereInput = {};

    if (keyword) {
      where.title = { contains: keyword };
    }
    if (status) {
      where.status = status;
    }
    if (isPublished !== undefined) {
      where.isPublished = isPublished;
    }

    // 解析排序
    let orderBy: Prisma.TopicOrderByWithRelationInput = {};
    switch (sortBy) {
      case 'date-asc':
        orderBy = { createdAt: 'asc' };
        break;
      case 'score-desc':
        orderBy = { aiScore: 'desc' };
        break;
      case 'score-asc':
        orderBy = { aiScore: 'asc' };
        break;
      default:
        orderBy = { createdAt: 'desc' };
    }

    const [items, total] = await Promise.all([
      this.prisma.topic.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          materials: {
            include: { material: { select: { id: true, title: true, platform: true } } },
          },
        },
      }),
      this.prisma.topic.count({ where }),
    ]);

    // 转换为前端需要的格式
    const formattedItems = items.map((item) => ({
      ...item,
      materials: item.materials.map((tm) => tm.material),
    }));

    return {
      items: formattedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 获取单个选题
  async findOne(id: string) {
    await this.recoverStaleGeneratingTopics(id);

    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: {
        materials: {
          include: { material: true },
        },
      },
    });
    if (!topic) throw new NotFoundException('选题不存在');
    return {
      ...topic,
      materials: topic.materials.map((tm) => tm.material),
    };
  }

  // 创建选题
  async create(dto: CreateTopicDto) {
    const { materialIds, ...data } = dto;

    return this.prisma.topic.create({
      data: {
        ...data,
        keywords: data.keywords || [],
        searchQueries: [],
        materials: materialIds?.length
          ? {
              create: materialIds.map((materialId) => ({
                material: { connect: { id: materialId } },
              })),
            }
          : undefined,
      },
      include: {
        materials: {
          include: { material: { select: { id: true, title: true, platform: true } } },
        },
      },
    });
  }

  // 更新选题状态
  async updateStatus(id: string, status: string) {
    await this.findOne(id);
    return this.prisma.topic.update({
      where: { id },
      data: { status },
    });
  }

  // 更新 AI 评分结果
  async updateScore(
    id: string,
    score: number,
    details: Record<string, number>,
    reason: string,
    keywords?: string[],
  ) {
    return this.prisma.topic.update({
      where: { id },
      data: {
        aiScore: score,
        scoreDetails: details,
        scoreReason: reason,
        status: 'completed',
        keywords: keywords || [],
      },
    });
  }

  // 发布/取消发布选题
  async publish(id: string, isPublished: boolean) {
    await this.findOne(id);
    return this.prisma.topic.update({
      where: { id },
      data: { isPublished },
    });
  }

  // 删除选题
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.topic.delete({ where: { id } });
  }

  private async recoverStaleGeneratingTopics(topicId?: string) {
    const staleBefore = new Date(Date.now() - STALE_GENERATING_TIMEOUT_MS);
    const staleTopics = await this.prisma.topic.findMany({
      where: {
        status: 'generating',
        updatedAt: { lt: staleBefore },
        ...(topicId ? { id: topicId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        isPublished: true,
        aiScore: true,
        scoreDetails: true,
        updatedAt: true,
        articles: {
          select: { id: true },
          take: 1,
        },
      },
    });

    if (staleTopics.length === 0) {
      return;
    }

    await Promise.all(
      staleTopics.map(async (topic) => {
        const hasArticle = topic.articles.length > 0;
        const hasScore = typeof topic.aiScore === 'number' || Boolean(topic.scoreDetails);
        const nextStatus = hasScore || hasArticle ? 'completed' : 'pending';
        const nextPublished = topic.isPublished || hasArticle;

        await this.prisma.topic.update({
          where: { id: topic.id },
          data: {
            status: nextStatus,
            isPublished: nextPublished,
          },
        });

        this.logger.warn(
          `检测到选题「${topic.title}」在 generating 状态停留超过 30 分钟，已自动回收为 ${nextStatus}${nextPublished ? ' / published' : ''}`,
        );
      }),
    );
  }
}
