"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Home, SearchX } from "@/components/iconpark";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";

export default function RootNotFound() {
  const router = useRouter();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--kaypal-v3-bg)] px-6">
      <V2EmptyState
        icon={SearchX}
        title="页面不存在"
        description="链接可能已失效，或对应记录已经删除、归档。请返回今日工作台继续。"
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <V2PrimaryButton
              icon={Home}
              onClick={() => router.push("/today")}
            >
              返回今日工作台
            </V2PrimaryButton>
            <V2GhostButton icon={ArrowLeft} onClick={() => router.back()}>
              返回上一页
            </V2GhostButton>
          </div>
        }
      />
    </main>
  );
}
