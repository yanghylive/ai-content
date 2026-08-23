"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  strategyTemplateApi,
  type StrategyTemplate,
} from "@/lib/api/content-strategies";
import { articlesApi } from "@/lib/api/articles";
import { useRouter } from "next/navigation";

/** S2 开箱引导（2026-08-09）：3 步（选行业→看示例→生成第一条），可跳过
 * 完成状态存 localStorage：1=完成引导，2=跳过（埋点区分）
 * 完成率 = '1' 数 / 首登总数（'1'+'2'） */
const STORAGE_KEY = "kx_onboarding_done_v1";

function getOnboardingDone(): boolean {
  try {
    // '1'=完成 '2'=跳过——两者都视为「不需要再引导」（埋点仍可区分完成率）
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "1" || v === "2";
  } catch {
    return false;
  }
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function markOnboardingSkipped() {
  try {
    localStorage.setItem(STORAGE_KEY, "2");
  } catch {
    /* ignore */
  }
}

export function isOnboardingPending(): boolean {
  // APK WebView 用户（UA 含 JIUZHANG-Mobile）视为已完成引导：桌面端首次引导与 App 壳体验冲突
  if (typeof navigator !== "undefined" && /JIUZHANG-Mobile/.test(navigator.userAgent)) {
    return false;
  }
  return !getOnboardingDone();
}

export function OnboardingGuide() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [industries, setIndustries] = useState<string[]>([]);
  const [industry, setIndustry] = useState("");
  const [example, setExample] = useState<StrategyTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  // 首次挂载：检查是否已完成 → 显示引导
  useEffect(() => {
    if (isOnboardingPending()) {
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  // 加载行业清单
  useEffect(() => {
    if (!visible) return;
    void strategyTemplateApi
      .industries()
      .then((d) => {
        const list = (d.items || []).map((i) => i.industry);
        setIndustries(list);
      })
      .catch(() => {
        setIndustries(["美业", "餐饮", "教育", "微商", "直销", "健身"]);
      });
  }, [visible]);

  /** Step 1→2：选行业 → 存 persona + 加载示例标题 */
  const pickIndustry = useCallback(
    async (ind: string) => {
      setIndustry(ind);
      setBusy(true);
      try {
        // 写记忆层 persona
        await fetch("/api/memory/persona", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ industry: ind }),
        });
        // 加载该行业标题示例
        const d = await strategyTemplateApi.templates({
          industry: ind,
          type: "title",
          limit: 1,
        });
        setExample(d.items?.[0] ?? null);
      } catch {
        setExample(null);
      } finally {
        setBusy(false);
        setStep(2);
      }
    },
    [],
  );

  /** Step 2→3：看示例 → 下一步 */
  const nextToStep3 = useCallback(() => setStep(3), []);

  /** Step 3：完成 → 生成示例草稿 + 进入激活清单 */
  const finish = useCallback(async () => {
    setBusy(true);
    try {
      // 示例草稿入工作区（用行业示例标题/文案）
      const title = example?.title || `${industry}内容创作`;
      await articlesApi.createDraft({ title, content: example?.content || "" });
      markOnboardingDone();
      setStep(4);
    } catch {
      markOnboardingDone();
      setStep(4);
    } finally {
      setBusy(false);
    }
  }, [example, industry]);

  /** 激活清单（报告 16.3 第 1 项）：生成首稿后，引导完成「首个价值」闭环 */
  const activationSteps = [
    {
      label: "绑定平台账号",
      desc: "连接抖音/小红书/公众号，让内容能发出去",
      href: "/distribution",
    },
    {
      label: "导入品牌知识",
      desc: "上传品牌资料，AI 写得更像你",
      href: "/knowledge",
    },
    {
      label: "发布第一条内容",
      desc: "把刚生成的草稿发到平台，拿到回执",
      href: "/distribution",
    },
    {
      label: "收获首个线索",
      desc: "发布后评论/私信会沉淀成客户线索",
      href: "/growth/leads",
    },
  ];

  /** 跳过 */
  const skip = useCallback(() => {
    markOnboardingSkipped();
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(4,12,24,.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0d1b2f",
          borderRadius: 20,
          padding: "24px 20px",
          border: "1px solid rgba(142,165,190,.25)",
        }}
      >
        {/* 步骤指示 */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: s <= step ? "#f6c478" : "rgba(142,165,190,.2)",
              }}
            />
          ))}
        </div>

        {step === 1 ? (
          <>
            <div style={{ color: "#f6c478", fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              👋 欢迎使用 JIUZHANG AI
            </div>
            <div style={{ color: "rgba(215,230,248,.7)", fontSize: 13, marginBottom: 16, lineHeight: 1.7 }}>
              先告诉我你做什么行业，AI 会按这个行业帮你写文案、配图、找选题。
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {industries.map((ind) => (
                <button
                  key={ind}
                  type="button"
                  disabled={busy}
                  onClick={() => void pickIndustry(ind)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 12,
                    fontSize: 13,
                    border: "1px solid rgba(142,165,190,.3)",
                    background: "rgba(255,255,255,.06)",
                    color: "#dbe7f5",
                    cursor: busy ? "wait" : "pointer",
                  }}
                >
                  {ind}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={skip}
              style={{
                marginTop: 18,
                background: "transparent",
                border: "none",
                color: "rgba(148,163,184,.6)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              跳过，稍后再设置
            </button>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div style={{ color: "#f6c478", fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              ✨ 这就是 AI 帮你写的
            </div>
            <div style={{ color: "rgba(215,230,248,.7)", fontSize: 13, marginBottom: 14 }}>
              {industry}行业的标题，AI 10 秒就能生成一篇：
            </div>
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(142,165,190,.2)",
                fontSize: 14,
                fontWeight: 600,
                color: "#e8f1fc",
                lineHeight: 1.6,
                marginBottom: 18,
              }}
            >
              {example?.title || "「用 AI 写好内容，让生意自己找上门」"}
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              onClick={nextToStep3}
              style={{ width: "100%", padding: "12px 0", borderRadius: 12, fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer" }}
            >
              下一步，试试生成第一条 →
            </button>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div style={{ color: "#f6c478", fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              🎤 说一句话，开始干活
            </div>
            <div style={{ color: "rgba(215,230,248,.7)", fontSize: 13, marginBottom: 16, lineHeight: 1.8 }}>
              打开右下角金色 🎤 按钮，说一句：
              <br />
              <b style={{ color: "var(--kaypal-v3-amber)" }}>「帮我写一条{industry}文案」</b>
              <br />
              或直接进入创作工作区，AI 已为你准备好了示例草稿。
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              disabled={busy}
              onClick={() => void finish()}
              style={{ width: "100%", padding: "12px 0", borderRadius: 12, fontSize: 14, fontWeight: 700, border: "none", cursor: busy ? "wait" : "pointer" }}
            >
              {busy ? "准备中…" : "🚀 进入工作区"}
            </button>
            <button
              type="button"
              onClick={skip}
              style={{
                marginTop: 12,
                width: "100%",
                background: "transparent",
                border: "none",
                color: "rgba(148,163,184,.6)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              跳过
            </button>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div style={{ color: "#f6c478", fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              ✅ 示例草稿已生成
            </div>
            <div style={{ color: "rgba(215,230,248,.7)", fontSize: 13, marginBottom: 16, lineHeight: 1.7 }}>
              接下来 4 步，就能发出第一条内容、收获首个客户线索：
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activationSteps.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setVisible(false);
                    router.push(s.href);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(142,165,190,.25)",
                    background: "rgba(255,255,255,.05)",
                    color: "#dbe7f5",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "rgba(246,196,120,.15)",
                      color: "#f6c478",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>
                      {s.label}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: "rgba(148,163,184,.7)", marginTop: 2 }}>
                      {s.desc}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setVisible(false);
                router.push("/today");
              }}
              style={{
                marginTop: 16,
                width: "100%",
                padding: "12px 0",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: "#f6c478",
                color: "#1a1207",
              }}
            >
              先去今天页看看
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
