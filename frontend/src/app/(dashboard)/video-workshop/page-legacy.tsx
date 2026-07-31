"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  addToast,
} from "@heroui/react";
import {
  AlertCircle,
  CircleStop,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileVideo,
  FolderInput,
  FolderOpen,
  ListChecks,
  Link2,
  PackagePlus,
  Play,
  RefreshCw,
  QrCode,
  Scissors,
  Search,
  SlidersHorizontal,
  Sparkles,
  Smartphone,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import type { AiEmployeeRunResult } from "@/lib/api/ai-employee";
import {
  videoWorkshopApi,
  type VideoWorkshopClipSettings,
  type VideoWorkshopLatestClip,
  type VideoWorkshopMaterialFile,
  type VideoWorkshopPhoneUploadSession,
  type VideoWorkshopProductProfile,
  type VideoWorkshopTask,
  type VideoWorkshopTaskResult,
} from "@/lib/api/video-workshop";
import {
  clearLatestVideoWorkshopClip,
  writeLatestVideoWorkshopClip,
} from "@/lib/ops-workbench/video-workshop-latest";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";

type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
type TaskFilter = "all" | RunStatus;
type PreviewTab = "storyboard" | "script" | "log";
type ModalView = "product" | "download" | "phone" | null;

type ClipDraft = {
  materialPath: string;
  templateName: string;
  outputName: string;
  titlePrompt: string;
  aspectRatio: string;
  durationPreset: string;
  productId: string;
  productName: string;
  musicPreset: string;
  titleStyle: string;
  subtitleStyle: string;
  fontPreset: string;
  filterPreset: string;
  transitionPreset: string;
};

type WorkshopRun = ClipDraft & {
  id: string;
  title: string;
  meta: string;
  status: RunStatus;
  stage: string;
  progress: number;
  createdAt: string;
  message?: string;
  outputPath?: string;
  backendTaskId?: string;
  taskKind?: "render" | "download";
  attempts?: number;
  maxAttempts?: number;
  result?: AiEmployeeRunResult | VideoWorkshopTaskResult;
};

const workspaceActions = [
  { key: "assets", label: "素材库", icon: FolderOpen, href: "/content" },
  { key: "asset", label: "选择素材", icon: FolderInput },
  { key: "batch", label: "批量导入", icon: PackagePlus },
  { key: "video", label: "视频剪辑", icon: FileVideo, current: true },
  { key: "product", label: "产品信息", icon: SlidersHorizontal },
  { key: "download", label: "下载任务", icon: Link2 },
  { key: "phone", label: "手机上传", icon: Smartphone },
  { key: "task", label: "任务进度", icon: ListChecks },
  { key: "accounts", label: "平台账号", icon: UsersRound, href: "/distribution?tab=accounts" },
  {
    key: "publish",
    label: "发布衔接",
    icon: Upload,
    href: "/distribution?tab=video",
  },
  { key: "records", label: "发布记录", icon: Download, href: "/distribution?tab=tasks" },
];

const DEFAULT_DRAFT: ClipDraft = {
  materialPath: "",
  templateName: "产品卖点模板",
  outputName: "产品视频.mp4",
  titlePrompt: "",
  aspectRatio: "9:16 竖版",
  durationPreset: "30 秒",
  productId: "",
  productName: "",
  musicPreset: "轻快节奏",
  titleStyle: "标题：简洁加粗",
  subtitleStyle: "字幕：白字黑边",
  fontPreset: "系统黑体",
  filterPreset: "自然清晰",
  transitionPreset: "自然切换",
};

const templatePresets = [
  {
    title: "产品卖点",
    templateName: "产品卖点模板",
    note: "竖版、自然清晰、轻快音乐",
    ratio: "9:16",
    previewClass: "aspect-[9/16] h-[168px]",
    prompt:
      "突出产品卖点、优惠信息和真实使用场景，画面节奏明快，最后引导咨询。",
    draft: {
      aspectRatio: "9:16 竖版",
      durationPreset: "30 秒",
      musicPreset: "轻快节奏",
      titleStyle: "标题：简洁加粗",
      subtitleStyle: "字幕：白字黑边",
      fontPreset: "系统黑体",
      filterPreset: "自然清晰",
      transitionPreset: "自然切换",
    },
    tone: "bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)] ring-[var(--kaypal-v3-border)]",
  },
  {
    title: "门店探店",
    templateName: "门店探店模板",
    note: "竖版、暖调生活、重点标题",
    ratio: "9:16",
    previewClass: "aspect-[9/16] h-[168px]",
    prompt: "按探店顺序讲清环境、爆品、价格和到店理由，镜头切换自然。",
    draft: {
      aspectRatio: "9:16 竖版",
      durationPreset: "30 秒",
      musicPreset: "轻快节奏",
      titleStyle: "标题：高亮重点",
      subtitleStyle: "字幕：简洁留白",
      fontPreset: "圆体",
      filterPreset: "暖调生活",
      transitionPreset: "自然切换",
    },
    tone: "bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)] ring-[var(--kaypal-v3-border)]",
  },
  {
    title: "客户案例",
    templateName: "客户案例模板",
    note: "横版、冷调质感、温和音乐",
    ratio: "16:9",
    previewClass: "aspect-video w-[88%]",
    prompt: "用客户案例结构呈现：原本问题、解决过程、结果变化、适合人群。",
    draft: {
      aspectRatio: "16:9 横版",
      durationPreset: "45 秒",
      musicPreset: "温和叙述",
      titleStyle: "标题：知识卡片",
      subtitleStyle: "字幕：简洁留白",
      fontPreset: "系统黑体",
      filterPreset: "冷调质感",
      transitionPreset: "淡入淡出",
    },
    tone: "bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)] ring-[var(--kaypal-v3-border)]",
  },
  {
    title: "知识口播",
    templateName: "知识口播模板",
    note: "方形、自然清晰、宋体字幕",
    ratio: "1:1",
    previewClass: "aspect-square h-[128px]",
    prompt: "用知识分享结构输出，开头直接给观点，中间给例子，结尾给行动建议。",
    draft: {
      aspectRatio: "1:1 方形",
      durationPreset: "30 秒",
      musicPreset: "氛围留白",
      titleStyle: "标题：简洁加粗",
      subtitleStyle: "字幕：白字黑边",
      fontPreset: "宋体",
      filterPreset: "自然清晰",
      transitionPreset: "不使用转场",
    },
    tone: "bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-soft-ink)] ring-[var(--kaypal-v3-border)]",
  },
];

const taskFilters: Array<{ key: TaskFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "running", label: "处理中" },
  { key: "done", label: "完成" },
  { key: "failed", label: "失败" },
  { key: "cancelled", label: "已取消" },
];
const statusMeta: Record<RunStatus, { label: string; className: string }> = {
  queued: {
    label: "排队中",
    className:
      "border-[var(--kaypal-v3-border)] bg-default-50 text-default-600",
  },
  running: {
    label: "处理中",
    className:
      "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]",
  },
  done: {
    label: "完成",
    className:
      "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]",
  },
  failed: {
    label: "失败",
    className:
      "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]",
  },
  cancelled: {
    label: "已取消",
    className:
      "border-[var(--kaypal-v3-border)] bg-default-100 text-default-600",
  },
};

function taskResultLabel(value: string | undefined) {
  switch (value) {
    case "success":
      return "处理成功";
    case "invalid_input":
      return "提交内容需要修改";
    case "missing_asset":
    case "target_not_found":
      return "素材不可用";
    case "runtime_unavailable":
      return "当前设备无法完成剪辑";
    case "processing_failure":
    case "send_failed":
      return "视频处理未完成";
    case "cancelled":
      return "任务已取消";
    default:
      return value ? commercialDisplayText(value) : "等待处理结果";
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return toPublicError(error, fallback);
}

function clipOutputPath(
  result: AiEmployeeRunResult | VideoWorkshopTaskResult | undefined | null,
) {
  if (!result) return "";
  return (
    result.evidence.find((item) => item.label === "video-template-clip-output")
      ?.path ||
    result.evidence.find((item) => item.label === "video-template-clip-output")
      ?.url ||
    ""
  );
}

function formatBytes(value: number | undefined) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatGeneratedAt(value: string | number | Date | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date
    .toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(/\//g, "-");
}
function normalizeOutputName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return `video-workshop-${Date.now()}.mp4`;
  return trimmed.toLowerCase().endsWith(".mp4") ? trimmed : `${trimmed}.mp4`;
}

function fileNameFromPath(value?: string | null, fallback = "本机成片") {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  const normalized = cleaned.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || fallback;
}

function displayFileNameFromPath(value?: string | null, fallback = "本机成片") {
  return commercialDisplayText(fileNameFromPath(value, fallback));
}

function buildPrompt(draft: ClipDraft) {
  return [
    draft.titlePrompt.trim(),
    [
      draft.productName ? `产品：${draft.productName}` : "",
      `画幅：${draft.aspectRatio}`,
      `时长：${draft.durationPreset}`,
      `音乐：${draft.musicPreset}`,
      draft.titleStyle,
      draft.subtitleStyle,
      `字体：${draft.fontPreset}`,
      `滤镜：${draft.filterPreset}`,
      `转场：${draft.transitionPreset}`,
    ]
      .filter(Boolean)
      .join("；"),
  ]
    .filter(Boolean)
    .join("\n");
}

function draftSignature(draft: ClipDraft) {
  return JSON.stringify(draft);
}

function clipSettingsFromDraft(draft: ClipDraft): VideoWorkshopClipSettings {
  return {
    musicPreset: draft.musicPreset,
    titleStyle: draft.titleStyle,
    subtitleStyle: draft.subtitleStyle,
    fontPreset: draft.fontPreset,
    filterPreset: draft.filterPreset,
    transitionPreset: draft.transitionPreset,
    aspectRatio: draft.aspectRatio,
  };
}

function durationSecondsFromPreset(value: string) {
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) ? seconds : 30;
}

function durationPresetFromClipName(value: string) {
  const match = value.match(/(?:^|[-_\s])(\d{1,3})(?:s|秒)(?:[-_\s.]|$)/i);
  if (!match) return "30 秒";
  return `${match[1]} 秒`;
}

function runFromLatestClip(
  clip: VideoWorkshopLatestClip,
): WorkshopRun {
  const outputName =
    clip.outputName || clip.outputPath.split("/").pop() || "视频工坊成片.mp4";
  const templateName = clip.templateName || "视频工坊模板";
  const materialPath = clip.materialPath || "";
  const titlePrompt = "已从最近一次真实成片恢复，可直接复制路径或进入发布。";
  return {
    id: clip.id || `video-workshop-restored-${Date.now()}`,
    title: outputName,
    meta: `${templateName} · 已恢复 · 本机成片`,
    status: "done",
    stage: "已恢复最近成片",
    progress: 100,
    createdAt: formatGeneratedAt(clip.createdAt || Date.now()),
    message: clip.message || `成片已生成：${outputName}`,
    outputPath: clip.outputPath,
    outputName,
    templateName,
    materialPath,
    titlePrompt: clip.titlePrompt || titlePrompt,
    aspectRatio: "9:16 竖版",
    durationPreset: durationPresetFromClipName(outputName),
    productId: "",
    productName: clip.productName || "",
    musicPreset: clip.settings?.musicPreset || DEFAULT_DRAFT.musicPreset,
    titleStyle: clip.settings?.titleStyle || DEFAULT_DRAFT.titleStyle,
    subtitleStyle: clip.settings?.subtitleStyle || DEFAULT_DRAFT.subtitleStyle,
    fontPreset: clip.settings?.fontPreset || DEFAULT_DRAFT.fontPreset,
    filterPreset: clip.settings?.filterPreset || DEFAULT_DRAFT.filterPreset,
    transitionPreset:
      clip.settings?.transitionPreset || DEFAULT_DRAFT.transitionPreset,
  };
}

function runFromTask(task: VideoWorkshopTask): WorkshopRun {
  const input = task.renderInput;
  const settings = input?.settings;
  const isRender = task.kind === "render";
  const status: RunStatus =
    task.status === "succeeded"
      ? "done"
      : task.status === "failed"
        ? "failed"
        : task.status === "cancelled"
          ? "cancelled"
          : task.status;
  const outputName = isRender
    ? normalizeOutputName(input?.outputName || fileNameFromPath(task.outputPath))
    : task.material?.name ||
      input?.outputName ||
      task.downloadInput?.outputName ||
      "链接下载素材";
  return {
    ...DEFAULT_DRAFT,
    id: task.id,
    backendTaskId: task.id,
    taskKind: task.kind,
    title: outputName,
    meta: isRender
      ? `${input?.templateName || "视频模板"} · 视频剪辑`
      : `安全链接下载 · ${task.attempts}/${task.maxAttempts} 次执行`,
    status,
    stage: task.stage,
    progress: task.progress,
    createdAt: formatGeneratedAt(task.updatedAt || task.createdAt),
    message: task.error || task.result?.message,
    outputPath: isRender ? task.outputPath : undefined,
    result: isRender ? task.result : undefined,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    materialPath: isRender
      ? input?.materialPath || ""
      : task.material?.path || "",
    templateName: input?.templateName || "链接下载",
    outputName,
    titlePrompt: input?.subtitleText || input?.titlePrompt || "",
    durationPreset: input?.durationSeconds
      ? `${input.durationSeconds} 秒`
      : DEFAULT_DRAFT.durationPreset,
    productName: input?.productName || "",
    musicPreset: settings?.musicPreset || DEFAULT_DRAFT.musicPreset,
    titleStyle: settings?.titleStyle || DEFAULT_DRAFT.titleStyle,
    subtitleStyle: settings?.subtitleStyle || DEFAULT_DRAFT.subtitleStyle,
    fontPreset: settings?.fontPreset || DEFAULT_DRAFT.fontPreset,
    filterPreset: settings?.filterPreset || DEFAULT_DRAFT.filterPreset,
    transitionPreset:
      settings?.transitionPreset || DEFAULT_DRAFT.transitionPreset,
    aspectRatio: settings?.aspectRatio || DEFAULT_DRAFT.aspectRatio,
  };
}
function StatusBadge({
  status,
  children,
}: {
  status: RunStatus;
  children?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-h-[22px] shrink-0 items-center justify-center rounded-full border px-2 text-[11px] font-semibold leading-none ${statusMeta[status].className}`}
    >
      {children || statusMeta[status].label}
    </span>
  );
}
function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-lg border-small border-divider bg-background shadow-sm ${className}`}
    >
      <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-divider px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            {title}
          </h2>
          <p className="mt-0.5 truncate text-small leading-5 text-default-500">
            {subtitle}
          </p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="grid min-w-0 gap-2">
      <span className="text-tiny font-semibold leading-5 text-default-600">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 w-full rounded-lg border border-divider bg-background px-3 text-small text-default-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

export default function VideoWorkshopPage() {
  const router = useRouter();
  const materialFileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedTaskSyncRef = useRef(false);
  const announcedTaskIdsRef = useRef(new Set<string>());
  const announcedPhoneSessionRef = useRef("");
  const [materialPath, setMaterialPath] = useState(DEFAULT_DRAFT.materialPath);
  const [templateName, setTemplateName] = useState(DEFAULT_DRAFT.templateName);
  const [outputName, setOutputName] = useState(DEFAULT_DRAFT.outputName);
  const [titlePrompt, setTitlePrompt] = useState(DEFAULT_DRAFT.titlePrompt);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_DRAFT.aspectRatio);
  const [durationPreset, setDurationPreset] = useState(DEFAULT_DRAFT.durationPreset);
  const [productId, setProductId] = useState(DEFAULT_DRAFT.productId);
  const [productName, setProductName] = useState(DEFAULT_DRAFT.productName);
  const [musicPreset, setMusicPreset] = useState(DEFAULT_DRAFT.musicPreset);
  const [titleStyle, setTitleStyle] = useState(DEFAULT_DRAFT.titleStyle);
  const [subtitleStyle, setSubtitleStyle] = useState(DEFAULT_DRAFT.subtitleStyle);
  const [fontPreset, setFontPreset] = useState(DEFAULT_DRAFT.fontPreset);
  const [filterPreset, setFilterPreset] = useState(DEFAULT_DRAFT.filterPreset);
  const [transitionPreset, setTransitionPreset] = useState(
    DEFAULT_DRAFT.transitionPreset,
  );
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<TaskFilter>("all");
  const [activePreviewTab, setActivePreviewTab] =
    useState<PreviewTab>("storyboard");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingQueue, setIsRefreshingQueue] = useState(false);
  const [isUploadingMaterial, setIsUploadingMaterial] = useState(false);
  const [materials, setMaterials] = useState<VideoWorkshopMaterialFile[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [products, setProducts] = useState<VideoWorkshopProductProfile[]>([]);
  const [activeModal, setActiveModal] = useState<ModalView>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [productFormName, setProductFormName] = useState("");
  const [productFormHighlights, setProductFormHighlights] = useState("");
  const [productFormDescription, setProductFormDescription] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadOutputName, setDownloadOutputName] = useState("");
  const [isCreatingDownload, setIsCreatingDownload] = useState(false);
  const [downloadPolicy, setDownloadPolicy] = useState<
    Awaited<ReturnType<typeof videoWorkshopApi.downloadPolicy>> | null
  >(null);
  const [phoneSession, setPhoneSession] =
    useState<VideoWorkshopPhoneUploadSession | null>(null);
  const [isCreatingPhoneSession, setIsCreatingPhoneSession] = useState(false);
  const [phoneSessionError, setPhoneSessionError] = useState("");
  const [savedDraftSignature, setSavedDraftSignature] = useState(() =>
    draftSignature(DEFAULT_DRAFT),
  );
  const [pendingNavigation, setPendingNavigation] = useState("");
  const [previewVideoUrl, setPreviewVideoUrl] = useState("");
  const [previewVideoError, setPreviewVideoError] = useState("");
  const [isLoadingPreviewVideo, setIsLoadingPreviewVideo] = useState(false);
  const [runs, setRuns] = useState<WorkshopRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [lastResult, setLastResult] = useState<
    AiEmployeeRunResult | VideoWorkshopTaskResult | null
  >(null);

  const loadMaterials = async () => {
    setIsLoadingMaterials(true);
    try {
      setMaterials(await videoWorkshopApi.materialFiles(60));
    } catch {
      setMaterials([]);
    } finally {
      setIsLoadingMaterials(false);
    }
  };

  const loadProducts = async () => {
    try {
      setProducts(await videoWorkshopApi.productProfiles());
    } catch {
      setProducts([]);
    }
  };

  function openProductModal() {
    const current = products.find((product) => product.id === productId);
    setProductFormName(current?.name || productName);
    setProductFormHighlights((current?.highlights || []).join("\n"));
    setProductFormDescription(current?.description || "");
    setActiveModal("product");
  }

  function selectProduct(nextId: string) {
    const product = products.find((item) => item.id === nextId);
    setProductId(product?.id || "");
    setProductName(product?.name || "");
  }

  async function saveProduct() {
    const name = productFormName.trim();
    if (!name) {
      addToast({ title: "请填写产品名称", color: "warning" });
      return;
    }
    setIsSavingProduct(true);
    try {
      const product = await videoWorkshopApi.saveProductProfile({
        id: productId || undefined,
        name,
        highlights: productFormHighlights
          .split(/\n|,|，/)
          .map((item) => item.trim())
          .filter(Boolean),
        description: productFormDescription.trim(),
      });
      setProducts((previous) => {
        const withoutCurrent = previous.filter((item) => item.id !== product.id);
        return [product, ...withoutCurrent];
      });
      setProductId(product.id);
      setProductName(product.name);
      if (!titlePrompt.trim()) {
        setTitlePrompt(
          [product.description, ...product.highlights]
            .filter(Boolean)
            .join("；"),
        );
      }
      setActiveModal(null);
      addToast({ title: "产品信息已保存", color: "success" });
    } catch (error) {
      addToast({
        title: "保存失败",
        description: getErrorMessage(error, "产品信息暂时无法保存。"),
        color: "danger",
      });
    } finally {
      setIsSavingProduct(false);
    }
  }

  function mergeTaskMaterials(tasks: VideoWorkshopTask[]) {
    const downloaded = tasks
      .filter((task) => task.status === "succeeded" && task.material)
      .map((task) => task.material as VideoWorkshopMaterialFile);
    if (!downloaded.length) return;
    setMaterials((previous) => {
      const merged = new Map(
        [...downloaded, ...previous].map((item) => [item.path, item]),
      );
      return Array.from(merged.values()).slice(0, 60);
    });
  }

  function handleTaskCompletions(
    tasks: VideoWorkshopTask[],
    announce: boolean,
  ) {
    mergeTaskMaterials(tasks);
    const terminalTasks = tasks.filter((task) =>
      ["succeeded", "failed", "cancelled"].includes(task.status),
    );
    if (!initializedTaskSyncRef.current) {
      terminalTasks.forEach((task) => announcedTaskIdsRef.current.add(task.id));
      initializedTaskSyncRef.current = true;
      return;
    }

    for (const task of terminalTasks) {
      if (announcedTaskIdsRef.current.has(task.id)) continue;
      announcedTaskIdsRef.current.add(task.id);
      if (task.status === "succeeded" && task.kind === "render" && task.outputPath) {
        const input = task.renderInput;
        writeLatestVideoWorkshopClip({
          id: task.id,
          outputPath: task.outputPath,
          outputName: normalizeOutputName(input?.outputName || fileNameFromPath(task.outputPath)),
          templateName: input?.templateName || "视频工坊模板",
          materialPath: input?.materialPath || "",
          titlePrompt: input?.subtitleText || input?.titlePrompt || "",
          productName: input?.productName || "",
          settings: input?.settings || {},
          message: task.result?.message,
          createdAt: task.finishedAt || task.updatedAt,
        });
        if (task.result) setLastResult(task.result);
      }
      if (task.status === "succeeded" && task.kind === "download" && task.material) {
        setMaterialPath(task.material.path);
      }
      if (!announce) continue;
      addToast({
        title:
          task.status === "succeeded"
            ? task.kind === "render"
              ? "剪辑已完成"
              : "素材下载完成"
            : task.status === "cancelled"
              ? "任务已取消"
              : "任务执行失败",
        description:
          task.result?.message || task.error || task.stage,
        color:
          task.status === "succeeded"
            ? "success"
            : task.status === "failed"
              ? "danger"
              : "default",
      });
    }
  }

  function mergeDurableTasks(tasks: VideoWorkshopTask[]) {
    const taskRuns = tasks.map(runFromTask);
    const taskIds = new Set(taskRuns.map((run) => run.id));
    const outputPaths = new Set(
      taskRuns.map((run) => run.outputPath).filter(Boolean),
    );
    setRuns((previous) => [
      ...taskRuns,
      ...previous.filter(
        (run) =>
          !taskIds.has(run.id) &&
          !run.backendTaskId &&
          (!run.outputPath || !outputPaths.has(run.outputPath)),
      ),
    ].slice(0, 50));
  }

  const restoreLatestClip = async (showToast = false) => {
    setIsRefreshingQueue(true);
    try {
      const [backendTasks, backendClips] = await Promise.all([
        videoWorkshopApi.tasks(50),
        videoWorkshopApi.clips("video-workshop", 20),
      ]);
      const taskRuns = backendTasks.map(runFromTask);
      const taskOutputs = new Set(
        taskRuns.map((run) => run.outputPath).filter(Boolean),
      );
      const restoredRuns = backendClips
        .map((clip) => runFromLatestClip(clip))
        .filter((run) => !run.outputPath || !taskOutputs.has(run.outputPath));
      const combinedRuns = [...taskRuns, ...restoredRuns].slice(0, 50);
      handleTaskCompletions(backendTasks, showToast);
      if (backendClips[0]) {
        writeLatestVideoWorkshopClip(backendClips[0]);
      } else {
        clearLatestVideoWorkshopClip();
      }
      if (!combinedRuns.length) {
        setRuns([]);
        setSelectedRunId("");
        setLastResult(null);
        if (showToast) {
          addToast({
            title: "任务进度已刷新",
            description: "没有找到最近成片。",
            color: "default",
          });
        }
        return;
      }

      setRuns(combinedRuns);
      setSelectedRunId((current) =>
        combinedRuns.some((run) => run.id === current)
          ? current
          : combinedRuns[0].id,
      );
      setLastResult(
        backendTasks.find(
          (task) => task.kind === "render" && task.status === "succeeded",
        )?.result || null,
      );
      if (showToast) {
        addToast({
          title: "任务进度已刷新",
          description: `${combinedRuns.length} 个任务和成片已显示。`,
          color: "success",
        });
      }
    } catch (error) {
      if (showToast) {
        addToast({
          title: "刷新失败",
          description: getErrorMessage(
            error,
            "成片任务暂时无法刷新，请稍后重试。",
          ),
          color: "danger",
        });
      }
    } finally {
      setIsRefreshingQueue(false);
    }
  };

  useEffect(() => {
    void restoreLatestClip(false);
    void loadMaterials();
    void loadProducts();
    // Initial hydration should not restart when editable draft state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasActiveDurableTasks = runs.some(
    (run) =>
      Boolean(run.backendTaskId) &&
      (run.status === "queued" || run.status === "running"),
  );

  useEffect(() => {
    if (!hasActiveDurableTasks) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const tasks = await videoWorkshopApi.tasks(50);
        if (cancelled) return;
        mergeDurableTasks(tasks);
        handleTaskCompletions(tasks, true);
      } catch {
        // Keep the last durable snapshot while the local backend reconnects.
      }
    };
    const timer = window.setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Polling is keyed to whether durable work exists; helpers read the latest task payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveDurableTasks]);

  useEffect(() => {
    if (
      activeModal !== "phone" ||
      !phoneSession ||
      !["pending", "uploading"].includes(phoneSession.status)
    )
      return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await videoWorkshopApi.phoneUploadSession(phoneSession.id);
        if (cancelled) return;
        setPhoneSessionError("");
        setPhoneSession((current) =>
          current?.id === next.id
            ? {
                ...next,
                uploadUrl: current.uploadUrl,
                qrDataUrl: current.qrDataUrl,
                reachableFromPhone: current.reachableFromPhone,
                networkHint: current.networkHint,
              }
            : current,
        );
        if (
          next.status === "succeeded" &&
          next.material &&
          announcedPhoneSessionRef.current !== next.id
        ) {
          announcedPhoneSessionRef.current = next.id;
          setMaterialPath(next.material.path);
          setMaterials((previous) => {
            const merged = new Map(
              [next.material as VideoWorkshopMaterialFile, ...previous].map(
                (item) => [item.path, item],
              ),
            );
            return Array.from(merged.values()).slice(0, 60);
          });
          addToast({
            title: "手机素材上传完成",
            description: next.material.name,
            color: "success",
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPhoneSessionError(
            getErrorMessage(error, "手机上传进度暂时无法刷新。"),
          );
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // The session id/status are the lifecycle keys; transient QR fields must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, phoneSession?.id, phoneSession?.status]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId],
  );
  const latestRunId = runs[0]?.id || "";
  const outputPath = useMemo(
    () =>
      selectedRun
        ? selectedRun.outputPath || ""
        : clipOutputPath(lastResult),
    [lastResult, selectedRun],
  );
  useEffect(() => {
    if (!outputPath) {
      setPreviewVideoUrl("");
      setPreviewVideoError("");
      setIsLoadingPreviewVideo(false);
      return;
    }

    let cancelled = false;
    let objectUrl = "";
    setPreviewVideoUrl("");
    setPreviewVideoError("");
    setIsLoadingPreviewVideo(true);

    fetch(videoWorkshopApi.previewClipUrl(outputPath), {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`预览加载失败：${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewVideoUrl(objectUrl);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewVideoError(
          getErrorMessage(error, "视频暂时无法预览，请稍后重试。"),
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreviewVideo(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [outputPath]);
  const filteredRuns = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (
        activeFilter !== "all" &&
        !(
          activeFilter === "running" &&
          (run.status === "running" || run.status === "queued")
        ) &&
        run.status !== activeFilter
      )
        return false;
      if (!keyword) return true;
      return [
        run.title,
        run.meta,
        run.materialPath,
        run.templateName,
        run.outputPath || "",
      ].some((item) => item.toLowerCase().includes(keyword));
    });
  }, [activeFilter, query, runs]);
  const queueStats = useMemo(
    () => ({
      total: runs.length,
      running: runs.filter(
        (run) => run.status === "running" || run.status === "queued",
      ).length,
      done: runs.filter((run) => run.status === "done").length,
      failed: runs.filter((run) => run.status === "failed").length,
    }),
    [runs],
  );
  const clipReadiness = useMemo(() => {
    const missing = [
      materialPath.trim() ? "" : "本机素材",
      titlePrompt.trim() ? "" : "创作目标",
      templateName.trim() ? "" : "剪辑模板",
    ].filter(Boolean);
    return {
      missing,
      ready: missing.length === 0,
      label: missing.length ? `还差 ${missing.join("、")}` : "可以开始剪辑",
    };
  }, [materialPath, templateName, titlePrompt]);
  const currentDraft = useMemo<ClipDraft>(
    () => ({
      materialPath,
      templateName,
      outputName: normalizeOutputName(outputName),
      titlePrompt,
      aspectRatio,
      durationPreset,
      productId,
      productName,
      musicPreset,
      titleStyle,
      subtitleStyle,
      fontPreset,
      filterPreset,
      transitionPreset,
    }),
    [
      aspectRatio,
      durationPreset,
      materialPath,
      outputName,
      productId,
      productName,
      musicPreset,
      titleStyle,
      subtitleStyle,
      fontPreset,
      filterPreset,
      templateName,
      titlePrompt,
      transitionPreset,
    ],
  );
  const hasUnsavedChanges =
    draftSignature(currentDraft) !== savedDraftSignature;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const confirmExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmExit);
    return () => window.removeEventListener("beforeunload", confirmExit);
  }, [hasUnsavedChanges]);

  function writeClipboardTextWithSelection(text: string) {
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
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function selectOutputPathText(path: string) {
    if (!path) return false;
    const input = document.querySelector<HTMLInputElement>(
      "[data-video-workshop-output-path]",
    );
    if (!input) return false;
    input.focus();
    input.select();
    input.setSelectionRange(0, path.length);
    return true;
  }

  async function copyOutputPath(path: string) {
    if (!path) return;
    const copied = await writeClipboardText(path);
    if (copied) {
      addToast({
        title: "已复制成片路径",
        description: path,
        color: "success",
      });
      return;
    }
    if (selectOutputPathText(path)) {
      addToast({
        title: "已选中成片路径",
        description: "当前浏览器限制剪贴板写入，可直接按 Cmd+C 复制。",
        color: "warning",
      });
      return;
    }
    addToast({ title: "复制失败", description: path, color: "warning" });
  }

  async function copyPhoneUploadUrl() {
    const url = phoneSession?.uploadUrl || "";
    if (!url) return;
    const copied = await writeClipboardText(url);
    addToast({
      title: copied ? "手机上传链接已复制" : "链接复制失败",
      description: copied ? "可发送到同一局域网内的手机打开。" : url,
      color: copied ? "success" : "warning",
    });
  }

  function applyDraft(draft: ClipDraft) {
    setMaterialPath(draft.materialPath);
    setTemplateName(draft.templateName);
    setOutputName(draft.outputName);
    setTitlePrompt(draft.titlePrompt);
    setAspectRatio(draft.aspectRatio);
    setDurationPreset(draft.durationPreset);
    setProductId(draft.productId);
    setProductName(draft.productName);
    setMusicPreset(draft.musicPreset);
    setTitleStyle(draft.titleStyle);
    setSubtitleStyle(draft.subtitleStyle);
    setFontPreset(draft.fontPreset);
    setFilterPreset(draft.filterPreset);
    setTransitionPreset(draft.transitionPreset);
  }

  function updateSearchQuery(value: string) {
    setQuery(value);
  }

  function clearSearchQuery() {
    setQuery("");
  }

  function openMaterialPicker() {
    materialFileInputRef.current?.click();
  }

  function requestNavigation(href: string) {
    if (!hasUnsavedChanges) {
      router.push(href);
      return;
    }
    setPendingNavigation(href);
  }

  async function importSelectedMaterial(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []).slice(0, 50);
    if (!files.length) return;

    setIsUploadingMaterial(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const result = await videoWorkshopApi.uploadMaterialFiles(formData);
      const material = result.items[0];
      if (!material) {
        throw new Error(result.rejected[0]?.reason || "没有可导入的素材");
      }
      setMaterialPath(material.path);
      setMaterials((previous) => {
        const merged = new Map(
          [...result.items, ...previous].map((item) => [item.path, item]),
        );
        return Array.from(merged.values()).slice(0, 60);
      });
      addToast({
        title: `已导入 ${result.items.length} 个素材`,
        description: result.rejected.length
          ? `${result.rejected.length} 个未导入`
          : material.name,
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "素材导入失败",
        description: getErrorMessage(
          error,
          "素材未能导入，请稍后重试。",
        ),
        color: "danger",
      });
    } finally {
      input.value = "";
      setIsUploadingMaterial(false);
    }
  }

  async function runClip(overrides?: Partial<ClipDraft>) {
    const draft = {
      ...currentDraft,
      ...overrides,
      materialPath: (
        overrides?.materialPath ?? currentDraft.materialPath
      ).trim(),
      templateName: (
        overrides?.templateName ?? currentDraft.templateName
      ).trim(),
      outputName: normalizeOutputName(
        overrides?.outputName ?? currentDraft.outputName,
      ),
      titlePrompt: overrides?.titlePrompt ?? currentDraft.titlePrompt,
    };

    if (!draft.materialPath) {
      addToast({
        title: "缺少素材",
        description: "请填写素材文件或素材文件夹路径。",
        color: "danger",
      });
      return;
    }
    if (!draft.titlePrompt.trim()) {
      addToast({
        title: "缺少创作目标",
        description: "请填写这条视频要突出什么内容。",
        color: "danger",
      });
      return;
    }
    if (!draft.templateName) {
      addToast({
        title: "缺少模板",
        description: "请选择剪辑模板。",
        color: "danger",
      });
      return;
    }
    applyDraft(draft);
    setIsSubmitting(true);
    setActivePreviewTab("log");

    try {
      const task = await videoWorkshopApi.createRenderTask({
        materialPath: draft.materialPath,
        templateName: draft.templateName,
        titlePrompt: buildPrompt(draft),
        titleText:
          draft.productName || draft.outputName.replace(/\.mp4$/i, ""),
        subtitleText: draft.titlePrompt,
        outputName: draft.outputName,
        durationSeconds: durationSecondsFromPreset(draft.durationPreset),
        productName: draft.productName,
        settings: clipSettingsFromDraft(draft),
        source: "video-workshop",
      });
      const queuedRun = runFromTask(task);
      setSelectedRunId(task.id);
      setRuns((previous) => [
        queuedRun,
        ...previous.filter((run) => run.id !== task.id),
      ].slice(0, 50));
      setSavedDraftSignature(draftSignature(draft));
      addToast({
        title: "剪辑任务已创建",
        description: "可在任务进度中查看、取消或等待完成。",
        color: "success",
      });
    } catch (error) {
      const message = getErrorMessage(
        error,
        "剪辑任务未能创建，请稍后重试。",
      );
      setActivePreviewTab("log");
      addToast({ title: "任务创建失败", description: message, color: "danger" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function retryRun(run: WorkshopRun) {
    if (run.backendTaskId) {
      try {
        const task = await videoWorkshopApi.retryTask(run.backendTaskId);
        announcedTaskIdsRef.current.delete(task.id);
        const retried = runFromTask(task);
        setRuns((previous) =>
          previous.map((item) => (item.id === retried.id ? retried : item)),
        );
        setSelectedRunId(task.id);
        addToast({ title: "任务已重新排队", color: "success" });
      } catch (error) {
        addToast({
          title: "重试失败",
          description: getErrorMessage(error, "任务暂时无法重试。"),
          color: "danger",
        });
      }
      return;
    }
    void runClip({
      ...run,
      materialPath: currentDraft.materialPath.trim() || run.materialPath,
      templateName: currentDraft.templateName.trim() || run.templateName,
      titlePrompt: currentDraft.titlePrompt,
      aspectRatio: currentDraft.aspectRatio,
      durationPreset: currentDraft.durationPreset,
      productId: currentDraft.productId,
      productName: currentDraft.productName,
      musicPreset: currentDraft.musicPreset,
      titleStyle: currentDraft.titleStyle,
      subtitleStyle: currentDraft.subtitleStyle,
      fontPreset: currentDraft.fontPreset,
      filterPreset: currentDraft.filterPreset,
      transitionPreset: currentDraft.transitionPreset,
      outputName: normalizeOutputName(
        currentDraft.outputName || run.outputName,
      ),
    });
  }

  async function cancelRun(run: WorkshopRun) {
    if (!run.backendTaskId) return;
    try {
      const task = await videoWorkshopApi.cancelTask(run.backendTaskId);
      const cancelledRun = runFromTask(task);
      setRuns((previous) =>
        previous.map((item) =>
          item.id === cancelledRun.id ? cancelledRun : item,
        ),
      );
      announcedTaskIdsRef.current.add(task.id);
      addToast({ title: "任务已取消", color: "default" });
    } catch (error) {
      addToast({
        title: "取消失败",
        description: getErrorMessage(error, "任务暂时无法取消。"),
        color: "danger",
      });
    }
  }

  async function openDownloadModal() {
    setActiveModal("download");
    if (downloadPolicy) return;
    try {
      setDownloadPolicy(await videoWorkshopApi.downloadPolicy());
    } catch {
      setDownloadPolicy(null);
    }
  }

  async function createDownloadTask() {
    if (!downloadUrl.trim()) {
      addToast({ title: "请填写视频链接", color: "warning" });
      return;
    }
    setIsCreatingDownload(true);
    try {
      const task = await videoWorkshopApi.createDownloadTask({
        url: downloadUrl.trim(),
        outputName: downloadOutputName.trim() || undefined,
      });
      const run = runFromTask(task);
      setRuns((previous) => [
        run,
        ...previous.filter((item) => item.id !== run.id),
      ].slice(0, 50));
      setSelectedRunId(task.id);
      setActivePreviewTab("log");
      setDownloadUrl("");
      setDownloadOutputName("");
      setActiveModal(null);
      addToast({
        title: "下载任务已创建",
        description: "安全检查和文件传输将在任务进度中更新。",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "下载任务创建失败",
        description: getErrorMessage(error, "链接暂时无法加入下载队列。"),
        color: "danger",
      });
    } finally {
      setIsCreatingDownload(false);
    }
  }

  async function createPhoneSession() {
    setIsCreatingPhoneSession(true);
    setPhoneSessionError("");
    try {
      const session = await videoWorkshopApi.createPhoneUploadSession();
      setPhoneSession(session);
      announcedPhoneSessionRef.current = "";
    } catch (error) {
      setPhoneSession(null);
      setPhoneSessionError(
        getErrorMessage(error, "手机上传链接暂时无法生成。"),
      );
    } finally {
      setIsCreatingPhoneSession(false);
    }
  }

  function openPhoneModal() {
    setActiveModal("phone");
    if (
      !phoneSession ||
      ["succeeded", "failed", "cancelled", "expired"].includes(
        phoneSession.status,
      )
    ) {
      void createPhoneSession();
    }
  }

  async function cancelPhoneSession() {
    if (!phoneSession) return;
    try {
      setPhoneSession(
        await videoWorkshopApi.cancelPhoneUploadSession(phoneSession.id),
      );
    } catch (error) {
      setPhoneSessionError(
        getErrorMessage(error, "手机上传会话暂时无法取消。"),
      );
    }
  }

  function refreshQueue() {
    void restoreLatestClip(true);
  }

  return (
    <main
      data-testid="video-workshop-page"
      className="min-h-[calc(100vh-64px)] bg-[var(--kaypal-v3-canvas)] text-default-900"
    >
      <input
        ref={materialFileInputRef}
        type="file"
        accept="video/*,image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={importSelectedMaterial}
      />
      <header className="border-b border-divider bg-background px-4 py-3 md:px-5">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-tiny leading-5 text-default-500">
              Kaypal / Video Workshop
            </p>
            <h1 className="text-[22px] font-bold leading-8 text-[var(--kaypal-v3-ink)]">
              视频工坊
            </h1>
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 xl:justify-start xl:pb-0">
            <div
              aria-label="视频工坊工作区"
              className="inline-grid max-w-full grid-flow-col gap-1 overflow-x-auto rounded-lg border-small border-divider bg-default-50 p-1"
            >
              {workspaceActions.map(
                ({ key, label, icon: Icon, href, current }) => {
                  const className = `inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-small font-medium transition ${
                    current
                      ? "bg-background text-primary shadow-sm ring-1 ring-primary/10"
                      : "text-default-600 hover:bg-background"
                  }`;

                  if (href) {
                    return (
                      <Link
                        key={key}
                        href={href}
                        aria-current={current ? "page" : undefined}
                        onClick={(event) => {
                          if (!hasUnsavedChanges) return;
                          event.preventDefault();
                          setPendingNavigation(href);
                        }}
                        className={className}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {label}
                      </Link>
                    );
                  }

                  return (
                    <button
                      key={key}
                      type="button"
                      aria-current={current ? "page" : undefined}
                      onClick={() => {
                        if (key === "asset") openMaterialPicker();
                        if (key === "batch") openMaterialPicker();
                        if (key === "task") setActivePreviewTab("log");
                        if (key === "product") openProductModal();
                        if (key === "download") void openDownloadModal();
                        if (key === "phone") openPhoneModal();
                      }}
                      className={className}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {label}
                    </button>
                  );
                },
              )}
            </div>
            <Button
              isIconOnly
              aria-label="刷新任务"
              variant="flat"
              isLoading={isRefreshingQueue}
              onPress={refreshQueue}
            >
              <RefreshCw size={16} />
            </Button>
            <Button
              variant="flat"
              startContent={<FolderOpen size={16} />}
              isLoading={isUploadingMaterial}
              onPress={openMaterialPicker}
              className="min-w-[96px] shrink-0"
            >
              选择素材
            </Button>
            <Button
              color="primary"
              startContent={<Sparkles size={16} />}
              isDisabled={!clipReadiness.ready}
              isLoading={isSubmitting}
              onPress={() => void runClip()}
              className="min-w-[96px] shrink-0"
            >
              创建视频
            </Button>
          </div>
        </div>
      </header>
      <section
        aria-label="视频工坊主体"
        className="grid min-w-0 gap-4 p-3 md:p-4 xl:grid-cols-[minmax(248px,300px)_minmax(420px,1fr)_minmax(340px,420px)]"
      >
        <Panel
          title="任务进度"
          subtitle={`${queueStats.total} 个任务 · ${queueStats.running} 个执行中 · ${queueStats.failed} 个失败`}
          action={
            <Chip size="sm" variant="flat">
              {queueStats.done} 完成
            </Chip>
          }
        >
          <div className="grid gap-2 border-b border-divider p-3">
            <label className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-default-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="搜索任务、模板、素材"
                data-testid="video-workshop-search"
                value={query}
                onInput={(event) =>
                  updateSearchQuery(event.currentTarget.value)
                }
                onChange={(event) => updateSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") clearSearchQuery();
                }}
                placeholder="搜索任务、模板、素材"
                className="min-h-9 w-full rounded-lg border border-divider bg-default-50 pl-9 pr-10 text-small text-default-900 outline-none transition placeholder:text-default-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  data-testid="video-workshop-search-clear"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearSearchQuery}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-default-500 transition hover:bg-default-100 hover:text-default-900"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {taskFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setActiveFilter(filter.key)}
                  className={`min-h-8 rounded-md border text-tiny font-semibold ${activeFilter === filter.key ? "border-primary/20 bg-primary/10 text-primary" : "border-divider bg-background text-default-600"}`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid max-h-[560px] gap-2 overflow-y-auto p-3">
            {filteredRuns.length ? (
              filteredRuns.map((run) => (
                <article
                  key={run.id}
                  role="group"
                  aria-label={`任务 ${commercialDisplayText(run.title)}`}
                  tabIndex={0}
                  onClick={() => setSelectedRunId(run.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      setSelectedRunId(run.id);
                  }}
                  className={`grid cursor-pointer gap-2 rounded-lg border bg-background p-3 transition hover:border-primary/40 ${selectedRun?.id === run.id ? "border-primary/30 shadow-[inset_3px_0_0_hsl(var(--heroui-primary))]" : "border-divider"}`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="line-clamp-2 break-all text-[13px] font-bold leading-5 text-default-900">
                        {commercialDisplayText(run.title)}
                      </h3>
                      <p className="mt-0.5 truncate text-[11px] leading-4 text-default-500">
                        {commercialDisplayText(run.meta)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] leading-4 text-default-600">
                        生成 {run.createdAt}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {run.id === latestRunId ? (
                        <Chip
                          size="sm"
                          color="primary"
                          variant="flat"
                          className="h-[22px] px-2 text-[11px]"
                        >
                          最新
                        </Chip>
                      ) : null}
                      <StatusBadge status={run.status} />
                    </div>
                  </div>
                  {run.progress > 0 ? (
                    <div
                      className="h-2 overflow-hidden rounded-full border border-divider bg-default-50"
                      aria-label={`任务进度 ${run.progress}%`}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${run.progress}%` }}
                      />
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 text-[11px] leading-4 text-default-500">
                    <span className="truncate">{commercialDisplayText(run.stage)}</span>
                    <span>
                      {run.progress > 0 ? `${run.progress}%` : "待执行"}
                    </span>
                  </div>
                  {run.backendTaskId ? (
                    <div className="flex items-center gap-2">
                      {(run.status === "queued" || run.status === "running") ? (
                        <Button
                          size="sm"
                          variant="flat"
                          color="danger"
                          onPress={() => void cancelRun(run)}
                          startContent={<CircleStop size={14} />}
                        >
                          取消
                        </Button>
                      ) : null}
                      {(run.status === "failed" || run.status === "cancelled") &&
                      (run.attempts || 0) < (run.maxAttempts || 3) ? (
                        <Button
                          size="sm"
                          variant="flat"
                          onPress={() => void retryRun(run)}
                          startContent={<RefreshCw size={14} />}
                        >
                          重试
                        </Button>
                      ) : null}
                    </div>
                  ) : run.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => void retryRun(run)}
                      startContent={<RefreshCw size={14} />}
                    >
                      重试
                    </Button>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-divider bg-default-50 p-4 text-center">
                <div className="grid justify-items-center gap-2">
                  <ListChecks size={32} className="text-default-400" />
                  <p className="text-small font-semibold text-default-900">
                    {isRefreshingQueue ? "正在读取最近成片" : "暂无任务"}
                  </p>
                  <p className="text-tiny leading-5 text-default-500">
                    {isRefreshingQueue
                      ? "正在读取任务和成片记录。"
                      : "剪辑或下载后，这里会记录任务状态，刷新后仍可恢复。"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Panel>
        <Panel
          title="创建视频"
          subtitle="素材、模板、参数和成片输出都在这里完成"
          action={
            <Chip
              size="sm"
              color={isSubmitting ? "primary" : "default"}
              variant="flat"
            >
              {isSubmitting ? "生成中" : "草稿"}
            </Chip>
          }
          className="xl:min-h-[680px]"
        >
          <div className="grid gap-4 p-4">
            <div className="grid gap-2">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <Input
                  label="选择本机素材"
                  placeholder="选择本机视频文件或素材文件夹"
                  value={materialPath}
                  onValueChange={setMaterialPath}
                  variant="bordered"
                  radius="sm"
                  isInvalid={!materialPath.trim()}
                  errorMessage={
                    !materialPath.trim()
                      ? "开始前需要选择本机素材。"
                      : undefined
                  }
                  startContent={
                    <FolderInput size={16} className="text-default-400" />
                  }
                />
                <Button
                  variant="flat"
                  startContent={<FolderOpen size={16} />}
                  isLoading={isUploadingMaterial}
                  onPress={openMaterialPicker}
                >
                  选择本机素材
                </Button>
              </div>
              <p className="text-tiny leading-5 text-default-500">
                可一次选择最多 50 个视频或图片；导入后从下方选一项作为本次剪辑素材。
              </p>
              <div className="grid gap-2 rounded-lg border border-divider bg-default-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-tiny font-semibold text-default-700">
                    已导入素材
                  </span>
                  <Button
                    size="sm"
                    variant="light"
                    isLoading={isLoadingMaterials}
                    onPress={() => void loadMaterials()}
                    startContent={<RefreshCw size={13} />}
                  >
                    刷新
                  </Button>
                </div>
                {materials.length ? (
                  <div className="flex max-h-[88px] flex-wrap gap-2 overflow-y-auto pr-1">
                    {materials.map((material) => (
                      <button
                        key={material.path}
                        type="button"
                        onClick={() => setMaterialPath(material.path)}
                        className={`max-w-full rounded-md border px-2 py-1 text-left text-[11px] transition ${materialPath === material.path ? "border-primary/40 bg-primary/10 text-primary" : "border-divider bg-background text-default-600 hover:border-primary/30"}`}
                      >
                        <span className="block truncate">
                          {material.kind === "video" ? "视频" : "图片"} · {material.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-tiny text-default-500">
                    还没有导入素材。
                  </p>
                )}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,230px)]">
              <Textarea
                label="创作目标"
                placeholder="例如：突出新品卖点、门店优惠、客户案例、口播风格、标题标签要求"
                value={titlePrompt}
                onValueChange={setTitlePrompt}
                variant="bordered"
                radius="sm"
                isInvalid={!titlePrompt.trim()}
                errorMessage={
                  !titlePrompt.trim()
                    ? "写清目标后，脚本和剪辑过程会更容易追踪。"
                    : undefined
                }
                minRows={6}
              />
              <div className="grid content-start gap-3">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-tiny font-semibold leading-5 text-default-600">
                      产品信息
                    </span>
                    <button
                      type="button"
                      onClick={openProductModal}
                      className="text-tiny font-semibold text-primary hover:underline"
                    >
                      管理
                    </button>
                  </div>
                  <select
                    value={productId}
                    onChange={(event) => selectProduct(event.target.value)}
                    className="min-h-10 w-full rounded-lg border border-divider bg-background px-3 text-small text-default-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  >
                    <option value="">不关联产品信息</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <span className="text-tiny font-semibold leading-5 text-default-600">
                模板
              </span>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                {templatePresets.map((template) => (
                  <button
                    key={template.templateName}
                    type="button"
                    onClick={() => {
                      setTemplateName(template.templateName);
                      setAspectRatio(template.draft.aspectRatio);
                      setDurationPreset(template.draft.durationPreset);
                      setMusicPreset(template.draft.musicPreset);
                      setTitleStyle(template.draft.titleStyle);
                      setSubtitleStyle(template.draft.subtitleStyle);
                      setFontPreset(template.draft.fontPreset);
                      setFilterPreset(template.draft.filterPreset);
                      setTransitionPreset(template.draft.transitionPreset);
                      if (!titlePrompt.trim()) setTitlePrompt(template.prompt);
                    }}
                    className={`min-w-0 overflow-hidden rounded-lg border bg-background text-left transition hover:-translate-y-0.5 hover:shadow-sm ${templateName === template.templateName ? "border-primary/40 shadow-[inset_0_0_0_2px_rgba(37,99,235,0.08)]" : "border-divider"}`}
                  >
                    <span className="grid h-[190px] min-w-0 place-items-center overflow-hidden border-b border-divider bg-default-50 px-2 py-3">
                      <span
                        className={`grid max-w-full place-items-center rounded-md border border-divider font-mono text-tiny font-bold shadow-sm ring-1 ring-inset ${template.previewClass} ${template.tone}`}
                      >
                        {template.ratio}
                      </span>
                    </span>
                    <span className="block p-2">
                      <span className="block text-small font-bold leading-5 text-default-900">
                        {template.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-default-500">
                        {template.note}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                id="video-workshop-ratio"
                label="比例"
                value={aspectRatio}
                onChange={setAspectRatio}
                options={["9:16 竖版", "16:9 横版", "1:1 方形"]}
              />
              <SelectField
                id="video-workshop-duration"
                label="时长"
                value={durationPreset}
                onChange={setDurationPreset}
                options={["10 秒", "30 秒", "45 秒", "60 秒"]}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <SelectField
                id="video-workshop-music"
                label="背景音乐"
                value={musicPreset}
                onChange={setMusicPreset}
                options={["轻快节奏", "温和叙述", "氛围留白", "不使用音乐"]}
              />
              <SelectField
                id="video-workshop-title-style"
                label="标题样式"
                value={titleStyle}
                onChange={setTitleStyle}
                options={["标题：简洁加粗", "标题：高亮重点", "标题：知识卡片", "不加标题"]}
              />
              <SelectField
                id="video-workshop-subtitle-style"
                label="字幕样式"
                value={subtitleStyle}
                onChange={setSubtitleStyle}
                options={["字幕：白字黑边", "字幕：重点高亮", "字幕：简洁留白", "不加字幕"]}
              />
              <SelectField
                id="video-workshop-font"
                label="文字字体"
                value={fontPreset}
                onChange={setFontPreset}
                options={["系统黑体", "圆体", "宋体"]}
              />
              <SelectField
                id="video-workshop-filter"
                label="滤镜"
                value={filterPreset}
                onChange={setFilterPreset}
                options={["自然清晰", "暖调生活", "冷调质感", "不使用滤镜"]}
              />
              <SelectField
                id="video-workshop-transition"
                label="转场"
                value={transitionPreset}
                onChange={setTransitionPreset}
                options={["自然切换", "节奏快切", "淡入淡出", "不使用转场"]}
              />
            </div>
            <p className="text-tiny leading-5 text-default-500">
              音乐、标题、字幕、字体、滤镜和转场会应用到本次成片。
            </p>
            <div className="grid gap-3">
              <Input
                label="输出名称"
                value={outputName}
                onValueChange={setOutputName}
                variant="bordered"
                radius="sm"
                startContent={
                  <FileVideo size={16} className="text-default-400" />
                }
              />
            </div>
          </div>
          <div className="grid gap-3 border-t border-divider bg-default-50 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="grid min-w-0 gap-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                <span className="text-small font-semibold leading-6 text-default-900">
                  视频剪辑任务
                </span>
                <span className="text-tiny leading-5 text-default-500">
                  {templateName} · 生成后自动进入任务进度
                </span>
              </div>
              <div
                className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-tiny font-medium ${clipReadiness.ready ? "border-success-200 bg-success-50 text-success-700" : "border-warning-200 bg-warning-50 text-warning-700"}`}
              >
                {clipReadiness.ready ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}
                {clipReadiness.label}
              </div>
            </div>
            <Button
              color="primary"
              isDisabled={!clipReadiness.ready}
              isLoading={isSubmitting}
              onPress={() => void runClip()}
              startContent={<Scissors size={16} />}
            >
              开始剪辑
            </Button>
          </div>
        </Panel>
        <Panel
          title="预览与交付"
          subtitle={
            selectedRun
              ? `当前任务：${selectedRun.title} · 生成 ${selectedRun.createdAt}`
              : "当前任务：等待创建"
          }
          action={
            selectedRun ? (
              <StatusBadge status={selectedRun.status} />
            ) : (
              <Chip size="sm" variant="flat">
                待生成
              </Chip>
            )
          }
          className="xl:min-h-[680px]"
        >
          <div className="m-3 grid aspect-[9/16] max-h-[380px] overflow-hidden rounded-[8px] border border-divider bg-default-50 text-[var(--kaypal-v3-ink)]">
            <div className="relative grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] p-3">
              {previewVideoUrl ? (
                <video
                  key={previewVideoUrl}
                  controls
                  preload="none"
                  src={previewVideoUrl}
                  className="absolute inset-0 h-full w-full bg-black object-contain"
                  aria-label="成片视频预览"
                />
              ) : null}
              {!previewVideoUrl ? (
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <span className="rounded-md border border-divider bg-background px-2 py-1 font-mono text-[10px] font-semibold">
                    {selectedRun?.aspectRatio || aspectRatio}
                  </span>
                  <span className="rounded-md border border-divider bg-background px-2 py-1 text-[10px] font-semibold">
                    {selectedRun?.durationPreset || durationPreset}
                  </span>
                </div>
              ) : null}
              {!previewVideoUrl ? (
                <div className="grid place-items-center px-4 text-center">
                  <div className="grid justify-items-center gap-2">
                    <button
                      type="button"
                      aria-label="播放预览"
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-accent-ink)] transition hover:bg-[var(--kaypal-v3-accent-soft)]"
                      onClick={() => {
                        if (outputPath) {
                          addToast({
                            title: "成片已生成",
                            description:
                              "成片已保存在本机，可复制后去发布中心读取。",
                            color: "default",
                          });
                        }
                      }}
                    >
                      <Play
                        className="h-5 w-5 fill-current"
                        aria-hidden="true"
                      />
                    </button>
                    <span className="text-small font-medium">
                      {isLoadingPreviewVideo
                        ? "正在加载视频预览"
                        : outputPath
                          ? "成片已生成"
                          : isSubmitting
                            ? "正在合成成片"
                            : "等待生成预览"}
                    </span>
                    {previewVideoError ? (
                      <span className="max-w-[280px] break-all text-[11px] text-danger">
                        {commercialDisplayText(previewVideoError)}
                      </span>
                    ) : null}
                    {outputPath ? (
                      <span className="max-w-[280px] break-all text-[11px] text-[var(--kaypal-v3-muted)]">
                        {displayFileNameFromPath(outputPath, selectedRun?.outputName)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {!previewVideoUrl ? (
                <div className="relative rounded-md border border-divider bg-background px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] leading-4">
                    <span className="truncate text-default-500">模板</span>
                    <span className="truncate font-semibold text-default-800">
                      {selectedRun?.templateName || templateName}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] leading-4">
                    <span className="truncate text-default-500">状态</span>
                    <span className="truncate font-semibold text-default-800">
                      {selectedRun ? selectedRun.stage : "待提交"}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div
            role="tablist"
            aria-label="预览详情"
            className="grid grid-cols-3 gap-2 px-3 pb-3"
          >
            {[
              { key: "storyboard" as const, label: "分镜" },
              { key: "script" as const, label: "脚本" },
              { key: "log" as const, label: "记录" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activePreviewTab === tab.key ? "true" : "false"}
                onClick={() => setActivePreviewTab(tab.key)}
                className={`min-h-8 rounded-md border text-tiny font-semibold ${activePreviewTab === tab.key ? "border-primary/20 bg-primary/10 text-primary" : "border-divider bg-background text-default-600"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="border-t border-divider p-3">
            <div className="min-h-[124px] rounded-lg border border-divider bg-default-50 p-3 text-small leading-6 text-default-700">
              {activePreviewTab === "storyboard" ? (
                <div className="grid gap-2">
                  <p>
                    <strong className="text-default-900">开场：</strong>
                    {selectedRun?.templateName || templateName}，前 4
                    秒显示标题。
                  </p>
                  <p>
                    <strong className="text-default-900">中段：</strong>
                    使用{selectedRun?.filterPreset || filterPreset}画面和
                    {selectedRun?.musicPreset || musicPreset}，保持素材内容完整。
                  </p>
                  <p>
                    <strong className="text-default-900">结尾：</strong>
                    使用{selectedRun?.transitionPreset || transitionPreset}，输出
                    {selectedRun?.aspectRatio || aspectRatio} 成片。
                  </p>
                </div>
              ) : null}
              {activePreviewTab === "script" ? (
                <div className="grid gap-2">
                  <p>
                    {selectedRun?.titlePrompt ||
                      titlePrompt ||
                      "填写创作目标后，这里展示本次剪辑的脚本方向。"}
                  </p>
                  <p className="text-tiny text-default-500">
                    {selectedRun
                      ? selectedRun.meta
                      : `${templateName} · ${aspectRatio} · ${durationPreset}`}
                  </p>
                </div>
              ) : null}
              {activePreviewTab === "log" ? (
                <div className="grid gap-2">
                  <p>
                    <Clock3 size={14} className="mr-1 inline" />
                    {selectedRun
                      ? `生成 ${selectedRun.createdAt} · ${commercialDisplayText(selectedRun.stage)}`
                      : "等待提交剪辑任务"}
                  </p>
                  <p className="break-all">
                    {commercialDisplayText(selectedRun?.message ||
                      (isSubmitting
                        ? "正在等待视频处理结果"
                        : "暂无任务记录"))}
                  </p>
                  {selectedRun?.outputPath ? (
                    <p className="break-all">
                      输出：
                      {displayFileNameFromPath(
                        selectedRun.outputPath,
                        selectedRun.outputName,
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid gap-2 border-t border-divider p-3">
            <div className="grid min-h-[54px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-divider px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-small font-bold leading-5 text-default-900">
                  成片视频
                </p>
                {outputPath ? (
                  <input
                    data-video-workshop-output-path
                    readOnly
                    value={displayFileNameFromPath(
                      outputPath,
                      selectedRun?.outputName,
                    )}
                    aria-label="成片路径"
                    className="mt-1 w-full truncate rounded-md border border-divider bg-default-50 px-2 py-1 font-mono text-[11px] leading-4 text-default-600 outline-none focus:border-primary"
                  />
                ) : (
                  <p className="mt-0.5 truncate text-[11px] leading-4 text-default-500">
                    等待生成
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="flat"
                isDisabled={!outputPath}
                onPress={() => void copyOutputPath(outputPath)}
                startContent={<Copy size={14} />}
              >
                复制
              </Button>
            </div>
            <div className="grid min-h-[54px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-divider px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-small font-bold leading-5 text-default-900">
                  处理结果
                </p>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-default-500">
                  {selectedRun?.result?.reasonCode
                    ? taskResultLabel(selectedRun.result.reasonCode)
                    : selectedRun?.stage || "等待处理结果"}
                </p>
              </div>
              <Button
                size="sm"
                variant="flat"
                onPress={() => setActivePreviewTab("log")}
                startContent={<Download size={14} />}
              >
                查看
              </Button>
            </div>
            <div className="grid min-h-[54px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-divider px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-small font-bold leading-5 text-default-900">
                  发布中心
                </p>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-default-500">
                  带着成片路径去选账号发布
                </p>
              </div>
              <Button
                size="sm"
                color="primary"
                variant="flat"
                isDisabled={!outputPath}
                onPress={() => requestNavigation("/distribution?tab=video")}
                startContent={<Upload size={14} />}
              >
                去发布中心
              </Button>
            </div>
          </div>
          {selectedRun?.status === "failed" ? (
            <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
              <AlertCircle size={17} className="mt-0.5 flex-none" />
              <span>
                {selectedRun.message || "任务失败，可从任务进度里重试。"}
              </span>
            </div>
          ) : selectedRun?.status === "done" ? (
            <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 p-3 text-small text-success-700">
              <CheckCircle2 size={17} className="mt-0.5 flex-none" />
              <span>
                {selectedRun.taskKind === "download"
                  ? "素材已下载并加入本机素材库。"
                  : "成片已生成，文件和证据已保留在本页。"}
              </span>
            </div>
          ) : null}
        </Panel>
      </section>
      <Modal
        isOpen={activeModal === "product"}
        onClose={() => setActiveModal(null)}
        size="lg"
      >
        <ModalContent>
          <ModalHeader>产品信息</ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label="产品名称"
              placeholder="例如：夏季轻薄防晒衣"
              value={productFormName}
              onValueChange={setProductFormName}
            />
            <Textarea
              label="核心卖点"
              placeholder="每行一个卖点，例如：UPF50+\n冰感面料\n通勤百搭"
              value={productFormHighlights}
              onValueChange={setProductFormHighlights}
              minRows={4}
            />
            <Textarea
              label="产品介绍"
              placeholder="补充适用人群、使用场景或活动信息"
              value={productFormDescription}
              onValueChange={setProductFormDescription}
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setActiveModal(null)}>
              取消
            </Button>
            <Button color="primary" isLoading={isSavingProduct} onPress={() => void saveProduct()}>
              保存并使用
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={activeModal === "download"}
        onClose={() => setActiveModal(null)}
        size="md"
      >
        <ModalContent>
          <ModalHeader>下载任务</ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label="HTTPS 视频直链"
              placeholder="https://允许的域名/path/video.mp4"
              value={downloadUrl}
              onValueChange={setDownloadUrl}
              startContent={<Link2 size={16} className="text-default-400" />}
            />
            <Input
              label="素材名称（可选）"
              placeholder="例如：门店实拍.mp4"
              value={downloadOutputName}
              onValueChange={setDownloadOutputName}
              startContent={<FileVideo size={16} className="text-default-400" />}
            />
            <div className="grid gap-1 rounded-lg border border-divider bg-default-50 p-3 text-tiny leading-5 text-default-600">
              <span>仅允许 HTTPS、域名白名单和公网解析地址；每次重定向都会重新校验。</span>
              <span>
                大小上限 {formatBytes(downloadPolicy?.maxBytes)} · 最多 {downloadPolicy?.maxRedirects ?? 3} 次重定向
              </span>
              {downloadPolicy?.allowedHosts.length ? (
                <span className="break-all font-mono text-[11px]">
                  {downloadPolicy.allowedHosts.join("、")}
                </span>
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setActiveModal(null)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={isCreatingDownload}
              isDisabled={!downloadUrl.trim()}
              onPress={() => void createDownloadTask()}
              startContent={<Download size={16} />}
            >
              创建下载任务
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={activeModal === "phone"}
        onClose={() => setActiveModal(null)}
        size="md"
      >
        <ModalContent>
          <ModalHeader>手机上传</ModalHeader>
          <ModalBody className="gap-4">
            {isCreatingPhoneSession ? (
              <div className="grid min-h-[280px] place-items-center text-center text-small text-default-600">
                <div className="grid justify-items-center gap-3">
                  <QrCode size={36} className="text-default-400" />
                  <span>正在启动本机上传地址</span>
                </div>
              </div>
            ) : phoneSession ? (
              <div className="grid gap-4">
                {phoneSession.qrDataUrl ? (
                  <Image
                    src={phoneSession.qrDataUrl}
                    alt="手机上传二维码"
                    width={220}
                    height={220}
                    unoptimized
                    className="mx-auto aspect-square w-[220px] border border-divider bg-white p-2"
                  />
                ) : null}
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3 text-small">
                    <span className="font-semibold text-default-900">
                      {phoneSession.status === "pending"
                        ? "等待手机选择文件"
                        : phoneSession.status === "uploading"
                          ? "手机正在上传"
                          : phoneSession.status === "succeeded"
                            ? "上传完成"
                            : phoneSession.status === "expired"
                              ? "链接已过期"
                              : phoneSession.status === "cancelled"
                                ? "上传已取消"
                                : "上传失败"}
                    </span>
                    <span className="font-mono text-tiny text-default-500">
                      {phoneSession.progress}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full border border-divider bg-default-50">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${phoneSession.progress}%` }}
                    />
                  </div>
                  <p className="text-tiny leading-5 text-default-600">
                    {phoneSession.networkHint} 已接收 {formatBytes(phoneSession.bytesReceived)} / 上限 {formatBytes(phoneSession.maxBytes)}
                  </p>
                  {phoneSession.reachableFromPhone === false ? (
                    <p className="text-tiny leading-5 text-warning-700">
                      当前电脑没有可用的局域网地址，请连接局域网后重新生成链接。
                    </p>
                  ) : null}
                  {phoneSession.error || phoneSessionError ? (
                    <p className="text-tiny leading-5 text-danger">
                      {phoneSession.error || phoneSessionError}
                    </p>
                  ) : null}
                </div>
                {phoneSession.uploadUrl ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <input
                      readOnly
                      value={phoneSession.uploadUrl}
                      aria-label="手机上传链接"
                      className="min-w-0 truncate rounded-lg border border-divider bg-default-50 px-3 font-mono text-[11px] text-default-600"
                    />
                    <Button
                      isIconOnly
                      variant="flat"
                      aria-label="复制手机上传链接"
                      onPress={() => void copyPhoneUploadUrl()}
                    >
                      <Copy size={16} />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid min-h-[180px] place-items-center text-center">
                <div className="grid justify-items-center gap-3">
                  <AlertCircle size={32} className="text-danger" />
                  <p className="text-small text-danger">
                    {phoneSessionError || "手机上传链接未生成。"}
                  </p>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setActiveModal(null)}>
              关闭
            </Button>
            {phoneSession && ["pending", "uploading"].includes(phoneSession.status) ? (
              <Button
                color="danger"
                variant="flat"
                onPress={() => void cancelPhoneSession()}
                startContent={<CircleStop size={16} />}
              >
                取消上传链接
              </Button>
            ) : (
              <Button
                color="primary"
                isLoading={isCreatingPhoneSession}
                onPress={() => void createPhoneSession()}
                startContent={<QrCode size={16} />}
              >
                生成新链接
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={Boolean(pendingNavigation)}
        onClose={() => setPendingNavigation("")}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>离开当前页面？</ModalHeader>
          <ModalBody>
            <p className="text-small leading-6 text-default-700">
              当前剪辑设置还没有保存，离开后本次修改不会保留。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setPendingNavigation("")}>继续编辑</Button>
            <Button
              color="danger"
              onPress={() => {
                const href = pendingNavigation;
                setPendingNavigation("");
                setSavedDraftSignature(draftSignature(currentDraft));
                router.push(href);
              }}
            >
              离开不保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </main>
  );
}
