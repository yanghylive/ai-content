import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateDefaultsDto } from './dto/update-defaults.dto';

@Injectable()
export class DefaultModelsService {
  constructor(private prisma: PrismaService) {}

  async getDefaults() {
    const configs = await this.prisma.defaultModelConfig.findMany();
    const result: Record<string, string> = {};
    configs.forEach((c) => {
      result[c.purpose] = c.modelId;
    });
    return {
      articleCreation: result['article_creation'] || '',
      imageCreation: result['image_creation'] || '',
      xCollection: result['x_collection'] || '',
      topicSelection: result['topic_selection'] || '',
    };
  }

  async updateDefaults(dto: UpdateDefaultsDto) {
    const mapping: Record<string, string | undefined> = {
      article_creation: dto.articleCreation,
      image_creation: dto.imageCreation,
      x_collection: dto.xCollection,
      topic_selection: dto.topicSelection,
    };

    for (const [purpose, modelId] of Object.entries(mapping)) {
      if (modelId !== undefined) {
        await this.prisma.defaultModelConfig.upsert({
          where: { purpose },
          update: { modelId },
          create: { purpose, modelId },
        });
      }
    }

    return this.getDefaults();
  }
}
