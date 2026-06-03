"use client";

import React, { Suspense } from "react";
import { Button, Card, CardBody, CardHeader, Form, Input, Spinner } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { authApi } from "@/lib/api/auth";

const kaypalV3Tokens = {
  "--kaypal-v3-canvas": "oklch(0.973 0.006 145)",
  "--kaypal-v3-paper": "oklch(1 0 0)",
  "--kaypal-v3-paper-soft": "oklch(0.955 0.007 145)",
  "--kaypal-v3-paper-muted": "oklch(0.982 0.003 210)",
  "--kaypal-v3-ink": "oklch(0.18 0.012 240)",
  "--kaypal-v3-soft-ink": "oklch(0.36 0.016 240)",
  "--kaypal-v3-muted": "oklch(0.56 0.016 240)",
  "--kaypal-v3-border": "oklch(0.89 0.01 145)",
  "--kaypal-v3-border-strong": "oklch(0.78 0.016 145)",
  "--kaypal-v3-accent": "oklch(0.45 0.105 165)",
  "--kaypal-v3-accent-soft": "oklch(0.92 0.035 165)",
  "--kaypal-v3-accent-ink": "oklch(0.25 0.08 165)",
  "--kaypal-v3-cobalt": "oklch(0.42 0.09 250)",
  "--kaypal-v3-blue-soft": "oklch(0.94 0.025 250)",
  "--kaypal-v3-amber": "oklch(0.55 0.095 75)",
  "--kaypal-v3-amber-soft": "oklch(0.94 0.04 80)",
  "--kaypal-v3-card-shadow": "0 1px 2px rgba(18, 20, 23, .05)",
  "--kaypal-v3-elevated-shadow": "0 18px 44px rgba(18, 20, 23, .08)",
  "--kaypal-v3-font-serif": "\"Noto Serif SC\", \"Source Han Serif SC\", \"Songti SC\", serif",
  "--kaypal-v3-font-nav": "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
} as React.CSSProperties;

const inputClassNames = {
  input: "text-[14px] text-[var(--kaypal-v3-ink)] placeholder:text-[var(--kaypal-v3-muted)]",
  label: "text-[13px] font-medium text-[var(--kaypal-v3-soft-ink)]",
  inputWrapper:
    "h-10 rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] shadow-none data-[hover=true]:border-[var(--kaypal-v3-border-strong)] group-data-[focus=true]:border-[var(--kaypal-v3-accent)] group-data-[focus=true]:ring-2 group-data-[focus=true]:ring-[var(--kaypal-v3-accent-soft)]",
};
const AUTH_PENDING_KEY = "ai-content-auth-pending";

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

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isVisible, setIsVisible] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [hasUsers, setHasUsers] = React.useState(true);

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
        const [setup, currentUser] = await Promise.allSettled([
          authApi.setupStatus(),
          authApi.me(),
        ]);

        if (!active) {
          return;
        }

        if (setup.status === "fulfilled") {
          setHasUsers(setup.value.hasUsers);
        }

        if (currentUser.status === "fulfilled") {
          navigateToNext();
          return;
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, [navigateToNext]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!username.trim() || !password) {
      toast.error("请输入账号和密码");
      return;
    }

    try {
      setSubmitting(true);
      await authApi.login(username.trim(), password);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(AUTH_PENDING_KEY, String(Date.now()));
      }
      toast.success("登录成功");
      navigateToNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoginPageFallback />;
  }

  return (
    <div
      className="kaypal-v3-shell min-h-dvh overflow-x-clip bg-[var(--kaypal-v3-canvas)] text-[var(--kaypal-v3-ink)] [font-family:var(--kaypal-v3-font-nav)]"
      style={kaypalV3Tokens}
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex min-h-14 items-center justify-between border-b border-[var(--kaypal-v3-border)] bg-white/70 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--kaypal-v3-ink)] text-sm font-extrabold text-white">
              K
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-[var(--kaypal-v3-ink)]">KaypalAI 内容创作平台</p>
              <p className="truncate text-xs text-[var(--kaypal-v3-muted)]">统一工作入口</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)] sm:flex">
            <Icon icon="solar:shield-check-linear" width={16} />
            安全登录
          </div>
        </header>

        <main className="grid flex-1 items-center gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:py-12">
          <section className="max-w-2xl">
            <div className="inline-flex h-7 items-center rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[11px] font-extrabold tracking-[0.04em] text-[var(--kaypal-v3-accent-ink)]">
              WORKBENCH
            </div>
            <h1 className="mt-5 max-w-xl text-[28px] font-bold leading-9 tracking-[0] text-[var(--kaypal-v3-ink)] [font-family:var(--kaypal-v3-font-serif)] sm:text-[32px] sm:leading-10">
              登录工作台
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-[var(--kaypal-v3-soft-ink)] sm:text-[15px] sm:leading-7">
              进入内容生产、发布执行和客户互动页面。登录后会回到你刚才访问的入口。
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { label: "当前入口", value: "内容工作台", icon: "solar:widget-linear" },
                { label: "会话状态", value: "待登录", icon: "solar:key-minimalistic-square-2-linear" },
                { label: "返回位置", value: nextPath === "/" ? "总览" : "原页面", icon: "solar:map-arrow-right-linear" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[14px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 shadow-[var(--kaypal-v3-card-shadow)]"
                >
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]">
                    <Icon icon={item.icon} width={18} />
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
                <Icon icon="solar:lock-keyhole-linear" width={22} />
              </div>
              <div>
                <h2 className="text-[22px] font-bold leading-[30px] tracking-[0] text-[var(--kaypal-v3-ink)] [font-family:var(--kaypal-v3-font-serif)]">
                  账号登录
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[var(--kaypal-v3-muted)]">请输入账号和密码继续。</p>
              </div>
            </CardHeader>
            <CardBody className="px-6 pb-6 pt-5">
              <Form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <Input
                  isRequired
                  classNames={inputClassNames}
                  label="账号"
                  name="username"
                  placeholder="请输入账号"
                  value={username}
                  variant="bordered"
                  onValueChange={setUsername}
                />
                <Input
                  isRequired
                  classNames={inputClassNames}
                  endContent={
                    <button type="button" onClick={() => setIsVisible((value) => !value)}>
                      <Icon
                        className="pointer-events-none text-xl text-[var(--kaypal-v3-muted)]"
                        icon={isVisible ? "solar:eye-closed-linear" : "solar:eye-bold"}
                      />
                    </button>
                  }
                  label="密码"
                  name="password"
                  placeholder="请输入账号密码"
                  type={isVisible ? "text" : "password"}
                  value={password}
                  variant="bordered"
                  onValueChange={setPassword}
                />

                {!hasUsers ? (
                  <div className="w-full rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-amber-soft)] px-4 py-3 text-[13px] leading-6 text-[var(--kaypal-v3-amber)]">
                    系统当前还没有可登录账号。请联系管理员完成首次初始化。
                  </div>
                ) : null}

                <Button
                  className="mt-1 h-10 w-full rounded-[10px] bg-[var(--kaypal-v3-ink)] text-sm font-semibold text-white shadow-none"
                  isDisabled={!hasUsers}
                  isLoading={submitting}
                  type="submit"
                >
                  登录系统
                </Button>
              </Form>
            </CardBody>
          </Card>
        </main>

        <footer className="border-t border-[var(--kaypal-v3-border)] pt-4 text-xs text-[var(--kaypal-v3-muted)]">
          Kaypal Workspace
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
