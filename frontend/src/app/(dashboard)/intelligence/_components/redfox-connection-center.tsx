"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  Link2,
  Loader2,
  RefreshCcw,
  Settings2,
  Zap,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { redfoxApi } from "@/lib/api/redfox";
import { toPublicError } from "@/lib/public-error";

export function RedfoxConnectionCenter() {
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stats, setStats] = useState({
    connected: false,
    interfaceCount: 0,
    skillCount: 0,
    todayCalls: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connection, interfaces, skills, costSummary] = await Promise.all([
        redfoxApi.getConnection().catch(() => null),
        redfoxApi.listInterfaces({ limit: 1 } as never).catch(() => null),
        redfoxApi.listSkills({ limit: 1 } as never).catch(() => null),
        redfoxApi.getCostSummary().catch(() => null),
      ]);

      const conn = connection as { connected?: boolean; status?: string } | null;
      const total = (v: unknown): number => {
        if (typeof v === "number") return v;
        const d = v as { total?: number } | null;
        return d?.total ?? 0;
      };
      const today = (costSummary as { todayUsage?: { userCalls?: number } } | null)
        ?.todayUsage;

      setStats({
        connected: Boolean(conn?.connected) || conn?.status === "connected",
        interfaceCount: total(interfaces),
        skillCount: total(skills),
        todayCalls: today?.userCalls ?? 0,
      });
    } catch (err: unknown) {
      setError(toPublicError(err, "连接状态读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    try {
      const result = (await redfoxApi.testConnection()) as {
        ok?: boolean;
        status?: string;
      };
      if (result.ok || result.status === "connected") {
        setNotice("连接正常");
      } else {
        setError("连接测试未通过，请检查密钥");
      }
      await load();
    } catch (err: unknown) {
      setError(toPublicError(err, "连接测试失败"));
    } finally {
      setTesting(false);
      setTimeout(() => setNotice(null), 3000);
    }
  };

  return (
    <WorkbenchCenter
      title="数据服务连接"
      subtitle="查看数据服务的连接状态、功能目录和使用情况"
      icon={Link2}
      stats={[
        {
          label: "连接状态",
          value: loading ? "-" : stats.connected ? "已连接" : "未连接",
          tone: stats.connected ? "success" : "default",
        },
        {
          label: "功能目录",
          value: loading ? "-" : `${stats.interfaceCount} 个`,
          tone: "accent",
        },
        {
          label: "数据技能",
          value: loading ? "-" : `${stats.skillCount} 个`,
          tone: "accent",
        },
        {
          label: "今日调用",
          value: loading ? "-" : `${stats.todayCalls} 次`,
          tone: "accent",
        },
      ]}
      error={error}
      notice={notice}
      primaryAction={{
        label: testing ? "正在测试..." : "测试连接",
        icon: testing ? Loader2 : Zap,
        onClick: handleTest,
        loading: testing,
      }}
      quickActions={[
        {
          key: "test",
          title: "测试连接",
          description: "检查数据服务是否正常",
          icon: CheckCircle2,
          onClick: handleTest,
        },
        {
          key: "refresh",
          title: "刷新状态",
          description: "重新获取连接状态和目录统计",
          icon: RefreshCcw,
          onClick: () => void load(),
        },
      ]}
      advancedLinks={[
        { key: "skills", title: "数据能力", icon: Database, href: "/redfox-skills" },
        { key: "settings", title: "连接设置", icon: Settings2, href: "/intelligence/redfox?tab=settings" },
      ]}
    />
  );
}
