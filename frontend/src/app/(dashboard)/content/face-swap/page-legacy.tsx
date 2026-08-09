"use client";

import {
  type ChangeEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Chip, Input, Switch, Textarea, addToast } from "@heroui/react";
import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Download,
  FileAudio,
  FileImage,
  FileVideo,
  Loader2,
  Play,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Upload,
  WandSparkles,
} from "lucide-react";
import {
  videoFaceSwapApi,
  type VideoFaceSwapCapability,
  type VideoFaceSwapBillingStatus,
  type VideoFaceSwapEstimate,
  type VideoFaceSwapHealth,
  type VideoFaceSwapJobSummary,
  type VideoFaceSwapMaterialFile,
  type VideoFaceSwapMode,
  type VideoFaceSwapRunResult,
} from "@/lib/api/video-face-swap";
import { toPublicError } from "@/lib/public-error";

type Draft = {
  mode: VideoFaceSwapMode;
  targetPath: string;
  sourcePath: string;
  audioPath: string;
  outputName: string;
  durationSeconds: number;
  usagePurpose: string;
  authorizationConfirmed: boolean;
  lawfulUseConfirmed: boolean;
  commercialLicenseConfirmed: boolean;
};

type MaterialSlot = "target" | "source" | "audio";

const fallbackCapabilities: VideoFaceSwapCapability[] = [
  {
    mode: "face_swap",
    title: "授权换脸",
    description: "把授权人脸替换到指定视频中",
    requiredMaterials: ["视频素材", "授权人脸图片"],
    cost: { basePoints: 30, includedSeconds: 60, extraPointsPer30Seconds: 10 },
  },
  {
    mode: "deep_swap",
    title: "深度替换",
    description: "换脸后自动做人像修复",
    requiredMaterials: ["视频素材", "授权人脸图片"],
    cost: { basePoints: 50, includedSeconds: 60, extraPointsPer30Seconds: 15 },
  },
  {
    mode: "lip_sync",
    title: "口型同步",
    description: "按音频自动生成口型同步结果",
    requiredMaterials: ["视频素材", "音频文件"],
    cost: { basePoints: 25, includedSeconds: 60, extraPointsPer30Seconds: 8 },
  },
  {
    mode: "face_enhance",
    title: "人像修复",
    description: "修复人像清晰度和面部细节",
    requiredMaterials: ["视频素材"],
    cost: { basePoints: 18, includedSeconds: 60, extraPointsPer30Seconds: 6 },
  },
  {
    mode: "frame_enhance",
    title: "画质增强",
    description: "提升视频画面清晰度",
    requiredMaterials: ["视频素材"],
    cost: { basePoints: 22, includedSeconds: 60, extraPointsPer30Seconds: 8 },
  },
  {
    mode: "background_remove",
    title: "背景处理",
    description: "处理视频人物背景",
    requiredMaterials: ["视频素材"],
    cost: { basePoints: 20, includedSeconds: 60, extraPointsPer30Seconds: 7 },
  },
  {
    mode: "frame_colorize",
    title: "视频上色",
    description: "为黑白或低色彩视频补色",
    requiredMaterials: ["视频素材"],
    cost: { basePoints: 18, includedSeconds: 60, extraPointsPer30Seconds: 6 },
  },
  {
    mode: "expression_restore",
    title: "表情修复",
    description: "修复表情自然度",
    requiredMaterials: ["视频素材"],
    cost: { basePoints: 15, includedSeconds: 60, extraPointsPer30Seconds: 5 },
  },
  {
    mode: "face_edit",
    title: "面部微调",
    description: "做轻量面部表情微调",
    requiredMaterials: ["视频素材"],
    cost: { basePoints: 15, includedSeconds: 60, extraPointsPer30Seconds: 5 },
  },
  {
    mode: "age_modify",
    title: "年龄效果",
    description: "生成年龄变化效果",
    requiredMaterials: ["视频素材"],
    cost: { basePoints: 15, includedSeconds: 60, extraPointsPer30Seconds: 5 },
  },
];

const initialDraft: Draft = {
  mode: "face_swap",
  targetPath: "",
  sourcePath: "",
  audioPath: "",
  outputName: "",
  durationSeconds: 60,
  usagePurpose: "",
  authorizationConfirmed: false,
  lawfulUseConfirmed: false,
  commercialLicenseConfirmed: false,
};

function getErrorMessage(error: unknown, fallback: string) {
  return toPublicError(error, fallback);
}

function fileNameFromPath(value?: string | null) {
  const text = String(value || "").replace(/\\/g, "/");
  return text.split("/").filter(Boolean).pop() || "未选择";
}

function formatDate(value: string | number | Date | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date
    .toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/\//g, "-");
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function resultOutputPath(result: VideoFaceSwapRunResult | null) {
  return (
    result?.evidence.find((item) => item.label === "video-face-swap-output")
      ?.path ||
    result?.evidence.find((item) => item.label === "video-face-swap-output")
      ?.url ||
    ""
  );
}

function isFaceMode(mode: VideoFaceSwapMode) {
  return mode === "face_swap" || mode === "deep_swap";
}

function isLipSyncMode(mode: VideoFaceSwapMode) {
  return mode === "lip_sync";
}

export default function VideoFaceSwapPage() {
  const [capabilities, setCapabilities] =
    useState<VideoFaceSwapCapability[]>(fallbackCapabilities);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [materials, setMaterials] = useState<VideoFaceSwapMaterialFile[]>([]);
  const [jobs, setJobs] = useState<VideoFaceSwapJobSummary[]>([]);
  const [estimate, setEstimate] = useState<VideoFaceSwapEstimate | null>(null);
  const [health, setHealth] = useState<VideoFaceSwapHealth | null>(null);
  const [billingStatus, setBillingStatus] =
    useState<VideoFaceSwapBillingStatus | null>(null);
  const [result, setResult] = useState<VideoFaceSwapRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<MaterialSlot | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const activeCapability = useMemo(
    () =>
      capabilities.find((item) => item.mode === draft.mode) ||
      fallbackCapabilities[0],
    [capabilities, draft.mode],
  );
  const outputPath = resultOutputPath(result);
  const canRun =
    Boolean(draft.targetPath) &&
    (!isFaceMode(draft.mode) || Boolean(draft.sourcePath)) &&
    (!isLipSyncMode(draft.mode) || Boolean(draft.audioPath)) &&
    Boolean(draft.usagePurpose.trim()) &&
    draft.authorizationConfirmed &&
    draft.lawfulUseConfirmed &&
    draft.commercialLicenseConfirmed &&
    Boolean(health?.ok) &&
    Boolean(billingStatus?.ok) &&
    Boolean(estimate?.estimatedCostPoints) &&
    !running;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [
          nextCapabilities,
          nextMaterials,
          nextJobs,
          nextBillingStatus,
          nextHealth,
        ] = await Promise.all([
          videoFaceSwapApi.capabilities().catch(() => fallbackCapabilities),
          videoFaceSwapApi.materialFiles().catch(() => []),
          videoFaceSwapApi.jobs().catch(() => []),
          videoFaceSwapApi.billingStatus().catch(() => null),
          videoFaceSwapApi.health().catch(() => null),
        ]);
        if (cancelled) return;
        setCapabilities(
          nextCapabilities.length ? nextCapabilities : fallbackCapabilities,
        );
        setMaterials(nextMaterials);
        setJobs(nextJobs);
        setBillingStatus(nextBillingStatus);
        setHealth(nextHealth);
      } catch (error) {
        if (!cancelled) {
          addToast({
            title: "加载失败",
            description: getErrorMessage(
              error,
              "换脸服务暂时无法加载，请稍后重试。",
            ),
            color: "danger",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshEstimate() {
      setEstimating(true);
      try {
        const nextEstimate = await videoFaceSwapApi.estimate({
          mode: draft.mode,
          durationSeconds: draft.durationSeconds,
        });
        if (!cancelled) setEstimate(nextEstimate);
      } catch {
        if (!cancelled) {
          const rule = activeCapability.cost;
          const extraBlocks = Math.ceil(
            Math.max(0, draft.durationSeconds - rule.includedSeconds) / 30,
          );
          setEstimate({
            mode: draft.mode,
            durationSeconds: draft.durationSeconds,
            estimatedCostPoints:
              rule.basePoints + extraBlocks * rule.extraPointsPer30Seconds,
            policyVersion: "local-preview",
            items: [
              {
                label: activeCapability.title,
                amount:
                  rule.basePoints + extraBlocks * rule.extraPointsPer30Seconds,
                rule: `前 60 秒 ${rule.basePoints} 点`,
              },
            ],
          });
        }
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }
    refreshEstimate();
    return () => {
      cancelled = true;
    };
  }, [activeCapability, draft.durationSeconds, draft.mode]);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const refreshLists = async () => {
    const [nextJobs, nextMaterials, nextBillingStatus, nextHealth] =
      await Promise.all([
        videoFaceSwapApi.jobs().catch(() => jobs),
        videoFaceSwapApi.materialFiles().catch(() => materials),
        videoFaceSwapApi.billingStatus().catch(() => billingStatus),
        videoFaceSwapApi.health().catch(() => health),
      ]);
    setJobs(nextJobs);
    setMaterials(nextMaterials);
    setBillingStatus(nextBillingStatus);
    setHealth(nextHealth);
  };

  const uploadMaterial = async (
    event: ChangeEvent<HTMLInputElement>,
    slot: MaterialSlot,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingSlot(slot);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const material = await videoFaceSwapApi.uploadMaterialFile(formData);
      setMaterials((current) => [material, ...current]);
      if (slot === "target") setField("targetPath", material.path);
      if (slot === "source") setField("sourcePath", material.path);
      if (slot === "audio") setField("audioPath", material.path);
      addToast({
        title: "素材已上传",
        description: material.name,
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "上传失败",
        description: getErrorMessage(
          error,
          "素材未能上传，请稍后重试。",
        ),
        color: "danger",
      });
    } finally {
      setUploadingSlot(null);
      event.target.value = "";
    }
  };

  const startJob = async () => {
    if (!estimate) return;
    if (!billingStatus?.ok) {
      addToast({
        title: "账号点数未就绪",
        description:
          billingStatus?.message || "请先到账号与设备完成授权后再生成。",
        color: "warning",
      });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const nextResult = await videoFaceSwapApi.createJob({
        mode: draft.mode,
        targetPath: draft.targetPath,
        sourcePath: draft.sourcePath || undefined,
        audioPath: draft.audioPath || undefined,
        outputName: draft.outputName || undefined,
        durationSeconds: estimate.durationSeconds,
        usagePurpose: draft.usagePurpose,
        authorizationConfirmed: draft.authorizationConfirmed,
        lawfulUseConfirmed: draft.lawfulUseConfirmed,
        commercialLicenseConfirmed: draft.commercialLicenseConfirmed,
        acceptedCostPoints: estimate.estimatedCostPoints,
      });
      setResult(nextResult);
      await refreshLists();
      const billingBlocked =
        !nextResult.ok && nextResult.billing?.status === "failed";
      addToast({
        title: nextResult.ok
          ? "生成完成"
          : billingBlocked
            ? "账号点数未就绪"
            : "生成未完成",
        description: billingBlocked
          ? "本次没有消耗点数，也没有开始生成。请先完成账号与设备授权。"
          : nextResult.message,
        color: nextResult.ok ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: "生成失败",
        description: getErrorMessage(
          error,
          "视频未能生成，请稍后重试。",
        ),
        color: "danger",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--kaypal-v3-canvas)] p-4 text-[var(--kaypal-v3-ink)] lg:p-6">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4">
        <section className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]">
              <ScanFace className="size-5" />
            </div>
            <div>
              <h1>视频换脸</h1>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                上传授权素材，确认点数，生成可交付视频。
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]">
                <Clock3 className="size-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">生成前准备</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--kaypal-v3-muted)]">
                  普通电脑也可以生成短视频，但速度会比较慢，1
                  分钟视频可能需要较长等待。频繁商用或高清视频建议使用高性能显卡。
                </p>
              </div>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2 lg:min-w-[640px]">
              <div className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
                <div className="font-semibold">基础准备</div>
                <p className="mt-1 text-xs leading-5 text-[var(--kaypal-v3-muted)]">
                  适合低频试做和短视频预览，建议预留足够内存与磁盘空间。
                </p>
              </div>
              <div className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
                <div className="font-semibold">建议配置</div>
                <p className="mt-1 text-xs leading-5 text-[var(--kaypal-v3-muted)]">
                  高频商用、长视频和高清交付建议使用独立显卡，并预留更充足的存储空间。
                </p>
              </div>
            </div>
          </div>
        </section>

        {billingStatus && !billingStatus.ok ? (
          <section className="rounded-lg border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-4 text-[var(--kaypal-v3-soft-ink)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-amber)]">
                  <CircleDollarSign className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                    账号点数还未准备好
                  </div>
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                    {billingStatus.message}
                  </p>
                </div>
              </div>
              <Button
                color="primary"
                radius="sm"
                onPress={() => {
                  window.location.href =
                    billingStatus.actionHref || "/capabilities/account";
                }}
              >
                {billingStatus.actionLabel || "去账号与设备"}
              </Button>
            </div>
          </section>
        ) : null}

        {health && !health.ok ? (
          <section className="rounded-lg border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-4 text-[var(--kaypal-v3-soft-ink)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  <Clock3 className="size-4 text-[var(--kaypal-v3-amber)]" />
                  生成准备未完成
                </div>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  请先完成生成组件准备，系统会在生成前继续拦截，避免无效消耗点数。
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[420px]">
                {health.checks.map((check) => (
                  <div
                    key={check.key}
                    className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{check.label}</span>
                      <Chip
                        color={check.ok ? "success" : "warning"}
                        size="sm"
                        variant="flat"
                      >
                        {check.ok ? "通过" : "待处理"}
                      </Chip>
                    </div>
                    <div className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                      {check.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]">
            <div className="mb-3 flex items-center justify-between">
              <h2>选择效果</h2>
              {loading ? (
                <Loader2 className="size-4 animate-spin text-[var(--kaypal-v3-muted)]" />
              ) : null}
            </div>
            <div className="space-y-2">
              {capabilities.map((item) => {
                const selected = item.mode === draft.mode;
                return (
                  <button
                    key={item.mode}
                    className={[
                      "w-full rounded-lg border p-3 text-left transition",
                      selected
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]",
                    ].join(" ")}
                    type="button"
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        mode: item.mode,
                        sourcePath: isFaceMode(item.mode)
                          ? current.sourcePath
                          : "",
                        audioPath: isLipSyncMode(item.mode)
                          ? current.audioPath
                          : "",
                      }));
                      setResult(null);
                    }}
                  >
                    <div className="text-sm font-semibold">{item.title}</div>
                    <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                      {item.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2>生成设置</h2>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {activeCapability.requiredMaterials.join(" + ")}
                </p>
              </div>
              <Chip
                color={estimate ? "primary" : "default"}
                size="sm"
                variant="flat"
              >
                {estimating
                  ? "计算中"
                  : estimate
                    ? `预计 ${estimate.estimatedCostPoints} 点`
                    : "待计算"}
              </Chip>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <MaterialPicker
                icon={<FileVideo className="size-4" />}
                label="视频素材"
                value={draft.targetPath}
                accept="video/*"
                isLoading={uploadingSlot === "target"}
                inputRef={targetInputRef}
                onUpload={(event) => uploadMaterial(event, "target")}
                onChoose={() => targetInputRef.current?.click()}
              />
              {isFaceMode(draft.mode) ? (
                <MaterialPicker
                  icon={<FileImage className="size-4" />}
                  label="授权人脸图片"
                  value={draft.sourcePath}
                  accept="image/*"
                  isLoading={uploadingSlot === "source"}
                  inputRef={sourceInputRef}
                  onUpload={(event) => uploadMaterial(event, "source")}
                  onChoose={() => sourceInputRef.current?.click()}
                />
              ) : null}
              {isLipSyncMode(draft.mode) ? (
                <MaterialPicker
                  icon={<FileAudio className="size-4" />}
                  label="音频文件"
                  value={draft.audioPath}
                  accept="audio/*"
                  isLoading={uploadingSlot === "audio"}
                  inputRef={audioInputRef}
                  onUpload={(event) => uploadMaterial(event, "audio")}
                  onChoose={() => audioInputRef.current?.click()}
                />
              ) : null}
              <Input
                label="输出名称"
                placeholder="例如：门店宣传片-换脸版"
                radius="sm"
                value={draft.outputName}
                onValueChange={(value) => setField("outputName", value)}
              />
              <Input
                label="视频时长（秒）"
                min={1}
                max={1800}
                radius="sm"
                type="number"
                value={String(draft.durationSeconds)}
                onValueChange={(value) =>
                  setField(
                    "durationSeconds",
                    Math.min(
                      1800,
                      Math.max(1, Number.parseInt(value || "60", 10)),
                    ),
                  )
                }
              />
            </div>

            <Textarea
              className="mt-3"
              label="本次用途"
              minRows={3}
              placeholder="例如：本品牌授权数字人视频、内部培训素材、已签约代言人宣传片"
              radius="sm"
              value={draft.usagePurpose}
              onValueChange={(value) => setField("usagePurpose", value)}
            />

            <div className="mt-4 rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-[var(--kaypal-v3-success)]" />
                生成确认
              </div>
              <div className="grid gap-2">
                <ConfirmSwitch
                  isSelected={draft.authorizationConfirmed}
                  label="我已获得视频人物、授权人脸和素材版权许可"
                  onChange={(value) =>
                    setField("authorizationConfirmed", value)
                  }
                />
                <ConfirmSwitch
                  isSelected={draft.lawfulUseConfirmed}
                  label="本次用途不涉及冒充、欺诈、色情、未成年人或政治误导"
                  onChange={(value) => setField("lawfulUseConfirmed", value)}
                />
                <ConfirmSwitch
                  isSelected={draft.commercialLicenseConfirmed}
                  label="我接受商业发布前需要完成授权和风险复核"
                  onChange={(value) =>
                    setField("commercialLicenseConfirmed", value)
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--kaypal-v3-border)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-lg bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]">
                  <CircleDollarSign className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">
                    {estimate
                      ? `本次预计扣 ${estimate.estimatedCostPoints} 点`
                      : "等待点数计算"}
                  </div>
                  <div className="text-xs text-[var(--kaypal-v3-muted)]">
                    {billingStatus && !billingStatus.ok
                      ? billingStatus.message
                      : estimate?.items[0]?.rule || "60 秒内按基础点数计算"}
                  </div>
                </div>
              </div>
              {billingStatus && !billingStatus.ok ? (
                <Button
                  color="primary"
                  radius="sm"
                  onPress={() => {
                    window.location.href =
                      billingStatus.actionHref || "/capabilities/account";
                  }}
                >
                  {billingStatus.actionLabel || "去账号与设备"}
                </Button>
              ) : (
                <Button
                  color="primary"
                  isDisabled={!canRun}
                  isLoading={running}
                  radius="sm"
                  startContent={
                    running ? undefined : <Play className="size-4" />
                  }
                  onPress={startJob}
                >
                  {health && !health.ok
                    ? "环境未就绪"
                    : billingStatus
                      ? "确认扣点并生成"
                      : "检查扣点状态"}
                </Button>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]">
            <div className="mb-3 flex items-center justify-between">
              <h2>结果预览</h2>
              <Button
                isIconOnly
                radius="sm"
                size="sm"
                variant="light"
                onPress={() => refreshLists()}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-[var(--kaypal-v3-border)] bg-black">
              {outputPath ? (
                <video
                  className="h-full w-full object-contain"
                  controls
                  src={videoFaceSwapApi.previewUrl(outputPath)}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center text-sm text-white/70">
                  <WandSparkles className="size-8" />
                  <span>生成完成后在这里预览</span>
                </div>
              )}
            </div>

            {result ? (
              <div className="mt-3 rounded-lg border border-[var(--kaypal-v3-border)] p-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {result.ok ? (
                    <CheckCircle2 className="size-4 text-[var(--kaypal-v3-success)]" />
                  ) : (
                    <Clock3 className="size-4 text-[var(--kaypal-v3-amber)]" />
                  )}
                  {result.message}
                </div>
                <div className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
                  {result.billing?.status === "charged"
                    ? `已扣 ${result.billing.amount} 点`
                    : result.billing?.status === "failed"
                      ? "本次没有扣点，也没有开始生成。请先完成账号与设备授权。"
                      : result.billing?.message || "未完成扣点结算"}
                </div>
                {!result.ok && result.billing?.status === "failed" ? (
                  <Button
                    className="mt-3"
                    color="primary"
                    radius="sm"
                    size="sm"
                    onPress={() => {
                      window.location.href = "/capabilities/account";
                    }}
                  >
                    去账号与设备
                  </Button>
                ) : null}
                {outputPath ? (
                  <a
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--kaypal-v3-border)] px-3 py-2 text-sm font-semibold text-[var(--kaypal-v3-accent-ink)]"
                    href={videoFaceSwapApi.previewUrl(outputPath)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Download className="size-4" />
                    打开成片
                  </a>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold">最近成片</div>
              <div className="space-y-2">
                {jobs.length ? (
                  jobs.slice(0, 5).map((job) => (
                    <button
                      key={job.id}
                      className="w-full rounded-lg border border-[var(--kaypal-v3-border)] p-3 text-left hover:border-[var(--kaypal-v3-border-strong)]"
                      type="button"
                      onClick={() =>
                        setResult({
                          ok: true,
                          status: "success",
                          reasonCode: "success",
                          message: job.message,
                          estimate: estimate || {
                            mode: job.mode,
                            durationSeconds: 60,
                            estimatedCostPoints: 0,
                            policyVersion: "history",
                            items: [],
                          },
                          evidence: [
                            {
                              type: "text",
                              label: "video-face-swap-output",
                              path: job.outputPath,
                              createdAt: job.createdAt,
                            },
                          ],
                        })
                      }
                    >
                      <div className="text-sm font-semibold">
                        {job.outputName}
                      </div>
                      <div className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                        {formatDate(job.createdAt)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--kaypal-v3-border)] p-4 text-center text-sm text-[var(--kaypal-v3-muted)]">
                    暂无成片
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]">
          <div className="mb-3 flex items-center justify-between">
            <h2>素材</h2>
            <Chip size="sm" variant="flat">
              {materials.length} 个
            </Chip>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {materials.slice(0, 8).map((item) => (
              <button
                key={item.id}
                className="rounded-lg border border-[var(--kaypal-v3-border)] p-3 text-left hover:border-[var(--kaypal-v3-border-strong)]"
                type="button"
                onClick={() => {
                  if (item.kind === "video") setField("targetPath", item.path);
                  if (item.kind === "image") setField("sourcePath", item.path);
                  if (item.kind === "audio") setField("audioPath", item.path);
                }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {item.kind === "video" ? (
                    <FileVideo className="size-4" />
                  ) : null}
                  {item.kind === "image" ? (
                    <FileImage className="size-4" />
                  ) : null}
                  {item.kind === "audio" ? (
                    <FileAudio className="size-4" />
                  ) : null}
                  <span className="truncate">{item.name}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                  {formatSize(item.sizeBytes)} · {formatDate(item.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function MaterialPicker({
  icon,
  label,
  value,
  accept,
  inputRef,
  isLoading,
  onChoose,
  onUpload,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accept: string;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  isLoading: boolean;
  onChoose: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--kaypal-v3-border)] p-3">
      <input
        ref={inputRef}
        accept={accept}
        className="hidden"
        type="file"
        onChange={onUpload}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-soft-ink)]">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{label}</div>
            <div className="truncate text-xs text-[var(--kaypal-v3-muted)]">
              {fileNameFromPath(value)}
            </div>
          </div>
        </div>
        <Button
          isLoading={isLoading}
          radius="sm"
          size="sm"
          startContent={isLoading ? undefined : <Upload className="size-4" />}
          variant="flat"
          onPress={onChoose}
        >
          上传
        </Button>
      </div>
    </div>
  );
}

function ConfirmSwitch({
  label,
  isSelected,
  onChange,
}: {
  label: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch
      classNames={{
        base: "max-w-full items-start gap-2",
        label: "text-sm leading-5 text-[var(--kaypal-v3-soft-ink)]",
      }}
      isSelected={isSelected}
      size="sm"
      onValueChange={onChange}
    >
      {label}
    </Switch>
  );
}
