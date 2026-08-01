import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AutoUploadPublishBatchResult,
  AutoUploadPublishPayload,
  AutoUploadPublishPlatformEntry,
} from './auto-upload.client';

export const DURABLE_PUBLISH_RECORD_SOURCE = 'durable_publish_record';
export const DURABLE_PUBLISH_RECORD_TASK_TYPE = 'auto-upload-publish-record-v1';

const LEGACY_MARKER_PREFIX = 'legacy:auto-upload-batch:';

type PublishRecordStatus = 'completed' | 'failed' | 'waiting';

export type DurablePublishRecordEnvelope = {
  source: typeof DURABLE_PUBLISH_RECORD_SOURCE;
  version: 1;
  title: string;
  platformType: number;
  accountFile: string;
  fileList: string[];
  tags: string[];
  dryRun: boolean;
  payloads: AutoUploadPublishPayload[];
  result: AutoUploadPublishBatchResult;
  engineTaskIds: string[];
  createdAt: string;
  updatedAt: string;
  legacy?: {
    storeKey: string;
  };
};

type DurablePublishRecordRow = {
  id: string;
  tenantId: string;
  userId: string;
  relatedId: string;
  relatedType: string;
  executor: string;
  platform: string;
  taskType: string;
  accountId: string | null;
  ok: boolean;
  status: string;
  reasonCode: string;
  userMessage: string;
  technicalMessage: string | null;
  runtimeJson: unknown;
  evidenceJson: unknown;
  readbackJson: unknown;
  agentSSessionId: string | null;
  engineUrl: string | null;
  createdAt: Date;
};

export type DurablePublishRecord = {
  databaseId: string;
  publicId: number;
  tenantId: string;
  userId: string;
  status: PublishRecordStatus;
  message: string;
  envelope: DurablePublishRecordEnvelope;
  createdAt: Date;
};

export type DurablePublishRecordPageQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'completed' | 'failed' | 'waiting';
  platform?: string;
};

export type DurablePublishRecordPage = {
  items: DurablePublishRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type CreateDurablePublishRecordInput = {
  title: string;
  platformType: number;
  accountFile: string;
  fileList: string[];
  tags: string[];
  dryRun: boolean;
  payloads: AutoUploadPublishPayload[];
  result: AutoUploadPublishBatchResult;
  engineTaskIds?: Array<number | string>;
  agentSessionId?: string;
  recordedAt?: string;
  preferredPublicId?: number;
  legacyStoreKey?: string;
};

const FAILURE_STATUSES = new Set<AutoUploadPublishPlatformEntry['status']>([
  'failed',
  'account_expired',
  'material_error',
  'login_required',
  'blocked',
  'not_integrated',
]);

@Injectable()
export class PublishRecordStore {
  private lastAllocatedPublicId = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  async list(limit: number): Promise<DurablePublishRecord[]> {
    const scope = await this.resolveTenantScope();
    const rows = await this.prisma.runtimeExecution.findMany({
      where: { taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE, ...scope },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.floor(limit)),
    });

    return rows
      .map((row) => this.decode(row as DurablePublishRecordRow))
      .filter((record): record is DurablePublishRecord => Boolean(record));
  }

  async listPage(
    query: DurablePublishRecordPageQuery,
  ): Promise<DurablePublishRecordPage> {
    const scope = await this.resolveTenantScope();
    const page = Math.max(1, Math.floor(query.page || 1));
    const pageSize = Math.max(
      1,
      Math.min(100, Math.floor(query.pageSize || 20)),
    );
    const where = {
      taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
      ...scope,
      ...(query.status ? { status: query.status } : {}),
      ...(query.platform
        ? { platform: { contains: query.platform.trim() } }
        : {}),
    };
    const search = query.search?.trim().toLocaleLowerCase() || '';
    if (!search) {
      const [rows, total] = await Promise.all([
        this.prisma.runtimeExecution.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.runtimeExecution.count({ where }),
      ]);
      return {
        items: rows
          .map((row) => this.decode(row as DurablePublishRecordRow))
          .filter((record): record is DurablePublishRecord => Boolean(record)),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }

    const rows = await this.prisma.runtimeExecution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    const records = rows
      .map((row) => this.decode(row as DurablePublishRecordRow))
      .filter((record): record is DurablePublishRecord => Boolean(record))
      .filter((record) => this.matchesSearch(record, search));
    const start = (page - 1) * pageSize;

    return {
      items: records.slice(start, start + pageSize),
      total: records.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(records.length / pageSize)),
    };
  }

  async findByPublicId(publicId: number): Promise<DurablePublishRecord | null> {
    if (!this.isValidPublicId(publicId)) return null;
    const scope = await this.resolveTenantScope();
    const row = await this.prisma.runtimeExecution.findFirst({
      where: {
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        relatedId: String(publicId),
        ...scope,
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.decode(row as DurablePublishRecordRow) : null;
  }

  async findLegacyImport(
    storeKey: string,
  ): Promise<DurablePublishRecord | null> {
    const scope = await this.resolveTenantScope();
    const row = await this.prisma.runtimeExecution.findFirst({
      where: {
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        technicalMessage: this.legacyMarker(storeKey),
        ...scope,
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.decode(row as DurablePublishRecordRow) : null;
  }

  async create(
    input: CreateDurablePublishRecordInput,
  ): Promise<DurablePublishRecord> {
    const scope = await this.resolveTenantScope();
    const publicId = await this.allocatePublicId(
      input.preferredPublicId,
      scope,
    );
    const now = this.safeTimestamp(input.recordedAt);
    const envelope = this.buildEnvelope(input, now, now);
    const state = this.resolveState(input.result);
    const created = await this.prisma.runtimeExecution.create({
      data: {
        ...scope,
        relatedId: String(publicId),
        relatedType: 'agent-session',
        executor: 'local-runtime',
        platform: this.platformColumn(input.result),
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        accountId: this.accountColumn(input.result),
        ok: state.status === 'completed',
        status: state.status,
        reasonCode: state.reasonCode,
        userMessage: state.message,
        technicalMessage: input.legacyStoreKey
          ? this.legacyMarker(input.legacyStoreKey)
          : null,
        runtimeJson: this.jsonValue(envelope),
        evidenceJson: this.jsonValue(
          this.buildEvidenceSnapshot(input.result.platforms),
        ),
        readbackJson: this.jsonValue(
          this.buildReadbackSnapshot(input.result.platforms),
        ),
        agentSSessionId: input.agentSessionId ?? null,
        engineUrl: 'internal://auto-upload/publish-records',
        createdAt: new Date(now),
      },
    });

    await this.createLinkedPublishRecords(
      created.id,
      scope,
      input.payloads,
      input.result,
    );

    const record = this.decode(created as DurablePublishRecordRow);
    if (!record) {
      throw new Error('持久化发布记录格式无效');
    }
    return record;
  }

  async updateResult(
    record: DurablePublishRecord,
    result: AutoUploadPublishBatchResult,
    options: {
      engineTaskIds?: Array<number | string>;
      agentSessionId?: string;
    } = {},
  ): Promise<DurablePublishRecord> {
    const scope = await this.resolveTenantScope();
    this.assertRecordScope(record, scope);
    const updatedAt = new Date().toISOString();
    const envelope: DurablePublishRecordEnvelope = {
      ...record.envelope,
      result,
      engineTaskIds: (options.engineTaskIds ?? record.envelope.engineTaskIds)
        .map(String)
        .filter(Boolean),
      updatedAt,
    };
    const state = this.resolveState(result);
    const updated = await this.prisma.runtimeExecution.update({
      where: { id: record.databaseId },
      data: {
        platform: this.platformColumn(result),
        accountId: this.accountColumn(result),
        ok: state.status === 'completed',
        status: state.status,
        reasonCode: state.reasonCode,
        userMessage: state.message,
        runtimeJson: this.jsonValue(envelope),
        evidenceJson: this.jsonValue(
          this.buildEvidenceSnapshot(result.platforms),
        ),
        readbackJson: this.jsonValue(
          this.buildReadbackSnapshot(result.platforms),
        ),
        agentSSessionId:
          options.agentSessionId ??
          result.agentSessionId ??
          record.envelope.result.agentSessionId ??
          null,
      },
    });

    await this.updateLinkedPublishRecords(
      record.databaseId,
      scope,
      envelope.payloads,
      result,
    );
    await this.markVerifiedArticlesPublished(scope, result, envelope.payloads);

    const decoded = this.decode(updated as DurablePublishRecordRow);
    if (!decoded) {
      throw new Error('更新后的发布记录格式无效');
    }
    return decoded;
  }

  async delete(record: DurablePublishRecord) {
    const scope = await this.resolveTenantScope();
    this.assertRecordScope(record, scope);
    const publishRecordDelegate = (
      this.prisma as unknown as {
        publishRecord?: {
          deleteMany?: (args: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).publishRecord;
    if (typeof publishRecordDelegate?.deleteMany === 'function') {
      await publishRecordDelegate.deleteMany({
        where: { durableRecordId: record.databaseId, ...scope },
      });
    }
    await this.prisma.runtimeExecution.delete({
      where: { id: record.databaseId },
    });
  }

  private async createLinkedPublishRecords(
    durableRecordId: string,
    scope: Record<string, string>,
    payloads: AutoUploadPublishPayload[],
    result: AutoUploadPublishBatchResult,
  ) {
    const publishRecordDelegate = (
      this.prisma as unknown as {
        publishRecord?: {
          create?: (args: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).publishRecord;
    if (typeof publishRecordDelegate?.create !== 'function') return;

    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];
      if (
        payload.contentKind !== 'article' ||
        !payload.articleId ||
        !payload.body ||
        !payload.sourceIdentity ||
        !payload.accountIdentity?.id
      ) {
        continue;
      }
      const entry = this.findPlatformEntry(payload, result, index);
      await publishRecordDelegate.create({
        data: {
          ...scope,
          durableRecordId,
          articleId: payload.articleId,
          accountId: payload.accountIdentity.id,
          platform:
            payload.accountIdentity.platform || entry?.platform || 'publishing',
          status: this.publishRecordStatus(entry),
          publishUrl: entry?.publishUrl || entry?.externalId || null,
          errorMessage: entry?.failureReason || null,
          sourceIdentity: this.jsonValue(payload.sourceIdentity),
          bodySnapshot: payload.body,
          payloadJson: this.jsonValue(payload),
          resultJson: this.jsonValue(entry || result),
        },
      });
    }
  }

  private async updateLinkedPublishRecords(
    durableRecordId: string,
    scope: Record<string, string>,
    payloads: AutoUploadPublishPayload[],
    result: AutoUploadPublishBatchResult,
  ) {
    const publishRecordDelegate = (
      this.prisma as unknown as {
        publishRecord?: {
          updateMany?: (args: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).publishRecord;
    if (typeof publishRecordDelegate?.updateMany !== 'function') return;

    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];
      if (!payload.articleId || !payload.accountIdentity?.id) continue;
      const entry = this.findPlatformEntry(payload, result, index);
      await publishRecordDelegate.updateMany({
        where: {
          durableRecordId,
          articleId: payload.articleId,
          accountId: payload.accountIdentity.id,
          ...scope,
        },
        data: {
          status: this.publishRecordStatus(entry),
          publishUrl: entry?.publishUrl || entry?.externalId || null,
          errorMessage: entry?.failureReason || null,
          resultJson: this.jsonValue(entry || result),
        },
      });
    }
  }

  private async markVerifiedArticlesPublished(
    scope: Record<string, string>,
    result: AutoUploadPublishBatchResult,
    payloads: AutoUploadPublishPayload[],
  ) {
    const verifiedSources = result.platforms
      .filter(
        (entry) =>
          entry.status === 'success' && hasVerifiedPlatformReadback(entry),
      )
      .map((entry) =>
        payloads.find(
          (payload) =>
            payload.articleId === entry.articleId &&
            payload.accountIdentity?.id === entry.accountId,
        ),
      )
      .filter(
        (
          payload,
        ): payload is AutoUploadPublishPayload & {
          articleId: string;
          sourceIdentity: NonNullable<
            AutoUploadPublishPayload['sourceIdentity']
          >;
        } => Boolean(payload?.articleId && payload.sourceIdentity?.updatedAt),
      );
    const uniqueSources = Array.from(
      new Map(
        verifiedSources.map((payload) => [payload.articleId, payload]),
      ).values(),
    );
    if (!uniqueSources.length) return;
    const articleDelegate = (
      this.prisma as unknown as {
        article?: {
          updateMany?: (args: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).article;
    if (typeof articleDelegate?.updateMany !== 'function') return;
    for (const payload of uniqueSources) {
      await articleDelegate.updateMany({
        where: {
          id: payload.articleId,
          updatedAt: new Date(payload.sourceIdentity.updatedAt),
          ...scope,
        },
        data: { status: 'published' },
      });
    }
  }

  private findPlatformEntry(
    payload: AutoUploadPublishPayload,
    result: AutoUploadPublishBatchResult,
    index: number,
  ) {
    return (
      result.platforms.find(
        (entry) =>
          entry.articleId === payload.articleId &&
          entry.accountId === payload.accountIdentity?.id,
      ) ||
      result.platforms.find(
        (entry) => entry.accountId === payload.accountIdentity?.id,
      ) ||
      result.platforms[index]
    );
  }

  private publishRecordStatus(
    entry: AutoUploadPublishPlatformEntry | undefined,
  ) {
    if (entry?.status === 'success' && hasVerifiedPlatformReadback(entry)) {
      return 'success';
    }
    if (entry && FAILURE_STATUSES.has(entry.status)) return 'failed';
    return 'pending';
  }

  private assertRecordScope(
    record: DurablePublishRecord,
    scope: Record<string, string>,
  ) {
    if (
      scope.tenantId &&
      (record.tenantId !== scope.tenantId || record.userId !== scope.userId)
    ) {
      throw new ForbiddenException('无权操作这条发布记录。');
    }
  }

  private buildEnvelope(
    input: CreateDurablePublishRecordInput,
    createdAt: string,
    updatedAt: string,
  ): DurablePublishRecordEnvelope {
    return {
      source: DURABLE_PUBLISH_RECORD_SOURCE,
      version: 1,
      title: input.title,
      platformType: input.platformType,
      accountFile: input.accountFile,
      fileList: input.fileList,
      tags: input.tags,
      dryRun: input.dryRun,
      payloads: input.payloads,
      result: input.result,
      engineTaskIds: (input.engineTaskIds ?? []).map(String).filter(Boolean),
      createdAt,
      updatedAt,
      legacy: input.legacyStoreKey
        ? { storeKey: input.legacyStoreKey }
        : undefined,
    };
  }

  private decode(row: DurablePublishRecordRow): DurablePublishRecord | null {
    const publicId = Number(row.relatedId);
    if (!this.isValidPublicId(publicId)) return null;
    const envelope = this.asRecord(row.runtimeJson);
    if (
      envelope?.source !== DURABLE_PUBLISH_RECORD_SOURCE ||
      envelope.version !== 1 ||
      !this.asRecord(envelope.result)
    ) {
      return null;
    }

    return {
      databaseId: row.id,
      publicId,
      tenantId: row.tenantId || 'legacy-local-desktop',
      userId: row.userId || 'legacy-local-user',
      status:
        row.status === 'completed' || row.status === 'failed'
          ? row.status
          : 'waiting',
      message: row.userMessage,
      envelope: envelope as DurablePublishRecordEnvelope,
      createdAt: row.createdAt,
    };
  }

  private async allocatePublicId(
    preferred: number | undefined,
    scope: Record<string, string>,
  ) {
    let candidate = this.isValidPublicId(preferred)
      ? preferred
      : Math.max(Date.now(), this.lastAllocatedPublicId + 1);

    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const existing = await this.prisma.runtimeExecution.findFirst({
        where: {
          taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
          relatedId: String(candidate),
          ...scope,
        },
        select: { id: true },
      });
      if (!existing) {
        this.lastAllocatedPublicId = Math.max(
          this.lastAllocatedPublicId,
          candidate,
        );
        return candidate;
      }
      candidate += 1;
    }

    throw new Error('无法分配发布记录编号');
  }

  private resolveState(result: AutoUploadPublishBatchResult): {
    status: PublishRecordStatus;
    reasonCode: string;
    message: string;
  } {
    const platforms = result.platforms ?? [];
    const failures = platforms.filter((entry) =>
      FAILURE_STATUSES.has(entry.status),
    );
    const completed =
      platforms.length > 0 &&
      platforms.every(
        (entry) =>
          entry.status === 'success' && hasVerifiedPlatformReadback(entry),
      );

    if (completed) {
      return {
        status: 'completed',
        reasonCode: 'success',
        message: `平台已确认 ${platforms.length}/${platforms.length}`,
      };
    }
    if (failures.length > 0) {
      return {
        status: 'failed',
        reasonCode: this.failureReasonCode(failures[0].status),
        message: `发布结果：成功 ${result.summary?.success || 0}/${platforms.length}，失败 ${failures.length}，待确认 ${result.summary?.pendingManual || 0}`,
      };
    }
    return {
      status: 'waiting',
      reasonCode: 'readback_failed',
      message: `发布结果：成功 0/${platforms.length}，失败 0，待确认 ${platforms.length}`,
    };
  }

  private failureReasonCode(status: AutoUploadPublishPlatformEntry['status']) {
    if (status === 'account_expired' || status === 'login_required') {
      return 'account_not_logged_in';
    }
    if (status === 'material_error') return 'target_not_found';
    if (status === 'blocked') return 'permission_missing';
    if (status === 'not_integrated') return 'not_integrated';
    return 'send_failed';
  }

  private buildEvidenceSnapshot(platforms: AutoUploadPublishPlatformEntry[]) {
    return platforms.map((entry) => ({
      platform: entry.platform,
      accountId: entry.accountId,
      accountName: entry.accountName,
      accountStatus: entry.accountStatus,
      articleId: entry.articleId,
      publishTaskId: entry.publishTaskId,
      publishUrl: entry.publishUrl,
      externalId: entry.externalId,
      status: entry.status,
      evidence: entry.evidence,
    }));
  }

  private buildReadbackSnapshot(platforms: AutoUploadPublishPlatformEntry[]) {
    return {
      verified:
        platforms.length > 0 && platforms.every(hasVerifiedPlatformReadback),
      platforms: platforms.map((entry) => ({
        platform: entry.platform,
        accountId: entry.accountId,
        accountName: entry.accountName,
        accountStatus: entry.accountStatus,
        articleId: entry.articleId,
        publishTaskId: entry.publishTaskId,
        publishUrl: entry.publishUrl,
        externalId: entry.externalId,
        matched: hasVerifiedPlatformReadback(entry),
        evidence: entry.evidence,
      })),
    };
  }

  private platformColumn(result: AutoUploadPublishBatchResult) {
    const platforms = Array.from(
      new Set(result.platforms.map((entry) => entry.platform).filter(Boolean)),
    );
    return platforms.join(',') || 'publishing';
  }

  private accountColumn(result: AutoUploadPublishBatchResult) {
    return result.platforms.find((entry) => entry.accountId)?.accountId ?? null;
  }

  private matchesSearch(record: DurablePublishRecord, search: string) {
    const payloadValues = record.envelope.payloads.flatMap((payload) => [
      payload.articleId,
      payload.sourceIdentity?.title,
      payload.sourceIdentity?.sourceId,
      payload.accountIdentity?.name,
      payload.accountIdentity?.platform,
      payload.accountIdentity?.status,
    ]);
    const resultValues = record.envelope.result.platforms.flatMap((entry) => [
      entry.platform,
      entry.accountName,
      entry.accountId,
      entry.failureReason,
    ]);
    return [
      record.publicId,
      record.envelope.title,
      record.message,
      ...payloadValues,
      ...resultValues,
    ].some((value) =>
      String(value || '')
        .toLocaleLowerCase()
        .includes(search),
    );
  }

  private legacyMarker(storeKey: string) {
    return `${LEGACY_MARKER_PREFIX}${storeKey}`;
  }

  private safeTimestamp(value?: string) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed)
      ? new Date(parsed).toISOString()
      : new Date().toISOString();
  }

  private isValidPublicId(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, any>;
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async resolveTenantScope(): Promise<Record<string, string>> {
    if (!this.authRequestContext) return {};

    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后查看发布记录。');
    }

    try {
      const membership = await this.prisma.tenantMember.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
        select: { tenantId: true },
      });
      if (membership?.tenantId) {
        return { tenantId: membership.tenantId, userId };
      }
    } catch (error) {
      if (user?.kaypalLocalOnly !== true) throw error;
    }

    if (user?.kaypalLocalOnly === true) {
      return { tenantId: `local-desktop:${userId}`, userId };
    }

    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }
}

export function hasVerifiedPlatformReadback(
  entry: Pick<AutoUploadPublishPlatformEntry, 'evidence'>,
) {
  const evidence = asRecord(entry.evidence);
  if (!evidence) return false;
  const candidates = [evidence, asRecord(evidence.raw)].filter(
    (value): value is Record<string, unknown> => Boolean(value),
  );
  return candidates.some((candidate) => {
    const readback = asRecord(candidate.readback);
    return candidate.readbackOk === true || readback?.matched === true;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
