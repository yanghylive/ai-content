"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  PenLine,
  Send,
  ShieldCheck,
  Smartphone,
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
  autoUploadAccountIdentityKey,
  dedupeAutoUploadAccounts,
  isAutoUploadAccountLoggedIn,
} from "@/lib/auto-upload-account-state";
import { toPublicError } from "@/lib/public-error";

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
    if (step === 3) return selectedMaterials.length > 0;
    if (step === 4) return title.trim().length > 0;
    return true;
  }, [step, mode, selectedArticle, selectedAccountKeys, selectedMaterials, title]);

  // 预检问题：真实字段是 ok + issues（带 nextAction）
  const preflightIssues = useMemo(() => {
    if (!preflightResult) return [];
    return (preflightResult.issues || []).map((issue) => ({
      message: issue.message,
      nextAction: issue.nextAction,
      scope: issue.scope,
    }));
  }, [preflightResult]);

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
              <V2PrimaryButton onClick={() => router.push("/distribution-v2/tasks")}>
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
            <h1 className="text-xl font-bold text-[var(--kaypal-v3-ink)] sm:text-2xl">
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
                        className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] ${
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
                <V2PrimaryButton onClick={() => router.push("/platforms")}>
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
          {materials.length === 0 ? (
            <V2EmptyState
              icon={Video}
              title="素材库是空的"
              description="先到素材库上传或让系统采集"
              action={
                <V2PrimaryButton onClick={() => router.push("/materials")}>
                  去素材库
                </V2PrimaryButton>
              }
            />
          ) : (
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
              {materials.map((material) => {
                const selected = selectedMaterials.includes(material.filename);
                return (
                  <button
                    key={material.filename}
                    type="button"
                    className={`flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] border p-3 text-left transition ${
                      selected
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                        : "border-[var(--kaypal-v3-border)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                    onClick={() => toggleMaterial(material.filename)}
                  >
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

          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(4)}>上一步</V2GhostButton>
            {preflightPassed && !preflightLoading && (
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
            )}
          </div>
        </V2Section>
      )}
    </div>
  );
}
