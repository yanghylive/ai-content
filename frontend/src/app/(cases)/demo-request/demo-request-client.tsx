"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "@/components/iconpark";
import { InquiryForm } from "../components/inquiry-form";

/**
 * 预约演示页客户端组件（S10 修复）：
 * - 从 URL query 读取 `case` 参数作为预约来源案例 slug，透传给 InquiryForm；
 * - 静态导出（output: export）下 useSearchParams 需要 Suspense 边界，
 *   这里直接用 window.location.search 解析，避免构建期约束。
 */
export function DemoRequestClient() {
  const [caseSlug, setCaseSlug] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const slug = params.get("case");
      setCaseSlug(slug && slug.trim() ? slug.trim() : undefined);
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <span
          className="kaypal-v3-icon-tile mb-4"
          style={{
            background: "var(--kaypal-v3-accent-soft)",
            color: "var(--kaypal-v3-accent-ink)",
            height: 48,
            width: 48,
          }}
        >
          <CalendarDays className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
          预约演示
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--kaypal-v3-muted)]">
          填写以下信息，我们会尽快与您联系安排一对一演示。
          {caseSlug ? `（来源案例：${caseSlug}）` : ""}
        </p>
      </header>

      <div className="kaypal-v3-panel p-6 sm:p-8">
        <InquiryForm sourceCaseSlug={caseSlug} />
      </div>
    </div>
  );
}
