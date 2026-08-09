import type { LocalBridgeAction } from "./actions";
import { LocalBridgeError } from "./errors";
import {
  isLocalBridgeResponse,
  LOCAL_BRIDGE_PROTOCOL,
  LOCAL_BRIDGE_PROTOCOL_VERSION,
  type LocalBridgeRequest,
  type LocalBridgeResponse,
} from "./protocol";

const DEFAULT_TIMEOUT_MS = 3_000;

type PendingRequest = {
  action: LocalBridgeAction;
  resolve: (value: unknown) => void;
  reject: (reason: LocalBridgeError) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
};

export interface LocalBridgeRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createTraceId(): string {
  return globalThis.crypto.randomUUID?.() ?? randomHex(16);
}

export class LocalBridgeClient {
  private readonly pending = new Map<string, PendingRequest>();
  private listening = false;

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!isLocalBridgeResponse(event.data)) return;

    const response = event.data;
    const pending = this.pending.get(response.traceId);
    if (!pending || pending.action !== response.action) return;

    this.clearPending(response.traceId, pending);
    if (!response.ok) {
      pending.reject(
        new LocalBridgeError(
          response.errorCode,
          response.message || "本地执行器请求失败",
          response.traceId,
        ),
      );
      return;
    }
    pending.resolve(response.data);
  };

  request<TResponse, TRequest = unknown>(
    action: LocalBridgeAction,
    data: TRequest,
    options: LocalBridgeRequestOptions = {},
  ): Promise<TResponse> {
    if (typeof window === "undefined" || !globalThis.crypto) {
      return Promise.reject(
        new LocalBridgeError("SSR_UNAVAILABLE", "本地执行器仅可在浏览器中访问"),
      );
    }

    const traceId = createTraceId();
    const request: LocalBridgeRequest<TRequest> = {
      protocol: LOCAL_BRIDGE_PROTOCOL,
      version: LOCAL_BRIDGE_PROTOCOL_VERSION,
      type: "request",
      traceId,
      action,
      timestamp: Date.now(),
      nonce: randomHex(16),
      data,
    };

    return new Promise<TResponse>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new LocalBridgeError("REQUEST_ABORTED", "本地执行器请求已取消", traceId));
        return;
      }

      this.startListening();
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const pending: PendingRequest = {
        action,
        resolve: (value) => resolve(value as TResponse),
        reject,
        timeoutId: setTimeout(() => {
          const current = this.pending.get(traceId);
          if (!current) return;
          this.clearPending(traceId, current);
          reject(
            new LocalBridgeError(
              "REQUEST_TIMEOUT",
              `本地执行器在 ${timeoutMs}ms 内未响应`,
              traceId,
            ),
          );
        }, timeoutMs),
      };

      if (options.signal) {
        const handleAbort = () => {
          const current = this.pending.get(traceId);
          if (!current) return;
          this.clearPending(traceId, current);
          reject(new LocalBridgeError("REQUEST_ABORTED", "本地执行器请求已取消", traceId));
        };
        options.signal.addEventListener("abort", handleAbort, { once: true });
        pending.removeAbortListener = () =>
          options.signal?.removeEventListener("abort", handleAbort);
      }

      this.pending.set(traceId, pending);
      window.postMessage(request, window.location.origin);
    });
  }

  dispose(): void {
    for (const [traceId, pending] of this.pending) {
      this.clearPending(traceId, pending);
      pending.reject(
        new LocalBridgeError("REQUEST_ABORTED", "本地执行器客户端已关闭", traceId),
      );
    }
    this.stopListening();
  }

  private startListening(): void {
    if (this.listening) return;
    window.addEventListener("message", this.handleMessage);
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening || typeof window === "undefined") return;
    window.removeEventListener("message", this.handleMessage);
    this.listening = false;
  }

  private clearPending(traceId: string, pending: PendingRequest): void {
    clearTimeout(pending.timeoutId);
    pending.removeAbortListener?.();
    this.pending.delete(traceId);
    if (this.pending.size === 0) this.stopListening();
  }
}

export const localBridge = new LocalBridgeClient();
export type { LocalBridgeResponse };
