"use client";

import React from "react";
import Link from "next/link";
import { Button, Chip } from "@heroui/react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  ListChecks,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

export type TaskExperienceStepStatus =
  | "pending"
  | "active"
  | "complete"
  | "blocked"
  | "failed";

export type TaskExperienceStep = {
  title: string;
  description: string;
  status?: TaskExperienceStepStatus;
};

type TaskExperienceFlowProps = {
  title?: string;
  description?: string;
  steps?: TaskExperienceStep[];
  compact?: boolean;
  primaryHref?: string;
  primaryLabel?: string;
};

const defaultSteps: TaskExperienceStep[] = [
  {
    title: "创建任务",
    description: "先选择目标、素材、账号或客户对象。",
    status: "complete",
  },
  {
    title: "AI 辅助",
    description: "生成候选内容，人工勾选后再回填。",
    status: "active",
  },
  {
    title: "执行前检查",
    description: "检查账号、素材、权限、时间和平台限制。",
    status: "pending",
  },
  {
    title: "确认执行",
    description: "展示任务数、目标账号、内容预览和风险提醒。",
    status: "pending",
  },
  {
    title: "运行中",
    description: "用状态条和时间线展示当前处理对象。",
    status: "pending",
  },
  {
    title: "异常处理",
    description: "失败时给原因、影响范围和处理按钮。",
    status: "pending",
  },
  {
    title: "完成复盘",
    description: "沉淀结果、记录和可复用的新任务入口。",
    status: "pending",
  },
];

const stepToneByStatus: Record<
  TaskExperienceStepStatus,
  {
    icon: LucideIcon;
    label: string;
    numberTone: string;
    tone: string;
  }
> = {
  complete: {
    icon: CheckCircle2,
    label: "已完成",
    numberTone: "text-[var(--kaypal-v3-success)]",
    tone:
      "border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]",
  },
  active: {
    icon: PlayCircle,
    label: "当前",
    numberTone: "text-[var(--kaypal-v3-accent-ink)]",
    tone:
      "border border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]",
  },
  blocked: {
    icon: TriangleAlert,
    label: "需处理",
    numberTone: "text-[var(--kaypal-v3-danger)]",
    tone:
      "border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]",
  },
  failed: {
    icon: TriangleAlert,
    label: "失败",
    numberTone: "text-[var(--kaypal-v3-danger)]",
    tone:
      "border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]",
  },
  pending: {
    icon: Clock3,
    label: "待处理",
    numberTone: "text-default-400",
    tone: "bg-default-100 text-default-600",
  },
};

const actionIconByIndex = [ListChecks, Bot, ShieldCheck, ClipboardCheck, RotateCcw];

export function TaskExperienceFlow({
  title = "标准任务流程",
  description = "查看任务进度和下一步操作。",
  steps = defaultSteps,
  compact = false,
  primaryHref,
  primaryLabel = "开始任务",
}: TaskExperienceFlowProps) {
  return (
    <section
      aria-label="模块任务导览"
      className={[
        "rounded-[8px] border-small border-divider bg-background shadow-sm",
        compact ? "px-3 py-2" : "px-3 py-2",
      ].join(" ")}
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Chip color="primary" size="sm" variant="flat">
            流程
          </Chip>
          <h3
            className="shrink-0 text-small font-semibold text-default-900"
            title={description}
          >
            {title}
          </h3>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
            {steps.map((step, index) => {
              const status = step.status || "pending";
              const tone = stepToneByStatus[status];
              const IconComponent = tone.icon;
              return (
                <span
                  key={`${step.title}-${index}`}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-tiny ${tone.tone}`}
                  title={`${tone.label}：${step.description}`}
                >
                  <IconComponent aria-hidden="true" className="h-3.5 w-3.5" />
                  <span className={`font-semibold ${tone.numberTone}`}>
                    {index + 1}
                  </span>
                  {step.title}
                </span>
              );
            })}
          </div>
        </div>

        {primaryHref ? (
          <div className="flex min-w-0 shrink-0 items-center gap-2 border-t border-divider pt-2 xl:w-[260px] xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
            <Chip color="success" size="sm" variant="flat">
              操作
            </Chip>
            <Button
              as={Link}
              className="shrink-0 rounded-[8px] font-semibold"
              href={primaryHref}
              size="sm"
              startContent={React.createElement(actionIconByIndex[0], {
                "aria-hidden": true,
                className: "h-4 w-4",
              })}
              variant="flat"
            >
              {primaryLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
