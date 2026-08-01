import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { RedfoxScope } from '../redfox/redfox.types';
import { GenerateIntelligenceTopicDto } from './dto/generate-intelligence-topic.dto';
import { ImportIntelligenceMaterialDto } from './dto/import-intelligence-material.dto';

@Injectable()
export class IntelligenceImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importItemToMaterial(
    scope: RedfoxScope,
    itemId: string,
    dto: ImportIntelligenceMaterialDto,
  ) {
    const item = await this.findItem(scope, itemId);

    const material = await this.prisma.material.create({
      data: {
        title: dto.title || item.title,
        content: dto.content ?? item.content ?? item.summary,
        summary: dto.summary ?? item.summary,
        sourceUrl:
          dto.sourceUrl ||
          item.sourceUrl ||
          `redfox://intelligence-items/${item.id}`,
        platform: dto.platform || item.platform || 'RedFox',
        author: dto.author ?? item.author ?? '',
        publishDate: dto.publishDate
          ? new Date(dto.publishDate)
          : item.publishDate,
        keywords: dto.keywords ?? this.asStringArray(item.keywords),
        metadata: this.metadata({
          source: 'redfox-intelligence',
          intelligenceItemId: item.id,
          tenantId: item.tenantId,
          userId: item.userId,
          redfoxSkillId: item.redfoxSkillId,
          redfoxCallLogId: item.redfoxCallLogId,
          metrics: item.metrics,
          raw: item.raw,
        }),
      },
    });

    await this.prisma.intelligenceItem.update({
      where: { id: item.id },
      data: {
        materialId: material.id,
        status: 'imported_material',
      },
    });

    return {
      intelligenceItemId: item.id,
      material,
    };
  }

  async generateTopicFromItem(
    scope: RedfoxScope,
    itemId: string,
    dto: GenerateIntelligenceTopicDto,
  ) {
    const item = await this.findItem(scope, itemId);
    const materialIds = this.uniqueStrings([
      ...(dto.materialIds || []),
      ...(item.materialId ? [item.materialId] : []),
    ]);

    const topic = await this.prisma.topic.create({
      data: {
        title: dto.title || item.title,
        description: dto.description ?? item.summary ?? item.content,
        summary: dto.summary ?? item.summary,
        sourceType: dto.sourceType || 'RedFox 情报',
        keywords: dto.keywords ?? this.asStringArray(item.keywords),
        searchQueries: dto.searchQueries ?? this.asStringArray(item.keywords),
        materials: materialIds.length
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

    await this.prisma.intelligenceItem.update({
      where: { id: item.id },
      data: {
        topicId: topic.id,
        status: 'generated_topic',
      },
    });

    return {
      intelligenceItemId: item.id,
      topic,
    };
  }

  private async findItem(scope: RedfoxScope, itemId: string) {
    const item = await this.prisma.intelligenceItem.findFirst({
      where: {
        id: itemId,
        AND: [this.scopeWhere(scope)],
      },
    });

    if (!item) {
      throw new NotFoundException('情报条目不存在');
    }

    return item;
  }

  private scopeWhere(scope: RedfoxScope): Prisma.IntelligenceItemWhereInput {
    if (scope.tenantId) {
      return {
        OR: [
          { tenantId: scope.tenantId },
          { userId: scope.userId, tenantId: null },
        ],
      };
    }
    return { userId: scope.userId };
  }

  private asStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
      .map((item) => item.trim());
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.filter((value) => value.trim().length > 0))];
  }

  private metadata(values: Record<string, unknown>): Prisma.InputJsonObject {
    const metadata = Object.entries(values).reduce<
      Record<string, Prisma.InputJsonValue>
    >((result, [key, value]) => {
      if (value !== undefined && value !== null) {
        result[key] = value as Prisma.InputJsonValue;
      }
      return result;
    }, {});

    return metadata as Prisma.InputJsonObject;
  }
}
