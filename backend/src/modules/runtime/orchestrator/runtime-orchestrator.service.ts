/**
 * RuntimeOrchestrator · Runtime 统一入口
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md §4
 * 配合 P3-D1 的"切上层 + 双跑"使用
 *
 * 职责：
 * 1. 把 ExecutorRouter.route() 包装成上层友好的单一入口
 * 2. 统一给真实外部动作加云端积分冻结/结算护栏
 * 3. 不持久化、不调度——EvidenceService 已在 ExecutorRouter.route() 末尾自动触发
 * 4. P3-D1 实际切换：把 LocalEngineService 中穿透到 LocalInteractionExecutorService
 *    的方法逐步改成调本 service（按调用点一个个切，per-call hard switch）
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRequestContextService } from '../../../common/auth-request-context.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { KaypalAuthClient } from '../../auth/kaypal-auth.client';
import { ExecutorRouter } from '../executor-router';
import {
  type ExecutorContext,
  type ExecutorTask,
  type ExecutorTaskType,
  type RuntimeExecutionResult,
  rejectResult,
} from '../executor.interface';
import { KaypalProviderResolver } from '../../ai-models/kaypal-provider.resolver';

const DEFAULT_KAYPAL_AUTH_BASE_URL = 'https://kaypal.cn';

const BILLABLE_RUNTIME_TASK_TYPES = new Set<ExecutorTaskType>([
  'douyin-comment-reply',
  'douyin-direct-message-reply',
  'wechat-channel-comment-reply',
  'wechat-channel-direct-message-reply',
  'wechat-reply-draft',
  'wechat-group-broadcast',
  'wechat-contact-add',
  'wechat-moments-publish',
  'wechat-moments-marketing',
  'customer-follow-up',
  'video-template-clip',
  'video-face-swap',
  'platform-publish-image-text',
  'platform-publish-video',
]);

interface RuntimeBillingReservation {
  status: 'charged';
  amount: number;
  reservationId: string;
  balanceAfter?: number;
  policyVersion?: string;
  idempotencyKey: string;
}

type RuntimeBillingContextIdentity = NonNullable<
  NonNullable<ExecutorContext['billing']>['identity']
>;

interface RuntimeBillingAuthIdentity {
  userId: string;
  authSource: 'desktop-token' | 'server-api-key';
  headers: Record<string, string>;
}

interface RuntimeBillingResponse {
  response: Response;
  payloadRecord: Record<string, unknown> | null;
}

@Injectable()
export class RuntimeOrchestrator {
  private readonly logger = new Logger(RuntimeOrchestrator.name);

  constructor(
    private readonly router: ExecutorRouter,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly config?: ConfigService,
    @Optional()
    private readonly kaypalClient?: KaypalAuthClient,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * 执行单个互动任务。
   *
   * 等价于直接调 ExecutorRouter.route()——P2-D4 后 ExecutorRouter 已自动
   * 调 EvidenceService 持久化，调用方无需额外关心。
   *
   * @returns 总是返回 RuntimeExecutionResult，不抛异常。
   */
  async execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    this.logger.debug(
      `RuntimeOrchestrator.execute: task=${task.relatedId} platform=${task.platform} type=${task.type}`,
    );

    if (!this.shouldBillRuntimeTask(task, ctx)) {
      return this.router.route(task, ctx);
    }

    const billingStartedAt = Date.now();
    const reservation = await this.reserveRuntimeCredits(task, ctx).catch(
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Runtime billing reserve blocked task=${task.relatedId} type=${task.type}: ${message}`,
        );
        return null;
      },
    );

    if (!reservation) {
      return {
        ...rejectResult(
          'permission_missing',
          '真实执行需要先完成云端积分冻结，本次动作已拦截。',
          'runtime billing reserve failed',
        ),
        billing: {
          status: 'failed',
          amount: 0,
          message:
            '真实执行扣积分需要当前账号接通 Kaypal 云端授权，并且积分余额足够。',
        },
      };
    }

    try {
      const result = await this.router.route(task, ctx);
      if (result.status === 'blocked' || result.status === 'skipped') {
        await this.releaseRuntimeCredits(
          reservation,
          `Runtime task ${task.type} ended as ${result.status}: ${result.userMessage}`,
          task,
          ctx,
        ).catch((error) => {
          this.logger.warn(
            `Runtime billing release failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
        return {
          ...result,
          billing: {
            status: 'skipped',
            amount: 0,
            reservationId: reservation.reservationId,
            idempotencyKey: reservation.idempotencyKey,
            message: '任务未进入真实执行，已释放冻结积分。',
          },
        };
      }

      const billing = await this.captureRuntimeCredits(
        reservation,
        task,
        ctx,
        result,
        billingStartedAt,
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Runtime billing capture failed after task=${task.relatedId}: ${message}`,
        );
        return {
          status: 'failed' as const,
          amount: 0,
          reservationId: reservation.reservationId,
          idempotencyKey: reservation.idempotencyKey,
          message: `动作已执行，但云端结算积分失败：${message}`,
        };
      });

      return {
        ...result,
        userMessage:
          billing.status === 'failed'
            ? `${result.userMessage}；${billing.message}`
            : result.userMessage,
        billing,
      };
    } catch (error) {
      await this.releaseRuntimeCredits(
        reservation,
        `Runtime task threw: ${error instanceof Error ? error.message : String(error)}`,
        task,
        ctx,
      ).catch((releaseError) => {
        this.logger.warn(
          `Runtime billing release after throw failed: ${
            releaseError instanceof Error
              ? releaseError.message
              : String(releaseError)
          }`,
        );
      });
      throw error;
    }
  }

  /**
   * 健康检查所有已注册执行器。
   * 薄包装，方便上层一个方法拿到所有执行器状态。
   */
  async healthCheck(): Promise<
    Array<{ id: string; ok: boolean; details?: string }>
  > {
    return this.router.healthCheck();
  }

  private shouldBillRuntimeTask(task: ExecutorTask, ctx: ExecutorContext) {
    if (ctx.billing?.covered) return false;
    if (!BILLABLE_RUNTIME_TASK_TYPES.has(task.type)) return false;
    if (task.type === 'wechat-reply-draft' && ctx.sendMode !== 'auto-send') {
      return false;
    }
    return true;
  }

  private async reserveRuntimeCredits(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeBillingReservation> {
    const identity = await this.getKaypalBillingIdentity(ctx);
    const idempotencyKey = this.buildBillingIdempotencyKey(task);
    const estimatedActions = this.estimateActionCount(task);
    const amount = this.resolveBillingAmount(task);
    const estimatedRuntimeMinutes = this.readPositiveNumberConfig(
      'KAYPAL_RUNTIME_TASK_RESERVE_RUNTIME_MINUTES',
      task.type === 'video-face-swap'
        ? 30
        : task.type === 'video-template-clip'
          ? 20
          : 10,
    );

    const { response, payloadRecord } =
      await this.postRuntimeBillingJsonWithFallback(
        '/api/billing/reserve',
        identity,
        {
          user_id: identity.userId,
          amount,
          service_type: 'runtime_automation',
          resource_type: this.resolveResourceType(task),
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            commercialBilling: true,
            idempotencyKey,
            mode: 'runtime_task',
            taskType: task.type,
            phase: 'reserve',
            relatedId: task.relatedId,
            relatedType: task.relatedType,
            platform: task.platform,
            accountId: task.accountId,
            sendMode: ctx.sendMode,
            runtimeMinutes: estimatedRuntimeMinutes,
            replies: this.isReplyTask(task.type) ? estimatedActions : 0,
            platformActions: this.isPlatformActionTask(task.type)
              ? estimatedActions
              : 0,
            articlePublishes:
              task.type === 'platform-publish-image-text'
                ? estimatedActions
                : 0,
            videoPublishes:
              task.type === 'platform-publish-video' ? estimatedActions : 0,
            evidences: estimatedActions,
            ...this.summarizePayloadForBilling(task),
          },
        },
      );
    if (!response.ok) {
      throw new Error(
        this.getBillingResponseError(payloadRecord, response.status),
      );
    }
    const billingRecord = this.asRecord(payloadRecord?.billing);
    const reservationId =
      typeof payloadRecord?.id === 'string' ? payloadRecord.id : undefined;
    if (!reservationId) {
      throw new Error('Kaypal 云端冻结积分未返回 reservation id。');
    }
    return {
      status: 'charged',
      amount,
      reservationId,
      balanceAfter:
        this.extractBillingBalanceValue(payloadRecord) ??
        this.extractBillingBalanceValue(billingRecord) ??
        undefined,
      policyVersion:
        typeof billingRecord?.policyVersion === 'string'
          ? billingRecord.policyVersion
          : undefined,
      idempotencyKey,
    };
  }

  private async captureRuntimeCredits(
    reservation: RuntimeBillingReservation,
    task: ExecutorTask,
    ctx: ExecutorContext,
    result: RuntimeExecutionResult,
    startedAt: number,
  ): Promise<NonNullable<RuntimeExecutionResult['billing']>> {
    const identity = await this.getKaypalBillingIdentity(ctx);
    const actionCount = this.estimateActionCount(task);
    const successfulActions = result.ok ? actionCount : 0;
    const amount = Math.max(
      1,
      Math.floor(reservation.amount || this.resolveBillingAmount(task)),
    );
    const runtimeMinutes = Math.max(
      1,
      Math.ceil((Date.now() - startedAt) / 60_000),
    );

    const { response, payloadRecord } =
      await this.postRuntimeBillingJsonWithFallback(
        '/api/billing/capture',
        identity,
        {
          user_id: identity.userId,
          reservation_id: reservation.reservationId,
          amount,
          service_type: 'runtime_automation',
          resource_type: this.resolveResourceType(task),
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            commercialBilling: true,
            idempotencyKey: reservation.idempotencyKey,
            mode: 'runtime_task',
            taskType: task.type,
            phase: 'capture',
            relatedId: task.relatedId,
            relatedType: task.relatedType,
            platform: task.platform,
            accountId: task.accountId,
            sendMode: ctx.sendMode,
            status: result.status,
            reasonCode: result.reasonCode,
            runtimeMinutes,
            replies: this.isReplyTask(task.type) ? successfulActions : 0,
            platformActions: this.isPlatformActionTask(task.type)
              ? successfulActions
              : 0,
            articlePublishes:
              task.type === 'platform-publish-image-text'
                ? successfulActions
                : 0,
            videoPublishes:
              task.type === 'platform-publish-video' ? successfulActions : 0,
            evidences: result.evidence?.length ?? 0,
            ...this.summarizePayloadForBilling(task),
          },
        },
      );
    if (!response.ok) {
      throw new Error(
        this.getBillingResponseError(payloadRecord, response.status),
      );
    }
    const billingRecord = this.asRecord(payloadRecord?.billing);
    return {
      status: 'charged',
      amount:
        this.numberValue(billingRecord?.amount) ??
        this.numberValue(payloadRecord?.amount) ??
        0,
      reservationId: reservation.reservationId,
      transactionId:
        typeof payloadRecord?.id === 'string' ? payloadRecord.id : undefined,
      balanceAfter:
        this.extractBillingBalanceValue(payloadRecord) ??
        this.extractBillingBalanceValue(billingRecord) ??
        undefined,
      policyVersion:
        typeof billingRecord?.policyVersion === 'string'
          ? billingRecord.policyVersion
          : undefined,
      idempotencyKey: reservation.idempotencyKey,
    };
  }

  private async releaseRuntimeCredits(
    reservation: RuntimeBillingReservation,
    reason: string,
    task: ExecutorTask,
    ctx: ExecutorContext,
  ) {
    const identity = await this.getKaypalBillingIdentity(ctx);
    const { response, payloadRecord } =
      await this.postRuntimeBillingJsonWithFallback(
        '/api/billing/release',
        identity,
        {
          user_id: identity.userId,
          reservation_id: reservation.reservationId,
          reason,
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            idempotencyKey: reservation.idempotencyKey,
            commercialBilling: true,
            mode: 'runtime_task',
            phase: 'release',
            taskType: task.type,
            relatedId: task.relatedId,
            relatedType: task.relatedType,
            platform: task.platform,
            accountId: task.accountId,
            sendMode: ctx.sendMode,
            billingAmount: reservation.amount,
            reason,
            ...this.summarizePayloadForBilling(task),
          },
        },
      );
    if (!response.ok) {
      throw new Error(
        this.getBillingResponseError(payloadRecord, response.status),
      );
    }
  }

  private async getKaypalBillingIdentity(
    ctx: ExecutorContext,
  ): Promise<RuntimeBillingAuthIdentity> {
    const contextUser = this.authRequestContext?.get()?.user;
    const billingIdentity = ctx.billing?.identity;
    const session = await this.getKaypalBillingSession(billingIdentity);
    const sessionMetadata = session?.metadata || null;
    const userId =
      billingIdentity?.kaypalUserId?.trim() ||
      contextUser?.kaypalUserId?.trim() ||
      session?.kaypalUserId?.trim() ||
      '';
    let token =
      billingIdentity?.kaypalDesktopAccessToken?.trim() ||
      contextUser?.kaypalDesktopAccessToken?.trim() ||
      this.textValue(sessionMetadata?.kaypalDesktopAccessToken) ||
      '';
    const refreshToken =
      billingIdentity?.kaypalDesktopRefreshToken?.trim() ||
      contextUser?.kaypalDesktopRefreshToken?.trim() ||
      this.textValue(sessionMetadata?.kaypalDesktopRefreshToken) ||
      '';
    const deviceId =
      billingIdentity?.kaypalDesktopDeviceId?.trim() ||
      contextUser?.kaypalDesktopDeviceId?.trim() ||
      this.textValue(sessionMetadata?.kaypalDesktopDeviceId) ||
      '';
    const tokenExpiresAt =
      billingIdentity?.kaypalDesktopTokenExpiresAt ||
      contextUser?.kaypalDesktopTokenExpiresAt ||
      this.textValue(sessionMetadata?.kaypalDesktopTokenExpiresAt);

    if (
      refreshToken &&
      deviceId &&
      this.kaypalClient &&
      (!token || this.isKaypalTokenExpiring(tokenExpiresAt))
    ) {
      try {
        const refreshed = await this.kaypalClient.refreshDesktopAuthToken({
          refreshToken,
          deviceId,
        });
        token = refreshed.access_token;
        await this.persistRefreshedKaypalBillingSession(
          billingIdentity,
          sessionMetadata,
          refreshed,
        );
      } catch (error) {
        const serverIdentity = this.getKaypalServerBillingIdentity(userId);
        if (serverIdentity) {
          this.logger.warn(
            `Runtime billing desktop token refresh failed, falling back to server billing key: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return serverIdentity;
        }
        throw error;
      }
    }

    if (userId && token) {
      return {
        userId,
        authSource: 'desktop-token',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };
    }

    const serverIdentity = this.getKaypalServerBillingIdentity(userId);
    if (serverIdentity) {
      return serverIdentity;
    }

    throw new Error(
      '真实执行扣积分需要当前账号接通 Kaypal 云端授权，或后端配置 KAYPAL_API_KEY/KAYPAL_AI_PROXY_API_KEY 后再执行。',
    );
  }

  private async getKaypalBillingSession(
    billingIdentity: RuntimeBillingContextIdentity | undefined,
  ) {
    const sessionId = billingIdentity?.sessionId?.trim();
    if (!sessionId || !this.prisma) {
      return null;
    }

    const session = await this.prisma.system.userSession
      .findFirst({
        where: {
          id: sessionId,
          userId: billingIdentity?.localUserId?.trim() || undefined,
          expiresAt: { gt: new Date() },
        },
        select: {
          metadata: true,
          user: {
            select: {
              kaypalUserId: true,
            },
          },
        },
      })
      .catch((error) => {
        this.logger.warn(
          `Runtime billing session lookup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      });

    if (!session) {
      return null;
    }

    return {
      kaypalUserId: session.user?.kaypalUserId || null,
      metadata: this.toMetadataRecord(session.metadata),
    };
  }

  private async persistRefreshedKaypalBillingSession(
    billingIdentity: RuntimeBillingContextIdentity | undefined,
    metadata: Record<string, unknown> | null,
    refreshed: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      device_id?: string;
    },
  ) {
    const sessionId = billingIdentity?.sessionId?.trim();
    if (!sessionId || !this.prisma) {
      return;
    }
    await this.prisma.system.userSession
      .update({
        where: { id: sessionId },
        data: {
          metadata: {
            ...(metadata || {}),
            kaypalDesktopAccessToken: refreshed.access_token,
            kaypalDesktopRefreshToken: refreshed.refresh_token,
            kaypalDesktopTokenExpiresAt: new Date(
              Date.now() + refreshed.expires_in * 1000,
            ).toISOString(),
            kaypalDesktopDeviceId:
              refreshed.device_id ||
              billingIdentity?.kaypalDesktopDeviceId ||
              this.textValue(metadata?.kaypalDesktopDeviceId),
          },
        },
      })
      .catch((error) => {
        this.logger.warn(
          `Runtime billing token refresh persistence failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private async postRuntimeBillingJsonWithFallback(
    path:
      '/api/billing/reserve' | '/api/billing/capture' | '/api/billing/release',
    identity: RuntimeBillingAuthIdentity,
    body: Record<string, unknown>,
  ): Promise<RuntimeBillingResponse> {
    let result = await this.postRuntimeBillingJson(path, identity, body);
    if (
      !result.response.ok &&
      identity.authSource === 'desktop-token' &&
      this.isBillingAuthFailure(result.response.status, result.payloadRecord)
    ) {
      const fallbackIdentity = this.getKaypalServerBillingIdentity(
        identity.userId,
      );
      if (fallbackIdentity) {
        result = await this.postRuntimeBillingJson(
          path,
          fallbackIdentity,
          body,
        );
      }
    }
    return result;
  }

  private async postRuntimeBillingJson(
    path:
      '/api/billing/reserve' | '/api/billing/capture' | '/api/billing/release',
    identity: RuntimeBillingAuthIdentity,
    body: Record<string, unknown>,
  ): Promise<RuntimeBillingResponse> {
    const response = await fetch(new URL(path, this.getKaypalCloudBaseUrl()), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...identity.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        this.readPositiveNumberConfig(
          'KAYPAL_RUNTIME_BILLING_TIMEOUT_MS',
          8000,
        ),
      ),
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    return {
      response,
      payloadRecord: this.asRecord(payload),
    };
  }

  private getKaypalServerBillingIdentity(
    userId: string,
  ): RuntimeBillingAuthIdentity | null {
    const serverApiKey = this.getKaypalServerBillingApiKey();
    if (!userId || !serverApiKey) return null;
    return {
      userId,
      authSource: 'server-api-key',
      headers: {
        'x-kaypal-api-key': serverApiKey,
        'x-kaypal-user-id': userId,
      },
    };
  }

  private getKaypalServerBillingApiKey() {
    return (
      this.config?.get<string>('KAYPAL_API_KEY')?.trim() ||
      this.config?.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      process.env.KAYPAL_API_KEY?.trim() ||
      process.env.KAYPAL_AI_PROXY_API_KEY?.trim() ||
      ''
    );
  }

  private isBillingAuthFailure(
    status: number,
    payloadRecord: Record<string, unknown> | null,
  ) {
    const message = this.getBillingResponseError(payloadRecord, status);
    return status === 401 || /login|unauthorized|授权|token/i.test(message);
  }

  private toMetadataRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string' && value.trim()) {
      try {
        return this.asRecord(JSON.parse(value));
      } catch {
        return null;
      }
    }
    return this.asRecord(value);
  }

  private isKaypalTokenExpiring(expiresAt: unknown) {
    if (typeof expiresAt !== 'string' || !expiresAt.trim()) return false;
    const ms = Date.parse(expiresAt);
    return Number.isFinite(ms) && ms <= Date.now() + 60_000;
  }

  private getKaypalCloudBaseUrl() {
    // Stage 1A：host 统一经 KaypalProviderResolver 校验（fail-closed）。
    // 该地址用于云端积分冻结/结算，env 被篡改会把用户 token 打到第三方。
    return KaypalProviderResolver.resolveBaseUrlFrom(
      [
        this.config?.get<string>('KAYPAL_AUTH_BASE_URL'),
        process.env.KAYPAL_AUTH_BASE_URL,
      ],
      DEFAULT_KAYPAL_AUTH_BASE_URL,
      this.config?.get<string>('KAYPAL_EXTRA_ALLOWED_HOSTS'),
    );
  }

  private readPositiveNumberConfig(key: string, fallback: number) {
    const value = Number(
      this.config?.get<string>(key) || process.env[key] || '',
    );
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private buildBillingIdempotencyKey(task: ExecutorTask) {
    return `ai-content:runtime:${task.type}:${task.relatedType}:${task.relatedId}`.slice(
      0,
      160,
    );
  }

  private resolveResourceType(task: ExecutorTask) {
    return task.type === 'video-template-clip' ||
      task.type === 'video-face-swap'
      ? 'runtime_automation'
      : 'platform_action';
  }

  private resolveBillingAmount(task: ExecutorTask) {
    const payload = task.payload || {};
    const amount = this.firstPositiveNumber(payload, [
      'billingAmount',
      'acceptedCostPoints',
      'estimatedCostPoints',
    ]);
    if (!amount) {
      if (task.type === 'video-face-swap') {
        throw new Error('视频换脸缺少服务端计费金额，已拒绝真实执行。');
      }
      return 10;
    }
    return Math.max(1, Math.min(100_000, Math.floor(amount)));
  }

  private estimateActionCount(task: ExecutorTask) {
    const payload = task.payload || {};
    const direct = this.firstPositiveNumber(payload, [
      'targetCount',
      'recipientCount',
      'selectedCount',
      'count',
      'quantity',
    ]);
    if (direct > 0) return Math.max(1, Math.floor(direct));
    for (const key of ['targets', 'recipients', 'messages', 'accounts']) {
      const value = payload[key];
      if (Array.isArray(value) && value.length > 0) return value.length;
    }
    return 1;
  }

  private isReplyTask(type: ExecutorTaskType) {
    return (
      type === 'douyin-comment-reply' ||
      type === 'douyin-direct-message-reply' ||
      type === 'wechat-channel-comment-reply' ||
      type === 'wechat-channel-direct-message-reply' ||
      type === 'wechat-reply-draft' ||
      type === 'customer-follow-up'
    );
  }

  private isPlatformActionTask(type: ExecutorTaskType) {
    return type !== 'video-template-clip' && type !== 'video-face-swap';
  }

  private summarizePayloadForBilling(
    task: ExecutorTask,
  ): Record<string, unknown> {
    const payload = task.payload || {};
    return {
      contentKind: this.textValue(payload.contentKind),
      platformType: this.textValue(payload.platformType),
      scheduleTime: this.textValue(payload.scheduleTime),
      durationSeconds: this.firstPositiveNumber(payload, ['durationSeconds']),
      operationMode: this.textValue(payload.mode),
      faceSwapMode: this.textValue(payload.mode),
      processors: Array.isArray(payload.processors)
        ? payload.processors.filter((item) => typeof item === 'string')
        : undefined,
      outputName: this.textValue(payload.outputName),
      billingAmount: this.firstPositiveNumber(payload, ['billingAmount']),
      estimatedCostPoints: this.firstPositiveNumber(payload, [
        'estimatedCostPoints',
      ]),
      acceptedCostPoints: this.firstPositiveNumber(payload, [
        'acceptedCostPoints',
      ]),
      targetCount: this.estimateActionCount(task),
    };
  }

  private firstPositiveNumber(
    record: Record<string, unknown>,
    keys: string[],
  ): number {
    for (const key of keys) {
      const value = this.numberValue(record[key]);
      if (value && value > 0) return value;
    }
    return 0;
  }

  private textValue(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private extractBillingBalanceValue(record: Record<string, unknown> | null) {
    const nestedBilling = this.asRecord(record?.billing);
    const balanceRecord =
      this.asRecord(record?.balance) ||
      this.asRecord(nestedBilling?.balance) ||
      this.asRecord(record?.creditBalance);
    return (
      this.numberValue(record?.balanceAfter) ??
      this.numberValue(record?.balance) ??
      this.numberValue(record?.credits) ??
      this.numberValue(record?.availableCredits) ??
      this.numberValue(record?.available_credits) ??
      this.numberValue(balanceRecord?.balance) ??
      null
    );
  }

  private getBillingResponseError(
    payload: Record<string, unknown> | null,
    status: number,
  ) {
    const message =
      (typeof payload?.message === 'string' && payload.message.trim()) ||
      (typeof payload?.error === 'string' && payload.error.trim()) ||
      '';
    return message || `Kaypal 云端扣积分接口返回 ${status}`;
  }
}
