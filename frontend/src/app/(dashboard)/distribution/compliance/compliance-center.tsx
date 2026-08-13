"use client";

import { useEffect, useState } from "react";
import { materialsApi } from "@/lib/api/materials";

import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function ComplianceCenter() {
  const [stats, setStats] = useState({ total: 0, passed: 0, pending: 0 });
  useEffect(() => {
    let active = true;
    materialsApi
      .list({ limit: 100 } as never)
      .then((result) => {
        if (!active) return;
        const data = result as { items?: Array<{ status?: string }> } | Array<{ status?: string }> | null;
        const items = (Array.isArray(data) ? data : data?.items || []) as Array<{ status?: string }>;
        setStats({
          total: items.length,
          passed: items.filter((m) => m.status === "ready" || m.status === "published").length,
          pending: items.filter((m) => m.status === "new" || m.status === "draft").length,
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <WorkbenchCenter
      backHref="/distribution"
            title="合规检查"
      subtitle="发布前检查内容是否合规，避免违规风险"
      icon={ShieldCheck}
      stats={[
        { label: "素材总数", value: stats.total },
        { label: "可直接用", value: stats.passed, tone: "success" },
        { label: "待检查", value: stats.pending, tone: stats.pending > 0 ? "warning" : "default" },
      ]}
      primaryAction={{ label: "检查新内容", href: "/compliance-check" }}
      quickActions={[
        {
          key: "check",
          title: "立即检查",
          description: "粘贴内容，一键合规检测",
          icon: FileSearch,
          href: "/compliance-check",
        },
        {
          key: "issues",
          title: "需修改内容",
          description: "查看有风险的检查结果",
          icon: AlertTriangle,
          href: "/distribution/compliance?filter=issues",
          badge: "2",
        },
        {
          key: "passed",
          title: "已通过",
          description: "查看合规通过的内容",
          icon: CheckCircle2,
          href: "/distribution/compliance?filter=passed",
        },
      ]}
      advancedLinks={[
        { key: "rules", title: "合规规则", icon: ListChecks, href: "/distribution/compliance?tab=rules" },
      ]}
    />
  );
}
