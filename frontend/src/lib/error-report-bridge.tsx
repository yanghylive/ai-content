"use client";

/**
 * 前端全局错误上报（v1.1.89+）：
 * 捕获 window.onerror / unhandledrejection，POST 到后端 /api/error-report/client，
 * 由后端转发 OSS error-reports/。静默失败，不影响业务。
 */
import { useEffect } from "react";

const ENABLED =
  typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1";

let bootstrapped = false;

function sendReport(input: {
  requestId?: string;
  url?: string;
  message?: string;
  stack?: string;
  status?: number;
  context?: string;
}) {
  if (!ENABLED) return;
  try {
    void fetch("/api/error-report/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* 静默 */
  }
}

function bootstrap() {
  if (bootstrapped || !ENABLED) return;
  bootstrapped = true;

  window.addEventListener("error", (event) => {
    sendReport({
      url: window.location.href,
      message: event.message,
      stack: event.error?.stack || undefined,
      status: 500,
      context: "window.onerror",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    sendReport({
      url: window.location.href,
      message:
        reason instanceof Error ? reason.message : String(reason).slice(0, 500),
      stack: reason instanceof Error ? reason.stack : undefined,
      status: 500,
      context: "unhandledrejection",
    });
  });
}

export function ErrorReportBridge() {
  useEffect(() => {
    bootstrap();
  }, []);
  return null;
}
