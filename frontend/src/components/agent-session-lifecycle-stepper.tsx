"use client";

import React from "react";
import Link from "next/link";
import { Button, Chip } from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import type { AgentSession } from "@/lib/api/local-engine";
import { getAgentSessionVerificationState } from "@/lib/agent-session-verification";

type LifecycleStepStatus =
  | "pending"
  | "active"
  | "complete"
  | "failed"
  | "blocked";

type AgentSessionLifecycleStepperProps = {
  session: AgentSession;
  compact?: boolean;
  showActions?: boolean;
};

const sourceLabels: Record<AgentSession["source"], string> = {
  "agent-console": "任务记录",
  publishing: "发布中心",
  interaction: "客户互动",
  system: "系统任务",
  web: "网页指令",
};

const scopeLabels: Record<AgentSession["executionScope"], string> = {
  browser: "平台后台",
  desktop: "桌面协作",
  "local-files": "本机资料",
  mixed: "综合处理",
  remote: "远程协助",
};

const statusIcons: Record<LifecycleStepStatus, string> = {
  pending: "solar:clock-circle-linear",
  active: "solar:play-circle-linear",
  complete: "solar:check-circle-linear",
  failed: "solar:close-circle-linear",
  blocked: "solar:shield-warning-linear",
};

const statusTones: Record<LifecycleStepStatus, string> = {
  pending: "border-divider bg-background text-default-500",
  active: "border-primary-200 bg-primary-50 text-primary-700",
  complete: "border-success-200 bg-success-50 text-success-700",
  failed: "border-danger-200 bg-danger-50 text-danger-700",
  blocked: "border-warning-200 bg-warning-50 text-warning-700",
};

export function AgentSessionLifecycleStepper({
  session,
  compact = false,
  showActions = false,
}: AgentSessionLifecycleStepperProps) {
  const events = Array.isArray(session.events) ? session.events : [];
  const confirmations = Array.isArray(session.confirmations)
    ? session.confirmations
    : [];
  const verification = getAgentSessionVerificationState(session);
  const evidenceCount = verification.evidenceCount;
  const hasPendingConfirmation =
    session.status === "waiting_for_confirmation" ||
    confirmations.some((item) => item.status === "pending");
  const hasApprovedConfirmation = confirmations.some(
    (item) => item.status === "approved",
  );
  const hasRejectedConfirmation = confirmations.some(
    (item) => item.status === "rejected",
  );
  const requiresConfirmation =
    confirmations.length > 0 ||
    hasPendingConfirmation ||
    Boolean(session.resumeAction);
  const hasExecutionStarted =
    events.length > 0 ||
    session.status === "running" ||
    session.status === "completed" ||
    session.status === "failed" ||
    session.status === "cancelled";
  const isFailed =
    session.status === "failed" ||
    session.status === "cancelled" ||
    events.some((event) => event.level === "error");

  const confirmationStatus: LifecycleStepStatus = hasRejectedConfirmation
    ? "failed"
    : hasPendingConfirmation
      ? "active"
      : requiresConfirmation && (hasApprovedConfirmation || hasExecutionStarted)
        ? "complete"
        : requiresConfirmation
          ? "pending"
          : "complete";
  const executionStatus: LifecycleStepStatus = hasPendingConfirmation
    ? "pending"
    : isFailed
      ? "failed"
      : session.status === "running"
        ? "active"
        : session.status === "completed"
          ? "complete"
          : hasExecutionStarted
            ? "active"
            : "pending";
  const evidenceStatus: LifecycleStepStatus = verification.pendingVerification
    ? "blocked"
    : evidenceCount
      ? isFailed
        ? "blocked"
        : "complete"
      : isFailed
        ? "failed"
        : session.status === "completed" && !verification.requiresEvidence
          ? "complete"
          : hasExecutionStarted
            ? "active"
            : "pending";
  const outcomeStatus: LifecycleStepStatus = verification.pendingVerification
    ? "blocked"
    : session.status === "completed"
      ? "complete"
      : isFailed
        ? "failed"
        : hasPendingConfirmation
          ? "pending"
          : hasExecutionStarted
            ? "active"
            : "pending";

  const steps: Array<{
    label: string;
    detail: string;
    status: LifecycleStepStatus;
  }> = [
    {
      label: "创建意图",
      detail: `${sourceLabels[session.source] || session.source} · ${
        scopeLabels[session.executionScope] || "综合处理"
      }`,
      status: session.status === "draft" ? "active" : "complete",
    },
    {
      label: "审批确认",
      detail: requiresConfirmation
        ? hasPendingConfirmation
          ? "等待人工确认"
          : hasRejectedConfirmation
            ? "已拒绝继续"
            : hasApprovedConfirmation
              ? "已确认继续"
              : "等待确认生成"
        : "无需人工确认",
      status: confirmationStatus,
    },
    {
      label: "继续执行",
      detail:
        session.status === "running"
          ? "本机执行服务正在处理"
          : session.statusLabel || session.status,
      status: executionStatus,
    },
    {
      label: "结果留存",
      detail: evidenceCount
        ? `${evidenceCount} 条截图、过程记录或结果确认记录`
        : verification.pendingVerification
          ? "证据缺失：等待截图、过程记录或结果回执"
          : verification.requiresEvidence
            ? "等待截图、过程记录或结果确认记录"
            : "内部分析任务无需外部动作证据",
      status: evidenceStatus,
    },
    {
      label: "结果沉淀",
      detail:
        session.failureReason ||
        session.nextAction ||
        (verification.pendingVerification
          ? "执行已结束，补齐证据后才能核验完成"
          : session.completedAt
            ? "已完成并保留记录"
            : "等待最终结果"),
      status: outcomeStatus,
    },
  ];

  return (
    <section className="rounded-[8px] border-small border-divider bg-default-50 p-3">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-small font-semibold text-default-900">
              任务生命周期
            </p>
            <Chip
              color={verification.pendingVerification ? "warning" : "default"}
              size="sm"
              variant="flat"
            >
              {verification.pendingVerification
                ? "待核验"
                : session.statusLabel || session.status}
            </Chip>
            {session.resumeAction ? (
              <Chip color="warning" size="sm" variant="flat">
                审批后续跑
              </Chip>
            ) : null}
          </div>
          {!compact ? (
            <p className="mt-1 line-clamp-2 text-tiny leading-5 text-default-500">
              {session.title || session.instruction}
            </p>
          ) : null}
        </div>
        {showActions ? (
          <div className="flex flex-wrap gap-2">
            <Button
              as={Link}
	              href="/tasks/confirmations"
              size="sm"
              startContent={
                <Icon icon="solar:checklist-minimalistic-linear" />
              }
              variant="flat"
            >
              待我确认
            </Button>
            <Button
              as={Link}
	              href="/tasks/evidence"
              size="sm"
              startContent={<Icon icon="solar:folder-check-linear" />}
              variant="flat"
            >
	              结果留存
            </Button>
          </div>
        ) : null}
      </div>
      <div
        className={
          compact ? "grid gap-2 md:grid-cols-5" : "grid gap-3 lg:grid-cols-5"
        }
      >
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={[
              "rounded-[8px] border-small p-3",
              compact ? "min-h-[92px]" : "min-h-[112px]",
              statusTones[step.status],
            ].join(" ")}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-background/80">
                <Icon icon={statusIcons[step.status]} width={17} />
              </span>
              <span className="text-tiny font-semibold">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <p className="text-small font-semibold">{step.label}</p>
            <p className="mt-1 line-clamp-2 text-tiny leading-5 opacity-80">
              {step.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
