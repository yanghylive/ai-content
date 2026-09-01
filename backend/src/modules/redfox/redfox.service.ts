import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { QueryRedfoxCallLogsDto } from './dto/query-redfox-call-logs.dto';
import { QueryRedfoxInterfacesDto } from './dto/query-redfox-interfaces.dto';
import { QueryRedfoxSkillsDto } from './dto/query-redfox-skills.dto';
import { SaveRedfoxConnectionDto } from './dto/save-redfox-connection.dto';
import { SyncRedfoxInterfacesDto } from './dto/sync-redfox-interfaces.dto';
import { SyncRedfoxSkillsDto } from './dto/sync-redfox-skills.dto';
import { UpdateRedfoxSkillDto } from './dto/update-redfox-skill.dto';
import { RedfoxCallLogService } from './redfox-call-log.service';
import { RedfoxClientService } from './redfox-client.service';
import { RedfoxCostGuardService } from './redfox-cost-guard.service';
import {
  RedfoxInterfaceCatalogService,
  RedfoxPlatform,
} from './redfox-interface-catalog.service';
import { RedfoxSkillCatalogService } from './redfox-skill-catalog.service';
import {
  RedfoxConnectionView,
  RedfoxEffectiveConnection,
  RedfoxScope,
  RedfoxStoredConnection,
} from './redfox.types';

const DEFAULT_REDFOX_BASE_URL = 'https://redfox.hk';
const DEFAULT_REDFOX_TIMEOUT_MS = 60000;
const ENCRYPTION_PREFIX = 'aes-256-gcm:v1:';

export type RedfoxActor =
  | Pick<AuthenticatedUser, 'id' | 'kaypalUserId' | 'kaypalRole' | 'role'>
  | undefined
  | null;

type RedfoxConnectionMetadata = {
  baseUrl?: string | null;
  timeoutMs?: number | null;
  enabled?: boolean;
  highCostConfirmThreshold?: number | null;
};

type RedfoxConnectionRecord = Prisma.RedfoxConnectionGetPayload<object>;

@Injectable()
export class RedfoxService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly client: RedfoxClientService,
    private readonly catalog: RedfoxSkillCatalogService,
    private readonly interfaces: RedfoxInterfaceCatalogService,
    private readonly callLogs: RedfoxCallLogService,
    private readonly costGuard: RedfoxCostGuardService,
  ) {}

  async getConnection(actor?: RedfoxActor): Promise<RedfoxConnectionView> {
    const scope = await this.resolveScope(actor);
    return this.toConnectionView(await this.getEffectiveConnection(scope));
  }

  async saveConnection(actor: RedfoxActor, dto: SaveRedfoxConnectionDto) {
    const scope = await this.resolveScope(actor);
    const existingRecord = await this.findConnectionRecord(scope);
    const existing = existingRecord
      ? this.toStoredConnection(existingRecord)
      : null;
    const now = new Date().toISOString();
    const apiKeyChanged = 'apiKey' in dto;
    const baseUrlChanged = 'baseUrl' in dto;
    const timeoutChanged = 'timeoutMs' in dto;

    const next: RedfoxStoredConnection = {
      baseUrl:
        dto.baseUrl !== undefined
          ? this.cleanBaseUrl(dto.baseUrl)
          : (existing?.baseUrl ?? null),
      apiKey:
        dto.apiKey !== undefined
          ? this.cleanNullable(dto.apiKey)
          : (existing?.apiKey ?? null),
      timeoutMs: dto.timeoutMs ?? existing?.timeoutMs ?? null,
      enabled: dto.enabled ?? existing?.enabled ?? true,
      dailyUserLimit: null,
      dailyTenantLimit: null,
      highCostConfirmThreshold: null,
      status: existing?.status || 'untested',
      lastTestAt: existing?.lastTestAt ?? null,
      lastError: existing?.lastError ?? null,
      updatedAt: now,
    };

    const effectivePreview = this.mergeEffectiveConnection(next);
    if (!next.enabled) {
      next.status = 'disabled';
    } else if (!effectivePreview.apiKey) {
      next.status = 'missing_key';
      next.lastError = '情报数据服务尚未配置，请到「设置」添加数据源后使用。';
    } else if (apiKeyChanged || baseUrlChanged || timeoutChanged) {
      next.status = 'untested';
      next.lastError = null;
    }

    await this.persistConnection(scope, existingRecord?.id || null, next);
    return this.getConnection(actor);
  }

  async testConnection(actor?: RedfoxActor) {
    const scope = await this.resolveScope(actor);
    const connection = await this.getEffectiveConnection(scope);
    try {
      const payload = await this.client.request<unknown>(scope, connection, {
        method: 'GET',
        path: '/story/web/api/doc/platforms',
        operation: 'connection.test',
        estimatedCostPoints: 0,
        requireApiKey: true,
      });
      const checkedAt = new Date().toISOString();
      await this.markConnectionStatus(scope, 'connected', checkedAt, null);
      void this.syncInterfacesForScope(scope).catch(() => undefined);
      return {
        ok: true,
        status: 'connected',
        checkedAt,
        baseUrl: connection.baseUrl,
        sample: this.summarizePayload(payload),
      };
    } catch (error) {
      await this.markConnectionStatus(
        scope,
        'failed',
        new Date().toISOString(),
        this.readErrorMessage(error),
      );
      throw error;
    }
  }

  async listInterfaces(actor: RedfoxActor, query: QueryRedfoxInterfacesDto) {
    await this.resolveScope(actor);
    return this.interfaces.list(query);
  }

  async syncInterfaces(actor: RedfoxActor, dto: SyncRedfoxInterfacesDto = {}) {
    return this.syncInterfacesForScope(await this.resolveScope(actor), dto);
  }

  private async syncInterfacesForScope(
    scope: RedfoxScope,
    dto: SyncRedfoxInterfacesDto = {},
  ) {
    const connection = await this.getEffectiveConnection(scope);
    let platformPayload: unknown = null;
    const failures: Array<{ platformCode: string; error: string }> = [];
    try {
      platformPayload = await this.client.request<unknown>(scope, connection, {
        method: 'GET',
        path: '/story/web/api/doc/platforms',
        operation: 'interfaces.platforms.sync',
        skillCode: 'redfox-interface-catalog',
        estimatedCostPoints: 0,
        requireApiKey: true,
      });
    } catch (error) {
      if (this.shouldAbortInterfaceSync(error)) {
        throw error;
      }
      failures.push({
        platformCode: 'platforms',
        error: this.readErrorMessage(error),
      });
    }

    const requested = this.requestedPlatforms(dto.platforms);
    const remotePlatforms = platformPayload
      ? this.interfaces.extractPlatforms(platformPayload)
      : [];
    const platforms = (
      remotePlatforms.length
        ? remotePlatforms
        : this.interfaces.fallbackPlatforms()
    )
      .filter((platform) => platform.status === 'online')
      .filter(
        (platform) =>
          !requested.size || requested.has(platform.platformCode.toLowerCase()),
      );
    const payloadResults = await Promise.all(
      platforms.map(async (platform) => {
        try {
          const payload = await this.client.request<unknown>(
            scope,
            connection,
            {
              method: 'GET',
              path: `/story/web/api/doc/platform/${encodeURIComponent(platform.platformCode)}/interfaces`,
              operation: 'interfaces.sync',
              skillCode: `redfox-interface:${platform.platformCode}`,
              estimatedCostPoints: 0,
              requireApiKey: true,
            },
          );
          return { platform, payload };
        } catch (error) {
          failures.push({
            platformCode: platform.platformCode,
            error: this.readErrorMessage(error),
          });
          return null;
        }
      }),
    );
    const payloads: Array<{ platform: RedfoxPlatform; payload: unknown }> =
      payloadResults.filter((item): item is NonNullable<typeof item> =>
        Boolean(item),
      );

    const result = await this.interfaces.syncFromRemote(
      platformPayload,
      payloads,
    );
    return {
      ...result,
      attempted: platforms.length,
      failed: failures.length,
      failures,
    };
  }

  private shouldAbortInterfaceSync(error: unknown) {
    if (!(error instanceof HttpException)) return false;
    return [400, 401, 403, 429].includes(error.getStatus());
  }

  async listSkills(actor: RedfoxActor, query: QueryRedfoxSkillsDto) {
    return this.catalog.list(await this.resolveScope(actor), query);
  }

  async syncSkills(actor: RedfoxActor, dto: SyncRedfoxSkillsDto = {}) {
    const scope = await this.resolveScope(actor);
    const connection = await this.getEffectiveConnection(scope);
    const payload = await this.client.request<unknown>(scope, connection, {
      method: 'GET',
      path: '/story/web/api/skills/list',
      query: {
        page: dto.page || 1,
        pageSize: dto.pageSize || 100,
      },
      operation: 'skills.sync',
      skillCode: 'redfox-skill-catalog',
      estimatedCostPoints: 1,
      requireApiKey: true,
    });

    return this.catalog.syncFromRemote(payload);
  }

  async updateSkill(actor: RedfoxActor, id: string, dto: UpdateRedfoxSkillDto) {
    return this.catalog.updateSkill(await this.resolveScope(actor), id, dto);
  }

  async listCallLogs(actor: RedfoxActor, query: QueryRedfoxCallLogsDto) {
    return this.callLogs.list(await this.resolveScope(actor), query);
  }

  async getCostSummary(actor: RedfoxActor, query: QueryRedfoxCallLogsDto = {}) {
    const scope = await this.resolveScope(actor);
    return this.costGuard.getSummary(
      scope,
      await this.getEffectiveConnection(scope),
      query,
    );
  }

  async resolveScope(actor?: RedfoxActor): Promise<RedfoxScope> {
    const userId = actor?.id?.trim() || 'local-user';
    const tenantId = actor?.id
      ? await this.resolveTenantId(actor.id)
      : undefined;
    return {
      key: `${tenantId || userId}:${userId}`,
      userId,
      tenantId,
    };
  }

  async getEffectiveConnection(
    scope: RedfoxScope,
  ): Promise<RedfoxEffectiveConnection> {
    const record = await this.findConnectionRecord(scope);
    return this.mergeEffectiveConnection(
      record ? this.toStoredConnection(record) : null,
    );
  }

  private async resolveTenantId(userId: string) {
    try {
      const member = await this.prisma.system.tenantMember.findFirst({
        where: { userId, status: 'active' },
        orderBy: { joinedAt: 'asc' },
        select: { tenantId: true },
      });
      return member?.tenantId || undefined;
    } catch {
      return undefined;
    }
  }

  private async findConnectionRecord(scope: RedfoxScope) {
    if (scope.tenantId) {
      const tenantScoped = await this.prisma.redfoxConnection.findFirst({
        where: { tenantId: scope.tenantId, userId: scope.userId },
      });
      if (tenantScoped) return tenantScoped;
    }
    return this.prisma.redfoxConnection.findFirst({
      where: { tenantId: null, userId: scope.userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async persistConnection(
    scope: RedfoxScope,
    existingId: string | null,
    connection: RedfoxStoredConnection,
  ) {
    const data = {
      tenantId: scope.tenantId || null,
      userId: scope.userId,
      name: 'RedFox',
      apiKeyEncrypted: this.encryptSecret(connection.apiKey || ''),
      apiKeyMasked: this.maskApiKey(connection.apiKey || ''),
      status: connection.status,
      dailyCallLimit: connection.dailyUserLimit,
      dailyCostLimit: connection.dailyTenantLimit,
      lastTestAt: connection.lastTestAt
        ? new Date(connection.lastTestAt)
        : null,
      lastError: connection.lastError,
      metadata: this.buildMetadata(connection),
    } satisfies Prisma.RedfoxConnectionUncheckedCreateInput;

    if (existingId) {
      await this.prisma.redfoxConnection.update({
        where: { id: existingId },
        data,
      });
      return;
    }

    await this.prisma.redfoxConnection.create({ data });
  }

  private buildMetadata(connection: RedfoxStoredConnection) {
    return {
      baseUrl: connection.baseUrl || null,
      timeoutMs: connection.timeoutMs || null,
      enabled: connection.enabled !== false,
      highCostConfirmThreshold: connection.highCostConfirmThreshold || null,
    } satisfies RedfoxConnectionMetadata;
  }

  private toStoredConnection(
    record: RedfoxConnectionRecord,
  ): RedfoxStoredConnection {
    const metadata = this.readConnectionMetadata(record.metadata);
    return {
      baseUrl: metadata.baseUrl || null,
      apiKey: this.decryptSecret(record.apiKeyEncrypted),
      timeoutMs: metadata.timeoutMs || null,
      enabled: metadata.enabled !== false && record.status !== 'disabled',
      dailyUserLimit: record.dailyCallLimit,
      dailyTenantLimit: record.dailyCostLimit,
      highCostConfirmThreshold: metadata.highCostConfirmThreshold || null,
      status: this.normalizeConnectionStatus(record.status),
      lastTestAt: record.lastTestAt?.toISOString() || null,
      lastError: record.lastError,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private readConnectionMetadata(
    value: Prisma.JsonValue | null,
  ): RedfoxConnectionMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    return {
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : null,
      timeoutMs:
        typeof record.timeoutMs === 'number' &&
        Number.isFinite(record.timeoutMs)
          ? record.timeoutMs
          : null,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      highCostConfirmThreshold:
        typeof record.highCostConfirmThreshold === 'number' &&
        Number.isFinite(record.highCostConfirmThreshold)
          ? record.highCostConfirmThreshold
          : null,
    };
  }

  private mergeEffectiveConnection(
    stored?: RedfoxStoredConnection | null,
  ): RedfoxEffectiveConnection {
    const savedApiKey = stored?.apiKey?.trim() || '';
    const envApiKey = this.config.get<string>('REDFOX_API_KEY')?.trim() || '';
    const apiKey = savedApiKey || envApiKey;
    const enabled = stored?.enabled !== false;
    const status = !enabled
      ? 'disabled'
      : !apiKey
        ? stored?.status === 'failed'
          ? 'failed'
          : 'missing_key'
        : stored?.status && stored.status !== 'missing_key'
          ? stored.status
          : 'untested';

    return {
      baseUrl: this.cleanBaseUrl(
        stored?.baseUrl ||
          this.config.get<string>('REDFOX_API_BASE_URL') ||
          DEFAULT_REDFOX_BASE_URL,
      ),
      apiKey,
      apiKeySource: savedApiKey ? 'saved' : envApiKey ? 'env' : 'missing',
      timeoutMs:
        stored?.timeoutMs ||
        this.readPositiveInt('REDFOX_TIMEOUT_MS', DEFAULT_REDFOX_TIMEOUT_MS),
      enabled,
      dailyUserLimit: this.costGuard.readDefaultDailyUserLimit(),
      dailyTenantLimit: this.costGuard.readDefaultDailyTenantLimit(),
      highCostConfirmThreshold:
        this.costGuard.readDefaultHighCostConfirmThreshold(),
      status,
      lastTestAt: stored?.lastTestAt ?? null,
      lastError:
        status === 'missing_key'
          ? stored?.lastError ||
            '情报数据服务尚未配置，请到「设置」添加数据源后使用。'
          : (stored?.lastError ?? null),
      updatedAt: stored?.updatedAt || new Date(0).toISOString(),
    };
  }

  private toConnectionView(
    connection: RedfoxEffectiveConnection,
  ): RedfoxConnectionView {
    return {
      baseUrl: connection.baseUrl,
      timeoutMs: connection.timeoutMs,
      enabled: connection.enabled,
      configured: Boolean(connection.apiKey),
      apiKeySource: connection.apiKeySource,
      apiKeyMasked: this.maskApiKey(connection.apiKey),
      status: connection.status,
      lastTestAt: connection.lastTestAt ?? null,
      lastError: connection.lastError ?? null,
      dailyUserLimit: connection.dailyUserLimit,
      dailyTenantLimit: connection.dailyTenantLimit,
      highCostConfirmThreshold: connection.highCostConfirmThreshold,
      updatedAt: connection.updatedAt,
    };
  }

  private async markConnectionStatus(
    scope: RedfoxScope,
    status: RedfoxStoredConnection['status'],
    testedAt: string,
    error: string | null,
  ) {
    const existingRecord = await this.findConnectionRecord(scope);
    const existing = existingRecord
      ? this.toStoredConnection(existingRecord)
      : {
          baseUrl: null,
          apiKey: null,
          timeoutMs: null,
          enabled: true,
          dailyUserLimit: null,
          dailyTenantLimit: null,
          highCostConfirmThreshold: null,
          status,
          updatedAt: testedAt,
        };
    await this.persistConnection(scope, existingRecord?.id || null, {
      ...existing,
      status,
      lastTestAt: testedAt,
      lastError: error,
      updatedAt: testedAt,
    });
  }

  private summarizePayload(payload: unknown) {
    if (Array.isArray(payload)) {
      return { kind: 'array', count: payload.length };
    }
    if (!payload || typeof payload !== 'object') {
      return { kind: typeof payload };
    }
    const record = payload as Record<string, unknown>;
    const data = record.data;
    return {
      kind: 'object',
      keys: Object.keys(record).slice(0, 8),
      dataKind: Array.isArray(data) ? 'array' : typeof data,
      dataCount: Array.isArray(data) ? data.length : undefined,
    };
  }

  private maskApiKey(apiKey: string) {
    if (!apiKey) return null;
    if (apiKey.length <= 8) return '****';
    return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
  }

  private encryptSecret(value: string) {
    if (!value) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${ENCRYPTION_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decryptSecret(value: string) {
    if (!value) return '';
    if (!value.startsWith(ENCRYPTION_PREFIX)) return value;
    try {
      const payload = value.slice(ENCRYPTION_PREFIX.length);
      const [ivRaw, tagRaw, encryptedRaw] = payload.split('.');
      if (!ivRaw || !tagRaw || !encryptedRaw) return '';
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey(),
        Buffer.from(ivRaw, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return '';
    }
  }

  private encryptionKey() {
    const secret =
      this.config.get<string>('REDFOX_API_KEY_ENCRYPTION_SECRET') ||
      this.config.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') ||
      this.config.get<string>('DATABASE_URL') ||
      'kaypal-redfox-local-development-secret';
    return createHash('sha256').update(secret).digest();
  }

  private normalizeConnectionStatus(
    value: string,
  ): RedfoxStoredConnection['status'] {
    if (
      value === 'missing_key' ||
      value === 'untested' ||
      value === 'connected' ||
      value === 'failed' ||
      value === 'disabled'
    ) {
      return value;
    }
    if (value === 'active') return 'connected';
    if (value === 'pending') return 'untested';
    return 'failed';
  }

  private readErrorMessage(error: unknown) {
    if (error && typeof error === 'object' && 'getResponse' in error) {
      const response = (error as { getResponse: () => unknown }).getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        return Array.isArray(message)
          ? message
              .filter((item): item is string => typeof item === 'string')
              .join('; ')
          : typeof message === 'string'
            ? message
            : '';
      }
    }
    return error instanceof Error ? error.message : 'RedFox 连接测试失败';
  }

  private cleanNullable(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed || null;
  }

  private cleanBaseUrl(value: string) {
    return (value || DEFAULT_REDFOX_BASE_URL).trim().replace(/\/+$/, '');
  }

  private readPositiveInt(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) || '');
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private requestedPlatforms(value?: string) {
    return new Set(
      (value || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
  }
}
