import {
  Injectable,
  NotFoundException,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { QueryTopicDto } from './dto/query-topic.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { Prisma } from '@prisma/client';

const STALE_GENERATING_TIMEOUT_MS = 30 * 60 * 1000;

type TopicOwnerScope = { tenantId: string; userId: string };

@Injectable()
export class TopicsService {
  private readonly logger = new Logger(TopicsService.name);

  constructor(
    private prisma: PrismaService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  /** 选题归属 scope（逐页体验报告 10.5 P0：Topic 原无 owner/tenant scope） */
  private async resolveTopicOwnerScope(): Promise<TopicOwnerScope> {
    if (!this.authRequestContext?.hasContext()) {
      throw new UnauthorizedException('缺少登录上下文，不能管理选题。');
    }
    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后管理选题。');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  // 分页查询选题列表
  async findAll(query: QueryTopicDto) {
    const scope = await this.resolveTopicOwnerScope();
    await this.recoverStaleGeneratingTopics(scope);

    const {
      page = 1,
      limit = 20,
      keyword,
      status,
      isPublished,
      sortBy = 'date-desc',
    } = query;

    const where: Prisma.TopicWhereInput = { ...scope };

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
            select: { materialId: true },
          },
        },
      }),
      this.prisma.topic.count({ where }),
    ]);

    const formattedItems = await this.hydrateExistingMaterials(items);

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
    const scope = await this.resolveTopicOwnerScope();
    await this.recoverStaleGeneratingTopics(scope, id);

    const topic = await this.prisma.topic.findUnique({
      where: { id, ...scope },
      include: {
        materials: {
          select: { materialId: true },
        },
      },
    });
    if (!topic) throw new NotFoundException('选题不存在');
    const [formattedTopic] = await this.hydrateExistingMaterials([topic]);
    return formattedTopic;
  }

  // 创建选题
  async create(dto: CreateTopicDto) {
    const { materialIds, ...data } = dto;
    const scope = await this.resolveTopicOwnerScope();

    const created = await this.prisma.topic.create({
      data: {
        ...data,
        ...scope,
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
          select: { materialId: true },
        },
      },
    });

    const [formattedTopic] = await this.hydrateExistingMaterials([created]);
    return formattedTopic;
  }

  // 更新选题状态
  async updateStatus(id: string, status: string) {
    const scope = await this.resolveTopicOwnerScope();
    await this.findOne(id);
    return this.prisma.topic.update({
      where: { id, ...scope },
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
    const scope = await this.resolveTopicOwnerScope();
    return this.prisma.topic.update({
      where: { id, ...scope },
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
    const scope = await this.resolveTopicOwnerScope();
    await this.findOne(id);
    return this.prisma.topic.update({
      where: { id, ...scope },
      data: { isPublished },
    });
  }

  // 删除选题
  async remove(id: string) {
    const scope = await this.resolveTopicOwnerScope();
    await this.findOne(id);
    return this.prisma.topic.delete({ where: { id, ...scope } });
  }

  private async recoverStaleGeneratingTopics(
    scope: TopicOwnerScope,
    topicId?: string,
  ) {
    const staleBefore = new Date(Date.now() - STALE_GENERATING_TIMEOUT_MS);
    const staleTopics = await this.prisma.topic.findMany({
      where: {
        ...scope,
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
        const hasScore =
          typeof topic.aiScore === 'number' || Boolean(topic.scoreDetails);
        const nextStatus = hasScore || hasArticle ? 'completed' : 'pending';
        const nextPublished = topic.isPublished || hasArticle;

        await this.prisma.topic.update({
          where: { id: topic.id, ...scope },
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

  private async hydrateExistingMaterials<
    T extends { materials: { materialId: string }[] },
  >(topics: T[]) {
    const materialIds = [
      ...new Set(
        topics.flatMap((topic) => topic.materials.map((tm) => tm.materialId)),
      ),
    ];
    const materialRows = materialIds.length
      ? await this.prisma.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, title: true, platform: true },
        })
      : [];
    const materialById = new Map(
      materialRows.map((material) => [material.id, material]),
    );

    return topics.map(({ materials, ...topic }) => ({
      ...topic,
      materials: materials
        .map((tm) => materialById.get(tm.materialId))
        .filter((material): material is (typeof materialRows)[number] =>
          Boolean(material),
        ),
    }));
  }
}
