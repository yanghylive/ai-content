"use client";

import React, { Suspense } from "react";
import { Button, Card, CardBody, CardHeader, Spinner } from "@heroui/react";
import {
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  LogIn,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { authApi, kaypalApi, type AuthUser } from "@/lib/api/auth";

const kaypalV3Tokens = {
  "--kaypal-v3-canvas": "#000000",
  "--kaypal-v3-paper": "#18181b",
  "--kaypal-v3-paper-soft": "#27272a",
  "--kaypal-v3-paper-muted": "#3f3f46",
  "--kaypal-v3-ink": "#ECEDEE",
  "--kaypal-v3-soft-ink": "#d4d4d8",
  "--kaypal-v3-muted": "#a1a1aa",
  "--kaypal-v3-border": "#27272a",
  "--kaypal-v3-border-strong": "#3f3f46",
  "--kaypal-v3-accent": "#006FEE",
  "--kaypal-v3-accent-soft": "#001731",
  "--kaypal-v3-accent-ink": "#99c7fb",
  "--kaypal-v3-cobalt": "#338ef7",
  "--kaypal-v3-blue-soft": "#001731",
  "--kaypal-v3-amber": "#fbbf24",
  "--kaypal-v3-amber-soft": "#422006",
  "--kaypal-v3-card-shadow": "0 1px 2px rgba(0, 0, 0, .24)",
  "--kaypal-v3-elevated-shadow": "0 18px 44px rgba(0, 0, 0, .28)",
  "--kaypal-v3-font-serif": "\"Noto Serif SC\", \"Source Han Serif SC\", \"Songti SC\", serif",
  "--kaypal-v3-font-nav": "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
} as React.CSSProperties;

type Phase = "loading" | "idle" | "starting" | "waiting" | "denied" | "error";

function hasKaypalDesktopSession(user: AuthUser | null | undefined) {
  return Boolean(user?.kaypalUserId && (user.kaypalDesktopAccessToken || user.kaypalDesktopRefreshToken));
}

function isAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /请先登录|登录状态|授权.*失效|授权.*过期|重新登录|401|unauthorized/i.test(message);
}

function LoginPageFallback() {
  return (
    <div
      className="kaypal-v3-shell flex min-h-dvh items-center justify-center bg-[var(--kaypal-v3-canvas)] text-[var(--kaypal-v3-ink)]"
      style={kaypalV3Tokens}
    >
      <div className="flex items-center gap-3 rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-3 shadow-[var(--kaypal-v3-card-shadow)]">
        <Spinner size="sm" />
        <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">正在检查登录状态...</span>
      </div>
    </div>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [deviceCode, setDeviceCode] = React.useState<string | null>(null);
  const [deviceId, setDeviceId] = React.useState<string | null>(null);
  const [userCode, setUserCode] = React.useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = React.useState<string | null>(null);
  const [expiresIn, setExpiresIn] = React.useState<number | null>(null);
  const [pollInterval, setPollInterval] = React.useState<number>(5);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const hasNavigatedRef = React.useRef(false);

  const navigateToNext = React.useCallback(() => {
    if (hasNavigatedRef.current) {
      return;
    }
    hasNavigatedRef.current = true;
    if (typeof window !== "undefined") {
      window.location.assign(nextPath);
      return;
    }
    router.replace(nextPath);
  }, [nextPath, router]);

  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const maxBootstrapWaitMs = 20000;

    const bootstrap = async () => {
      try {
        const currentUser = await authApi.me();
        if (active && hasKaypalDesktopSession(currentUser)) {
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
      if (timer) clearTimeout(timer);
    };
  }, [navigateToNext]);

  const openKaypalAuthorization = React.useCallback(
    async (url: string, options?: { silent?: boolean }) => {
      try {
        await kaypalApi.openKaypalDeviceAuth({ verificationUrl: url });
        if (!options?.silent) {
          toast.success("已打开 Kaypal 确认页");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kaypal 确认页打开失败";
        setErrorMessage(`${message}。请复制链接到浏览器打开：${url}`);
        if (!options?.silent) {
          toast.error(message);
        }
      }
    },
    [],
  );

  const startDeviceAuth = React.useCallback(async () => {
    setPhase("starting");
    setErrorMessage(null);
    try {
      const newDeviceId = `web-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      const result = await kaypalApi.startKaypalDeviceAuth({
        deviceId: newDeviceId,
        deviceName: "AI Content Workbench (Web)",
        platform: "web",
      });
      setDeviceId(newDeviceId);
      setDeviceCode(result.deviceCode);
      setUserCode(result.userCode);
      setVerificationUrl(result.verificationUrl);
      setExpiresIn(result.expiresIn);
      setPollInterval(Math.max(1, Math.min(60, result.interval || 5)));
      setPhase("waiting");
      void openKaypalAuthorization(result.verificationUrl, { silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kaypal 授权启动失败";
      setErrorMessage(message);
      setPhase("error");
    }
  }, [openKaypalAuthorization]);

  React.useEffect(() => {
    if (phase !== "waiting" || !deviceCode || !deviceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const intervalMs = Math.max(1000, pollInterval * 1000);

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await kaypalApi.pollKaypalDeviceAuth({
          deviceCode,
          deviceId,
        });
        if (cancelled) return;
        if (result.status === "authorized") {
          toast.success(`已通过 Kaypal 登录：${result.user?.name || result.user?.username || "Kaypal 用户"}`);
          navigateToNext();
          return;
        }
        if (result.status === "denied") {
          setPhase("denied");
          setErrorMessage("Kaypal 拒绝了授权，请重新发起。");
          return;
        }
        timer = setTimeout(poll, intervalMs);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "轮询 Kaypal 失败");
        setPhase("error");
      }
    };

    timer = setTimeout(poll, Math.min(1000, intervalMs));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, deviceCode, deviceId, pollInterval, navigateToNext]);

  React.useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probeExistingSession = async () => {
      if (cancelled) return;
      try {
        const currentUser = await authApi.me();
        if (!cancelled && hasKaypalDesktopSession(currentUser)) {
          navigateToNext();
          return;
        }
      } catch {
        // 仍未写入本地登录态，继续等待 Kaypal 授权轮询。
      }
      if (!cancelled) {
        timer = setTimeout(probeExistingSession, 1500);
      }
    };

    timer = setTimeout(probeExistingSession, 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, navigateToNext]);

  if (phase === "loading") {
    return <LoginPageFallback />;
  }

  return (
    <div
      className="kaypal-v3-shell min-h-dvh overflow-x-clip bg-[var(--kaypal-v3-canvas)] text-[var(--kaypal-v3-ink)] [font-family:var(--kaypal-v3-font-nav)]"
      style={kaypalV3Tokens}
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex min-h-14 items-center justify-between rounded-[18px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 shadow-[var(--kaypal-v3-card-shadow)]">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- Static export cannot use next/image optimization. */}
            <img
              alt="JIUZHANG AI"
              className="h-7 w-auto shrink-0 shadow-[var(--kaypal-v3-card-shadow)]"
              src="/brand/jiuzhang-ai-logo.png"
            />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-[var(--kaypal-v3-ink)]">JIUZHANG AI 智能运营系统</p>
              <p className="truncate text-xs text-[var(--kaypal-v3-muted)]">内容创作与发布工作台</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)] sm:flex">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            安全登录
          </div>
        </header>

        <main className="grid flex-1 items-center gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:py-12">
          <section className="max-w-2xl">
            <div className="inline-flex h-7 items-center rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[11px] font-extrabold tracking-[0.04em] text-[var(--kaypal-v3-accent-ink)]">
              AI CONTENT WORKSPACE
            </div>
            <h1 className="mt-5 max-w-xl text-[28px] font-bold leading-9 tracking-[0] text-[var(--kaypal-v3-ink)] [font-family:var(--kaypal-v3-font-serif)] sm:text-[32px] sm:leading-10">
              让内容创作、发布和互动一起跑起来
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-[var(--kaypal-v3-soft-ink)] sm:text-[15px] sm:leading-7">
              JIUZHANG AI 帮你从素材采集、选题生成、文章创作到多平台发布和客户互动回复，
              把日常内容运营变成一套可持续执行的工作流。
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { label: "内容生产", value: "从素材到成稿", icon: LayoutDashboard },
                { label: "发布管理", value: "多平台统一执行", icon: KeyRound },
                { label: "客户互动", value: "评论私信及时跟进", icon: MapPinned },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[14px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]"
                >
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]">
                    <item.icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </div>
                  <p className="text-[11px] font-bold text-[var(--kaypal-v3-muted)]">{item.label}</p>
                  <p className="mt-1 text-[15px] font-bold text-[var(--kaypal-v3-ink)]">{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <Card className="rounded-[18px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] shadow-[var(--kaypal-v3-elevated-shadow)]">
            <CardHeader className="flex flex-col items-start gap-3 px-6 pb-0 pt-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-accent-ink)]">
                <KeyRound aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-[22px] font-bold leading-[30px] tracking-[0] text-[var(--kaypal-v3-ink)] [font-family:var(--kaypal-v3-font-serif)]">
                  {phase === "waiting" ? "请在 Kaypal 页面确认" : "欢迎回来"}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[var(--kaypal-v3-muted)]">
                  {phase === "waiting"
                    ? "确认后会自动进入当前工作台。"
                    : "登录后进入 JIUZHANG AI。"}
                </p>
              </div>
            </CardHeader>
            <CardBody className="px-6 pb-6 pt-5">
              {phase === "idle" || phase === "starting" || phase === "error" ? (
                <div className="flex flex-col gap-4">
                  <Button
                    className="mt-1 h-11 w-full rounded-[10px] bg-[var(--kaypal-v3-accent)] text-sm font-semibold text-white shadow-none"
                    isLoading={phase === "starting"}
                    onPress={startDeviceAuth}
                    startContent={
                      <LogIn aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    }
                  >
                    {phase === "starting" ? "正在打开 JIUZHANG AI..." : "用 JIUZHANG AI 账号登录"}
                  </Button>
                  {errorMessage && phase === "error" ? (
                    <p className="text-[12px] leading-5 text-[var(--kaypal-v3-amber)]">
                      {errorMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {phase === "waiting" && userCode && verificationUrl ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-[12px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--kaypal-v3-muted)]">
                      1. 打开 Kaypal 登录页
                    </p>
                    <Button
                      className="mt-2 h-10 w-full justify-start rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[13px] font-semibold text-white shadow-none"
                      onPress={() => void openKaypalAuthorization(verificationUrl)}
                      startContent={
                        <ExternalLink aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                      }
                    >
                      重新打开 Kaypal 确认页
                    </Button>
                    <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--kaypal-v3-muted)]">
                      2. 确认授权码
                    </p>
                    <button
                      type="button"
                      className="mt-2 flex w-full items-center justify-between rounded-[10px] border border-[var(--kaypal-v3-border-strong)] bg-white px-4 py-3 text-left"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          navigator.clipboard.writeText(userCode).then(
                            () => toast.success("授权码已复制"),
                            () => toast.error("复制失败"),
                          );
                        }
                      }}
                    >
                      <span className="font-mono text-[20px] font-bold tracking-[0.4em] text-[var(--kaypal-v3-ink)]">
                        {userCode}
                      </span>
                      <span className="text-[11px] text-[var(--kaypal-v3-muted)]">
                        复制授权码
                      </span>
                    </button>
                    <p className="mt-3 text-[12px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      3. 在 Kaypal 页面确认授权，确认后会自动回到工作台。
                    </p>
                    {errorMessage ? (
                      <p className="mt-2 break-all text-[11px] leading-5 text-[var(--kaypal-v3-amber)]">
                        {errorMessage}
                      </p>
                    ) : null}
                    {expiresIn ? (
                      <p className="mt-2 text-[11px] text-[var(--kaypal-v3-muted)]">
                        授权码 {Math.round(expiresIn / 60)} 分钟内有效
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-[var(--kaypal-v3-muted)]">
                    <Spinner size="sm" />
                    正在等待授权确认...
                  </div>
                  <Button
                    variant="light"
                    size="sm"
                    onPress={() => {
                      setDeviceCode(null);
                      setDeviceId(null);
                      setUserCode(null);
                      setVerificationUrl(null);
                      setExpiresIn(null);
                      setPhase("idle");
                    }}
                  >
                    取消，重新发起
                  </Button>
                </div>
              ) : null}

              {phase === "denied" ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-[10px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-3 py-2 text-[13px] text-[var(--kaypal-v3-amber)]">
                    {errorMessage || "Kaypal 拒绝了授权"}
                  </div>
                  <Button color="primary" onPress={startDeviceAuth}>
                    重新发起授权
                  </Button>
                </div>
              ) : null}

            </CardBody>
          </Card>
        </main>

        <footer className="border-t border-[var(--kaypal-v3-border)] pt-4 text-xs text-[var(--kaypal-v3-muted)]">
          JIUZHANG AI · 内容创作、发布与客户互动工作台
        </footer>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}
