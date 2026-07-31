"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { Button, Card, CardBody, Chip, Spinner } from "@heroui/react";
import toast from "@/lib/toast";
import { aiEmployeeApi, type AiEmployeeCapability, type AiEmployeeCapabilitiesSnapshot } from "@/lib/api/ai-employee";
import { toPublicError } from "@/lib/public-error";

const domainLabels: Record<string, string> = {
  "douyin-acquisition": "增长获客",
  "wechat-service": "客户服务",
  "wechat-broadcast": "客户触达",
  "wechat-moments": "朋友圈运营",
  "video-creation": "视频生产",
  "multi-platform-publish": "多平台发布",
};

const domainLinks: Record<string, string> = {
  "douyin-acquisition": "/growth?view=acquisition",
  "wechat-service": "/workbench",
  "wechat-broadcast": "/engagement/wechat-groups",
  "wechat-moments": "/engagement/wechat-moments",
  "video-creation": "/video-workshop",
  "multi-platform-publish": "/distribution",
};

const statusMeta: Record<
  AiEmployeeCapability["status"],
  { label: string; color: "success" | "primary" | "warning" | "danger"; icon: typeof CheckCircle2 }
> = {
  real: { label: "可执行", color: "success", icon: CheckCircle2 },
  simulated: { label: "可预览", color: "primary", icon: Sparkles },
  needs_config: { label: "待配置", color: "warning", icon: AlertTriangle },
  unavailable: { label: "暂不可用", color: "danger", icon: XCircle },
};

function CapabilityCard({ capability }: { capability: AiEmployeeCapability }) {
  const meta = statusMeta[capability.status];
  const Icon = meta.icon;
  return (
    <div className="rounded-[8px] border border-default-200 bg-content1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-default-900">{capability.title}</p>
            <p className="mt-1 text-xs leading-5 text-default-500">{capability.message}</p>
          </div>
        </div>
        <Chip size="sm" color={meta.color} variant="flat">{meta.label}</Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-default-500">
        <span className="rounded-full bg-default-100 px-2 py-1">{domainLabels[capability.domain] || capability.domain}</span>
        <span className="rounded-full bg-default-100 px-2 py-1">{capability.riskLevel === "high" ? "需要确认" : capability.riskLevel === "medium" ? "有风险提示" : "低风险"}</span>
      </div>
      {capability.nextAction ? <p className="mt-3 text-xs text-warning-700">下一步：{capability.nextAction}</p> : null}
    </div>
  );
}

export function CapabilityWorkbench() {
  const [snapshot, setSnapshot] = useState<AiEmployeeCapabilitiesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      setSnapshot(await aiEmployeeApi.capabilities());
    } catch (error) {
      toast.error(
        toPublicError(error, "能力状态暂时无法读取，请稍后重试。"),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const capabilities = useMemo(
    () => snapshot?.capabilities.filter((item) => selectedDomain === "all" || item.domain === selectedDomain) || [],
    [selectedDomain, snapshot],
  );
  const domains = useMemo(
    () => Array.from(new Set(snapshot?.capabilities.map((item) => item.domain) || [])),
    [snapshot],
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-5">
      <Card>
        <CardBody className="gap-5 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-primary/10 text-primary"><ShieldCheck size={22} /></span>
              <div>
                <p className="text-sm font-semibold text-primary">智能员工</p>
                <h1 className="mt-1 text-2xl font-bold text-default-900">能力与任务入口</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-default-500">这里显示当前账号、本机服务和平台任务真正能做什么。进入具体模块后，系统会继续检查登录、风险和素材状态。</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="flat" startContent={<RefreshCw size={15} />} onPress={() => void load()}>刷新状态</Button>
              <Button as={Link} href="/tasks" size="sm" color="primary" endContent={<ArrowRight size={15} />}>查看任务</Button>
            </div>
          </div>
          {loading ? <div className="flex min-h-28 items-center justify-center"><Spinner label="正在读取能力状态" /></div> : snapshot ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Metric label="全部能力" value={snapshot.summary.total} />
                <Metric label="可执行" value={snapshot.summary.real} tone="success" />
                <Metric label="可预览" value={snapshot.summary.simulated} tone="primary" />
                <Metric label="待配置" value={snapshot.summary.needsConfig} tone="warning" />
                <Metric label="暂不可用" value={snapshot.summary.unavailable} tone="danger" />
              </div>
              {snapshot.readiness && !snapshot.readiness.ready ? <div className="rounded-[8px] border border-warning-200 bg-warning-50 px-3 py-3 text-sm text-warning-800">{snapshot.readiness.nextAction}</div> : null}
            </>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="gap-4 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-lg font-semibold text-default-900">任务能力</h2><p className="mt-1 text-sm text-default-500">每个入口都可完成配置、检查或执行。</p></div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={selectedDomain === "all" ? "solid" : "flat"} color={selectedDomain === "all" ? "primary" : "default"} onPress={() => setSelectedDomain("all")}>全部</Button>
              {domains.map((domain) => <Button key={domain} size="sm" variant={selectedDomain === domain ? "solid" : "flat"} color={selectedDomain === domain ? "primary" : "default"} onPress={() => setSelectedDomain(domain)}>{domainLabels[domain] || domain}</Button>)}
            </div>
          </div>
          {loading ? <Spinner label="正在读取任务能力" /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{capabilities.map((capability) => <div key={capability.key}><CapabilityCard capability={capability} /><div className="mt-2"><Button as={Link} href={domainLinks[capability.domain] || "/tasks"} size="sm" variant="light" color="primary" endContent={<ArrowRight size={14} />}>进入模块</Button></div></div>)}</div>}
          {!loading && !capabilities.length ? <p className="rounded-[8px] border border-dashed border-default-300 px-4 py-8 text-center text-sm text-default-500">当前筛选下没有能力记录。</p> : null}
        </CardBody>
      </Card>
    </main>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "primary" | "warning" | "danger" }) {
  return <div className="rounded-[8px] border border-default-200 bg-default-50 px-3 py-3"><p className="text-xs text-default-500">{label}</p><p className={`mt-1 text-2xl font-bold ${tone === "success" ? "text-success" : tone === "primary" ? "text-primary" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-default-900"}`}>{value}</p></div>;
}
