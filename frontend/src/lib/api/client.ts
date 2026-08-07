const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getApiBase() {
  /**
   * 把构建期注入的 base URL 修正为运行时真正可达的地址。
   *
   * 关键坑：`NEXT_PUBLIC_API_BASE` 在 `next build` 时会被**内联成字面量**。
   * 本地 .env.local 写的是 http://localhost:3011/api，于是生产 / 手机壳 WebView 里
   * 这个字面量原样保留 —— 客户端根本没有 localhost:3011，所有 fetch 必然失败
   * （登录失败 / /auth/me 永远 pending / 设备码授权启动不了，全是这一个根因）。
   * 因此：只要 base 指向 loopback 而运行环境不是 loopback，一律改走同源 /api
   * （生产 nginx 已把 /api/* 反代到后端 3011）。
   */
  const resolveRuntimeBase = (
    baseUrl: string,
    currentHostname: string,
    currentProtocol: string,
  ) => {
    if (!currentHostname) {
      return baseUrl;
    }

    try {
      const parsed = new URL(baseUrl);
      const baseIsLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
      const hostIsLoopback = LOOPBACK_HOSTS.has(currentHostname);

      // 两边都是 loopback：对齐 host（localhost ↔ 127.0.0.1），保留 3011 直连
      if (baseIsLoopback && hostIsLoopback) {
        parsed.hostname = currentHostname;
        return parsed.toString().replace(/\/$/, "");
      }

      // base 指向 loopback 但跑在真实域名（生产 web / Android WebView 壳）：
      // 构建期字面量不可达，强制回落到同源 /api
      if (baseIsLoopback && !hostIsLoopback) {
        return `${currentProtocol}//${currentHostname}/api`;
      }
    } catch {
      return baseUrl;
    }

    return baseUrl;
  };

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;

    if (process.env.NEXT_PUBLIC_API_BASE) {
      return resolveRuntimeBase(
        process.env.NEXT_PUBLIC_API_BASE,
        hostname,
        protocol,
      );
    }

    // 无 env 注入时：loopback 走 3011 直连（dev），其余一律同源 /api
    if (LOOPBACK_HOSTS.has(hostname)) {
      return `${protocol}//${hostname}:3011/api`;
    }
    return `${protocol}//${hostname}/api`;
  }

  return process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3011/api";
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
