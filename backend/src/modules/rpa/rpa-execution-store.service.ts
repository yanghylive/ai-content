import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * RPA 执行记录持久化（复核#2，对齐 3010-AI获客完整开发文档 §7.2）。
 *
 * 每次 RPA 任务持久化：账号、会话、模式、步骤、断点、证据、页面指纹、
 * 失败原因和下一动作。RPA 适配器不直接写 Lead/CRM。
 */

export interface RpaExecutionCreateInput {
  tenantId?: string | null;
  userId: string;
  platform: string;
  sessionId?: string | null;
  accountId?: string | null;
  mode?: string;
  steps?: unknown[];
  resumeStep?: string | null;
  reasonCode?: string | null;
  nextAction?: string | null;
  pageFingerprint?: string | null;
  evidence?: unknown[];
  status?: string;
  driverVersion?: string | null;
  runId?: string | null;
  /** 执行输入快照（恢复断点时重建执行参数） */
  inputJson?: Record<string, unknown>;
  userMessage: string;
  technicalMessage?: string | null;
  /**
   * P1-14 复核：记录来源审计语义——
   * 'driver'（默认）：真实浏览器执行（controller/driver 状态机，经独立步骤/证据/finalize 门禁）；
   * 'growth-synthesis'：Growth 获客流程合成留痕（非真实浏览器执行，不得冒充 RPA success）；
   * 'legacy-adapter' / 'manual-import'：旧适配器/手动导入路径。
   */
  source?: 'driver' | 'growth-synthesis' | 'legacy-adapter' | 'manual-import';
}

export interface RpaExecutionFinalizeInput {
  status?: string;
  reasonCode?: string | null;
  nextAction?: string | null;
  steps?: unknown[];
  resumeStep?: string | null;
  pageFingerprint?: string | null;
  evidence?: unknown[];
  technicalMessage?: string | null;
}

export interface RpaExecutionStepInput {
  /** 步骤名（可恢复断点，如 fetch-candidates / follow-up / readback） */
  stepName: string;
  status?: 'running' | 'success' | 'failed';
  reasonCode?: string | null;
  message?: string | null;
  evidenceUrl?: string | null;
  pageFingerprint?: string | null;
  occurredAt?: string;
  /** P1-2 复核：真实重试次数（driver 侧 attempt，默认 1，不再固定假值） */
  attempt?: number;
}

/**
 * 业务动作步骤：只有这些步骤成功才可能证明业务结果。
 * open-session / heartbeat 等只证明会话存在，不能作为业务成功证据。
 */
const BUSINESS_ACTION_STEPS = [
  'discover-keyword',
  'discover-account-works',
  'discover-recommended',
  'read-comments',
  'reply-comment',
] as const;

const RPA_EXECUTION_STATUSES = [
  'created', // §6.2 初始态（store 记录创建；实际引擎启动后转 running）
  'running',
  'paused',
  'needs-human',
  'reconcile_required',
  'success',
  'succeeded', // §6.2 文档命名别名（与 success 等价）
  'failed',
  'cancelled',
] as const;

type RpaExecutionStatus = (typeof RPA_EXECUTION_STATUSES)[number];

/**
 * 状态变化只允许沿可恢复工作流前进。终态只可提升到 reconcile_required
 * 用于审计对账，不能被任意调用重新激活或改写。
 */
const RPA_STATUS_TRANSITIONS: Readonly<
  Record<RpaExecutionStatus, readonly RpaExecutionStatus[]>
> = {
  created: ['running', 'failed', 'cancelled'],
  running: [
    'paused',
    'needs-human',
    'reconcile_required',
    'success',
    'failed',
    'cancelled',
  ],
  paused: [
    'running',
    'needs-human',
    'reconcile_required',
    'failed',
    'cancelled',
  ],
  'needs-human': [
    'running',
    'paused',
    'reconcile_required',
    'failed',
    'cancelled',
  ],
  reconcile_required: ['paused', 'needs-human', 'failed', 'cancelled'],
  success: ['reconcile_required'],
  succeeded: ['reconcile_required'],
  failed: ['reconcile_required'],
  cancelled: ['reconcile_required'],
};

@Injectable()
export class RpaExecutionStore {
  constructor(private readonly prisma: PrismaService) {}

  create(input: RpaExecutionCreateInput) {
    return this.prisma.rpaExecution.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId,
        platform: input.platform,
        sessionId: input.sessionId ?? null,
        accountId: input.accountId ?? null,
        mode: input.mode ?? 'unknown',
        steps: (input.steps ?? []) as Prisma.InputJsonValue,
        resumeStep: input.resumeStep ?? null,
        reasonCode: input.reasonCode ?? null,
        nextAction: input.nextAction ?? null,
        pageFingerprint: input.pageFingerprint ?? null,
        evidence: (input.evidence ?? []) as Prisma.InputJsonValue,
        inputJson: (input.inputJson ?? {}) as Prisma.InputJsonValue,
        status: input.status ?? 'running',
        // P1-14 复核：create 也必须透传 source（与 createWithLock 一致）——
        // growth 合成留痕走 create({source:'growth-synthesis'})，丢了会默认成
        // 'driver' 冒充真实浏览器执行，审计按 source 过滤失效。
        source: input.source ?? 'driver',
        driverVersion: input.driverVersion ?? null,
        runId: input.runId ?? null,
        userMessage: input.userMessage,
        technicalMessage: input.technicalMessage ?? null,
        startedAt: new Date(),
      },
    });
  }

  /**
   * P1 复核：并发锁原子化创建——事务内先查「同账号活动执行」再创建，
   * 消除「先查后建」的竞态窗口（两个并发请求同时通过检查）。
   * 冲突时抛错（调用方捕获转 ConflictException）。
   * P1-4 复核：锁维度升级为租户共享账号互斥——同租户成员使用同一纳管账号
   * 也必须互斥（浏览器 session/动作/证据不得串扰）；tenantId 缺失（legacy）回退 user 维度。
   */
  async createWithLock(input: RpaExecutionCreateInput) {
    const accountId = input.accountId ?? '';
    const userId = input.userId;
    const platform = input.platform;
    return this.prisma.$transaction(async (tx) => {
      if (accountId) {
        const active = await tx.rpaExecution.findFirst({
          where: input.tenantId
            ? {
                tenantId: input.tenantId,
                platform,
                accountId,
                status: { in: ['running', 'paused', 'needs-human'] },
              }
            : {
                userId,
                platform,
                accountId,
                status: { in: ['running', 'paused', 'needs-human'] },
              },
        });
        if (active) {
          throw new Error('account_busy');
        }
      }
      try {
        return await tx.rpaExecution.create({
          data: {
            tenantId: input.tenantId ?? null,
            userId,
            platform,
            sessionId: input.sessionId ?? null,
            accountId: input.accountId ?? null,
            mode: input.mode ?? 'unknown',
            steps: (input.steps ?? []) as Prisma.InputJsonValue,
            resumeStep: input.resumeStep ?? null,
            reasonCode: input.reasonCode ?? null,
            nextAction: input.nextAction ?? null,
            pageFingerprint: input.pageFingerprint ?? null,
            evidence: (input.evidence ?? []) as Prisma.InputJsonValue,
            inputJson: (input.inputJson ?? {}) as Prisma.InputJsonValue,
            status: input.status ?? 'running',
            // P1-14 复核：记录来源审计语义（driver 默认；合成/旧适配器路径显式标注，
            // 审计可按 source 过滤真实浏览器执行，合成记录不冒充 RPA success）
            source: input.source ?? 'driver',
            driverVersion: input.driverVersion ?? null,
            runId: input.runId ?? null,
            userMessage: input.userMessage,
            technicalMessage: input.technicalMessage ?? null,
            startedAt: new Date(),
          },
        });
      } catch (err) {
        // P1 复核：数据库级部分唯一索引冲突（P2002）= 并发创建撞上活动执行约束
        // → 转为 account_busy（与上面 findFirst 命中同语义，调用方转 ConflictException）。
        const code = (err as { code?: string } | null)?.code;
        if (code === 'P2002' || code === 'SQLITE_CONSTRAINT') {
          throw new Error('account_busy');
        }
        throw err;
      }
    });
  }

  /** 执行结束：写终态、步骤/断点/证据/指纹/原因/下一动作（带 owner scope，防 IDOR） */
  async finalize(
    id: string,
    owner: { userId: string; tenantId?: string | null },
    input: RpaExecutionFinalizeInput,
  ) {
    const existing = await this.findOne(id, owner);
    if (!existing) return null;
    // P1 复核（全面审查）：finalize 终态保护——已终态（success/failed/cancelled）
    // 记录不可被再次 finalize 改写（防客户端对已成功/已取消记录二次改终态绕过 transition 守卫）
    if (['success', 'failed', 'cancelled'].includes(existing.status)) {
      throw new Error(
        `非法 finalize：记录已处于终态 ${existing.status}，不可改写（如需人工核对请走 reconcile_required）`,
      );
    }
    let status = input.status ?? 'success';
    let reasonCode = input.reasonCode ?? null;
    let technicalMessage = input.technicalMessage ?? null;
    // 证据门禁（P0-1）：success 必须存在业务动作步骤（discover/read/reply）的成功记录；
    // 只有 open-session / heartbeat / unknown 步骤不能证明业务成功。
    if (status === 'success' || status === 'partial') {
      const steps = Array.isArray(existing.steps) ? existing.steps : [];
      const businessSteps = steps.filter(
        (s) =>
          s &&
          typeof s === 'object' &&
          typeof (s as { stepName?: string }).stepName === 'string' &&
          (BUSINESS_ACTION_STEPS as readonly string[]).includes(
            (s as { stepName: string }).stepName,
          ),
      );
      const businessSuccess = businessSteps.some(
        (s) => (s as { status?: string }).status === 'success',
      );
      // 证据契约：success 还必须有内容可追溯证据（rpa-items 带 externalContentId/sourceUrl，
      // 或 evidenceUrl）——候选真实存在且可访问，不只看步骤状态。
      // 校验合并本次提交的新证据（input.evidence）与记录已有证据——finalize 时新证据必须参与判定。
      const evidencePool = [
        ...((existing.evidence as Array<Record<string, unknown>> | null) ?? []),
        ...((input.evidence as Array<Record<string, unknown>> | null) ?? []),
      ];
      const hasContentEvidence = evidencePool.some(
        (ev) =>
          ev &&
          typeof ev === 'object' &&
          ((ev.type === 'rpa-items' &&
            Array.isArray(ev.externalContentIds) &&
            ev.externalContentIds.length > 0 &&
            Array.isArray(ev.sourceUrls) &&
            ev.sourceUrls.length > 0) ||
            (typeof ev.url === 'string' && ev.url.length > 0)),
      );
      // success：必须业务步骤成功 + 内容可追溯证据；partial：至少执行过业务步骤（未完成部分需 reasonCode 说明）
      const ok =
        status === 'success'
          ? businessSuccess && hasContentEvidence
          : businessSteps.length > 0 && Boolean(reasonCode);
      if (!ok) {
        status = 'reconcile_required';
        reasonCode = 'evidence_insufficient';
        technicalMessage =
          '缺少业务动作步骤（发现/读评论/回复）成功证据，不能标记成功/部分成功；需人工核对平台实际结果。';
      }
    }
    const fallbackEvidence = Array.isArray(existing.evidence)
      ? (existing.evidence as Array<Record<string, unknown>>)
      : [];
    const evidenceToPersist =
      Array.isArray(input.evidence) && input.evidence.length > 0
        ? (input.evidence as Array<Record<string, unknown>>)
        : fallbackEvidence;
    // P1 复核：finalize「主记录终态 + 独立证据表」同一事务——
    // 一起提交或一起回滚，失败时不残留「状态已改但证据未落」的半成品。
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.rpaExecution.update({
        where: {
          id,
          userId: owner.userId,
          ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
        },
        data: {
          status,
          reasonCode: reasonCode ?? null,
          nextAction: input.nextAction ?? null,
          steps:
            input.steps !== undefined
              ? (input.steps as Prisma.InputJsonValue)
              : undefined,
          resumeStep: input.resumeStep ?? null,
          pageFingerprint: input.pageFingerprint ?? null,
          evidence:
            input.evidence !== undefined
              ? (input.evidence as Prisma.InputJsonValue)
              : undefined,
          technicalMessage: technicalMessage ?? null,
          endedAt: new Date(),
        },
      });
      // P1 复核：证据 stepId 绑定——事务内查最新步骤记录的真实 id 作默认 stepId
      // （step_id 是 rpa_execution_steps.id 的真实外键，不再存 sequenceNo）。
      let defaultStepId: string | null = null;
      try {
        const latestStep = await tx.rpaExecutionStep.findFirst({
          where: { executionId: id },
          orderBy: { sequenceNo: 'desc' },
        });
        defaultStepId = latestStep ? latestStep.id : null;
      } catch {
        defaultStepId = null;
      }
      await this.persistEvidence(
        tx,
        id,
        owner,
        evidenceToPersist,
        defaultStepId,
      );
      return updated;
    });
  }

  /**
   * P1 复核：把证据上的 stepId 解析为 rpa_execution_steps.id 的真实外键。
   * - ev.stepId 缺省 → 用默认（最新步骤的真实 id）。
   * - ev.stepId 是纯数字（旧版写入的 sequenceNo 语义）→ 反查同执行下该 sequenceNo 的步骤记录真实 id。
   * - ev.stepId 已是字符串 id → 校验其属于本执行；不属于视为脏值回退默认。
   * 解析失败一律回退 defaultStepId（宁可绑到最新步骤，也不写悬空外键）。
   */
  private async resolveEvidenceStepId(
    tx: Prisma.TransactionClient,
    executionId: string,
    rawStepId: unknown,
    defaultStepId: string | null,
  ): Promise<string | null> {
    if (typeof rawStepId !== 'string' || rawStepId.length === 0) {
      return defaultStepId;
    }
    try {
      if (/^\d+$/.test(rawStepId)) {
        const bySequence = await tx.rpaExecutionStep.findFirst({
          where: { executionId, sequenceNo: Number(rawStepId) },
          select: { id: true },
        });
        return bySequence ? bySequence.id : defaultStepId;
      }
      const byId = await tx.rpaExecutionStep.findFirst({
        where: { id: rawStepId, executionId },
        select: { id: true },
      });
      return byId ? byId.id : defaultStepId;
    } catch {
      return defaultStepId;
    }
  }

  /**
   * 复核 #3：独立证据表持久化（P0 审计强一致：失败必抛，由事务一起回滚）。
   * sha256 = 内容指纹（唯一主键）；绑定 executionId/userId/platform/accountId。
   * 写入目标为事务客户端（tx），与主记录终态同事务提交。
   */
  private async persistEvidence(
    tx: Prisma.TransactionClient,
    executionId: string,
    owner: { userId: string; tenantId?: string | null },
    evidenceList: Array<Record<string, unknown>>,
    defaultStepId?: string | null,
  ): Promise<void> {
    for (const ev of evidenceList) {
      if (!ev || typeof ev !== 'object') continue;
      const createdAt =
        typeof ev.createdAt === 'string'
          ? ev.createdAt
          : new Date().toISOString();
      // P1 复核（审查 #11）：createdAt 来源不可信（客户端/驱动传入）——
      // 非法日期直接回退当前时间，防 Invalid Date 写入 PG 抛错回滚整个事务
      const capturedAtDate = new Date(createdAt);
      const capturedAtValid = !Number.isNaN(capturedAtDate.getTime());
      const capturedAtIso = capturedAtValid
        ? capturedAtDate.toISOString()
        : new Date().toISOString();
      const sha =
        typeof ev.sha256 === 'string' && ev.sha256
          ? // P1-1 复核：driver/controller 侧已是捕获物字节 hash → 直接采用（可复验）
            ev.sha256
          : // 兜底：元数据 hash（非捕获物，metadata 标注 source=metadata-hash 不可冒充）
            createHash('sha256')
              .update(
                JSON.stringify({
                  executionId,
                  kind: ev.type,
                  label: ev.label,
                  url: ev.url ?? '',
                  createdAt,
                }),
              )
              .digest('hex');
      try {
        // P1 复核（全面审查）：证据幂等键 = (executionId, sha256) 复合——
        // 原 sha256 全局唯一时，同内容证据跨执行 hash 相同会吞掉第二次执行的证据行
        await tx.rpaEvidence.upsert({
          where: {
            executionId_sha256: { executionId, sha256: sha },
          },
          update: {},
          create: {
            // P0 复核（二次）：主键混入 executionId——原 id 只由 sha 派生，
            // 复合唯一 (executionId, sha256) 允许跨执行同 sha，但相同 PK 会撞 P2002
            // 重新引入「第二次执行证据写不入」的 bug。
            id: `rev_${executionId.slice(0, 8)}_${sha.slice(0, 12)}`,
            sha256: sha,
            executionId,
            // P1 复核：stepId 解析为步骤记录真实 id（兼容 legacy sequenceNo 字符串），
            // 保证外键引用完整性，不写悬空值。
            stepId: await this.resolveEvidenceStepId(
              tx,
              executionId,
              ev.stepId,
              defaultStepId ?? null,
            ),
            tenantId: owner.tenantId ?? null,
            userId: owner.userId,
            platform: typeof ev.platform === 'string' ? ev.platform : '',
            accountId: typeof ev.accountId === 'string' ? ev.accountId : null,
            kind: typeof ev.type === 'string' ? ev.type : 'rpa-step',
            uri:
              typeof ev.url === 'string'
                ? ev.url
                : typeof ev.path === 'string'
                  ? ev.path
                  : null,
            capturedAt: new Date(capturedAtIso),
            metadata: ev as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        // P0 审计强一致：证据写入失败必须抛出（不吞）。
        // 商用审计不允许 best-effort——证据缺失则任务不能标成功。
        throw new Error(
          `RPA 证据写入独立表失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * 账号锁（P0-2 + P1-4）：同一「账号活动执行」存在（running/paused/needs-human）时返回 true，禁止并发。
   * P1-4 复核：有 tenantId 时按租户共享账号互斥（同租户成员用同一纳管账号也锁住，
   * 防浏览器 session/动作/证据串扰）；无 tenantId（legacy）回退 userId 维度。
   */
  async hasActiveExecution(
    owner: { userId: string; tenantId?: string | null },
    platform: string,
    accountId: string,
    excludeId?: string,
  ): Promise<boolean> {
    const active = await this.prisma.rpaExecution.findFirst({
      where: {
        platform,
        accountId,
        ...(owner.tenantId
          ? { tenantId: owner.tenantId }
          : { userId: owner.userId }),
        ...(excludeId ? { id: { not: excludeId } } : {}),
        status: { in: ['running', 'paused', 'needs-human'] },
      },
    });
    return Boolean(active);
  }

  list(owner: { userId: string; tenantId?: string | null }, limit = 50) {
    return this.prisma.rpaExecution.findMany({
      where: {
        userId: owner.userId,
        ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  findOne(id: string, owner: { userId: string; tenantId?: string | null }) {
    return this.prisma.rpaExecution.findFirst({
      where: {
        id,
        userId: owner.userId,
        ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
      },
    });
  }

  /**
   * P1-2 复核：步骤独立表为唯一事实源——详情/展示层读取用本方法。
   * 独立表（rpa_execution_steps）有步骤时以其为准（含真实 attempt/resultHash/endedAt）；
   * 独立表为空（legacy 记录，历史 JSON 有步骤）时回退 JSON 兼容展示。
   * 注意：appendStep 内部 sequenceNo 计算继续用 JSON（自身维护的存储），不受影响。
   */
  async findOneWithSteps(
    id: string,
    owner: { userId: string; tenantId?: string | null },
  ) {
    const run = await this.findOne(id, owner);
    if (!run) return null;
    const steps = await this.prisma.rpaExecutionStep.findMany({
      where: { executionId: id },
      orderBy: { sequenceNo: 'asc' },
      select: {
        stepName: true,
        status: true,
        reasonCode: true,
        message: true,
        attempt: true,
        resultHash: true,
        sequenceNo: true,
        endedAt: true,
      },
    });
    if (steps.length > 0) {
      // 独立表为准：覆盖 JSON steps（JSON 仅 legacy 回填）
      return { ...run, steps };
    }
    return run;
  }

  /**
   * 逐步状态机：追加一个执行步骤（P1-5 乐观锁：读 version → updateMany where version → 冲突重试）。
   * 带 owner scope（防 IDOR）；执行不存在时返回 null。
   */
  async appendStep(
    id: string,
    owner: { userId: string; tenantId?: string | null },
    input: RpaExecutionStepInput,
    opts?: { internal?: boolean },
  ) {
    // 证据门禁（P0-1）：非内部调用（客户端 appendStep 端点）只能上报 running；
    // 成功/失败状态只能由服务端执行器（driver.execute 返回后）写入。
    const status =
      opts?.internal === true ? (input.status ?? 'running') : 'running';
    // P1-2 复核：记录真实重试次数（driver 每次重试 attempt+1），不再固定 1
    const attempt = Math.max(1, input.attempt ?? 1);
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const step = {
      stepName: input.stepName,
      status,
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.message ? { message: input.message } : {}),
      // 证据门禁：evidenceUrl/pageFingerprint 只允许内部执行器写入（真实 driver 上下文）
      ...(opts?.internal === true && input.evidenceUrl
        ? { evidenceUrl: input.evidenceUrl }
        : {}),
      ...(opts?.internal === true && input.pageFingerprint
        ? { pageFingerprint: input.pageFingerprint }
        : {}),
      occurredAt,
    };
    // 乐观锁：最多重试 3 次（并发 append 冲突时重读重试，不丢步骤）
    for (let retry = 0; retry < 3; retry += 1) {
      const existing = await this.findOne(id, owner);
      if (!existing) return null;
      const version = Number(existing.version ?? 1);
      const steps = Array.isArray(existing.steps) ? existing.steps : [];
      // 文档 4.2：步骤带 sequenceNo/attempt/resultHash（可审计、可回放）
      const sequenceNo = steps.length + 1;
      const resultHash = createHash('sha256')
        .update(
          JSON.stringify({
            stepName: input.stepName,
            status,
            reasonCode: input.reasonCode ?? null,
            message: input.message ?? null,
            sequenceNo,
          }),
        )
        .digest('hex')
        .slice(0, 24);
      const nextSteps = [
        ...steps,
        { ...step, sequenceNo, attempt, resultHash },
      ];
      // P1 复核：主记录 CAS 更新 + 独立步骤表写入同一事务——
      // CAS 命中但步骤表写失败时一起回滚，不残留「主记录有步骤、步骤表缺失」的审计缺口。
      const applied = await this.prisma.$transaction(async (tx) => {
        const result = await tx.rpaExecution.updateMany({
          where: {
            id,
            userId: owner.userId,
            ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
            version,
          },
          data: {
            steps: nextSteps,
            version: version + 1,
            // 失败步骤可作为断点恢复点
            ...(input.status === 'failed'
              ? {
                  resumeStep: input.stepName,
                  reasonCode: input.reasonCode ?? null,
                }
              : {}),
          },
        });
        if (result.count !== 1) return false;
        // P0 审计强一致：独立步骤表写入失败必须抛出（事务回滚），
        // 让调用方感知"审计不能保证"，不得静默标成功。
        await tx.rpaExecutionStep.create({
          data: {
            executionId: id,
            sequenceNo,
            stepName: input.stepName,
            status,
            attempt,
            reasonCode: input.reasonCode ?? null,
            message: input.message ?? null,
            resultHash,
            endedAt: new Date(),
          },
        });
        return true;
      });
      if (applied) {
        return this.findOne(id, owner);
      }
      // 冲突：version 不匹配（其他并发写入先到），重读重试
    }
    throw new Error(
      'RPA 步骤写入并发冲突（超过重试次数），请稍后重试或转人工核对',
    );
  }

  /** 状态迁移：暂停/恢复/取消/人工接管（带 owner scope） */
  transition(
    id: string,
    owner: { userId: string; tenantId?: string | null },
    status: string,
    extra?: {
      resumeStep?: string | null;
      reasonCode?: string | null;
      nextAction?: string | null;
      technicalMessage?: string | null;
      /** 复核#4-4：恢复时重新绑定的会话 id（resume 重新 openSession） */
      sessionId?: string | null;
    },
  ) {
    return this.transitionWithGuard(id, owner, status, extra);
  }

  /**
   * P1-3 复核：状态机合法迁移校验——transition 不能接受任意目标状态。
   * 已终态（success/failed/cancelled）的记录不允许再被迁移（防已成功/已取消记录被
   * pause/cancel/takeover 再次改写）；reconcile_required 只能由终态/运行态进入（对账兜底），
   * 不能从 reconcile_required 迁移到业务终态之外的状态。
   */
  private async transitionWithGuard(
    id: string,
    owner: { userId: string; tenantId?: string | null },
    status: string,
    extra?: {
      resumeStep?: string | null;
      reasonCode?: string | null;
      nextAction?: string | null;
      technicalMessage?: string | null;
      sessionId?: string | null;
    },
  ) {
    const existing = await this.findOne(id, owner);
    if (!existing) return null;
    const from = existing.status as RpaExecutionStatus;
    const to = status as RpaExecutionStatus;
    if (
      !RPA_EXECUTION_STATUSES.includes(from) ||
      !RPA_EXECUTION_STATUSES.includes(to) ||
      !RPA_STATUS_TRANSITIONS[from].includes(to)
    ) {
      throw new Error(`非法状态迁移：${existing.status} → ${status}`);
    }
    return this.prisma.rpaExecution.update({
      where: {
        id,
        userId: owner.userId,
        ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
      },
      data: {
        status,
        ...(extra?.sessionId !== undefined
          ? { sessionId: extra.sessionId }
          : {}),
        resumeStep: extra?.resumeStep ?? null,
        reasonCode: extra?.reasonCode ?? null,
        nextAction: extra?.nextAction ?? null,
        technicalMessage: extra?.technicalMessage ?? null,
        ...(['success', 'failed', 'cancelled'].includes(status)
          ? { endedAt: new Date() }
          : {}),
      },
    });
  }
}
