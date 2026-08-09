"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { Button, Chip, Input, Switch, Textarea, addToast } from "@heroui/react";
import {
  Copy,
  Download,
  Edit3,
  Loader2,
  LogIn,
  MessageCircle,
  PauseCircle,
  Plus,
  PlayCircle,
  RefreshCw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  aiEmployeeApi,
  type AiEmployeeAutoAcquisitionConfig,
  type AiEmployeeAutoAcquisitionConfigStatus,
  type AiEmployeeAutoAcquisitionRecord,
  type AiEmployeeDouyinFollowUpTarget,
} from "@/lib/api/ai-employee";
import { buildRiskConfirmation } from "@/lib/api/auto-upload";
import { localEngineApi } from "@/lib/api/local-engine";
import type { AutoUploadAccount } from "@/lib/api/auto-upload";
import { loadLocalPlatformAccounts } from "@/lib/ops-workbench/local-platform-accounts";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";

type AutoLeadConfigStatus = AiEmployeeAutoAcquisitionConfigStatus;
type AutoLeadConfig = AiEmployeeAutoAcquisitionConfig;
type AutoLeadRecord = AiEmployeeAutoAcquisitionRecord;
type AutoLeadCommentMode = "reply" | "video-comment";
type PendingImmediateExecution =
  | { kind: "draft" }
  | { kind: "saved"; config: AutoLeadConfig };

const DOUYIN_PLATFORM_TYPE = 3;
const LEGACY_CONFIG_STORAGE_KEY = "kaypal.autoAcquisition.configs";
const BACKEND_MIGRATION_STORAGE_KEY = "kaypal.autoAcquisition.backendMigrated";
const DEFAULT_MESSAGE_CONTENTS = [
  "我这边刚好有相关案例，可以交流一下。",
  "这个问题我们服务过不少客户，可以发你一份参考。",
].join("\n");

const DEFAULT_APPEND_COMMENTS = ["已关注，方便的话可以交流一下。"].join("\n");

const DEFAULT_NICKNAME_KEYWORDS = "装修, 家装, 设计, 建材, 门店";
const DEFAULT_DAILY_LIMIT = "10";

function createDefaultTaskName() {
  return `自动获客${Date.now()}`;
}

function splitList(value = "") {
  return value
    .split(/[\n,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readLegacyConfigs(): AutoLeadConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(LEGACY_CONFIG_STORAGE_KEY) || "[]",
    );
    return Array.isArray(parsed) ? parsed.map(normalizeStoredConfig) : [];
  } catch {
    return [];
  }
}

function hasMigratedBackendConfigs() {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem(BACKEND_MIGRATION_STORAGE_KEY) === "1"
  );
}

function markBackendConfigsMigrated() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(BACKEND_MIGRATION_STORAGE_KEY, "1");
  }
}

function accountLabel(account: AutoUploadAccount) {
  const label = String(account.profileName || account.userName || "").trim();
  if (!label || /^\d+$/.test(label)) return `抖音账号 ${account.id}`;
  return label;
}

function accountReady(account: AutoUploadAccount) {
  return (
    account.type === DOUYIN_PLATFORM_TYPE &&
    account.status === 1 &&
    (!account.sessionStatus || account.sessionStatus === "logged_in") &&
    account.lastDispatchOk !== false
  );
}

function accountStatusText(account?: AutoUploadAccount | null) {
  if (!account) return "未找到";
  if (accountReady(account)) return "已登录，可执行";
  return (
    account.statusLabel ||
    account.lastDispatchReason ||
    account.sessionStatus ||
    "需要重新登录"
  );
}

function statusChip(status: AutoLeadConfigStatus) {
  if (status === "running")
    return (
      <Chip color="primary" variant="flat" size="sm">
        执行中
      </Chip>
    );
  if (status === "enabled")
    return (
      <Chip color="success" variant="flat" size="sm">
        已启用
      </Chip>
    );
  return (
    <Chip color="default" variant="flat" size="sm">
      已停用
    </Chip>
  );
}

function recordStatusText(status: string) {
  if (status === "running") return "执行中";
  if (status === "success") return "成功";
  if (status === "partial") return "部分成功";
  if (status === "failed") return "失败";
  if (status === "skipped") return "已跳过";
  return status;
}

function crmCaptureText(record: AutoLeadRecord) {
  const capture = record.crmCapture;
  if (!capture) return "";
  if (capture.enabled && capture.capturedCount > 0)
    return `CRM 已沉淀 ${capture.capturedCount} 条`;
  return capture.message || "CRM 未沉淀";
}

function actualTouchCount(record: AutoLeadRecord) {
  return (
    record.executionSummary?.successCount ??
    record.executionResults?.filter((item) => item.ok).length ??
    0
  );
}

function normalizeStoredConfig(config: AutoLeadConfig): AutoLeadConfig {
  const taskName = config.taskName?.startsWith("搜索账号曝光")
    ? config.taskName.replace("搜索账号曝光", "自动获客")
    : config.taskName;
  return {
    ...config,
    taskName,
    commentMode:
      config.commentMode === "video-comment" ? "video-comment" : "reply",
  };
}

function commentModeLabel(mode?: AutoLeadCommentMode) {
  return mode === "video-comment" ? "视频直评" : "评论区回复";
}

function videoKey(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/douyin\.com\/video\/(\d+)/i);
  return match?.[1] ? `douyin-video:${match[1]}` : raw.replace(/[?#].*$/, "");
}

function countVideos(
  targets: Array<
    Pick<AiEmployeeDouyinFollowUpTarget, "videoUrl" | "sourceUrl">
  >,
) {
  return new Set(
    targets
      .map((target) => videoKey(target.videoUrl || target.sourceUrl))
      .filter(Boolean),
  ).size;
}

function evidenceHref(value?: string) {
  return value ? localEngineApi.evidenceFileUrl(value) : "";
}

export default function AutoAcquisitionPage() {
  const [accounts, setAccounts] = useState<AutoUploadAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [runningId, setRunningId] = useState("");
  const [pendingImmediateExecution, setPendingImmediateExecution] =
    useState<PendingImmediateExecution | null>(null);
  const [confirmingImmediateExecution, setConfirmingImmediateExecution] =
    useState(false);
  const immediateExecutionLockRef = useRef(false);
  const [editingId, setEditingId] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [backendLoading, setBackendLoading] = useState(true);
  const blacklistFileInputRef = useRef<HTMLInputElement | null>(null);
  const [configs, setConfigs] = useState<AutoLeadConfig[]>([]);
  const [records, setRecords] = useState<AutoLeadRecord[]>([]);

  const [taskName, setTaskName] = useState("自动获客");
  const [accountId, setAccountId] = useState("");
  const [commentMode, setCommentMode] = useState<AutoLeadCommentMode>("reply");
  const [searchKeywords, setSearchKeywords] = useState("");
  const [keywords, setKeywords] = useState(DEFAULT_NICKNAME_KEYWORDS);
  const [contents, setContents] = useState(DEFAULT_MESSAGE_CONTENTS);
  const [contentDraft, setContentDraft] = useState("");
  const [blacklistNicknames, setBlacklistNicknames] = useState("");
  const [enterpriseOnly, setEnterpriseOnly] = useState(false);
  const [appendCommentEnabled, setAppendCommentEnabled] = useState(false);
  const [appendComments, setAppendComments] = useState(DEFAULT_APPEND_COMMENTS);
  const [appendCommentDraft, setAppendCommentDraft] = useState("");
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_DAILY_LIMIT);
  const [deduplicate, setDeduplicate] = useState(false);
  const [beginTime, setBeginTime] = useState("09:00");
  const [enabled, setEnabled] = useState(true);

  const contentItems = useMemo(
    () =>
      contents
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [contents],
  );
  const appendCommentItems = useMemo(
    () =>
      appendComments
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [appendComments],
  );
  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || null,
    [records, selectedRecordId],
  );

  const selectedAccount = useMemo(
    () => accounts.find((account) => String(account.id) === accountId) || null,
    [accountId, accounts],
  );
  const readyAccounts = useMemo(
    () => accounts.filter(accountReady),
    [accounts],
  );
  const accountById = useMemo(() => {
    const map = new Map<string, AutoUploadAccount>();
    accounts.forEach((account) => map.set(String(account.id), account));
    return map;
  }, [accounts]);

  const refreshAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const list = (
        await loadLocalPlatformAccounts({
          validate: true,
          force: true,
        })
      ).filter((account) => account.type === DOUYIN_PLATFORM_TYPE);
      setAccounts(list);
      setAccountId((current) => {
        if (current && list.some((account) => String(account.id) === current))
          return current;
        const firstReady = list.find(accountReady);
        return firstReady?.id ? String(firstReady.id) : "";
      });
    } catch (err) {
      addToast({
        color: "danger",
        title: "读取抖音账号失败",
        description:
          err instanceof Error
            ? err.message
            : "请先到发布中心-平台账号登录抖音账号。",
      });
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const refreshAutoAcquisition = useCallback(async () => {
    setBackendLoading(true);
    try {
      let snapshot = await aiEmployeeApi.autoAcquisition();
      if (!snapshot.configs.length && !hasMigratedBackendConfigs()) {
        const legacyConfigs = readLegacyConfigs();
        if (legacyConfigs.length) {
          for (const config of legacyConfigs.slice().reverse()) {
            await aiEmployeeApi.createAutoAcquisitionConfig({
              taskName: config.taskName,
              accountId: config.accountId,
              account: config.account,
              commentMode:
                config.commentMode === "video-comment"
                  ? "video-comment"
                  : "reply",
              searchKeywords: config.searchKeywords,
              keywords: config.keywords,
              contents: config.contents,
              blacklistNicknames: config.blacklistNicknames,
              enterpriseOnly: config.enterpriseOnly,
              appendCommentEnabled: config.appendCommentEnabled,
              appendComments: config.appendComments,
              dailyLimit: config.dailyLimit,
              exposureCount: config.exposureCount,
              deduplicate: config.deduplicate,
              beginTime: config.beginTime,
              enabled: false,
            });
          }
          markBackendConfigsMigrated();
          snapshot = await aiEmployeeApi.autoAcquisition();
          addToast({
            color: "success",
            title: `已迁移 ${legacyConfigs.length} 条旧配置，默认停用待确认`,
          });
        } else {
          markBackendConfigsMigrated();
        }
      }
      setConfigs(snapshot.configs.map(normalizeStoredConfig));
      setRecords(snapshot.records);
    } catch (err) {
      addToast({
        color: "danger",
        title: "读取自动获客配置失败",
        description: err instanceof Error ? err.message : "配置读取失败。",
      });
    } finally {
      setBackendLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAccounts();
    void refreshAutoAcquisition();
  }, [refreshAccounts, refreshAutoAcquisition]);

  useEffect(() => {
    if (taskName === "自动获客") setTaskName(createDefaultTaskName());
  }, [taskName]);

  function resetForm() {
    setEditingId("");
    setTaskName(createDefaultTaskName());
    setCommentMode("reply");
    setSearchKeywords("");
    setKeywords(DEFAULT_NICKNAME_KEYWORDS);
    setContents(DEFAULT_MESSAGE_CONTENTS);
    setContentDraft("");
    setBlacklistNicknames("");
    setEnterpriseOnly(false);
    setAppendCommentEnabled(false);
    setAppendComments(DEFAULT_APPEND_COMMENTS);
    setAppendCommentDraft("");
    setDailyLimit(DEFAULT_DAILY_LIMIT);
    setDeduplicate(false);
    setBeginTime("09:00");
    setEnabled(true);
  }

  function updateListItem(value: string, index: number, nextValue: string) {
    const items = value.split("\n");
    items[index] = nextValue;
    return items.join("\n");
  }

  function removeListItem(value: string, index: number) {
    return value
      .split("\n")
      .filter((_, itemIndex) => itemIndex !== index)
      .join("\n");
  }

  function appendListItem(value: string, nextValue: string) {
    const trimmed = nextValue.trim();
    if (!trimmed) return value;
    return [
      ...value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      trimmed,
    ].join("\n");
  }

  function downloadBlacklistTemplate() {
    const blob = new Blob(["昵称\n竞品账号\n同行商家\n"], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "曝光黑名单导入模板.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyBlacklist() {
    const text = blacklistNicknames.trim();
    if (!text) {
      addToast({ color: "warning", title: "黑名单为空" });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      addToast({ color: "success", title: "已复制黑名单列表" });
    } catch {
      addToast({ color: "danger", title: "复制失败，请检查浏览器剪贴板权限" });
    }
  }

  function validateDraftConfig(requireImmediateExecution = false) {
    if (!selectedAccount || !accountReady(selectedAccount)) {
      addToast({
        color: "warning",
        title: "请先登录可执行的抖音账号",
        description: selectedAccount
          ? accountStatusText(selectedAccount)
          : "当前没有可执行的抖音账号。",
      });
      return false;
    }
    if (!searchKeywords.trim()) {
      addToast({ color: "warning", title: "请填写搜索关键词" });
      return false;
    }
    if (requireImmediateExecution && !enabled) {
      addToast({
        color: "warning",
        title: "请先启用配置",
        description: "启用后才可执行，停用状态下不会发起操作。",
      });
      return false;
    }
    return true;
  }

  function buildConfigInput() {
    if (!selectedAccount) return null;

    return {
      id: editingId || undefined,
      taskName: taskName.trim() || "自动获客",
      accountId,
      account: accountLabel(selectedAccount),
      commentMode,
      searchKeywords: searchKeywords.trim(),
      keywords: keywords.trim(),
      contents: contents.trim(),
      blacklistNicknames: blacklistNicknames.trim(),
      enterpriseOnly,
      appendCommentEnabled,
      appendComments: appendComments.trim(),
      dailyLimit: Math.max(
        1,
        Math.min(200, Number(dailyLimit) || Number(DEFAULT_DAILY_LIMIT)),
      ),
      deduplicate,
      beginTime: beginTime.trim() || "09:00",
      enabled,
      riskConfirmation: enabled
        ? buildRiskConfirmation("schedule-enable")
        : undefined,
    };
  }

  async function submitConfig(options?: { executeAfterSave?: boolean }) {
    const executeAfterSave = options?.executeAfterSave === true;
    if (!validateDraftConfig(executeAfterSave)) return false;
    const next = buildConfigInput();
    if (!next) return false;

    setBackendLoading(true);
    try {
      const savedConfig = normalizeStoredConfig(
        editingId
          ? await aiEmployeeApi.updateAutoAcquisitionConfig(editingId, next)
          : await aiEmployeeApi.createAutoAcquisitionConfig(next),
      );
      if (executeAfterSave) {
        setConfigs((current) => [
          savedConfig,
          ...current.filter((item) => item.id !== savedConfig.id),
        ]);
        const executed = await executeConfig(savedConfig);
        if (!executed) {
          addToast({
            color: "warning",
            title: editingId
              ? "配置已保存，立即执行未完成"
              : "配置已创建，立即执行未完成",
            description: "配置已保留，可在下方配置列表检查原因后重试。",
          });
        }
        resetForm();
        return executed;
      }
      await refreshAutoAcquisition();
      addToast({
        color: "success",
        title: editingId ? "配置已保存" : "配置已创建",
      });
      resetForm();
      return true;
    } catch (err) {
      addToast({
        color: "danger",
        title: "保存配置失败",
        description: err instanceof Error ? err.message : "保存失败。",
      });
      return false;
    } finally {
      setBackendLoading(false);
    }
  }

  function editConfig(config: AutoLeadConfig) {
    setEditingId(config.id);
    setTaskName(config.taskName);
    setAccountId(config.accountId);
    setCommentMode(
      config.commentMode === "video-comment" ? "video-comment" : "reply",
    );
    setSearchKeywords(config.searchKeywords || "");
    setKeywords(config.keywords || DEFAULT_NICKNAME_KEYWORDS);
    setContents(config.contents || DEFAULT_MESSAGE_CONTENTS);
    setContentDraft("");
    setBlacklistNicknames(config.blacklistNicknames || "");
    setEnterpriseOnly(Boolean(config.enterpriseOnly));
    setAppendCommentEnabled(Boolean(config.appendCommentEnabled));
    setAppendComments(config.appendComments || DEFAULT_APPEND_COMMENTS);
    setAppendCommentDraft("");
    setDailyLimit(String(config.dailyLimit));
    setDeduplicate(config.deduplicate);
    setBeginTime(config.beginTime);
    setEnabled(config.status !== "disabled");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reuseLatestConfig() {
    const latest = configs[0];
    if (!latest) {
      addToast({ color: "warning", title: "暂无可复用配置" });
      return;
    }
    editConfig(latest);
    setEditingId("");
    setTaskName(`${latest.taskName}-复制`);
    addToast({ color: "success", title: "已复用最新配置" });
  }

  async function importBlacklistFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const names = splitList(`${blacklistNicknames}\n${text}`);
      setBlacklistNicknames(Array.from(new Set(names)).join("\n"));
      addToast({
        color: "success",
        title: `已导入 ${names.length} 个黑名单昵称`,
      });
    } catch (err) {
      addToast({
        color: "danger",
        title: "导入黑名单失败",
        description: err instanceof Error ? err.message : "文件读取失败",
      });
    } finally {
      if (blacklistFileInputRef.current) {
        blacklistFileInputRef.current.value = "";
      }
    }
  }

  async function removeConfig(id: string) {
    try {
      await aiEmployeeApi.deleteAutoAcquisitionConfig(id);
      await refreshAutoAcquisition();
      addToast({ color: "success", title: "配置已删除" });
    } catch (err) {
      addToast({
        color: "danger",
        title: "删除配置失败",
        description: err instanceof Error ? err.message : "删除失败。",
      });
    }
  }

  async function toggleConfig(config: AutoLeadConfig) {
    const nextEnabled = config.status === "disabled";
    if (nextEnabled) {
      const account = accountById.get(String(config.accountId));
      if (!account || !accountReady(account)) {
        addToast({
          color: "warning",
          title: "账号不可用，不能启用定时任务",
          description: account
            ? accountStatusText(account)
            : "未找到该配置绑定的抖音账号，请重新登录后编辑配置。",
        });
        return;
      }
    }
    try {
      await aiEmployeeApi.updateAutoAcquisitionConfigStatus(config.id, {
        enabled: nextEnabled,
        riskConfirmation: nextEnabled
          ? buildRiskConfirmation("schedule-enable")
          : undefined,
      });
      await refreshAutoAcquisition();
    } catch (err) {
      addToast({
        color: "danger",
        title: "更新状态失败",
        description: err instanceof Error ? err.message : "状态更新失败。",
      });
    }
  }

  function validateExecutableConfig(config: AutoLeadConfig) {
    if (config.status === "disabled") {
      addToast({ color: "warning", title: "请先打开配置开关" });
      return false;
    }
    const account = accountById.get(String(config.accountId));
    if (!account || !accountReady(account)) {
      addToast({
        color: "warning",
        title: "账号不可用，已阻止执行",
        description: account
          ? accountStatusText(account)
          : "未找到该配置绑定的抖音账号，请到发布中心-平台账号重新登录。",
      });
      return false;
    }
    if (config.exposureCount >= config.dailyLimit) {
      addToast({ color: "warning", title: "当天已曝光次数达到上限" });
      return false;
    }
    return true;
  }

  function requestDraftImmediateExecution() {
    if (!validateDraftConfig(true)) return;
    setPendingImmediateExecution({ kind: "draft" });
  }

  function requestSavedImmediateExecution(config: AutoLeadConfig) {
    if (!validateExecutableConfig(config)) return;
    setPendingImmediateExecution({ kind: "saved", config });
  }

  async function executeConfig(config: AutoLeadConfig) {
    if (!validateExecutableConfig(config)) return false;
    setRunningId(config.id);
    setConfigs((current) =>
      current.map((item) =>
        item.id === config.id
          ? { ...item, status: "running", reason: "执行中" }
          : item,
      ),
    );
    try {
      const approval =
        await aiEmployeeApi.createAutoAcquisitionExecutionConfirmation(
          config.id,
        );
      const result = await aiEmployeeApi.executeAutoAcquisitionConfig(
        config.id,
        {
          ...buildRiskConfirmation("batch-touch"),
          confirmationId: approval.confirmationId,
        },
      );
      setRecords((current) =>
        [
          result.record,
          ...current.filter((item) => item.id !== result.record.id),
        ].slice(0, 100),
      );
      setConfigs((current) =>
        current.map((item) => (item.id === config.id ? result.config : item)),
      );
      addToast({
        color: result.record.status === "success" ? "success" : "warning",
        title: "自动获客已执行",
        description: result.record.message,
      });
      void refreshAutoAcquisition();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "执行失败";
      void refreshAutoAcquisition();
      addToast({ color: "danger", title: "执行失败", description: message });
      return false;
    } finally {
      setRunningId("");
    }
  }

  async function confirmImmediateExecution() {
    const pending = pendingImmediateExecution;
    if (!pending || immediateExecutionLockRef.current) return;
    immediateExecutionLockRef.current = true;
    setConfirmingImmediateExecution(true);
    try {
      if (pending.kind === "draft") {
        await submitConfig({ executeAfterSave: true });
      } else {
        await executeConfig(pending.config);
      }
    } finally {
      immediateExecutionLockRef.current = false;
      setConfirmingImmediateExecution(false);
      setPendingImmediateExecution(null);
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-3 pb-8 text-[13px] leading-5">
      <header className="rounded-[4px] border border-default-200 bg-content1 px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold text-[var(--kaypal-v3-ink)]">
                短视频评论获客
              </h1>
              <Chip color="primary" variant="flat" size="sm">
                抖音自动上评论
              </Chip>
            </div>
            <p className="mt-1 text-default-500">
              按关键词找相关抖音短视频，读取评论区，筛出高意向留言并生成评论回复；创作者只作为流量入口，不作为客户私信。
            </p>
            <p className="mt-1 text-[12px] leading-5 text-default-400">
              这里是短视频评论获客 /
              自动上评论入口；客户互动里的抖音评论页只处理已进来的评论回复。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              as={Link}
              href="/distribution?tab=accounts"
              color="primary"
              variant="flat"
              className="rounded-[4px]"
              startContent={<LogIn size={16} />}
            >
              登录抖音账号
            </Button>
            <Button
              variant="flat"
              className="rounded-[4px]"
              startContent={
                accountsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )
              }
              onPress={() => {
                void refreshAccounts();
                void refreshAutoAcquisition();
              }}
            >
              刷新平台账号
            </Button>
          </div>
        </div>
      </header>
      <section className="rounded-[4px] border border-default-200 bg-content1 shadow-sm">
        <div className="border-b border-default-200 px-4 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--kaypal-v3-ink)]">
              {editingId ? "编辑自动获客配置" : "新建自动获客配置"}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="flat"
                className="rounded-[4px]"
                onPress={reuseLatestConfig}
              >
                复用配置
              </Button>
              <Button
                size="sm"
                variant="flat"
                className="rounded-[4px]"
                onPress={() => blacklistFileInputRef.current?.click()}
              >
                批量导入黑名单
              </Button>
              <input
                ref={blacklistFileInputRef}
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={(event) =>
                  void importBlacklistFile(event.target.files?.[0])
                }
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-3">
          <Input
            label="配置名称"
            labelPlacement="outside"
            value={taskName}
            onValueChange={setTaskName}
            classNames={{ inputWrapper: "rounded-[4px]" }}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">
              平台账号
            </span>
            <select
              className="h-8 rounded-[4px] border border-default-200 bg-default-100 px-3 text-[13px] outline-none transition-colors focus:border-primary"
              value={accountId}
              disabled={accountsLoading}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {accounts.length ? (
                accounts.map((account) => (
                  <option key={account.id} value={String(account.id)}>
                    {accountLabel(account)}
                  </option>
                ))
              ) : (
                <option value="">暂无已登录抖音账号</option>
              )}
            </select>
            {!accountsLoading && !readyAccounts.length ? (
              <div className="rounded-[4px] border border-warning-200 bg-warning-50 px-3 py-2 text-[12px] leading-5 text-warning-700">
                <p>当前没有可执行的抖音账号，不能创建真实自动评论任务。</p>
                <Button
                  as={Link}
                  href="/distribution?tab=accounts"
                  size="sm"
                  color="warning"
                  variant="flat"
                  className="mt-2 rounded-[4px]"
                  startContent={<LogIn size={14} />}
                >
                  去登录抖音账号
                </Button>
              </div>
            ) : null}
          </div>
          <Input
            label="平台"
            labelPlacement="outside"
            value="抖音"
            isReadOnly
            classNames={{ inputWrapper: "rounded-[4px]" }}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">
              评论方式
            </span>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                color={commentMode === "reply" ? "primary" : "default"}
                variant={commentMode === "reply" ? "solid" : "flat"}
                className="h-9 rounded-[4px]"
                startContent={<MessageCircle size={14} />}
                aria-pressed={commentMode === "reply"}
                onPress={() => setCommentMode("reply")}
              >
                评论区回复
              </Button>
              <Button
                size="sm"
                color={commentMode === "video-comment" ? "primary" : "default"}
                variant={commentMode === "video-comment" ? "solid" : "flat"}
                className="h-9 rounded-[4px]"
                startContent={<Video size={14} />}
                aria-pressed={commentMode === "video-comment"}
                onPress={() => setCommentMode("video-comment")}
              >
                视频直评
              </Button>
            </div>
          </div>
          <Input
            label="搜索关键词"
            labelPlacement="outside"
            value={searchKeywords}
            maxLength={160}
            onValueChange={setSearchKeywords}
            description="可填写多个关键词，用逗号、空格或换行分隔；执行时会按关键词轮换搜索。"
            placeholder="装修获客, 家装设计, 本地门店"
            classNames={{ inputWrapper: "rounded-[4px]" }}
          />
          <Textarea
            label={
              commentMode === "video-comment"
                ? "评论匹配关键词（直评不使用）"
                : "评论匹配关键词"
            }
            labelPlacement="outside"
            minRows={2}
            value={keywords}
            isDisabled={commentMode === "video-comment"}
            onValueChange={setKeywords}
            placeholder="装修, 家装, 设计"
            classNames={{ inputWrapper: "rounded-[4px]" }}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">
              评论回复内容
            </span>
            <div className="flex flex-col gap-1.5">
              {contentItems.map((item, index) => (
                <div
                  key={`${item}-${index}`}
                  className="flex items-start gap-2"
                >
                  <Textarea
                    minRows={1}
                    value={item}
                    onValueChange={(value) =>
                      setContents((current) =>
                        updateListItem(current, index, value),
                      )
                    }
                    classNames={{ inputWrapper: "rounded-[4px]" }}
                  />
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="mt-0.5 rounded-[4px]"
                    aria-label="删除评论回复内容"
                    onPress={() =>
                      setContents((current) => removeListItem(current, index))
                    }
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={contentDraft}
                  onValueChange={setContentDraft}
                  placeholder="新增一条评论回复"
                  classNames={{ inputWrapper: "rounded-[4px]" }}
                />
                <Button
                  isIconOnly
                  color="primary"
                  className="rounded-[4px]"
                  aria-label="新增评论回复内容"
                  onPress={() => {
                    setContents((current) =>
                      appendListItem(current, contentDraft),
                    );
                    setContentDraft("");
                  }}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-foreground">
                曝光黑名单
              </span>
              <div className="flex gap-1">
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="rounded-[4px]"
                  aria-label="下载导入模板"
                  onPress={downloadBlacklistTemplate}
                >
                  <Download size={14} />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="rounded-[4px]"
                  aria-label="复制黑名单列表"
                  onPress={() => void copyBlacklist()}
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
            <Textarea
              minRows={2}
              value={blacklistNicknames}
              onValueChange={setBlacklistNicknames}
              placeholder="命中这些昵称时跳过，换行添加多个"
              classNames={{ inputWrapper: "rounded-[4px]" }}
            />
          </div>
          <Input
            label="每天次数限制"
            labelPlacement="outside"
            type="number"
            min={1}
            max={200}
            value={dailyLimit}
            onValueChange={setDailyLimit}
            classNames={{ inputWrapper: "rounded-[4px]" }}
          />
          <div className="grid grid-cols-1 gap-2">
            <Input
              label="每天启动时间"
              labelPlacement="outside"
              value={beginTime}
              onValueChange={setBeginTime}
              description="计划启动时间继续用于每天定时；也可用下方按钮创建或保存后立即执行。"
              classNames={{ inputWrapper: "rounded-[4px]" }}
            />
            <Switch isSelected={enabled} onValueChange={setEnabled}>
              启用
            </Switch>
            <Switch isSelected={deduplicate} onValueChange={setDeduplicate}>
              跳过重复
            </Switch>
            <Switch
              isSelected={appendCommentEnabled}
              onValueChange={setAppendCommentEnabled}
            >
              备用评论文案池
            </Switch>
          </div>
          {appendCommentEnabled ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-foreground">
                追加评论内容
              </span>
              {appendCommentItems.map((item, index) => (
                <div
                  key={`${item}-${index}`}
                  className="flex items-start gap-2"
                >
                  <Textarea
                    minRows={1}
                    value={item}
                    onValueChange={(value) =>
                      setAppendComments((current) =>
                        updateListItem(current, index, value),
                      )
                    }
                    classNames={{ inputWrapper: "rounded-[4px]" }}
                  />
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="mt-0.5 rounded-[4px]"
                    aria-label="删除追加评论内容"
                    onPress={() =>
                      setAppendComments((current) =>
                        removeListItem(current, index),
                      )
                    }
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={appendCommentDraft}
                  onValueChange={setAppendCommentDraft}
                  placeholder="新增一条追加评论"
                  classNames={{ inputWrapper: "rounded-[4px]" }}
                />
                <Button
                  isIconOnly
                  color="primary"
                  className="rounded-[4px]"
                  aria-label="新增追加评论内容"
                  onPress={() => {
                    setAppendComments((current) =>
                      appendListItem(current, appendCommentDraft),
                    );
                    setAppendCommentDraft("");
                  }}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-default-200 px-4 py-2">
          {editingId ? (
            <Button
              variant="flat"
              className="rounded-[4px]"
              onPress={resetForm}
            >
              取消
            </Button>
          ) : null}
          <Button
            color="primary"
            className="rounded-[4px]"
            isLoading={backendLoading}
            isDisabled={!selectedAccount || !accountReady(selectedAccount)}
            onPress={() => void submitConfig()}
          >
            {editingId ? "保存" : "创建"}
          </Button>
          <Button
            color="warning"
            variant="flat"
            className="rounded-[4px]"
            startContent={<PlayCircle size={16} />}
            isLoading={
              confirmingImmediateExecution &&
              pendingImmediateExecution?.kind === "draft"
            }
            isDisabled={
              backendLoading ||
              Boolean(runningId) ||
              !enabled ||
              !selectedAccount ||
              !accountReady(selectedAccount)
            }
            onPress={requestDraftImmediateExecution}
          >
            {editingId ? "保存并立即执行" : "创建并立即执行"}
          </Button>
        </div>
      </section>
      <section className="overflow-hidden rounded-[4px] border border-default-200 bg-content1 shadow-sm">
        <div className="flex items-center justify-between border-b border-default-200 px-4 py-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--kaypal-v3-ink)]">
              自动获客配置
            </h2>
            <p className="mt-0.5 text-[12px] leading-5 text-default-500">
              「立即执行」会马上跑一次；「停用」相当于暂停定时任务，不会删除配置和历史记录。
            </p>
          </div>
          <Chip variant="flat" size="sm">
            {configs.length} 条配置
          </Chip>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1420px] w-full border-collapse text-left">
            <thead className="bg-default-50 text-[12px] text-default-500">
              <tr>
                {[
                  "配置名称",
                  "平台账号",
                  "账号状态",
                  "平台",
                  "评论方式",
                  "上次停止原因",
                  "搜索关键词",
                  "评论匹配关键词",
                  "评论回复内容",
                  "每天次数限制",
                  "当天已曝光次数",
                  "跳过重复",
                  "启动时间",
                  "创建时间",
                  "状态",
                  "操作",
                ].map((title) => (
                  <th
                    key={title}
                    className="border-b border-default-200 px-2.5 py-2 font-medium"
                  >
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {configs.length ? (
                configs.map((config) => {
                  const isConfigRunning =
                    runningId === config.id || config.status === "running";
                  const boundAccount = accountById.get(
                    String(config.accountId),
                  );
                  const boundAccountReady = boundAccount
                    ? accountReady(boundAccount)
                    : false;
                  return (
                    <tr
                      key={config.id}
                      className="border-b border-default-100 align-top last:border-b-0"
                    >
                      <td className="px-2.5 py-2 font-medium text-[var(--kaypal-v3-ink)]">
                        {config.taskName}
                      </td>
                      <td className="px-2.5 py-2">{config.account}</td>
                      <td className="px-2.5 py-2">
                        <div className="flex flex-col gap-1">
                          <Chip
                            color={boundAccountReady ? "success" : "warning"}
                            variant="flat"
                            size="sm"
                          >
                            {accountStatusText(boundAccount)}
                          </Chip>
                          {!boundAccountReady ? (
                            <Button
                              as={Link}
                              href="/distribution?tab=accounts"
                              size="sm"
                              variant="flat"
                              className="w-fit rounded-[4px]"
                              startContent={<LogIn size={13} />}
                            >
                              登录账号
                            </Button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2.5 py-2">{config.socialPlatform}</td>
                      <td className="px-2.5 py-2">
                        {commentModeLabel(config.commentMode)}
                      </td>
                      <td className="max-w-[150px] px-2.5 py-2 text-default-500">
                        {config.reason}
                      </td>
                      <td className="max-w-[160px] px-2.5 py-2">
                        {config.searchKeywords}
                      </td>
                      <td className="max-w-[180px] px-2.5 py-2">
                        {config.keywords}
                      </td>
                      <td className="max-w-[220px] px-2.5 py-2">
                        {config.contents}
                      </td>
                      <td className="px-2.5 py-2">{config.dailyLimit}</td>
                      <td className="px-2.5 py-2">{config.exposureCount}</td>
                      <td className="px-2.5 py-2">
                        {config.deduplicate ? "是" : "否"}
                      </td>
                      <td className="px-2.5 py-2">{config.beginTime}</td>
                      <td className="px-2.5 py-2">{config.createdTime}</td>
                      <td className="px-2.5 py-2">
                        {statusChip(config.status)}
                      </td>
                      <td className="px-2.5 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            color="primary"
                            className="rounded-[4px]"
                            startContent={
                              isConfigRunning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <PlayCircle size={14} />
                              )
                            }
                            isDisabled={
                              Boolean(runningId) ||
                              config.status === "disabled" ||
                              config.status === "running" ||
                              !boundAccountReady
                            }
                            onPress={() =>
                              requestSavedImmediateExecution(config)
                            }
                          >
                            立即执行
                          </Button>
                          <Button
                            size="sm"
                            variant="flat"
                            className="rounded-[4px]"
                            startContent={<MessageCircle size={14} />}
                            onPress={() =>
                              document
                                .getElementById("auto-acquisition-records")
                                ?.scrollIntoView({ behavior: "smooth" })
                            }
                          >
                            记录
                          </Button>
                          <Button
                            size="sm"
                            variant="flat"
                            className="rounded-[4px]"
                            startContent={<Edit3 size={14} />}
                            onPress={() => editConfig(config)}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="flat"
                            className="rounded-[4px]"
                            startContent={
                              config.status === "disabled" ? (
                                <PlayCircle size={14} />
                              ) : (
                                <PauseCircle size={14} />
                              )
                            }
                            onPress={() => void toggleConfig(config)}
                          >
                            {config.status === "disabled" ? "启用" : "停用"}
                          </Button>
                          <Button
                            size="sm"
                            color="danger"
                            variant="flat"
                            className="rounded-[4px]"
                            startContent={<Trash2 size={14} />}
                            onPress={() => void removeConfig(config.id)}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={15}
                    className="px-3 py-8 text-center text-default-400"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <span>
                        暂无配置。可先登录抖音账号，再从上方创建配置或创建并立即执行。
                      </span>
                      <Button
                        as={Link}
                        href="/distribution?tab=accounts"
                        size="sm"
                        color="primary"
                        variant="flat"
                        className="rounded-[4px]"
                        startContent={<LogIn size={14} />}
                      >
                        登录抖音账号
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section
        id="auto-acquisition-records"
        className="overflow-hidden rounded-[4px] border border-default-200 bg-content1 shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-default-200 px-4 py-2">
          <h2 className="text-[15px] font-semibold text-[var(--kaypal-v3-ink)]">
            获客记录
          </h2>
          <Chip variant="flat" size="sm">
            {records.length} 条记录
          </Chip>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full border-collapse text-left">
            <thead className="bg-default-50 text-[12px] text-default-500">
              <tr>
                {[
                  "时间",
                  "配置名称",
                  "搜索关键词",
                  "候选评论",
                  "评论回复",
                  "实际触达",
                  "覆盖视频",
                  "状态",
                  "结果",
                  "证据",
                ].map((title) => (
                  <th
                    key={title}
                    className="border-b border-default-200 px-2.5 py-2 font-medium"
                  >
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.length ? (
                records.map((record) => (
                  <tr
                    key={record.id}
                    className="border-b border-default-100 last:border-b-0"
                  >
                    <td className="px-2.5 py-2">{record.createdTime}</td>
                    <td className="px-2.5 py-2 font-medium">
                      {record.taskName}
                    </td>
                    <td className="px-2.5 py-2">{record.keyword}</td>
                    <td className="px-2.5 py-2">{record.candidateCount}</td>
                    <td className="px-2.5 py-2">{record.selectedCount}</td>
                    <td className="px-2.5 py-2 font-semibold">
                      {actualTouchCount(record)}
                    </td>
                    <td className="px-2.5 py-2">
                      {record.videoCount ||
                        countVideos(record.targets || []) ||
                        "-"}
                    </td>
                    <td className="px-2.5 py-2">
                      {recordStatusText(record.status)}
                    </td>
                    <td className="max-w-[360px] px-2.5 py-2 text-default-500">
                      <div>{record.message}</div>
                      {crmCaptureText(record) ? (
                        <div className="mt-1 text-[11px] text-success-600">
                          {crmCaptureText(record)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {record.targets?.length ? (
                          <Button
                            size="sm"
                            variant="flat"
                            className="rounded-[4px]"
                            onPress={() => setSelectedRecordId(record.id)}
                          >
                            打开
                          </Button>
                        ) : null}
                        {record.evidenceUrl ? (
                          <a
                            className="text-primary underline-offset-4 hover:underline"
                            href={evidenceHref(record.evidenceUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            证据
                          </a>
                        ) : (
                          "无"
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-8 text-center text-default-400"
                  >
                    暂无曝光记录。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {selectedRecord ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-5"
          role="dialog"
          aria-modal="true"
          aria-label="获客记录详情"
        >
          <div className="flex max-h-[82vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[4px] border border-default-200 bg-content1 shadow-sm">
            <div className="flex items-center justify-between border-b border-default-200 px-4 py-2.5">
              <div>
                <div className="text-[15px] font-semibold text-[var(--kaypal-v3-ink)]">
                  获客记录详情
                </div>
                <div className="mt-0.5 text-[12px] text-default-500">
                  {selectedRecord.createdTime} · {selectedRecord.taskName}
                </div>
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className="rounded-[4px]"
                aria-label="关闭记录详情"
                onPress={() => setSelectedRecordId("")}
              >
                <X size={16} />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 border-b border-default-200 px-4 py-2 text-[12px] md:grid-cols-4">
              <div>
                <span className="text-default-500">搜索关键词：</span>
                {selectedRecord.keyword || "-"}
              </div>
              <div>
                <span className="text-default-500">候选评论：</span>
                {selectedRecord.candidateCount}
              </div>
              <div>
                <span className="text-default-500">评论回复：</span>
                {selectedRecord.selectedCount}
              </div>
              <div>
                <span className="text-default-500">实际触达：</span>
                {actualTouchCount(selectedRecord)}
              </div>
              <div>
                <span className="text-default-500">覆盖视频：</span>
                {selectedRecord.videoCount ||
                  countVideos(selectedRecord.targets || []) ||
                  "-"}
              </div>
              <div className="col-span-2 md:col-span-4">
                <span className="text-default-500">结果：</span>
                {selectedRecord.message || "-"}
              </div>
              <div className="col-span-2 md:col-span-4">
                <span className="text-default-500">CRM：</span>
                {crmCaptureText(selectedRecord) || "未记录"}
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-[12px]">
                <thead className="bg-default-50 text-default-500">
                  <tr>
                    {[
                      "序号",
                      "评论用户",
                      "候选评论",
                      "评论回复",
                      "状态",
                      "证据",
                    ].map((title) => (
                      <th
                        key={title}
                        className="border-b border-default-200 px-3 py-2 font-medium"
                      >
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedRecord.targets?.length ? (
                    selectedRecord.targets.map((target, index) => {
                      const executionResult =
                        selectedRecord.executionResults?.find(
                          (item) =>
                            item.index === target.index ||
                            (item.targetName === target.targetName &&
                              item.targetText === target.text),
                        );
                      return (
                        <tr
                          key={`${selectedRecord.id}-${target.index ?? index}`}
                          className="border-b border-default-100 align-top last:border-b-0"
                        >
                          <td className="px-3 py-2">{index + 1}</td>
                          <td className="px-3 py-2 font-medium text-[var(--kaypal-v3-ink)]">
                            {target.targetName || "未知账号"}
                          </td>
                          <td className="max-w-[260px] whitespace-pre-wrap px-3 py-2 text-default-600">
                            {target.text || target.sourceText || "-"}
                          </td>
                          <td className="max-w-[260px] whitespace-pre-wrap px-3 py-2">
                            {target.commentReplyText || "-"}
                          </td>
                          <td className="px-3 py-2">
                            <Chip
                              size="sm"
                              variant="flat"
                              color={
                                executionResult?.ok
                                  ? "success"
                                  : executionResult
                                    ? "danger"
                                    : "default"
                              }
                            >
                              {executionResult
                                ? executionResult.message
                                : selectedRecord.executionSummary?.message ||
                                  selectedRecord.message}
                            </Chip>
                          </td>
                          <td className="px-3 py-2">
                            {executionResult?.evidenceUrl ? (
                              <a
                                className="text-primary underline-offset-4 hover:underline"
                                href={evidenceHref(executionResult.evidenceUrl)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                证据
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-default-400"
                      >
                        无目标明细
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-default-200 px-4 py-2">
              <Button
                size="sm"
                variant="flat"
                className="rounded-[4px]"
                onPress={() => setSelectedRecordId("")}
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <RiskConfirmationDialog
        isOpen={Boolean(pendingImmediateExecution)}
        title="确认立即执行短视频评论获客"
        description="确认后会马上执行一次抖音评论获客，可能产生真实评论回复；每天启动时间与定时配置会继续保留。"
        riskLevel="high"
        confirmLabel={
          pendingImmediateExecution?.kind === "draft"
            ? editingId
              ? "保存并执行"
              : "创建并执行"
            : "确认立即执行"
        }
        isLoading={confirmingImmediateExecution}
        impactItems={[
          {
            label: "配置",
            value:
              pendingImmediateExecution?.kind === "saved"
                ? pendingImmediateExecution.config.taskName
                : taskName.trim() || "自动获客",
          },
          {
            label: "抖音账号",
            value:
              pendingImmediateExecution?.kind === "saved"
                ? pendingImmediateExecution.config.account
                : selectedAccount
                  ? accountLabel(selectedAccount)
                  : "未选择",
          },
          {
            label: "搜索关键词",
            value:
              pendingImmediateExecution?.kind === "saved"
                ? pendingImmediateExecution.config.searchKeywords
                : searchKeywords.trim() || "未填写",
          },
          {
            label: "评论方式",
            value: commentModeLabel(
              pendingImmediateExecution?.kind === "saved"
                ? pendingImmediateExecution.config.commentMode
                : commentMode,
            ),
          },
          {
            label: "本次上限",
            value: `${
              pendingImmediateExecution?.kind === "saved"
                ? pendingImmediateExecution.config.dailyLimit
                : Math.max(
                    1,
                    Math.min(
                      200,
                      Number(dailyLimit) || Number(DEFAULT_DAILY_LIMIT),
                    ),
                  )
            } 条`,
          },
        ]}
        checklist={[
          "确认当前抖音账号属于获客测试或已批准业务范围。",
          "确认搜索关键词、评论回复文案和每日上限准确。",
          "确认本次执行可能在外部评论区产生真实写入。",
        ]}
        onCancel={() => setPendingImmediateExecution(null)}
        onConfirm={() => void confirmImmediateExecution()}
      />
    </div>
  );
}
