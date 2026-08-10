import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 门店 POI 数据层（对标炼刀 /poi 5 端点）
 *
 * 本地生活门店点位管理：门店 CRUD + 按城市/分类检索 + 探店统计。
 * 下游消费：video-workshop 门店探店模板（门店名/地址/分类 → 探店成片）。
 */
@Injectable()
export class PoiService {
  private readonly logger = new Logger(PoiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  /** 解析当前请求的用户 + 租户（复用全局租户上下文，与 savings 一致） */
  async resolveScope(): Promise<{ tenantId: string; userId: string }> {
    const context = this.authRequestContext.get();
    const user = context?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后使用门店管理');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  async create(input: {
    tenantId: string;
    userId: string;
    name: string;
    address?: string;
    city?: string;
    category?: string;
    poiId?: string;
    lng?: number;
    lat?: number;
    tags?: string;
    note?: string;
  }) {
    if (!input.name?.trim()) {
      throw new NotFoundException('门店名称不能为空');
    }
    return this.prisma.poiStore.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        name: input.name.trim(),
        address: input.address ?? null,
        city: input.city ?? null,
        category: input.category ?? null,
        poiId: input.poiId ?? null,
        lng: input.lng ?? null,
        lat: input.lat ?? null,
        tags: input.tags ?? null,
        note: input.note ?? null,
      },
    });
  }

  async update(
    id: string,
    input: {
      tenantId: string;
      userId: string;
      name?: string;
      address?: string;
      city?: string;
      category?: string;
      poiId?: string;
      lng?: number;
      lat?: number;
      tags?: string;
      status?: string;
      note?: string;
    },
  ) {
    const existing = await this.prisma.poiStore.findFirst({
      where: { id, tenantId: input.tenantId, userId: input.userId },
    });
    if (!existing) {
      throw new NotFoundException('门店不存在');
    }
    return this.prisma.poiStore.update({
      where: { id },
      data: {
        name: input.name?.trim() || existing.name,
        address: input.address ?? existing.address,
        city: input.city ?? existing.city,
        category: input.category ?? existing.category,
        poiId: input.poiId ?? existing.poiId,
        lng: input.lng ?? existing.lng,
        lat: input.lat ?? existing.lat,
        tags: input.tags ?? existing.tags,
        status: input.status ?? existing.status,
        note: input.note ?? existing.note,
        updatedAt: new Date(),
      },
    });
  }

  async list(input: {
    tenantId: string;
    userId: string;
    city?: string;
    category?: string;
    status?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(Math.floor(input.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Math.floor(input.pageSize ?? 20), 1), 100);
    const where: Record<string, unknown> = {
      tenantId: input.tenantId,
      userId: input.userId,
    };
    if (input.city) where.city = input.city;
    if (input.category) where.category = input.category;
    if (input.status) where.status = input.status;
    if (input.keyword?.trim()) {
      where.OR = [
        { name: { contains: input.keyword.trim() } },
        { address: { contains: input.keyword.trim() } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.poiStore.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.poiStore.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async remove(id: string, scope: { tenantId: string; userId: string }) {
    const existing = await this.prisma.poiStore.findFirst({
      where: { id, tenantId: scope.tenantId, userId: scope.userId },
    });
    if (!existing) {
      throw new NotFoundException('门店不存在');
    }
    await this.prisma.poiStore.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** 门店数据报告：按城市/分类聚合 + 探店统计（对标炼刀 /poi/report） */
  async report(scope: { tenantId: string; userId: string }) {
    const [rows, cityRows, categoryRows] = await Promise.all([
      this.prisma.poiStore.findMany({
        where: { tenantId: scope.tenantId, userId: scope.userId },
      }),
      this.prisma.poiStore.groupBy({
        by: ['city'],
        where: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          city: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.poiStore.groupBy({
        by: ['category'],
        where: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          category: { not: null },
        },
        _count: { _all: true },
      }),
    ]);
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      totalVisits: rows.reduce((sum, r) => sum + r.visitCount, 0),
      byCity: cityRows.map((r) => ({ city: r.city, count: r._count._all })),
      byCategory: categoryRows.map((r) => ({
        category: r.category,
        count: r._count._all,
      })),
    };
  }
}
