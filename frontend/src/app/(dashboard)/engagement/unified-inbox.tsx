"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Inbox,
  MessageSquare,
  RefreshCw,
  Sparkles,
  UserCheck,
} from "@/components/iconpark";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
  V2StatusChip,
  V2Textarea,
} from "@/components/v2/ui-kit";
import {
  getInboxThreadDetail,
  listInbox,
  type InboxItem,
  type InboxView,
} from "@/lib/api/interaction-inbox";
import {
  replyApi,
  type ReplySuggestionItem,
} from "@/lib/api/reply";
import {
  localEngineApi,
  type InteractionTaskType,
} from "@/lib/api/local-engine";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { toActionableError } from "@/lib/public-error";

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  "wechat-channel": "视频号",
  shipinhao: "视频号",
  wechat: "微信",
  wecom: "企微",
};

const VIEW_LABEL: Array<{ key: InboxView; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unassigned", label: "待分配" },
  { key: "pending", label: "待处理" },
  { key: "replied", label: "已回复" },
  { key: "needs_human", label: "转人工" },
  { key: "overdue", label: "已超时" },
];

const STATUS_LABEL: Record<string, string> = {
  new: "新消息",
  QUEUED: "排队中",
  RUNNING: "执行中",
  WAITING_FOR_SEND_CONFIRMATION: "待确认",
  BLOCKED: "阻塞",
  PAUSED: "暂停",
  COMPLETED: "已回复",
  SKIPPED: "已跳过",
  NO_TARGET: "无目标",
};

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p;
}

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}

/* ===== AI 回复建议（方案 1：收件箱内联生成） ===== */
type ReplyTone = "" | "friendly" | "formal" | "professional";

const REPLY_TONE_OPTIONS: Array<{ key: ReplyTone; label: string }> = [
  { key: "", label: "全部" },
  { key: "friendly", label: "亲切" },
  { key: "formal", label: "正式" },
  { key: "professional", label: "专业" },
];

const TONE_LABEL: Record<string, string> = {
  friendly: "亲切",
  formal: "正式",
  professional: "专业",
};

const TONE_COLOR: Record<string, string> = {
  friendly: "var(--kaypal-v3-success)",
  formal: "var(--kaypal-v3-purple)",
  professional: "var(--kaypal-v3-amber)",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

/** 线程平台/渠道 → 本地引擎互动任务类型（与 local-engine 后端契约一致）。
 * 仅抖音/视频号有真实回复执行链路；其余平台回退到抖音类型避免报错。 */
function replyTaskType(platform: string, channel: string): InteractionTaskType {
  const isDm = channel === "dm";
  if (platform === "douyin") {
    return isDm
      ? "douyin-direct-message-reply"
      : "douyin-comment-reply";
  }
  if (platform === "wechat-channel" || platform === "shipinhao") {
    return isDm
      ? "wechat-channel-direct-message-reply"
      : "wechat-channel-comment-reply";
  }
  return isDm ? "douyin-direct-message-reply" : "douyin-comment-reply";
}

/**
 * 统一互动收件箱（报告 5.1 节）：三栏 Inbox。
 * 左：视图/平台过滤；中：会话列表；右：会话详情。
 * 客服机器人设置作为外部 Tab，不阻塞收件箱。
 */
export function UnifiedInbox() {
  const isMobile = useIsMobile();
  const [view, setView] = useState<InboxView>("all");
  const [platform, setPlatform] = useState<string>("");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [views, setViews] = useState<Record<InboxView, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listInbox({
        view,
        platform: platform || undefined,
        limit: 200,
      });
      setItems(result.items);
      setViews(result.views);
      setSelectedKey((cur) => {
        if (cur && result.items.some((i) => i.threadKey === cur)) return cur;
        return result.items[0]?.threadKey ?? null;
      });
    } catch (e) {
      setError(toActionableError(e, "收件箱加载失败"));
    } finally {
      setLoading(false);
    }
  }, [view, platform]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => items.find((i) => i.threadKey === selectedKey) ?? null,
    [items, selectedKey],
  );

  // 移动端：列表 ↔ 详情 单列切换
  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        <ViewTabs view={view} setView={setView} views={views} />
        {selected ? (
          <div>
            <button
              type="button"
              className="mb-2 text-sm text-[var(--kaypal-v3-muted)]"
              onClick={() => setSelectedKey(null)}
            >
              ← 返回列表
            </button>
            <ThreadDetail threadKey={selected.threadKey} />
          </div>
        ) : (
          <ThreadList
            items={items}
            loading={loading}
            error={error}
            onSelect={setSelectedKey}
            onRetry={load}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[480px] overflow-hidden rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]">
      {/* 左栏：视图 + 平台 */}
      <aside className="flex w-44 shrink-0 flex-col border-r border-[var(--kaypal-v3-border)] p-3">
        <ViewTabs view={view} setView={setView} views={views} />
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-[var(--kaypal-v3-muted)]">
            平台
          </p>
          <div className="flex flex-col gap-1">
            {["", "douyin", "xiaohongshu", "wechat-channel", "wechat"].map(
              (p) => (
                <button
                  key={p || "all"}
                  type="button"
                  onClick={() => setPlatform(p)}
                  className={`rounded-[var(--kaypal-v3-radius-sm)] px-2.5 py-1.5 text-left text-sm transition ${
                    platform === p
                      ? "bg-[var(--kaypal-v3-accent-soft)] font-medium text-[var(--kaypal-v3-accent-ink)]"
                      : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-muted)]"
                  }`}
                >
                  {p ? platformLabel(p) : "全部平台"}
                </button>
              ),
            )}
          </div>
        </div>
      </aside>

      {/* 中栏：会话列表 */}
      <section className="flex w-80 shrink-0 flex-col border-r border-[var(--kaypal-v3-border)]">
        <ThreadList
          items={items}
          loading={loading}
          error={error}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          onRetry={load}
        />
      </section>

      {/* 右栏：详情 */}
      <section className="flex-1 overflow-hidden">
        {selected ? (
          <ThreadDetail threadKey={selected.threadKey} />
        ) : (
          <V2EmptyState
            icon={Inbox}
            title="选择一个会话"
            description="从左侧列表选择一条客户消息查看详情"
          />
        )}
      </section>
    </div>
  );
}

function ViewTabs({
  view,
  setView,
  views,
}: {
  view: InboxView;
  setView: (v: InboxView) => void;
  views: Record<InboxView, number> | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      {VIEW_LABEL.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => setView(v.key)}
          className={`flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] px-2.5 py-1.5 text-sm transition ${
            view === v.key
              ? "bg-[var(--kaypal-v3-accent-soft)] font-medium text-[var(--kaypal-v3-accent-ink)]"
              : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-muted)]"
          }`}
        >
          <span>{v.label}</span>
          {views && views[v.key] > 0 && (
            <span
              className={`ml-2 rounded-full px-1.5 text-xs ${
                view === v.key
                  ? "bg-[var(--kaypal-v3-accent)] text-white"
                  : "bg-[var(--kaypal-v3-paper-muted)] text-[var(--kaypal-v3-muted)]"
              }`}
            >
              {views[v.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function ThreadList({
  items,
  loading,
  error,
  selectedKey,
  onSelect,
  onRetry,
}: {
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="p-4 text-sm text-[var(--kaypal-v3-muted)]">
        正在加载会话…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-start gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 underline"
              onClick={onRetry}
            >
              <RefreshCw className="h-3.5 w-3.5" /> 重试
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <V2EmptyState
        icon={Inbox}
        title="暂无会话"
        description="还没有客户消息，扫描评论/私信后会自动聚合到这里"
      />
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {items.map((item) => (
        <button
          key={item.threadKey}
          type="button"
          onClick={() => onSelect(item.threadKey)}
          className={`block w-full border-b border-[var(--kaypal-v3-border)] px-3 py-3 text-left transition hover:bg-[var(--kaypal-v3-paper-muted)] ${
            selectedKey === item.threadKey
              ? "bg-[var(--kaypal-v3-accent-soft)]"
              : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-xs text-[var(--kaypal-v3-muted)]">
                {platformLabel(item.platform)}
              </span>
              {item.priority === "high" && (
                <span className="h-2 w-2 rounded-full bg-[var(--kaypal-v3-danger)]" />
              )}
            </div>
            <span className="shrink-0 text-xs text-[var(--kaypal-v3-muted)]">
              {timeAgo(item.latestAt)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
              {item.authorName || item.authorExternalId || "客户"}
            </p>
            {item.unreadCount > 0 && (
              <span className="shrink-0 rounded-full bg-[var(--kaypal-v3-accent)] px-1.5 text-xs font-semibold text-white">
                {item.unreadCount}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-[var(--kaypal-v3-muted)]">
            {item.latestBody || "（无文本内容）"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {item.handoffState === "needs_human" && (
              <V2StatusChip tone="danger">转人工</V2StatusChip>
            )}
            {item.slaOverdue && (
              <V2StatusChip tone="warning">
                <Clock className="h-3 w-3" /> 超时
              </V2StatusChip>
            )}
            {item.status === "WAITING_FOR_SEND_CONFIRMATION" && (
              <V2StatusChip tone="accent">待确认</V2StatusChip>
            )}
            {item.leadId && <V2StatusChip tone="success">线索</V2StatusChip>}
          </div>
        </button>
      ))}
    </div>
  );
}

function ThreadDetail({ threadKey }: { threadKey: string }) {
  const [detail, setDetail] = useState<{
    thread: InboxItem;
    history: Array<{
      eventId: string;
      body: string | null;
      occurredAt: string;
      channel: string;
      platform: string;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  // AI 回复建议：内联生成状态（切换会话即重置）
  const [tone, setTone] = useState<ReplyTone>("");
  const [suggestions, setSuggestions] = useState<ReplySuggestionItem[]>([]);
  const [suggestSource, setSuggestSource] = useState<"" | "ai" | "local">("");
  const [suggestNotice, setSuggestNotice] = useState<string | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [draftAdopted, setDraftAdopted] = useState(false);
  const suggestReqRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await getInboxThreadDetail(threadKey));
    } catch (e) {
      setError(toActionableError(e, "详情加载失败"));
    } finally {
      setLoading(false);
    }
  }, [threadKey]);

  useEffect(() => {
    load();
  }, [load]);

  // 切换会话：清空建议区/采纳态，并使在途请求失效
  useEffect(() => {
    setTone("");
    setSuggestions([]);
    setSuggestSource("");
    setSuggestNotice(null);
    setSuggestBusy(false);
    setDraftAdopted(false);
    suggestReqRef.current += 1;
  }, [threadKey]);

  /** 生成回复建议：复用 /reply 的建议服务，输入取当前线程最新文本 */
  const runSuggest = useCallback(
    async (toneValue: ReplyTone) => {
      const thread = detail?.thread;
      const body = (thread?.latestBody ?? "").trim();
      if (!thread || !body) return;
      const reqId = ++suggestReqRef.current;
      setSuggestBusy(true);
      setSuggestNotice(null);
      try {
        const result = await replyApi.suggest({
          comment: body,
          tone: toneValue || undefined,
        });
        if (reqId !== suggestReqRef.current) return; // 会话已切换，丢弃过期响应
        if (!result.suggestions || result.suggestions.length === 0) {
          setSuggestions([]);
          setSuggestSource("");
          setSuggestNotice(result.message || "没有生成到合适建议，换个语气试试");
          return;
        }
        setSuggestions(result.suggestions);
        setSuggestSource(result.source ?? "ai");
        setSuggestNotice(
          result.source === "local"
            ? result.fallbackMessage || "AI 暂不可用，已展示本地规则建议"
            : null,
        );
      } catch (e) {
        if (reqId !== suggestReqRef.current) return;
        setSuggestions([]);
        setSuggestSource("");
        setSuggestNotice(toActionableError(e, "回复建议生成失败"));
      } finally {
        if (reqId === suggestReqRef.current) setSuggestBusy(false);
      }
    },
    [detail],
  );

  /** 采纳建议：写入回复框并收起建议区（发送始终以回复框内容为准） */
  const adoptSuggestion = (content: string) => {
    suggestReqRef.current += 1;
    setSuggestBusy(false);
    setSuggestions([]);
    setSuggestSource("");
    setSuggestNotice(null);
    setReplyText(content);
  };

  /** 采纳已有 AI 草稿 */
  const adoptDraft = () => {
    const draft = detail?.thread?.draftText;
    if (!draft) return;
    setDraftAdopted(true);
    setReplyText(draft);
  };

  const handleReply = async () => {
    const thread = detail?.thread;
    const content = replyText.trim();
    if (!thread || !content) return;
    setSending(true);
    setReplyError(null);
    try {
      const task = await localEngineApi.createTask({
        type: replyTaskType(thread.platform, thread.channel),
        accountId: thread.accountId ?? undefined,
        platformName: thread.platform,
        targetName: thread.authorName ?? thread.authorExternalId ?? undefined,
        sourceText: thread.latestBody ?? undefined,
        sourceUrl: thread.sourceUrl ?? undefined,
        replyText: content,
      });
      await localEngineApi.approveTask(task.id, { replyText: content });
      setReplyText("");
      setSuggestions([]);
      setSuggestSource("");
      setSuggestNotice(null);
      setDraftAdopted(false);
      suggestReqRef.current += 1;
      await load();
    } catch (e) {
      setReplyError(toActionableError(e, "回复发送失败，请稍后重试"));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--kaypal-v3-muted)]">
        正在加载会话详情…
      </div>
    );
  }
  if (error || !detail || !detail.thread) {
    return (
      <div className="p-6 text-sm text-[var(--kaypal-v3-danger)]">
        {error || "会话不存在"}
      </div>
    );
  }

  const { thread, history } = detail;

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="border-b border-[var(--kaypal-v3-border)] px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              {thread.authorName || thread.authorExternalId || "客户"}
              <span className="ml-2 text-xs font-normal text-[var(--kaypal-v3-muted)]">
                {platformLabel(thread.platform)} · {thread.channel === "dm" ? "私信" : "评论"}
              </span>
            </p>
            {thread.sourceArticleTitle && (
              <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                内容来源：{thread.sourceArticleTitle}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <V2StatusChip
              tone={
                thread.handoffState === "needs_human"
                  ? "danger"
                  : thread.status === "COMPLETED"
                    ? "success"
                    : "accent"
              }
            >
              {thread.handoffState === "needs_human"
                ? "转人工"
                : statusLabel(thread.status)}
            </V2StatusChip>
            {thread.slaOverdue && (
              <V2StatusChip tone="warning">
                <Clock className="h-3 w-3" /> 超时
              </V2StatusChip>
            )}
            {thread.assigneeId && (
              <V2StatusChip tone="muted">
                <UserCheck className="h-3 w-3" /> 已分配
              </V2StatusChip>
            )}
          </div>
        </div>
      </div>

      {/* 历史 */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {history.length === 0 ? (
          <p className="text-sm text-[var(--kaypal-v3-muted)]">暂无历史消息</p>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map((h) => (
              <div
                key={h.eventId}
                className="max-w-[85%] rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-muted)] px-3 py-2"
              >
                <p className="text-sm text-[var(--kaypal-v3-ink)]">
                  {h.body || "（无文本）"}
                </p>
                <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                  {platformLabel(h.platform)} · {timeAgo(h.occurredAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 线索/CRM 关联 + 草稿 + 动作 */}
      <div className="border-t border-[var(--kaypal-v3-border)] px-5 py-3">
        {thread.draftText && !draftAdopted && (
          <div className="mb-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-[var(--kaypal-v3-accent-ink)]">
                回复草稿
              </p>
              <button
                type="button"
                className="shrink-0 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] px-2 py-0.5 text-xs font-medium text-[var(--kaypal-v3-accent-ink)] transition hover:bg-[var(--kaypal-v3-paper)]"
                onClick={adoptDraft}
              >
                采纳
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-ink)]">
              {thread.draftText}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {thread.leadId ? (
            <V2StatusChip tone="success">已关联线索 · {thread.leadStatus}</V2StatusChip>
          ) : (
            <V2StatusChip tone="muted">未关联线索</V2StatusChip>
          )}
          {thread.customerId && (
            <V2StatusChip tone="success">已入 CRM</V2StatusChip>
          )}
          <div className="ml-auto">
            <V2GhostButton
              icon={UserCheck}
              disabled
              title="分配功能即将上线"
            >
              分配
            </V2GhostButton>
          </div>
        </div>
        <div className="mt-3">
          {/* 工具行：AI 生成回复 + 语气 */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <V2GhostButton
              icon={Sparkles}
              loading={suggestBusy}
              disabled={suggestBusy || sending || !(thread.latestBody ?? "").trim()}
              title={
                (thread.latestBody ?? "").trim()
                  ? undefined
                  : "这条消息没有可引用的文本"
              }
              onClick={() => void runSuggest(tone)}
              style={{ padding: "5px 12px", fontSize: 12 }}
            >
              {suggestBusy ? "AI 生成中…" : "AI 生成回复"}
            </V2GhostButton>
            <div className="flex flex-wrap items-center gap-1">
              {REPLY_TONE_OPTIONS.map((opt) => {
                const active = tone === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={suggestBusy}
                    onClick={() => {
                      setTone(opt.key);
                      // 已有建议时切语气 = 按新语气重新生成（整体替换）
                      if (suggestions.length > 0) void runSuggest(opt.key);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-60 ${
                      active
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                        : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 建议区 */}
          {suggestions.length > 0 && (
            <div className="mb-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="shrink-0 text-xs font-medium text-[var(--kaypal-v3-accent-ink)]">
                    回复建议
                  </p>
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-medium leading-4 ${
                      suggestSource === "local"
                        ? "bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]"
                        : "bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)]"
                    }`}
                  >
                    {suggestSource === "local" ? "规则建议" : "AI 生成"}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={suggestBusy}
                  onClick={() => void runSuggest(tone)}
                  className="shrink-0 rounded-[var(--kaypal-v3-radius-sm)] px-1.5 py-0.5 text-xs text-[var(--kaypal-v3-accent-ink)] transition hover:bg-[var(--kaypal-v3-paper)] disabled:opacity-60"
                >
                  换一批
                </button>
              </div>
              {suggestSource === "local" && suggestNotice && (
                <p className="mt-1.5 text-[11px] text-[var(--kaypal-v3-amber)]">
                  {suggestNotice}
                </p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {suggestions.map((s, i) => (
                  <div
                    key={`${s.tone}-${i}`}
                    className="flex items-start gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2.5 py-2"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: TONE_COLOR[s.tone] ?? "var(--kaypal-v3-muted)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[11px] font-medium"
                        style={{ color: TONE_COLOR[s.tone] ?? "var(--kaypal-v3-muted)" }}
                      >
                        {TONE_LABEL[s.tone] ?? s.tone}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-[var(--kaypal-v3-ink)]">
                        {s.content}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] px-2 py-1 text-xs font-medium text-[var(--kaypal-v3-accent-ink)] transition hover:bg-[var(--kaypal-v3-accent-soft)]"
                      onClick={() => adoptSuggestion(s.content)}
                    >
                      采纳
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 无建议时的行内提示（失败 / 空结果 / 降级） */}
          {suggestions.length === 0 && suggestNotice && !suggestBusy && (
            <p
              className={`mb-2 text-xs ${
                suggestSource === "local"
                  ? "text-[var(--kaypal-v3-amber)]"
                  : "text-[var(--kaypal-v3-muted)]"
              }`}
            >
              {suggestNotice}
            </p>
          )}

          <V2Textarea
            placeholder="输入回复内容…（将自动发送）"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
          />
          {replyError && (
            <p className="mt-1 text-xs text-[var(--kaypal-v3-danger)]">
              {replyError}
            </p>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <V2PrimaryButton
              icon={MessageSquare}
              loading={sending}
              disabled={!replyText.trim()}
              onClick={() => void handleReply()}
            >
              发送回复
            </V2PrimaryButton>
          </div>
        </div>
        {thread.handoffReason && (
          <p className="mt-2 text-xs text-[var(--kaypal-v3-danger)]">
            转人工原因：{thread.handoffReason}
          </p>
        )}
      </div>
    </div>
  );
}
