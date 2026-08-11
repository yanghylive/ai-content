"use client";

import React from "react";

const FALLBACK_TARGET = "/engagement/wechat-channel-comments";

function getSafeTarget(rawTarget: string | null) {
  if (!rawTarget) {
    return FALLBACK_TARGET;
  }

  try {
    const parsed = new URL(rawTarget, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return FALLBACK_TARGET;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return FALLBACK_TARGET;
  }
}

export function ClearBrowserCacheClient() {
  const [target, setTarget] = React.useState(FALLBACK_TARGET);
  const [status, setStatus] = React.useState("等待手动确认");

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTarget(getSafeTarget(params.get("target")));
  }, []);

  const clearAndContinue = async () => {
    setStatus("正在清理本地缓存...");
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
      if ("caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
      setStatus("清理完成，正在跳转...");
    } finally {
      window.location.assign(target);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-lg border border-divider bg-content1 px-5 py-4 text-sm text-default-600 shadow-sm">
        <h1 className="text-base font-semibold text-foreground">
          清理本地开发缓存
        </h1>
        <p className="mt-2 leading-6">
          这会清理当前浏览器的 localStorage、sessionStorage 和 Cache Storage。
        </p>
        <p className="mt-2 rounded-md bg-default-100 px-3 py-2 text-xs">
          完成后跳转：{target}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-default-500">{status}</span>
          <button
            type="button"
            className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background"
            onClick={() => void clearAndContinue()}
          >
            清理并继续
          </button>
        </div>
      </div>
    </main>
  );
}
