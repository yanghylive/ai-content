import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentAssetVersioningService } from '../content-strategies/content-asset-versioning.service';

@Injectable()
export class StylesService {
  constructor(
    private prisma: PrismaService,
    @Optional()
    private readonly versioning?: ContentAssetVersioningService,
  ) {}

  /** 风格的内容字段快照（版本化用，排除 id/时间戳等元数据） */
  private styleSnapshot(style: {
    name: string;
    description?: string | null;
    promptTemplate: string;
    isDefault: boolean;
    type: string;
    parameters?: unknown;
  }) {
    return {
      name: style.name,
      description: style.description ?? null,
      promptTemplate: style.promptTemplate,
      isDefault: style.isDefault,
      type: style.type,
      parameters: style.parameters ?? null,
    };
  }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma Json 字段兼容性（Record<string, any> 是 Prisma Json 的惯用类型）
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
      const created = await this.prisma.style.create({
        data: {
          ...data,
          type: styleType,
        },
      });
      void this.versioning?.recordVersion({
        assetType: 'style',
        assetId: created.id,
        snapshot: this.styleSnapshot(created),
        changeSummary: '创建风格',
      });
      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma Json 字段兼容性（Record<string, any> 是 Prisma Json 的惯用类型）
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
      const updated = await this.prisma.style.update({
        where: { id },
        data,
      });
      void this.versioning?.recordVersion({
        assetType: 'style',
        assetId: updated.id,
        snapshot: this.styleSnapshot(updated),
        changeSummary: '更新风格',
      });
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
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

    const result = await this.prisma.$transaction([
      this.prisma.style.updateMany({
        where: { isDefault: true, type: style.type },
        data: { isDefault: false },
      }),
      this.prisma.style.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
    const updated = await this.prisma.style.findUnique({ where: { id } });
    if (updated) {
      void this.versioning?.recordVersion({
        assetType: 'style',
        assetId: updated.id,
        snapshot: this.styleSnapshot(updated),
        changeSummary: '设为默认风格',
      });
    }
    return result;
  }

  /* ===== 版本化（报告 16.3 第 8 项） ===== */

  /** 风格版本历史（倒序） */
  async listVersions(id: string) {
    await this.findOne(id);
    return this.versioning?.listVersions('style', id) ?? [];
  }

  /** 回滚到指定版本：恢复快照内容并生成新版本（留痕） */
  async rollback(id: string, versionNo: number) {
    await this.findOne(id);
    const snapshot = await this.versioning?.getSnapshot('style', id, versionNo);
    if (!snapshot) {
      throw new NotFoundException(`版本 ${versionNo} 不存在`);
    }

    if (snapshot.isDefault) {
      await this.prisma.style.updateMany({
        where: {
          isDefault: true,
          type: (snapshot.type as string) || 'article',
        },
        data: { isDefault: false },
      });
    }

    const restored = await this.prisma.style.update({
      where: { id },
      data: {
        name: snapshot.name as string,
        description: snapshot.description as string | null,
        promptTemplate: snapshot.promptTemplate as string,
        isDefault: snapshot.isDefault as boolean | undefined,
        type: snapshot.type as string | undefined,
        parameters: snapshot.parameters ?? undefined,
      },
    });
    void this.versioning?.recordVersion({
      assetType: 'style',
      assetId: id,
      snapshot: this.styleSnapshot(restored),
      changeSummary: `回滚到 v${versionNo}`,
    });
    return restored;
  }
}
