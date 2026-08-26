"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  History,
  Loader2,
  Pause,
  Pencil,
  Play,
  Rocket,
  Save,
  Target,
  Trash2,
  UserRoundPlus,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2Select,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import {
  growthApi,
  type GrowthAcquisitionConfig,
  type GrowthAcquisitionRun,
  type GrowthRiskMode,
} from "@/lib/api/growth";
import { buildRiskConfirmation } from "@/lib/api/auto-upload";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle } from "@/components/skeleton";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信",
  "wechat-channel": "视频号",
  wecom: "企业微信",
  kuaishou: "快手",
  gongzhonghao: "公众号",
};

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "muted" }> = {
  enabled: { label: "运行中", tone: "success" },
  disabled: { label: "已停用", tone: "muted" },
  running: { label: "执行中", tone: "warning" },
};

const RISK_OPTIONS = [
  { value: "confirm-first", label: "每条先给我确认（推荐）" },
  { value: "draft-only", label: "只存草稿，我自己发" },
  { value: "auto", label: "自动发送（高风险）" },
] as const;

export function GrowthAcquisitionTasks() {
  const router = useRouter();
  const [configs, setConfigs] = useState<GrowthAcquisitionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<GrowthAcquisitionConfig | null>(null);
  const [editForm, setEditForm] = useState({
    taskName: "",
    sourceInputs: "",
    excludeKeywords: "",
    blacklistNicknames: "",
    commentTemplates: "",
    privateMessageTemplates: "",
    dailyLimit: 20,
    perTargetLimit: 3,
    scheduleEnabled: false,
    beginTime: "09:00",
    deduplicate: true,
    riskMode: "confirm-first" as GrowthRiskMode,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<GrowthAcquisitionConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 执行确认
  const [executeTarget, setExecuteTarget] = useState<GrowthAcquisitionConfig | null>(null);
  const [executing, setExecuting] = useState(false);

  // 执行记录展开
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<GrowthAcquisitionRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const fetchConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await growthApi.listConfigs();
      setConfigs(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载获客任务失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  const handleToggle = async (config: GrowthAcquisitionConfig) => {
    setActingId(config.id);
    setError(null);
    try {
      const nextEnabled = config.status !== "enabled";
      await growthApi.setConfigStatus(config.id, nextEnabled);
      await fetchConfigs();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  /* 编辑 */
  const openEdit = (config: GrowthAcquisitionConfig) => {
    setEditTarget(config);
    setEditForm({
      taskName: config.taskName,
      sourceInputs: (config.sourceInputs || []).join("\n"),
      excludeKeywords: (config.excludeKeywords || []).join("\n"),
      blacklistNicknames: (config.blacklistNicknames || []).join("\n"),
      commentTemplates: (config.commentTemplates || []).join("\n"),
      privateMessageTemplates: (config.privateMessageTemplates || []).join("\n"),
      dailyLimit: config.dailyLimit || 20,
      perTargetLimit: config.perTargetLimit || 3,
      scheduleEnabled: Boolean(config.scheduleEnabled),
      beginTime: config.beginTime || "09:00",
      deduplicate: config.deduplicate !== false,
      riskMode: config.riskMode || "confirm-first",
    });
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    setError(null);
    try {
      const toList = (text: string) =>
        text
          .split(/\n|,|，/)
          .map((k) => k.trim())
          .filter(Boolean);
      await growthApi.updateConfig(editTarget.id, {
        taskName: editForm.taskName.trim(),
        sourceInputs: toList(editForm.sourceInputs),
        excludeKeywords: toList(editForm.excludeKeywords),
        blacklistNicknames: toList(editForm.blacklistNicknames),
        commentTemplates: toList(editForm.commentTemplates),
        privateMessageTemplates: toList(editForm.privateMessageTemplates),
        dailyLimit: editForm.dailyLimit,
        perTargetLimit: editForm.perTargetLimit,
        scheduleEnabled: editForm.scheduleEnabled,
        beginTime: editForm.scheduleEnabled ? editForm.beginTime : "",
        deduplicate: editForm.deduplicate,
        riskMode: editForm.riskMode,
      });
      setEditTarget(null);
      flash("已保存修改");
      await fetchConfigs();
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(rawMessage || toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSavingEdit(false);
    }
  };

  /* 删除 */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await growthApi.deleteConfig(deleteTarget.id);
      setDeleteTarget(null);
      flash("已删除");
      await fetchConfigs();
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeleting(false);
    }
  };

  /* 立即执行（真实触达，要确认） */
  const handleExecute = async () => {
    if (!executeTarget) return;
    setExecuting(true);
    setError(null);
    try {
      // 先执行前检查（与旧版 preflight 确认链一致）
      const preflight = (await growthApi.preflightConfig(executeTarget.id)) as {
        allowed?: boolean;
        blockers?: Array<{ message?: string } | string>;
      };
      if (preflight.allowed === false) {
        const reasons = (preflight.blockers || [])
          .map((b) => (typeof b === "string" ? b : b.message || String(b)))
          .join("；");
        setError(`执行前检查未通过：${reasons || "请检查任务配置和账号状态"}`);
        setExecuteTarget(null);
        setExecuting(false);
        return;
      }
      // 高风险触达需要后端一次性确认编号：先创建确认单再执行
      const approval = (await api.post<{
        confirmationId: string;
        action?: string;
        riskLevel?: string;
        target?: string;
        expiresAt?: string;
      }>("/risk-policies/approvals", {
        action: "batch-touch",
        riskLevel: "high",
        target: `${executeTarget.taskName} · ${
          executeTarget.accountName || executeTarget.accountId
        } · ${executeTarget.id}`,
        reason: "执行增长获客任务会触发外部平台采集、评论或私信动作，系统将确认真实触达风险。",
      })) as { confirmationId: string };
      if (!approval?.confirmationId) {
        throw new Error("后端未返回确认编号，请稍后重试");
      }
      await growthApi.executeConfig(
        executeTarget.id,
        buildRiskConfirmation("batch-touch", "high", approval.confirmationId),
      );
      setExecuteTarget(null);
      flash("执行已开始，结果稍后在线索池和执行记录里看");
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(rawMessage || toPublicError(err, "执行失败，请稍后重试"));
    } finally {
      setExecuting(false);
    }
  };

  /* 执行记录 */
  const toggleRuns = async (config: GrowthAcquisitionConfig) => {
    if (runsFor === config.id) {
      setRunsFor(null);
      setRuns([]);
      return;
    }
    setRunsFor(config.id);
    setRunsLoading(true);
    try {
      const data = await growthApi.listRuns(config.id);
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">获客任务</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">自动帮你找客户的任务，随时启停和编辑</p>
        </div>
        <V2PrimaryButton
          icon={Target}
          onClick={() => router.push("/auto-acquisition/create")}
        >
          新建获客任务
        </V2PrimaryButton>
      </div>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : configs.length === 0 ? (
          <V2EmptyState
            icon={UserRoundPlus}
            title="还没有获客任务"
            description="创建一个获客任务，让系统自动帮你找客户"
            action={
              <V2PrimaryButton
                icon={Target}
                onClick={() => router.push("/auto-acquisition/create")}
              >
                新建获客任务
              </V2PrimaryButton>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {configs.map((config) => {
              const status = STATUS_LABELS[config.status] || STATUS_LABELS.disabled;
              const runsOpen = runsFor === config.id;
              return (
                <div key={config.id}>
                  <div className="flex items-center justify-between p-5">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-[var(--kaypal-v3-ink)]">
                          {config.taskName}
                        </h3>
                        <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                      </div>
                      <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                        {PLATFORM_LABELS[config.platform] || config.platform}
                        {config.sourceInputs?.length ? ` · 关键词：${config.sourceInputs.slice(0, 3).join("、")}` : ""}
                        {config.dailyLimit ? ` · 每日上限 ${config.dailyLimit}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        title="执行记录"
                        className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
                        onClick={() => void toggleRuns(config)}
                      >
                        {runsOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <History className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="立即执行"
                        className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
                        onClick={() => setExecuteTarget(config)}
                      >
                        <Rocket className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="编辑"
                        className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
                        onClick={() => openEdit(config)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                        onClick={() => setDeleteTarget(config)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <V2GhostButton
                        icon={config.status === "enabled" ? Pause : Play}
                        loading={actingId === config.id}
                        onClick={() => void handleToggle(config)}
                      >
                        {config.status === "enabled" ? "暂停" : "启用"}
                      </V2GhostButton>
                    </div>
                  </div>

                  {/* 执行记录展开 */}
                  {runsOpen && (
                    <div className="border-t border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-5 py-4">
                      {runsLoading ? (
                        <div className="py-4 text-center">
                          <SkeletonList rows={5} />
                        </div>
                      ) : runs.length === 0 ? (
                        <p className="py-2 text-sm text-[var(--kaypal-v3-muted)]">
                          还没有执行记录
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {runs.slice(0, 10).map((run) => (
                          <Fragment key={run.id}>
                            <div
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-[var(--kaypal-v3-soft-ink)]">
                                {run.startedAt
                                  ? new Date(run.startedAt).toLocaleString("zh-CN")
                                  : ""}
                              </span>
                              <span className="text-[var(--kaypal-v3-muted)]">
                                候选 {run.candidateCount ?? "-"} · 触达 {run.contactedCount ?? "-"} · 进 CRM {run.crmCapturedCount ?? "-"}
                              </span>
                              <V2StatusChip
                                tone={
                                  run.status === "success"
                                    ? "success"
                                    : run.status === "failed"
                                      ? "danger"
                                      : "accent"
                                }
                              >
                                {run.status === "success"
                                  ? "完成"
                                  : run.status === "failed"
                                    ? "失败"
                                    : run.status === "partial"
                                      ? "部分完成"
                                      : run.status}
                              </V2StatusChip>
                            </div>
                            {/* P1-2：回退来源如实展示（RPA 失败→回退旧链路时不让用户误以为 RPA 成功） */}
                            {run.fallback &&
                              run.fallback.attempted &&
                              run.fallback.source === "legacy-adapter" && (
                                <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                                  ⚠ RPA 执行失败（{run.fallback.reasonCode ?? "未知原因"}），已回退本地适配器
                                </p>
                              )}
                          </Fragment>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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

      {/* 编辑弹窗 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">编辑获客任务</h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setEditTarget(null)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <V2Field label="任务名称" required>
                <V2Input
                  value={editForm.taskName}
                  onChange={(e) => setEditForm((p) => ({ ...p, taskName: e.target.value }))}
                />
              </V2Field>
              <V2Field label="关键词/来源" hint="一行一个">
                <V2Textarea
                  rows={3}
                  value={editForm.sourceInputs}
                  onChange={(e) => setEditForm((p) => ({ ...p, sourceInputs: e.target.value }))}
                />
              </V2Field>
              <div className="grid grid-cols-2 gap-4">
                <V2Field label="排除关键词" hint="含这些词的不触达">
                  <V2Textarea
                    rows={2}
                    value={editForm.excludeKeywords}
                    onChange={(e) => setEditForm((p) => ({ ...p, excludeKeywords: e.target.value }))}
                  />
                </V2Field>
                <V2Field label="昵称黑名单" hint="这些人跳过不碰">
                  <V2Textarea
                    rows={2}
                    value={editForm.blacklistNicknames}
                    onChange={(e) => setEditForm((p) => ({ ...p, blacklistNicknames: e.target.value }))}
                  />
                </V2Field>
              </div>
              <V2Field label="评论话术" hint="一行一条，随机选用">
                <V2Textarea
                  rows={3}
                  value={editForm.commentTemplates}
                  onChange={(e) => setEditForm((p) => ({ ...p, commentTemplates: e.target.value }))}
                />
              </V2Field>
              <V2Field label="私信话术" hint="一行一条">
                <V2Textarea
                  rows={3}
                  value={editForm.privateMessageTemplates}
                  onChange={(e) => setEditForm((p) => ({ ...p, privateMessageTemplates: e.target.value }))}
                />
              </V2Field>
              <div className="grid grid-cols-2 gap-4">
                <V2Field label="每日上限">
                  <V2Input
                    type="number"
                    min={1}
                    value={editForm.dailyLimit}
                    onChange={(e) => setEditForm((p) => ({ ...p, dailyLimit: Number(e.target.value) }))}
                  />
                </V2Field>
                <V2Field label="单人上限" hint="同一个人最多触达几次">
                  <V2Input
                    type="number"
                    min={1}
                    value={editForm.perTargetLimit}
                    onChange={(e) => setEditForm((p) => ({ ...p, perTargetLimit: Number(e.target.value) }))}
                  />
                </V2Field>
                <V2Field label="发送方式">
                  <V2Select
                    value={editForm.riskMode}
                    onChange={(e) => setEditForm((p) => ({ ...p, riskMode: e.target.value as GrowthRiskMode }))}
                  >
                    {RISK_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </V2Select>
                </V2Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <V2Field label="定时启动" hint="每天固定时间自动跑">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                      checked={editForm.scheduleEnabled}
                      onChange={(e) => setEditForm((p) => ({ ...p, scheduleEnabled: e.target.checked }))}
                    />
                    <V2Input
                      type="time"
                      value={editForm.beginTime}
                      disabled={!editForm.scheduleEnabled}
                      onChange={(e) => setEditForm((p) => ({ ...p, beginTime: e.target.value }))}
                    />
                  </div>
                </V2Field>
                <V2Field label="去重" hint="触达过的人不再重复触达">
                  <label className="flex h-9 items-center gap-2 text-sm text-[var(--kaypal-v3-soft-ink)]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                      checked={editForm.deduplicate}
                      onChange={(e) => setEditForm((p) => ({ ...p, deduplicate: e.target.checked }))}
                    />
                    不重复触达同一个人
                  </label>
                </V2Field>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <V2GhostButton onClick={() => setEditTarget(null)}>取消</V2GhostButton>
              <V2PrimaryButton icon={Save} loading={savingEdit} onClick={handleSaveEdit}>
                {savingEdit ? "正在保存..." : "保存修改"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">删除获客任务？</h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              「{deleteTarget.taskName}」将被删除，执行记录保留。这个操作不能撤销。
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

      {/* 立即执行确认弹窗 */}
      {executeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">立即执行获客任务？</h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              「{executeTarget.taskName}」会现在开始找客户并触达（每日上限 {executeTarget.dailyLimit} 人）。
              发送方式：{RISK_OPTIONS.find((r) => r.value === executeTarget.riskMode)?.label || executeTarget.riskMode}。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <V2GhostButton onClick={() => setExecuteTarget(null)}>取消</V2GhostButton>
              <V2PrimaryButton icon={Rocket} loading={executing} onClick={handleExecute}>
                {executing ? "正在启动..." : "确认执行"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
