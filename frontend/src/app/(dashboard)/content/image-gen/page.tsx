"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ImageIcon,
  Loader2,
  RefreshCcw,
  Sparkles,
  Wand2,
  XCircle,
} from "@/components/iconpark";
import toast from "@/lib/toast";
import { getApiBase } from "@/lib/api/client";
import {
  generateImageOutline,
  getImageGenTask,
  type GeneratedImagePage,
  type ImageGenTask,
  type OutlinePage,
  type OutlinePageType,
} from "@/lib/api/content-optimization";
import {
  V2Field,
  V2GhostButton,
  V2Input,
  V2PrimaryButton,
  V2Section,
  V2Textarea,
} from "@/components/v2/ui-kit";
import { toActionableError } from "@/lib/public-error";

const PAGE_TYPE_LABEL: Record<OutlinePageType, string> = {
  cover: "封面",
  content: "内容",
  summary: "总结",
};

type Stage = "input" | "outline" | "generating" | "done";

export default function ImageGenPage() {
  const [topic, setTopic] = useState("");
  const [pageCount, setPageCount] = useState(5);
  const [stage, setStage] = useState<Stage>("input");
  const [outline, setOutline] = useState<OutlinePage[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedImagePage[]>([]);
  const [failed, setFailed] = useState<GeneratedImagePage[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState("");
  const [outlining, setOutlining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [reviewInfo, setReviewInfo] = useState<{
    score: number;
    pass: boolean;
    issues: Array<{ dimension: string; severity: string; message: string }>;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 断点重放：URL 带 ?task=xxx 时拉取已落库状态
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    if (!id) return;
    getImageGenTask(id)
      .then((task: ImageGenTask) => {
        setTaskId(task.id);
        setTopic(task.topic);
        setTitles(task.titles);
        setTags(task.tags);
        setGenerated(task.generated);
        setFailed(task.failed);
        setOutline(task.pages.map((p) => ({
          type: p.type,
          title: p.heading,
          points: p.content ? [p.content] : [],
          imagePrompt: p.imagePrompt,
        })));
        setStage(task.status === "completed" ? "done" : "generating");
      })
      .catch(() => toast.error("任务重放失败"));
  }, []);

  const handleOutline = async () => {
    if (!topic.trim()) {
      toast.error("请先输入一句话主题");
      return;
    }
    setOutlining(true);
    setError(null);
    try {
      const res = await generateImageOutline(topic.trim(), pageCount);
      setOutline(res.pages);
      setStage("outline");
    } catch (err) {
      const message = toActionableError(err, "大纲生成失败");
      setError(message);
      toast.error(message);
    } finally {
      setOutlining(false);
    }
  };

  const updateOutlinePage = (
    index: number,
    patch: Partial<OutlinePage>,
  ) => {
    setOutline((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );
  };

  const runGenerate = async () => {
    if (outline.length === 0 || !topic.trim()) return;
    setStage("generating");
    setGenerated([]);
    setFailed([]);
    setTitles([]);
    setTags([]);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const base = getApiBase();
      const tenantId = window.localStorage
        .getItem("ai_content_tenant_id")
        ?.trim();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (tenantId) headers["x-tenant-id"] = tenantId;

      const res = await fetch(`${base}/content-optimization/generate`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ topic: topic.trim(), outline }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text ? `生成失败：${text.slice(0, 200)}` : "生成失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (payload: Record<string, unknown>) => {
        switch (payload.type) {
          case "progress": {
            setProgressMsg(toActionableError(String(payload.message), ""));
            break;
          }
          case "titles": {
            if (Array.isArray(payload.titles)) {
              setTitles(payload.titles.map(String));
            }
            if (Array.isArray(payload.tags)) {
              setTags(payload.tags.map(String));
            }
            break;
          }
          case "page_done": {
            const page = payload.page as GeneratedImagePage;
            if (page) {
              setGenerated((prev) => {
                const next = prev.filter((p) => p.index !== page.index);
                return [...next, page].sort((a, b) => a.index - b.index);
              });
            }
            break;
          }
          case "page_error": {
            setFailed((prev) => [
              ...prev,
              {
                index: Number(payload.index ?? -1),
                type: "content",
                heading: "",
                content: "",
                imagePrompt: "",
                status: "failed",
                error: toActionableError(String(payload.message), "配图失败"),
              },
            ]);
            break;
          }
          case "evidence": {
            setEvidence(payload.evidence as Record<string, unknown>);
            break;
          }
          case "complete": {
            setTaskId(String(payload.taskId || ""));
            if (payload.review) {
              setReviewInfo(
                payload.review as {
                  score: number;
                  pass: boolean;
                  issues: Array<{
                    dimension: string;
                    severity: string;
                    message: string;
                  }>;
                },
              );
            }
            setStage("done");
            break;
          }
          case "error": {
            setError(toActionableError(String(payload.message), "生成失败"));
            toast.error(toActionableError(String(payload.message), "生成失败"));
            break;
          }
          default:
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(trimmed.slice(6)) as Record<
              string,
              unknown
            >;
            handleEvent(payload);
          } catch {
            /* 忽略损坏帧 */
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message = toActionableError(err, "生成失败");
      setError(message);
      setStage("outline");
      toast.error(message);
    } finally {
      abortRef.current = null;
    }
  };

  const stopGenerate = () => abortRef.current?.abort();

  const restart = () => {
    abortRef.current?.abort();
    setStage("input");
    setOutline([]);
    setGenerated([]);
    setFailed([]);
    setTitles([]);
    setTags([]);
    setTaskId(null);
    setError(null);
    setTopic("");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
          一句话生成图文
        </h1>
        <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
          输入主题 → AI 生成大纲（可编辑）→ 逐页配图，中途刷新不重复计费
        </p>
      </div>

      {stage === "input" && (
        <V2Section title="输入主题" description="一句话说清楚你想做什么内容">
          <div className="space-y-4">
            <V2Field label="主题" required hint="例如：讲讲程序员35岁危机">
              <V2Textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="一句话描述图文主题…"
                rows={3}
              />
            </V2Field>
            <V2Field label="页数" hint="封面 + 内容页 + 总结">
              <div className="flex items-center gap-3">
                {[3, 5, 7].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPageCount(n)}
                    className={`h-10 w-14 rounded-lg border text-sm font-medium transition ${
                      pageCount === n
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)]"
                    }`}
                  >
                    {n} 页
                  </button>
                ))}
              </div>
            </V2Field>
            <V2PrimaryButton
              icon={outlining ? Loader2 : Wand2}
              loading={outlining}
              onClick={handleOutline}
            >
              {outlining ? "AI 生成大纲中…" : "生成大纲"}
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {stage === "outline" && (
        <V2Section
          title="编辑大纲"
          description="人审卡在出图前：确认每一页标题与要点后再生成"
          action={
            <div className="flex items-center gap-2">
              <V2GhostButton icon={RefreshCcw} onClick={handleOutline}>
                重新生成
              </V2GhostButton>
              <V2GhostButton onClick={restart}>返回</V2GhostButton>
            </div>
          }
        >
          <div className="space-y-4">
            {outline.map((page, i) => (
              <div
                key={i}
                className="rounded-xl border border-[var(--kaypal-v3-border)] p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full bg-[var(--kaypal-v3-accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--kaypal-v3-accent-ink)]">
                    {PAGE_TYPE_LABEL[page.type] ?? "内容"}
                  </span>
                  <span className="text-xs text-[var(--kaypal-v3-muted)]">
                    第 {i + 1} 页
                  </span>
                </div>
                <V2Field label="标题">
                  <V2Input
                    value={page.title}
                    onChange={(e) =>
                      updateOutlinePage(i, { title: e.target.value })
                    }
                  />
                </V2Field>
                <div className="mt-3">
                  <V2Field label="要点（每行一条）">
                    <V2Textarea
                      rows={2}
                      value={(page.points || []).join("\n")}
                      onChange={(e) =>
                        updateOutlinePage(i, {
                          points: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </V2Field>
                </div>
                <div className="mt-3">
                  <V2Field label="配图描述（可选）">
                    <V2Input
                      value={page.imagePrompt || ""}
                      placeholder="描述该页想要的画面，留空则 AI 自动生成"
                      onChange={(e) =>
                        updateOutlinePage(i, { imagePrompt: e.target.value })
                      }
                    />
                  </V2Field>
                </div>
              </div>
            ))}

            {error && (
              <p className="text-sm text-[var(--kaypal-v3-danger)]">{error}</p>
            )}
            <div className="flex items-center gap-3 pt-2">
              <V2PrimaryButton icon={Sparkles} onClick={runGenerate}>
                开始生成图文
              </V2PrimaryButton>
              <span className="text-xs text-[var(--kaypal-v3-muted)]">
                逐页 AI 配图，全程可刷新恢复
              </span>
            </div>
          </div>
        </V2Section>
      )}

      {(stage === "generating" || stage === "done") && (
        <V2Section
          title="生成进度"
          description={taskId ? `任务 ID：${taskId}` : "正在逐页生成配图…"}
          action={
            stage === "done" ? (
              <div className="flex items-center gap-2">
                {taskId && (
                  <V2GhostButton
                    onClick={() => {
                      window.history.replaceState(
                        null,
                        "",
                        `/content/image-gen?task=${encodeURIComponent(taskId || "")}`,
                      );
                      toast.success("已生成可分享/刷新恢复的链接");
                    }}
                  >
                    复制恢复链接
                  </V2GhostButton>
                )}
                <V2GhostButton icon={Wand2} onClick={restart}>
                  再来一篇
                </V2GhostButton>
              </div>
            ) : (
              <V2GhostButton onClick={stopGenerate}>停止</V2GhostButton>
            )
          }
        >
          {stage === "generating" && progressMsg && (
            <p className="mb-4 flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progressMsg}
            </p>
          )}

          {titles.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                标题候选
              </h3>
              <div className="space-y-1">
                {titles.map((t, i) => (
                  <p
                    key={i}
                    className="rounded-lg bg-[var(--kaypal-v3-field-bg)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)]"
                  >
                    {t}
                  </p>
                ))}
              </div>
            </div>
          )}

          {generated.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                已生成配图（{generated.length}）
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {generated.map((page) => (
                  <div
                    key={page.index}
                    className="overflow-hidden rounded-xl border border-[var(--kaypal-v3-border)]"
                  >
                    <div className="flex aspect-[3/4] items-center justify-center bg-[var(--kaypal-v3-field-bg)]">
                      {page.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={page.imageUrl}
                          alt={page.heading || `第 ${page.index + 1} 页`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-[var(--kaypal-v3-muted)]" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--kaypal-v3-success)]" />
                      <span className="truncate text-xs text-[var(--kaypal-v3-soft-ink)]">
                        {PAGE_TYPE_LABEL[page.type]} · {page.heading || "配图"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-[var(--kaypal-v3-danger)]">
                失败页面（{failed.length}）
              </h3>
              <div className="space-y-1">
                {failed.map((f, i) => (
                  <p
                    key={i}
                    className="flex items-center gap-2 rounded-lg bg-[var(--kaypal-v3-danger-soft)] px-3 py-2 text-xs text-[var(--kaypal-v3-danger)]"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    第 {f.index + 1} 页：{f.error || "配图失败"}
                  </p>
                ))}
              </div>
            </div>
          )}

          {tags.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                推荐标签
              </h3>
              <div className="flex flex-wrap gap-2">
                {tags.map((t, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-[var(--kaypal-v3-accent-soft)] px-3 py-1 text-xs font-medium text-[var(--kaypal-v3-accent-ink)]"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {reviewInfo && (
            <div
              className={`rounded-xl border p-4 ${
                reviewInfo.pass
                  ? "border-green-200 bg-green-50 dark:border-green-500/30 dark:bg-green-500/15"
                  : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/15"
              }`}
            >
              <h3 className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                质量审稿：{reviewInfo.score} 分
                {reviewInfo.pass ? "（达标 ✅）" : "（未达标 ⚠️，已尝试修订）"}
              </h3>
              {reviewInfo.issues.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[var(--kaypal-v3-soft-ink)]">
                  {reviewInfo.issues.map((issue, i) => (
                    <li key={i}>
                      [{issue.dimension}/{issue.severity}] {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {evidence && (
            <div className="rounded-xl border border-[var(--kaypal-v3-border)] p-4">
              <h3 className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                生成证据链
              </h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--kaypal-v3-muted)]">
                <dt>生成时间</dt>
                <dd>{String(evidence.generatedAt || "")}</dd>
                <dt>模型</dt>
                <dd>{String(evidence.modelId || "")}</dd>
                <dt>去 AI 味</dt>
                <dd>{evidence.deFlavorApplied ? "已应用" : "未应用"}</dd>
                <dt>配图</dt>
                <dd>
                  {String(evidence.imageSuccess ?? 0)} 成功 /{" "}
                  {String(evidence.imageFailed ?? 0)} 失败
                </dd>
              </dl>
            </div>
          )}

          {stage === "done" && generated.length === 0 && failed.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
              <ArrowRight className="h-4 w-4" />
              生成完成，可复制链接刷新恢复查看
            </p>
          )}
        </V2Section>
      )}
    </div>
  );
}
