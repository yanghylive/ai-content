import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError, userFacingErrorMessage } from "./client";

describe("ApiClient 超时与中止（P1-2 Local Engine 健康检查依赖的底层）", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("timeoutMs 到期后中止请求并抛 TIMEOUT（P1-2 核心：health 挂起不再无限等待）", async () => {
    // fetch 永不 resolve（模拟本机引擎未启动时挂起），但响应 abort
    fetchMock.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });

    const promise = api.get("/local-engine/health", { timeoutMs: 12_000 });
    // 先挂一个 no-op handler，避免定时器推进期间产生 unhandled rejection 告警
    void promise.catch(() => {});
    // 断言 fetch 收到 AbortController 的 signal
    const fetchArgs = fetchMock.mock.calls[0]!;
    expect(fetchArgs[1].signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(12_001);

    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      code: "TIMEOUT",
      message: "请求超时",
    });
  });

  it("未传 timeoutMs 时挂默认 30s 超时（P1-9：接口挂起不再无限转圈），正常响应不受影响", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: 1 }, message: "" }), { status: 200 }),
    );
    await expect(api.get("/some-path")).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("timeoutMs: 0 显式禁用超时不挂 AbortSignal（长轮询等场景）", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: 2 }, message: "" }), { status: 200 }),
    );
    await expect(api.get("/some-path", { timeoutMs: 0 })).resolves.toEqual({ ok: 2 });
    expect(fetchMock.mock.calls[0]![1].signal).toBeUndefined();
  });

  it("调用方 signal 中止时透传错误（非 TIMEOUT 包装）", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      return new Promise((_resolve, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const promise = api.get("/some-path", { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("普通网络错误映射为 NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.get("/some-path")).rejects.toMatchObject({
      name: "ApiError",
      code: "NETWORK_ERROR",
    });
  });
});

describe("ApiClient 响应解析", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("200 + success:true 返回 data", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { ok: 1 }, message: "" }),
        { status: 200 },
      ),
    );
    await expect(api.get<{ ok: number }>("/x")).resolves.toEqual({ ok: 1 });
  });

  it("200 + success:false 抛 ApiError 且带后端 message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, data: null, message: "后端拒绝" }),
        { status: 200 },
      ),
    );
    await expect(api.get("/x")).rejects.toMatchObject({
      name: "ApiError",
      message: "后端拒绝",
    });
  });

  it("非 JSON 响应按错误处理不崩溃", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Internal Server Error</html>", { status: 500 }),
    );
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("userFacingErrorMessage 网关错误业务域文案（2026-09-04 大王定调）", () => {
  it("/growth 网关错误 → 采集引擎不可用", () => {
    const msg = userFacingErrorMessage(502, "", "/growth/acquisition/configs/x/execute");
    expect(msg).toContain("采集引擎不可用");
    expect(msg).not.toContain("502");
  });

  it("/auto-upload 网关错误 → 发布服务不可用", () => {
    const msg = userFacingErrorMessage(504, "", "/auto-upload/accounts/publish");
    expect(msg).toContain("发布服务不可用");
  });

  it("/local-engine 网关错误 → 本地引擎不可用", () => {
    const msg = userFacingErrorMessage(503, "", "/local-engine/health");
    expect(msg).toContain("本地引擎不可用");
  });

  it("/compliance、/video、/api/ai 映射业务标签", () => {
    expect(userFacingErrorMessage(502, "", "/compliance/check")).toContain("合规检查不可用");
    expect(userFacingErrorMessage(504, "", "/video-generation/tasks")).toContain("视频服务不可用");
    expect(userFacingErrorMessage(502, "", "/api/ai/image")).toContain("AI 生成服务不可用");
  });

  it("未收录路径的网关错误走通用中文解释", () => {
    const msg = userFacingErrorMessage(502, "", "/crm/customers");
    expect(msg).toContain("服务暂时不可用");
  });

  it("非网关错误优先透出后端 message", () => {
    const msg = userFacingErrorMessage(400, "客户名称不能为空", "/crm/customers");
    expect(msg).toBe("客户名称不能为空");
  });
});
