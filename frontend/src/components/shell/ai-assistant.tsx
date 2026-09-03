"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { savingsApi } from "@/lib/api/savings";
import {
  chatStream,
  type AiChatMessage,
  type AiGatewayEvent,
} from "@/lib/api/ai-gateway";
import { ShellIcon } from "@/components/shell/icons";
import {
  Bot,
  Clipboard,
  Info,
  Layers,
  Lightbulb,
  Send,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "@/components/iconpark";
import { voiceApi } from "@/lib/api/voice";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { toActionableError } from "@/lib/public-error";

interface ChatItem {
  id: string;
  kind: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  streaming?: boolean;
  jump?: { label: string; href: string };
  draft?: {
    draftId?: string;
    intent?: string;
    goal?: string;
    platform?: string | null;
    readiness?: string;
    missingFields?: string[];
    plannedActions?: Array<{
      type: string;
      label: string;
      risk: string;
      requiresConfirmation: boolean;
    }>;
    riskSummary?: string | null;
    hint?: string;
  };
  /**
   * 瞬态消息（2026-09-03）：错误/中断类反馈仅当次会话可见，
   * 不写入 localStorage 历史，避免旧鉴权失败之类的整屏报错被永久留存。
   */
  ephemeral?: boolean;
}

const QUICK_PROMPTS = ["今天有什么热点选题？", "帮我检查一段文案有没有违禁词", "怎么提升内容质量？"];

/** 能力中心清单（2026-09-03）。数据来自后端 GET /api/ai-gateway/capabilities，
 * 后端以 ai-gateway.service.ts 的 TOOLS 白名单为准动态核对，此处不再手抄清单。 */
type Capability = {
  key: string;
  name: string;
  desc: string;
  example: string;
};
type CapabilityGroup = { title: string; items: Capability[] };

/** 省钱返利快捷场景（M6 顺手省钱：找货/盯价/资产/支付） */
const SAVINGS_PROMPTS = [
  "我返利还有多少？",
  "帮我找 200 块以内的空气炸锅，要返利高的",
  "盯住这个洗发水，降到 39 以下提醒我",
  "把返利余额换成 AI 额度",
  "我要提现 50 块",
  "店里抽纸快没了，列个补货清单",
];

/**
 * AI 消息 markdown 渲染（S7 安全修复，2026-08-18）。
 * 原 renderRichText 用正则替换后 dangerouslySetInnerHTML，原始 HTML（含
 * <img onerror> 等）原样穿透执行 → 存储型/流式 XSS。
 * 改用 react-markdown + remark-gfm + remark-breaks：
 *   - react-markdown 默认不渲染原始 HTML（当纯文本处理），天然免疫 XSS
 *   - remark-gfm 支持表格/删除线/任务列表
 *   - remark-breaks 保持原「\n → <br/>」的换行行为
 * 链接统一 target=_blank + rel=noopener noreferrer。
 */
export const markdownComponents = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- node 是 react-markdown 内部注入属性，需从 props 剔除
  a: ({ node: _node, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" style={{ color: "var(--kaypal-v3-accent)", textDecoration: "underline" }} />
  ),
};

export function AiAssistant({
  embedded = false,
}: {
  /** 内嵌模式：不渲染悬浮入口按钮，对话面板直接铺满容器（用于 /agent 页面与手机端同款对话） */
  embedded?: boolean;
} = {}) {
  const [open, setOpen] = useState(embedded);
  // 历史记录延后到 useEffect 加载：若在 useState initializer 里读 localStorage，
  // SSR（[]）与 CSR hydration（历史）不一致会触发 React #418 hydration mismatch。
  // 过滤瞬态消息（ephemeral）与旧版遗留的整条错误回复（⚠️ 开头），避免污染会话。
  const [items, setItems] = useState<ChatItem[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ai_assistant_history");
      const parsed = raw ? (JSON.parse(raw) as ChatItem[]) : [];
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (i) =>
            !i.ephemeral &&
            !(
              i.kind === "assistant" &&
              typeof i.text === "string" &&
              i.text.trim().startsWith("⚠️")
            ),
        );
        setItems(cleaned.slice(-50));
      }
    } catch {
      // 忽略损坏的历史记录
    }
  }, []);
  const [busy, setBusy] = useState(false);
  const isMobile = useIsMobile();
  // 桌面端默认文字输入（有实体键盘），移动端默认语音
  const [inputMode, setInputMode] = useState<"voice" | "text">(
    isMobile ? "voice" : "text",
  );
  const [textInput, setTextInput] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebateOffer, setRebateOffer] = useState<{
    price: number;
    balance: number;
  } | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 单条 hover 定位 + 清空按钮两段式确认（2026-09-03 历史可治理化）
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // 能力中心入口（2026-09-03）：弹出面板展示能力清单，数据来自后端接口
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [capabilityGroups, setCapabilityGroups] = useState<CapabilityGroup[] | null>(null);
  const [capabilityTotal, setCapabilityTotal] = useState(0);
  const [capsState, setCapsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const textInputRef = useRef<HTMLInputElement>(null);

  // 挂载即预取能力清单（静态 JSON，量小）；失败时面板内可重试
  const loadCapabilities = useCallback(async () => {
    setCapsState("loading");
    try {
      const res = await fetch("/api/ai-gateway/capabilities", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: { total?: number; groups?: CapabilityGroup[] };
      };
      if (!res.ok || !json.success) throw new Error(json.success === false ? "接口返回失败" : `HTTP ${res.status}`);
      setCapabilityGroups(Array.isArray(json.data?.groups) ? json.data.groups : []);
      setCapabilityTotal(typeof json.data?.total === "number" ? json.data.total : 0);
      setCapsState("ready");
    } catch {
      setCapsState("error");
    }
  }, []);
  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  // 对话历史持久化：过滤流式中的半成品与瞬态消息（错误/中断反馈），最多保留最近 50 条
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const settled = items
        .filter((i) => !i.streaming && !i.ephemeral)
        .slice(-50);
      window.localStorage.setItem(
        "ai_assistant_history",
        JSON.stringify(settled),
      );
    } catch {
      /* 存储满/异常时静默降级 */
    }
  }, [items]);
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

      // 带上会话内已有对话历史（多轮上下文），只发 user/assistant 且非空的文本
      const history: AiChatMessage[] = [
        ...items
          .filter(
            (item) =>
              (item.kind === "user" || item.kind === "assistant") &&
              item.text &&
              !item.streaming,
          )
          .map((item) => ({
            role: item.kind === "user" ? ("user" as const) : ("assistant" as const),
            content: item.text,
          })),
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
            } else if (event.type === "tool_done") {
              setItems((prev) => {
                let updated = false;
                return prev.map((item) => {
                  if (
                    !updated &&
                    item.kind === "tool" &&
                    item.toolName === event.name &&
                    !item.jump
                  ) {
                    updated = true;
                    return {
                      ...item,
                      text: `已完成「${event.name}」`,
                      jump: event.jump,
                      draft: event.draft,
                    };
                  }
                  return item;
                });
              });
            } else if (event.type === "error") {
              setError(toActionableError(event.message, "AI 助手遇到了问题，请重试"));
              setItems((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? {
                        ...item,
                        text: `⚠️ ${toActionableError(event.message, "AI 助手遇到了问题")}`,
                        streaming: false,
                        ephemeral: true,
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
              // 配额/额度耗尽 → 引导返利兑换 AI 额度
              if (/已用完|额度不足/.test(event.message || "")) {
                setQuotaExhausted(true);
                void savingsApi
                  .rebateBalance()
                  .then((info) => {
                    if ((info.available ?? 0) <= 0) setQuotaExhausted(false);
                  })
                  .catch(() => setQuotaExhausted(false));
              }
            }
          },
          controller.signal,
          rebateReceiptId,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const raw = toActionableError(e, "AI 助手暂时无法响应，请稍后重试。");
        // 网络层原生错误（Android WebView fetch 失败消息）转友好中文，2026-08-11 真机测试
        const msg = /Connection error|Failed to fetch|NetworkError|Network request failed|network error/i.test(
          toActionableError(e, ""),
        )
          ? "网络连接失败，请检查网络后重试。"
          : raw;
        setError(msg);
        setItems((prev) =>
          prev.map((item) =>
            item.id === assistantId
              ? { ...item, text: `⚠️ ${msg}`, streaming: false, ephemeral: true }
              : item,
          ),
        );
      } finally {
        setItems((prev) =>
          prev.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  streaming: false,
                  // 空回复兜底：模型未产出任何文本（如对资金类敏感输入的网关空回）
                  // 时给用户可见反馈，避免「发了消息却无任何回复」的静默失联；
                  // 属失败反馈，标 ephemeral 不入历史。
                  text:
                    item.text.trim() === ""
                      ? "（本次未收到有效回复，请换个说法再试）"
                      : item.text,
                  ephemeral: item.text.trim() === "" ? true : item.ephemeral,
                }
              : item,
          ),
        );
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, items],
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
          `录音停止失败：${toActionableError(err, "未知原因")}`,
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
          `语音识别失败：${toActionableError(err, "未知原因")}`,
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

  /** 停止生成：中断 SSE 并就地收起流式状态（保留已产出文本） */
  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setItems((prev) =>
      prev.map((item) => {
        if (!item.streaming) return item;
        const text =
          item.text.trim() === "" ? "（已停止生成）" : item.text;
        return { ...item, streaming: false, text };
      }),
    );
    setBusy(false);
  };

  /** Esc 关闭能力中心 */
  useEffect(() => {
    if (!capabilitiesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCapabilitiesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capabilitiesOpen]);

  /** 「试试」：关闭面板、切文字输入、填入示例并聚焦 */
  const tryCapability = (example: string) => {
    setCapabilitiesOpen(false);
    setInputMode("text");
    setTextInput(example);
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
    });
  };

  /** 删除单条消息（hover 操作，不触发整批重排） */
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setHoverId((cur) => (cur === id ? null : cur));
  };

  /** 清空对话：两段式确认（第一次点击进入确认态，3s 后自动复位） */
  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    setHoverId(null);
    handleStop();
    setError(null);
    setRebateOffer(null);
    setQuotaExhausted(false);
    setItems([]);
  };

  return (
    <>
      {/* 悬浮入口（右下角品牌紫钮）——内嵌模式不渲染 */}
      {!embedded && (
        <button
          type="button"
          aria-label="AI 助手"
          onClick={() => setOpen((v) => !v)}
          style={{
            position: "fixed",
            right: 18,
            bottom: 84,
            width: 48,
            height: 48,
            borderRadius: 24,
            background: "var(--kaypal-v3-accent)",
            color: "#fff",
            fontSize: 20,
            border: "none",
            boxShadow: "0 4px 16px color-mix(in srgb, var(--kaypal-v3-accent) 40%, transparent)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "transform .2s ease, box-shadow .2s ease",
          }}
        >
          {busy ? (
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                border: "2px solid rgba(255,255,255,.3)",
                borderTopColor: "#fff",
                animation: "kx-spin .8s linear infinite",
              }}
            />
          ) : (
            <Sparkles size={20} />
          )}
        </button>
      )}

      {/* 对话面板：悬浮模式 = fixed 全屏；内嵌模式 = 填满父容器 */}
      {(open || embedded) && (
        <div
          style={{
            position: embedded ? "relative" : "fixed",
            inset: embedded ? undefined : 0,
            zIndex: embedded ? undefined : 70,
            display: "flex",
            flexDirection: "column",
            height: embedded ? "100%" : undefined,
            minHeight: embedded ? "100%" : undefined,
            background: "var(--kaypal-v3-canvas)",
            color: "var(--kaypal-v3-ink)",
          }}
        >
          {/* 头部 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              paddingTop: embedded
                ? "14px"
                : "calc(14px + env(safe-area-inset-top))",
              borderBottom: "1px solid var(--kaypal-v3-paper-muted)",
            }}
          >
            <div>
              <div style={{ color: "var(--kaypal-v3-accent)", fontSize: 15, fontWeight: 700 }}>
                AI 助手
              </div>
              <div style={{ color: "var(--kaypal-v3-muted)", fontSize: 11 }}>
                {embedded
                  ? "与手机 App 同一套 AI 对话 · 内容由 AI 生成，请注意甄别"
                  : "正在与 AI 对话，内容由 AI 生成，请注意甄别"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => setCapabilitiesOpen(true)}
                aria-label="能力中心"
                title="查看 AI 助手支持的能力清单"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 16,
                  border: "1px solid var(--kaypal-v3-accent-border)",
                  background: "var(--kaypal-v3-accent-soft)",
                  color: "var(--kaypal-v3-accent-ink)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Layers size={14} />
                能力中心
              </button>
              <button
                type="button"
                onClick={clearAll}
                aria-label={confirmClear ? "再次点击确认清空对话" : "清空对话"}
                title={confirmClear ? "再次点击确认清空" : "清空对话"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 16,
                  border: confirmClear
                    ? "1px solid color-mix(in srgb, var(--kaypal-v3-danger, #ef4444) 45%, transparent)"
                    : "1px solid var(--kaypal-v3-paper-muted)",
                  background: confirmClear
                    ? "var(--kaypal-v3-danger-soft, rgba(239,68,68,.1))"
                    : "var(--kaypal-v3-paper-soft)",
                  color: confirmClear
                    ? "var(--kaypal-v3-danger, #ef4444)"
                    : "var(--kaypal-v3-muted)",
                  fontSize: 12,
                  fontWeight: confirmClear ? 700 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Trash2 size={14} />
                {confirmClear ? "确认清空" : "清空对话"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  window.location.href = "/settings/legal";
                }}
                aria-label="合规中心"
                title="用户协议 · 隐私 · 投诉"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--kaypal-v3-paper-soft)",
                  border: "none",
                  color: "var(--kaypal-v3-muted)",
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  cursor: "pointer",
                }}
              >
                <Info size={15} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                style={{
                  display: embedded ? "none" : "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--kaypal-v3-paper-soft)",
                  border: "none",
                  color: "var(--kaypal-v3-muted)",
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  cursor: "pointer",
                }}
              >
                <X size={15} />
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
                    color: "var(--kaypal-v3-accent)",
                    fontSize: 16,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  嗨，我是你的 AI 内容运营助手
                </div>
                <div style={{ color: "var(--kaypal-v3-muted)", fontSize: 13, lineHeight: 1.7 }}>
                  可以直接问我热点选题、检查违禁词，或告诉我你想写什么。
                  <br />
                  {isMobile ? (
                    <>
                      试试按住 <b style={{ color: "var(--kaypal-v3-accent)" }}>🎤</b> 说一句：
                      <b style={{ color: "var(--kaypal-v3-accent)" }}>「帮我写一条行业文案」</b>。
                    </>
                  ) : (
                    <>
                      在下方输入框打字，回车发送；也可以点
                      <b style={{ color: "var(--kaypal-v3-accent)" }}> 🎤 </b>切到语音。
                    </>
                  )}
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
                        background: "var(--kaypal-v3-accent-soft)",
                        border: "1px solid var(--kaypal-v3-accent-border)",
                        color: "var(--kaypal-v3-accent-ink)",
                        borderRadius: 14,
                        padding: "7px 12px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                  <div
                    style={{
                      width: "100%",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "var(--kaypal-v3-amber)",
                      marginTop: 4,
                    }}
                  >
                    <Wallet size={11} />
                    省钱返利
                  </div>
                  {SAVINGS_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleQuickPrompt(p)}
                      style={{
                        background: "var(--kaypal-v3-amber-soft)",
                        border: "1px solid color-mix(in srgb, var(--kaypal-v3-amber) 35%, transparent)",
                        color: "var(--kaypal-v3-amber)",
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

            {items.map((item) => {
              const isUser = item.kind === "user";
              const showRemove = hoverId === item.id && !item.streaming;
              return (
                <div
                  key={item.id}
                  onMouseEnter={() => setHoverId(item.id)}
                  onMouseLeave={() =>
                    setHoverId((cur) => (cur === item.id ? null : cur))
                  }
                  style={{
                    display: "flex",
                    justifyContent: isUser ? "flex-end" : "flex-start",
                    position: "relative",
                    minWidth: 0,
                  }}
                >
                  {isUser ? (
                    <div
                      style={{
                        maxWidth: "82%",
                        background: "var(--kaypal-v3-accent)",
                        color: "#fff",
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
                  ) : item.kind === "tool" && item.draft ? (
                    <DraftCard
                      draft={item.draft}
                      onDone={(msg) =>
                        setItems((prev) => [
                          ...prev.map((x) =>
                            x.id === item.id
                              ? { ...x, text: msg, draft: undefined }
                              : x,
                          ),
                          {
                            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            kind: "assistant",
                            text: msg,
                          },
                        ])
                      }
                    />
                  ) : item.kind === "tool" ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        background: "var(--kaypal-v3-accent-soft)",
                        border: "1px solid var(--kaypal-v3-accent-border)",
                        color: "var(--kaypal-v3-accent-ink)",
                        borderRadius: 12,
                        padding: "8px 12px",
                        fontSize: 12,
                      }}
                    >
                      <Bot size={14} />
                      {item.text}
                      {item.jump && (
                        <a
                          href={item.jump.href}
                          style={{
                            color: "var(--kaypal-v3-accent)",
                            textDecoration: "underline",
                            textUnderlineOffset: 3,
                          }}
                        >
                          {item.jump.label} →
                        </a>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        maxWidth: "88%",
                        background: item.ephemeral
                          ? "var(--kaypal-v3-danger-soft, rgba(239,68,68,.06))"
                          : "var(--kaypal-v3-paper)",
                        border: item.ephemeral
                          ? "1px solid color-mix(in srgb, var(--kaypal-v3-danger, #ef4444) 32%, transparent)"
                          : "1px solid var(--kaypal-v3-paper-muted)",
                        color: item.ephemeral
                          ? "color-mix(in srgb, var(--kaypal-v3-ink) 88%, var(--kaypal-v3-danger, #ef4444))"
                          : "var(--kaypal-v3-ink)",
                        borderRadius: "16px 16px 16px 4px",
                        padding: "10px 14px",
                        fontSize: 14,
                        lineHeight: 1.65,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={markdownComponents}
                      >
                        {item.text}
                      </ReactMarkdown>
                    </div>
                  )}
                  {showRemove && (
                    <button
                      type="button"
                      aria-label="删除这条消息"
                      title="删除这条消息"
                      onClick={() => removeItem(item.id)}
                      style={{
                        position: "absolute",
                        top: -8,
                        right: 4,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--kaypal-v3-paper)",
                        border: "1px solid var(--kaypal-v3-paper-muted)",
                        color: "var(--kaypal-v3-muted)",
                        cursor: "pointer",
                        boxShadow: "0 1px 4px rgba(30,20,60,.14)",
                      }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              );
            })}

            {busy && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "var(--kaypal-v3-muted)",
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: "var(--kaypal-v3-accent)",
                    marginRight: 6,
                    animation: "kx-blink 1s ease infinite",
                  }}
                />
                思考中…
                <button
                  type="button"
                  onClick={handleStop}
                  style={{
                    border: "1px solid var(--kaypal-v3-paper-muted)",
                    background: "var(--kaypal-v3-paper-soft)",
                    color: "var(--kaypal-v3-muted)",
                    borderRadius: 10,
                    padding: "3px 10px",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  停止生成
                </button>
              </div>
            )}

            {error && !busy && (
              <div style={{ color: "var(--kaypal-v3-danger, #ef4444)", fontSize: 12 }}>
                ⚠️ {error}
              </div>
            )}
            {quotaExhausted && !busy && (
              <a
                href="/savings/wallet"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--kaypal-v3-amber)",
                  fontSize: 12,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                <Lightbulb size={13} />
                额度用完？可用返利余额兑换 AI 额度 →
              </a>
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
                      setError(toActionableError(e, "返利支付失败")),
                    )
                    .finally(() => setBusy(false));
                }}
                style={{
                  marginTop: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--kaypal-v3-accent)",
                  border: "none",
                  borderRadius: 10,
                  padding: "8px 14px",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <Wallet size={14} />
                用返利 ¥{rebateOffer.price}/次 重试
                （余额 ¥{rebateOffer.balance.toFixed(2)}）
              </button>
            )}
          </div>

          {/* 输入区：默认语音，可切文字 */}
          <div
            style={{
              padding: "12px 14px",
              paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
              borderTop: "1px solid var(--kaypal-v3-paper-muted)",
              background: "var(--kaypal-v3-paper-soft)",
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
                    background: "var(--kaypal-v3-paper)",
                    border: "1px solid var(--kaypal-v3-paper-muted)",
                    color: "var(--kaypal-v3-muted)",
                    cursor: "pointer",
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ShellIcon name="keyboard" size={18} />
                </button>
                <button
                  type="button"
                  onClick={busy ? handleStop : undefined}
                  onMouseDown={(e) => {
                    if (busy) return;
                    e.preventDefault();
                    toggleVoice();
                  }}
                  onTouchStart={(e) => {
                    if (busy) return;
                    e.preventDefault();
                    toggleVoice();
                  }}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 22,
                    border: "none",
                    background:
                      busy || listening
                        ? "var(--kaypal-v3-danger, #ef4444)"
                        : "var(--kaypal-v3-accent)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    touchAction: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                  }}
                >
                  {busy ? (
                    "■ 停止生成"
                  ) : listening ? (
                    "正在听…（点击停止）"
                  ) : (
                    <>
                      <ShellIcon name="mic" size={16} />
                      按住说话
                    </>
                  )}
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
                    background: "var(--kaypal-v3-paper)",
                    border: "1px solid var(--kaypal-v3-paper-muted)",
                    color: "var(--kaypal-v3-muted)",
                    cursor: "pointer",
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ShellIcon name="mic" size={18} />
                </button>
                <input
                  ref={textInputRef}
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
                    border: "1px solid var(--kaypal-v3-paper-muted)",
                    background: "var(--kaypal-v3-paper)",
                    color: "var(--kaypal-v3-ink)",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={busy ? handleStop : handleSendText}
                  disabled={!busy && !textInput.trim()}
                  aria-label={busy ? "停止生成" : "发送"}
                  title={busy ? "停止生成" : "发送"}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: busy ? 22 : 22,
                    border: "none",
                    background: busy
                      ? "var(--kaypal-v3-danger, #ef4444)"
                      : "var(--kaypal-v3-accent)",
                    color: "#fff",
                    cursor: "pointer",
                    opacity: !busy && !textInput.trim() ? 0.5 : 1,
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {busy ? (
                    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
                      <rect width="12" height="12" rx="2" fill="currentColor" />
                    </svg>
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 能力中心弹出层（fixed 盖全屏，避免被对话卡片 overflow 裁剪） */}
      {capabilitiesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI 助手能力中心"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCapabilitiesOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(22, 16, 40, 0.42)",
            padding: "24px 12px",
          }}
        >
          <div
            style={{
              width: "min(680px, 100%)",
              maxHeight: "min(78vh, 720px)",
              display: "flex",
              flexDirection: "column",
              background: "var(--kaypal-v3-paper)",
              border: "1px solid var(--kaypal-v3-paper-muted)",
              borderRadius: 16,
              boxShadow: "0 18px 60px rgba(24, 16, 50, 0.28)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 18px",
                borderBottom: "1px solid var(--kaypal-v3-paper-muted)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--kaypal-v3-accent-soft)",
                  color: "var(--kaypal-v3-accent-ink)",
                }}
              >
                <Layers size={15} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--kaypal-v3-ink)", fontSize: 14, fontWeight: 700 }}>
                  AI 助手能力中心
                </div>
                <div style={{ color: "var(--kaypal-v3-muted)", fontSize: 11 }}>
                  {capsState === "loading" && "正在加载能力清单…"}
                  {capsState === "error" && "能力清单加载失败"}
                  {capsState === "ready" &&
                    `共 ${capabilityTotal} 项能力 · 点「试试」把示例填进输入框，回车即可发起`}
                  {capsState === "idle" && "能力清单"}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                aria-label="关闭能力中心"
                onClick={() => setCapabilitiesOpen(false)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  background: "var(--kaypal-v3-paper-soft)",
                  border: "none",
                  color: "var(--kaypal-v3-muted)",
                  cursor: "pointer",
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div
              style={{
                overflowY: "auto",
                padding: "6px 18px 16px",
              }}
            >
              {capsState === "error" && (
                <div
                  style={{
                    padding: "26px 10px",
                    textAlign: "center",
                    color: "var(--kaypal-v3-muted)",
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ marginBottom: 10 }}>能力清单加载失败，请检查网络后重试</div>
                  <button
                    type="button"
                    onClick={() => void loadCapabilities()}
                    style={{
                      border: "1px solid var(--kaypal-v3-accent-border)",
                      background: "var(--kaypal-v3-accent-soft)",
                      color: "var(--kaypal-v3-accent-ink)",
                      borderRadius: 9,
                      padding: "6px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    重新加载
                  </button>
                </div>
              )}

              {capsState === "loading" && (
                <div
                  style={{
                    padding: "30px 10px",
                    textAlign: "center",
                    color: "var(--kaypal-v3-muted)",
                    fontSize: 12.5,
                  }}
                >
                  加载中…
                </div>
              )}

              {capsState === "ready" &&
                (capabilityGroups && capabilityGroups.length > 0 ? (
                  capabilityGroups.map((group) => (
                    <div key={group.title} style={{ marginTop: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ color: "var(--kaypal-v3-accent)", fontSize: 12.5, fontWeight: 700 }}>
                          {group.title}
                        </span>
                        <span
                          style={{
                            color: "var(--kaypal-v3-muted)",
                            fontSize: 10.5,
                            padding: "1px 7px",
                            borderRadius: 999,
                            background: "var(--kaypal-v3-paper-soft)",
                          }}
                        >
                          {group.items.length} 项
                        </span>
                      </div>
                      {group.items.map((cap) => (
                        <div
                          key={cap.key}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "8px 2px",
                            borderBottom: "1px solid var(--kaypal-v3-paper-muted)",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "var(--kaypal-v3-ink)", fontSize: 12.5, fontWeight: 600 }}>
                              {cap.name}
                            </div>
                            <div
                              style={{
                                color: "var(--kaypal-v3-muted)",
                                fontSize: 11.5,
                                lineHeight: 1.5,
                                marginTop: 1,
                              }}
                            >
                              {cap.desc}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => tryCapability(cap.example)}
                            style={{
                              flexShrink: 0,
                              border: "1px solid var(--kaypal-v3-accent-border)",
                              background: "var(--kaypal-v3-accent-soft)",
                              color: "var(--kaypal-v3-accent-ink)",
                              borderRadius: 9,
                              padding: "4px 11px",
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            试试
                          </button>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      padding: "30px 10px",
                      textAlign: "center",
                      color: "var(--kaypal-v3-muted)",
                      fontSize: 12.5,
                    }}
                  >
                    暂无可展示的能力
                  </div>
                ))}

              <div
                style={{
                  marginTop: 12,
                  color: "var(--kaypal-v3-muted)",
                  fontSize: 10.5,
                  lineHeight: 1.6,
                }}
              >
                说明：定时发布、返利兑换/提现等高风险写操作会先生成确认卡，你确认后才真正执行；
                内容生成类请配合「品牌知识检索」使用真实资料，避免编造。
              </div>
            </div>
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

/** P3：任务草稿卡片（确认/执行）。意图 -> 草稿 -> 确认 -> 执行 */
function DraftCard({
  draft,
  onDone,
}: {
  draft: NonNullable<ChatItem["draft"]>;
  onDone: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<
    "draft" | "confirmed" | "executed" | "error"
  >("draft");
  const [errorMsg, setErrorMsg] = useState("");

  const intentLabel: Record<string, string> = {
    find_leads: "发现线索",
    contact_leads: "触达线索",
    sync_crm: "同步 CRM",
    follow_up: "老客跟进",
    report: "复盘报告",
  };
  const platformLabel: Record<string, string> = {
    douyin: "抖音",
    xiaohongshu: "小红书",
    kuaishou: "快手",
    "wechat-channel": "视频号",
    bilibili: "B站",
  };
  const riskTone: Record<string, { bg: string; fg: string }> = {
    low: { bg: "var(--kaypal-v3-accent-soft)", fg: "var(--kaypal-v3-accent-ink)" },
    medium: { bg: "var(--kaypal-v3-amber-soft)", fg: "var(--kaypal-v3-amber)" },
    high: { bg: "var(--kaypal-v3-danger-soft)", fg: "var(--kaypal-v3-danger)" },
    blocked: { bg: "var(--kaypal-v3-paper-muted)", fg: "var(--kaypal-v3-muted)" },
  };

  const confirm = async () => {
    if (!draft.draftId || busy) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/ai/assistant/task-drafts/${draft.draftId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { success?: boolean; message?: string };
      if (!json.success) throw new Error(json.message || "确认失败");
      setState("confirmed");
    } catch (e) {
      setState("error");
      setErrorMsg(toActionableError(e, "任务确认失败"));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!draft.draftId || busy) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/ai/assistant/task-drafts/${draft.draftId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await res.json()) as { success?: boolean; message?: string };
      if (!json.success) throw new Error(json.message || "执行失败");
      setState("executed");
      onDone("任务草稿已执行 ✅");
    } catch (e) {
      setState("error");
      setErrorMsg(toActionableError(e, "任务执行失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        alignSelf: "flex-start",
        maxWidth: "92%",
        width: 380,
        background: "var(--kaypal-v3-paper)",
        border: "1px solid var(--kaypal-v3-accent-border)",
        borderRadius: 14,
        padding: "12px 14px",
        fontSize: 13,
        color: "var(--kaypal-v3-ink)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Clipboard size={15} />
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>
          {intentLabel[draft.intent || ""] || "任务草稿"}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--kaypal-v3-accent-soft)",
            color: "var(--kaypal-v3-accent-ink)",
          }}
        >
          {draft.platform ? platformLabel[draft.platform] || draft.platform : "未选平台"}
        </span>
      </div>

      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--kaypal-v3-ink)", marginBottom: 8 }}>
        {draft.goal}
      </div>

      {draft.readiness === "needs-input" && (
        <div style={{ fontSize: 12, color: "var(--kaypal-v3-amber)", marginBottom: 8 }}>
          ⚠️ 需要补充：{draft.missingFields?.join("、")}
        </div>
      )}

      {draft.plannedActions && draft.plannedActions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
          {draft.plannedActions.map((a, i) => {
            const tone = riskTone[a.risk] || riskTone.low;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: tone.bg,
                    color: tone.fg,
                    fontSize: 10.5,
                    flexShrink: 0,
                  }}
                >
                  {a.risk}
                </span>
                <span style={{ color: "var(--kaypal-v3-ink)" }}>{a.label}</span>
                {a.requiresConfirmation && (
                  <span style={{ color: "var(--kaypal-v3-muted)", fontSize: 10.5 }}>需确认</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {draft.riskSummary && (
        <div style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginBottom: 8 }}>
          风险：{draft.riskSummary}
        </div>
      )}

      {state === "error" && (
        <div style={{ fontSize: 11.5, color: "var(--kaypal-v3-danger, #ef4444)", marginBottom: 8 }}>
          ❌ {errorMsg}
        </div>
      )}

      {state !== "executed" && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {state === "draft" && (
            <button
              onClick={confirm}
              disabled={busy}
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 8,
                border: "1px solid var(--kaypal-v3-accent-border)",
                background: "var(--kaypal-v3-accent-soft)",
                color: "var(--kaypal-v3-accent-ink)",
                fontSize: 12.5,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "处理中…" : "确认草稿"}
            </button>
          )}
          {state === "confirmed" && (
            <button
              onClick={execute}
              disabled={busy}
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 8,
                border: "none",
                background: "var(--kaypal-v3-accent)",
                color: "#fff",
                fontSize: 12.5,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "执行中…" : "执行任务"}
            </button>
          )}
        </div>
      )}
      {state === "executed" && (
        <span style={{ fontSize: 12.5, color: "var(--kaypal-v3-accent)" }}>✅ 已执行</span>
      )}
    </div>
  );
}
