"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "@/lib/toast";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  Copy,
  FilePenLine,
  GitCompare,
  Layers,
  Loader2,
  MessageCircle,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  AiFillAssistantDialog,
  type AiFillCandidate,
} from "../../components/ai-fill-assistant-dialog";
import { FailureActionPanel } from "../../components/failure-action-panel";
import { api } from "@/lib/api/client";
import { articlesApi, type Article } from "@/lib/api/articles";
import {
  getContentVersionDiff,
  listContentOptimizationVersions,
  saveContentOptimizationVersion,
  setOfficialContentVersion,
  type ContentVersionDiff,
  type ContentOptimizationVersion,
  type ContentOptimizationVersionInput,
  type ContentWorkflowPlatform,
  type ContentWorkflowTargetType,
} from "@/lib/api/content-optimization";
import { materialsApi, type Material } from "@/lib/api/materials";
import { saveComplianceHandoff } from "@/lib/content-workflow-storage";

type OptimizationPlatform = ContentWorkflowPlatform;

type Mode = "title" | "rewrite" | "xhs";

type SourceKind = "manual" | "article" | "material";

type BrandVoiceId = "professional" | "experience" | "conversion";

type PlatformTemplateId = "xiaohongshu-note" | "wechat-article" | "short-video";

type ScoreDimension = {
  key: string;
  label: string;
  score: number;
  evidence: string;
};

type OptimizationHitItem = {
  type: "hook" | "keyword" | "risk" | "structure";
  text: string;
  reason: string;
};

type WorkflowTrace = {
  source: "local_scoring" | "redfox";
  status: "local_scoring" | "ready_for_redfox";
  plannedSkill: string;
  redfoxClientHook: string;
  generatedAt: string;
};

type TitleScoreResult = {
  workflowId: string;
  platform: OptimizationPlatform;
  originalTitle: string;
  overallScore: number;
  qualityLevel: "excellent" | "good" | "needs_improvement" | "weak";
  dimensions: ScoreDimension[];
  hitItems: OptimizationHitItem[];
  suggestions: string[];
  rewriteCandidates: string[];
  workflow: WorkflowTrace;
};

type RewriteVariant = {
  label: string;
  title: string;
  content: string;
  highlight: string;
};

type RewriteResult = {
  workflowId: string;
  platform: OptimizationPlatform;
  originalContent: string;
  rewrittenContent: string;
  variants: RewriteVariant[];
  changes: string[];
  suggestions: string[];
  workflow: WorkflowTrace;
};

type XhsNoteOptimizationResult = {
  workflowId: string;
  original: {
    title?: string;
    content: string;
    hashtags: string[];
  };
  optimized: {
    title: string;
    opening: string;
    body: string;
    hashtags: string[];
    callToAction: string;
  };
  score: {
    overall: number;
    coverHook: number;
    searchKeyword: number;
    trustBuilding: number;
    interactionIntent: number;
  };
  hitItems: OptimizationHitItem[];
  suggestions: string[];
  workflow: WorkflowTrace;
};

const platformOptions: Array<{ label: string; value: OptimizationPlatform }> = [
  { label: "全平台", value: "all" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "抖音", value: "douyin" },
  { label: "公众号", value: "wechat" },
  { label: "B站", value: "bilibili" },
  { label: "TikTok", value: "tiktok" },
];

const modeItems: Array<{
  id: Mode;
  label: string;
  caption: string;
  icon: typeof Sparkles;
}> = [
  {
    id: "title",
    label: "标题评分",
    caption: "吸引力、关键词和风险",
    icon: Sparkles,
  },
  {
    id: "rewrite",
    label: "文案改写",
    caption: "多平台、多语气版本",
    icon: WandSparkles,
  },
  {
    id: "xhs",
    label: "小红书优化",
    caption: "标题、开头、标签和引导语",
    icon: MessageCircle,
  },
];

const sourceKindOptions: Array<{ label: string; value: SourceKind }> = [
  { label: "手动输入", value: "manual" },
  { label: "文章库", value: "article" },
  { label: "素材库", value: "material" },
];

const brandVoiceOptions: Array<{
  id: BrandVoiceId;
  label: string;
  tone: string;
  positioning: string;
  goal: string;
}> = [
  {
    id: "professional",
    label: "专业可信",
    tone: "专业但易懂",
    positioning: "AI 内容生产工具号",
    goal: "让用户快速理解价值并愿意收藏",
  },
  {
    id: "experience",
    label: "真实经验",
    tone: "真实经验分享",
    positioning: "实战型内容运营账号",
    goal: "用案例和细节建立信任",
  },
  {
    id: "conversion",
    label: "稳健转化",
    tone: "克制、有行动指引",
    positioning: "面向增长团队的内容顾问",
    goal: "引导咨询和后续跟进",
  },
];

const platformTemplateOptions: Array<{
  id: PlatformTemplateId;
  label: string;
  platform: OptimizationPlatform;
  mode: Mode;
  goal: string;
  tags: string;
}> = [
  {
    id: "xiaohongshu-note",
    label: "小红书笔记",
    platform: "xiaohongshu",
    mode: "xhs",
    goal: "收藏和咨询",
    tags: "内容创作, 小红书运营, AI工具",
  },
  {
    id: "wechat-article",
    label: "公众号文章",
    platform: "wechat",
    mode: "rewrite",
    goal: "阅读完成和私域承接",
    tags: "内容策略, 运营复盘, 增长方法",
  },
  {
    id: "short-video",
    label: "短视频脚本",
    platform: "douyin",
    mode: "rewrite",
    goal: "停留、互动和线索承接",
    tags: "短视频, 口播脚本, 内容增长",
  },
];

const qualityLabel: Record<TitleScoreResult["qualityLevel"], string> = {
  excellent: "优秀",
  good: "可用",
  needs_improvement: "待加强",
  weak: "较弱",
};

function splitTokens(value: string) {
  return value
    .split(/[\n,，、#]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreTone(score: number) {
  if (score >= 85) return "text-[var(--kaypal-v3-success)]";
  if (score >= 70) return "text-[var(--kaypal-v3-accent-ink)]";
  if (score >= 55) return "text-[var(--kaypal-v3-amber)]";
  return "text-[var(--kaypal-v3-danger)]";
}

function hitTone(type: OptimizationHitItem["type"]) {
  if (type === "risk") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]";
  }
  if (type === "keyword") {
    return "border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]";
}

function writeClipboardTextWithSelection(text: string) {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function writeClipboardText(text: string) {
  if (writeClipboardTextWithSelection(text)) {
    return true;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  await navigator.clipboard.writeText(text);
  return true;
}

const modeLabelMap: Record<Mode, string> = {
  title: "标题评分",
  rewrite: "文案改写",
  xhs: "小红书优化",
};

function targetTypeForMode(
  mode: Mode,
  platform: OptimizationPlatform,
): ContentWorkflowTargetType {
  if (mode === "xhs" || platform === "xiaohongshu") return "xiaohongshu_note";
  if (
    platform === "douyin" ||
    platform === "tiktok" ||
    platform === "bilibili"
  ) {
    return "video_script";
  }
  return "article";
}

function formatTitleVersion(result: TitleScoreResult) {
  return [
    `原标题：${result.originalTitle}`,
    `总分：${result.overallScore}（${qualityLabel[result.qualityLevel]}）`,
    "",
    "候选标题：",
    ...result.rewriteCandidates.map(
      (candidate, index) => `${index + 1}. ${candidate}`,
    ),
    "",
    "优化建议：",
    ...result.suggestions.map(
      (suggestion, index) => `${index + 1}. ${suggestion}`,
    ),
  ].join("\n");
}

function formatXhsNote(result: XhsNoteOptimizationResult) {
  return [
    result.optimized.title,
    "",
    result.optimized.opening,
    "",
    result.optimized.body,
    "",
    result.optimized.callToAction,
    "",
    result.optimized.hashtags.map((tag) => `#${tag}`).join(" "),
  ].join("\n");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function platformLabel(platform: OptimizationPlatform) {
  return (
    platformOptions.find((item) => item.value === platform)?.label || platform
  );
}

function sourceKindLabel(kind: SourceKind) {
  return (
    sourceKindOptions.find((item) => item.value === kind)?.label || "内容来源"
  );
}

function normalizeMaterialPlatform(platform?: string): OptimizationPlatform {
  if (!platform) return "all";
  if (platform.includes("小红书")) return "xiaohongshu";
  if (platform.includes("抖音")) return "douyin";
  if (platform.includes("公众号") || platform.includes("微信")) return "wechat";
  if (platform.includes("B站") || platform.toLowerCase().includes("bilibili")) {
    return "bilibili";
  }
  if (platform.toLowerCase().includes("tiktok")) return "tiktok";
  return "all";
}

function trimPreview(value: string, maxLength = 88) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function complianceTone(status?: ContentOptimizationVersion["compliance"]) {
  if (!status)
    return "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)]";
  if (status.riskLevel === "pass") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]";
  }
  if (status.riskLevel === "low") {
    return "border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]";
  }
  if (status.riskLevel === "medium") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]";
  }
  return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]";
}

export function ContentOptimizationWorkbench() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("title");
  const [platform, setPlatform] = useState<OptimizationPlatform>("xiaohongshu");
  const [loadingMode, setLoadingMode] = useState<Mode | null>(null);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<ContentOptimizationVersion[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind>("manual");
  const [articles, setArticles] = useState<Article[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourceLoading, setSourceLoading] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState("");
  const [currentSourceType, setCurrentSourceType] = useState("");
  const [currentSourceId, setCurrentSourceId] = useState("");
  const [currentSourceSummary, setCurrentSourceSummary] =
    useState("手动输入内容");
  const [brandVoice, setBrandVoice] = useState<BrandVoiceId>("professional");
  const [platformTemplate, setPlatformTemplate] =
    useState<PlatformTemplateId>("xiaohongshu-note");
  const [selectedDiff, setSelectedDiff] = useState<ContentVersionDiff | null>(
    null,
  );
  const [diffLoadingId, setDiffLoadingId] = useState("");

  const [title, setTitle] = useState("小红书低粉爆款内容拆解方法");
  const [keywords, setKeywords] = useState("小红书, 爆款, 内容创作");
  const [titleGoal, setTitleGoal] = useState("搜索收录和收藏");

  const [content, setContent] = useState(
    "我们整理了一套内容创作流程，可以把热点、样本和素材快速变成适合发布的文章、小红书笔记和短视频脚本。",
  );
  const [tone, setTone] = useState("专业但易懂");
  const [goals, setGoals] = useState("收藏, 咨询, 复用");
  const [keepFacts, setKeepFacts] = useState(true);

  const [xhsTitle, setXhsTitle] = useState("内容优化怎么做才不空泛");
  const [hashtags, setHashtags] = useState("内容创作, 小红书运营, AI工具");
  const [targetAudience, setTargetAudience] = useState("内容运营和独立创作者");
  const [accountPositioning, setAccountPositioning] =
    useState("AI 内容生产工具号");
  const [xhsGoal, setXhsGoal] = useState("收藏和咨询");

  const [titleResult, setTitleResult] = useState<TitleScoreResult | null>(null);
  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(
    null,
  );
  const [xhsResult, setXhsResult] = useState<XhsNoteOptimizationResult | null>(
    null,
  );
  const [aiFillOpen, setAiFillOpen] = useState(false);

  const activeMode = useMemo(
    () => modeItems.find((item) => item.id === mode) || modeItems[0],
    [mode],
  );
  const activeOutput = useMemo(() => {
    if (mode === "title") return titleResult;
    if (mode === "rewrite") return rewriteResult;
    return xhsResult;
  }, [mode, rewriteResult, titleResult, xhsResult]);
  const sourceOptions = useMemo(() => {
    if (sourceKind === "article") {
      return articles.map((article) => ({
        id: article.id,
        title: article.xiaohongshuData?.title || article.title,
        summary: trimPreview(
          article.content || article.xiaohongshuData?.caption || "",
        ),
      }));
    }

    if (sourceKind === "material") {
      return materials.map((material) => ({
        id: material.id,
        title: material.title,
        summary: trimPreview(
          material.summary || material.content || material.sourceUrl,
        ),
      }));
    }

    return [];
  }, [articles, materials, sourceKind]);

  const isLoading = loadingMode === mode;

  useEffect(() => {
    void refreshVersions();
    void refreshSources();
  }, []);

  async function refreshSources() {
    setSourceLoading(true);
    try {
      const [articleResult, materialResult] = await Promise.all([
        articlesApi.list({ page: 1, limit: 12 }),
        materialsApi.list({ page: 1, limit: 12 }),
      ]);
      setArticles(articleResult.items);
      setMaterials(materialResult.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "内容来源加载失败";
      toast.error(message);
    } finally {
      setSourceLoading(false);
    }
  }

  function changeSourceKind(kind: SourceKind) {
    setSourceKind(kind);
    setSelectedSourceId("");
    setCurrentDraftId("");
    if (kind === "manual") {
      setCurrentSourceType("");
      setCurrentSourceId("");
      setCurrentSourceSummary("手动输入内容");
    }
  }

  function applySelectedSource() {
    if (sourceKind === "manual") {
      setCurrentDraftId("");
      setCurrentSourceType("");
      setCurrentSourceId("");
      setCurrentSourceSummary("手动输入内容");
      toast.success("已切换为手动输入");
      return;
    }

    if (!selectedSourceId) {
      toast.error("请选择内容来源");
      return;
    }

    if (sourceKind === "article") {
      const article = articles.find((item) => item.id === selectedSourceId);
      if (!article) {
        toast.error("未找到这篇内容");
        return;
      }

      const nextTitle = article.xiaohongshuData?.title || article.title;
      const nextContent =
        article.content || article.xiaohongshuData?.caption || article.title;
      const nextPlatform =
        article.contentType === "xiaohongshu" ? "xiaohongshu" : "wechat";

      setCurrentDraftId("");
      setCurrentSourceType("article");
      setCurrentSourceId(article.id);
      setCurrentSourceSummary(`来自文章库：${nextTitle}`);
      setPlatform(nextPlatform);
      setTitle(nextTitle);
      setXhsTitle(nextTitle);
      setContent(nextContent);
      setKeywords(article.topic?.keywords?.join(", ") || keywords);
      setMode(article.contentType === "xiaohongshu" ? "xhs" : "rewrite");
      toast.success("内容已载入");
      return;
    }

    const material = materials.find((item) => item.id === selectedSourceId);
    if (!material) {
      toast.error("未找到这条素材");
      return;
    }

    const nextContent = material.content || material.summary || material.title;
    const nextPlatform = normalizeMaterialPlatform(material.platform);
    setCurrentDraftId("");
    setCurrentSourceType("material");
    setCurrentSourceId(material.id);
    setCurrentSourceSummary(`来自素材库：${material.title}`);
    setPlatform(nextPlatform);
    setTitle(material.title);
    setXhsTitle(material.title);
    setContent(nextContent);
    setKeywords(material.keywords.join(", "));
    setMode(nextPlatform === "xiaohongshu" ? "xhs" : "rewrite");
    toast.success("素材已载入");
  }

  function applyBrandVoice(nextVoice: BrandVoiceId) {
    const option =
      brandVoiceOptions.find((item) => item.id === nextVoice) ||
      brandVoiceOptions[0];
    setBrandVoice(option.id);
    setTone(option.tone);
    setAccountPositioning(option.positioning);
    setTitleGoal(option.goal);
    setXhsGoal(option.goal);
  }

  function applyPlatformTemplate(nextTemplate: PlatformTemplateId) {
    const option =
      platformTemplateOptions.find((item) => item.id === nextTemplate) ||
      platformTemplateOptions[0];
    setPlatformTemplate(option.id);
    setPlatform(option.platform);
    setMode(option.mode);
    setGoals(option.goal);
    setXhsGoal(option.goal);
    setHashtags(option.tags);
  }

  async function runOptimization() {
    setError("");

    try {
      if (mode === "title") {
        if (!title.trim()) {
          toast.error("请输入标题");
          return;
        }

        setLoadingMode("title");
        const result = await api.post<TitleScoreResult>(
          "/content-optimization/title-score",
          {
            title,
            platform,
            contentType: platform === "xiaohongshu" ? "xiaohongshu" : "article",
            keywords: splitTokens(keywords),
            goal: titleGoal,
          },
        );
        setTitleResult(result);
        toast.success("标题评分已完成");
        return;
      }

      if (mode === "rewrite") {
        if (!content.trim()) {
          toast.error("请输入待改写正文");
          return;
        }

        setLoadingMode("rewrite");
        const result = await api.post<RewriteResult>(
          "/content-optimization/rewrite",
          {
            content,
            platform,
            tone,
            goals: splitTokens(goals),
            keepFacts,
          },
        );
        setRewriteResult(result);
        toast.success("文案改写已完成");
        return;
      }

      if (!content.trim()) {
        toast.error("请输入笔记正文");
        return;
      }

      setLoadingMode("xhs");
      const result = await api.post<XhsNoteOptimizationResult>(
        "/content-optimization/xhs-note-optimize",
        {
          title: xhsTitle,
          content,
          hashtags: splitTokens(hashtags),
          targetAudience,
          accountPositioning,
          optimizationGoal: xhsGoal,
        },
      );
      setXhsResult(result);
      toast.success("小红书优化已完成");
    } catch (err) {
      const message = err instanceof Error ? err.message : "优化失败";
      setError(message);
      toast.error(message);
    } finally {
      setLoadingMode(null);
    }
  }

  function resetResult() {
    setError("");
    if (mode === "title") setTitleResult(null);
    if (mode === "rewrite") setRewriteResult(null);
    if (mode === "xhs") setXhsResult(null);
  }

  async function copyText(text: string, label = "内容") {
    const ok = await writeClipboardText(text);
    if (ok) {
      toast.success(`${label}已复制`);
    } else {
      toast.error("复制失败");
    }
  }

  async function refreshVersions() {
    try {
      const result = await listContentOptimizationVersions();
      setVersions(result.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "版本加载失败";
      toast.error(message);
    }
  }

  function buildCurrentVersionInput(): ContentOptimizationVersionInput | null {
    const baseInput = {
      draftId: currentDraftId || undefined,
      sourceType: currentSourceType || undefined,
      sourceId: currentSourceId || undefined,
    };

    if (mode === "title" && titleResult) {
      return {
        ...baseInput,
        mode,
        modeLabel: modeLabelMap[mode],
        title: titleResult.originalTitle,
        content: formatTitleVersion(titleResult),
        originalTitle: title,
        originalContent: title,
        platform: titleResult.platform,
        targetType: targetTypeForMode(mode, titleResult.platform),
        sourceWorkflowId: titleResult.workflowId,
        sourceSummary: `${currentSourceSummary} · 标题评分 ${titleResult.overallScore}`,
      };
    }

    if (mode === "rewrite" && rewriteResult) {
      return {
        ...baseInput,
        mode,
        modeLabel: modeLabelMap[mode],
        title: rewriteResult.variants[0]?.title || "文案改写版本",
        content: rewriteResult.rewrittenContent,
        originalTitle: title,
        originalContent: rewriteResult.originalContent || content,
        platform: rewriteResult.platform,
        targetType: targetTypeForMode(mode, rewriteResult.platform),
        sourceWorkflowId: rewriteResult.workflowId,
        sourceSummary: `${currentSourceSummary} · 生成 ${rewriteResult.variants.length} 个改写版本`,
      };
    }

    if (mode === "xhs" && xhsResult) {
      return {
        ...baseInput,
        mode,
        modeLabel: modeLabelMap[mode],
        title: xhsResult.optimized.title,
        content: formatXhsNote(xhsResult),
        originalTitle: xhsResult.original.title || xhsTitle,
        originalContent: xhsResult.original.content || content,
        platform: "xiaohongshu",
        targetType: "xiaohongshu_note",
        sourceWorkflowId: xhsResult.workflowId,
        sourceSummary: `${currentSourceSummary} · 小红书优化评分 ${xhsResult.score.overall}`,
      };
    }

    return null;
  }

  async function saveCurrentVersion({ silent = false } = {}) {
    const input = buildCurrentVersionInput();
    if (!input) {
      toast.error("请先生成优化结果");
      return null;
    }

    try {
      const saved = await saveContentOptimizationVersion(input);
      setCurrentDraftId(saved.draftId);
      await refreshVersions();
      if (!silent) toast.success("版本已保存");
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : "版本保存失败";
      toast.error(message);
      return null;
    }
  }

  function sendVersionToCompliance(version: ContentOptimizationVersion) {
    saveComplianceHandoff({
      versionId: version.id,
      title: version.title,
      content: version.content,
      platform: version.platform,
      targetType: version.targetType,
    });
    router.push(
      `/distribution?tab=compliance&source=content-optimization&versionId=${encodeURIComponent(
        version.id,
      )}`,
    );
  }

  async function sendCurrentToCompliance() {
    const saved = await saveCurrentVersion({ silent: true });
    if (!saved) return;
    sendVersionToCompliance(saved);
  }

  async function setCurrentAsOfficial() {
    const saved = await saveCurrentVersion({ silent: true });
    if (!saved) return;

    try {
      await setOfficialContentVersion(saved.id);
      await refreshVersions();
      toast.success("已设为正式稿");
    } catch (err) {
      const message = err instanceof Error ? err.message : "正式稿确认失败";
      toast.error(message);
    }
  }

  async function setVersionAsOfficial(version: ContentOptimizationVersion) {
    try {
      await setOfficialContentVersion(version.id);
      await refreshVersions();
      toast.success("已设为正式稿");
    } catch (err) {
      const message = err instanceof Error ? err.message : "正式稿确认失败";
      toast.error(message);
    }
  }

  async function compareVersion(version: ContentOptimizationVersion) {
    setDiffLoadingId(version.id);
    try {
      const diff = await getContentVersionDiff(version.id);
      setSelectedDiff(diff);
      toast.success("版本对比已打开");
    } catch (err) {
      const message = err instanceof Error ? err.message : "版本对比加载失败";
      toast.error(message);
    } finally {
      setDiffLoadingId("");
    }
  }

  function restoreVersionToEditor(version: ContentOptimizationVersion) {
    setMode(version.mode);
    setPlatform(version.platform);
    setCurrentDraftId(version.draftId);
    setCurrentSourceSummary(version.sourceSummary || "来自历史版本");

    if (version.mode === "title") {
      setTitle(version.title);
    } else {
      setTitle(version.title);
      setXhsTitle(version.title);
      setContent(version.content);
    }

    setError("");
    setTitleResult(null);
    setRewriteResult(null);
    setXhsResult(null);
    toast.success("已恢复到编辑区");
  }

  function restoreDiffVersion(diff: ContentVersionDiff) {
    const version = versions.find((item) => item.id === diff.versionId);
    if (version) {
      restoreVersionToEditor(version);
      return;
    }

    setTitle(diff.version.title);
    setXhsTitle(diff.version.title);
    setContent(diff.version.content);
    setCurrentDraftId(diff.draftId);
    setError("");
    toast.success("已恢复到编辑区");
  }

  const aiFillCandidates: AiFillCandidate[] = useMemo(
    () => [
      {
        id: "search-collection",
        title: "搜索收藏型",
        description: "适合小红书、公众号和知识型内容。",
        fields: [
          { label: "标题", value: "低粉账号也能复用的内容优化清单" },
          {
            label: "正文",
            value:
              "先把内容拆成目标用户、核心痛点、可验证案例和行动建议四块，再用平台语言重写标题和开头。这样不会只停留在口号，也方便后续发布前检查。",
          },
          { label: "关键词/标签", value: "内容优化, 小红书运营, AI工具" },
          { label: "目标", value: "搜索收录、收藏和咨询" },
        ],
      },
      {
        id: "conversion-safe",
        title: "稳健转化型",
        description: "适合产品介绍、私域承接和咨询转化。",
        fields: [
          { label: "标题", value: "内容发布前，先用这 4 步降低踩雷概率" },
          {
            label: "正文",
            value:
              "发布前先确认素材来源、平台限制、敏感表达和转化路径。AI 可以生成候选版本，但正式稿必须人工确认，再交给发布中心做检查和留存。",
          },
          { label: "关键词/标签", value: "发布检查, 内容风控, 私域转化" },
          { label: "目标", value: "咨询、留资和复盘" },
        ],
      },
    ],
    [],
  );

  function applyAiFillCandidate(candidate: AiFillCandidate) {
    const getField = (label: string) =>
      candidate.fields.find((field) => field.label === label)?.value || "";
    const nextTitle = getField("标题");
    const nextContent = getField("正文");
    const nextTags = getField("关键词/标签");
    const nextGoal = getField("目标");

    if (mode === "title") {
      setTitle(nextTitle || title);
      setKeywords(nextTags || keywords);
      setTitleGoal(nextGoal || titleGoal);
    } else if (mode === "rewrite") {
      setTitle(nextTitle || title);
      setContent(nextContent || content);
      setGoals(nextGoal || goals);
    } else {
      setXhsTitle(nextTitle || xhsTitle);
      setContent(nextContent || content);
      setHashtags(nextTags || hashtags);
      setXhsGoal(nextGoal || xhsGoal);
    }

    setError("");
    toast.success("候选内容已回填");
  }

  const resultActions = (
    <>
      <button
        className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
        onClick={() => void saveCurrentVersion()}
        type="button"
      >
        <Save aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} />
        保存版本
      </button>
      <button
        className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[12px] font-semibold text-white transition hover:opacity-90"
        onClick={() => void setCurrentAsOfficial()}
        type="button"
      >
        <CheckCircle2
          aria-hidden="true"
          className="h-3.5 w-3.5"
          strokeWidth={1.8}
        />
        设为正式稿
      </button>
      <button
        className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[12px] font-semibold text-white transition hover:opacity-90"
        onClick={() => void sendCurrentToCompliance()}
        type="button"
      >
        <ShieldCheck
          aria-hidden="true"
          className="h-3.5 w-3.5"
          strokeWidth={1.8}
        />
        送检查
      </button>
    </>
  );
  return (
    <div className="flex flex-col gap-4 pb-8">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="grid xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
          <header className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <Sparkles
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">内容生产</p>
                <h1 className="mt-1 text-[24px] font-bold leading-8 text-[var(--kaypal-v3-ink)]">
                  创作优化
                </h1>
                <p className="mt-1 max-w-4xl text-[13px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  把素材、样本和选题加工成可发布版本，保留原文，输出评分依据、改写版本和发布风险提示。
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                ["当前模式", activeMode.label],
                ["版本策略", "不覆盖原文"],
                ["发布边界", "先审后发"],
              ].map(([label, value]) => (
                <div
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                  key={label}
                >
                  <p className="kaypal-v3-label">{label}</p>
                  <p className="mt-1 text-[14px] font-bold text-[var(--kaypal-v3-ink)]">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </header>

          <aside className="p-4">
            <p className="kaypal-v3-label">下一步</p>
            <div className="mt-3 flex flex-col gap-2">
              <Link
                className="inline-flex h-9 items-center justify-between gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                href="/intelligence/viral"
              >
                爆款拆解
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
              </Link>
              <Link
                className="inline-flex h-9 items-center justify-between gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                href="/distribution?tab=compliance"
              >
                发布前检查
                <ShieldCheck
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
              </Link>
              <Link
                className="inline-flex h-9 items-center justify-between gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[13px] font-semibold text-white"
                href="/content/strategies"
              >
                内容策略
                <ArrowRight
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
        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.68fr)]">
          <ContentSourcePanel
            currentSourceSummary={currentSourceSummary}
            onApply={applySelectedSource}
            onChangeKind={changeSourceKind}
            onRefresh={() => void refreshSources()}
            onSelectSource={setSelectedSourceId}
            selectedSourceId={selectedSourceId}
            sourceKind={sourceKind}
            sourceLoading={sourceLoading}
            sourceOptions={sourceOptions}
          />
          <ContextTemplatePanel
            brandVoice={brandVoice}
            onBrandVoiceChange={applyBrandVoice}
            onTemplateChange={applyPlatformTemplate}
            platformTemplate={platformTemplate}
          />
        </div>
      </section>

      <section className="kaypal-v3-panel overflow-hidden">
        <div
          aria-label="创作优化模式"
          className="grid border-b border-[var(--kaypal-v3-border)] md:grid-cols-3"
          role="tablist"
        >
          {modeItems.map((item) => {
            const Icon = item.icon;
            const selected = mode === item.id;

            return (
              <button
                aria-selected={selected}
                className={[
                  "flex min-h-[72px] items-center gap-3 border-b border-[var(--kaypal-v3-border)] px-4 py-3 text-left transition md:border-b-0 md:border-r md:last:border-r-0",
                  selected
                    ? "bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                    : "bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]",
                ].join(" ")}
                key={item.id}
                onClick={() => {
                  setMode(item.id);
                  setError("");
                }}
                role="tab"
                type="button"
              >
                <span className="kaypal-v3-icon-tile h-9 w-9 shrink-0">
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold leading-5">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-[var(--kaypal-v3-muted)]">
                    {item.caption}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-0 xl:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="目标平台">
                <select
                  className="h-9 w-full px-3 text-[13px]"
                  onChange={(event) =>
                    setPlatform(event.target.value as OptimizationPlatform)
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

              {mode === "title" ? (
                <Field label="标题目标">
                  <input
                    className="h-9 w-full px-3 text-[13px]"
                    onChange={(event) => setTitleGoal(event.target.value)}
                    value={titleGoal}
                  />
                </Field>
              ) : null}

              {mode === "rewrite" ? (
                <Field label="改写语气">
                  <input
                    className="h-9 w-full px-3 text-[13px]"
                    onChange={(event) => setTone(event.target.value)}
                    value={tone}
                  />
                </Field>
              ) : null}

              {mode === "xhs" ? (
                <Field label="优化目标">
                  <input
                    className="h-9 w-full px-3 text-[13px]"
                    onChange={(event) => setXhsGoal(event.target.value)}
                    value={xhsGoal}
                  />
                </Field>
              ) : null}
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {mode === "title" ? (
                <>
                  <Field label="待评分标题">
                    <input
                      className="h-10 w-full px-3 text-[13px]"
                      onChange={(event) => setTitle(event.target.value)}
                      value={title}
                    />
                  </Field>
                  <Field label="目标关键词">
                    <input
                      className="h-10 w-full px-3 text-[13px]"
                      onChange={(event) => setKeywords(event.target.value)}
                      value={keywords}
                    />
                  </Field>
                </>
              ) : null}

              {mode === "rewrite" ? (
                <>
                  <Field label="待改写正文">
                    <textarea
                      className="min-h-[180px] w-full resize-y px-3 py-2 text-[13px] leading-5"
                      onChange={(event) => setContent(event.target.value)}
                      value={content}
                    />
                  </Field>
                  <Field label="改写目标">
                    <input
                      className="h-10 w-full px-3 text-[13px]"
                      onChange={(event) => setGoals(event.target.value)}
                      value={goals}
                    />
                  </Field>
                  <label className="flex items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 py-2 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)]">
                    <input
                      checked={keepFacts}
                      className="h-4 w-4"
                      onChange={(event) => setKeepFacts(event.target.checked)}
                      type="checkbox"
                    />
                    保留原始事实信息
                  </label>
                </>
              ) : null}

              {mode === "xhs" ? (
                <>
                  <Field label="原笔记标题">
                    <input
                      className="h-10 w-full px-3 text-[13px]"
                      onChange={(event) => setXhsTitle(event.target.value)}
                      value={xhsTitle}
                    />
                  </Field>
                  <Field label="笔记正文">
                    <textarea
                      className="min-h-[170px] w-full resize-y px-3 py-2 text-[13px] leading-5"
                      onChange={(event) => setContent(event.target.value)}
                      value={content}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="目标用户">
                      <input
                        className="h-10 w-full px-3 text-[13px]"
                        onChange={(event) =>
                          setTargetAudience(event.target.value)
                        }
                        value={targetAudience}
                      />
                    </Field>
                    <Field label="账号定位">
                      <input
                        className="h-10 w-full px-3 text-[13px]"
                        onChange={(event) =>
                          setAccountPositioning(event.target.value)
                        }
                        value={accountPositioning}
                      />
                    </Field>
                  </div>
                  <Field label="话题标签">
                    <input
                      className="h-10 w-full px-3 text-[13px]"
                      onChange={(event) => setHashtags(event.target.value)}
                      value={hashtags}
                    />
                  </Field>
                </>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={() => setAiFillOpen(true)}
                type="button"
              >
                <Bot
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                AI 候选填写
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoading}
                onClick={() => void runOptimization()}
                type="button"
              >
                {isLoading ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <WandSparkles
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                )}
                {isLoading ? "处理中" : "开始优化"}
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={resetResult}
                type="button"
              >
                <RotateCcw
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                清空结果
              </button>
            </div>

            {error ? (
              <div className="mt-3">
                <FailureActionPanel
                  actions={[
                    { label: "重新优化", onPress: () => void runOptimization() },
                    { label: "清空结果", onPress: resetResult },
                    { href: "/distribution?tab=compliance", label: "发布前检查" },
                  ]}
                  impact="当前内容不会进入正式稿和发布检查。"
                  nextAction="补齐表单或换一个 AI 候选，再重新优化。"
                  reason="内容优化失败，可能是输入不完整、AI 服务暂时不可用或当前素材无法处理。"
                  technicalDetails={error}
                  title="内容优化需要处理"
                />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 p-4">
            {activeOutput ? (
              <>
                {mode === "title" && titleResult ? (
                  <TitleResultView
                    extraActions={resultActions}
                    onCopy={(text, label) => void copyText(text, label)}
                    result={titleResult}
                  />
                ) : null}

                {mode === "rewrite" && rewriteResult ? (
                  <RewriteResultView
                    extraActions={resultActions}
                    onCopy={(text, label) => void copyText(text, label)}
                    result={rewriteResult}
                  />
                ) : null}

                {mode === "xhs" && xhsResult ? (
                  <XhsResultView
                    extraActions={resultActions}
                    onCopy={(text, label) => void copyText(text, label)}
                    result={xhsResult}
                  />
                ) : null}
              </>
            ) : (
              <EmptyResult activeMode={activeMode.label} />
            )}
          </div>
        </div>
      </section>

      <VersionVault
        diffLoadingId={diffLoadingId}
        onCompare={(version) => void compareVersion(version)}
        onOfficial={(version) => void setVersionAsOfficial(version)}
        onRestore={restoreVersionToEditor}
        onSend={sendVersionToCompliance}
        versions={versions}
      />
      {selectedDiff ? (
        <VersionComparePanel
          diff={selectedDiff}
          onClose={() => setSelectedDiff(null)}
          onRestore={() => restoreDiffVersion(selectedDiff)}
        />
      ) : null}
      <AiFillAssistantDialog
        candidates={aiFillCandidates}
        description="选择一组候选内容后，会按当前模式回填标题、正文、关键词或目标字段。"
        isOpen={aiFillOpen}
        title="AI 候选填写"
        onApply={applyAiFillCandidate}
        onOpenChange={setAiFillOpen}
      />
    </div>
  );
}

function ContentSourcePanel({
  currentSourceSummary,
  onApply,
  onChangeKind,
  onRefresh,
  onSelectSource,
  selectedSourceId,
  sourceKind,
  sourceLoading,
  sourceOptions,
}: {
  currentSourceSummary: string;
  onApply: () => void;
  onChangeKind: (kind: SourceKind) => void;
  onRefresh: () => void;
  onSelectSource: (id: string) => void;
  selectedSourceId: string;
  sourceKind: SourceKind;
  sourceLoading: boolean;
  sourceOptions: Array<{ id: string; title: string; summary: string }>;
}) {
  return (
    <div className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
      <div className="flex min-w-0 items-start gap-3">
        <span className="kaypal-v3-icon-tile shrink-0">
          <BookOpen aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="kaypal-v3-label">内容来源</p>
          <h2 className="mt-1 text-[15px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            从真实内容开始
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
            可从文章库、素材库载入，也可以保持手动输入。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
        <Field label="来源类型">
          <select
            className="h-9 w-full px-3 text-[13px]"
            onChange={(event) => onChangeKind(event.target.value as SourceKind)}
            value={sourceKind}
          >
            {sourceKindOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="选择内容">
          <select
            className="h-9 w-full px-3 text-[13px]"
            disabled={sourceKind === "manual" || sourceLoading}
            onChange={(event) => onSelectSource(event.target.value)}
            value={selectedSourceId}
          >
            <option value="">
              {sourceKind === "manual"
                ? "手动输入"
                : sourceLoading
                  ? "读取中"
                  : `请选择${sourceKindLabel(sourceKind)}`}
            </option>
            {sourceOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="min-w-0 text-[12px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
          当前：{currentSourceSummary}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
            onClick={onRefresh}
            type="button"
          >
            <RotateCcw
              aria-hidden="true"
              className="h-3.5 w-3.5"
              strokeWidth={1.8}
            />
            更新列表
          </button>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[12px] font-semibold text-white transition hover:opacity-90"
            onClick={onApply}
            type="button"
          >
            <ArrowRight
              aria-hidden="true"
              className="h-3.5 w-3.5"
              strokeWidth={1.8}
            />
            载入内容
          </button>
        </div>
      </div>

      {sourceOptions.length > 0 && sourceKind !== "manual" ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {sourceOptions.slice(0, 2).map((item) => (
            <button
              className={[
                "min-h-[76px] rounded-[8px] border p-3 text-left transition",
                selectedSourceId === item.id
                  ? "border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] hover:border-[var(--kaypal-v3-border-strong)]",
              ].join(" ")}
              key={item.id}
              onClick={() => onSelectSource(item.id)}
              type="button"
            >
              <span className="line-clamp-1 text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
                {item.title}
              </span>
              <span className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                {item.summary || "暂无摘要"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContextTemplatePanel({
  brandVoice,
  onBrandVoiceChange,
  onTemplateChange,
  platformTemplate,
}: {
  brandVoice: BrandVoiceId;
  onBrandVoiceChange: (voice: BrandVoiceId) => void;
  onTemplateChange: (template: PlatformTemplateId) => void;
  platformTemplate: PlatformTemplateId;
}) {
  return (
    <div className="p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="kaypal-v3-icon-tile shrink-0">
          <Layers aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="kaypal-v3-label">账号语气</p>
          <h2 className="mt-1 text-[15px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            复用常用表达
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
            先选账号语气和平台模板，再进入优化。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="账号语气">
          <select
            className="h-9 w-full px-3 text-[13px]"
            onChange={(event) =>
              onBrandVoiceChange(event.target.value as BrandVoiceId)
            }
            value={brandVoice}
          >
            {brandVoiceOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="平台模板">
          <select
            className="h-9 w-full px-3 text-[13px]"
            onChange={(event) =>
              onTemplateChange(event.target.value as PlatformTemplateId)
            }
            value={platformTemplate}
          >
            {platformTemplateOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
        <p className="text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
          当前建议
        </p>
        <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
          {brandVoiceOptions.find((item) => item.id === brandVoice)?.goal}
        </p>
      </div>
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
      <span className="text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)]">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function EmptyResult({ activeMode }: { activeMode: string }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-6 text-center">
      <span className="kaypal-v3-icon-tile">
        <FilePenLine aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <h2 className="mt-3 text-[16px] font-bold text-[var(--kaypal-v3-ink)]">
        等待{activeMode}结果
      </h2>
      <p className="mt-1 max-w-md text-[13px] leading-5 text-[var(--kaypal-v3-muted)]">
        结果会显示评分、改写版本、命中项和后续建议，原始输入不会被覆盖。
      </p>
    </div>
  );
}

function VersionVault({
  diffLoadingId,
  onCompare,
  onOfficial,
  onRestore,
  onSend,
  versions,
}: {
  diffLoadingId: string;
  onCompare: (version: ContentOptimizationVersion) => void;
  onOfficial: (version: ContentOptimizationVersion) => void;
  onRestore: (version: ContentOptimizationVersion) => void;
  onSend: (version: ContentOptimizationVersion) => void;
  versions: ContentOptimizationVersion[];
}) {
  const recentVersions = versions.slice(0, 5);

  return (
    <section className="kaypal-v3-panel overflow-hidden">
      <div className="border-b border-[var(--kaypal-v3-border)] p-4">
        <div className="flex items-center gap-2">
          <Save
            aria-hidden="true"
            className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]"
            strokeWidth={1.8}
          />
          <h2 className="text-[15px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            最近版本
          </h2>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
          优化结果先保存为独立版本，再进入发布前检查；原始输入不会被覆盖。
        </p>
      </div>

      {recentVersions.length ? (
        <div className="divide-y divide-[var(--kaypal-v3-border)]">
          {recentVersions.map((version) => {
            const complianceText = version.compliance
              ? `已检查 · ${version.compliance.riskScore}`
              : "待检查";

            return (
              <article
                className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
                key={version.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-1 text-[11px] font-bold text-[var(--kaypal-v3-soft-ink)]">
                      {version.modeLabel}
                    </span>
                    {version.isOfficial ? (
                      <span className="rounded-[8px] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] px-2 py-1 text-[11px] font-bold text-[var(--kaypal-v3-success)]">
                        正式稿
                      </span>
                    ) : null}
                    <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] px-2 py-1 text-[11px] font-bold text-[var(--kaypal-v3-muted)]">
                      {platformLabel(version.platform)}
                    </span>
                    <span
                      className={`rounded-[8px] border px-2 py-1 text-[11px] font-bold ${complianceTone(
                        version.compliance,
                      )}`}
                    >
                      {complianceText}
                    </span>
                  </div>
                  <h3 className="mt-2 line-clamp-1 text-[14px] font-bold text-[var(--kaypal-v3-ink)]">
                    {version.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                    {version.sourceSummary || version.content}
                  </p>
                  <p className="mt-2 text-[11px] font-semibold text-[var(--kaypal-v3-muted)]">
                    更新于 {formatDateTime(version.updatedAt)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={diffLoadingId === version.id}
                    onClick={() => onCompare(version)}
                    type="button"
                  >
                    {diffLoadingId === version.id ? (
                      <Loader2
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin"
                        strokeWidth={1.8}
                      />
                    ) : (
                      <GitCompare
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={1.8}
                      />
                    )}
                    对比
                  </button>
                  <button
                    className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                    onClick={() => onRestore(version)}
                    type="button"
                  >
                    <FilePenLine
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    恢复编辑
                  </button>
                  {!version.isOfficial ? (
                    <button
                      className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                      onClick={() => onOfficial(version)}
                      type="button"
                    >
                      <CheckCircle2
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={1.8}
                      />
                      设为正式稿
                    </button>
                  ) : null}
                  <button
                    className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[12px] font-semibold text-white transition hover:opacity-90"
                    onClick={() => onSend(version)}
                    type="button"
                  >
                    <ShieldCheck
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    送检查
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="p-4">
          <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-4 text-[13px] leading-5 text-[var(--kaypal-v3-muted)]">
            暂无保存版本。生成优化结果后，可以在结果区保存版本或送发布前检查。
          </div>
        </div>
      )}
    </section>
  );
}

function VersionComparePanel({
  diff,
  onClose,
  onRestore,
}: {
  diff: ContentVersionDiff;
  onClose: () => void;
  onRestore: () => void;
}) {
  const metrics = [
    ["原文字数", diff.summary.originalLength],
    ["版本字数", diff.summary.versionLength],
    [
      "字数变化",
      diff.summary.lengthDelta > 0
        ? `+${diff.summary.lengthDelta}`
        : diff.summary.lengthDelta,
    ],
  ];

  return (
    <section className="kaypal-v3-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--kaypal-v3-border)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitCompare
              aria-hidden="true"
              className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]"
              strokeWidth={1.8}
            />
            <h2 className="text-[15px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              版本对比
            </h2>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
            对照原文和当前版本，确认是否恢复继续编辑。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
            onClick={onClose}
            type="button"
          >
            收起
          </button>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[12px] font-semibold text-white transition hover:opacity-90"
            onClick={onRestore}
            type="button"
          >
            <FilePenLine
              aria-hidden="true"
              className="h-3.5 w-3.5"
              strokeWidth={1.8}
            />
            恢复编辑
          </button>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            {metrics.map(([label, value]) => (
              <div
                className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                key={label}
              >
                <p className="kaypal-v3-label">{label}</p>
                <p className="mt-1 text-[18px] font-bold text-[var(--kaypal-v3-ink)]">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-2">
          <CompareTextBlock
            content={diff.original.content}
            title={diff.original.title}
            label="原始内容"
          />
          <CompareTextBlock
            content={diff.version.content}
            title={diff.version.title}
            label="优化版本"
          />
        </div>
      </div>
    </section>
  );
}

function CompareTextBlock({
  content,
  label,
  title,
}: {
  content: string;
  label: string;
  title: string;
}) {
  const normalizedTitle = title.trim();
  const normalizedContent = content.trim();
  const displayContent =
    normalizedContent && normalizedContent !== normalizedTitle
      ? normalizedContent
      : "";

  return (
    <div className="min-w-0 border-b border-[var(--kaypal-v3-border)] p-4 md:border-b-0 md:border-r md:last:border-r-0">
      <p className="kaypal-v3-label">{label}</p>
      <h3 className="mt-1 line-clamp-2 text-[14px] font-bold leading-5 text-[var(--kaypal-v3-ink)]">
        {title || "无标题"}
      </h3>
      <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-[12px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
        {displayContent || "暂无正文"}
      </pre>
    </div>
  );
}

function ResultShell({
  actions,
  children,
  subtitle,
  title,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="kaypal-v3-label">{subtitle}</p>
          <h2 className="mt-1 text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            {title}
          </h2>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>

      {children}
    </div>
  );
}

function CopyButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
      onClick={onClick}
      type="button"
    >
      <Copy aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} />
      {label}
    </button>
  );
}

function TitleResultView({
  extraActions,
  onCopy,
  result,
}: {
  extraActions?: React.ReactNode;
  onCopy: (text: string, label?: string) => void;
  result: TitleScoreResult;
}) {
  return (
    <ResultShell
      actions={
        <>
          <CopyButton
            label="复制候选"
            onClick={() =>
              onCopy(result.rewriteCandidates.join("\n"), "候选标题")
            }
          />
          {extraActions}
        </>
      }
      subtitle="标题表现与可选方向"
      title="标题评分结果"
    >
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
          <p className="kaypal-v3-label">总分</p>
          <div className="mt-2 flex items-end gap-2">
            <strong
              className={`text-[42px] leading-none ${scoreTone(result.overallScore)}`}
            >
              {result.overallScore}
            </strong>
            <span className="pb-1 text-[13px] font-semibold text-[var(--kaypal-v3-muted)]">
              {qualityLabel[result.qualityLevel]}
            </span>
          </div>
          <p className="mt-3 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
            {result.originalTitle}
          </p>
        </div>

        <div className="grid gap-2">
          {result.dimensions.map((dimension) => (
            <div
              className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3"
              key={dimension.key}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
                  {dimension.label}
                </p>
                <span
                  className={`text-[13px] font-bold ${scoreTone(dimension.score)}`}
                >
                  {dimension.score}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--kaypal-v3-paper-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--kaypal-v3-accent)]"
                  style={{
                    width: `${Math.max(0, Math.min(100, dimension.score))}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                {dimension.evidence}
              </p>
            </div>
          ))}
        </div>
      </div>

      <TwoColumnLists
        leftTitle="候选标题"
        leftItems={result.rewriteCandidates}
        rightTitle="优化建议"
        rightItems={result.suggestions}
      />

      <HitItems items={result.hitItems} />
    </ResultShell>
  );
}

function RewriteResultView({
  extraActions,
  onCopy,
  result,
}: {
  extraActions?: React.ReactNode;
  onCopy: (text: string, label?: string) => void;
  result: RewriteResult;
}) {
  return (
    <ResultShell
      actions={
        <>
          <CopyButton
            label="复制正文"
            onClick={() => onCopy(result.rewrittenContent, "改写正文")}
          />
          {extraActions}
        </>
      }
      subtitle="主版本与可复用变体"
      title="文案改写结果"
    >
      <OutputBlock content={result.rewrittenContent} title="主版本" />

      <div className="grid gap-3 lg:grid-cols-3">
        {result.variants.map((variant) => (
          <article
            className="min-w-0 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
            key={variant.label}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
                  {variant.label}
                </p>
                <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                  {variant.title}
                </p>
              </div>
              <CopyButton
                label="复制"
                onClick={() => onCopy(variant.content, variant.label)}
              />
            </div>
            <p className="mt-2 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
              {variant.highlight}
            </p>
          </article>
        ))}
      </div>

      <TwoColumnLists
        leftTitle="改动点"
        leftItems={result.changes}
        rightTitle="后续建议"
        rightItems={result.suggestions}
      />
    </ResultShell>
  );
}

function XhsResultView({
  extraActions,
  onCopy,
  result,
}: {
  extraActions?: React.ReactNode;
  onCopy: (text: string, label?: string) => void;
  result: XhsNoteOptimizationResult;
}) {
  const note = [
    result.optimized.title,
    "",
    result.optimized.opening,
    "",
    result.optimized.body,
    "",
    result.optimized.callToAction,
    "",
    result.optimized.hashtags.map((tag) => `#${tag}`).join(" "),
  ].join("\n");

  return (
    <ResultShell
      actions={
        <>
          <CopyButton label="复制笔记" onClick={() => onCopy(note, "笔记")} />
          {extraActions}
        </>
      }
      subtitle="适合发布前确认的笔记版本"
      title="小红书笔记优化结果"
    >
      <div className="grid gap-3 lg:grid-cols-5">
        {[
          ["综合", result.score.overall],
          ["封面钩子", result.score.coverHook],
          ["搜索词", result.score.searchKeyword],
          ["可信度", result.score.trustBuilding],
          ["互动意图", result.score.interactionIntent],
        ].map(([label, score]) => (
          <div
            className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
            key={label}
          >
            <p className="kaypal-v3-label">{label}</p>
            <p
              className={`mt-1 text-[24px] font-bold ${scoreTone(Number(score))}`}
            >
              {score}
            </p>
          </div>
        ))}
      </div>

      <OutputBlock content={note} title="优化后笔记" />

      <HitItems items={result.hitItems} />

      <TwoColumnLists
        leftTitle="标签"
        leftItems={result.optimized.hashtags.map((tag) => `#${tag}`)}
        rightTitle="后续建议"
        rightItems={result.suggestions}
      />
    </ResultShell>
  );
}

function OutputBlock({ content, title }: { content: string; title: string }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]">
      <div className="border-b border-[var(--kaypal-v3-border)] px-3 py-2">
        <p className="text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
          {title}
        </p>
      </div>
      <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap p-3 text-[13px] leading-6 text-[var(--kaypal-v3-soft-ink)]">
        {content}
      </pre>
    </div>
  );
}

function TwoColumnLists({
  leftItems,
  leftTitle,
  rightItems,
  rightTitle,
}: {
  leftItems: string[];
  leftTitle: string;
  rightItems: string[];
  rightTitle: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Checklist title={leftTitle} items={leftItems} />
      <Checklist title={rightTitle} items={rightItems} />
    </div>
  );
}

function Checklist({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
      <p className="text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
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
            <span className="text-[13px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {item}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HitItems({ items }: { items: OptimizationHitItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
      <p className="text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
        命中项
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            className={`inline-flex max-w-full items-center gap-2 rounded-[8px] border px-2.5 py-1 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] ${hitTone(item.type)}`}
            key={`${item.type}-${item.text}-${item.reason}`}
            title={item.reason}
          >
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}
