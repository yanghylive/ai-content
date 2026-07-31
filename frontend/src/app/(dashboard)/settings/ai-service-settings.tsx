"use client";

import React from "react";
import {
  Button,
  Chip,
  Select,
  SelectItem,
  Spinner,
  addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import {
  settingsApi,
  type AIModel,
  type DefaultModels,
  type KaypalModelSyncStatus,
} from "@/lib/api/settings";

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
  {
    key: "articleCreation",
    label: "文章创作",
    description: "生成文章、改写和润色时使用",
  },
  {
    key: "topicSelection",
    label: "选题推荐",
    description: "分析素材并生成选题时使用",
  },
  {
    key: "imageCreation",
    label: "图片创作",
    description: "生成配图时使用",
  },
  {
    key: "xCollection",
    label: "采集分析",
    description: "整理采集内容时使用",
  },
];

function isAuthorizationIssue(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || "");
  return /未登录|unauthorized|授权|过期|失效|401/i.test(message);
}

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
      setSyncError(
        isAuthorizationIssue(error)
          ? "账号授权已失效，请重新登录后再同步。"
          : toPublicError(error, "AI 服务状态暂时无法读取，请重新加载。"),
      );
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
      const description = isAuthorizationIssue(error)
        ? "账号授权已失效，请重新登录后再同步。"
        : toPublicError(error, "AI 服务未同步，请重试。");
      setSyncError(description);
      addToast({
        title: "AI 服务同步失败",
        description,
        color: "danger",
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
      <div className="flex items-center justify-center gap-2 py-12">
        <Spinner size="sm" />
        <span className="text-small text-default-500">正在读取 AI 服务...</span>
      </div>
    );
  }

  const authorizationFailed = isAuthorizationIssue(syncError);

  return (
    <div className="grid gap-5">
      <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-medium font-bold text-default-900">
                账号 AI 服务
              </h3>
              <Chip
                color={
                  syncStatus?.configured
                    ? "success"
                    : syncError
                      ? "danger"
                      : "warning"
                }
                size="sm"
                variant="flat"
              >
                {statusLoading
                  ? "检查中"
                  : syncStatus?.configured
                    ? "已同步"
                    : syncError
                      ? "需处理"
                      : "待同步"}
              </Chip>
            </div>
            <p className="mt-1 text-small text-default-600">
              {syncError || getStatusMessage(syncStatus)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {(authorizationFailed || !syncStatus) && syncError ? (
              <Button
                as="a"
                href="/login?reauth=1&next=%2Fsettings%3Ftab%3Dai"
                startContent={<Icon icon="solar:user-check-linear" />}
                variant="flat"
              >
                重新登录
              </Button>
            ) : null}
            <Button
              color="primary"
              isDisabled={statusLoading}
              isLoading={syncing}
              startContent={
                syncing ? null : <Icon icon="solar:refresh-linear" />
              }
              variant="flat"
              onPress={handleSync}
            >
              从账号同步
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-bold text-default-900">
              默认 AI 服务
            </h3>
            <p className="mt-1 text-small text-default-500">
              为不同工作选择默认服务。
            </p>
          </div>
          <Chip color={models.length ? "success" : "warning"} variant="flat">
            可用服务 {models.length}
          </Chip>
        </div>

        {loadError ? (
          <div className="flex flex-col gap-3 rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{loadError}</span>
            <Button
              className="shrink-0"
              color="danger"
              size="sm"
              variant="flat"
              onPress={() => void loadConfiguration()}
            >
              重新加载
            </Button>
          </div>
        ) : null}

        {models.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {defaultServiceFields.map((field) => (
              <Select
                key={field.key}
                description={field.description}
                label={field.label}
                labelPlacement="outside"
                placeholder="选择 AI 服务"
                selectedKeys={defaults[field.key] ? [defaults[field.key]] : []}
                onSelectionChange={(keys) => {
                  const value = String(Array.from(keys)[0] || "");
                  setDefaults((current) => ({
                    ...current,
                    [field.key]: value,
                  }));
                }}
              >
                {models.map((model) => (
                  <SelectItem key={model.id} textValue={model.name}>
                    {model.name}
                  </SelectItem>
                ))}
              </Select>
            ))}
          </div>
        ) : (
          <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-4">
            <p className="text-small font-semibold text-warning-800">
              暂无可用 AI 服务
            </p>
            <p className="mt-1 text-small text-warning-700">
              请先重新登录账号并点击“从账号同步”。
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-divider pt-4">
          <Button
            isDisabled={!defaults.articleCreation}
            isLoading={testing}
            startContent={testing ? null : <Icon icon="solar:bolt-linear" />}
            variant="flat"
            onPress={handleTest}
          >
            检查连接
          </Button>
          <Button
            color="primary"
            isDisabled={!models.length}
            isLoading={saving}
            onPress={handleSave}
          >
            保存设置
          </Button>
        </div>
      </section>
    </div>
  );
}
