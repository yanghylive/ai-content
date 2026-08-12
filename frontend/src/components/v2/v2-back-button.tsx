"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** 统一返回按钮:默认 router.back(),可指定目标路由(2026-08-11 返回按钮缺口补齐) */
export function V2BackButton({
  label = "返回",
  to,
}: {
  label?: string;
  to?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (to ? router.push(to) : router.back())}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        marginBottom: 12,
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        border: "none",
        background: "transparent",
        color: "var(--kx-muted, rgba(215,230,248,.62))",
      }}
    >
      <ArrowLeft size={15} strokeWidth={2.2} />
      {label}
    </button>
  );
}
