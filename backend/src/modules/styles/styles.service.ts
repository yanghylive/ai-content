import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StylesService {
  constructor(private prisma: PrismaService) {}

  async findAll(type?: string) {
    const where = type ? { type } : {};
    return this.prisma.style.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const style = await this.prisma.style.findUnique({ where: { id } });
    if (!style) {
      throw new NotFoundException(`Style with ID ${id} not found`);
    }
    return style;
  }

  async create(data: {
    name: string;
    description?: string;
    promptTemplate: string;
    isDefault?: boolean;
    type?: string;
    parameters?: Record<string, any>;
  }) {
    const styleType = data.type || 'article';

    if (data.isDefault) {
      await this.prisma.style.updateMany({
        where: { isDefault: true, type: styleType },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.style.create({
        data: {
          ...data,
          type: styleType,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          'Style action failed: name must be unique',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      promptTemplate?: string;
      isDefault?: boolean;
      type?: string;
      parameters?: Record<string, any>;
    },
  ) {
    const style = await this.prisma.style.findUnique({ where: { id } });
    if (!style) {
      throw new NotFoundException(`Style with ID ${id} not found`);
    }

    const styleType = data.type || style.type || 'article';

    if (data.isDefault) {
      await this.prisma.style.updateMany({
        where: { isDefault: true, type: styleType },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.style.update({
        where: { id },
        data,
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          'Style action failed: name must be unique',
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    const style = await this.prisma.style.findUnique({ where: { id } });
    if (!style) {
      throw new NotFoundException(`Style with ID ${id} not found`);
    }

    return this.prisma.style.delete({ where: { id } });
  }

  async setDefault(id: string) {
    const style = await this.prisma.style.findUnique({ where: { id } });
    if (!style) {
      throw new NotFoundException(`Style with ID ${id} not found`);
    }

    return this.prisma.$transaction([
      this.prisma.style.updateMany({
        where: { isDefault: true, type: style.type },
        data: { isDefault: false },
      }),
      this.prisma.style.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }
}
