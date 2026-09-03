"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  Tab,
  Tabs,
  Textarea,
} from "@heroui/react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Edit3,
  ExternalLink,
  FileText,
  Link2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Target,
  UserRound,
  X,
} from "@/components/iconpark";
import toast from "@/lib/toast";
import { ApiError } from "@/lib/api/client";
import {
  completeCrmTask,
  createCrmNote,
  createCrmTask,
  getCrmCustomerContinuity,
  listCrmWelcomeMessageTemplates,
  mergeCrmCustomer,
  updateCrmCustomer,
  type CrmCustomer,
  type CrmCustomerContinuity,
  type CrmTimelineEvent,
  type CrmWelcomeMessageTemplate,

} from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useConfirm } from "@/hooks/use-confirm";
import { CustomerAttributionPanel } from "./customer-attribution-panel";
import { WelcomeMessagePanel } from "./welcome-message-panel";
import { SkeletonList } from "@/components/skeleton";

const statusLabels: Record<string, string> = {
  new: "新线索",
  contacted: "已触达",
  interested: "有意向",
  follow_up: "待跟进",
  customer: "已成交",
  invalid: "无效",
  archived: "已归档",
};

const eventLabels: Record<string, string> = {
  customer_created: "客户已创建",
  customer_updated: "客户资料已更新",
  task_created: "跟进任务已创建",
  task_completed: "跟进任务已完成",
  note_created: "备注已添加",
  welcome_message_prepared: "欢迎消息已准备",
  welcome_message_interaction_started: "测试发送任务已启动",
  auto_acquisition_comment_replied: "获客互动已沉淀",
  growth_lead_synced: "增长线索已同步",
};

const platformLabels: Record<string, string> = {
  manual: "手动录入",
  douyin: "抖音",
  wechat: "微信",
  "wechat-channel": "视频号",
  xiaohongshu: "小红书",
  growth: "增长获客",
  csv: "CSV 导入",
};

const customerTabKeys = ["profile", "follow-up", "opportunities", "welcome"] as const;

const OPPORTUNITY_STAGE_LABELS: Record<string, string> = {
  new: "新商机",
  qualified: "资格确认",
  discovery: "发现阶段",
  proposal: "提案",
  negotiation: "谈判",
  won: "成交",
  lost: "失单",
  nurture: "暂缓",
};

function customerTabFromLocation() {
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  return customerTabKeys.includes(
    requestedTab as (typeof customerTabKeys)[number],
  )
    ? String(requestedTab)
    : "profile";
}

function writeCustomerTabToUrl(tab: string) {
  const url = new URL(window.location.href);
  if (tab === "profile") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

type CustomerForm = {
  displayName: string;
  companyName: string;
  title: string;
  email: string;
  phone: string;
  wechat: string;
  status: string;
  sourcePlatform: string;
  sourceAccountId: string;
  sourceAccountName: string;
  sourceKeyword: string;
  sourceUrl: string;
  sourceText: string;
  externalUserId: string;
  tags: string;
};

function customerToForm(customer: CrmCustomer): CustomerForm {
  return {
    displayName: customer.displayName,
    companyName: customer.companyName || "",
    title: customer.title || "",
    email: customer.email || "",
    phone: customer.phone || "",
    wechat: customer.wechat || "",
    status: customer.status,
    sourcePlatform: customer.sourcePlatform || "manual",
    sourceAccountId: customer.sourceAccount?.id || "",
    sourceAccountName: customer.sourceAccount?.name || "",
    sourceKeyword: customer.sourceKeyword || "",
    sourceUrl: customer.sourceUrl || "",
    sourceText: customer.sourceText || "",
    externalUserId: customer.externalUserId || "",
    tags: customer.tags.join("、"),
  };
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deliveryLabel(event: CrmTimelineEvent) {
  const metadata = metadataRecord(event.metadata);
  if (metadata.deliveryConfirmed === true) return "平台已确认";
  if (event.relatedInteractionTaskId) return "等待平台确认";
  if (event.eventType === "welcome_message_prepared") return "尚未发送";
  return null;
}

type CustomerDetailClientProps = {
  customerId: string;
};

type CustomerLoadIssue = {
  title: string;
  description: string;
  canRetry: boolean;
};

function customerLoadIssueFrom(error: unknown): CustomerLoadIssue {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        title: "登录状态已失效",
        description: "请重新登录后再打开客户档案。客户资料没有被修改。",
        canRetry: false,
      };
    }
    if (error.status === 403) {
      return {
        title: "没有查看这位客户的权限",
        description:
          "该客户不属于当前账号或当前角色无权访问。系统不会展示客户名称和内容。",
        canRetry: false,
      };
    }
    if (error.status === 404) {
      return {
        title: "客户不存在或已归档",
        description:
          "链接可能已失效，或客户已经被删除、归档或合并。请返回客户列表重新查找。",
        canRetry: false,
      };
    }
  }
  return {
    title: "客户档案暂时无法加载",
    description: toPublicError(error, "客户档案暂时无法加载，请稍后重试。"),
    canRetry: true,
  };
}

export function CustomerDetailClient({
  customerId,
}: CustomerDetailClientProps) {
  const { confirm, modal } = useConfirm();
  const isMobile = useIsMobile();
  const [continuity, setContinuity] =
    React.useState<CrmCustomerContinuity | null>(null);
  const [templates, setTemplates] = React.useState<CrmWelcomeMessageTemplate[]>(
    [],
  );
  const [loading, setLoading] = React.useState(true);
  const [loadIssue, setLoadIssue] = React.useState<CustomerLoadIssue | null>(
    null,
  );
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<CustomerForm | null>(null);
  const [taskTitle, setTaskTitle] = React.useState("");
  const [taskDescription, setTaskDescription] = React.useState("");
  const [taskPriority, setTaskPriority] = React.useState("normal");
  const [taskDueAt, setTaskDueAt] = React.useState("");
  const [noteBody, setNoteBody] = React.useState("");
  const [followUpBusy, setFollowUpBusy] = React.useState(false);
  const [selectedTab, setSelectedTab] = React.useState("profile");
  // 合并/重复（报告 7.2）：输入要合并进来的客户 ID
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [mergeSourceId, setMergeSourceId] = React.useState("");
  const [merging, setMerging] = React.useState(false);
  const [mergeMsg, setMergeMsg] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (showSpinner = true, preserveForm = false) => {
      if (showSpinner) setLoading(true);
      setLoadIssue(null);
      try {
        const [nextContinuity, nextTemplates] = await Promise.all([
          getCrmCustomerContinuity(customerId),
          listCrmWelcomeMessageTemplates(),
        ]);
        setContinuity(nextContinuity);
        setTemplates(nextTemplates);
        if (!preserveForm) setForm(customerToForm(nextContinuity.customer));
      } catch (reason) {
        setLoadIssue(customerLoadIssueFrom(reason));
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [customerId],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const syncTabFromUrl = () => setSelectedTab(customerTabFromLocation());
    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  const customer = continuity?.customer || null;

  const handleMerge = React.useCallback(async () => {
    const sourceId = mergeSourceId.trim();
    if (!sourceId) {
      setMergeMsg("请输入要合并进来的客户 ID");
      return;
    }
    if (sourceId === customerId) {
      setMergeMsg("不能把客户合并到自身");
      return;
    }
    setMerging(true);
    setMergeMsg(null);
    try {
      await mergeCrmCustomer(customerId, sourceId);
      setMergeOpen(false);
      setMergeSourceId("");
      await load(false, true);
    } catch (reason) {
      setMergeMsg(toPublicError(reason, "合并失败，请确认客户 ID 正确"));
    } finally {
      setMerging(false);
    }
  }, [mergeSourceId, customerId, load]);

  const profileIsDirty = Boolean(
    editing &&
      form &&
      customer &&
      JSON.stringify(form) !== JSON.stringify(customerToForm(customer)),
  );
  const followUpDraftIsDirty = Boolean(
    taskTitle.trim() ||
      taskDescription.trim() ||
      taskDueAt ||
      taskPriority !== "normal" ||
      noteBody.trim(),
  );
  const hasUnsavedChanges = profileIsDirty || followUpDraftIsDirty;

  useUnsavedChangesWarning(hasUnsavedChanges);

  const refreshCustomer = () => {
    if (!hasUnsavedChanges) {
      void load(false);
      return;
    }
    void confirm({
      kind: "warning",
      title: "有未保存的修改",
      description: "重新加载将丢失未保存的修改。",
      confirmText: "重新加载",
      cancelText: "留在本页",
    }).then((ok) => {
      if (ok) void load(false);
    });
  };

  const saveCustomer = async () => {
    if (!form) return;
    const displayName = form.displayName.trim();
    if (!displayName) {
      toast.error("客户名称不能为空");
      return;
    }
    setSaving(true);
    try {
      await updateCrmCustomer(customerId, {
        displayName,
        companyName: form.companyName.trim(),
        title: form.title.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        wechat: form.wechat.trim(),
        status: form.status,
        sourcePlatform: form.sourcePlatform,
        sourceAccountId: form.sourceAccountId.trim(),
        sourceAccountName: form.sourceAccountName.trim(),
        sourceKeyword: form.sourceKeyword.trim(),
        sourceUrl: form.sourceUrl.trim(),
        sourceText: form.sourceText.trim(),
        externalUserId: form.externalUserId.trim(),
        tags: form.tags
          .split(/[、,，\n]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      await load(false);
      setEditing(false);
      toast.success("客户档案已更新");
    } catch (reason) {
      toast.error(toPublicError(reason, "客户档案未保存，请重试。"));
    } finally {
      setSaving(false);
    }
  };

  const createTask = async () => {
    const title = taskTitle.trim();
    if (!title) {
      toast.error("任务标题不能为空");
      return;
    }
    setFollowUpBusy(true);
    try {
      await createCrmTask({
        title,
        description: taskDescription.trim() || undefined,
        priority: taskPriority,
        dueAt: taskDueAt || undefined,
        customerId,
      });
      setTaskTitle("");
      setTaskDescription("");
      setTaskPriority("normal");
      setTaskDueAt("");
      await load(false, true);
      toast.success("跟进任务已创建");
    } catch (reason) {
      toast.error(toPublicError(reason, "跟进任务未创建，请重试。"));
    } finally {
      setFollowUpBusy(false);
    }
  };

  const createNote = async () => {
    const body = noteBody.trim();
    if (!body) {
      toast.error("备注内容不能为空");
      return;
    }
    setFollowUpBusy(true);
    try {
      await createCrmNote({ body, customerId });
      setNoteBody("");
      await load(false, true);
      toast.success("备注已添加");
    } catch (reason) {
      toast.error(toPublicError(reason, "备注未保存，请重试。"));
    } finally {
      setFollowUpBusy(false);
    }
  };

  const completeTask = async (taskId: string) => {
    try {
      await completeCrmTask(taskId);
      await load(false, true);
      toast.success("跟进任务已完成");
    } catch (reason) {
      toast.error(toPublicError(reason, "任务状态未更新，请重试。"));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <div className="flex items-center gap-3 border border-divider bg-content1 px-4 py-3">
          <SkeletonList rows={5} />
          <span className="text-sm text-default-500">正在加载客户档案...</span>
        </div>
      </div>
    );
  }

  if (loadIssue || !customer || !form || !continuity) {
    const issue =
      loadIssue ||
      customerLoadIssueFrom(new ApiError("客户不存在", 404, "HTTP_ERROR"));
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-2xl flex-col items-center justify-center gap-4 border border-dashed border-danger-200 px-6 text-center">
        <UserRound size={28} className="text-danger" />
        <div>
          <h1 className="kx-greet">{issue.title}</h1>
          <p className="mt-2 text-sm text-default-500">
            {issue.description}
          </p>
        </div>
        <div className="flex gap-2">
          <Button as={Link} href="/crm" variant="flat">
            返回 CRM
          </Button>
          {issue.canRetry ? (
            <Button
              color="primary"
              startContent={<RefreshCw size={15} />}
              onPress={() => load()}
            >
              重新加载
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (isMobile) {
    const statusToneBadge = (status: string) =>
      status === "customer" ? "mx-badge mx-badge-green"
        : status === "follow_up" ? "mx-badge mx-badge-gold"
          : status === "invalid" || status === "archived" ? "mx-badge mx-badge-red"
            : "mx-badge mx-badge-blue";
    const factRows: Array<[string, string | null | undefined]> = [
      ["公司", customer.companyName],
      ["职位", customer.title],
      ["手机", customer.phone],
      ["微信", customer.wechat],
      ["邮箱", customer.email],
      ["来源", [platformLabels[customer.sourcePlatform || ""] || customer.sourcePlatform, customer.sourceAccount?.name].filter(Boolean).join(" · ")],
      ["匹配关键词", customer.matchedKeyword],
      ["线索评分", customer.score != null ? String(customer.score) : null],
    ];
    const visibleFacts = factRows.filter(([, v]) => v);
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">{customer.displayName}</h1>
              <p className="mx-page-sub">
                {[customer.companyName, customer.title].filter(Boolean).join(" · ") || "客户档案"}
              </p>
            </div>
            <span className={statusToneBadge(customer.status)} style={{ whiteSpace: "nowrap" }}>
              {statusLabels[customer.status] || customer.status}
            </span>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {/* 操作条 */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, fontSize: 12, padding: "10px 8px" }}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "取消编辑" : "编辑客户"}
            </button>
            {editing ? (
              <button
                type="button"
                style={{ flex: 1, fontSize: 12, padding: "10px 8px", borderRadius: 999, background: "var(--kaypal-v3-cobalt)", color: "#fff", border: "none" }}
                disabled={saving}
                onClick={() => void saveCustomer()}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            ) : null}
            <button
              type="button"
              style={{ fontSize: 12, padding: "10px 14px", borderRadius: 999, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)" }}
              onClick={refreshCustomer}
            >
              刷新
            </button>
          </div>
          {hasUnsavedChanges ? (
            <p style={{ marginTop: 8, fontSize: 11.5, color: "var(--kaypal-v3-amber)" }}>有改动未保存</p>
          ) : null}

          {/* Tab 切换（横滚） */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, margin: "14px 0 12px" }}>
            {([["profile", "客户档案"], ["follow-up", "跟进与备注"], ["opportunities", "商机"], ["welcome", "欢迎消息"]] as Array<[string, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setSelectedTab(key); writeCustomerTabToUrl(key); }}
                style={{
                  flexShrink: 0,
                  fontSize: 12.5,
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: selectedTab === key ? "1.5px solid var(--kaypal-v3-accent)" : "1px solid var(--kaypal-v3-border)",
                  background: selectedTab === key ? "rgba(37,99,235,.12)" : "rgba(255,255,255,.06)",
                  color: selectedTab === key ? "var(--kaypal-v3-cobalt)" : "var(--kaypal-v3-ink)",
                  fontWeight: selectedTab === key ? 700 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {selectedTab === "profile" ? (
            <div className="mx-card" style={{ padding: 14 }}>
              {editing ? (
                <>
                  {([["displayName", "姓名/昵称"], ["companyName", "公司"], ["title", "职位"], ["phone", "手机"], ["wechat", "微信"], ["email", "邮箱"]] as Array<[keyof typeof form, string]>).map(([key, label]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginBottom: 4 }}>{label}</div>
                      <input
                        value={String(form[key] ?? "")}
                        onChange={(e) => setForm((cur) => (cur ? { ...cur, [key]: e.target.value } : cur))}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {visibleFacts.map(([label, value]) => (
                    <div key={label} className="mx-row">
                      <div className="mx-row-main" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", flexShrink: 0 }}>{label}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)", textAlign: "right", wordBreak: "break-all" }}>{value}</span>
                      </div>
                    </div>
                  ))}
                  {customer.tags.length > 0 ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {customer.tags.map((tag) => (
                        <span key={tag} className="mx-badge mx-badge-blue">{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {selectedTab === "profile" ? (
            <section className="mx-mt-lg">
              <div className="mx-section-head">
                <div className="mx-section-title">客户时间线</div>
                <span className="mx-section-eyebrow">{continuity.timeline.length} 条</span>
              </div>
              {continuity.timeline.length === 0 ? (
                <div className="mx-card mx-empty"><p>暂无时间线记录</p></div>
              ) : (
                <div className="mx-card mx-list-card">
                  {continuity.timeline.slice(0, 12).map((event) => (
                    <div key={event.id} className="mx-row">
                      <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)", borderRadius: 999 }}>
                        <Clock3 size={18} strokeWidth={1.8} />
                      </span>
                      <div className="mx-row-main">
                        <div className="mx-row-title">{eventLabels[event.eventType] || event.eventType}</div>
                        <div className="mx-row-desc">{formatDate(event.createdAt)}</div>
                        {event.replyContent || event.content ? (
                          <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--kaypal-v3-ink)", lineHeight: 1.6 }}>
                            {(event.replyContent || event.content || "").slice(0, 80)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {selectedTab === "follow-up" ? (
            <>
              <div className="mx-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)", marginBottom: 10 }}>新建跟进任务</div>
                <input
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="任务标题 *"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 8 }}
                />
                <textarea
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="任务描述（可选）"
                  rows={2}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13, outline: "none", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
                />
                <button
                  type="button"
                  className="mx-btn-gold"
                  style={{ width: "100%", fontSize: 12, padding: "10px 8px" }}
                  disabled={followUpBusy}
                  onClick={() => void createTask()}
                >
                  {followUpBusy ? "创建中…" : "创建任务"}
                </button>
              </div>

              <div className="mx-card mx-mt-lg" style={{ padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)", marginBottom: 10 }}>添加备注</div>
                <textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="备注内容"
                  rows={2}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13, outline: "none", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
                />
                <button
                  type="button"
                  className="mx-btn-gold"
                  style={{ width: "100%", fontSize: 12, padding: "10px 8px" }}
                  disabled={followUpBusy}
                  onClick={() => void createNote()}
                >
                  {followUpBusy ? "保存中…" : "添加备注"}
                </button>
              </div>

              <section className="mx-mt-lg">
                <div className="mx-section-head">
                  <div className="mx-section-title">任务</div>
                  <span className="mx-section-eyebrow">{continuity.tasks.length} 个</span>
                </div>
                {continuity.tasks.length === 0 ? (
                  <div className="mx-card mx-empty"><p>暂无跟进任务</p></div>
                ) : (
                  <div className="mx-card mx-list-card">
                    {continuity.tasks.map((task) => (
                      <div key={task.id} className="mx-row">
                        <div className="mx-row-main">
                          <div className="mx-row-title">{task.title}</div>
                          <div className="mx-row-desc">
                            {task.priority === "high" ? "高优 · " : ""}
                            {task.dueAt ? `截止 ${formatDate(task.dueAt)}` : "无截止"}
                          </div>
                        </div>
                        <div className="mx-row-right" style={{ gap: 6 }}>
                          {task.status !== "completed" ? (
                            <button
                              type="button"
                              style={{ fontSize: 10.5, padding: "5px 9px", borderRadius: 8, background: "rgba(16,185,129,.1)", color: "var(--kaypal-v3-success)", border: "none" }}
                              onClick={() => void completeTask(task.id)}
                            >
                              完成
                            </button>
                          ) : (
                            <span className="mx-badge mx-badge-green">已完成</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="mx-mt-lg">
                <div className="mx-section-head">
                  <div className="mx-section-title">备注</div>
                  <span className="mx-section-eyebrow">{continuity.notes.length} 条</span>
                </div>
                {continuity.notes.length === 0 ? (
                  <div className="mx-card mx-empty"><p>暂无备注</p></div>
                ) : (
                  <div className="mx-card mx-list-card">
                    {continuity.notes.map((note) => (
                      <div key={note.id} className="mx-row">
                        <span className="mx-row-ic" style={{ background: "rgba(120,148,179,.14)", color: "var(--kaypal-v3-muted)", borderRadius: 999 }}>
                          <FileText size={18} strokeWidth={1.8} />
                        </span>
                        <div className="mx-row-main">
                          <div style={{ fontSize: 12.5, color: "var(--kaypal-v3-ink)", lineHeight: 1.6 }}>{note.body}</div>
                          <div className="mx-row-desc">{formatDate(note.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}

          {selectedTab === "opportunities" ? (
            <section className="mx-mt-lg">
              <div className="mx-section-head">
                <div className="mx-section-title">关联商机</div>
                <span className="mx-section-eyebrow">{continuity.opportunities.length} 个</span>
              </div>
              {continuity.opportunities.length === 0 ? (
                <div className="mx-card mx-empty">
                  <p>还没有关联商机</p>
                  <p style={{ fontSize: 11, marginTop: 4 }}>去 CRM 给这个客户建商机</p>
                </div>
              ) : (
                <div className="mx-card mx-list-card">
                  {continuity.opportunities.map((o) => (
                    <div key={o.id} className="mx-row">
                      <div className="mx-row-main">
                        <div className="mx-row-title">{o.name}</div>
                        <div className="mx-row-desc">
                          {OPPORTUNITY_STAGE_LABELS[o.stage] || o.stage}
                          {o.amountCents ? ` · ¥${(o.amountCents / 100).toLocaleString()}` : ""}
                          {o.nextStep ? ` · 下一步:${o.nextStep}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {selectedTab === "welcome" ? (
            <WelcomeMessagePanel
              customer={customer}
              templates={templates}
              onTemplatesChange={setTemplates}
              onPrepared={() => load(false, true)}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 pb-10">
      <header className="border-b border-divider pb-5">
        <Button
          as={Link}
          href="/crm"
          size="sm"
          startContent={<ArrowLeft size={15} />}
          variant="light"
        >
          返回 CRM
        </Button>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words kx-greet text-foreground">
                {customer.displayName}
              </h1>
              <Chip
                color={customer.archived ? "default" : "success"}
                size="sm"
                variant="flat"
              >
                {statusLabels[customer.status] || customer.status}
              </Chip>
            </div>
            <p className="mt-2 text-sm text-default-500">
              {[
                customer.companyName,
                customer.title,
                customer.sourceAccount?.name,
              ]
                .filter(Boolean)
                .join(" · ") || "独立客户"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasUnsavedChanges ? (
              <Chip color="warning" size="sm" variant="flat">
                有改动未保存
              </Chip>
            ) : null}
            <Button
              startContent={<RefreshCw size={15} />}
              variant="flat"
              onPress={refreshCustomer}
            >
              刷新
            </Button>
            {editing ? (
              <>
                <Button
                  startContent={<X size={15} />}
                  variant="flat"
                  onPress={() => {
                    setForm(customerToForm(customer));
                    setEditing(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  color="primary"
                  isLoading={saving}
                  startContent={!saving ? <Save size={15} /> : null}
                  onPress={saveCustomer}
                >
                  保存
                </Button>
              </>
            ) : (
              <Button
                color="primary"
                startContent={<Edit3 size={15} />}
                onPress={() => setEditing(true)}
              >
                编辑客户
              </Button>
            )}
          </div>
        </div>
      </header>

      <Tabs
        aria-label="客户档案视图"
        color="primary"
        selectedKey={selectedTab}
        variant="underlined"
        onSelectionChange={(key) => {
          const nextTab = String(key);
          if (nextTab === selectedTab) return;
          setSelectedTab(nextTab);
          writeCustomerTabToUrl(nextTab);
        }}
      >
        <Tab key="profile" title="客户档案">
          <div className="grid gap-6 pt-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section aria-labelledby="profile-heading" className="space-y-5">
              <h2 id="profile-heading" className="text-base font-semibold">
                基本资料
              </h2>
              {editing ? (
                <CustomerEditFields form={form} onChange={setForm} />
              ) : (
                <CustomerFacts customer={customer} />
              )}

              <div className="border-t border-divider pt-5">
                <h2 className="text-base font-semibold">会话与来源</h2>
                <ConversationLinks
                  customer={customer}
                  timeline={continuity.timeline}
                />
              </div>

              {/* P2 T05：来源归因链（内容→发布→互动→线索→客户） */}
              <div className="border-t border-divider pt-5">
                <h2 className="mb-3 text-base font-semibold">来源归因</h2>
                <CustomerAttributionPanel customerId={customer.id} />
              </div>

              <div className="border-t border-divider pt-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">合并与去重</h2>
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<Link2 size={15} />}
                    onPress={() => setMergeOpen(true)}
                  >
                    合并客户
                  </Button>
                </div>
                <p className="mt-1 text-sm text-default-400">
                  如果这个客户与另一个客户重复，可把另一个客户的跟进记录合并进来。
                </p>
              </div>
            </section>

            <section aria-labelledby="timeline-heading" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 id="timeline-heading" className="text-base font-semibold">
                  客户时间线
                </h2>
                <Chip size="sm" variant="flat">
                  {continuity.timeline.length}
                </Chip>
              </div>
              <Timeline events={continuity.timeline} />
            </section>
          </div>
        </Tab>

        <Tab key="follow-up" title="跟进与备注">
          <div className="grid gap-8 pt-4 lg:grid-cols-2">
            <section aria-labelledby="tasks-heading" className="space-y-4">
              <div className="flex items-center justify-between border-b border-divider pb-3">
                <h2 id="tasks-heading" className="text-base font-semibold">
                  跟进任务
                </h2>
                <Chip size="sm" variant="flat">
                  {continuity.tasks.length}
                </Chip>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="任务标题"
                  value={taskTitle}
                  onValueChange={setTaskTitle}
                />
                <Select
                  label="优先级"
                  selectedKeys={[taskPriority]}
                  onSelectionChange={(keys) =>
                    setTaskPriority(String(Array.from(keys)[0] || "normal"))
                  }
                >
                  <SelectItem key="low">低</SelectItem>
                  <SelectItem key="normal">普通</SelectItem>
                  <SelectItem key="high">高</SelectItem>
                </Select>
                <Input
                  label="截止日期"
                  type="date"
                  value={taskDueAt}
                  onValueChange={setTaskDueAt}
                />
                <Textarea
                  label="任务说明"
                  minRows={1}
                  value={taskDescription}
                  onValueChange={setTaskDescription}
                />
              </div>
              <Button
                color="primary"
                isLoading={followUpBusy}
                startContent={!followUpBusy ? <Plus size={15} /> : null}
                onPress={createTask}
              >
                新建任务
              </Button>
              <div className="space-y-2">
                {continuity.tasks.length ? (
                  continuity.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-start justify-between gap-3 border border-divider p-3"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-default-500">
                          {formatDate(task.dueAt)} · {task.priority}
                        </p>
                        {task.description ? (
                          <p className="mt-2 break-words text-sm text-default-600">
                            {task.description}
                          </p>
                        ) : null}
                      </div>
                      {task.status === "done" ? (
                        <Chip color="success" size="sm" variant="flat">
                          已完成
                        </Chip>
                      ) : (
                        <Button
                          isIconOnly
                          aria-label={`完成任务 ${task.title}`}
                          size="sm"
                          variant="flat"
                          onPress={() => completeTask(task.id)}
                        >
                          <Check size={15} />
                        </Button>
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyBlock
                    icon={<Clock3 size={22} />}
                    title="没有待跟进任务"
                  />
                )}
              </div>
            </section>

            <section aria-labelledby="notes-heading" className="space-y-4">
              <div className="flex items-center justify-between border-b border-divider pb-3">
                <h2 id="notes-heading" className="text-base font-semibold">
                  客户备注
                </h2>
                <Chip size="sm" variant="flat">
                  {continuity.notes.length}
                </Chip>
              </div>
              <Textarea
                label="备注内容"
                minRows={4}
                value={noteBody}
                onValueChange={setNoteBody}
              />
              <Button
                color="primary"
                isLoading={followUpBusy}
                startContent={!followUpBusy ? <Plus size={15} /> : null}
                onPress={createNote}
              >
                添加备注
              </Button>
              <div className="space-y-2">
                {continuity.notes.length ? (
                  continuity.notes.map((note) => (
                    <article
                      key={note.id}
                      className="border border-divider p-3"
                    >
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">
                        {note.body}
                      </p>
                      <p className="mt-2 text-xs text-default-400">
                        {formatDate(note.createdAt)}
                      </p>
                    </article>
                  ))
                ) : (
                  <EmptyBlock
                    icon={<FileText size={22} />}
                    title="还没有客户备注"
                  />
                )}
              </div>
            </section>
          </div>
        </Tab>

        <Tab key="opportunities" title={`商机${continuity.opportunities.length ? `（${continuity.opportunities.length}）` : ""}`}>
          <div className="pt-4">
            <section aria-labelledby="opportunities-heading" className="space-y-5">
              <h2 id="opportunities-heading" className="text-base font-semibold">
                关联商机
              </h2>
              {continuity.opportunities.length ? (
                <div className="space-y-2">
                  {continuity.opportunities.map((o) => (
                    <article
                      key={o.id}
                      className="border border-divider p-4"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">{o.name}</h3>
                        <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs text-primary-600">
                          {OPPORTUNITY_STAGE_LABELS[o.stage] || o.stage}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-default-500">
                        {o.amountCents
                          ? `预计 ¥${(o.amountCents / 100).toLocaleString()}`
                          : "金额未填"}
                        {o.nextStep ? ` · 下一步：${o.nextStep}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyBlock
                  icon={<Target size={22} />}
                  title="还没有关联商机"
                />
              )}
            </section>
          </div>
        </Tab>

        <Tab key="welcome" title="欢迎消息">
          <div className="pt-4">
            <WelcomeMessagePanel
              customer={customer}
              templates={templates}
              onTemplatesChange={setTemplates}
              onPrepared={() => load(false, true)}
            />
          </div>
        </Tab>
      </Tabs>
      {modal}

      {mergeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--kaypal-v3-paper)] p-6 shadow-sm dark:bg-default-50">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">合并客户</h3>
              <button
                type="button"
                className="rounded-full p-1 text-default-400 hover:bg-default-100"
                onClick={() => {
                  setMergeOpen(false);
                  setMergeMsg(null);
                }}
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-sm text-default-500">
              把另一个客户的跟进记录（任务/备注/时间线/商机）合并进当前客户，被合并客户会归档。
            </p>
            <input
              value={mergeSourceId}
              onChange={(e) => setMergeSourceId(e.target.value)}
              placeholder="要合并进来的客户 ID"
              className="mt-4 h-10 w-full rounded-lg border border-default-200 px-3 text-sm outline-none focus:border-primary"
            />
            {mergeMsg ? (
              <p className="mt-2 text-sm text-danger">{mergeMsg}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="light" onPress={() => setMergeOpen(false)}>
                取消
              </Button>
              <Button
                color="danger"
                isLoading={merging}
                onPress={() => void handleMerge()}
              >
                确认合并
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerEditFields({
  form,
  onChange,
}: {
  form: CustomerForm;
  onChange: React.Dispatch<React.SetStateAction<CustomerForm | null>>;
}) {
  const update = (key: keyof CustomerForm, value: string) =>
    onChange((current) => (current ? { ...current, [key]: value } : current));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input
        isRequired
        label="姓名或昵称"
        value={form.displayName}
        onValueChange={(value) => update("displayName", value)}
      />
      <Input
        label="公司"
        value={form.companyName}
        onValueChange={(value) => update("companyName", value)}
      />
      <Input
        label="职位"
        value={form.title}
        onValueChange={(value) => update("title", value)}
      />
      <Select
        label="客户状态"
        selectedKeys={[form.status]}
        onSelectionChange={(keys) =>
          update("status", String(Array.from(keys)[0] || "new"))
        }
      >
        {Object.entries(statusLabels)
          .filter(([key]) => key !== "archived")
          .map(([key, label]) => (
            <SelectItem key={key}>{label}</SelectItem>
          ))}
      </Select>
      <Input
        label="邮箱"
        type="email"
        value={form.email}
        onValueChange={(value) => update("email", value)}
      />
      <Input
        label="手机号"
        value={form.phone}
        onValueChange={(value) => update("phone", value)}
      />
      <Input
        label="微信号"
        value={form.wechat}
        onValueChange={(value) => update("wechat", value)}
      />
      <Input
        label="平台用户 ID"
        value={form.externalUserId}
        onValueChange={(value) => update("externalUserId", value)}
      />
      <Select
        label="来源平台"
        selectedKeys={[form.sourcePlatform]}
        onSelectionChange={(keys) =>
          update("sourcePlatform", String(Array.from(keys)[0] || "manual"))
        }
      >
        {Object.entries(platformLabels).map(([key, label]) => (
          <SelectItem key={key}>{label}</SelectItem>
        ))}
      </Select>
      <Input
        label="来源关键词"
        value={form.sourceKeyword}
        onValueChange={(value) => update("sourceKeyword", value)}
      />
      <Input
        label="来源账号名称"
        value={form.sourceAccountName}
        onValueChange={(value) => update("sourceAccountName", value)}
      />
      <Input
        label="来源账号 ID"
        value={form.sourceAccountId}
        onValueChange={(value) => update("sourceAccountId", value)}
      />
      <Input
        className="sm:col-span-2"
        label="来源链接"
        value={form.sourceUrl}
        onValueChange={(value) => update("sourceUrl", value)}
      />
      <Input
        className="sm:col-span-2"
        label="标签"
        value={form.tags}
        onValueChange={(value) => update("tags", value)}
      />
      <Textarea
        className="sm:col-span-2"
        label="来源内容"
        minRows={3}
        value={form.sourceText}
        onValueChange={(value) => update("sourceText", value)}
      />
    </div>
  );
}

function CustomerFacts({ customer }: { customer: CrmCustomer }) {
  const facts = [
    ["公司", customer.companyName],
    ["职位", customer.title],
    ["邮箱", customer.email],
    ["手机号", customer.phone],
    ["微信号", customer.wechat],
    ["平台用户 ID", customer.externalUserId],
    [
      "来源平台",
      platformLabels[customer.sourcePlatform || ""] || customer.sourcePlatform,
    ],
    ["来源账号", customer.sourceAccount?.name],
    ["来源账号 ID", customer.sourceAccount?.id],
    ["来源关键词", customer.sourceKeyword],
    ["评分", String(customer.score)],
    ["更新时间", formatDate(customer.updatedAt)],
  ];
  return (
    <div className="grid gap-x-6 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label} className="border-b border-divider py-3">
          <p className="text-xs font-medium text-default-500">{label}</p>
          <p className="mt-1 break-words text-sm font-medium">{value || "-"}</p>
        </div>
      ))}
      <div className="border-b border-divider py-3 sm:col-span-2">
        <p className="text-xs font-medium text-default-500">标签</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {customer.tags.length ? (
            customer.tags.map((tag) => (
              <Chip key={tag} size="sm" variant="flat">
                {tag}
              </Chip>
            ))
          ) : (
            <span className="text-sm text-default-400">-</span>
          )}
        </div>
      </div>
      <div className="py-3 sm:col-span-2">
        <p className="text-xs font-medium text-default-500">来源内容</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
          {customer.sourceText || "-"}
        </p>
      </div>
    </div>
  );
}

function ConversationLinks({
  customer,
  timeline,
}: {
  customer: CrmCustomer;
  timeline: CrmTimelineEvent[];
}) {
  const taskIds = Array.from(
    new Set(
      [
        customer.latestInteractionTaskId,
        customer.firstInteractionTaskId,
        ...timeline.map((event) => event.relatedInteractionTaskId),
      ].filter(Boolean) as string[],
    ),
  );
  const links = [
    customer.sourceUrl
      ? { label: "来源内容", href: customer.sourceUrl, external: true }
      : null,
    customer.profileUrl
      ? { label: "客户主页", href: customer.profileUrl, external: true }
      : null,
    ...taskIds.map((taskId, index) => ({
      label: index === 0 ? "最近互动记录" : `互动记录 ${index + 1}`,
      href: `/engagement/records?taskId=${encodeURIComponent(taskId)}`,
      external: false,
    })),
  ].filter(Boolean) as Array<{
    label: string;
    href: string;
    external: boolean;
  }>;
  return links.length ? (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {links.map((link) => (
        <Button
          key={`${link.label}-${link.href}`}
          as={Link}
          className="justify-between"
          endContent={
            link.external ? <ExternalLink size={14} /> : <Link2 size={14} />
          }
          href={link.href}
          target={link.external ? "_blank" : undefined}
          variant="flat"
        >
          {link.label}
        </Button>
      ))}
    </div>
  ) : (
    <div className="mt-3">
      <EmptyBlock icon={<Link2 size={22} />} title="还没有会话或来源链接" />
    </div>
  );
}

function Timeline({ events }: { events: CrmTimelineEvent[] }) {
  if (!events.length) {
    return <EmptyBlock icon={<Clock3 size={22} />} title="还没有客户动态" />;
  }
  return (
    <div className="max-h-[680px] space-y-2 overflow-auto pr-1">
      {events.map((event) => {
        const readback = deliveryLabel(event);
        return (
          <article key={event.id} className="border border-divider p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {eventLabels[event.eventType] || event.eventType}
                </p>
                <p className="mt-1 text-xs text-default-400">
                  {formatDate(event.createdAt)}
                </p>
              </div>
              {readback ? (
                <Chip
                  color={readback === "平台已确认" ? "success" : "warning"}
                  size="sm"
                  variant="flat"
                >
                  {readback}
                </Chip>
              ) : null}
            </div>
            {event.replyContent || event.content ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-default-600">
                {event.replyContent || event.content}
              </p>
            ) : null}
            {event.relatedInteractionTaskId ? (
              <Button
                as={Link}
                className="mt-2"
                href={`/engagement/records?taskId=${encodeURIComponent(event.relatedInteractionTaskId)}`}
                size="sm"
                startContent={<MessageSquareText size={14} />}
                variant="light"
              >
                查看互动记录
              </Button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function EmptyBlock({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center gap-2 border border-dashed border-divider px-4 text-center text-default-400">
      {icon}
      <p className="text-sm">{title}</p>
    </div>
  );
}
