// 发现中心类型（开发文档 §7.1 + 统一开发计划 §六）
// 平台发现候选的统一契约：SourceContent / InteractionEvent / PlatformIdentity 的产出入参

export type DiscoveryCapability = {
  platform: string;
  modes: Array<
    | 'keyword'
    | 'video-link'
    | 'target-account'
    | 'manual-import'
    | 'account-search'
  >;
  supportsComment: boolean;
  supportsDm: boolean;
  /** 能力差异：auto-publish / manual-notify / collect-only */
  publishMode: 'auto' | 'manual' | 'collect-only';
  dailyQuota: number;
  remainingQuota?: number;
  cooldownSeconds?: number;
  lastSyncedAt?: string;
  /** 不支持的原因（unsupported 时） */
  unavailableReason?: string;
};

export type ExternalContentRef = {
  platform: string;
  accountId: string;
  /** 外部内容 ID 或 URL（二选一） */
  externalContentId?: string;
  url?: string;
};

export type DiscoveryItem = {
  platform: string;
  accountId: string;
  /** 来源内容（可能为 null，如纯账号搜索） */
  sourceContent?: {
    externalContentId: string;
    url: string;
    contentType: string;
    authorIdentityId?: string;
    title?: string;
    text?: string;
    rawHash: string;
  };
  /** 互动事件（可能为空） */
  interactionEvents?: Array<{
    // P1-6 复核：无平台真实事件/评论 ID 时为 undefined（禁止合成内容锚点冒充事件 ID）
    externalEventId?: string;
    type: string;
    authorExternalId?: string;
    text?: string;
    sourceUrl?: string;
    occurredAt: string;
    evidenceUrl?: string;
  }>;
  /** 作者身份线索 */
  identityHint?: {
    externalUserId?: string;
    profileUrl?: string;
    nickname?: string;
    avatarHash?: string;
  };
  /** Sprint 5：快手真实搜索不渲染时降级推荐流的标注（不冒充关键词搜索结果） */
  recommendedFallback?: boolean;
};

export type DiscoveryContext = {
  tenantId: string;
  userId: string;
  accountId: string;
  runId: string;
  cursor?: string;
  timeWindow: { from: string; to: string };
  budget: { maxItems: number; maxRequests: number };
  abortSignal: AbortSignal;
};

export type DiscoveryInput = {
  platform: string;
  accountId: string;
  mode: DiscoveryCapability['modes'][number];
  /** 关键词 / 视频链接 / 目标账号 / 导入文件 输入 */
  input: Record<string, unknown>;
  timeWindow: { from: string; to: string };
  limit: number;
  riskMode: 'draft-only' | 'confirm-first' | 'auto';
};
