"use client";

import React, { useEffect, useState } from "react";

/** 距离今日 24:00 的倒计时（秒杀紧迫感） */
function computeRemaining(): string {
  const now = new Date();
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const diffMs = Math.max(0, end.getTime() - now.getTime());
  const total = Math.floor(diffMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function CountdownBadge() {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    setText(computeRemaining());
    const timer = setInterval(() => setText(computeRemaining()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-0.5 font-mono text-xs font-bold text-orange-500 dark:text-orange-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500 dark:bg-orange-400" />
      {text} 后重置
    </span>
  );
}
