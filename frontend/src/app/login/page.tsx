"use client";

import React, { Suspense } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import {
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  LogIn,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "@/lib/toast";
import { authApi, kaypalApi, type AuthUser } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";

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
    setErrorMessage("本次授权码已过期，请获取新的授权码后继续。");
    setPhase("expired");
  }, []);

  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;
    const startedAt = Date.now();
    const maxBootstrapWaitMs = 20000;

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
      setExpiresAt(Date.now() + expiresInSeconds * 1000);
      setPollInterval(pollIntervalSeconds);
      setPhase("waiting");
    } catch (error) {
      const message = toPublicError(error, "登录授权未能启动，请稍后重试。");
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
            <Stack
              as="section"
              className="order-last md:order-first"
              gap={6}
              maxWidth={640}
            >
              <Stack gap={3}>
                <Text color="accent" type="supporting" weight="bold">
                  AI EMPLOYEE OS
                </Text>
                <Heading level={1} textWrap="balance" type="display-2">
                  让内容创作、发布和互动一起跑起来
                </Heading>
                <Text as="p" color="secondary" textWrap="pretty" type="large">
                  JIUZHANG AI
                  帮你从素材采集、选题生成、文章创作到多平台发布和客户互动回复，
                  把日常内容运营变成一套可持续执行的工作流。
                </Text>
              </Stack>

              <Grid columns={{ minWidth: 148, max: 3, repeat: "fit" }} gap={4}>
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
                    gap={3}
                    vAlign="center"
                  >
                    <Center height={32} width={32}>
                      <item.icon
                        aria-hidden="true"
                        className="h-[18px] w-[18px]"
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
                ) : null}

                {phase === "waiting" && userCode && verificationUrl ? (
                  <Stack gap={4}>
                    <Stack gap={4} padding={4}>
                      <Stack gap={2}>
                        <Text color="secondary" type="supporting" weight="bold">
                          1. 打开 JIUZHANG AI 登录页
                        </Text>
                        <Button
                          href={verificationUrl}
                          icon={
                            <ExternalLink
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={1.75}
                            />
                          }
                          label="打开 JIUZHANG AI 确认页"
                          rel="noopener noreferrer"
                          target="_blank"
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
              v1.1.56 · 2026-07-30 更新 ·{" "}
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
