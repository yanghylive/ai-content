"use client";

import React from "react";
import { addToast } from "@heroui/react";
import {
  RefreshCcw,
  Save,
  Sparkles,
  UserRoundPlus,
} from "@/components/iconpark";
import {
  V2EmptyState,
  V2Field,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2Select,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import {
  settingsApi,
  type AIModel,
  type DefaultModels,
  type KaypalModelSyncStatus,
} from "@/lib/api/settings";
import { SkeletonList } from "@/components/skeleton";
import {
  isModelListUnavailable,
  isSessionAuthIssue,
  describeSyncError,
} from "@/lib/kaypal-sync-error";

const emptyDefaults: DefaultModels = {
  articleCreation: "",
  imageCreation: "",
  xCollection: "",
  topicSelection: "",
};

const defaultServiceFields: Array<{
  key: keyof DefaultModels;
  label: string;
  description: string;
}> = [
  { key: "articleCreation", label: "文章创作", description: "生成文章、改写和润色时使用" },
  { key: "topicSelection", label: "选题推荐", description: "分析素材并生成选题时使用" },
  { key: "imageCreation", label: "图片创作", description: "生成配图时使用" },
  { key: "xCollection", label: "采集分析", description: "整理采集内容时使用" },
];

type ModelCapability = "text" | "image" | "vision";

/** 与后端 model-capability.util 对齐的轻量归类：视觉/文生图/其它(文本) */
function modelCapability(model: { modelId?: string | null; name?: string | null }): ModelCapability {
  const s = `${model.modelId ?? ""} ${model.name ?? ""}`.toLowerCase();
  if (/(qwen-vl|vision|图像理解|vl-max|视觉)/i.test(s)) return "vision";
  if (/(image|img|图片|绘画|画图|flux|dall|stable[\s_-]?diffusion|文生图|t2i)/i.test(s)) return "image";
  return "text";
}

function modelOptionLabel(model: AIModel, cap: ModelCapability) {
  const tag = cap === "vision" ? "视觉" : cap === "image" ? "图片" : "文本";
  const base = model.name || model.modelId;
  return `${base}（${tag}）`;
}

/** 各用途应使用的模型能力 */
const PURPOSE_CAPABILITY: Record<keyof DefaultModels, ModelCapability> = {
  articleCreation: "text",
  topicSelection: "text",
  xCollection: "text",
  imageCreation: "image",
};

function getStatusMessage(status: KaypalModelSyncStatus | null) {
  if (!status) return "正在读取账号中的 AI 服务状态。";
  if (status.configured) return "默认 AI 服务已经同步，可以直接用于内容生产。";
  if (status.source === "kaypal" && status.defaultModel) {
    return "账号中已有可用 AI 服务，点击同步即可用于当前工作台。";
  }
  return toPublicError(status.message, "暂未找到可用的默认 AI 服务。");
}

export function AiServiceSettings({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [models, setModels] = React.useState<AIModel[]>([]);
  const [defaults, setDefaults] = React.useState<DefaultModels>(emptyDefaults);
  const [savedDefaults, setSavedDefaults] =
    React.useState<DefaultModels>(emptyDefaults);
  const [syncStatus, setSyncStatus] =
    React.useState<KaypalModelSyncStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [syncError, setSyncError] = React.useState("");

  /** 模型按能力索引（展示/过滤用，不重复遍历） */
  const byCapability = React.useMemo(() => {
    const groups: Record<ModelCapability, AIModel[]> = {
      text: [],
      image: [],
      vision: [],
    };
    for (const m of models) groups[modelCapability(m)].push(m);
    return groups;
  }, [models]);
  const textModels = byCapability.text;
  const imageModels = byCapability.image;
  const visionModels = byCapability.vision;
  const defaultsAreDirty =
    !loading && JSON.stringify(defaults) !== JSON.stringify(savedDefaults);

  useUnsavedChangesWarning(defaultsAreDirty);

  React.useEffect(() => {
    onDirtyChange?.(defaultsAreDirty);
    return () => onDirtyChange?.(false);
  }, [defaultsAreDirty, onDirtyChange]);

  const loadConfiguration = React.useCallback(async () => {
    setLoading(true);
    try {
      const [modelList, defaultConfig] = await Promise.all([
        settingsApi.listModels(),
        settingsApi.getDefaults(),
      ]);
      setModels(modelList.filter((model) => model.enabled));
      setDefaults(defaultConfig);
      setSavedDefaults(defaultConfig);
      setLoadError("");
    } catch (error) {
      setLoadError(
        toPublicError(error, "AI 服务配置暂时无法读取，请重新加载。"),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSyncStatus = React.useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await settingsApi.getKaypalModelStatus();
      setSyncStatus(status);
      setSyncError("");
    } catch (error) {
      setSyncStatus(null);
      setSyncError(describeSyncError(error));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadConfiguration();
    void loadSyncStatus();
  }, [loadConfiguration, loadSyncStatus]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await settingsApi.syncKaypalModel();
      setSyncStatus(result);
      setSyncError("");
      addToast({
        title: "AI 服务同步完成",
        description: "文章创作和选题推荐已使用账号中的默认服务。",
        color: "success",
      });
      await loadConfiguration();
    } catch (error) {
      const description = describeSyncError(error);
      setSyncError(description);
      addToast({
        title: "AI 服务同步失败",
        description,
        color: isModelListUnavailable(error) ? "warning" : "danger",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    if (!defaults.articleCreation || !defaults.topicSelection) {
      addToast({
        title: "请先选择文字服务",
        description: "文章创作和选题推荐都需要可用的 AI 服务。",
        color: "warning",
      });
      return;
    }
    setSaving(true);
    try {
      const saved = await settingsApi.updateDefaults(defaults);
      setDefaults(saved);
      setSavedDefaults(saved);
      addToast({
        title: "默认服务已保存",
        description: "新的内容任务会使用本次设置。",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "保存失败",
        description: toPublicError(error, "AI 服务设置未保存，请重试。"),
        color: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const selected = models.find(
      (model) => model.id === defaults.articleCreation,
    );
    if (!selected) {
      addToast({
        title: "请先选择文章创作服务",
        color: "warning",
      });
      return;
    }
    setTesting(true);
    try {
      const result = await settingsApi.testModel({
        platformId: selected.platformId,
        modelId: selected.modelId,
      });
      addToast({
        title: result.success ? "AI 服务连接正常" : "AI 服务连接失败",
        description: result.success
          ? commercialDisplayText(result.reply, "AI 服务已成功响应。")
          : toPublicError(
              result.message,
              "AI 服务连接检查未通过，请检查当前设置。",
            ),
        color: result.success ? "success" : "danger",
      });
    } catch (error) {
      addToast({
        title: "AI 服务连接失败",
        description: toPublicError(error, "AI 服务连接检查未完成，请重试。"),
        color: "danger",
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-14">
        <SkeletonList rows={4} />
        <span className="text-sm text-[var(--kaypal-v3-muted)]">
          正在读取 AI 服务…
        </span>
      </div>
    );
  }

  const sessionAuthFailed = isSessionAuthIssue(syncError);
  const listUnavailable = isModelListUnavailable(syncError);
  const statusLabel = statusLoading
    ? "检查中"
    : syncStatus?.configured
      ? "已同步"
      : sessionAuthFailed
        ? "登录失效"
        : listUnavailable
          ? "列表受限"
          : syncError
            ? "需处理"
            : "待同步";
  const statusTone: "success" | "danger" | "warning" | "muted" = statusLoading
    ? "muted"
    : syncStatus?.configured
      ? "success"
      : sessionAuthFailed
        ? "danger"
        : "warning";
  const statusText = syncError || getStatusMessage(syncStatus);

  return (
    <div className="grid gap-5">
      {/* 账号 AI 服务：从 Kaypal 同步的默认模型状态 */}
      <V2Section
        title="账号 AI 服务"
        description="默认服务来自你的 Kaypal 账号，可在下方手动同步"
        action={<V2StatusChip tone={statusTone}>{statusLabel}</V2StatusChip>}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p
              className={`text-sm ${
                sessionAuthFailed
                  ? "font-medium text-[var(--kaypal-v3-danger)]"
                  : listUnavailable
                    ? "text-[var(--kaypal-v3-amber)]"
                    : "text-[var(--kaypal-v3-soft-ink)]"
              }`}
            >
              {statusText}
            </p>
            {listUnavailable && syncStatus?.configured ? (
              <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                当前默认 AI 服务（{syncStatus.defaultModel || "已同步"}）仍可用，
                无需处理即可继续生产。
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {sessionAuthFailed ? (
              <V2PrimaryButton
                icon={UserRoundPlus}
                onClick={() => {
                  window.location.assign(
                    "/login?reauth=1&next=%2Fsettings%2Fai-service",
                  );
                }}
              >
                重新登录
              </V2PrimaryButton>
            ) : null}
            {!sessionAuthFailed && !statusLoading ? (
              <V2GhostButton
                icon={RefreshCcw}
                loading={syncing}
                disabled={syncing}
                onClick={handleSync}
              >
                {syncing
                  ? "同步中…"
                  : syncStatus?.configured
                    ? "重新同步"
                    : "从账号同步"}
              </V2GhostButton>
            ) : null}
          </div>
        </div>
      </V2Section>

      {/* 默认 AI 服务：按用途选择文本/图片模型 */}
      <V2Section
        title="默认 AI 服务"
        description="为不同工作选择默认服务"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <V2StatusChip tone="accent">
              文本服务 {textModels.length}
            </V2StatusChip>
            {(imageModels.length > 0 || visionModels.length > 0) && (
              <V2StatusChip tone="muted">
                图片/视觉 {imageModels.length + visionModels.length}
              </V2StatusChip>
            )}
          </div>
        }
      >
        {loadError ? (
          <div className="mb-5 flex flex-col gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)] sm:flex-row sm:items-center sm:justify-between">
            <span>{loadError}</span>
            <V2GhostButton
              icon={RefreshCcw}
              onClick={() => void loadConfiguration()}
            >
              重新加载
            </V2GhostButton>
          </div>
        ) : null}

        {models.length ? (
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            {defaultServiceFields.map((field) => {
              const need = PURPOSE_CAPABILITY[field.key];
              const options =
                need === "text"
                  ? textModels
                  : need === "image"
                    ? imageModels
                    : visionModels;
              const noOptions = options.length === 0;
              const value = defaults[field.key] || "";
              const hint = noOptions
                ? `${
                    need === "image"
                      ? "当前暂无可用图片生成模型（视觉模型用于图像理解，不能直接生图）"
                      : `当前暂无可用${need === "vision" ? "视觉模型" : "文本模型"}`
                  }`
                : field.description;
              return (
                <V2Field key={field.key} label={field.label} hint={hint}>
                  <V2Select
                    aria-label={field.label}
                    value={value}
                    disabled={noOptions}
                    onChange={(e) => {
                      setDefaults((current) => ({
                        ...current,
                        [field.key]: e.target.value,
                      }));
                    }}
                  >
                    <option value="">
                      {noOptions ? "暂无可用的服务" : "选择 AI 服务"}
                    </option>
                    {options.map((m) => (
                      <option key={m.id} value={m.id}>
                        {modelOptionLabel(m, modelCapability(m))}
                      </option>
                    ))}
                  </V2Select>
                </V2Field>
              );
            })}
          </div>
        ) : (
          <V2EmptyState
            icon={Sparkles}
            title="暂无可用 AI 服务"
            description="请先重新登录账号，并从账号同步可用的默认模型。"
            action={
              <V2PrimaryButton
                icon={RefreshCcw}
                loading={syncing}
                disabled={syncing}
                onClick={handleSync}
              >
                {syncing ? "同步中…" : "从账号同步"}
              </V2PrimaryButton>
            }
          />
        )}

        {models.length ? (
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--kaypal-v3-border)] pt-5">
            <V2GhostButton
              icon={RefreshCcw}
              disabled={!defaults.articleCreation}
              loading={testing}
              onClick={handleTest}
            >
              {testing ? "检查中…" : "检查连接"}
            </V2GhostButton>
            <V2PrimaryButton
              icon={Save}
              disabled={!models.length}
              loading={saving}
              onClick={handleSave}
            >
              {saving ? "保存中…" : "保存设置"}
            </V2PrimaryButton>
          </div>
        ) : null}
      </V2Section>
    </div>
  );
}
