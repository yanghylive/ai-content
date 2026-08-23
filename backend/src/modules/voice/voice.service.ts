import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { pickDefaultModel } from '../ai-models/model-capability.util';
import { KaypalModelSyncService } from '../ai-models/kaypal-model-sync.service';
import { createSessionToken, hashSessionToken } from '../auth/auth.utils';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { BackendRiskContext } from '../auth/risk-control';
import { BillingService } from '../billing/billing.service';
import { IntelligenceMonitorRunnerService } from '../intelligence/intelligence-monitor-runner.service';
import { LocalEngineService } from '../local-engine/local-engine.service';
import type {
  AgentConfirmationDecisionInput,
  AgentConfirmationListItem,
  CreateInteractionTaskInput,
  InteractionBusinessRouteKey,
} from '../local-engine/local-engine.types';
import type {
  VoiceChatDto,
  VoiceCommandDto,
  VoiceConfirmDto,
  VoiceAsrMeterDto,
  VoiceHeartbeatDto,
  VoiceMediaImageDto,
  VoicePairDto,
} from './dto/voice.dto';
import type {
  VoiceChatResult,
  VoiceAsrMeterResult,
  VoiceCommandIntent,
  VoiceCommandResult,
  VoiceMediaImageResult,
  VoicePairResult,
  VoiceState,
  VoiceToolDescriptor,
  VoiceToolRisk,
} from './voice.types';

type Settled<T> = { value: T | null; error?: string };
type VoiceChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly localEngine: LocalEngineService,
    private readonly intelligenceRunner: IntelligenceMonitorRunnerService,
    private readonly defaultModels?: DefaultModelsService,
    private readonly aiClient?: AiClientService,
    private readonly kaypalModelSync?: KaypalModelSyncService,
    private readonly config?: ConfigService,
  ) {}

  async pair(
    user: AuthenticatedUser | undefined,
    authSessionId: string | undefined,
    input: VoicePairDto = {},
  ): Promise<VoicePairResult> {
    this.requireUser(user);
    const ttlHours = this.clampNumber(input.requestedTtlHours, 1, 72, 24);
    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const inheritedMetadata = await this.loadSessionMetadata(authSessionId);
    const metadata = {
      ...inheritedMetadata,
      voiceSession: {
        source: input.clientKind || 'bailongma-desktop',
        clientName: input.clientName || 'BaiLongma',
        deviceId: input.deviceId || null,
        deviceName: input.deviceName || null,
        parentSessionId: authSessionId || null,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };

    const session = await this.prisma.userSession.create({
      data: {
        userId: user!.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
        metadata: metadata,
      },
    });

    return {
      tokenType: 'Bearer',
      accessToken: sessionToken,
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
      scopes: ['voice:read', 'voice:command', 'voice:confirm', 'voice:chat'],
      usage: {
        header: `Authorization: Bearer ${sessionToken}`,
        example: `curl -H "Authorization: Bearer ${sessionToken}" http://127.0.0.1:3011/api/voice/state`,
      },
    };
  }

  heartbeat(
    user: AuthenticatedUser | undefined,
    input: VoiceHeartbeatDto = {},
  ) {
    this.requireUser(user);
    return {
      connected: true,
      userId: user!.id,
      clientKind: input.clientKind || 'bailongma-desktop',
      clientName: input.clientName || 'BaiLongma',
      deviceId: input.deviceId || null,
      status: input.status || 'online',
      serverTime: new Date().toISOString(),
    };
  }

  async getState(user: AuthenticatedUser | undefined): Promise<VoiceState> {
    this.requireUser(user);
    const [billing, confirmations, wechatTasks] = await Promise.all([
      this.settle(() => this.billing.getStatusForUser(user!)),
      this.settle(() => this.localEngine.listAgentConfirmations('pending')),
      this.settle(() => this.localEngine.listBusinessTasks('wechat', 5)),
    ]);

    return {
      user: {
        id: user!.id,
        name: user!.name || user!.username || user!.email,
        email: user!.email,
        kaypalUserId: user!.kaypalUserId,
        plan: user!.kaypalPlan,
        role: user!.role,
      },
      companion: {
        productName: 'BaiLongma',
        mode: 'embedded-3010-voice-module',
        embeddedIn3010: true,
        summary:
          'BaiLongma 是 3010 内置语音交互模块。用户可以继续直接操作 3010，也可以用语音完成查询、导航、生成和确认。',
        generalCapabilities: [
          'voice_chat',
          'web_search',
          'file_summary',
          'reminders',
          'tts',
          'local_tools',
        ],
      },
      kaypal: {
        connected: true,
        billing: billing.value,
        billingStatus: billing.error ? 'temporarily_unavailable' : 'ready',
        billingMessage: billing.error
          ? '用量信息暂时不可用，其他 KAYPAL 能力仍可继续使用。'
          : undefined,
        pendingConfirmations: {
          count: confirmations.value?.length || 0,
          items: confirmations.value || [],
          status: confirmations.error ? 'temporarily_unavailable' : 'ready',
          message: confirmations.error
            ? '待确认列表暂时不可用，请稍后再试。'
            : undefined,
        },
        recentWechatTasks: {
          count: wechatTasks.value?.length || 0,
          items: wechatTasks.value || [],
          status: wechatTasks.error ? 'temporarily_unavailable' : 'ready',
          message: wechatTasks.error
            ? '最近任务暂时不可用，请稍后再试。'
            : undefined,
        },
      },
      tools: {
        general: this.generalTools(),
        kaypal: this.kaypalTools(),
        hybrid: this.hybridTools(),
      },
    };
  }

  async chat(
    user: AuthenticatedUser | undefined,
    input: VoiceChatDto = {},
  ): Promise<VoiceChatResult> {
    await this.requireKaypalAccount(user);
    const messages = this.normalizeChatMessages(input);
    const modelId = await this.resolveDefaultChatModelId();

    if (!this.aiClient) {
      throw new ServiceUnavailableException(
        'BaiLongma 智能服务暂时不可用，请稍后再试。',
      );
    }

    const content = (
      await this.aiClient.generate(modelId, messages, {
        temperature: this.clampFloat(input.temperature, 0, 2, 0.5),
        maxTokens: this.clampNumber(input.maxTokens, 64, 4000, 1400),
        knowledgeMode: 'off',
      })
    ).trim();

    if (!content) {
      throw new ServiceUnavailableException(
        'BaiLongma 暂时没有生成回复，请稍后再试。',
      );
    }

    return {
      content,
      account: {
        kaypalUserId: user!.kaypalUserId || '',
        plan: user!.kaypalPlan,
      },
      usageMode: 'kaypal-subscription-credits',
    };
  }

  async generateImage(
    user: AuthenticatedUser | undefined,
    input: VoiceMediaImageDto,
  ): Promise<VoiceMediaImageResult> {
    await this.requireKaypalAccount(user);
    if (!this.aiClient) {
      throw new ServiceUnavailableException(
        'BaiLongma 媒体服务暂时不可用，请稍后再试。',
      );
    }

    const prompt = this.optionalString(input.prompt).slice(0, 4000);
    if (!prompt) {
      throw new BadRequestException('请输入要生成的画面描述');
    }

    const modelId = await this.resolveDefaultImageModelId();
    const count = this.clampNumber(input.n, 1, 4, 1);
    const urls: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const url = await this.aiClient.generateImage(modelId, prompt, {
        ratio: input.aspectRatio || '1:1',
        n: 1,
      });
      if (url) urls.push(url);
    }

    if (!urls.length) {
      throw new ServiceUnavailableException(
        'BaiLongma 暂时没有生成图片，请稍后再试。',
      );
    }

    return {
      urls,
      account: {
        kaypalUserId: user!.kaypalUserId || '',
        plan: user!.kaypalPlan,
      },
      usageMode: 'kaypal-subscription-credits',
    };
  }

  async meterAsr(
    user: AuthenticatedUser | undefined,
    input: VoiceAsrMeterDto = {},
  ): Promise<VoiceAsrMeterResult> {
    await this.requireKaypalAccount(user);
    const sessionId = this.optionalString(input.sessionId).slice(0, 128);
    await this.chargeVoiceRecognitionCredits(user!, input, sessionId);
    return {
      accepted: true,
      account: {
        kaypalUserId: user!.kaypalUserId || '',
        plan: user!.kaypalPlan,
      },
      usageMode: 'kaypal-subscription-credits',
      service: 'voice_recognition',
      ...(sessionId ? { sessionId } : {}),
    };
  }

  async command(
    user: AuthenticatedUser | undefined,
    input: VoiceCommandDto,
    riskContext?: BackendRiskContext,
  ): Promise<VoiceCommandResult> {
    this.requireUser(user);
    const text = input.text?.trim();
    if (!text) {
      throw new BadRequestException('语音命令不能为空');
    }
    const intent = this.resolveIntent(text, input);

    if (intent === 'get_state') {
      const state = await this.getState(user);
      return this.result(
        intent,
        'low',
        this.buildStateResponseText(state),
        this.toPublicStateSummary(state),
      );
    }

    if (intent === 'get_billing') {
      const billing = await this.settle(() =>
        this.billing.getStatusForUser(user!),
      );
      if (!billing.value) {
        return this.result(
          intent,
          'low',
          '用量信息暂时不可用，其他 KAYPAL 能力仍可继续使用。',
          this.publicIssue('billing_unavailable'),
        );
      }
      const billingValue = billing.value;
      const plan = billingValue.entitlement?.plan || user!.kaypalPlan || 'FREE';
      return this.result(
        intent,
        'low',
        `当前 KAYPAL 套餐是 ${plan}。用量和积分详情已返回。`,
        billingValue,
      );
    }

    if (intent === 'list_confirmations') {
      const confirmations = await this.settle(() =>
        this.localEngine.listAgentConfirmations('pending'),
      );
      if (!confirmations.value) {
        return this.result(
          intent,
          'low',
          '待确认列表暂时不可用，请稍后再试。',
          this.publicIssue('confirmations_unavailable'),
        );
      }
      return this.result(
        intent,
        'low',
        confirmations.value.length
          ? `现在有 ${confirmations.value.length} 个待确认动作。`
          : '现在没有待确认动作。',
        confirmations.value,
      );
    }

    if (intent === 'decide_confirmation') {
      return this.decideConfirmation(user, input, text, riskContext);
    }

    if (intent === 'open_page') {
      const page = this.resolvePage(text);
      return {
        intent,
        handledBy: 'kaypal-voice-bridge',
        risk: 'low',
        responseText: `可以，打开 ${page.label}。`,
        action: {
          type: 'open_page',
          label: page.label,
          href: page.href,
        },
        data: page,
      };
    }

    if (intent === 'search_intelligence') {
      const keyword = this.extractKeyword(text, input);
      if (!keyword) {
        throw new BadRequestException('请说明要搜索的关键词');
      }
      const platform = input.platform || this.resolvePlatform(text);
      const target = input.target || this.resolveSearchTarget(text);
      const result = await this.settle(() =>
        this.intelligenceRunner.runSearch(user, {
          keyword,
          platform,
          target,
          limit: this.clampNumber(input.limit, 1, 20, 10),
        }),
      );
      if (!result.value) {
        return this.result(
          intent,
          'medium',
          '情报搜索暂时不可用，KAYPAL 已保留这次请求，请稍后再试。',
          this.publicIssue('intelligence_search_unavailable'),
        );
      }
      return this.result(
        intent,
        'medium',
        `已发起情报搜索：${keyword}。收到 ${result.value.received} 条，入库 ${result.value.created} 条，更新 ${result.value.updated} 条。`,
        this.toPublicSearchSummary(result.value),
      );
    }

    if (intent === 'create_wechat_task') {
      const task = await this.createWechatDraftTask(text, input);
      const taskSummary = this.toPublicWechatTaskSummary(task);
      return this.result(
        intent,
        'high',
        taskSummary.status === 'blocked'
          ? '已尝试创建微信任务草稿，但当前执行条件不完整，KAYPAL 已阻止自动执行。'
          : '已创建微信相关任务草稿。外发、发布或批量动作仍需确认后执行。',
        taskSummary,
      );
    }

    return {
      intent: 'general_agent_fallback',
      handledBy: 'bailongma-general',
      risk: 'low',
      responseText: '这条更像日常语音助手任务，会在 3010 语音模块内继续处理。',
      data: {
        text,
        suggestedMode: 'voice-assist',
      },
    };
  }

  async confirm(
    user: AuthenticatedUser | undefined,
    input: VoiceConfirmDto,
    riskContext?: BackendRiskContext,
  ): Promise<VoiceCommandResult> {
    this.requireUser(user);
    const text = input.spokenText || input.decision || '';
    return this.decideConfirmation(
      user,
      {
        confirmationId: input.confirmationId,
        decision: input.decision,
        text,
        context: { note: input.note },
      },
      text,
      riskContext,
      input.confirmedChecks,
    );
  }

  private async decideConfirmation(
    user: AuthenticatedUser | undefined,
    input: VoiceCommandDto,
    spokenText: string,
    riskContext?: BackendRiskContext,
    confirmedChecks?: Record<string, boolean>,
  ): Promise<VoiceCommandResult> {
    const decision =
      input.decision ||
      (/拒绝|取消|不要|否/i.test(spokenText) ? 'reject' : 'approve');
    const confirmation = await this.resolvePendingConfirmation(
      input.confirmationId,
    );
    const confirmationId = confirmation?.id;
    if (!confirmationId) {
      return this.result(
        'decide_confirmation',
        'low',
        '当前没有待确认动作。',
        [],
      );
    }
    const decisionInput: AgentConfirmationDecisionInput = {
      operator: user?.name || user?.username || 'voice-user',
      note:
        this.optionalString(input.context?.note) ||
        `语音${decision === 'approve' ? '确认' : '拒绝'}：${spokenText}`,
      confirmedChecks,
    };

    if (decision === 'approve') {
      decisionInput.riskConfirmation = {
        confirmed: true,
        confirmationId,
        operator: decisionInput.operator,
        reason: decisionInput.note,
        confirmedAt: new Date().toISOString(),
        confirmedAction: 'agent-confirmation-approve',
        confirmedRiskLevel: confirmation.riskLevel,
        checklist: confirmedChecks,
      };
      const session = await this.localEngine.approveAgentConfirmation(
        confirmationId,
        decisionInput,
        riskContext,
      );
      return this.result(
        'decide_confirmation',
        'high',
        '已通过语音确认，KAYPAL 已记录确认和安全审计。',
        session,
      );
    }

    const session = await this.localEngine.rejectAgentConfirmation(
      confirmationId,
      decisionInput,
    );
    return this.result(
      'decide_confirmation',
      'high',
      '已通过语音拒绝，相关动作不会继续执行。',
      session,
    );
  }

  private async createWechatDraftTask(text: string, input: VoiceCommandDto) {
    const route = this.resolveWechatRoute(text);
    const taskInput: Omit<CreateInteractionTaskInput, 'type'> &
      Partial<Pick<CreateInteractionTaskInput, 'type'>> = {
      type:
        route === 'moments'
          ? 'wechat-moments-marketing'
          : route === 'groups'
            ? 'wechat-group-broadcast'
            : 'wechat-reply-draft',
      sourceText: text,
      targetName: '语音创建',
      replyText: this.extractQuotedContent(text) || undefined,
      planName: 'BaiLongma 语音创建任务',
      sendMode: 'draft-only',
      commercialExecutionRequested: false,
      metadata: {
        source: 'bailongma-voice',
        spokenText: text,
        voiceContext: input.context || {},
        safety: 'draft-only-created-by-voice-bridge',
      },
    };
    return this.localEngine.createBusinessTask(route, taskInput);
  }

  private async resolvePendingConfirmation(
    id?: string,
  ): Promise<AgentConfirmationListItem | undefined> {
    const confirmations =
      await this.localEngine.listAgentConfirmations('pending');
    if (id) {
      return confirmations.find((confirmation) => confirmation.id === id);
    }
    return confirmations[0];
  }

  private resolveIntent(
    text: string,
    input: VoiceCommandDto,
  ): VoiceCommandIntent {
    if (/状态|连接|能做什么|有哪些能力/i.test(text)) return 'get_state';
    if (/积分|余额|用量|扣了多少|扣费/i.test(text)) return 'get_billing';
    if (/打开|进入|跳到|切到/i.test(text)) return 'open_page';
    if (/待确认|确认队列|待审批|待批准/i.test(text)) {
      return 'list_confirmations';
    }
    if (
      input.confirmationId ||
      input.decision ||
      /确认执行|确认通过|通过这个|同意执行|拒绝|取消执行/i.test(text)
    ) {
      return 'decide_confirmation';
    }
    if (
      /(搜|搜索|查一下|找).*(小红书|抖音|B站|公众号|微信|情报|线索|热点|账号|作品|评论)/i.test(
        text,
      )
    ) {
      return 'search_intelligence';
    }
    if (/(创建|新建|安排|发起).*(微信|朋友圈|群发|好友|客户)/i.test(text)) {
      return 'create_wechat_task';
    }
    return 'general_agent_fallback';
  }

  private resolvePlatform(
    text: string,
  ): 'all' | 'douyin' | 'xiaohongshu' | 'bilibili' | 'wechat' | 'gongzhonghao' {
    if (/小红书/i.test(text)) return 'xiaohongshu';
    if (/抖音/i.test(text)) return 'douyin';
    if (/B站|哔哩|bilibili/i.test(text)) return 'bilibili';
    if (/公众号/i.test(text)) return 'gongzhonghao';
    if (/微信/i.test(text)) return 'wechat';
    return 'all';
  }

  private resolveSearchTarget(
    text: string,
  ): 'all' | 'post' | 'account' | 'comment' | 'engagement' {
    if (/账号|用户|博主/i.test(text)) return 'account';
    if (/评论/i.test(text)) return 'comment';
    if (/互动|点赞|转发/i.test(text)) return 'engagement';
    if (/作品|文章|笔记|内容/i.test(text)) return 'post';
    return 'all';
  }

  private extractKeyword(text: string, input: VoiceCommandDto) {
    if (input.keyword?.trim()) return input.keyword.trim();
    return text
      .replace(/帮我|请|一下|相关|内容|资料|情报|线索/g, ' ')
      .replace(/搜索|搜|查一下|查|找/g, ' ')
      .replace(/小红书|抖音|B站|哔哩|bilibili|公众号|微信/g, ' ')
      .replace(/作品|文章|笔记|账号|用户|博主|评论|互动|热点/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private resolveWechatRoute(text: string): InteractionBusinessRouteKey {
    if (/朋友圈/i.test(text)) return 'moments';
    if (/群发|群聊|社群/i.test(text)) return 'groups';
    if (/好友|客户/i.test(text)) return 'customers';
    return 'wechat';
  }

  private resolvePage(text: string) {
    const routes = [
      {
        pattern: /情报|搜索|研究/i,
        label: '情报搜索',
        href: '/intelligence/search',
      },
      { pattern: /监控/i, label: '情报监控', href: '/intelligence/monitors' },
      {
        pattern: /用量|扣费|积分/i,
        label: '用量记录',
        href: '/intelligence/costs',
      },
      { pattern: /微信/i, label: '微信任务', href: '/workbench/wechat' },
      {
        pattern: /本地|引擎|运行|设备/i,
        label: '设备状态',
        href: '/local-engine',
      },
      {
        pattern: /确认|审批/i,
        label: '待确认',
        href: '/tasks/confirmations',
      },
      { pattern: /风控|安全|风险/i, label: '风控中心', href: '/admin/risk' },
      { pattern: /增长|获客/i, label: '增长获客', href: '/growth/acquisition' },
    ];
    return (
      routes.find((route) => route.pattern.test(text)) || {
        label: '今日工作台',
        href: '/',
      }
    );
  }

  private extractQuotedContent(text: string) {
    const quoted = text.match(/[“"]([^”"]+)[”"]/);
    return quoted?.[1]?.trim();
  }

  private result(
    intent: VoiceCommandIntent,
    risk: VoiceToolRisk,
    responseText: string,
    data: VoiceCommandResult['data'],
  ): VoiceCommandResult {
    return {
      intent,
      handledBy: 'kaypal-voice-bridge',
      risk,
      responseText,
      data,
    };
  }

  private publicIssue(code: string) {
    return {
      status: 'temporarily_unavailable',
      code,
      message: '该信息暂时不可用，请稍后再试。',
    };
  }

  private buildStateResponseText(state: VoiceState) {
    const plan =
      state.kaypal.billing?.entitlement?.plan || state.user.plan || '未同步';
    const billingNote =
      state.kaypal.billingStatus === 'temporarily_unavailable'
        ? '用量信息暂时不可用。'
        : `当前套餐是 ${plan}。`;
    return `BaiLongma 已接入 KAYPAL。${billingNote}现在有 ${state.kaypal.pendingConfirmations.count} 个待确认动作。`;
  }

  private toPublicStateSummary(state: VoiceState) {
    return {
      connected: state.kaypal.connected,
      plan: state.kaypal.billing?.entitlement?.plan || state.user.plan || null,
      billingStatus: state.kaypal.billingStatus,
      billingMessage: state.kaypal.billingMessage,
      pendingConfirmations: {
        count: state.kaypal.pendingConfirmations.count,
        status: state.kaypal.pendingConfirmations.status,
        message: state.kaypal.pendingConfirmations.message,
      },
      recentWechatTasks: {
        count: state.kaypal.recentWechatTasks.count,
        status: state.kaypal.recentWechatTasks.status,
        message: state.kaypal.recentWechatTasks.message,
      },
    };
  }

  private toPublicSearchSummary(result: {
    keyword: string;
    platform: string;
    target: string;
    received: number;
    normalized: number;
    created: number;
    updated: number;
  }) {
    return {
      keyword: result.keyword,
      platform: result.platform,
      target: result.target,
      received: result.received,
      normalized: result.normalized,
      created: result.created,
      updated: result.updated,
    };
  }

  private toPublicWechatTaskSummary(
    task: Awaited<ReturnType<LocalEngineService['createBusinessTask']>>,
  ) {
    return {
      id: task.id,
      typeLabel: task.typeLabel,
      status: task.status,
      statusLabel: task.statusLabel,
      planName: task.planName,
      targetName: task.targetName,
      sendMode: task.sendMode,
      riskLevel: task.riskLevel,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      summary: this.toPublicTaskMessage(
        task.resultSummary?.detail ||
          task.diagnostics?.summary ||
          task.failureContext?.reason,
      ),
      nextAction: this.toPublicTaskMessage(
        task.resultSummary?.nextAction ||
          task.diagnostics?.nextAction ||
          task.failureContext?.nextAction,
      ),
      recordsHref: task.resultSummary?.recordsHref,
      evidenceHref: task.resultSummary?.evidenceHref,
    };
  }

  private toPublicTaskMessage(value?: string) {
    if (!value) return undefined;
    if (
      /executor|capability|preflight|contract|runtime|本地\s*发布服务/i.test(
        value,
      )
    ) {
      return '当前设备或账号条件还不完整，请在 KAYPAL 里查看任务详情并按提示处理。';
    }
    return value;
  }

  private async settle<T>(fn: () => Promise<T>): Promise<Settled<T>> {
    try {
      return { value: await fn() };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : '请求失败',
      };
    }
  }

  private async loadSessionMetadata(sessionId?: string) {
    if (!sessionId) return {};
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    return this.asRecord(session?.metadata);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readConfig(key: string) {
    return (
      this.config?.get<string>(key)?.trim() || process.env[key]?.trim() || ''
    );
  }

  private readPositiveNumberConfig(key: string, fallback: number) {
    const value = Number(this.readConfig(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private getKaypalCloudBaseUrl() {
    return (
      this.readConfig('KAYPAL_AUTH_BASE_URL') || 'https://kaypal.cn'
    ).replace(/\/+$/, '');
  }

  private isVoiceAsrBillingEnabled() {
    const value = this.readConfig('KAYPAL_VOICE_ASR_BILLING_ENABLED');
    return value !== 'false' && value !== '0';
  }

  private getVoiceRecognitionBillingIdentity(user: AuthenticatedUser) {
    const userId = user.kaypalUserId?.trim() || '';
    const token = user.kaypalDesktopAccessToken?.trim() || '';
    if (userId && token) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      return {
        userId,
        authSource: 'desktop-token',
        headers,
      };
    }

    const serverApiKey =
      this.readConfig('KAYPAL_API_KEY') ||
      this.readConfig('KAYPAL_AI_PROXY_API_KEY');
    if (userId && serverApiKey) {
      const headers: Record<string, string> = {
        'x-kaypal-api-key': serverApiKey,
      };
      return {
        userId,
        authSource: 'server-api-key',
        headers,
      };
    }

    throw new ServiceUnavailableException(
      'KAYPAL 账号状态需要刷新，请重新登录后再使用语音识别。',
    );
  }

  private getBillingResponseError(
    payload: Record<string, unknown> | null,
    status: number,
  ) {
    return (
      (typeof payload?.error === 'string' ? payload.error : '') ||
      (typeof payload?.message === 'string' ? payload.message : '') ||
      `Kaypal 云端扣积分接口返回 HTTP ${status}`
    );
  }

  private async chargeVoiceRecognitionCredits(
    user: AuthenticatedUser,
    input: VoiceAsrMeterDto,
    sessionId: string,
  ) {
    if (!this.isVoiceAsrBillingEnabled()) return;
    const amount = this.readPositiveNumberConfig(
      'KAYPAL_VOICE_ASR_CREDIT_COST',
      1,
    );
    const identity = this.getVoiceRecognitionBillingIdentity(user);

    try {
      const response = await fetch(
        new URL('/api/billing/deduct', this.getKaypalCloudBaseUrl()),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...identity.headers,
          },
          body: JSON.stringify({
            user_id: identity.userId,
            amount,
            service_type: 'ai_content_workbench',
            resource_type: 'voice_recognition',
            metadata: {
              source: 'bailongma-desktop',
              billingMode: 'cloud',
              billingAuthSource: identity.authSource,
              phase: 'asr_session_start',
              idempotencyKey: `bailongma:asr:${sessionId || randomUUID()}`,
              clientKind: input.clientKind || 'bailongma-desktop',
              durationMs: this.clampNumber(
                input.durationMs,
                0,
                10 * 60 * 1000,
                0,
              ),
              lang: this.optionalString(input.lang).slice(0, 32),
            },
          }),
          signal: AbortSignal.timeout(
            this.readPositiveNumberConfig(
              'KAYPAL_VOICE_ASR_BILLING_TIMEOUT_MS',
              8000,
            ),
          ),
        },
      );
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok) {
        throw new Error(this.getBillingResponseError(payload, response.status));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`KAYPAL voice ASR billing failed: ${message}`);
      throw new ServiceUnavailableException(
        'KAYPAL 语音识别服务暂时不可用，请刷新账号状态后再试。',
      );
    }
  }

  private clampNumber(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number,
  ) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
  }

  private clampFloat(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number,
  ) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  private normalizeChatMessages(input: VoiceChatDto): VoiceChatMessage[] {
    const rawMessages = Array.isArray(input.messages) ? input.messages : [];
    const messages = rawMessages
      .map((message) => {
        const role = String(message?.role || '').trim();
        if (!['system', 'user', 'assistant'].includes(role)) return null;
        const content = this.optionalString(message?.content).slice(0, 6000);
        if (!content) return null;
        return {
          role: role as VoiceChatMessage['role'],
          content,
        };
      })
      .filter((message): message is VoiceChatMessage => Boolean(message))
      .slice(-40);

    const text = this.optionalString(input.text);
    if (!messages.length && text) {
      messages.push({ role: 'user', content: text.slice(0, 6000) });
    }

    if (!messages.some((message) => message.role === 'user')) {
      throw new BadRequestException('请输入要对 BaiLongma 说的话');
    }

    return messages;
  }

  private async resolveDefaultChatModelId() {
    const existingModelId = await this.findDefaultChatModelId();
    if (existingModelId) return existingModelId;

    if (this.kaypalModelSync) {
      try {
        const synced = await this.kaypalModelSync.sync();
        if (synced.localModelId) return synced.localModelId;
      } catch (error) {
        this.logger.warn(
          `Kaypal default model auto-sync failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    const syncedModelId = await this.findDefaultChatModelId();
    if (syncedModelId) return syncedModelId;

    throw new ServiceUnavailableException(
      'BaiLongma 智能服务还未准备好，请先登录 KAYPAL 后稍后再试。',
    );
  }

  private async findDefaultChatModelId() {
    const defaults = await this.defaultModels?.getDefaults();
    const modelId =
      defaults?.articleCreation ||
      defaults?.topicSelection ||
      defaults?.xCollection ||
      '';
    if (modelId) return modelId;

    const fallbackModel = await pickDefaultModel(this.prisma, 'text');
    if (fallbackModel?.id) return fallbackModel.id;

    return '';
  }

  private async resolveDefaultImageModelId() {
    const existingModelId = await this.findDefaultImageModelId();
    if (existingModelId) return existingModelId;

    if (this.kaypalModelSync) {
      try {
        await this.kaypalModelSync.sync();
      } catch (error) {
        this.logger.warn(
          `Kaypal image model auto-sync failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    const syncedModelId = await this.findDefaultImageModelId();
    if (syncedModelId) return syncedModelId;

    throw new ServiceUnavailableException(
      'BaiLongma 媒体服务还未准备好，请稍后再试。',
    );
  }

  private async findDefaultImageModelId() {
    const defaults = await this.defaultModels?.getDefaults();
    if (defaults?.imageCreation) return defaults.imageCreation;

    const fallbackModel = await pickDefaultModel(this.prisma, 'image');
    if (fallbackModel?.id) return fallbackModel.id;

    return '';
  }

  private requireUser(user?: AuthenticatedUser) {
    if (!user) {
      throw new UnauthorizedException('请先登录 KAYPAL 后再连接语音助手');
    }
  }

  private async requireKaypalAccount(user?: AuthenticatedUser) {
    this.requireUser(user);
    if (!user!.kaypalUserId || user!.kaypalLocalOnly) {
      throw new UnauthorizedException(
        '请先登录 KAYPAL 账号后再使用 BaiLongma。',
      );
    }
    if (user!.kaypalPlanExpired) {
      // C2 收敛（2026-08-09）：DB 持久化授权（tenant_entitlements，等效 billing-webhook）
      // 优先于云平台 kaypalPlanExpired 展示标记——DB 有 active 非 FREE 授权时放行，
      // 避免「kaypalPlan 展示 FREE/过期但已持久化授权」的用户被误拒。
      const billing = await this.settle(() =>
        this.billing.getStatusForUser(user!),
      );
      const ent = billing.value?.entitlement;
      const dbActive =
        Boolean(ent) &&
        ent!.status === 'active' &&
        Boolean(ent!.plan) &&
        ent!.plan !== 'FREE';
      if (!dbActive) {
        throw new UnauthorizedException(
          '当前 KAYPAL 订阅状态需要确认，请登录 KAYPAL 后再使用 BaiLongma。',
        );
      }
    }
  }

  private generalTools(): VoiceToolDescriptor[] {
    return [
      {
        name: 'general.chat',
        title: '通用语音对话',
        description: '聊天、写作、总结、翻译和改写，可在 3010 内用语音完成。',
        mode: 'voice-assist',
        risk: 'low',
        requiresKaypalConnection: false,
      },
      {
        name: 'general.file_summary',
        title: '本地文件整理',
        description: '在用户授权范围内读取、总结和整理本地文件。',
        mode: 'voice-assist',
        risk: 'medium',
        requiresKaypalConnection: false,
      },
    ];
  }

  private kaypalTools(): VoiceToolDescriptor[] {
    return [
      {
        name: 'kaypal.get_state',
        title: 'KAYPAL 状态',
        description: '查询积分、套餐、待确认和最近任务。',
        mode: 'kaypal-business',
        risk: 'low',
        requiresKaypalConnection: true,
      },
      {
        name: 'kaypal.search_intelligence',
        title: '情报搜索',
        description: '搜索平台线索、热点内容、账号和评论情报。',
        mode: 'kaypal-business',
        risk: 'medium',
        requiresKaypalConnection: true,
      },
      {
        name: 'kaypal.create_wechat_task',
        title: '微信任务草稿',
        description: '创建微信、群发或朋友圈任务草稿，高风险执行需要确认。',
        mode: 'kaypal-business',
        risk: 'high',
        requiresKaypalConnection: true,
      },
    ];
  }

  private hybridTools(): VoiceToolDescriptor[] {
    return [
      {
        name: 'hybrid.research_to_task',
        title: '资料整理后创建任务',
        description:
          '先由 BaiLongma 整理资料，再生成可确认的 KAYPAL 业务任务。',
        mode: 'hybrid',
        risk: 'medium',
        requiresKaypalConnection: true,
      },
    ];
  }
}
