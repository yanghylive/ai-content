import { getApiBase } from "./api/client";

export type GeoBridgeStatus =
    | "sent_to_ai_content"
    | "running"
    | "published"
    | "waiting_retest"
    | "completed"
    | "blocked";

export interface GeoBridgeContext {
    source: "kaypal-geo";
    actionId: string;
    actionType: string;
    actionTitle: string;
    brandId?: string;
    brandName?: string;
    platform?: string;
    brief?: string;
    goal?: string;
    reason?: string;
    retestWindow?: string;
    returnUrl?: string;
    callbackUrl?: string;
    keyword?: string;
    contentPreview?: string;
}

export interface GeoBridgeTask extends GeoBridgeContext {
    id: string;
    status: GeoBridgeStatus;
    receivedAt: string;
    updatedAt: string;
    resultUrl?: string;
    publishedUrl?: string;
    lastCallbackAt?: string;
}

interface ApiResponse<T> {
    success?: boolean;
    data?: T;
    tasks?: GeoBridgeTask[];
    task?: GeoBridgeTask;
}

const GEO_BRIDGE_CONTEXT_KEY = "ai-content-geo-bridge-context";
const GEO_BRIDGE_TASKS_KEY = "ai-content-geo-bridge-tasks";

function normalizeTask(raw: GeoBridgeTask & { createdAt?: string }) {
    return {
        ...raw,
        source: "kaypal-geo" as const,
        receivedAt: raw.receivedAt || raw.createdAt || raw.updatedAt,
    };
}

function unwrapTasks(result: ApiResponse<GeoBridgeTask[]>) {
    return (result.data || result.tasks || []).map((task) => normalizeTask(task));
}

function unwrapTask(result: ApiResponse<GeoBridgeTask>) {
    const task = result.data || result.task || null;
    return task ? normalizeTask(task) : null;
}

export function readGeoBridgeContextFromParams(searchParams: URLSearchParams): GeoBridgeContext | null {
    if (searchParams.get("source") !== "kaypal-geo") return null;

    const actionId = searchParams.get("actionId");
    const actionType = searchParams.get("actionType");
    if (!actionId || !actionType) return null;

    const brief = searchParams.get("brief") || "";

    return {
        source: "kaypal-geo",
        actionId,
        actionType,
        actionTitle: brief || actionType,
        brandId: searchParams.get("brandId") || undefined,
        brandName: searchParams.get("brandName") || undefined,
        platform: searchParams.get("platform") || undefined,
        brief,
        goal: searchParams.get("goal") || undefined,
        reason: searchParams.get("reason") || undefined,
        retestWindow: searchParams.get("retestWindow") || undefined,
        returnUrl: searchParams.get("returnUrl") || undefined,
        callbackUrl: searchParams.get("callbackUrl") || undefined,
        keyword: searchParams.get("keyword") || undefined,
        contentPreview: searchParams.get("contentPreview") || undefined,
    };
}

export function saveGeoBridgeContext(context: GeoBridgeContext) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(GEO_BRIDGE_CONTEXT_KEY, JSON.stringify(context));
}

export function loadGeoBridgeContext() {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.sessionStorage.getItem(GEO_BRIDGE_CONTEXT_KEY);
        return raw ? (JSON.parse(raw) as GeoBridgeContext) : null;
    } catch {
        return null;
    }
}

export function clearGeoBridgeContext() {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(GEO_BRIDGE_CONTEXT_KEY);
}

export function listGeoBridgeTasks() {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(GEO_BRIDGE_TASKS_KEY);
        const tasks = raw ? (JSON.parse(raw) as GeoBridgeTask[]) : [];
        return tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch {
        return [];
    }
}

export function upsertGeoBridgeTask(context: GeoBridgeContext, status: GeoBridgeStatus = "sent_to_ai_content") {
    if (typeof window === "undefined") return null;
    const tasks = listGeoBridgeTasks();
    const now = new Date().toISOString();
    const existing = tasks.find((task) => task.actionId === context.actionId);
    const nextTask: GeoBridgeTask = {
        ...(existing || {}),
        ...context,
        id: existing?.id || `geo-task-${Date.now()}`,
        status,
        receivedAt: existing?.receivedAt || now,
        updatedAt: now,
    };
    const nextTasks = [nextTask, ...tasks.filter((task) => task.actionId !== context.actionId)].slice(0, 50);
    window.localStorage.setItem(GEO_BRIDGE_TASKS_KEY, JSON.stringify(nextTasks));
    return nextTask;
}

export function updateGeoBridgeTask(
    actionId: string,
    patch: Partial<Pick<GeoBridgeTask, "status" | "resultUrl" | "publishedUrl" | "lastCallbackAt">>,
) {
    if (typeof window === "undefined") return null;
    const tasks = listGeoBridgeTasks();
    const existing = tasks.find((task) => task.actionId === actionId);
    if (!existing) return null;
    const nextTask: GeoBridgeTask = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
        GEO_BRIDGE_TASKS_KEY,
        JSON.stringify([nextTask, ...tasks.filter((task) => task.actionId !== actionId)]),
    );
    return nextTask;
}

export async function fetchGeoBridgeTasks(limit = 50) {
    try {
        const response = await fetch(`${getApiBase()}/geo-bridge/tasks?limit=${limit}`, {
            cache: "no-store",
            credentials: "include",
        });
        if (!response.ok) throw new Error(`GEO backend task API failed: ${response.status}`);
        return unwrapTasks(await response.json());
    } catch {
        // Fallback to the Next API for local/offline development.
    }

    // Fallback to local storage
    return listGeoBridgeTasks().slice(0, limit);
}

export async function syncGeoBridgeTask(context: GeoBridgeContext, status: GeoBridgeStatus = "sent_to_ai_content") {
    const localTask = upsertGeoBridgeTask(context, status);
    try {
        const response = await fetch(`${getApiBase()}/geo-bridge/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ ...context, status }),
        });
        if (!response.ok) throw new Error(`GEO backend task sync failed: ${response.status}`);
        return unwrapTask(await response.json()) || localTask;
    } catch {
        return localTask;
    }
}

export async function patchGeoBridgeTask(
    actionId: string,
    patch: Partial<Pick<GeoBridgeTask, "status" | "resultUrl" | "publishedUrl" | "lastCallbackAt">>,
) {
    const localTask = updateGeoBridgeTask(actionId, patch);
    try {
        const response = await fetch(`${getApiBase()}/geo-bridge/tasks`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ actionId, ...patch }),
        });
        if (!response.ok) throw new Error(`GEO task patch failed: ${response.status}`);
        return unwrapTask(await response.json()) || localTask;
    } catch {
        return localTask;
    }
}

export async function postGeoBridgeCallback(
    context: GeoBridgeContext,
    input: {
        status: GeoBridgeStatus;
        aiContentTaskId?: string;
        resultUrl?: string;
        publishedUrl?: string;
        attributionNote?: string;
    },
) {
    if (!context.callbackUrl) {
        throw new Error("Missing GEO callbackUrl");
    }

    const response = await fetch(context.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            actionId: context.actionId,
            actionType: context.actionType,
            actionTitle: context.actionTitle,
            brandId: context.brandId,
            brandName: context.brandName,
            platform: context.platform || "AI Content",
            status: input.status,
            aiContentTaskId: input.aiContentTaskId,
            resultUrl: input.resultUrl,
            publishedUrl: input.publishedUrl,
            reason: context.reason,
            expectedImpact: context.goal,
            retestWindow: context.retestWindow,
            attributionNote: input.attributionNote,
        }),
    });

    if (!response.ok) {
        throw new Error(`GEO callback failed: ${response.status}`);
    }

    const result = await response.json();
    await patchGeoBridgeTask(context.actionId, {
        status: input.status,
        resultUrl: input.resultUrl,
        publishedUrl: input.publishedUrl,
        lastCallbackAt: new Date().toISOString(),
    });
    return result;
}
