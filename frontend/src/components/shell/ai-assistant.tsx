"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { savingsApi } from "@/lib/api/savings";
import {
  chatStream,
  type AiChatMessage,
  type AiGatewayEvent,
} from "@/lib/api/ai-gateway";
import { voiceApi } from "@/lib/api/voice";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";

interface ChatItem {
  id: string;
  kind: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  streaming?: boolean;
}

const QUICK_PROMPTS = ["今天有什么热点选题？", "帮我检查一段文案有没有违禁词", "怎么提升内容质量？"];

/** 省钱返利快捷场景（M6 顺手省钱：找货/盯价/资产/支付） */
const SAVINGS_PROMPTS = [
  "我返利还有多少？",
  "帮我找 200 块以内的空气炸锅，要返利高的",
  "盯住这个洗发水，降到 39 以下提醒我",
  "把返利余额换成 AI 额度",
  "我要提现 50 块",
  "店里抽纸快没了，列个补货清单",
];

/** 简易 markdown 渲染（加粗/列表/换行），避免引第三方库 */
function renderRichText(text: string): string {
  return text
    .replace(/^###\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^##\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^#\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br/>");
}

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const [textInput, setTextInput] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebateOffer, setRebateOffer] = useState<{
    price: number;
    balance: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 语音输入：16kHz PCM 录音 → 走 /api/voice/asr（kaypal 云端网关 + 积分结算）
  const recorder = useVoiceRecorder();

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  // 关闭时中止进行中的对话
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    scrollToBottom();
  }, [items, scrollToBottom]);

  const send = useCallback(
    async (content: string, rebateReceiptId?: string) => {
      const text = content.trim();
      if (!text || busy) return;
      setBusy(true);
      setError(null);
      const userItem: ChatItem = {
        id: `u-${Date.now()}`,
        kind: "user",
        text,
      };
      const assistantId = `a-${Date.now()}`;
      const assistantItem: ChatItem = {
        id: assistantId,
        kind: "assistant",
        text: "",
        streaming: true,
      };
      setItems((prev) => [...prev, userItem, assistantItem]);
      setTextInput("");

      const history: AiChatMessage[] = [
        { role: "user", content: text },
      ];

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await chatStream(
          history,
          (event: AiGatewayEvent) => {
            if (event.type === "text") {
              setItems((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? { ...item, text: item.text + event.content }
                    : item,
                ),
              );
            } else if (event.type === "tool_exec") {
              setItems((prev) => [
                ...prev,
                {
                  id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  kind: "tool",
                  text: event.summary || `正在执行「${event.name}」…`,
                  toolName: event.name,
                },
              ]);
            } else if (event.type === "error") {
              setError(event.message);
              setItems((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? {
                        ...item,
                        text: `⚠️ ${event.message}`,
                        streaming: false,
                      }
                    : item,
                ),
              );
              // M6：云积分不足 → 引导返利直付（1:1 现金抵扣）
              if (event.message?.includes("云积分不足")) {
                void savingsApi
                  .payCheck("text_generation")
                  .then((info) =>
                    setRebateOffer({
                      price: info.price,
                      balance: info.rebateBalance,
                    }),
                  )
                  .catch(() => setRebateOffer(null));
              }
            }
          },
          controller.signal,
          rebateReceiptId,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setItems((prev) =>
          prev.map((item) =>
            item.id === assistantId
              ? { ...item, text: `⚠️ ${msg}`, streaming: false }
              : item,
          ),
        );
      } finally {
        setItems((prev) =>
          prev.map((item) =>
            item.id === assistantId
              ? { ...item, streaming: false }
              : item,
          ),
        );
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy],
  );

  const handleQuickPrompt = (prompt: string) => {
    void send(prompt);
  };

  // 语音识别：16kHz PCM 录音 → /api/voice/asr（kaypal 云端网关）
  const toggleVoice = async () => {
    if (listening) {
      setListening(false);
      let pcm: ArrayBuffer;
      try {
        pcm = await recorder.stop();
      } catch (err) {
        setError(
          `录音停止失败：${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      if (!pcm || pcm.byteLength === 0) {
        setError("未捕获到声音，请重试");
        return;
      }
      try {
        const result = await voiceApi.asrTranscribe(pcm);
        if (!result.text?.trim()) {
          setError("没有识别到内容，请再试一次");
          return;
        }
        void send(result.text);
      } catch (err) {
        setError(
          `语音识别失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持语音识别，请切换文字输入");
      setInputMode("text");
      return;
    }
    await recorder.start();
    if (recorder.error) {
      setError(recorder.error);
      setInputMode("text");
      return;
    }
    setListening(true);
  };

  const handleSendText = () => {
    if (textInput.trim()) void send(textInput);
  };

  return (
    <>
      {/* 悬浮入口（右下角金色语音钮） */}
      <button
        type="button"
        aria-label="AI 助手"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          right: 18,
          bottom: 84,
          width: 44,
          height: 44,
          borderRadius: 22,
          background: "linear-gradient(135deg,#e39a3e,#f6c478)",
          color: "#173052",
          fontSize: 18,
          border: "1px solid rgba(230,168,84,.55)",
          boxShadow: "0 6px 18px rgba(227,154,62,.35)",
          zIndex: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {busy ? (
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              border: "2px solid rgba(23,48,82,.3)",
              borderTopColor: "#173052",
              animation: "kx-spin .8s linear infinite",
            }}
          />
        ) : (
          "🎤"
        )}
      </button>

      {/* 对话面板 */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            display: "flex",
            flexDirection: "column",
            background: "linear-gradient(180deg,#0d1b2f 0%,#122a4a 100%)",
          }}
        >
          {/* 头部 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              paddingTop: "calc(14px + env(safe-area-inset-top))",
              borderBottom: "1px solid rgba(142,165,190,.2)",
            }}
          >
            <div>
              <div style={{ color: "#f6c478", fontSize: 15, fontWeight: 700 }}>
                AI 助手
              </div>
              <div style={{ color: "rgba(215,230,248,.55)", fontSize: 11 }}>
                正在与 AI 对话，内容由 AI 生成，请注意甄别
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  window.location.href = "/settings/legal";
                }}
                aria-label="合规中心"
                title="用户协议 · 隐私 · 投诉"
                style={{
                  background: "rgba(255,255,255,.08)",
                  border: "none",
                  color: "#d7e6f8",
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                ⓘ
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: "rgba(255,255,255,.08)",
                  border: "none",
                  color: "#d7e6f8",
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* 消息区 */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 14px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {items.length === 0 && (
              <div style={{ marginTop: 18 }}>
                <div
                  style={{
                    color: "#f6c478",
                    fontSize: 16,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  嗨，我是你的 AI 内容运营助手 👋
                </div>
                <div style={{ color: "rgba(215,230,248,.7)", fontSize: 13, lineHeight: 1.7 }}>
                  可以直接问我热点选题、检查违禁词，或告诉我你想写什么。
                  <br />
                  试试按住 🎤 说一句：<b style={{ color: "#f4bb67" }}>「帮我写一条行业文案」</b>。
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleQuickPrompt(p)}
                      style={{
                        background: "rgba(246,196,120,.12)",
                        border: "1px solid rgba(246,196,120,.35)",
                        color: "#f6c478",
                        borderRadius: 14,
                        padding: "7px 12px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                  <div style={{ width: "100%", fontSize: 11, color: "rgba(126,226,168,.8)", marginTop: 4 }}>💰 省钱返利</div>
                  {SAVINGS_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleQuickPrompt(p)}
                      style={{
                        background: "rgba(126,226,168,.12)",
                        border: "1px solid rgba(126,226,168,.35)",
                        color: "#7ee2a8",
                        borderRadius: 14,
                        padding: "7px 12px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {items.map((item) =>
              item.kind === "user" ? (
                <div
                  key={item.id}
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "82%",
                    background: "linear-gradient(135deg,#e39a3e,#f6c478)",
                    color: "#173052",
                    borderRadius: "16px 16px 4px 16px",
                    padding: "10px 14px",
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {item.text}
                </div>
              ) : item.kind === "tool" ? (
                <div
                  key={item.id}
                  style={{
                    alignSelf: "flex-start",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(99,102,241,.14)",
                    border: "1px solid rgba(129,140,248,.3)",
                    color: "#a5b4fc",
                    borderRadius: 12,
                    padding: "8px 12px",
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontSize: 14 }}>⚙️</span>
                  {item.text}
                </div>
              ) : (
                <div
                  key={item.id}
                  style={{
                    alignSelf: "flex-start",
                    maxWidth: "88%",
                    background: "rgba(255,255,255,.08)",
                    border: "1px solid rgba(142,165,190,.18)",
                    color: "#e8f1fc",
                    borderRadius: "16px 16px 16px 4px",
                    padding: "10px 14px",
                    fontSize: 14,
                    lineHeight: 1.65,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                  dangerouslySetInnerHTML={{ __html: renderRichText(item.text) }}
                />
              ),
            )}

            {busy && (
              <div style={{ color: "rgba(215,230,248,.45)", fontSize: 12 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: "#f6c478",
                    marginRight: 6,
                    animation: "kx-blink 1s ease infinite",
                  }}
                />
                思考中…
              </div>
            )}

            {error && !busy && (
              <div style={{ color: "#fca5a5", fontSize: 12 }}>
                ⚠️ {error}
              </div>
            )}
            {rebateOffer && !busy && (
              <button
                type="button"
                onClick={() => {
                  setBusy(true);
                  const bizNo = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  void savingsApi
                    .payRebate({
                      amount: rebateOffer.price,
                      bizNo,
                      feature: "text_generation",
                      idempotencyKey: bizNo,
                    })
                    .then(async (receipt) => {
                      setRebateOffer(null);
                      setError(null);
                      const lastUser = [...items]
                        .reverse()
                        .find((i) => i.kind === "user");
                      if (lastUser) {
                        await send(lastUser.text, receipt.receiptId);
                      } else {
                        setError("未找到待重发的消息");
                      }
                    })
                    .catch((e) =>
                      setError(e instanceof Error ? e.message : "返利支付失败"),
                    )
                    .finally(() => setBusy(false));
                }}
                style={{
                  marginTop: 8,
                  background: "linear-gradient(135deg,#7ee2a8,#4ecb8b)",
                  border: "none",
                  borderRadius: 10,
                  padding: "8px 14px",
                  color: "#1a1d24",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                💰 用返利 ¥{rebateOffer.price}/次 重试
                （余额 ¥{rebateOffer.balance.toFixed(2)}）
              </button>
            )}
          </div>

          {/* 输入区：默认语音，可切文字 */}
          <div
            style={{
              padding: "12px 14px",
              paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
              borderTop: "1px solid rgba(142,165,190,.2)",
              background: "rgba(255,255,255,.05)",
            }}
          >
            {inputMode === "voice" ? (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setInputMode("text")}
                  aria-label="切换文字输入"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    background: "rgba(255,255,255,.08)",
                    border: "1px solid rgba(142,165,190,.25)",
                    color: "#d7e6f8",
                    fontSize: 17,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ⌨️
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleVoice();
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    toggleVoice();
                  }}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 22,
                    border: "1px solid rgba(230,168,84,.55)",
                    background: listening
                      ? "linear-gradient(135deg,#d9534f,#e98a8a)"
                      : "linear-gradient(135deg,#e39a3e,#f6c478)",
                    color: listening ? "#fff" : "#173052",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    touchAction: "none",
                  }}
                >
                  {listening ? "🔴 正在听…（点击停止）" : "🎤 按住说话"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setInputMode("voice")}
                  aria-label="切换语音输入"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    background: "rgba(255,255,255,.08)",
                    border: "1px solid rgba(142,165,190,.25)",
                    color: "#d7e6f8",
                    fontSize: 17,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  🎤
                </button>
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendText();
                  }}
                  placeholder="输入你想让 AI 做的事…"
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "0 14px",
                    height: 44,
                    borderRadius: 22,
                    border: "1px solid rgba(142,165,190,.3)",
                    background: "rgba(255,255,255,.08)",
                    color: "#e8f1fc",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleSendText}
                  disabled={!textInput.trim() || busy}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    border: "none",
                    background: "linear-gradient(135deg,#e39a3e,#f6c478)",
                    color: "#173052",
                    fontSize: 16,
                    cursor: "pointer",
                    opacity: !textInput.trim() || busy ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  发送
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes kx-spin { to { transform: rotate(360deg); } }
        @keyframes kx-blink { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
      `}</style>
    </>
  );
}
