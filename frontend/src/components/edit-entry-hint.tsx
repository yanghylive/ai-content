"use client";

import { useRouter } from "next/navigation";

/**
 * 编辑/详情页无参数时的空态引导（替代白屏，2026-08-09 UX 审计 P2-1）。
 * 直接访问 /xxx/edit 等无 query 参数页面时，原实现 return null 导致内容区白屏，
 * 用户无任何提示。此组件渲染「请从列表选择」说明 + 返回入口。
 */
export function EditEntryHint({ label }: { label?: string }) {
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
        {label || "请从列表选择要编辑的项目"}
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
        这个页面需要先选择一个条目才能进入。请返回列表页，点击要编辑或查看的项目进入。
      </p>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => router.back()}
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
          返回上一页
        </button>
        <button
          type="button"
          onClick={() => router.push("/today")}
          style={{
            padding: "10px 22px",
            borderRadius: 999,
            fontSize: 13.5,
            background: "transparent",
            border: "1px solid rgba(128,128,128,.4)",
            cursor: "pointer",
          }}
        >
          回首页
        </button>
      </div>
    </div>
  );
}
