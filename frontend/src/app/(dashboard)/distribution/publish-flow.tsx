"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  PenLine,
  RefreshCcw,
  Send,
  ShieldCheck,
  Smartphone,
  Upload,
  Video,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2Textarea,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
  V2Disclosure,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import {
  autoUploadApi,
  type AutoUploadAccount,
  type AutoUploadMaterial,
  type AutoUploadPublishPayload,
  type AutoUploadPublishPreflightResult,
} from "@/lib/api/auto-upload";
import { articlesApi, type Article } from "@/lib/api/articles";
import {
  checkCompliance,
  type ComplianceCheckResult,
} from "@/lib/api/compliance";
import { api } from "@/lib/api/client";
import {
  autoUploadAccountIdentityKey,
  dedupeAutoUploadAccounts,
  isAutoUploadAccountLoggedIn,
} from "@/lib/auto-upload-account-state";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  copyText,
  openApp,
  platformTypeToKey,
  type PlatformKey,
} from "@/lib/mobile-bridge";

type Step = 1 | 2 | 3 | 4 | 5;

const PLATFORM_NAMES: Record<number, string> = {
  1: "小红书",
  2: "视频号",
  3: "抖音",
  4: "快手",
  5: "B站",
  6: "微博",
  7: "知乎",
  8: "头条",
  9: "公众号",
};

/** 分享到社交平台按钮的图标（与 PLATFORM_NAMES 对齐，仅用于移动端分享入口） */
const PLATFORM_EMOJI: Record<number, string> = {
  1: "📕",
  2: "📹",
  3: "🎵",
  4: "⚡",
  5: "🅱️",
  6: "📢",
  7: "💬",
  8: "📰",
  9: "📱",
};

const STEP_TITLES = ["选内容", "选账号", "选素材", "填信息", "预检发布"];

export function PublishFlow({ contentKind = "article" }: { contentKind?: "article" | "video" }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 第 1 步：内容
  const [mode, setMode] = useState<"library" | "manual">("library");
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);

  // 第 2 步：账号
  const [accounts, setAccounts] = useState<AutoUploadAccount[]>([]);
  const [selectedAccountKeys, setSelectedAccountKeys] = useState<string[]>([]);

  // 第 3 步：素材
  const [materials, setMaterials] = useState<AutoUploadMaterial[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const materialFileRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  /* 移动端手动发布线：生成发布包（不提交引擎任务） */
  const [manualPublish, setManualPublish] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  /* 分享到社交平台：点平台按钮 → 复制内容 + 调起对应 App（2026-08-11 真机需求） */
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [compliance, setCompliance] = useState<
    | { status: "idle" }
    | { status: "checking" }
    | { status: "done"; result: ComplianceCheckResult & { degraded?: boolean } }
  >({ status: "idle" });
  const [coverPath, setCoverPath] = useState<string>("");

  // 第 4 步：信息
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  const [timing, setTiming] = useState<"now" | "schedule">("now");
  const [videosPerDay, setVideosPerDay] = useState(1);
  const [dailyTime, setDailyTime] = useState("12:00");
  const [startDays, setStartDays] = useState(0);
  const [timeJitter, setTimeJitter] = useState(0);
  const [scheduleTime, setScheduleTime] = useState("");
  const [execMode, setExecMode] = useState<"dry-run" | "publish">("publish");

  // 第 5 步：预检与提交
  const [preflightResult, setPreflightResult] = useState<AutoUploadPublishPreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  const isVideo = contentKind === "video";

  /* 加载基础数据 */
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [articleData, accountData, materialData] = await Promise.allSettled([
          isVideo ? Promise.resolve([]) : articlesApi.list({ limit: 40 }),
        autoUploadApi.accounts(),
          autoUploadApi.materials(),
        ]);
        if (articleData.status === "fulfilled") {
          const list = Array.isArray(articleData.value)
            ? articleData.value
            : (articleData.value as { items?: Article[] }).items || [];
          setArticles(list);
        }
        if (accountData.status === "fulfilled") {
          setAccounts(dedupeAutoUploadAccounts(accountData.value));
        }
        if (materialData.status === "fulfilled") {
          setMaterials(Array.isArray(materialData.value) ? materialData.value : []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [isVideo]);

  /* 选中文章时自动带标题/文案/标签（与旧版一致） */
  const pickArticle = (article: Article) => {
    setSelectedArticle(article);
    setTitle(article.title || "");
    const articleBody = (article as { content?: string }).content || "";
    setBody(articleBody);
    const articleTags = (article as { tags?: string[] }).tags;
    if (articleTags?.length) setTags(articleTags.join(", "));
    // 空正文文章不能发（预检会拦），提前告诉用户
    if (!articleBody.trim()) {
      setError("这篇文章正文是空的，不能发布。请先在内容编辑器里写好正文，或换一篇。");
    } else {
      setError(null);
    }
  };

  /* 可用账号：登录正常的 */
  const usableAccounts = useMemo(
    () => accounts.filter(isAutoUploadAccountLoggedIn),
    [accounts],
  );

  const toggleAccount = (key: string) => {
    setSelectedAccountKeys((prev) =>
      prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key],
    );
  };

  const handleMaterialUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        await autoUploadApi.uploadMaterial(formData);
      }
      const refreshed = await autoUploadApi.materials();
      setMaterials(Array.isArray(refreshed) ? refreshed : []);
    } catch (error) {
      setUploadError(toPublicError(error, "素材上传失败，请稍后重试"));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const isImageFile = (filename: string) =>
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(filename);

  /** 重新拉取发布素材（去素材库做去水印采集后，回到这里点刷新即可看到新素材） */
  const refreshMaterials = async () => {
    try {
      const refreshed = await autoUploadApi.materials();
      setMaterials(Array.isArray(refreshed) ? refreshed : []);
    } catch {
      /* 刷新失败静默 */
    }
  };

  const copyToClipboard = async (field: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  /* 分享到社交平台：复制内容 + 调起对应平台 App（壳桥 openApp / PWA 深链兜底） */
  const handleShareToPlatform = async (type: number) => {
    const text = getPublishPackageText();
    const copied = await copyText(text);
    const key: PlatformKey = platformTypeToKey(type);
    const opened = openApp(key);
    const platformName = PLATFORM_NAMES[type] || PLATFORM_NAMES[3];
    if (!copied.ok) {
      setShareMsg(`${platformName}内容复制失败，请手动复制。`);
      return;
    }
    if (opened.ok) {
      setShareMsg(`已复制内容并调起${platformName}，到 App 内粘贴即可发布。`);
    } else {
      setShareMsg(`内容已复制；${opened.message}，请手动打开${platformName}粘贴发布。`);
    }
    setTimeout(() => setShareMsg(null), 4000);
  };

  const runComplianceCheck = async () => {
    if (compliance.status === "checking") return;
    const payload = buildPayloads()[0];
    const text = [payload?.title, payload?.body].filter(Boolean).join("\n\n");
    if (!text.trim()) return;
    setCompliance({ status: "checking" });
    try {
      // 统一到后端 compliance.service（报告 4.5）：按 riskLevel 分级 + gate
      const result = await checkCompliance({
        content: text,
        platform: payload?.accountIdentity?.platform ?? undefined,
        targetType: contentKind === "video" ? "video_script" : "article",
        targetId: selectedArticle?.id,
        title: payload?.title,
        scenario: "pre_publish",
      });
      setCompliance({ status: "done", result });
    } catch {
      // S0-4 fail-closed：检查接口异常时不得伪装「通过」，标记 degraded 由 UI 显示「检查不可用」
      setCompliance({
        status: "done",
        result: {
          checkId: "",
          targetType: "article",
          platform: "all",
          riskLevel: "high",
          riskScore: 0,
          summary: "",
          findings: [],
          suggestions: [],
          gate: {
            publishAllowed: false,
            manualReviewRequired: true,
            reason: "检查服务不可用",
            nextActions: ["重试检查"],
          },
          degraded: true,
        },
      });
    }
  };

  const getPublishPackageText = () => {
    const payload = buildPayloads()[0];
    if (!payload) return "";
    return [payload.title, payload.body, payload.tags]
      .filter((part) => part && String(part).trim())
      .join("\n\n");
  };

  const toggleMaterial = (filename: string) => {
    setSelectedMaterials((prev) =>
      prev.includes(filename)
        ? prev.filter((x) => x !== filename)
        : [...prev, filename],
    );
  };

  /* 组装发布载荷（与旧版字段一致） */
  const buildPayloads = useCallback((): AutoUploadPublishPayload[] => {
    const selectedAccounts = accounts.filter((account) =>
      selectedAccountKeys.includes(autoUploadAccountIdentityKey(account)),
    );
    return selectedAccounts.map((account) => ({
      type: account.type,
      accountIds: [account.id],
      contentKind,
      articleId: selectedArticle?.id,
      title: title.trim(),
      tags: tags
        .split(/[,，\s#]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      body: body.trim(),
      fileList: selectedMaterials,
      // accountList 传账号 filePath（后端按 filePath 匹配发布账号，不是显示名）
      accountList: [account.filePath].filter(Boolean) as string[],
      enableTimer: timing === "schedule" ? 1 : 0,
      videosPerDay,
      dailyTimes: timing === "schedule"
        ? dailyTime.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
        : [],
      startDays,
      timeJitterMinutes: timeJitter,
      scheduleTime: scheduleTime || undefined,
      debugDryRun: execMode === "dry-run",
      debugDryRunHoldBrowser: false,
      category: 0,
      coverPath: coverPath || undefined,
      sourceIdentity: selectedArticle
        ? {
            sourceType: "article",
            sourceId: selectedArticle.id,
            title: selectedArticle.title || "",
            contentType: contentKind,
            contentFormat: contentKind,
            updatedAt: selectedArticle.updatedAt || new Date().toISOString(),
          }
        : undefined,
    }));
  }, [
    accounts,
    selectedAccountKeys,
    contentKind,
    selectedArticle,
    title,
    tags,
    body,
    selectedMaterials,
    coverPath,
    timing,
    videosPerDay,
    dailyTime,
    startDays,
    timeJitter,
    scheduleTime,
    execMode,
  ]);

  /* 预检 */
  const runPreflight = useCallback(async () => {
    setPreflightLoading(true);
    setError(null);
    try {
      const payloads = buildPayloads();
      const result = await autoUploadApi.preflight(payloads);
      setPreflightResult(result);
    } catch (err: unknown) {
      setError(toPublicError(err, "预检失败，请稍后重试"));
    } finally {
      setPreflightLoading(false);
    }
  }, [buildPayloads]);

  /* 进入第 5 步时自动预检 */
  useEffect(() => {
    if (step === 5) {
      void runPreflight();
    }
  }, [step, runPreflight]);

  /* 提交发布（与旧版发布链一致） */
  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payloads = buildPayloads();
      // 平台内容体检（标题/正文/话题/敏感词规则，纯前端拦截，不进发布队列）
      const platformTypeToSlug: Record<number, string> = {
        1: "xiaohongshu",
        2: "wechat-channel",
        3: "douyin",
        4: "kuaishou",
        5: "bilibili",
      };
      const checkedPlatforms = new Set<string>();
      const contentChecks: Array<{
        platform: string;
        title: string;
        content: string;
        tags: string[];
      }> = [];
      for (const payload of payloads) {
        const slug = platformTypeToSlug[payload.type] ?? "";
        if (!slug || checkedPlatforms.has(slug)) continue;
        checkedPlatforms.add(slug);
        contentChecks.push({
          platform: slug,
          title: payload.title ?? "",
          content: payload.body ?? "",
          tags: Array.isArray(payload.tags) ? payload.tags : [],
        });
      }
      if (contentChecks.length > 0) {
        const results = await Promise.all(
          contentChecks.map((check) =>
            api.post<{
              platform: string;
              platformName: string;
              valid: boolean;
              errors: string[];
              suggestions: string[];
            }>("/publishing/preflight", check),
          ),
        );
        const failed = results.filter((result) => !result.valid);
        if (failed.length > 0) {
          const first = failed[0];
          setError(
            `发布前体检未通过（${first.platformName}）：${first.errors?.[0] ?? "内容不符合平台要求"}`,
          );
          setSubmitting(false);
          return;
        }
      }
      if (execMode === "dry-run") {
        // 发布前检查：直接 dry-run 提交
        await autoUploadApi.publish(payloads);
        setSubmitMessage("预演任务已创建，只是走一遍流程不会真发");
      } else {
        // 正式发布：先创建确认 → 再发布
        const confirmation = await autoUploadApi.createPublishConfirmation(payloads);
        await autoUploadApi.publish(payloads, confirmation.confirmationId);
        setSubmitMessage(
          "发布任务已提交，系统正在按队列执行。去「发布任务」里能看到进度和结果",
        );
      }
      setSubmitted(true);
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(
        rawMessage
          ? `发布失败：${rawMessage}`
          : toPublicError(err, "发布失败，请稍后重试"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* 步骤校验 */
  const canNext = useMemo(() => {
    if (step === 1) return mode === "manual" || Boolean(selectedArticle);
    if (step === 2) return selectedAccountKeys.length > 0;
    // 第 3 步：图文允许跳过素材（UI 文案「图文可以带图，也可以跳过」）；
    // 仅视频发布必须选素材（`isVideo` 时描述为「视频发布必须选素材」）。
    if (step === 3) return isVideo ? selectedMaterials.length > 0 : true;
    if (step === 4) return title.trim().length > 0;
    return true;
  }, [step, mode, selectedArticle, selectedAccountKeys, selectedMaterials, title, isVideo]);

  // 预检问题：真实字段是 ok + issues（带 nextAction）
  const preflightIssues = useMemo(() => {
    if (!preflightResult) return [];
    return (preflightResult.issues || [])
      // 移动端发布走「发布包 + 分享到平台 App」原生链路，不依赖桌面本地引擎，
      // engine_unavailable（本机发布服务）对手机端无意义，直接过滤（2026-08-11 原生发布改造）
      .filter((issue) => !(isMobile && issue.code === "engine_unavailable"))
      .map((issue) => ({
        message: issue.message,
        nextAction: issue.nextAction,
        scope: issue.scope,
      }));
  }, [preflightResult, isMobile]);

  const preflightPassed = preflightResult ? preflightResult.ok : false;

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
      </div>
    );
  }

  /* 成功态 */
  if (submitted) {
    return (
      <div className="flex flex-col gap-6">
        <V2Section>
          <div className="py-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-success-soft)]">
              <CheckCircle2 className="h-8 w-8 text-[var(--kaypal-v3-success)]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              {execMode === "dry-run" ? "预演任务已创建" : "发布任务已创建"}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--kaypal-v3-muted)]">
              {submitMessage}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <V2PrimaryButton onClick={() => router.push("/distribution/tasks")}>
                去「发布任务」看进度
              </V2PrimaryButton>
              <V2GhostButton onClick={() => router.push("/distribution")}>
                返回发布中心
              </V2GhostButton>
            </div>
          </div>
        </V2Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 + 步骤条 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/distribution")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)] sm:text-2xl">
              {isVideo ? "发布视频" : "发布图文"}
            </h1>
            {/* 移动端：紧凑步骤条（第 N 步 / 共 5 步） */}
            <div className="mt-3 flex items-center gap-3 sm:hidden">
              <div className="flex flex-1 items-center gap-1.5">
                {STEP_TITLES.map((t, i) => {
                  const num = (i + 1) as Step;
                  return (
                    <div
                      key={t}
                      className={`h-1 flex-1 rounded-full ${
                        step >= num ? "bg-[var(--kaypal-v3-accent)]" : "bg-[var(--kaypal-v3-border)]"
                      }`}
                    />
                  );
                })}
              </div>
              <span className="shrink-0 text-xs font-medium text-[var(--kaypal-v3-muted)]">
                第 {step} / 5 步 · {STEP_TITLES[step - 1]}
              </span>
            </div>
            {/* 桌面端：完整步骤条 */}
            <div className="mt-3 hidden items-center gap-1.5 sm:flex">
              {STEP_TITLES.map((t, i) => {
                const num = (i + 1) as Step;
                return (
                  <div key={t} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <div className="h-px w-4 bg-[var(--kaypal-v3-border-strong)]" />
                    )}
                    <span
                      className={`flex items-center gap-1 text-xs ${
                        step >= num
                          ? "font-medium text-[var(--kaypal-v3-accent-ink)]"
                          : "text-[var(--kaypal-v3-muted)]"
                      }`}
                    >
                      <span
                        className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-11 ${
                          step >= num
                            ? "bg-[var(--kaypal-v3-accent)] text-white"
                            : "bg-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)]"
                        }`}
                        style={{ height: 18, width: 18 }}
                      >
                        {step > num ? "✓" : num}
                      </span>
                      {t}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：选内容 */}
      {step === 1 && (
        <V2Section title="发什么内容？">
          <div className="grid gap-3 sm:grid-cols-2">
            <V2OptionCard
              icon={FileText}
              title="从内容库选"
              description="AI 已生成好的内容"
              selected={mode === "library"}
              onClick={() => setMode("library")}
            />
            <V2OptionCard
              icon={PenLine}
              title="直接写"
              description={isVideo ? "手动填标题和文案" : "图文发布必须选库里的文章"}
              selected={mode === "manual"}
              onClick={() => (isVideo ? setMode("manual") : undefined)}
            />
          </div>
          {mode === "library" && !isVideo && (
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {articles.length === 0 ? (
                <V2EmptyState icon={FileText} title="内容库是空的" description="先去内容生成里做几篇" />
              ) : (
                articles.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    className={`w-full rounded-[var(--kaypal-v3-radius-sm)] border p-4 text-left transition ${
                      selectedArticle?.id === article.id
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                        : "border-[var(--kaypal-v3-border)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                    onClick={() => pickArticle(article)}
                  >
                    <p className="font-medium text-[var(--kaypal-v3-ink)]">
                      {article.title || "未命名"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                      {article.createdAt
                        ? new Date(article.createdAt).toLocaleDateString("zh-CN")
                        : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
          <div className="mt-6 flex justify-end">
            <V2PrimaryButton icon={ArrowRight} disabled={!canNext} onClick={() => setStep(2)}>
              下一步
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 第 2 步：选账号 */}
      {step === 2 && (
        <V2Section title="发到哪些账号？" description="只显示登录正常的账号">
          {usableAccounts.length === 0 ? (
            <V2EmptyState
              icon={Smartphone}
              title="没有登录正常的账号"
              description="先到「平台账号」扫码登录"
              action={
                <V2PrimaryButton onClick={() => router.push("/distribution/accounts")}>
                  去登录账号
                </V2PrimaryButton>
              }
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {usableAccounts.map((account) => {
                const accountKey = autoUploadAccountIdentityKey(account);
                const selected = selectedAccountKeys.includes(accountKey);
                return (
                  <button
                    key={accountKey}
                    type="button"
                    className={`flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] border p-4 text-left transition ${
                      selected
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                        : "border-[var(--kaypal-v3-border)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                    onClick={() => toggleAccount(accountKey)}
                  >
                    <div>
                      <p className="font-medium text-[var(--kaypal-v3-ink)]">
                        {account.profileName || account.userName || `账号 ${account.id}`}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                        {PLATFORM_NAMES[account.type] || `平台 ${account.type}`}
                      </p>
                    </div>
                    {selected && (
                      <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(1)}>上一步</V2GhostButton>
            <V2PrimaryButton icon={ArrowRight} disabled={!canNext} onClick={() => setStep(3)}>
              下一步
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 第 3 步：选素材 */}
      {step === 3 && (
        <V2Section
          title={isVideo ? "选视频素材" : "选配图素材（可选）"}
          description={isVideo ? "视频发布必须选素材" : "图文可以带图，也可以跳过"}
        >
          {/* 相册上传入口（组件级隐藏 input，手机/电脑通用） */}
          <input
            ref={materialFileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="sr-only"
            onChange={(e) => void handleMaterialUpload(e)}
          />
          {materials.length === 0 ? (
            <V2EmptyState
              icon={Video}
              title="素材库是空的"
              description="从手机相册直接上传，或到素材库用「去水印」采集作品，回来后点「刷新素材」"
              action={
                <>
                  <V2PrimaryButton
                    icon={uploading ? undefined : Upload}
                    disabled={uploading}
                    onClick={() => materialFileRef.current?.click()}
                  >
                    {uploading ? "上传中…" : "从相册上传"}
                  </V2PrimaryButton>
                  <V2GhostButton onClick={() => void refreshMaterials()}>
                    刷新素材
                  </V2GhostButton>
                  <V2GhostButton onClick={() => router.push("/materials?open=download")}>
                    去素材库去水印
                  </V2GhostButton>
                </>
              }
            />
          ) : (
            <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <V2GhostButton
                  icon={uploading ? undefined : Upload}
                  disabled={uploading}
                  onClick={() => materialFileRef.current?.click()}
                >
                  {uploading ? "上传中…" : "从相册上传"}
                </V2GhostButton>
                <V2GhostButton icon={RefreshCcw} onClick={() => void refreshMaterials()}>
                  刷新素材
                </V2GhostButton>
              </div>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">
                共 {materials.length} 个素材 · 已选 {selectedMaterials.length}
              </p>
            </div>
            {uploadError && (
              <p className="mb-3 text-xs text-red-600">{uploadError}</p>
            )}
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
              {materials.map((material) => {
                const selected = selectedMaterials.includes(material.filename);
                const previewable = isImageFile(material.filename);
                return (
                  <button
                    key={material.filename}
                    type="button"
                    className={`flex items-center gap-2 overflow-hidden rounded-[var(--kaypal-v3-radius-sm)] border p-2 text-left transition ${
                      selected
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                        : "border-[var(--kaypal-v3-border)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                    onClick={() => toggleMaterial(material.filename)}
                  >
                    {previewable && (
                      /* eslint-disable-next-line @next/next/no-img-element -- 静态导出无法用 next/image 优化 */
                      <img
                        src={autoUploadApi.materialPreviewUrl(material.filename)}
                        alt={material.filename}
                        className="h-10 w-10 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {material.filename}
                      </p>
                      <p className="text-xs text-[var(--kaypal-v3-muted)]">
                        {material.filesizeMb ? `${material.filesizeMb.toFixed(1)}MB` : ""}
                      </p>
                    </div>
                    {selected && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-accent)]" />
                    )}
                  </button>
                );
              })}
            </div>
            </>
          )}
          {selectedMaterials.length > 0 && (
            <div className="mt-5 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
              <V2Field label="封面" hint="可选：从已选素材里挑一个当封面，不选用默认">
                <V2Select
                  value={coverPath}
                  onChange={(e) => setCoverPath(e.target.value)}
                >
                  <option value="">默认封面</option>
                  {selectedMaterials.map((filename) => (
                    <option key={filename} value={filename}>
                      {filename}
                    </option>
                  ))}
                </V2Select>
              </V2Field>
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(2)}>上一步</V2GhostButton>
            <V2PrimaryButton icon={ArrowRight} disabled={!canNext} onClick={() => setStep(4)}>
              {isVideo ? "下一步" : "跳过/下一步"}
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 第 4 步：填信息 */}
      {step === 4 && (
        <V2Section title="标题和发布方式">
          <div className="grid gap-5">
            <V2Field label="标题" required>
              <V2Input
                placeholder="给内容起个标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </V2Field>
            <V2Field label="标签" hint="逗号分隔，可选">
              <V2Input
                placeholder="例如：装修, 干货"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </V2Field>
            <V2Field label="文案">
              <V2Textarea
                rows={4}
                placeholder="正文文案..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </V2Field>

            <V2Field label="什么时候发？">
              <div className="grid grid-cols-2 gap-3">
                <V2OptionCard
                  icon={Send}
                  title="立即发布"
                  description="确认后马上发"
                  selected={timing === "now"}
                  onClick={() => setTiming("now")}
                />
                <V2OptionCard
                  icon={Loader2}
                  title="定时发布"
                  description="每天固定时间发"
                  selected={timing === "schedule"}
                  onClick={() => setTiming("schedule")}
                />
              </div>
            </V2Field>

            {timing === "schedule" && (
              <div className="grid gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-4">
                  <V2Field label="每天几条">
                    <V2Input
                      type="number"
                      min={1}
                      value={videosPerDay}
                      onChange={(e) => setVideosPerDay(Number(e.target.value))}
                    />
                  </V2Field>
                  <V2Field label="几天后开始">
                    <V2Input
                      type="number"
                      min={0}
                      value={startDays}
                      onChange={(e) => setStartDays(Number(e.target.value))}
                    />
                  </V2Field>
                  <V2Field label="随机浮动（分钟）" hint="0=准时发">
                    <V2Input
                      type="number"
                      min={0}
                      value={timeJitter}
                      onChange={(e) => setTimeJitter(Number(e.target.value))}
                    />
                  </V2Field>
                </div>
                <V2Field label="每天发布时间" hint="多个时间用逗号分隔，例如：09:00, 18:00">
                  <V2Input
                    placeholder="09:00"
                    value={dailyTime}
                    onChange={(e) => setDailyTime(e.target.value)}
                  />
                </V2Field>
                <V2Field label="固定发布时间" hint="可选：指定某个确切时刻一次性发布（ datetime ）">
                  <V2Input
                    type="datetime-local"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                </V2Field>
              </div>
            )}

            <V2Field label="执行方式">
              <div className="grid grid-cols-2 gap-3">
                <V2OptionCard
                  icon={ShieldCheck}
                  title="安全检查"
                  description="只检查内容和账号，不会发布"
                  selected={execMode === "dry-run"}
                  onClick={() => setExecMode("dry-run")}
                />
                <V2OptionCard
                  icon={Send}
                  title="正式发布"
                  description="进「待我确认」，你放行才发"
                  selected={execMode === "publish"}
                  onClick={() => setExecMode("publish")}
                />
              </div>
            </V2Field>

            {/* B站参数（高级，选了 B站账号才有意义） */}
            {accounts.some(
              (account) =>
                selectedAccountKeys.includes(
                  autoUploadAccountIdentityKey(account),
                ) && account.type === 5,
            ) && (
              <V2Disclosure>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">
                  检测到 B站账号。B站独立标题/分区等专属参数还在接入中，当前用统一标题提交；需要专属参数请先用旧版发布
                </p>
              </V2Disclosure>
            )}
          </div>
          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(3)}>上一步</V2GhostButton>
            <V2PrimaryButton icon={ArrowRight} disabled={!canNext} onClick={() => setStep(5)}>
              去预检
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 第 5 步：预检 + 提交 */}
      {step === 5 && (
        <V2Section
          title={execMode === "dry-run" ? "发布前检查" : "确认并提交"}
          description={`${selectedAccountKeys.length} 个账号 · ${execMode === "dry-run" ? "安全检查" : "正式发布"}`}
        >
          {preflightLoading ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--kaypal-v3-accent)]" />
              <p className="mt-3 text-sm text-[var(--kaypal-v3-muted)]">正在预检...</p>
            </div>
          ) : !preflightPassed ? (
            <div className="space-y-3">
              <p className="font-medium text-[var(--kaypal-v3-danger)]">
                预检发现 {preflightIssues.length} 个问题，解决后才能发：
              </p>
              {preflightIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--kaypal-v3-danger)]" />
                  <div>
                    <p className="text-sm text-[var(--kaypal-v3-ink)]">{issue.message}</p>
                    {issue.nextAction && (
                      <p className="mt-1 text-sm text-[var(--kaypal-v3-accent-ink)]">
                        怎么办：{issue.nextAction}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex justify-end">
                <V2GhostButton icon={ArrowLeft} onClick={() => setStep(4)}>
                  回去修改
                </V2GhostButton>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
                <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
                <span className="text-sm font-medium text-[var(--kaypal-v3-success)]">
                  预检通过，可以提交
                </span>
              </div>

              {/* 摘要 */}
              <div className="mt-4 space-y-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-4 text-sm">
                <p><strong>标题：</strong>{title}</p>
                <p><strong>账号：</strong>{selectedAccountKeys.length} 个</p>
                {selectedMaterials.length > 0 && (
                  <p><strong>素材：</strong>{selectedMaterials.length} 个</p>
                )}
                <p><strong>方式：</strong>{timing === "now" ? "立即发布" : `定时 ${dailyTime}`}</p>
                <p><strong>模式：</strong>{execMode === "dry-run" ? "发布前检查（不真发）" : "正式发布（先进待我确认）"}</p>
              </div>

              {execMode === "publish" && (
                <div className="mt-4 flex items-start gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--kaypal-v3-amber)]" />
                  <p className="text-sm text-[var(--kaypal-v3-ink)]">
                    提交后任务会进入「待我确认」，你在任务中心放行后系统才会真的发布。
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 rounded-[var(--kaypal-v3-radius-md)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                合规体检
              </p>
              {compliance.status === "done" &&
                (compliance.result.degraded ? (
                  <span className="rounded-full bg-[var(--kaypal-v3-amber-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--kaypal-v3-amber)]">
                    ⚠️ 检查不可用
                  </span>
                ) : compliance.result.riskLevel === "pass" ? (
                  <span className="rounded-full bg-[var(--kaypal-v3-success-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--kaypal-v3-success)]">
                    ✅ 通过
                  </span>
                ) : (
                  <span className="rounded-full bg-[var(--kaypal-v3-danger-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--kaypal-v3-danger)]">
                    ⚠️ {compliance.result.findings.length} 个风险
                  </span>
                ))}
            </div>
            <p className="mb-3 text-xs text-[var(--kaypal-v3-muted)]">
              发布前提醒
            </p>
            {compliance.status === "idle" && (
              <V2GhostButton icon={ShieldCheck} onClick={() => void runComplianceCheck()}>
                开始体检
              </V2GhostButton>
            )}
            {compliance.status === "checking" && (
              <div className="flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" /> 检测中…
              </div>
            )}
            {compliance.status === "done" && compliance.result.findings.length > 0 && (
              <div className="mt-2 space-y-2">
                {compliance.result.findings.map((finding) => {
                  const blocked = finding.riskLevel === "high" || finding.riskLevel === "medium";
                  return (
                    <div
                      key={finding.id}
                      className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${
                        blocked
                          ? "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]"
                          : "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold ${blocked ? "text-[var(--kaypal-v3-danger)]" : "text-[var(--kaypal-v3-amber)]"}`}>
                          {blocked ? "⛔ " : "⚠️ "}
                          「{finding.matchedText}」{finding.reason ? ` · ${finding.reason}` : ""}
                        </p>
                        {finding.suggestion && (
                          <p className={`mt-0.5 ${blocked ? "text-[var(--kaypal-v3-danger)]" : "text-[var(--kaypal-v3-amber)]"}`}>
                            建议：{finding.suggestion}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <V2GhostButton icon={ShieldCheck} onClick={() => void runComplianceCheck()}>
                  修改后重新体检
                </V2GhostButton>
              </div>
            )}
            {compliance.status === "done" && compliance.result.degraded && (
              <div className="mt-2">
                <p className="text-xs text-amber-600">
                  违禁词检查服务暂不可用，请重试；未完成检查前不建议发布。
                </p>
                <V2GhostButton icon={ShieldCheck} onClick={() => void runComplianceCheck()}>
                  重新检查
                </V2GhostButton>
              </div>
            )}
            {compliance.status === "done" && compliance.result.riskLevel === "pass" && !compliance.result.degraded && (
              <p className="text-xs text-emerald-600">文案没有发现合规风险，可以放心发布。</p>
            )}
          </div>

          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(4)}>上一步</V2GhostButton>
            {preflightPassed && !preflightLoading &&
              (isMobile && execMode === "publish" && !manualPublish ? (
                <V2PrimaryButton
                  icon={Smartphone}
                  onClick={() => setManualPublish(true)}
                >
                  生成发布包，去 App 手动发
                </V2PrimaryButton>
              ) : (
                <V2PrimaryButton
                  icon={submitting ? Loader2 : Send}
                  loading={submitting}
                  onClick={handleSubmit}
                >
                  {submitting
                    ? "正在提交..."
                    : execMode === "dry-run"
                      ? "开始预演"
                      : "提交发布"}
                </V2PrimaryButton>
              ))}
          </div>

          {/* 移动端手动发布线：发布包卡片（PRD：手机端不自动发布） */}
          {manualPublish && (
            <div className="mt-6 rounded-[var(--kaypal-v3-radius-md)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
              <div className="mb-3">
                <p className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                  发布包已生成（手机端不自动发布）
                </p>
                <p className="text-xs text-[var(--kaypal-v3-muted)]">
                  复制内容后，到目标平台 App 手动发布，发布完回来确认
                </p>
              </div>

              {/* 多账号摘要：告诉用户这份发布包要逐个发到哪些账号 */}
              {selectedAccountKeys.length > 0 && (
                <div className="mb-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
                  <p className="font-semibold text-[var(--kaypal-v3-ink)]">
                    将发布到 {selectedAccountKeys.length} 个账号，逐个复制发布：
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {accounts
                      .filter((account) =>
                        selectedAccountKeys.includes(
                          autoUploadAccountIdentityKey(account),
                        ),
                      )
                      .map((account) => (
                        <p key={autoUploadAccountIdentityKey(account)}>
                          · {account.profileName || account.userName || `账号 ${account.id}`}
                          （{PLATFORM_NAMES[account.type] || `平台 ${account.type}`}）
                        </p>
                      ))}
                  </div>
                </div>
              )}

              <V2Field label="标题" hint="一键复制，到 App 粘贴">
                <div className="flex items-center gap-2">
                  <div className="flex-1 truncate rounded border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)]">
                    {buildPayloads()[0]?.title || "（无标题）"}
                  </div>
                  <V2GhostButton
                    icon={copiedField === "title" ? CheckCircle2 : Copy}
                    onClick={() =>
                      void copyToClipboard("title", buildPayloads()[0]?.title || "")
                    }
                  >
                    {copiedField === "title" ? "已复制" : "复制"}
                  </V2GhostButton>
                </div>
              </V2Field>

              <V2Field label="正文" hint="复制后在 App 里粘贴正文">
                <div className="max-h-40 overflow-y-auto rounded border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-[var(--kaypal-v3-ink)]">
                  {buildPayloads()[0]?.body || "（无正文）"}
                </div>
                <V2GhostButton
                  className="mt-2"
                  icon={copiedField === "body" ? CheckCircle2 : Copy}
                  onClick={() =>
                    void copyToClipboard("body", buildPayloads()[0]?.body || "")
                  }
                >
                  {copiedField === "body" ? "已复制" : "复制正文"}
                </V2GhostButton>
              </V2Field>

              {selectedMaterials.length > 0 && (
                <V2Field label="配图素材" hint="对照缩略图，从相册选对应的图">
                  <div className="flex flex-wrap gap-2">
                    {selectedMaterials.map((filename) => (
                      /* eslint-disable-next-line @next/next/no-img-element -- 静态导出无法用 next/image 优化 */
                      <img
                        key={filename}
                        src={autoUploadApi.materialPreviewUrl(filename)}
                        alt={filename}
                        className="h-16 w-16 rounded object-cover"
                        loading="lazy"
                      />
                    ))}
                  </div>
                </V2Field>
              )}

              <div className="mt-4 flex flex-col gap-2">
                <V2PrimaryButton
                  icon={copiedField === "all" ? CheckCircle2 : Copy}
                  onClick={() => void copyToClipboard("all", getPublishPackageText())}
                >
                  {copiedField === "all" ? "已复制全部" : "一键复制全部内容"}
                </V2PrimaryButton>

                {/* 分享到社交平台：点平台 → 复制内容 + 调起对应 App（2026-08-11 真机需求） */}
                <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
                  <p className="text-xs font-semibold text-[var(--kaypal-v3-ink)]">
                    分享到社交平台
                  </p>
                  <p className="mt-0.5 text-11 text-[var(--kaypal-v3-muted)]">
                    点平台自动复制内容并调起对应 App，到 App 内粘贴即可发布
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Array.from(
                      new Set(
                        buildPayloads()
                          .map((p) => p.type)
                          .filter((t): t is number => Boolean(t)),
                      ),
                    ).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => void handleShareToPlatform(type)}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 py-1.5 text-sm font-medium text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
                      >
                        <span aria-hidden>{PLATFORM_EMOJI[type] || "📤"}</span>
                        {PLATFORM_NAMES[type] || `平台 ${type}`}
                      </button>
                    ))}
                  </div>
                  {shareMsg && (
                    <p className="mt-2 text-xs text-[var(--kaypal-v3-accent-ink)]">
                      {shareMsg}
                    </p>
                  )}
                </div>

                <V2PrimaryButton
                  icon={CheckCircle2}
                  onClick={() => {
                    setSubmitted(true);
                    setSubmitMessage(
                      "已在 App 发布？记得回来把任务状态同步一下；如需记录可到发布任务页",
                    );
                  }}
                >
                  我发完了
                </V2PrimaryButton>
              </div>
            </div>
          )}
        </V2Section>
      )}
    </div>
  );
}
