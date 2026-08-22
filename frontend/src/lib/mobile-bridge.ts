"use client";

/**
 * 移动端能力桥（APK 壳 ↔ Web 双路径）。
 *
 * 设计原则（2026-08-09 产品方向：手机端平台互动适配手机逻辑）：
 * - APK 壳（com.aicontent.mobile）通过 addJavascriptInterface 暴露 window.JiuZhang，
 *   提供 openApp / shareText / copyToClipboard / getInstalledApps 等原生能力。
 * - PWA / 浏览器环境无壳桥时，回退 Web 标准（navigator.share / navigator.clipboard /
 *   深链跳转 / 提示文案），保证两种安装形态都有可用的手机逻辑。
 *
 * 典型用法：
 *   const { isShell, openApp, shareText } = useMobileBridge();
 *   openApp("douyin");          // 调起抖音 App（壳）或深链（PWA）
 *   shareText("回复文案");        // 系统分享面板 / 剪贴板兜底
 */

/** 与 mobile/JsBridge.kt 同步的壳桥方法（未打包新 APK 时这些方法不存在） */
interface JiuZhangBridge {
  version(): string;
  agentStatus(): string;
  asrUpload(base64Audio: string, mimeType: string): string;
  openApp?(packageNameOrDeepLink: string): string;
  shareText?(text: string): string;
  copyToClipboard?(text: string): string;
  getInstalledApps?(): string;
  rpaStatus?(): string;
  /** App 内微信一键登录：拉起微信 SDK 授权，返回 { ok, code?, message }（需企业资质 AppID） */
  wechatLogin?(): string;
  /** MAI-UI 动作执行（PRD M2/M3）：同步执行结构化动作序列，返回 { ok, message } */
  executeActions?(actionsJson: string): string;
  /** ask_user 暂停后继续（true）/ 中止（false） */
  resumeAfterAsk?(proceed: boolean): string;
  /** 中止正在执行的动作序列 */
  cancelActions?(): string;
  /** 截取当前屏幕（无障碍，Android 11+），返回 { ok, message: dataURL } */
  captureScreen?(): string;
}

declare global {
  interface Window {
    JiuZhang?: JiuZhangBridge;
  }
}

export type PlatformKey =
  | "douyin"
  | "xiaohongshu"
  | "shipinhao"
  | "kuaishou"
  | "bilibili"
  | "weibo"
  | "zhihu"
  | "toutiao"
  | "gongzhonghao";

/** 平台 → Android 包名（壳桥 openApp 优先） */
export const PLATFORM_PACKAGE: Record<PlatformKey, string> = {
  douyin: "com.ss.android.ugc.aweme",
  xiaohongshu: "com.xingin.xhs",
  shipinhao: "com.tencent.mm", // 视频号在微信内
  kuaishou: "com.smile.gifmaker",
  bilibili: "tv.danmaku.bili",
  weibo: "com.sina.weibo",
  zhihu: "com.zhihu.android",
  toutiao: "com.ss.android.article.news",
  gongzhonghao: "com.tencent.mm", // 公众号在微信内
};

/** 平台 → 深链（PWA 无壳桥时的跳转兜底；无法保证一定命中） */
export const PLATFORM_DEEP_LINK: Partial<Record<PlatformKey, string>> = {
  douyin: "snssdk1128://",
  xiaohongshu: "xhsdiscover://",
  shipinhao: "weixin://",
  kuaishou: "kuaishou://",
  bilibili: "bilibili://",
  weibo: "sinaweibo://",
  zhihu: "zhihu://",
  gongzhonghao: "weixin://",
};

export const PLATFORM_LABEL: Record<PlatformKey, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  shipinhao: "视频号",
  kuaishou: "快手",
  bilibili: "B站",
  weibo: "微博",
  zhihu: "知乎",
  toutiao: "头条",
  gongzhonghao: "公众号",
};

/** 后端平台 type（1-9）→ PlatformKey，与 platform-accounts 的 PLATFORMS 对齐 */
export function platformTypeToKey(type: number): PlatformKey {
  const map: Record<number, PlatformKey> = {
    1: "xiaohongshu",
    2: "shipinhao",
    3: "douyin",
    4: "kuaishou",
    5: "bilibili",
    6: "weibo",
    7: "zhihu",
    8: "toutiao",
    9: "gongzhonghao",
  };
  return map[type] ?? "douyin";
}

export function isMobileShell(): boolean {
  return typeof window !== "undefined" && typeof window.JiuZhang === "object";
}

/**
 * 调起目标平台 App（登录/会话入口）。
 * - 壳桥：window.JiuZhang.openApp(packageName)（新 APK）
 * - PWA：尝试深链跳转，失败则提示用户手动打开
 * 返回 { ok, mode: "bridge" | "deep-link" | "unsupported", message }
 */
export function openApp(platform: PlatformKey): {
  ok: boolean;
  mode: "bridge" | "deep-link" | "unsupported";
  message: string;
} {
  const pkg = PLATFORM_PACKAGE[platform];
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;

  if (bridge?.openApp) {
    try {
      const raw = bridge.openApp(pkg);
      // 壳返回 JSON：{"ok":bool,"message":string}——必须消费真实结果，
      // 否则未安装时前端会误报「已调起」（2026-08-09 真机体验抓到）。
      if (typeof raw === "string" && raw.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(raw) as { ok?: boolean; message?: string };
          if (parsed && typeof parsed.ok === "boolean") {
            return {
              ok: parsed.ok,
              mode: "bridge",
              message:
                parsed.message ||
                (parsed.ok ? `已调起${PLATFORM_LABEL[platform]}` : "调起失败"),
            };
          }
        } catch {
          // 非 JSON 忽略，走默认成功
        }
      }
      return { ok: true, mode: "bridge", message: `已调起${PLATFORM_LABEL[platform]}` };
    } catch {
      // 壳桥抛错则继续走深链
    }
  }

  const deepLink = PLATFORM_DEEP_LINK[platform];
  if (deepLink) {
    try {
      window.location.href = deepLink;
      return {
        ok: true,
        mode: "deep-link",
        message: `已尝试打开${PLATFORM_LABEL[platform]}，如未跳转请在手机上手动打开`,
      };
    } catch {
      // 深链异常落到 unsupported
    }
  }

  return {
    ok: false,
    mode: "unsupported",
    message: `请在手机上手动打开${PLATFORM_LABEL[platform]} App 完成登录`,
  };
}

/**
 * 一键转发：优先系统分享面板（可直达任意 App），壳桥次之，剪贴板兜底。
 * 返回 { ok, mode, message }
 */
export async function shareText(text: string): Promise<{
  ok: boolean;
  mode: "web-share" | "bridge" | "clipboard" | "unsupported";
  message: string;
}> {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;

  // Web Share API（PWA / Android Chrome 支持系统分享面板）
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return { ok: true, mode: "web-share", message: "已唤起系统分享" };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { ok: false, mode: "web-share", message: "已取消分享" };
      }
      // 分享失败落到壳桥/剪贴板
    }
  }

  if (bridge?.shareText) {
    try {
      const raw = bridge.shareText(text);
      if (typeof raw === "string" && raw.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(raw) as { ok?: boolean; message?: string };
          if (parsed && typeof parsed.ok === "boolean" && parsed.ok) {
            return { ok: true, mode: "bridge", message: parsed.message || "已唤起系统分享" };
          }
        } catch {
          // 非 JSON 忽略，走默认成功
        }
      }
      return { ok: true, mode: "bridge", message: "已唤起系统分享" };
    } catch {
      // 落到剪贴板
    }
  }

  const copied = await copyText(text);
  return copied.ok
    ? { ok: true, mode: "clipboard", message: "已复制到剪贴板，请在目标 App 内粘贴发送" }
    : { ok: false, mode: "unsupported", message: "当前环境不支持分享，请手动复制" };
}

export async function copyText(text: string): Promise<{
  ok: boolean;
  mode: "web-clipboard" | "bridge" | "unsupported";
  message: string;
}> {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, mode: "web-clipboard", message: "已复制" };
    } catch {
      // 落到壳桥
    }
  }

  if (bridge?.copyToClipboard) {
    try {
      bridge.copyToClipboard(text);
      return { ok: true, mode: "bridge", message: "已复制" };
    } catch {
      // 落到 execCommand
    }
  }

  // 最后兜底：隐藏 textarea + execCommand（老 WebView）
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return { ok: true, mode: "unsupported", message: "已复制" };
  } catch {
    // 忽略
  }

  return { ok: false, mode: "unsupported", message: "复制失败，请长按手动复制" };
}

/** 一次性获取桥信息（调试用） */
export function bridgeInfo(): { isShell: boolean; methods: string[] } {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;
  return {
    isShell: Boolean(bridge),
    methods: bridge
      ? ["version", "agentStatus", "asrUpload", "openApp", "shareText", "copyToClipboard", "getInstalledApps", "rpaStatus", "wechatLogin", "executeActions", "resumeAfterAsk", "cancelActions", "captureScreen"].filter(
          (m) => typeof (bridge as unknown as Record<string, unknown>)[m] === "function",
        )
      : [],
  };
}

/**
 * App 内微信一键登录（2026-08-11，需微信开放平台企业资质 AppID）。
 * 调原生壳拉起微信授权，成功回传 code 由后端换取会话。
 * 未开通时壳桥返回 ok:false + message。
 */
export function wechatLogin(): {
  ok: boolean;
  code?: string;
  message: string;
} {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;
  if (!bridge?.wechatLogin) {
    return {
      ok: false,
      message: "当前环境不支持微信一键登录，请使用扫码或账号密码登录",
    };
  }
  try {
    const raw = bridge.wechatLogin();
    if (typeof raw === "string" && raw.trim().startsWith("{")) {
      const parsed = JSON.parse(raw) as {
        ok?: boolean;
        code?: string;
        message?: string;
      };
      return {
        ok: parsed.ok === true,
        code: parsed.code,
        message:
          parsed.message ||
          (parsed.ok ? "微信授权成功" : "微信登录未完成"),
      };
    }
    return { ok: true, message: "已拉起微信授权" };
  } catch {
    return { ok: false, message: "微信登录调用失败，请重试" };
  }
}

/** RPA 无障碍执行器状态（APK 壳内查询；PWA 返回未开启） */
export function rpaStatus(): { enabled: boolean; available: boolean } {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;
  if (bridge?.rpaStatus) {
    try {
      const raw = bridge.rpaStatus();
      const parsed =
        typeof raw === "string" && raw.trim().startsWith("{")
          ? (JSON.parse(raw) as { ok?: boolean; enabled?: boolean })
          : null;
      return {
        enabled: parsed?.enabled === true,
        available: true,
      };
    } catch {
      return { enabled: false, available: true };
    }
  }
  return { enabled: false, available: false };
}

/** MAI-UI 结构化动作（与 /api/mai-ui/actions 返回对齐） */
export interface MaiUiAction {
  action: "click" | "input" | "swipe" | "wait" | "back" | "home" | "ask_user" | "done" | string;
  target?: string;
  bounds?: [number, number, number, number];
  text?: string;
  direction?: "up" | "down" | "left" | "right";
  distance?: number;
  ms?: number;
  question?: string;
  summary?: string;
}

export interface MaiUiExecResult {
  ok: boolean;
  message: string;
}

/**
 * 在手机壳执行 MAI-UI 动作序列（需无障碍权限已开启）。
 * 同步等待结果；ask_user 时返回 message 以 "ASK_USER:" 开头，需调 resumeAfterAsk 继续。
 */
export function executeActions(actions: MaiUiAction[]): MaiUiExecResult {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;
  if (!bridge?.executeActions) {
    return { ok: false, message: "当前不在 JIUZHANG AI App 内，无法执行设备操作" };
  }
  try {
    const raw = bridge.executeActions(JSON.stringify(actions));
    const parsed =
      typeof raw === "string" && raw.trim().startsWith("{")
        ? (JSON.parse(raw) as MaiUiExecResult)
        : null;
    return parsed ?? { ok: false, message: "执行结果解析失败" };
  } catch {
    return { ok: false, message: "动作执行调用失败" };
  }
}

/** ask_user 暂停后继续执行 */
export function resumeAfterAsk(proceed: boolean): MaiUiExecResult {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;
  if (!bridge?.resumeAfterAsk) return { ok: false, message: "桥方法不可用" };
  try {
    const raw = bridge.resumeAfterAsk(proceed);
    const parsed = typeof raw === "string" && raw.trim().startsWith("{")
      ? (JSON.parse(raw) as MaiUiExecResult)
      : null;
    return parsed ?? { ok: false, message: "解析失败" };
  } catch {
    return { ok: false, message: "调用失败" };
  }
}

/** 中止动作执行 */
export function cancelActions(): MaiUiExecResult {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;
  if (!bridge?.cancelActions) return { ok: false, message: "桥方法不可用" };
  try {
    const raw = bridge.cancelActions();
    const parsed = typeof raw === "string" && raw.trim().startsWith("{")
      ? (JSON.parse(raw) as MaiUiExecResult)
      : null;
    return parsed ?? { ok: false, message: "解析失败" };
  } catch {
    return { ok: false, message: "调用失败" };
  }
}

/** 截取当前屏幕（需 Android 11+ 且无障碍已开启），成功时 message 为 data:image/jpeg;base64 */
export function captureScreen(): MaiUiExecResult {
  const bridge = typeof window !== "undefined" ? window.JiuZhang : undefined;
  if (!bridge?.captureScreen) return { ok: false, message: "当前不在 JIUZHANG AI App 内，无法截屏" };
  try {
    const raw = bridge.captureScreen();
    const parsed = typeof raw === "string" && raw.trim().startsWith("{")
      ? (JSON.parse(raw) as MaiUiExecResult)
      : null;
    return parsed ?? { ok: false, message: "截图结果解析失败" };
  } catch {
    return { ok: false, message: "截图调用失败" };
  }
}