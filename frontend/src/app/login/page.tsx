"use client";

import React, { Suspense } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Field } from "@astryxdesign/core/Field";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  LogIn,
  MapPinned,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "@/lib/toast";
import { authApi, kaypalApi, type AuthUser } from "@/lib/api/auth";
import { ApiError, getApiBase } from "@/lib/api/client";
import { toPublicError, toActionableError } from "@/lib/public-error";

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
    <AppShell contentPadding={0} height="auto" variant="wash">
      <Center minHeight="100dvh" width="100%">
        <Card padding={4}>
          <Spinner label="正在检查登录状态..." size="sm" />
        </Card>
      </Center>
    </AppShell>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = normalizeNextPath(searchParams.get("next"));
  const forceReauth = searchParams.get("reauth") === "1";

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
  const [loginTab, setLoginTab] = React.useState<"password" | "device">(
    "password",
  );
  /* 移动端（手机/APK WebView）没有桌面 Electron bridge，设备码授权无法工作。
     直接隐藏「扫码/授权码」入口，只保留账号密码登录，避免真机报
     「登录授权未能启动」。桌面端/PC 浏览器仍显示该 tab。 */
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    if (typeof navigator === "undefined") return;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    setIsMobile(mobile);
    if (mobile) setLoginTab("password");
  }, []);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
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
    setErrorMessage("本次授权码已过期，请获取新的授权码后继续。");
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
            setLoginTab("device");
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
        "登录授权未能启动，请稍后重试。",
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
          setErrorMessage("JIUZHANG AI 拒绝了授权，请重新发起。");
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
        setErrorMessage("本次授权无法继续，请重新获取授权码。");
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
    <AppShell contentPadding={0} height="auto" variant="wash">
      <Center axis="horizontal" width="100%">
        <Stack
          gap={6}
          maxWidth={1184}
          minHeight="100dvh"
          paddingBlock={4}
          paddingInline={6}
          width="100%"
        >
          <Stack
            as="header"
            direction="horizontal"
            hAlign="between"
            vAlign="center"
          >
            <Stack direction="horizontal" gap={3} vAlign="center">
              {/* eslint-disable-next-line @next/next/no-img-element -- Static export cannot use next/image optimization. */}
              <img
                alt="JIUZHANG AI"
                className="h-7 w-auto shrink-0"
                src="/brand/jiuzhang-ai-logo.png"
              />
              <Text color="secondary" type="supporting">
                智能运营系统
              </Text>
            </Stack>
            <Stack
              className="hidden sm:flex"
              direction="horizontal"
              gap={2}
              vAlign="center"
            >
              <ShieldCheck
                aria-hidden="true"
                className="h-4 w-4"
                strokeWidth={1.75}
              />
              <Text color="accent" type="supporting" weight="semibold">
                安全登录
              </Text>
            </Stack>
          </Stack>

          <Grid
            align="center"
            className="flex-1"
            columns={{ minWidth: 320, max: 2, repeat: "fit" }}
            gap={10}
            width="100%"
          >
            {/* P2-18：hero 营销区紧凑化——缩小间距/字号/图标，首屏占用从约 1/3 降下来 */}
            <Stack
              as="section"
              className="order-last md:order-first"
              gap={3}
              maxWidth={640}
            >
              <Stack gap={2}>
                <Text color="accent" type="supporting" weight="bold">
                  AI EMPLOYEE OS
                </Text>
                <Heading level={1} textWrap="balance" type="display-3">
                  让内容创作、发布和互动一起跑起来
                </Heading>
                <Text as="p" color="secondary" textWrap="pretty" type="large">
                  JIUZHANG AI
                  帮你从素材采集、选题生成、文章创作到多平台发布和客户互动回复，
                  把日常内容运营变成一套可持续执行的工作流。
                </Text>
              </Stack>

              <Grid columns={{ minWidth: 148, max: 3, repeat: "fit" }} gap={3}>
                {[
                  {
                    label: "内容生产",
                    value: "从素材到成稿",
                    icon: LayoutDashboard,
                  },
                  {
                    label: "发布管理",
                    value: "多平台统一执行",
                    icon: KeyRound,
                  },
                  {
                    label: "客户互动",
                    value: "评论私信及时跟进",
                    icon: MapPinned,
                  },
                ].map((item) => (
                  <Stack
                    key={item.label}
                    direction="horizontal"
                    gap={2}
                    vAlign="center"
                  >
                    <Center height={24} width={24}>
                      <item.icon
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.75}
                      />
                    </Center>
                    <Stack gap={0}>
                      <Text
                        color="secondary"
                        type="supporting"
                        weight="semibold"
                      >
                        {item.label}
                      </Text>
                      <Text type="label" weight="bold">
                        {item.value}
                      </Text>
                    </Stack>
                  </Stack>
                ))}
              </Grid>
            </Stack>

            <Card
              className="order-first md:order-last"
              maxWidth={440}
              padding={6}
              width="100%"
            >
              <Stack gap={5}>
                <Stack gap={3}>
                  <Center height={40} width={40}>
                    <KeyRound
                      aria-hidden="true"
                      className="h-5 w-5"
                      strokeWidth={1.75}
                    />
                  </Center>
                  <Stack gap={1}>
                    <Heading level={2}>
                      {phase === "waiting"
                        ? "请在 JIUZHANG AI 页面确认"
                        : forceReauth
                          ? "重新授权账号"
                          : "欢迎回来"}
                    </Heading>
                    <Text as="p" color="secondary" type="supporting">
                      {phase === "waiting"
                        ? "确认后会自动进入当前工作台。"
                        : forceReauth
                          ? "完成确认后会更新当前账号授权。"
                          : "登录后进入 JIUZHANG AI。"}
                    </Text>
                  </Stack>
                </Stack>

                {phase === "idle" ||
                phase === "starting" ||
                phase === "error" ? (
                  <Stack gap={4}>
                    {/* 登录方式切换：账号密码（默认，手机版体验） / 设备码（备用） */}
                    <Stack direction="horizontal" gap={2}>
                      {(
                        [
                          { key: "password", label: "账号密码登录" },
                          { key: "device", label: "扫码/授权码" },
                        ] as const
                      )
                        .filter((tab) => tab.key === "password" || !isMobile)
                        .map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setLoginTab(tab.key)}
                          className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition ${
                            loginTab === tab.key
                              ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                          }`}
                          style={{
                            border: "1px solid transparent",
                            cursor: "pointer",
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </Stack>

                    {loginTab === "password" ? (
                      <Stack gap={3}>
                        <Field label="手机号 / 邮箱" width="100%" inputID="login-username">
                          <TextInput
                            label="手机号 / 邮箱"
                            isLabelHidden
                            placeholder="手机号或邮箱"
                            value={username}
                            onChange={(value) => setUsername(value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handlePasswordLogin();
                            }}
                          />
                        </Field>
                        <Field label="密码" width="100%" inputID="login-password">
                          <TextInput
                            label="密码"
                            isLabelHidden
                            type="password"
                            placeholder="输入密码"
                            value={password}
                            onChange={(value) => setPassword(value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handlePasswordLogin();
                            }}
                          />
                        </Field>
                        <label
                          htmlFor="login-remember"
                          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                        >
                          <input
                            id="login-remember"
                            type="checkbox"
                            checked={rememberAccount}
                            onChange={(e) => setRememberAccount(e.target.checked)}
                            style={{ width: 16, height: 16, accentColor: "#b45309" }}
                          />
                          <span style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)" }}>
                            记住账号和密码（本机加密保存）
                          </span>
                        </label>
                        <Button
                          icon={
                            passwordSubmitting ? (
                              <Spinner aria-label="登录中" size="sm" />
                            ) : (
                              <LogIn
                                aria-hidden="true"
                                className="h-4 w-4"
                                strokeWidth={1.75}
                              />
                            )
                          }
                          isDisabled={
                            passwordSubmitting || !username.trim() || !password
                          }
                          label={
                            passwordSubmitting ? "正在登录..." : "登录"
                          }
                          onClick={() => void handlePasswordLogin()}
                          variant="primary"
                          width="100%"
                        />
                        {passwordError ? (
                          <Banner
                            description={passwordError}
                            status="error"
                            title="登录失败"
                          />
                        ) : null}
                        {/* 微信登录（kaypal 认证服务原生支持，扫码一步登录） */}
                        <Stack
                          direction="horizontal"
                          gap={3}
                          hAlign="center"
                          vAlign="center"
                        >
                          <span
                            style={{
                              height: 1,
                              flex: 1,
                              background: "var(--border)",
                            }}
                          />
                          <Text
                            color="secondary"
                            type="supporting"
                            style={{ textAlign: "center" }}
                          >
                            或
                          </Text>
                          <span
                            style={{
                              height: 1,
                              flex: 1,
                              background: "var(--border)",
                            }}
                          />
                        </Stack>
                        <Button
                          icon={
                            <MessageCircle
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={1.75}
                            />
                          }
                          label="微信登录"
                          onClick={() => {
                            // 用 getApiBase() 拼绝对地址直连后端：
                            // 桌面 Electron 的静态服务不反代 /api（相对路径会 404 到 not-found 页）；
                            // 生产 web 的 getApiBase 回落为同源 /api（nginx 反代），两处都兼容。
                            const apiBase = getApiBase().replace(/\/$/, "");
                            window.location.href = `${apiBase}/auth/wechat/start?next=${encodeURIComponent(
                              nextPath,
                            )}`;
                          }}
                          variant="secondary"
                          width="100%"
                        />
                        <Text
                          as="p"
                          color="secondary"
                          type="supporting"
                          style={{ textAlign: "center" }}
                        >
                          微信扫码一步登录，与账号登录是同一个账户
                        </Text>
                        {/* P2-19：忘记密码 / 注册入口。
                            目标路由 /auth/forgot-password、/auth/register 尚未实现，
                            先用 # 占位链接，路由就绪后替换 href 即可。 */}
                        <Stack
                          direction="horizontal"
                          gap={4}
                          hAlign="center"
                          vAlign="center"
                        >
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              toast("忘记密码请联系管理员重置");
                            }}
                            className="text-[13px] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
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
                              toast("账号由管理员开通，请联系管理员");
                            }}
                            className="text-[13px] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                          >
                            注册账号
                          </a>
                        </Stack>
                      </Stack>
                    ) : (
                      <Stack gap={3}>
                        <Button
                          icon={
                            <LogIn
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={1.75}
                            />
                          }
                          isLoading={phase === "starting"}
                          label={
                            phase === "starting"
                              ? "正在准备 JIUZHANG AI 登录..."
                              : phase === "error"
                                ? "重新获取授权码"
                                : forceReauth
                                  ? "重新授权 JIUZHANG AI 账号"
                                  : "用 JIUZHANG AI 账号登录"
                          }
                          onClick={() => void startDeviceAuth()}
                          variant="primary"
                          width="100%"
                        />
                        {errorMessage && phase === "error" ? (
                          <Banner
                            description={errorMessage}
                            status="error"
                            title="登录授权未能启动"
                          />
                        ) : null}
                      </Stack>
                    )}
                  </Stack>
                ) : null}

                {phase === "waiting" && userCode && verificationUrl ? (
                  <Stack gap={4}>
                    <Stack gap={4} padding={4}>
                      <Stack gap={2}>
                        <Text color="secondary" type="supporting" weight="bold">
                          1. 打开 JIUZHANG AI 登录页
                        </Text>
                        <Button
                          icon={
                            <ExternalLink
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={1.75}
                            />
                          }
                          label="打开 JIUZHANG AI 确认页"
                          onClick={() => {
                            // 桌面 Electron：走系统浏览器打开确认页（避免当前窗口被导航走）；
                            // 手机 WebView 不支持多窗口，保留当前窗口导航。
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
                            window.location.href = verificationUrl;
                          }}
                          variant="primary"
                          width="100%"
                        />
                      </Stack>
                      <Stack gap={2}>
                        <Text color="secondary" type="supporting" weight="bold">
                          2. 确认授权码
                        </Text>
                        <Button
                          label={`复制授权码 ${userCode}`}
                          onClick={() => {
                            // 桌面 Electron：走主进程原生剪贴板（renderer 的 navigator.clipboard 可能被权限拒绝）
                            const desktopBridge =
                              (window as unknown as { electronAPI?: { system?: { writeClipboard?: (text: string) => Promise<unknown> } } })
                                .electronAPI?.system;
                            if (desktopBridge?.writeClipboard) {
                              void desktopBridge
                                .writeClipboard(userCode)
                                .then((ok) => {
                                  if (ok) toast.success("授权码已复制");
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
                                () => toast.success("授权码已复制"),
                                () => toast.error("复制失败"),
                              );
                            }
                          }}
                          variant="secondary"
                          width="100%"
                        >
                          <Stack
                            direction="horizontal"
                            hAlign="between"
                            vAlign="center"
                            width="100%"
                          >
                            <Text hasTabularNumbers type="code" weight="bold">
                              {userCode}
                            </Text>
                            <Text color="secondary" type="supporting">
                              复制授权码
                            </Text>
                          </Stack>
                        </Button>
                      </Stack>
                      <Text as="p" color="secondary" type="supporting">
                        3. 在 JIUZHANG AI 页面确认授权，确认后会自动回到工作台。
                      </Text>
                      {errorMessage ? (
                        <Banner
                          description={errorMessage}
                          status="warning"
                          title="连接恢复中"
                        />
                      ) : null}
                      {expiresIn ? (
                        <Text color="secondary" type="supporting">
                          授权码 {Math.round(expiresIn / 60)} 分钟内有效
                        </Text>
                      ) : null}
                    </Stack>
                    <Spinner
                      label={
                        errorMessage
                          ? "连接恢复中，正在自动重试..."
                          : "正在等待授权确认..."
                      }
                      size="sm"
                    />
                    <Button
                      label="取消，重新发起"
                      onClick={resetDeviceAuth}
                      variant="ghost"
                      width="100%"
                    />
                  </Stack>
                ) : null}

                {phase === "expired" ? (
                  <Stack gap={3}>
                    <Banner
                      description={
                        errorMessage ||
                        "本次授权码已过期，请获取新的授权码后继续。"
                      }
                      status="warning"
                      title="授权码已过期"
                    />
                    <Button
                      label="获取新授权码"
                      onClick={() => void startDeviceAuth()}
                      variant="primary"
                      width="100%"
                    />
                  </Stack>
                ) : null}

                {phase === "denied" ? (
                  <Stack gap={3}>
                    <Banner
                      description={errorMessage || "JIUZHANG AI 拒绝了授权"}
                      status="warning"
                      title="授权未通过"
                    />
                    <Button
                      label="重新发起授权"
                      onClick={() => void startDeviceAuth()}
                      variant="primary"
                      width="100%"
                    />
                  </Stack>
                ) : null}
              </Stack>
            </Card>
          </Grid>

          <Stack as="footer" gap={2}>
            <Text color="secondary" type="supporting">
              JIUZHANG AI · 内容创作、发布与客户互动工作台
            </Text>
            <Text color="secondary" type="supporting">
              v1.1.60 · 2026-08-04 更新 ·{" "}
              <a
                href="/release-notes"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                查看更新历史
              </a>
            </Text>
          </Stack>
        </Stack>
      </Center>
    </AppShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}
