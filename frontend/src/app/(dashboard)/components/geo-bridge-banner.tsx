"use client";

import React from "react";
import { Button, Chip } from "@heroui/react";
import toast from "@/lib/toast";
import { ExternalLink } from "lucide-react";
import {
  clearGeoBridgeContext,
  loadGeoBridgeContext,
  postGeoBridgeCallback,
  readGeoBridgeContextFromParams,
  saveGeoBridgeContext,
  syncGeoBridgeTask,
  type GeoBridgeContext,
  type GeoBridgeStatus,
} from "@/lib/geo-bridge";
import { usePathname, useSearchParams } from "next/navigation";

const statusLabels: Record<GeoBridgeStatus, string> = {
  sent_to_ai_content: "已接收",
  running: "执行中",
  published: "已发布",
  waiting_retest: "待复测",
  completed: "已完成",
  blocked: "需要处理",
};

export function GeoBridgeBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [context, setContext] = React.useState<GeoBridgeContext | null>(null);
  const [status, setStatus] =
    React.useState<GeoBridgeStatus>("sent_to_ai_content");
  const [posting, setPosting] = React.useState<GeoBridgeStatus | null>(null);
  const autoAcceptedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const parsed = readGeoBridgeContextFromParams(searchParams);
    if (parsed) {
      saveGeoBridgeContext(parsed);
      void syncGeoBridgeTask(parsed, "sent_to_ai_content");
      setContext(parsed);
      setStatus("sent_to_ai_content");
      return;
    }

    setContext(loadGeoBridgeContext());
  }, [pathname, searchParams]);

  const handleCallback = async (nextStatus: GeoBridgeStatus) => {
    if (!context) return;

    try {
      setPosting(nextStatus);
      const resultUrl =
        typeof window !== "undefined" ? window.location.href : undefined;
      await postGeoBridgeCallback(context, {
        status: nextStatus,
        resultUrl,
        publishedUrl:
          nextStatus === "published" || nextStatus === "completed"
            ? resultUrl
            : undefined,
        attributionNote:
          nextStatus === "running"
            ? "AI Content 已接收并开始处理 GEO 动作。"
            : "AI Content 已完成 GEO 动作，等待 GEO 复测归因。",
      });
      setStatus(nextStatus);
      toast.success(`已回传 GEO：${statusLabels[nextStatus]}`);
    } catch (error) {
      console.error(error);
      toast.error("回传 GEO 失败，请确认 3004 服务可访问");
    } finally {
      setPosting(null);
    }
  };

  React.useEffect(() => {
    if (!context?.callbackUrl) return;
    if (autoAcceptedRef.current === context.actionId) return;
    autoAcceptedRef.current = context.actionId;

    postGeoBridgeCallback(context, {
      status: "running",
      resultUrl:
        typeof window !== "undefined" ? window.location.href : undefined,
      attributionNote: "AI Content 已自动接收 GEO 动作。",
    })
      .then(() => {
        setStatus("running");
      })
      .catch((error) => {
        console.error("Auto GEO callback failed:", error);
      });
  }, [context]);
  if (!context) return null;
  return (
    <div className="mb-4 rounded-[8px] border border-success-200 bg-success-50 px-4 py-3 text-success-900 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Chip color="success" size="sm" variant="flat">
              GEO 联动任务
            </Chip>
            <Chip size="sm" variant="flat">
              {statusLabels[status]}
            </Chip>
            {context.platform ? (
              <Chip size="sm" variant="flat">
                {context.platform}
              </Chip>
            ) : null}
          </div>
          <div className="truncate text-14 font-bold leading-[22px]">
            {context.actionTitle}
          </div>
          <p className="mt-1 line-clamp-2 text-12 leading-5 text-success-800/80">
            {context.brandName ? `${context.brandName} · ` : ""}
            {context.goal || context.reason || "来自 JIUZHANG AI GEO 的执行动作。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            color="success"
            className="h-8 rounded-[8px] font-semibold"
            isLoading={posting === "running"}
            size="sm"
            variant="flat"
            onPress={() => handleCallback("running")}
          >
            标记执行中
          </Button>
          <Button
            color="success"
            className="h-8 rounded-[8px] font-semibold"
            isLoading={posting === "published"}
            size="sm"
            onPress={() => handleCallback("published")}
          >
            完成并回传 GEO
          </Button>
          {context.returnUrl ? (
            <Button
              as="a"
              href={context.returnUrl}
              className="h-8 rounded-[8px] font-semibold"
              size="sm"
              variant="light"
              endContent={
                <ExternalLink
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.75}
                />
              }
            >
              返回 GEO
            </Button>
          ) : null}
          <Button
            className="h-8 rounded-[8px] font-semibold"
            size="sm"
            variant="light"
            onPress={() => {
              clearGeoBridgeContext();
              setContext(null);
            }}
          >
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
