import { redirect } from "next/navigation";

/**
 * 双首页合并（2026-09-03 大王决策）：增长数据首页唯一化，统一入口为 /today。
 * /growth 控制台（GrowthCenter）及其旧版 ?view= 子页体系已并入今日增长首页，
 * 各增长子功能仍有独立路由（/growth/leads、/growth/acquisition …），本页仅兜底重定向。
 */
export default function GrowthPage() {
  redirect("/today");
}
