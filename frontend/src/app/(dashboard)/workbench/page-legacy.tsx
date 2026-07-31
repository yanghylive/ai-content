"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  Spinner,
  Switch,
  Textarea,
  addToast,
} from "@heroui/react";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@/components/lucide-icon-compat";
import {
  OpsDesktopPage,
  OpsDenseTable,
  OpsFormRow,
  OpsMetric,
  OpsPanel,
  OpsStatusPill,
  OpsToolbar,
} from "../components/desktop-ops-ui";
import {
  localEngineApi,
  type InteractionGeneratedReply,
  type LocalEngineBrowserAccount,
  type InteractionReplyRuleConfig,
  type InteractionTask,
} from "@/lib/api/local-engine";
import { api } from "@/lib/api/client";
import { kaypalApi, type LocalKnowledgeItem } from "@/lib/api/auth";
import { toPublicError } from "@/lib/public-error";

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
  action: "reply" | "review" | "no-reply";
  sendMode: InteractionReplyRuleConfig["defaultSendMode"];
  canGenerate: boolean;
  canCreateTask: boolean;
  reason: string;
  reasons: string[];
  matchedRules: {
    whitelist: string[];
    noReply: string[];
    approval: string[];
    blocked: string[];
  };
  delay: {
    minSeconds: number;
    maxSeconds: number;
    selectedSeconds: number;
    notBefore?: string;
  };
  knowledge: {
    scope: "local" | "selected" | "none";
    selectedKnowledgeId?: string;
    selectedKnowledgeTitle?: string;
    available: boolean;
  };
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

const CUSTOMER_SERVICE_GUIDE_STEPS = [
  "选择类型",
  "设置行业",
  "设置目标",
  "对话流程",
  "限制条件",
  "确认保存",
] as const;

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

function buildPromptPreview(form: CustomerServiceForm) {
  const role =
    form.botType === "sales"
      ? "你是成交导向的销售顾问，只做候选回复。"
      : "你是专业顾问型客服，只做候选回复。";
  return [
    role,
    `行业：${form.industryName || "未设置"}`,
    `语气：${form.tone === "warm" ? "温和亲切" : form.tone === "professional" ? "专业稳重" : "简洁直接"}`,
    `发送策略：${form.defaultSendMode === "auto-send" ? "低风险自动发送" : form.defaultSendMode === "approval-send" ? "发送前确认" : "只生成草稿"}`,
    `知识范围：${form.knowledgeScope === "none" ? "暂不引用知识库" : form.knowledgeScope === "selected" ? "仅引用选中的知识资料" : "引用本地知识库"}`,
    `联系人范围：${form.contactScope === "wechat" ? "微信联系人" : form.contactScope === "douyin" ? "抖音/视频号客户" : "全部客户来源"}`,
    `授权账号：${splitConfigLines(form.authorizedAccounts).join("、") || "未设置"}`,
    `延时回复：${form.replyDelay || "立即生成候选回复"}`,
    `白名单：${splitConfigLines(form.whitelist).join("、") || "未设置"}`,
    `不回复场景：${splitConfigLines(form.noReplyScenarios).join("、") || "敏感和不确定问题"}`,
    `发送文件需求：${form.fileRequestPolicy || "先转人工确认"}`,
    `服务亮点：${splitConfigLines(form.serviceHighlights).join("、") || "按客户具体问题回复"}`,
    `必须转人工：${splitConfigLines(form.requireApprovalKeywords).join("、") || "敏感问题和不确定问题"}`,
    `禁止表达：${splitConfigLines(form.blockedKeywords).join("、") || "夸大承诺、私下转账、绝对化保证"}`,
  ].join("\n");
}

function decisionPresentation(decision?: CustomerServiceReplyDecision) {
  if (!decision) {
    return {
      label: "等待测试",
      color: "default" as const,
      detail: "运行模拟问答后显示当前规则的实际判断。",
    };
  }
  if (decision.action === "no-reply") {
    return {
      label: "不自动回复",
      color: "danger" as const,
      detail: decision.reason,
    };
  }
  if (decision.action === "review") {
    return {
      label: decision.sendMode === "draft-only" ? "只生成草稿" : "发送前确认",
      color: "warning" as const,
      detail: decision.reason,
    };
  }
  return {
    label: "可以进入发送队列",
    color: "success" as const,
    detail: decision.reason,
  };
}

function interactionTaskStatusTone(
  status: InteractionTask["status"],
): "default" | "primary" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "waiting_for_send_confirmation") return "warning";
  if (status === "running") return "primary";
  return "default";
}

export default function WorkbenchOverviewPage() {
  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
        <VStack gap={3}>
          <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
            <VStack gap={2}>
              <Text color="secondary" type="supporting">
                商业增长 · 客服配置
              </Text>
              <Heading level={1}>AI客服配置</Heading>
              <Text color="secondary">
                机器人配置、规则测试、模拟问答、知识库、联系人和发送前确认集中在这里处理。
              </Text>
            </VStack>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                as={Link}
                href="/distribution?tab=accounts"
                size="sm"
                variant="flat"
              >
                账号管理
              </Button>
              <Button
                as={Link}
                color="primary"
                href="/tasks/confirmations"
                size="sm"
                variant="flat"
              >
                待我确认
              </Button>
            </div>
          </HStack>
        </VStack>
      </LayoutContent>
      <OpsDesktopPage>
        <CustomerServiceConfigWorkbench />
      </OpsDesktopPage>
    </Layout>
  );
}

export function CustomerServiceConfigWorkbench() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [guideStep, setGuideStep] = React.useState(0);
  const [isCreatingBot, setIsCreatingBot] = React.useState(false);
  const [bots, setBots] = React.useState<CustomerServiceBot[]>([]);
  const [selectedBotId, setSelectedBotId] = React.useState("");
  const [form, setForm] = React.useState<CustomerServiceForm | null>(null);
  const [knowledgeItems, setKnowledgeItems] = React.useState<
    LocalKnowledgeItem[]
  >([]);
  const [contactCount, setContactCount] = React.useState(0);
  const [question, setQuestion] = React.useState(
    "你们这个怎么收费？我想先了解一下适不适合我们门店。",
  );
  const [targetName, setTargetName] = React.useState("张先生");
  const [contactLabels, setContactLabels] = React.useState("");
  const [accountName, setAccountName] = React.useState("抖音门店号");
  const [deliveryPlatform, setDeliveryPlatform] =
    React.useState<CustomerServicePlatform>("douyin");
  const [availableAccounts, setAvailableAccounts] = React.useState<
    LocalEngineBrowserAccount[]
  >([]);
  const [accountId, setAccountId] = React.useState("");
  const [reply, setReply] = React.useState<CustomerServiceSimulation | null>(
    null,
  );
  const [interactionTask, setInteractionTask] =
    React.useState<InteractionTask | null>(null);
  const saveConfigLockRef = React.useRef(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [replyBots, knowledge, contacts, browserStatus] = await Promise.all(
        [
          api.get<CustomerServiceBot[]>("/local-engine/reply-bots"),
          kaypalApi.listLocalKnowledge().catch(() => ({ total: 0, items: [] })),
          localEngineApi
            .wechatContacts()
            .catch(() => ({
              count: 0,
              items: [],
              contacts: [],
              source: "none",
            })),
          localEngineApi.browserStatus().catch(() => ({ accounts: [] })),
        ],
      );
      const activeBot = replyBots.find((bot) => bot.enabled) || replyBots[0];
      setBots(replyBots);
      setSelectedBotId(activeBot?.id || "");
      setForm(activeBot ? ruleToCustomerServiceForm(activeBot.config) : null);
      setIsCreatingBot(false);
      if (activeBot?.config.contactScope === "wechat") {
        setDeliveryPlatform("wechat");
      } else if (activeBot?.config.contactScope === "douyin") {
        setDeliveryPlatform("douyin");
      }
      setKnowledgeItems(knowledge.items || []);
      setContactCount(contacts.count || contacts.items?.length || 0);
      setAvailableAccounts(browserStatus.accounts || []);
    } catch (error) {
      addToast({
        title: "AI客服配置读取失败",
        description: toPublicError(
          error,
          "AI 客服配置暂时无法读取，请重新加载。",
        ),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (
      !interactionTask ||
      ["completed", "failed", "blocked", "skipped"].includes(
        interactionTask.status,
      )
    ) {
      return;
    }
    let active = true;
    const refreshTask = async () => {
      try {
        const latest = await localEngineApi.task(interactionTask.id);
        if (active) setInteractionTask(latest);
      } catch {
        // The task remains visible with its last known state when a refresh is unavailable.
      }
    };
    void refreshTask();
    const timer = window.setInterval(() => {
      void refreshTask();
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [interactionTask]);

  const updateForm = React.useCallback(
    <K extends keyof CustomerServiceForm>(
      key: K,
      value: CustomerServiceForm[K],
    ) => {
      setForm((current) => (current ? { ...current, [key]: value } : current));
    },
    [],
  );

  const saveConfig = async () => {
    if (!form || (!isCreatingBot && !selectedBotId)) return;
    const creatingBot = isCreatingBot;
    const selectedBot = bots.find((item) => item.id === selectedBotId);
    if (!form.industryName.trim() || !form.botName.trim()) {
      addToast({
        title: "请补齐机器人信息",
        description: "机器人名称和行业不能为空。",
        color: "warning",
      });
      return;
    }
    if (saveConfigLockRef.current) return;
    saveConfigLockRef.current = true;
    setSaving(true);
    try {
      const payload = buildRulePayload(form);
      const saved = creatingBot
        ? await api.post<CustomerServiceBot>(
            "/local-engine/reply-bots",
            payload,
          )
        : await api.post<CustomerServiceBot>(
            `/local-engine/reply-bots/${encodeURIComponent(selectedBotId)}`,
            {
              ...payload,
              expectedRevision: selectedBot?.revision,
            },
          );
      setBots((items) =>
        creatingBot
          ? [saved, ...items]
          : items.map((item) => (item.id === saved.id ? saved : item)),
      );
      setSelectedBotId(saved.id);
      setIsCreatingBot(false);
      setForm(ruleToCustomerServiceForm(saved.config));
      addToast({
        title: creatingBot ? "机器人已创建" : "AI客服配置已保存",
        description: creatingBot
          ? "机器人已保存，现在可以运行回复预览和创建客服任务。"
          : "新规则会用于后续候选回复和发送前检查。",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "保存失败",
        description: toPublicError(error, "AI 客服配置未保存，请重试。"),
        color: "danger",
      });
    } finally {
      saveConfigLockRef.current = false;
      setSaving(false);
    }
  };

  const startBotDraft = () => {
    if (!form) return;
    setIsCreatingBot(true);
    setForm({ ...form });
    setGuideStep(0);
    setReply(null);
    setInteractionTask(null);
  };

  const cancelBotDraft = () => {
    if (!isCreatingBot) return;
    const existingBot =
      bots.find((item) => item.id === selectedBotId) ||
      bots.find((item) => item.enabled) ||
      bots[0];
    setIsCreatingBot(false);
    setGuideStep(0);
    setReply(null);
    setInteractionTask(null);
    if (existingBot) {
      setSelectedBotId(existingBot.id);
      setForm(ruleToCustomerServiceForm(existingBot.config));
      if (
        existingBot.config.contactScope === "wechat" ||
        existingBot.config.contactScope === "douyin"
      ) {
        setDeliveryPlatform(existingBot.config.contactScope);
      }
    }
    addToast({
      title: "已取消新建",
      description: "未保存的机器人草稿不会写入机器人列表。",
      color: "default",
    });
  };

  const selectBot = (bot: CustomerServiceBot) => {
    setIsCreatingBot(false);
    setSelectedBotId(bot.id);
    setForm(ruleToCustomerServiceForm(bot.config));
    setGuideStep(0);
    setReply(null);
    if (
      bot.config.contactScope === "wechat" ||
      bot.config.contactScope === "douyin"
    ) {
      setDeliveryPlatform(bot.config.contactScope);
    }
  };

  const toggleBot = async (bot: CustomerServiceBot) => {
    try {
      const updated = await api.post<CustomerServiceBot>(
        `/local-engine/reply-bots/${encodeURIComponent(bot.id)}/enabled`,
        { enabled: !bot.enabled, expectedRevision: bot.revision },
      );
      setBots((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      addToast({
        title: updated.enabled ? "机器人已启用" : "机器人已停用",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "状态更新失败",
        description: toPublicError(error, "请稍后重试。"),
        color: "danger",
      });
    }
  };

  const generateReply = async () => {
    if (!form) return;
    if (isCreatingBot) {
      addToast({
        title: "请先保存机器人",
        description: "保存当前草稿后即可运行回复预览。",
        color: "warning",
      });
      return;
    }
    if (!question.trim()) {
      addToast({ title: "请输入客户问题", color: "warning" });
      return;
    }
    setGenerating(true);
    try {
      const generated = await api.post<CustomerServiceSimulation>(
        "/local-engine/reply/generate",
        {
          sourceText: question,
          targetName,
          accountName,
          platform: deliveryPlatform,
          contactLabels: splitConfigLines(contactLabels),
          botId: selectedBotId,
        },
      );
      setReply(generated);
      addToast({
        title:
          generated.decision.action === "no-reply"
            ? "规则判断已完成"
            : "候选回复已生成",
        description:
          generated.decision.action === "no-reply"
            ? generated.decision.reason
            : generated.generatedBy === "ai"
            ? "已按当前规则生成回复。"
            : "当前使用规则兜底回复。",
        color:
          generated.decision.action === "no-reply"
            ? "warning"
            : "success",
      });
    } catch (error) {
      addToast({
        title: "生成失败",
        description: toPublicError(error, "客服回复未生成，请调整问题后重试。"),
        color: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const createCustomerServiceTask = async () => {
    if (!form || !reply || !selectedBotId) {
      addToast({
        title: "请先生成候选回复",
        description: "生成回复后才能创建客服任务。",
        color: "warning",
      });
      return;
    }
    if (!reply.decision.canCreateTask) {
      addToast({
        title: "当前规则不创建发送任务",
        description: reply.decision.reason,
        color: "warning",
      });
      return;
    }
    setConfirming(true);
    try {
      const task = await api.post<InteractionTask>(
        `/local-engine/reply-bots/${encodeURIComponent(selectedBotId)}/tasks`,
        {
          accountId: accountId || undefined,
          targetName: targetName || "未命名客户",
          accountName: accountName || "未指定账号",
          sourceText: question,
          replyText: reply.replyText,
          replyGeneratedBy: reply.generatedBy,
          platform: deliveryPlatform,
          contactLabels: splitConfigLines(contactLabels),
          commercialExecutionRequested: true,
        },
      );
      setInteractionTask(task);
      addToast({
        title: task.status === "blocked" ? "客服任务需处理" : "客服任务已创建",
        description:
          task.failureReason ||
          task.nextAction ||
          (task.sendMode === "approval-send"
            ? "请确认后继续发送。"
            : "任务已进入发送队列。"),
        color: task.status === "blocked" ? "warning" : "success",
      });
    } catch (error) {
      addToast({
        title: "客服任务创建失败",
        description: toPublicError(error, "客服任务未创建，请重试。"),
        color: "danger",
      });
    } finally {
      setConfirming(false);
    }
  };

  const clearSimulation = () => {
    setQuestion("你们这个怎么收费？我想先了解一下适不适合我们门店。");
    setTargetName("张先生");
    setContactLabels("");
    setAccountName("抖音门店号");
    setReply(null);
    addToast({ title: "测试会话已清空", color: "success" });
  };

  if (loading || !form) {
    return (
      <OpsPanel>
        <div className="flex min-h-[180px] items-center justify-center">
          <Spinner label="正在读取AI客服配置" />
        </div>
      </OpsPanel>
    );
  }

  const risk = reply ? decisionPresentation(reply.decision) : null;
  const ruleRisk = decisionPresentation(reply?.decision);
  const selectedKnowledge = knowledgeItems.find(
    (item) => item.id === form.selectedKnowledgeId,
  );
  const robotRows = bots.map((bot) => ({
    ...bot,
    accounts: splitConfigLines(joinConfigLines(bot.config.authorizedAccounts))
      .length,
    type: bot.config.botType === "advisor" ? "顾问型" : "销售型",
    sendMode:
      bot.config.defaultSendMode === "auto-send"
        ? "自动发送"
        : bot.config.defaultSendMode === "approval-send"
          ? "发送前确认"
          : "只生成草稿",
    knowledge:
      bot.config.knowledgeScope === "none"
        ? "未关联"
        : bot.config.knowledgeScope === "selected"
          ? "指定资料"
          : "本地知识库",
  }));

  return (
    <>
      <OpsPanel
        extra={
          <div className="flex flex-wrap gap-2">
            <Button
              color="primary"
              isDisabled={isCreatingBot}
              size="sm"
              startContent={<Icon icon="solar:magic-stick-3-linear" />}
              variant="flat"
              onPress={startBotDraft}
            >
              {isCreatingBot ? "新建中" : "新建机器人"}
            </Button>
            {isCreatingBot ? (
              <Button
                size="sm"
                startContent={<Icon icon="solar:close-circle-linear" />}
                variant="flat"
                onPress={cancelBotDraft}
              >
                取消新建
              </Button>
            ) : null}
            <Button
              as={Link}
              href="/tasks/confirmations"
              size="sm"
              startContent={<Icon icon="solar:check-square-linear" />}
              variant="flat"
            >
              待我确认
            </Button>
            <Button
              isLoading={saving}
              size="sm"
              startContent={
                saving ? null : <Icon icon="solar:diskette-linear" />
              }
              variant="flat"
              onPress={saveConfig}
            >
              保存配置
            </Button>
          </div>
        }
        title="AI客服配置"
      >
        <div className="grid gap-3">
          <OpsToolbar className="justify-between">
            <div className="flex flex-wrap gap-4">
              <OpsMetric
                label="机器人"
                tone="brand"
                value={form.botName || "未命名"}
              />
              <OpsMetric label="知识资料" value={knowledgeItems.length} />
              <OpsMetric label="联系人" value={contactCount} />
              <OpsMetric
                label="发送策略"
                tone="warning"
                value={
                  form.defaultSendMode === "auto-send"
                    ? "自动发送"
                    : form.defaultSendMode === "approval-send"
                      ? "发送前确认"
                      : "生成草稿"
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <OpsStatusPill tone="brand">机器人列表</OpsStatusPill>
              <OpsStatusPill>配置表单</OpsStatusPill>
              <OpsStatusPill>回复预览</OpsStatusPill>
              <OpsStatusPill>联系人/知识库</OpsStatusPill>
            </div>
          </OpsToolbar>

          <OpsPanel title="AI客服机器人">
            <OpsDenseTable>
              <table>
                <thead>
                  <tr>
                    <th>机器人</th>
                    <th>类型</th>
                    <th>授权账号</th>
                    <th>发送策略</th>
                    <th>知识库</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {robotRows.map((robot) => (
                    <tr key={robot.id}>
                      <td>{robot.name}</td>
                      <td>{robot.type}</td>
                      <td>{robot.accounts}</td>
                      <td>{robot.sendMode}</td>
                      <td>{robot.knowledge}</td>
                      <td>
                        <OpsStatusPill
                          tone={robot.enabled ? "success" : "default"}
                        >
                          {robot.enabled ? "启用" : "停用"}
                        </OpsStatusPill>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="flat"
                            onPress={() => selectBot(robot)}
                          >
                            编辑配置
                          </Button>
                          <Button
                            size="sm"
                            variant="flat"
                            onPress={() => {
                              selectBot(robot);
                              setReply(null);
                              setQuestion(
                                robot.config.botType === "sales"
                                  ? "这个方案多少钱？能不能今天先给我报价？"
                                  : "我不太懂怎么选，能先帮我判断适不适合吗？",
                              );
                            }}
                          >
                            回复预览
                          </Button>
                          <Button
                            size="sm"
                            variant="flat"
                            onPress={() => void toggleBot(robot)}
                          >
                            {robot.enabled ? "停用" : "启用"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </OpsDenseTable>
          </OpsPanel>

          <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-3">
              {guideStep === 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    {
                      key: "sales" as const,
                      title: "销售型机器人",
                      detail: "主动识别意向、引导留资、关键问题转人工。",
                    },
                    {
                      key: "advisor" as const,
                      title: "顾问型机器人",
                      detail: "先解释方案和边界，再把高意向客户交给人工。",
                    },
                  ].map((item) => (
                    <button
                      key={item.key}
                      className={`rounded-[8px] border px-3 py-3 text-left transition ${
                        form.botType === item.key
                          ? "border-[#f759ab] bg-[#fff0f6] dark:bg-[#f759ab]/15"
                          : "border-divider bg-default-50 hover:border-[#f759ab]"
                      }`}
                      type="button"
                      onClick={() => updateForm("botType", item.key)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-semibold text-foreground">
                          {item.title}
                        </span>
                        {form.botType === item.key ? (
                          <OpsStatusPill tone="brand">当前</OpsStatusPill>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-default-500">
                        {item.detail}
                      </p>
                    </button>
                  ))}
                </div>
              ) : null}

              <OpsPanel
                title={isCreatingBot ? "引导创建配置 · 未保存草稿" : "引导创建配置"}
              >
                <div className="mb-4 grid gap-2 md:grid-cols-6">
                  {CUSTOMER_SERVICE_GUIDE_STEPS.map((step, index) => (
                    <button
                      key={step}
                      aria-current={guideStep === index ? "step" : undefined}
                      type="button"
                      className={`h-8 rounded-[6px] border px-2 text-center text-[12px] leading-8 ${
                        index <= guideStep
                          ? "border-[#f759ab] bg-[#fff0f6] text-[#d9368b] dark:bg-[#f759ab]/15 dark:text-[#ff9aca]"
                          : "border-divider bg-background text-default-500"
                      }`}
                      onClick={() => setGuideStep(index)}
                    >
                      {step}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3">
                  {guideStep === 0 ? (
                    <OpsFormRow label="配置名称">
                      <Input
                        aria-label="配置名称"
                        size="sm"
                        value={form.botName}
                        onValueChange={(value) => updateForm("botName", value)}
                      />
                    </OpsFormRow>
                  ) : null}

                  {guideStep === 1 ? (
                    <>
                      <OpsFormRow label="行业/业务">
                        <Input
                          aria-label="行业或业务"
                          size="sm"
                          value={form.industryName}
                          onValueChange={(value) =>
                            updateForm("industryName", value)
                          }
                        />
                      </OpsFormRow>
                      <OpsFormRow label="回复语气">
                        <Select
                          aria-label="回复语气"
                          selectedKeys={[form.tone]}
                          size="sm"
                          onSelectionChange={(keys) =>
                            updateForm(
                              "tone",
                              String(
                                Array.from(keys)[0] || "warm",
                              ) as InteractionReplyRuleConfig["tone"],
                            )
                          }
                        >
                          <SelectItem key="warm">温和亲切</SelectItem>
                          <SelectItem key="professional">专业稳重</SelectItem>
                          <SelectItem key="concise">简洁直接</SelectItem>
                        </Select>
                      </OpsFormRow>
                    </>
                  ) : null}

                  {guideStep === 2 ? (
                    <>
                      <OpsFormRow label="发送策略">
                        <Select
                          aria-label="发送策略"
                          selectedKeys={[form.defaultSendMode]}
                          size="sm"
                          onSelectionChange={(keys) =>
                            updateForm(
                              "defaultSendMode",
                              String(
                                Array.from(keys)[0] || "auto-send",
                              ) as InteractionReplyRuleConfig["defaultSendMode"],
                            )
                          }
                        >
                          <SelectItem key="auto-send">
                            低风险自动发送
                          </SelectItem>
                          <SelectItem key="approval-send">
                            发送前确认
                          </SelectItem>
                          <SelectItem key="draft-only">只生成草稿</SelectItem>
                        </Select>
                      </OpsFormRow>
                      <OpsFormRow label="授权账号">
                        <Textarea
                          aria-label="授权账号"
                          minRows={2}
                          size="sm"
                          value={form.authorizedAccounts}
                          onValueChange={(value) =>
                            updateForm("authorizedAccounts", value)
                          }
                        />
                      </OpsFormRow>
                      <OpsFormRow label="延时回复">
                        <Input
                          aria-label="延时回复"
                          placeholder="例如：20-45 秒"
                          size="sm"
                          value={form.replyDelay}
                          onValueChange={(value) =>
                            updateForm("replyDelay", value)
                          }
                        />
                      </OpsFormRow>
                    </>
                  ) : null}

                  {guideStep === 3 ? (
                    <>
                      <OpsFormRow label="自动备注">
                        <Switch
                          aria-label="自动备注"
                          isSelected={form.askForContact}
                          size="sm"
                          onValueChange={(value) =>
                            updateForm("askForContact", value)
                          }
                        >
                          主动引导留资
                        </Switch>
                      </OpsFormRow>
                      <OpsFormRow label="白名单">
                        <Textarea
                          aria-label="白名单"
                          minRows={2}
                          size="sm"
                          value={form.whitelist}
                          onValueChange={(value) =>
                            updateForm("whitelist", value)
                          }
                        />
                      </OpsFormRow>
                      <OpsFormRow label="发送文件">
                        <Textarea
                          aria-label="发送文件"
                          minRows={2}
                          size="sm"
                          value={form.fileRequestPolicy}
                          onValueChange={(value) =>
                            updateForm("fileRequestPolicy", value)
                          }
                        />
                      </OpsFormRow>
                      <OpsFormRow label="服务亮点">
                        <Textarea
                          aria-label="服务亮点"
                          minRows={2}
                          size="sm"
                          value={form.serviceHighlights}
                          onValueChange={(value) =>
                            updateForm("serviceHighlights", value)
                          }
                        />
                      </OpsFormRow>
                      <OpsFormRow label="兜底回复">
                        <Textarea
                          aria-label="兜底回复"
                          minRows={2}
                          size="sm"
                          value={form.fallbackReplies}
                          onValueChange={(value) =>
                            updateForm("fallbackReplies", value)
                          }
                        />
                      </OpsFormRow>
                      <OpsFormRow label="收尾话术">
                        <Input
                          aria-label="收尾话术"
                          size="sm"
                          value={form.closingText}
                          onValueChange={(value) =>
                            updateForm("closingText", value)
                          }
                        />
                      </OpsFormRow>
                    </>
                  ) : null}

                  {guideStep === 4 ? (
                    <>
                      <OpsFormRow label="AI不回复">
                        <Textarea
                          aria-label="AI不回复"
                          minRows={2}
                          size="sm"
                          value={form.noReplyScenarios}
                          onValueChange={(value) =>
                            updateForm("noReplyScenarios", value)
                          }
                        />
                      </OpsFormRow>
                      <div className="grid gap-3 md:grid-cols-2">
                        <OpsFormRow label="确认关键词">
                          <Textarea
                            aria-label="确认关键词"
                            minRows={3}
                            size="sm"
                            value={form.requireApprovalKeywords}
                            onValueChange={(value) =>
                              updateForm("requireApprovalKeywords", value)
                            }
                          />
                        </OpsFormRow>
                        <OpsFormRow label="禁止表达">
                          <Textarea
                            aria-label="禁止表达"
                            minRows={3}
                            size="sm"
                            value={form.blockedKeywords}
                            onValueChange={(value) =>
                              updateForm("blockedKeywords", value)
                            }
                          />
                        </OpsFormRow>
                      </div>
                    </>
                  ) : null}

                  {guideStep === 5 ? (
                    <div className="grid gap-2 text-[13px] text-default-600">
                      <div>机器人：{form.botName || "未命名"}</div>
                      <div>行业：{form.industryName || "未设置"}</div>
                      <div>
                        账号：
                        {splitConfigLines(form.authorizedAccounts).join("、") ||
                          "未设置"}
                      </div>
                      <div>
                        发送：
                        {form.defaultSendMode === "auto-send"
                          ? "自动发送"
                          : form.defaultSendMode === "approval-send"
                            ? "发送前确认"
                            : "生成草稿"}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between gap-2 border-t border-divider pt-3">
                    <div className="flex items-center gap-2">
                      <Button
                        isDisabled={guideStep === 0}
                        size="sm"
                        variant="flat"
                        onPress={() =>
                          setGuideStep((current) => Math.max(0, current - 1))
                        }
                      >
                        上一步
                      </Button>
                      {isCreatingBot ? (
                        <Button
                          size="sm"
                          variant="light"
                          onPress={cancelBotDraft}
                        >
                          取消新建
                        </Button>
                      ) : null}
                    </div>
                    {guideStep < CUSTOMER_SERVICE_GUIDE_STEPS.length - 1 ? (
                      <Button
                        color="primary"
                        size="sm"
                        onPress={() =>
                          setGuideStep((current) =>
                            Math.min(
                              CUSTOMER_SERVICE_GUIDE_STEPS.length - 1,
                              current + 1,
                            ),
                          )
                        }
                      >
                        下一步
                      </Button>
                    ) : (
                      <Button
                        color="primary"
                        isLoading={saving}
                        size="sm"
                        onPress={saveConfig}
                      >
                        保存配置
                      </Button>
                    )}
                  </div>
                </div>
              </OpsPanel>
            </div>

            <div className="grid gap-3">
              <OpsPanel
                extra={
                  <Button
                    isLoading={loading}
                    size="sm"
                    startContent={<Icon icon="solar:refresh-linear" />}
                    variant="flat"
                    onPress={() => void load()}
                  >
                    刷新
                  </Button>
                }
                title="知识库/联系人关联"
              >
                <div className="grid gap-3">
                  <Select
                    label="联系人范围"
                    selectedKeys={[form.contactScope]}
                    size="sm"
                    onSelectionChange={(keys) =>
                      updateForm(
                        "contactScope",
                        String(
                          Array.from(keys)[0] || "all",
                        ) as CustomerServiceForm["contactScope"],
                      )
                    }
                  >
                    <SelectItem key="all">全部客户来源</SelectItem>
                    <SelectItem key="wechat">微信联系人</SelectItem>
                    <SelectItem key="douyin">抖音/视频号客户</SelectItem>
                  </Select>
                  <Select
                    label="知识范围"
                    selectedKeys={[form.knowledgeScope]}
                    size="sm"
                    onSelectionChange={(keys) =>
                      updateForm(
                        "knowledgeScope",
                        String(
                          Array.from(keys)[0] || "local",
                        ) as CustomerServiceForm["knowledgeScope"],
                      )
                    }
                  >
                    <SelectItem key="local">本地知识库</SelectItem>
                    <SelectItem key="selected">指定知识资料</SelectItem>
                    <SelectItem key="none">暂不引用</SelectItem>
                  </Select>
                  {form.knowledgeScope === "selected" ? (
                    <Select
                      label="指定知识资料"
                      placeholder="选择一条知识资料"
                      selectedKeys={
                        form.selectedKnowledgeId
                          ? [form.selectedKnowledgeId]
                          : []
                      }
                      size="sm"
                      onSelectionChange={(keys) =>
                        updateForm(
                          "selectedKnowledgeId",
                          String(Array.from(keys)[0] || ""),
                        )
                      }
                    >
                      {knowledgeItems.map((item) => (
                        <SelectItem key={item.id}>
                          {item.title || item.fileName || item.id}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : null}
                  <div className="rounded-[6px] border border-divider bg-default-50 p-3 text-[12px] leading-5 text-default-600">
                    {selectedKnowledge
                      ? `已关联：${selectedKnowledge.title || selectedKnowledge.fileName}`
                      : form.knowledgeScope === "none"
                        ? "当前测试不会引用知识资料。"
                        : "当前测试会按本地知识库范围生成候选回复。"}
                  </div>
                </div>
              </OpsPanel>

              <OpsPanel title="规则测试">
                <div className="grid gap-3">
                  <OpsDenseTable>
                    <table>
                      <thead>
                        <tr>
                          <th>检查项</th>
                          <th>当前值</th>
                          <th>结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>发送策略</td>
                          <td>
                            {(reply?.decision.sendMode || form.defaultSendMode) ===
                            "auto-send"
                              ? "自动发送"
                              : (reply?.decision.sendMode ||
                                    form.defaultSendMode) === "approval-send"
                                ? "发送前确认"
                                : "生成草稿"}
                          </td>
                          <td>{ruleRisk.label}</td>
                        </tr>
                        <tr>
                          <td>账号与来源</td>
                          <td>{accountName || "未设置"}</td>
                          <td>
                            {!reply
                              ? "等待测试"
                              : reply.decision.contact.accountBound &&
                                  reply.decision.contact.scopeMatched
                                ? "符合范围"
                                : "不符合范围"}
                          </td>
                        </tr>
                        <tr>
                          <td>联系人白名单</td>
                          <td>
                            {splitConfigLines(contactLabels).join("、") ||
                              "未填写标签"}
                          </td>
                          <td>
                            {!reply
                              ? "等待测试"
                              : reply.decision.contact.whitelisted
                                ? "已命中"
                                : "需确认"}
                          </td>
                        </tr>
                        <tr>
                          <td>知识范围</td>
                          <td>
                            {reply?.decision.knowledge.selectedKnowledgeTitle ||
                              (form.knowledgeScope === "none"
                                ? "不引用"
                                : form.knowledgeScope === "selected"
                                  ? "指定资料"
                                  : "本地知识库")}
                          </td>
                          <td>
                            {!reply
                              ? "等待测试"
                              : reply.decision.knowledge.available
                                ? "可用"
                                : "不可用"}
                          </td>
                        </tr>
                        <tr>
                          <td>回复延时</td>
                          <td>{form.replyDelay || "立即"}</td>
                          <td>
                            {reply
                              ? `${reply.decision.delay.selectedSeconds} 秒`
                              : "等待测试"}
                          </td>
                        </tr>
                        <tr>
                          <td>不回复与文件规则</td>
                          <td>
                            不回复 {splitConfigLines(form.noReplyScenarios).length} 条
                          </td>
                          <td>
                            {!reply
                              ? "等待测试"
                              : reply.decision.action === "no-reply"
                                ? "不自动回复"
                                : reply.decision.fileRequest
                                  ? "按文件规则处理"
                                  : "未命中"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </OpsDenseTable>
                  <div className="rounded-[6px] border border-divider bg-default-50 p-3 text-[12px] leading-5 text-default-600">
                    当前问题检查结果：{ruleRisk.detail}
                  </div>
                </div>
              </OpsPanel>

              <OpsPanel title="回复预览">
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="客户名称"
                      size="sm"
                      value={targetName}
                      onValueChange={setTargetName}
                    />
                    <Input
                      label="联系人标签"
                      placeholder="例如：老客户、高意向客户"
                      size="sm"
                      value={contactLabels}
                      onValueChange={setContactLabels}
                    />
                    <Input
                      label="承接账号"
                      size="sm"
                      value={accountName}
                      onValueChange={setAccountName}
                    />
                    <Select
                      label="已登录账号"
                      placeholder="抖音发送请选择已登录账号"
                      selectedKeys={accountId ? [accountId] : []}
                      size="sm"
                      onSelectionChange={(keys) => {
                        const id = String(Array.from(keys)[0] || "");
                        const account = availableAccounts.find(
                          (item) => String(item.id) === id,
                        );
                        setAccountId(id);
                        if (account) {
                          setAccountName(account.displayName || accountName);
                          if (/微信|wechat/i.test(account.platform)) {
                            setDeliveryPlatform("wechat");
                          } else if (
                            /抖音|douyin|tiktok/i.test(account.platform)
                          ) {
                            setDeliveryPlatform("douyin");
                          }
                        }
                      }}
                    >
                      {availableAccounts.map((account) => (
                        <SelectItem key={String(account.id)}>
                          {account.displayName || account.platform}
                        </SelectItem>
                      ))}
                    </Select>
                    <Select
                      label="回复平台"
                      selectedKeys={[deliveryPlatform]}
                      size="sm"
                      onSelectionChange={(keys) =>
                        setDeliveryPlatform(
                          String(
                            Array.from(keys)[0] || "douyin",
                          ) as CustomerServicePlatform,
                        )
                      }
                    >
                      <SelectItem key="douyin">抖音</SelectItem>
                      <SelectItem key="wechat">微信</SelectItem>
                    </Select>
                  </div>
                  <Textarea
                    label="客户问题"
                    minRows={3}
                    size="sm"
                    value={question}
                    onValueChange={setQuestion}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      color="primary"
                      isLoading={generating}
                      startContent={
                        generating ? null : (
                          <Icon icon="solar:magic-stick-3-linear" />
                        )
                      }
                      variant="flat"
                      onPress={generateReply}
                    >
                      模拟问答
                    </Button>
                    <Button
                      isDisabled={!reply || !reply.decision.canCreateTask}
                      isLoading={confirming}
                      startContent={
                        confirming ? null : (
                          <Icon icon="solar:send-square-linear" />
                        )
                      }
                      variant="flat"
                      onPress={createCustomerServiceTask}
                    >
                      {reply?.decision.action === "reply"
                        ? "创建发送任务"
                        : reply?.decision.action === "no-reply"
                          ? "按规则不发送"
                          : "进入发送前确认"}
                    </Button>
                    <Button
                      startContent={
                        <Icon icon="solar:trash-bin-minimalistic-linear" />
                      }
                      variant="flat"
                      onPress={clearSimulation}
                    >
                      清空会话
                    </Button>
                  </div>
                  {reply ? (
                    <div className="grid gap-2 rounded-[6px] border border-divider bg-default-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={
                            reply.decision.action === "no-reply"
                              ? "default"
                              : reply.generatedBy === "ai"
                                ? "success"
                                : "warning"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {reply.decision.action === "no-reply"
                            ? "未生成回复"
                            : reply.generatedBy === "ai"
                              ? "AI生成"
                              : "规则兜底"}
                        </Chip>
                        {risk ? (
                          <Chip color={risk.color} size="sm" variant="flat">
                            {risk.label}
                          </Chip>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-6 text-default-700">
                        {reply.replyText || "当前规则要求转人工，不生成自动回复。"}
                      </p>
                      {risk ? (
                        <p className="text-[12px] text-default-500">
                          {risk.detail}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {interactionTask ? (
                    <div className="grid gap-2 rounded-[6px] border border-divider bg-default-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip
                            color={interactionTaskStatusTone(
                              interactionTask.status,
                            )}
                            size="sm"
                            variant="flat"
                          >
                            {interactionTask.statusLabel ||
                              interactionTask.status}
                          </Chip>
                          <span className="text-[12px] font-medium text-default-700">
                            正式客服任务
                          </span>
                        </div>
                        <span className="text-[11px] text-default-400">
                          {interactionTask.id}
                        </span>
                      </div>
                      <p className="text-[12px] leading-5 text-default-600">
                        {interactionTask.failureReason ||
                          interactionTask.nextAction ||
                          "任务状态会在执行记录中持续更新。"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          as={Link}
                          href="/tasks/confirmations"
                          size="sm"
                          variant="flat"
                        >
                          去待我确认
                        </Button>
                        <Button
                          as={Link}
                          href={`/interaction/records?taskId=${encodeURIComponent(interactionTask.id)}`}
                          size="sm"
                          variant="flat"
                        >
                          查看任务记录
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </OpsPanel>

              <div className="rounded-[8px] bg-[#111827] p-4 text-white shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold">提示词预览</p>
                  <OpsStatusPill tone="brand">实时生成</OpsStatusPill>
                </div>
                <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-[#d1d5db]">
                  {buildPromptPreview(form)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </OpsPanel>
    </>
  );
}
