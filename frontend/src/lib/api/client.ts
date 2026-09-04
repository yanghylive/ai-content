const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getApiBase() {
  /**
   * 单入口改造（v1.1.70）：所有正式入口（桌面内置静态服务 / 本地 3010
   * serve-static.mjs / 生产 nginx / 移动壳网关）都已做 /api 反代，
   * 前端一律同源相对路径，不再依赖绝对地址直连 3011。
   *
   * 保留两个例外，避免回归：
   * 1. 显式配置 NEXT_PUBLIC_API_BASE 指向非 loopback 域名（云端跨域部署）→ 用绝对地址
   * 2. 显式配置指向 loopback 且运行环境也是 loopback（next dev 无反代，靠它直连 3011）→ 用绝对地址
   *    显式 loopback 配置但跑在真实域名（生产 web 构建期误注入字面量）→ 回落同源 /api
   *
   * 关键坑（历史教训）：NEXT_PUBLIC_API_BASE 在 next build 时被内联成字面量，
   * 客户端没有 localhost:3011 时所有 fetch 必然失败，必须按运行时环境修正。
   */
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_BASE ?? "/api";
  }
  const { protocol, hostname } = window.location;
  const explicit = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      const baseIsLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
      /* API 根统一语义：必须带 /api 前缀（后端 setGlobalPrefix('api')）。
         历史坑（2026-08-12）：显式配置裸 host（如 http://127.0.0.1:3011）时
         若原样返回，login 页 `${apiBase}/auth/wechat/start` 会拼出缺 /api 的
         URL → 后端 404「Cannot GET /auth/wechat/start」，微信登录反复修反复坏。 */
      const withApiRoot = (base: string) => {
        const clean = base.replace(/\/$/, "");
        return clean.endsWith("/api") ? clean : `${clean}/api`;
      };
      if (!baseIsLoopback) {
        // 云端跨域部署：可信的显式绝对地址（补 /api 保证语义一致）
        return withApiRoot(explicit);
      }
      if (LOOPBACK_HOSTS.has(hostname)) {
        // next dev / 本地直连场景（无反代入口）：保留显式 loopback 直连（补 /api）
        return withApiRoot(explicit);
      }
      // 生产 web 构建期误注入 loopback 字面量：回落同源 /api（nginx 反代兜底）
      return `${protocol}//${hostname}/api`;
    } catch {
      // 非法/相对配置（如 /api），忽略走同源
    }
  }
  // 默认：同源 /api（桌面 / 本地 3010 / 生产 nginx / 移动壳均已反代）
  return "/api";
}

// 统一响应格式（与后端 TransformInterceptor 对应）
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
  code?: string;
  details?: unknown;
  requestId?: string;
  traceId?: string;
  retryable?: boolean;
}

// 分页响应格式
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "HTTP_ERROR" | "NETWORK_ERROR" | "TIMEOUT",
    readonly errorCode: string | null = null,
    readonly details: unknown = null,
    readonly requestId: string | null = null,
    readonly traceId: string | null = null,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 面向用户的兜底错误文案（解释 + 操作指引）。
 * 后端 body 有 message 时优先透出（static-server 代理错误已是可读中文）；
 * 只有 502/503/504 无实体网关错误、或后端没给 message 时才走这里的映射。
 */
export function userFacingErrorMessage(
  status: number,
  rawMessage = "",
): string {
  const clean = (rawMessage || "").trim();
  if (clean && clean.length <= 200) {
    return clean;
  }
  switch (status) {
    case 502:
      return "服务暂时不可用（网关错误）。若刚提交了任务，它可能仍在后台执行，请稍后到任务列表确认结果，避免重复提交。";
    case 503:
      return "服务暂不可用，请稍后重试。";
    case 504:
      return "服务响应超时。任务可能仍在后台执行，请稍后查看任务列表确认结果，避免重复提交。";
    default:
      if (status >= 500) return "服务内部错误，请稍后重试。";
      return clean || `请求失败（${status}），请稍后重试。`;
  }
}

/** 默认请求超时（毫秒）。传 timeoutMs: 0 可显式禁用超时。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface ApiRequestOptions extends RequestInit {
  /** 超时时间（毫秒）。不传用默认 30s，传 0 禁用超时。 */
  timeoutMs?: number;
}

/**
 * 底层原始响应（仅内部与特殊场景使用）
 * 普通调用请走 api.get/post 等，语义化结果由 ApiError 承载；
 * 需要读取原始响应体（如 WeChat 通讯录同步的诊断信息）时可用 api.raw。
 */
export interface RawApiResponse {
  ok: boolean;
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}

class ApiClient {
  /**
   * 底层请求：统一注入 x-tenant-id、超时控制与错误分类（网络/超时），
   * 返回原始响应体。request() 与 api.raw 都复用它，保证所有请求
   * 都走同一封装，避免绕过统一行为（缺租户头、无超时等）。
   */
  private async rawRequest(
    path: string,
    options?: ApiRequestOptions,
  ): Promise<RawApiResponse> {
    const url = `${getApiBase()}${path}`;
    const {
      timeoutMs,
      signal: callerSignal,
      ...requestOptions
    } = options || {};
    const isFormData =
      typeof FormData !== "undefined" &&
      requestOptions.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(requestOptions.headers as Record<string, string> | undefined),
    };
    if (typeof window !== "undefined") {
      const tenantId = window.localStorage
        .getItem("ai_content_tenant_id")
        ?.trim();
      if (tenantId && !headers["x-tenant-id"]) {
        headers["x-tenant-id"] = tenantId;
      }
    }
    // 默认超时：30s；传 0 显式禁用；传具体值覆盖默认
    const effectiveTimeout = timeoutMs === 0 ? null : (timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    const timeoutController = effectiveTimeout ? new AbortController() : null;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const abortForCaller = () => timeoutController?.abort(callerSignal?.reason);

    if (timeoutController && callerSignal) {
      if (callerSignal.aborted) {
        abortForCaller();
      } else {
        callerSignal.addEventListener("abort", abortForCaller, { once: true });
      }
    }
    if (timeoutController && effectiveTimeout) {
      timeout = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, effectiveTimeout);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        credentials: "include",
        ...requestOptions,
        headers,
        signal: timeoutController?.signal ?? callerSignal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiError("请求超时", 0, "TIMEOUT", null, null, null, null, true);
      }
      if (callerSignal?.aborted) {
        throw error;
      }
      throw new ApiError("网络请求失败", 0, "NETWORK_ERROR", null, null, null, null, true);
    } finally {
      if (timeout) clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortForCaller);
    }

    const text = await res.text();
    let json: Record<string, unknown> | null = null;

    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = null;
      }
    }

    return { ok: res.ok, status: res.status, text, json };
  }

  // 通用请求方法（语义化：非 2xx / success:false 抛 ApiError，成功返回 data）
  private async request<T>(
    path: string,
    options?: ApiRequestOptions,
  ): Promise<T> {
    const raw = await this.rawRequest(path, options);
    const body = raw.json;
    if (!raw.ok || !body || body.success !== true) {
      const requestId =
        typeof body?.requestId === "string" ? body.requestId : undefined;
      const traceId =
        typeof body?.traceId === "string" ? body.traceId : undefined;
      const retryable =
        typeof body?.retryable === "boolean" ? body.retryable : raw.status >= 500;
      // v1.1.89+：5xx 自动上报（带 requestId/traceId 精确定位后端日志），静默失败
      if (raw.status >= 500 && typeof window !== "undefined") {
        try {
          void fetch("/api/error-report/client", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestId,
              traceId,
              url: window.location.href,
              message:
                typeof body?.message === "string" && body.message
                  ? body.message
                  : `请求失败: ${raw.status}`,
              status: raw.status,
              context: `api:${path}`,
            }),
            keepalive: true,
          }).catch(() => undefined);
        } catch {
          /* 静默 */
        }
      }
      throw new ApiError(
        userFacingErrorMessage(
          raw.status,
          typeof body?.message === "string" ? body.message : "",
        ),
        raw.status,
        "HTTP_ERROR",
        typeof body?.code === "string" ? body.code : null,
        body?.details ?? null,
        requestId ?? null,
        traceId ?? null,
        retryable,
      );
    }
    return body.data as T;
  }

  /**
   * 暴露底层请求：返回原始响应（成功与否由调用方自行判定），
   * 但仍走统一封装（x-tenant-id 注入 / 超时 / 错误分类）。
   * 用于需要读取非标准响应结构的场景，避免直接用原生 fetch。
   */
  async raw(path: string, options?: ApiRequestOptions): Promise<RawApiResponse> {
    return this.rawRequest(path, options);
  }

  async get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, options);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async upload<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: formData,
    });
  }

  url(path: string): string {
    return `${getApiBase()}${path}`;
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

export const api = new ApiClient();
