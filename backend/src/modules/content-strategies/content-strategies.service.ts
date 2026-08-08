import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ContentStrategy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ContentStrategyPayload {
  name: string;
  description?: string;
  industry?: string;
  targetAudience: string;
  commercialGoal: string;
  corePainPoints: string;
  writingAngles: string;
  toneAndStyle?: string;
  isDefault?: boolean;
  enabled?: boolean;
}

const DEFAULT_CONTENT_STRATEGY: ContentStrategyPayload = {
  name: 'AI 增长内容策略',
  description: '面向 AI 工具、数字化转型和一人业务增长的默认内容策略',
  industry: 'AI / 数字化增长',
  targetAudience:
    '想用 AI 提升效率、获客或打造一人业务的创业者、运营和小团队负责人',
  commercialGoal:
    '通过内容吸引目标用户，建立专业认知，并进一步转化为咨询、服务、课程或社群成交',
  corePainPoints:
    '不会选题、内容太空泛、缺少转化钩子、担心被时代淘汰、想用 AI 提升产出但没有可落地方法',
  writingAngles: '趋势解读、痛点拆解、认知反转、实操方法、案例拆解',
  toneAndStyle: '务实、通俗、带结论、强调对普通人的具体价值，避免过度炫技',
  isDefault: true,
  enabled: true,
};

@Injectable()
export class ContentStrategiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<ContentStrategy[]> {
    try {
      await this.ensureDefaultStrategy();
      return await this.prisma.contentStrategy.findMany({
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    } catch (error) {
      if (this.isPrismaTableMissingError(error, 'content_strategies')) {
        return [this.defaultStrategyRecord()];
      }
      throw error;
    }
  }

  async findOne(id: string): Promise<ContentStrategy> {
    let strategy: ContentStrategy | null = null;
    try {
      strategy = await this.prisma.contentStrategy.findUnique({
        where: { id },
      });
    } catch (error) {
      if (this.isPrismaTableMissingError(error, 'content_strategies')) {
        strategy =
          id === this.defaultStrategyRecord().id
            ? this.defaultStrategyRecord()
            : null;
      } else {
        throw error;
      }
    }
    if (!strategy) {
      throw new NotFoundException(`Content strategy with ID ${id} not found`);
    }
    return strategy;
  }

  async getDefaultStrategy(): Promise<ContentStrategy> {
    let strategy: ContentStrategy | null = null;
    try {
      await this.ensureDefaultStrategy();
      strategy = await this.prisma.contentStrategy.findFirst({
        where: { isDefault: true, enabled: true },
        orderBy: { updatedAt: 'desc' },
      });
    } catch (error) {
      if (this.isPrismaTableMissingError(error, 'content_strategies')) {
        strategy = this.defaultStrategyRecord();
      } else {
        throw error;
      }
    }

    if (!strategy) {
      throw new BadRequestException(
        '没有可用的默认内容策略，请先在“内容策略”中启用一个默认策略',
      );
    }

    return strategy;
  }

  async create(data: ContentStrategyPayload) {
    await this.ensureDefaultStrategy();

    if (data.isDefault) {
      await this.prisma.contentStrategy.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.contentStrategy.create({
        data: {
          ...data,
          industry: data.industry || '通用',
          enabled: data.enabled ?? true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('内容策略名称必须唯一');
      }
      throw error;
    }
  }

  async update(id: string, data: Partial<ContentStrategyPayload>) {
    const strategy = await this.findOne(id);

    if (data.isDefault) {
      await this.prisma.contentStrategy.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const nextEnabled = data.enabled ?? strategy.enabled;
    const nextIsDefault = data.isDefault ?? strategy.isDefault;
    if (!nextEnabled && nextIsDefault) {
      throw new BadRequestException('默认内容策略不能被禁用，请先切换默认策略');
    }

    try {
      return await this.prisma.contentStrategy.update({
        where: { id },
        data,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('内容策略名称必须唯一');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const strategy = await this.findOne(id);
    if (strategy.isDefault) {
      throw new BadRequestException('默认内容策略不能删除，请先切换默认策略');
    }

    return this.prisma.contentStrategy.delete({ where: { id } });
  }

  async setDefault(id: string) {
    const strategy = await this.findOne(id);
    if (!strategy.enabled) {
      throw new BadRequestException('请先启用该内容策略，再设为默认');
    }

    return this.prisma.$transaction([
      this.prisma.contentStrategy.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.contentStrategy.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }

  private async ensureDefaultStrategy() {
    let total = 0;
    try {
      total = await this.prisma.contentStrategy.count();
    } catch (error) {
      if (this.isPrismaTableMissingError(error, 'content_strategies')) {
        return;
      }
      throw error;
    }
    if (total > 0) {
      return;
    }

    await this.prisma.contentStrategy.create({
      data: DEFAULT_CONTENT_STRATEGY,
    });
  }

  private defaultStrategyRecord(): ContentStrategy {
    const now = new Date(0);
    return {
      id: 'default-content-strategy',
      ...DEFAULT_CONTENT_STRATEGY,
      description: DEFAULT_CONTENT_STRATEGY.description || null,
      toneAndStyle: DEFAULT_CONTENT_STRATEGY.toneAndStyle || null,
      industry: DEFAULT_CONTENT_STRATEGY.industry || '通用',
      isDefault: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  private isPrismaTableMissingError(error: unknown, tableName?: string) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      code === 'P2021' ||
      /does not exist in the current database/i.test(message) ||
      /no such table/i.test(message);
    return missing && (!tableName || message.includes(tableName));
  }
}
