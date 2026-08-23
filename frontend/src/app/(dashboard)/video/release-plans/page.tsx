"use client";

/**
 * 视频发布计划（炼刀 /video_release_plan/* 对标）
 * 展示定时发布的视频任务列表。后端读 runtime_executions.runtimeJson，
 * 只返回 enableTimer=1 / scheduleTime / plannedAt 且未取消的任务。
 */
import React, { useEffect, useState } from "react";
import { CalendarClock, Clock } from "lucide-react";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { videoApi, type ReleasePlan } from "@/lib/api/video";
import { toPublicError } from "@/lib/public-error";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { V2EmptyState, V2StatusChip } from "@/components/v2/ui-kit";

const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
};

const statusLabel = (status: string) =>
  status === "waiting" ? "待发布" : status === "completed" ? "已发布" : status;

export default function ReleasePlansPage() {
  const isMobile = useIsMobile();
  const [plans, setPlans] = useState<ReleasePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    videoApi
      .listReleasePlans()
      .then((data) => {
        if (!active) return;
        setPlans(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!active) return;
        setErr(toPublicError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const listView =
    loading ? (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-field-bg)]"
          />
        ))}
      </div>
    ) : plans.length === 0 ? (
      <V2EmptyState
        icon={CalendarClock}
        title="暂无定时发布的视频任务"
        description="在发布时开启「定时发布」并设置时间，任务会出现在这里。"
      />
    ) : (
      <ul className="divide-y divide-[var(--kaypal-v3-border)]">
        {plans.map((plan) => (
          <li
            key={plan.id}
            className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                {plan.title || "未命名发布计划"}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {plan.platforms.length > 0 ? (
                  plan.platforms.map((p) => (
                    <V2StatusChip key={p} tone="accent">
                      {p}
                    </V2StatusChip>
                  ))
                ) : (
                  <V2StatusChip tone="muted">未指定平台</V2StatusChip>
                )}
                <V2StatusChip
                  tone={plan.status === "waiting" ? "warning" : "success"}
                >
                  {statusLabel(plan.status)}
                </V2StatusChip>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--kaypal-v3-muted)]">
              <Clock className="h-3.5 w-3.5" />
              <span>{fmtTime(plan.scheduleTime)}</span>
            </div>
          </li>
        ))}
      </ul>
    );

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ marginTop: 8 }}>
          <V2BackButton to="/content" />
        </div>
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">视频发布计划</h1>
              <p className="mx-page-sub">定时发布的视频任务列表</p>
            </div>
          </div>
        </header>
        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {err ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", marginBottom: 12 }}>
              ⚠️ {err}
            </p>
          ) : null}
          <div className="mx-card" style={{ padding: 16 }}>
            {listView}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <header>
        <div className="kx-page-head"><div><h1 className="kx-greet text-[var(--kaypal-v3-ink)]">视频发布计划</h1><p className="kx-greet-sub text-[var(--kaypal-v3-muted)]">定时发布任务与计划管理</p></div></div>
        <p style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>
          定时发布的视频任务列表（开启定时发布的发布任务会在这里显示）
        </p>
      </header>
      {err ? (
        <p style={{ fontSize: 13, color: "var(--kaypal-v3-danger)" }}>⚠️ {err}</p>
      ) : null}
      <div className="kaypal-v3-panel p-6">{listView}</div>
    </div>
  );
}
