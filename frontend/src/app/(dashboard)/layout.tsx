"use client";
/* The legacy route metadata below remains as migration reference data. */
/* eslint-disable @next/next/no-img-element */

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Chip, Progress, Spinner, Textarea, cn } from "@heroui/react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "@/lib/toast";
import {
  authApi,
  kaypalApi,
  type AuthUser,
  type AuthTenantMembership,
  type KaypalBillingSnapshot,
  type KaypalProfile,
  type KaypalSubscription,
} from "@/lib/api/auth";
import { ElectronUpdateBanner } from "@/components/electron-update-banner";
import { SolutionRunContextBanner } from "./components/solution-run-context-banner";
import {
  approveSolutionManualTask,
  createSolutionRun,
  dryRunSolutionTaskRedfox,
  executeSolutionTaskRedfox,
  type SolutionRunRecord,
  type SolutionRunTaskRecord,
} from "@/lib/api/solutions";
import { toPublicError } from "@/lib/public-error";
import { RELEASE_NOTES, DESKTOP_APP_VERSION } from "@/lib/release-notes";
import { routeAliases } from "@/lib/route-config";
import { formatPlanLabel, formatCredits, getBillingPlan, hasUsableLocalSession } from "@/lib/dashboard-helpers";

const AUTH_PENDING_KEY = "ai-content-auth-pending";
const ACTIVE_TENANT_KEY = "ai_content_tenant_id";

function DashboardFooter({ appVersion }: { appVersion: string }) {
  // 优先读 electron 真实版本号（package.json），web 环境回退到写死常量
  const [version, setVersion] = useState(appVersion);
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { app?: { getVersion?: () => Promise<string> } } })
      .electronAPI;
    if (api?.app?.getVersion) {
      api.app
        .getVersion()
        .then((v) => {
          if (v) setVersion(v);
        })
        .catch(() => {});
    }
  }, []);
  const current = RELEASE_NOTES.find((r) => r.version === `v${version}`) ?? RELEASE_NOTES[0];
  return (
    <footer
      className="mt-auto flex min-w-0 flex-col gap-3 border-t border-divider px-4 py-6 text-12 text-default-500 sm:px-6 lg:flex-row lg:items-center lg:justify-between"
      aria-label="系统信息"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {/* 左下角品牌字标：浅色系统用黑字版，暗色系统用白字版 */}
        <img
          src="/brand/jiuzhang-wordmark-black.webp"
          alt="JIUZHANG AI"
          className="h-6 w-auto shrink-0 dark:hidden"
          draggable={false}
        />
        <img
          src="/brand/jiuzhang-wordmark-white.webp"
          alt="JIUZHANG AI"
          className="hidden h-6 w-auto shrink-0 dark:block"
          draggable={false}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono font-semibold text-foreground">
            {current.version}
          </span>
          <span className="text-default-400">·</span>
          <span>更新于 {current.date}</span>
          <span className="text-default-400">·</span>
          <span>检查新版本可获得最新能力</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="flat"
          color="primary"
          startContent={<RefreshCw size={14} />}
          onClick={() =>
            toast.success(`已是最新版本 ${current.version}`, {
              duration: 4000,
            })
          }
        >
          检查更新
        </Button>
        <Button
          as={Link}
          size="sm"
          variant="light"
          href="/release-notes"
          endContent={<ArrowRight size={14} />}
        >
          更新历史
        </Button>
      </div>
    </footer>
  );
}



type ToolEntryDefinition = {
  title: string;
  module: string;
  description: string;
  outputs: string[];
  resultHref: string;
  actionLabel?: string;
  available?: boolean;
};

type ToolResultAction = {
  label: string;
  href: string;
  detail: string;
};

const toolEntryDefinitions: Record<string, ToolEntryDefinition> = {
  "hot-topic-solution": {
    title: "热点选题",
    module: "情报中心",
    description: "看热点、找角度，把可执行选题沉淀到选题库。",
    outputs: ["热点情报", "选题库", "素材线索"],
    resultHref: "/intelligence/trends",
    actionLabel: "生成选题",
  },
  "industry-intel": {
    title: "行业情报",
    module: "情报中心",
    description: "按行业和关键词整理趋势、机会、风险和报告。",
    outputs: ["趋势情报", "行业报告", "行动建议"],
    resultHref: "/intelligence/industries",
    actionLabel: "生成情报",
  },
  "global-content-intel": {
    title: "出海趋势",
    module: "情报中心",
    description: "发现海外平台内容趋势，转成本地化选题和脚本方向。",
    outputs: ["海外趋势", "本地化选题", "参考素材"],
    resultHref: "/intelligence/trends",
    actionLabel: "发现趋势",
  },
  "competitor-account-radar": {
    title: "竞品账号",
    module: "情报中心",
    description: "分析对标账号、爆款栏目、增长异常和可复制打法。",
    outputs: ["对标账号", "竞品报告", "增长机会"],
    resultHref: "/intelligence/accounts",
    actionLabel: "分析竞品",
  },
  "low-follower-viral": {
    title: "低粉爆款",
    module: "情报中心",
    description: "发现低粉高互动内容，拆出冷启动更容易复制的模式。",
    outputs: ["爆款样本", "复刻选题", "机会判断"],
    resultHref: "/intelligence/viral",
    actionLabel: "挖掘爆款",
  },
  "viral-breakdown": {
    title: "爆款拆解",
    module: "情报中心",
    description: "拆作品结构、评论反馈和复刻建议。",
    outputs: ["结构拆解", "评论反馈", "复刻建议"],
    resultHref: "/intelligence/viral",
    actionLabel: "拆解爆款",
  },
  "brand-monitoring": {
    title: "品牌舆情",
    module: "情报中心",
    description: "监控品牌词、竞品词、负面风险和回应机会。",
    outputs: ["监控任务", "风险识别", "每日情报"],
    resultHref: "/intelligence/monitors",
    actionLabel: "开始监控",
  },
  "private-asset-extractor": {
    title: "素材提取",
    module: "素材与品牌",
    description: "从文件、链接、短视频和私域内容里提取素材与知识。",
    outputs: ["素材库", "知识库", "证据附件"],
    resultHref: "/content",
    actionLabel: "提取素材",
  },
  "creation-enhancement": {
    title: "内容生成",
    module: "内容运营",
    description: "围绕选题生成标题、正文、封面素材和发布草稿。",
    outputs: ["内容草稿", "素材建议", "发布草稿"],
    resultHref: "/content/articles",
    actionLabel: "生成内容",
  },
  "aigc-asset-factory": {
    title: "素材生成",
    module: "素材与品牌",
    description: "根据选题、产品和风格要求生成图片、封面和素材提示词。",
    outputs: ["图片素材", "素材提示词", "素材包"],
    resultHref: "/content",
    actionLabel: "生成素材",
  },
  "multi-platform-copy": {
    title: "多平台文案",
    module: "内容运营",
    description: "把一份原文改写成小红书、公众号、知乎、抖音等版本。",
    outputs: ["平台文案", "合规提示", "发布草稿"],
    resultHref: "/content/optimization",
    actionLabel: "改写文案",
    available: false,
  },
  "publish-compliance": {
    title: "发布风险检查",
    module: "发布中心",
    description: "发布前检查违禁词、风险表达和替代写法。",
    outputs: ["合规检查", "替代表达", "风险记录"],
    resultHref: "/compliance",
    actionLabel: "检查风险",
  },
  "kol-screening": {
    title: "达人筛选",
    module: "增长获客",
    description: "按投放目标、人设、内容质量和风险筛出可跟进达人。",
    outputs: ["候选达人", "匹配评分", "跟进任务"],
    resultHref: "/growth?view=acquisition",
    actionLabel: "筛选达人",
  },
  "account-diagnosis": {
    title: "账号健康",
    module: "增长获客",
    description: "诊断账号定位、内容节奏、互动质量、风险项和改进计划。",
    outputs: ["健康评分", "增长报告", "监控任务"],
    resultHref: "/growth?view=account-health",
    actionLabel: "开始诊断",
  },
  "comment-lead-solution": {
    title: "评论线索",
    module: "客户互动",
    description: "从评论里识别需求、投诉、购买意图和跟进机会。",
    outputs: ["评论洞察", "客户线索", "跟进建议"],
    resultHref: "/engagement/comment-insights",
    actionLabel: "提取线索",
  },
};

const redfoxTaskRunnableStatuses = new Set(["queued", "planned", "failed"]);
const redfoxTaskExecutableStatuses = new Set([
  "dry_run_ready",
  "approval_required",
  "failed",
]);
const manualTaskApprovableStatuses = new Set([
  "approval_required",
  "planned",
  "queued",
  "failed",
]);

type BusinessToolRunState = {
  phase: "idle" | "running" | "success" | "failed";
  message?: string;
  run?: SolutionRunRecord;
};

function businessToolPhaseMeta(phase: BusinessToolRunState["phase"]) {
  if (phase === "success") {
    return {
      label: "已生成",
      tone: "success" as const,
      description: "结果已生成，可以继续查看和保存。",
    };
  }
  if (phase === "running") {
    return {
      label: "生成中",
      tone: "primary" as const,
      description: "系统正在处理输入、生成结果并写入对应业务库。",
    };
  }
  if (phase === "failed") {
    return {
      label: "未完成",
      tone: "danger" as const,
      description: "本次生成失败，请调整目标后重新生成或查看记录。",
    };
  }
  return {
    label: "待生成",
    tone: "default" as const,
    description: "写一句目标后生成，结果会沉淀到当前业务模块。",
  };
}

function hrefWithRunId(href: string, runId?: string) {
  if (!runId) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}runId=${encodeURIComponent(
    runId,
  )}&source=business-tool-entry`;
}

function businessRunTaskProgress(run?: SolutionRunRecord) {
  if (!run?.tasks.length) {
    return { completed: 0, total: 0, percent: 0 };
  }
  const completed = run.tasks.filter((task) =>
    ["succeeded", "completed", "dry_run_ready", "approval_required"].includes(
      task.status,
    ),
  ).length;
  return {
    completed,
    total: run.tasks.length,
    percent: Math.round((completed / run.tasks.length) * 100),
  };
}

function buildToolResultActions(
  entry: ToolEntryDefinition,
  run?: SolutionRunRecord,
): ToolResultAction[] {
  return [
    {
      label: "打开结果区",
      href: hrefWithRunId(entry.resultHref, run?.id),
      detail: "查看这次生成沉淀到业务页的结果。",
    },
    {
      label: "查看生成记录",
      href: run
        ? `/tasks/runs?runId=${encodeURIComponent(run.id)}`
        : "/tasks/runs",
      detail: "看处理进度、失败原因和执行留痕。",
    },
    {
      label: "继续组合方案",
      href: "/solutions",
      detail: "需要跨情报、内容、线索、合规一起跑时再用组合方案。",
    },
  ];
}

function buildBusinessToolInput(
  toolCode: string,
  entry: ToolEntryDefinition,
  objective: string,
) {
  return {
    businessObjective: objective,
    query: objective,
    keyword: objective,
    keywords: objective
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8),
    platform: "all",
    platforms: ["全平台"],
    deliveryTarget: entry.outputs.join("、"),
    outputTarget: entry.resultHref,
    scenario: toolCode,
    source: "business-module-tool-entry",
  };
}

function canAutoRunRedfoxTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "redfox" &&
    redfoxTaskRunnableStatuses.has(task.status)
  );
}

function canAutoExecuteRedfoxTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "redfox" &&
    redfoxTaskExecutableStatuses.has(task.status)
  );
}

function canAutoApproveManualTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "manual" &&
    manualTaskApprovableStatuses.has(task.status)
  );
}

function isBackgroundDataServiceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /redfox|api key|key|required|数据服务|授权已失效|暂未开通|暂不可用|暂时不可达/i.test(
    message,
  );
}

function publicBusinessToolErrorMessage(error: unknown) {
  if (isBackgroundDataServiceError(error)) {
    return "系统数据服务暂时不可用，已为你保留可继续处理的任务结果。";
  }
  return toPublicError(error, "业务结果未生成，请调整目标后重试。");
}

async function generateBusinessToolRun({
  toolCode,
  entry,
  objective,
}: {
  toolCode: string;
  entry: ToolEntryDefinition;
  objective: string;
}) {
  const input = buildBusinessToolInput(toolCode, entry, objective);
  let currentRun = await createSolutionRun(toolCode, {
    trigger: "manual",
    source: "business-module-tool-entry",
    input,
    dryRun: false,
  });

  for (const originalTask of currentRun.tasks) {
    const task =
      currentRun.tasks.find((item) => item.id === originalTask.id) ||
      originalTask;

    if (canAutoRunRedfoxTask(task)) {
      let updatedTask = task;
      let estimatedCostPoints = 1;
      try {
        const preview = await dryRunSolutionTaskRedfox(currentRun.id, task.id, {
          input,
          estimatedCostPoints: 1,
        });
        currentRun = preview.run;
        updatedTask =
          currentRun.tasks.find((item) => item.id === task.id) || task;
        estimatedCostPoints = preview.redfoxRun.estimatedCostPoints || 1;
      } catch (error) {
        if (!isBackgroundDataServiceError(error)) {
          throw error;
        }
      }

      if (canAutoExecuteRedfoxTask(updatedTask)) {
        try {
          const executed = await executeSolutionTaskRedfox(
            currentRun.id,
            task.id,
            {
              input,
              estimatedCostPoints,
              approvalNote: "用户在业务模块直接生成结果。",
            },
          );
          currentRun = executed.run;
        } catch (error) {
          if (!isBackgroundDataServiceError(error)) {
            throw error;
          }
        }
      }
      continue;
    }

    if (canAutoApproveManualTask(task)) {
      const approved = await approveSolutionManualTask(currentRun.id, task.id, {
        approvalNote: "用户在业务模块直接生成结果时确认检查点。",
      });
      currentRun = approved.run;
    }
  }

  return currentRun;
}

function BusinessToolEntryPanel({
  toolCode,
  entry,
}: {
  toolCode: string;
  entry: ToolEntryDefinition;
}) {
  const [objective, setObjective] = React.useState("");
  const [runState, setRunState] = React.useState<BusinessToolRunState>({
    phase: "idle",
  });
  const canGenerate = entry.available !== false;

  React.useEffect(() => {
    setObjective("");
    setRunState({ phase: "idle" });
  }, [toolCode]);

  const handleGenerate = async () => {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective) {
      toast.error("先写一句你要的结果");
      return;
    }
    if (!canGenerate) {
      toast.error("这个能力还在建设中");
      return;
    }

    setRunState({ phase: "running", message: "正在生成业务结果" });
    try {
      const run = await generateBusinessToolRun({
        toolCode,
        entry,
        objective: trimmedObjective,
      });
      setRunState({
        phase: "success",
        message: "结果已生成，正在进入对应业务库。",
        run,
      });
      toast.success("业务结果已生成");
    } catch (error) {
      const message = publicBusinessToolErrorMessage(error);
      setRunState({ phase: "failed", message });
      toast.error(message);
    }
  };

  const phaseMeta = businessToolPhaseMeta(runState.phase);
  const taskProgress = businessRunTaskProgress(runState.run);
  const resultActions = buildToolResultActions(entry, runState.run);
  const generatedResultHref = hrefWithRunId(entry.resultHref, runState.run?.id);

  return (
    <section className="mb-4 rounded-[8px] border border-primary/20 bg-primary/5 p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip color="primary" variant="flat">
              当前场景
            </Chip>
            <span className="text-xs font-semibold text-primary">
              {entry.module}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-bold text-foreground">
            {entry.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-default-600">
            {entry.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {entry.outputs.map((output) => (
              <Chip key={output} size="sm" variant="flat">
                {output}
              </Chip>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-default-200 bg-content1 p-3">
          <Textarea
            label="你要什么结果"
            minRows={2}
            value={objective}
            placeholder={`例如：帮我${entry.title}，目标是...`}
            variant="bordered"
            isDisabled={!canGenerate || runState.phase === "running"}
            onValueChange={setObjective}
            classNames={{
              inputWrapper: "rounded-[8px] bg-background",
            }}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              color="primary"
              className="rounded-[8px] font-semibold"
              isDisabled={!canGenerate}
              isLoading={runState.phase === "running"}
              onPress={handleGenerate}
            >
              {canGenerate ? entry.actionLabel || "生成结果" : "建设中"}
            </Button>
            <Button
              as="a"
              href={generatedResultHref}
              variant="flat"
              className="rounded-[8px] font-semibold"
              endContent={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
            >
              打开结果区
            </Button>
          </div>
          {runState.message ? (
            <p
              className={cn("mt-3 text-xs leading-5", {
                "text-default-500": runState.phase === "running",
                "text-[var(--kaypal-v3-success)]": runState.phase === "success",
                "text-[var(--kaypal-v3-danger)]": runState.phase === "failed",
              })}
            >
              {runState.message}
            </p>
          ) : null}
          {runState.run ? (
            <Button
              as="a"
              href={`/tasks/runs?runId=${encodeURIComponent(runState.run.id)}`}
              size="sm"
              variant="light"
              className="mt-2 h-7 rounded-[6px] px-2 text-xs font-semibold"
            >
              查看本次生成记录
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-foreground">结果区</p>
              <p className="mt-1 text-xs leading-5 text-default-500">
                {phaseMeta.description}
              </p>
            </div>
            <Chip color={phaseMeta.tone} variant="flat">
              {phaseMeta.label}
            </Chip>
          </div>
          {runState.run ? (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-default-500">
                <span>
                  已处理 {taskProgress.completed}/{taskProgress.total} 个步骤
                </span>
                <span>{runState.run.progress}%</span>
              </div>
              <Progress
                aria-label="生成进度"
                className="max-w-full"
                color="success"
                size="sm"
                value={runState.run.progress || taskProgress.percent}
              />
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {entry.outputs.map((output) => (
              <div
                key={output}
                className="rounded-[8px] border border-default-200 bg-default-50 p-3"
              >
                <Chip
                  size="sm"
                  color={
                    runState.phase === "success"
                      ? "success"
                      : runState.phase === "running"
                        ? "primary"
                        : runState.phase === "failed"
                          ? "danger"
                          : "default"
                  }
                  variant="flat"
                >
                  {phaseMeta.label}
                </Chip>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {output}
                </p>
                <p className="mt-1 text-xs leading-5 text-default-500">
                  {runState.phase === "success"
                    ? "可继续打开结果区查看和处理。"
                    : "生成后会沉淀到对应业务位置。"}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4">
          <p className="text-sm font-bold text-foreground">下一步</p>
          <div className="mt-3 grid gap-2">
            {resultActions.map((action) => (
              <Button
                key={action.label}
                as="a"
                href={action.href}
                variant="flat"
                className="h-auto justify-start rounded-[8px] px-3 py-2 text-left"
                endContent={
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                }
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {action.label}
                  </span>
                  <span className="block whitespace-normal text-xs leading-5 text-default-500">
                    {action.detail}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<DashboardLayoutFallback />}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}
function DashboardLayoutFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex items-center gap-3 rounded-[8px] border border-divider bg-content1 px-4 py-3 shadow-sm">
        <Spinner size="sm" />
        <span className="text-14 leading-[22px] text-default-500">
          正在验证登录状态...
        </span>
      </div>
    </div>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [authLoading, setAuthLoading] = React.useState(true);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState<AuthUser | null>(null);
  const [tenantMemberships, setTenantMemberships] = React.useState<
    AuthTenantMembership[]
  >([]);
  const [activeTenantId, setActiveTenantId] = React.useState("");
  const [kaypalProfile, setKaypalProfile] =
    React.useState<KaypalProfile | null>(null);
  const [kaypalSubscription, setKaypalSubscription] =
    React.useState<KaypalSubscription | null>(null);
  const [kaypalBilling, setKaypalBilling] =
    React.useState<KaypalBillingSnapshot | null>(null);
  const [kaypalSyncRequired, setKaypalSyncRequired] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let redirectTimer: number | null = null;

    const redirectToLogin = () => {
      const search = searchParams.toString();
      const currentPath = `${pathname || "/"}${search ? `?${search}` : ""}`;
      const next = currentPath
        ? `?next=${encodeURIComponent(currentPath)}`
        : "";
      if (typeof window !== "undefined") {
        window.location.replace(`/login${next}`);
      } else {
        router.replace(`/login${next}`);
      }
    };

    if (typeof window !== "undefined") {
      redirectTimer = window.setTimeout(() => {
        if (!active) return;
        redirectToLogin();
      }, 6500);
    }

    const hasRecentAuthPending = () => {
      if (typeof window === "undefined") {
        return false;
      }

      const pendingAt = Number(
        window.sessionStorage.getItem(AUTH_PENDING_KEY) || "0",
      );
      if (!pendingAt) {
        return false;
      }

      return Date.now() - pendingAt < 10000;
    };

    const clearAuthPending = () => {
      if (typeof window === "undefined") {
        return;
      }

      window.sessionStorage.removeItem(AUTH_PENDING_KEY);
    };

    const wait = (ms: number) =>
      new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });

    const checkCurrentUser = () =>
      Promise.race<AuthUser>([
        authApi.me(),
        new Promise<AuthUser>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("auth-check-timeout")),
            3000,
          );
        }),
      ]);

    const fetchCurrentUser = async () => {
      const attempts = hasRecentAuthPending()
        ? [0, 250, 1000]
        : [0, 250];

      for (const delay of attempts) {
        if (delay > 0) {
          await wait(delay);
        }

        try {
          const user = await checkCurrentUser();
          if (hasUsableLocalSession(user)) {
            clearAuthPending();
            return user;
          }
        } catch {
          // 继续重试，直到耗尽次数
        }
      }

      clearAuthPending();
      throw new Error("auth-check-failed");
    };

    const ensureAuth = async () => {
      let authenticated = false;
      try {
        const user = await fetchCurrentUser();
        if (!active) {
          return;
        }
        authenticated = true;
        setCurrentUser(user);
      } catch {
        if (!active) {
          return;
        }
        redirectToLogin();
        return;
      } finally {
        if (active && authenticated) {
          if (redirectTimer) {
            window.clearTimeout(redirectTimer);
          }
          setAuthLoading(false);
        }
      }
    };

    ensureAuth();

    return () => {
      active = false;
      if (redirectTimer) {
        window.clearTimeout(redirectTimer);
      }
    };
  }, [pathname, router, searchParams]);

  React.useEffect(() => {
    let active = true;
    if (!currentUser) {
      setKaypalProfile(null);
      setKaypalSubscription(null);
      setKaypalBilling(null);
      setKaypalSyncRequired(false);
      return () => {
        active = false;
      };
    }

    const refreshKaypalState = () => {
      Promise.all([
        kaypalApi
          .profile()
          .then((value) => ({ value, error: null }))
          .catch((error) => ({ value: null, error })),
        kaypalApi
          .subscription()
          .then((value) => ({ value, error: null }))
          .catch((error) => ({ value: null, error })),
        kaypalApi
          .billing()
          .then((value) => ({ value, error: null }))
          .catch((error) => ({ value: null, error })),
      ]).then(([profile, subscription, billing]) => {
        if (!active) return;
        setKaypalProfile(profile.value);
        setKaypalSubscription(subscription.value);
        setKaypalBilling(billing.value);
        const errors = [profile.error, subscription.error, billing.error]
          .map((error) =>
            error instanceof Error ? error.message : String(error || ""),
          )
          .join(" ");
        setKaypalSyncRequired(
          /授权|过期|失效|未登录|unauthorized|401/i.test(errors),
        );
      });
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshKaypalState();
    };

    refreshKaypalState();
    const refreshTimer = window.setInterval(refreshKaypalState, 30_000);
    window.addEventListener("focus", refreshKaypalState);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshKaypalState);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [currentUser]);

  React.useEffect(() => {
    if (!currentUser) {
      setTenantMemberships([]);
      setActiveTenantId("");
      return;
    }
    let active = true;
    void authApi
      .tenants()
      .then((memberships) => {
        if (!active) return;
        setTenantMemberships(memberships);
        const stored = window.localStorage.getItem(ACTIVE_TENANT_KEY) || "";
        const selected = memberships.some((item) => item.tenantId === stored)
          ? stored
          : memberships.length === 1
            ? memberships[0].tenantId
            : "";
        setActiveTenantId(selected);
        if (selected) window.localStorage.setItem(ACTIVE_TENANT_KEY, selected);
      })
      .catch(() => {
        if (active) setTenantMemberships([]);
      });
    return () => {
      active = false;
    };
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await authApi.logout();
      toast.success("已退出登录");
    } catch {
      toast.error("退出失败，请稍后重试");
    } finally {
      setLoggingOut(false);
      router.replace("/login");
      router.refresh();
    }
  };
  const displayName =
    kaypalProfile?.displayName ||
    currentUser?.name ||
    currentUser?.username ||
    "当前用户";
  const localPlan = currentUser?.kaypalPlanExpired
    ? null
    : currentUser?.kaypalPlan;
  const planLabel = kaypalSyncRequired
    ? "需登录"
    : formatPlanLabel(
        kaypalSubscription?.plan || getBillingPlan(kaypalBilling) || localPlan,
      );
  const creditLabel = kaypalSyncRequired
    ? "需登录"
    : formatCredits(kaypalBilling?.balance?.balance);
  const activeToolCode = searchParams.get("tool") || "";
  const activeToolEntry = toolEntryDefinitions[activeToolCode] || null;
  const activeRunId = (searchParams.get("runId") || "").trim();

  // 旧路径别名重定向（admin → capabilities/apps 等迁移映射；APK 内不再渲染 admin 后台）
  React.useEffect(() => {
    if (authLoading || !pathname) return;
    const alias = routeAliases[pathname];
    if (alias && alias !== pathname) {
      router.replace(alias);
    }
  }, [pathname, authLoading, router]);

  if (authLoading) {
    return <DashboardLayoutFallback />;
  }
  return (
    <AppShell
      footer={
        <>
          <DashboardFooter appVersion={DESKTOP_APP_VERSION} />
          <ElectronUpdateBanner />
        </>
      }
      user={{
        displayName,
        planLabel,
        creditLabel,
        avatarUrl: kaypalProfile?.avatarUrl || undefined,
        onLogout: handleLogout,
        loggingOut,
      }}
      tenant={{
        memberships: tenantMemberships,
        activeTenantId,
        onChange: (tenantId) => {
          if (!tenantId) return;
          window.localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
          setActiveTenantId(tenantId);
          window.location.reload();
        },
      }}
    >
      {activeRunId ? <SolutionRunContextBanner runId={activeRunId} /> : null}
      {activeToolEntry ? (
        <BusinessToolEntryPanel
          entry={activeToolEntry}
          toolCode={activeToolCode}
        />
      ) : null}
      {children}
    </AppShell>
  );
}
