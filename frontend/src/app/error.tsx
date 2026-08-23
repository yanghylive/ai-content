"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@heroui/react";
import { Home, RefreshCw, TriangleAlert } from "lucide-react";

/**
 * 全局错误边界（Next.js 约定 app/error.tsx）：
 * 兜住根路由下的所有页面（登录页/演示页/未匹配路由等），
 * 避免 PWA 用户遇到渲染错误时白屏。
 * dashboard 路由级边界（(dashboard)/error.tsx）优先拦截，这里是最外层兜底。
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root route failed", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[55vh] w-full max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-danger-50 text-danger">
        <TriangleAlert aria-hidden="true" size={24} />
      </span>
      <div>
        <h1 className="kx-greet text-foreground">
          页面暂时无法打开
        </h1>
        <p className="mt-2 text-sm leading-6 text-default-500">
          出错了，重新加载试试；仍失败可返回首页，已保存的数据不会受影响。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          color="primary"
          startContent={<RefreshCw aria-hidden="true" size={16} />}
          onPress={reset}
        >
          重新加载
        </Button>
        <Button
          as={Link}
          href="/"
          startContent={<Home aria-hidden="true" size={16} />}
          variant="flat"
        >
          返回首页
        </Button>
      </div>
    </main>
  );
}
