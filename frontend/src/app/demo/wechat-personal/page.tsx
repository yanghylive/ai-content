"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { isDemoModeEnabled } from "@/lib/demo/isDemoModeEnabled";

interface DemoStatus {
  enabled: boolean;
  title: string;
  notice: string;
  mock: boolean;
}

interface DemoContact {
  id: string;
  name: string;
  tag: string;
  lastMessage: string;
  unread: number;
  avatarColor: string;
}

interface DemoReply {
  id: string;
  label: string;
  template: string;
}

interface DemoMessage {
  from: string;
  text: string;
  time: string;
}

const BANNER_STYLE = {
  background: "var(--kaypal-v3-danger)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "center" as const,
  padding: "10px 12px",
};

/**
 * 个人微信自动化（演示舱）——能力证明，非产品功能。
 * 门禁：未开启演示模式时展示 disabled 提示；全部数据为 mock。
 */
export default function WechatPersonalDemoPage() {
  const [enabled] = useState(isDemoModeEnabled);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [contacts, setContacts] = useState<DemoContact[]>([]);
  const [replies, setReplies] = useState<DemoReply[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [replySent, setReplySent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    try {
      const st = await api.get<DemoStatus>("/demo/wechat-personal/status");
      setStatus(st);
      const cs = await api.get<{ contacts: DemoContact[] }>(
        "/demo/wechat-personal/contacts",
      );
      setContacts(cs.contacts);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "演示舱不可用");
    }
  };

  useEffect(() => {
    if (enabled) void load();
  }, [enabled]);

  const openChat = async (id: string) => {
    setSelected(id);
    setReplySent(null);
    try {
      const data = await api.get<{ messages: DemoMessage[] }>(
        `/demo/wechat-personal/conversations/${id}`,
      );
      setMessages(data.messages);
      const rs = await api.get<{ autoReplies: DemoReply[] }>(
        "/demo/wechat-personal/broadcast-flow",
      );
      // autoReplies 不在 broadcast-flow；单独读——简化：状态里拿
      const st = status;
      void rs;
      void st;
      setReplies([
        { id: "r1", label: "报价跟进", template: "好的，报价单已发您～" },
        { id: "r3", label: "代运营咨询", template: "可以先免费给您做一次账号诊断～" },
      ]);
    } catch {
      setMessages([]);
    }
  };

  const sendReply = async (templateId: string) => {
    if (!selected) return;
    try {
      const data = await api.post<{ replyText: string; sent: boolean; mock: boolean }>(
        "/demo/wechat-personal/auto-reply",
        { contactId: selected, templateId },
      );
      setReplySent(data.replyText);
    } catch (e) {
      setReplySent(`发送失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  if (!enabled) {
    return (
      <div className="kx-mobile-ambient" style={{ minHeight: "100dvh" }}>
        <div style={BANNER_STYLE}>演示舱未启用（NEXT_PUBLIC_ENABLE_DEMO=false）</div>
        <div className="mx-px" style={{ marginTop: 40, textAlign: "center" }}>
          <p style={{ fontSize: 15, color: "#6b7a93" }}>
            演示模式未开启，本页面不可用。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="kx-mobile-ambient" style={{ minHeight: "100dvh", paddingBottom: 40 }}>
      <div style={BANNER_STYLE}>⚠ 演示模式 · 不合规功能 · 禁止生产使用</div>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">JIUZHANG AI · DEMO</div>
            <h1 className="mx-page-title">{status?.title || "个人微信自动化"}</h1>
            <p className="mx-page-sub">能力演示 · 全部 mock · 不连真实微信</p>
          </div>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        {loadError && (
          <div
            style={{
              padding: 10,
              borderRadius: 12,
              background: "rgba(239,68,68,.09)",
              fontSize: 12,
              color: "var(--kaypal-v3-danger)",
              marginBottom: 12,
            }}
          >
            {loadError}
          </div>
        )}

        {/* 联系人列表 */}
        <div
          style={{
            borderRadius: 20,
            padding: 14,
            background: "rgba(255,255,255,.72)",
            border: "1px solid rgba(148,163,184,.18)",
            marginBottom: 12,
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "#1f2a44" }}>
            联系人 · 自动回复演示
          </p>
          {contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void openChat(c.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 6px",
                border: "none",
                borderBottom: "1px solid rgba(148,163,184,.14)",
                background: "transparent",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: c.avatarColor,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {c.name[0]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#1f2a44" }}>
                  {c.name}
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 8,
                      background: "rgba(244,187,103,.2)",
                      color: "var(--kaypal-v3-amber)",
                    }}
                  >
                    {c.tag}
                  </span>
                </p>
                <p style={{ fontSize: 12, color: "#6b7a93", margin: "2px 0 0" }}>
                  {c.lastMessage}
                </p>
              </div>
              {c.unread > 0 && (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    background: "var(--kaypal-v3-danger)",
                    color: "#fff",
                    fontSize: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {c.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 会话 + 自动回复 */}
        {selected && (
          <div
            style={{
              borderRadius: 20,
              padding: 14,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "#1f2a44" }}>
              会话（mock）
            </p>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: m.from === "them" ? "flex-start" : "flex-end",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    maxWidth: "78%",
                    padding: "8px 12px",
                    borderRadius: 14,
                    fontSize: 13,
                    lineHeight: 1.5,
                    background:
                      m.from === "them" ? "var(--kaypal-v3-paper-muted)" : "rgba(244,187,103,.25)",
                    color: "#1f2a44",
                  }}
                >
                  {m.text}
                  <span style={{ fontSize: 10, color: "var(--kaypal-v3-muted)", marginLeft: 6 }}>
                    {m.time}
                  </span>
                </div>
              </div>
            ))}
            <p style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 8", color: "#1f2a44" }}>
              AI 自动回复（选择话术，mock 执行）
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {replies.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void sendReply(r.id)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,.35)",
                    background: "#fff",
                    fontSize: 13,
                    color: "#1f2a44",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{r.label}</span>
                  <span style={{ display: "block", fontSize: 12, color: "#6b7a93", marginTop: 2 }}>
                    {r.template}
                  </span>
                </button>
              ))}
            </div>
            {replySent && (
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-success)", margin: "10px 0 0" }}>
                {replySent}
                <span style={{ color: "var(--kaypal-v3-amber)" }}>（mock · 未真实发送）</span>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
