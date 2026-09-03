"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "@/components/iconpark";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { schedulesApi, type ScheduleConfig } from "@/lib/api/schedules";
import { toPublicError } from "@/lib/public-error";

const TASK_TYPE_LABELS: Record<string, string> = {
  collect_materials: "自动采集素材",
  mine_materials: "自动挖掘素材",
  create_articles: "自动生成文章",
};

function taskTypeLabel(taskType: string) {
  return TASK_TYPE_LABELS[taskType] || taskType;
}

function cronToText(cronExpr: string) {
  // 常见 cron 的人性化描述
  if (cronExpr === "0 9 * * *") return "每天 09:00";
  if (cronExpr === "0 18 * * *") return "每天 18:00";
  if (cronExpr.startsWith("0 */")) {
    const hours = cronExpr.split(" ")[1]?.replace("*/", "");
    return `每 ${hours} 小时`;
  }
  if (cronExpr.startsWith("*/")) {
    const minutes = cronExpr.split(" ")[0]?.replace("*/", "");
    return `每 ${minutes} 分钟`;
  }
  return cronExpr;
}

export function SchedulesCenter() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<ScheduleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await schedulesApi.list();
      setSchedules(data);
      clearLoadError();
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载定时任务失败"));
      reportLoadError(error, "定时任务列表暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  const items: ResourceItem[] = schedules.map((s) => ({
    id: s.taskType,
    title: taskTypeLabel(s.taskType),
    description: s.lastRunTime
      ? `上次执行：${new Date(s.lastRunTime).toLocaleString("zh-CN")}`
      : "还未执行过",
    badges: [cronToText(s.cronExpr)],
    enabled: s.enabled,
  }));

  return (
    <div className="flex flex-col gap-3">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchSchedules()} />
      ) : null}
      <ResourceCenter
        title="定时任务"
        subtitle="让系统按固定时间自动干活，你不用盯着"
        resourceName="任务"
        icon={CalendarClock}
        items={items}
        loading={loading}
        onItemClick={(item) => router.push(`/schedules/edit?taskType=${encodeURIComponent(item.id)}`)}
      />
    </div>
  );
}
