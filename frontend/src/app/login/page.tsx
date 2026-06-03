"use client";

import React, { Suspense } from "react";
import { Button, Card, CardBody, CardHeader, Input, Spinner } from "@heroui/react";
import {
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  LogIn,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { authApi, kaypalApi } from "@/lib/api/auth";

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

const inputClassNames = {
  input: "text-[14px] text-[var(--kaypal-v3-ink)] placeholder:text-[var(--kaypal-v3-muted)]",
  label: "text-[13px] font-medium text-[var(--kaypal-v3-soft-ink)]",
  inputWrapper:
    "h-10 rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] shadow-none data-[hover=true]:border-[var(--kaypal-v3-border-strong)] group-data-[focus=true]:border-[var(--kaypal-v3-accent)] group-data-[focus=true]:ring-2 group-data-[focus=true]:ring-[var(--kaypal-v3-accent-soft)]",
};

type Phase = "loading" | "idle" | "starting" | "waiting" | "denied" | "fallback" | "error";

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

  const [fallbackUsername, setFallbackUsername] = React.useState("");
  const [fallbackPassword, setFallbackPassword] = React.useState("");
  const [fallbackBusy, setFallbackBusy] = React.useState(false);
  const [fallbackVisible, setFallbackVisible] = React.useState(false);

  const navigateToNext = React.useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.assign(nextPath);
      return;
    }
    router.replace(nextPath);
  }, [nextPath, router]);

  React.useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const currentUser = await authApi.me();
        if (active && currentUser) {
          navigateToNext();
          return;
        }
      } catch {
        // 未登录
      }
      if (active) setPhase("idle");
    };
    bootstrap();
    return () => {
      active = false;
    };
  }, [navigateToNext]);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kaypal 授权启动失败";
      setErrorMessage(message);
      setPhase("fallback");
    }
  }, []);

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
        setPhase("fallback");
      }
    };

    timer = setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, deviceCode, deviceId, pollInterval, navigateToNext]);

  const handleFallbackSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fallbackUsername.trim() || !fallbackPassword) {
      toast.error("请输入本地账号和密码");
      return;
    }
    try {
      setFallbackBusy(true);
      await authApi.login(fallbackUsername.trim(), fallbackPassword);
      toast.success("已通过本地账号登录");
      navigateToNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setFallbackBusy(false);
    }
  };

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
              alt="Kaypal"
              className="h-10 w-10 shrink-0 rounded-[10px] object-cover shadow-[var(--kaypal-v3-card-shadow)]"
              src="/brand/kaypal-logo.png"
            />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-[var(--kaypal-v3-ink)]">KaypalAI 内容创作平台</p>
              <p className="truncate text-xs text-[var(--kaypal-v3-muted)]">统一工作入口</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)] sm:flex">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            Kaypal 单点登录
          </div>
        </header>

        <main className="grid flex-1 items-center gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:py-12">
          <section className="max-w-2xl">
            <div className="inline-flex h-7 items-center rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[11px] font-extrabold tracking-[0.04em] text-[var(--kaypal-v3-accent-ink)]">
              KAYPAL SINGLE SIGN-ON
            </div>
            <h1 className="mt-5 max-w-xl text-[28px] font-bold leading-9 tracking-[0] text-[var(--kaypal-v3-ink)] [font-family:var(--kaypal-v3-font-serif)] sm:text-[32px] sm:leading-10">
              用 Kaypal 账号登录
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-[var(--kaypal-v3-soft-ink)] sm:text-[15px] sm:leading-7">
              点击下方按钮，本系统会跳到 Kaypal 网页。输码、点确认、回来。
              登录后会回到你刚才访问的入口。
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { label: "当前入口", value: "内容工作台", icon: LayoutDashboard },
                { label: "登录方式", value: "Kaypal 设备授权", icon: KeyRound },
                { label: "返回位置", value: nextPath === "/" ? "总览" : "原页面", icon: MapPinned },
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
                  {phase === "waiting" ? "在 Kaypal 网页确认" : "登录工作台"}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[var(--kaypal-v3-muted)]">
                  {phase === "waiting"
                    ? "在 Kaypal 网页完成授权后会自动回来。"
                    : "通过 Kaypal 单点登录，无需在本地输密码。"}
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
                    {phase === "starting" ? "Kaypal 授权启动中..." : "用 Kaypal 账号登录"}
                  </Button>
                  {errorMessage && phase === "error" ? (
                    <p className="text-[12px] leading-5 text-[var(--kaypal-v3-amber)]">
                      {errorMessage}。可改用下方凭据登录。
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="text-[12px] text-[var(--kaypal-v3-muted)] underline-offset-2 hover:text-[var(--kaypal-v3-soft-ink)] hover:underline"
                    onClick={() => setPhase("fallback")}
                  >
                    Kaypal 网页打不开？用凭据登录
                  </button>
                </div>
              ) : null}

              {phase === "waiting" && userCode && verificationUrl ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-[12px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--kaypal-v3-muted)]">
                      1. 打开 Kaypal
                    </p>
                    <a
                      href={verificationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 py-2 text-[13px] font-semibold text-white"
                    >
                      <ExternalLink aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                      {verificationUrl}
                    </a>
                    <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--kaypal-v3-muted)]">
                      2. 输入授权码
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
                        点击复制
                      </span>
                    </button>
                    <p className="mt-3 text-[12px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      3. 在 Kaypal 点确认，本系统会等几秒自动回来。
                    </p>
                    {expiresIn ? (
                      <p className="mt-2 text-[11px] text-[var(--kaypal-v3-muted)]">
                        码 {Math.round(expiresIn / 60)} 分钟内有效
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-[var(--kaypal-v3-muted)]">
                    <Spinner size="sm" />
                    等待 Kaypal 授权...
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

              {phase === "fallback" ? (
                <form className="flex flex-col gap-3" onSubmit={handleFallbackSubmit}>
                  <p className="rounded-[10px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--kaypal-v3-amber)]">
                    Kaypal 设备授权暂时不可用，请用本地账号密码登录（仅授权服务异常时使用）。
                  </p>
                  <Input
                    isRequired
                    classNames={inputClassNames}
                    label="本地账号"
                    name="username"
                    placeholder="admin"
                    value={fallbackUsername}
                    variant="bordered"
                    onValueChange={setFallbackUsername}
                  />
                  <Input
                    isRequired
                    classNames={inputClassNames}
                    endContent={
                      <button type="button" onClick={() => setFallbackVisible((v) => !v)}>
                        {fallbackVisible ? (
                          <EyeOff
                            aria-hidden="true"
                            className="pointer-events-none h-5 w-5 text-[var(--kaypal-v3-muted)]"
                            strokeWidth={1.75}
                          />
                        ) : (
                          <Eye
                            aria-hidden="true"
                            className="pointer-events-none h-5 w-5 text-[var(--kaypal-v3-muted)]"
                            strokeWidth={1.75}
                          />
                        )}
                      </button>
                    }
                    label="Kaypal 密码"
                    name="password"
                    placeholder="Kaypal 账号密码"
                    type={fallbackVisible ? "text" : "password"}
                    value={fallbackPassword}
                    variant="bordered"
                    onValueChange={setFallbackPassword}
                  />
                  <Button
                    className="mt-1 h-10 w-full rounded-[10px] bg-[var(--kaypal-v3-accent)] text-sm font-semibold text-white shadow-none"
                    isLoading={fallbackBusy}
                    type="submit"
                  >
                    用凭据登录
                  </Button>
                  <button
                    type="button"
                    className="text-[12px] text-[var(--kaypal-v3-muted)] underline-offset-2 hover:text-[var(--kaypal-v3-soft-ink)] hover:underline"
                    onClick={() => setPhase("idle")}
                  >
                    返回 Kaypal 设备授权
                  </button>
                </form>
              ) : null}
            </CardBody>
          </Card>
        </main>

        <footer className="border-t border-[var(--kaypal-v3-border)] pt-4 text-xs text-[var(--kaypal-v3-muted)]">
          Kaypal Workspace · 设备授权流程
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
