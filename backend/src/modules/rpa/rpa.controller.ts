import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RpaDriverRegistry } from './rpa-driver-registry.service';
import { RpaExecutionStore } from './rpa-execution-store.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

type AuthenticatedRequest = Request & {
  authUser?: { id?: string; tenantId?: string | null };
};

/**
 * RPA 能力查询 + 执行接口（复核#1/#2 + 阶段 B 执行闭环）。
 * 前端据此展示各平台 RPA 动作的支持状态（不支持的显式标注原因，不伪装），
 * 并创建/执行/暂停/恢复/取消/人工接管 RPA 任务，记录逐步状态机。
 * 全部执行端点带 owner scope（userId + tenantId），防 IDOR。
 */
@ApiTags('统一RPA')
@Controller('rpa')
export class RpaController {
  private readonly logger = new Logger(RpaController.name);
  constructor(
    private readonly registry: RpaDriverRegistry,
    private readonly store: RpaExecutionStore,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  /**
   * P1 复核：账号归属强约束——校验 accountId 是否属于当前用户/租户（exposure_accounts）。
   * 不归属 → 拒绝创建（防越权使用他人账号）。无 exposure_accounts 记录时放行（兼容未纳管账号）。
   */
  /**
   * 账号归属强约束（fail-closed，复核 P1）：
   * 1. 账号必须存在于授权账号表（无记录 → 阻断，不再放行未纳管账号）；
   * 2. 归属当前用户，或账号 owner 与当前用户同租户（经 TenantMember）；
   * 3. 任一查询异常 → 阻断执行（不再 fail-open）。
   * ExposureAccount 只有 userId（无 tenantId），故用 TenantMember 判定租户共享，
   * 不能拿 owner.tenantId 直接当 userId 查。
   */
  private async assertAccountOwnership(
    owner: { userId: string; tenantId?: string | null },
    platform: string,
    accountId: string,
  ): Promise<void> {
    // 1. 账号必须存在于授权账号表（fail-closed：查询失败即阻断）
    let account: { userId: string; status: string } | null;
    try {
      account = await this.prisma.exposureAccount.findFirst({
        where: { platform, accountId, status: 'active' },
        select: { userId: true, status: true },
      });
    } catch (err) {
      this.logger.error(
        `[assertAccountOwnership] 账号归属校验查询失败 platform=${platform} account=${accountId}：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new BadRequestException(
        `账号归属校验失败（授权表查询异常），已阻断执行；请稍后重试`,
      );
    }
    if (!account) {
      throw new BadRequestException(
        `账号 ${accountId}（${platform}）未纳管授权，禁止使用；请先在账号管理中纳管该账号`,
      );
    }
    // 2a. 直接归属当前用户 → 放行
    if (account.userId === owner.userId) return;
    // 2b. 账号 owner 与当前用户同租户（经 TenantMember）→ 放行
    if (owner.tenantId) {
      let sameTenant: { id: string } | null;
      try {
        sameTenant = await this.prisma.tenantMember.findFirst({
          where: {
            tenantId: owner.tenantId,
            userId: account.userId,
            status: 'active',
          },
          select: { id: true },
        });
      } catch (err) {
        this.logger.error(
          `[assertAccountOwnership] 租户成员校验查询失败：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new BadRequestException(
          `账号归属校验失败（租户成员查询异常），已阻断执行；请稍后重试`,
        );
      }
      if (sameTenant) return;
    }
    // 3. 既非本人也非同租户 → 拒绝
    throw new BadRequestException(
      `账号 ${accountId}（${platform}）不属于当前用户/租户，无权使用；请切换为您纳管的账号`,
    );
  }

  private resolveOwner(request?: AuthenticatedRequest): {
    userId: string;
    tenantId?: string | null;
  } {
    const ctx = this.authRequestContext?.get();
    const userId =
      request?.authUser?.id?.trim() ||
      ctx?.user?.id?.trim() ||
      'legacy-local-user';
    if (!userId) throw new UnauthorizedException('请先登录');
    // tenantId：authUser 携带优先，其次请求上下文
    return {
      userId,
      tenantId: request?.authUser?.tenantId ?? ctx?.tenantId ?? null,
    };
  }

  @Get('capabilities')
  @ApiOperation({
    summary:
      'RPA 能力总览；带 platform+accountId 时返回该账号级 preflight（P1-1）',
  })
  async listCapabilities(
    @Req() request: AuthenticatedRequest,
    @Query('platform') platform?: string,
    @Query('accountId') accountId?: string,
  ) {
    if (platform && accountId) {
      const owner = this.resolveOwner(request);
      // 复核 P0：能力探测也要账号归属校验（防对任意 platform+accountId 探测）
      await this.assertAccountOwnership(owner, platform, accountId);
      const driver = this.registry.get(platform);
      if (!driver) return [];
      const caps = await driver.capabilities({ accountId });
      // P1-5 复核：preflight 注入账号级 busy（活动执行锁）/cooldown（配额冷却），
      // 前端据此展示「账号忙碌/冷却中」而非仅"会话就绪"。
      if (caps.accountProbe) {
        const active = await this.store.hasActiveExecution(
          owner,
          platform,
          accountId,
        );
        caps.accountProbe.busy = active;
        caps.accountProbe.cooldown = false;
      }
      return [caps];
    }
    return this.registry.listCapabilities();
  }

  @Get('executions')
  @ApiOperation({ summary: 'RPA 执行记录列表（步骤/断点/证据/指纹/失败原因）' })
  @ApiQuery({ name: 'limit', required: false })
  listExecutions(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: number,
  ) {
    return this.store.list(
      this.resolveOwner(request),
      limit ? Number(limit) : 50,
    );
  }

  @Get('executions/:id')
  @ApiOperation({ summary: 'RPA 执行记录详情（逐步状态机）' })
  async getExecution(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const owner = this.resolveOwner(request);
    // P1-2 复核：步骤以独立表为唯一事实源（含真实 attempt/resultHash/endedAt）
    const run = await this.store.findOneWithSteps(id, owner);
    if (!run) throw new NotFoundException('RPA 执行记录不存在');
    return run;
  }

  @Post('executions')
  @ApiOperation({
    summary: '创建并立即执行 RPA 任务（openSession → 首个动作 → 终态）',
  })
  async createExecution(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      platform: string;
      accountId: string;
      mode?: string;
      driverVersion?: string;
      runId?: string;
      /** 首个动作输入：discover-keyword 用 keyword；read-comments 用 sourceUrl；discover-account-works 用 targetId */
      keyword?: string;
      sourceUrl?: string;
      targetId?: string;
    },
  ) {
    const owner = this.resolveOwner(request);
    // P1 复核：账号归属强约束（不归属当前用户/租户 → 拒绝）
    await this.assertAccountOwnership(owner, body.platform, body.accountId);
    // P0-2 账号锁：同一账号活动执行互斥（同账号并发 → account_busy）
    const busy = await this.store.hasActiveExecution(
      owner,
      body.platform,
      body.accountId,
    );
    if (busy) {
      throw new ConflictException(
        `账号 ${body.accountId} 已有进行中的任务（running/paused/needs-human），不能并发执行；请先暂停/取消/接管处理`,
      );
    }
    // 复核#4-2：driver 不存在/未就绪/动作不支持 → 拒绝创建（不降级假 sessionId + running）
    const opened = await this.openDriverSession(
      owner,
      body.platform,
      body.accountId,
      body.mode,
    );
    if (!opened) {
      const reason = await this.unavailableReason(body.platform, body.mode);
      throw new BadRequestException(
        `${body.platform} ${body.mode ?? 'keyword'} 暂不可执行：${reason}`,
      );
    }
    if ('blocked' in opened) {
      // P1-5 复核：preflight 阻断给准确原因（busy/浏览器未就绪/页面不可交互/验证码/风控/未登录）
      throw new BadRequestException(
        `账号 ${body.accountId} 预检未通过（${opened.blocked}），暂不能执行；请先处理账号状态后重试`,
      );
    }
    const { driver, session, action, caps } = opened;
    // P1 复核：「打开会话 → 创建记录 → 执行 → 关闭会话」统一 try/finally。
    // store.create 写失败也会走 finally 关闭会话（不泄漏）；关闭失败转 reconcile_required。
    let record: Awaited<ReturnType<RpaExecutionStore['create']>> | null = null;
    try {
      // P1 复核：用事务化 createWithLock（原子查+建），消除「先查后建」竞态。
      // account_busy 冲突 → ConflictException（与前面 hasActiveExecution 快路径语义一致）。
      try {
        record = await this.store.createWithLock({
          tenantId: owner.tenantId,
          userId: owner.userId,
          platform: body.platform,
          sessionId: session.sessionId,
          accountId: body.accountId,
          mode: body.mode ?? 'keyword',
          driverVersion: body.driverVersion ?? caps.driverVersion ?? '1.0.0',
          runId: body.runId ?? null,
          // P0-3：快照执行输入，恢复断点时重建执行参数
          inputJson: this.buildExecutionInput(body, action),
          userMessage: `${caps.displayName ?? body.platform} 执行开始`,
          status: 'running',
        });
      } catch (lockErr) {
        if (lockErr instanceof Error && lockErr.message === 'account_busy') {
          throw new ConflictException(
            `账号 ${body.accountId} 已有进行中的任务（并发创建被事务锁拦截）；请先处理现有任务`,
          );
        }
        throw lockErr;
      }
      // 复核#4-1：创建后立即执行首个动作，成功/失败都写终态，不无限停留 running
      const input = this.buildExecutionInput(body, action);
      const result = await driver.execute(session, {
        name: action,
        action,
        input,
      });
      if (result.status === 'success') {
        await this.store.appendStep(
          record.id,
          owner,
          {
            stepName: action,
            status: 'success',
            reasonCode: 'ok',
            message:
              result.message ||
              `${caps.displayName ?? body.platform} ${action} 完成`,
            evidenceUrl: result.evidenceUrl,
            pageFingerprint: result.pageFingerprint,
          },
          { internal: true },
        );
        await this.store.finalize(record.id, owner, {
          status: 'success',
          reasonCode: 'ok',
          evidence: this.stepEvidence(result, {
            executionId: record.id,
            accountId: body.accountId,
            platform: body.platform,
          }),
          technicalMessage: result.message ?? null,
        });
      } else {
        await this.store.appendStep(
          record.id,
          owner,
          {
            stepName: action,
            status: 'failed',
            reasonCode: result.reasonCode,
            message: result.message || `${action} 执行失败`,
          },
          { internal: true },
        );
        await this.store.finalize(record.id, owner, {
          status: 'failed',
          reasonCode: result.reasonCode,
          nextAction: '检查平台会话/页面结构后重试，或转人工接管',
          technicalMessage: result.message ?? null,
        });
      }
    } catch (error) {
      // 执行/建记录异常如实记失败（不伪装成功）
      if (record) {
        await this.store.appendStep(
          record.id,
          owner,
          {
            stepName: action,
            status: 'failed',
            reasonCode: 'network_error',
            message: error instanceof Error ? error.message : '执行异常',
          },
          { internal: true },
        );
        await this.store.finalize(record.id, owner, {
          status: 'failed',
          reasonCode: 'network_error',
          nextAction: '检查平台会话后重试',
          technicalMessage:
            error instanceof Error ? error.message : String(error),
        });
      } else {
        throw error; // store.create 失败：直接抛出（finally 仍会关闭会话）
      }
    } finally {
      // P0-2 + P1 复核：成功/失败/异常三分支都释放真实浏览器会话，防止残留执行
      const closeIssue = await this.closeDriverSession({
        platform: body.platform,
        sessionId: session.sessionId,
        accountId: body.accountId,
      });
      // P1 复核：关闭失败必须改变任务终态 → reconcile_required（需人工核对浏览器是否仍在运行）
      if (closeIssue && record) {
        await this.store.appendStep(
          record.id,
          owner,
          {
            stepName: 'close-session',
            status: 'failed',
            reasonCode: 'close_failed',
            message: `浏览器会话关闭失败：${closeIssue}；需人工检查是否仍在运行`,
          },
          { internal: true },
        );
        await this.store.transition(record.id, owner, 'reconcile_required', {
          reasonCode: 'close_failed',
          nextAction: '浏览器会话关闭失败，请人工检查浏览器是否仍在运行',
          technicalMessage: `任务执行已完成，但浏览器会话关闭失败：${closeIssue}`,
        });
      }
    }
    return record ? this.store.findOne(record.id, owner) : null;
  }

  /**
   * 复核#4-2：严格打开 driver 会话。
   * driver 不存在/动作不支持/运行时未就绪/openSession 失败 → 返回 null（调用方拒绝创建）。
   */
  /**
   * P1-5 复核：统一 preflight 门禁——账号级 probe 任一关键维度不通过 → 返回阻断原因。
   * 覆盖：登录态 / 浏览器就绪 / 页面可交互 / 验证码 / 风控 / 账号忙碌（busy）。
   * 返回 null = 可执行。四处调用点（创建/恢复/回复/Growth 执行）统一走这里，不再漏维度。
   */
  private probeBlockReason(probe?: {
    loggedIn?: boolean;
    browserReady?: boolean;
    pageInteractive?: boolean;
    captchaRequired?: boolean;
    riskControl?: boolean;
    busy?: boolean;
    reasonCode?: string | null;
  }): string | null {
    // 无 probe 或 driver 未返回账号级信息（无 loggedIn 键）→ 放行（保持原语义）
    if (!probe || !('loggedIn' in probe)) return null;
    if (probe.busy) return 'account_busy';
    if (!probe.loggedIn) return probe.reasonCode ?? 'not_logged_in';
    if (probe.captchaRequired) return 'captcha_required';
    if (probe.riskControl) return 'risk_control';
    if (probe.browserReady === false) return 'browser_not_ready';
    if (probe.pageInteractive === false) return 'page_not_interactive';
    return null;
  }

  /**
   * 打开 driver 会话前的账号级预检（P1-1/P1-5）：
   * 登录态/验证码/风控/browserReady/pageInteractive/busy 任一不通过 → 返回 null。
   */
  private async openDriverSession(
    owner: { userId: string; tenantId?: string | null },
    platform: string,
    accountId: string,
    mode?: string,
  ): Promise<
    | {
        driver: import('./rpa-driver.interface').RpaDriver;
        session: import('./rpa.types').RpaSession;
        action: string;
        caps: import('./rpa.types').RpaCapability;
      }
    | { blocked: string }
    | null
  > {
    try {
      const driver = this.registry.get(platform);
      if (!driver) return null;
      // P1-1/P1-5 复核：创建任务必须账号级预检——登录态/验证码/风控/
      // browserReady/pageInteractive/busy 任一不通过直接拒绝创建（不再用全局
      // capabilities 冒充账号状态）。busy 由 createWithLock 账号锁兜底，这里同查。
      const caps = await driver.capabilities({ accountId });
      const probe = caps.accountProbe;
      const blocked = this.probeBlockReason({
        ...probe,
        busy:
          probe?.busy ||
          (await (
            this.store.hasActiveExecution?.(owner, platform, accountId) ??
            Promise.resolve(false)
          ).catch(() => false)),
      });
      if (blocked) {
        this.logger.warn(
          `[openDriverSession] ${platform}/${accountId} preflight 阻断：${blocked}（reason=${probe?.reasonCode ?? ''}）`,
        );
        // P1-5 复核：返回具体阻断原因（account_busy/browser_not_ready/...），
        // createExecution 据此给用户准确提示，而不是笼统的「动作暂不支持」
        return { blocked };
      }
      const action = this.modeToAction(mode);
      if (!action) return null;
      const cap = caps.actions.find((item) => item.action === action);
      if (!caps.runtimeReady || !cap?.supported) return null;
      const session = await driver.openSession({
        tenantId: owner.tenantId ?? undefined,
        userId: owner.userId,
        accountId,
        runId: `rpa-manual-${Date.now()}`,
      });
      return { driver, session, action, caps };
    } catch {
      return null;
    }
  }

  /** 平台/模式不可用的具体原因（供拒绝创建时告知用户） */
  private async unavailableReason(
    platform: string,
    mode?: string,
  ): Promise<string> {
    const driver = this.registry.get(platform);
    if (!driver) return '该平台无统一 RPA 驱动';
    try {
      const caps = await driver.capabilities();
      if (!caps.runtimeReady) {
        return '浏览器会话未就绪（请先登录平台账号）';
      }
      const action = this.modeToAction(mode);
      if (!action) return `模式 ${mode ?? 'unknown'} 不支持 RPA 执行`;
      const cap = caps.actions.find((item) => item.action === action);
      return (
        cap?.unavailableReason ??
        cap?.unavailableReasonCode ??
        `动作 ${action} 暂不支持`
      );
    } catch {
      return '驱动能力查询失败';
    }
  }

  /** 模式 → RPA 动作（与 growth 侧 driverActionForMode 对齐；video-link = 读评论） */
  private modeToAction(mode?: string): string | null {
    if (mode === 'keyword') return 'discover-keyword';
    if (mode === 'video-link') return 'read-comments';
    if (mode === 'search-account' || mode === 'target-account')
      return 'discover-account-works';
    // Sprint 5：推荐流独立模式（与关键词搜索解耦）
    if (mode === 'recommended') return 'discover-recommended';
    if (!mode) return 'discover-keyword';
    return null;
  }

  /** 首个动作输入构造 */
  private buildExecutionInput(
    body: {
      keyword?: string;
      sourceUrl?: string;
      targetId?: string;
    },
    action: string,
  ): Record<string, unknown> {
    if (action === 'read-comments') {
      // P1 复核（全面审查）：透传 keyword——小红书读评论需会话内搜索定位
      // （直开详情 404），原实现把 keyword 当 contentUrl 兜底导致 XHS 必失败。
      return {
        contentUrl: body.sourceUrl ?? '',
        keyword: body.keyword?.trim() || undefined,
        limit: 20,
      };
    }
    if (action === 'discover-account-works') {
      return { targetId: body.targetId ?? '', limit: 20 };
    }
    return { keyword: body.keyword ?? '', limit: 20 };
  }

  /**
   * 复核#4-4 / P0-2：关闭真实 driver 会话（暂停/取消/接管时冻结浏览器执行）。
   * 关闭失败返回 close_failed 原因（不静默当成功），由调用方记录到状态迁移。
   */
  private async closeDriverSession(run: {
    platform: string;
    sessionId?: string | null;
    accountId?: string | null;
  }): Promise<string | null> {
    if (!run.sessionId) return null;
    const driver = this.registry.get(run.platform);
    if (!driver) return null;
    try {
      await driver.closeSession({
        sessionId: run.sessionId,
        platform: run.platform as never,
        accountId: run.accountId ?? '',
        // P1 复核（全面审查）：显式传 engineSessionKey（任务键 = platform-account），
        // 让 driver 归属校验分支走通；engine 层 browserReused 兜底防误杀用户手动窗口
        engineSessionKey: `${run.platform}-${run.accountId ?? ''}`,
        pageAvailable: false,
      });
      return null;
    } catch (error) {
      // P0-2：关闭失败不能静默——返回 close_failed，状态迁移时如实标注需人工检查
      return error instanceof Error ? error.message : 'close_failed';
    }
  }

  /**
   * 复核#4-4：重新打开 driver 会话（resume 时绑定新会话 id）。
   * driver 不可用/运行时未就绪 → 返回 null（状态机仍迁移，前端提示检查登录态）。
   */
  private async reopenDriverSession(
    run: { platform: string; accountId?: string | null },
    owner: { userId: string; tenantId?: string | null },
  ): Promise<string | null> {
    const driver = this.registry.get(run.platform);
    if (!driver) return null;
    try {
      // 卡点1：恢复重开会话也走账号级预检（未登录/验证码/风控 → 不重开）
      const caps = await driver.capabilities({
        accountId: run.accountId ?? '',
      });
      const probe = caps.accountProbe;
      if (!caps.runtimeReady) return null;
      // P1-5 复核：恢复统一走完整 preflight 门禁（登录态/验证码/风控/browserReady/pageInteractive/busy）
      if (probe && this.probeBlockReason(probe)) return null;
      const session = await driver.openSession({
        tenantId: owner.tenantId ?? undefined,
        userId: owner.userId,
        accountId: run.accountId ?? '',
        runId: `rpa-resume-${Date.now()}`,
      });
      return session.sessionId;
    } catch {
      return null;
    }
  }

  /**
   * P1-1 复核：证据 hash = 捕获物字节 SHA-256（可复验）。
   * - 本地文件路径（截图/DOM 快照）→ 读真实字节计算；
   * - 非文件（URL/指纹/items）→ 对捕获内容序列化字节计算；
   * - 完全无法获取内容 → 元数据 hash 兜底并在 metadata 标注 source=metadata-hash。
   */
  private hashEvidenceBytes(
    kind: string,
    content: string,
    contentBytes?: Buffer,
    meta?: Record<string, unknown>,
  ): { sha256: string; metadata: Record<string, unknown> } {
    if (contentBytes) {
      return {
        sha256: createHash('sha256').update(contentBytes).digest('hex'),
        metadata: { ...meta, source: 'capture-bytes' },
      };
    }
    const bytes = Buffer.from(content, 'utf8');
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      metadata: { ...meta, source: 'capture-content' },
    };
  }

  /** 本地文件存在则读取字节（证据捕获物），否则 null */
  private readEvidenceFile(path: string): Buffer | null {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  }

  /** 步骤结果 → 证据数组（4.4：服务端生成 sha256 + 绑定 execution/step/account/platform） */
  private stepEvidence(
    result: {
      evidenceUrl?: string;
      screenshotPath?: string;
      pageFingerprint?: string;
      items?: unknown[];
      message?: string;
    },
    binding?: {
      executionId?: string;
      stepId?: string;
      accountId?: string;
      platform?: string;
    },
  ): Array<{
    type: string;
    label: string;
    url?: string;
    path?: string;
    createdAt: string;
    sha256?: string;
    metadata?: Record<string, unknown>;
    executionId?: string;
    stepId?: string;
    accountId?: string;
    platform?: string;
    externalContentIds?: string[];
    sourceUrls?: string[];
  }> {
    const evidence: Array<{
      type: string;
      label: string;
      url?: string;
      path?: string;
      createdAt: string;
      sha256?: string;
      metadata?: Record<string, unknown>;
      executionId?: string;
      stepId?: string;
      accountId?: string;
      platform?: string;
      externalContentIds?: string[];
      sourceUrls?: string[];
    }> = [];
    const createdAt = new Date().toISOString();
    const bind = {
      executionId: binding?.executionId,
      stepId: binding?.stepId,
      accountId: binding?.accountId,
      platform: binding?.platform,
    };
    if (result.evidenceUrl) {
      // P1-1 复核：本地文件证据读真实字节 hash；否则对 URL 内容序列化字节 hash
      const fileBytes = this.readEvidenceFile(result.evidenceUrl);
      const hash = this.hashEvidenceBytes(
        'rpa-step',
        result.evidenceUrl,
        fileBytes ?? undefined,
      );
      evidence.push({
        type: 'rpa-step',
        label: '步骤证据',
        url: result.evidenceUrl,
        createdAt,
        sha256: hash.sha256,
        metadata: hash.metadata,
        ...bind,
      });
    }
    if (result.screenshotPath) {
      // P1-1 复核：截图 = 真实文件字节 hash（可复验捕获物）
      const fileBytes = this.readEvidenceFile(result.screenshotPath);
      const hash = this.hashEvidenceBytes(
        'rpa-screenshot',
        result.screenshotPath,
        fileBytes ?? undefined,
      );
      evidence.push({
        type: 'rpa-screenshot',
        label: '页面截图',
        path: result.screenshotPath,
        createdAt,
        sha256: hash.sha256,
        metadata: hash.metadata,
        ...bind,
      });
    }
    if (result.pageFingerprint) {
      // P1-1 复核：指纹 = 指纹内容序列化字节 hash
      const hash = this.hashEvidenceBytes(
        'rpa-fingerprint',
        result.pageFingerprint,
      );
      evidence.push({
        type: 'rpa-fingerprint',
        label: result.pageFingerprint.slice(0, 16),
        createdAt,
        sha256: hash.sha256,
        metadata: hash.metadata,
        ...bind,
      });
    }
    if (Array.isArray(result.items) && result.items.length) {
      // 证据契约：rpa-items 带内容可追溯字段（externalContentId/sourceUrl），
      // finalize 门禁据此校验"候选真实存在且可访问"，不只看步骤状态。
      const contentRefs = result.items
        .map((item) => {
          const it = item as {
            externalContentId?: string;
            url?: string;
          };
          return it.externalContentId && it.url
            ? `${it.externalContentId}:${it.url}`
            : it.url
              ? it.url
              : '';
        })
        .filter(Boolean)
        .slice(0, 10);
      // P1-1 复核：rpa-items 补证据 hash = 发现结果序列化字节 hash（可复验候选集合）
      const itemsHash = this.hashEvidenceBytes(
        'rpa-items',
        JSON.stringify(result.items),
      );
      evidence.push({
        type: 'rpa-items',
        label: `发现 ${result.items.length} 条`,
        externalContentIds: contentRefs.map((ref) => ref.split(':')[0]),
        sourceUrls: contentRefs.map((ref) =>
          ref.includes(':') ? ref.split(':').slice(1).join(':') : ref,
        ),
        createdAt: new Date().toISOString(),
        sha256: itemsHash.sha256,
        metadata: itemsHash.metadata,
      });
    }
    return evidence;
  }

  @Post('executions/:id/steps')
  @ApiOperation({ summary: '上报执行进度（appendStep）' })
  async appendStep(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      stepName: string;
      status?: 'running';
      reasonCode?: string;
      message?: string;
    },
  ) {
    const owner = this.resolveOwner(request);
    // 证据门禁（P0-1）：客户端只能上报 running 进度；
    // 成功/失败状态与证据只能由服务端执行器（driver.execute 返回后）写入。
    if (body.status && body.status !== 'running') {
      throw new BadRequestException(
        '客户端不能提交成功/失败状态；执行结果由服务端执行器写入',
      );
    }
    const updated = await this.store.appendStep(id, owner, {
      stepName: body.stepName,
      status: 'running',
      reasonCode: body.reasonCode,
      message: body.message,
    });
    if (!updated) throw new NotFoundException('RPA 执行记录不存在');
    return updated;
  }

  @Post('executions/:id/pause')
  @ApiOperation({
    summary:
      '暂停（关闭真实浏览器会话冻结执行；断点由服务端记录，前端不能指定）',
  })
  async pause(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const owner = this.resolveOwner(request);
    const run = await this.store.findOne(id, owner);
    if (!run) throw new NotFoundException('RPA 执行记录不存在');
    // 复核#4-4：真实会话控制——关闭浏览器页面冻结执行（防暂停后仍在自动操作）
    const closeIssue = await this.closeDriverSession(run);
    if (closeIssue) {
      // P0-7 复核：浏览器关闭失败 → 不能写 paused（浏览器可能仍在自动操作），
      // 转 reconcile_required 保留 session/状态供人工核对。
      await this.store.appendStep(
        id,
        owner,
        {
          stepName: 'close-session',
          status: 'failed',
          reasonCode: 'close_failed',
          message: `暂停时浏览器会话关闭失败：${closeIssue}；需人工检查浏览器是否仍在执行`,
        },
        { internal: true },
      );
      return this.store.transition(id, owner, 'reconcile_required', {
        resumeStep: run.resumeStep ?? null,
        reasonCode: 'close_failed',
        nextAction:
          '浏览器会话关闭失败，不能确认已暂停；请人工检查浏览器后重试暂停或接管',
        technicalMessage: `暂停请求未确认：浏览器会话关闭失败 ${closeIssue}`,
      });
    }
    const updated = await this.store.transition(id, owner, 'paused', {
      resumeStep: run.resumeStep ?? null,
      reasonCode: 'user_paused',
      nextAction: '用户暂停后可从断点恢复',
      technicalMessage: '已关闭浏览器会话，执行已冻结',
    });
    return updated;
  }

  @Post('executions/:id/resume')
  @ApiOperation({ summary: '恢复（从服务端断点 resumeStep 真正续跑）' })
  async resume(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const owner = this.resolveOwner(request);
    const run = await this.store.findOne(id, owner);
    if (!run) throw new NotFoundException('RPA 执行记录不存在');
    // P1 复核：恢复也校验账号归属（防越权恢复他人任务）
    await this.assertAccountOwnership(owner, run.platform, run.accountId ?? '');
    // P0-3：只能从 paused / needs-human 恢复
    if (run.status !== 'paused' && run.status !== 'needs-human') {
      throw new BadRequestException(
        `当前状态 ${run.status} 不可恢复；仅 paused / needs-human 可恢复`,
      );
    }
    const resumeStep = run.resumeStep;
    if (!resumeStep) {
      throw new BadRequestException('该执行记录没有断点（resumeStep 为空）');
    }
    // 账号锁：恢复期间同账号互斥（防并发恢复）
    const busy = await this.store.hasActiveExecution(
      owner,
      run.platform,
      run.accountId ?? '',
      run.id,
    );
    if (busy) {
      throw new ConflictException(
        `账号 ${run.accountId} 已有其他进行中的任务，不能恢复；请先处理现有任务`,
      );
    }
    const driver = this.registry.get(run.platform);
    if (!driver) {
      throw new BadRequestException(`${run.platform} driver 不可用，无法恢复`);
    }
    // 重新探测账号（登录态/风控/browserReady/pageInteractive/busy）——
    // P1-5 复核：统一完整 preflight 门禁，不满足则结构化失败，不回退成 running
    const caps = await driver.capabilities({ accountId: run.accountId ?? '' });
    const probe = caps.accountProbe;
    const blocked = probe ? this.probeBlockReason(probe) : null;
    if (blocked) {
      throw new BadRequestException(
        `账号 ${run.accountId} 预检未通过（${probe?.reasonCode ?? blocked}），无法恢复；请登录或转人工处理`,
      );
    }
    if (!caps.runtimeReady) {
      throw new BadRequestException(
        `${caps.displayName ?? run.platform} 浏览器会话未就绪，请检查平台登录态`,
      );
    }
    // 打开会话 → 从断点执行（try/finally 包全程：execute/appendStep/finalize 任一异常都释放会话）
    const session = await driver.openSession({
      tenantId: owner.tenantId ?? undefined,
      userId: owner.userId,
      accountId: run.accountId ?? '',
      runId: `rpa-resume-${Date.now()}`,
    });
    let updated: Awaited<ReturnType<typeof this.store.transition>> | null =
      null;
    try {
      let result: Awaited<ReturnType<typeof driver.execute>> | null = null;
      try {
        const input = this.rebuildResumeInput(run);
        result = await driver.execute(session, {
          name: resumeStep,
          action: resumeStep,
          input,
        });
      } catch (error) {
        await this.store.appendStep(
          run.id,
          owner,
          {
            stepName: resumeStep,
            status: 'failed',
            reasonCode: 'network_error',
            message: `恢复执行异常：${
              error instanceof Error ? error.message : String(error)
            }`,
          },
          { internal: true },
        );
      }
      if (result?.status === 'success') {
        await this.store.appendStep(
          run.id,
          owner,
          {
            stepName: resumeStep,
            status: 'success',
            reasonCode: 'ok',
            message:
              result.message ||
              `${caps.displayName ?? run.platform} ${resumeStep} 恢复执行完成`,
            evidenceUrl: result.evidenceUrl,
            pageFingerprint: result.pageFingerprint,
          },
          { internal: true },
        );
        // 恢复成功写入新的服务端证据（stepEvidence：候选内容 ID/URL/回读摘要），
        // 证据门禁据此通过；不复用旧证据。
        const newEvidence = this.stepEvidence(result, {
          executionId: run.id,
          accountId: run.accountId ?? '',
          platform: run.platform,
        });
        await this.store.finalize(run.id, owner, {
          status: 'success',
          reasonCode: 'ok',
          resumeStep: null,
          nextAction: null,
          evidence: newEvidence,
          technicalMessage: '已从断点恢复执行完成',
        });
      } else if (result) {
        await this.store.appendStep(
          run.id,
          owner,
          {
            stepName: resumeStep,
            status: 'failed',
            reasonCode: result.reasonCode,
            message: result.message || `${resumeStep} 恢复执行失败（断点保留）`,
          },
          { internal: true },
        );
        updated = await this.store.transition(run.id, owner, 'paused', {
          sessionId: session.sessionId,
          resumeStep,
          reasonCode: 'resume_failed',
          nextAction: '检查断点原因后再次恢复，或转人工接管',
          technicalMessage: '恢复执行失败，断点已保留',
        });
      } else {
        // execute 抛异常路径：步骤已记 failed，补终态
        updated = await this.store.transition(run.id, owner, 'paused', {
          sessionId: session.sessionId,
          resumeStep,
          reasonCode: 'resume_failed',
          nextAction: '检查断点原因后再次恢复，或转人工接管',
          technicalMessage: '恢复执行异常，断点已保留',
        });
      }
    } finally {
      // 会话泄漏修复：恢复成功/失败/异常都释放真实浏览器会话
      const closeIssue = await this.closeDriverSession({
        platform: run.platform,
        sessionId: session.sessionId,
        accountId: run.accountId ?? '',
      });
      // P1 复核：关闭失败必须改变任务终态 → reconcile_required
      if (closeIssue) {
        await this.store.appendStep(
          run.id,
          owner,
          {
            stepName: 'close-session',
            status: 'failed',
            reasonCode: 'close_failed',
            message: `浏览器会话关闭失败：${closeIssue}；需人工检查是否仍在运行`,
          },
          { internal: true },
        );
        await this.store.transition(run.id, owner, 'reconcile_required', {
          reasonCode: 'close_failed',
          nextAction: '浏览器会话关闭失败，请人工检查浏览器是否仍在运行',
          technicalMessage: `恢复执行已完成，但浏览器会话关闭失败：${closeIssue}`,
        });
      }
    }
    if (updated) return updated;
    return this.store.findOne(run.id, owner);
  }

  /** P0-3：从执行记录重建恢复步骤的执行参数（inputJson 快照优先，兼容旧记录回退） */
  private rebuildResumeInput(run: {
    inputJson?: unknown;
    keyword?: string | null;
    sourceUrl?: string | null;
  }): Record<string, unknown> {
    const snapshot =
      run.inputJson && typeof run.inputJson === 'object'
        ? (run.inputJson as Record<string, unknown>)
        : {};
    if (snapshot && Object.keys(snapshot).length > 0) return snapshot;
    return {
      ...(run.keyword ? { keyword: run.keyword } : {}),
      ...(run.sourceUrl ? { sourceUrl: run.sourceUrl } : {}),
    };
  }

  @Post('executions/:id/cancel')
  @ApiOperation({ summary: '取消（关闭真实浏览器会话 + 终态）' })
  async cancel(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const owner = this.resolveOwner(request);
    const run = await this.store.findOne(id, owner);
    if (!run) throw new NotFoundException('RPA 执行记录不存在');
    // 复核#4-4：真实会话控制——关闭浏览器页面，防止已取消任务继续发送
    const closeIssue = await this.closeDriverSession(run);
    if (closeIssue) {
      // P0-7 复核：浏览器关闭失败 → 不能写 cancelled（已取消任务可能仍在发送），
      // 转 reconcile_required 保留人工处置。
      await this.store.appendStep(
        id,
        owner,
        {
          stepName: 'close-session',
          status: 'failed',
          reasonCode: 'close_failed',
          message: `取消时浏览器会话关闭失败：${closeIssue}；需人工检查浏览器是否仍在执行`,
        },
        { internal: true },
      );
      return this.store.transition(id, owner, 'reconcile_required', {
        reasonCode: 'close_failed',
        nextAction:
          '浏览器会话关闭失败，不能确认已取消；请人工检查浏览器后重试取消或接管',
        technicalMessage: `取消请求未确认：浏览器会话关闭失败 ${closeIssue}`,
      });
    }
    const updated = await this.store.transition(id, owner, 'cancelled', {
      reasonCode: 'user_cancelled',
      nextAction: null,
      technicalMessage: '已关闭浏览器会话，任务已终止',
    });
    return updated;
  }

  @Post('executions/:id/manual-takeover')
  @ApiOperation({ summary: '人工接管（标记 needs-human，停止自动执行）' })
  async manualTakeover(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { nextAction?: string } = {},
  ) {
    const owner = this.resolveOwner(request);
    const run = await this.store.findOne(id, owner);
    if (!run) throw new NotFoundException('RPA 执行记录不存在');
    // P0-2：人工接管必须真实停止自动执行（关闭浏览器会话），页面进入人工可控状态
    const closeIssue = await this.closeDriverSession(run);
    if (closeIssue) {
      // P0-7 复核：浏览器关闭失败 → 不能写 needs-human（自动执行可能仍在跑），
      // 转 reconcile_required 保留人工处置。
      await this.store.appendStep(
        id,
        owner,
        {
          stepName: 'close-session',
          status: 'failed',
          reasonCode: 'close_failed',
          message: `人工接管时浏览器会话关闭失败：${closeIssue}；需人工检查浏览器是否仍在执行`,
        },
        { internal: true },
      );
      return this.store.transition(id, owner, 'reconcile_required', {
        reasonCode: 'close_failed',
        nextAction:
          '浏览器会话关闭失败，不能确认自动执行已停止；请人工检查浏览器后重试接管',
        technicalMessage: `人工接管未确认：浏览器会话关闭失败 ${closeIssue}`,
      });
    }
    const updated = await this.store.transition(id, owner, 'needs-human', {
      reasonCode: 'manual_takeover',
      nextAction: body.nextAction ?? '已转人工接管，请人工确认账号与目标后继续',
      technicalMessage: '已关闭浏览器会话，自动执行已停止',
    });
    if (!updated) throw new NotFoundException('RPA 执行记录不存在');
    return updated;
  }

  @Post('executions/:id/finalize')
  @ApiOperation({
    summary: '完成回读（写终态；成功/partial 证据门禁由服务端校验）',
  })
  async finalize(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      status?: 'success' | 'failed' | 'partial';
      reasonCode?: string;
      nextAction?: string;
    } = {},
  ) {
    const owner = this.resolveOwner(request);
    const existing = await this.store.findOne(id, owner);
    if (!existing) throw new NotFoundException('RPA 执行记录不存在');
    const targetStatus = body.status ?? 'success';
    // 复核#4-3 + P0-1：客户端不能提交任意 evidence——证据只能由服务端执行器生成。
    // 成功/partial 是否达标由 store.finalize 依据记录内业务步骤校验（不足 → reconcile_required）。
    const updated = await this.store.finalize(id, owner, {
      status: targetStatus,
      reasonCode: body.reasonCode,
      nextAction: body.nextAction,
    });
    return updated;
  }

  /**
   * 人工确认式触达：回复指定评论（dryRun=true 只填框不发送，预览用）。
   * 真实发送是平台写操作，调用方（前端工作台）必须经用户逐条确认。
   */
  @Post('actions/reply-comment')
  @ApiOperation({
    summary: '回复指定评论（dryRun=true 预览不发送；确认后 dryRun=false 真发）',
  })
  async replyComment(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      platform: string;
      accountId: string;
      contentUrl: string;
      keyword?: string;
      targetText: string;
      replyText: string;
      dryRun?: boolean;
    },
  ) {
    const owner = this.resolveOwner(request);
    // 复核 P0：真实触达前必须账号归属校验（防对不属于自己的账号执行外部回复）
    await this.assertAccountOwnership(owner, body.platform, body.accountId);
    const driver = this.registry.get(body.platform);
    if (!driver) throw new BadRequestException(`${body.platform} 无 RPA 驱动`);
    // 卡点1/P1-5：回复评论（真实触达）前必须完整账号级 preflight——未登录/风控/
    // browserReady/pageInteractive/busy 任一不通过拒绝，防绕过
    const caps = await driver.capabilities({ accountId: body.accountId });
    const probe = caps.accountProbe;
    const blocked = probe ? this.probeBlockReason(probe) : null;
    if (blocked) {
      throw new BadRequestException(
        `账号 ${body.accountId} 预检未通过（${probe?.reasonCode ?? blocked}），不能回复评论；请登录或转人工处理`,
      );
    }
    const cap = caps.actions.find((item) => item.action === 'reply-comment');
    if (!caps.runtimeReady || !cap?.supported) {
      throw new BadRequestException(
        `${body.platform} 回复评论不可用：${cap?.unavailableReason ?? '运行时未就绪'}`,
      );
    }
    // P1 复核：本次回复绑定独立 runId（不再无记录或写「最新一条」其他任务的执行记录）
    const replyRunId = `rpa-reply-${Date.now()}`;
    const session = await driver.openSession({
      tenantId: owner.tenantId ?? undefined,
      userId: owner.userId,
      accountId: body.accountId,
      runId: replyRunId,
    });
    // P1 复核：独立执行记录（绑定本次 runId），关闭失败/成功都归属本记录，不污染其他任务
    let replyRecordId: string | null = null;
    // P1 复核：成功响应先存变量（finally 在 return 之后执行无法改返回值），
    // 关闭会话失败时统一降级为 sent:false + reconcile_required，避免「前端成功、后台待核对」不一致。
    let replyOutcome: {
      platform: string;
      dryRun: boolean;
      sent: boolean;
      status?: 'success' | 'partial' | 'reconcile_required';
      message?: string;
      rpaRecordId: string | null;
    } = {
      platform: body.platform,
      dryRun: body.dryRun === true,
      sent: false,
      message: undefined,
      rpaRecordId: null,
    };
    try {
      // P0 复核：审计记录创建失败必须阻断外发——真实回复是平台写操作，
      // 无 rpa_executions 记录则不可追责，不允许「无审计外发」。
      try {
        const record = await this.store.createWithLock({
          tenantId: owner.tenantId,
          userId: owner.userId,
          platform: body.platform,
          sessionId: session.sessionId,
          accountId: body.accountId,
          mode: 'reply-comment',
          status: 'running',
          driverVersion: caps.driverVersion ?? '1.0.0',
          runId: replyRunId,
          inputJson: {
            contentUrl: body.contentUrl,
            targetText: body.targetText,
            replyText: body.replyText,
            dryRun: body.dryRun === true,
          },
          userMessage: `回复评论：${body.targetText}`,
        });
        replyRecordId = record?.id ?? null;
      } catch (lockErr) {
        // P1 复核：与主执行路径统一原子锁语义——同账号并发操作被事务锁拦截 → 409
        if (lockErr instanceof Error && lockErr.message === 'account_busy') {
          throw new ConflictException(
            `账号 ${body.accountId} 已有进行中的任务（回复评论被事务锁拦截）；请先处理现有任务`,
          );
        }
        // P0 复核：记录创建失败（非并发）→ 阻断外发，不发送（无审计不可追责）
        throw new BadRequestException(
          `RPA 执行记录创建失败，已阻断回复（无审计不可追责）：${
            lockErr instanceof Error ? lockErr.message : String(lockErr)
          }`,
        );
      }
      const result = await driver.execute(session, {
        name: 'reply-comment',
        action: 'reply-comment',
        input: {
          contentUrl: body.contentUrl,
          keyword: body.keyword,
          targetText: body.targetText,
          replyText: body.replyText,
          dryRun: body.dryRun === true,
          userId: owner.userId,
        },
      });
      if (result.status !== 'success') {
        // 失败：如实写失败步骤 + failed 终态（尽力而为，失败本身已如实返回）
        if (replyRecordId) {
          await this.store
            .appendStep(
              replyRecordId,
              owner,
              {
                stepName: 'reply-comment',
                status: 'failed',
                reasonCode: result.reasonCode,
                message:
                  result.message ||
                  `${body.platform} 回复评论失败：${result.reasonCode}`,
              },
              { internal: true },
            )
            .catch(() => undefined);
          await this.store
            .finalize(replyRecordId, owner, {
              status: 'failed',
              reasonCode: result.reasonCode,
              nextAction: '请重试或转人工核对平台实际结果',
            })
            .catch(() => undefined);
        }
        throw new BadRequestException(
          result.message ||
            `${body.platform} 回复评论失败：${result.reasonCode}`,
        );
      }
      // 成功：写成功步骤 + 证据 + 终态（dryRun 预览未真实发送 → partial，不冒充 success）。
      // P0 复核：步骤/终态审计写入失败 → 不允许返回 sent:true（无审计外发不可追责），
      // 转 reconcile_required 后如实抛错，前端/人工可见「需核对」而非成功。
      // P0-4 复核：sent 必须以 finalize 返回的最终状态为准——driver 报 success 但
      // 证据不足时 store.finalize 会降级 reconcile_required，接口不得仍报 sent:true。
      let auditWriteFailed: string | null = null;
      let finalStatus: string | null = null;
      if (replyRecordId) {
        try {
          await this.store.appendStep(
            replyRecordId,
            owner,
            {
              stepName: 'reply-comment',
              status: 'success',
              reasonCode: 'ok',
              message: result.message,
              evidenceUrl: result.evidenceUrl,
              pageFingerprint: result.pageFingerprint,
            },
            { internal: true },
          );
          const finalized = await this.store.finalize(replyRecordId, owner, {
            status: body.dryRun === true ? 'partial' : 'success',
            reasonCode: 'ok',
            nextAction: null,
            evidence: this.stepEvidence(result, {
              executionId: replyRecordId,
              accountId: body.accountId,
              platform: body.platform,
            }),
          });
          finalStatus = finalized?.status ?? null;
        } catch (auditErr) {
          auditWriteFailed =
            auditErr instanceof Error ? auditErr.message : String(auditErr);
        }
      }
      if (auditWriteFailed) {
        // 审计写入失败：先尽力落 reconcile_required，再如实抛错（不返回 sent:true）
        if (replyRecordId) {
          await this.store
            .transition(replyRecordId, owner, 'reconcile_required', {
              reasonCode: 'audit_write_failed',
              nextAction:
                '回复可能已发送，但审计写入失败，请人工核对平台实际结果',
              technicalMessage: auditWriteFailed,
            })
            .catch(() => undefined);
        }
        throw new BadRequestException(
          `回复已执行但审计写入失败（${auditWriteFailed}），已标记需人工核对，不能确认发送结果`,
        );
      }
      // P0-4 复核：最终状态以 finalize 为准——
      //   success → sent:true；partial（dryRun 预览）→ sent:false + partial；
      //   reconcile_required（无回读证据被门禁降级）→ sent:false + reconcile_required。
      const isDryRun = body.dryRun === true;
      const auditStatus = finalStatus ?? (isDryRun ? 'partial' : 'success');
      replyOutcome = {
        platform: body.platform,
        dryRun: isDryRun,
        sent: !isDryRun && auditStatus === 'success',
        status:
          auditStatus === 'success'
            ? 'success'
            : auditStatus === 'reconcile_required'
              ? 'reconcile_required'
              : 'partial',
        message:
          auditStatus === 'reconcile_required'
            ? '回复可能已发送，但无平台回读证据，请人工核对平台实际结果'
            : result.message,
        rpaRecordId: replyRecordId,
      };
    } finally {
      // 会话泄漏修复：回复评论成功/失败/异常都释放真实浏览器会话
      // P1 复核：finally 只记录 closeIssue（不 return——return 会吞掉 try 抛出的异常）
      const closeIssue = await this.closeDriverSession({
        platform: body.platform,
        sessionId: session.sessionId,
        accountId: body.accountId,
      });
      if (closeIssue) {
        // 关闭失败不吞也不在 finally 抛（unsafe）：通过返回字段如实标注，前端/人工可见
        this.logger.warn(
          `回复评论会话关闭失败：${closeIssue}（platform=${body.platform}, account=${body.accountId}）`,
        );
        // P1 复核：关闭失败步骤写入本回复自己的执行记录（不是「最新一条」其他任务），
        // 并转 reconcile_required（浏览器状态不可确认，需人工核对）
        if (replyRecordId) {
          await this.store
            .appendStep(
              replyRecordId,
              owner,
              {
                stepName: 'close-session',
                status: 'failed',
                reasonCode: 'close_failed',
                message: `浏览器会话关闭失败：${closeIssue}；需人工检查是否仍在运行`,
              },
              { internal: true },
            )
            .catch(() => undefined);
          await this.store
            .transition(replyRecordId, owner, 'reconcile_required', {
              reasonCode: 'session_close_failed',
              nextAction:
                '请人工确认浏览器会话是否已退出，并核对平台实际执行结果',
              technicalMessage: closeIssue,
            })
            .catch(() => undefined);
        }
        // P0 复核：关闭失败 → 接口不能返回 sent:true（平台侧实际结果不可确认）
        replyOutcome = {
          ...replyOutcome,
          sent: false,
          status: 'reconcile_required',
          message:
            '回复可能已发送，但浏览器会话关闭失败，请人工核对平台实际结果',
        };
      }
    }
    // try 正常完成（无异常）才走到这里；异常已在 finally 后继续传播
    return replyOutcome;
  }
}
