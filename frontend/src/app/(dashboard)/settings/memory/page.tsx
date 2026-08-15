"use client";

import { BrandLogo } from "@/components/brand-logo";

import React, { useCallback, useEffect, useState } from "react";
import {
  listMemories,
  removeMemory,
  clearMemories,
  type UserMemoryItem,
} from "@/lib/api/ai-gateway";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { useConfirm } from "@/hooks/use-confirm";

const TYPE_LABEL: Record<string, string> = {
  persona: "画像偏好",
  episodic: "事件记忆",
  instruction: "行为指令",
};

const TYPE_COLOR: Record<string, string> = {
  persona: "#f4bb67",
  episodic: "#4ade80",
  instruction: "#60a5fa",
};

export default function MemorySettingsPage() {
  const { confirm, modal } = useConfirm();
  const [items, setItems] = useState<UserMemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listMemories();
      setItems(result.items);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeOne = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await removeMemory(id);
        setMsg("已删除该条记忆");
        await refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "删除失败");
      } finally {
        setBusy(false);
        window.setTimeout(() => setMsg(""), 2500);
      }
    },
    [refresh],
  );

  const clearAll = useCallback(async () => {
    const ok = await confirm({
      kind: "danger",
      title: "清除全部记忆",
      description: "此操作不可恢复，AI 将不再记得关于你的任何历史信息。",
      confirmText: "清除",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const count = await clearMemories();
      setMsg(`已清除 ${count} 条记忆`);
      setItems([]);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
      window.setTimeout(() => setMsg(""), 2500);
    }
  }, [confirm]);

  return (
    <div>
      <V2BackButton />
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <BrandLogo />
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">我的记忆</h1>
            <p className="mx-page-sub">AI 助手记住你的偏好与习惯，越用越懂你</p>
          </div>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
        <div className="mx-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "rgba(219,234,254,.75)" }}>
              共 {items.length} 条记忆
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => void refresh()}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  background: "rgba(255,255,255,.08)",
                  border: "1px solid rgba(142,165,190,.3)",
                  color: "#d7e6f8",
                  cursor: "pointer",
                }}
              >
                刷新
              </button>
              <button
                type="button"
                onClick={() => void clearAll()}
                disabled={busy || items.length === 0}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  background: "rgba(239,68,68,.12)",
                  border: "1px solid rgba(239,68,68,.4)",
                  color: "#f87171",
                  cursor: busy || items.length === 0 ? "not-allowed" : "pointer",
                  opacity: busy || items.length === 0 ? 0.5 : 1,
                }}
              >
                清除全部
              </button>
            </div>
          </div>

          {msg ? (
            <div style={{ marginBottom: 10, fontSize: 12, color: "#4ade80", textAlign: "center" }}>{msg}</div>
          ) : null}

          {loading ? (
            <div style={{ fontSize: 13, color: "rgba(219,234,254,.5)", padding: "20px 0", textAlign: "center" }}>
              加载中…
            </div>
          ) : items.length === 0 ? (
            <div style={{ fontSize: 13, color: "rgba(219,234,254,.5)", padding: "24px 0", textAlign: "center", lineHeight: 1.7 }}>
              还没有记忆。
              <br />
              多和 AI 助手聊聊（告诉我你的创作风格、常用平台、发内容的要求），
              <br />
              它会记住你的偏好，越用越懂你。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: 12,
                    borderRadius: 12,
                    background: "rgba(255,255,255,.04)",
                    border: "1px solid rgba(142,165,190,.2)",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      background: `${TYPE_COLOR[m.type] || "#888"}22`,
                      color: TYPE_COLOR[m.type] || "#888",
                      marginTop: 2,
                    }}
                  >
                    {TYPE_LABEL[m.type] || m.type}
                  </span>
                  <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.6, color: "#dbe7f5" }}>{m.content}</div>
                  <button
                    type="button"
                    onClick={() => void removeOne(m.id)}
                    disabled={busy}
                    style={{
                      flexShrink: 0,
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      background: "transparent",
                      border: "1px solid rgba(239,68,68,.35)",
                      color: "#f87171",
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 11, lineHeight: 1.7, color: "rgba(219,234,254,.5)" }}>
            💡 记忆只存你自己的偏好（画像/事件/指令），不会跨用户共享。删除后 AI 助手不再引用对应内容。
          </div>
        </div>
      </section>
      {modal}
    </div>
  );
}
