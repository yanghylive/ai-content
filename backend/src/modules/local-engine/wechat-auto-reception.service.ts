/**
 * 微信消息自动接待守护（方案 2 阶段 1+2，2026-09）
 *
 * 语义红线（与既有风控一致，见 risk-safety / desktop-status mixin）：
 * - 守护永不自动外发：只把新客户消息按客服机器人规则生成「确认后发送」草稿任务，
 *   任务进入 waiting_for_send_confirmation，发送必须经 /tasks/confirmations 人工放行。
 * - 用户接管/停止会话（takeoverActive / stoppedAt）期间，守护暂停生成草稿。
 *
 * 阶段 1（探测）：周期读取微信聊天历史缓存，与持久化水位 diff，识别新客户消息；
 * 阶段 2（草稿）：对每条新消息解析承接账号与启用 bot → createCustomerServiceReplyTask。
 *
 * 全部写动作都有硬门槛保护：找不到启用 bot / 无法解析承接账号 / 无本机用户时
 * 只记录原因，不产生任何任务（宁可跳过，不可误发）。
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalEngineService } from './local-engine.service';
import { getProjectRoot } from './local-engine.utils';

const STATE_FILE_NAME = 'wechat-auto-reception-state.json';
const DEFAULT_INTERVAL_MS = 15_000;
const MIN_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 60_000;
/** force 重新同步微信聊天历史的最小间隔（避免高频调用采集脚本） */
const SYNC_FORCE_THROTTLE_MS = 60_000;

const WATERMARK_PER_SESSION_LIMIT = 200;

type ReceptionState = {
  enabled: boolean;
  /** sessionId -> 已处理的 incoming message id 列表（保留最近 200） */
  watermark: Record<string, string[]>;
  perSessionReason: Record<string, string>; // sessionId -> 最近一次跳过/失败原因
  todayCreated: number;
  todayDate: string;
  lastRunAt?: string;
  lastDetectedAt?: string;
  pausedReason?: string;
  /** 最近一次由 HTTP 请求刷新到的本机用户（controller 层提供，避免依赖库表猜测） */
  actor?: { tenantId?: string; userId?: string } | null;
};

type WechatHistoryCacheShape = {
  sessions: Array<{ id: string; title?: string; contactName?: string }>;
  messages: Array<{
    id: string;
    sessionId: string;
    direction: string;
    contentType: string;
    content: string;
    sentAt?: string;
  }>;
};

type GuardStatus = {
  running: boolean;
  enabled: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  lastDetectedAt: string | null;
  lastError: string | null;
  paused: boolean;
  pausedReason: string | null;
  detectedSessions: number;
  createdTasks: number;
  skipped: number;
  todayCreated: number;
  watermarkCount: number;
  reasons: Record<string, string>;
  bots: Array<{
    id: string;
    name: string;
    enabled: boolean;
    contactScope?: string;
  }>;
};

type EngineReplyBot = {
  id: string;
  name: string;
  enabled: boolean;
  config: {
    contactScope?: string;
    authorizedAccounts?: string[];
    defaultSendMode?: string;
  };
};

@Injectable()
export class WechatAutoReceptionGuardService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WechatAutoReceptionGuardService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastSyncForceAt = 0;
  private lastRunAt: string | null = null;
  private lastDetectedAt: string | null = null;
  private lastError: string | null = null;
  private detectedSessions = 0;
  private createdTasks = 0;
  private skipped = 0;
  private lastReasons: Record<string, string> = {};
  private lastBots: GuardStatus['bots'] = [];
  private state: ReceptionState = {
    enabled: true,
    watermark: {},
    perSessionReason: {},
    todayCreated: 0,
    todayDate: new Date().toISOString().slice(0, 10),
  };

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly engine: LocalEngineService,
  ) {}

  onModuleInit() {
    if (!this.enabled()) {
      this.logger.log(
        'Wechat auto-reception guard disabled by env WECHAT_AUTO_RECEPTION_ENABLED=false.',
      );
      return;
    }
    this.logger.log(
      'Wechat auto-reception guard armed (poll every ' +
        `${this.intervalMs()}ms; UI 开关可在「微信-自动接待」控制)`,
    );
    const intervalMs = this.intervalMs();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** env 缺省视为开启（功能可用性由 state.enabled + 各项门槛保护共同决定） */
  enabled() {
    const value = this.config.get<string>('WECHAT_AUTO_RECEPTION_ENABLED');
    if (value == null || String(value).trim() === '') return true;
    return this.readBoolean(value);
  }

  intervalMs() {
    const value = Number(
      this.config.get<string>('WECHAT_AUTO_RECEPTION_INTERVAL_MS'),
    );
    return Number.isFinite(value)
      ? Math.max(MIN_INTERVAL_MS, Math.min(value, MAX_INTERVAL_MS))
      : DEFAULT_INTERVAL_MS;
  }

  private asText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readBoolean(value: unknown) {
    return ['1', 'true', 'yes', 'on'].includes(
      this.asText(value).toLowerCase(),
    );
  }

  /* ---------------- 状态路径 ---------------- */

  private statePathFor(userId: string): string {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return join(this.runtimeLogRoot(), 'accounts', safeUserId, STATE_FILE_NAME);
  }

  private runtimeLogRoot(): string {
    const configured = process.env.KAYPAL_RUNTIME_LOG_ROOT?.trim();
    return configured ? configured : join(getProjectRoot(), '.local-logs');
  }

  /* ---------------- 公开状态 ---------------- */

  getStatus(): GuardStatus {
    return {
      running: this.running,
      enabled: this.state.enabled,
      intervalMs: this.intervalMs(),
      lastRunAt: this.lastRunAt,
      lastDetectedAt: this.lastDetectedAt,
      lastError: this.lastError,
      paused: Boolean(this.state.pausedReason),
      pausedReason: this.state.pausedReason ?? null,
      detectedSessions: this.detectedSessions,
      createdTasks: this.createdTasks,
      skipped: this.skipped,
      todayCreated: this.state.todayCreated,
      watermarkCount: Object.keys(this.state.watermark).length,
      reasons: this.lastReasons,
      bots: this.lastBots,
    };
  }

  async setEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    this.state.enabled = enabled;
    await this.persistState();
    return { enabled };
  }

  /* ---------------- 主循环 ---------------- */

  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      await this.loadState();
      if (!this.state.enabled) {
        return;
      }
      if (this.isPausedByUserTakeover()) {
        this.state.pausedReason = this.userTakeoverReason();
        await this.persistState();
        return;
      }
      this.state.pausedReason = undefined;
      const scope = await this.resolveActorScope();
      if (!scope) {
        this.recordSkip(
          '未找到本机用户上下文，本轮跳过（请先在应用内登录并触发一次微信任务）',
        );
        return;
      }
      await this.authRequestContext.run(
        {
          requestedTenantId: scope.tenantId,
          user: { id: scope.userId, kaypalLocalOnly: true },
        },
        async () => {
          await this.processTick(scope.userId);
        },
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Wechat auto-reception tick failed: ${this.lastError}`);
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
    }
  }

  private isPausedByUserTakeover(): boolean {
    const state = this.engine.wechatSessionConfirmation;
    return Boolean(state?.takeoverActive || state?.stoppedAt);
  }

  private userTakeoverReason(): string {
    const state = this.engine.wechatSessionConfirmation;
    if (state?.stoppedAt)
      return '微信会话已停止，守护暂停生成草稿（用户停止优先）。';
    return '用户正在人工接管微信会话，守护暂停生成草稿。';
  }

  private recordSkip(reason: string) {
    this.skipped += 1;
    this.lastReasons.general = reason;
    this.logger.log(`Wechat auto-reception skip: ${reason}`);
  }

  /**
   * 由 controller 在携带登录态的请求里刷新本机用户（主路径），
   * 避免守护在无 HTTP 上下文时依赖库表猜测用户。
   */
  async refreshActorFromUser(user: {
    id: string;
    kaypalLocalOnly?: boolean;
  }): Promise<void> {
    const userId = user?.id?.trim();
    if (!userId) return;
    this.state.actor = {
      userId,
      tenantId:
        user.kaypalLocalOnly === true ? `local-desktop:${userId}` : undefined,
    };
    await this.persistState();
  }

  /** 找当前本机用户：优先 HTTP 刷新到的 actor，回退最近任务行 */
  private async resolveActorScope(): Promise<
    { tenantId: string; userId: string } | undefined
  > {
    const actor = this.state.actor;
    if (actor?.userId) {
      return {
        tenantId: actor.tenantId || `local-desktop:${actor.userId}`,
        userId: actor.userId,
      };
    }
    try {
      const row = await this.prisma.interactionTask.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { tenantId: true, userId: true },
      });
      if (row?.tenantId && row?.userId) {
        return { tenantId: row.tenantId, userId: row.userId };
      }
    } catch (error) {
      this.logger.warn(
        `Actor fallback via interactionTask unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return undefined;
  }

  private async processTick(userId: string) {
    const bots = await this.listEligibleBots();
    this.lastBots = bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: bot.enabled,
      contactScope: bot.config?.contactScope,
    }));
    if (bots.length === 0) {
      this.recordSkip(
        '没有启用的客服机器人覆盖微信（contactScope=微信/全部），请先在互动-客服机器人启用',
      );
      return;
    }
    const accountName = await this.resolveWechatAccountName(userId);
    if (!accountName) {
      this.recordSkip(
        '暂未识别本机微信承接账号（先通过微信工作台创建过一条微信回复任务后自动学习）',
      );
      return;
    }
    const matchedBot = bots.find((bot) =>
      (bot.config?.authorizedAccounts || []).some(
        (name) => name.trim().toLowerCase() === accountName.toLowerCase(),
      ),
    );
    if (!matchedBot) {
      this.recordSkip(
        `微信承接账号「${accountName}」未授权到任何启用机器人，请在机器人配置的授权账号中添加`,
      );
      return;
    }

    // 受控 force 同步（节流），失败不阻塞：继续用既有缓存 diff
    if (Date.now() - this.lastSyncForceAt > SYNC_FORCE_THROTTLE_MS) {
      this.lastSyncForceAt = Date.now();
      try {
        await this.syncChatHistoryForce();
      } catch (error) {
        this.logger.warn(
          `Wechat chat history force sync failed (proceed with cache): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const cache = await this.readChatHistoryCache();
    if (!cache) {
      this.recordSkip('微信聊天历史缓存为空（本机尚未采集到微信消息）');
      return;
    }

    const newIncoming = this.findNewIncomingMessages(cache);
    if (newIncoming.length === 0) {
      return;
    }
    this.lastDetectedAt = new Date().toISOString();
    this.detectedSessions += newIncoming.length;
    this.lastReasons = {};

    let created = 0;
    for (const item of newIncoming) {
      try {
        // 红线：同一会话同一时刻只保留一条待确认草稿，避免确认列表堆积
        if (await this.hasPendingReplyDraft(userId, item.sessionName)) {
          this.state.perSessionReason[item.sessionId] =
            '该会话已有待确认的回复草稿，本轮跳过以免堆积（处理完上一条后再生成下一条）';
          this.lastReasons[item.sessionName] =
            this.state.perSessionReason[item.sessionId];
          this.markProcessed(item.sessionId, item.messageId);
          this.skipped += 1;
          continue;
        }
        await this.createReplyDraftTask({
          botId: matchedBot.id,
          accountName,
          targetName: item.sessionName,
          sourceText: item.content,
        });
        this.markProcessed(item.sessionId, item.messageId);
        delete this.state.perSessionReason[item.sessionId];
        created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.state.perSessionReason[item.sessionId] = message;
        this.lastReasons[item.sessionName] = message;
        this.skipped += 1;
        this.logger.warn(
          `Wechat auto-reception draft failed for ${item.sessionName}: ${message}`,
        );
      }
    }
    this.createdTasks += created;
    this.state.todayCreated += created;
    await this.persistState();
  }

  /* ---------------- 客服机器人与账号解析 ---------------- */

  private async listEligibleBots(): Promise<EngineReplyBot[]> {
    const host = this.engine as unknown as {
      listReplyBots(): Promise<EngineReplyBot[]>;
    };
    const bots = await host.listReplyBots();
    return (Array.isArray(bots) ? bots : []).filter(
      (bot) =>
        bot?.enabled === true &&
        (bot.config?.contactScope === 'wechat' ||
          bot.config?.contactScope === 'all' ||
          !bot.config?.contactScope),
    );
  }

  /** 从最近一条微信桌面任务学习承接账号名（先人工、后自动） */
  private async resolveWechatAccountName(userId: string): Promise<string> {
    const row = await this.prisma.interactionTask.findFirst({
      where: {
        userId,
        taskType: 'WECHAT_REPLY_DRAFT',
        status: { notIn: ['FAILED'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { config: true },
    });
    const config = (row?.config ?? {}) as Record<string, unknown>;
    const name = this.asText(config.accountName);
    if (name) return name;
    // 兼容一次任意微信类任务（contact-add / friend-accept）的账号名
    const anyWechat = await this.prisma.interactionTask.findFirst({
      where: {
        userId,
        taskType: { in: ['WECHAT_CONTACT_ADD', 'WECHAT_FRIEND_ACCEPT'] },
        status: { notIn: ['FAILED'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { config: true },
    });
    const anyConfig = (anyWechat?.config ?? {}) as Record<string, unknown>;
    return this.asText(anyConfig.accountName);
  }

  /** 该会话是否已有等待人工放行的微信回复草稿（per-session 唯一约束） */
  private async hasPendingReplyDraft(
    userId: string,
    targetName: string,
  ): Promise<boolean> {
    const rows = await this.prisma.interactionTask.findMany({
      where: {
        userId,
        taskType: 'WECHAT_REPLY_DRAFT',
        status: 'WAITING_FOR_SEND_CONFIRMATION',
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { config: true },
    });
    const target = targetName.trim().toLowerCase();
    return rows.some((row) => {
      const config = (row?.config ?? {}) as Record<string, unknown>;
      return this.asText(config.targetName).toLowerCase().includes(target);
    });
  }

  /** 把消息 id 记入水位（保留最近 200 条） */
  private markProcessed(sessionId: string, messageId: string) {
    const list = this.state.watermark[sessionId] || [];
    if (!list.includes(messageId)) {
      this.state.watermark[sessionId] = [...list, messageId].slice(
        -WATERMARK_PER_SESSION_LIMIT,
      );
    }
  }

  private async createReplyDraftTask(input: {
    botId: string;
    accountName: string;
    targetName: string;
    sourceText: string;
  }) {
    const host = this.engine as unknown as {
      createCustomerServiceReplyTask(
        botId: string,
        payload: {
          accountName?: string;
          platform?: 'wechat';
          targetName?: string;
          sourceText?: string;
          sendMode?: 'approval-send' | 'draft-only';
          commercialExecutionRequested?: boolean;
        },
      ): Promise<unknown>;
    };
    await host.createCustomerServiceReplyTask(input.botId, {
      accountName: input.accountName,
      platform: 'wechat',
      targetName: input.targetName,
      sourceText: input.sourceText,
      // 守护永不请求直发：无论 bot 配什么发送策略，都收敛为「确认后发送」
      sendMode: 'approval-send',
      commercialExecutionRequested: false,
    });
  }

  /* ---------------- 消息探测与水位 ---------------- */

  private async syncChatHistoryForce() {
    const host = this.engine as unknown as {
      syncWechatChatHistory(input: { force?: boolean }): Promise<unknown>;
    };
    await host.syncWechatChatHistory({ force: true });
  }

  private async readChatHistoryCache(): Promise<WechatHistoryCacheShape | null> {
    const host = this.engine as unknown as {
      readWechatChatHistoryCache(): Promise<unknown>;
    };
    try {
      const cache = (await host.readWechatChatHistoryCache()) as {
        sessions?: Array<{ id: string; title?: string; contactName?: string }>;
        messages?: Array<{
          id: string;
          sessionId: string;
          direction: string;
          contentType: string;
          content: string;
          sentAt?: string;
        }>;
      };
      if (!Array.isArray(cache?.sessions) || !Array.isArray(cache?.messages)) {
        return null;
      }
      return { sessions: cache.sessions, messages: cache.messages };
    } catch {
      return null;
    }
  }

  private findNewIncomingMessages(cache: WechatHistoryCacheShape) {
    const sessionById = new Map(
      cache.sessions.map((session) => [session.id, session]),
    );
    // 时间升序取未处理消息，按会话归组后每会话取最新一条（避免一条条打扰客户）
    const unprocessed = cache.messages
      .filter(
        (message) =>
          message.direction === 'incoming' &&
          message.contentType === 'text' &&
          message.content?.trim() &&
          !(this.state.watermark[message.sessionId] || []).includes(message.id),
      )
      .sort((a, b) => (a.sentAt || '').localeCompare(b.sentAt || ''));
    const newestBySession = new Map<string, (typeof cache.messages)[number]>();
    for (const message of unprocessed) {
      const current = newestBySession.get(message.sessionId);
      if (!current || (message.sentAt || '') >= (current.sentAt || '')) {
        newestBySession.set(message.sessionId, message);
      }
    }
    const result: Array<{
      sessionId: string;
      sessionName: string;
      messageId: string;
      content: string;
    }> = [];
    for (const message of newestBySession.values()) {
      const session = sessionById.get(message.sessionId);
      result.push({
        sessionId: message.sessionId,
        sessionName: session?.title || session?.contactName || '微信客户',
        messageId: message.id,
        content: message.content,
      });
    }
    return result;
  }

  /* ---------------- 状态持久化 ---------------- */

  private async loadState() {
    try {
      const scope = await this.resolveActorScope();
      if (!scope) return;
      const raw = await readFile(this.statePathFor(scope.userId), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ReceptionState>;
      const rawActor =
        parsed.actor && parsed.actor.userId ? parsed.actor : null;
      this.state.actor = rawActor;
      const rawWatermark = parsed.watermark || {};
      const safeWatermark: Record<string, string[]> = {};
      for (const [sessionId, value] of Object.entries(rawWatermark)) {
        safeWatermark[sessionId] = (Array.isArray(value) ? value : [])
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(-WATERMARK_PER_SESSION_LIMIT);
      }
      this.state = {
        enabled: parsed.enabled ?? true,
        watermark: safeWatermark,
        perSessionReason: parsed.perSessionReason || {},
        todayCreated: parsed.todayCreated || 0,
        todayDate: parsed.todayDate || '',
        lastRunAt: parsed.lastRunAt,
        lastDetectedAt: parsed.lastDetectedAt,
        pausedReason: parsed.pausedReason,
        actor:
          rawActor && rawActor.userId
            ? { tenantId: rawActor.tenantId, userId: rawActor.userId }
            : this.state.actor,
      };
      const today = new Date().toISOString().slice(0, 10);
      if (this.state.todayDate !== today) {
        this.state.todayDate = today;
        this.state.todayCreated = 0;
      }
    } catch {
      // 首次运行或损坏：保持默认
    }
  }

  private async persistState() {
    try {
      const scope = await this.resolveActorScope();
      if (!scope) return;
      const path = this.statePathFor(scope.userId);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      this.logger.warn(
        `Wechat auto-reception state persist failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
