"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Inbox,
  MessageSquare,
  RefreshCw,
  UserCheck,
} from "lucide-react";
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
        {thread.draftText && (
          <div className="mb-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-3">
            <p className="text-xs font-medium text-[var(--kaypal-v3-accent-ink)]">
              回复草稿
            </p>
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
