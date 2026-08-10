"use client";

import { useEffect, useState } from "react";
import { redfoxApi } from "@/lib/api/redfox";
import { autoUploadApi } from "@/lib/api/auto-upload";

import {
  CheckCircle2,
  Clock,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { MobilePageShell } from "@/components/mobile-page-shell";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export function CommercialReadinessCenter() {
  const [stats, setStats] = useState({ ready: 0, pending: 0 });
  useEffect(() => {
    let active = true;
    Promise.all([
      redfoxApi.getConnection().catch(() => null),
      autoUploadApi.accounts().catch(() => []),
    ]).then(([conn, accounts]) => {
      if (!active) return;
      const connected = Boolean((conn as { connected?: boolean } | null)?.connected);
      const loggedIn = (Array.isArray(accounts) ? accounts : []).filter(
        (a) => (a as { status?: number }).status === 1,
      ).length;
      const total = 3; // 数据连接 / 平台账号 / 模型配置 三个维度
      const readyCount = (connected ? 1 : 0) + (loggedIn > 0 ? 1 : 0) + 1; // 模型已同步视为就绪
      setStats({ ready: readyCount, pending: total - readyCount });
    });
    return () => { active = false; };
  }, []);
  const isMobile = useIsMobile();
  const content = (
    <WorkbenchCenter
      title="商业化就绪"
      subtitle="检查系统是否具备对外商业化运营的条件"
      icon={Rocket}
      stats={[
        { label: "已就绪项", value: stats.ready, tone: "success" },
        { label: "待完善项", value: stats.pending, tone: stats.pending > 0 ? "warning" : "default" },
      ]}
      primaryAction={{ label: "处理待完善项", href: "/commercial-readiness?filter=pending" }}
      quickActions={[
        {
          key: "pending",
          title: "待完善项",
          description: "上线前必须完成的事项",
          icon: Clock,
          href: "/commercial-readiness?filter=pending",
          badge: "4",
        },
        {
          key: "done",
          title: "已就绪项",
          description: "已完成的检查项",
          icon: CheckCircle2,
          href: "/commercial-readiness?filter=done",
        },
      ]}
      advancedLinks={[
        { key: "risk", title: "风险管控", icon: ShieldCheck, href: "/risk-v2" },
      ]}
    />
  );
  if (isMobile) {
    return (
      <MobilePageShell title="商业化就绪" desc="系统对外商业化条件检查">
        {content}
      </MobilePageShell>
    );
  }
  return content;
}
