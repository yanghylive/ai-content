"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Select,
  SelectItem,
  Spinner,
  Tab,
  Tabs,
  Textarea,
  Tooltip,
  addToast,
} from "@heroui/react";
import {
  Activity,
  ArrowLeft,
  Ban,
  Bot,
  Check,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Square,
  User,
  X,
} from "lucide-react";
import {
  localEngineApi,
  type AgentSConversationAttachment,
  type AgentSConversationEvent,
  type AgentSConversationMessage,
  type AgentSConversationPurpose,
  type AgentSConversationSession,
  type AgentSConversationStatus,
} from "@/lib/api/local-engine";
import { settingsApi, type AIModel } from "@/lib/api/settings";
import { useAgentSState } from "@/lib/ops-workbench/hooks/use-agent-s-state";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

const PURPOSES: Array<{
  key: AgentSConversationPurpose;
  label: string;
}> = [
  { key: "general", label: "讨论" },
  { key: "research", label: "资料整理" },
  { key: "draft", label: "内容起草" },
  { key: "execute", label: "执行操作（需确认）" },
];

const STATUS_LABEL: Record<AgentSConversationStatus, string> = {
  idle: "待开始",
  running: "处理中",
  blocked: "已阻断",
  waiting_approval: "待确认",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<
  AgentSConversationStatus,
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  idle: "default",
  running: "primary",
  blocked: "danger",
  waiting_approval: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "default",
};

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function textFromPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function currentConfirmation(conversation: AgentSConversationSession | null) {
  if (conversation?.session.status !== "waiting_approval") return null;
  return [...conversation.events]
    .reverse()
    .find((event) => event.event_type.toLowerCase().includes("approval_required"));
}

function messageModelLabel(models: AIModel[], modelId?: string | null) {
  if (!modelId) return "默认模型";
  const model = models.find((item) => item.id === modelId);
  return model ? `${model.name} / ${model.modelId}` : "已配置模型";
}

export function AgentConversationWorkbench() {
  const isMobile = useIsMobile();
  const {
    agentSStatus,
    agentSError,
    agentSConversations,
    agentSConversation,
    agentSConversationArtifacts,
    agentSConversationBusy,
    agentSApprovalBusy,
    refreshAgentSStatus,
    refreshAgentSConversations,
    refreshAgentSConversation,
    createAgentSConversation,
    sendAgentSMessage,
    cancelAgentSConversation,
    retryAgentSConversation,
    decideAgentSConversation,
  } = useAgentSState();
  const [models, setModels] = React.useState<AIModel[]>([]);
  const [modelId, setModelId] = React.useState("");
  const [purpose, setPurpose] =
    React.useState<AgentSConversationPurpose>("general");
  const [draft, setDraft] = React.useState("");
  const [attachments, setAttachments] = React.useState<
    AgentSConversationAttachment[]
  >([]);
  const [approvalComment, setApprovalComment] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [mobileView, setMobileView] = React.useState<"list" | "chat">("list");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const [availableModels, defaults, sessions] = await Promise.all([
          settingsApi.listModels(),
          settingsApi.getDefaults().catch(() => null),
          refreshAgentSConversations(),
          refreshAgentSStatus(),
        ]);
        if (!active) return;
        const enabledModels = (availableModels || []).filter(
          (model) =>
            model.enabled &&
            model.platform?.enabled !== false &&
            Boolean(model.modelId.trim()),
        );
        setModels(enabledModels);
        const configuredDefault =
          defaults?.articleCreation ||
          defaults?.topicSelection ||
          "";
        const preferred =
          enabledModels.find((model) => model.id === configuredDefault)?.id ||
          enabledModels[0]?.id ||
          "";
        setModelId(preferred);
        const first = sessions[0];
        if (first) {
          setPurpose(first.purpose);
          setModelId(
            enabledModels.find((model) => model.id === first.model_id)?.id ||
              preferred,
          );
          await refreshAgentSConversation(first.session.session_id);
        }
      } catch (error) {
        if (active) {
          addToast({
            title: "Agent 工作台加载失败",
            description: toPublicError(error, "请稍后重试。"),
            color: "danger",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    refreshAgentSConversation,
    refreshAgentSConversations,
    refreshAgentSStatus,
  ]);

  React.useEffect(() => {
    const sessionId = agentSConversation?.session.session_id;
    if (
      !sessionId ||
      !["running", "waiting_approval"].includes(
        agentSConversation.session.status,
      )
    )
      return;
    const timer = window.setInterval(() => {
      void refreshAgentSConversation(sessionId).catch(() => undefined);
      void refreshAgentSConversations().catch(() => undefined);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [
    agentSConversation?.session.session_id,
    agentSConversation?.session.status,
    refreshAgentSConversation,
    refreshAgentSConversations,
  ]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [agentSConversation?.messages.length, agentSConversation?.events.length]);

  const selectConversation = async (conversation: AgentSConversationSession) => {
    setPurpose(conversation.purpose);
    setModelId(
      models.find((model) => model.id === conversation.model_id)?.id ||
        models[0]?.id ||
        "",
    );
    setDraft("");
    setAttachments([]);
    await refreshAgentSConversation(conversation.session.session_id);
  };

  const createConversation = async () => {
    const availableModel = models.find((model) => model.id === modelId);
    if (!availableModel) {
      addToast({
        title: "尚无可用模型",
        description: "请先配置并启用文本模型，再新建 Agent 对话。",
        color: "warning",
      });
      return;
    }
    try {
      const conversation = await createAgentSConversation({
        modelId: availableModel.id,
        purpose,
        sessionName: "新对话",
      });
      setPurpose(conversation.purpose);
      setDraft("");
      setAttachments([]);
    } catch (error) {
      addToast({
        title: "新建对话失败",
        description: toPublicError(error, "请稍后重试。"),
        color: "danger",
      });
    }
  };

  const sendMessage = async () => {
    const instruction = draft.trim() || (attachments.length ? "请分析附件内容。" : "");
    if (!instruction) {
      addToast({ title: "请输入消息", color: "warning" });
      return;
    }
    const availableModel = models.find((model) => model.id === modelId);
    if (!availableModel) {
      addToast({
        title: "尚无可用模型",
        description: "请先到模型与工具中配置并启用文本模型。",
        color: "warning",
      });
      return;
    }
    try {
      await sendAgentSMessage({
        sessionId: agentSConversation?.session.session_id,
        instruction,
        modelId: availableModel.id,
        purpose,
        attachments,
      });
      setDraft("");
      setAttachments([]);
    } catch (error) {
      addToast({
        title: "本轮未完成",
        description: toPublicError(error, "请检查模型或本机助手状态。"),
        color: "danger",
      });
    }
  };

  const uploadAttachments = async (files: File[]) => {
    const remaining = Math.max(0, 3 - attachments.length);
    const selected = files.slice(0, remaining);
    if (!selected.length) {
      addToast({ title: "每条消息最多 3 个附件", color: "warning" });
      return;
    }
    setUploading(true);
    try {
      const uploaded: AgentSConversationAttachment[] = [];
      for (const file of selected) {
        const formData = new FormData();
        formData.append("file", file);
        uploaded.push(await localEngineApi.uploadInteractionAsset(formData));
      }
      setAttachments((current) => [...current, ...uploaded].slice(0, 3));
    } catch (error) {
      addToast({
        title: "附件上传失败",
        description: toPublicError(error, "当前仅支持安全上传的图片附件。"),
        color: "danger",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const cancelCurrent = async () => {
    const sessionId = agentSConversation?.session.session_id;
    if (!sessionId) return;
    try {
      await cancelAgentSConversation(sessionId);
    } catch (error) {
      addToast({
        title: "取消失败",
        description: toPublicError(error, "请刷新状态后重试。"),
        color: "danger",
      });
    }
  };

  const retryCurrent = async () => {
    const sessionId = agentSConversation?.session.session_id;
    if (!sessionId) return;
    if (!models.some((model) => model.id === modelId)) {
      addToast({
        title: "尚无可用模型",
        description: "配置文本模型后再重试本轮。",
        color: "warning",
      });
      return;
    }
    try {
      await retryAgentSConversation(sessionId);
    } catch (error) {
      addToast({
        title: "重试失败",
        description: toPublicError(error, "请修正当前问题后再试。"),
        color: "danger",
      });
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    const sessionId = agentSConversation?.session.session_id;
    if (!sessionId) return;
    try {
      await decideAgentSConversation(
        sessionId,
        decision,
        approvalComment.trim() || undefined,
      );
      setApprovalComment("");
    } catch (error) {
      addToast({
        title: decision === "approved" ? "确认未提交" : "拒绝未提交",
        description: toPublicError(error, "请刷新状态后重试。"),
        color: "danger",
      });
    }
  };

  const refreshCurrent = async () => {
    const sessionId = agentSConversation?.session.session_id;
    await Promise.all([
      refreshAgentSStatus(),
      refreshAgentSConversations(),
      sessionId ? refreshAgentSConversation(sessionId) : Promise.resolve(),
    ]).catch((error) => {
      addToast({
        title: "刷新失败",
        description: toPublicError(error, "请稍后重试。"),
        color: "danger",
      });
    });
  };

  const confirmation = currentConfirmation(agentSConversation);
  const currentStatus = agentSConversation?.session.status || "idle";
  const isActive =
    currentStatus === "running" || currentStatus === "waiting_approval";
  const canRetry = ["failed", "cancelled", "blocked"].includes(currentStatus);
  const runtimeReady =
    agentSStatus?.connected === true || agentSStatus?.phase === "ready";
  const selectedModel = models.find((model) => model.id === modelId);

  if (loading) {
    return (
      <div className="flex min-h-[560px] items-center justify-center rounded-[8px] border border-divider bg-background">
        <SkeletonList rows={5} />
      </div>
    );
  }

  /* 移动端原生视图（mx-* 明德 VP 风格）——两级导航：会话列表 → 聊天流。
     agent-console 与 agent-workbench 共用本组件，一改两页受益。 */
  if (isMobile) {
    const mobileStatusBadge = (status: AgentSConversationStatus) =>
      status === "running" ? "mx-badge mx-badge-blue"
        : status === "waiting_approval" ? "mx-badge mx-badge-gold"
          : status === "completed" ? "mx-badge mx-badge-green"
            : status === "failed" || status === "blocked" ? "mx-badge mx-badge-red"
              : "mx-badge mx-badge-blue";

    /* ---------- 聊天视图 ---------- */
    if (mobileView === "chat") {
      return (
        <div className="kx-mobile-ambient">
          <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 24, display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 120px)" }}>
            {/* 头部：返回 + 会话名 + 状态 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => setMobileView("list")}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--kaypal-v3-muted)", background: "none", border: "none", padding: "4px 0", flexShrink: 0 }}
              >
                <ArrowLeft width={14} height={14} /> 会话
              </button>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "var(--kaypal-v3-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agentSConversation?.session.session_name || "新对话"}
              </span>
              <span className={mobileStatusBadge(currentStatus)} style={{ fontSize: 10, flexShrink: 0 }}>
                {STATUS_LABEL[currentStatus]}
              </span>
            </div>

            {/* 助手状态行 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, fontSize: 11, color: "var(--kaypal-v3-muted)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: runtimeReady ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-amber)", flexShrink: 0 }} />
              {runtimeReady ? "本机助手可用" : "本机助手未连接"}
              {agentSConversationBusy ? " · 处理中…" : ""}
            </div>

            {agentSError && (
              <div className="mx-card" style={{ marginTop: 9, padding: 10, borderColor: "var(--kaypal-v3-danger)" }}>
                <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", lineHeight: 1.5 }}>{agentSError}</p>
              </div>
            )}

            {/* 消息流 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 0" }}>
              {agentSConversation?.messages.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {agentSConversation.messages.map((message) => (
                    <ConversationMessage key={message.message_id} message={message} models={models} />
                  ))}
                </div>
              ) : (
                <div className="mx-card mx-empty" style={{ padding: 26, textAlign: "center" }}>
                  <Bot width={26} height={26} style={{ color: "var(--kaypal-v3-muted)", margin: "0 auto" }} />
                  <p style={{ fontSize: 13, color: "var(--kaypal-v3-muted)", marginTop: 9 }}>发送第一条消息，开始这段对话</p>
                </div>
              )}

              {confirmation && (
                <ConfirmationCard
                  event={confirmation}
                  busy={agentSApprovalBusy}
                  comment={approvalComment}
                  onCommentChange={setApprovalComment}
                  onApprove={() => void decide("approved")}
                  onReject={() => void decide("rejected")}
                />
              )}

              {currentStatus === "running" && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12, fontSize: 12, color: "var(--kaypal-v3-muted)" }}>
                  <Spinner size="sm" /> 本机助手正在处理…
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区 */}
            <div className="mx-card" style={{ padding: 11, flexShrink: 0 }}>
              {!selectedModel && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, padding: "8px 10px", borderRadius: "var(--kaypal-v3-radius-xs)", background: "var(--kaypal-v3-amber-soft)", border: "1px solid var(--kaypal-v3-amber)" }}>
                  <span style={{ fontSize: 11, color: "var(--kaypal-v3-amber)" }}>尚无可用文本模型，发送已暂停。</span>
                  <Link href="/capabilities/models" style={{ fontSize: 11, fontWeight: 700, color: "var(--kaypal-v3-amber)", flexShrink: 0 }}>配置模型 ›</Link>
                </div>
              )}
              {attachments.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {attachments.map((attachment) => (
                    <span key={`${attachment.filepath}:${attachment.uploadedAt}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: "var(--kaypal-v3-radius-xs)", background: "var(--kaypal-v3-paper-muted)", fontSize: 11, color: "var(--kaypal-v3-ink)", maxWidth: "100%" }}>
                      <ImageIcon width={12} height={12} style={{ flexShrink: 0 }} />
                      <span style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.filename}</span>
                      <button
                        type="button"
                        aria-label={`移除 ${attachment.filename}`}
                        onClick={() => setAttachments((current) => current.filter((item) => item.filepath !== attachment.filepath))}
                        style={{ display: "inline-flex", padding: 0, background: "none", border: "none" }}
                      >
                        <X width={12} height={12} style={{ color: "var(--kaypal-v3-muted)" }} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <input
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  type="file"
                  style={{ display: "none" }}
                  onChange={(event) => void uploadAttachments(Array.from(event.target.files || []))}
                />
                <button
                  type="button"
                  aria-label="添加图片"
                  disabled={isActive || attachments.length >= 3 || uploading}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ width: 38, height: 38, borderRadius: "var(--kaypal-v3-radius-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--kaypal-v3-paper-muted)", border: "1px solid var(--kaypal-v3-border)", color: "var(--kaypal-v3-muted)", flexShrink: 0 }}
                >
                  {uploading ? <Spinner size="sm" /> : <Paperclip width={16} height={16} />}
                </button>
                <textarea
                  aria-label="消息"
                  placeholder={purpose === "execute" ? "描述要执行的操作…" : "输入消息…"}
                  value={draft}
                  disabled={isActive}
                  rows={1}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  style={{ flex: 1, minHeight: 38, maxHeight: 110, padding: "9px 12px", borderRadius: "var(--kaypal-v3-radius-sm)", border: "1px solid var(--kaypal-v3-border)", background: "var(--kaypal-v3-paper)", color: "var(--kaypal-v3-ink)", fontSize: 13, resize: "none", lineHeight: 1.5 }}
                />
                <button
                  type="button"
                  aria-label="发送"
                  className="mx-btn-gold"
                  style={{ width: 38, height: 38, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  disabled={!selectedModel || agentSConversationBusy}
                  onClick={() => void sendMessage()}
                >
                  <Send width={16} height={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    /* ---------- 会话列表视图 ---------- */
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">Agent 工作台</div>
            <div className="mx-page-sub">多轮对话、模型协作与本机助手执行</div>
          </div>

          {/* 状态条 + 新建 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--kaypal-v3-muted)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: runtimeReady ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-amber)", flexShrink: 0 }} />
              {runtimeReady ? "本机助手可用" : "本机助手未连接"}
            </span>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ padding: "7px 14px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
              disabled={agentSConversationBusy || !selectedModel}
              onClick={() => void createConversation()}
            >
              <Plus width={13} height={13} /> 新建对话
            </button>
          </div>

          {!selectedModel && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "var(--kaypal-v3-amber)" }}>
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-amber)", lineHeight: 1.5 }}>
                尚无可用文本模型，无法新建对话。
                <Link href="/capabilities/models" style={{ fontWeight: 700, color: "var(--kaypal-v3-amber)" }}> 去配置模型 ›</Link>
              </p>
            </div>
          )}

          {/* 会话列表 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>对话（{agentSConversations.length}）</div>
          {agentSConversations.length === 0 ? (
            <div className="mx-card mx-empty" style={{ padding: 26, textAlign: "center" }}>
              <MessageSquare width={26} height={26} style={{ color: "var(--kaypal-v3-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)", marginTop: 9 }}>还没有对话</p>
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginTop: 4 }}>点上方「新建对话」，让 Agent 帮你干活</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {agentSConversations.map((conversation) => (
                <button
                  key={conversation.session.session_id}
                  type="button"
                  className="mx-card"
                  style={{ padding: 13, textAlign: "left", width: "100%" }}
                  onClick={() => {
                    void selectConversation(conversation);
                    setMobileView("chat");
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {conversation.session.session_name || "新对话"}
                    </span>
                    <span className={mobileStatusBadge(conversation.session.status)} style={{ fontSize: 10, flexShrink: 0 }}>
                      {STATUS_LABEL[conversation.session.status]}
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 10, color: "var(--kaypal-v3-muted)", marginTop: 6 }}>
                    {PURPOSES.find((p) => p.key === conversation.purpose)?.label || conversation.purpose}
                    {" · "}
                    {messageModelLabel(models, conversation.model_id)}
                    {conversation.session.updated_at ? ` · ${formatTime(conversation.session.updated_at)}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[680px] overflow-hidden rounded-[8px] border border-divider bg-background lg:h-[calc(100vh-190px)] lg:min-h-[620px] lg:grid-cols-[228px_minmax(0,1fr)_300px]">
      <aside className="flex min-h-0 flex-col border-b border-divider bg-default-50/60 lg:border-b-0 lg:border-r">
        <div className="flex h-14 flex-none items-center justify-between border-b border-divider px-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-default-500" />
            <span className="text-14 font-semibold">对话</span>
            <Chip size="sm" variant="flat">
              {agentSConversations.length}
            </Chip>
          </div>
          <Tooltip content="新建对话">
            <Button
              isIconOnly
              aria-label="新建对话"
              isDisabled={agentSConversationBusy || !selectedModel}
              size="sm"
              variant="flat"
              onPress={createConversation}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
        <div className="flex max-h-56 gap-2 overflow-x-auto p-2 lg:max-h-none lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto">
          {agentSConversations.length ? (
            agentSConversations.map((conversation) => {
              const selected =
                conversation.session.session_id ===
                agentSConversation?.session.session_id;
              return (
                <button
                  key={conversation.session.session_id}
                  type="button"
                  className={`min-h-[72px] w-48 flex-none border-l-2 px-3 py-2 text-left transition-colors lg:w-full ${
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:bg-default-100"
                  }`}
                  onClick={() => void selectConversation(conversation)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-13 font-medium leading-5 text-default-800">
                      {conversation.session.session_name || "新对话"}
                    </span>
                    <span
                      className={`mt-1 h-2 w-2 flex-none rounded-full ${
                        conversation.session.status === "running"
                          ? "bg-primary"
                          : conversation.session.status === "waiting_approval"
                            ? "bg-warning"
                            : conversation.session.status === "failed" ||
                                conversation.session.status === "blocked"
                              ? "bg-danger"
                              : conversation.session.status === "completed"
                                ? "bg-success"
                                : "bg-default-300"
                      }`}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-11 text-default-500">
                    <span>{STATUS_LABEL[conversation.session.status]}</span>
                    <span>{formatTime(conversation.session.updated_at)}</span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-8 text-center text-13 text-default-400">
              暂无对话
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-[620px] min-w-0 flex-col lg:min-h-0">
        <div className="flex min-h-14 flex-none flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="max-w-[320px] truncate text-14 font-semibold text-default-900">
                {agentSConversation?.session.session_name || "新对话"}
              </h3>
              <Chip
                color={STATUS_COLOR[currentStatus]}
                size="sm"
                variant="flat"
              >
                {STATUS_LABEL[currentStatus]}
              </Chip>
            </div>
            <div className="mt-1 flex items-center gap-2 text-11 text-default-500">
              <span
                className={`h-2 w-2 rounded-full ${runtimeReady ? "bg-success" : "bg-warning"}`}
              />
              <span>{runtimeReady ? "本机助手可用" : "本机助手未连接"}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isActive ? (
              <Tooltip content="取消当前处理">
                <Button
                  isIconOnly
                  aria-label="取消当前处理"
                  size="sm"
                  variant="flat"
                  onPress={cancelCurrent}
                >
                  <Square className="h-4 w-4" />
                </Button>
              </Tooltip>
            ) : null}
            {canRetry ? (
              <Tooltip
                content={selectedModel ? "重试上一轮" : "请先配置可用模型"}
              >
                <Button
                  isIconOnly
                  aria-label="重试上一轮"
                  isDisabled={agentSConversationBusy || !selectedModel}
                  size="sm"
                  variant="flat"
                  onPress={retryCurrent}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip content="刷新">
              <Button
                isIconOnly
                aria-label="刷新"
                size="sm"
                variant="light"
                onPress={refreshCurrent}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          {agentSError ? (
            <div className="mb-4 border-l-2 border-danger bg-danger-50 px-3 py-2 text-13 text-danger-700">
              {agentSError}
            </div>
          ) : null}
          {agentSConversation?.messages.length ? (
            <div className="space-y-4">
              {agentSConversation.messages.map((message) => (
                <ConversationMessage
                  key={message.message_id}
                  message={message}
                  models={models}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-divider bg-default-50">
                <Bot className="h-6 w-6 text-default-500" />
              </div>
              <p className="mt-3 text-14 font-medium text-default-700">
                开始一段 Agent 对话
              </p>
            </div>
          )}

          {confirmation ? (
            <ConfirmationCard
              event={confirmation}
              busy={agentSApprovalBusy}
              comment={approvalComment}
              onCommentChange={setApprovalComment}
              onApprove={() => void decide("approved")}
              onReject={() => void decide("rejected")}
            />
          ) : null}

          {currentStatus === "running" ? (
            <div className="mt-4 flex items-center gap-2 text-12 text-default-500">
              <Spinner size="sm" />
              <span>本机助手正在处理</span>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>

        <div className="flex-none border-t border-divider bg-background p-3">
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <Select
              aria-label="模型"
              isDisabled={isActive || agentSConversationBusy}
              placeholder="选择模型"
              selectedKeys={modelId ? [modelId] : []}
              size="sm"
              onSelectionChange={(keys) =>
                setModelId(String(Array.from(keys)[0] || ""))
              }
            >
              {models.map((model) => (
                <SelectItem key={model.id} textValue={`${model.name} ${model.modelId}`}>
                  {model.name} / {model.modelId}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="用途"
              isDisabled={isActive || agentSConversationBusy}
              selectedKeys={[purpose]}
              size="sm"
              onSelectionChange={(keys) =>
                setPurpose(
                  String(Array.from(keys)[0] || "general") as AgentSConversationPurpose,
                )
              }
            >
              {PURPOSES.map((item) => (
                <SelectItem key={item.key}>{item.label}</SelectItem>
              ))}
            </Select>
          </div>

          {!selectedModel ? (
            <div
              className="mb-2 flex flex-wrap items-center justify-between gap-2 border-l-2 border-warning bg-warning-50 px-3 py-2 text-12 text-warning-700"
              role="status"
            >
              <span>尚无可用文本模型，发送和重试已暂停。</span>
              <Button
                as={Link}
                href="/capabilities/models"
                size="sm"
                startContent={<Settings2 className="h-3.5 w-3.5" />}
                variant="flat"
              >
                配置模型
              </Button>
            </div>
          ) : null}

          {attachments.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={`${attachment.filepath}:${attachment.uploadedAt}`}
                  className="flex max-w-full items-center gap-2 rounded-[6px] border border-divider bg-default-50 px-2 py-1 text-12"
                >
                  <ImageIcon className="h-3.5 w-3.5 flex-none text-default-500" />
                  <span className="max-w-44 truncate">{attachment.filename}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${attachment.filename}`}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.filepath !== attachment.filepath),
                      )
                    }
                  >
                    <X className="h-3.5 w-3.5 text-default-400" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              multiple
              type="file"
              onChange={(event) =>
                void uploadAttachments(Array.from(event.target.files || []))
              }
            />
            <Tooltip content="添加图片">
              <Button
                isIconOnly
                aria-label="添加图片"
                className="h-10 w-10 flex-none"
                isDisabled={isActive || attachments.length >= 3}
                isLoading={uploading}
                variant="flat"
                onPress={() => fileInputRef.current?.click()}
              >
                {uploading ? null : <Paperclip className="h-4 w-4" />}
              </Button>
            </Tooltip>
            <Textarea
              aria-label="消息"
              classNames={{ inputWrapper: "min-h-10" }}
              isDisabled={isActive}
              maxRows={5}
              minRows={1}
              placeholder="输入消息"
              value={draft}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              onValueChange={setDraft}
            />
            <Tooltip
              content={
                !selectedModel
                  ? "请先配置可用模型"
                  : purpose === "execute"
                    ? "提交执行请求"
                    : "发送"
              }
            >
              <Button
                isIconOnly
                aria-label={purpose === "execute" ? "提交执行请求" : "发送"}
                className="h-10 w-10 flex-none"
                color={purpose === "execute" ? "warning" : "primary"}
                isDisabled={
                  isActive ||
                  !selectedModel ||
                  (!draft.trim() && !attachments.length)
                }
                isLoading={agentSConversationBusy}
                onPress={sendMessage}
              >
                {agentSConversationBusy ? null : <Send className="h-4 w-4" />}
              </Button>
            </Tooltip>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-11 text-default-400">
            <span className="truncate">
              {selectedModel
                ? `${selectedModel.name} / ${selectedModel.modelId}`
                : "尚无可用模型"}
            </span>
            <span>{attachments.length}/3</span>
          </div>
        </div>
      </main>

      <aside className="min-h-[480px] border-t border-divider bg-default-50/40 lg:min-h-0 lg:border-l lg:border-t-0">
        <Tabs
          aria-label="对话详情"
          classNames={{
            base: "w-full border-b border-divider px-2",
            tabList: "w-full",
            panel: "p-0",
          }}
          fullWidth
          variant="underlined"
        >
          <Tab
            key="sources"
            title={
              <span className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> 来源
              </span>
            }
          >
            <SourcesPanel conversation={agentSConversation} models={models} />
          </Tab>
          <Tab
            key="results"
            title={
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> 结果
              </span>
            }
          >
            <ResultsPanel
              conversation={agentSConversation}
              artifacts={agentSConversationArtifacts}
            />
          </Tab>
          <Tab
            key="events"
            title={
              <span className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> 事件
              </span>
            }
          >
            <EventsPanel events={agentSConversation?.events || []} />
          </Tab>
        </Tabs>
      </aside>
    </div>
  );
}

function ConversationMessage({
  message,
  models,
}: {
  message: AgentSConversationMessage;
  models: AIModel[];
}) {
  if (message.kind === "status") {
    return (
      <div className="flex justify-center">
        <span className="rounded-[6px] bg-default-100 px-2 py-1 text-11 text-default-500">
          {message.content}
        </span>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-[6px] border border-divider bg-default-50">
          <Bot className="h-4 w-4 text-default-500" />
        </div>
      ) : null}
      <div className={`max-w-[84%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`whitespace-pre-wrap break-words rounded-[8px] px-3 py-2 text-13 leading-6 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : message.kind === "confirmation"
                ? "border border-warning-200 bg-warning-50 text-default-800"
                : "border border-divider bg-background text-default-800"
          }`}
        >
          {message.content}
          {message.attachments.length ? (
            <div className="mt-2 space-y-1 border-t border-current/15 pt-2">
              {message.attachments.map((attachment) => (
                <div
                  key={`${message.message_id}:${attachment.filepath}`}
                  className="flex items-center gap-2 text-11 opacity-80"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span className="truncate">{attachment.filename}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div
          className={`mt-1 flex items-center gap-2 text-11 text-default-400 ${
            isUser ? "justify-end" : "justify-start"
          }`}
        >
          <span>{formatTime(message.created_at)}</span>
          {!isUser && message.model_id ? (
            <span>{messageModelLabel(models, message.model_id)}</span>
          ) : null}
        </div>
      </div>
      {isUser ? (
        <div className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-[6px] bg-primary/10">
          <User className="h-4 w-4 text-primary" />
        </div>
      ) : null}
    </div>
  );
}

function ConfirmationCard({
  event,
  busy,
  comment,
  onCommentChange,
  onApprove,
  onReject,
}: {
  event: AgentSConversationEvent;
  busy: boolean;
  comment: string;
  onCommentChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const prompt =
    textFromPayload(event.payload, "approval_prompt") ||
    event.message ||
    "本机助手请求继续执行下一步。";
  const hint = textFromPayload(event.payload, "approval_hint");
  return (
    <Card className="mt-5 border border-warning-300 bg-warning-50 shadow-none">
      <CardBody className="gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-[6px] bg-warning-100 text-warning-700">
              <Ban className="h-4 w-4" />
            </div>
            <div>
              <p className="text-13 font-semibold text-default-900">
                等待执行确认
              </p>
              <p className="mt-1 whitespace-pre-wrap text-12 leading-5 text-default-700">
                {prompt}
              </p>
            </div>
          </div>
          <Chip color="warning" size="sm" variant="flat">
            高风险
          </Chip>
        </div>
        {hint ? <p className="text-11 text-default-500">{hint}</p> : null}
        <Textarea
          aria-label="确认备注"
          isDisabled={busy}
          minRows={2}
          placeholder="备注（可选）"
          size="sm"
          value={comment}
          onValueChange={onCommentChange}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            color="primary"
            isDisabled={busy}
            isLoading={busy}
            size="sm"
            startContent={busy ? null : <Check className="h-4 w-4" />}
            onPress={onApprove}
          >
            确认执行
          </Button>
          <Button
            isDisabled={busy}
            size="sm"
            startContent={<X className="h-4 w-4" />}
            variant="flat"
            onPress={onReject}
          >
            拒绝
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function SourcesPanel({
  conversation,
  models,
}: {
  conversation: AgentSConversationSession | null;
  models: AIModel[];
}) {
  const attachments = (conversation?.messages || []).flatMap((message) =>
    message.attachments.map((attachment) => ({
      key: attachment.filepath,
      title: attachment.filename,
      detail: `${attachment.mimeType} · ${formatBytes(attachment.sizeBytes)}`,
      icon: <ImageIcon className="h-4 w-4" />,
    })),
  );
  const runtimeSources = (conversation?.events || [])
    .map((event) => textFromPayload(event.payload, "source"))
    .filter(Boolean)
    .map((source) => ({
      key: `runtime:${source}`,
      title: source === "configured-model" ? "已配置模型" : source,
      detail: "运行来源",
      icon: <Bot className="h-4 w-4" />,
    }));
  const model = conversation?.model_id
    ? models.find((item) => item.id === conversation.model_id)
    : null;
  const items = [
    ...(model
      ? [
          {
            key: `model:${model.id}`,
            title: model.name,
            detail: model.modelId,
            icon: <Bot className="h-4 w-4" />,
          },
        ]
      : []),
    ...attachments,
    ...runtimeSources,
  ].filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.key === item.key) === index,
  );
  return (
    <DetailList
      empty="暂无来源"
      items={items.map((item) => ({
        key: item.key,
        title: item.title,
        detail: item.detail,
        icon: item.icon,
      }))}
    />
  );
}

function ResultsPanel({
  conversation,
  artifacts,
}: {
  conversation: AgentSConversationSession | null;
  artifacts: Array<{
    artifact_id: string;
    filename: string;
    kind: string;
    size_bytes: number;
  }>;
}) {
  const latestResult = [...(conversation?.messages || [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.kind === "result");
  return (
    <div className="max-h-[calc(100vh-250px)] overflow-y-auto p-3">
      {latestResult ? (
        <div className="border-l-2 border-success px-3 py-2">
          <p className="text-11 font-medium text-default-500">最新结果</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-12 leading-5 text-default-700">
            {latestResult.content}
          </p>
        </div>
      ) : (
        <p className="py-8 text-center text-12 text-default-400">暂无结果</p>
      )}
      {artifacts.length ? (
        <div className="mt-4 border-t border-divider pt-3">
          <p className="mb-2 text-11 font-medium text-default-500">产物</p>
          <div className="space-y-2">
            {artifacts.map((artifact) => (
              <div
                key={artifact.artifact_id}
                className="flex items-start gap-2 border-b border-divider pb-2 last:border-0"
              >
                <FileText className="mt-0.5 h-4 w-4 flex-none text-default-400" />
                <div className="min-w-0">
                  <p className="truncate text-12 text-default-700">
                    {artifact.filename}
                  </p>
                  <p className="text-11 text-default-400">
                    {artifact.kind} · {formatBytes(artifact.size_bytes)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EventsPanel({ events }: { events: AgentSConversationEvent[] }) {
  if (!events.length) {
    return <p className="p-8 text-center text-12 text-default-400">暂无事件</p>;
  }
  return (
    <div className="max-h-[calc(100vh-250px)] overflow-y-auto p-3">
      <div className="space-y-3">
        {[...events].reverse().map((event) => (
          <div key={`${event.seq}:${event.event_type}`} className="flex gap-2">
            <div className="flex w-4 flex-none flex-col items-center">
              <span
                className={`mt-1 h-2 w-2 rounded-full ${
                  event.status === "completed"
                    ? "bg-success"
                    : event.status === "failed" || event.status === "blocked"
                      ? "bg-danger"
                      : event.status === "waiting_approval"
                        ? "bg-warning"
                        : "bg-primary"
                }`}
              />
              <span className="mt-1 h-full w-px bg-divider" />
            </div>
            <div className="min-w-0 pb-2">
              <p className="break-words text-11 font-medium text-default-700">
                {event.event_type}
              </p>
              {event.message ? (
                <p className="mt-1 break-words text-11 leading-4 text-default-500">
                  {event.message}
                </p>
              ) : null}
              <p className="mt-1 text-11 text-default-400">
                #{event.seq} · {formatTime(event.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailList({
  items,
  empty,
}: {
  items: Array<{
    key: string;
    title: string;
    detail: string;
    icon: React.ReactNode;
  }>;
  empty: string;
}) {
  if (!items.length) {
    return <p className="p-8 text-center text-12 text-default-400">{empty}</p>;
  }
  return (
    <div className="max-h-[calc(100vh-250px)] space-y-1 overflow-y-auto p-3">
      {items.map((item) => (
        <div
          key={item.key}
          className="flex items-start gap-2 border-b border-divider px-1 py-3 last:border-0"
        >
          <span className="mt-0.5 text-default-400">{item.icon}</span>
          <div className="min-w-0">
            <p className="truncate text-12 font-medium text-default-700">
              {item.title}
            </p>
            <p className="mt-0.5 truncate text-11 text-default-400">
              {item.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
