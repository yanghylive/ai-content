"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { growthApi } from "@/lib/api/growth";

interface AccountHealth {  accountId: string;
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

/** 账号体检 30 天报告（F7） */
interface HealthReport {
  accounts: Array<{
    accountId: string;
    accountName: string;
    platform: string;
    snapshotCount: number;
    from: string;
    to: string;
    latestRisk: string;
    initialRisk: string;
    riskStable: boolean;
    latestFailureRate: number;
    initialFailureRate: number;
    trend: Array<{ checkedAt: string; failureRate: number; riskStatus: string }>;
    recommendation: string;
  }>;
}

const GRADE_STYLE: Record<string, { color: string; bg: string }> = {
  A: { color: "#10b981", bg: "rgba(16,185,129,.12)" },
  B: { color: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  C: { color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  D: { color: "#ef4444", bg: "rgba(239,68,68,.12)" },
};

/** F4 评分维度：基于诊断数据的前端规则打分（0-100，与后端 score 独立的多维视角） */
function computeDimensions(h: AccountHealth) {
  const followersScore =
    h.followers >= 500000
      ? 95
      : h.followers >= 100000
        ? 85
        : h.followers >= 20000
          ? 70
          : h.followers >= 5000
            ? 55
            : h.followers >= 1000
              ? 40
              : 20;
  const worksScore =
    h.works30d > 20
      ? 95
      : h.works30d >= 11
        ? 85
        : h.works30d >= 6
          ? 70
          : h.works30d >= 3
            ? 55
            : h.works30d >= 1
              ? 35
              : 10;
  const avgLikes = h.works > 0 ? h.totalFavorited / h.works : 0;
  const engageScore =
    avgLikes >= 2000 ? 95 : avgLikes >= 500 ? 80 : avgLikes >= 100 ? 60 : avgLikes >= 10 ? 40 : h.works === 0 ? 15 : 20;
  const gradeScore = { A: 95, B: 75, C: 55, D: 25 }[h.grade] ?? 50;
  return [
    { label: "粉丝规模", score: followersScore },
    { label: "内容活跃（近30天）", score: worksScore },
    { label: "互动表现（平均赞）", score: engageScore },
    { label: "账号健康等级", score: gradeScore },
  ];
}

type RiskItem = { level: "高" | "中" | "低"; text: string };

/** F4 投放风险评估：规则化生成风险点（无 AI 依赖，透明可解释） */
function computeRisks(h: AccountHealth): {
  level: "高" | "中" | "低" | "无";
  items: RiskItem[];
} {
  const items: RiskItem[] = [];
  const avgLikes = h.works > 0 ? h.totalFavorited / h.works : 0;
  if (h.works30d < 2) {
    items.push({
      level: "高",
      text: `近 30 天仅更新 ${h.works30d} 条，投放后内容承接力弱，建议先激活账号再投放`,
    });
  }
  if (h.works > 0 && avgLikes < 50) {
    items.push({
      level: "高",
      text: `平均赞约 ${Math.round(avgLikes)}，互动偏低，内容多为泛流量，转化预期打折`,
    });
  }
  if (h.followers >= 100000 && avgLikes < 200) {
    items.push({
      level: "中",
      text: "粉丝体量与互动表现不匹配，存在水分粉丝风险，建议抽样核查粉丝画像",
    });
  }
  if (h.followers < 5000) {
    items.push({
      level: "中",
      text: "粉丝基数较小（<5k），适合种草试水，不适合放量投放",
    });
  }
  if (!h.signature?.trim()) {
    items.push({
      level: "低",
      text: "主页无简介，商业合作触达与信任感不足",
    });
  }
  const level = items.some((i) => i.level === "高")
    ? "高"
    : items.some((i) => i.level === "中")
      ? "中"
      : items.length
        ? "低"
        : "无";
  return { level, items };
}

const RISK_LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  高: { color: "#dc2626", bg: "rgba(239,68,68,.1)" },
  中: { color: "#d97706", bg: "rgba(245,158,11,.12)" },
  低: { color: "#2563eb", bg: "rgba(59,130,246,.1)" },
  无: { color: "#059669", bg: "rgba(16,185,129,.1)" },
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
  const [report, setReport] = useState<HealthReport | null>(null);
  const [leadHint, setLeadHint] = useState<string | null>(null);

  /** 达人 → 增长线索（F4：复用 F3 已验证的 lead→CRM 链路） */
  const toLead = async (input: {
    nickname: string;
    platform: string;
    profileUrl?: string | null;
    score?: number;
    accountId: string;
  }) => {
    try {
      await growthApi.createLead({
        nickname: input.nickname,
        platform: (input.platform || "douyin") as never,
        sourceType: "redfox_account",
        sourceText: "竞品/达人账号诊断订阅转线索",
        sourceUrl: input.profileUrl || undefined,
        profileUrl: input.profileUrl || undefined,
        score: input.score ?? 60,
        scoreReasons: ["账号体检诊断"],
        matchedKeywords: [],
        status: "new",
      });
      setLeadHint(`「${input.nickname}」已转为增长线索，可在增长线索库跟进`);
    } catch (e) {
      setLeadHint(`转线索失败：${e instanceof Error ? e.message : "请稍后重试"}`);
    }
  };

  const loadSubs = async () => {
    try {
      const data = await api.get<Subscription[]>("/redfox/account/subscriptions");
      setSubs(data);
    } catch {
      /* 列表失败静默 */
    }
  };

  const loadReport = async () => {
    try {
      const data = await api.get<HealthReport>("/redfox/account/health-report");
      setReport(data);
    } catch {
      /* 报告失败静默（可能是老数据无快照） */
    }
  };

  useEffect(() => {
    void loadSubs();
    void loadReport();
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
          {leadHint && (
            <p
              style={{
                fontSize: 12,
                margin: "10px 0 0",
                color: leadHint.startsWith("「") && leadHint.includes("已转为") ? "#047857" : "#dc2626",
              }}
            >
              {leadHint}
            </p>
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

            {/* F4 评分维度：多维度透视 */}
            <p style={{ fontSize: 12, fontWeight: 700, color: "#1f2a44", margin: "14px 0 8" }}>
              评分维度
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {computeDimensions(health).map((d) => (
                <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 118, fontSize: 11, color: "#6b7a93", flexShrink: 0 }}>
                    {d.label}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: "rgba(148,163,184,.15)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${d.score}%`,
                        height: "100%",
                        borderRadius: 3,
                        background:
                          d.score >= 80 ? "#10b981" : d.score >= 55 ? "#f59e0b" : "#ef4444",
                      }}
                    />
                  </div>
                  <span style={{ width: 32, fontSize: 11, fontWeight: 700, color: "#1f2a44", textAlign: "right" }}>
                    {d.score}
                  </span>
                </div>
              ))}
            </div>

            {/* F4 投放风险评估 */}
            {(() => {
              const risk = computeRisks(health);
              const rs = RISK_LEVEL_STYLE[risk.level];
              return (
                <>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#1f2a44", margin: "14px 0 8" }}>
                    投放风险评估{" "}
                    <span
                      style={{
                        display: "inline-block",
                        marginLeft: 6,
                        padding: "2px 8px",
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        color: rs.color,
                        background: rs.bg,
                      }}
                    >
                      {risk.level}风险
                    </span>
                  </p>
                  {risk.items.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#059669", margin: 0 }}>
                      未发现明显投放风险点，可正常评估合作
                    </p>
                  ) : (
                    risk.items.map((item, i) => (
                      <p key={i} style={{ fontSize: 12, color: "#374151", margin: "3px 0" }}>
                        <span style={{ color: RISK_LEVEL_STYLE[item.level].color, fontWeight: 700 }}>
                          [{item.level}]
                        </span>{" "}
                        {item.text}
                      </p>
                    ))
                  )}
                </>
              );
            })()}
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
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() =>
                    void toLead({
                      nickname: s.accountName || s.accountId,
                      platform: s.platform,
                      profileUrl: s.accountUrl,
                      accountId: s.accountId,
                    })
                  }
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(16,185,129,.25)",
                    background: "rgba(16,185,129,.05)",
                    color: "#047857",
                    fontSize: 12,
                  }}
                >
                  转线索
                </button>
                <button
                  type="button"
                  onClick={() => void unsubscribe(s.id)}
                  style={{
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
            </div>
          ))}
        </div>

        {/* 账号体检 30 天报告 */}
        {report && report.accounts.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#1f2a44", margin: "0 0 8" }}>
              体检 30 天报告（{report.accounts.length} 个账号）
            </p>
            {report.accounts.map((a) => {
              const riskLabel = a.latestRisk === "high" ? "高风险" : a.latestRisk === "medium" ? "中风险" : a.latestRisk === "low" ? "低风险" : a.latestRisk === "normal" ? "正常" : a.latestRisk;
              const riskColor = a.latestRisk === "high" ? "#dc2626" : a.latestRisk === "medium" ? "#f59e0b" : "#10b981";
              const delta = ((a.latestFailureRate - a.initialFailureRate) * 100).toFixed(0);
              return (
                <div
                  key={a.accountId}
                  style={{
                    padding: "12px",
                    marginBottom: 10,
                    borderRadius: 14,
                    background: "rgba(255,255,255,.6)",
                    border: "1px solid rgba(148,163,184,.15)",
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6" }}>
                    {a.accountName} · {a.platform}
                    <span
                      style={{
                        float: "right",
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 999,
                        color: riskColor,
                        background: `${riskColor}1a`,
                      }}
                    >
                      {riskLabel}
                    </span>
                  </p>
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 6" }}>
                    {a.snapshotCount} 次体检快照 · {a.from.slice(5, 10)} 至 {a.to.slice(5, 10)}
                    {a.riskStable ? " · 风险状态稳定" : " · 风险状态有变化"}
                    {a.latestFailureRate > 0 && (
                      <span> · 失败率 {delta}%{a.latestFailureRate >= a.initialFailureRate ? " ↑" : " ↓"}</span>
                    )}
                  </p>
                  <p style={{ fontSize: 12, color: "#334155", margin: "6px 0 0", lineHeight: 1.6 }}>
                    📋 {a.recommendation}
                  </p>
                </div>
              );
            })}
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>
              每日 09:15 自动体检并记录快照，30 天趋势反映账号健康变化
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
