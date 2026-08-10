"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  MessageSquareText,
  Play,
  Plus,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2Textarea,
  V2PrimaryButton,
  V2GhostButton,
  V2StatusChip,
  V2OptionCard,
  V2Disclosure,
} from "@/components/v2/ui-kit";
import { api } from "@/lib/api/client";
import { kaypalApi } from "@/lib/api/auth";
import { autoUploadApi } from "@/lib/api/auto-upload";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import type {
  InteractionGeneratedReply,
  InteractionReplyRuleConfig,
  InteractionTask,
} from "@/lib/api/local-engine";

/* ============ 类型（与旧版一致） ============ */

type CustomerServiceForm = {
  botName: string;
  botType: "sales" | "advisor";
  industryName: string;
  tone: InteractionReplyRuleConfig["tone"];
  defaultSendMode: InteractionReplyRuleConfig["defaultSendMode"];
  askForContact: boolean;
  authorizedAccounts: string;
  replyDelay: string;
  whitelist: string;
  noReplyScenarios: string;
  fileRequestPolicy: string;
  serviceHighlights: string;
  requireApprovalKeywords: string;
  blockedKeywords: string;
  fallbackReplies: string;
  closingText: string;
  contactScope: "wechat" | "douyin" | "all";
  knowledgeScope: "local" | "selected" | "none";
  selectedKnowledgeId: string;
};

type CustomerServiceBot = {
  id: string;
  name: string;
  enabled: boolean;
  configVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  config: InteractionReplyRuleConfig;
};

type CustomerServicePlatform = "wechat" | "douyin";

type CustomerServiceReplyDecision = {
  action: "reply" | "review" | "no-reply" | string;
  reason: string;
  canCreateTask: boolean;
  sendMode?: string;
  riskLevel?: string;
  contact: {
    platform?: CustomerServicePlatform;
    accountBound: boolean;
    scopeMatched: boolean;
    whitelisted: boolean;
  };
  fileRequest: boolean;
};

type CustomerServiceSimulation = InteractionGeneratedReply & {
  decision: CustomerServiceReplyDecision;
};

type KnowledgeItem = { id: string; title?: string; name?: string; fileName?: string };

/* ============ 转换函数（与旧版逐字一致） ============ */

function splitConfigLines(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinConfigLines(items?: string[]) {
  return (items || []).join("\n");
}

function ruleToCustomerServiceForm(
  rule: InteractionReplyRuleConfig,
): CustomerServiceForm {
  return {
    botName: rule.botName || "销售顾问机器人",
    botType: rule.botType || "sales",
    industryName: rule.industryName,
    tone: rule.tone,
    defaultSendMode: rule.defaultSendMode || "auto-send",
    askForContact: rule.askForContact,
    authorizedAccounts:
      joinConfigLines(rule.authorizedAccounts) || "抖音门店号\n微信客服号",
    replyDelay: rule.replyDelay || "20-45 秒",
    whitelist:
      joinConfigLines(rule.whitelist) || "老客户\n高意向客户\n售后客户",
    noReplyScenarios:
      joinConfigLines(rule.noReplyScenarios) ||
      "投诉\n退款\n发票\n私下转账\n平台违规词",
    fileRequestPolicy:
      rule.fileRequestPolicy || "客户要求文件、合同、报价单时先转人工确认。",
    serviceHighlights: joinConfigLines(rule.serviceHighlights),
    requireApprovalKeywords: joinConfigLines(rule.requireApprovalKeywords),
    blockedKeywords: joinConfigLines(rule.blockedKeywords),
    fallbackReplies: joinConfigLines(rule.fallbackReplies),
    closingText: rule.closingText,
    contactScope: rule.contactScope || "all",
    knowledgeScope: rule.knowledgeScope || "local",
    selectedKnowledgeId: rule.selectedKnowledgeId || "",
  };
}

function buildRulePayload(form: CustomerServiceForm) {
  return {
    botName: form.botName.trim(),
    botType: form.botType,
    authorizedAccounts: splitConfigLines(form.authorizedAccounts),
    replyDelay: form.replyDelay.trim(),
    whitelist: splitConfigLines(form.whitelist),
    noReplyScenarios: splitConfigLines(form.noReplyScenarios),
    fileRequestPolicy: form.fileRequestPolicy.trim(),
    contactScope: form.contactScope,
    knowledgeScope: form.knowledgeScope,
    selectedKnowledgeId: form.selectedKnowledgeId || "",
    industryName: form.industryName,
    tone: form.tone,
    defaultSendMode: form.defaultSendMode,
    askForContact: form.askForContact,
    serviceHighlights: splitConfigLines(form.serviceHighlights),
    requireApprovalKeywords: splitConfigLines(form.requireApprovalKeywords),
    blockedKeywords: splitConfigLines(form.blockedKeywords),
    fallbackReplies: splitConfigLines(form.fallbackReplies),
    closingText: form.closingText,
    fallbackEnabled: true,
    allowFallbackAutoSend: false,
  };
}

const DEFAULT_FORM = ruleToCustomerServiceForm({
  botName: "",
  industryName: "",
  tone: "warm",
  askForContact: true,
  closingText: "好的，我记下了，稍后详细跟你说～",
} as InteractionReplyRuleConfig);

const SEND_MODES = [
  { value: "auto-send" as const, label: "低风险自动发送", desc: "省心的内容直接发，敏感的转人工" },
  { value: "approval-send" as const, label: "发送前都确认（推荐）", desc: "每条回复你过目后再发" },
  { value: "draft-only" as const, label: "只生成草稿", desc: "AI 只写不发，你自己复制粘贴" },
];

const TONES = [
  { value: "warm", label: "温和亲切" },
  { value: "professional", label: "专业稳重" },
  { value: "concise", label: "简洁直接" },
];

/* ============ 主组件 ============ */

export function CustomerServiceConfig() {
  const isMobile = useIsMobile();
  const router = useRouter();

  // 机器人列表
  const [bots, setBots] = useState<CustomerServiceBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [creatingBot, setCreatingBot] = useState(false);

  // 配置表单
  const [form, setForm] = useState<CustomerServiceForm>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  // 知识库
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);

  // 模拟问答
  const [question, setQuestion] = useState("");
  const [targetName, setTargetName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [simPlatform, setSimPlatform] = useState<CustomerServicePlatform>("douyin");
  const [contactLabels, setContactLabels] = useState("");
  const [reply, setReply] = useState<CustomerServiceSimulation | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskCreated, setTaskCreated] = useState<InteractionTask | null>(null);

  // 消息
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needAccountLogin, setNeedAccountLogin] = useState<string | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) || null,
    [bots, selectedBotId],
  );

  // 已登录的本地账号：名字 → 账号 id（后端建任务要 accountId 不要名字）
  const [loggedInAccounts, setLoggedInAccounts] = useState<string[]>([]);
  const [accountIdByName, setAccountIdByName] = useState<Record<string, number>>({});

  // 模拟问答的承接账号：机器人授权账号 ∩ 已登录账号（名字匹配 accountName/profileName/userName）
  const authorizedAccountOptions = useMemo(
    () => splitConfigLines(form.authorizedAccounts),
    [form.authorizedAccounts],
  );
  const selectableAccountOptions = useMemo(() => {
    if (loggedInAccounts.length === 0) return authorizedAccountOptions;
    const matched = authorizedAccountOptions.filter((name) =>
      loggedInAccounts.includes(name),
    );
    return matched.length > 0 ? matched : authorizedAccountOptions;
  }, [authorizedAccountOptions, loggedInAccounts]);
  const hasNoLoggedInMatch =
    loggedInAccounts.length > 0 &&
    !authorizedAccountOptions.some((name) => loggedInAccounts.includes(name));

  // 授权账号变化时，若当前选中项已失效才改选第一个；"不指定"（空）是合法选择，不强制覆盖
  useEffect(() => {
    if (
      accountName &&
      selectableAccountOptions.length > 0 &&
      !selectableAccountOptions.includes(accountName)
    ) {
      setAccountName(selectableAccountOptions[0]);
    }
  }, [selectableAccountOptions, accountName]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [replyBots, knowledge, accountList] = await Promise.all([
        api.get<CustomerServiceBot[]>("/local-engine/reply-bots"),
        kaypalApi.listLocalKnowledge().catch(() => ({ total: 0, items: [] })),
        autoUploadApi.accounts().catch(() => []),
      ]);
      // 收集所有已登录账号的可解析名（accountName/profileName/userName）→ id 映射
      const names = new Set<string>();
      const idMap: Record<string, number> = {};
      (Array.isArray(accountList) ? accountList : [])
        .filter((a) => a.status === 1 || a.sessionStatus === "logged_in")
        .forEach((a) => {
          [a.accountName, a.profileName, a.userName]
            .filter(Boolean)
            .forEach((n) => {
              const key = String(n);
              names.add(key);
              if (!(key in idMap)) idMap[key] = a.id;
            });
        });
      setLoggedInAccounts(Array.from(names));
      setAccountIdByName(idMap);
      const botList = Array.isArray(replyBots) ? replyBots : [];
      setBots(botList);
      setKnowledgeItems(
        ((knowledge as { items?: KnowledgeItem[] }).items || []) as KnowledgeItem[],
      );
      if (!selectedBotId && botList.length > 0) {
        const active = botList.find((b) => b.enabled) || botList[0];
        setSelectedBotId(active.id);
        setForm(ruleToCustomerServiceForm(active.config));
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "加载客服配置失败"));
    } finally {
      setLoading(false);
    }
  }, [selectedBotId]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectBot = (bot: CustomerServiceBot) => {
    setCreatingBot(false);
    setSelectedBotId(bot.id);
    setForm(ruleToCustomerServiceForm(bot.config));
    setReply(null);
    setTaskCreated(null);
  };

  const startCreate = () => {
    setCreatingBot(true);
    setSelectedBotId(null);
    setForm(DEFAULT_FORM);
    setReply(null);
    setTaskCreated(null);
  };

  const toggleBot = async (bot: CustomerServiceBot) => {
    try {
      await api.post<CustomerServiceBot>(
        `/local-engine/reply-bots/${encodeURIComponent(bot.id)}/enabled`,
        { enabled: !bot.enabled, expectedRevision: bot.revision },
      );
      await load();
    } catch (err: unknown) {
      setError(toPublicError(err, "切换失败，请稍后重试"));
    }
  };

  const handleSave = async () => {
    if (!form.botName.trim()) {
      setError("请先给机器人起个名字");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildRulePayload(form);
      if (creatingBot) {
        const saved = await api.post<CustomerServiceBot>(
          "/local-engine/reply-bots",
          payload,
        );
        setSelectedBotId(saved.id);
        setCreatingBot(false);
        flash("机器人已创建");
      } else if (selectedBotId) {
        await api.post<CustomerServiceBot>(
          `/local-engine/reply-bots/${encodeURIComponent(selectedBotId)}`,
          { ...payload, expectedRevision: selectedBot?.revision },
        );
        flash("配置已保存");
      }
      await load();
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!question.trim()) {
      setError("请输入客户问题");
      return;
    }
    setGenerating(true);
    setError(null);
    setReply(null);
    setTaskCreated(null);
    try {
      const generated = await api.post<CustomerServiceSimulation>(
        "/local-engine/reply/generate",
        {
          sourceText: question,
          targetName: targetName || undefined,
          accountName: accountName || undefined,
          platform: simPlatform,
          botId: selectedBotId || undefined,
          contactLabels: contactLabels
            .split(/[,，\n]/)
            .map((t) => t.trim())
            .filter(Boolean),
        },
      );
      setReply(generated);
    } catch (err: unknown) {
      // 排障期：透出后端真实错误
      const rawMessage = err instanceof Error ? err.message : "";
      setError(
        rawMessage
          ? `生成失败：${rawMessage}`
          : toPublicError(err, "生成失败，请调整问题后重试"),
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateTask = async () => {
    if (!reply || !selectedBotId) return;
    if (!reply.decision.canCreateTask) {
      setError(reply.decision.reason || "当前规则不创建发送任务");
      return;
    }
    if (!accountName) {
      setError("请先选择一个承接账号（第 3 步「授权账号」里维护）");
      return;
    }
    setCreatingTask(true);
    setError(null);
    try {
      const task = await api.post<InteractionTask>(
        `/local-engine/reply-bots/${encodeURIComponent(selectedBotId)}/tasks`,
        {
          targetName: targetName || "未命名客户",
          accountName,
          // 后端校验要 accountId（数字 ID），按选中账号名映射
          accountId: accountIdByName[accountName]
            ? String(accountIdByName[accountName])
            : undefined,
          sourceText: question,
          replyText: reply.replyText || undefined,
          platform: simPlatform,
          contactLabels: contactLabels
            .split(/[,，\n]/)
            .map((t) => t.trim())
            .filter(Boolean),
          commercialExecutionRequested: true,
        },
      );
      setTaskCreated(task);
      flash("发送任务已创建，去「待我确认」里查看");
    } catch (err: unknown) {
      // 排障期：透出后端真实错误
      const rawMessage = err instanceof Error ? err.message : "";
      // 账号未登录 → 给可点击的引导，不只是文字
      if (rawMessage.includes("已登录的本地账号") || rawMessage.includes("平台账号完成登录")) {
        setError(null);
        setNeedAccountLogin(rawMessage);
      } else {
        setError(
          rawMessage
            ? `创建任务失败：${rawMessage}`
            : toPublicError(err, "创建任务失败，请稍后重试"),
        );
      }
    } finally {
      setCreatingTask(false);
    }
  };

  const set = <K extends keyof CustomerServiceForm>(key: K, value: CustomerServiceForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const decisionTone =
    reply?.decision.action === "reply"
      ? "success"
      : reply?.decision.action === "no-reply"
        ? "muted"
        : "warning";

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载客服配置...</p>
      </div>
    );
  }

  /* 移动端原生视图（mx-* 明德 VP 风格）——AI 客服配置移动版 */
  if (isMobile) {
    const inputStyle: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(142,165,190,.3)",
      background: "rgba(255,255,255,.06)",
      color: "var(--mx-ink)",
      fontSize: 13,
    };
    const decisionBadge =
      decisionTone === "success" ? "mx-badge-green" : decisionTone === "warning" ? "mx-badge-gold" : "mx-badge-blue";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <button type="button" onClick={() => router.push("/engagement")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, marginBottom: 6 }}>
              <ArrowLeft width={14} height={14} /> 返回互动中心
            </button>
            <div className="mx-page-title">AI 客服</div>
            <div className="mx-page-sub">教 AI 怎么帮你回复客户：定风格 → 定规则 → 试一试</div>
          </div>

          {/* 状态条 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className={`mx-badge ${creatingBot || selectedBot?.enabled ? "mx-badge-green" : "mx-badge-blue"}`} style={{ fontSize: 10.5 }}>
              {creatingBot ? "新建中" : selectedBot?.enabled ? "运行中" : "未启用"}
            </span>
            <button type="button" className="mx-btn-gold" style={{ padding: "7px 14px", fontSize: 11.5 }} onClick={startCreate}>
              <Plus width={13} height={13} /> 新建机器人
            </button>
          </div>

          {notice && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(5,150,105,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#059669" }}>{notice}</p>
            </div>
          )}
          {needAccountLogin && (
            <div className="mx-card" style={{ marginTop: 10, padding: 12, borderColor: "rgba(222,150,57,.45)" }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--mx-ink)" }}>先登录平台账号</p>
              <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 4, lineHeight: 1.5 }}>抖音私信回复需要一个已登录的抖音账号，登录后回来就能创建任务了</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 9 }} onClick={() => router.push("/platforms")}>去平台账号登录</button>
            </div>
          )}
          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* 机器人列表 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>我的客服机器人</div>
          {bots.length === 0 ? (
            <button type="button" className="mx-card mx-empty" style={{ padding: 22, textAlign: "center", width: "100%", borderStyle: "dashed" }} onClick={startCreate}>
              <Bot width={26} height={26} style={{ color: "var(--mx-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--mx-ink)", marginTop: 9 }}>创建第一个机器人</p>
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {bots.map((bot) => (
                <button
                  key={bot.id}
                  type="button"
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", width: "100%", borderColor: selectedBotId === bot.id ? "rgba(222,150,57,.6)" : undefined, background: selectedBotId === bot.id ? "rgba(246,196,120,.1)" : undefined }}
                  onClick={() => selectBot(bot)}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.name}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--mx-muted)", marginTop: 2 }}>
                      {bot.config.industryName || "未设行业"} · {bot.enabled ? "运行中" : "已停用"}
                    </span>
                  </span>
                  <span
                    role="switch"
                    aria-checked={bot.enabled}
                    onClick={(e) => { e.stopPropagation(); void toggleBot(bot); }}
                    style={{ flexShrink: 0, width: 42, height: 25, borderRadius: 999, padding: 3, background: bot.enabled ? "#d98a2d" : "rgba(142,165,190,.4)", display: "flex", alignItems: "center", justifyContent: bot.enabled ? "flex-end" : "flex-start", transition: "all .2s" }}
                  >
                    <span style={{ width: 19, height: 19, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 第 1 步：风格 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 1 步：它是什么风格？</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>机器人名字 *</span>
              <input placeholder="例如：门店销售小助手" value={form.botName} onChange={(e) => set("botName", e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>所在行业</span>
              <input placeholder="例如：美业 / 餐饮 / 教育" value={form.industryName} onChange={(e) => set("industryName", e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
            </label>
            <div style={{ marginTop: 11 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>回复类型</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 7 }}>
                {[
                  { value: "sales" as const, label: "销售型", desc: "目标是成交，会主动引导" },
                  { value: "advisor" as const, label: "顾问型", desc: "专业解答，不硬推" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set("botType", opt.value)}
                    style={{ padding: 11, borderRadius: 10, textAlign: "left", background: form.botType === opt.value ? "rgba(246,196,120,.12)" : "rgba(120,148,179,.1)", border: "1px solid " + (form.botType === opt.value ? "rgba(222,150,57,.5)" : "rgba(142,165,190,.3)") }}
                  >
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--mx-ink)" }}>{opt.label}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--mx-muted)", marginTop: 3, lineHeight: 1.45 }}>{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 11 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>说话语气</span>
              <div style={{ display: "flex", gap: 7, marginTop: 7 }}>
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set("tone", t.value as CustomerServiceForm["tone"])}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 600, background: form.tone === t.value ? "rgba(246,196,120,.18)" : "rgba(120,148,179,.12)", color: form.tone === t.value ? "#d98a2d" : "var(--mx-ink)", border: "1px solid " + (form.tone === t.value ? "rgba(222,150,57,.5)" : "rgba(142,165,190,.3)") }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 第 2 步：发送策略 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 2 步：写好的回复怎么发？</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SEND_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => set("defaultSendMode", mode.value)}
                className="mx-card"
                style={{ padding: 12, textAlign: "left", width: "100%", borderColor: form.defaultSendMode === mode.value ? "rgba(222,150,57,.6)" : undefined, background: form.defaultSendMode === mode.value ? "rgba(246,196,120,.1)" : undefined }}
              >
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>{mode.label}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 3 }}>{mode.desc}</span>
              </button>
            ))}
          </div>
          <div className="mx-card" style={{ marginTop: 8, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12.5, color: "var(--mx-ink)" }}>主动问客户要联系方式</span>
            <button
              type="button"
              role="switch"
              aria-checked={form.askForContact}
              onClick={() => set("askForContact", !form.askForContact)}
              style={{ flexShrink: 0, width: 44, height: 26, borderRadius: 999, padding: 3, background: form.askForContact ? "#d98a2d" : "rgba(142,165,190,.4)", display: "flex", alignItems: "center", justifyContent: form.askForContact ? "flex-end" : "flex-start", transition: "all .2s", border: "none" }}
            >
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
            </button>
          </div>

          {/* 第 3 步提示：高级规则在桌面端配置 */}
          <div className="mx-card" style={{ marginTop: 14, padding: 12, borderColor: "rgba(222,150,57,.35)" }}>
            <p style={{ fontSize: 12, color: "var(--mx-ink)", lineHeight: 1.6 }}>
              第 3 步补充规则（服务范围、授权账号、禁止词、知识库等）字段较多，已按最佳实践预填，建议在电脑端配置后再来试用。
            </p>
          </div>

          {/* 第 4 步：试一试 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 4 步：试一试</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>客户的问题 *</span>
              <textarea rows={2} placeholder="例如：你们这个多少钱？有效果吗？" value={question} onChange={(e) => setQuestion(e.target.value)} style={{ ...inputStyle, marginTop: 6, resize: "vertical", lineHeight: 1.55, fontSize: 12.5 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>客户称呼</span>
              <input placeholder="例如：王女士" value={targetName} onChange={(e) => setTargetName(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
            </label>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ width: "100%", marginTop: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={generating}
              onClick={() => void handleGenerate()}
            >
              {generating ? <Sparkles width={14} height={14} className="animate-spin" /> : <Play width={14} height={14} />}
              {generating ? "正在生成…" : "生成候选回复"}
            </button>

            {reply && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "rgba(120,148,179,.08)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--mx-ink)" }}>它会这样回：</span>
                  <span className={`mx-badge ${decisionBadge}`} style={{ fontSize: 10 }}>
                    {reply.decision.action === "reply" ? "会自动发送" : reply.decision.action === "review" ? "会先给你确认" : reply.decision.action === "no-reply" ? "按规则不回复" : reply.decision.action}
                  </span>
                </div>
                <p style={{ marginTop: 8, whiteSpace: "pre-wrap", padding: 10, borderRadius: 8, background: "rgba(255,255,255,.05)", fontSize: 12.5, lineHeight: 1.6, color: "var(--mx-ink)" }}>
                  {reply.replyText || reply.decision.reason}
                </p>
                {reply.decision.reason && reply.decision.action !== "auto-send" && (
                  <p style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 6 }}>原因：{reply.decision.reason}</p>
                )}
                {reply.decision.canCreateTask && !taskCreated && (
                  <button
                    type="button"
                    className="mx-btn-gold"
                    style={{ width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    disabled={creatingTask}
                    onClick={() => void handleCreateTask()}
                  >
                    <Send width={14} height={14} />
                    {creatingTask ? "正在创建…" : "创建发送任务"}
                  </button>
                )}
                {taskCreated && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(5,150,105,.1)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: "#059669" }}>✓ 任务已创建，等你在「待我确认」里放行</span>
                    <button type="button" onClick={() => router.push("/tasks/confirmations")} style={{ fontSize: 11.5, fontWeight: 700, color: "#d98a2d", background: "none", border: "none", flexShrink: 0 }}>
                      去确认 ›
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 保存 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/engagement")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回
            </button>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={saving}
              onClick={() => void handleSave()}
            >
              <Save width={15} height={15} />
              {saving ? "正在保存…" : "保存配置"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/engagement")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              AI 客服
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              教 AI 怎么帮你回复客户：定风格 → 定规则 → 试一试
            </p>
          </div>
          <V2StatusChip tone={selectedBot?.enabled || creatingBot ? "success" : "muted"}>
            {creatingBot ? "新建中" : selectedBot?.enabled ? "运行中" : "未启用"}
          </V2StatusChip>
        </div>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {needAccountLogin && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-5">
          <div className="flex items-start gap-3">
            <MessageSquareText className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-amber)]" />
            <div className="flex-1">
              <p className="font-medium text-[var(--kaypal-v3-ink)]">
                先登录平台账号
              </p>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                抖音私信回复需要一个已登录的抖音账号，登录后回来就能创建任务了
              </p>
              <div className="mt-3">
                <V2PrimaryButton
                  onClick={() => router.push("/platforms")}
                >
                  去平台账号登录
                </V2PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* 左：机器人列表 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--kaypal-v3-muted)]">
              我的客服机器人
            </h2>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-[var(--kaypal-v3-accent-ink)] transition hover:underline"
              onClick={startCreate}
            >
              <Plus className="h-4 w-4" />
              新建
            </button>
          </div>
          {bots.length === 0 && (
            <button
              type="button"
              className="w-full rounded-[var(--kaypal-v3-radius)] border-2 border-dashed border-[var(--kaypal-v3-border)] p-6 text-center transition hover:border-[var(--kaypal-v3-accent)]"
              onClick={startCreate}
            >
              <Bot className="mx-auto h-8 w-8 text-[var(--kaypal-v3-muted)]" />
              <p className="mt-2 text-sm font-medium text-[var(--kaypal-v3-ink)]">
                创建第一个机器人
              </p>
            </button>
          )}
          {bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-4 text-left transition ${
                selectedBotId === bot.id
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() => selectBot(bot)}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-[var(--kaypal-v3-ink)]">{bot.name}</p>
                <span
                  role="switch"
                  aria-checked={bot.enabled}
                  className={`flex h-5 w-9 items-center rounded-full p-0.5 transition ${
                    bot.enabled
                      ? "justify-end bg-[var(--kaypal-v3-accent)]"
                      : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleBot(bot);
                  }}
                >
                  <span className="h-4 w-4 rounded-full bg-white shadow" />
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                {bot.config.industryName || "未设行业"} ·{" "}
                {bot.enabled ? "运行中" : "已停用"}
              </p>
            </button>
          ))}
        </div>

        {/* 右：配置 + 模拟 */}
        <div className="space-y-6">
          {/* 第 1 步：定风格 */}
          <V2Section title="第 1 步：它是什么风格？">
            <div className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <V2Field label="机器人名字" required>
                  <V2Input
                    placeholder="例如：门店销售小助手"
                    value={form.botName}
                    onChange={(e) => set("botName", e.target.value)}
                  />
                </V2Field>
                <V2Field label="所在行业">
                  <V2Input
                    placeholder="例如：美业 / 餐饮 / 教育"
                    value={form.industryName}
                    onChange={(e) => set("industryName", e.target.value)}
                  />
                </V2Field>
              </div>
              <V2Field label="回复类型">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "sales" as const, label: "销售型", desc: "目标是成交，会主动引导" },
                    { value: "advisor" as const, label: "顾问型", desc: "专业解答，不硬推" },
                  ].map((opt) => (
                    <V2OptionCard
                      key={opt.value}
                      icon={opt.value === "sales" ? Sparkles : MessageSquareText}
                      title={opt.label}
                      description={opt.desc}
                      selected={form.botType === opt.value}
                      onClick={() => set("botType", opt.value)}
                    />
                  ))}
                </div>
              </V2Field>
              <V2Field label="说话语气">
                <div className="grid grid-cols-3 gap-3">
                  {TONES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-2.5 text-sm font-medium transition ${
                        form.tone === t.value
                          ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                      }`}
                      onClick={() => set("tone", t.value as CustomerServiceForm["tone"])}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </V2Field>
            </div>
          </V2Section>

          {/* 第 2 步：定发送策略 */}
          <V2Section title="第 2 步：写好的回复怎么发？">
            <div className="grid gap-3">
              {SEND_MODES.map((mode) => (
                <V2OptionCard
                  key={mode.value}
                  icon={mode.value === "auto-send" ? Send : mode.value === "approval-send" ? CheckCircle2 : MessageSquareText}
                  title={mode.label}
                  description={mode.desc}
                  selected={form.defaultSendMode === mode.value}
                  onClick={() => set("defaultSendMode", mode.value)}
                />
              ))}
            </div>
            <label className="mt-4 flex items-center justify-between">
              <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                主动问客户要联系方式
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.askForContact}
                className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${
                  form.askForContact
                    ? "justify-end bg-[var(--kaypal-v3-accent)]"
                    : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                }`}
                onClick={() => set("askForContact", !form.askForContact)}
              >
                <span className="h-5 w-5 rounded-full bg-white shadow" />
              </button>
            </label>
          </V2Section>

          {/* 第 3 步：定规则（高级折叠） */}
          <V2Section title="第 3 步：补充规则（可选）" description="已按通用最佳实践预填，一般不用改">
            <V2Disclosure>
              <div className="grid gap-5">
                <V2Field label="服务范围">
                  <V2Select
                    value={form.contactScope}
                    onChange={(e) => set("contactScope", e.target.value as CustomerServiceForm["contactScope"])}
                  >
                    <option value="all">全部客户来源</option>
                    <option value="douyin">抖音/视频号客户</option>
                    <option value="wechat">微信联系人</option>
                  </V2Select>
                </V2Field>
                <V2Field label="授权账号" hint="允许它用哪些账号回复，一行一个">
                  <V2Textarea
                    rows={2}
                    value={form.authorizedAccounts}
                    onChange={(e) => set("authorizedAccounts", e.target.value)}
                  />
                </V2Field>
                <V2Field label="这些情况不回复" hint="命中就转人工，一行一个">
                  <V2Textarea
                    rows={2}
                    value={form.noReplyScenarios}
                    onChange={(e) => set("noReplyScenarios", e.target.value)}
                  />
                </V2Field>
                <V2Field label="这些情况必须先问我" hint="需要确认的关键词，一行一个">
                  <V2Textarea
                    rows={2}
                    value={form.requireApprovalKeywords}
                    onChange={(e) => set("requireApprovalKeywords", e.target.value)}
                  />
                </V2Field>
                <V2Field label="禁止说的话" hint="一行一个">
                  <V2Textarea
                    rows={2}
                    value={form.blockedKeywords}
                    onChange={(e) => set("blockedKeywords", e.target.value)}
                  />
                </V2Field>
                <V2Field label="服务亮点" hint="让它记住你的卖点，一行一个">
                  <V2Textarea
                    rows={2}
                    placeholder="例如：30天无理由退换\n免费上门测量"
                    value={form.serviceHighlights}
                    onChange={(e) => set("serviceHighlights", e.target.value)}
                  />
                </V2Field>
                <V2Field label="答不上来时怎么说" hint="兜底回复，一行一个">
                  <V2Textarea
                    rows={2}
                    placeholder="例如：这个问题我记下来，稍后人工回复你"
                    value={form.fallbackReplies}
                    onChange={(e) => set("fallbackReplies", e.target.value)}
                  />
                </V2Field>
                <V2Field label="收尾话术">
                  <V2Input
                    value={form.closingText}
                    onChange={(e) => set("closingText", e.target.value)}
                  />
                </V2Field>
                <V2Field label="知识库" hint="让它引用你的资料回答">
                  <V2Select
                    value={form.knowledgeScope}
                    onChange={(e) => set("knowledgeScope", e.target.value as CustomerServiceForm["knowledgeScope"])}
                  >
                    <option value="local">引用本地知识库</option>
                    <option value="selected">仅引用选中的资料</option>
                    <option value="none">不引用知识库</option>
                  </V2Select>
                </V2Field>
                {form.knowledgeScope === "selected" && (
                  <V2Field label="选择资料">
                    <V2Select
                      value={form.selectedKnowledgeId}
                      onChange={(e) => set("selectedKnowledgeId", e.target.value)}
                    >
                      <option value="">请选择</option>
                      {knowledgeItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title || item.fileName || item.id}
                        </option>
                      ))}
                    </V2Select>
                  </V2Field>
                )}
                <V2Field label="延时回复" hint="更像真人，不秒回">
                  <V2Input
                    placeholder="例如：20-45 秒"
                    value={form.replyDelay}
                    onChange={(e) => set("replyDelay", e.target.value)}
                  />
                </V2Field>
                <V2Field label="白名单" hint="这些人可以更自动，一行一个">
                  <V2Textarea
                    rows={2}
                    value={form.whitelist}
                    onChange={(e) => set("whitelist", e.target.value)}
                  />
                </V2Field>
                <V2Field label="客户要文件时">
                  <V2Input
                    value={form.fileRequestPolicy}
                    onChange={(e) => set("fileRequestPolicy", e.target.value)}
                  />
                </V2Field>
              </div>
            </V2Disclosure>
          </V2Section>

          {/* 规则检查：6 行检查表（当前配置自检） */}
          <V2Section
            title="规则检查"
            description="保存前看看这套配置有没有明显的坑"
          >
            <div className="divide-y divide-[var(--kaypal-v3-border)]">
              {[
                {
                  label: "发送策略",
                  value:
                    form.defaultSendMode === "auto-send"
                      ? "低风险自动发送"
                      : form.defaultSendMode === "approval-send"
                        ? "发送前确认"
                        : "只生成草稿",
                  ok: true,
                  note: form.defaultSendMode === "auto-send" ? "省心但敏感内容也自动发" : "安全",
                },
                {
                  label: "账号与来源",
                  value: splitConfigLines(form.authorizedAccounts).length > 0
                    ? `${splitConfigLines(form.authorizedAccounts).length} 个授权账号`
                    : "未设置",
                  ok: splitConfigLines(form.authorizedAccounts).length > 0,
                  note: splitConfigLines(form.authorizedAccounts).length > 0 ? "符合范围" : "建任务会被拦",
                },
                {
                  label: "联系人白名单",
                  value: splitConfigLines(form.whitelist).length > 0
                    ? splitConfigLines(form.whitelist).slice(0, 2).join("、") + (splitConfigLines(form.whitelist).length > 2 ? " 等" : "")
                    : "未设置",
                  ok: true,
                  note: splitConfigLines(form.whitelist).length > 0 ? "这些人更自动" : "全部按默认策略",
                },
                {
                  label: "知识范围",
                  value:
                    form.knowledgeScope === "none"
                      ? "不引用知识库"
                      : form.knowledgeScope === "selected"
                        ? form.selectedKnowledgeId
                          ? "已关联指定资料"
                          : "选了指定资料但没选文件"
                        : "本地知识库",
                  ok: form.knowledgeScope !== "selected" || Boolean(form.selectedKnowledgeId),
                  note:
                    form.knowledgeScope === "selected" && !form.selectedKnowledgeId
                      ? "去上面选一个文件"
                      : "可用",
                },
                {
                  label: "回复延时",
                  value: form.replyDelay || "立即",
                  ok: true,
                  note: form.replyDelay ? "更像真人" : "秒回",
                },
                {
                  label: "不回复与限制规则",
                  value: splitConfigLines(form.noReplyScenarios).length > 0
                    ? `${splitConfigLines(form.noReplyScenarios).length} 条不回复场景`
                    : "未设置",
                  ok: splitConfigLines(form.noReplyScenarios).length > 0,
                  note: splitConfigLines(form.noReplyScenarios).length > 0 ? "敏感内容转人工" : "建议加投诉/退款等",
                },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    {row.ok ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--kaypal-v3-success)]" />
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-amber-soft)] text-xs font-bold text-[var(--kaypal-v3-amber)]">
                        !
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {row.label}
                      </p>
                      <p className="text-xs text-[var(--kaypal-v3-muted)]">{row.value}</p>
                    </div>
                  </div>
                  <span className={`text-xs ${row.ok ? "text-[var(--kaypal-v3-success)]" : "text-[var(--kaypal-v3-amber)]"}`}>
                    {row.note}
                  </span>
                </div>
              ))}
            </div>
          </V2Section>

          {/* 保存 */}
          <div className="flex items-center justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/engagement")}>
              返回
            </V2GhostButton>
            <V2PrimaryButton icon={Save} loading={saving} onClick={handleSave}>
              {saving ? "正在保存..." : creatingBot ? "创建机器人" : "保存配置"}
            </V2PrimaryButton>
          </div>

          {/* 第 4 步：试一试 */}
          <V2Section
            title="第 4 步：试一试"
            description="模拟一个客户问题，看它怎么回，满意再上岗"
          >
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <V2Field label="客户称呼">
                  <V2Input
                    placeholder="例如：王女士"
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                  />
                </V2Field>
                <V2Field
                  label="承接账号"
                  hint={
                    authorizedAccountOptions.length === 0
                      ? "先在第 3 步「授权账号」里添加账号"
                      : undefined
                  }
                >
                  <V2Select
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  >
                    <option value="">不指定</option>
                    {selectableAccountOptions.map((account) => (
                      <option key={account} value={account}>
                        {account}
                      </option>
                    ))}
                  </V2Select>
                  {hasNoLoggedInMatch && (
                    <p className="mt-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-2.5 text-xs text-[var(--kaypal-v3-amber)]">
                      机器人授权的账号都没有在本地登录。请先到「平台账号」登录，或在第 3 步「授权账号」里填已登录的账号名（当前已登录：{loggedInAccounts.slice(0, 3).join("、")}）
                    </p>
                  )}
                </V2Field>
                <V2Field label="来源平台">
                  <V2Select
                    value={simPlatform}
                    onChange={(e) => setSimPlatform(e.target.value as CustomerServicePlatform)}
                  >
                    <option value="douyin">抖音</option>
                    <option value="wechat">微信</option>
                  </V2Select>
                </V2Field>
              </div>
              <V2Field
                label="客户标签"
                hint="测试白名单命中，例如：老客户, 高意向客户（逗号分隔）"
              >
                <V2Input
                  placeholder="例如：老客户, 高意向客户"
                  value={contactLabels}
                  onChange={(e) => setContactLabels(e.target.value)}
                />
              </V2Field>
              <V2Field label="客户的问题" required>
                <V2Textarea
                  rows={2}
                  placeholder="例如：你们这个多少钱？有效果吗？"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </V2Field>
              <div className="flex justify-end">
                <V2PrimaryButton
                  icon={generating ? Sparkles : Play}
                  loading={generating}
                  onClick={handleGenerate}
                >
                  {generating ? "正在生成..." : "生成候选回复"}
                </V2PrimaryButton>
              </div>

              {/* 候选回复 */}
              {reply && (
                <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                      它会这样回：
                    </p>
                    <V2StatusChip tone={decisionTone}>
                      {reply.decision.action === "reply"
                        ? "会自动发送"
                        : reply.decision.action === "review"
                          ? "会先给你确认"
                          : reply.decision.action === "no-reply"
                            ? "按规则不回复"
                            : reply.decision.action}
                    </V2StatusChip>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper)] p-4 text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
                    {reply.replyText || reply.decision.reason}
                  </p>
                  {reply.decision.reason && reply.decision.action !== "auto-send" && (
                    <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
                      原因：{reply.decision.reason}
                    </p>
                  )}
                  {reply.decision.canCreateTask && !taskCreated && (
                    <div className="mt-4 flex justify-end">
                      <V2PrimaryButton
                        icon={Send}
                        loading={creatingTask}
                        onClick={handleCreateTask}
                      >
                        {creatingTask ? "正在创建..." : "创建发送任务"}
                      </V2PrimaryButton>
                    </div>
                  )}
                  {taskCreated && (
                    <div className="mt-4 flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-success-soft)] p-3">
                      <span className="text-sm text-[var(--kaypal-v3-success)]">
                        ✓ 任务已创建，等你在「待我确认」里放行
                      </span>
                      <button
                        type="button"
                        className="text-sm font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline"
                        onClick={() => router.push("/tasks/confirmations")}
                      >
                        去确认 →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </V2Section>
        </div>
      </div>
    </div>
  );
}
