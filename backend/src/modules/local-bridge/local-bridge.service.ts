import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AutoUploadAccount,
  AutoUploadPublishBatchResult,
  AutoUploadPublishPayload,
} from '../auto-upload/auto-upload.client';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import {
  computePublishRequestHash,
  DurablePublishCommandCoordinator,
  DurablePublishIdempotencyConflictError,
} from '../auto-upload/durable-publish-command.coordinator';
import { PublishRecordStore } from '../auto-upload/publish-record.store';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PlatformAdapterRegistry } from '../platform-registry/platform-adapter.registry';
import {
  LOCAL_BRIDGE_ACTIONS,
  LOCAL_BRIDGE_PROTOCOL,
  LOCAL_BRIDGE_VERSION,
  type LocalBridgeAccount,
  type LocalBridgeAccountStatus,
  type LocalBridgeAction,
  type LocalBridgeCancelTaskRequest,
  type LocalBridgeCancelTaskResult,
  type LocalBridgeExecutePublishRequest,
  type LocalBridgeExecutePublishAcceptedResult,
  type LocalBridgePlatformCapability,
  type LocalBridgeResponse,
  type LocalBridgeStatus,
  type LocalBridgeTaskState,
  type LocalBridgeTaskStatus,
} from './local-bridge.contract';
import {
  LOCAL_BRIDGE_ERROR_CODES,
  LocalBridgeError,
} from './local-bridge.errors';

const PLATFORM_KEYS_BY_TYPE: Readonly<Record<number, string>> = {
  1: 'xiaohongshu',
  2: 'wechat-channel',
  3: 'douyin',
  4: 'kuaishou',
  5: 'bilibili',
  6: 'weibo',
  7: 'zhihu',
  8: 'toutiao',
  9: 'wechat-official',
};

const EXECUTE_REQUEST_KEYS = new Set([
  'confirmationId',
  'idempotencyKey',
  'payloads',
]);
const PUBLISH_PAYLOAD_KEYS = new Set([
  'type',
  'accountIds',
  'contentKind',
  'articleId',
  'body',
  'sourceIdentity',
  'accountIdentity',
  'title',
  'tags',
  'fileList',
  'accountList',
  'enableTimer',
  'videosPerDay',
  'dailyTimes',
  'startDays',
  'timeJitterMinutes',
  'scheduleTime',
  'debugDryRun',
  'debugDryRunHoldBrowser',
  'skipAccountCheck',
  'category',
  'coverPath',
  'coverPaths',
  'biliTitle',
  'biliType',
  'biliPartition',
  'biliDesc',
]);
const SOURCE_IDENTITY_KEYS = new Set([
  'sourceType',
  'sourceId',
  'title',
  'contentType',
  'contentFormat',
  'updatedAt',
]);
const ACCOUNT_IDENTITY_KEYS = new Set(['id', 'name', 'platform', 'status']);
const CANCEL_REQUEST_KEYS = new Set(['reason']);
const TERMINAL_FAILURE_STATUSES = new Set([
  'failed',
  'account_expired',
  'material_error',
  'login_required',
  'blocked',
  'not_integrated',
  'skipped',
]);

@Injectable()
export class LocalBridgeService {
  constructor(
    private readonly autoUploadService: AutoUploadService,
    private readonly platformRegistry: PlatformAdapterRegistry,
    private readonly coordinator: DurablePublishCommandCoordinator,
    private readonly publishRecordStore: PublishRecordStore,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  async getStatus(): Promise<LocalBridgeStatus> {
    try {
      const health = await this.autoUploadService.getHealth();
      return {
        online: health.online,
        status: health.status,
        service: 'jiuzhang-local-bridge',
        version: health.version || '1.0.0',
        protocolVersion: LOCAL_BRIDGE_VERSION,
        actions: Object.values(LOCAL_BRIDGE_ACTIONS),
        checkedAt: health.checkedAt || new Date().toISOString(),
      };
    } catch {
      throw new LocalBridgeError(
        LOCAL_BRIDGE_ERROR_CODES.ENGINE_UNAVAILABLE,
        '本地发布引擎暂不可用',
        503,
      );
    }
  }

  async respond<T>(
    traceId: string | undefined,
    action: LocalBridgeAction,
    read: () => T | Promise<T>,
  ): Promise<LocalBridgeResponse<T>> {
    const timestamp = Date.now();
    try {
      const normalizedTraceId = this.requireTraceId(traceId);
      const data = await read();
      return {
        protocol: LOCAL_BRIDGE_PROTOCOL,
        version: LOCAL_BRIDGE_VERSION,
        type: 'response',
        traceId: normalizedTraceId,
        action,
        ok: true,
        code: 200,
        message: 'ok',
        data,
        timestamp,
      };
    } catch (error) {
      const bridgeError =
        error instanceof LocalBridgeError
          ? error
          : new LocalBridgeError(
              LOCAL_BRIDGE_ERROR_CODES.INTERNAL_ERROR,
              'Local Bridge 请求处理失败',
              500,
            );
      return {
        protocol: LOCAL_BRIDGE_PROTOCOL,
        version: LOCAL_BRIDGE_VERSION,
        type: 'response',
        traceId: this.normalizeTraceId(traceId) || `srv-${randomUUID()}`,
        action,
        ok: false,
        code: bridgeError.code,
        errorCode: bridgeError.errorCode,
        message: bridgeError.message,
        data: null,
        timestamp,
      };
    }
  }

  listCapabilities(): LocalBridgePlatformCapability[] {
    return this.platformRegistry.listCapabilities();
  }

  async listAccounts(): Promise<LocalBridgeAccount[]> {
    const accounts = await this.autoUploadService.listAccounts({
      validate: false,
      force: false,
    });
    return accounts.map((account) => this.toBridgeAccount(account));
  }

  async executePublish(
    request: LocalBridgeExecutePublishRequest,
  ): Promise<LocalBridgeExecutePublishAcceptedResult> {
    this.validateExecuteRequest(request);

    const scope = await this.publishRecordStore.resolveOwnerScope();
    const requestHash = computePublishRequestHash(request.payloads);
    const authSession = this.authRequestContext.get();
    const sessionId = authSession?.sessionId?.trim() || '';

    const input = {
      title: `Local Bridge 发布 ${request.idempotencyKey}`,
      platformType: request.payloads[0]?.type ?? 0,
      accountFile: '',
      fileList: [],
      tags: [],
      dryRun: false,
      payloads: request.payloads,
      result: {
        platforms: [],
        summary: {
          total: 0,
          success: 0,
          failed: 0,
          accountExpired: 0,
          materialError: 0,
          loginRequired: 0,
          pendingManual: 0,
          blocked: 0,
          notIntegrated: 0,
        },
      },
      idempotencyKey: request.idempotencyKey,
      requestHash,
      confirmationId: request.confirmationId,
      authSessionId: sessionId,
    };

    try {
      const result = await this.coordinator.executeDurablePublish(
        scope,
        input,
        {
          confirmationId: request.confirmationId,
          action: 'publish',
          riskLevel: 'high',
        },
        {
          tenantId: scope.tenantId,
          userId: scope.userId,
          sessionId,
          operator: authSession?.user?.kaypalRole || scope.userId,
        },
      );

      return {
        accepted: true,
        taskId: result.record.publicId,
        status: 'waiting',
        idempotencyKey: request.idempotencyKey,
      };
    } catch (error) {
      if (error instanceof DurablePublishIdempotencyConflictError) {
        throw new LocalBridgeError(
          LOCAL_BRIDGE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          '同一幂等键已绑定不同的发布请求',
          409,
        );
      }
      throw error;
    }
  }

  async getTaskStatus(taskId: string | number): Promise<LocalBridgeTaskStatus> {
    const normalizedTaskId = this.requireTaskId(taskId);
    try {
      const result =
        await this.autoUploadService.getPublishBatchResults(normalizedTaskId);
      return {
        taskId: normalizedTaskId,
        status: this.resolveTaskStatus(result),
        result,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new LocalBridgeError(
          LOCAL_BRIDGE_ERROR_CODES.TASK_NOT_FOUND,
          '未找到该发布任务',
          404,
        );
      }
      throw error;
    }
  }

  // 声明 Promise 返回但同步 throw：必须 async，调用方才能拿到 rejected promise
  async cancelTask(
    taskId: string | number,
    request: LocalBridgeCancelTaskRequest = {},
  ): Promise<LocalBridgeCancelTaskResult> {
    this.requireTaskId(taskId);
    this.validateCancelRequest(request);
    throw new LocalBridgeError(
      LOCAL_BRIDGE_ERROR_CODES.CANCELLATION_UNSUPPORTED,
      'Local Bridge 当前不支持取消发布任务',
      409,
    );
  }

  private validateExecuteRequest(
    request: LocalBridgeExecutePublishRequest,
  ): void {
    if (
      !this.isRecord(request) ||
      !this.hasOnlyKeys(request, EXECUTE_REQUEST_KEYS)
    ) {
      this.invalidRequest('发布请求格式无效');
    }
    this.requireBoundedString(request.confirmationId, 1, 200, 'confirmationId');
    this.requireBoundedString(request.idempotencyKey, 1, 200, 'idempotencyKey');
    if (
      !Array.isArray(request.payloads) ||
      request.payloads.length < 1 ||
      request.payloads.length > 50
    ) {
      this.invalidRequest('payloads 必须包含 1 至 50 项');
    }
    request.payloads.forEach((payload) => this.validatePublishPayload(payload));
  }

  private validatePublishPayload(payload: AutoUploadPublishPayload): void {
    if (
      !this.isRecord(payload) ||
      !this.hasOnlyKeys(payload, PUBLISH_PAYLOAD_KEYS)
    ) {
      this.invalidRequest('发布 payload 包含无效字段');
    }
    if (
      !Number.isSafeInteger(payload.type) ||
      payload.type < 1 ||
      payload.type > 5
    ) {
      this.invalidRequest('发布平台 type 无效');
    }
    this.requireBoundedString(payload.title, 1, 500, 'title');
    this.requireStringArray(payload.tags, 100, 100, 'tags');
    this.requireStringArray(payload.fileList, 100, 4096, 'fileList');
    this.requireStringArray(payload.accountList, 100, 200, 'accountList');
    if (payload.accountIds !== undefined) {
      if (
        !Array.isArray(payload.accountIds) ||
        payload.accountIds.length > 100 ||
        payload.accountIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
      ) {
        this.invalidRequest('accountIds 无效');
      }
    }
    if (
      payload.contentKind !== undefined &&
      payload.contentKind !== 'article' &&
      payload.contentKind !== 'video'
    ) {
      this.invalidRequest('contentKind 无效');
    }
    for (const key of [
      'articleId',
      'body',
      'scheduleTime',
      'coverPath',
      'biliTitle',
      'biliType',
      'biliPartition',
      'biliDesc',
    ] as const) {
      const value = payload[key];
      if (value !== undefined) {
        this.requireBoundedString(
          value,
          0,
          key === 'body' ? 1_000_000 : 4096,
          key,
        );
      }
    }
    this.validateOptionalPublishFields(payload);
  }

  private validateOptionalPublishFields(
    payload: AutoUploadPublishPayload,
  ): void {
    for (const key of ['enableTimer'] as const) {
      if (
        payload[key] !== undefined &&
        payload[key] !== 0 &&
        payload[key] !== 1
      ) {
        this.invalidRequest(`${key} 无效`);
      }
    }
    for (const key of [
      'debugDryRun',
      'debugDryRunHoldBrowser',
      'skipAccountCheck',
    ] as const) {
      if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
        this.invalidRequest(`${key} 无效`);
      }
    }
    for (const key of [
      'videosPerDay',
      'startDays',
      'timeJitterMinutes',
      'category',
    ] as const) {
      const value = payload[key];
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < 0 || value > 100_000)
      ) {
        this.invalidRequest(`${key} 无效`);
      }
    }
    if (payload.dailyTimes !== undefined) {
      this.requireStringArray(payload.dailyTimes, 100, 20, 'dailyTimes');
    }
    if (payload.coverPaths !== undefined) {
      if (
        !this.isRecord(payload.coverPaths) ||
        Object.keys(payload.coverPaths).length > 100
      ) {
        this.invalidRequest('coverPaths 无效');
      }
      for (const [key, value] of Object.entries(payload.coverPaths)) {
        this.requireBoundedString(key, 1, 200, 'coverPaths key');
        this.requireBoundedString(value, 1, 4096, 'coverPaths value');
      }
    }
    if (payload.sourceIdentity !== undefined) {
      const source = payload.sourceIdentity;
      if (
        !this.isRecord(source) ||
        !this.hasOnlyKeys(source, SOURCE_IDENTITY_KEYS) ||
        source.sourceType !== 'article'
      ) {
        this.invalidRequest('sourceIdentity 无效');
      }
      for (const key of [
        'sourceId',
        'title',
        'contentType',
        'contentFormat',
        'updatedAt',
      ] as const) {
        this.requireBoundedString(
          source[key],
          1,
          4096,
          `sourceIdentity.${key}`,
        );
      }
    }
    if (payload.accountIdentity !== undefined) {
      const account = payload.accountIdentity;
      if (
        !this.isRecord(account) ||
        !this.hasOnlyKeys(account, ACCOUNT_IDENTITY_KEYS)
      ) {
        this.invalidRequest('accountIdentity 无效');
      }
      for (const key of ['id', 'name', 'platform', 'status'] as const) {
        this.requireBoundedString(
          account[key],
          1,
          4096,
          `accountIdentity.${key}`,
        );
      }
    }
  }

  private validateCancelRequest(request: LocalBridgeCancelTaskRequest): void {
    if (
      !this.isRecord(request) ||
      !this.hasOnlyKeys(request, CANCEL_REQUEST_KEYS)
    ) {
      this.invalidRequest('取消请求格式无效');
    }
    if (request.reason !== undefined) {
      this.requireBoundedString(request.reason, 1, 500, 'reason');
    }
  }

  private resolveTaskStatus(
    result: AutoUploadPublishBatchResult,
  ): LocalBridgeTaskState {
    if (
      result.platforms.length === 0 ||
      result.platforms.some((entry) => entry.status === 'pending_manual')
    ) {
      return 'waiting';
    }
    if (
      result.platforms.some((entry) =>
        TERMINAL_FAILURE_STATUSES.has(entry.status),
      )
    ) {
      return 'failed';
    }
    return 'completed';
  }

  private requireTaskId(taskId: string | number): number {
    const normalized =
      typeof taskId === 'string'
        ? /^[1-9]\d*$/.test(taskId)
          ? Number(taskId)
          : Number.NaN
        : taskId;
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
      this.invalidRequest('taskId 必须为正安全整数');
    }
    return normalized;
  }

  private requireStringArray(
    value: unknown,
    maxItems: number,
    maxLength: number,
    field: string,
  ): asserts value is string[] {
    if (!Array.isArray(value) || value.length > maxItems) {
      this.invalidRequest(`${field} 无效`);
    }
    value.forEach((item) =>
      this.requireBoundedString(item, 0, maxLength, field),
    );
  }

  private requireBoundedString(
    value: unknown,
    minLength: number,
    maxLength: number,
    field: string,
  ): asserts value is string {
    if (
      typeof value !== 'string' ||
      value.length < minLength ||
      value.length > maxLength
    ) {
      this.invalidRequest(`${field} 无效`);
    }
  }

  private hasOnlyKeys(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
  ): boolean {
    return Object.keys(value).every((key) => allowed.has(key));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    return prototype === Object.prototype || prototype === null;
  }

  private invalidRequest(message: string): never {
    throw new LocalBridgeError(
      LOCAL_BRIDGE_ERROR_CODES.INVALID_REQUEST,
      message,
      400,
    );
  }

  private requireTraceId(traceId: string | undefined): string {
    const normalized = this.normalizeTraceId(traceId);
    if (!normalized) {
      throw new LocalBridgeError(
        LOCAL_BRIDGE_ERROR_CODES.INVALID_REQUEST,
        '缺少或无效的 x-jiuzhang-trace-id 请求头',
        400,
      );
    }
    return normalized;
  }

  private normalizeTraceId(traceId: string | undefined): string {
    const normalized = traceId?.trim() || '';
    return /^[A-Za-z0-9._:-]{1,80}$/.test(normalized) ? normalized : '';
  }

  private toBridgeAccount(account: AutoUploadAccount): LocalBridgeAccount {
    const platform =
      account.platformKey || PLATFORM_KEYS_BY_TYPE[account.type] || 'unknown';
    const capability = this.platformRegistry.getCapability(platform);
    return {
      id: account.stableId || `${platform}:${account.id}`,
      platform,
      displayName: capability?.displayName || account.platform,
      accountName:
        account.accountName ||
        account.profileName ||
        account.userName ||
        `账号 ${account.id}`,
      status: this.resolveAccountStatus(account),
      statusLabel: account.statusLabel,
      avatarUrl: account.avatarUrl || null,
      lastCheckedAt: account.lastDispatchAt || null,
    };
  }

  private resolveAccountStatus(
    account: AutoUploadAccount,
  ): LocalBridgeAccountStatus {
    if (account.status !== 1 || account.sessionStatus === 'needs_login') {
      return 'needs_login';
    }
    if (account.sessionStatus === 'error') return 'error';
    if (account.sessionStatus === 'logged_in') return 'ready';
    return account.status === 1 ? 'ready' : 'unknown';
  }
}
