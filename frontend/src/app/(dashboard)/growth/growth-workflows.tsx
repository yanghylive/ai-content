"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pause, Play, Route, Trash2 } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import { growthApi, type GrowthWorkflow } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "muted" }> = {
  active: { label: "运行中", tone: "success" },
  enabled: { label: "运行中", tone: "success" },
  paused: { label: "已暂停", tone: "warning" },
  disabled: { label: "已停用", tone: "muted" },
};

export function GrowthWorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<GrowthWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GrowthWorkflow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const data = await growthApi.listWorkflows();
      setWorkflows(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载工作流失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  const handleAction = async (workflow: GrowthWorkflow, action: "start" | "pause") => {
    setActingId(workflow.id);
    setError(null);
    try {
      await growthApi.workflowAction(workflow.id, action, {});
      await fetchWorkflows();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await growthApi.deleteWorkflow(deleteTarget.id);
      setDeleteTarget(null);
      await fetchWorkflows();
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeleting(false);
    }
  };

  const isActive = (w: GrowthWorkflow) =>
    ["active", "enabled"].includes((w.status || "").toLowerCase());

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/growth")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">增长工作流</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              多步骤的自动化获客流程
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : workflows.length === 0 ? (
          <V2EmptyState
            icon={Route}
            title="还没有工作流"
            description="工作流把多个获客步骤串成自动化流程"
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {workflows.map((workflow) => {
              const active = isActive(workflow);
              const status = STATUS_LABELS[active ? "active" : "paused"];
              const stepCount = (workflow as { steps?: unknown[] }).steps?.length;
              return (
                <div key={workflow.id} className="flex items-center justify-between p-5">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-[var(--kaypal-v3-ink)]">
                        {workflow.name || "未命名工作流"}
                      </h3>
                      <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                    </div>
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {(workflow as { description?: string }).description || ""}
                      {stepCount ? ` · ${stepCount} 个步骤` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      title="删除"
                      className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                      onClick={() => setDeleteTarget(workflow)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <V2GhostButton
                      icon={active ? Pause : Play}
                      loading={actingId === workflow.id}
                      onClick={() => void handleAction(workflow, active ? "pause" : "start")}
                    >
                      {active ? "暂停" : "启动"}
                    </V2GhostButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/growth")}>
          返回增长控制台
        </V2GhostButton>
      </section>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">删除工作流？</h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              「{deleteTarget.name}」将被删除，不能撤销。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <V2GhostButton onClick={() => setDeleteTarget(null)}>取消</V2GhostButton>
              <V2DangerButton loading={deleting} onClick={handleDelete}>
                {deleting ? "正在删除..." : "确认删除"}
              </V2DangerButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
