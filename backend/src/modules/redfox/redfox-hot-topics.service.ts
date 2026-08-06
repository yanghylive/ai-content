import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AgentSService } from '../agent-s/agent-s.service';
import { RedfoxSkillRunnerService } from './redfox-skill-runner.service';

export interface HotTopicItem {
  title: string;
  platform: string;
  heat?: string;
  url?: string;
}

interface CacheEntry {
  items: HotTopicItem[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟：热点不必实时，省积分
const HOT_SEARCH_SKILL = 'trending-hub-top10';

/**
 * 首页「行业热点」轻量通道：
 * 调 RedFox 全网聚合热榜技能 → 取 agent 产物 JSON → 解析出热点列表
 * 30 分钟缓存（反复刷首页不重复扣积分）
 */
@Injectable()
export class RedfoxHotTopicsService {
  private readonly logger = new Logger(RedfoxHotTopicsService.name);
  private cache: CacheEntry | null = null;
  private inflight: Promise<HotTopicItem[]> | null = null;

  constructor(
    private readonly skillRunner: RedfoxSkillRunnerService,
    private readonly agentS: AgentSService,
  ) {}

  async getHotTopics(authUser: AuthenticatedUser): Promise<{
    items: HotTopicItem[];
    fetchedAt: number;
    fromCache: boolean;
  }> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return {
        items: this.cache.items,
        fetchedAt: this.cache.fetchedAt,
        fromCache: true,
      };
    }

    // 防止并发重复调用（首页多端同时打开时只调一次）
    if (!this.inflight) {
      this.inflight = this.fetchFromRedfox(authUser).finally(() => {
        this.inflight = null;
      });
    }
    const items = await this.inflight;
    return {
      items,
      fetchedAt: this.cache?.fetchedAt ?? Date.now(),
      fromCache: false,
    };
  }

  private async fetchFromRedfox(
    authUser: AuthenticatedUser,
  ): Promise<HotTopicItem[]> {
    try {
      const result = await this.skillRunner.runSkill(authUser, {
        skillCode: HOT_SEARCH_SKILL,
        input: {},
        dryRun: false,
      } as never);

      const summary = (result as { payloadSummary?: Record<string, unknown> })
        .payloadSummary;
      const sessionId = summary?.agentSessionId as string | undefined;
      const artifact = summary?.primaryArtifact as
        | { artifactId?: string }
        | undefined;
      if (!sessionId || !artifact?.artifactId) {
        this.logger.warn('热榜技能未返回产物，使用缓存兜底');
        return this.cache?.items ?? [];
      }

      const artifactResult = await this.agentS.getArtifact(
        sessionId,
        artifact.artifactId,
      );
      const payload = this.parseJsonContent(artifactResult.content);
      const items = this.extractItems(payload);

      if (items.length > 0) {
        this.cache = { items, fetchedAt: Date.now() };
        this.logger.log(`热榜已更新：${items.length} 条`);
      }
      return items.length > 0 ? items : (this.cache?.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`热榜获取失败（用缓存兜底）: ${message}`);
      return this.cache?.items ?? [];
    }
  }

  private parseJsonContent(content: unknown): unknown {
    const text = Buffer.isBuffer(content)
      ? content.toString('utf-8')
      : String(content ?? '');
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** 从产物 JSON 里提取热点列表（主结构 output.hotspots，其他结构兜底） */
  private extractItems(payload: unknown): HotTopicItem[] {
    if (!payload || typeof payload !== 'object') return [];
    const root = payload as Record<string, unknown>;

    // 主结构：output.hotspots（trending-hub-top10 实测结构）
    const output = root.output as Record<string, unknown> | undefined;
    const hotspots = output?.hotspots;
    if (Array.isArray(hotspots) && hotspots.length > 0) {
      return (hotspots as Array<Record<string, unknown>>)
        .slice(0, 15)
        .map((entry): HotTopicItem | null => {
          const title = String(entry.title ?? '').trim();
          if (!title) return null;
          return {
            title,
            platform: String(entry.platName ?? entry.platform ?? '全网'),
            heat:
              entry.maxHotScore != null
                ? this.formatHeat(Number(entry.maxHotScore))
                : undefined,
            url: entry.url != null ? String(entry.url) : undefined,
          };
        })
        .filter((x): x is HotTopicItem => x !== null);
    }

    // 兜底：常见容器名逐个试
    const candidates: unknown[] = [];
    for (const key of [
      'items',
      'list',
      'data',
      'results',
      'hotList',
      'topics',
      'hotSearch',
      'entries',
    ]) {
      const v = root[key];
      if (Array.isArray(v) && v.length > 0) candidates.push(v);
      const nested = root.data as Record<string, unknown> | undefined;
      if (
        nested &&
        Array.isArray(nested[key]) &&
        (nested[key] as unknown[]).length > 0
      ) {
        candidates.push(nested[key]);
      }
    }
    const list =
      (candidates[0] as Array<Record<string, unknown>> | undefined) ?? [];

    return list
      .slice(0, 15)
      .map((entry): HotTopicItem | null => {
        if (typeof entry === 'string')
          return { title: entry, platform: '全网' };
        if (!entry || typeof entry !== 'object') return null;
        const title = String(
          entry.title ??
            entry.word ??
            entry.name ??
            entry.keyword ??
            entry.query ??
            '',
        ).trim();
        if (!title) return null;
        return {
          title,
          platform: String(
            entry.platform ?? entry.source ?? entry.channel ?? '全网',
          ),
          heat:
            entry.heat != null
              ? String(entry.heat)
              : entry.hot_value != null
                ? String(entry.hot_value)
                : undefined,
          url: entry.url != null ? String(entry.url) : undefined,
        };
      })
      .filter((x): x is HotTopicItem => x !== null);
  }

  /** 热度值人性化：30690000 → 3069万 */
  private formatHeat(score: number): string {
    if (!Number.isFinite(score) || score <= 0) return '';
    if (score >= 10000) return `${Math.round(score / 10000)}万`;
    return String(Math.round(score));
  }
}
