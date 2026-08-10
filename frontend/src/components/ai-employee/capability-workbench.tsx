"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { Button, Card, CardBody, Chip, Spinner } from "@heroui/react";
import toast from "@/lib/toast";
import { aiEmployeeApi, type AiEmployeeCapability, type AiEmployeeCapabilitiesSnapshot } from "@/lib/api/ai-employee";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

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

const hiddenFrontendDomains = new Set(["video-creation"]);

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
  const isMobile = useIsMobile();
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

  const visibleCapabilities = useMemo(
    () => snapshot?.capabilities.filter((item) => !hiddenFrontendDomains.has(item.domain)) || [],
    [snapshot],
  );
  const capabilities = useMemo(
    () => visibleCapabilities.filter((item) => selectedDomain === "all" || item.domain === selectedDomain),
    [selectedDomain, visibleCapabilities],
  );
  const domains = useMemo(
    () => Array.from(new Set(visibleCapabilities.map((item) => item.domain))),
    [visibleCapabilities],
  );

  /* 移动端原生视图（mx-* 明德 VP 风格）——转 2 页（apps/ai-employee + admin/ai-employee） */
  if (isMobile) {
    const badgeClass = (status: AiEmployeeCapability["status"]) =>
      status === "real" ? "mx-badge-green"
        : status === "simulated" ? "mx-badge-blue"
          : status === "needs_config" ? "mx-badge-gold"
            : "mx-badge-red";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">能力与任务入口</div>
            <div className="mx-page-sub">智能员工当前真正能做什么，一目了然</div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={() => void load()} style={{ flex: 1, padding: "9px 10px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600 }}>
              刷新状态
            </button>
            <Link href="/tasks" className="mx-btn-gold" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              查看任务
            </Link>
          </div>

          {loading ? (
            <div style={{ padding: "36px 0", textAlign: "center" }}>
              <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: "50%", border: "2px solid rgba(222,150,57,.9)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
              <p style={{ fontSize: 12, color: "var(--mx-muted)", marginTop: 10 }}>正在读取能力状态</p>
            </div>
          ) : snapshot ? (
            <>
              <div className="mx-stat-grid" style={{ marginTop: 12 }}>
                <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: "var(--mx-ink)" }}>{snapshot.summary.total}</div>
                  <div style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 2 }}>全部能力</div>
                </div>
                <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: "#059669" }}>{snapshot.summary.real}</div>
                  <div style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 2 }}>可执行</div>
                </div>
                <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: "#b45309" }}>{snapshot.summary.needsConfig}</div>
                  <div style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 2 }}>待配置</div>
                </div>
              </div>
              <div className="mx-stat-grid" style={{ marginTop: 8 }}>
                <div className="mx-card" style={{ padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#2563eb" }}>{snapshot.summary.simulated}</div>
                  <div style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 2 }}>可预览</div>
                </div>
                <div className="mx-card" style={{ padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#dc2626" }}>{snapshot.summary.unavailable}</div>
                  <div style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 2 }}>暂不可用</div>
                </div>
              </div>
              {snapshot.readiness && !snapshot.readiness.ready ? (
                <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(222,150,57,.4)" }}>
                  <p style={{ fontSize: 12, color: "#b45309", lineHeight: 1.5 }}>{snapshot.readiness.nextAction}</p>
                </div>
              ) : null}
            </>
          ) : null}

          {/* 领域筛选横滚 */}
          <div style={{ display: "flex", gap: 7, overflowX: "auto", marginTop: 16, paddingBottom: 2 }}>
            <button
              type="button"
              onClick={() => setSelectedDomain("all")}
              style={{ flexShrink: 0, padding: "6px 13px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: selectedDomain === "all" ? "#d98a2d" : "rgba(120,148,179,.12)", color: selectedDomain === "all" ? "#fff" : "var(--mx-ink)", border: selectedDomain === "all" ? "1px solid #d98a2d" : "1px solid rgba(142,165,190,.3)" }}
            >
              全部
            </button>
            {domains.map((domain) => (
              <button
                key={domain}
                type="button"
                onClick={() => setSelectedDomain(domain)}
                style={{ flexShrink: 0, padding: "6px 13px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: selectedDomain === domain ? "#d98a2d" : "rgba(120,148,179,.12)", color: selectedDomain === domain ? "#fff" : "var(--mx-ink)", border: selectedDomain === domain ? "1px solid #d98a2d" : "1px solid rgba(142,165,190,.3)" }}
              >
                {domainLabels[domain] || domain}
              </button>
            ))}
          </div>

          {loading ? null : capabilities.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 12, padding: 24, textAlign: "center" }}>
              <p style={{ fontSize: 12.5, color: "var(--mx-muted)" }}>当前筛选下没有能力记录。</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
              {capabilities.map((capability) => (
                <div key={capability.key} className="mx-card" style={{ padding: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {capability.title}
                    </span>
                    <span className={`mx-badge ${badgeClass(capability.status)}`} style={{ fontSize: 10, flexShrink: 0 }}>
                      {statusMeta[capability.status].label}
                    </span>
                  </div>
                  <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 5, lineHeight: 1.5 }}>{capability.message}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 999, background: "rgba(120,148,179,.12)", color: "var(--mx-muted)" }}>
                      {domainLabels[capability.domain] || capability.domain}
                    </span>
                    <span style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 999, background: "rgba(120,148,179,.12)", color: "var(--mx-muted)" }}>
                      {capability.riskLevel === "high" ? "需要确认" : capability.riskLevel === "medium" ? "有风险提示" : "低风险"}
                    </span>
                  </div>
                  {capability.nextAction ? (
                    <p style={{ fontSize: 11.5, color: "#b45309", marginTop: 7 }}>下一步：{capability.nextAction}</p>
                  ) : null}
                  <Link
                    href={domainLinks[capability.domain] || "/tasks"}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 9, fontSize: 12, fontWeight: 700, color: "#d98a2d" }}
                  >
                    进入模块 ›
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

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
