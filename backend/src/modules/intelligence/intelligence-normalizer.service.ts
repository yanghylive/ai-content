import { Injectable } from '@nestjs/common';

export interface NormalizeRedfoxPayloadInput {
  tenantId?: string | null;
  userId: string;
  platform: string;
  type: string;
  redfoxSkillId?: string | null;
  redfoxCallLogId?: string | null;
  rawItems: unknown[];
}

export interface NormalizedIntelligenceItem {
  tenantId?: string | null;
  userId: string;
  platform: string;
  type: string;
  title: string;
  content?: string;
  summary?: string;
  sourceUrl?: string;
  sourceExternalId?: string;
  author?: string;
  authorUrl?: string;
  publishDate?: Date;
  metrics: Record<string, unknown>;
  keywords: string[];
  raw: unknown;
  redfoxSkillId?: string | null;
  redfoxCallLogId?: string | null;
}

@Injectable()
export class IntelligenceNormalizerService {
  normalizeRedfoxPayload(
    input: NormalizeRedfoxPayloadInput,
  ): NormalizedIntelligenceItem[] {
    return input.rawItems.map((rawItem, index) => {
      const record = this.asRecord(rawItem);
      const title =
        this.pickString(record, [
          'title',
          'workTitle',
          'name',
          'nickname',
          'accountName',
          'accountNickname',
          'keyword',
        ]) || `RedFox 情报 ${index + 1}`;

      return {
        tenantId: input.tenantId,
        userId: input.userId,
        platform: input.platform,
        type: input.type,
        title,
        content: this.pickString(record, [
          'content',
          'text',
          'workDesc',
          'desc',
          'description',
          'signature',
          'sign',
          'accountDesc',
        ]),
        summary: this.pickString(record, ['summary', 'brief']),
        sourceUrl: this.pickString(record, [
          'sourceUrl',
          'source_url',
          'url',
          'link',
          'workUrl',
          'articleUrl',
        ]),
        sourceExternalId: this.pickString(record, [
          'id',
          'externalId',
          'external_id',
          'workId',
          'workUuid',
          'noteId',
          'awemeId',
          'bvId',
          'bvid',
          'mid',
          'uid',
          'account',
          'accountId',
          'accountUserid',
        ]),
        author: this.pickString(record, [
          'author',
          'nickname',
          'userName',
          'accountName',
          'accountNickname',
          'name',
        ]),
        authorUrl: this.pickString(record, [
          'authorUrl',
          'author_url',
          'userUrl',
          'profileUrl',
          'profile_url',
          'authorLink',
        ]),
        publishDate: this.pickDate(record, [
          'publishDate',
          'publish_date',
          'publishedAt',
          'published_at',
          'createdAt',
          'created_at',
          'publishTime',
          'workPublishTime',
          'lastCreateTime',
          'lastCreated',
          'created',
        ]),
        metrics: this.pickMetrics(record),
        keywords: this.pickKeywords(record),
        raw: rawItem,
        redfoxSkillId: input.redfoxSkillId,
        redfoxCallLogId: input.redfoxCallLogId,
      };
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private pickString(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }
    return undefined;
  }

  private pickKeywords(record: Record<string, unknown>) {
    const value = record.keywords ?? record.tags;
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
      .map((item) => item.trim());
  }

  private pickDate(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value;
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        if (Number.isFinite(date.getTime())) {
          return date;
        }
      }
    }
    return undefined;
  }

  private pickMetrics(record: Record<string, unknown>) {
    const metrics = record.metrics;
    if (metrics && typeof metrics === 'object' && !Array.isArray(metrics)) {
      return metrics as Record<string, unknown>;
    }

    const metricKeys = [
      'likeCount',
      'commentCount',
      'shareCount',
      'collectCount',
      'readCount',
      'watchCount',
      'rewardCount',
      'viewCount',
      'playCount',
      'followerCount',
      'favoriteCount',
      'workLikedCount',
      'workReadedCount',
      'workSharedCount',
      'workCommentsCount',
      'workCollectedCount',
      'accountFans',
      'accountLikes',
      'accountCollectes',
      'accountTotalWorks',
      'redfoxIndex',
      'redFoxIndex',
    ];
    return metricKeys.reduce<Record<string, unknown>>((result, key) => {
      if (record[key] !== undefined) {
        result[key] = record[key];
      }
      return result;
    }, {});
  }
}
