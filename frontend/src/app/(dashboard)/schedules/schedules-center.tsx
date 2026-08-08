"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { schedulesApi, type ScheduleConfig } from "@/lib/api/schedules";
import { toPublicError } from "@/lib/public-error";

const TASK_TYPE_LABELS: Record<string, string> = {
  "create-articles": "自动生成文章",
  "publish-articles": "自动发布文章",
  "sync-intelligence": "同步情报数据",
  "check-accounts": "检查账号状态",
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

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await schedulesApi.list();
      setSchedules(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载定时任务失败"));
    } finally {
      setLoading(false);
    }
  }, []);

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
    <ResourceCenter
      title="定时任务"
      subtitle="让系统按固定时间自动干活，你不用盯着"
      resourceName="任务"
      icon={CalendarClock}
      items={items}
      loading={loading}
      onItemClick={(item) => router.push(`/schedules/edit?taskType=${encodeURIComponent(item.id)}`)}
    />
  );
}
