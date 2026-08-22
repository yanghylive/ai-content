"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** P4 Agent Browser 驾驶台（文档 §7.4）：会话生命周期 + Observe-Act-Verify 事件回放 */

type SessionStatus = "created" | "running" | "paused" | "stopped" | "error";

interface SessionDto {
  id: string;
  accountId: string;
  status: SessionStatus;
  url?: string;
  createdAt: string;
  updatedAt: string;
  stepCount: number;
  allowDomains?: string[];
  error?: string;
}

interface EventDto {
  type: "snapshot" | "step" | "done" | "error";
  stepIndex?: number;
  action?: string;
  ok?: boolean;
  message?: string;
  url?: string;
  extractText?: string;
  error?: string;
  at: string;
}

const B = "/api/local-engine/agent-browser";

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = (await res.json()) as { success?: boolean; data?: T; message?: string };
  if (!json.success) throw new Error(json.message || `请求失败（${res.status}）`);
  return json.data as T;
}

const STATUS_TONE: Record<SessionStatus, string> = {
  created: "#94a3b8",
  running: "#34d399",
  paused: "#fbbf24",
  stopped: "#64748b",
  error: "#f87171",
};

export default function AgentBrowserPage() {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [startUrl, setStartUrl] = useState("https://example.com");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eventsRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await jfetch<SessionDto[]>(`${B}/sessions`);
      setSessions(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    eventsRef.current?.scrollTo({ top: eventsRef.current.scrollHeight });
  }, [events]);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const s = await jfetch<SessionDto>(`${B}/sessions`, {
        method: "POST",
        body: JSON.stringify({ startUrl: startUrl.trim() || undefined }),
      });
      setActiveId(s.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: "run" | "pause" | "resume" | "stop") => {
    setBusy(true);
    setError("");
    try {
      await jfetch(`${B}/sessions/${id}/${action}`, {
        method: "POST",
        body:
          action === "run"
            ? JSON.stringify({ instruction: instruction.trim() || undefined })
            : JSON.stringify({}),
      });
      if (action === "run" || action === "stop" || action === "pause" || action === "resume") {
        setActiveId(id);
      }
      await refresh();
      if (action === "run") {
        const ev = await jfetch<EventDto[]>(`${B}/sessions/${id}/events`);
        setEvents(ev);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadEvents = async (id: string) => {
    setActiveId(id);
    try {
      const ev = await jfetch<EventDto[]>(`${B}/sessions/${id}/events`);
      setEvents(ev);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ padding: "18px 24px", maxWidth: 1080 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 800 }}>🤖 Agent Browser</span>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          通用网页自动化 · Observe-Act-Verify（灰度）
        </span>
        <button
          onClick={refresh}
          style={{
            marginLeft: "auto",
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid rgba(148,163,184,.4)",
            background: "transparent",
            color: "inherit",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          刷新
        </button>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 8, background: "rgba(248,113,113,.14)", color: "#f87171", fontSize: 12.5 }}>
          ❌ {error}
        </div>
      )}

      {/* 创建会话 */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "14px 16px",
          borderRadius: 12,
          border: "1px solid rgba(148,163,184,.25)",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: 12.5, color: "#94a3b8" }}>起始网址</label>
        <input
          value={startUrl}
          onChange={(e) => setStartUrl(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(148,163,184,.35)",
            background: "transparent",
            color: "inherit",
            fontSize: 13,
          }}
        />
        <button
          onClick={create}
          disabled={busy}
          style={{
            padding: "8px 18px",
            borderRadius: 8,
            border: "none",
            background: "linear-gradient(135deg,#8b5cf6,#7c3aed)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "处理中…" : "＋ 创建会话"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* 会话列表 */}
        <div
          style={{
            border: "1px solid rgba(148,163,184,.25)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(148,163,184,.2)", fontSize: 13, fontWeight: 700 }}>
            会话（{sessions.length}）
          </div>
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {sessions.length === 0 && (
              <div style={{ padding: 20, fontSize: 12.5, color: "#94a3b8", textAlign: "center" }}>
                还没有会话，先创建
              </div>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadEvents(s.id)}
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid rgba(148,163,184,.12)",
                  cursor: "pointer",
                  background: activeId === s.id ? "rgba(139,92,246,.1)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: STATUS_TONE[s.status],
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.id.slice(0, 8)}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{s.accountId}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11.5, color: STATUS_TONE[s.status] }}>
                    {s.status} · {s.stepCount} 步
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.url || "未导航"}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button onClick={(e) => { e.stopPropagation(); act(s.id, "run"); }} disabled={busy || s.status === "running"} style={btn}>▶ 运行</button>
                  <button onClick={(e) => { e.stopPropagation(); act(s.id, "pause"); }} disabled={busy || s.status !== "running"} style={btn}>⏸ 暂停</button>
                  <button onClick={(e) => { e.stopPropagation(); act(s.id, "resume"); }} disabled={busy || s.status !== "paused"} style={btn}>▶ 恢复</button>
                  <button onClick={(e) => { e.stopPropagation(); act(s.id, "stop"); }} disabled={busy || s.status === "stopped"} style={{ ...btn, color: "#f87171" }}>⏹ 停止</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 事件回放 */}
        <div
          style={{
            border: "1px solid rgba(148,163,184,.25)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(148,163,184,.2)", fontSize: 13, fontWeight: 700 }}>
            指令输入
          </div>
          <div style={{ padding: 12 }}>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={"输入任务指令，如：搜索「装修公司」并截图前 3 条结果"}
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(148,163,184,.35)",
                background: "transparent",
                color: "inherit",
                fontSize: 13,
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
              选中会话后点「运行」执行一轮 Observe-Act-Verify；指令通过 AI 解析为浏览器动作（navigate/click/fill）。
            </div>
          </div>
          <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(148,163,184,.2)", fontSize: 13, fontWeight: 700 }}>
            事件回放（{events.length}）
          </div>
          <div ref={eventsRef} style={{ maxHeight: 320, overflowY: "auto", padding: "4px 12px 12px" }}>
            {events.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
                运行会话后展示 Observe-Act-Verify 步骤
              </div>
            )}
            {events.map((ev, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(148,163,184,.08)" }}>
                <span style={{ color: "#64748b", flexShrink: 0, width: 16 }}>{i + 1}</span>
                <span style={{ color: ev.type === "step" ? "#8b5cf6" : ev.type === "done" ? "#34d399" : ev.type === "error" ? "#f87171" : "#94a3b8", flexShrink: 0 }}>
                  {ev.type === "snapshot" ? "👁" : ev.type === "step" ? "⚡" : ev.type === "done" ? "✅" : "❌"}
                </span>
                <div style={{ color: "inherit", flex: 1, wordBreak: "break-word" }}>
                  {ev.action ? `[${ev.action}] ${ev.message || "ok"}` : ev.message || ev.error || ev.type}
                  {ev.extractText && <span style={{ color: "#64748b" }}> · {ev.extractText.slice(0, 80)}</span>}
                  <span style={{ color: "#64748b", fontSize: 10.5, marginLeft: 6 }}>{new Date(ev.at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 6,
  border: "1px solid rgba(148,163,184,.3)",
  background: "transparent",
  color: "inherit",
  fontSize: 11.5,
  cursor: "pointer",
};
