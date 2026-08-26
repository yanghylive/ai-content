"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  FileText,
  MessageSquareText,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { WorkbenchCenter, type WorkbenchStat } from "@/components/v2/workbench-center";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";

interface CustomerRow {
  id: string;
  displayName: string;
  sourcePlatform?: string | null;
  updatedAt?: string;
}

interface TimelineEvent {
  id: string;
  type?: string;
  createdAt?: string;
}

/** 客户详情聚合页：默认展示最近有互动的真实客户（不再用写死的示例数字） */
export function CustomerDetailCenter() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [interactionCount, setInteractionCount] = useState<number | null>(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPartialErrors([]);
    try {
      // 最近更新的客户作为展示主体
      const list = (await api.get("/crm/customers?limit=1")) as
        | { items?: CustomerRow[] }
        | CustomerRow[];
      const items = Array.isArray(list) ? list : list?.items || [];
      const first = items[0];
      if (!first) {
        setCustomer(null);
        setInteractionCount(0);
        setTaskCount(0);
        setNoteCount(0);
        return;
      }
      setCustomer(first);

      // 互动时间线 / 跟进任务 / 备注 三路真实计数（独立失败，不互相阻塞）
      const results = await Promise.allSettled([
        api.get(`/crm/customers/${encodeURIComponent(first.id)}/timeline`),
        api.get(`/crm/tasks?customerId=${encodeURIComponent(first.id)}&status=open&limit=50`),
        api.get(`/crm/notes?customerId=${encodeURIComponent(first.id)}&limit=50`),
      ]);

      const errors: string[] = [];

      // 互动记录
      if (results[0].status === "fulfilled") {
        const tl = Array.isArray(results[0].value)
          ? (results[0].value as TimelineEvent[])
          : [];
        setInteractionCount(tl.length);
      } else {
        setInteractionCount(null);
        errors.push("互动记录加载失败");
      }

      // 跟进任务
      if (results[1].status === "fulfilled") {
        const taskItems = (results[1].value as { items?: unknown[] })?.items;
        setTaskCount(Array.isArray(taskItems) ? taskItems.length : 0);
      } else {
        setTaskCount(null);
        errors.push("跟进任务加载失败");
      }

      // 备注
      if (results[2].status === "fulfilled") {
        const noteItems = (results[2].value as { items?: unknown[] })?.items;
        setNoteCount(Array.isArray(noteItems) ? noteItems.length : 0);
      } else {
        setNoteCount(null);
        errors.push("客户备注加载失败");
      }

      if (errors.length > 0) {
        setPartialErrors(errors);
      }
    } catch (err) {
      setError(toPublicError(err, "客户信息加载失败"));
      setCustomer(null);
      setInteractionCount(null);
      setTaskCount(null);
      setNoteCount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPartialError = partialErrors.length > 0;

  const stats: WorkbenchStat[] = customer
    ? [
        { label: "互动记录", value: loading ? "-" : (interactionCount === null ? "加载失败" : `${interactionCount} 条`), tone: loading || interactionCount === null ? "default" : "accent" },
        { label: "待跟进事项", value: loading ? "-" : (taskCount === null ? "加载失败" : String(taskCount)), tone: loading || taskCount === null || taskCount === 0 ? "default" : "warning" },
        { label: "备注", value: loading ? "-" : (noteCount === null ? "加载失败" : `${noteCount} 条`), tone: loading || noteCount === null ? "default" : "default" },
      ]
    : [{ label: "客户", value: "暂无", tone: "default" }];

  if (error) {
    return (
      <WorkbenchCenter
        title="客户详情"
        subtitle={error}
        icon={UserRound}
        stats={[{ label: "状态", value: "加载失败", tone: "danger" }]}
        primaryAction={{ label: "重试", onClick: () => void load() }}
        quickActions={[]}
        advancedLinks={[
          { key: "all", title: "全部客户", icon: UserRound, href: "/crm" },
        ]}
      />
    );
  }

  return (
    <WorkbenchCenter
      title={customer ? `客户：${customer.displayName}` : "客户详情"}
      subtitle={
        customer
          ? (hasPartialError
            ? `来源：${customer.sourcePlatform || "手动录入"} · ⚠️ 部分数据加载失败，可能不完整`
            : `来源：${customer.sourcePlatform || "手动录入"} · 展示最近有更新的客户档案`)
          : "还没有客户档案，先导入或新增一个客户"
      }
      icon={UserRound}
      stats={stats}
      primaryAction={{
        label: customer ? "查看完整档案" : "去新增客户",
        href: customer ? `/crm/customer?id=${customer.id}` : "/crm?action=new",
      }}
      quickActions={[
        {
          key: "follow-up",
          title: "记录跟进",
          description: "添加一条新的跟进记录",
          icon: Clock,
          href: customer ? `/crm/customer?id=${customer.id}&action=follow-up` : "/crm?action=new",
        },
        {
          key: "message",
          title: "发消息",
          description: "给客户发私信",
          icon: MessageSquareText,
          href: "/message",
        },
        {
          key: "orders",
          title: "成交记录",
          description: "查看该客户的订单",
          icon: TrendingUp,
          href: customer ? `/crm/customer?id=${customer.id}&tab=orders` : "/crm",
        },
      ]}
      advancedLinks={[
        { key: "files", title: "相关文件", icon: FileText, href: "/crm" },
        { key: "all", title: "全部客户", icon: UserRound, href: "/crm" },
      ]}
    />
  );
}
