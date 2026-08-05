"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";

interface EngineStatus {
  online: boolean;
  ok: boolean;
  url: string;
  error?: string;
  checkedAt: string;
}

/**
 * 视频引擎（studio_core 8600）——D3 对接起点页
 * 显示引擎在线状态；完整流水线接入（12 条）排期后在此展开
 */
export default function VideoWorkshopV2Page() {
  const router = useRouter();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const check = async () => {
    setLoading(true);
    try {
      const data = await api.get<EngineStatus>("/video-workshop/engine-status");
      setStatus(data);
    } catch {
      setStatus({
        online: false,
        ok: false,
        url: "",
        error: "状态接口不可用",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="kx-mobile-ambient" style={{ minHeight: "100dvh" }}>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" /></svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">视频引擎</h1>
            <p className="mx-page-sub">studio_core 一键成片 · 上云运行</p>
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px" }}
            onClick={() => void check()}
          >
            刷新
          </button>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        <div
          className="mx-hero"
          style={{
            borderRadius: 22,
            padding: 18,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: loading
                ? "rgba(148,163,184,.15)"
                : status?.online
                  ? "rgba(16,185,129,.14)"
                  : "rgba(239,68,68,.12)",
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: loading
                  ? "#94a3b8"
                  : status?.online
                    ? "#10b981"
                    : "#ef4444",
                animation: loading ? "pulse 1s infinite" : "none",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <p
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--kaypal-v3-ink)",
                margin: 0,
              }}
            >
              {loading
                ? "检查引擎状态…"
                : status?.online
                  ? "视频引擎在线"
                  : "视频引擎离线"}
            </p>
            <p
              style={{
                fontSize: 12,
                color: "var(--kaypal-v3-muted)",
                margin: "3px 0 0",
                lineHeight: 1.5,
              }}
            >
              {status?.online
                ? `studio_core 已上云运行（${status.url}）· 12 条流水线待接入`
                : status?.error || "引擎不可达，稍后重试"}
            </p>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            borderRadius: 18,
            padding: 16,
            background: "rgba(255,255,255,.6)",
            border: "1px solid rgba(148,163,184,.18)",
          }}
        >
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--kaypal-v3-ink)",
              margin: 0,
            }}
          >
            一键成片（规划中）
          </p>
          <p
            style={{
              fontSize: 12,
              color: "var(--kaypal-v3-muted)",
              margin: "6px 0 0",
              lineHeight: 1.6,
            }}
          >
            引擎已就绪：选题 → 文案 → 画面 → 配音 → 合成，12 条
            流水线全部在云端运行。完整接入排期后，这里会直接生成成片。
          </p>
          <button
            type="button"
            className="mx-btn-gold"
            style={{
              marginTop: 12,
              fontSize: 12,
              padding: "8px 14px",
              opacity: status?.online ? 1 : .5,
            }}
            disabled={!status?.online}
            onClick={() => router.push("/content")}
          >
            去创作内容
          </button>
        </div>
      </section>
    </div>
  );
}
