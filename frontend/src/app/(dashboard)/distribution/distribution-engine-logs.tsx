"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Inbox,
  RefreshCw,
} from "lucide-react";
import {
  autoUploadApi,
  type AutoUploadEngineHealth,
  type AutoUploadLogFile,
} from "@/lib/api/auto-upload";
import {
  V2Section,
  V2StatCard,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import { toPublicError } from "@/lib/public-error";

/** 把本机运行时术语替换为用户友好文案 */
function cleanRuntimeText(text: string): string {
  return text
    .replace(/3011\s*本地\s*Runtime/g, "本机发布服务")
    .replace(/Chrome\/CDP\s*持久浏览器/g, "本机平台后台")
    .replace(/CDP\s*会话/g, "平台后台连接")
    .replace(/persistent-cdp-browser/gi, "本机平台后台")
    .replace(/CDP/g, "平台后台")
    .replace(/尚未打开\s+本机平台后台/g, "尚未打开平台后台");
}

const isFailureLine = (line: string) => /失败|fail|error|异常/i.test(line);

export function DistributionEngineLogs() {
  const [health, setHealth] = useState<AutoUploadEngineHealth | null>(null);
  const [logs, setLogs] = useState<AutoUploadLogFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, l] = await Promise.all([
        autoUploadApi.health().catch(() => null),
        autoUploadApi.logs(80).catch(() => []),
      ]);
      setHealth(h);
      setLogs(Array.isArray(l) ? l : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "发布服务与结果读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportLogs = () => {
    if (!logs.length) return;
    const text = logs
      .map(
        (log) =>
          `【${cleanRuntimeText(log.platform)}】${log.filename}\n${log.lines
            .map(cleanRuntimeText)
            .join("\n")}`,
      )
      .join("\n\n---\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `publish-results-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const failedCount = logs.filter((log) =>
    log.lines.some(isFailureLine),
  ).length;
  const succeededCount = logs.length - failedCount;

  return (
    <div className="flex flex-col gap-4">
      {/* 发布服务 */}
      <V2Section
        title="发布服务"
        description="本机发布服务和运行状态"
        action={
          <V2GhostButton
            icon={RefreshCw}
            loading={loading}
            onClick={() => void load()}
          >
            刷新状态
          </V2GhostButton>
        }
      >
        {health ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <V2StatCard
              label="服务状态"
              value={health.online ? "可用" : "需处理"}
              tone={health.online ? "success" : "warning"}
              icon={Activity}
            />
            <V2StatCard
              label="检查时间"
              value={new Date(health.checkedAt).toLocaleString("zh-CN")}
              icon={RefreshCw}
            />
            <V2StatCard
              label="发布数据"
              value={health.database?.exists ? "可用" : "需处理"}
              tone={health.database?.exists ? "success" : "warning"}
              icon={FileText}
            />
          </div>
        ) : (
          <V2EmptyState
            icon={Activity}
            title="发布服务暂不可用"
            description={error || "请打开运行检查完成设置后刷新。"}
          />
        )}
      </V2Section>

      {/* 发布结果 */}
      <V2Section
        title="发布结果"
        description="汇总本机发布结果，回看平台反馈、失败原因和下一步处理"
        action={
          <V2GhostButton icon={Download} onClick={exportLogs}>
            导出记录
          </V2GhostButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <V2StatCard label="发布结果" value={logs.length} icon={FileText} />
          <V2StatCard
            label="成功"
            value={succeededCount}
            tone="success"
            icon={CheckCircle2}
          />
          <V2StatCard
            label="失败"
            value={failedCount}
            tone="danger"
            icon={AlertTriangle}
          />
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {logs.map((log) => {
            const failed = log.lines.some(isFailureLine);
            return (
              <div key={log.key} className="kaypal-v3-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <V2StatusChip tone={failed ? "danger" : "success"}>
                      {cleanRuntimeText(log.platform)}
                    </V2StatusChip>
                    <span className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {log.filename}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--kaypal-v3-muted)]">
                    {new Date(log.updatedAt).toLocaleString("zh-CN")} ·{" "}
                    {(log.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {log.lines.length
                    ? log.lines.map(cleanRuntimeText).join("\n")
                    : "当前没有发布记录"}
                </pre>
              </div>
            );
          })}
          {!loading && !logs.length && (
            <V2EmptyState
              icon={Inbox}
              title="暂无发布结果"
              description="发布任务完成后，这里会显示平台反馈和失败原因。"
            />
          )}
        </div>
      </V2Section>
    </div>
  );
}
