import { useCallback, useReducer } from "react";

/**
 * P0 规范层 · 统一异步状态机（对应 PRD 验收 check 1/2）
 *
 * 约束（来自 PRD 验收清单）：
 * - 异步动作必须处于 idle / loading / success / error / timeout 五态之一
 * - 真实进度只能由后端回传赋值（setProgress），禁止内部伪造百分比
 * - 超过 timeoutMs 且未返回时进入 timeout 态，并中止请求
 *
 * 用法：
 *   const { status, isLoading, data, error, run, setProgress, reset } = useAsyncState(fetchX);
 *   await run(); // 超时/异常自动归位，不会卡在 loading
 */

export type AsyncStatus = "idle" | "loading" | "success" | "error" | "timeout";

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: Error | null;
  /** 真实进度 0-100，仅由后端回传赋值，禁止伪造。无进度源时为 null。 */
  progress: number | null;
  isIdle: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isTimeout: boolean;
}

export interface UseAsyncStateOptions {
  /** 超时毫秒；超过则置 timeout 并 abort。asyncFn 需消费 AbortSignal。 */
  timeoutMs?: number;
}

type Action<T> =
  | { type: "load" }
  | { type: "success"; data: T }
  | { type: "error"; error: Error }
  | { type: "timeout" }
  | { type: "progress"; value: number }
  | { type: "reset" };

function reducer<T>(_state: AsyncState<T>, action: Action<T>): AsyncState<T> {
  switch (action.type) {
    case "load":
      return {
        status: "loading",
        data: null,
        error: null,
        progress: null,
        isIdle: false,
        isLoading: true,
        isSuccess: false,
        isError: false,
        isTimeout: false,
      };
    case "success":
      return {
        status: "success",
        data: action.data,
        error: null,
        progress: null,
        isIdle: false,
        isLoading: false,
        isSuccess: true,
        isError: false,
        isTimeout: false,
      };
    case "error":
      return {
        status: "error",
        data: null,
        error: action.error,
        progress: null,
        isIdle: false,
        isLoading: false,
        isSuccess: false,
        isError: true,
        isTimeout: false,
      };
    case "timeout":
      return {
        status: "timeout",
        data: null,
        error: null,
        progress: null,
        isIdle: false,
        isLoading: false,
        isSuccess: false,
        isError: false,
        isTimeout: true,
      };
    case "progress":
      return { ..._state, progress: Math.max(0, Math.min(100, action.value)) };
    case "reset":
      return {
        status: "idle",
        data: null,
        error: null,
        progress: null,
        isIdle: true,
        isLoading: false,
        isSuccess: false,
        isError: false,
        isTimeout: false,
      };
    default:
      return _state;
  }
}

export function useAsyncState<T = unknown>(
  asyncFn: (signal: AbortSignal) => Promise<T>,
  options: UseAsyncStateOptions = {},
) {
  const { timeoutMs } = options;
  const [state, dispatch] = useReducer(reducer<T>, undefined, () =>
    reducer<T>(undefined as unknown as AsyncState<T>, { type: "reset" }),
  );

  const run = useCallback(
    async (signal?: AbortSignal): Promise<T | undefined> => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort);
      dispatch({ type: "load" });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs) {
        timer = setTimeout(() => {
          controller.abort();
          dispatch({ type: "timeout" });
        }, timeoutMs);
      }

      try {
        const data = await asyncFn(controller.signal);
        if (controller.signal.aborted) return undefined;
        clearTimeout(timer);
        dispatch({ type: "success", data });
        return data;
      } catch (err) {
        if (controller.signal.aborted) return undefined;
        clearTimeout(timer);
        dispatch({ type: "error", error: err instanceof Error ? err : new Error(String(err)) });
        return undefined;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
    [asyncFn, timeoutMs],
  );

  const setProgress = useCallback((value: number) => {
    // 仅允许外部（后端回传）显式赋值；禁止内部伪造百分比
    dispatch({ type: "progress", value });
  }, []);

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { ...state, run, setProgress, reset };
}
