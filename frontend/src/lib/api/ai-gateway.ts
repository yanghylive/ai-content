/** AI 对话网关客户端（P0.5）：SSE 流式对话 + 工具调用事件 */

export interface AiChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type AiGatewayEvent =
  | { type: "text"; content: string }
  | { type: "tool_exec"; name: string; summary: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * 流式对话：POST /api/ai-gateway/chat → 逐事件回调。
 * 事件协议（与后端 AiGatewayService 对齐）：
 *   {type:"text",content} 增量文本 / {type:"tool_exec",name,summary} 工具执行
 *   {type:"done"} 结束 / {type:"error",message} 失败
 */
export async function chatStream(
  messages: AiChatMessage[],
  onEvent: (event: AiGatewayEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/ai-gateway/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const message = text.startsWith("{")
      ? (JSON.parse(text) as { message?: string })?.message
      : undefined;
    throw new Error(message || `对话失败（${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6)) as AiGatewayEvent;
        onEvent(event);
        if (event.type === "done" || event.type === "error") return;
      } catch {
        /* 忽略损坏行 */
      }
    }
  }
}

/** 浏览器端语音识别（Web Speech API，P0.5 体验；P1 换阿里 ASR 服务端） */
export function browserSpeechRecognition(): {
  start: () => void;
  stop: () => void;
  /** 注册识别结果回调 */
  onResult: (fn: (text: string) => void) => void;
  /** 注册错误回调 */
  onError: (fn: (message: string) => void) => void;
  supported: boolean;
} {
  const SpeechRecognition = (
    window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }
  ).SpeechRecognition;

  const webkitSpeechRecognition = (
    window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }
  ).webkitSpeechRecognition;

  const Ctor = SpeechRecognition || webkitSpeechRecognition;
  if (!Ctor) {
    return {
      start: () => {},
      stop: () => {},
      onResult: () => {},
      onError: (m) => console.warn(m),
      supported: false,
    };
  }

  const recognition = new Ctor();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  const handlers: {
    onResult: (text: string) => void;
    onError: (message: string) => void;
  } = { onResult: () => {}, onError: () => {} };

  recognition.onresult = (event) => {
    const text = Array.from(event.results)
      .map((r) => r[0]?.transcript ?? "")
      .join("");
    if (text.trim()) handlers.onResult(text.trim());
  };
  recognition.onerror = (event) => {
    handlers.onError(`语音识别失败：${event.error ?? "未知错误"}`);
  };
  recognition.onend = () => {};

  return {
    start: () => {
      try {
        recognition.start();
      } catch {
        /* 已启动则忽略 */
      }
    },
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* 已停止则忽略 */
      }
    },
    onResult: (fn) => (handlers.onResult = fn),
    onError: (fn) => (handlers.onError = fn),
    supported: true,
  };
}

/** 轻量语音识别兼容接口（避免引入 DOM 类型耦合） */
interface SpeechRecognitionResult {
  [index: number]: { transcript?: string };
  length: number;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<SpeechRecognitionResult> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
