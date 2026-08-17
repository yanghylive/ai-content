// 人工导入 adapter（开发文档 §7.3 顺序 2，Sprint 5 T5.2）
// 最低风险模式：CSV/JSON 结构化导入 → 产出 DiscoveryItem（SourceContent + InteractionEvent + identityHint）。
// 复用 csv.ts 状态机解析（引号/逗号/换行正确处理）；字段映射 + 去重（rawHash）+ 幂等 batch。
import { createHash } from 'node:crypto';
import type {
  DiscoveryAdapter,
} from '../discovery.adapter';
import type {
  DiscoveryCapability,
  DiscoveryContext,
  DiscoveryInput,
  DiscoveryItem,
  ExternalContentRef,
} from '../discovery.types';
import { parseCsv } from './csv';

/** 人工导入的字段映射（列名 → 语义） */
const FIELD_ALIASES: Record<string, string> = {
  nickname: 'nickname',
  昵称: 'nickname',
  名称: 'nickname',
  name: 'nickname',
  sourceText: 'sourceText',
  评论: 'sourceText',
  文本: 'sourceText',
  text: 'sourceText',
  sourceUrl: 'sourceUrl',
  链接: 'sourceUrl',
  url: 'sourceUrl',
  externalUserId: 'externalUserId',
  用户ID: 'externalUserId',
  user_id: 'externalUserId',
  platform: 'platform',
  平台: 'platform',
  evidenceUrl: 'evidenceUrl',
  证据: 'evidenceUrl',
};

export class ManualAdapter implements DiscoveryAdapter {
  readonly platform = 'manual';

  async capabilities(): Promise<DiscoveryCapability> {
    return {
      platform: 'manual',
      modes: ['manual-import'],
      supportsComment: true,
      supportsDm: false,
      publishMode: 'manual',
      dailyQuota: 10000,
    };
  }

  async *discover(
    input: DiscoveryInput,
    _ctx: DiscoveryContext,
  ): AsyncIterable<DiscoveryItem> {
    const raw = input.input;
    const limit = input.limit || 100;
    let count = 0;

    // 支持两种输入：rows（结构化数组）或 csvText（CSV 文本）
    let records: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw.rows)) {
      records = raw.rows as Array<Record<string, unknown>>;
    } else if (typeof raw.csvText === 'string') {
      const parsed = parseCsv(raw.csvText);
      records = parsed.rows as unknown as Array<Record<string, unknown>>;
    }

    for (const rec of records) {
      if (count >= limit) break;
      const item = this.mapRecord(rec, input.accountId);
      if (!item) continue;
      yield item;
      count += 1;
    }
  }

  async fetchContent(
    ref: ExternalContentRef,
    _ctx: DiscoveryContext,
  ) {
    return {
      externalContentId: ref.externalContentId ?? createHash('sha1').update(ref.url ?? 'manual').digest('hex').slice(0, 24),
      url: ref.url ?? '',
      contentType: 'manual',
      rawHash: createHash('sha256').update(JSON.stringify(ref)).digest('hex'),
    };
  }

  async *fetchInteractions(
    _ref: ExternalContentRef,
    _ctx: DiscoveryContext,
  ): AsyncIterable<{ externalEventId: string; type: string; authorExternalId?: string; text?: string; sourceUrl?: string; occurredAt: string; evidenceUrl?: string }> {
    // 人工导入的互动随 discover 产出，不单独抓取
    return;
  }

  /** 记录 → DiscoveryItem（字段映射 + 去重 rawHash） */
  private mapRecord(
    rec: Record<string, unknown>,
    accountId: string,
  ): DiscoveryItem | null {
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      const semantic = FIELD_ALIASES[k] ?? k;
      if (typeof v === 'string' || typeof v === 'number') {
        mapped[semantic] = String(v);
      }
    }
    const nickname = mapped.nickname ?? '';
    const sourceText = mapped.sourceText ?? '';
    if (!nickname && !sourceText) return null; // 无有效内容跳过

    const platform = mapped.platform || 'unknown';
    const sourceUrl = mapped.sourceUrl ?? null;
    const externalUserId = mapped.externalUserId || undefined;
    const externalContentId =
      mapped.externalContentId ||
      createHash('sha1').update(`${platform}:${nickname}:${sourceText.slice(0, 40)}`).digest('hex').slice(0, 24);

    return {
      platform,
      accountId,
      sourceContent: {
        externalContentId,
        url: sourceUrl ?? '',
        contentType: 'manual',
        title: nickname ? `${nickname} 的导入内容` : undefined,
        text: sourceText || undefined,
        rawHash: createHash('sha256')
          .update(`${platform}|${nickname}|${sourceText}`)
          .digest('hex'),
      },
      interactionEvents: [
        {
          externalEventId: `manual:${externalContentId}:0`,
          type: 'comment',
          authorExternalId: externalUserId,
          text: sourceText || undefined,
          sourceUrl: sourceUrl ?? undefined,
          occurredAt: mapped.occurredAt || new Date().toISOString(),
          evidenceUrl: mapped.evidenceUrl || undefined,
        },
      ],
      identityHint: {
        externalUserId,
        profileUrl: mapped.profileUrl || undefined,
        nickname: nickname || undefined,
      },
    };
  }
}
