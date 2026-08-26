"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PlugZap,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  getWecomAssistantState,
  installWecomAssistant,
  retestWecomAssistant,
  setWecomAssistantEnabled,
  testWecomWebhook,
  updateWecomAssistantSettings,
  deleteWecomAssistant,
  createDefaultWecomAssistantState,
  validateWecomWebhookUrl,
  type WecomAssistantState,
  type WecomAssistantSettings,
} from "@/lib/api/wecom-ai-assistant";
import { toPublicError } from "@/lib/public-error";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { useConfirm } from "@/hooks/use-confirm";
import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle } from "@/components/skeleton";

const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  not_installed: { label: "未安装", color: "var(--kaypal-v3-muted)", bg: "var(--kaypal-v3-accent-soft)" },
  active: { label: "已连接", color: "var(--kaypal-v3-success)", bg: "rgba(74,222,128,.14)" },
  disabled: { label: "已停用", color: "var(--kaypal-v3-amber)", bg: "var(--kaypal-v3-accent-soft)" },
  test_failed: { label: "连接异常", color: "var(--kaypal-v3-danger)", bg: "rgba(255,138,138,.14)" },
};

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--kaypal-v3-field-bg)",
        border: "1px solid var(--kaypal-v3-border)",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          fontWeight: 700,
          color: "var(--kaypal-v3-soft-ink)",
          marginBottom: 10,
        }}
      >
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--kaypal-v3-field-bg)",
  border: "1px solid var(--kaypal-v3-border)",
  borderRadius: 8,
  color: "var(--kaypal-v3-soft-ink)",
  padding: "8px 10px",
  fontSize: 13,
  marginBottom: 8,
};

const smallBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 14px",
  borderRadius: 9,
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export function WecomAssistantCenter() {
  const { confirm, modal } = useConfirm();
  const [state, setState] = useState<WecomAssistantState>(() =>
    createDefaultWecomAssistantState(),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 安装表单
  const [name, setName] = useState("企业微信 AI 客服");
  const [webhookUrl, setWebhookUrl] = useState("");

  // 设置表单
  const [settings, setSettings] = useState<WecomAssistantSettings>(
    createDefaultWecomAssistantState().settings,
  );

  const [suggestInput, setSuggestInput] = useState("");
  const [suggestResult, setSuggestResult] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await getWecomAssistantState();
      setState(data);
      setSettings(data.settings);
      setError("");
    } catch (err) {
      setError(toPublicError(err, "加载企微助手状态失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(toPublicError(err, "操作失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleTestBeforeInstall = async () => {
    if (!webhookUrl.trim()) {
      setError("请先填写企业微信 Webhook 地址");
      return;
    }
    if (!validateWecomWebhookUrl(webhookUrl.trim())) {
      setError("Webhook 地址必须以 https://qyapi.weixin.qq.com/ 开头");
      return;
    }
    await run(() => testWecomWebhook(webhookUrl.trim()));
  };

  const handleInstall = async () => {
    if (!webhookUrl.trim()) {
      setError("请填写企业微信 Webhook 地址");
      return;
    }
    if (!validateWecomWebhookUrl(webhookUrl.trim())) {
      setError("Webhook 地址必须以 https://qyapi.weixin.qq.com/ 开头");
      return;
    }
    await run(() =>
      installWecomAssistant({
        name: name.trim() || "企业微信 AI 客服",
        webhookUrl: webhookUrl.trim(),
        settings,
      }),
    );
  };

  const handleSaveSettings = () =>
    run(() => updateWecomAssistantSettings(settings));

  const meta = STATUS_META[state.status] ?? STATUS_META.not_installed;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <V2BackButton />
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 16,
          fontWeight: 700,
          color: "var(--kaypal-v3-soft-ink)",
        }}
      >
        <Bot size={18} style={{ color: "var(--mx-accent, #e39a3e)" }} />
        企微助手
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: meta.color,
            background: meta.bg,
          }}
        >
          {meta.label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 400, color: "var(--kaypal-v3-muted)" }}>
          企业微信 AI 智能客服：自动回复 + 转人工 + 消息记录
        </span>
      </div>

      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--kaypal-v3-muted)",
            fontSize: 13,
            padding: 24,
          }}
        >
          <SkeletonList rows={3} />
        </div>
      ) : state.status === "not_installed" ? (
        /* ---------- 未安装：安装表单 ---------- */
        <SectionCard title="连接企业微信群机器人" icon={<PlugZap size={14} />}>
          <div style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginBottom: 10, lineHeight: 1.6 }}>
            在企业微信群里添加「群机器人」，复制 Webhook 地址粘贴到下面。
            连接成功后，客户消息会由 AI 自动回复，命中转人工关键词时提醒人工介入。
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="连接名称（可选）"
            style={fieldStyle}
          />
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"
            style={fieldStyle}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => void handleTestBeforeInstall()}
              disabled={busy}
              style={{
                ...smallBtn,
                background: "var(--kaypal-v3-accent-soft)",
                color: "var(--kaypal-v3-soft-ink)",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              测试连接
            </button>
            <button
              type="button"
              onClick={() => void handleInstall()}
              disabled={busy}
              style={{
                ...smallBtn,
                background: "linear-gradient(135deg,#e39a3e,#f6c478)",
                color: "var(--kaypal-v3-accent-ink)",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
              安装连接
            </button>
          </div>
        </SectionCard>
      ) : (
        <>
          {/* ---------- 已安装：状态 + 操作 ---------- */}
          <SectionCard
            title="连接信息"
            icon={
              state.status === "active" ? (
                <CheckCircle2 size={14} style={{ color: "var(--kaypal-v3-success)" }} />
              ) : (
                <XCircle size={14} style={{ color: "var(--kaypal-v3-danger)" }} />
              )
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div>
                <span style={{ color: "var(--kaypal-v3-muted)" }}>名称：</span>
                <span style={{ color: "var(--kaypal-v3-soft-ink)" }}>{state.integration?.name ?? "-"}</span>
              </div>
              <div>
                <span style={{ color: "var(--kaypal-v3-muted)" }}>Webhook：</span>
                <span style={{ color: "var(--kaypal-v3-soft-ink)" }}>
                  {state.integration?.maskedWebhookUrl ?? "-"}
                </span>
              </div>
              {state.integration?.lastTestedAt ? (
                <div>
                  <span style={{ color: "var(--kaypal-v3-muted)" }}>最近测试：</span>
                  <span style={{ color: "var(--kaypal-v3-soft-ink)" }}>
                    {new Date(state.integration.lastTestedAt).toLocaleString()}
                  </span>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => void run(() => retestWecomAssistant())}
                  disabled={busy}
                  style={{
                    ...smallBtn,
                    background: "var(--kaypal-v3-accent-soft)",
                    color: "var(--kaypal-v3-soft-ink)",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  重测连接
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => setWecomAssistantEnabled(state.status !== "active"))}
                  disabled={busy}
                  style={{
                    ...smallBtn,
                    background: state.status === "active" ? "rgba(255,138,138,.14)" : "rgba(74,222,128,.16)",
                    color: state.status === "active" ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-success)",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {state.status === "active" ? "停用" : "启用"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void confirm({
                      kind: "danger",
                      title: "删除企微助手连接",
                      description: "删除后需要重新安装才能继续使用。",
                      confirmText: "删除",
                    }).then((ok) => {
                      if (ok) void run(() => deleteWecomAssistant());
                    });
                  }}
                  disabled={busy}
                  style={{
                    ...smallBtn,
                    background: "transparent",
                    border: "1px solid var(--kaypal-v3-danger)",
                    color: "var(--kaypal-v3-danger)",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <Trash2 size={14} />
                  删除连接
                </button>
              </div>
            </div>
          </SectionCard>

          {/* ---------- 设置 ---------- */}
          <SectionCard title="AI 客服设置" icon={<Settings2 size={14} />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginBottom: 4 }}>品牌名称</div>
                <input
                  value={settings.brandName ?? ""}
                  onChange={(e) => setSettings({ ...settings, brandName: e.target.value })}
                  style={fieldStyle}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginBottom: 4 }}>门店名称</div>
                <input
                  value={settings.storeName ?? ""}
                  onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                  style={fieldStyle}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginBottom: 4 }}>回复风格</div>
                <input
                  value={settings.replyStyle ?? ""}
                  onChange={(e) => setSettings({ ...settings, replyStyle: e.target.value })}
                  placeholder="如：礼貌专业、热情活泼"
                  style={fieldStyle}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginBottom: 4 }}>
                  转人工关键词（逗号分隔）
                </div>
                <input
                  value={settings.transferKeywords ?? ""}
                  onChange={(e) => setSettings({ ...settings, transferKeywords: e.target.value })}
                  placeholder="如：人工、客服、投诉"
                  style={fieldStyle}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 10, fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--kaypal-v3-soft-ink)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!settings.sendToWecom}
                  onChange={(e) => setSettings({ ...settings, sendToWecom: e.target.checked })}
                />
                建议发送到企微群
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--kaypal-v3-soft-ink)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!settings.autoSendToCustomer}
                  onChange={(e) => setSettings({ ...settings, autoSendToCustomer: e.target.checked })}
                />
                自动回复客户
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleSaveSettings()}
              disabled={busy}
              style={{
                ...smallBtn,
                background: "linear-gradient(135deg,#e39a3e,#f6c478)",
                color: "var(--kaypal-v3-accent-ink)",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              保存设置
            </button>
          </SectionCard>

          {/* ---------- AI 回复建议体验 ---------- */}
          <SectionCard title="AI 回复建议" icon={<MessageSquareText size={14} />}>
            <textarea
              value={suggestInput}
              onChange={(e) => setSuggestInput(e.target.value)}
              placeholder="模拟一条客户消息，看看 AI 怎么回复 / 是否转人工…"
              rows={3}
              style={{ ...fieldStyle, marginBottom: 8 }}
            />
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  const { sendAutoReplySuggestion } = await import(
                    "@/lib/api/wecom-ai-assistant"
                  );
                  const res = await sendAutoReplySuggestion(suggestInput);
                  setSuggestResult(
                    res.suggestion?.suggestedReply ??
                      res.content ??
                      "已生成回复建议",
                  );
                })
              }
              disabled={busy || !suggestInput.trim()}
              style={{
                ...smallBtn,
                background: "var(--kaypal-v3-accent-soft)",
                color: "var(--kaypal-v3-soft-ink)",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              生成回复建议
            </button>
            {suggestResult ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--kaypal-v3-field-bg)",
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--kaypal-v3-soft-ink)",
                }}
              >
                {suggestResult}
              </div>
            ) : null}
          </SectionCard>

          {/* ---------- 消息记录 ---------- */}
          {state.records && state.records.length > 0 ? (
            <SectionCard title="消息记录" icon={<MessageSquareText size={14} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {state.records.slice(0, 20).map((record) => (
                  <div
                    key={record.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 13,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "var(--kaypal-v3-field-bg)",
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        background: "var(--kaypal-v3-accent-soft)",
                        color: "var(--kaypal-v3-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {record.type}
                    </span>
                    <span style={{ color: "var(--kaypal-v3-soft-ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {record.content || record.title}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color:
                          record.status === "sent"
                            ? "var(--kaypal-v3-success)"
                            : record.status === "failed"
                              ? "var(--kaypal-v3-danger)"
                              : "var(--kaypal-v3-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {record.status}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", whiteSpace: "nowrap" }}>
                      {new Date(record.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </>
      )}

      {error ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--kaypal-v3-danger)",
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(255,138,138,.1)",
          }}
        >
          {error}
        </div>
      ) : null}
      {modal}
    </div>
  );
}
