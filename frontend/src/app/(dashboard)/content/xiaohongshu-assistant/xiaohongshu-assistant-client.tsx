"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Progress,
  Spinner,
  Switch,
  Textarea,
  Tooltip,
  addToast,
} from "@heroui/react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Images,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  agentWakerApi,
  type AgentWakerRun,
  type AgentWakerRunStatus,
} from "@/lib/api/agentwaker";
import { toPublicError } from "@/lib/public-error";

const STATUS_COLOR: Record<
  AgentWakerRunStatus,
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  draft: "default",
  running: "primary",
  waiting_for_confirmation: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "default",
};

const STEP_PROGRESS: Record<AgentWakerRun["currentStep"], number> = {
  input: 10,
  generation: 55,
  approval: 85,
  handoff: 100,
  failed: 100,
};

type FormState = {
  goal: string;
  brand: string;
  audience: string;
  product: string;
  keywords: string;
  sourceMaterials: string;
  generateCards: boolean;
};

type QuickStartPreset = Pick<
  FormState,
  | "goal"
  | "brand"
  | "audience"
  | "product"
  | "keywords"
  | "sourceMaterials"
  | "generateCards"
> & {
  title: string;
  description: string;
};

const initialForm: FormState = {
  goal: "",
  brand: "",
  audience: "",
  product: "",
  keywords: "",
  sourceMaterials: "",
  generateCards: true,
};

const QUICK_START_PRESETS: QuickStartPreset[] = [
  {
    title: "新品首发",
    description: "适合刚上架、需要快速拉起第一波真实体验型内容",
    goal: "为新品首发生成一篇真实体验型小红书笔记",
    brand: "JIUZHANG AI",
    audience: "一线城市 25-35 岁职场女性",
    product: "新品首发",
    keywords: "新品,体验,开箱,真实感,种草",
    sourceMaterials: "产品卖点：更快的内容起草速度\n核心感受：省时、省心、可控\n发布诉求：先建立信任，再引导咨询",
    generateCards: true,
  },
  {
    title: "复盘优化",
    description: "适合已有内容，要把表达和转化路径再提升一版",
    goal: "基于已有笔记复盘，生成更利于转化的新版本",
    brand: "JIUZHANG AI",
    audience: "内容运营和品牌增长团队",
    product: "内容复盘优化",
    keywords: "复盘,优化,转化,表达,效率",
    sourceMaterials: "现有内容表现：阅读有了，但咨询偏少\n优化目标：缩短理解路径，强化行动指令\n输出要求：保留事实，不夸张承诺",
    generateCards: false,
  },
  {
    title: "活动促活",
    description: "适合活动节点、限时权益、拉新促活场景",
    goal: "围绕活动节点生成一篇易转发、易参与的种草笔记",
    brand: "JIUZHANG AI",
    audience: "对优惠和效率敏感的年轻用户",
    product: "活动促活内容",
    keywords: "活动,限时,福利,参与,转发",
    sourceMaterials: "活动重点：限时权益、参与门槛低、步骤清晰\n表达要求：先讲利益点，再讲参与方式\n补充信息：避免复杂术语，减少跳步",
    generateCards: true,
  },
];

function splitList(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isActive(
  run: AgentWakerRun | null,
): run is AgentWakerRun & { status: "draft" | "running" } {
  return run?.status === "draft" || run?.status === "running";
}

function rememberRun(runId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("runId", runId);
  window.history.replaceState(null, "", url);
}

export function XiaohongshuAssistantClient() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [runs, setRuns] = useState<AgentWakerRun[]>([]);
  const [currentRun, setCurrentRun] = useState<AgentWakerRun | null>(null);
  const [roleAvailable, setRoleAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [executingRunId, setExecutingRunId] = useState("");
  const [historyBusyId, setHistoryBusyId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedRunIdRef = useRef("");

  const refresh = useCallback(async () => {
    const [roles, runResult] = await Promise.all([
      agentWakerApi.roles(),
      agentWakerApi.runs(20),
    ]);
    setRoleAvailable(
      roles.some(
        (role) => role.id === "xiaohongshu-operator" && role.available,
      ),
    );
    const channelRuns = runResult.runs.filter(
      (run) => run.role === "xiaohongshu-operator",
    );
    setRuns(channelRuns);
    return channelRuns;
  }, []);

  const currentRunId = currentRun?.runId;
  const activeRunId = isActive(currentRun) ? currentRun.runId : "";

  const applyPreset = (preset: QuickStartPreset) => {
    setForm({
      goal: preset.goal,
      brand: preset.brand,
      audience: preset.audience,
      product: preset.product,
      keywords: preset.keywords,
      sourceMaterials: preset.sourceMaterials,
      generateCards: preset.generateCards,
    });
    setAdvancedOpen(true);
  };

  const refreshView = useCallback(async () => {
    const items = await refresh();
    const targetId =
      currentRunId && items.some((item) => item.runId === currentRunId)
        ? currentRunId
        : items[0]?.runId;
    const detail = targetId ? await agentWakerApi.run(targetId) : null;
    selectedRunIdRef.current = detail?.runId || "";
    setCurrentRun(detail);
  }, [currentRunId, refresh]);

  useEffect(() => {
    let active = true;
    void refresh()
      .then(async (items) => {
        if (!active || !items[0]) return;
        const requestedRunId = new URLSearchParams(window.location.search).get(
          "runId",
        );
        const selected =
          items.find((item) => item.runId === requestedRunId) || items[0];
        const detail = await agentWakerApi.run(selected.runId);
        if (active) {
          selectedRunIdRef.current = detail.runId;
          setCurrentRun(detail);
        }
      })
      .catch((error) => {
        if (!active) return;
        addToast({
          title: "运营助理加载失败",
          description: toPublicError(error, "请检查服务连接后重试。"),
          color: "danger",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void agentWakerApi
        .run(activeRunId)
        .then((run) => {
          if (cancelled || selectedRunIdRef.current !== activeRunId) return;
          setCurrentRun(run);
          if (!isActive(run)) void refresh();
        })
        .catch(() => undefined);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRunId, refresh]);

  const canSubmit = useMemo(
    () => Boolean(form.goal.trim() && form.product.trim() && roleAvailable),
    [form.goal, form.product, roleAvailable],
  );

  const optionalFieldCount = useMemo(
    () =>
      [form.brand, form.audience, form.keywords, form.sourceMaterials].filter(
        (value) => value.trim(),
      ).length,
    [form.audience, form.brand, form.keywords, form.sourceMaterials],
  );

  const startExecution = (runId: string) => {
    if (executingRunId === runId) return;
    setExecutingRunId(runId);
    void agentWakerApi
      .executeRun(runId)
      .then((completed) => {
        if (selectedRunIdRef.current === runId) setCurrentRun(completed);
        void refresh();
        addToast({
          title: "笔记包已生成",
          description: "草稿和卡图已写入内容库，发布准备等待确认。",
          color: "success",
        });
      })
      .catch((error) => {
        addToast({
          title: "生成失败",
          description: toPublicError(error, "可在当前页面重试任务。"),
          color: "danger",
        });
        void agentWakerApi
          .run(runId)
          .then((run) => {
            if (selectedRunIdRef.current === runId) setCurrentRun(run);
          })
          .catch(() => undefined);
      })
      .finally(() => setExecutingRunId(""));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await agentWakerApi.createRun({
        role: "xiaohongshu-operator",
        workflow: "note-package",
        goal: form.goal.trim(),
        inputs: {
          brand: form.brand.trim(),
          audience: form.audience.trim(),
          product: form.product.trim(),
          keywords: splitList(form.keywords),
          sourceMaterials: splitList(form.sourceMaterials),
        },
        generateCards: form.generateCards,
      });
      selectedRunIdRef.current = created.runId;
      setCurrentRun(created);
      rememberRun(created.runId);
      setRuns((items) => [created, ...items]);
      startExecution(created.runId);
    } catch (error) {
      addToast({
        title: "生成失败",
        description: toPublicError(error, "请检查服务设置和角色信息后重试。"),
        color: "danger",
      });
      await refresh().catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const openRun = async (runId: string) => {
    const previousRunId = selectedRunIdRef.current;
    selectedRunIdRef.current = runId;
    setHistoryBusyId(runId);
    try {
      setCurrentRun(await agentWakerApi.run(runId));
      rememberRun(runId);
    } catch (error) {
      selectedRunIdRef.current = previousRunId;
      addToast({
        title: "任务读取失败",
        description: toPublicError(error, "请稍后重试。"),
        color: "danger",
      });
    } finally {
      setHistoryBusyId("");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[480px] items-center justify-center">
        <Spinner label="正在加载运营助理" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-3 border-b border-divider pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-12 font-medium text-default-500">
            <WandSparkles className="h-4 w-4" />
            AgentWaker / Ruby
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            小红书运营助理
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Chip
            color={roleAvailable ? "success" : "danger"}
            size="sm"
            startContent={
              roleAvailable ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )
            }
            variant="flat"
          >
            {roleAvailable ? "角色已就绪" : "角色不可用"}
          </Chip>
          <Tooltip content="刷新任务">
            <Button
              isIconOnly
              aria-label="刷新任务"
              size="sm"
              variant="light"
              onPress={() => void refreshView()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </header>

      <section className="rounded-[8px] border border-divider bg-background p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-12 font-medium text-default-500">
              <Sparkles className="h-4 w-4" />
              快速开始
            </div>
            <h2 className="text-14 font-semibold text-foreground">
              先选场景，再补信息，最后一键生成
            </h2>
            <p className="mt-1 text-13 leading-6 text-default-500">
              最少只要填“运营目标”和“产品/主题”就能开始，其余字段可以后补。
            </p>
          </div>
          <Chip
            color={roleAvailable ? "success" : "warning"}
            size="sm"
            variant="flat"
          >
            {roleAvailable ? "可直接提交" : "角色未就绪"}
          </Chip>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {QUICK_START_PRESETS.map((preset) => (
            <Button
              key={preset.title}
              className="h-auto min-h-[84px] justify-start border-[var(--kaypal-v3-border)] px-4 py-3 text-left text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]"
              variant="bordered"
              onPress={() => applyPreset(preset)}
            >
              <div className="flex w-full flex-col items-start gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-14 font-semibold text-foreground">
                    {preset.title}
                  </span>
                  <Chip size="sm" variant="flat">
                    一键填充
                  </Chip>
                </div>
                <span className="text-12 leading-5 text-default-500">
                  {preset.description}
                </span>
              </div>
            </Button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
        <section className="h-fit rounded-[8px] border border-divider bg-background p-4">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-14 font-semibold">创建笔记包</h2>
          </div>
          <div className="space-y-3">
            <Textarea
              isRequired
              label="运营目标"
              maxRows={4}
              minRows={2}
              placeholder="例如：为新品首发生成一篇真实体验型笔记"
              value={form.goal}
              onValueChange={(goal) => setForm((value) => ({ ...value, goal }))}
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Input
                isRequired
                label="产品或主题"
                placeholder="本次要推广的对象"
                value={form.product}
                onValueChange={(product) =>
                  setForm((value) => ({ ...value, product }))
                }
              />
              <div className="rounded-[8px] border border-divider bg-default-50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-13 font-medium text-foreground">
                      更多信息（可选）
                    </p>
                    <p className="mt-0.5 text-12 leading-5 text-default-500">
                      品牌、目标人群、关键词、参考素材都可以后补。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    endContent={
                      advancedOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )
                    }
                    variant="light"
                    onPress={() => setAdvancedOpen((value) => !value)}
                  >
                    {advancedOpen ? "收起" : "展开"}
                  </Button>
                </div>
                <p className="mt-2 text-11 text-default-400">
                  已补充 {optionalFieldCount} / 4 项可选信息
                </p>
              </div>
            </div>
            {advancedOpen ? (
              <div className="space-y-3">
                <Input
                  label="品牌"
                  placeholder="品牌或账号名称"
                  value={form.brand}
                  onValueChange={(brand) =>
                    setForm((value) => ({ ...value, brand }))
                  }
                />
                <Input
                  label="目标人群"
                  placeholder="例如：一线城市 25-35 岁职场女性"
                  value={form.audience}
                  onValueChange={(audience) =>
                    setForm((value) => ({ ...value, audience }))
                  }
                />
                <Input
                  label="关键词"
                  placeholder="使用逗号分隔"
                  value={form.keywords}
                  onValueChange={(keywords) =>
                    setForm((value) => ({ ...value, keywords }))
                  }
                />
                <Textarea
                  label="参考素材"
                  maxRows={6}
                  minRows={3}
                  placeholder="每行一条事实、卖点或素材摘要"
                  value={form.sourceMaterials}
                  onValueChange={(sourceMaterials) =>
                    setForm((value) => ({ ...value, sourceMaterials }))
                  }
                />
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4 border-y border-divider py-3">
              <div className="flex items-center gap-2">
                <Images className="h-4 w-4 text-default-500" />
                <span className="text-13 font-medium">生成 3:4 卡图</span>
              </div>
              <Switch
                aria-label="生成 3:4 卡图"
                isSelected={form.generateCards}
                size="sm"
                onValueChange={(generateCards) =>
                  setForm((value) => ({ ...value, generateCards }))
                }
              />
            </div>
            <Button
              className="w-full"
              color="primary"
              isDisabled={
                !canSubmit || Boolean(executingRunId) || isActive(currentRun)
              }
              isLoading={submitting}
              startContent={
                submitting ? null : <WandSparkles className="h-4 w-4" />
              }
              onPress={() => void submit()}
            >
              生成笔记包
            </Button>
            <p className="text-12 leading-5 text-default-400">
              生成后会自动进入执行进度；你也可以先点上面的场景卡，少填几项再提交。
            </p>
          </div>
        </section>

        <section className="min-w-0 rounded-[8px] border border-divider bg-background">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-divider px-4 py-3">
            <div>
              <h2 className="text-14 font-semibold">本次产物</h2>
              {currentRun ? (
                <p className="mt-0.5 text-11 text-default-400">
                  {formatTime(currentRun.updatedAt)}
                </p>
              ) : null}
            </div>
            {currentRun ? (
              <Chip
                color={STATUS_COLOR[currentRun.status]}
                size="sm"
                variant="flat"
              >
                {currentRun.statusLabel}
              </Chip>
            ) : null}
          </div>

          {!currentRun ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center px-6 text-center">
              <FileText className="h-9 w-9 text-default-300" />
              <p className="mt-3 text-14 font-medium text-default-600">
                暂无笔记产物
              </p>
            </div>
          ) : (
            <div className="space-y-5 p-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-11 text-default-500">
                  <span>{currentRun.nextAction}</span>
                  <span>{STEP_PROGRESS[currentRun.currentStep]}%</span>
                </div>
                <Progress
                  aria-label="任务进度"
                  color={currentRun.status === "failed" ? "danger" : "primary"}
                  size="sm"
                  value={STEP_PROGRESS[currentRun.currentStep]}
                />
              </div>

              {isActive(currentRun) ? (
                <div className="flex min-h-[360px] items-center justify-center gap-3 text-13 text-default-500">
                  <Spinner size="sm" />
                  <span>任务在后台执行，刷新页面不会丢失进度</span>
                </div>
              ) : currentRun.output ? (
                <RunOutput run={currentRun} />
              ) : currentRun.failureReason ? (
                <div className="space-y-3 border-l-2 border-danger bg-danger-50 px-3 py-3 text-13 text-danger-700">
                  <p>{currentRun.failureReason}</p>
                  <Button
                    color="danger"
                    isLoading={executingRunId === currentRun.runId}
                    size="sm"
                    startContent={<RefreshCw className="h-4 w-4" />}
                    variant="flat"
                    onPress={() => startExecution(currentRun.runId)}
                  >
                    重试任务
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-[8px] border border-divider bg-background">
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-default-500" />
            <h2 className="text-14 font-semibold">最近任务</h2>
          </div>
          <span className="text-11 text-default-400">{runs.length} 条</span>
        </div>
        {runs.length ? (
          <div className="divide-y divide-divider">
            {runs.map((run) => (
              <button
                key={run.runId}
                className="grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-default-50 sm:grid-cols-[minmax(0,1fr)_120px_110px] sm:items-center"
                type="button"
                onClick={() => void openRun(run.runId)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-13 font-medium text-default-700">
                    {run.goal}
                  </span>
                  <span className="mt-0.5 block truncate text-11 text-default-400">
                    {run.inputs?.product || "未填写产品"}
                  </span>
                </span>
                <Chip color={STATUS_COLOR[run.status]} size="sm" variant="flat">
                  {run.statusLabel}
                </Chip>
                <span className="flex items-center justify-end gap-2 text-11 text-default-400">
                  {historyBusyId === run.runId ? <Spinner size="sm" /> : null}
                  {formatTime(run.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-13 text-default-400">
            暂无任务记录
          </div>
        )}
      </section>
    </div>
  );
}

function RunOutput({ run }: { run: AgentWakerRun }) {
  const output = run.output!;
  const checklistItems = Array.isArray(run.checklist?.items)
    ? run.checklist.items
    : [];
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold leading-7 text-foreground">
          {output.title}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-13 leading-6 text-default-600">
          {output.caption}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {output.hashtags.map((tag) => (
            <Chip key={tag} size="sm" variant="flat">
              #{tag.replace(/^#/, "")}
            </Chip>
          ))}
        </div>
      </div>

      {output.slides.length ? (
        <div>
          <div className="mb-2 flex items-center gap-2 text-13 font-medium">
            <Images className="h-4 w-4 text-default-500" />
            卡图
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {output.slides.map((slide, index) => (
              <div
                key={`${slide.role || "slide"}-${index}`}
                className="min-w-0 overflow-hidden rounded-[6px] border border-divider bg-default-50"
              >
                <div className="aspect-[3/4] w-full bg-default-100">
                  {slide.cardImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={slide.title || `卡图 ${index + 1}`}
                      className="h-full w-full object-cover"
                      src={slide.cardImageUrl}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-3 text-center text-12 text-default-500">
                      {slide.title}
                    </div>
                  )}
                </div>
                <div className="truncate px-2 py-1.5 text-11 text-default-500">
                  {index + 1}. {slide.title}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-divider pt-4">
        <div className="mb-2 flex items-center gap-2 text-13 font-medium">
          <ShieldCheck className="h-4 w-4 text-default-500" />
          发布前检查
        </div>
        <div className="space-y-2">
          {checklistItems.map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-2 text-12 text-default-600"
            >
              {item.status === "ready" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-success" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-warning" />
              )}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        {run.risks.length ? (
          <div className="mt-3 border-l-2 border-warning bg-warning-50 px-3 py-2 text-12 text-warning-700">
            {run.risks.join("；")}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-divider pt-4">
        <Button
          as={Link}
          href={`/content/xiaohongshu?articleId=${encodeURIComponent(output.articleId)}`}
          startContent={<Eye className="h-4 w-4" />}
          variant="flat"
        >
          查看笔记
        </Button>
        {run.status === "waiting_for_confirmation" ? (
          <Button
            as={Link}
            color="warning"
            href="/tasks/confirmations"
            startContent={<ClipboardCheck className="h-4 w-4" />}
          >
            待我确认
          </Button>
        ) : null}
      </div>
    </div>
  );
}
