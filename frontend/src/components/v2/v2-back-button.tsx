"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * 全站唯一返回按钮（B4 2026-08-23 升级：样式接 kx token，告别 inline style）。
 * 规格：页头左上、胶囊 ghost、13px/600、图标 16。
 * 所有页面禁止自写返回（ArrowLeft + router.back 拼装），一律用本组件。
 */
export function V2BackButton({
  label = "返回",
  to,
  onClick,
}: {
  label?: string;
  to?: string;
  onClick?: () => void;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (onClick) {
          onClick();
          return;
        }
        if (to) {
          router.push(to);
          return;
        }
        router.back();
      }}
      className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--kx-border)] bg-[var(--kx-card)] px-3 py-1.5 text-13 font-semibold text-[var(--kx-muted)] transition hover:border-[var(--kx-border-strong)] hover:text-[var(--kx-ink)]"
      aria-label={label}
    >
      <ArrowLeft size={15} strokeWidth={2.2} />
      {label}
    </button>
  );
}
