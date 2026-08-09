"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  MessageSquareText,
  RefreshCcw,
  Search,
  UserRound,
} from "lucide-react";
import {
  V2Section,
  V2GhostButton,
  V2PrimaryButton,
  V2EmptyState,
  V2Input,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type WechatChatSession,
  type WechatChatMessage,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export function WechatChatHistory() {
  const router = useRouter();
  const [sessions, setSessions] = useState<WechatChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WechatChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.wechatChatSessions();
      const list = (data as { items?: WechatChatSession[] }).items || (Array.isArray(data) ? data : []);
      setSessions(list);
      if (list.length > 0 && !selectedSessionId) {
        setSelectedSessionId(list[0].id);
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "加载会话失败"));
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    void fetchSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMessages = useCallback(async (sessionId: string) => {
    setLoadingMessages(true);
    try {
      const data = await localEngineApi.wechatChatHistory(sessionId, 100);
      setMessages((data as { items?: WechatChatMessage[] }).items || (Array.isArray(data) ? data : []));
    } catch (err: unknown) {
      setError(toPublicError(err, "加载消息失败"));
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      void fetchMessages(selectedSessionId);
    }
  }, [selectedSessionId, fetchMessages]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await localEngineApi.syncWechatChatHistory({});
      flash("会话历史已同步");
      await fetchSessions();
      if (selectedSessionId) await fetchMessages(selectedSessionId);
    } catch (err: unknown) {
      setError(toPublicError(err, "同步失败，请稍后重试"));
    } finally {
      setSyncing(false);
    }
  };

  const filteredSessions = sessions.filter((s) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return `${s.title} ${s.contactName || ""} ${s.lastMessage || ""}`.toLowerCase().includes(q);
  });

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/engagement/wechat")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">会话历史</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              微信聊天记录，随时回看
            </p>
          </div>
          <V2PrimaryButton
            icon={RefreshCcw}
            loading={syncing}
            onClick={handleSync}
          >
            {syncing ? "正在同步..." : "同步历史"}
          </V2PrimaryButton>
        </div>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* 左：会话列表 */}
        <V2Section padding={false} title="会话">
          <div className="border-b border-[var(--kaypal-v3-border)] p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
              <V2Input
                placeholder="搜索会话..."
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <V2EmptyState
              icon={MessageSquareText}
              title={sessions.length === 0 ? "还没有会话" : "没有匹配的会话"}
              description={sessions.length === 0 ? "点右上角「同步历史」拉取聊天记录" : undefined}
            />
          ) : (
            <div className="max-h-[480px] divide-y divide-[var(--kaypal-v3-border)] overflow-y-auto">
              {filteredSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`flex w-full items-start gap-3 p-4 text-left transition ${
                    selectedSessionId === session.id
                      ? "bg-[var(--kaypal-v3-accent-soft)]"
                      : "hover:bg-[var(--kaypal-v3-paper-soft)]"
                  }`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
                    {session.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={session.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <UserRound className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                        {session.contactName || session.title}
                      </p>
                      {session.unreadCount > 0 && (
                        <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--kaypal-v3-danger)] px-1.5 text-xs text-white">
                          {session.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-[var(--kaypal-v3-muted)]">
                      {session.lastMessage || "暂无消息"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </V2Section>

        {/* 右：消息流 */}
        <V2Section
          title={selectedSession ? selectedSession.contactName || selectedSession.title : "消息"}
          padding={false}
        >
          {!selectedSessionId ? (
            <V2EmptyState icon={MessageSquareText} title="选一个会话查看消息" />
          ) : loadingMessages ? (
            <div className="p-12 text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
            </div>
          ) : messages.length === 0 ? (
            <V2EmptyState icon={MessageSquareText} title="这个会话还没有消息记录" />
          ) : (
            <div className="max-h-[480px] space-y-3 overflow-y-auto p-5">
              {messages.map((message) => {
                const isOutgoing = message.direction === "outgoing";
                const isSystem = message.direction === "system" || message.contentType === "system";
                if (isSystem) {
                  return (
                    <p key={message.id} className="py-1 text-center text-xs text-[var(--kaypal-v3-muted)]">
                      {message.content}
                    </p>
                  );
                }
                return (
                  <div
                    key={message.id}
                    className={`flex ${isOutgoing ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-[var(--kaypal-v3-radius)] px-4 py-2.5 ${
                        isOutgoing
                          ? "bg-[var(--kaypal-v3-accent)] text-white"
                          : "bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-ink)]"
                      }`}
                    >
                      {!isOutgoing && message.senderName && (
                        <p className="mb-1 text-xs font-medium opacity-70">
                          {message.senderName}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {message.contentType === "image"
                          ? "[图片]"
                          : message.contentType === "file"
                            ? `[文件] ${message.content}`
                            : message.content}
                      </p>
                      {message.sentAt && (
                        <p className={`mt-1 text-[10px] ${isOutgoing ? "text-white/60" : "text-[var(--kaypal-v3-muted)]"}`}>
                          {new Date(message.sentAt).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </V2Section>
      </div>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/engagement/wechat")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
