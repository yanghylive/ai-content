"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Divider,
  Input,
  Select,
  SelectItem,
  Spinner,
  Switch,
  Tab,
  Tabs,
  Textarea,
  addToast,
} from "@heroui/react";
import { BrainCircuit, Cloud, Database, MonitorCog } from "lucide-react";
import { Icon, loadIcons } from "@/components/lucide-icon-compat";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";
import {
  buildSettingsRiskConfirmation,
  type Source,
  type StorageConfig,
  sourcesApi,
  storageApi,
} from "@/lib/api/settings";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { FailureActionPanel } from "../components/failure-action-panel";
import { FunctionalEmptyState } from "../components/functional-empty-state";
import {
  DashboardPageHeader,
  DashboardPageShell,
} from "../components/dashboard-page";
import { AiServiceSettings } from "./ai-service-settings";
import { DesktopSettings } from "./desktop-settings";

const emptyStorageConfig: StorageConfig = {
  provider: "local",
  accessKey: "",
  secretKey: "",
  bucket: "",
  domain: "",
  endpoint: "",
  region: "",
};

type SourceFormState = {
  id?: string;
  name: string;
  type: string;
  url: string;
  enabled: boolean;
  configJson: string;
};

const emptySourceForm: SourceFormState = {
  name: "",
  type: "crawler",
  url: "",
  enabled: true,
  configJson: '{\n  "platform": ""\n}',
};

const sourceTypeOptions = [
  { key: "crawler", label: "网页采集" },
  { key: "rss", label: "RSS 订阅" },
  { key: "api", label: "数据服务" },
];

const sourceTypeLabelMap = Object.fromEntries(
  sourceTypeOptions.map((option) => [option.key, option.label]),
) as Record<string, string>;

const settingsTabKeys = ["desktop", "ai", "sources", "storage"] as const;

function settingsTabFromLocation() {
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  return settingsTabKeys.includes(
    requestedTab as (typeof settingsTabKeys)[number],
  )
    ? String(requestedTab)
    : "desktop";
}

function writeSettingsTabToUrl(tab: string, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (tab === "desktop") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history[`${mode}State`](null, "", `${url.pathname}${url.search}${url.hash}`);
}

type DirtyStateProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

function sourceDisplayText(value: unknown, fallback = "-") {
  return commercialDisplayText(value, fallback) || fallback;
}

function sourceUrlDisplayText(value: string | null | undefined) {
  if (!value) return "-";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
    return "数据来源已配置";
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, "");
    if (/api/i.test(hostname)) return "采集地址已配置";
    return hostname || "采集地址已配置";
  } catch {
    return sourceDisplayText(value, "采集地址已配置");
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return toPublicError(error, fallback);
}

function toSourceForm(source: Source): SourceFormState {
  return {
    id: source.id,
    name: source.name,
    type: source.type || "crawler",
    url: source.url,
    enabled: source.enabled,
    configJson: JSON.stringify(source.config || {}, null, 2),
  };
}

function parseSourceConfig(configJson: string) {
  const text = configJson.trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("高级设置格式不正确，请检查后重试。");
  }
  return parsed as Record<string, unknown>;
}

export default function SettingsPage() {
  const [selectedTab, setSelectedTab] = useState("desktop");
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadIcons([
      "solar:global-bold",
      "solar:cloud-storage-bold",
      "solar:add-circle-bold",
      "solar:programming-bold",
      "solar:folder-with-files-linear",
      "solar:server-bold-duotone",
    ]);

  }, []);

  useEffect(() => {
    const syncTabFromUrl = () => {
      const requestedTab = settingsTabFromLocation();
      setSelectedTab((currentTab) => {
        if (requestedTab === currentTab) return currentTab;
        if (
          dirtyTabs[currentTab] &&
          !window.confirm("当前设置还有未保存的修改，确定要切换吗？")
        ) {
          writeSettingsTabToUrl(currentTab, "replace");
          return currentTab;
        }
        return requestedTab;
      });
    };

    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, [dirtyTabs]);

  const handleTabChange = (key: React.Key) => {
    const nextTab = String(key);
    if (nextTab === selectedTab) return;
    if (
      dirtyTabs[selectedTab] &&
      !window.confirm("当前设置还有未保存的修改，确定要切换吗？")
    ) {
      return;
    }
    setSelectedTab(nextTab);
    writeSettingsTabToUrl(nextTab, "push");
  };

  const markTabDirty = useCallback((tab: string, dirty: boolean) => {
    setDirtyTabs((current) =>
      current[tab] === dirty ? current : { ...current, [tab]: dirty },
    );
  }, []);
  const markAiDirty = useCallback(
    (dirty: boolean) => markTabDirty("ai", dirty),
    [markTabDirty],
  );
  const markSourcesDirty = useCallback(
    (dirty: boolean) => markTabDirty("sources", dirty),
    [markTabDirty],
  );
  const markStorageDirty = useCallback(
    (dirty: boolean) => markTabDirty("storage", dirty),
    [markTabDirty],
  );

  return (
    <DashboardPageShell className="settings-workspace" width="wide">
      <DashboardPageHeader
        description="管理这台电脑、AI 服务、内容来源和文件保存方式。"
        icon={<MonitorCog aria-hidden="true" size={19} />}
        title="系统设置"
      />
      <Card className="min-w-0 border-small border-divider bg-background shadow-sm dark:bg-default-100">
        <Tabs
          classNames={{
            base: "min-w-0 max-w-full",
            tabList:
              "settings-workspace__tabs mx-4 mt-4 w-auto max-w-[calc(100%_-_2rem)] justify-start overflow-x-auto bg-default-100 text-medium",
            tabContent: "text-small",
            panel: "min-w-0 p-5",
          }}
          size="md"
          selectedKey={selectedTab}
          onSelectionChange={handleTabChange}
        >
          <Tab
            key="desktop"
            title={
              <div className="flex items-center gap-2">
                <MonitorCog aria-hidden="true" size={18} />
                <span>桌面设置</span>
              </div>
            }
          >
            <DesktopSettings />
          </Tab>
          <Tab
            key="ai"
            title={
              <div className="flex items-center gap-2">
                <BrainCircuit aria-hidden="true" size={18} />
                <span>AI 服务</span>
              </div>
            }
          >
            <AiServiceSettings onDirtyChange={markAiDirty} />
          </Tab>
          <Tab
            key="sources"
            title={
              <div className="flex items-center gap-2">
                <Database aria-hidden="true" size={18} />
                <span>内容来源</span>
              </div>
            }
          >
            <SourceSettings onDirtyChange={markSourcesDirty} />
          </Tab>
          <Tab
            key="storage"
            title={
              <div className="flex items-center gap-2">
                <Cloud aria-hidden="true" size={18} />
                <span>文件存储</span>
              </div>
            }
          >
            <StorageSettings onDirtyChange={markStorageDirty} />
          </Tab>
        </Tabs>
      </Card>
    </DashboardPageShell>
  );
}

function SourceSettings({ onDirtyChange }: DirtyStateProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<SourceFormState | null>(null);
  const [formBaseline, setFormBaseline] = useState<SourceFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [sourceToDelete, setSourceToDelete] = useState<Source | null>(null);
  const [loadError, setLoadError] = useState("");
  const formIsDirty = Boolean(
    form && formBaseline && JSON.stringify(form) !== JSON.stringify(formBaseline),
  );

  useUnsavedChangesWarning(formIsDirty);

  useEffect(() => {
    onDirtyChange?.(formIsDirty);
    return () => onDirtyChange?.(false);
  }, [formIsDirty, onDirtyChange]);

  const openSourceForm = (nextForm: SourceFormState) => {
    if (
      formIsDirty &&
      !window.confirm("当前采集源还有未保存的修改，确定要切换吗？")
    ) {
      return;
    }
    setForm({ ...nextForm });
    setFormBaseline({ ...nextForm });
  };

  const closeSourceForm = () => {
    if (
      formIsDirty &&
      !window.confirm("采集源还有未保存的修改，确定要取消吗？")
    ) {
      return;
    }
    setForm(null);
    setFormBaseline(null);
  };

  const loadSources = useCallback(async () => {
    try {
      setLoading(true);
      const data = await sourcesApi.list();
      setLoadError("");
      setSources(data);
    } catch (error) {
      const message = getErrorMessage(
        error,
        "采集源暂时无法加载，请重新加载。",
      );
      setLoadError(message);
      addToast({
        title: "加载信息源失败",
        description: message,
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const handleSeed = async () => {
    try {
      const result = await sourcesApi.seed();
      addToast({
        title: "推荐来源已添加",
        description: `新增 ${result.created} 个，已有 ${result.skipped} 个`,
        color: "success",
      });
      await loadSources();
    } catch (error) {
      addToast({
        title: "推荐来源未添加",
        description: getErrorMessage(error, "推荐来源未添加，请稍后重试。"),
        color: "danger",
      });
    }
  };

  const handleToggle = async (id: string) => {
    try {
      setTogglingId(id);
      await sourcesApi.toggle(id);
      setSources((prev) =>
        prev.map((source) =>
          source.id === id ? { ...source, enabled: !source.enabled } : source,
        ),
      );
    } catch (error) {
      addToast({
        title: "切换失败",
        description: getErrorMessage(error, "采集源状态未更新，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleSaveSource = async () => {
    if (!form) return;

    const name = form.name.trim();
    const url = form.url.trim();
    if (!name || !url) {
      addToast({
        title: "请补全采集源",
        description: "名称和采集地址不能为空",
        color: "warning",
      });
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name,
        type: form.type,
        url,
        enabled: form.enabled,
        config: parseSourceConfig(form.configJson),
      };

      if (form.id) {
        await sourcesApi.update(form.id, payload);
      } else {
        await sourcesApi.create(payload);
      }

      addToast({
        title: "保存成功",
        description: form.id ? "采集源配置已更新" : "采集源已新增",
        color: "success",
      });
      setForm(null);
      setFormBaseline(null);
      await loadSources();
    } catch (error) {
      addToast({
        title: "保存失败",
        description: getErrorMessage(
          error,
          "采集源未保存，请检查填写内容后重试。",
        ),
        color: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSource = (source: Source) => {
    setSourceToDelete(source);
  };

  const confirmDeleteSource = async () => {
    if (!sourceToDelete) return;
    try {
      setDeletingId(sourceToDelete.id);
      await sourcesApi.remove(sourceToDelete.id);
      addToast({
        title: "删除成功",
        description: `已删除 ${sourceToDelete.name}`,
        color: "success",
      });
      if (form?.id === sourceToDelete.id) {
        setForm(null);
        setFormBaseline(null);
      }
      setSourceToDelete(null);
      await loadSources();
    } catch (error) {
      addToast({
        title: "删除失败",
        description: getErrorMessage(error, "采集源未删除，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setDeletingId(null);
    }
  };
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 max-w-5xl flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold">内容来源</h2>
          <p className="mt-1 text-small text-default-500">
            管理自动采集内容的平台、地址和启用状态。
          </p>
        </div>
        <div className="settings-action-row flex min-w-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="flat"
            onPress={handleSeed}
            startContent={<Icon icon="solar:add-circle-bold" />}
          >
            添加推荐来源
          </Button>
          <Button
            size="sm"
            color="primary"
            onPress={() => openSourceForm(emptySourceForm)}
            startContent={<Icon icon="solar:add-circle-bold" />}
          >
            新增采集源
          </Button>
        </div>
      </div>
      {form ? (
        <div className="rounded-[8px] border border-divider bg-default-50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h4 className="font-medium">
                {form.id ? "编辑采集源" : "新增采集源"}
              </h4>
              <p className="mt-1 text-small text-default-500">
                填写采集地址并设置是否启用。
              </p>
            </div>
            <Button size="sm" variant="light" onPress={closeSourceForm}>
              取消
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="采集源名称"
              value={form.name}
              onChange={(event) =>
                setForm((prev) =>
                  prev ? { ...prev, name: event.target.value } : prev,
                )
              }
              labelPlacement="outside"
              placeholder="例如：Aibase"
            />
            <Select
              label="采集类型"
              selectedKeys={[form.type]}
              onSelectionChange={(keys) => {
                const type = Array.from(keys)[0] as string | undefined;
                if (!type) return;
                setForm((prev) => (prev ? { ...prev, type } : prev));
              }}
              labelPlacement="outside"
              disallowEmptySelection
            >
              {sourceTypeOptions.map((option) => (
                <SelectItem key={option.key}>{option.label}</SelectItem>
              ))}
            </Select>
          </div>
          <div className="mt-4">
            <Input
              label="采集地址"
              value={form.url}
              onChange={(event) =>
                setForm((prev) =>
                  prev ? { ...prev, url: event.target.value } : prev,
                )
              }
              labelPlacement="outside"
              placeholder="请输入采集页面或订阅地址"
            />
          </div>
          <details className="mt-4 rounded-[6px] border border-divider bg-background px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-default-700">
              高级采集设置
            </summary>
            <div className="mt-4">
              <Textarea
                label="附加设置"
                value={form.configJson}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, configJson: event.target.value } : prev,
                  )
                }
                minRows={4}
                labelPlacement="outside"
                description="仅在渠道说明明确要求时填写，其他情况保持默认。"
              />
            </div>
          </details>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Switch
              color="success"
              isSelected={form.enabled}
              onValueChange={(enabled) =>
                setForm((prev) => (prev ? { ...prev, enabled } : prev))
              }
            >
              启用采集源
            </Switch>
            <Button
              color="primary"
              isLoading={saving}
              onPress={handleSaveSource}
            >
              保存采集源
            </Button>
          </div>
        </div>
      ) : null}
      {loadError ? (
        <FailureActionPanel
          actions={[
            { label: "重新加载", onPress: () => void loadSources() },
            { label: "初始化默认渠道", onPress: () => void handleSeed() },
          ]}
          impact="采集源列表暂时不可用，情报采集、素材沉淀和自动跟踪可能缺少来源。"
          nextAction="先重新加载；仍失败时初始化默认渠道或检查服务状态。"
          reason="采集源读取失败，可能是数据服务或网络连接暂时不可用。"
          technicalDetails={loadError}
          title="采集源需要处理"
        />
      ) : null}
      {sources.length === 0 ? (
        <FunctionalEmptyState
          actions={[
            { label: "初始化默认渠道", onPress: () => void handleSeed() },
            { href: "/intelligence/search", label: "一键找线索" },
          ]}
          description="还没有配置采集源。初始化默认渠道后，情报搜索、素材采集和长期监控才有可用来源。"
          examples={["网页采集", "RSS 订阅", "数据服务", "长期监控"]}
          surface="plain"
          title="当前没有采集源"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between gap-3 rounded-[8px] border border-divider bg-default-50 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{source.name}</span>
                  <Chip size="sm" variant="flat" color="primary">
                    {sourceTypeLabelMap[source.type] || sourceDisplayText(source.type)}
                  </Chip>
                </div>
                <p className="mt-1 max-w-[300px] truncate text-small text-default-500">
                  {sourceUrlDisplayText(source.url)}
                </p>
                {source.lastCrawlTime ? (
                  <p className="mt-1 text-tiny text-default-400">
                    上次采集:
                    {new Date(source.lastCrawlTime).toLocaleString("zh-CN")}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  color="success"
                  size="sm"
                  isSelected={source.enabled}
                  isDisabled={togglingId === source.id}
                  onValueChange={() => handleToggle(source.id)}
                />
                <Button
                  size="sm"
                  variant="light"
                  isIconOnly
                  aria-label={`编辑 ${source.name}`}
                  onPress={() => openSourceForm(toSourceForm(source))}
                >
                  <Icon icon="solar:pen-bold" width={18} />
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  color="danger"
                  isIconOnly
                  aria-label={`删除 ${source.name}`}
                  isLoading={deletingId === source.id}
                  onPress={() => handleDeleteSource(source)}
                >
                  <Icon icon="solar:trash-bin-trash-bold" width={18} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Divider className="my-2" />
      <h3 className="text-medium font-bold">来源管理</h3>
      <div className="rounded-[8px] border border-divider bg-default-50 p-4 text-small text-default-500">
        调整单个渠道，请点击右侧编辑按钮。
      </div>
      <RiskConfirmationDialog
        checklist={[
          "确认该采集源不再用于自动采集和素材入库。",
          "删除后，相关渠道需要重新新增配置才能恢复采集。",
        ]}
        confirmLabel="确认删除"
        description="删除采集源会影响后续自动采集任务。"
        impactItems={[
          {
            label: "采集源",
            value: sourceToDelete?.name || "-",
          },
          {
            label: "地址",
            value: sourceUrlDisplayText(sourceToDelete?.url),
          },
        ]}
        isLoading={Boolean(deletingId)}
        isOpen={Boolean(sourceToDelete)}
        riskLevel="medium"
        title="确认删除采集源"
        onCancel={() => setSourceToDelete(null)}
        onConfirm={confirmDeleteSource}
      />
    </div>
  );
}

function StorageSettings({ onDirtyChange }: DirtyStateProps) {
  const [config, setConfig] = useState<StorageConfig>(emptyStorageConfig);
  const [savedConfig, setSavedConfig] =
    useState<StorageConfig>(emptyStorageConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadError, setLoadError] = useState("");

  const configIsDirty =
    !loading && JSON.stringify(config) !== JSON.stringify(savedConfig);
  useUnsavedChangesWarning(configIsDirty);

  useEffect(() => {
    onDirtyChange?.(configIsDirty);
    return () => onDirtyChange?.(false);
  }, [configIsDirty, onDirtyChange]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await storageApi.getConfig();
      const nextConfig = { ...emptyStorageConfig, ...(data || {}) };
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setLoadError("");
    } catch (error) {
      const message = getErrorMessage(
        error,
        "存储设置暂时无法加载，请重新加载。",
      );
      setLoadError(message);
        addToast({
          title: "加载失败",
          description: message,
          color: "danger",
        });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await storageApi.updateConfig(config);
      setSavedConfig({ ...config });
      addToast({
        title: "保存成功",
        description:
          config.provider === "local" ? "已使用本地存储" : "对象存储配置已保存",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "保存失败",
        description: getErrorMessage(error, "存储设置未保存，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      const result = await storageApi.testConnection(
        buildSettingsRiskConfirmation(
          "storage-remote-test",
          "high",
          "用户在设置页点击测试对象存储连接",
        ),
      );
      addToast({
        title: result.success ? "连接成功" : "连接失败",
        description: result.success
          ? "存储连接可用。"
          : "存储连接暂不可用，请检查设置后重试。",
        color: result.success ? "success" : "danger",
      });
    } catch (error) {
      addToast({
        title: "测试异常",
        description: getErrorMessage(error, "存储连接未完成，请检查配置后重试。"),
        color: "danger",
      });
    } finally {
      setTesting(false);
    }
  };
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const isRemoteStorage = config.provider !== "local";
  const isAliyunOss = config.provider === "aliyun-oss";
  return (
    <div className="flex min-w-0 max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-base font-bold">文件存储</h2>
        <p className="mt-1 text-small text-default-500">
          选择素材、图片和生成文件的保存方式。本地存储适合单机使用；对象存储适合多设备访问和长期保存。
        </p>
      </div>
      {loadError ? (
        <FailureActionPanel
          actions={[{ label: "重新加载", onPress: () => void loadConfig() }]}
          impact="当前无法确认已保存的存储方式；为避免覆盖原配置，建议先重新读取。"
          nextAction="重新加载成功后再修改或检查连接。"
          reason="存储设置读取失败，可能是桌面服务或数据服务暂时不可用。"
          technicalDetails={loadError}
          title="存储设置需要重新读取"
        />
      ) : null}
      <div className="flex flex-col gap-4">
        <Select
          label="存储方式"
          selectedKeys={[config.provider || "local"]}
          onSelectionChange={(keys) => {
            const provider = Array.from(keys)[0] as StorageConfig["provider"];
            if (!provider) return;
            setConfig((prev) => ({ ...prev, provider }));
          }}
          labelPlacement="outside"
          disallowEmptySelection
        >
          <SelectItem key="local">本地存储</SelectItem>
              <SelectItem key="aliyun-oss">云存储 - 阿里 OSS</SelectItem>
              <SelectItem key="qiniu">云存储 - 七牛云</SelectItem>
        </Select>
        {config.provider === "local" ? (
          <div className="rounded-[8px] border border-divider bg-default-50 p-4">
            <div className="flex items-start gap-3">
              <Icon
                icon="solar:folder-with-files-linear"
                width={24}
                className="mt-0.5 text-primary"
              />
              <div>
                <p className="font-medium">当前使用本地存储</p>
                <p className="mt-1 text-small text-default-500">
                  文件保存在当前设备，无需填写云端授权信息。适合桌面版和单机使用。
                </p>
              </div>
            </div>
          </div>
        ) : null}
        {isRemoteStorage ? (
          <>
            <Select
              label="云存储服务商"
              selectedKeys={[config.provider]}
              onSelectionChange={(keys) => {
                const provider = Array.from(
                  keys,
                )[0] as StorageConfig["provider"];
                if (!provider || provider === "local") return;
                setConfig((prev) => ({ ...prev, provider }));
              }}
              labelPlacement="outside"
              disallowEmptySelection
            >
              <SelectItem key="aliyun-oss">阿里 OSS</SelectItem>
              <SelectItem key="qiniu">七牛云</SelectItem>
            </Select>
            <Input
              label="访问账号"
              placeholder={
                isAliyunOss ? "请输入阿里云访问账号" : "请输入七牛云访问账号"
              }
              value={config.accessKey}
              onChange={(event) =>
                setConfig({ ...config, accessKey: event.target.value })
              }
              labelPlacement="outside"
            />
            <Input
              label="访问凭证"
              placeholder={
                isAliyunOss ? "请输入阿里云访问凭证" : "请输入七牛云访问凭证"
              }
              type="password"
              value={config.secretKey}
              onChange={(event) =>
                setConfig({ ...config, secretKey: event.target.value })
              }
              labelPlacement="outside"
            />
            <Input
              label="存储空间"
              placeholder={
                isAliyunOss
                  ? "例如：kaypal-content-assets"
                  : "例如：my-ai-images"
              }
              value={config.bucket}
              onChange={(event) =>
                setConfig({ ...config, bucket: event.target.value })
              }
              labelPlacement="outside"
            />
            <Input
              label="访问域名"
              placeholder="例如：https://cdn.example.com"
              value={config.domain}
              onChange={(event) =>
                setConfig({ ...config, domain: event.target.value })
              }
              labelPlacement="outside"
              description="用于在其他设备上打开已保存的文件。"
            />
            {isAliyunOss ? (
              <>
                <Input
                  label="服务地址"
                  placeholder="例如：https://oss-cn-hangzhou.aliyuncs.com"
                  value={config.endpoint || ""}
                  onChange={(event) =>
                    setConfig({ ...config, endpoint: event.target.value })
                  }
                  labelPlacement="outside"
                />
                <Input
                  label="服务区域代码"
                  placeholder="例如：oss-cn-hangzhou"
                  value={config.region || ""}
                  onChange={(event) =>
                    setConfig({ ...config, region: event.target.value })
                  }
                  labelPlacement="outside"
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="settings-action-row flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          color="secondary"
          variant="flat"
          isLoading={testing}
          isDisabled={!isRemoteStorage}
          startContent={!testing && <Icon icon="solar:server-bold-duotone" />}
          onPress={handleTest}
        >
          测试连接
        </Button>
        <Button color="primary" isLoading={saving} onPress={handleSave}>
          保存配置
        </Button>
      </div>
    </div>
  );
}
