"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  FileText,
  MessageSquareText,
  PhoneCall,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { WorkbenchCenter, type WorkbenchStat } from "@/components/v2/workbench-center";
import { api } from "@/lib/api/client";

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
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [interactionCount, setInteractionCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [noteCount, setNoteCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 最近更新的客户作为展示主体
      const list = (await api.get("/crm/customers?limit=1").catch(() => null)) as
        | { items?: CustomerRow[] }
        | CustomerRow[]
        | null;
      const items = Array.isArray(list) ? list : list?.items || [];
      const first = items[0];
      if (!first) {
        setCustomer(null);
        return;
      }
      setCustomer(first);

      // 互动时间线 / 跟进任务 / 备注 三路真实计数
      const [timeline, tasks, notes] = await Promise.all([
        api
          .get(`/crm/customers/${encodeURIComponent(first.id)}/timeline`)
          .catch(() => []),
        api
          .get(`/crm/tasks?customerId=${encodeURIComponent(first.id)}&status=open&limit=50`)
          .catch(() => null),
        api
          .get(`/crm/notes?customerId=${encodeURIComponent(first.id)}&limit=50`)
          .catch(() => null),
      ]);
      const tl = Array.isArray(timeline) ? (timeline as TimelineEvent[]) : [];
      setInteractionCount(tl.length);
      const taskItems = (tasks as { items?: unknown[] } | null)?.items;
      setTaskCount(Array.isArray(taskItems) ? taskItems.length : 0);
      const noteItems = (notes as { items?: unknown[] } | null)?.items;
      setNoteCount(Array.isArray(noteItems) ? noteItems.length : 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats: WorkbenchStat[] = customer
    ? [
        { label: "互动记录", value: loading ? "-" : `${interactionCount} 条`, tone: "accent" },
        { label: "待跟进事项", value: loading ? "-" : taskCount, tone: taskCount > 0 ? "warning" : "default" },
        { label: "备注", value: loading ? "-" : `${noteCount} 条`, tone: "default" },
      ]
    : [{ label: "客户", value: "暂无", tone: "default" }];

  return (
    <WorkbenchCenter
      title={customer ? `客户：${customer.displayName}` : "客户详情"}
      subtitle={
        customer
          ? `来源：${customer.sourcePlatform || "手动录入"} · 展示最近有更新的客户档案`
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
          key: "call",
          title: "打电话",
          description: "发起 AI 外呼",
          icon: PhoneCall,
          href: "/voice-agent",
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
