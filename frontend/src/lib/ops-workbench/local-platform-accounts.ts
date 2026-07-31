import type { AutoUploadAccount } from "@/lib/api/auto-upload";
import { publishingApi, type PublishAccount } from "@/lib/api/publishing";

type LoadLocalPlatformAccountOptions = {
  validate?: boolean;
  force?: boolean;
  ids?: number[];
  timeoutMs?: number;
};

const PLATFORM_LABELS: Record<number, string> = {
  1: "小红书",
  2: "视频号",
  3: "抖音",
  4: "快手",
  5: "B站",
};

const PLATFORM_TYPES: Record<string, number> = {
  xiaohongshu: 1,
  "wechat-channel": 2,
  wechat: 2,
  douyin: 3,
  kuaishou: 4,
  bilibili: 5,
};

function normalizeAvatarUrl(avatarUrl?: string | null) {
  if (!avatarUrl) return null;
  return avatarUrl.startsWith("http") ? avatarUrl : avatarUrl;
}

function normalizeSessionStatus(
  value: PublishAccount["config"] extends infer Config
    ? Config extends { sessionStatus?: infer Status }
      ? Status
      : unknown
    : unknown,
  fallbackReady: boolean,
): AutoUploadAccount["sessionStatus"] {
  if (
    value === "logged_in" ||
    value === "needs_login" ||
    value === "error" ||
    value === "unknown"
  ) {
    return value;
  }
  return fallbackReady ? "logged_in" : "needs_login";
}

function resolvePlatformType(account: PublishAccount) {
  const configuredType = Number(account.config?.platformType);
  if (Number.isFinite(configuredType) && configuredType > 0) {
    return configuredType;
  }
  return PLATFORM_TYPES[account.platform] || 0;
}

export function publishAccountToAutoUploadAccount(
  account: PublishAccount,
): AutoUploadAccount | null {
  if (account.source !== "local-engine") return null;

  const id = Number(account.engineAccountId ?? account.config?.engineAccountId);
  const type = resolvePlatformType(account);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(type) || type <= 0) {
    return null;
  }

  const profileName = account.config?.profileName || account.name || null;
  const userName = account.config?.userName || account.name || "";
  const ready = account.status === "ready" || account.config?.status === "ready";
  const sessionStatus = normalizeSessionStatus(
    account.config?.sessionStatus,
    ready,
  );

  return {
    id,
    type,
    platform: PLATFORM_LABELS[type] || account.platform || `平台 ${type}`,
    filePath: account.filePath || "",
    userName,
    profileName,
    avatarPath: account.config?.avatarPath || null,
    avatarUrl: normalizeAvatarUrl(
      account.config?.avatarUrl || account.config?.avatarPath,
    ),
    status: ready ? 1 : 0,
    statusLabel:
      account.statusLabel ||
      account.config?.statusLabel ||
      (ready ? "已登录" : "需重新登录"),
    avatarUpdatedAt: account.config?.avatarUpdatedAt || null,
    sessionStatus,
    lastDispatchAt:
      account.config?.lastDispatchAt ||
      account.config?.checkedAt ||
      account.config?.syncedAt ||
      null,
    lastDispatchOk:
      account.config?.lastDispatchOk ??
      (sessionStatus === "logged_in"
        ? true
        : sessionStatus === "needs_login" || sessionStatus === "error"
          ? false
          : null),
    lastDispatchReason:
      account.config?.lastDispatchReason ||
      (ready ? "local_engine_account_ready" : "local_engine_account_expired"),
  };
}

function accountReliabilityScore(account: AutoUploadAccount) {
  const sessionScore =
    account.sessionStatus === "logged_in"
      ? 50
      : account.sessionStatus === "unknown"
        ? 10
        : account.sessionStatus
          ? 0
          : 5;
  const readyScore = account.status === 1 ? 30 : 0;
  const dispatchScore = account.lastDispatchOk === true ? 20 : 0;
  const timestampScore = account.lastDispatchAt ? 1 : 0;
  return sessionScore + readyScore + dispatchScore + timestampScore;
}

function dedupeLocalPlatformAccounts(accounts: AutoUploadAccount[]) {
  const byEngineAccount = new Map<string, AutoUploadAccount>();
  for (const account of accounts) {
    const key = `${account.type}:${account.id}`;
    const existing = byEngineAccount.get(key);
    if (
      !existing ||
      accountReliabilityScore(account) > accountReliabilityScore(existing)
    ) {
      byEngineAccount.set(key, account);
    }
  }
  return Array.from(byEngineAccount.values());
}

export async function loadLocalPlatformAccounts(
  options: LoadLocalPlatformAccountOptions = {},
): Promise<AutoUploadAccount[]> {
  const accounts = await publishingApi.getAccounts({
    validate: options.validate,
    force: options.force,
    ids: options.ids,
    source: "local-engine",
  });
  const selectedIds = options.ids?.length ? new Set(options.ids) : null;

  const mapped = accounts
    .map(publishAccountToAutoUploadAccount)
    .filter((account): account is AutoUploadAccount => {
      if (!account) return false;
      return selectedIds ? selectedIds.has(account.id) : true;
    });
  return dedupeLocalPlatformAccounts(mapped);
}

export async function loadReadyLocalAccountsByType(
  type: number,
): Promise<AutoUploadAccount[]> {
  const accounts = await loadLocalPlatformAccounts();
  return accounts.filter(
    (account) => account.type === type && account.status === 1,
  );
}
