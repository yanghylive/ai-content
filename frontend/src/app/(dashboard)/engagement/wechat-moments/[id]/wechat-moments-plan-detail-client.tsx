"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Select,
  SelectItem,
  Spinner,
  Textarea,
  addToast,
} from "@heroui/react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  FileQuestion,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import {
  localEngineApi,
  type InteractionTask,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type PlanForm = {
  planName: string;
  content: string;
  additionalComment: string;
  assetPaths: string;
  visibility: string;
  scheduleStartTime: string;
};

const emptyForm: PlanForm = {
  planName: "",
  content: "",
  additionalComment: "",
  assetPaths: "",
  visibility: "public",
  scheduleStartTime: "",
};

type PlanLoadIssueKind =
  | "missing-id"
  | "not-found"
  | "forbidden"
  | "wrong-type"
  | "failed";

type PlanLoadIssue = {
  kind: PlanLoadIssueKind;
  title: string;
  description: string;
  canRetry: boolean;
};

const missingPlanIdIssue: PlanLoadIssue = {
  kind: "missing-id",
  title: "缺少朋友圈计划编号",
  description:
    "当前链接没有 planId，无法确定要打开哪条计划。系统没有执行或修改任何朋友圈任务。",
  canRetry: false,
};

function executionModeMeta(task: InteractionTask) {
  if (
    task.safetyBoundary?.planMode === "trial" ||
    task.safetyBoundary?.trialLimited
  ) {
    return {
      color: "default" as const,
      label: "试用模式",
      description: "当前计划不会计为真实朋友圈发布。",
    };
  }
  if (task.sendMode === "draft-only") {
    return {
      color: "default" as const,
      label: "只看不发",
      description: "当前计划只保存和分析，不执行朋友圈发布。",
    };
  }
  if (task.executionMode === "internal-record") {
    return {
      color: "default" as const,
      label: "仅记录",
      description: "当前记录没有外部发布结果，不能视为已经发布。",
    };
  }
  if (task.sendMode === "auto-send") {
    return {
      color: "warning" as const,
      label: "自动发布",
      description: "由本机微信执行，并以发布结果和证据核验完成。",
    };
  }
  return {
    color: "primary" as const,
    label: "确认后执行",
    description: "确认前不会发布，确认后以真实结果核验完成。",
  };
}

export function WechatMomentsPlanDetailClient({ planId }: { planId: string }) {
  const isMobile = useIsMobile();
  const safePlanId = planId.trim();
  const [task, setTask] = React.useState<InteractionTask | null>(null);
  const [form, setForm] = React.useState<PlanForm>(emptyForm);
  const [instruction, setInstruction] = React.useState("");
  const [loading, setLoading] = React.useState(Boolean(safePlanId));
  const [loadIssue, setLoadIssue] = React.useState<PlanLoadIssue | null>(
    safePlanId ? null : missingPlanIdIssue,
  );
  const [saving, setSaving] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [generatedPreview, setGeneratedPreview] = React.useState<string | null>(
    null,
  );
  const [savedRevision, setSavedRevision] =
    React.useState<InteractionTask | null>(null);
  const loadSequence = React.useRef(0);

  const load = React.useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!safePlanId) {
      setTask(null);
      setLoadIssue(missingPlanIdIssue);
      setLoading(false);
      return;
    }

    setLoading(true);
    setTask(null);
    setLoadIssue(null);
    try {
      const next = await localEngineApi.task(safePlanId);
      if (sequence !== loadSequence.current) return;
      if (
        next.type !== "wechat-moments-publish" &&
        next.type !== "wechat-moments-marketing"
      ) {
        setLoadIssue({
          kind: "wrong-type",
          title: "这条记录不是朋友圈计划",
          description:
            "链接指向的是其他类型任务，不能在朋友圈计划详情中编辑。系统没有修改该任务。",
          canRetry: false,
        });
        return;
      }
      setTask(next);
      setForm(formFromTask(next));
      setGeneratedPreview(null);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadIssue(planLoadIssueFrom(error));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [safePlanId]);

  React.useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);

  const update = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const regenerate = async () => {
    if (!task) return;
    setGenerating(true);
    try {
      const result = await localEngineApi.regenerateMomentsPlanContent(
        task.id,
        {
          currentContent: form.content,
          instruction: instruction.trim() || undefined,
        },
      );
      setGeneratedPreview(result.content);
      addToast({
        title: "改写预览已生成",
        description: "确认采用前不会覆盖当前文案。",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "文案改写失败",
        description: toPublicError(error, "请检查文本模型后重试。"),
        color: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const saveRevision = async () => {
    if (!task || !form.content.trim()) {
      addToast({ title: "请填写朋友圈文案", color: "warning" });
      return;
    }
    setSaving(true);
    try {
      const revision = await localEngineApi.createMomentsPlanRevision(task.id, {
        planName: form.planName,
        content: form.content,
        additionalComment: form.additionalComment,
        assetPaths: splitLines(form.assetPaths),
        visibility: form.visibility,
        scheduleStartTime: form.scheduleStartTime || undefined,
      });
      setSavedRevision(revision);
      addToast({
        title: "修订版已保存",
        description: "当前没有发布，可回到计划列表检查后启动。",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "修订版保存失败",
        description: toPublicError(error, "请检查内容和素材后重试。"),
        color: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <WechatMomentsPlanDetailLoading />;
  }

  if (loadIssue || !task) {
    return (
      <WechatMomentsPlanDetailIssue
        issue={loadIssue || planLoadIssueFrom(null)}
        onRetry={() => void load()}
      />
    );
  }

  const currentExecutionMode = executionModeMeta(task);

  /* 移动端原生视图（mx-* 明德 VP 风格）——朋友圈计划详情，单列堆叠。
     一改转 /engagement/wechat-moments/[id] 与 /engagement/wechat-moments/detail 两入口。 */
  if (isMobile) {
    const fieldStyle: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(142,165,190,.3)",
      background: "rgba(255,255,255,.06)",
      color: "var(--mx-ink)",
      fontSize: 13,
    };
    const labelStyle: React.CSSProperties = {
      display: "block",
      fontSize: 12,
      fontWeight: 600,
      color: "var(--mx-ink)",
      marginBottom: 6,
    };
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          {/* 头部：返回 + 标题 + 状态徽标 */}
          <div className="mx-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Link href="/engagement/wechat-moments" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)" }}>
                <ArrowLeft width={14} height={14} /> 返回
              </Link>
              <button
                type="button"
                onClick={() => void load()}
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--mx-muted)", background: "rgba(120,148,179,.12)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 9, padding: "5px 11px", fontWeight: 600 }}
              >
                <RefreshCw width={12} height={12} /> 刷新
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              <span className="mx-badge mx-badge-blue" style={{ fontSize: 10 }}>
                {task.type === "wechat-moments-publish" ? "朋友圈发布" : "朋友圈营销"}
              </span>
              <span className={`mx-badge ${task.status === "completed" ? "mx-badge-green" : "mx-badge-blue"}`} style={{ fontSize: 10 }}>
                {task.statusLabel || task.status}
              </span>
              <span className={`mx-badge ${currentExecutionMode.color === "warning" ? "mx-badge-gold" : currentExecutionMode.color === "primary" ? "mx-badge-blue" : "mx-badge-blue"}`} style={{ fontSize: 10 }}>
                {currentExecutionMode.label}
              </span>
            </div>
            <div className="mx-page-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {task.planName || "朋友圈计划详情"}
            </div>
          </div>

          {/* 计划表单 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <label style={labelStyle}>计划名称</label>
            <input value={form.planName} onChange={(e) => update("planName", e.target.value)} style={fieldStyle} />

            <label style={{ ...labelStyle, marginTop: 12 }}>计划时间</label>
            <input type="datetime-local" value={form.scheduleStartTime} onChange={(e) => update("scheduleStartTime", e.target.value)} style={fieldStyle} />

            <label style={{ ...labelStyle, marginTop: 12 }}>朋友圈文案</label>
            <textarea rows={7} value={form.content} onChange={(e) => update("content", e.target.value)} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.6 }} />

            <label style={{ ...labelStyle, marginTop: 12 }}>追加评论</label>
            <textarea rows={2} value={form.additionalComment} onChange={(e) => update("additionalComment", e.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />

            <label style={{ ...labelStyle, marginTop: 12 }}>图片或视频</label>
            <textarea rows={3} placeholder="每行一个本机素材文件" value={form.assetPaths} onChange={(e) => update("assetPaths", e.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />

            <label style={{ ...labelStyle, marginTop: 12 }}>可见范围</label>
            <select value={form.visibility} onChange={(e) => update("visibility", e.target.value)} style={fieldStyle}>
              <option value="public">公开</option>
              <option value="private">仅自己可见</option>
              <option value="partial">部分联系人可见</option>
            </select>

            <button
              type="button"
              className="mx-btn-gold"
              style={{ width: "100%", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={saving}
              onClick={() => void saveRevision()}
            >
              <Save width={15} height={15} />
              {saving ? "正在保存…" : "保存修订版"}
            </button>
          </div>

          {/* AI 改写 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 10 }}>AI 改写</p>
            <label style={labelStyle}>修改要求</label>
            <textarea rows={3} placeholder="例如：更简洁，保留时间和活动信息。" value={instruction} onChange={(e) => setInstruction(e.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={generating}
              style={{ width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <Sparkles width={14} height={14} />
              {generating ? "正在改写…" : "重新生成"}
            </button>

            {generatedPreview && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "rgba(37,99,235,.08)", border: "1px solid rgba(37,99,235,.25)" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>改写预览</p>
                <p style={{ marginTop: 7, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5, lineHeight: 1.6, color: "var(--mx-ink)" }}>
                  {generatedPreview}
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      update("content", generatedPreview);
                      setGeneratedPreview(null);
                      addToast({ title: "已采用改写文案", color: "success" });
                    }}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 9, background: "#2563eb", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                  >
                    <Check width={13} height={13} /> 采用新文案
                  </button>
                  <button
                    type="button"
                    onClick={() => setGeneratedPreview(null)}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                  >
                    <X width={13} height={13} /> 保留当前
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 当前记录 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 9 }}>当前记录</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--mx-muted)" }}>
              <p>对象：{task.targetName || "未指定"}</p>
              <p>计划时间：{task.planTime || "未设置"}</p>
              <p>执行方式：{currentExecutionMode.label}</p>
              <p>结果：{task.nextAction || "等待操作"}</p>
              <p>目标数：{task.batchSummary?.total || task.batchTargets?.length || 1}</p>
            </div>
          </div>

          {/* 修订版已保存提示 */}
          {savedRevision && (
            <div className="mx-card" style={{ marginTop: 12, padding: 14, borderColor: "rgba(5,150,105,.4)" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>修订版已保存</p>
              <p style={{ fontSize: 11.5, color: "#059669", marginTop: 4, lineHeight: 1.5 }}>当前没有发布。回到计划列表检查后再启动。</p>
              <Link
                href={`/local-engine?tab=tasks&taskId=${encodeURIComponent(savedRevision.id)}`}
                style={{ display: "inline-block", marginTop: 9, padding: "8px 16px", borderRadius: 9, background: "rgba(5,150,105,.12)", color: "#059669", border: "1px solid rgba(5,150,105,.3)", fontSize: 12, fontWeight: 600 }}
              >
                查看修订版
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 pb-8">
      <header className="kaypal-v3-page-header flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="flat">
              {task.type === "wechat-moments-publish"
                ? "朋友圈发布"
                : "朋友圈营销"}
            </Chip>
            <Chip
              size="sm"
              variant="flat"
              color={task.status === "completed" ? "success" : "default"}
            >
              {task.statusLabel || task.status}
            </Chip>
            <Chip
              color={currentExecutionMode.color}
              size="sm"
              title={currentExecutionMode.description}
              variant="flat"
            >
              {currentExecutionMode.label}
            </Chip>
          </div>
          <h1 className="mt-2 truncate text-xl font-semibold text-default-900">
            {task.planName || "朋友圈计划详情"}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            as={Link}
            href="/engagement/wechat-moments"
            variant="flat"
            startContent={<ArrowLeft size={16} />}
          >
            返回
          </Button>
          <Button
            variant="flat"
            onPress={() => void load()}
            startContent={<RefreshCw size={16} />}
          >
            刷新
          </Button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="border border-divider shadow-none">
          <CardBody className="gap-3 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="计划名称"
                value={form.planName}
                onValueChange={(value) => update("planName", value)}
              />
              <Input
                type="datetime-local"
                label="计划时间"
                value={form.scheduleStartTime}
                onValueChange={(value) => update("scheduleStartTime", value)}
              />
            </div>
            <Textarea
              label="朋友圈文案"
              minRows={8}
              value={form.content}
              onValueChange={(value) => update("content", value)}
            />
            <Textarea
              label="追加评论"
              minRows={2}
              value={form.additionalComment}
              onValueChange={(value) => update("additionalComment", value)}
            />
            <Textarea
              label="图片或视频"
              minRows={3}
              value={form.assetPaths}
              onValueChange={(value) => update("assetPaths", value)}
              placeholder="每行一个本机素材文件"
            />
            <Select
              label="可见范围"
              selectedKeys={[form.visibility]}
              onSelectionChange={(keys) =>
                update("visibility", String(Array.from(keys)[0] || "public"))
              }
            >
              <SelectItem key="public">公开</SelectItem>
              <SelectItem key="private">仅自己可见</SelectItem>
              <SelectItem key="partial">部分联系人可见</SelectItem>
            </Select>
            <div className="flex justify-end">
              <Button
                color="primary"
                isLoading={saving}
                onPress={() => void saveRevision()}
                startContent={saving ? null : <Save size={16} />}
              >
                保存修订版
              </Button>
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-3">
          <Card className="border border-divider shadow-none">
            <CardBody className="gap-3 p-4">
              <h2 className="text-sm font-semibold text-default-900">AI 改写</h2>
              <Textarea
                label="修改要求"
                minRows={4}
                value={instruction}
                onValueChange={setInstruction}
                placeholder="例如：更简洁，保留时间和活动信息。"
              />
              <Button
                variant="flat"
                color="primary"
                isLoading={generating}
                onPress={() => void regenerate()}
                startContent={generating ? null : <Sparkles size={16} />}
              >
                重新生成
              </Button>
              {generatedPreview ? (
                <div className="rounded-[8px] border border-primary-200 bg-primary-50/50 p-3">
                  <p className="text-xs font-semibold text-primary-700">
                    改写预览
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-default-800">
                    {generatedPreview}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      color="primary"
                      size="sm"
                      startContent={<Check size={15} />}
                      onPress={() => {
                        update("content", generatedPreview);
                        setGeneratedPreview(null);
                        addToast({ title: "已采用改写文案", color: "success" });
                      }}
                    >
                      采用新文案
                    </Button>
                    <Button
                      size="sm"
                      startContent={<X size={15} />}
                      variant="flat"
                      onPress={() => setGeneratedPreview(null)}
                    >
                      保留当前文案
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card className="border border-divider shadow-none">
            <CardBody className="gap-2 p-4 text-xs text-default-600">
              <h2 className="text-sm font-semibold text-default-900">当前记录</h2>
              <p>对象：{task.targetName || "未指定"}</p>
              <p>计划时间：{task.planTime || "未设置"}</p>
              <p title={currentExecutionMode.description}>
                执行方式：{currentExecutionMode.label}
              </p>
              <p>结果：{task.nextAction || "等待操作"}</p>
              <p>
                目标数：
                {task.batchSummary?.total || task.batchTargets?.length || 1}
              </p>
            </CardBody>
          </Card>

          {savedRevision ? (
            <Card className="border border-success-200 bg-success-50/50 shadow-none">
              <CardBody className="gap-2 p-4">
                <p className="text-sm font-semibold text-success-700">
                  修订版已保存
                </p>
                <p className="text-xs text-success-700">
                  当前没有发布。回到计划列表检查后再启动。
                </p>
                <Button
                  as={Link}
                  href={`/local-engine?tab=tasks&taskId=${encodeURIComponent(savedRevision.id)}`}
                  size="sm"
                  variant="flat"
                >
                  查看修订版
                </Button>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WechatMomentsPlanDetailLoading() {
  return (
    <div
      className="flex min-h-[420px] items-center justify-center"
      aria-live="polite"
      aria-busy="true"
    >
      <Spinner label="正在读取朋友圈计划" />
    </div>
  );
}

function WechatMomentsPlanDetailIssue({
  issue,
  onRetry,
}: {
  issue: PlanLoadIssue;
  onRetry: () => void;
}) {
  const Icon =
    issue.kind === "forbidden"
      ? LockKeyhole
      : issue.kind === "failed"
        ? CircleAlert
        : FileQuestion;

  return (
    <section
      className="mx-auto flex min-h-[420px] w-full max-w-[760px] flex-col items-center justify-center rounded-[8px] border border-dashed border-default-300 bg-content1 px-6 py-10 text-center"
      role={issue.kind === "failed" ? "alert" : "status"}
      aria-live="polite"
    >
      <Icon size={32} className="text-default-500" aria-hidden="true" />
      <h1 className="mt-4 text-xl font-semibold text-default-900">
        {issue.title}
      </h1>
      <p className="mt-2 max-w-[580px] text-sm leading-6 text-default-600">
        {issue.description}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button
          as={Link}
          href="/engagement/wechat-moments"
          variant="flat"
          startContent={<ArrowLeft size={16} />}
        >
          返回朋友圈列表
        </Button>
        {issue.canRetry ? (
          <Button
            variant="flat"
            startContent={<RefreshCw size={16} />}
            onPress={onRetry}
          >
            重新加载
          </Button>
        ) : null}
        <Button
          as={Link}
          href="/engagement/wechat-moments"
          color="primary"
          startContent={<Plus size={16} />}
        >
          新建朋友圈计划
        </Button>
      </div>
    </section>
  );
}

function planLoadIssueFrom(error: unknown): PlanLoadIssue {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        kind: "forbidden",
        title: "登录状态已失效",
        description: "请重新登录后再打开这条朋友圈计划。系统没有修改计划内容。",
        canRetry: true,
      };
    }
    if (error.status === 403) {
      return {
        kind: "forbidden",
        title: "无权访问该朋友圈计划",
        description:
          "当前账号没有查看这条计划的权限。请切换到有权限的账号，或联系管理员确认授权。",
        canRetry: true,
      };
    }
    if (error.status === 404) {
      return {
        kind: "not-found",
        title: "朋友圈计划不存在或不可访问",
        description:
          "该计划可能已删除、链接已经失效，或不属于当前账号。请返回列表确认计划是否仍然存在。",
        canRetry: true,
      };
    }
  }

  return {
    kind: "failed",
    title: "朋友圈计划暂时无法加载",
    description: toPublicError(
      error,
      "服务暂时没有返回计划详情。你可以重新加载，或返回列表继续处理其他计划。",
    ),
    canRetry: true,
  };
}

function formFromTask(task: InteractionTask): PlanForm {
  const metadata = task.metadata || {};
  return {
    planName: task.planName || "",
    content:
      text(metadata.wechat_moments_content) ||
      task.replyText ||
      task.sourceText ||
      "",
    additionalComment: text(metadata.wechat_moments_additional_comment),
    assetPaths: readStringList(
      metadata.wechat_moments_asset_paths || metadata.wechat_moments_assets,
    ).join("\n"),
    visibility: text(metadata.wechat_moments_visibility) || "public",
    scheduleStartTime: toLocalDateTime(
      text(metadata.wechat_moments_schedule_start_time) || task.planTime || "",
    ),
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : text(value)
      ? [text(value)]
      : [];
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function toLocalDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
