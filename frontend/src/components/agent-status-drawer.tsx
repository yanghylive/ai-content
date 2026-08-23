"use client";

import React from "react";
import Link from "next/link";
import { Button, Chip, Spinner, addToast } from "@heroui/react";
import { AgentSessionLifecycleStepper } from "@/components/agent-session-lifecycle-stepper";
import { Icon } from "@/components/lucide-icon-compat";
import {
  localEngineApi,
  type AgentSession,
  type AgentSessionEvent,
} from "@/lib/api/local-engine";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { getAgentSessionVerificationState } from "@/lib/agent-session-verification";

type BusyAction = "" | "continue" | "stop" | "export";

type AgentStatusDrawerProps = {
  session: AgentSession | null;
  onClose: () => void;
  onUpdated?: (session: AgentSession) => void | Promise<void>;
  recordHref?: (session: AgentSession) => string;
};

function normalizeSession(session: AgentSession): AgentSession {
  return {
    ...session,
    confirmations: Array.isArray(session.confirmations)
      ? session.confirmations
      : [],
    events: Array.isArray(session.events) ? session.events : [],
  };
}

function canFetchSession(session?: AgentSession | null) {
  return Boolean(session?.id && !session.id.startsWith("interaction-task:"));
}

function defaultRecordHref(session: AgentSession) {
  if (!session.id || session.id.startsWith("interaction-task:")) {
    return "/tasks/records";
  }
  return `/tasks/records?sessionId=${encodeURIComponent(session.id)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function statusColor(status: AgentSession["status"]) {
  if (status === "failed") return "danger" as const;
  if (status === "running") return "primary" as const;
  if (status === "waiting_for_confirmation") return "warning" as const;
  if (status === "completed") return "success" as const;
  return "default" as const;
}

function eventColor(level: AgentSessionEvent["level"]) {
  if (level === "error") return "danger" as const;
  if (level === "warning") return "warning" as const;
  if (level === "success") return "success" as const;
  return "default" as const;
}

function sourceLabel(value: AgentSession["source"]) {
  const labels: Record<AgentSession["source"], string> = {
    "agent-console": "任务历史",
    publishing: "发布中心",
    interaction: "客户互动",
    system: "系统任务",
    web: "网页指令",
  };
  return labels[value] || value;
}

function riskLabel(value: AgentSession["riskLevel"]) {
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  return "低风险";
}

function sessionTitle(session: AgentSession) {
  return commercialDisplayText(
    session.title || session.instruction || "任务记录",
    "任务记录",
  );
}

function statusText(session: AgentSession) {
  const fallback: Record<AgentSession["status"], string> = {
    draft: "已创建",
    running: "执行中",
    waiting_for_confirmation: "待我确认",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  };
  return commercialDisplayText(
    session.statusLabel || fallback[session.status],
    fallback[session.status],
  );
}

function failureDetails(session: AgentSession) {
  return [
    session.failureReason,
    session.nextAction,
    ...session.events
      .filter((event) => event.level === "error")
      .map((event) => `${event.title || "任务异常"}：${event.message}`),
  ].filter(Boolean);
}

export function AgentStatusDrawer({
  session,
  onClose,
  onUpdated,
  recordHref,
}: AgentStatusDrawerProps) {
  const [current, setCurrent] = React.useState<AgentSession | null>(
    session ? normalizeSession(session) : null,
  );
  const [loading, setLoading] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState<BusyAction>("");
  const panelRef = React.useRef<HTMLElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const isOpen = current !== null;

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!isOpen) return;

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
          ].join(","),
        ),
      ).filter(
        (element) =>
          element.getAttribute("aria-disabled") !== "true" &&
          element.getClientRects().length > 0,
      );
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    };
  }, [isOpen]);

  React.useEffect(() => {
    let cancelled = false;
    const next = session ? normalizeSession(session) : null;
    setCurrent(next);
    if (!next || !canFetchSession(next)) return;

    setLoading(true);
    localEngineApi
      .agentSession(next.id)
      .then((detail) => {
        if (cancelled) return;
        setCurrent(normalizeSession(detail));
      })
      .catch(() => {
        if (!cancelled) setCurrent(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!current) return null;

  const canControl = canFetchSession(current);
  const evidenceEvents = current.events.filter((event) => event.evidence);
  const verification = getAgentSessionVerificationState(current);
  const failures = failureDetails(current);
  const hasPendingConfirmation =
    current.status === "waiting_for_confirmation" ||
    current.confirmations.some((item) => item.status === "pending");
  const canContinue =
    canControl &&
    !hasPendingConfirmation &&
    current.status !== "completed" &&
    current.status !== "cancelled";
  const canStop =
    canControl &&
    (current.status === "running" ||
      current.status === "waiting_for_confirmation" ||
      current.status === "draft");
  const lifecycleSession = hasPendingConfirmation
    ? {
        ...current,
        status: "waiting_for_confirmation" as const,
        statusLabel: "待我确认",
      }
    : current;
  const statusBoard = [
    {
      key: "ready",
      title: "准备",
      active:
        current.status === "draft" ||
        current.status === "waiting_for_confirmation",
      detail:
        current.status === "waiting_for_confirmation"
          ? "等待你确认后继续"
          : "任务已准备",
    },
    {
      key: "running",
      title: "执行中",
      active: current.status === "running",
      detail: current.status === "running" ? "正在处理" : "待运行",
    },
    {
      key: "success",
      title: verification.pendingVerification ? "待核验" : "成功",
      active: current.status === "completed" && !hasPendingConfirmation,
      detail:
        current.status === "completed" && !hasPendingConfirmation
          ? verification.pendingVerification
            ? "证据缺失，暂不计为成功"
            : "已完成"
          : hasPendingConfirmation
            ? "等待确认"
            : "等待完成",
    },
    {
      key: "error",
      title: "异常",
      active: current.status === "failed" || failures.length > 0,
      detail: failures[0]
        ? commercialDisplayText(failures[0], "待处理")
        : "暂无异常",
    },
  ];

  const updateCurrent = async (next: AgentSession) => {
    const normalized = normalizeSession(next);
    setCurrent(normalized);
    await onUpdated?.(normalized);
  };

  const continueSession = async () => {
    if (!canControl) return;
    if (hasPendingConfirmation) {
      addToast({
        title: "请先完成确认",
        description: "待确认动作处理完成后才能继续。",
        color: "warning",
      });
      return;
    }
    if (current.blockers?.length) {
      addToast({
        title: "继续前需处理",
        description: commercialDisplayText(current.blockers[0].nextAction),
        color: "warning",
      });
      return;
    }
    setBusyAction("continue");
    try {
      const next = await localEngineApi.continueAgentSession(current.id, {
        instruction: "继续执行当前任务",
        operator: "当前用户",
      });
      await updateCurrent(next);
      addToast({ title: "已继续执行", color: "success" });
    } catch (error) {
      addToast({
        title: "继续失败",
        description: toPublicError(error, "任务未能继续，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setBusyAction("");
    }
  };

  const stopSession = async () => {
    if (!canControl) return;
    setBusyAction("stop");
    try {
      const next = await localEngineApi.stopAgentSession(current.id);
      await updateCurrent(next);
      addToast({ title: "已停止执行", color: "warning" });
    } catch (error) {
      addToast({
        title: "停止失败",
        description: toPublicError(error, "任务未能停止，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setBusyAction("");
    }
  };

  const exportSession = async () => {
    if (!canControl) return;
    setBusyAction("export");
    try {
      const result = await localEngineApi.exportAgentSessionEvidence(
        current.id,
      );
      downloadTextFile(result.filename, result.content, result.mimeType);
      addToast({
        title: "记录已导出",
        description: `${result.evidenceCount} 条结果资料，${result.timelineCount} 条处理记录`,
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "导出失败",
        description: toPublicError(error, "任务记录未能导出，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setBusyAction("");
    }
  };

  return (
    <div className="dashboard-overlay agent-status-overlay fixed inset-0 z-50 flex justify-end bg-black/30">
      <button
        aria-label="关闭 AI 专家状态"
        className="dashboard-overlay__backdrop absolute inset-0 cursor-default"
        type="button"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        aria-labelledby="agent-status-drawer-title"
        aria-modal="true"
        className="dashboard-overlay__panel agent-status-drawer relative flex h-full w-full max-w-[620px] flex-col border-l border-divider bg-background shadow-2xl"
        role="dialog"
        tabIndex={-1}
      >
        <div className="dashboard-overlay__header flex items-start justify-between gap-3 border-b border-divider p-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Chip
                color={
                  hasPendingConfirmation
                    ? "warning"
                    : verification.pendingVerification
                      ? "warning"
                      : statusColor(current.status)
                }
                size="sm"
                variant="flat"
              >
                {hasPendingConfirmation
                  ? "待我确认"
                  : verification.pendingVerification
                    ? "待核验"
                    : statusText(current)}
              </Chip>
              <Chip
                color={current.riskLevel === "high" ? "danger" : "warning"}
                size="sm"
                variant="flat"
              >
                {riskLabel(current.riskLevel)}
              </Chip>
              <Chip size="sm" variant="flat">
                {sourceLabel(current.source)}
              </Chip>
            </div>
            <p className="text-12 font-medium text-[#f759ab]">AI 专家</p>
            <h3
              id="agent-status-drawer-title"
              className="line-clamp-2 text-base font-bold leading-6 text-default-900"
            >
              {sessionTitle(current)}
            </h3>
            <p className="mt-1 text-tiny text-default-500">
              更新于 {formatDateTime(current.updatedAt)}
            </p>
          </div>
          <Button
            ref={closeButtonRef}
            aria-label="关闭 AI 专家状态"
            isIconOnly
            size="sm"
            variant="light"
            onPress={onClose}
          >
            <Icon icon="solar:close-circle-linear" width={18} />
          </Button>
        </div>

        <div className="dashboard-overlay__body flex-1 overflow-auto p-4">
          {loading ? <Spinner label="读取状态..." size="sm" /> : null}
          <div className="grid gap-4">
            <section className="dashboard-overlay__section rounded-[8px] border border-divider bg-background p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-14 font-semibold text-foreground">
                  任务状态
                </h4>
                <Button
                  as={Link}
                  href={(recordHref || defaultRecordHref)(current)}
                  size="sm"
                  variant="flat"
                >
                  查看记录
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {statusBoard.map((item) => (
                  <div
                    key={item.key}
                    className={`min-h-[86px] rounded-[6px] border p-3 ${
                      item.active
                        ? "border-[#f759ab] bg-[#fff0f6] dark:bg-[#f759ab]/15"
                        : "border-divider bg-default-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-13 font-semibold text-foreground">
                        {item.title}
                      </span>
                      <Chip
                        color={item.active ? "primary" : "default"}
                        size="sm"
                        variant="flat"
                      >
                        {item.active ? "当前" : "待定"}
                      </Chip>
                    </div>
                    <p className="mt-2 line-clamp-2 text-12 leading-5 text-default-500">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="dashboard-overlay__section rounded-[8px] border-small border-divider p-3">
              <h4 className="mb-3 text-small font-semibold text-default-900">
                当前进度
              </h4>
              <AgentSessionLifecycleStepper
                compact
                showActions
                session={lifecycleSession}
              />
              {verification.pendingVerification ? (
                <p className="mt-3 rounded-small border-small border-warning-200 bg-warning-50 p-2 text-small text-warning-700">
                  执行已结束，但缺少必需的截图、过程记录或结果回执，补齐前保持待核验。
                </p>
              ) : null}
              {current.nextAction ? (
                <p className="mt-3 rounded-small bg-default-50 p-2 text-small text-default-600">
                  下一步：{commercialDisplayText(current.nextAction)}
                </p>
              ) : null}
              {failures.length ? (
                <div className="mt-3 rounded-small border-small border-danger-200 bg-danger-50 p-2">
                  <p className="text-tiny font-semibold text-danger-700">
                    待处理原因
                  </p>
                  <ul className="mt-1 grid gap-1 text-small text-danger-700">
                    {failures.slice(0, 4).map((detail, index) => (
                      <li key={`${current.id}-failure-${index}`}>
                        {commercialDisplayText(detail)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="dashboard-overlay__section rounded-[8px] border-small border-divider p-3">
              <h4 className="text-small font-semibold text-default-900">
                待确认动作
              </h4>
              <div className="mt-3 grid gap-2">
                {current.confirmations.length ? (
                  current.confirmations.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-small border-small border-divider bg-default-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={
                            item.riskLevel === "high" ? "danger" : "warning"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {item.riskLevel === "high" ? "高风险" : "中风险"}
                        </Chip>
                        <Chip size="sm" variant="flat">
                          {item.status === "pending" ? "待我确认" : "已处理"}
                        </Chip>
                      </div>
                      <p className="mt-2 text-small font-semibold text-default-800">
                        {commercialDisplayText(item.title)}
                      </p>
                      <p className="mt-1 line-clamp-3 text-tiny text-default-500">
                        {commercialDisplayText(
                          item.description || item.actionLabel,
                        )}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-small text-default-500">
                    当前没有待确认动作。
                  </p>
                )}
              </div>
            </section>

            <section className="dashboard-overlay__section rounded-[8px] border-small border-divider p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h4 className="text-small font-semibold text-default-900">
                  处理记录
                </h4>
                <Chip size="sm" variant="flat">
                  {current.events.length} 条
                </Chip>
                <Chip
                  color={verification.pendingVerification ? "warning" : "success"}
                  size="sm"
                  variant="flat"
                >
                  结果资料 {verification.evidenceCount}
                </Chip>
              </div>
              <div className="grid gap-2">
                {current.events.length ? (
                  current.events.slice(0, 8).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-small border-small border-divider bg-default-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={
                            (hasPendingConfirmation ||
                              verification.pendingVerification) &&
                            event.level === "success"
                              ? "warning"
                              : eventColor(event.level)
                          }
                          size="sm"
                          variant="flat"
                        >
                          {event.level === "error"
                            ? "异常"
                            : event.level === "warning"
                              ? "提醒"
                              : event.level === "success"
                                ? hasPendingConfirmation
                                  ? "待确认"
                                  : verification.pendingVerification
                                    ? "待核验"
                                    : "完成"
                                : "记录"}
                        </Chip>
                        <span className="text-tiny text-default-500">
                          {formatDateTime(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-small font-semibold text-default-800">
                        {commercialDisplayText(event.title)}
                      </p>
                      <p className="mt-1 text-tiny leading-5 text-default-500">
                        {commercialDisplayText(event.message)}
                      </p>
                      {event.evidence ? (
                        <p className="mt-2 break-all rounded-small bg-background px-2 py-1 text-tiny text-default-600">
                          {commercialDisplayText(event.evidence.label)}：
                          {commercialDisplayText(event.evidence.value)}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-small text-default-500">暂无处理记录。</p>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="dashboard-overlay__footer flex flex-wrap gap-2 border-t border-divider p-4">
          <Button
            color="primary"
            isDisabled={!canContinue}
            isLoading={busyAction === "continue"}
            startContent={
              busyAction === "continue" ? null : (
                <Icon icon="solar:play-circle-linear" />
              )
            }
            variant="flat"
            onPress={continueSession}
          >
            继续
          </Button>
          <Button
            color="danger"
            isDisabled={!canStop}
            isLoading={busyAction === "stop"}
            startContent={
              busyAction === "stop" ? null : (
                <Icon icon="solar:stop-circle-linear" />
              )
            }
            variant="flat"
            onPress={stopSession}
          >
            停止
          </Button>
          <Button
            isDisabled={!canControl || evidenceEvents.length === 0}
            isLoading={busyAction === "export"}
            startContent={
              busyAction === "export" ? null : (
                <Icon icon="solar:download-minimalistic-linear" />
              )
            }
            variant="flat"
            onPress={exportSession}
          >
            导出记录
          </Button>
        </div>
      </aside>
    </div>
  );
}
