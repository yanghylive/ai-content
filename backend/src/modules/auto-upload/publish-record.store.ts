import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { assertPublishTransition } from './publish-state.machine';
import type {
  AutoUploadPublishBatchResult,
  AutoUploadPublishPayload,
  AutoUploadPublishPlatformEntry,
} from './auto-upload.client';

export const DURABLE_PUBLISH_RECORD_SOURCE = 'durable_publish_record';
export const DURABLE_PUBLISH_RECORD_TASK_TYPE = 'auto-upload-publish-record-v1';

const LEGACY_MARKER_PREFIX = 'legacy:auto-upload-batch:';

type PublishRecordStatus =
  'completed' | 'failed' | 'waiting' | 'claimed' | 'cancelled';

export type DurablePublishExecutionStatus = 'completed' | 'failed' | 'waiting';

export type DurablePublishResultState = {
  status: DurablePublishExecutionStatus;
  reasonCode: string;
  message: string;
};

export type DurablePublishExecutionOutcome = DurablePublishResultState & {
  /**
   * True when the execution path already persisted and released the claim.
   * False when the worker must finalize the still-claimed record.
   */
  claimReleased: boolean;
};

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
  /** 改期后的计划发布时间（ISO 8601），未改期则缺省 */
  plannedAt?: string;
  /** 取消时间（ISO 8601），取消后写入 */
  cancelledAt?: string;
  /** 执行层幂等键：发布执行开始前写入；崩溃重跑检测到已存在则不再重复发布 */
  attemptKey?: string;
  /** 最近一次执行开始时间（ISO 8601） */
  attemptStartedAt?: string;
  /** 执行中断、结果不确定，转人工确认 */
  outcomeUncertain?: { markedAt: string; reason: string };
  legacy?: {
    storeKey: string;
  };
};

export type PublishOwnerScope = {
  tenantId: string;
  userId: string;
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
  idempotencyKey: string | null;
  requestHash: string | null;
  confirmationId: string | null;
  authSessionId: string | null;
  claimToken: string | null;
  claimedAt: Date | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DurablePublishRecord = {
  databaseId: string;
  publicId: number;
  tenantId: string;
  userId: string;
  status: PublishRecordStatus;
  message: string;
  idempotencyKey: string | null;
  requestHash: string | null;
  confirmationId: string | null;
  authSessionId: string | null;
  claimToken: string | null;
  claimedAt: Date | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  envelope: DurablePublishRecordEnvelope;
  createdAt: Date;
  updatedAt: Date;
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

/** 发布日历单条任务（按天分组展示） */
export type PublishCalendarTask = {
  id: number; // publicId
  title: string;
  platform: string;
  status: string; // completed | failed | waiting | cancelled
  /** 计划发布时间（改期后），无则退回 createdAt */
  time: string; // ISO 8601
  isRescheduled: boolean;
};

/** 发布日历一天的分组 */
export type PublishCalendarDay = {
  date: string; // YYYY-MM-DD
  items: PublishCalendarTask[];
};

export type ReschedulePublishInput = {
  plannedAt: string; // ISO 8601
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

export type CreateDurablePublishClaimInput = CreateDurablePublishRecordInput & {
  idempotencyKey: string;
  requestHash: string;
  confirmationId: string;
  authSessionId: string;
};

export type ClaimDurablePublishRecordResult =
  | { kind: 'created'; record: DurablePublishRecord }
  | { kind: 'existing'; record: DurablePublishRecord };

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
    return row ? this.decode(row) : null;
  }

  async resolveOwnerScope(): Promise<PublishOwnerScope> {
    if (!this.authRequestContext || !this.authRequestContext.hasContext()) {
      throw new UnauthorizedException('缺少登录上下文，不能创建发布任务。');
    }
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后创建发布任务。');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  async findClaimByIdempotencyKey(
    scope: PublishOwnerScope,
    idempotencyKey: string,
    tx?: Prisma.TransactionClient,
  ): Promise<DurablePublishRecord | null> {
    const db = tx ?? this.prisma;
    const row = await db.runtimeExecution.findUnique({
      where: {
        tenantId_userId_taskType_idempotencyKey: {
          ...scope,
          taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
          idempotencyKey,
        },
      },
    });
    return row ? this.decode(row) : null;
  }

  async createClaim(
    scope: PublishOwnerScope,
    input: CreateDurablePublishClaimInput,
    tx?: Prisma.TransactionClient,
  ): Promise<DurablePublishRecord> {
    const db = tx ?? this.prisma;
    const now = this.safeTimestamp(input.recordedAt);
    const envelope = this.buildEnvelope(input, now, now);
    let preferredPublicId = input.preferredPublicId;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicId = await this.allocatePublicId(
        preferredPublicId,
        scope,
        db,
      );
      try {
        const created = await db.runtimeExecution.create({
          data: {
            ...scope,
            relatedId: String(publicId),
            relatedType: 'publish-command',
            executor: 'local-runtime',
            platform: 'publishing',
            taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
            accountId: null,
            ok: false,
            status: 'queued',
            reasonCode: 'queued',
            userMessage: '发布任务已安全排队，等待本机执行。',
            technicalMessage: null,
            runtimeJson: this.jsonValue(envelope),
            evidenceJson: this.jsonValue([]),
            readbackJson: Prisma.JsonNull,
            agentSSessionId: null,
            engineUrl: 'internal://auto-upload/publish-records',
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            confirmationId: input.confirmationId,
            authSessionId: input.authSessionId,
            attemptCount: 0,
            createdAt: new Date(now),
          },
        });
        const record = this.decode(created);
        if (!record) {
          throw new Error('持久化发布任务格式无效');
        }
        return record;
      } catch (error) {
        if (!this.isDurablePublishPublicIdConflict(error)) throw error;
        preferredPublicId = publicId + 1;
      }
    }

    throw new Error('无法分配唯一的发布任务编号');
  }

  async claimNextQueued(
    now: Date,
    leaseExpiresAt: Date,
    claimToken: string,
    maxAttempts = 3,
  ): Promise<DurablePublishRecord | null> {
    const candidate = await this.prisma.runtimeExecution.findFirst({
      where: {
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        status: 'queued',
        claimToken: null,
        leaseExpiresAt: null,
        attemptCount: { lt: maxAttempts },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!candidate) return null;

    assertPublishTransition('queued', 'claimed');
    const claimed = await this.prisma.runtimeExecution.updateMany({
      where: {
        id: candidate.id,
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        status: 'queued',
        claimToken: null,
        leaseExpiresAt: null,
      },
      data: {
        status: 'claimed',
        reasonCode: 'claimed',
        userMessage: '发布任务已由本机执行器接收。',
        claimToken,
        claimedAt: now,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;

    const row = await this.prisma.runtimeExecution.findFirst({
      where: { id: candidate.id, claimToken },
    });
    return row ? this.decode(row) : null;
  }

  async completeClaimedTask(
    databaseId: string,
    claimToken: string,
    status: DurablePublishExecutionStatus,
    reasonCode: string,
    userMessage: string,
  ): Promise<boolean> {
    assertPublishTransition('claimed', status);
    const result = await this.prisma.runtimeExecution.updateMany({
      where: {
        id: databaseId,
        claimToken,
        status: 'claimed',
      },
      data: {
        status,
        reasonCode,
        userMessage,
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  async renewLease(
    databaseId: string,
    claimToken: string,
    newLeaseExpiresAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.runtimeExecution.updateMany({
      where: {
        id: databaseId,
        claimToken,
        status: 'claimed',
      },
      data: { leaseExpiresAt: newLeaseExpiresAt },
    });
    return result.count === 1;
  }

  async reclaimStaleClaims(
    now: Date,
    maxAttempts = 3,
  ): Promise<{ reclaimed: number; deadLettered: number }> {
    assertPublishTransition('claimed', 'failed');
    const deadLettered = await this.prisma.runtimeExecution.updateMany({
      where: {
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        status: 'claimed',
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: maxAttempts },
      },
      data: {
        status: 'failed',
        reasonCode: 'max_attempts_exceeded',
        userMessage: `发布任务重试超过 ${maxAttempts} 次，已标记为永久失败。`,
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
      },
    });

    assertPublishTransition('claimed', 'queued');
    const reclaimed = await this.prisma.runtimeExecution.updateMany({
      where: {
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        status: 'claimed',
        leaseExpiresAt: { lt: now },
        attemptCount: { lt: maxAttempts },
      },
      data: {
        status: 'queued',
        reasonCode: 'lease_expired',
        userMessage: '执行器租约过期，任务已重新排队。',
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
      },
    });

    return { reclaimed: reclaimed.count, deadLettered: deadLettered.count };
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
    return row ? this.decode(row) : null;
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

    const record = this.decode(created);
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
    const claimRelease = record.claimToken
      ? {
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
        }
      : {};
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
        ...claimRelease,
      },
    });

    await this.updateLinkedPublishRecords(
      record.databaseId,
      scope,
      envelope.payloads,
      result,
    );
    await this.markVerifiedArticlesPublished(scope, result, envelope.payloads);

    const decoded = this.decode(updated);
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

  /**
   * 发布日历：近 N 天任务按天分组（含改期/取消后状态）。
   * 仅统计 taskType 为发布记录的聚合任务，不含内部测试任务。
   */
  async listCalendar(days = 7): Promise<PublishCalendarDay[]> {
    const scope = await this.resolveTenantScope();
    const safeDays = Math.max(1, Math.min(31, Math.floor(days)));
    // 窗口 = 今天前后对称：过去 (safeDays-1) 天 + 今天 + 未来 (safeDays-1) 天
    // 这样改期到未来几天内的任务依然可见（发布日历的看板价值在计划）
    const since = new Date();
    since.setDate(since.getDate() - (safeDays - 1));
    since.setHours(0, 0, 0, 0);
    const until = new Date();
    until.setDate(until.getDate() + (safeDays - 1));
    until.setHours(23, 59, 59, 999);

    // 为窗口内每一天构造 plannedAt 匹配（JSON path string_contains 按 YYYY-MM-DD 前缀匹配）
    const totalDays = safeDays * 2 - 1;
    const plannedAtMatches: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < totalDays; offset += 1) {
      const day = new Date(since);
      day.setDate(day.getDate() + offset);
      plannedAtMatches.push({
        runtimeJson: {
          // SQLite 的 Prisma Json path 用字符串路径（$.plannedAt），不是数组（数组是 Postgres JSONPath 语法）
          path: '$.plannedAt',
          string_contains: this.localDateKey(day),
        },
      });
    }

    const rows = await this.prisma.runtimeExecution.findMany({
      where: {
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        ...scope,
        OR: [{ createdAt: { gte: since, lte: until } }, ...plannedAtMatches],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const byDay = new Map<string, PublishCalendarTask[]>();
    for (const row of rows) {
      const record = this.decode(row);
      if (!record) continue;
      const envelope = record.envelope;
      const result = this.asRecord(envelope.result);
      const platformEntries = Array.isArray(result?.platforms)
        ? (result.platforms as Array<{ platform?: string }>)
        : [];
      const platformNames = platformEntries
        .map((entry) => entry.platform)
        .filter((value): value is string => Boolean(value));
      const task: PublishCalendarTask = {
        id: record.publicId,
        title: envelope.title || `发布任务 #${record.publicId}`,
        platform:
          platformNames.length > 0
            ? platformNames.join('、')
            : envelope.platformType
              ? String(envelope.platformType)
              : 'publishing',
        status: record.status,
        time: envelope.plannedAt || record.createdAt.toISOString(),
        isRescheduled: Boolean(envelope.plannedAt),
      };
      const dayKey = this.localDateKey(new Date(task.time));
      const list = byDay.get(dayKey) ?? [];
      list.push(task);
      byDay.set(dayKey, list);
    }

    // 补齐窗口每一天（含未来改期日）的空分组，保证日历连续
    const result: PublishCalendarDay[] = [];
    for (let offset = 0; offset < totalDays; offset += 1) {
      const date = new Date(since);
      date.setDate(date.getDate() + offset);
      const key = this.localDateKey(date);
      result.push({
        date: key,
        items: (byDay.get(key) ?? []).sort((a, b) =>
          a.time.localeCompare(b.time),
        ),
      });
    }
    return result;
  }

  /** 本地时区 YYYY-MM-DD（避免 toISOString 的 UTC 切日偏移） */
  private localDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** 取消排队中的发布任务（仅 queued/未认领，完成后不可取消） */
  async cancelTask(
    record: DurablePublishRecord,
  ): Promise<DurablePublishRecord> {
    const scope = await this.resolveTenantScope();
    this.assertRecordScope(record, scope);
    if (!['waiting', 'queued'].includes(record.status)) {
      throw new ForbiddenException(
        `只有排队中的任务可以取消（当前状态：${record.status}）。`,
      );
    }
    const updatedAt = new Date().toISOString();
    const envelope: DurablePublishRecordEnvelope = {
      ...record.envelope,
      cancelledAt: updatedAt,
      updatedAt,
    };
    assertPublishTransition(record.status, 'cancelled');
    const updated = await this.prisma.runtimeExecution.update({
      where: { id: record.databaseId },
      data: {
        status: 'cancelled',
        reasonCode: 'cancelled',
        userMessage: '任务已取消，不再执行发布。',
        runtimeJson: this.jsonValue(envelope),
      },
    });
    const decoded = this.decode(updated);
    if (!decoded) throw new Error('取消后的发布记录格式无效');
    return decoded;
  }

  /** 执行层幂等：发布开始前写入 attemptKey，崩溃重跑据此识别"上次已开始" */
  async markPublishAttemptStarted(
    record: DurablePublishRecord,
    attemptKey: string,
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    const envelope: DurablePublishRecordEnvelope = {
      ...record.envelope,
      attemptKey,
      attemptStartedAt: updatedAt,
      updatedAt,
    };
    await this.prisma.runtimeExecution.update({
      where: { id: record.databaseId },
      data: { runtimeJson: this.jsonValue(envelope) },
    });
  }

  /** 执行中断、结果不确定：不重复发布，标记失败并转人工确认 */
  async markOutcomeUncertain(
    record: DurablePublishRecord,
    reason: string,
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    const envelope: DurablePublishRecordEnvelope = {
      ...record.envelope,
      outcomeUncertain: { markedAt: updatedAt, reason },
      updatedAt,
    };
    assertPublishTransition('claimed', 'failed');
    await this.prisma.runtimeExecution.update({
      where: { id: record.databaseId },
      data: {
        status: 'failed',
        reasonCode: 'outcome_uncertain',
        userMessage: reason,
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        runtimeJson: this.jsonValue(envelope),
      },
    });
  }

  resolveResultState(
    result: AutoUploadPublishBatchResult,
  ): DurablePublishResultState {
    const state = this.resolveState(result);
    return {
      status: state.status as DurablePublishExecutionStatus,
      reasonCode: state.reasonCode,
      message: state.message,
    };
  }

  /** 改期：记录计划发布时间并把任务移出排队（到点由扫描器重新入队） */
  async rescheduleTask(
    record: DurablePublishRecord,
    input: ReschedulePublishInput,
  ): Promise<DurablePublishRecord> {
    const scope = await this.resolveTenantScope();
    this.assertRecordScope(record, scope);
    if (record.status !== 'waiting') {
      throw new ForbiddenException(
        `只有等待中的任务可以改期（当前状态：${record.status}）。`,
      );
    }
    const plannedAt = new Date(input.plannedAt);
    if (Number.isNaN(plannedAt.getTime())) {
      throw new ForbiddenException('改期时间格式无效。');
    }
    const updatedAt = new Date().toISOString();
    const envelope: DurablePublishRecordEnvelope = {
      ...record.envelope,
      plannedAt: plannedAt.toISOString(),
      updatedAt,
    };
    const updated = await this.prisma.runtimeExecution.update({
      where: { id: record.databaseId },
      data: {
        status: 'waiting',
        reasonCode: 'rescheduled',
        userMessage: `已改期至 ${plannedAt.toLocaleString('zh-CN')}。`,
        runtimeJson: this.jsonValue(envelope),
      },
    });
    const decoded = this.decode(updated);
    if (!decoded) throw new Error('改期后的发布记录格式无效');
    return decoded;
  }

  /** 扫描到点的改期任务，重新入队等待执行；返回重新入队数量 */
  async reenqueueDueScheduled(now = new Date()): Promise<number> {
    // 后台扫描可能没有登录上下文：有则按用户隔离，无则扫全量（本地单机默认租户）
    let scope: Record<string, string> = {};
    try {
      scope = await this.resolveTenantScope();
    } catch {
      scope = {};
    }
    const dueRows = await this.prisma.runtimeExecution.findMany({
      where: {
        taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
        ...scope,
        status: 'waiting',
      },
      take: 200,
    });
    let reenqueued = 0;
    for (const row of dueRows) {
      const envelope = this.asRecord(row.runtimeJson);
      const plannedAt = envelope?.plannedAt as string | undefined;
      if (!plannedAt) continue;
      const planned = Date.parse(plannedAt);
      if (!Number.isFinite(planned) || planned > now.getTime()) continue;
      assertPublishTransition('waiting', 'queued');
      await this.prisma.runtimeExecution.update({
        where: { id: row.id },
        data: {
          status: 'queued',
          reasonCode: 'queued',
          userMessage: '已到计划发布时间，重新进入发布队列。',
          runtimeJson: this.jsonValue({
            ...envelope,
            plannedAt: undefined,
          }),
        },
      });
      reenqueued += 1;
    }
    return reenqueued;
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
    // S0-P1-5：tenant 存在时校验 tenant+user；legacy 无 tenant 时也必须校验 userId，
    // 杜绝「tenantId 为空就跳过校验」导致的跨用户操作发布记录。
    const tenantMatches = !scope.tenantId || record.tenantId === scope.tenantId;
    const userMatches = record.userId === scope.userId;
    if (!tenantMatches || !userMatches) {
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
        row.status === 'completed' ||
        row.status === 'failed' ||
        row.status === 'cancelled' ||
        row.status === 'claimed'
          ? row.status
          : 'waiting',
      message: row.userMessage,
      idempotencyKey: row.idempotencyKey,
      requestHash: row.requestHash,
      confirmationId: row.confirmationId,
      authSessionId: row.authSessionId,
      claimToken: row.claimToken,
      claimedAt: row.claimedAt,
      leaseExpiresAt: row.leaseExpiresAt,
      attemptCount: row.attemptCount,
      envelope: envelope as DurablePublishRecordEnvelope,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private isDurablePublishPublicIdConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const prismaError = error as {
      code?: unknown;
      meta?: { target?: unknown };
    };
    if (prismaError.code !== 'P2002') return false;
    const target = prismaError.meta?.target;
    if (typeof target === 'string') {
      return target.includes(
        'runtime_executions_durable_publish_related_id_key',
      );
    }
    if (!Array.isArray(target)) return false;
    const fields = new Set(
      target.filter((field): field is string => typeof field === 'string'),
    );
    return (
      fields.has('tenant_id') &&
      fields.has('user_id') &&
      (fields.has('relatedId') || fields.has('related_id'))
    );
  }

  private async allocatePublicId(
    preferred: number | undefined,
    scope: Record<string, string>,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    let candidate = this.isValidPublicId(preferred)
      ? preferred
      : Math.max(Date.now(), this.lastAllocatedPublicId + 1);

    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const existing = await db.runtimeExecution.findFirst({
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

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async resolveTenantScope(): Promise<PublishOwnerScope> {
    return this.resolveOwnerScope();
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
