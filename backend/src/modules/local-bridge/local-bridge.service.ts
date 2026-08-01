import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AutoUploadAccount } from '../auto-upload/auto-upload.client';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformAdapterRegistry } from '../platform-registry/platform-adapter.registry';
import {
  LOCAL_BRIDGE_ACTIONS,
  LOCAL_BRIDGE_PROTOCOL,
  LOCAL_BRIDGE_VERSION,
  type LocalBridgeAccount,
  type LocalBridgeAccountStatus,
  type LocalBridgeAction,
  type LocalBridgePlatformCapability,
  type LocalBridgeResponse,
  type LocalBridgeStatus,
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
};

@Injectable()
export class LocalBridgeService {
  constructor(
    private readonly autoUploadService: AutoUploadService,
    private readonly platformRegistry: PlatformAdapterRegistry,
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
