/**
 * customer service（回复）方法簇 mixin。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式：
 * - 本文件只声明 CustomerServiceHost 接口（不 import service，避免 madge 环）
 * - 方法统一 this: CustomerServiceHost，互调保留 this.x()
 * - service 底部 Object.assign(LocalEngineService.prototype, customerServiceMethods) 挂载
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type InteractionReplyRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';

import {
  createId,
  extractReplySubject,
  normalizeEditableStringList,
  normalizeStringList,
  optionalTrimmedText,
  resolveSafeReplyClosing,
} from './local-engine.utils';
import { normalizeAiInteractionReply } from './local-engine.wechat-command.utils';
import type {
  CreateCustomerServiceReplyTaskInput,
  CreateInteractionTaskInput,
  CustomerServiceKnowledgeContext,
  CustomerServiceReplyBot,
  CustomerServiceReplyDecision,
  CustomerServiceReplyPlatform,
  InteractionReplyGeneratedBy,
  InteractionReplyRuleConfig,
  InteractionSendMode,
  InteractionTask,
  InteractionTaskType,
  LocalEngineTenantScope,
  UpdateInteractionReplyRuleInput,
} from './local-engine.types';

/** customer service 簇的 host 接口 */
export interface CustomerServiceHost {
  aiClient: AiClientService;
  defaultModels: DefaultModelsService;
  prisma: PrismaService;
  replyRule: InteractionReplyRuleConfig;
  replyRules: Map<string, InteractionReplyRuleConfig>;
  getReplyRule(): Promise<InteractionReplyRuleConfig>;
  listReplyBots(): Promise<CustomerServiceReplyBot[]>;
  getReplyBot(id: string): Promise<CustomerServiceReplyBot>;
  createReplyBot(
    input?: UpdateInteractionReplyRuleInput,
  ): Promise<CustomerServiceReplyBot>;
  updateReplyBot(
    id: string,
    input: UpdateInteractionReplyRuleInput,
  ): Promise<CustomerServiceReplyBot>;
  setReplyBotEnabled(
    id: string,
    enabled: boolean,
    expectedRevision?: number,
  ): Promise<CustomerServiceReplyBot>;
  createCustomerServiceReplyTask(
    botId: string,
    input: CreateCustomerServiceReplyTaskInput,
  ): Promise<InteractionTask>;
  updateReplyRule(
    input: UpdateInteractionReplyRuleInput,
  ): Promise<InteractionReplyRuleConfig>;
  generateInteractionReply(input: {
    sourceText?: string;
    targetName?: string;
    accountName?: string;
    botId?: string;
    platform?: CustomerServiceReplyPlatform;
    contactLabels?: string[];
  }): Promise<{
    replyText: string;
    generatedBy: 'ai' | 'fallback';
    rule: InteractionReplyRuleConfig;
    decision: CustomerServiceReplyDecision;
  }>;
  createDefaultReplyRule(): InteractionReplyRuleConfig;
  toCustomerServiceReplyBot(row: InteractionReplyRule): CustomerServiceReplyBot;
  normalizeCustomerServiceRule(
    input: UpdateInteractionReplyRuleInput,
    base: InteractionReplyRuleConfig,
  ): InteractionReplyRuleConfig;
  resolveCustomerServiceKnowledge(
    rule: InteractionReplyRuleConfig,
  ): Promise<CustomerServiceKnowledgeContext>;
  evaluateCustomerServiceReplyDecision(
    rule: InteractionReplyRuleConfig,
    input: {
      sourceText: string;
      replyText?: string;
      targetName?: string;
      accountName?: string;
      platform?: CustomerServiceReplyPlatform;
      contactLabels?: string[];
      requestedSendMode?: InteractionSendMode;
      commercialExecutionAllowed: boolean;
      knowledge: CustomerServiceKnowledgeContext;
      now?: Date;
    },
  ): CustomerServiceReplyDecision;
  matchCustomerServiceTerms(
    values: string[] | undefined,
    text: string,
  ): string[];
  parseCustomerServiceReplyDelay(
    value: unknown,
    now: Date,
  ): {
    minSeconds: number;
    maxSeconds: number;
    selectedSeconds: number;
  };
  resolveCustomerServicePlatform(
    rule: InteractionReplyRuleConfig,
    requested: CustomerServiceReplyPlatform | undefined,
    accountName: string,
  ): CustomerServiceReplyPlatform;
  resolveCustomerServiceSendMode(
    rule: InteractionReplyRuleConfig,
    requested: InteractionSendMode | undefined,
    sourceText: string,
    replyText: string,
    commercialExecutionAllowed: boolean,
  ): InteractionSendMode;
  buildReplyFromRule(
    sourceText: string,
    context?: { targetName?: string; accountName?: string },
    replyRule?: InteractionReplyRuleConfig,
  ): string;
  tryGenerateInteractionReplyWithAi(
    sourceText: string,
    context: {
      targetName?: string;
      accountName?: string;
      fallbackReply: string;
    },
    replyRule?: InteractionReplyRuleConfig,
    knowledge?: CustomerServiceKnowledgeContext,
  ): Promise<string>;
  pickConfiguredFallbackReply(
    sourceText: string,
    rule?: InteractionReplyRuleConfig,
  ): string;
  normalizeReplyGeneratedBy(
    value: unknown,
  ): InteractionReplyGeneratedBy | undefined;
  allowLocalPlanBypass(): boolean;
  currentActorCommercialAllowed(): boolean;
  createTask(input: CreateInteractionTaskInput): Promise<InteractionTask>;
  ensureTaskStore(): Promise<void>;
  isRuleTone(value: unknown): value is InteractionReplyRuleConfig['tone'];
  isSendMode(value: unknown): value is InteractionSendMode;
  loadReplyRuleFromStore(
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionReplyRuleConfig>;
  normalizeRuleNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number;
  persistReplyRule(
    rule: InteractionReplyRuleConfig,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<void>;
  resolveCustomerReplyReviewReason(
    sourceText?: string | null,
  ): string | undefined;
  resolveTenantScope(): Promise<LocalEngineTenantScope>;
  runPrismaTransientRetry<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T>;
  tenantScopeKey(scope: LocalEngineTenantScope): string;
}

export async function getReplyRule(
  this: CustomerServiceHost,
): Promise<InteractionReplyRuleConfig> {
  await this.ensureTaskStore();
  return this.loadReplyRuleFromStore();
}

export async function listReplyBots(
  this: CustomerServiceHost,
): Promise<CustomerServiceReplyBot[]> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  await this.loadReplyRuleFromStore(scope);

  const rows = await this.runPrismaTransientRetry(
    'list customer service bots',
    () =>
      this.prisma.interactionReplyRule.findMany({
        where: scope,
        orderBy: { updatedAt: 'desc' },
      }),
  );
  return rows.map((row) => this.toCustomerServiceReplyBot(row));
}

export async function getReplyBot(
  this: CustomerServiceHost,
  id: string,
): Promise<CustomerServiceReplyBot> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  const safeId = optionalTrimmedText(id);
  if (!safeId) {
    throw new BadRequestException('请选择客服机器人。');
  }
  if (safeId === 'default') {
    await this.loadReplyRuleFromStore(scope);
  }
  let row = await this.prisma.interactionReplyRule.findFirst({
    where: {
      ...scope,
      ...(safeId === 'default' ? { botKey: 'default' } : { id: safeId }),
    },
  });
  if (!row && safeId === 'default') {
    await this.persistReplyRule(this.createDefaultReplyRule(), scope);
    row = await this.prisma.interactionReplyRule.findFirst({
      where: { ...scope, botKey: 'default' },
    });
  }
  if (!row) {
    throw new NotFoundException('客服机器人不存在或已被删除。');
  }
  return this.toCustomerServiceReplyBot(row);
}

export async function createReplyBot(
  this: CustomerServiceHost,
  input: UpdateInteractionReplyRuleInput = {},
): Promise<CustomerServiceReplyBot> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  const base = this.createDefaultReplyRule();
  const config = this.normalizeCustomerServiceRule(input, base);
  config.configVersion = 1;
  config.revision = 1;
  config.botName =
    optionalTrimmedText(input.botName) ||
    (config.botType === 'advisor' ? '顾问型客服机器人' : '销售顾问机器人');
  const id = createId();
  const now = new Date();
  const row = await this.prisma.interactionReplyRule.create({
    data: {
      id,
      ...scope,
      botKey: id,
      configVersion: config.configVersion,
      revision: config.revision,
      name: config.botName,
      industry: config.industryName,
      tone: config.tone,
      sendMode: config.defaultSendMode,
      keywords: config.requireApprovalKeywords,
      forbiddenWords: config.blockedKeywords,
      highlights: config.serviceHighlights,
      closingText: config.closingText,
      ruleJson: config as unknown as Prisma.InputJsonValue,
      escalationRules: config as unknown as Prisma.InputJsonValue,
      enabled: true,
      updatedAt: now,
    },
  });
  return this.toCustomerServiceReplyBot(row);
}

export async function updateReplyBot(
  this: CustomerServiceHost,
  id: string,
  input: UpdateInteractionReplyRuleInput,
): Promise<CustomerServiceReplyBot> {
  const scope = await this.resolveTenantScope();
  const current = await this.getReplyBot(id);
  if (
    input.expectedRevision !== undefined &&
    (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)
  ) {
    throw new BadRequestException('机器人修订号必须是正整数。');
  }
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== current.revision
  ) {
    throw new ConflictException('机器人配置已更新，请刷新后重试。');
  }
  const config = this.normalizeCustomerServiceRule(input, current.config);
  config.configVersion = current.configVersion;
  config.revision = current.revision + 1;
  const updated = await this.prisma.interactionReplyRule.updateMany({
    where: { id: current.id, ...scope, revision: current.revision },
    data: {
      name: config.botName || current.name,
      industry: config.industryName,
      tone: config.tone,
      sendMode: config.defaultSendMode,
      keywords: config.requireApprovalKeywords,
      forbiddenWords: config.blockedKeywords,
      highlights: config.serviceHighlights,
      closingText: config.closingText,
      ruleJson: config as unknown as Prisma.InputJsonValue,
      escalationRules: config as unknown as Prisma.InputJsonValue,
      configVersion: config.configVersion,
      revision: config.revision,
    },
  });
  if (updated.count !== 1) {
    throw new ConflictException('机器人配置已更新，请刷新后重试。');
  }
  const row = await this.prisma.interactionReplyRule.findFirst({
    where: { id: current.id, ...scope },
  });
  if (!row) {
    throw new NotFoundException('客服机器人不存在或已被删除。');
  }
  if (row.botKey === 'default') {
    this.replyRules.set(this.tenantScopeKey(scope), config);
  }
  return this.toCustomerServiceReplyBot(row);
}

export async function setReplyBotEnabled(
  this: CustomerServiceHost,
  id: string,
  enabled: boolean,
  expectedRevision?: number,
): Promise<CustomerServiceReplyBot> {
  const scope = await this.resolveTenantScope();
  const current = await this.getReplyBot(id);
  if (
    expectedRevision !== undefined &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw new BadRequestException('机器人修订号必须是正整数。');
  }
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    throw new ConflictException('机器人配置已更新，请刷新后重试。');
  }
  const revision = current.revision + 1;
  const config = {
    ...current.config,
    revision,
    updatedAt: new Date().toISOString(),
  };
  const updated = await this.prisma.interactionReplyRule.updateMany({
    where: { id: current.id, ...scope, revision: current.revision },
    data: {
      enabled,
      revision,
      ruleJson: config as unknown as Prisma.InputJsonValue,
      escalationRules: config as unknown as Prisma.InputJsonValue,
    },
  });
  if (updated.count !== 1) {
    throw new ConflictException('机器人配置已更新，请刷新后重试。');
  }
  const row = await this.prisma.interactionReplyRule.findFirst({
    where: { id: current.id, ...scope },
  });
  if (!row) {
    throw new NotFoundException('客服机器人不存在或已被删除。');
  }
  if (row.botKey === 'default') {
    this.replyRules.set(this.tenantScopeKey(scope), config);
  }
  return this.toCustomerServiceReplyBot(row);
}

export async function createCustomerServiceReplyTask(
  this: CustomerServiceHost,
  botId: string,
  input: CreateCustomerServiceReplyTaskInput,
): Promise<InteractionTask> {
  const bot = await this.getReplyBot(botId);
  const callerCommercialAllowed = this.currentActorCommercialAllowed();
  if (!bot.enabled) {
    throw new BadRequestException('该机器人已停用，请启用后再创建回复任务。');
  }
  const accountName = optionalTrimmedText(input.accountName);
  if (!accountName) {
    throw new BadRequestException('请选择承接账号。');
  }
  const authorizedAccounts = normalizeStringList(
    bot.config.authorizedAccounts,
    [],
  );
  if (
    authorizedAccounts.length > 0 &&
    !authorizedAccounts.some(
      (account) =>
        account.trim().toLocaleLowerCase() === accountName.toLocaleLowerCase(),
    )
  ) {
    throw new BadRequestException(
      '该账号未绑定到当前机器人，请先在机器人配置中添加。',
    );
  }

  const platform = this.resolveCustomerServicePlatform(
    bot.config,
    input.platform,
    accountName,
  );
  const sourceText = optionalTrimmedText(input.sourceText);
  if (!sourceText) {
    throw new BadRequestException('请输入客户问题后再创建回复任务。');
  }
  const replyText =
    optionalTrimmedText(input.replyText) ||
    this.buildReplyFromRule(sourceText, { accountName }, bot.config);
  const knowledge = await this.resolveCustomerServiceKnowledge(bot.config);
  const decision = this.evaluateCustomerServiceReplyDecision(bot.config, {
    sourceText,
    replyText,
    targetName: input.targetName,
    accountName,
    platform,
    contactLabels: input.contactLabels,
    requestedSendMode: input.sendMode,
    commercialExecutionAllowed:
      callerCommercialAllowed || this.allowLocalPlanBypass(),
    knowledge,
  });
  const sendMode = decision.sendMode;
  const type: InteractionTaskType =
    platform === 'wechat'
      ? 'wechat-reply-draft'
      : 'douyin-direct-message-reply';
  return this.createTask({
    type,
    replyBotId: bot.id,
    accountId: input.accountId,
    accountName,
    platformName: platform === 'wechat' ? '微信' : '抖音',
    targetName: optionalTrimmedText(input.targetName) || '未命名客户',
    sourceText,
    replyText:
      decision.action === 'no-reply'
        ? '按当前客服规则转人工处理，不自动回复。'
        : replyText,
    replyGeneratedBy: input.replyGeneratedBy,
    sendMode,
    planStatus: decision.action === 'no-reply' ? 'draft' : undefined,
    commercialExecutionRequested:
      decision.action !== 'no-reply' &&
      input.commercialExecutionRequested !== false,
    callerCommercialAllowed,
    metadata: {
      customerServiceBotId: bot.id,
      customerServiceBotName: bot.name,
      customerServicePlatform: platform,
      knowledgeScope: bot.config.knowledgeScope,
      selectedKnowledgeId: bot.config.selectedKnowledgeId,
      contactScope: bot.config.contactScope,
      contactLabels: input.contactLabels || [],
      customerServiceDecision: decision,
      customerServiceDelaySeconds: decision.delay.selectedSeconds,
      customerServiceNotBefore: decision.delay.notBefore,
      customerServiceNoReply: decision.action === 'no-reply',
      customerServiceFileRequest: decision.fileRequest,
    },
  });
}

export async function updateReplyRule(
  this: CustomerServiceHost,
  input: UpdateInteractionReplyRuleInput,
): Promise<InteractionReplyRuleConfig> {
  return (await this.updateReplyBot('default', input)).config;
}

export async function generateInteractionReply(
  this: CustomerServiceHost,
  input: {
    sourceText?: string;
    targetName?: string;
    accountName?: string;
    botId?: string;
    platform?: CustomerServiceReplyPlatform;
    contactLabels?: string[];
  },
): Promise<{
  replyText: string;
  generatedBy: 'ai' | 'fallback';
  rule: InteractionReplyRuleConfig;
  decision: CustomerServiceReplyDecision;
}> {
  await this.ensureTaskStore();
  const defaultRule = await this.loadReplyRuleFromStore();

  const sourceText = input.sourceText?.trim();
  if (!sourceText) {
    throw new BadRequestException(
      '缺少客户原话或待跟进内容，不能生成商用回复。',
    );
  }

  const bot = input.botId ? await this.getReplyBot(input.botId) : undefined;
  if (bot && !bot.enabled) {
    throw new BadRequestException('该机器人已停用，请启用后再生成回复。');
  }
  const rule = bot?.config || defaultRule;
  const knowledge = await this.resolveCustomerServiceKnowledge(rule);
  const decisionInput = {
    sourceText,
    targetName: input.targetName,
    accountName: input.accountName,
    platform: input.platform,
    contactLabels: input.contactLabels,
    commercialExecutionAllowed:
      this.currentActorCommercialAllowed() || this.allowLocalPlanBypass(),
    knowledge,
  };
  const beforeGeneration = this.evaluateCustomerServiceReplyDecision(
    rule,
    decisionInput,
  );
  if (!beforeGeneration.canGenerate) {
    return {
      replyText: '',
      generatedBy: 'fallback',
      rule,
      decision: beforeGeneration,
    };
  }
  const fallbackReply = this.buildReplyFromRule(
    sourceText,
    {
      targetName: input.targetName,
      accountName: input.accountName,
    },
    rule,
  );

  const aiReply = await this.tryGenerateInteractionReplyWithAi(
    sourceText,
    {
      targetName: input.targetName,
      accountName: input.accountName,
      fallbackReply,
    },
    rule,
    knowledge,
  );
  const replyText = aiReply || fallbackReply;
  const decision = this.evaluateCustomerServiceReplyDecision(rule, {
    ...decisionInput,
    replyText,
  });
  if (aiReply) {
    return {
      replyText: decision.action === 'no-reply' ? '' : aiReply,
      generatedBy: 'ai',
      rule,
      decision,
    };
  }

  return {
    replyText: decision.action === 'no-reply' ? '' : fallbackReply,
    generatedBy: 'fallback',
    rule,
    decision,
  };
}

export function createDefaultReplyRule(): InteractionReplyRuleConfig {
  return {
    configVersion: 1,
    revision: 1,
    industryName: '本地生活/电商服务',
    tone: 'warm',
    // 报告 5.6 P1：默认「发送前都确认」，避免首次保存即自动外发
    defaultSendMode: 'approval-send',
    askForContact: true,
    commentParsingMode: 'none',
    commentRulePreset: 'loose',
    commentRequireActionAndTime: false,
    commentAllowShortText: true,
    commentSkipHandled: false,
    commentQuestionOnly: false,
    commentMinLength: 1,
    commentMaxLength: 500,
    commentWhitelistKeywords: [],
    commentExcludeAuthorKeywords: ['作者', '商家', '客服', '施主聒噪 作者'],
    commentNoiseKeywords: [
      '发布作品',
      '作品管理',
      '评论管理',
      '互动管理',
      '数据中心',
      '回复',
      '删除',
      '加载中',
      '暂无',
    ],
    commentPriorityKeywords: [
      '价格',
      '多少',
      '怎么',
      '哪里',
      '联系',
      '电话',
      '微信',
      '私信',
      '预约',
      '吗',
      '呢',
    ],
    fallbackEnabled: true,
    fallbackReplies: [
      '你把具体内容发我，我按实际情况帮你看。',
      '可以，你说下具体款式、订单或时间，我帮你核一下。',
      '这个要看具体情况，你把截图或问题发我，我按实际内容回复你。',
    ],
    allowFallbackAutoSend: true,
    requireApprovalKeywords: [
      '投诉',
      '退款',
      '售后',
      '差评',
      '发票',
      '转账',
      '支付',
      '维权',
    ],
    blockedKeywords: ['保证治好', '最低价', '绝对有效', '返现', '私下转账'],
    serviceHighlights: [
      '按客户具体问题回复',
      '不编造价格和承诺',
      '必要时转人工核实',
    ],
    closingText: '你把具体款式、订单或时间发我，我按实际情况帮你看。',
    botName: '销售顾问机器人',
    botType: 'sales',
    authorizedAccounts: ['抖音门店号', '微信客服号'],
    replyDelay: '20-45 秒',
    whitelist: ['老客户', '高意向客户', '售后客户'],
    noReplyScenarios: ['投诉', '退款', '发票', '私下转账', '平台违规词'],
    fileRequestPolicy: '客户要求文件、合同、报价单时先转人工确认。',
    contactScope: 'all',
    knowledgeScope: 'local',
    selectedKnowledgeId: '',
    updatedAt: new Date().toISOString(),
  };
}

export function toCustomerServiceReplyBot(
  this: CustomerServiceHost,
  row: InteractionReplyRule,
): CustomerServiceReplyBot {
  const configVersion =
    Number.isInteger(row.configVersion) && row.configVersion > 0
      ? row.configVersion
      : 1;
  const revision =
    Number.isInteger(row.revision) && row.revision > 0 ? row.revision : 1;
  const base = {
    ...this.createDefaultReplyRule(),
    configVersion,
    revision,
  };
  const stored =
    (row.ruleJson as UpdateInteractionReplyRuleInput | undefined) ||
    (row.escalationRules as UpdateInteractionReplyRuleInput | undefined) ||
    {};
  const config = this.normalizeCustomerServiceRule(stored, base);
  const name = optionalTrimmedText(row.name) || config.botName || '客服机器人';
  const createdAt = row.createdAt.toISOString();
  const updatedAt = row.updatedAt.toISOString();
  return {
    id: String(row.id),
    name,
    enabled: row.enabled !== false,
    configVersion,
    revision,
    createdAt,
    updatedAt,
    config: {
      ...config,
      botName: name,
      configVersion,
      revision,
      updatedAt,
    },
  };
}

export function normalizeCustomerServiceRule(
  this: CustomerServiceHost,
  input: UpdateInteractionReplyRuleInput,
  base: InteractionReplyRuleConfig,
): InteractionReplyRuleConfig {
  const configInput = { ...input };
  delete configInput.expectedRevision;
  const next = { ...base, ...configInput };
  return {
    ...next,
    configVersion: base.configVersion,
    revision: base.revision,
    botName: optionalTrimmedText(input.botName) || base.botName,
    botType:
      input.botType === 'advisor'
        ? 'advisor'
        : input.botType === 'sales'
          ? 'sales'
          : base.botType,
    authorizedAccounts: normalizeStringList(
      input.authorizedAccounts,
      base.authorizedAccounts || [],
    ),
    replyDelay: optionalTrimmedText(input.replyDelay) || base.replyDelay,
    whitelist: normalizeStringList(input.whitelist, base.whitelist || []),
    noReplyScenarios: normalizeStringList(
      input.noReplyScenarios,
      base.noReplyScenarios || [],
    ),
    fileRequestPolicy:
      optionalTrimmedText(input.fileRequestPolicy) || base.fileRequestPolicy,
    contactScope:
      input.contactScope === 'wechat' ||
      input.contactScope === 'douyin' ||
      input.contactScope === 'all'
        ? input.contactScope
        : base.contactScope,
    knowledgeScope:
      input.knowledgeScope === 'selected' ||
      input.knowledgeScope === 'none' ||
      input.knowledgeScope === 'local'
        ? input.knowledgeScope
        : base.knowledgeScope,
    selectedKnowledgeId:
      input.knowledgeScope === 'none'
        ? ''
        : optionalTrimmedText(input.selectedKnowledgeId) ||
          base.selectedKnowledgeId ||
          '',
    industryName: optionalTrimmedText(input.industryName) || base.industryName,
    tone: this.isRuleTone(input.tone) ? input.tone : base.tone,
    defaultSendMode: this.isSendMode(input.defaultSendMode)
      ? input.defaultSendMode
      : base.defaultSendMode,
    askForContact:
      typeof input.askForContact === 'boolean'
        ? input.askForContact
        : base.askForContact,
    commentParsingMode:
      input.commentParsingMode === 'none' ? 'none' : base.commentParsingMode,
    commentRulePreset:
      input.commentRulePreset === 'loose' ? 'loose' : base.commentRulePreset,
    commentRequireActionAndTime:
      typeof input.commentRequireActionAndTime === 'boolean'
        ? input.commentRequireActionAndTime
        : base.commentRequireActionAndTime,
    commentAllowShortText:
      typeof input.commentAllowShortText === 'boolean'
        ? input.commentAllowShortText
        : base.commentAllowShortText,
    commentSkipHandled:
      typeof input.commentSkipHandled === 'boolean'
        ? input.commentSkipHandled
        : base.commentSkipHandled,
    commentQuestionOnly:
      typeof input.commentQuestionOnly === 'boolean'
        ? input.commentQuestionOnly
        : base.commentQuestionOnly,
    commentMinLength: this.normalizeRuleNumber(
      input.commentMinLength,
      base.commentMinLength,
      1,
      80,
    ),
    commentMaxLength: this.normalizeRuleNumber(
      input.commentMaxLength,
      base.commentMaxLength,
      10,
      500,
    ),
    commentWhitelistKeywords: normalizeEditableStringList(
      input.commentWhitelistKeywords,
      base.commentWhitelistKeywords,
    ),
    commentExcludeAuthorKeywords: normalizeEditableStringList(
      input.commentExcludeAuthorKeywords,
      base.commentExcludeAuthorKeywords,
    ),
    commentNoiseKeywords: normalizeEditableStringList(
      input.commentNoiseKeywords,
      base.commentNoiseKeywords,
    ),
    commentPriorityKeywords: normalizeEditableStringList(
      input.commentPriorityKeywords,
      base.commentPriorityKeywords,
    ),
    fallbackEnabled:
      typeof input.fallbackEnabled === 'boolean'
        ? input.fallbackEnabled
        : base.fallbackEnabled,
    fallbackReplies: normalizeEditableStringList(
      input.fallbackReplies,
      base.fallbackReplies,
    ),
    allowFallbackAutoSend:
      typeof input.allowFallbackAutoSend === 'boolean'
        ? input.allowFallbackAutoSend
        : base.allowFallbackAutoSend,
    requireApprovalKeywords: normalizeStringList(
      input.requireApprovalKeywords,
      base.requireApprovalKeywords,
    ),
    blockedKeywords: normalizeStringList(
      input.blockedKeywords,
      base.blockedKeywords,
    ),
    serviceHighlights: normalizeStringList(
      input.serviceHighlights,
      base.serviceHighlights,
    ),
    closingText: optionalTrimmedText(input.closingText) || base.closingText,
    updatedAt: new Date().toISOString(),
  };
}

export async function resolveCustomerServiceKnowledge(
  this: CustomerServiceHost,
  rule: InteractionReplyRuleConfig,
): Promise<CustomerServiceKnowledgeContext> {
  const scope = rule.knowledgeScope || 'local';
  if (scope === 'none') {
    return { scope, available: true };
  }
  if (scope === 'local') {
    return { scope, available: true };
  }
  const selectedKnowledgeId = optionalTrimmedText(rule.selectedKnowledgeId);
  if (!selectedKnowledgeId) {
    return { scope, available: false };
  }
  const material = await this.prisma.material.findFirst({
    where: { id: selectedKnowledgeId, platform: 'LocalKnowledge' },
    select: { id: true, title: true, content: true, summary: true },
  });
  if (!material) {
    return { scope, selectedKnowledgeId, available: false };
  }
  return {
    scope,
    selectedKnowledgeId: material.id,
    selectedKnowledgeTitle: material.title,
    content: String(material.content || material.summary || '')
      .trim()
      .slice(0, 5000),
    available: true,
  };
}

export function evaluateCustomerServiceReplyDecision(
  this: CustomerServiceHost,
  rule: InteractionReplyRuleConfig,
  input: {
    sourceText: string;
    replyText?: string;
    targetName?: string;
    accountName?: string;
    platform?: CustomerServiceReplyPlatform;
    contactLabels?: string[];
    requestedSendMode?: InteractionSendMode;
    commercialExecutionAllowed: boolean;
    knowledge: CustomerServiceKnowledgeContext;
    now?: Date;
  },
): CustomerServiceReplyDecision {
  const sourceText = optionalTrimmedText(input.sourceText) || '';
  const replyText = optionalTrimmedText(input.replyText) || '';
  const accountName = optionalTrimmedText(input.accountName) || '';
  const targetName = optionalTrimmedText(input.targetName) || '';
  const platform =
    input.platform ||
    (/微信|wechat/i.test(accountName)
      ? 'wechat'
      : /抖音|douyin|字节|tiktok|视频号/i.test(accountName)
        ? 'douyin'
        : undefined);
  const authorizedAccounts = normalizeStringList(rule.authorizedAccounts, []);
  const accountBound =
    authorizedAccounts.length === 0 ||
    authorizedAccounts.some(
      (account) => account.toLowerCase() === accountName.toLowerCase(),
    );
  const scopeMatched =
    rule.contactScope === 'all' ||
    !rule.contactScope ||
    rule.contactScope === platform;
  const contactText = [
    targetName,
    ...normalizeStringList(input.contactLabels, []),
  ]
    .join('\n')
    .toLowerCase();
  const whitelist = normalizeStringList(rule.whitelist, []);
  const whitelistHits = whitelist.filter((item) =>
    contactText.includes(item.toLowerCase()),
  );
  const whitelisted = whitelist.length === 0 || whitelistHits.length > 0;
  const content = `${sourceText}\n${replyText}`;
  const noReplyHits = this.matchCustomerServiceTerms(
    rule.noReplyScenarios,
    sourceText,
  );
  const approvalHits = this.matchCustomerServiceTerms(
    rule.requireApprovalKeywords,
    content,
  );
  const blockedHits = this.matchCustomerServiceTerms(
    rule.blockedKeywords,
    content,
  );
  const fileRequest =
    /(文件|附件|合同|报价单|价目表|资料|方案|pdf|word|excel|表格|文档).{0,12}(发|发送|给|要|下载|提供)|(?:发|发送|给).{0,12}(文件|附件|合同|报价单|资料|方案|pdf)/i.test(
      sourceText,
    );
  const fileMayAutoSend =
    /允许.{0,6}发送|可以.{0,6}发送|自动发送|直接发送/.test(
      rule.fileRequestPolicy || '',
    );
  const reviewReason = this.resolveCustomerReplyReviewReason(content);
  const noReplyReasons = [
    ...noReplyHits.map((item) => `命中不回复场景：${item}`),
    ...blockedHits.map((item) => `命中禁止表达：${item}`),
    !accountBound ? '承接账号未绑定到当前机器人' : '',
    !scopeMatched ? '客户来源不在当前机器人范围内' : '',
    input.knowledge.scope === 'selected' && !input.knowledge.available
      ? '指定知识资料不存在或不可用'
      : '',
  ].filter(Boolean);
  const reviewReasons = [
    ...approvalHits.map((item) => `命中发送前确认词：${item}`),
    reviewReason ? `需要人工核对：${reviewReason}` : '',
    !whitelisted ? '联系人未命中白名单' : '',
    fileRequest && !fileMayAutoSend
      ? optionalTrimmedText(rule.fileRequestPolicy) || '文件请求需要人工确认'
      : '',
    !input.commercialExecutionAllowed ? '当前账号没有自动发送权限' : '',
  ].filter(Boolean);
  const baseSendMode = this.resolveCustomerServiceSendMode(
    rule,
    input.requestedSendMode,
    sourceText,
    replyText,
    input.commercialExecutionAllowed,
  );
  const action = noReplyReasons.length
    ? 'no-reply'
    : reviewReasons.length || baseSendMode !== 'auto-send'
      ? 'review'
      : 'reply';
  const sendMode: InteractionSendMode =
    action === 'no-reply'
      ? 'draft-only'
      : action === 'review'
        ? baseSendMode === 'draft-only'
          ? 'draft-only'
          : 'approval-send'
        : 'auto-send';
  const delay = this.parseCustomerServiceReplyDelay(
    rule.replyDelay,
    input.now || new Date(),
  );
  const reasons = action === 'no-reply' ? noReplyReasons : reviewReasons;
  const reason =
    reasons[0] ||
    (action === 'reply'
      ? delay.selectedSeconds > 0
        ? `低风险回复将在 ${delay.selectedSeconds} 秒后进入发送队列。`
        : '低风险回复可以进入发送队列。'
      : sendMode === 'draft-only'
        ? '当前规则只生成草稿。'
        : '当前规则要求发送前确认。');
  return {
    action,
    sendMode,
    canGenerate: action !== 'no-reply',
    canCreateTask: action !== 'no-reply',
    reason,
    reasons: reasons.length ? reasons : [reason],
    matchedRules: {
      whitelist: whitelistHits,
      noReply: noReplyHits,
      approval: approvalHits,
      blocked: blockedHits,
    },
    delay,
    knowledge: {
      scope: input.knowledge.scope,
      selectedKnowledgeId: input.knowledge.selectedKnowledgeId,
      selectedKnowledgeTitle: input.knowledge.selectedKnowledgeTitle,
      available: input.knowledge.available,
    },
    contact: {
      platform,
      accountBound,
      scopeMatched,
      whitelisted,
    },
    fileRequest,
  };
}

export function matchCustomerServiceTerms(
  this: CustomerServiceHost,
  values: string[] | undefined,
  text: string,
) {
  const normalizedText = text.toLowerCase();
  return normalizeStringList(values, []).filter((item) =>
    normalizedText.includes(item.toLowerCase()),
  );
}

export function parseCustomerServiceReplyDelay(
  this: CustomerServiceHost,
  value: unknown,
  now: Date,
) {
  const text = optionalTrimmedText(value) || '';
  if (!text || /立即|即时|马上/.test(text)) {
    return { minSeconds: 0, maxSeconds: 0, selectedSeconds: 0 };
  }
  const numbers = Array.from(text.matchAll(/\d+(?:\.\d+)?/g))
    .map((match) => Number(match[0]))
    .filter((number) => Number.isFinite(number) && number >= 0);
  if (!numbers.length) {
    return { minSeconds: 0, maxSeconds: 0, selectedSeconds: 0 };
  }
  const multiplier = /小时/.test(text) ? 3600 : /分钟|分/.test(text) ? 60 : 1;
  const minSeconds = Math.min(
    24 * 60 * 60,
    Math.max(0, Math.round(Math.min(...numbers) * multiplier)),
  );
  const maxSeconds = Math.min(
    24 * 60 * 60,
    Math.max(minSeconds, Math.round(Math.max(...numbers) * multiplier)),
  );
  const selectedSeconds = minSeconds;
  return {
    minSeconds,
    maxSeconds,
    selectedSeconds,
    notBefore:
      selectedSeconds > 0
        ? new Date(now.getTime() + selectedSeconds * 1000).toISOString()
        : undefined,
  };
}

export function resolveCustomerServicePlatform(
  this: CustomerServiceHost,
  rule: InteractionReplyRuleConfig,
  requested: CustomerServiceReplyPlatform | undefined,
  accountName: string,
): CustomerServiceReplyPlatform {
  const inferred = /微信|wechat/i.test(accountName)
    ? 'wechat'
    : /抖音|douyin|字节|tiktok/i.test(accountName)
      ? 'douyin'
      : undefined;
  const platform = requested || inferred;
  if (!platform) {
    throw new BadRequestException('无法判断承接账号的平台，请选择微信或抖音。');
  }
  if (rule.contactScope !== 'all' && rule.contactScope !== platform) {
    throw new BadRequestException(
      '该机器人没有绑定当前平台，请更换机器人或账号。',
    );
  }
  return platform;
}

export function resolveCustomerServiceSendMode(
  this: CustomerServiceHost,
  rule: InteractionReplyRuleConfig,
  requested: InteractionSendMode | undefined,
  sourceText: string,
  replyText: string,
  commercialExecutionAllowed: boolean,
): InteractionSendMode {
  if (requested === 'draft-only' || requested === 'approval-send') {
    return requested;
  }
  if (rule.defaultSendMode !== 'auto-send') {
    return rule.defaultSendMode;
  }
  const content = `${sourceText}\n${replyText}`;
  const requiresReview =
    !commercialExecutionAllowed ||
    Boolean(this.resolveCustomerReplyReviewReason(content)) ||
    normalizeStringList(rule.requireApprovalKeywords, []).some((keyword) =>
      content.includes(keyword),
    ) ||
    normalizeStringList(rule.blockedKeywords, []).some((keyword) =>
      content.includes(keyword),
    );
  return requiresReview ? 'approval-send' : 'auto-send';
}

export function buildReplyFromRule(
  this: CustomerServiceHost,
  sourceText: string,
  context: { targetName?: string; accountName?: string } = {},
  replyRule: InteractionReplyRuleConfig = this.replyRule,
) {
  const rule = replyRule;
  const normalizedSource = sourceText.replace(/\s+/g, ' ').trim();
  const namePrefix = context.targetName?.trim()
    ? `${context.targetName.trim()}，`
    : '';
  const serviceHighlight = rule.serviceHighlights
    .map((highlight) => highlight.trim())
    .find(Boolean);
  const closing = rule.askForContact
    ? resolveSafeReplyClosing(rule.closingText)
    : '';
  const appendRuleContext = (reply: string) =>
    [reply, serviceHighlight ? `我们这边${serviceHighlight}。` : '', closing]
      .filter(Boolean)
      .join(' ');
  const hitApproval = rule.requireApprovalKeywords.find((keyword) =>
    normalizedSource.includes(keyword),
  );
  if (
    /退款|退货|售后|坏了|破损|发错|没收到|少发|漏发|质量|订单|物流|快递|发票/.test(
      normalizedSource,
    )
  ) {
    return '先别急，你把订单号和问题照片发我，我核实后按平台售后流程处理。';
  }
  if (
    /投诉|差评|不满意|垃圾|骗子|曝光|举报|拉黑|太差|生气|坑人|维权/.test(
      normalizedSource,
    )
  ) {
    return '抱歉让你体验不好了。你把具体问题和订单信息发我，我先核实处理。';
  }
  if (/价格|多少钱|收费|费用|报价|贵不贵|怎么卖/.test(normalizedSource)) {
    return appendRuleContext(
      `${namePrefix}你问的价格要看具体需求、数量和时间，我先按你的情况核准后再回复，避免乱报。`,
    );
  }
  if (
    /预约|预定|时间|几点|营业|排期|今天|明天|后天|周末|上门|到店/.test(
      normalizedSource,
    )
  ) {
    return '可以约，你把大概时间和要办的事发我，我先帮你看下能不能排上。';
  }
  if (
    /怎么买|购买|下单|链接|入口|橱窗|商品|有吗|还有吗|库存|现货/.test(
      normalizedSource,
    )
  ) {
    return '可以，你想看哪一款？把名称或截图发我，我帮你对应到具体入口。';
  }
  if (/在哪|哪里|地址|位置|怎么去|导航|门店/.test(normalizedSource)) {
    return '你想找门店地址还是商品入口？我按你要的给你发。';
  }
  if (/电话|联系|微信|私信|加我|客服|人工/.test(normalizedSource)) {
    return '可以，你直接私信发具体需求就行，我先看内容，再告诉你下一步怎么处理。';
  }
  if (hitApproval) {
    return `这个涉及${hitApproval}，你把订单和具体情况发我，我先按平台规则核实。`;
  }
  const configuredFallback = this.pickConfiguredFallbackReply(
    normalizedSource,
    rule,
  );
  if (configuredFallback) {
    return appendRuleContext(configuredFallback);
  }
  const subject = extractReplySubject(normalizedSource);
  return appendRuleContext(
    `${namePrefix}我看到你提到“${subject}”，这块我先按你的实际情况帮你核一下，再给你明确回复。`,
  );
}

export async function tryGenerateInteractionReplyWithAi(
  this: CustomerServiceHost,
  sourceText: string,
  context: {
    targetName?: string;
    accountName?: string;
    fallbackReply: string;
  },
  replyRule: InteractionReplyRuleConfig = this.replyRule,
  knowledge: CustomerServiceKnowledgeContext = {
    scope: 'local',
    available: true,
  },
) {
  if (!this.aiClient || !this.defaultModels) {
    return '';
  }

  try {
    const defaults = await this.defaultModels.getDefaults();
    const modelId = defaults.articleCreation || defaults.topicSelection;
    if (!modelId) {
      return '';
    }

    const rule = replyRule;
    const prompt = [
      `行业：${rule.industryName || '本地生活/电商服务'}`,
      `语气：${rule.tone === 'concise' ? '简洁直接' : rule.tone === 'warm' ? '自然友好' : '专业克制'}`,
      context.accountName ? `账号：${context.accountName}` : '',
      context.targetName ? `客户/对象：${context.targetName}` : '',
      knowledge.scope === 'selected' && knowledge.selectedKnowledgeTitle
        ? `仅可引用指定资料：${knowledge.selectedKnowledgeTitle}`
        : knowledge.scope === 'none'
          ? '本次不得引用知识库；信息不足时直接追问或转人工。'
          : '可引用当前本地知识库中的相关资料。',
      knowledge.scope === 'selected' && knowledge.content
        ? `指定资料内容：\n${knowledge.content}`
        : '',
      `客户原话：${sourceText}`,
      `规则兜底参考：${context.fallbackReply}`,
      '请生成一条可直接回复客户的中文短句，要求：',
      '1. 不编造价格、库存、疗效、承诺、联系方式或平台外交易。',
      '2. 不使用“亲亲”“尊敬的客户”“马上安排”“专人跟进”等模板腔。',
      '3. 能回答就回答，信息不足时请自然地追问必要信息。',
      '4. 只输出回复正文，控制在 80 字以内。',
    ]
      .filter(Boolean)
      .join('\n');
    const output = await this.aiClient.generate(
      modelId,
      [
        {
          role: 'system',
          content:
            '你是商家账号的客服回复助手，只能输出要发给客户的一句话。必须真实、克制、可商用。',
        },
        { role: 'user', content: prompt },
      ],
      {
        temperature: 0.35,
        maxTokens: 180,
        knowledgeMode: knowledge.scope === 'local' ? 'required' : 'off',
        knowledgeQuery:
          knowledge.scope === 'local'
            ? `${context.accountName || ''}\n${context.targetName || ''}\n${sourceText}`
            : undefined,
      },
    );
    return normalizeAiInteractionReply(output);
  } catch (error) {
    console.warn(
      '[local-engine] AI interaction reply failed, falling back to rule',
      error instanceof Error ? error.message : error,
    );
    return '';
  }
}

export function pickConfiguredFallbackReply(
  this: CustomerServiceHost,
  sourceText: string,
  rule: InteractionReplyRuleConfig = this.replyRule,
) {
  if (!rule.fallbackEnabled) {
    return '';
  }
  const replies = normalizeStringList(rule.fallbackReplies, []);
  if (!replies.length) {
    return '';
  }
  const source = sourceText.replace(/\s+/g, ' ').trim();
  const matched = replies.find((reply) => {
    if (/订单|售后|退款|物流|发票/.test(source)) {
      return /订单|售后|物流|核实|问题/.test(reply);
    }
    if (/价格|多少|费用|收费/.test(source)) {
      return /价格|费用|具体|核/.test(reply);
    }
    if (/预约|时间|上门|到店/.test(source)) {
      return /时间|预约|具体/.test(reply);
    }
    return false;
  });
  return (matched || '').slice(0, 140);
}

export function normalizeReplyGeneratedBy(
  this: CustomerServiceHost,
  value: unknown,
): InteractionReplyGeneratedBy | undefined {
  const text = optionalTrimmedText(value);
  return text === 'ai' || text === 'fallback' ? text : undefined;
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const customerServiceMethods = {
  getReplyRule,
  listReplyBots,
  getReplyBot,
  createReplyBot,
  updateReplyBot,
  setReplyBotEnabled,
  createCustomerServiceReplyTask,
  updateReplyRule,
  generateInteractionReply,
  createDefaultReplyRule,
  toCustomerServiceReplyBot,
  normalizeCustomerServiceRule,
  resolveCustomerServiceKnowledge,
  evaluateCustomerServiceReplyDecision,
  matchCustomerServiceTerms,
  parseCustomerServiceReplyDelay,
  resolveCustomerServicePlatform,
  resolveCustomerServiceSendMode,
  buildReplyFromRule,
  tryGenerateInteractionReplyWithAi,
  pickConfiguredFallbackReply,
  normalizeReplyGeneratedBy,
};
