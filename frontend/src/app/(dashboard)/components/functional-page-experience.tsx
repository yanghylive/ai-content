"use client";

import Link from "next/link";
import { V2StatusChip } from "@/components/v2/ui-kit";
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { type TaskExperienceStep } from "./task-experience-flow";

type FunctionalPageAction = {
  title: string;
  description: string;
  href?: string;
  label?: string;
  icon?: LucideIcon;
};

type FunctionalPageExperienceProps = {
  title: string;
  description: string;
  steps: TaskExperienceStep[];
  actionTitle?: string;
  actionDescription?: string;
  actions?: FunctionalPageAction[];
};

const defaultActions: FunctionalPageAction[] = [
  {
    title: "AI 辅助",
    description: "围绕当前页面生成候选内容、补全字段或解释失败原因。",
    icon: Bot,
  },
  {
    title: "执行前检查",
    description: "先检查账号、素材、权限、对象和风险，再允许进入执行。",
    icon: ShieldCheck,
  },
  {
    title: "异常处理",
    description: "失败时展示原因、影响范围、建议动作和可点击处理入口。",
    icon: RotateCcw,
  },
];

const stepToneByStatus: Record<
  NonNullable<TaskExperienceStep["status"]>,
  {
    icon: LucideIcon;
    label: string;
    tone: string;
    numberTone: string;
  }
> = {
  complete: {
    icon: CheckCircle2,
    label: "已完成",
    tone:
      "border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]",
    numberTone: "text-[var(--kaypal-v3-success)]",
  },
  active: {
    icon: PlayCircle,
    label: "当前",
    tone:
      "border border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]",
    numberTone: "text-[var(--kaypal-v3-accent-ink)]",
  },
  blocked: {
    icon: TriangleAlert,
    label: "需处理",
    tone:
      "border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]",
    numberTone: "text-[var(--kaypal-v3-danger)]",
  },
  failed: {
    icon: TriangleAlert,
    label: "失败",
    tone:
      "border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]",
    numberTone: "text-[var(--kaypal-v3-danger)]",
  },
  pending: {
    icon: Clock3,
    label: "待处理",
    tone: "bg-default-100 text-default-600",
    numberTone: "text-default-400",
  },
};

export function FunctionalPageExperience({
  title,
  description,
  steps,
  actionTitle = "下一步操作",
  actionDescription = "这里才是可以点击的功能入口；上面的流程只说明做事顺序。",
  actions = defaultActions,
}: FunctionalPageExperienceProps) {
  return (
    <section
      aria-label="模块任务导览"
      className="rounded-[8px] border-small border-divider bg-background px-3 py-2 shadow-sm"
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <V2StatusChip tone="accent">流程</V2StatusChip>
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

        <div className="flex min-w-0 shrink-0 items-center gap-2 border-t border-divider pt-2 xl:w-[340px] xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
          <V2StatusChip tone="success">操作</V2StatusChip>
          <p className="sr-only">
            {actionTitle}：{actionDescription}
          </p>
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
            {actions.map((action) => {
              const IconComponent = action.icon || ClipboardCheck;
              if (!action.href) return null;
              return (
                <Link
                  key={action.title}
                  className="inline-flex shrink-0 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 text-sm font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                  href={action.href}
                >
                  <IconComponent aria-hidden="true" className="h-4 w-4" />
                  {action.label || action.title}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
