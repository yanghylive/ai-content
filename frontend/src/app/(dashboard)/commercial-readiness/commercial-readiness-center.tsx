"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  CloudCog,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  commercialReadinessApi,
  type CommercialReadinessSummary,
} from "@/lib/api/commercial-readiness";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { MobilePageShell } from "@/components/mobile-page-shell";
import { useIsMobile } from "@/lib/hooks/use-media-query";

/** check.key 前缀 → 可操作设置页 */
const CHECK_TARGETS: Array<{ match: RegExp; href: string; label: string }> = [
  { match: /^auth\./, href: "/settings", label: "前往账号设置" },
  { match: /^license\./, href: "/settings", label: "前往授权设置" },
  { match: /^app-market\./, href: "/apps", label: "前往应用市场" },
  { match: /^crm\.import/, href: "/crm-import", label: "前往受控导入" },
  { match: /^crm\.closer/, href: "/crm-closer", label: "前往销售建议" },
  { match: /^crm\.connectors/, href: "/crm-connectors", label: "前往连接器" },
  { match: /^crm\./, href: "/crm", label: "前往 CRM" },
  { match: /^tenant\./, href: "/admin", label: "前往租户管理" },
  { match: /^payment\./, href: "/settings", label: "前往计费设置" },
  { match: /^external-crm\./, href: "/crm-connectors", label: "前往外部 CRM" },
  { match: /^windows\./, href: "/settings", label: "查看发布说明" },
];

function checkTarget(key: string): { href: string; label: string } {
  for (const t of CHECK_TARGETS) {
    if (t.match.test(key)) return { href: t.href, label: t.label };
  }
  return { href: "/settings", label: "前往相关设置" };
}

function statusMeta(status: string) {
  if (status === "pass")
    return {
      label: "已就绪",
      icon: CheckCircle2,
      tone: "text-emerald-600 dark:text-emerald-400",
      chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
    };
  if (status === "warn")
    return {
      label: "待加固",
      icon: TriangleAlert,
      tone: "text-amber-600 dark:text-amber-400",
      chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
    };
  return {
    label: "需处理",
    icon: ShieldAlert,
    tone: "text-red-600 dark:text-red-400",
    chip: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  };
}

function publicText(value: string | null | undefined, fallback: string) {
  const text = commercialDisplayText(value || "").trim();
  if (!text) return fallback;
  if (
    /(?:https?:\/\/|internal:\/\/|localhost|127\.0\.0\.1|(?:\/Users|\/Volumes|\/private|\/tmp|\/var)\/|[A-Za-z]:\\|\b(?:API|PID|JSON|hash)\b|\b[a-f0-9]{32,}\b|\.(?:json|log|db|sqlite|exe)\b)/i.test(
      text,
    )
  ) {
    return fallback;
  }
  return text.replace(/验收/g, "检查").replace(/演练/g, "验证");
}

export function CommercialReadinessCenter() {
  const searchParams = useSearchParams();
  const filter = searchParams.get("filter") ?? undefined;
  const [summary, setSummary] = useState<CommercialReadinessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await commercialReadinessApi.summary());
    } catch {
      setError("加载商用检查失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const checks = summary?.checks ?? [];
    return {
      pass: checks.filter((c) => c.status === "pass").length,
      warn: checks.filter((c) => c.status === "warn").length,
      blocker: checks.filter((c) => c.status === "blocker").length,
      total: checks.length,
    };
  }, [summary]);

  /** ?filter=pending → 未就绪项（warn+blocker）；?filter=done → 已就绪项 */
  const visibleChecks = useMemo(() => {
    const checks = summary?.checks ?? [];
    if (filter === "pending") return checks.filter((c) => c.status !== "pass");
    if (filter === "done") return checks.filter((c) => c.status === "pass");
    return checks;
  }, [summary, filter]);

  const isMobile = useIsMobile();
  const shell = (
    <div className="flex flex-col gap-5">
      {/* 概览头部 */}
      <section className="rounded-2xl border border-default-200 bg-background p-5 shadow-sm dark:border-default-800">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CloudCog size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-default-900">商业化就绪</h1>
            <p className="mt-0.5 text-sm text-default-500">
              上线前的商用能力自检清单
            </p>
          </div>
        </div>
        {summary && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">
                {summary.overallStatus === "ready"
                  ? "可上线"
                  : summary.overallStatus === "warning"
                    ? "可试点，需加固"
                    : "暂不可完整上线"}
              </span>
              <span className="text-lg font-semibold text-default-900">
                {summary.score}
                <span className="text-sm font-normal text-default-400"> 分</span>
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-default-100">
              <div
                className={`h-full rounded-full transition-all ${
                  summary.overallStatus === "blocked"
                    ? "bg-danger"
                    : summary.overallStatus === "warning"
                      ? "bg-warning"
                      : "bg-success"
                }`}
                style={{ width: `${Math.max(4, summary.score)}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-success-50 p-3 dark:bg-success-500/10">
                <p className="text-xl font-semibold text-success-700 dark:text-success-400">
                  {counts.pass}
                </p>
                <p className="mt-0.5 text-xs text-default-500">已就绪</p>
              </div>
              <div className="rounded-xl bg-warning-50 p-3 dark:bg-warning-500/10">
                <p className="text-xl font-semibold text-warning-700 dark:text-warning-400">
                  {counts.warn}
                </p>
                <p className="mt-0.5 text-xs text-default-500">待加固</p>
              </div>
              <div className="rounded-xl bg-danger-50 p-3 dark:bg-danger-500/10">
                <p className="text-xl font-semibold text-danger-700 dark:text-danger-400">
                  {counts.blocker}
                </p>
                <p className="mt-0.5 text-xs text-default-500">需处理</p>
              </div>
            </div>
            {filter && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-default-200 bg-default-50 px-3 py-2 text-sm dark:border-default-800">
                <span className="text-default-600">
                  {filter === "pending"
                    ? `只看未就绪项（${counts.warn + counts.blocker} 项）`
                    : `只看已就绪项（${counts.pass} 项）`}
                </span>
                <Link
                  href="/commercial-readiness"
                  className="text-primary hover:underline"
                >
                  查看全部
                </Link>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 检查清单 */}
      <section className="flex flex-col gap-3">
        {loading && !summary && (
          <div className="flex min-h-[40vh] items-center justify-center text-default-400">
            <Loader2 className="mr-2 size-5 animate-spin" />
            正在检查商用上线状态...
          </div>
        )}
        {error && !summary && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger-200 bg-danger-50 p-8 text-center dark:border-danger-500/30 dark:bg-danger-500/10">
            <ShieldAlert className="size-8 text-danger" />
            <p className="text-sm text-danger-700 dark:text-danger-400">{error}</p>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              <RefreshCw size={14} /> 重新检查
            </button>
          </div>
        )}
        {!loading && visibleChecks.length === 0 && (
          <div className="rounded-2xl border border-default-200 bg-background p-8 text-center text-sm text-default-400 dark:border-default-800">
            {filter === "pending"
              ? "太棒了，没有未就绪项 🎉"
              : "当前筛选下没有检查项"}
          </div>
        )}
        {visibleChecks.map((check) => {
          const meta = statusMeta(check.status);
          const target = checkTarget(check.key);
          const Icon = meta.icon;
          return (
            <div
              key={check.key}
              className="rounded-2xl border border-default-200 bg-background p-4 shadow-sm dark:border-default-800"
            >
              <div className="flex items-start gap-3">
                <Icon className={`mt-0.5 size-5 shrink-0 ${meta.tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-default-900">
                      {publicText(check.title, "上线准备项")}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-default-600">
                    {publicText(
                      check.summary,
                      check.status === "pass" ? "此项已准备完成。" : "此项需要处理。",
                    )}
                  </p>
                  {check.nextAction && check.status !== "pass" && (
                    <p className="mt-1.5 text-sm text-default-500">
                      下一步：{publicText(check.nextAction, "完成设置后重新检查。")}
                    </p>
                  )}
                  <div className="mt-3">
                    <Link
                      href={target.href}
                      className="inline-flex items-center gap-1 rounded-lg border border-default-200 bg-default-50 px-2.5 py-1.5 text-xs font-medium text-default-700 hover:border-primary/40 hover:text-primary dark:border-default-800"
                    >
                      <ExternalLink size={13} />
                      {target.label}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* 快捷筛选 */}
      <section className="grid grid-cols-2 gap-3">
        <Link
          href="/commercial-readiness?filter=pending"
          className={`flex flex-col gap-1.5 rounded-2xl border p-4 transition-colors ${
            filter === "pending"
              ? "border-primary/50 bg-primary/5"
              : "border-default-200 bg-background hover:border-primary/40 dark:border-default-800"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-default-900">
            <Clock size={15} className="text-amber-500" />
            待完善项
          </span>
          <span className="text-xs text-default-500">
            {counts.warn + counts.blocker} 项未就绪
          </span>
        </Link>
        <Link
          href="/commercial-readiness?filter=done"
          className={`flex flex-col gap-1.5 rounded-2xl border p-4 transition-colors ${
            filter === "done"
              ? "border-primary/50 bg-primary/5"
              : "border-default-200 bg-background hover:border-primary/40 dark:border-default-800"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-default-900">
            <ShieldCheck size={15} className="text-emerald-500" />
            已就绪项
          </span>
          <span className="text-xs text-default-500">
            {counts.pass} 项已完成
          </span>
        </Link>
      </section>
    </div>
  );

  if (isMobile) {
    return (
      <MobilePageShell title="商业化就绪" desc="上线前商用能力自检清单">
        {shell}
      </MobilePageShell>
    );
  }
  return shell;
}
