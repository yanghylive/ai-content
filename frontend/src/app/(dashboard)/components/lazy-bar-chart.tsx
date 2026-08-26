"use client";

import dynamic from "next/dynamic";
import type { BarChartCardProps } from "./bar-chart-card";

/**
 * recharts 懒加载包装器：
 * 将 recharts（212KB）拆到独立 chunk，仅首页图表渲染时才加载。
 */
const BarChartCard = dynamic(
  () => import("./bar-chart-card").then((mod) => mod.BarChartCard),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] animate-pulse rounded-[8px] border border-divider bg-content1" />
    ),
  },
) as React.ComponentType<BarChartCardProps>;

export default function LazyBarChart(props: BarChartCardProps) {
  return <BarChartCard {...props} />;
}
