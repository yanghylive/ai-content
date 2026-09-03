"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import toast from "@/lib/toast";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "@/components/iconpark";
import { api } from "@/lib/api/client";
import {
  clearComplianceHandoff,
  loadComplianceHandoff,
} from "@/lib/content-workflow-storage";
import {
  createContentVersionComment,
  createContentVersionFeedback,
  createPublishPreparation,
  getContentOptimizationVersion,
  listContentVersionComments,
  listContentVersionFeedback,
  listContentOptimizationVersions,
  manualReviewContentVersion,
  markContentVersionCompliance,
  setOfficialContentVersion,
  type ContentVersionComment,
  type ContentVersionFeedback,
  type ContentOptimizationVersion,
  type ContentWorkflowPlatform,
  type ContentWorkflowTargetType,
} from "@/lib/api/content-optimization";
import { toActionableError } from "@/lib/public-error";

type ComplianceRiskLevel = "pass" | "low" | "medium" | "high";

type ComplianceFinding = {
  id: string;
  category:
    | "prohibited_word"
    | "absolute_claim"
    | "medical_claim"
    | "traffic_inducement"
    | "price_claim"
    | "privacy";
  riskLevel: ComplianceRiskLevel;
  matchedText: string;
  reason: string;
  suggestion: string;
  replacement?: string;
  startIndex?: number;
};

type ComplianceCheckResult = {
  checkId: string;
  targetType: ContentWorkflowTargetType;
  targetId?: string;
  platform: ContentWorkflowPlatform;
  riskLevel: ComplianceRiskLevel;
  riskScore: number;
  summary: string;
  findings: ComplianceFinding[];
  suggestions: string[];
  gate: {
    publishAllowed: boolean;
    manualReviewRequired: boolean;
    reason: string;
    nextActions: string[];
  };
  workflow: {
    source: "local_rule" | "redfox";
    status: "rule_screening" | "ready_for_redfox";
    plannedSkill: string;
    redfoxClientHook: string;
    generatedAt: string;
  };
};

type ComplianceCheckPayload = {
  content: string;
  platform: ContentWorkflowPlatform;
  targetType: ContentWorkflowTargetType;
  targetId?: string;
  title?: string;
  scenario: "pre_publish";
};

type FeedbackFormState = {
  views: string;
  likes: string;
  comments: string;
  saves: string;
  leads: string;
  note: string;
};

const platformOptions: Array<{
  label: string;
  value: ContentWorkflowPlatform;
}> = [
  { label: "全平台", value: "all" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "抖音", value: "douyin" },
  { label: "公众号", value: "wechat" },
  { label: "B站", value: "bilibili" },
  { label: "TikTok", value: "tiktok" },
];

const targetTypeOptions: Array<{
  label: string;
  value: ContentWorkflowTargetType;
}> = [
  { label: "图文文章", value: "article" },
  { label: "小红书笔记", value: "xiaohongshu_note" },
  { label: "视频脚本", value: "video_script" },
  { label: "评论回复", value: "comment_reply" },
  { label: "素材", value: "material" },
];

const riskLabel: Record<ComplianceRiskLevel, string> = {
  pass: "通过",
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

const findingCategoryLabel: Record<ComplianceFinding["category"], string> = {
  prohibited_word: "敏感词",
  absolute_claim: "绝对化承诺",
  medical_claim: "功效承诺",
  traffic_inducement: "站外引导",
  price_claim: "价格承诺",
  privacy: "隐私信息",
};

function riskTone(level: ComplianceRiskLevel) {
  if (level === "pass") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]";
  }
  if (level === "low") {
    return "border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]";
  }
  if (level === "medium") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]";
  }
  return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]";
}

function platformLabel(platform: ContentWorkflowPlatform) {
  return (
    platformOptions.find((item) => item.value === platform)?.label || platform
  );
}

function targetTypeLabel(targetType: ContentWorkflowTargetType) {
  return (
    targetTypeOptions.find((item) => item.value === targetType)?.label ||
    targetType
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function submitComplianceCheck(payload: ComplianceCheckPayload) {
  return api.post<ComplianceCheckResult>("/compliance/check", payload);
}

function parseMetric(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number));
}

export function ComplianceWorkbench() {
  const autoRunRef = useRef(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [platform, setPlatform] =
    useState<ContentWorkflowPlatform>("xiaohongshu");
  const [targetType, setTargetType] =
    useState<ContentWorkflowTargetType>("xiaohongshu_note");
  const [versionId, setVersionId] = useState("");
  const [versions, setVersions] = useState<ContentOptimizationVersion[]>([]);
  const [result, setResult] = useState<ComplianceCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState("");
  const [error, setError] = useState("");
  const [selectedVersion, setSelectedVersion] =
    useState<ContentOptimizationVersion | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewDone, setReviewDone] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [officialing, setOfficialing] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<ContentVersionFeedback[]>(
    [],
  );
  const [commentItems, setCommentItems] = useState<ContentVersionComment[]>([]);
  const [feedbackForm, setFeedbackForm] = useState<FeedbackFormState>({
    views: "0",
    likes: "0",
    comments: "0",
    saves: "0",
    leads: "0",
    note: "",
  });
  const [commentText, setCommentText] = useState("");
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [savingComment, setSavingComment] = useState(false);

  useEffect(() => {
    void refreshVersions();

    const handoff = loadComplianceHandoff();
    if (handoff && !autoRunRef.current) {
      autoRunRef.current = true;
      clearComplianceHandoff();

      setTitle(handoff.title);
      setContent(handoff.content);
      setPlatform(handoff.platform);
      setTargetType(handoff.targetType);
      setVersionId(handoff.versionId);
      void hydrateVersionContext(handoff.versionId);

      const payload: ComplianceCheckPayload = {
        title: handoff.title,
        content: handoff.content,
        platform: handoff.platform,
        targetType: handoff.targetType,
        targetId: handoff.versionId,
        scenario: "pre_publish",
      };

      void runComplianceWithPayload(payload);
      return;
    }

    const versionIdFromUrl =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("versionId")
        : null;
    if (versionIdFromUrl && !autoRunRef.current) {
      autoRunRef.current = true;
      void loadVersionById(versionIdFromUrl, { autoCheck: true });
    }
    // 只在页面首次打开时接收一次跨页内容，避免重复创建检查记录。
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshVersions() {
    try {
      const result = await listContentOptimizationVersions();
      setVersions(result.items);
    } catch (err) {
      const message = toActionableError(err, "版本加载失败");
      toast.error(message);
    }
  }

  async function hydrateVersionContext(id: string) {
    try {
      const version = await getContentOptimizationVersion(id);
      setSelectedVersion(version);
      syncReviewStateFromVersion(version);
      await refreshVersionRecords(id);
    } catch {
      setSelectedVersion(null);
      syncReviewStateFromVersion(null);
    }
  }

  async function refreshVersionRecords(id: string) {
    try {
      const [feedbackResult, commentResult] = await Promise.all([
        listContentVersionFeedback(id),
        listContentVersionComments(id),
      ]);
      setFeedbackItems(feedbackResult.items);
      setCommentItems(commentResult.items);
    } catch {
      setFeedbackItems([]);
      setCommentItems([]);
    }
  }

  function syncReviewStateFromVersion(
    version: ContentOptimizationVersion | null,
  ) {
    const review = version?.manualReview;
    const reviewed = Boolean(review?.reviewed) || version?.status === "reviewed";
    setReviewDone(reviewed);
    setReviewNote(review?.note || "");
  }

  function buildPayload(): ComplianceCheckPayload | null {
    if (!title.trim() && !content.trim()) {
      toast.error("请输入标题或正文");
      return null;
    }

    return {
      title: title.trim() || undefined,
      content,
      platform,
      targetType,
      targetId: versionId || undefined,
      scenario: "pre_publish",
    };
  }

  async function runCompliance() {
    const payload = buildPayload();
    if (!payload) return;

    await runComplianceWithPayload(payload);
  }

  async function runComplianceWithPayload(payload: ComplianceCheckPayload) {
    setLoading(true);
    setError("");
    setPublishStatus("");
    setReviewDone(false);
    try {
      const check = await submitComplianceCheck(payload);
      setResult(check);
      if (payload.targetId) {
        await markContentVersionCompliance(payload.targetId, {
          checkId: check.checkId,
          checkedAt: new Date().toISOString(),
          riskLevel: check.riskLevel,
          riskScore: check.riskScore,
          summary: check.summary,
        });
        await hydrateVersionContext(payload.targetId);
      }
      await refreshVersions();
      toast.success("发布前检查已完成");
    } catch (err) {
      const message = toActionableError(err, "发布前检查失败");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadVersionById(
    id: string,
    options: { autoCheck?: boolean } = {},
  ) {
    try {
      const version = await getContentOptimizationVersion(id);
      loadVersion(version);
      if (options.autoCheck) {
        await runComplianceWithPayload({
          title: version.title,
          content: version.content,
          platform: version.platform,
          targetType: version.targetType,
          targetId: version.id,
          scenario: "pre_publish",
        });
      }
    } catch (err) {
      const message = toActionableError(err, "版本加载失败");
      setError(message);
      toast.error(message);
    }
  }

  function loadVersion(version: ContentOptimizationVersion) {
    setTitle(version.title);
    setContent(version.content);
    setPlatform(version.platform);
    setTargetType(version.targetType);
    setVersionId(version.id);
    setSelectedVersion(version);
    setResult(null);
    setPublishStatus("");
    syncReviewStateFromVersion(version);
    setError("");
    void refreshVersionRecords(version.id);
  }

  async function createPublishReadyTask() {
    if (!versionId) {
      toast.error("请先载入正式稿");
      return;
    }

    setPublishing(true);
    setPublishStatus("");
    try {
      await createPublishPreparation({ versionId, platform });
      setPublishStatus("已创建发布准备，可进入发布中心继续安排。");
      toast.success("发布准备已创建");
      await refreshVersions();
    } catch (err) {
      const message = toActionableError(err, "发布准备创建失败");
      setPublishStatus(message);
      toast.error(message);
    } finally {
      setPublishing(false);
    }
  }

  async function confirmOfficialVersion() {
    if (!versionId) {
      toast.error("请先载入版本");
      return;
    }

    setOfficialing(true);
    try {
      const version = await setOfficialContentVersion(versionId);
      setSelectedVersion(version);
      await refreshVersions();
      toast.success("已确认正式稿");
    } catch (err) {
      const message = toActionableError(err, "正式稿确认失败");
      toast.error(message);
    } finally {
      setOfficialing(false);
    }
  }

  async function confirmManualReview() {
    if (!versionId) {
      toast.error("请先载入版本");
      return;
    }

    setReviewing(true);
    try {
      const version = await manualReviewContentVersion(versionId, reviewNote);
      setSelectedVersion(version);
      syncReviewStateFromVersion(version);
      await refreshVersions();
      toast.success("负责人复核已记录");
    } catch (err) {
      const message = toActionableError(err, "负责人复核失败");
      toast.error(message);
    } finally {
      setReviewing(false);
    }
  }

  async function saveFeedback() {
    if (!versionId) {
      toast.error("请先载入版本");
      return;
    }

    setSavingFeedback(true);
    try {
      await createContentVersionFeedback(versionId, {
        platform,
        views: parseMetric(feedbackForm.views),
        likes: parseMetric(feedbackForm.likes),
        comments: parseMetric(feedbackForm.comments),
        saves: parseMetric(feedbackForm.saves),
        leads: parseMetric(feedbackForm.leads),
        note: feedbackForm.note,
      });
      setFeedbackForm({
        views: "0",
        likes: "0",
        comments: "0",
        saves: "0",
        leads: "0",
        note: "",
      });
      await refreshVersionRecords(versionId);
      toast.success("复盘已记录");
    } catch (err) {
      const message = toActionableError(err, "复盘保存失败");
      toast.error(message);
    } finally {
      setSavingFeedback(false);
    }
  }

  async function saveComment() {
    if (!versionId) {
      toast.error("请先载入版本");
      return;
    }

    if (!commentText.trim()) {
      toast.error("请填写备注");
      return;
    }

    setSavingComment(true);
    try {
      await createContentVersionComment(versionId, commentText);
      setCommentText("");
      await refreshVersionRecords(versionId);
      toast.success("备注已保存");
    } catch (err) {
      const message = toActionableError(err, "备注保存失败");
      toast.error(message);
    } finally {
      setSavingComment(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-1 rounded-lg border border-primary-200 bg-primary-50 p-4">
        <p className="font-semibold text-primary-700">发布前内容合规检查</p>
        <p className="text-sm text-primary-600">所有结果由规则引擎自动生成，最终发布决策由您确认。</p>
      </div>
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
          <header className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <ShieldCheck
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">内容上线前</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  发布前检查
                </h1>
                <p className="mt-1 max-w-3xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  对标题、正文和脚本进行发布风险检查，给出命中项、改写建议和下一步处理方式。
                </p>
              </div>
            </div>
          </header>

          <aside className="p-4">
            <p className="kaypal-v3-label">相关页面</p>
            <div className="mt-3 flex flex-col gap-2">
              <Link
                className="inline-flex h-9 items-center justify-between gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                href="/content/optimization"
              >
                返回创作优化
                <ArrowLeft
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
              </Link>
              <Link
                className="inline-flex h-9 items-center justify-between gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                href="/strategies"
              >
                内容规则
                <ClipboardCheck
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
              </Link>
            </div>
          </aside>
        </div>
      </section>

      <section className="kaypal-v3-panel overflow-hidden">
        <div className="grid xl:grid-cols-[minmax(360px,0.74fr)_minmax(0,1.26fr)]">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="检查平台">
                <select
                  className="h-9 w-full px-3 text-13"
                  onChange={(event) =>
                    setPlatform(event.target.value as ContentWorkflowPlatform)
                  }
                  value={platform}
                >
                  {platformOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="内容类型">
                <select
                  className="h-9 w-full px-3 text-13"
                  onChange={(event) =>
                    setTargetType(
                      event.target.value as ContentWorkflowTargetType,
                    )
                  }
                  value={targetType}
                >
                  {targetTypeOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              <Field label="标题 / 封面文案">
                <input
                  className="h-10 w-full px-3 text-13"
                  onChange={(event) => setTitle(event.target.value)}
                  value={title}
                />
              </Field>
              <Field label="待检查正文">
                <textarea
                  className="min-h-[300px] w-full resize-y px-3 py-2 text-13 leading-5"
                  onChange={(event) => setContent(event.target.value)}
                  value={content}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[image:var(--kaypal-v3-gradient-primary)] px-4 text-13 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={() => void runCompliance()}
                type="button"
              >
                {loading ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <FileSearch
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                )}
                {loading ? "检查中" : "开始检查"}
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={() => {
                  setResult(null);
                  setError("");
                }}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                清空结果
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] px-3 py-2 text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                {error}
              </div>
            ) : null}
          </div>

          <div className="min-w-0 p-4">
            {result ? (
              <ComplianceResult
                officialing={officialing}
                onConfirmOfficial={() => void confirmOfficialVersion()}
                onCreatePublishReady={() => void createPublishReadyTask()}
                onManualReview={() => void confirmManualReview()}
                onReviewNoteChange={setReviewNote}
                publishStatus={publishStatus}
                publishing={publishing}
                reviewDone={reviewDone}
                reviewNote={reviewNote}
                reviewing={reviewing}
                result={result}
                selectedVersion={selectedVersion}
                versionId={versionId}
              />
            ) : (
              <EmptyComplianceResult />
            )}
          </div>
        </div>
      </section>

      {versionId ? (
        <VersionFollowUpPanel
          commentItems={commentItems}
          commentText={commentText}
          feedbackForm={feedbackForm}
          feedbackItems={feedbackItems}
          onCommentTextChange={setCommentText}
          onFeedbackFormChange={setFeedbackForm}
          onSaveComment={() => void saveComment()}
          onSaveFeedback={() => void saveFeedback()}
          savingComment={savingComment}
          savingFeedback={savingFeedback}
        />
      ) : null}

      <RecentVersions versions={versions} onLoad={loadVersion} />
    </div>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function EmptyComplianceResult() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-6 text-center">
      <span className="kaypal-v3-icon-tile">
        <ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <h2 className="mt-3 text-base font-bold text-[var(--kaypal-v3-ink)]">
        等待检查结果
      </h2>
      <p className="mt-1 max-w-md text-13 leading-5 text-[var(--kaypal-v3-muted)]">
        从创作优化送来的版本会自动检查，也可以在左侧直接粘贴内容复查。
      </p>
    </div>
  );
}

function ComplianceResult({
  officialing,
  onConfirmOfficial,
  onCreatePublishReady,
  onManualReview,
  onReviewNoteChange,
  publishStatus,
  publishing,
  reviewDone,
  reviewNote,
  reviewing,
  result,
  selectedVersion,
  versionId,
}: {
  officialing: boolean;
  onConfirmOfficial: () => void;
  onCreatePublishReady: () => void;
  onManualReview: () => void;
  onReviewNoteChange: (value: string) => void;
  publishStatus: string;
  publishing: boolean;
  reviewDone: boolean;
  reviewNote: string;
  reviewing: boolean;
  result: ComplianceCheckResult;
  selectedVersion: ContentOptimizationVersion | null;
  versionId: string;
}) {
  const canPreparePublish =
    Boolean(versionId) &&
    Boolean(selectedVersion?.isOfficial) &&
    (result.gate.publishAllowed || reviewDone);
  const reviewRequired = result.gate.manualReviewRequired && !reviewDone;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="kaypal-v3-label">检查结果</p>
          <h2 className="mt-1 text-lg font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            {riskLabel[result.riskLevel]} · 风险分 {result.riskScore}
          </h2>
        </div>
        <span
          className={`inline-flex h-8 shrink-0 items-center rounded-[8px] border px-3 text-12 font-bold ${riskTone(
            result.riskLevel,
          )}`}
        >
          {riskLabel[result.riskLevel]}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["平台", platformLabel(result.platform)],
          ["类型", targetTypeLabel(result.targetType)],
          ["下一步", result.gate.publishAllowed ? "可继续发布" : "需要复核"],
        ].map(([label, value]) => (
          <div
            className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
            key={label}
          >
            <p className="kaypal-v3-label">{label}</p>
            <p className="mt-1 text-14 font-bold text-[var(--kaypal-v3-ink)]">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
        <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
          检查摘要
        </p>
        <p className="mt-2 text-13 leading-6 text-[var(--kaypal-v3-soft-ink)]">
          {result.summary}
        </p>
        <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
          {result.gate.reason}
        </p>
      </div>

      <FindingsList findings={result.findings} />
      <Checklist title="处理建议" items={result.suggestions} />
      <Checklist title="下一步动作" items={result.gate.nextActions} />

      {versionId ? (
        <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                正式稿确认
              </p>
              <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                {selectedVersion?.isOfficial
                  ? "当前版本已作为发布内容。"
                  : "进入发布准备前，需要先确认这一版为发布内容。"}
              </p>
            </div>
            <button
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={Boolean(selectedVersion?.isOfficial) || officialing}
              onClick={onConfirmOfficial}
              type="button"
            >
              {officialing ? (
                <Loader2
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={1.8}
                />
              ) : (
                <CheckCircle2
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              )}
              {selectedVersion?.isOfficial ? "已确认" : "确认正式稿"}
            </button>
          </div>
        </div>
      ) : null}

      {result.gate.manualReviewRequired ? (
        <div className="rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-amber)]"
              strokeWidth={1.8}
            />
            <div className="min-w-0 flex-1">
              <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                负责人复核
              </p>
              <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                中高风险内容需要负责人确认处理方式后，才能进入发布准备。
              </p>
              <textarea
                className="mt-3 min-h-[72px] w-full resize-y px-3 py-2 text-13 leading-5"
                disabled={reviewDone}
                onChange={(event) => onReviewNoteChange(event.target.value)}
                placeholder="记录处理说明，例如已删除夸大承诺、保留事实来源、负责人已确认。"
                value={reviewNote}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[image:var(--kaypal-v3-gradient-primary)] px-3 text-12 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={reviewDone || reviewing || !versionId}
                  onClick={onManualReview}
                  type="button"
                >
                  {reviewing ? (
                    <Loader2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={1.8}
                    />
                  ) : (
                    <CheckCircle2
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                  )}
                  {reviewDone ? "复核已记录" : "确认已复核"}
                </button>
                {reviewDone ? (
                  <span className="text-12 font-semibold text-[var(--kaypal-v3-success)]">
                    已满足进入发布准备的复核要求
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
            发布准备
          </p>
          <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
            {canPreparePublish
              ? "检查通过后可以创建发布准备。"
              : reviewRequired
                ? "请先完成负责人复核。"
                : selectedVersion?.isOfficial
                  ? "当前内容还不能直接进入发布准备。"
                  : "请先确认正式稿。"}
          </p>
          {publishStatus ? (
            <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {publishStatus}
            </p>
          ) : null}
          {publishStatus ? (
            <Link
              className="mt-2 inline-flex items-center gap-1 text-12 font-bold text-[var(--kaypal-v3-accent-ink)]"
              href="/distribution"
            >
              去发布中心
              <ArrowRight
                aria-hidden="true"
                className="h-3.5 w-3.5"
                strokeWidth={1.8}
              />
            </Link>
          ) : null}
        </div>
        <button
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] bg-[image:var(--kaypal-v3-gradient-primary)] px-3 text-12 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canPreparePublish || publishing}
          onClick={onCreatePublishReady}
          type="button"
        >
          {publishing ? (
            <Loader2
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin"
              strokeWidth={1.8}
            />
          ) : (
            <CheckCircle2
              aria-hidden="true"
              className="h-3.5 w-3.5"
              strokeWidth={1.8}
            />
          )}
          创建发布准备
        </button>
      </div>
    </div>
  );
}

function FindingsList({ findings }: { findings: ComplianceFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="rounded-[8px] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-3">
        <div className="flex items-start gap-2">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]"
            strokeWidth={1.8}
          />
          <p className="text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
            未命中当前基础规则。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
      <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
        命中项
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {findings.map((finding) => (
          <div
            className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
            key={finding.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-[8px] border px-2 py-1 text-11 font-bold ${riskTone(
                  finding.riskLevel,
                )}`}
              >
                {riskLabel[finding.riskLevel]}
              </span>
              <strong className="text-13 text-[var(--kaypal-v3-ink)]">
                {finding.matchedText}
              </strong>
              <span className="text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                {findingCategoryLabel[finding.category]}
              </span>
            </div>
            <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
              {finding.reason}
            </p>
            <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {finding.replacement
                ? `建议改为「${finding.replacement}」；${finding.suggestion}`
                : finding.suggestion}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Checklist({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
      <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
        {title}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <div className="flex items-start gap-2" key={item}>
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]"
              strokeWidth={1.8}
            />
            <span className="text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {item}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionFollowUpPanel({
  commentItems,
  commentText,
  feedbackForm,
  feedbackItems,
  onCommentTextChange,
  onFeedbackFormChange,
  onSaveComment,
  onSaveFeedback,
  savingComment,
  savingFeedback,
}: {
  commentItems: ContentVersionComment[];
  commentText: string;
  feedbackForm: FeedbackFormState;
  feedbackItems: ContentVersionFeedback[];
  onCommentTextChange: (value: string) => void;
  onFeedbackFormChange: (value: FeedbackFormState) => void;
  onSaveComment: () => void;
  onSaveFeedback: () => void;
  savingComment: boolean;
  savingFeedback: boolean;
}) {
  const metricFields: Array<{
    key: keyof Pick<
      FeedbackFormState,
      "views" | "likes" | "comments" | "saves" | "leads"
    >;
    label: string;
  }> = [
    { key: "views", label: "阅读" },
    { key: "likes", label: "点赞" },
    { key: "comments", label: "评论" },
    { key: "saves", label: "收藏" },
    { key: "leads", label: "线索" },
  ];

  return (
    <section className="kaypal-v3-panel overflow-hidden">
      <div className="border-b border-[var(--kaypal-v3-border)] p-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck
            aria-hidden="true"
            className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]"
            strokeWidth={1.8}
          />
          <h2 className="text-14 font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            复盘与备注
          </h2>
        </div>
        <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
          记录发布表现和团队处理意见，方便下次创作继续参考。
        </p>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
          <div className="grid gap-3 sm:grid-cols-5">
            {metricFields.map((field) => (
              <Field label={field.label} key={field.key}>
                <input
                  className="h-9 w-full px-3 text-13"
                  min={0}
                  onChange={(event) =>
                    onFeedbackFormChange({
                      ...feedbackForm,
                      [field.key]: event.target.value,
                    })
                  }
                  type="number"
                  value={feedbackForm[field.key]}
                />
              </Field>
            ))}
          </div>
          <div className="mt-3">
            <Field label="复盘备注">
              <textarea
                className="min-h-[92px] w-full resize-y px-3 py-2 text-13 leading-5"
                onChange={(event) =>
                  onFeedbackFormChange({
                    ...feedbackForm,
                    note: event.target.value,
                  })
                }
                placeholder="记录标题、开头、承接方式的表现，或下一版要保留/调整的点。"
                value={feedbackForm.note}
              />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[image:var(--kaypal-v3-gradient-primary)] px-3 text-12 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
              disabled={savingFeedback}
              onClick={onSaveFeedback}
              type="button"
            >
              {savingFeedback ? (
                <Loader2
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={1.8}
                />
              ) : (
                <CheckCircle2
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              )}
              保存复盘
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {feedbackItems.length ? (
              feedbackItems.map((item) => (
                <div
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                  key={item.id}
                >
                  <div className="flex flex-wrap gap-2 text-11 font-bold text-[var(--kaypal-v3-muted)]">
                    <span>阅读 {item.views}</span>
                    <span>点赞 {item.likes}</span>
                    <span>评论 {item.comments}</span>
                    <span>收藏 {item.saves}</span>
                    <span>线索 {item.leads}</span>
                  </div>
                  {item.note ? (
                    <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {item.note}
                    </p>
                  ) : null}
                  <p className="mt-2 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                暂无复盘记录。
              </div>
            )}
          </div>
        </div>

        <div className="p-4">
          <Field label="协作备注">
            <textarea
              className="min-h-[116px] w-full resize-y px-3 py-2 text-13 leading-5"
              onChange={(event) => onCommentTextChange(event.target.value)}
              placeholder="记录负责人意见、改写原因或发布注意事项。"
              value={commentText}
            />
          </Field>
          <div className="mt-3 flex justify-end">
            <button
              className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={savingComment}
              onClick={onSaveComment}
              type="button"
            >
              {savingComment ? (
                <Loader2
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={1.8}
                />
              ) : (
                <CheckCircle2
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              )}
              保存备注
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {commentItems.length ? (
              commentItems.map((item) => (
                <div
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                  key={item.id}
                >
                  <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {item.body}
                  </p>
                  <p className="mt-2 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                    {item.authorName} · {formatDateTime(item.createdAt)}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                暂无协作备注。
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function RecentVersions({
  onLoad,
  versions,
}: {
  onLoad: (version: ContentOptimizationVersion) => void;
  versions: ContentOptimizationVersion[];
}) {
  const recentVersions = versions.slice(0, 5);

  return (
    <section className="kaypal-v3-panel overflow-hidden">
      <div className="border-b border-[var(--kaypal-v3-border)] p-4">
        <div className="flex items-center gap-2">
          <History
            aria-hidden="true"
            className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]"
            strokeWidth={1.8}
          />
          <h2 className="text-14 font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            可检查版本
          </h2>
        </div>
      </div>

      {recentVersions.length ? (
        <div className="divide-y divide-[var(--kaypal-v3-border)]">
          {recentVersions.map((version) => (
            <article
              className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
              key={version.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-1 text-11 font-bold text-[var(--kaypal-v3-soft-ink)]">
                    {version.modeLabel}
                  </span>
                  <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] px-2 py-1 text-11 font-bold text-[var(--kaypal-v3-muted)]">
                    {platformLabel(version.platform)}
                  </span>
                  {version.compliance ? (
                    <span
                      className={`rounded-[8px] border px-2 py-1 text-11 font-bold ${riskTone(
                        version.compliance.riskLevel,
                      )}`}
                    >
                      {riskLabel[version.compliance.riskLevel]} ·{" "}
                      {version.compliance.riskScore}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-2 line-clamp-1 text-14 font-bold text-[var(--kaypal-v3-ink)]">
                  {version.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  {version.sourceSummary || version.content}
                </p>
                <p className="mt-2 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                  更新于 {formatDateTime(version.updatedAt)}
                </p>
              </div>

              <div className="flex items-center lg:justify-end">
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                  onClick={() => onLoad(version)}
                  type="button"
                >
                  <FileSearch
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={1.8}
                  />
                  载入检查
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-start gap-2 rounded-[8px] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-4">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-amber)]"
              strokeWidth={1.8}
            />
            <p className="text-13 leading-5 text-[var(--kaypal-v3-muted)]">
              还没有从创作优化保存过版本。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
