"use client";

import { useEffect, useState } from "react";
import { GrowthCenter } from "./growth-center";
import { GrowthPageShell } from "./growth-page-shell";

export default function GrowthPage() {
  const [view, setView] = useState<string | null>(null);

  useEffect(() => {
    setView(new URLSearchParams(window.location.search).get("view"));
  }, []);

  // 无 view 参数 → v2 增长控制台；带 view → 对应的旧版子页（过渡）
  if (view === null) {
    return <GrowthCenter />;
  }
  return <GrowthPageShell view={view as never} />;
}
