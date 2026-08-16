"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  History,
  RotateCcw,
  Upload,
  Users,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import {
  listCrmImportBatches,
  rollbackCrmImport,
  type CrmImportBatch,
} from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";

function batchStatusLabel(status: string) {
  if (status === "committed" || status === "completed") return "已导入";
  if (status === "rolled_back" || status === "archived") return "已回滚";
  if (status === "blocked") return "已拦截";
  return status || "处理中";
}

export function CrmImportCenter() {
  const [batches, setBatches] = useState<CrmImportBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    setBatchesError(null);
    try {
      const list = await listCrmImportBatches();
      setBatches(Array.isArray(list) ? list : []);
    } catch (err: unknown) {
      // 报告 7.5：导入历史加载失败不得静默显示空
      setBatchesError(toPublicError(err, "导入记录加载失败"));
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const handleRollbackBatch = async (batch: CrmImportBatch) => {
    // 报告 7.5：回滚不依赖前端 batch.customerIds（字段可能缺失/批量大不完整），
    // 传空数组，后端按 importCommitId + rollbackToken 回退到 batch 内存储的客户
    const customerIds = Array.isArray(batch.customerIds)
      ? (batch.customerIds as string[])
      : [];
    if (!window.confirm(`确定回滚这批导入的 ${batch.committedCount || customerIds.length || "?"} 条客户吗？回滚后需要重新导入。`)) return;
    setRollingBackId(batch.id);
    setRollbackMsg(null);
    try {
      const result = await rollbackCrmImport({
        importCommitId: batch.id,
        rollbackToken: batch.rollbackToken,
        customerIds,
        reason: "crm-import-center-local-rollback",
      });
      setRollbackMsg(`已回滚 ${result.archivedCount} 条`);
      await loadBatches();
    } catch (err: unknown) {
      setRollbackMsg(toPublicError(err, "回滚失败"));
    } finally {
      setRollingBackId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCenter
        title="导入客户"
        backHref="/crm"
        subtitle="上传 Excel 或粘贴数据，系统自动识别字段并导入"
        icon={Upload}
        primaryAction={{ label: "开始导入", href: "/crm-import/flow" }}
        quickActions={[
          {
            key: "upload-excel",
            title: "上传 Excel",
            description: "支持 .xlsx / .csv 文件",
            icon: FileSpreadsheet,
            href: "/crm-import/flow",
          },
          {
            key: "download-template",
            title: "下载模板",
            description: "按模板格式整理数据",
            icon: Download,
            href: "/crm-import/flow",
          },
          {
            key: "paste",
            title: "直接粘贴",
            description: "粘贴表格数据快速导入",
            icon: Upload,
            href: "/crm-import/flow",
          },
        ]}
        advancedLinks={[
          { key: "customers", title: "客户列表", icon: Users, href: "/crm" },
        ]}
      />

      {/* 导入记录（审计留痕 + 回滚） */}
      {(batches.length > 0 || batchesError) && (
        <section className="kaypal-v3-panel p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
              <h2 className="font-semibold text-[var(--kaypal-v3-ink)]">
                导入记录（{batches.length}）
              </h2>
            </div>
            {rollbackMsg ? (
              <p className={`text-sm ${rollbackMsg.startsWith("已回滚") ? "text-[var(--kaypal-v3-success)]" : "text-[var(--kaypal-v3-danger)]"}`}>
                {rollbackMsg}
              </p>
            ) : null}
          </div>
          {loadingBatches ? (
            <p className="mt-3 text-sm text-[var(--kaypal-v3-muted)]">加载中…</p>
          ) : batchesError ? (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm text-[var(--kaypal-v3-danger)]">{batchesError}</p>
              <button
                type="button"
                className="text-sm text-[var(--kaypal-v3-accent-ink)] underline"
                onClick={() => void loadBatches()}
              >
                重试
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {batches.map((batch) => {
                const rollbacked =
                  batch.status === "rolled_back" || batch.status === "archived";
                return (
                  <div
                    key={batch.id}
                    className="kaypal-v3-surface flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {batch.filename || `导入批次 #${batch.id.slice(0, 8)}`}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                        {batch.createdAt
                          ? new Date(batch.createdAt).toLocaleString("zh-CN", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                        {" · "}导入 {batch.committedCount} 条 · {batchStatusLabel(batch.status)}
                      </p>
                    </div>
                    {/* 报告 7.5：回滚按钮按 committedCount 判断，不依赖前端 customerIds */}
                    {!rollbacked && batch.committedCount > 0 && batch.rollbackToken ? (
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--kaypal-v3-danger)] hover:bg-[var(--kaypal-v3-danger-soft)]"
                        disabled={rollingBackId === batch.id}
                        onClick={() => void handleRollbackBatch(batch)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {rollingBackId === batch.id ? "回滚中…" : "回滚"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
