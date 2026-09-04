"use client";

import { MapPin, Clock, ShieldAlert } from "@/components/iconpark";
import { V2BackButton } from "@/components/v2/v2-back-button";

/**
 * 能力路线图说明页（2026-08-10 商用优化批次 2 P1-7）。
 * 微信生态的群发/朋友圈等高频商用需求，当前依赖微信桌面客户端 RPA
 * 能力（C2 依赖），尚未落地——与其展示 UnderConstruction 空壳，
 * 不如给用户讲清楚：为什么没有、什么时候有、现在能先做什么。
 */
export function FeatureRoadmap({
  title,
  desc,
  status,
  eta,
  blocker,
  workaround,
  backHref = "/engagement/wechat",
}: {
  title: string;
  desc: string;
  status: string;
  /** 预计时间线，如"随桌面端 RPA 能力（C2）落地后开放" */
  eta: string;
  /** 为什么暂未开放 */
  blocker: string;
  /** 现在可以先怎么做 */
  workaround: string;
  backHref?: string;
}) {

  const rows: Array<{ icon: typeof MapPin; label: string; value: string }> = [
    { icon: MapPin, label: "当前状态", value: status },
    { icon: Clock, label: "预计时间", value: eta },
    { icon: ShieldAlert, label: "为什么暂无", value: blocker },
  ];

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--kaypal-v3-canvas, #0b1524)",
        padding: "28px 20px 40px",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            color: "var(--kaypal-v3-muted)",
          }}
        >
          <V2BackButton to={backHref} label="返回" inline />
        </div>

        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(148,163,184,.2)",
            background: "rgba(255,255,255,.04)",
            padding: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 999,
                background: "rgba(245,158,11,.15)",
                color: "#fbbf24",
                letterSpacing: 0.5,
              }}
            >
              能力路线图
            </span>
          </div>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: "var(--kaypal-v3-paper-muted)" }}>
            {title}
          </h1>
          <p
            style={{
              fontSize: 13,
              margin: "8px 0 0",
              color: "var(--kaypal-v3-muted)",
              lineHeight: 1.8,
            }}
          >
            {desc}
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 20,
            }}
          >
            {rows.map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "11px 12px",
                  borderRadius: 10,
                  background: "rgba(148,163,184,.07)",
                }}
              >
                <row.icon
                  size={16}
                  style={{ color: "var(--kaypal-v3-cobalt)", flexShrink: 0, marginTop: 2 }}
                />
                <div>
                  <div
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--kaypal-v3-muted)" }}
                  >
                    {row.label}
                  </div>
                  <div
                    style={{ fontSize: 13, color: "#cbd5e1", marginTop: 2 }}
                  >
                    {row.value}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              borderRadius: 10,
              padding: "12px 14px",
              background: "rgba(16,185,129,.08)",
              border: "1px solid rgba(16,185,129,.2)",
            }}
          >
            <div
              style={{ fontSize: 12, fontWeight: 600, color: "#34d399" }}
            >
              现在可以先做
            </div>
            <p
              style={{
                fontSize: 12.5,
                margin: "5px 0 0",
                color: "#a7f3d0",
                lineHeight: 1.7,
              }}
            >
              {workaround}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
