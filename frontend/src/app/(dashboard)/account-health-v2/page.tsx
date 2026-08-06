"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

interface AccountHealth {
  accountId: string;
  name: string;
  avatarUrl?: string;
  signature?: string;
  followers: number;
  works: number;
  works30d: number;
  totalFavorited: number;
  grade: "A" | "B" | "C" | "D";
  score: number;
  suggestions: string[];
}

interface Subscription {
  id: string;
  accountId: string;
  accountName: string | null;
  accountUrl: string | null;
  platform: string;
  active: boolean;
  lastFetchedAt: string | null;
  createdAt: string;
}

const GRADE_STYLE: Record<string, { color: string; bg: string }> = {
  A: { color: "#10b981", bg: "rgba(16,185,129,.12)" },
  B: { color: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  C: { color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  D: { color: "#ef4444", bg: "rgba(239,68,68,.12)" },
};

/**
 * 账号健康 + 竞品订阅（A6/M5，主文档 P2）
 * 诊断：RedFox queryUser → 健康打分（A-D + 建议）；订阅：持久化 + cron 每日抓取
 */
export default function AccountHealthPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);

  const loadSubs = async () => {
    try {
      const data = await api.get<Subscription[]>("/redfox/account/subscriptions");
      setSubs(data);
    } catch {
      /* 列表失败静默 */
    }
  };

  useEffect(() => {
    void loadSubs();
  }, []);

  const diagnose = async (accountUrl?: string, accountId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<AccountHealth>("/redfox/account/diagnose", {
        accountUrl: accountUrl || (input.trim() ? input.trim() : undefined),
        accountId,
      });
      setHealth(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "诊断失败，检查链接或稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const subscribe = async () => {
    if (!input.trim()) {
      setError("先粘贴一个抖音账号链接");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post<{ id: string }>("/redfox/account/subscribe", {
        accountUrl: input.trim(),
      });
      setInput("");
      setHealth(null);
      await loadSubs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "订阅失败");
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async (id: string) => {
    try {
      await api.delete(`/redfox/account/subscriptions/${id}`);
      await loadSubs();
    } catch {
      setError("取消失败");
    }
  };

  const gs = health ? GRADE_STYLE[health.grade] : null;

  return (
    <div className="kx-mobile-ambient" style={{ minHeight: "100dvh", paddingBottom: 90 }}>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">账号健康</h1>
            <p className="mx-page-sub">诊断竞品账号 · 订阅追踪变化</p>
          </div>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        {/* 诊断输入 */}
        <div
          style={{
            borderRadius: 20,
            padding: 16,
            background: "rgba(255,255,255,.72)",
            border: "1px solid rgba(148,163,184,.18)",
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "#1f2a44" }}>
            诊断一个账号
          </p>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴抖音账号链接，如 https://v.douyin.com/xxx/"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,.35)",
              background: "#fff",
              fontSize: 14,
              color: "#1f2a44",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="mx-btn-gold"
              disabled={loading}
              onClick={() => void diagnose()}
              style={{ flex: 1, fontSize: 13, padding: "10px", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "诊断中…" : "开始诊断"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void subscribe()}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: 12,
                border: "1px solid rgba(16,185,129,.4)",
                background: "rgba(16,185,129,.08)",
                color: "#047857",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              诊断并订阅
            </button>
          </div>
          {error && (
            <p style={{ fontSize: 12, color: "#dc2626", margin: "10px 0 0" }}>{error}</p>
          )}
        </div>

        {/* 诊断结果 */}
        {health && gs && (
          <div
            style={{
              borderRadius: 20,
              padding: 16,
              marginTop: 12,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#1f2a44" }}>
                  {health.name}
                </p>
                <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>
                  粉丝 {health.followers.toLocaleString()} · 作品 {health.works} · 近30天 {health.works30d}
                </p>
              </div>
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 800,
                  color: gs.color,
                  background: gs.bg,
                  flexShrink: 0,
                }}
              >
                {health.grade}
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                margin: "12px 0",
                background: "rgba(148,163,184,.15)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${health.score}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: gs.color,
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: "#6b7a93", margin: "0 0 6" }}>
              健康分 {health.score}/100 · 建议：
            </p>
            {(health.suggestions || []).map((s, i) => (
              <p key={i} style={{ fontSize: 12, color: "#374151", margin: "3px 0" }}>
                · {s}
              </p>
            ))}
          </div>
        )}

        {/* 订阅列表 */}
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#1f2a44", margin: "0 0 8" }}>
            竞品订阅（{subs.length}）
          </p>
          {subs.length === 0 && (
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "8px 0" }}>
              还没有订阅——粘贴竞品账号链接，每天自动追踪粉丝/作品变化
            </p>
          )}
          {subs.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "11px 12px",
                marginBottom: 8,
                borderRadius: 14,
                background: "rgba(255,255,255,.6)",
                border: "1px solid rgba(148,163,184,.15)",
              }}
            >
              <div style={{ overflow: "hidden" }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.accountName || s.accountId}
                </p>
                <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>
                  {s.platform} · 每日 09:15 自动追踪
                </p>
              </div>
              <button
                type="button"
                onClick={() => void unsubscribe(s.id)}
                style={{
                  flexShrink: 0,
                  marginLeft: 8,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(239,68,68,.25)",
                  background: "rgba(239,68,68,.05)",
                  color: "#dc2626",
                  fontSize: 12,
                }}
              >
                取消
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
