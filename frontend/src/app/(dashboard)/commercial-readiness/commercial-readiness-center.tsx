"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CloudCog,
  Download,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "@/components/iconpark";
import {
  commercialReadinessApi,
  type CommercialBackupRestoreDryRunResult,
  type CommercialBackupResult,
  type CommercialBackupStatus,
  type CommercialReleaseRollbackDryRunResult,
  type CommercialReleaseRollbackStatus,
  type CommercialReadinessSummary,
} from "@/lib/api/commercial-readiness";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { MobilePageShell } from "@/components/mobile-page-shell";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

/** check.key 前缀 → 可操作设置页 */
const CHECK_TARGETS: Array<{ match: RegExp; href: string; label: string }> = [
  { match: /^auth\./, href: "/settings", label: "前往账号设置" },
  { match: /^license\./, href: "/settings", label: "前往授权设置" },
  { match: /^app-market\./, href: "/apps", label: "前往应用市场" },
  { match: /^crm\.import/, href: "/crm-import", label: "前往受控导入" },
  { match: /^crm\.closer/, href: "/crm-closer", label: "前往销售建议" },
  { match: /^crm\.connectors/, href: "/crm-connectors", label: "前往集成配置" },
  { match: /^crm\./, href: "/crm", label: "前往 CRM" },
  { match: /^tenant\./, href: "/capabilities/account", label: "前往账号管理" },
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

  // 数据保障：备份 / 恢复 / 发布回滚
  const backupGate = summary?.evidence.backupExport;
  const backupExportBlocked = backupGate?.allowed === false;
  const backupRequiredPlans = backupGate?.requiredPlans.join(" / ") ?? "STANDARD+";
  const [exporting, setExporting] = useState(false);
  const [backup, setBackup] = useState<CommercialBackupResult | null>(null);
  const [backupStatus, setBackupStatus] = useState<CommercialBackupStatus | null>(null);
  const [restoreDryRun, setRestoreDryRun] = useState<CommercialBackupRestoreDryRunResult | null>(null);
  const [checkingBackup, setCheckingBackup] = useState(false);
  const [runningRestoreDryRun, setRunningRestoreDryRun] = useState(false);
  const [releaseRollbackStatus, setReleaseRollbackStatus] = useState<CommercialReleaseRollbackStatus | null>(null);
  const [releaseRollbackDryRun, setReleaseRollbackDryRun] = useState<CommercialReleaseRollbackDryRunResult | null>(null);
  const [checkingReleaseRollback, setCheckingReleaseRollback] = useState(false);
  const [runningReleaseRollbackDryRun, setRunningReleaseRollbackDryRun] = useState(false);
  const [dataGuardError, setDataGuardError] = useState<string | null>(null);

  const handleExportBackup = async () => {
    if (backupExportBlocked) {
      setDataGuardError(`导出备份需要商用授权，当前套餐 ${backupGate?.plan ?? "FREE"}，需要 ${backupRequiredPlans}。`);
      return;
    }
    setExporting(true);
    setDataGuardError(null);
    try {
      const result = await commercialReadinessApi.exportBackup();
      setBackup(result);
      setBackupStatus(await commercialReadinessApi.backupStatus());
      await load();
    } catch (err: unknown) {
      setDataGuardError(toPublicError(err, "导出备份失败"));
    } finally {
      setExporting(false);
    }
  };

  const handleBackupStatus = async () => {
    if (backupExportBlocked) {
      setDataGuardError(`查看备份状态需要商用授权，需要 ${backupRequiredPlans}。`);
      return;
    }
    setCheckingBackup(true);
    setDataGuardError(null);
    try {
      setBackupStatus(await commercialReadinessApi.backupStatus());
    } catch (err: unknown) {
      setDataGuardError(toPublicError(err, "读取备份状态失败"));
    } finally {
      setCheckingBackup(false);
    }
  };

  const handleRestoreDryRun = async () => {
    if (backupExportBlocked) {
      setDataGuardError(`恢复验证需要商用授权，需要 ${backupRequiredPlans}。`);
      return;
    }
    setRunningRestoreDryRun(true);
    setDataGuardError(null);
    try {
      setRestoreDryRun(await commercialReadinessApi.restoreDryRun());
      setBackupStatus(await commercialReadinessApi.backupStatus());
    } catch (err: unknown) {
      setDataGuardError(toPublicError(err, "恢复验证失败"));
    } finally {
      setRunningRestoreDryRun(false);
    }
  };

  const handleReleaseRollbackStatus = async () => {
    if (backupExportBlocked) {
      setDataGuardError(`查看发布回滚需要商用授权，需要 ${backupRequiredPlans}。`);
      return;
    }
    setCheckingReleaseRollback(true);
    setDataGuardError(null);
    try {
      setReleaseRollbackStatus(await commercialReadinessApi.releaseRollbackStatus());
    } catch (err: unknown) {
      setDataGuardError(toPublicError(err, "读取发布回滚状态失败"));
    } finally {
      setCheckingReleaseRollback(false);
    }
  };

  const handleReleaseRollbackDryRun = async () => {
    if (backupExportBlocked) {
      setDataGuardError(`发布回滚验证需要商用授权，需要 ${backupRequiredPlans}。`);
      return;
    }
    setRunningReleaseRollbackDryRun(true);
    setDataGuardError(null);
    try {
      setReleaseRollbackDryRun(await commercialReadinessApi.releaseRollbackDryRun());
      setReleaseRollbackStatus(await commercialReadinessApi.releaseRollbackStatus());
      await load();
    } catch (err: unknown) {
      setDataGuardError(toPublicError(err, "发布回滚验证失败"));
    } finally {
      setRunningReleaseRollbackDryRun(false);
    }
  };

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
            <h1 className="kx-greet text-default-900">商业化就绪</h1>
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
            <SkeletonList rows={5} />
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
                  <p className="mt-1 break-words text-sm text-default-600">
                    {publicText(
                      check.summary,
                      check.status === "pass" ? "此项已准备完成。" : "此项需要处理。",
                    )}
                  </p>
                  {check.nextAction && check.status !== "pass" && (
                    <p className="mt-1.5 break-words text-sm text-default-500">
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

      {/* 数据保障：备份 / 恢复 / 发布回滚 */}
      <section className="rounded-2xl border border-default-200 bg-background p-5 shadow-sm dark:border-default-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Archive size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-default-900">数据保障</h2>
              <p className="mt-0.5 text-sm text-default-500">
                备份、恢复验证与发布回滚（需要商用授权）
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-xs font-medium text-default-700 hover:border-primary/40 hover:text-primary dark:border-default-800"
              disabled={backupExportBlocked || exporting}
              onClick={() => void handleExportBackup()}
            >
              <Download size={13} />
              {exporting ? "导出中…" : "导出备份"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-xs font-medium text-default-700 hover:border-primary/40 hover:text-primary dark:border-default-800"
              disabled={backupExportBlocked || checkingBackup}
              onClick={() => void handleBackupStatus()}
            >
              <Archive size={13} />
              {checkingBackup ? "读取中…" : "备份状态"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-xs font-medium text-default-700 hover:border-primary/40 hover:text-primary dark:border-default-800"
              disabled={backupExportBlocked || runningRestoreDryRun}
              onClick={() => void handleRestoreDryRun()}
            >
              <ClipboardCheck size={13} />
              {runningRestoreDryRun ? "验证中…" : "验证恢复"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-xs font-medium text-default-700 hover:border-primary/40 hover:text-primary dark:border-default-800"
              disabled={backupExportBlocked || checkingReleaseRollback}
              onClick={() => void handleReleaseRollbackStatus()}
            >
              <PackageCheck size={13} />
              {checkingReleaseRollback ? "读取中…" : "回滚状态"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-xs font-medium text-default-700 hover:border-primary/40 hover:text-primary dark:border-default-800"
              disabled={backupExportBlocked || runningReleaseRollbackDryRun}
              onClick={() => void handleReleaseRollbackDryRun()}
            >
              <RotateCcw size={13} />
              {runningReleaseRollbackDryRun ? "验证中…" : "验证回滚"}
            </button>
          </div>
        </div>

        {dataGuardError ? (
          <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-400">
            {dataGuardError}
          </p>
        ) : null}

        {backupGate ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-2 text-sm dark:border-default-800">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                backupGate.allowed
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                  : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
              }`}
            >
              {backupGate.allowed ? "导出已授权" : "导出被锁定"}
            </span>
            <span className="text-default-500">当前套餐：{backupGate.plan}</span>
            <span className="text-default-500">要求：{backupRequiredPlans} 商用授权</span>
          </div>
        ) : null}

        {(backup || backupStatus || restoreDryRun) && (
          <div className="mt-3 grid gap-2 text-sm">
            {backup ? (
              <p className="text-default-600">
                {backup.status === "created"
                  ? `备份已创建（${Math.ceil(backup.sizeBytes / 1024 / 1024)} MB）`
                  : backup.message}
              </p>
            ) : null}
            {backupStatus ? (
              <p className="text-default-600">
                {backupStatus.restoreDryRunReady ? "备份可恢复" : "备份未就绪"}
                {backupStatus.latestSizeBytes
                  ? ` · 最近备份 ${Math.ceil(backupStatus.latestSizeBytes / 1024 / 1024)} MB`
                  : ""}
              </p>
            ) : null}
            {restoreDryRun ? (
              <p className="text-default-600">
                恢复验证：
                {restoreDryRun.status === "pass"
                  ? "通过，当前备份可用于恢复"
                  : restoreDryRun.message || "需处理"}
              </p>
            ) : null}
          </div>
        )}

        {(releaseRollbackStatus || releaseRollbackDryRun) && (
          <div className="mt-3 grid gap-2 rounded-lg border border-default-200 bg-default-50 p-3 text-sm dark:border-default-800">
            <p className="font-medium text-default-900">发布回滚</p>
            {releaseRollbackStatus ? (
              <p className="text-default-600">
                {releaseRollbackStatus.ready ? "就绪，当前版本可安全回滚" : "未就绪"}
                {releaseRollbackStatus.currentVersion
                  ? ` · 当前版本 ${commercialDisplayText(releaseRollbackStatus.currentVersion)}`
                  : ""}
              </p>
            ) : null}
            {releaseRollbackDryRun ? (
              <p className="text-default-600">
                回滚验证：
                {releaseRollbackDryRun.status === "pass"
                  ? "通过，回滚准备已验证"
                  : releaseRollbackDryRun.message || "需处理"}
              </p>
            ) : null}
          </div>
        )}
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
