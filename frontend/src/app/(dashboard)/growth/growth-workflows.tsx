"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pause,
  PenLine,
  Play,
  Route,
  Trash2,
  Building2,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import { growthApi, type GrowthWorkflow } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";
import FlowCanvas from "./workflow-canvas/FlowCanvas";

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "muted" }> = {
  active: { label: "运行中", tone: "success" },
  enabled: { label: "运行中", tone: "success" },
  paused: { label: "已暂停", tone: "warning" },
  disabled: { label: "已停用", tone: "muted" },
};

interface PlaybookScenario {
  key: string;
  name: string;
  description: string;
  platforms: string[];
  stepCount: number;
  riskNotes: string[];
}

interface IndustryPlaybooks {
  industry: string;
  scenarios: PlaybookScenario[];
}

export function GrowthWorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<GrowthWorkflow[]>([]);
  const [playbooks, setPlaybooks] = useState<IndustryPlaybooks[]>([]);
  const [activeIndustry, setActiveIndustry] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GrowthWorkflow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<GrowthWorkflow | null>(null);

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

  const fetchPlaybooks = useCallback(async () => {
    try {
      const data = await growthApi.listWorkflowPlaybooks();
      const list = Array.isArray(data) ? data : [];
      setPlaybooks(list);
      setActiveIndustry((prev) => prev || list[0]?.industry || "");
    } catch {
      // 方案库加载失败不阻塞页面
    }
  }, []);

  useEffect(() => {
    void fetchWorkflows();
    void fetchPlaybooks();
  }, [fetchWorkflows, fetchPlaybooks]);

  /** 一键从行业方案库创建工作流（industry + scenario → 行业步骤链） */
  const handleCreateFromPlaybook = async (industry: string, scenario: string) => {
    const key = `${industry}-${scenario}`;
    setCreating(key);
    setError(null);
    try {
      await growthApi.createWorkflow({ industry, scenario });
      await fetchWorkflows();
    } catch (err: unknown) {
      setError(toPublicError(err, "创建工作流失败，请稍后重试"));
    } finally {
      setCreating(null);
    }
  };

  /** 打开画布编辑器（先刷新拿到最新数据，保证 status 状态着色正确） */
  const handleOpenEditor = async (workflow: GrowthWorkflow) => {
    setError(null);
    try {
      const latest = await growthApi.listWorkflows();
      const found = (Array.isArray(latest) ? latest : []).find(
        (w) => w.id === workflow.id,
      );
      setEditing(found ?? workflow);
    } catch {
      setEditing(workflow);
    }
  };

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
      {editing ? (
        <FlowCanvas
          workflow={editing}
          onBack={() => {
            setEditing(null);
            void fetchWorkflows();
          }}
          onSaved={() => {
            // 保存后刷新列表（画布内已更新数据）
          }}
        />
      ) : (
      <>
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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">增长工作流 · 行业方案库</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              按行业选场景，一键创建带行业话术、平台组合与合规风控的获客流水线
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* ===== 行业方案库 ===== */}
      <V2Section padding={false}>
        <div className="p-5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
            <h2 className="text-base font-bold text-[var(--kaypal-v3-ink)]">行业方案库</h2>
            <span className="text-xs text-[var(--kaypal-v3-muted)]">
              覆盖 {playbooks.length} 个行业 · 每个行业 2 套获客场景
            </span>
          </div>

          {/* 行业 chips */}
          {playbooks.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {playbooks.map((pb) => (
                <button
                  key={pb.industry}
                  type="button"
                  onClick={() => setActiveIndustry(pb.industry)}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition ${
                    activeIndustry === pb.industry
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent)] text-white"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-ink)]"
                  }`}
                >
                  {pb.industry}
                </button>
              ))}
            </div>
          )}

          {/* 当前行业场景卡片 */}
          {activeIndustry && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {playbooks
                .find((pb) => pb.industry === activeIndustry)
                ?.scenarios.map((sc) => {
                  const creatingKey = `${activeIndustry}-${sc.key}`;
                  return (
                    <button
                      key={sc.key}
                      type="button"
                      disabled={creating !== null}
                      onClick={() => void handleCreateFromPlaybook(activeIndustry, sc.key)}
                      className="group flex flex-col gap-2.5 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 text-left transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-sm disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                          {sc.name}
                        </span>
                        <span className="shrink-0 rounded bg-[var(--kaypal-v3-accent)]/10 px-2 py-0.5 text-11 font-medium text-[var(--kaypal-v3-accent)]">
                          {sc.stepCount} 步
                        </span>
                      </div>
                      <span className="text-xs leading-5 text-[var(--kaypal-v3-muted)]">
                        {sc.description}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-11 text-[var(--kaypal-v3-muted)]">
                        <Smartphone className="h-3 w-3" />
                        {sc.platforms.join(" / ")}
                        {sc.riskNotes.length > 0 && (
                          <span className="flex items-center gap-1 text-[var(--kaypal-v3-amber)]">
                            <ShieldAlert className="h-3 w-3" />
                            {sc.riskNotes[0]}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 text-xs font-medium text-[var(--kaypal-v3-accent)]">
                        {creating === creatingKey ? "创建中…" : "+ 一键创建此工作流"}
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </V2Section>

      {/* ===== 我的工作流 ===== */}
      <V2Section padding={false}>
        <div className="flex items-center gap-2 p-5 pb-3">
          <Route className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
          <h2 className="text-base font-bold text-[var(--kaypal-v3-ink)]">我的工作流</h2>
          <span className="text-xs text-[var(--kaypal-v3-muted)]">{workflows.length} 个</span>
        </div>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="p-5 pt-2">
            <V2EmptyState
              icon={Route}
              title="还没有工作流"
              description="从上方行业方案库选一个场景，一键创建"
            />
          </div>
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
                      {workflow.industry ? `${workflow.industry} · ${workflow.scenario || ""}` : ""}
                      {stepCount ? ` · ${stepCount} 个步骤` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <V2GhostButton
                      icon={PenLine}
                      onClick={() => void handleOpenEditor(workflow)}
                    >
                      编辑画布
                    </V2GhostButton>
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
      </>
      )}
    </div>
  );
}
