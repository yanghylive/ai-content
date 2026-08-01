import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryRedfoxInterfacesDto } from './dto/query-redfox-interfaces.dto';
import { RedfoxInterface, RedfoxListResult } from './redfox.types';

type RedfoxInterfaceRecord = Prisma.RedfoxInterfaceGetPayload<object>;

export type RedfoxPlatform = {
  platformCode: string;
  platformName: string | null;
  status: string;
  raw: Record<string, unknown>;
};

const FALLBACK_REDFOX_PLATFORMS: Array<{
  platformCode: string;
  platformName: string;
}> = [
  { platformCode: 'douyin', platformName: '抖音' },
  { platformCode: 'xiaohongshu', platformName: '小红书' },
  { platformCode: 'gongzhonghao', platformName: '公众号' },
  { platformCode: 'bilibili', platformName: '哔哩哔哩' },
  { platformCode: 'tool-ai-search', platformName: 'AI搜索' },
  { platformCode: 'tool', platformName: '工具' },
  { platformCode: 'tool-doubao-image', platformName: '豆包图片生成' },
  { platformCode: 'tool-doubao-video', platformName: '豆包视频生成' },
  { platformCode: 'tool-gpt-image', platformName: 'GPT图片生成' },
  { platformCode: 'tool-tiktok', platformName: 'TikTok' },
];

@Injectable()
export class RedfoxInterfaceCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: QueryRedfoxInterfacesDto = {},
  ): Promise<RedfoxListResult<RedfoxInterface>> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    const keyword = query.keyword?.trim().toLowerCase();

    const where: Prisma.RedfoxInterfaceWhereInput = {};
    if (query.platform?.trim()) {
      where.platformCode = query.platform.trim();
    }
    if (query.scenario?.trim()) {
      where.scenario = query.scenario.trim();
    }
    if (query.status?.trim()) {
      where.status = query.status.trim();
    }
    if (query.path?.trim()) {
      where.path = { contains: query.path.trim() };
    }
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { path: { contains: keyword } },
        { interfaceNo: { contains: keyword } },
        { platformCode: { contains: keyword } },
        { platformName: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.redfoxInterface.findMany({
        where,
        orderBy: this.sortOrder(query),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.redfoxInterface.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toInterface(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async syncFromRemote(
    platformPayload: unknown,
    interfacePayloads: Array<{ platform: RedfoxPlatform; payload: unknown }>,
  ) {
    const syncedAt = new Date();
    const platforms = this.extractPlatforms(platformPayload);
    let received = 0;
    let created = 0;
    let updated = 0;

    for (const { platform, payload } of interfacePayloads) {
      const remoteItems = this.extractRemoteItems(payload);
      received += remoteItems.length;
      for (const item of remoteItems) {
        const normalized = this.normalizeRemoteInterface(
          platform,
          item,
          syncedAt,
        );
        const current = await this.prisma.redfoxInterface.findUnique({
          where: { code: normalized.code },
        });
        if (current) {
          updated += 1;
          await this.prisma.redfoxInterface.update({
            where: { id: current.id },
            data: normalized,
          });
        } else {
          created += 1;
          await this.prisma.redfoxInterface.create({ data: normalized });
        }
      }
    }

    const total = await this.prisma.redfoxInterface.count();
    const syncedPlatformCount =
      platforms.filter((item) => item.status === 'online').length ||
      new Set(interfacePayloads.map((item) => item.platform.platformCode)).size;

    return {
      syncedAt: syncedAt.toISOString(),
      platforms: syncedPlatformCount,
      received,
      created,
      updated,
      total,
    };
  }

  extractPlatforms(payload: unknown): RedfoxPlatform[] {
    return this.extractRemoteItems(payload)
      .flatMap((item) => [item, ...this.extractChildPlatforms(item)])
      .map((item) => ({
        platformCode:
          this.firstString(item, ['platformCode', 'code', 'key']) || 'unknown',
        platformName:
          this.firstString(item, ['platformName', 'name', 'title']) || null,
        status: this.firstString(item, ['status', 'state']) || 'unknown',
        raw: item,
      }))
      .filter((item) => item.platformCode !== 'unknown');
  }

  fallbackPlatforms(): RedfoxPlatform[] {
    return FALLBACK_REDFOX_PLATFORMS.map((item) => ({
      ...item,
      status: 'online',
      raw: item,
    }));
  }

  officialMonitorPaths() {
    return [
      '/story/api/dyData/searchUser',
      '/story/api/dyData/searchArticle',
      '/story/api/dyData/queryUser',
      '/story/api/dyData/queryWork',
      '/story/api/dyData/queryWorkList',
      '/story/api/parseWork/queryDyAiMsgs',
      '/story/api/xhsUser/searchUser',
      '/story/api/xhsUser/searchArticle',
      '/story/api/xhsUser/queryAccountDetail',
      '/story/api/xhsUser/queryWorkDetail',
      '/story/api/parseWork/queryXhsAiMsgs',
      '/story/api/gzhData/searchUser',
      '/story/api/gzhData/searchArticle',
      '/story/api/gzhData/queryUser',
      '/story/api/gzhData/queryWork',
      '/story/api/gzhData/queryWorkList',
      '/story/api/gzhData/queryArticleDetail',
      '/story/api/parseWork/queryAiMsgs',
      '/story/api/bili/data/accountSearch',
      '/story/api/bili/data/workSearch',
      '/story/api/bili/data/accountDetail',
      '/story/api/bili/data/workDetail',
      '/story/api/bili/data/accountWorkList',
      '/story/api/toutiao/searchWork',
      '/story/api/toutiao/workDetail',
      '/story/api/deepSearch/tk/searchUser',
      '/story/api/deepSearch/dbSubmit',
      '/story/api/deepSearch/dbResult',
      '/story/api/deepSearch/dsSubmit',
      '/story/api/deepSearch/dsResult',
      '/story/api/parseWork/parse',
      '/story/api/parseWork/imageGen/uploadImage',
      '/story/api/parseWork/imageGen/submitSkill',
      '/story/api/parseWork/imageGen/result',
      '/story/api/parseWork/imageGen/arkSubmit',
      '/story/api/parseWork/imageGen/arkResult',
      '/story/api/parseWork/videoGen/uploadFile',
      '/story/api/parseWork/videoGen/submit',
      '/story/api/parseWork/videoGen/result',
    ];
  }

  isBlockedMonitorPath(path: string) {
    const normalized = this.normalizePath(path);
    return (
      normalized === '/story/web/api/home/hot' ||
      normalized.startsWith('/story/web/api/doc/') ||
      normalized === '/story/web/api/doc/platforms' ||
      normalized === '/story/web/api/skills/list'
    );
  }

  private normalizeRemoteInterface(
    platform: RedfoxPlatform,
    item: Record<string, unknown>,
    syncedAt: Date,
  ): Prisma.RedfoxInterfaceUncheckedCreateInput {
    const path = this.normalizePath(
      this.firstString(item, ['path', 'endpoint', 'apiPath']) || '',
    );
    const method = (
      this.firstString(item, ['httpMethod', 'method']) || 'POST'
    ).toUpperCase();
    const interfaceNo =
      this.firstString(item, ['interfaceNo', 'interface_no', 'no']) || null;
    const name =
      this.firstString(item, ['interfaceName', 'name', 'title']) ||
      `${platform.platformName || platform.platformCode} ${path}`;
    const code =
      interfaceNo ||
      `${platform.platformCode}:${method}:${path}`.replace(
        /[^a-z0-9/_:-]+/gi,
        '-',
      );

    return {
      platformCode:
        this.firstString(item, ['platformCode']) || platform.platformCode,
      platformName:
        this.firstString(item, ['platformName']) || platform.platformName,
      interfaceNo,
      code,
      name: name.trim(),
      path,
      method,
      scenario: this.inferScenario(path, name),
      status: this.normalizeStatus(item),
      category: this.firstString(item, ['categoryName', 'category']) || null,
      description:
        this.firstString(item, ['description', 'desc', 'summary']) || null,
      price: this.firstNumber(item, ['price']),
      minPrice: this.firstNumber(item, ['minPrice', 'min_price']),
      requireAuth:
        typeof item.requireAuth === 'boolean' ? item.requireAuth : true,
      parameters: this.jsonOrNull(item.parameters),
      examples: this.jsonOrNull(item.examples),
      raw: item as Prisma.InputJsonObject,
      syncedAt,
    };
  }

  private inferScenario(path: string, name: string) {
    const text = `${path} ${name}`.toLowerCase();
    if (
      /imagegen\/uploadimage|videogen\/uploadfile|上传.*(图片|视频|音频)/.test(
        text,
      )
    ) {
      return 'media_upload';
    }
    if (/parsework\/parse|短视频下载|作品爬取/.test(text)) {
      return 'media_parse';
    }
    if (
      /imagegen\/(submitskill|arksubmit)|图片生成|image2-gpt|seedream/.test(
        text,
      )
    ) {
      return 'image_generation_submit';
    }
    if (/imagegen\/(result|arkresult)|图片.*查询任务/.test(text)) {
      return 'image_generation_result';
    }
    if (/videogen\/submit|视频生成/.test(text)) {
      return 'video_generation_submit';
    }
    if (/videogen\/result|视频.*查询任务/.test(text)) {
      return 'video_generation_result';
    }
    if (/deepsearch\/tk\/searchuser/.test(text)) return 'search_user';
    if (/deepsearch|dbsubmit|dssubmit/.test(text)) return 'ai_search_submit';
    if (/dbresult|dsresult/.test(text)) return 'ai_search_result';
    if (/aimsgs|ai\s*作品|ai\s*创作|ai内容/.test(text)) {
      return 'ai_content_search';
    }
    if (/queryworklist|accountworklist|作品列表/.test(text)) {
      return 'work_list';
    }
    if (/querywork|workdetail|articledetail|作品.*详情|文章.*详情/.test(text)) {
      return 'work_detail';
    }
    if (/searchuser|accountsearch|搜.*账号|搜索.*账号/.test(text)) {
      return 'search_user';
    }
    if (
      /searcharticle|worksearch|搜.*作品|搜索.*作品|搜.*文章|搜索.*文章/.test(
        text,
      )
    ) {
      return 'search_article';
    }
    if (/queryuser|accountdetail|账号信息|用户信息/.test(text)) {
      return 'account_detail';
    }
    return 'general';
  }

  private normalizeStatus(item: Record<string, unknown>) {
    const value = this.firstString(item, ['status', 'state']);
    if (value === '1' || value === 'online' || value === 'available') {
      return 'online';
    }
    if (value === '0' || value === 'offline' || value === 'disabled') {
      return 'offline';
    }
    return value || 'unknown';
  }

  private sortOrder(
    query: QueryRedfoxInterfacesDto,
  ): Prisma.RedfoxInterfaceOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'desc' ? 'desc' : 'asc';
    if (query.sortBy === 'name') return [{ name: direction }];
    if (query.sortBy === 'price') return [{ price: direction }];
    if (query.sortBy === 'syncedAt') return [{ syncedAt: direction }];
    return [{ platformCode: direction }, { scenario: direction }];
  }

  private toInterface(record: RedfoxInterfaceRecord): RedfoxInterface {
    return {
      id: record.code,
      platformCode: record.platformCode,
      platformName: record.platformName,
      interfaceNo: record.interfaceNo,
      code: record.code,
      name: record.name,
      path: record.path,
      method: record.method,
      scenario: record.scenario,
      status: record.status,
      category: record.category,
      description: record.description || '',
      price: record.price,
      minPrice: record.minPrice,
      requireAuth: record.requireAuth,
      syncedAt: record.syncedAt.toISOString(),
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
      if (Array.isArray(candidate)) return candidate.filter(this.isRecord);
      if (this.isRecord(candidate)) {
        for (const key of ['list', 'items', 'records', 'rows', 'interfaces']) {
          const value = candidate[key];
          if (Array.isArray(value)) return value.filter(this.isRecord);
        }
      }
    }
    return [];
  }

  private extractChildPlatforms(item: Record<string, unknown>) {
    return Array.isArray(item.categories)
      ? item.categories.filter(this.isRecord)
      : [];
  }

  private normalizePath(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return '';
    try {
      const url = new URL(trimmed);
      return url.pathname;
    } catch {
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }
  }

  private firstString(item: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
    return '';
  }

  private firstNumber(item: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = Number(item[key]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  private jsonOrNull(value: unknown) {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }

  private pick(value: unknown, key: string) {
    return this.isRecord(value) ? value[key] : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }
}
