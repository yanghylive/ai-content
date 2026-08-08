import { Injectable, Logger } from '@nestjs/common';
import { safeText } from '../../common/text.utils';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RedfoxService } from './redfox.service';
import { RedfoxClientService } from './redfox-client.service';

/** 竞品雷达账号（来自 RedFox 抖音账号搜索） */
export interface RadarAccount {
  name: string;
  accountId: string;
  avatarUrl?: string;
  /** 粉丝数（原始数字） */
  followers: number;
  /** 作品数 */
  works: number;
  /** 近 30 天作品数（活跃度信号） */
  works30d: number;
  /** 总获赞 */
  totalFavorited?: number;
  description?: string;
}

export interface RadarResult {
  keyword: string;
  items: RadarAccount[];
  fetchedAt: number;
  fromCache: boolean;
}

interface CacheEntry {
  items: RadarAccount[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟：竞品不必实时，省积分
const SEARCH_USER_PATH = '/story/api/dyData/searchUser';
const DEFAULT_KEYWORD = 'AI 编程';

/**
 * 竞品雷达（手机端驾驶舱「竞品雷达」卡数据源）：
 * 调 RedFox 抖音账号搜索 → 解析账号列表（粉丝/作品/近30天活跃度）
 * 30 分钟按关键词缓存（反复刷新不重复扣积分），失败降级返回缓存/空。
 */
@Injectable()
export class RedfoxRadarService {
  private readonly logger = new Logger(RedfoxRadarService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly redfoxService: RedfoxService,
    private readonly client: RedfoxClientService,
  ) {}

  async getRadarAccounts(
    authUser: AuthenticatedUser,
    input: { keyword?: string; limit?: number } = {},
  ): Promise<RadarResult> {
    const keyword =
      (input.keyword || DEFAULT_KEYWORD).trim().slice(0, 20) || DEFAULT_KEYWORD;
    const limit = Math.min(Math.max(input.limit ?? 4, 1), 10);
    const cacheKey = `${keyword}:${limit}`;
    const hit = this.cache.get(cacheKey);

    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      return {
        keyword,
        items: hit.items,
        fetchedAt: hit.fetchedAt,
        fromCache: true,
      };
    }

    try {
      const scope = await this.redfoxService.resolveScope(authUser);
      const connection = await this.redfoxService.getEffectiveConnection(scope);
      const raw = await this.client.request<{
        code: number;
        data?: { list?: Array<Record<string, unknown>> };
      }>(scope, connection, {
        method: 'POST',
        path: SEARCH_USER_PATH,
        body: { keyword, limit },
        operation: `redfox.skill.execute.radar.search-user.${keyword}`,
        skillCode: 'douyin-search-user',
        estimatedCostPoints: 1,
      });

      const items = this.extractAccounts(raw?.data?.list, limit);
      if (items.length > 0) {
        this.cache.set(cacheKey, { items, fetchedAt: Date.now() });
        this.logger.log(`竞品雷达已更新：${items.length} 个账号`);
      }
      return {
        keyword,
        items: items.length > 0 ? items : (hit?.items ?? []),
        fetchedAt: Date.now(),
        fromCache: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`竞品雷达获取失败（用缓存兜底）: ${message}`);
      return {
        keyword,
        items: hit?.items ?? [],
        fetchedAt: hit?.fetchedAt ?? Date.now(),
        fromCache: Boolean(hit),
      };
    }
  }

  /** 解析账号列表（宽容多字段，昵称/粉丝/作品缺一不可） */
  private extractAccounts(
    list: Array<Record<string, unknown>> | undefined,
    limit: number,
  ): RadarAccount[] {
    if (!Array.isArray(list)) return [];
    return list
      .map((entry): RadarAccount | null => {
        const name = this.toText(
          entry.nickname,
          entry.name,
          entry.accountName,
        ).trim();
        const accountId = this.toText(entry.accountId, entry.uid).trim();
        const followers = this.toNumber(entry.followerCount, entry.fans);
        const works = this.toNumber(entry.awemeCount, entry.workCount);
        if (!name || !accountId) return null;
        return {
          name,
          accountId,
          avatarUrl: entry.avatarUrl
            ? this.toText(entry.avatarUrl) || undefined
            : undefined,
          followers,
          works,
          works30d: this.toNumber(entry.awemeCountThirty, entry.aweme30d),
          totalFavorited: this.toNumber(entry.totalFavorited, entry.favorited),
          description: entry.signature
            ? this.toText(entry.signature) || undefined
            : undefined,
        };
      })
      .filter((x): x is RadarAccount => x !== null)
      .slice(0, limit);
  }

  /** 安全转字符串：字符串原样、null/undefined 空串、其他 JSON 化（避免 [object Object]） */
  private toText(...values: unknown[]): string {
    for (const value of values) {
      if (value == null) continue;
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        return String(value);
      }
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch {
          return safeText(value);
        }
      }
    }
    return '';
  }

  private toNumber(...values: unknown[]): number {
    for (const value of values) {
      if (value == null) continue;
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }
}
