import type {
  AutoUploadAccount,
  AutoUploadCdpBrowserSession,
} from "@/lib/api/auto-upload";
import { commercialDisplayText } from "@/lib/commercial-display-text";

/** 平台名归一化（CDP 会话平台名 → 稳定 slug） */
export function normalizeCdpPlatform(platform?: string | null): string {
  const value = String(platform || "").toLowerCase();
  if (value.includes("douyin") || value.includes("抖音")) return "douyin";
  if (value.includes("kuaishou") || value.includes("快手")) return "kuaishou";
  if (value.includes("xiaohongshu") || value.includes("小红书"))
    return "xiaohongshu";
  if (
    value.includes("wechat-channel") ||
    value.includes("wechat_channel") ||
    value.includes("channels.weixin") ||
    value.includes("视频号")
  ) {
    return "wechat-channel";
  }
  return value;
}

/** 账号平台 slug（按 type 映射，兜底归一化 platform 名） */
export function accountPlatformSlug(account: AutoUploadAccount): string {
  const byType: Record<number, string> = {
    1: "xiaohongshu",
    2: "wechat-channel",
    3: "douyin",
    4: "kuaishou",
    5: "bilibili",
  };
  return byType[account.type] || normalizeCdpPlatform(account.platform);
}

/** 账号去重身份键 */
export function accountIdentityKey(account: AutoUploadAccount): string {
  return [
    accountPlatformSlug(account) || `type-${account.type}`,
    account.stableId || account.id,
    account.filePath || account.profileName || account.userName || "",
  ].join(":");
}

/** 账号行 key（列表渲染用） */
export function accountRowKey(account: AutoUploadAccount, index: number): string {
  return `${accountIdentityKey(account)}:${index}`;
}

/** 找账号对应的 CDP 平台后台会话 */
export function findAccountCdpSession(
  sessions: AutoUploadCdpBrowserSession[],
  account: AutoUploadAccount,
): AutoUploadCdpBrowserSession | null {
  const expectedPlatform = accountPlatformSlug(account);
  return (
    sessions.find(
      (session) =>
        normalizeCdpPlatform(session.platform) === expectedPlatform &&
        String(session.accountId || "") === String(account.id || ""),
    ) ||
    sessions.find(
      (session) =>
        normalizeCdpPlatform(session.platform) === expectedPlatform &&
        String(session.accountId || "") === String(account.filePath || ""),
    ) ||
    null
  );
}

export type CdpSessionTone = "success" | "warning" | "danger" | "muted";

/** CDP 会话状态 → 展示标签 + tone */
export function cdpSessionChip(
  session: AutoUploadCdpBrowserSession | null,
): { label: string; tone: CdpSessionTone } {
  if (!session) return { label: "未连接", tone: "muted" };
  if (session.status === "ready")
    return { label: "后台已连接", tone: "success" };
  if (session.status === "needs_login")
    return { label: "需登录", tone: "warning" };
  if (session.status === "error")
    return { label: "连接异常", tone: "danger" };
  if (session.status === "unknown") {
    return session.activeProfile
      ? { label: "账号环境已准备", tone: "success" }
      : { label: "未打开后台", tone: "muted" };
  }
  return { label: "等待反馈", tone: "warning" };
}

/** 把本机运行时术语替换为用户友好文案 */
export function cleanUserFacingRuntimeText(
  value: string | null | undefined,
): string {
  return commercialDisplayText(String(value || ""))
    .replace(
      /\bcommercial acceptance injected failure(?:\s+for\s+[^；,，。\n]+)?/gi,
      "发布检查未通过，请重新确认后再试",
    )
    .replace(
      /\b(?:smoke|fixture|acceptance|e2e)[-_ ]?[\w.-]*(?:\s+(?:failed|failure|error))?/gi,
      "发布检查未通过",
    )
    .replace(/3011\s*本地\s*Runtime/g, "本机发布服务")
    .replace(/Chrome\/CDP\s*持久浏览器/g, "本机平台后台")
    .replace(/CDP\s*会话/g, "平台后台连接")
    .replace(/CDP/g, "平台后台")
    .replace(/\bRuntime\b/g, "本机服务")
    .replace(/persistent-cdp-browser/gi, "本机平台后台")
    .replace(/local-browser-engine/gi, "本机浏览器")
    .replace(/\bprofile\b/gi, "登录环境")
    .replace(/engine:\s*/gi, "")
    .replace(/尚未打开\s+本机平台后台/g, "尚未打开平台后台")
    .replace(/本地浏览器\s+本机服务/g, "本机浏览器")
    .replace(/账号\s+登录环境/g, "账号登录环境")
    .replace(/本机浏览器\s+已就绪/g, "本机浏览器已就绪")
    .replace(/账号登录环境\s+已准备/g, "账号登录环境已准备")
    .replace(
      /(?:\/Users|\/Volumes|\/private|\/tmp|\/var)\/[^；,，。\n\r\t)）]+/g,
      (match) => displayFileName(match, "本机文件"),
    )
    .trim();
}

/** 从路径提取可读文件名（去 UUID 前缀） */
export function displayFileName(
  value: string | null | undefined,
  fallback = "本机文件",
): string {
  const text = commercialDisplayText(String(value || "").trim());
  if (!text) return fallback;
  const normalized = text.replace(/\\/g, "/");
  return (
    normalized
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[_-]/i,
        "",
      ) || fallback
  );
}

/** 生成登录请求 ID */
export function createRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
