import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  assertBackendRiskGate,
  assertRiskWithPolicy,
  createRiskContextFromRequest,
  type BackendRiskConfirmationInput,
} from '../auth/risk-control';
import { RiskPolicyService } from '../auth/risk-policy.service';
import { GrowthService } from './growth.service';
import type { GrowthAcquisitionConfig, GrowthPlatform } from './growth.types';

type AuthenticatedRequest = Request & {
  authSessionId?: string;
  authUser?: {
    id?: string;
    name?: string;
    username?: string;
    email?: string;
    role?: string;
    kaypalPlan?: string;
    kaypalPlatformRole?: string | null;
  };
};

@Controller('growth')
export class GrowthController {
  constructor(
    private readonly growthService: GrowthService,
    @Optional() private readonly riskPolicyService?: RiskPolicyService,
  ) {}

  /**
   * 曝光账号管理（对标炼刀 /auto/exposure/accounts）
   * GET/POST /api/growth/exposure-accounts
   */
  /**
   * 曝光扩展（对标炼刀 /auto/exposure/comment_expand + filed-copy-expansions + psg/record/list）
   */
  @Post('exposure/comment-expand')
  commentExpand(@Body() body: { url: string; limit?: number }) {
    return this.growthService.commentExpand(body);
  }

  @Post('exposure/copy-expansions')
  expandCopy(@Body() body: { text: string; count?: number }) {
    return this.growthService.expandCopy(body);
  }

  @Get('exposure/records')
  listExposureRecords(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    const userId = request.authUser?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录');
    return this.growthService.listExposureRecords(
      userId,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('exposure-accounts')
  listExposureAccounts(@Req() request: AuthenticatedRequest) {
    const userId = request.authUser?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录');
    return this.growthService.listExposureAccounts(userId);
  }

  @Post('exposure-accounts')
  createExposureAccount(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: { platform?: string; accountId: string; name: string; note?: string },
  ) {
    const userId = request.authUser?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录');
    return this.growthService.createExposureAccount(userId, body);
  }

  @Patch('exposure-accounts/:id/status')
  setExposureAccountStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const userId = request.authUser?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录');
    return this.growthService.setExposureAccountStatus(userId, id, body.status);
  }

  @Delete('exposure-accounts/:id')
  removeExposureAccount(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const userId = request.authUser?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录');
    return this.growthService.removeExposureAccount(userId, id);
  }

  @Get('overview')
  getOverview(@Req() request: AuthenticatedRequest) {
    return this.growthService.getOverview(this.getUserId(request));
  }

  /** 3010「今日增长」首页聚合接口（开发文档 7.2 / P0-P1 计划 §2.1） */
  @Get('home')
  getGrowthHome(
    @Req() request: AuthenticatedRequest,
    @Query('range') range?: string,
  ) {
    return this.growthService.getGrowthHome(this.getUserId(request), {
      range: range === '30d' ? '30d' : 'today',
    });
  }

  @Get('runtime-status')
  getRuntimeStatus(@Req() request: AuthenticatedRequest) {
    return this.growthService.getRuntimeStatus(this.getUserId(request));
  }

  @Get('commercial-readiness')
  getCommercialReadiness(@Req() request: AuthenticatedRequest) {
    return this.growthService.getCommercialReadiness(this.getUserId(request));
  }

  @Get('commercial-readiness/audits')
  listCommercialAudits(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.growthService.listCommercialAuditRecords(
      this.getUserId(request),
      query || {},
    );
  }

  @Post('commercial-readiness/remediate')
  async remediateCommercialReadiness(
    @Req() request: AuthenticatedRequest,
    @Body() body: { riskConfirmation?: BackendRiskConfirmationInput } = {},
  ) {
    await this.assertGrowthAutoExecutionConfirmation(
      request,
      {
        id: 'commercial-readiness-remediate',
        taskName: '商用闭环自动修复',
        accountName: '真实账号任务',
      },
      body?.riskConfirmation,
    );
    return this.growthService.remediateCommercialReadiness(
      this.getUserId(request),
    );
  }

  @Post('intelligence/redfox/benchmark-accounts/preview')
  previewRedfoxBenchmarkAccountIntake(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.previewBenchmarkAccountIntake(
      this.getUserId(request),
      body || {},
    );
  }

  @Post('intelligence/redfox/leads/confirm')
  confirmRedfoxIntelligenceLeads(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.confirmIntelligenceLeads(
      this.getUserId(request),
      body || {},
    );
  }

  @Get('strategies')
  listStrategies(@Req() request: AuthenticatedRequest) {
    return this.growthService.listStrategies(this.getUserId(request));
  }

  @Post('strategies')
  createStrategy(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.createStrategy(
      this.getUserId(request),
      body || {},
    );
  }

  @Post('strategies/generate')
  generateStrategy(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.generateStrategy(
      this.getUserId(request),
      body || {},
    );
  }

  @Post('strategies/:id/apply')
  applyStrategy(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.applyStrategy(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Patch('strategies/:id')
  updateStrategy(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.updateStrategy(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Delete('strategies/:id')
  deleteStrategy(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.growthService.deleteStrategy(this.getUserId(request), id);
  }

  /** 命中意向词统计（数据反馈闭环；D4：按当前登录用户的租户 scope 隔离返回） */
  @Get('keyword-stats')
  keywordStats(@Req() request: AuthenticatedRequest) {
    return this.growthService.keywordStats(this.getUserId(request));
  }

  @Get('acquisition/configs')
  listConfigs(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.growthService.listConfigs(this.getUserId(request), query || {});
  }

  @Get('acquisition/configs/:id')
  getConfig(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.growthService.getConfig(this.getUserId(request), id);
  }

  @Get('acquisition/configs/:id/preflight')
  preflightConfig(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.growthService.preflightConfig(this.getUserId(request), id);
  }

  @Post('acquisition/configs')
  async createConfig(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    await this.assertAutoExecutionCreateRisk(request, body || {});
    return this.growthService.createConfig(this.getUserId(request), body || {});
  }

  @Patch('acquisition/configs/:id')
  async updateConfig(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const existing = await this.growthService.getConfig(
      this.getUserId(request),
      id,
    );
    await this.assertAutoExecutionUpdateRisk(request, existing, body || {});
    return this.growthService.updateConfig(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Delete('acquisition/configs/:id')
  deleteConfig(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.growthService.deleteConfig(this.getUserId(request), id);
  }

  @Post('acquisition/configs/:id/status')
  async setConfigStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      enabled?: boolean;
      riskConfirmation?: BackendRiskConfirmationInput;
    },
  ) {
    const existing = await this.growthService.getConfig(
      this.getUserId(request),
      id,
    );
    if (body?.enabled !== false && this.isAutoExecutionEnabled(existing)) {
      await this.assertGrowthAutoExecutionConfirmation(
        request,
        existing,
        body?.riskConfirmation,
      );
    }
    return this.growthService.setConfigStatus(
      this.getUserId(request),
      id,
      body?.enabled !== false,
    );
  }

  @Post('acquisition/configs/:id/execute')
  @HttpCode(201)
  async executeConfig(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { riskConfirmation?: BackendRiskConfirmationInput } = {},
  ) {
    const config = await this.growthService.getConfig(
      this.getUserId(request),
      id,
    );
    await this.assertGrowthExecutionConfirmation(
      request,
      config,
      body?.riskConfirmation,
    );
    return this.growthService.executeConfig(this.getUserId(request), id, {
      confirmedExecution: true,
    });
  }

  @Get('acquisition/schedule-plan')
  getSchedulePlan(@Req() request: AuthenticatedRequest) {
    return this.growthService.getSchedulePlan(this.getUserId(request));
  }

  @Post('acquisition/schedule/run')
  async runScheduledConfigs(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    await this.assertGrowthExecutionConfirmation(
      request,
      { taskName: '到期增长获客任务批量执行', id: 'schedule-run' },
      body?.riskConfirmation as BackendRiskConfirmationInput | undefined,
    );
    return this.growthService.runScheduledConfigs(this.getUserId(request), {
      ...(body || {}),
      trigger: 'manual',
    });
  }

  @Get('acquisition/runs')
  listRuns(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.growthService.listRuns(this.getUserId(request), query || {});
  }

  @Get('acquisition/runs/live/:configId')
  getRunLive(
    @Req() request: AuthenticatedRequest,
    @Param('configId') configId: string,
    @Query('after') after?: string,
  ) {
    return this.growthService.getRunLive(
      this.getUserId(request),
      configId,
      Number(after) || 0,
    );
  }

  @Get('acquisition/runs/:id')
  getRun(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.growthService.getRun(this.getUserId(request), id);
  }

  @Post('acquisition/runs/:id/cancel')
  @HttpCode(202)
  cancelRun(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.growthService.cancelRun(this.getUserId(request), id);
  }

  @Get('leads')
  listLeads(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.growthService.listLeads(this.getUserId(request), query || {});
  }

  @Post('leads')
  createLead(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.createLead(this.getUserId(request), body || {});
  }

  @Patch('leads/:id')
  updateLead(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.updateLead(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Post('leads/:id/sync-crm')
  syncLeadToCrm(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.growthService.syncLeadToCrm(this.getUserId(request), id);
  }

  @Get('leads/:id/score-history')
  getLeadScoreHistory(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.growthService.getLeadScoreHistory(this.getUserId(request), id);
  }

  @Post('leads/:id/rescore')
  rescoreLead(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.growthService.rescoreLead(this.getUserId(request), id);
  }

  @Get('leads/:id/attribution')
  getLeadAttribution(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.growthService.getLeadAttribution(this.getUserId(request), id);
  }

  @Get('leads/:id/touch-history')
  getLeadTouchHistory(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.growthService.getLeadTouchHistory(this.getUserId(request), id);
  }

  @Delete('leads/:id')
  deleteLead(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.growthService.deleteLead(this.getUserId(request), id);
  }

  @Post('leads/dedupe-preview')
  dedupePreview(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.dedupePreview(
      this.getUserId(request),
      body || {},
    );
  }

  @Post('leads/merge')
  mergeLeads(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.mergeLeads(this.getUserId(request), body || {});
  }

  @Get('account-health')
  listAccountHealth(@Req() request: AuthenticatedRequest) {
    return this.growthService.listAccountHealth(this.getUserId(request));
  }

  @Post('account-health/:platform/:accountId/check')
  checkAccountHealth(
    @Req() request: AuthenticatedRequest,
    @Param('platform') platform: GrowthPlatform,
    @Param('accountId') accountId: string,
  ) {
    return this.growthService.checkAccountHealth(
      this.getUserId(request),
      platform,
      accountId,
    );
  }

  @Post('account-health/:platform/:accountId/cooldown')
  cooldownAccount(
    @Req() request: AuthenticatedRequest,
    @Param('platform') platform: GrowthPlatform,
    @Param('accountId') accountId: string,
    @Body() body: { minutes?: number },
  ) {
    return this.growthService.cooldownAccount(
      this.getUserId(request),
      platform,
      accountId,
      body?.minutes,
    );
  }

  @Post('account-health/:platform/:accountId/release-cooldown')
  releaseAccountCooldown(
    @Req() request: AuthenticatedRequest,
    @Param('platform') platform: GrowthPlatform,
    @Param('accountId') accountId: string,
  ) {
    return this.growthService.releaseAccountCooldown(
      this.getUserId(request),
      platform,
      accountId,
    );
  }

  @Get('reports')
  getReports(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.growthService.getReports(this.getUserId(request), query || {});
  }

  @Get('workflows')
  listWorkflows(@Req() request: AuthenticatedRequest) {
    return this.growthService.listWorkflows(this.getUserId(request));
  }

  /** 行业方案库：14 行业 × 场景 Playbook 清单 */
  @Get('workflow-playbooks')
  listWorkflowPlaybooks() {
    return this.growthService.listWorkflowPlaybooks();
  }

  @Post('workflows')
  createWorkflow(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.createWorkflow(
      this.getUserId(request),
      body || {},
    );
  }

  @Patch('workflows/:id')
  updateWorkflow(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.updateWorkflow(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Delete('workflows/:id')
  deleteWorkflow(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.growthService.deleteWorkflow(this.getUserId(request), id);
  }

  @Post('workflows/:id/:action')
  setWorkflowAction(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.growthService.applyWorkflowAction(
      this.getUserId(request),
      id,
      action,
      body || {},
    );
  }

  private getUserId(request: AuthenticatedRequest) {
    return request.authUser?.id || 'local-user';
  }

  private async assertAutoExecutionCreateRisk(
    request: AuthenticatedRequest,
    body: Record<string, unknown>,
  ) {
    if (
      body.scheduleEnabled === true &&
      body.riskMode === 'auto' &&
      body.status !== 'disabled'
    ) {
      await this.assertGrowthAutoExecutionConfirmation(
        request,
        body,
        body.riskConfirmation as BackendRiskConfirmationInput | undefined,
      );
    }
  }

  private async assertAutoExecutionUpdateRisk(
    request: AuthenticatedRequest,
    existing: GrowthAcquisitionConfig,
    body: Record<string, unknown>,
  ) {
    const next = {
      scheduleEnabled:
        body.scheduleEnabled === undefined
          ? existing.scheduleEnabled
          : body.scheduleEnabled === true,
      riskMode:
        body.riskMode === undefined
          ? existing.riskMode
          : (this.text(body.riskMode) as GrowthAcquisitionConfig['riskMode']),
      status:
        body.status === undefined
          ? existing.status
          : body.status === 'disabled'
            ? 'disabled'
            : 'enabled',
    };
    const changedExecutionGate =
      body.scheduleEnabled !== undefined ||
      body.riskMode !== undefined ||
      body.status !== undefined;
    if (
      changedExecutionGate &&
      !this.isAutoExecutionEnabled(existing) &&
      this.isAutoExecutionEnabled(next)
    ) {
      await this.assertGrowthAutoExecutionConfirmation(
        request,
        existing,
        body.riskConfirmation as BackendRiskConfirmationInput | undefined,
      );
    }
  }

  private isAutoExecutionEnabled(
    config: Pick<
      GrowthAcquisitionConfig,
      'scheduleEnabled' | 'riskMode' | 'status'
    >,
  ) {
    return (
      config.scheduleEnabled === true &&
      config.riskMode === 'auto' &&
      config.status !== 'disabled'
    );
  }

  private async assertGrowthAutoExecutionConfirmation(
    request: AuthenticatedRequest,
    target:
      | Pick<GrowthAcquisitionConfig, 'id' | 'taskName' | 'accountName'>
      | Record<string, unknown>,
    riskConfirmation?: BackendRiskConfirmationInput,
  ) {
    const id =
      this.text('id' in target ? target.id : undefined) || 'new-config';
    const taskName =
      this.text('taskName' in target ? target.taskName : undefined) ||
      '增长获客任务';
    const accountName = this.text(
      'accountName' in target ? target.accountName : undefined,
    );
    await this.assertGrowthRisk(request, {
      action: 'schedule-enable',
      target: accountName
        ? `${taskName} · ${accountName} · ${id}`
        : `${taskName} · ${id}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
      reason:
        '启用增长获客自动真实执行后，后台 daemon 会在任务到期时触达外部平台用户。',
    });
  }

  private async assertGrowthExecutionConfirmation(
    request: AuthenticatedRequest,
    target:
      | Pick<
          GrowthAcquisitionConfig,
          'id' | 'taskName' | 'accountName' | 'riskMode'
        >
      | Record<string, unknown>,
    riskConfirmation?: BackendRiskConfirmationInput,
  ) {
    if (process.env.GROWTH_EXECUTION_ENABLED !== 'true') return;
    const riskMode = this.text(
      'riskMode' in target ? target.riskMode : undefined,
    );
    if (riskMode === 'draft-only') return;
    const id =
      this.text('id' in target ? target.id : undefined) || 'growth-execution';
    const taskName =
      this.text('taskName' in target ? target.taskName : undefined) ||
      '增长获客执行';
    const accountName = this.text(
      'accountName' in target ? target.accountName : undefined,
    );
    await this.assertGrowthRisk(request, {
      action: 'batch-touch',
      target: accountName
        ? `${taskName} · ${accountName} · ${id}`
        : `${taskName} · ${id}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
      reason:
        '执行增长获客任务会触发外部平台采集、评论或私信动作，必须在后端确认真实触达风险。',
    });
  }

  private async assertGrowthRisk(
    request: AuthenticatedRequest,
    input: Parameters<typeof assertBackendRiskGate>[0],
  ) {
    if (!this.riskPolicyService) {
      return assertBackendRiskGate(input);
    }
    const context = input.context || createRiskContextFromRequest(request);
    return assertRiskWithPolicy(
      this.riskPolicyService,
      { ...input, context },
      {
        plan: request.authUser?.kaypalPlan || 'FREE',
        role: request.authUser?.role || null,
        platformRole: request.authUser?.kaypalPlatformRole || null,
        userId: request.authUser?.id,
        sessionId: request.authSessionId,
        operator:
          request.authUser?.name ||
          request.authUser?.username ||
          request.authUser?.email ||
          request.authUser?.id,
      },
    );
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }
}
