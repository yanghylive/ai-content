import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryRedfoxSkillsDto } from './dto/query-redfox-skills.dto';
import { UpdateRedfoxSkillDto } from './dto/update-redfox-skill.dto';
import { RedfoxListResult, RedfoxScope, RedfoxSkill } from './redfox.types';

type RedfoxSkillRecord = Prisma.RedfoxSkillGetPayload<{
  include: { installs: true };
}>;

@Injectable()
export class RedfoxSkillCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    scope: RedfoxScope,
    query: QueryRedfoxSkillsDto = {},
  ): Promise<RedfoxListResult<RedfoxSkill>> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    const keyword = query.keyword?.trim().toLowerCase();
    const platform = query.platform?.trim().toLowerCase();
    const tag = query.tag?.trim().toLowerCase();
    const scenario = query.scenario?.trim().toLowerCase();

    const records = await this.prisma.redfoxSkill.findMany({
      include: { installs: { where: this.installScopeWhere(scope) } },
      orderBy: this.sortOrder(query),
      take: 1000,
    });

    const filtered = records
      .map((record) => this.toSkill(record))
      .filter((skill) => {
        if (
          typeof query.enabled === 'boolean' &&
          skill.enabled !== query.enabled
        ) {
          return false;
        }
        if (platform && skill.platform.toLowerCase() !== platform) return false;
        if (tag && !skill.tags.some((item) => item.toLowerCase() === tag)) {
          return false;
        }
        if (scenario && (skill.scenario || '').toLowerCase() !== scenario) {
          return false;
        }
        if (!keyword) return true;
        return [
          skill.name,
          skill.code,
          skill.skillNo,
          skill.summary,
          skill.platform,
          skill.category,
          ...skill.tags,
        ].some((value) => value.toLowerCase().includes(keyword));
      });

    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
    };
  }

  async syncFromRemote(payload: unknown) {
    const remoteItems = this.extractRemoteItems(payload);
    const syncedAt = new Date();
    let created = 0;
    let updated = 0;

    for (const item of remoteItems) {
      const normalized = this.normalizeRemoteSkill(
        item,
        syncedAt.toISOString(),
      );
      const current = await this.prisma.redfoxSkill.findUnique({
        where: { code: normalized.code },
      });
      const tags = current
        ? this.mergeTags(
            normalized.tags,
            this.readJsonStringArray(current.tags),
          )
        : normalized.tags;
      if (current) {
        updated += 1;
        await this.prisma.redfoxSkill.update({
          where: { id: current.id },
          data: {
            skillNo: normalized.skillNo,
            name: normalized.name,
            platform: normalized.platform,
            category: normalized.category,
            tags,
            summary: normalized.summary,
            description: normalized.summary,
            status: normalized.status,
            raw: normalized.raw as Prisma.InputJsonValue,
            syncedAt,
          },
        });
      } else {
        created += 1;
        await this.prisma.redfoxSkill.create({
          data: {
            skillNo: normalized.skillNo,
            code: normalized.code,
            name: normalized.name,
            platform: normalized.platform,
            category: normalized.category,
            tags,
            summary: normalized.summary,
            description: normalized.summary,
            status: normalized.status,
            raw: normalized.raw as Prisma.InputJsonValue,
            syncedAt,
          },
        });
      }
    }

    const total = await this.prisma.redfoxSkill.count();
    return {
      syncedAt: syncedAt.toISOString(),
      received: remoteItems.length,
      created,
      updated,
      total,
    };
  }

  async updateSkill(
    scope: RedfoxScope,
    id: string,
    dto: UpdateRedfoxSkillDto,
  ): Promise<RedfoxSkill> {
    const skill = await this.findSkillByIdOrCode(id);
    if (!skill) {
      throw new NotFoundException('RedFox Skill 不存在或尚未同步');
    }

    const scenario = this.normalizeNullable(dto.scenario) || 'general';
    if (dto.tags) {
      await this.prisma.redfoxSkill.update({
        where: { id: skill.id },
        data: { tags: this.normalizeTags(dto.tags) },
      });
    }

    const currentInstall = await this.prisma.redfoxSkillInstall.findFirst({
      where: {
        skillId: skill.id,
        OR: [
          ...(scope.tenantId ? [{ tenantId: scope.tenantId }] : []),
          { userId: scope.userId },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (currentInstall) {
      await this.prisma.redfoxSkillInstall.update({
        where: { id: currentInstall.id },
        data: {
          tenantId: scope.tenantId || null,
          userId: scope.userId,
          enabled:
            typeof dto.enabled === 'boolean'
              ? dto.enabled
              : currentInstall.enabled,
          scenario,
        },
      });
    } else {
      await this.prisma.redfoxSkillInstall.create({
        data: {
          tenantId: scope.tenantId || null,
          userId: scope.userId,
          skillId: skill.id,
          enabled: dto.enabled ?? true,
          scenario,
        },
      });
    }

    const updated = await this.prisma.redfoxSkill.findUniqueOrThrow({
      where: { id: skill.id },
      include: { installs: { where: this.installScopeWhere(scope) } },
    });
    return this.toSkill(updated);
  }

  private async findSkillByIdOrCode(id: string) {
    return this.prisma.redfoxSkill.findFirst({
      where: { OR: [{ id }, { code: id }, { skillNo: id }] },
    });
  }

  private installScopeWhere(
    scope: RedfoxScope,
  ): Prisma.RedfoxSkillInstallWhereInput {
    return {
      OR: [
        ...(scope.tenantId ? [{ tenantId: scope.tenantId }] : []),
        { userId: scope.userId },
      ],
    };
  }

  private sortOrder(query: QueryRedfoxSkillsDto) {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    if (query.sortBy === 'name') return { name: direction } as const;
    if (query.sortBy === 'platform') return { platform: direction } as const;
    return { syncedAt: direction } as const;
  }

  private toSkill(record: RedfoxSkillRecord): RedfoxSkill {
    const install =
      record.installs.find((item) => item.enabled) || record.installs[0];
    return {
      id: record.code,
      skillNo: record.skillNo || record.code,
      code: record.code,
      name: record.name,
      platform: record.platform || 'unknown',
      category: record.category || 'uncategorized',
      tags: this.readJsonStringArray(record.tags),
      summary: record.summary || record.description || '',
      status: this.normalizeStatus(record.status),
      enabled: install?.enabled ?? false,
      scenario: install?.scenario || null,
      raw: this.readJsonRecord(record.raw),
      syncedAt:
        record.syncedAt?.toISOString() || record.updatedAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private extractRemoteItems(payload: unknown): Record<string, unknown>[] {
    const candidates = [
      payload,
      this.pick(payload, 'data'),
      this.pick(this.pick(payload, 'data'), 'data'),
      this.pick(payload, 'result'),
      this.pick(payload, 'payload'),
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter(this.isRecord);
      }
      if (this.isRecord(candidate)) {
        for (const key of ['list', 'items', 'records', 'rows', 'skills']) {
          const value = candidate[key];
          if (Array.isArray(value)) return value.filter(this.isRecord);
        }
      }
    }
    return [];
  }

  private normalizeRemoteSkill(
    item: Record<string, unknown>,
    syncedAt: string,
  ): RedfoxSkill {
    const skillNo =
      this.firstString(item, ['skillNo', 'skill_no', 'no', 'id', 'skillId']) ||
      this.stableSlug(
        this.firstString(item, ['name', 'title', 'skillName']) || 'skill',
      );
    const name =
      this.firstString(item, ['skillName', 'name', 'title', 'displayName']) ||
      `RedFox Skill ${skillNo}`;
    const code =
      this.firstString(item, [
        'skillCode',
        'code',
        'key',
        'slug',
        'identifier',
      ]) || this.stableSlug(`${name}-${skillNo}`);
    const platform =
      this.firstString(item, ['platform', 'platformName', 'sourcePlatform']) ||
      this.inferPlatform(name, item);
    const category =
      this.firstString(item, ['category', 'group', 'type', 'scene']) ||
      'uncategorized';
    const tags = this.mergeTags(
      this.readTags(item),
      [platform, category].filter((value) => value !== 'unknown'),
    );

    return {
      id: code,
      skillNo,
      code,
      name,
      platform,
      category,
      tags,
      summary:
        this.firstString(item, ['summary', 'description', 'desc', 'intro']) ||
        '',
      status: this.inferStatus(item),
      enabled: false,
      scenario: null,
      raw: item,
      syncedAt,
      updatedAt: syncedAt,
    };
  }

  private inferPlatform(name: string, item: Record<string, unknown>) {
    const text = `${name} ${JSON.stringify(item)}`.toLowerCase();
    if (/小红书|xhs|xiaohongshu/.test(text)) return 'xiaohongshu';
    if (/抖音|douyin/.test(text)) return 'douyin';
    if (/公众号|wechat|微信/.test(text)) return 'wechat';
    if (/b站|bilibili/.test(text)) return 'bilibili';
    if (/tiktok/.test(text)) return 'tiktok';
    return 'unknown';
  }

  private inferStatus(item: Record<string, unknown>): RedfoxSkill['status'] {
    const value = String(
      item.status || item.state || item.available || item.enabled || '',
    ).toLowerCase();
    if (['false', 'disabled', 'offline', 'coming_soon'].includes(value)) {
      return 'disabled';
    }
    if (['true', 'enabled', 'online', 'available', '1'].includes(value)) {
      return 'available';
    }
    return 'unknown';
  }

  private normalizeStatus(value: string): RedfoxSkill['status'] {
    return value === 'available' || value === 'disabled' ? value : 'unknown';
  }

  private firstString(item: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    }
    return '';
  }

  private readTags(item: Record<string, unknown>) {
    const value = item.tags || item.labels || item.keywords;
    if (Array.isArray(value)) return value.map((tag) => String(tag));
    if (typeof value === 'string') {
      return value
        .split(/[,，\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    return [];
  }

  private mergeTags(...groups: string[][]) {
    return this.normalizeTags(groups.flat());
  }

  private normalizeTags(tags: string[]) {
    return Array.from(
      new Set(
        tags
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tag) => tag.slice(0, 40)),
      ),
    );
  }

  private normalizeNullable(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed || null;
  }

  private stableSlug(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private pick(value: unknown, key: string) {
    return this.isRecord(value) ? value[key] : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private readJsonStringArray(value: Prisma.JsonValue) {
    return Array.isArray(value)
      ? value.map((item) => String(item)).filter(Boolean)
      : [];
  }

  private readJsonRecord(value: Prisma.JsonValue | null) {
    return this.isRecord(value) ? (value as Record<string, unknown>) : {};
  }
}
