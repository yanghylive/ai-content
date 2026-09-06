"use client";

import React, { Suspense } from "react";
import { Button, Card, CardBody, Input, Spinner, cn } from "@heroui/react";
import {
  ExternalLink,
  EyeClosed,
  EyeOpen,
  KeyRound,
  LayoutDashboard,
  LogIn,
  MapPinned,
  ShieldCheck,
} from "@/components/iconpark";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "@/lib/toast";
import { authApi, kaypalApi, type AuthUser } from "@/lib/api/auth";
import { ApiError, getApiBase } from "@/lib/api/client";
import { toPublicError, toActionableError } from "@/lib/public-error";
import { isMobileShell } from "@/lib/mobile-bridge";
import LoginRuntime from "./login-runtime";
import "./login-custom.css";

const KAYPAL_DEVICE_AUTH_STATE_KEY = "kaypal_device_auth_state_v1";

type PersistedDeviceAuthState = {
  deviceCode: string;
  deviceId: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  pollInterval: number;
};

function saveDeviceAuthState(state: PersistedDeviceAuthState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KAYPAL_DEVICE_AUTH_STATE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // 忽略写入失败（隐私模式等）
  }
}

function loadDeviceAuthState(): PersistedDeviceAuthState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KAYPAL_DEVICE_AUTH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDeviceAuthState;
    if (!parsed.deviceCode || !parsed.deviceId || !parsed.expiresAt) {
      return null;
    }
    if (Date.now() >= parsed.expiresAt) {
      window.localStorage.removeItem(KAYPAL_DEVICE_AUTH_STATE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearDeviceAuthState() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KAYPAL_DEVICE_AUTH_STATE_KEY);
  } catch {
    // 忽略
  }
}

type Phase =
  | "loading"
  | "idle"
  | "starting"
  | "waiting"
  | "expired"
  | "denied"
  | "error";

const KAYPAL_DESKTOP_DEVICE_ID_KEY = "kaypal.aiContent.desktopDeviceId";
const MAX_POLL_RETRY_MS = 15000;

function hasKaypalDesktopSession(user: AuthUser | null | undefined) {
  return user?.hasKaypalDesktopSession === true;
}

function normalizeNextPath(value: string | null) {
  const fallback = "/";
  const nextPath = value?.trim() || fallback;
  if (
    !nextPath.startsWith("/") ||
    nextPath.startsWith("//") ||
    nextPath.includes("\\") ||
    /^[a-z][a-z\d+.-]*:/i.test(nextPath) ||
    Array.from(nextPath).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return fallback;
  }
  return nextPath;
}

function getKaypalDesktopDeviceId(platform: string) {
  if (typeof window === "undefined") {
    return `${platform}-${Date.now().toString(36)}`;
  }
  const existing = window.localStorage.getItem(KAYPAL_DESKTOP_DEVICE_ID_KEY);
  if (existing?.startsWith(`${platform}-`)) {
    return existing;
  }
  const randomId =
    existing?.replace(/^[^-]+-/, "") ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`);
  const nextDeviceId = `${platform}-${randomId}`;
  window.localStorage.setItem(KAYPAL_DESKTOP_DEVICE_ID_KEY, nextDeviceId);
  return nextDeviceId;
}

async function getKaypalDesktopDeviceMetadata() {
  try {
    const nativePlatform = await window.electronAPI?.app?.getPlatform();
    if (nativePlatform === "win32") {
      return {
        idPlatform: "windows",
        deviceName: "JIUZHANG AI (Windows)",
        platform: "windows",
      };
    }
    if (nativePlatform === "darwin") {
      return {
        idPlatform: "macos",
        deviceName: "JIUZHANG AI (macOS)",
        platform: "macos",
      };
    }
    if (nativePlatform === "linux") {
      return {
        idPlatform: "linux",
        deviceName: "JIUZHANG AI (Linux)",
        platform: "linux",
      };
    }
  } catch {
    // Browser fallback below keeps the login page usable outside Electron.
  }
  return {
    idPlatform: "web",
    deviceName: "JIUZHANG AI (Web)",
    platform: "web",
  };
}

function isAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /请先登录|登录状态|授权.*失效|授权.*过期|重新登录|401|unauthorized/i.test(
    message,
  );
}

function isDeviceAuthExpired(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    (error instanceof ApiError && error.status === 410) ||
    /授权(?:会话|码)?.*(?:过期|失效|不存在)|(?:expired|invalid).*(?:device|authorization).*(?:code|session)/i.test(
      message,
    )
  );
}

function isRetryablePollError(error: unknown) {
  if (error instanceof ApiError) {
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  const message = error instanceof Error ? error.message : String(error || "");
  return /network|fetch|timeout|timed out|网络|连接|超时|暂时不可用/i.test(
    message,
  );
}

function LoginPageFallback() {
  return (
    <div className="min-h-screen w-full bg-default-50 p-0">
      <div className="flex min-h-[100dvh] w-full items-center justify-center">
        <Card className="p-4">
          <CardBody className="flex items-center gap-2 p-0">
            <Spinner size="sm" />
            <span className="text-small text-default-500">
              正在检查登录状态...
            </span>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = normalizeNextPath(searchParams.get("next"));
  const forceReauth = searchParams.get("reauth") === "1";
  // kaypal 账号自助服务回跳状态：注册/改密完成后回跳本地登录页提示
  const registered = searchParams.get("registered") === "1";
  const passwordReset = searchParams.get("passwordReset") === "1";

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [deviceCode, setDeviceCode] = React.useState<string | null>(null);
  const [deviceId, setDeviceId] = React.useState<string | null>(null);
  const [userCode, setUserCode] = React.useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = React.useState<string | null>(
    null,
  );
  const [expiresIn, setExpiresIn] = React.useState<number | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null);
  const [pollInterval, setPollInterval] = React.useState<number>(5);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const hasNavigatedRef = React.useRef(false);
  const startInFlightRef = React.useRef(false);
  /* 账号密码登录（参考 WorkBuddy 手机版：直接填账号密码，一步进入） */
  const [loginTab, setLoginTab] = React.useState<"sso" | "password" | "wechat">(
    "sso",
  );
  /* 移动端（手机/APK WebView）没有桌面 Electron bridge，设备码授权无法工作。
     直接隐藏「扫码/授权码」入口，只保留账号密码登录，避免真机报
     「登录授权未能启动」。桌面端/PC 浏览器仍显示该 tab。 */
  React.useEffect(() => {
    if (typeof navigator === "undefined") return;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (mobile) setLoginTab("password");
  }, []);

  // kaypal 账号自助服务回跳提示：注册成功 / 密码已重置
  React.useEffect(() => {
    if (registered) toast("注册成功，请用新账号登录");
    else if (passwordReset) toast("密码已重置，请重新登录");
  }, [registered, passwordReset]);

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberAccount, setRememberAccount] = React.useState(true);
  const [passwordSubmitting, setPasswordSubmitting] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(
    null,
  );

  const handlePasswordLogin = async () => {
    if (!username.trim() || !password) {
      setPasswordError("请输入账号和密码");
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError(null);
    try {
      await authApi.login(username.trim(), password);
      // 记住账号和密码（Electron safeStorage 加密；网页版仅记账号）
      const desktopBridge =
        (window as unknown as { electronAPI?: { system?: { secureStoreGet?: (k: string) => Promise<unknown>; secureStoreSet?: (k: string, v: string) => Promise<unknown>; secureStoreDelete?: (k: string) => Promise<unknown> } } })
          .electronAPI?.system;
      if (desktopBridge?.secureStoreSet) {
        if (rememberAccount) {
          void desktopBridge.secureStoreSet(
            "login",
            JSON.stringify({ username: username.trim(), password }),
          );
        } else if (desktopBridge.secureStoreDelete) {
          void desktopBridge.secureStoreDelete("login");
        }
      } else if (rememberAccount) {
        try {
          window.localStorage.setItem("kaypal_remembered_username", username.trim());
        } catch {
          // 忽略
        }
      }
      navigateToNext();
    } catch (error) {
      setPasswordError(
        toPublicError(error, "登录失败，请检查账号和密码后重试。"),
      );
      setPasswordSubmitting(false);
    }
  };

  const handleWechatLogin = React.useCallback(() => {
    const apiBase = getApiBase().replace(/\/$/, "");
    const wechatStart = apiBase.endsWith("/api")
      ? `${apiBase}/auth/wechat/start`
      : `${apiBase}/api/auth/wechat/start`;
    const origin = encodeURIComponent(window.location.origin);
    window.location.href = `${wechatStart}?origin=${origin}&next=${encodeURIComponent(nextPath)}`;
  }, [nextPath]);

  /** 跳转 kaypal.cn 账号自助服务（注册 / 忘记密码），完成后回跳本地登录页 */
  const handleKaypalAccount = React.useCallback(
    (action: "register" | "forgot-password") => {
      const apiBase = getApiBase().replace(/\/$/, "");
      const path =
        action === "register"
          ? "register-redirect"
          : "forgot-password-redirect";
      const endpoint = apiBase.endsWith("/api")
        ? `${apiBase}/auth/${path}`
        : `${apiBase}/api/auth/${path}`;
      const origin = encodeURIComponent(window.location.origin);
      window.location.href = `${endpoint}?origin=${origin}&next=${encodeURIComponent(nextPath)}`;
    },
    [nextPath],
  );

  const navigateToNext = React.useCallback(() => {
    if (hasNavigatedRef.current) {
      return;
    }
    hasNavigatedRef.current = true;
    if (typeof window !== "undefined") {
      window.location.replace(nextPath);
      return;
    }
    router.replace(nextPath);
  }, [nextPath, router]);

  const resetDeviceAuth = React.useCallback(() => {
    clearDeviceAuthState();
    setDeviceCode(null);
    setDeviceId(null);
    setUserCode(null);
    setVerificationUrl(null);
    setExpiresIn(null);
    setExpiresAt(null);
    setErrorMessage(null);
    setPhase("idle");
  }, []);

  const markDeviceAuthExpired = React.useCallback(() => {
    clearDeviceAuthState();
    setErrorMessage("本次验证码已过期，请获取新的验证码后继续。");
    setPhase("expired");
  }, []);

  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;
    const startedAt = Date.now();
    const maxBootstrapWaitMs = 20000;

    // 回填记住的登录凭据（Electron safeStorage；网页版仅用户名）
    const restoreRemembered = async () => {
      const desktopBridge =
        (window as unknown as { electronAPI?: { system?: { secureStoreGet?: (k: string) => Promise<unknown> } } })
          .electronAPI?.system;
      if (desktopBridge?.secureStoreGet) {
        try {
          const raw = await desktopBridge.secureStoreGet("login");
          if (typeof raw === "string" && raw) {
            const parsed = JSON.parse(raw) as {
              username?: string;
              password?: string;
            };
            if (parsed.username) setUsername(parsed.username);
            if (parsed.password) setPassword(parsed.password);
          }
        } catch {
          // 忽略损坏的凭据
        }
        return;
      }
      try {
        const remembered = window.localStorage.getItem("kaypal_remembered_username");
        if (remembered) setUsername(remembered);
      } catch {
        // 忽略
      }
    };
    void restoreRemembered();

    const bootstrap = async () => {
      try {
        requestController = new AbortController();
        const currentUser = await authApi.me({
          signal: requestController.signal,
        });
        if (!forceReauth && active && hasKaypalDesktopSession(currentUser)) {
          navigateToNext();
          return;
        }
      } catch (error) {
        if (active && isAuthFailure(error)) {
          // 未登录：检查是否之前已发起设备码授权且未过期，
          // 是则自动恢复 waiting 阶段（移动端从 kaypal 授权页返回 /today 后能继续轮询）
          const persisted = loadDeviceAuthState();
          if (active && persisted && !forceReauth) {
            setDeviceId(persisted.deviceId);
            setDeviceCode(persisted.deviceCode);
            setUserCode(persisted.userCode);
            setVerificationUrl(persisted.verificationUrl);
            setExpiresAt(persisted.expiresAt);
            setPollInterval(persisted.pollInterval);
            setExpiresIn(
              Math.max(1, Math.round((persisted.expiresAt - Date.now()) / 1000)),
            );
            setLoginTab("sso");
            setPhase("waiting");
            return;
          }
          setPhase("idle");
          return;
        }
        // 桌面版前端可能比本地后端更早启动；给 3011 一段就绪时间。
        if (active && Date.now() - startedAt < maxBootstrapWaitMs) {
          timer = setTimeout(bootstrap, 800);
          return;
        }
      }
      if (active) setPhase("idle");
    };

    bootstrap();
    return () => {
      active = false;
      requestController?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [forceReauth, navigateToNext]);

  const startDeviceAuth = React.useCallback(async () => {
    if (startInFlightRef.current) {
      return;
    }
    startInFlightRef.current = true;
    setPhase("starting");
    setErrorMessage(null);
    setDeviceCode(null);
    setUserCode(null);
    setVerificationUrl(null);
    setExpiresIn(null);
    setExpiresAt(null);
    try {
      const deviceMetadata = await getKaypalDesktopDeviceMetadata();
      const newDeviceId = getKaypalDesktopDeviceId(deviceMetadata.idPlatform);
      const result = await kaypalApi.startKaypalDeviceAuth({
        deviceId: newDeviceId,
        deviceName: deviceMetadata.deviceName,
        platform: deviceMetadata.platform,
      });
      const expiresInSeconds = Number.isFinite(result.expiresIn)
        ? Math.max(1, result.expiresIn)
        : 600;
      const pollIntervalSeconds = Number.isFinite(result.interval)
        ? Math.max(1, Math.min(60, result.interval))
        : 5;
      setDeviceId(newDeviceId);
      setDeviceCode(result.deviceCode);
      setUserCode(result.userCode);
      setVerificationUrl(result.verificationUrl);
      setExpiresIn(expiresInSeconds);
      const nextExpiresAt = Date.now() + expiresInSeconds * 1000;
      setExpiresAt(nextExpiresAt);
      setPollInterval(pollIntervalSeconds);
      saveDeviceAuthState({
        deviceCode: result.deviceCode,
        deviceId: newDeviceId,
        userCode: result.userCode,
        verificationUrl: result.verificationUrl,
        expiresAt: nextExpiresAt,
        pollInterval: pollIntervalSeconds,
      });
      setPhase("waiting");
    } catch (error) {
      // 不再用 toPublicError 吞掉真错误——移动端调试需要看到原始 status/message
      console.error("[device-auth] start failed:", error);
      const message = toActionableError(
        error,
        "登录未能启动，请稍后重试。",
      );
      setErrorMessage(message);
      setPhase("error");
    } finally {
      startInFlightRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    if (phase !== "waiting" || !expiresAt) return;
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      markDeviceAuthExpired();
      return;
    }
    const timer = setTimeout(markDeviceAuthExpired, remainingMs);
    return () => clearTimeout(timer);
  }, [expiresAt, markDeviceAuthExpired, phase]);

  React.useEffect(() => {
    if (phase !== "waiting" || !deviceCode || !deviceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;
    let consecutiveFailures = 0;
    const intervalMs = Math.max(1000, pollInterval * 1000);

    const schedulePoll = (delayMs: number) => {
      if (cancelled) return;
      if (expiresAt) {
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
          markDeviceAuthExpired();
          return;
        }
        timer = setTimeout(poll, Math.min(delayMs, remainingMs));
        return;
      }
      timer = setTimeout(poll, delayMs);
    };

    const poll = async () => {
      if (cancelled) return;
      if (expiresAt && Date.now() >= expiresAt) {
        markDeviceAuthExpired();
        return;
      }
      try {
        requestController = new AbortController();
        const result = await kaypalApi.pollKaypalDeviceAuth(
          {
            deviceCode,
            deviceId,
            forceReauth,
          },
          { signal: requestController.signal },
        );
        if (cancelled) return;
        if (result.status === "authorized") {
          if (result.tenantId) {
            window.localStorage.setItem(
              "ai_content_tenant_id",
              result.tenantId,
            );
          }
          clearDeviceAuthState();
          toast.success(
            `已通过 JIUZHANG AI 登录：${result.user?.name || result.user?.username || "JIUZHANG AI 用户"}`,
          );
          navigateToNext();
          return;
        }
        if (result.status === "denied") {
          setPhase("denied");
          setErrorMessage("没有完成确认，请重试，请重新发起。");
          return;
        }
        consecutiveFailures = 0;
        setErrorMessage(null);
        schedulePoll(intervalMs);
      } catch (error) {
        if (cancelled) return;
        if (isDeviceAuthExpired(error)) {
          markDeviceAuthExpired();
          return;
        }
        if (isRetryablePollError(error)) {
          consecutiveFailures += 1;
          setErrorMessage(
            "账号服务连接暂时不稳定，正在自动重试。请保留当前页面。",
          );
          const retryDelayMs = Math.min(
            MAX_POLL_RETRY_MS,
            intervalMs * 2 ** Math.min(consecutiveFailures - 1, 3),
          );
          schedulePoll(retryDelayMs);
          return;
        }
        setErrorMessage("本次登录未能继续，请重新获取验证码。");
        setPhase("error");
      }
    };

    schedulePoll(Math.min(1000, intervalMs));
    return () => {
      cancelled = true;
      requestController?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    phase,
    deviceCode,
    deviceId,
    expiresAt,
    pollInterval,
    forceReauth,
    markDeviceAuthExpired,
    navigateToNext,
  ]);

  React.useEffect(() => {
    if (phase !== "waiting" || forceReauth) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;

    const probeExistingSession = async () => {
      if (cancelled) return;
      try {
        requestController = new AbortController();
        const currentUser = await authApi.me({
          signal: requestController.signal,
        });
        if (!cancelled && hasKaypalDesktopSession(currentUser)) {
          navigateToNext();
          return;
        }
      } catch {
        // 仍未写入本地登录态，继续等待 JIUZHANG AI 授权轮询。
      }
      if (!cancelled) {
        timer = setTimeout(probeExistingSession, 1500);
      }
    };

    timer = setTimeout(probeExistingSession, 1200);
    return () => {
      cancelled = true;
      requestController?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [phase, forceReauth, expiresAt, navigateToNext]);

  if (phase === "loading") {
    return <LoginPageFallback />;
  }

  return (
    <div className="login-preview min-h-screen w-full p-0">
      <div className="login-preview-center flex w-full items-center justify-center">
        <div className="login-preview-stack flex flex-col gap-6 max-w-[1184px] min-h-[100dvh] py-4 px-6 w-full">
          {/* 左上品牌区已移除（2026-09-05）：桌面壳顶栏已有 JIUZHANG AI 字标，
              登录页再放 icon+文字就是重复曝光；header 保留只为撑住布局高度，
              右侧「企业级安全登录」徽章照常。 */}
          <header className="login-preview-header flex flex-row justify-end items-center">
            <div className="hidden sm:flex flex-row items-center gap-2">
              <ShieldCheck
                aria-hidden="true"
                className="h-4 w-4"
                strokeWidth={1.75}
              />
              <span className="text-primary text-small font-semibold">企业级安全登录</span>
            </div>
          </header>

          <div
            className="login-preview-grid flex-1 grid items-center gap-10 w-full"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
          >
            {/* P2-18：hero 营销区紧凑化——缩小间距/字号/图标，首屏占用从约 1/3 降下来 */}
            <section className="login-preview-hero order-last md:order-first flex flex-col gap-3 max-w-[640px]">
              {/* 融入式场景（F1 月夜山水）：九妹儿=hero 背景本身而非贴纸，
                  文字坐左侧暗部留白；veil 渐变保对比度（CSS 内定义） */}
              <div className="login-preview-hero-scene" aria-hidden="true">
                <span className="scene-aurora" /><span className="scene-water" /><span className="scene-glow" /><span className="scene-stars" /><span className="scene-shoot scene-shoot-one" /><span className="scene-shoot scene-shoot-two" /><span className="scene-glasses" /><span className="scene-glasses-two" />
              </div>
              <div className="login-preview-hero-copy flex flex-col gap-2">
                <span className="preview-kicker text-small font-bold text-default-500">AI 智慧员工平台 · DIGITAL WORKFORCE</span>
                <h1 className="text-3xl font-bold text-balance">不是工具，<br /><em>是会成长的智慧员工。</em></h1>
                <p className="text-lg text-default-500 text-pretty">九妹儿带队的 AI 员工团队，替你盯机会、写内容、发出去、聊客户——每一份工作可执行、可追踪、可复用，也会越干越懂你的生意。</p>
                <span className="preview-credit">JIU MEIER · 九妹儿 · 智慧员工团队主管</span>
              </div>

              <div
                className="login-preview-features grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))" }}
              >
                {[
                  { label: "员工会找", value: "情报 · 趋势 · 选题", icon: LayoutDashboard },
                  { label: "员工会写", value: "文字 · 图片 · 视频", icon: KeyRound },
                  { label: "员工会聊", value: "线索 · 微信 · CRM", icon: MapPinned },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-row items-center gap-2"
                  >
                    <div className="flex h-6 w-6 items-center justify-center">
                      <item.icon
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.75}
                      />
                    </div>
                    <div className="flex flex-col gap-0">
                      <span className="text-default-500 text-small font-semibold">
                        {item.label}
                      </span>
                      <span className="text-sm font-bold">
                        {item.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="preview-system-visual" aria-label="九章智能工作流预览">
                <span className="preview-glow" /><span className="preview-ring preview-ring-one" /><span className="preview-ring preview-ring-two" /><span className="preview-ring preview-ring-three" /><span className="preview-ring preview-ring-four" /><span className="preview-pulse-ring" />
                <span className="preview-core">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src="/brand/jiuzhang-ai-icon.webp" width={512} height={512} />
                  </span>
                {[
                  ["01", "发现机会", "情报 · 趋势 · 选题", "preview-node-one"],
                  ["02", "智能创作", "文字 · 图片 · 视频", "preview-node-two"],
                  ["04", "沉淀客户", "线索 · 微信 · CRM", "preview-node-three"],
                  ["03", "全域触达", "发布 · 互动 · 跟进", "preview-node-four"],
                ].map(([number, title, detail, className]) => <span className={`preview-node ${className}`} key={number}><i>{number}</i><b>{title}</b><small>{detail}</small></span>)}
                <span className="preview-connector preview-connector-one" /><span className="preview-connector preview-connector-two" /><span className="preview-connector preview-connector-three" /><span className="preview-connector preview-connector-four" />
              </div>
              <div className="preview-stage-footer flex flex-row gap-4">
                <span className="text-small text-default-500"><i />中国主流内容平台</span><span className="text-small text-default-500"><i />智能建议与实际操作结合</span><span className="text-small text-default-500"><i />关键任务全程留痕</span>
              </div>
            </section>

            <Card className="login-preview-card order-first md:order-last max-w-[440px] w-full p-6">
              <CardBody className="p-0">
                <div className="login-preview-card-inner flex flex-col gap-5">
                  <div className="login-preview-card-head flex flex-col gap-3">
                    <div className="flex h-10 w-10 items-center justify-center">
                      <KeyRound
                        aria-hidden="true"
                        className="h-5 w-5"
                        strokeWidth={1.75}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="preview-login-kicker text-small text-default-500">WELCOME TO JIUZHANG AI</span>
                      <h2 className="text-xl font-semibold">{phase === "waiting" ? "请在 JIUZHANG AI 页面确认" : forceReauth ? "重新登录账号" : "进入九章智慧员工系统"}</h2>
                      <p className="text-small text-default-500">
                        {phase === "waiting"
                          ? "确认后会自动进入当前工作台。"
                          : forceReauth
                            ? "确认后即可重新登录。"
                            : "选择一种方式登录。"}
                      </p>
                    </div>
                  </div>

                  {phase === "idle" ||
                  phase === "starting" ||
                  phase === "error" ? (
                    <div className="login-preview-form flex flex-col gap-4">
                      <div className="preview-tabs flex flex-row gap-2">
                        {(
                          [
                            { key: "sso", label: "九章账号" },
                            { key: "password", label: "账号密码" },
                            { key: "wechat", label: "微信登录" },
                          ] as const
                        )
                          .map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setLoginTab(tab.key)}
                            className={cn("preview-tab", loginTab === tab.key && "active")}
                            style={{
                              border: "1px solid transparent",
                              cursor: "pointer",
                            }}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      {loginTab === "sso" ? (
                        <div className="sso-pane flex flex-col gap-3">
                          <div className="sso-hero flex flex-col gap-3">
                            <div className="sso-head flex flex-row items-center gap-3">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img alt="" src="/brand/jiuzhang-logo.webp" width={400} height={400} />
                              <div className="flex flex-col gap-0"><span className="text-sm font-bold">使用 JIUZHANG AI 账号</span><span className="text-small text-default-500">登录一次，全端可用</span></div>
                            </div>
                            <p className="text-sm">用你的 JIUZHANG AI 账号一键登录，登录后即可直接开始工作。</p>
                            <div
                              className="sso-points grid gap-2"
                              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
                            >
                              {["自动识别当前账号", "随时可以退出登录", "工作区内容自动同步", "操作记录安全留存"].map((point) => <span key={point} className="text-small text-default-500"><b>✓</b>{point}</span>)}
                            </div>
                            <Button className="preview-main-button login-action-button w-full" color="primary" isLoading={phase === "starting"} onPress={() => void startDeviceAuth()}>
                              {phase === "starting" ? "正在准备 JIUZHANG AI 登录..." : "使用 JIUZHANG AI 账号继续"}
                            </Button>
                          </div>
                          <span className="sso-note text-small text-default-500">登录由 JIUZHANG AI 官方完成，本页面不会读取你的密码</span>
                        </div>
                      ) : loginTab === "password" ? (
                        <div className="flex flex-col gap-3">
                          <Input
                            id="login-username"
                            label="手机号 / 邮箱"
                            labelPlacement="outside"
                            placeholder="手机号或邮箱"
                            value={username}
                            onValueChange={(value) => setUsername(value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handlePasswordLogin();
                            }}
                            className="w-full"
                          />
                          <Input
                            id="login-password"
                            label="密码"
                            labelPlacement="outside"
                            type={showPassword ? "text" : "password"}
                            placeholder="输入密码"
                            value={password}
                            onValueChange={(value) => setPassword(value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handlePasswordLogin();
                            }}
                            className="w-full"
                            endContent={
                              <button
                                type="button"
                                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                                title={showPassword ? "隐藏密码" : "显示密码"}
                                onClick={() => setShowPassword((v) => !v)}
                                className="flex items-center justify-center rounded-md p-1 text-default-400 transition-colors hover:bg-default-100 hover:text-default-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                              >
                                {showPassword ? (
                                  <EyeClosed aria-hidden="true" className="h-4 w-4" />
                                ) : (
                                  <EyeOpen aria-hidden="true" className="h-4 w-4" />
                                )}
                              </button>
                            }
                          />
                          <label
                            htmlFor="login-remember"
                            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                          >
                            <input
                              id="login-remember"
                              type="checkbox"
                              checked={rememberAccount}
                              onChange={(e) => setRememberAccount(e.target.checked)}
                              style={{ width: 16, height: 16, accentColor: "var(--kaypal-v3-amber)" }}
                            />
                            <span style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)" }}>
                              记住账号和密码（本机加密保存）
                            </span>
                          </label>
                          <Button
                            className="preview-main-button login-action-button w-full"
                            color="primary"
                            isDisabled={passwordSubmitting}
                            startContent={
                              passwordSubmitting ? (
                                <Spinner aria-label="登录中" size="sm" />
                              ) : null
                            }
                            onPress={() => void handlePasswordLogin()}
                          >
                            {passwordSubmitting ? "正在登录..." : "登录"}
                          </Button>
                          {passwordError ? (
                            <div className="flex flex-col gap-1 rounded-lg border border-danger-200 bg-danger-50 p-4">
                              <p className="font-semibold text-danger">登录失败</p>
                              <p className="text-sm text-danger-600">{passwordError}</p>
                            </div>
                          ) : null}
                          {/* 忘记密码 / 注册：共用 kaypal.cn 账号自助服务，跳转后完成回跳本地登录页 */}
                          <div className="flex flex-row gap-4 justify-center items-center">
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                handleKaypalAccount("forgot-password");
                              }}
                              className="text-13 font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                            >
                              忘记密码？
                            </a>
                            <span
                              style={{
                                width: 1,
                                height: 12,
                                background: "var(--border)",
                              }}
                            />
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                handleKaypalAccount("register");
                              }}
                              className="text-13 font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                            >
                              注册账号
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="qr-pane flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-semibold">微信扫码登录</h3>
                            <span className="text-small text-default-500">点击按钮，用微信扫码完成登录，确认后会自动回到本页。</span>
                          </div>
                          {!isMobileShell() && (
                            <Button className="preview-main-button qr-login-button login-action-button w-full" color="primary" onPress={handleWechatLogin}>
                              使用微信登录
                            </Button>
                          )}
                          {/* 统一账号收编（2026-08-19）：App 内登录并入九章统一账号
                              （设备授权调起 kaypal 网页登录，手机号/微信/密码在统一账号中心完成），
                              不再走微信开放平台 openid 独立建号。 */}
                          {isMobileShell() && (
                            <Button
                              className="preview-main-button qr-login-button login-action-button w-full"
                              variant="flat"
                              onPress={() => void startDeviceAuth()}
                            >
                              微信一键登录（九章账号）
                            </Button>
                          )}
                        </div>
                      )}
                      <span className="preview-signup text-small text-default-500">还没有九章账号？<a href="#" onClick={(event) => { event.preventDefault(); handleKaypalAccount("register"); }}>申请体验</a></span>
                    </div>
                  ) : null}

                  {phase === "waiting" && userCode && verificationUrl ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-4 p-4">
                        <div className="flex flex-col gap-2">
                          <span className="text-default-500 text-small font-bold">
                            1. 打开 JIUZHANG AI 登录页
                          </span>
                          <Button
                            className="w-full"
                            color="primary"
                            startContent={
                              <ExternalLink
                                aria-hidden="true"
                                className="h-4 w-4"
                                strokeWidth={1.75}
                              />
                            }
                            onPress={() => {
                              // 桌面 Electron：走系统浏览器打开确认页（避免当前窗口被导航走）；
                              // 浏览器：新标签页打开确认页，当前登录页保持轮询等待授权结果。
                              // （2026-08-19 修复：原 window.location.href 同页跳转，
                              //   授权后当前页已被导航走，轮询/会话恢复逻辑丢失。）
                              if (typeof window === "undefined" || !verificationUrl) {
                                return;
                              }
                              const desktopBridge =
                                (window as unknown as { electronAPI?: { system?: { openExternal?: (url: string) => Promise<unknown> } } })
                                  .electronAPI?.system;
                              if (desktopBridge?.openExternal) {
                                void desktopBridge.openExternal(verificationUrl);
                                return;
                              }
                              // 2026-09-01 修复：window.open 第三参 "noopener" 会让规范浏览器
                              // 恒返回 null（无论弹窗是否打开），导致"被拦截"误报。
                              // 改用 "_blank"（现代浏览器默认隐式 noopener），
                              // 再手动剥离 opener，使空引用只代表真正的拦截。
                              const popup = window.open(
                                verificationUrl,
                                "_blank",
                              );
                              if (!popup) {
                                toast.error(
                                  "浏览器拦截了弹窗，请允许本站点弹出窗口后重试",
                                );
                              } else {
                                popup.opener = null;
                              }
                            }}
                          >
                            打开确认页面
                          </Button>
                        </div>
                        <div className="flex flex-col gap-2">
                          <span className="text-default-500 text-small font-bold">
                            2. 输入页面上的验证码
                          </span>
                          <Button
                            className="w-full"
                            variant="flat"
                            aria-label={`点击复制 ${userCode}`}
                            onPress={() => {
                              // 桌面 Electron：走主进程原生剪贴板（renderer 的 navigator.clipboard 可能被权限拒绝）
                              const desktopBridge =
                                (window as unknown as { electronAPI?: { system?: { writeClipboard?: (text: string) => Promise<unknown> } } })
                                  .electronAPI?.system;
                              if (desktopBridge?.writeClipboard) {
                                void desktopBridge
                                  .writeClipboard(userCode)
                                  .then((ok) => {
                                    if (ok) toast.success("验证码已复制");
                                    else toast.error("复制失败");
                                  })
                                  .catch(() => toast.error("复制失败"));
                                return;
                              }
                              if (
                                typeof navigator !== "undefined" &&
                                navigator.clipboard
                              ) {
                                navigator.clipboard.writeText(userCode).then(
                                  () => toast.success("验证码已复制"),
                                  () => toast.error("复制失败"),
                                );
                              }
                            }}
                          >
                            <div className="flex flex-row justify-between items-center w-full">
                              <span className="font-mono text-sm font-bold tabular-nums">
                                {userCode}
                              </span>
                              <span className="text-small text-default-500">
                                点击复制
                              </span>
                            </div>
                          </Button>
                        </div>
                        <p className="text-small text-default-500">
                          3. 在打开的页面确认登录，确认后会自动回到这里。
                        </p>
                        {errorMessage ? (
                          <div className="flex flex-col gap-1 rounded-lg border border-warning-200 bg-warning-50 p-4">
                            <p className="font-semibold text-warning">网络恢复中</p>
                            <p className="text-sm text-warning-600">{errorMessage}</p>
                          </div>
                        ) : null}
                        {expiresIn ? (
                          <span className="text-small text-default-500">
                            验证码 {Math.round(expiresIn / 60)} 分钟内有效
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Spinner size="sm" />
                        <span className="text-small text-default-500">
                          {errorMessage
                            ? "网络恢复中，正在自动重试..."
                            : "等待确认中..."}
                        </span>
                      </div>
                      <Button
                        className="w-full"
                        variant="light"
                        onPress={resetDeviceAuth}
                      >
                        重新发起
                      </Button>
                    </div>
                  ) : null}

                  {phase === "expired" ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1 rounded-lg border border-warning-200 bg-warning-50 p-4">
                        <p className="font-semibold text-warning">验证码已过期</p>
                        <p className="text-sm text-warning-600">
                          {errorMessage ||
                            "本次验证码已过期，请获取新的验证码后继续。"}
                        </p>
                      </div>
                      <Button
                        className="w-full"
                        color="primary"
                        onPress={() => void startDeviceAuth()}
                      >
                        获取新验证码
                      </Button>
                    </div>
                  ) : null}

                  {phase === "denied" ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1 rounded-lg border border-warning-200 bg-warning-50 p-4">
                        <p className="font-semibold text-warning">登录未确认</p>
                        <p className="text-sm text-warning-600">
                          {errorMessage || "没有完成确认，请重试"}
                        </p>
                      </div>
                      <Button
                        className="w-full"
                        color="primary"
                        onPress={() => void startDeviceAuth()}
                      >
                        重新登录
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          </div>

          <footer className="login-preview-footer flex flex-col gap-2">
            <span className="text-small text-default-500">数据自有部署　·　关键操作可审计　·　本地执行可控</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      {/* 登录页运行时定制：背景透明化 + 弹窗拦截兜底（见 login-runtime.tsx） */}
      <LoginRuntime />
      <Suspense fallback={<LoginPageFallback />}>
        <LoginPageContent />
      </Suspense>
    </>
  );
}
