"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@heroui/react";
import { Home, RefreshCw, TriangleAlert } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route failed", error);
  }, [error]);

  const isApiError = error && error.name === "ApiError";
  const apiError = isApiError ? (error as unknown as { requestId?: string; traceId?: string; status?: number; errorCode?: string }) : null;
  const statusCode = apiError?.status;
  const isRetryable = apiError && "retryable" in error && (error as unknown as { retryable: boolean }).retryable;

  const errorType = (() => {
    if (statusCode === 401) return "登录已失效";
    if (statusCode === 403) return "没有操作权限";
    if (statusCode === 404) return "页面不存在";
    if (statusCode === 429) return "操作过于频繁";
    if (statusCode && statusCode >= 500) return "服务暂时不可用";
    if (error?.message?.includes("timeout") || error?.message?.includes("超时")) return "请求超时";
    if (error?.message?.includes("network") || error?.message?.includes("网络")) return "网络连接异常";
    return "页面出错了";
  })();

  const requestId = apiError?.requestId || error?.digest;

  return (
    <main className="mx-auto flex min-h-[55vh] w-full max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-danger-50 text-danger">
        <TriangleAlert aria-hidden="true" size={24} />
      </span>
      <div>
        <h1 className="kx-greet text-foreground">
          {errorType}
        </h1>
        <p className="mt-2 text-sm leading-6 text-default-500">
          {isRetryable
            ? "这是临时问题，点击「重新加载」通常就能恢复。"
            : statusCode === 401
            ? "登录状态已过期，请重新登录后再试。"
            : statusCode === 403
            ? "当前账号没有执行此操作的权限。"
            : "当前操作没有完成。可以重新加载本页；仍失败时先返回工作台，已保存的数据不会受影响。"}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {(isRetryable || !statusCode || statusCode >= 500) && (
          <Button
            color="primary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={reset}
          >
            重新加载
          </Button>
        )}
        {statusCode === 401 ? (
          <Button
            as={Link}
            href="/login"
            color="primary"
            startContent={<Home aria-hidden="true" size={16} />}
          >
            去登录
          </Button>
        ) : (
          <Button
            as={Link}
            href="/"
            startContent={<Home aria-hidden="true" size={16} />}
            variant="flat"
          >
            返回工作台
          </Button>
        )}
      </div>
      {requestId && (
        <div className="mt-2 text-11 text-default-400">
          错误编号：<code className="rounded bg-default-100 px-1.5 py-0.5 font-mono text-10">{requestId.slice(0, 12)}</code>
          <span className="ml-2">如需帮助请提供此编号</span>
        </div>
      )}
    </main>
  );
}
