"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Progress,
  Spinner,
  addToast,
} from "@heroui/react";
import {
  Archive,
  CheckCircle2,
  ClipboardCheck,
  CloudCog,
  Download,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  commercialReadinessApi,
  type CommercialBackupResult,
  type CommercialBackupRestoreDryRunResult,
  type CommercialBackupStatus,
  type CommercialReleaseRollbackDryRunResult,
  type CommercialReleaseRollbackStatus,
  type CommercialReadinessCooperationItem,
  type CommercialReadinessCheck,
  type CommercialReadinessSummary,
} from "@/lib/api/commercial-readiness";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";

function getErrorMessage(error: unknown) {
  return toPublicError(error, "当前操作未完成，请稍后重试。");
}

function publicReadinessText(
  value: string | null | undefined,
  fallback: string,
) {
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

function statusColor(status: CommercialReadinessCheck["status"]) {
  if (status === "pass") return "success";
  if (status === "warn") return "warning";
  return "danger";
}

function statusLabel(status: CommercialReadinessCheck["status"]) {
  if (status === "pass") return "正常";
  if (status === "warn") return "待加固";
  return "需处理";
}

function cooperationStatusColor(status: CommercialReadinessCooperationItem["status"]) {
  if (status === "received") return "success";
  if (status === "blocked") return "danger";
  return "warning";
}

function cooperationStatusLabel(status: CommercialReadinessCooperationItem["status"]) {
  if (status === "received") return "记录已收到";
  if (status === "blocked") return "需处理";
  return "需要配合";
}

function cooperationOwnerLabel(owner: CommercialReadinessCooperationItem["owner"]) {
  if (owner === "user") return "用户";
  if (owner === "operator") return "运营";
  return "技术支持";
}

function overallLabel(status: CommercialReadinessSummary["overallStatus"]) {
  if (status === "ready") return "可上线";
  if (status === "warning") return "可试点，需加固";
  return "暂不可完整上线";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function CommercialReadinessPage() {
  const [summary, setSummary] = useState<CommercialReadinessSummary | null>(null);
  const [backup, setBackup] = useState<CommercialBackupResult | null>(null);
  const [backupStatus, setBackupStatus] = useState<CommercialBackupStatus | null>(null);
  const [restoreDryRun, setRestoreDryRun] = useState<CommercialBackupRestoreDryRunResult | null>(null);
  const [releaseRollbackStatus, setReleaseRollbackStatus] = useState<CommercialReleaseRollbackStatus | null>(null);
  const [releaseRollbackDryRun, setReleaseRollbackDryRun] = useState<CommercialReleaseRollbackDryRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [checkingBackup, setCheckingBackup] = useState(false);
  const [runningRestoreDryRun, setRunningRestoreDryRun] = useState(false);
  const [checkingReleaseRollback, setCheckingReleaseRollback] = useState(false);
  const [runningReleaseRollbackDryRun, setRunningReleaseRollbackDryRun] = useState(false);

  const loadSummary = useCallback(async () =>{
    try {
      setLoading(true);
      setSummary(await commercialReadinessApi.summary());
    } catch (error) {
      addToast({
        title: "加载商用检查失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() =>{
    loadSummary();
  }, [loadSummary]);

  const counts = useMemo(() =>{
    return {
      pass: summary?.checks.filter((item) => item.status === "pass").length ?? 0,
      warn: summary?.warnings.length ?? 0,
      blocker: summary?.blockers.length ?? 0,
      total: summary?.checks.length ?? 0,
    };
  }, [summary]);
  const backupGate = summary?.evidence.backupExport;
  const backupExportBlocked = backupGate?.allowed === false;
  const backupRequiredPlans = backupGate?.requiredPlans.join(" / ") ?? "STANDARD+";
  const cooperationItems = summary?.cooperationItems ?? [];
  const cooperationNeededCount = cooperationItems.filter((item) => item.status !== "received").length;

  const exportBackup = async () =>{
    if (backupExportBlocked) {
      addToast({
        title: "导出备份需要商用授权",
        description: `当前套餐 ${backupGate?.plan ?? "FREE"}，需要 ${backupRequiredPlans}。`,
        color: "danger",
      });
      return;
    }
    try {
      setExporting(true);
      const result = await commercialReadinessApi.exportBackup();
      setBackup(result);
      setBackupStatus(await commercialReadinessApi.backupStatus());
      addToast({
        title: result.status === "created" ? "备份已创建" : "备份不可用",
        description:
          result.status === "created"
            ? "数据备份已完成。"
            : "当前无法创建备份，请检查授权后重试。",
        color: result.status === "created" ? "success" : "warning",
      });
      await loadSummary();
    } catch (error) {
      addToast({
        title: "导出备份失败",
        description: getErrorMessage(error),
        color: "danger", }); } finally { setExporting(false); } };

  const checkBackupStatus = async () =>{
    if (backupExportBlocked) {
      addToast({
        title: "查看备份状态需要商用授权",
        description: `当前套餐 ${backupGate?.plan ?? "FREE"}，需要 ${backupRequiredPlans}。`,
        color: "danger",
      });
      return;
    }
    try {
      setCheckingBackup(true);
      const result = await commercialReadinessApi.backupStatus();
      setBackupStatus(result);
      addToast({
        title: result.restoreDryRunReady ? "备份可恢复" : "备份未就绪",
        description: result.restoreDryRunReady
          ? "当前备份已具备恢复条件。"
          : "请先完成备份后重新检查。",
        color: result.restoreDryRunReady ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: "读取备份状态失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    } finally {
      setCheckingBackup(false);
    }
  };

  const runRestoreDryRun = async () =>{
    if (backupExportBlocked) {
      addToast({
        title: "恢复验证需要商用授权",
        description: `当前套餐 ${backupGate?.plan ?? "FREE"}，需要 ${backupRequiredPlans}。`,
        color: "danger",
      });
      return;
    }
    try {
      setRunningRestoreDryRun(true);
      const result = await commercialReadinessApi.restoreDryRun();
      setRestoreDryRun(result);
      setBackupStatus(await commercialReadinessApi.backupStatus());
      addToast({
        title: result.status === "pass" ? "恢复验证通过" : "恢复验证未通过",
        description:
          result.status === "pass"
            ? "当前备份可用于恢复。"
            : "备份完整性需要处理，请重新导出后再试。",
        color: result.status === "pass" ? "success" : "danger",
      });
    } catch (error) {
      addToast({
        title: "恢复验证失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    } finally {
      setRunningRestoreDryRun(false);
    }
  };

  const checkReleaseRollbackStatus = async () =>{
    if (backupExportBlocked) {
      addToast({
        title: "查看发布回滚需要商用授权",
        description: `当前套餐 ${backupGate?.plan ?? "FREE"}，需要 ${backupRequiredPlans}。`,
        color: "danger",
      });
      return;
    }
    try {
      setCheckingReleaseRollback(true);
      const result = await commercialReadinessApi.releaseRollbackStatus();
      setReleaseRollbackStatus(result);
      addToast({
        title: result.ready ? "发布回滚就绪" : "发布回滚未就绪",
        description: result.ready
          ? "当前版本已具备回滚条件。"
          : "请先处理发布备份或版本准备问题。",
        color: result.ready ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: "读取发布回滚状态失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    } finally {
      setCheckingReleaseRollback(false);
    }
  };

  const runReleaseRollbackDryRun = async () =>{
    if (backupExportBlocked) {
      addToast({
        title: "发布回滚验证需要商用授权",
        description: `当前套餐 ${backupGate?.plan ?? "FREE"}，需要 ${backupRequiredPlans}。`,
        color: "danger",
      });
      return;
    }
    try {
      setRunningReleaseRollbackDryRun(true);
      const result = await commercialReadinessApi.releaseRollbackDryRun();
      setReleaseRollbackDryRun(result);
      setReleaseRollbackStatus(await commercialReadinessApi.releaseRollbackStatus());
      addToast({
        title: result.status === "pass" ? "发布回滚验证通过" : "发布回滚验证未通过",
        description:
          result.status === "pass"
            ? "回滚准备已通过验证。"
            : "回滚准备仍有待处理项。",
        color: result.status === "pass" ? "success" : "danger",
      });
      await loadSummary();
    } catch (error) {
      addToast({
        title: "发布回滚验证失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    } finally {
      setRunningReleaseRollbackDryRun(false);
    }
  };

  if (loading && !summary) { return ( <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="正在检查商用上线状态..."/> </div> ); } return ( <div className="mx-auto flex w-full max-w-6xl flex-col gap-5"> <header className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-divider bg-background p-4 shadow-sm"> <div className="flex items-center gap-3"> <div className="flex size-11 items-center justify-center rounded-[8px] bg-primary/10 text-primary"> <CloudCog size={22} /> </div><div> <h1 className="text-xl font-semibold text-default-900">商用上线检查</h1><p className="mt-1 text-sm text-default-500"> 统一检查账号授权、客户管理、数据保障、运行监控与交付准备情况。 </p> </div> </div><div className="flex items-center gap-2">
          <Button
            variant="flat"
            startContent={<RefreshCw size={16} />}
            isLoading={loading}
            onPress={loadSummary}
          >
            重新检查
          </Button><Button
            color="primary"startContent={<Download size={16} />} isDisabled={backupExportBlocked} isLoading={exporting} onPress={exportBackup} > 导出本地备份 </Button><Button
            variant="flat"
            startContent={<Archive size={16} />}
            isDisabled={backupExportBlocked}
            isLoading={checkingBackup}
            onPress={checkBackupStatus}
          >
            备份状态
          </Button><Button
            variant="flat"
            startContent={<ClipboardCheck size={16} />}
            isDisabled={backupExportBlocked}
            isLoading={runningRestoreDryRun}
            onPress={runRestoreDryRun}
          >
            验证恢复
          </Button><Button
            variant="flat"
            startContent={<PackageCheck size={16} />}
            isDisabled={backupExportBlocked}
            isLoading={checkingReleaseRollback}
            onPress={checkReleaseRollbackStatus}
          >
            回滚状态
          </Button><Button
            variant="flat"
            startContent={<RotateCcw size={16} />}
            isDisabled={backupExportBlocked}
            isLoading={runningReleaseRollbackDryRun}
            onPress={runReleaseRollbackDryRun}
          >
            验证回滚
          </Button> </div> </header>{summary && ( <> <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"> <Card className="border border-divider shadow-sm"> <CardBody className="gap-4"> <div className="flex flex-wrap items-start justify-between gap-3"> <div> <p className="text-sm text-default-500">当前结论</p><div className="mt-2 flex items-center gap-2">{summary.overallStatus === "blocked"? ( <ShieldAlert className="text-danger" size={24} />
                      ) : summary.overallStatus === "warning"? ( <TriangleAlert className="text-warning"size={24} /> ) : ( <ShieldCheck className="text-success"size={24} /> )}<h2 className="text-2xl font-semibold">{overallLabel(summary.overallStatus)}</h2> </div><p className="mt-2 text-sm text-default-500">
                      生成时间：{new Date(summary.generatedAt).toLocaleString()}</p>
                  </div><Chip
                    color={summary.overallStatus === "blocked" ? "danger" : summary.overallStatus === "warning" ? "warning" : "success"}
                    variant="flat"
                  >{summary.score} 分
                  </Chip>
                </div><Progress
                  aria-label="商用上线分数"
                  color={summary.overallStatus === "blocked" ? "danger" : summary.overallStatus === "warning" ? "warning" : "success"} value={summary.score} /> <div className="grid grid-cols-3 gap-3"> <div className="rounded-[8px] bg-success-50 p-3 text-success-700"> <p className="text-xs">正常</p><p className="mt-1 text-xl font-semibold">{counts.pass}</p> </div><div className="rounded-[8px] bg-warning-50 p-3 text-warning-700"> <p className="text-xs">待加固</p><p className="mt-1 text-xl font-semibold">{counts.warn}</p> </div><div className="rounded-[8px] bg-danger-50 p-3 text-danger-700"> <p className="text-xs">需处理</p><p className="mt-1 text-xl font-semibold">{counts.blocker}</p> </div> </div> </CardBody> </Card><Card className="border border-divider shadow-sm"> <CardBody className="gap-3"> <div className="flex items-center gap-2"> <Archive size={18} /> <h2 className="font-semibold">最近备份</h2> </div>{backupGate && ( <div className="rounded-[8px] border border-divider bg-default-50 p-3 text-sm"> <div className="flex flex-wrap items-center gap-2">
                      <Chip color={backupGate.allowed ? "success" : "danger"} variant="flat">{backupGate.allowed ? "导出已授权" : "导出被锁定"}</Chip><span className="text-default-500">当前套餐：{backupGate.plan}</span> </div><p className="mt-2 text-default-500">要求：{backupRequiredPlans} 商用授权</p> </div> )} {backupStatus && ( <div className="rounded-[8px] border border-divider bg-default-50 p-3 text-sm"> <div className="flex flex-wrap items-center gap-2"><Chip color={backupStatus.restoreDryRunReady ? "success" : "warning"} variant="flat">{backupStatus.restoreDryRunReady ? "可恢复" : "未就绪"}</Chip><span className="text-default-500">{backupStatus.restoreDryRunReady ? "当前备份可用于恢复。" : "请先完成备份后重新检查。"}</span></div><p className="text-default-500">最近大小：{formatBytes(backupStatus.latestSizeBytes)}</p> </div> )} {restoreDryRun && ( <div className="rounded-[8px] border border-divider bg-default-50 p-3 text-sm"> <div className="flex flex-wrap items-center gap-2"><Chip color={restoreDryRun.status === "pass" ? "success" : "danger"} variant="flat">{restoreDryRun.status === "pass" ? "验证通过" : "需处理"}</Chip><span className="text-default-500">{restoreDryRun.status === "pass" ? "当前备份可用于恢复。" : "备份完整性需要处理。"}</span></div><p className="mt-2 text-default-500">备份完整性：{restoreDryRun.manifestValid && restoreDryRun.contentValid ? "正常" : "需处理"}</p> </div> )} {backup ? ( <div className="space-y-2 text-sm">
                    <Chip color={backup.status === "created" ? "success" : "warning"} variant="flat">{backup.status === "created" ? "已创建" : "不支持"}</Chip><p className="text-default-600">{backup.status === "created" ? "数据备份已完成。" : "当前无法创建备份。"}</p><p className="text-default-500">大小：{formatBytes(backup.sizeBytes)}</p> </div> ) : ( <p className="text-sm text-default-500"> 点击“导出本地备份”保存当前数据，便于需要时恢复。 </p> )}</CardBody> </Card> </section><Card className="border border-divider shadow-sm"> <CardBody className="gap-3"> <div className="flex flex-wrap items-start justify-between gap-3"> <div className="flex items-start gap-3"> <div className="flex size-9 items-center justify-center rounded-[8px] bg-primary/10 text-primary"> <PackageCheck size={18} /> </div><div> <h2 className="font-semibold text-default-900">发布回滚</h2><p className="mt-1 text-sm text-default-500">确认当前版本和数据备份已具备安全回滚条件。</p> </div> </div><div className="flex flex-wrap gap-2"> <Button size="sm" variant="flat" startContent={<PackageCheck size={15} />} isDisabled={backupExportBlocked} isLoading={checkingReleaseRollback} onPress={checkReleaseRollbackStatus}>检查状态</Button><Button size="sm" color="primary" variant="flat" startContent={<RotateCcw size={15} />} isDisabled={backupExportBlocked} isLoading={runningReleaseRollbackDryRun} onPress={runReleaseRollbackDryRun}>验证回滚</Button> </div> </div>{releaseRollbackStatus ? ( <div className="grid gap-3 lg:grid-cols-3"> <div className="rounded-[8px] border border-divider bg-default-50 p-3 text-sm"> <div className="flex flex-wrap items-center gap-2"><Chip color={releaseRollbackStatus.ready ? "success" : "warning"} variant="flat">{releaseRollbackStatus.ready ? "就绪" : "未就绪"}</Chip><span className="text-default-500">{releaseRollbackStatus.ready ? "当前版本可安全回滚。" : "回滚准备仍有待处理项。"}</span></div><p className="mt-2 text-default-500">当前版本：{commercialDisplayText(releaseRollbackStatus.currentVersion ?? "-")}</p><p className="text-default-500">可用版本：{commercialDisplayText(releaseRollbackStatus.latestFeedVersion ?? "-")}</p><p className="text-default-500">候选数：{releaseRollbackStatus.candidates.length}</p> </div><div className="rounded-[8px] border border-divider bg-default-50 p-3 text-sm"> <p className="font-medium text-default-900">回滚目标</p><p className="mt-2 text-default-500">版本：{commercialDisplayText(releaseRollbackStatus.rollbackCandidate?.version ?? "-")}</p><p className="text-default-500">大小：{formatBytes(releaseRollbackStatus.rollbackCandidate?.sizeBytes ?? 0)}</p> </div><div className="rounded-[8px] border border-divider bg-default-50 p-3 text-sm"> <p className="font-medium text-default-900">记录</p><p className="mt-2 text-default-500">需处理：{releaseRollbackStatus.blockers.length || 0} 项</p><p className="text-default-500">提醒：{releaseRollbackStatus.warnings.length || 0} 项</p> </div> </div> ) : ( <p className="text-sm text-default-500">点击“检查状态”确认当前版本是否具备安全回滚条件。</p> )}{releaseRollbackDryRun && ( <div className="rounded-[8px] border border-divider bg-default-50 p-3 text-sm"> <div className="flex flex-wrap items-center gap-2"><Chip color={releaseRollbackDryRun.status === "pass" ? "success" : "danger"} variant="flat">{releaseRollbackDryRun.status === "pass" ? "验证通过" : "需处理"}</Chip><span className="text-default-500">{releaseRollbackDryRun.status === "pass" ? "回滚准备已通过验证。" : "回滚准备仍有待处理项。"}</span></div><p className="mt-2 text-default-500">安全检查：{releaseRollbackDryRun.noDestructiveAction ? "已通过" : "需处理"}</p> </div> )}</CardBody> </Card>{cooperationItems.length > 0 && ( <Card className="border border-divider shadow-sm"> <CardBody className="gap-3"> <div className="flex flex-wrap items-start justify-between gap-3"> <div className="flex items-start gap-3"> <div className="flex size-9 items-center justify-center rounded-[8px] bg-warning-50 text-warning-700"> <ClipboardCheck size={18} /> </div><div> <h2 className="font-semibold text-default-900">需要你配合</h2><p className="mt-1 text-sm text-default-500">
                        完成以下资料后，可以继续上线准备。
                      </p>
                    </div>
                  </div><Chip color={cooperationNeededCount > 0 ? "warning" : "success"} variant="flat">{cooperationNeededCount > 0 ? `${cooperationNeededCount} 项待补` : "全部收到"}</Chip> </div><div className="grid gap-2 lg:grid-cols-2">{cooperationItems.map((item) => ( <div key={item.key} className="rounded-[8px] border border-divider bg-default-50 p-3"> <div className="flex flex-wrap items-center justify-between gap-2"> <div className="min-w-0"> <p className="font-medium text-default-900">{commercialDisplayText(item.title)}</p><p className="mt-1 text-xs text-default-500">负责人：{cooperationOwnerLabel(item.owner)}</p>
                        </div><Chip color={cooperationStatusColor(item.status)} size="sm" variant="flat">{cooperationStatusLabel(item.status)}</Chip> </div><p className="mt-2 text-sm text-default-600">{publicReadinessText(item.summary, "此项需要补充资料。")}</p><Divider className="my-2"/> <p className="text-sm text-default-500">下一步：{publicReadinessText(item.nextAction, "完成资料后重新检查。")}</p> </div> ))}</div> </CardBody> </Card> )}<section className="grid gap-3">{summary.checks.map((check) => ( <Card key={check.key} className="border border-divider shadow-sm"> <CardBody className="gap-3"> <div className="flex flex-wrap items-start justify-between gap-3"> <div className="flex items-start gap-3">{check.status === "pass"? ( <CheckCircle2 className="mt-0.5 text-success" size={20} />
                      ) : check.status === "warn"? ( <TriangleAlert className="mt-0.5 text-warning"size={20} /> ) : ( <ShieldAlert className="mt-0.5 text-danger"size={20} /> )}<div> <h3 className="font-semibold text-default-900">{publicReadinessText(check.title, "上线准备项")}</h3><p className="mt-1 text-sm text-default-600">{publicReadinessText(check.summary, check.status === "pass" ? "此项已准备完成。" : "此项需要处理。")}</p>
                      </div>
                    </div><Chip color={statusColor(check.status)} variant="flat">{statusLabel(check.status)}</Chip> </div>{check.nextAction && ( <> <Divider /> <p className="text-sm text-default-500">下一步：{publicReadinessText(check.nextAction, "完成设置后重新检查。")}</p>
                    </>
                  )}</CardBody>
              </Card>
            ))}</section>
        </>
      )}</div>
  );
}
