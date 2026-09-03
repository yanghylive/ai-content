"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@heroui/react";
import { RefreshCw, TriangleAlert } from "@/components/iconpark";

export default function ContentWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Content workspace route failed:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[55vh] w-full max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-danger-50 text-danger">
        <TriangleAlert aria-hidden="true" size={24} />
      </span>
      <div>
        <h1 className="text-foreground">内容工作台暂时无法打开</h1>
        <p className="mt-2 text-sm leading-6 text-default-500">
          可以重新加载本页；已保存的草稿不会受影响。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button color="primary" startContent={<RefreshCw aria-hidden="true" size={16} />} onPress={reset}>
          重新加载
        </Button>
        <Button as={Link} href="/content" startContent={<RefreshCw aria-hidden="true" size={16} />} variant="flat">
          返回内容中心
        </Button>
      </div>
    </main>
  );
}
