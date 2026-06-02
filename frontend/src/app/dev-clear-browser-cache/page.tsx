"use client";

import React from "react";

const FALLBACK_TARGET = "/workbench/channel-comments";

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

export default function ClearBrowserCachePage() {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = getSafeTarget(params.get("target"));
    window.location.replace(target);
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background text-foreground">
      <div className="rounded-lg border border-divider bg-content1 px-5 py-4 text-sm text-default-600 shadow-sm">
        正在清理本地开发缓存...
      </div>
    </main>
  );
}
