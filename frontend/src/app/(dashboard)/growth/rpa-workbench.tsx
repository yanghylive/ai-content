"use client";

import { useConfirm } from "@/hooks/use-confirm";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CirclePause,
  CirclePlay,
  ClipboardList,
  Eye,
  Hammer,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "@/components/iconpark";
import {
  V2Section,
  V2StatusChip,
  V2PrimaryButton,
  V2GhostButton,
  V2DangerButton,
  V2EmptyState,
  V2Field,
  V2Input,
  V2Select,
  V2Textarea,
} from "@/components/v2/ui-kit";
import {
  RPA_PLATFORM_LABELS,
  RPA_STATUS_META,
  cancelRpaExecution,
  createRpaExecution,
  fetchRpaCapabilities,
  fetchRpaExecution,
  fetchRpaExecutions,
  finalizeRpaExecution,
  manualTakeoverRpaExecution,
  pauseRpaExecution,
  replyToComment,
  resumeRpaExecution,
  type RpaAccountProbe,
  type RpaCapabilityRow,
  type RpaExecutionRecord,
  type RpaReplyCommentInput,
} from "@/lib/api/rpa";
import { toPublicError } from "@/lib/public-error";
import {
  fetchExposureAccounts,
  type ExposureAccount,
} from "@/lib/api/growth";

/** 平台模式选项（与后端 driverActionForMode 对应；search-account/manual-import 后端无独立 action 映射，移除避免创建后失败） */
const MODE_OPTIONS = [
  { value: "keyword", label: "关键词发现" },
  { value: "video-link", label: "视频链接" },
  { value: "target-account", label: "目标账号" },
  // P2 复核：推荐流独立模式（快手推荐流入口，与关键词搜索解耦）
  { value: "recommended", label: "推荐流发现" },
];

function formatTime(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function ActionChip({
  action,
  supported,
  reason,
}: {
  action: string;
  supported: boolean;
  reason?: string;
}) {
  const labelMap: Record<string, string> = {
    "discover-keyword": "关键词发现",
    "discover-account-works": "账号作品发现",
    "discover-recommended": "推荐流发现",
    "read-comments": "读评论",
    "reply-comment": "回复评论",
    "send-direct-message": "私信触达",
  };
  const label = labelMap[action] ?? action;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
        supported
          ? "border-[var(--kaypal-v3-success-border)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]"
          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface)] text-[var(--kaypal-v3-muted)]"
      }`}
      title={supported ? "支持" : reason ?? "不支持"}
    >
      {supported ? "✓" : "—"} {label}
    </span>
  );
}

export function RpaWorkbenchPage() {
  const [capabilities, setCapabilities] = useState<RpaCapabilityRow[]>([]);
  const [executions, setExecutions] = useState<RpaExecutionRecord[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [accountProbes, setAccountProbes] = useState<Record<string, RpaAccountProbe>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RpaExecutionRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [caps, runs] = await Promise.all([
        fetchRpaCapabilities(),
        fetchRpaExecutions(50),
      ]);
      setCapabilities(caps);
      setExecutions(runs);
      setError(null);
    } catch (err) {
      setError(toPublicError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>, okMessage: string) => {
      setBusyId(id);
      try {
        await action();
        flash(okMessage);
        await refresh();
        if (detail?.id === id) setDetail(await fetchRpaExecution(id));
      } catch (err) {
        flash(toPublicError(err));
      } finally {
        setBusyId(null);
      }
    },
    [refresh, detail, flash],
  );

  const readyPlatforms = useMemo(
    () => capabilities.filter((item) => item.runtimeReady),
    [capabilities],
  );

  const statusCount = useMemo(() => {
    const count: Record<string, number> = {};
    for (const run of executions) {
      count[run.status] = (count[run.status] ?? 0) + 1;
    }
    return count;
  }, [executions]);

  return (
    <div className="kx-view flex min-w-0 flex-col gap-4">
      {/* 统一页头 */}
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">统一 RPA 工作台</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            六平台浏览器自动化执行记录与人工接管（状态机逐步留痕）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <V2GhostButton onClick={() => void refresh()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </V2GhostButton>
          <V2GhostButton onClick={() => setShowReply(true)}>
            <MessageSquareText className="mr-1.5 h-4 w-4" />
            回复评论
          </V2GhostButton>
          <V2PrimaryButton onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            新建执行任务
          </V2PrimaryButton>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--kaypal-v3-danger-border)] bg-[var(--kaypal-v3-danger-soft)] px-4 py-3 text-sm text-[var(--kaypal-v3-danger)]">
          加载失败：{error}
        </div>
      )}

      {/* 能力总览 */}
      <V2Section
        title="六平台 RPA 能力"
        description="浏览器会话就绪的平台可执行发现/读评论；回复评论仅支持逐条人工确认，私信触达尚未接入"
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-[var(--kaypal-v3-muted)]">
            加载中…
          </div>
        ) : capabilities.length === 0 ? (
          <V2EmptyState
            icon={Activity}
            title="暂无平台能力数据"
            description="平台能力信息暂不可用"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {capabilities.map((cap) => (
              <div
                key={cap.platform}
                className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface)] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                    {RPA_PLATFORM_LABELS[cap.platform] ?? cap.platform}
                  </span>
                  <V2StatusChip
                    tone={cap.runtimeReady ? "success" : "muted"}
                  >
                    {cap.runtimeReady ? "会话就绪" : "会话未就绪"}
                  </V2StatusChip>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {cap.actions.map((action) => (
                    <ActionChip
                      key={action.action}
                      action={action.action}
                      supported={action.supported}
                      reason={action.unavailableReason}
                    />
                  ))}
                </div>
                <AccountProbeBox
                  platform={cap.platform}
                  onProbe={(probe) => setAccountProbes((prev) => ({ ...prev, [cap.platform]: probe }))}
                />
                {!cap.runtimeReady && (
                  <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
                    需在本地浏览器登录对应平台账号后自动就绪
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </V2Section>

      {/* 执行记录 */}
      <V2Section
        title="RPA 执行记录"
        description={`共 ${executions.length} 条 · ${Object.entries(statusCount)
          .map(([status, count]) => `${RPA_STATUS_META[status as keyof typeof RPA_STATUS_META]?.label ?? status} ${count}`)
          .join(" · ")}`}
        action={
          <span className="text-xs text-[var(--kaypal-v3-muted)]">
            最近 50 条
          </span>
        }
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-[var(--kaypal-v3-muted)]">
            加载中…
          </div>
        ) : executions.length === 0 ? (
          <V2EmptyState
            icon={ClipboardList}
            title="暂无执行记录"
            description="创建执行任务或运行获客任务后，RPA 步骤状态机将在这里留痕"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--kaypal-v3-border)] text-xs text-[var(--kaypal-v3-muted)]">
                  <th className="px-3 py-2 font-medium">平台</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">模式</th>
                  <th className="px-3 py-2 font-medium">步骤</th>
                  <th className="px-3 py-2 font-medium">开始时间</th>
                  <th className="px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((run) => {
                  const meta = RPA_STATUS_META[run.status] ?? {
                    label: run.status,
                    tone: "default" as const,
                  };
                  return (
                    <tr
                      key={run.id}
                      className="border-b border-[var(--kaypal-v3-border)] last:border-0 hover:bg-[var(--kaypal-v3-surface)]"
                    >
                      <td className="px-3 py-2.5 font-medium text-[var(--kaypal-v3-ink)]">
                        {RPA_PLATFORM_LABELS[run.platform] ?? run.platform}
                      </td>
                      <td className="px-3 py-2.5">
                        <V2StatusChip tone={meta.tone}>{meta.label}</V2StatusChip>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--kaypal-v3-soft-ink)]">
                        {run.mode}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--kaypal-v3-soft-ink)]">
                        {(run.steps?.length ?? 0)} 步
                        {run.resumeStep && (
                          <span className="ml-1 text-xs text-[var(--kaypal-v3-warning)]">
                            断点:{run.resumeStep}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[var(--kaypal-v3-muted)]">
                        {formatTime(run.startedAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <V2GhostButton
                            className="!px-2 !py-1 !text-xs"
                            onClick={() => void openDetail(run.id, setDetail, setBusyId, flash)}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            详情
                          </V2GhostButton>
                          {run.status === "running" && (
                            <>
                              <V2GhostButton
                                className="!px-2 !py-1 !text-xs"
                                disabled={busyId === run.id}
                                onClick={() =>
                                  void runAction(run.id, () => pauseRpaExecution(run.id), "已暂停")
                                }
                              >
                                <CirclePause className="mr-1 h-3.5 w-3.5" />
                                暂停
                              </V2GhostButton>
                              <V2GhostButton
                                className="!px-2 !py-1 !text-xs"
                                disabled={busyId === run.id}
                                onClick={() =>
                                  void runAction(run.id, () => manualTakeoverRpaExecution(run.id), "已转人工接管")
                                }
                              >
                                <Hammer className="mr-1 h-3.5 w-3.5" />
                                接管
                              </V2GhostButton>
                            </>
                          )}
                          {run.status === "paused" && (
                            <V2GhostButton
                              className="!px-2 !py-1 !text-xs"
                              disabled={busyId === run.id}
                              onClick={() =>
                                void runAction(run.id, () => resumeRpaExecution(run.id), "已恢复执行")
                              }
                            >
                              <CirclePlay className="mr-1 h-3.5 w-3.5" />
                              恢复
                            </V2GhostButton>
                          )}
                          {(run.status === "running" || run.status === "paused") && (
                            <V2DangerButton
                              className="!px-2 !py-1 !text-xs"
                              disabled={busyId === run.id}
                              onClick={() =>
                                void runAction(run.id, () => cancelRpaExecution(run.id), "已取消")
                              }
                            >
                              <XCircle className="mr-1 h-3.5 w-3.5" />
                              取消
                            </V2DangerButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </V2Section>

      {/* 详情弹层 */}
      {detail && (
        <DetailModal
          detail={detail}
          busy={busyId === detail.id}
          onClose={() => setDetail(null)}
          onAction={(action) => {
            if (action === "pause")
              return runAction(detail.id, () => pauseRpaExecution(detail.id), "已暂停");
            if (action === "resume")
              return runAction(detail.id, () => resumeRpaExecution(detail.id), "已恢复");
            if (action === "cancel")
              return runAction(detail.id, () => cancelRpaExecution(detail.id), "已取消");
            if (action === "takeover")
              return runAction(
                detail.id,
                () => manualTakeoverRpaExecution(detail.id),
                "已转人工接管",
              );
            if (action === "finalize-success")
              return runAction(
                detail.id,
                () => {
                  // 复核#4-3：成功终态必须带执行证据——从已有步骤/指纹提取；
                  // 无任何证据时前端直接拒绝（后端同样 400 拦截）
                  const evidence: Array<{ type: string; label: string; url?: string; createdAt: string }> = [];
                  const successStep = (detail.steps ?? []).find(
                    (step) => step.status === "success",
                  );
                  if (successStep?.evidenceUrl) {
                    evidence.push({
                      type: "rpa-step",
                      label: successStep.stepName,
                      url: successStep.evidenceUrl,
                      createdAt: new Date().toISOString(),
                    });
                  }
                  if (detail.pageFingerprint) {
                    evidence.push({
                      type: "rpa-fingerprint",
                      label: detail.pageFingerprint.slice(0, 16),
                      createdAt: new Date().toISOString(),
                    });
                  }
                  if (evidence.length === 0) {
                    return Promise.reject(
                      new Error(
                        "缺少执行证据（截图/页面指纹/成功步骤），无法标记成功；请先执行任务或标记失败/取消",
                      ),
                    );
                  }
                  return finalizeRpaExecution(detail.id, {
                    status: "success",
                    reasonCode: "ok",
                    evidence,
                  });
                },
                "已完成回读（带证据）",
              );
            return Promise.resolve();
          }}
        />
      )}

      {/* 回复评论弹层（人工确认式触达） */}
      {showReply && (
        <ReplyModal
          capabilities={capabilities}
          onClose={() => setShowReply(false)}
          onFlash={flash}
        />
      )}

      {/* 创建弹层 */}
      {showCreate && (
        <CreateModal
          capabilities={capabilities}
          readyPlatforms={readyPlatforms}
          onClose={() => setShowCreate(false)}
          onCreated={async (input) => {
            try {
              const created = await createRpaExecution(input);
              setShowCreate(false);
              flash(`任务已创建（session=${created.sessionId}）`);
              await refresh();
            } catch (err) {
              flash(toPublicError(err));
            }
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-4 z-[100] max-w-sm rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-panel-bg)] px-4 py-3 text-sm text-[var(--kaypal-v3-ink)] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/** 打开详情（提取成独立函数避免在 JSX 里写 async） */
async function openDetail(
  id: string,
  setDetail: (v: RpaExecutionRecord) => void,
  setBusyId: (v: string | null) => void,
  flash: (m: string) => void,
) {
  setBusyId(id);
  try {
    setDetail(await fetchRpaExecution(id));
  } catch (err) {
    flash(toPublicError(err));
  } finally {
    setBusyId(null);
  }
}

/* ============ 详情弹层 ============ */

function DetailModal({
  detail,
  busy,
  onClose,
  onAction,
}: {
  detail: RpaExecutionRecord;
  busy: boolean;
  onClose: () => void;
  onAction: (action: string) => Promise<void>;
}) {
  const meta = RPA_STATUS_META[detail.status] ?? {
    label: detail.status,
    tone: "default" as const,
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-panel-bg)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--kaypal-v3-ink)]">
              {RPA_PLATFORM_LABELS[detail.platform] ?? detail.platform} · 执行详情
            </span>
            <V2StatusChip tone={meta.tone}>{meta.label}</V2StatusChip>
          </div>
          <V2GhostButton className="!px-2 !py-1 !text-xs" onClick={onClose}>
            关闭
          </V2GhostButton>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="执行 ID" value={detail.id} />
            <Info label="会话 ID" value={detail.sessionId ?? "-"} />
            <Info label="模式" value={detail.mode} />
            <Info label="账号" value={detail.accountId ?? "-"} />
            <Info label="Driver" value={detail.driverVersion ?? "-"} />
            <Info label="Run ID" value={detail.runId ?? "-"} />
            <Info label="开始时间" value={formatTime(detail.startedAt)} />
            <Info label="结束时间" value={formatTime(detail.endedAt)} />
          </div>

          {detail.userMessage && (
            <div className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)]">
              {detail.userMessage}
            </div>
          )}
          {detail.reasonCode && (
            <div className="rounded-lg border border-[var(--kaypal-v3-danger-border)] bg-[var(--kaypal-v3-danger-soft)] px-3 py-2 text-sm text-[var(--kaypal-v3-danger)]">
              原因码：{detail.reasonCode}
              {detail.nextAction ? ` · 下一步：${detail.nextAction}` : ""}
            </div>
          )}
          {detail.technicalMessage && (
            <div className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface)] px-3 py-2 text-xs text-[var(--kaypal-v3-muted)]">
              技术信息：{detail.technicalMessage}
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              步骤时间线（{(detail.steps?.length ?? 0)}）
            </h3>
            {!detail.steps?.length ? (
              <p className="text-sm text-[var(--kaypal-v3-muted)]">暂无步骤</p>
            ) : (
              <ol className="space-y-2">
                {detail.steps.map((step, index) => (
                  <li
                    key={`${step.stepName}-${index}`}
                    className="flex items-start gap-2 rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface)] px-3 py-2"
                  >
                    <span
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                        step.status === "success"
                          ? "bg-[var(--kaypal-v3-success)]"
                          : step.status === "failed"
                            ? "bg-[var(--kaypal-v3-danger)]"
                            : "bg-[var(--kaypal-v3-warning)]"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                          {step.stepName}
                          {typeof step.sequenceNo === "number" && (
                            <span className="ml-2 text-xs text-[var(--kaypal-v3-muted)]">
                              #{step.sequenceNo}
                              {typeof step.attempt === "number" && step.attempt > 1
                                ? ` · 第${step.attempt}次`
                                : ""}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-[var(--kaypal-v3-muted)]">
                          {formatTime(step.occurredAt)}
                        </span>
                      </div>
                      {step.message && (
                        <p className="mt-0.5 text-xs text-[var(--kaypal-v3-soft-ink)]">
                          {step.message}
                        </p>
                      )}
                      {step.reasonCode && (
                        <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                          原因码：{step.reasonCode}
                        </p>
                      )}
                      {step.resultHash && (
                        <p className="mt-0.5 break-all font-mono text-11 text-[var(--kaypal-v3-muted)]">
                          结果 hash {step.resultHash.slice(0, 24)}…
                        </p>
                      )}
                      {step.evidenceUrl && (
                        <a
                          href={step.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-block text-xs text-[var(--kaypal-v3-primary)] underline"
                        >
                          证据
                        </a>
                      )}
                      {step.pageFingerprint && (
                        <p className="mt-0.5 break-all font-mono text-11 text-[var(--kaypal-v3-muted)]">
                          指纹 {step.pageFingerprint.slice(0, 32)}…
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {detail.pageFingerprint && (
            <div className="break-all rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface)] px-3 py-2 font-mono text-11 text-[var(--kaypal-v3-muted)]">
              页面指纹 {detail.pageFingerprint.slice(0, 48)}…
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--kaypal-v3-border)] pt-4">
            {detail.status === "running" && (
              <>
                <V2GhostButton
                  className="!px-2 !py-1 !text-xs"
                  disabled={busy}
                  onClick={() => void onAction("pause")}
                >
                  <CirclePause className="mr-1 h-3.5 w-3.5" />
                  暂停
                </V2GhostButton>
                <V2GhostButton
                  className="!px-2 !py-1 !text-xs"
                  disabled={busy}
                  onClick={() => void onAction("takeover")}
                >
                  <Hammer className="mr-1 h-3.5 w-3.5" />
                  人工接管
                </V2GhostButton>
              </>
            )}
            {detail.status === "paused" && (
              <V2GhostButton
                className="!px-2 !py-1 !text-xs"
                disabled={busy}
                onClick={() => void onAction("resume")}
              >
                <CirclePlay className="mr-1 h-3.5 w-3.5" />
                恢复
              </V2GhostButton>
            )}
            {(detail.status === "running" || detail.status === "paused") && (
              <V2DangerButton
                className="!px-2 !py-1 !text-xs"
                disabled={busy}
                onClick={() => void onAction("cancel")}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                取消
              </V2DangerButton>
            )}
            {detail.status === "running" && (
              <V2PrimaryButton
                className="!px-2 !py-1 !text-xs"
                disabled={busy}
                onClick={() => void onAction("finalize-success")}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                确认结果
              </V2PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-[var(--kaypal-v3-muted)]">{label}</span>
      <span className="mt-0.5 block break-all text-[var(--kaypal-v3-soft-ink)]">
        {value}
      </span>
    </div>
  );
}

/* ============ 创建弹层 ============ */

function CreateModal({
  capabilities,
  readyPlatforms,
  onClose,
  onCreated,
}: {
  capabilities: RpaCapabilityRow[];
  readyPlatforms: RpaCapabilityRow[];
  onClose: () => void;
  onCreated: (input: {
    platform: string;
    accountId: string;
    mode: string;
    keyword?: string;
    sourceUrl?: string;
    targetId?: string;
  }) => Promise<void>;
}) {
  const [platform, setPlatform] = useState(
    readyPlatforms[0]?.platform ?? capabilities[0]?.platform ?? "",
  );
  const [accountId, setAccountId] = useState("");
  const [mode, setMode] = useState("keyword");
  const [keyword, setKeyword] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [targetId, setTargetId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<RpaAccountProbe | null>(null);
  const [accounts, setAccounts] = useState<ExposureAccount[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  // 账号选择器：已授权账号列表（不允许随意输入任意账号 ID 执行）
  const [accountsError, setAccountsError] = useState(false);
  useEffect(() => {
    void fetchExposureAccounts()
      .then((list) => {
        setAccounts(list);
        setAccountsError(false);
      })
      // 前端审计第 1 项：账号列表请求失败 → 阻断（置错误态），
      // 不置空开放手动输入任意账号 ID
      .catch(() => setAccountsError(true));
  }, []);

  const platformAccounts = accounts.filter((a) => a.platform === platform);

  // 平台切换时：若当前账号不在该平台授权列表，自动选中首个（收敛手动输入）
  useEffect(() => {
    if (
      platformAccounts.length > 0 &&
      !platformAccounts.some((a) => a.accountId === accountId)
    ) {
      setAccountId(platformAccounts[0].accountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, accounts]);

  const runProbe = async (): Promise<RpaAccountProbe | null> => {
    if (!platform || !accountId.trim()) {
      setLocalError("请先选择平台并填写账号 ID");
      return null;
    }
    setProbing(true);
    setLocalError(null);
    try {
      const caps = await fetchRpaCapabilities(platform, accountId.trim());
      const first = caps.find((c) => c.platform === platform);
      const result = first?.accountProbe ?? null;
      setProbe(result);
      return result;
    } catch (err) {
      setLocalError(toPublicError(err));
      return null;
    } finally {
      setProbing(false);
    }
  };

  const submit = async () => {
    if (!platform) {
      setLocalError("请选择平台");
      return;
    }
    if (!accountId.trim()) {
      setLocalError("请选择或填写账号 ID（平台登录账号标识）");
      return;
    }
    // 账号授权收紧：有纳管账号时只能使用已授权账号（不允许自由输入任意账号）
    if (
      platformAccounts.length > 0 &&
      !platformAccounts.some((a) => a.accountId === accountId.trim())
    ) {
      setLocalError(
        "只能使用已纳管的授权账号执行（当前账号不在列表中，请从下拉框选择）",
      );
      return;
    }
    if (mode === "keyword" && !keyword.trim()) {
      setLocalError("关键词发现需要填写关键词");
      return;
    }
    if (mode === "video-link" && !sourceUrl.trim()) {
      setLocalError("视频链接模式需要填写内容页 URL（打开读评论区）");
      return;
    }
    if (mode === "target-account" && !targetId.trim()) {
      setLocalError("目标账号模式需要填写目标账号标识");
      return;
    }
    // P1-1：创建前账号级预检（未登录/验证码/风控直接阻止，不等到提交后报错）
    const currentProbe =
      probe && probe.accountId === accountId.trim()
        ? probe
        : await runProbe();
    if (!currentProbe) return;
    if (!currentProbe.loggedIn) {
      setLocalError(
        `账号 ${accountId.trim()} 未登录（${currentProbe.reasonCode ?? "not_logged_in"}），请先在本地浏览器登录后重试`,
      );
      return;
    }
    if (currentProbe.captchaRequired || currentProbe.riskControl) {
      setLocalError(
        currentProbe.captchaRequired
          ? "账号当前需完成验证码，转人工处理（禁止自动绕过）"
          : "账号被风控拦截，转人工处理",
      );
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      await onCreated({
        platform,
        accountId: accountId.trim(),
        mode,
        keyword: keyword.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
        targetId: targetId.trim() || undefined,
      });
    } catch (err) {
      setLocalError(toPublicError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-panel-bg)] shadow-xl">
        <div className="border-b border-[var(--kaypal-v3-border)] px-5 py-4">
          <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
            新建 RPA 执行任务
          </h3>
          <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
            创建后立即执行首个动作并落证据；不支持的平台/动作会被拒绝创建
          </p>
        </div>
        <div className="space-y-4 p-5">
          <V2Field label="平台" required>
            <V2Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {capabilities.map((cap) => (
                <option key={cap.platform} value={cap.platform}>
                  {RPA_PLATFORM_LABELS[cap.platform] ?? cap.platform}
                  {cap.runtimeReady ? "（会话就绪）" : "（会话未就绪）"}
                </option>
              ))}
            </V2Select>
          </V2Field>
          <V2Field
            label="账号 ID"
            required
            hint="平台账号标识，用于打开浏览器会话；提交前自动预检登录态/风控"
          >
            <div className="flex items-center gap-2">
              <V2Select
                value={
                  platformAccounts.some((a) => a.accountId === accountId)
                    ? accountId
                    : platformAccounts.length > 0
                      ? ""
                      : "__manual__"
                }
                onChange={(e) =>
                  setAccountId(
                    e.target.value === "__manual__" ? "" : e.target.value,
                  )
                }
                className="flex-1"
              >
                {accountsError && (
                    <option value="">账号列表加载失败，请刷新重试</option>
                )}
                {!accountsError && platformAccounts.length === 0 && (
                  <option value="__manual__">暂无可选账号（需先纳管平台账号）</option>
                )}
                {platformAccounts.length > 0 && (
                  <option value="" disabled>
                    请选择已授权账号…
                  </option>
                )}
                {platformAccounts.map((a) => (
                  <option key={a.id} value={a.accountId}>
                    {a.name}（{a.accountId}）
                  </option>
                ))}
              </V2Select>
              {/* 仅列表为空且无错误时保留手动输入兜底（后端归属校验仍拦截未纳管账号） */}
              {!accountsError && platformAccounts.length === 0 && (
                <V2Input
                  className="!w-32"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="手动输入账号 ID"
                />
              )}
              <V2GhostButton
                className="!px-2 !py-1 !text-xs"
                onClick={() => void runProbe()}
                disabled={probing || submitting || !accountId.trim()}
              >
                {probing ? "预检中…" : "预检"}
              </V2GhostButton>
            </div>
            {platformAccounts.length > 0 && (
              <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                仅可使用已授权账号（{platformAccounts.length} 个）
              </p>
            )}
            {probe && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
                <V2StatusChip tone={probe.loggedIn ? "success" : "danger"}>
                  {probe.loggedIn ? "已登录" : "未登录"}
                </V2StatusChip>
                {probe.captchaRequired && (
                  <V2StatusChip tone="warning">需验证码</V2StatusChip>
                )}
                {probe.riskControl && (
                  <V2StatusChip tone="danger">风控拦截</V2StatusChip>
                )}
                {probe.loggedIn &&
                  !probe.captchaRequired &&
                  !probe.riskControl && (
                    <span className="text-[var(--kaypal-v3-muted)]">
                      {new Date(probe.checkedAt).toLocaleTimeString()} 探测 · 可创建任务
                    </span>
                  )}
                {probe.reasonCode && (
                  <span className="text-[var(--kaypal-v3-danger)]">
                    {probe.reasonCode}
                  </span>
                )}
              </div>
            )}
          </V2Field>
          <V2Field label="执行模式">
            <V2Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </V2Select>
          </V2Field>
          {mode === "keyword" && (
            <V2Field label="关键词" required hint="打开平台搜索页发现候选">
              <V2Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="如 装修 / 本地生活"
              />
            </V2Field>
          )}
          {mode === "video-link" && (
            <V2Field
              label="内容页 URL"
              required
              hint="打开视频/笔记详情页读取评论区（评论者 = 候选）"
            >
              <V2Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://www.douyin.com/video/..."
              />
            </V2Field>
          )}
          {mode === "target-account" && (
            <V2Field label="目标账号标识" required hint="账号主页作品发现">
              <V2Input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="账号 ID / sec_uid"
              />
            </V2Field>
          )}
          {localError && (
            <p className="text-sm text-[var(--kaypal-v3-danger)]">{localError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <V2GhostButton className="!px-2 !py-1 !text-xs" onClick={onClose} disabled={submitting}>
              取消
            </V2GhostButton>
            <V2PrimaryButton className="!px-2 !py-1 !text-xs" onClick={() => void submit()} disabled={submitting || accountsError}>
              {submitting ? "创建中…" : "创建并执行"}
            </V2PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ 回复评论弹层（人工确认式触达） ============ */

function ReplyModal({
  capabilities,
  onClose,
  onFlash,
}: {
  capabilities: RpaCapabilityRow[];
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const { confirm, modal } = useConfirm();
  // 初始平台取第一个就绪平台：下拉只渲染 runtimeReady 项，
  // 若取 capabilities[0]（可能未就绪）会导致显示与实际不一致，
  // 用户可能对未就绪/错误平台真实发送回复；全部未就绪时保持原行为
  const [platform, setPlatform] = useState(
    capabilities.find((cap) => cap.runtimeReady)?.platform ??
      capabilities[0]?.platform ??
      "",
  );
  const [accountId, setAccountId] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  // 前端审计第 2 项：关键词不再硬编码"装修"——用户输入，用于小红书目标定位
  const [keyword, setKeyword] = useState("");
  const [targetText, setTargetText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const buildInput = (dryRun: boolean): RpaReplyCommentInput => ({
    platform,
    accountId: accountId.trim(),
    contentUrl: contentUrl.trim(),
    keyword: keyword.trim(),
    targetText: targetText.trim(),
    replyText: replyText.trim(),
    dryRun,
  });

  const validate = () => {
    if (!platform || !accountId.trim() || !contentUrl.trim()) {
      setLocalError("请填写平台、账号 ID 与内容页 URL");
      return false;
    }
    if (!replyText.trim()) {
      setLocalError("请填写回复话术");
      return false;
    }
    // 前端审计第 2 项：目标评论必填——后端 P0-3 已删除"无目标发新评论"fallback，
    // 目标缺失会 parse_failed 阻断（不再允许"留空=发新评论"的误导语义）
    if (!targetText.trim()) {
      setLocalError("请填写目标评论文本（用于定位要回复的评论）");
      return false;
    }
    return true;
  };

  const previewRun = async () => {
    if (!validate()) return;
    setBusy(true);
    setLocalError(null);
    setPreview(null);
    try {
      const result = await replyToComment(buildInput(true));
      setPreview(result.message);
      onFlash("dry-run 预览完成（未发送）");
    } catch (err) {
      setLocalError(toPublicError(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmSend = async () => {
    if (!validate()) return;
    // 二次确认：真实发送到平台
    const ok = await confirm({ kind: "warning", title: "确认真实发送", description: "确认后将在该平台真实发送此条回复（不可撤回），是否继续？" });
    if (!ok) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const result = await replyToComment(buildInput(false));
      onFlash(result.sent ? "评论回复已发送" : result.message);
      setPreview(result.message);
    } catch (err) {
      setLocalError(toPublicError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      {modal}
      <div className="w-full max-w-lg rounded-xl border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-panel-bg)] shadow-xl">
        <div className="border-b border-[var(--kaypal-v3-border)] px-5 py-4">
          <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
            回复评论（人工确认式触达）
          </h3>
          <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
            先预览内容，确认后才会发送到平台
          </p>
        </div>
        <div className="space-y-4 p-5">
          <V2Field label="平台" required>
            <V2Select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {capabilities
                .filter((cap) => cap.runtimeReady)
                .map((cap) => (
                  <option key={cap.platform} value={cap.platform}>
                    {RPA_PLATFORM_LABELS[cap.platform] ?? cap.platform}
                  </option>
                ))}
            </V2Select>
          </V2Field>
          <V2Field label="账号 ID" required>
            <V2Input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="如 1 / ks-account-1"
            />
          </V2Field>
          <V2Field label="内容页 URL" required hint="评论区所在的笔记/视频详情页">
            <V2Input
              value={contentUrl}
              onChange={(e) => setContentUrl(e.target.value)}
              placeholder="https://www.xiaohongshu.com/explore/... 或 https://www.kuaishou.com/short-video/..."
            />
          </V2Field>
          <V2Field label="搜索关键词" hint="小红书读评论时用于会话内定位目标笔记（目标 URL 直开会被平台拦截）">
            <V2Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="如：装修 / 会员（小红书必填，其他平台可空）"
            />
          </V2Field>
          <V2Field label="目标评论" required hint="必填：按文本定位要回复的评论（缺失会阻断，不再支持发新评论）">
            <V2Input
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="如：怎么收费 / 请问桌子哪里买的"
            />
          </V2Field>
          <V2Field label="回复话术" required>
            <V2Textarea
              value={replyText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setReplyText(e.target.value)
              }
              placeholder="如：你好，看到你的评论，可以交流一下"
              rows={3}
            />
          </V2Field>
          {localError && (
            <p className="text-sm text-[var(--kaypal-v3-danger)]">{localError}</p>
          )}
          {preview && (
            <div className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface)] px-3 py-2 text-sm text-[var(--kaypal-v3-soft-ink)]">
              {preview}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <V2GhostButton
              className="!px-2 !py-1 !text-xs"
              onClick={onClose}
              disabled={busy}
            >
              关闭
            </V2GhostButton>
            <V2GhostButton
              className="!px-2 !py-1 !text-xs"
              onClick={() => void previewRun()}
              disabled={busy}
            >
              {busy ? "处理中…" : "预览（不发送）"}
            </V2GhostButton>
            <V2PrimaryButton
              className="!px-2 !py-1 !text-xs"
              onClick={() => void confirmSend()}
              disabled={busy}
            >
              {busy ? "处理中…" : "确认发送"}
            </V2PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ 账号级预检组件（P1-1：登录态/验证码/风控，替代"仅会话就绪"） ============ */

function AccountProbeBox({
  platform,
  onProbe,
}: {
  platform: string;
  onProbe: (probe: RpaAccountProbe) => void;
}) {
  const [accountId, setAccountId] = useState("1");
  const [probe, setProbe] = useState<RpaAccountProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const runProbe = async () => {
    if (!accountId.trim()) {
      setLocalError("请填写账号 ID");
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const caps = await fetchRpaCapabilities(platform, accountId.trim());
      const first = caps.find((c) => c.platform === platform);
      if (first?.accountProbe) {
        setProbe(first.accountProbe);
        onProbe(first.accountProbe);
      } else {
        setLocalError("该账号无探测结果（driver 可能不支持账号级预检）");
      }
    } catch (err) {
      setLocalError(toPublicError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-panel-bg)] p-2">
      <div className="flex items-center gap-2">
        <V2Input
          className="!w-24 !px-2 !py-1 !text-xs"
          value={accountId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccountId(e.target.value)}
          placeholder="账号 ID"
        />
        <V2GhostButton
          className="!px-2 !py-1 !text-xs"
          onClick={() => void runProbe()}
          disabled={busy}
        >
          {busy ? "探测中…" : "探测账号"}
        </V2GhostButton>
        {probe && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <V2StatusChip tone={probe.loggedIn ? "success" : "danger"}>
              {probe.loggedIn ? "已登录" : "未登录"}
            </V2StatusChip>
            {probe.captchaRequired && (
              <V2StatusChip tone="warning">需验证码</V2StatusChip>
            )}
            {probe.riskControl && (
              <V2StatusChip tone="danger">风控拦截</V2StatusChip>
            )}
            {probe.loggedIn && !probe.captchaRequired && !probe.riskControl && (
              <span className="text-[var(--kaypal-v3-muted)]">
                {new Date(probe.checkedAt).toLocaleTimeString()} 探测
              </span>
            )}
            {probe.reasonCode && (
              <span className="text-[var(--kaypal-v3-danger)]">
                {probe.reasonCode}
              </span>
            )}
          </div>
        )}
      </div>
      {localError && (
        <p className="mt-1 text-xs text-[var(--kaypal-v3-danger)]">{localError}</p>
      )}
    </div>
  );
}
