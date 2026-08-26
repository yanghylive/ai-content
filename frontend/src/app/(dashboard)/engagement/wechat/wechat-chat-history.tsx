"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Avatar } from "@/components/avatar";
import {
  localEngineApi,
  type WechatChatSession,
  type WechatChatMessage,
} from "@/lib/api/local-engine";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { toActionableError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

/** 商用授权引导条：同步历史需要 STANDARD/PRO 及以上套餐 */
function CommercialGateBanner() {
  return (
    <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-warning)] bg-[var(--kaypal-v3-warning-soft)] p-4">
      <p className="text-sm font-medium text-[var(--kaypal-v3-warning)]">
        同步历史需要有效商用授权（STANDARD / PRO 及以上套餐）。
      </p>
      <a
        href="/commercial-readiness"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)] underline underline-offset-2 hover:opacity-80"
      >
        去开通商用授权 →
      </a>
    </div>
  );
}

/** 403 且为商用授权/套餐类报错（对应后端 PlanGuard） */
function isCommercial403(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    /商用授权|套餐|升级/.test(err.message)
  );
}

export function WechatChatHistory() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [sessions, setSessions] = useState<WechatChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WechatChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commercialBlocked, setCommercialBlocked] = useState(false);

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
      setError(toActionableError(err, "加载会话失败"));
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    void fetchSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 商用授权预检：无授权时禁用同步并显示引导条（避免每次点击 403）
  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((me) => {
        if (active && me && me.commercialExecutionAllowed === false) {
          setCommercialBlocked(true);
        }
      })
      .catch(() => {
        /* 预检失败不阻塞页面，由同步动作兜底 */
      });
    return () => {
      active = false;
    };
  }, []);

  // 请求序号守卫：快速切换会话时，慢响应回来若序号已过期则丢弃，
  // 避免旧会话的响应覆盖新会话消息（标题 B 内容 A 的竞态）
  const messageReqSeq = useRef(0);

  const fetchMessages = useCallback(async (sessionId: string) => {
    const seq = ++messageReqSeq.current;
    setLoadingMessages(true);
    try {
      const data = await localEngineApi.wechatChatHistory(sessionId, 100);
      if (seq !== messageReqSeq.current) return; // 过期响应，丢弃
      setMessages((data as { items?: WechatChatMessage[] }).items || (Array.isArray(data) ? data : []));
    } catch (err: unknown) {
      if (seq !== messageReqSeq.current) return;
      setError(toActionableError(err, "加载消息失败"));
    } finally {
      if (seq === messageReqSeq.current) setLoadingMessages(false);
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
      if (isCommercial403(err)) {
        setCommercialBlocked(true);
        setError(null);
      } else {
        setError(toActionableError(err, "同步失败，请稍后重试"));
      }
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

  /* 移动端原生视图：列表 → 消息详情两级导航 */
  if (isMobile) {
    /* 消息渲染（列表页与详情页共用） */
    const renderMessages = () => {
      if (!selectedSessionId) {
        return <p style={{ fontSize: 12.5, color: "var(--mx-muted)", textAlign: "center", padding: 24 }}>选一个会话查看消息</p>;
      }
      if (loadingMessages) {
        return (
          <div style={{ padding: "30px 0", textAlign: "center" }}>
            <SkeletonList rows={5} />
          </div>
        );
      }
      if (messages.length === 0) {
        return <p style={{ fontSize: 12.5, color: "var(--mx-muted)", textAlign: "center", padding: 24 }}>这个会话还没有消息记录</p>;
      }
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 12 }}>
          {messages.map((message) => {
            const isOutgoing = message.direction === "outgoing";
            const isSystem = message.direction === "system" || message.contentType === "system";
            if (isSystem) {
              return (
                <p key={message.id} style={{ textAlign: "center", fontSize: 10.5, color: "var(--mx-muted)" }}>{message.content}</p>
              );
            }
            return (
              <div key={message.id} style={{ display: "flex", justifyContent: isOutgoing ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    maxWidth: "78%",
                    borderRadius: 12,
                    padding: "8px 12px",
                    background: isOutgoing ? "var(--kaypal-v3-amber)" : "rgba(120,148,179,.12)",
                    color: isOutgoing ? "#fff" : "var(--mx-ink)",
                  }}
                >
                  {!isOutgoing && message.senderName && (
                    <p style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.7, marginBottom: 3 }}>{message.senderName}</p>
                  )}
                  <p style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {message.contentType === "image" ? "[图片]" : message.contentType === "file" ? `[文件] ${message.content}` : message.content}
                  </p>
                  {message.sentAt && (
                    <p style={{ fontSize: 9.5, marginTop: 3, opacity: 0.6 }}>
                      {new Date(message.sentAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    };

    /* 详情页 */
    if (mobileDetailOpen && selectedSession) {
      return (
        <div className="kx-mobile-ambient">
          <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
            <div className="mx-header">
              <button type="button" onClick={() => setMobileDetailOpen(false)} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, marginBottom: 6 }}>
                <ArrowLeft width={14} height={14} /> 返回会话列表
              </button>
              <div className="mx-page-title" style={{ fontSize: 16 }}>{selectedSession.contactName || selectedSession.title}</div>
            </div>
            <div className="mx-card" style={{ marginTop: 10, padding: 0, overflow: "hidden" }}>
              {renderMessages()}
            </div>
          </div>
        </div>
      );
    }

    /* 列表页 */
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">会话历史</div>
            <div className="mx-page-sub">微信聊天记录，随时回看</div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search width={15} height={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--mx-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索会话…"
                style={{ width: "100%", padding: "9px 11px 9px 32px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5 }}
              />
            </div>
            <button type="button" className="mx-btn-gold" style={{ flexShrink: 0, padding: "9px 13px" }} disabled={syncing || commercialBlocked} onClick={() => void handleSync()}>
              {syncing ? "同步中…" : "同步"}
            </button>
          </div>

          {notice && (
            <div className="mx-card" style={{ marginTop: 10, padding: 10, borderColor: "rgba(5,150,105,.4)" }}>
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-success)" }}>{notice}</p>
            </div>
          )}
          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 10, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}
          {commercialBlocked && (
            <div style={{ marginTop: 10 }}>
              <CommercialGateBanner />
            </div>
          )}

          {loading ? (
            <div style={{ padding: "36px 0", textAlign: "center" }}>
              <SkeletonList rows={5} />
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 12, padding: 26, textAlign: "center" }}>
              <MessageSquareText width={26} height={26} style={{ color: "var(--mx-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--mx-ink)", marginTop: 9 }}>
                {sessions.length === 0 ? "还没有会话" : "没有匹配的会话"}
              </p>
              {sessions.length === 0 && (
                <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 4 }}>点右上角「同步」拉取聊天记录</p>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
              {filteredSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}
                  onClick={() => { setSelectedSessionId(session.id); setMobileDetailOpen(true); }}
                >
                  <span style={{ width: 38, height: 38, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", overflow: "hidden", flexShrink: 0 }}>
                    <Avatar
                      src={session.avatarUrl}
                      name={session.contactName || session.title}
                      size={38}
                      alt={session.contactName || session.title || "会话"}
                      fallback={<UserRound width={17} height={17} style={{ color: "var(--kaypal-v3-amber)" }} />}
                    />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mx-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {session.contactName || session.title}
                      </span>
                      {session.unreadCount > 0 && (
                        <span style={{ flexShrink: 0, minWidth: 18, height: 18, borderRadius: "50%", background: "var(--kaypal-v3-danger)", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                          {session.unreadCount}
                        </span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {session.lastMessage || "暂无消息"}
                    </span>
                  </span>
                  <span style={{ color: "var(--mx-muted)", fontSize: 14, flexShrink: 0 }}>›</span>
                </button>
              ))}
            </div>
          )}

          <button type="button" onClick={() => router.push("/engagement/wechat")} style={{ marginTop: 18, padding: "9px 18px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ArrowLeft width={14} height={14} /> 返回
          </button>
        </div>
      </div>
    );
  }

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
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">会话历史</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              微信聊天记录，随时回看
            </p>
          </div>
          <V2PrimaryButton
            icon={RefreshCcw}
            loading={syncing}
            disabled={commercialBlocked}
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
      {commercialBlocked && <CommercialGateBanner />}

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
              <SkeletonList rows={5} />
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
                    <Avatar
                      src={session.avatarUrl}
                      name={session.contactName || session.title}
                      size={40}
                      alt={session.contactName || session.title || "会话"}
                      fallback={<UserRound className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />}
                    />
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
              <SkeletonList rows={5} />
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
                        <p className={`mt-1 text-11 ${isOutgoing ? "text-white/60" : "text-[var(--kaypal-v3-muted)]"}`}>
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
