"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  MessageSquareText,
  RefreshCcw,
  Search,
  Users,
} from "@/components/iconpark";

type ChatSession = {
  id: string;
  nickname: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount?: number;
};

type ChatMessage = {
  id: string;
  sender: "me" | "them";
  content: string;
  sentAt: string;
};

export function ChatHistoryPanel({
  sessions = [],
  messages = {},
  syncing = false,
  onSync,
  onCancel,
}: {
  sessions?: ChatSession[];
  messages?: Record<string, ChatMessage[]>;
  syncing?: boolean;
  onSync?: () => void;
  onCancel?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    sessions[0]?.id || "",
  );

  // 智能默认值：搜索过滤会话
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      [s.nickname, s.lastMessage].join(" ").toLowerCase().includes(q),
    );
  }, [sessions, searchQuery]);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const currentMessages = messages[selectedSessionId] || [];

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      {/* 顶部：标题 + 操作 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              会话历史
            </h2>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              共 {sessions.length} 个会话
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] h-11 px-4 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
            >
              <Download className="h-4 w-4" />
              导出
            </button>
            {/* 单一主行动 */}
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-6 text-base font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
              disabled={syncing}
              onClick={onSync}
            >
              <RefreshCcw
                className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing ? "正在同步..." : "同步历史"}
            </button>
          </div>
        </div>

        {/* 搜索 */}
        <div className="relative mt-4">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
          <input
            className="h-11 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] pl-11 pr-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
            placeholder="搜索联系人或消息内容"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </section>

      {/* 主体：左会话列表 + 右消息区 */}
      <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* 会话列表 */}
        <div className="kaypal-v3-panel overflow-hidden">
          {filteredSessions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-[var(--kaypal-v3-muted)]">
                {sessions.length === 0
                  ? "暂无会话，点击\"同步历史\"获取"
                  : `没有找到匹配 "${searchQuery}" 的会话`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--kaypal-v3-border)]">
              {filteredSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`flex w-full items-center gap-3 p-4 text-left transition ${
                    selectedSessionId === session.id
                      ? "bg-[var(--kaypal-v3-accent-soft)]"
                      : "hover:bg-[var(--kaypal-v3-paper-soft)]"
                  }`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-paper-muted)]">
                    <Users className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                        {session.nickname}
                      </p>
                      <span className="ml-2 shrink-0 text-xs text-[var(--kaypal-v3-muted)]">
                        {session.lastMessageAt}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-[var(--kaypal-v3-muted)]">
                      {session.lastMessage}
                    </p>
                  </div>
                  {session.unreadCount && session.unreadCount > 0 && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-danger)] text-xs font-semibold text-white">
                      {session.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 消息区 */}
        <div className="kaypal-v3-panel flex min-h-[400px] flex-col">
          {selectedSession ? (
            <>
              <div className="border-b border-[var(--kaypal-v3-border)] p-4">
                <p className="font-medium text-[var(--kaypal-v3-ink)]">
                  {selectedSession.nickname}
                </p>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {currentMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <MessageSquareText className="mx-auto h-8 w-8 text-[var(--kaypal-v3-muted)]" />
                      <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
                        暂无消息记录，点击"同步历史"获取
                      </p>
                    </div>
                  </div>
                ) : (
                  currentMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-[var(--kaypal-v3-radius)] px-4 py-2.5 ${
                          msg.sender === "me"
                            ? "bg-[var(--kaypal-v3-accent)] text-white"
                            : "bg-[var(--kaypal-v3-paper-muted)] text-[var(--kaypal-v3-ink)]"
                        }`}
                      >
                        <p className="text-sm">{msg.content}</p>
                        <p
                          className={`mt-1 text-xs ${
                            msg.sender === "me"
                              ? "text-white/70"
                              : "text-[var(--kaypal-v3-muted)]"
                          }`}
                        >
                          {msg.sentAt}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <MessageSquareText className="mx-auto h-8 w-8 text-[var(--kaypal-v3-muted)]" />
                <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
                  从左侧选择一个会话查看消息
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 返回 */}
      {onCancel && (
        <section>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] h-10 px-5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
            onClick={onCancel}
          >
            <ArrowLeft className="h-4 w-4" />
            返回任务中心
          </button>
        </section>
      )}
    </div>
  );
}
