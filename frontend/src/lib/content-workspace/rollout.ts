"use client";

import { useEffect, useState } from "react";
import { getApiBase } from "../api/client.ts";

export const CONTENT_WORKSPACE_FLAG_KEY =
  "content_workspace_result_entry_v1" as const;

export const CONTENT_WORKSPACE_EVENT_NAMES = [
  "result_entry_viewed",
  "intent_form_viewed",
  "intent_submitted",
  "draft_created",
  "draft_create_failed",
] as const;

export type ContentWorkspaceEventName =
  (typeof CONTENT_WORKSPACE_EVENT_NAMES)[number];

export const CONTENT_WORKSPACE_METRIC_EVENT =
  "kaypal:content-workspace-metric" as const;
const CONTENT_WORKSPACE_METRIC_STORAGE_KEY =
  "kaypal:content-workspace-metrics:v1";

type RolloutEnvironment = Record<string, string | undefined>;

// Keep the public build-time values as direct env references so Next.js can
// inline them into the client bundle. A dynamic `process.env` lookup is not
// replaced for browser code and would silently force every cohort to closed.
const buildTimeRolloutEnvironment: RolloutEnvironment = {
  NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED:
    process.env.NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED,
  NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT:
    process.env.NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT,
};

export type ContentWorkspaceRolloutConfig = {
  flagKey: typeof CONTENT_WORKSPACE_FLAG_KEY;
  enabled: boolean;
  rolloutPercent: number;
};

export type ContentWorkspaceRolloutState =
  | { status: "loading" }
  | ({ status: "disabled" } & ContentWorkspaceRolloutConfig & {
      reason:
        | "flag_off"
        | "zero_percent"
        | "not_eligible"
        | "auth_unavailable";
      bucket: number | null;
    })
  | ({ status: "enabled" } & ContentWorkspaceRolloutConfig & {
      reason: "eligible";
      bucket: number;
    });

export type ContentWorkspaceMetric = {
  schemaVersion: 1;
  eventName: ContentWorkspaceEventName;
  flagKey: typeof CONTENT_WORKSPACE_FLAG_KEY;
  flagEnabled: boolean;
  rolloutPercent: number;
  task?: string;
  platform?: string;
  errorCode?: string;
  occurredAt: string;
};

function readBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function readPercent(value: string | undefined) {
  const normalized = value?.trim() || "";
  if (!/^\d+$/.test(normalized)) return 0;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
}

export function readContentWorkspaceRolloutConfig(
  env: RolloutEnvironment = buildTimeRolloutEnvironment,
): ContentWorkspaceRolloutConfig {
  return {
    flagKey: CONTENT_WORKSPACE_FLAG_KEY,
    enabled: readBoolean(env.NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED),
    rolloutPercent: readPercent(
      env.NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT,
    ),
  };
}

export function contentWorkspaceBucket(value: string) {
  let hash = 2166136261;
  for (const character of `${CONTENT_WORKSPACE_FLAG_KEY}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

export function isContentWorkspaceRolloutEligible(
  config: ContentWorkspaceRolloutConfig,
  bucket: number,
) {
  return config.enabled && config.rolloutPercent > bucket;
}

async function resolveContentWorkspaceRollout(): Promise<ContentWorkspaceRolloutState> {
  const config = readContentWorkspaceRolloutConfig();
  if (!config.enabled) {
    return { ...config, status: "disabled", reason: "flag_off", bucket: null };
  }
  if (config.rolloutPercent === 0) {
    return {
      ...config,
      status: "disabled",
      reason: "zero_percent",
      bucket: null,
    };
  }

  try {
    const userKey = await readAuthenticatedUserKey();
    if (!userKey) {
      return {
        ...config,
        status: "disabled",
        reason: "auth_unavailable",
        bucket: null,
      };
    }
    const bucket = contentWorkspaceBucket(userKey);
    return isContentWorkspaceRolloutEligible(config, bucket)
      ? { ...config, status: "enabled", reason: "eligible", bucket }
      : { ...config, status: "disabled", reason: "not_eligible", bucket };
  } catch {
    return {
      ...config,
      status: "disabled",
      reason: "auth_unavailable",
      bucket: null,
    };
  }
}

async function readAuthenticatedUserKey() {
  if (typeof window === "undefined") return null;
  // 统一走 getApiBase()：运行时把 loopback base 纠正为同源 /api，
  // 避免 NEXT_PUBLIC_API_BASE 被内联成 localhost:3011 后手机端请求打自己端口。
  const baseUrl = getApiBase();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/me`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    data?: { id?: unknown };
    id?: unknown;
  };
  const data = payload?.data ?? payload;
  return typeof data?.id === "string" ? data.id.trim() || null : null;
}

export function useContentWorkspaceRollout(shouldEvaluate = true) {
  const disabledState: ContentWorkspaceRolloutState = {
    ...readContentWorkspaceRolloutConfig(),
    status: "disabled",
    reason: "flag_off",
    bucket: null,
  };
  const [state, setState] = useState<ContentWorkspaceRolloutState>(() =>
    shouldEvaluate
      ? { status: "loading" }
      : disabledState,
  );

  useEffect(() => {
    if (!shouldEvaluate) return;

    let active = true;
    void resolveContentWorkspaceRollout().then((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
    };
  }, [shouldEvaluate]);

  return shouldEvaluate ? state : disabledState;
}

export function recordContentWorkspaceMetric(
  eventName: ContentWorkspaceEventName,
  state: ContentWorkspaceRolloutState,
  details: Pick<
    ContentWorkspaceMetric,
    "task" | "platform" | "errorCode"
  > = {},
) {
  if (typeof window === "undefined" || state.status === "loading") return;

  const metric: ContentWorkspaceMetric = {
    schemaVersion: 1,
    eventName,
    flagKey: CONTENT_WORKSPACE_FLAG_KEY,
    flagEnabled: state.status === "enabled",
    rolloutPercent: state.rolloutPercent,
    occurredAt: new Date().toISOString(),
    ...(typeof details.task === "string" ? { task: details.task } : {}),
    ...(typeof details.platform === "string"
      ? { platform: details.platform }
      : {}),
    ...(typeof details.errorCode === "string"
      ? { errorCode: details.errorCode }
      : {}),
  };

  try {
    window.dispatchEvent(
      new CustomEvent(CONTENT_WORKSPACE_METRIC_EVENT, { detail: metric }),
    );
    const stored = window.sessionStorage.getItem(
      CONTENT_WORKSPACE_METRIC_STORAGE_KEY,
    );
    const previous = stored ? JSON.parse(stored) : [];
    const metrics = Array.isArray(previous) ? previous.slice(-99) : [];
    window.sessionStorage.setItem(
      CONTENT_WORKSPACE_METRIC_STORAGE_KEY,
      JSON.stringify([...metrics, metric]),
    );
  } catch {
    // Metrics must never block the content workflow.
  }
}
