"use client";

import { useRouter } from "next/navigation";

/**
 * 「功能建设中」提示页（2026-08-09 UX 审计 P2-2）。
 * 替代无条件 redirect("/content") 的静默弹回：用户访问占位路由时看到明确说明，
 * 而不是页面一闪跳走、以为出了 bug。
 */
export function UnderConstruction({ title }: { title?: string }) {
  const router = useRouter();
  return (
    <div
      style={{
        padding: "72px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        {title || "功能建设中"}
      </p>
      <p
        style={{
          fontSize: 13,
          margin: "10px 0 0",
          opacity: 0.6,
          lineHeight: 1.7,
          maxWidth: 320,
        }}
      >
        该功能正在建设中，暂未开放。可以先使用内容中心的现有功能。
      </p>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => router.push("/content")}
          style={{
            padding: "10px 22px",
            borderRadius: 999,
            fontSize: 13.5,
            background: "var(--kaypal-v3-accent, #2563eb)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          去内容中心
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "10px 22px",
            borderRadius: 999,
            fontSize: 13.5,
            background: "transparent",
            border: "1px solid rgba(128,128,128,.4)",
            cursor: "pointer",
          }}
        >
          返回上一页
        </button>
      </div>
    </div>
  );
}
