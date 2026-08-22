import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';

@Injectable()
export class AiPlatformsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.aIPlatform.findMany({
      include: { models: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const platform = await this.prisma.aIPlatform.findUnique({
      where: { id },
      include: { models: true },
    });
    if (!platform) throw new NotFoundException('AI 平台不存在');
    return platform;
  }

  async create(dto: CreatePlatformDto) {
    // 2026-08-22 大王指示：只允许 Kaypal 模型台，自定义第三方平台关闭
    const baseUrl = `${dto.baseUrl ?? ''}`;
    const name = `${dto.name ?? ''}`;
    if (
      !baseUrl.includes('kaypal.cn') &&
      !baseUrl.includes('kaypal.com') &&
      !name.includes('Kaypal')
    ) {
      throw new BadRequestException(
        '仅支持 Kaypal 模型台（统一计费），用户自定义第三方 AI 平台已关闭',
      );
    }
    try {
      return await this.prisma.aIPlatform.create({ data: dto });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('平台名称已存在');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdatePlatformDto) {
    await this.findOne(id);
    return this.prisma.aIPlatform.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.aIPlatform.delete({ where: { id } });
  }
}
