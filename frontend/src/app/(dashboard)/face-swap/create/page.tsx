"use client";

import { redirect } from "next/navigation";

/* 子页统一归到主路线图页（2026-08-10 商用审查批次 A） */
export default function Page() {
  redirect("/face-swap");
}
