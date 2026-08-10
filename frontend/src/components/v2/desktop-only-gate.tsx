"use client";

import { useRouter } from "next/navigation";
import { Monitor, ArrowLeft, Info } from "lucide-react";
import { useIsMobile } from "@/lib/hooks/use-media-query";

/**
 * 电脑端专属功能拦截（2026-08-10 商用优化批次 2 P1-6）。
 * 复杂操作台（视频工作坊 / 抖音评论控制台 / 微信互动等）在手机上
 * 会挤压成不可用的桌面 UI——这里拦截并给出明确引导，而不是让用户
 * 对着半残界面干瞪眼。
 */
export function DesktopOnlyGate({
  title,
  desc,
  backHref = "/mobile-capabilities",
  children,
}: {
  title: string;
  desc?: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();

  if (!isMobile) return <>{children}</>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        textAlign: "center",
        background: "var(--mx-bg, #0b1524)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: 360,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(37,99,235,.12)",
            color: "#3b82f6",
            marginBottom: 18,
          }}
        >
          <Monitor size={28} />
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#f1f5f9" }}>
          {title}
        </h1>
        <p
          style={{
            fontSize: 13,
            margin: "10px 0 0",
            opacity: 0.72,
            lineHeight: 1.8,
            color: "#cbd5e1",
          }}
        >
          {desc ||
            "该功能需要电脑端操作（桌面浏览器或 macOS 桌面应用），手机端暂不支持。"}
        </p>

        <div
          style={{
            marginTop: 22,
            width: "100%",
            borderRadius: 12,
            padding: "12px 14px",
            background: "rgba(245,158,11,.1)",
            border: "1px solid rgba(245,158,11,.25)",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fbbf24",
            }}
          >
            <Info size={14} />
            手机端能做什么？
          </div>
          <p
            style={{
              fontSize: 12,
              margin: "6px 0 0",
              color: "#fde68a",
              opacity: 0.85,
              lineHeight: 1.7,
            }}
          >
            查看工作台、审批任务、轻编辑内容、素材采集（去水印 / AI
            生图 / 配音）都可以在手机上完成；复杂操作请回电脑端。
          </p>
        </div>

        <div style={{ marginTop: 22, display: "flex", gap: 10, width: "100%" }}>
          <button
            type="button"
            onClick={() => router.push("/mobile-capabilities")}
            style={{
              flex: 1,
              padding: "11px 16px",
              borderRadius: 12,
              fontSize: 13.5,
              fontWeight: 600,
              background: "rgba(148,163,184,.14)",
              color: "#e2e8f0",
              border: "1px solid rgba(148,163,184,.25)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            查看手机端能力
          </button>
          <button
            type="button"
            onClick={() => router.push(backHref)}
            style={{
              flex: 1,
              padding: "11px 16px",
              borderRadius: 12,
              fontSize: 13.5,
              fontWeight: 600,
              background: "#2563eb",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <ArrowLeft size={15} />
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
