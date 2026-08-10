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
      if (!baseIsLoopback) {
        // 云端跨域部署：可信的显式绝对地址
        return explicit.replace(/\/$/, "");
      }
      if (LOOPBACK_HOSTS.has(hostname)) {
        // next dev / 本地直连场景（无反代入口）：保留显式 loopback 直连
        return explicit.replace(/\/$/, "");
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
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

class ApiClient {
  // 通用请求方法
  private async request<T>(
    path: string,
    options?: ApiRequestOptions,
  ): Promise<T> {
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
    const timeoutController = timeoutMs ? new AbortController() : null;
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
    if (timeoutController && timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs);
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
        throw new ApiError("请求超时", 0, "TIMEOUT");
      }
      if (callerSignal?.aborted) {
        throw error;
      }
      throw new ApiError("网络请求失败", 0, "NETWORK_ERROR");
    } finally {
      if (timeout) clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortForCaller);
    }

    const text = await res.text();
    let json: ApiResponse<T> | null = null;

    if (text) {
      try {
        json = JSON.parse(text) as ApiResponse<T>;
      } catch {
        json = null;
      }
    }

    if (!res.ok || !json?.success) {
      throw new ApiError(
        json?.message || `请求失败: ${res.status}`,
        res.status,
        "HTTP_ERROR",
        typeof json?.code === "string" ? json.code : null,
        json?.details ?? null,
        typeof json?.requestId === "string" ? json.requestId : null,
      );
    }

    return json.data;
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
