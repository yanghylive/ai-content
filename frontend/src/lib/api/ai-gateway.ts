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

/** 语音识别统一句柄（Web Speech / 百炼 ASR 同构） */
export interface AsrHandle {
  start: () => void;
  stop: () => void;
  /** 注册识别结果回调 */
  onResult: (fn: (text: string) => void) => void;
  /** 注册错误回调 */
  onError: (fn: (message: string) => void) => void;
  supported: boolean;
}

/**
 * 阿里百炼语音识别（B3）：浏览器 MediaRecorder 录音 → 上传 /api/ai/asr → 文本。
 * 替代 Web Speech API（百炼识别更准、无浏览器兼容问题）。
 * 录音上限 30s，超时自动停止上传。
 */
export function dashscopeAsrRecognition(): AsrHandle {
  const handlers: { onResult: (text: string) => void; onError: (message: string) => void } =
    { onResult: () => {}, onError: () => {} };

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const supported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    recorder = null;
    chunks = [];
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  const upload = async (blob: Blob) => {
    try {
      const ext = (blob.type.includes("mp4") ? "m4a" : "webm") as "m4a" | "webm";
      const form = new FormData();
      form.append("file", blob, `voice-${Date.now()}.${ext}`);
      const res = await fetch("/api/ai/asr", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { success?: boolean; data?: { text?: string }; message?: string };
      if (!res.ok || !json.success) {
        handlers.onError(json.message || `语音识别失败（${res.status}）`);
        return;
      }
      const text = (json.data?.text || "").trim();
      if (text) handlers.onResult(text);
      else handlers.onError("未能识别到语音内容，请重试");
    } catch {
      handlers.onError("语音识别网络异常，请检查连接后重试");
    }
  };

  return {
    start: () => {
      if (!supported || recorder) return;
      void navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((s) => {
          stream = s;
          // 优先 AAC（mp4）减小体积；不支持则用默认（webm/opus，百炼兼容）
          const mimeType = MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
          recorder = mimeType
            ? new MediaRecorder(s, { mimeType })
            : new MediaRecorder(s);
          chunks = [];
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
            void upload(blob);
          };
          recorder.start();
          timer = setTimeout(() => {
            try {
              recorder?.stop();
            } catch {
              /* 已停则忽略 */
            }
          }, 30000); // 30s 上限
        })
        .catch(() => handlers.onError("无法访问麦克风，请检查浏览器权限"));
    },
    stop: () => {
      try {
        recorder?.stop();
      } catch {
        /* 已停则忽略 */
      }
      cleanup();
    },
    onResult: (fn) => (handlers.onResult = fn),
    onError: (fn) => (handlers.onError = fn),
    supported,
  };
}
