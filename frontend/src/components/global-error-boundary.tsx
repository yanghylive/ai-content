"use client";

/**
 * 全局错误兜底（P2 体验项，2026-08-10）：
 * 监听 unhandledrejection + window.onerror，未捕获异常时：
 *  - toast 提示用户（避免静默失败）
 *  - console 归档（错误链路可查）
 * 不吞错误（保留原生 console.error），只做用户可见反馈。
 */
import React from "react";
import toast from "@/lib/toast";
import { toActionableError } from "@/lib/public-error";

const SEEN = new Set<string>();

function notify(message: string) {
  const key = message.slice(0, 80);
  if (SEEN.has(key)) return; // 同源错误只提示一次，防风暴
  SEEN.add(key);
  if (SEEN.size > 100) SEEN.clear();
  toast.error(`操作遇到一点问题：${message.slice(0, 40)}`);
}

export function GlobalErrorBoundary() {
  React.useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = toActionableError(e.reason, "操作遇到未知问题，请刷新后重试。");
      notify(msg);
    };
    const onError = (e: ErrorEvent) => {
      const msg = toActionableError(e.error ?? e.message, "页面遇到未知问题，请刷新后重试。");
      if (e.message || e.error) notify(msg);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
