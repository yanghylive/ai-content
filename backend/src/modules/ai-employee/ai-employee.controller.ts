import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Optional,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  ArchiveAgentSessionInput,
  CreateAgentSessionInput,
} from '../local-engine/local-engine.types';
import {
  assertBackendRiskGate,
  assertRiskWithPolicy,
  createRiskContextFromRequest,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
} from '../auth/risk-control';
import { RiskPolicyService } from '../auth/risk-policy.service';
import {
  AiEmployeeService,
  type AiEmployeeDryRunTaskInput,
  type AiEmployeeWorkflowPreparationInput,
  type AiEmployeeWorkflowRetryInput,
  type AutoAcquisitionConfigInput,
  type AutoAcquisitionConfig,
  type DouyinFollowUpExecuteInput,
  type DouyinFollowUpPlanInput,
  type DouyinHotVideoLeadInput,
  type DouyinLinkLeadInput,
  type DouyinRetentionLeadInput,
  type DouyinSearchLeadInput,
  type DouyinTargetedLeadInput,
  type P1ClosureReadinessInput,
  type P2WechatReadinessInput,
  type VideoTemplateClipInput,
} from './ai-employee.service';
import type { AiEmployeeWorkflowConfirmationMetadata } from './ai-employee-workflow.types';

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

@Controller('ai-employee')
export class AiEmployeeController {
  constructor(
    private readonly aiEmployeeService: AiEmployeeService,
    @Optional() private readonly riskPolicyService?: RiskPolicyService,
  ) {}

  @Get('sessions')
  listSessions(@Query('limit') limit?: string) {
    return this.aiEmployeeService.listSessions(
      limit ? Number(limit) : undefined,
    );
  }

  @Get('capabilities')
  getCapabilities() {
    return this.aiEmployeeService.getCapabilities();
  }

  @Post('sessions')
  createSession(@Body() body: CreateAgentSessionInput) {
    return this.aiEmployeeService.createSession(body);
  }

  @Post('tasks/dry-run')
  createDryRunTask(@Body() body: AiEmployeeDryRunTaskInput) {
    return this.aiEmployeeService.createDryRunTask(body);
  }

  @Post('workflows/prepare')
  prepareWorkflow(@Body() body: AiEmployeeWorkflowPreparationInput) {
    return this.aiEmployeeService.prepareWorkflow(body);
  }

  @Get('workflows')
  listWorkflows(@Query('limit') limit?: string) {
    return this.aiEmployeeService.listWorkflows(
      limit ? Number(limit) : undefined,
    );
  }

  @Get('workflows/runs/:id')
  getWorkflowRun(@Param('id') id: string) {
    return this.aiEmployeeService.getWorkflowRun(id);
  }

  @Post('workflows/:id/runs')
  async startWorkflowRun(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: { riskConfirmation?: BackendRiskConfirmationInput } = {},
  ) {
    const definition =
      await this.aiEmployeeService.refreshWorkflowDefinition(id);
    const confirmation = this.assertWorkflowRunConfirmation(
      request,
      definition,
      body.riskConfirmation,
      'manual',
    );
    return this.aiEmployeeService.startWorkflowRun(id, {
      externalActionsAuthorized:
        definition.executionPolicy.requiresConfirmation,
      confirmation,
    });
  }

  @Post('workflows/runs/:id/retry')
  async retryWorkflowRun(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: AiEmployeeWorkflowRetryInput & {
      riskConfirmation?: BackendRiskConfirmationInput;
    } = {},
  ) {
    const definition =
      await this.aiEmployeeService.getWorkflowRunDefinition(id);
    const confirmation = this.assertWorkflowRunConfirmation(
      request,
      definition,
      body.riskConfirmation,
      'retry',
    );
    return this.aiEmployeeService.retryWorkflowRun(
      id,
      { stepIds: body.stepIds },
      {
        externalActionsAuthorized:
          definition.executionPolicy.requiresConfirmation,
        confirmation,
      },
    );
  }

  @Post('workflows/runs/:id/cancel')
  cancelWorkflowRun(@Param('id') id: string) {
    return this.aiEmployeeService.cancelWorkflowRun(id);
  }

  @Get('auto-acquisition')
  listAutoAcquisition() {
    return this.aiEmployeeService.listAutoAcquisition();
  }

  @Post('auto-acquisition')
  createAutoAcquisitionConfig(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: AutoAcquisitionConfigInput & {
      riskConfirmation?: BackendRiskConfirmationInput;
    },
  ) {
    if (body?.enabled !== false) {
      this.assertLegacySchedulerConfirmation(request, body.riskConfirmation);
    }
    return this.aiEmployeeService.createAutoAcquisitionConfig(body);
  }

  @Post('auto-acquisition/:id/execute')
  async executeAutoAcquisitionConfig(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { riskConfirmation?: BackendRiskConfirmationInput } = {},
  ) {
    const config = await this.aiEmployeeService.getAutoAcquisitionConfig(id);
    await this.assertAutoAcquisitionExecutionConfirmation(
      request,
      config,
      body?.riskConfirmation,
    );
    return this.aiEmployeeService.executeAutoAcquisitionConfig(
      id,
      'manual',
      config.updatedAt,
    );
  }

  @Post('auto-acquisition/:id/execute/confirmations')
  async createAutoAcquisitionExecutionConfirmation(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.assertRealTouchEnabled();
    const config = await this.aiEmployeeService.getAutoAcquisitionConfig(id);
    const riskPolicyService = this.requireRiskPolicyService();
    const actor = this.autoAcquisitionRiskActor(request, config.tenantId);
    return riskPolicyService.issueHighRiskApproval(
      {
        action: 'batch-touch',
        riskLevel: 'high',
        target: this.autoAcquisitionExecutionTarget(config),
        reason: '用户已在短视频评论获客页确认立即执行，可能产生真实评论回复。',
      },
      actor,
    );
  }

  @Post('auto-acquisition/:id/status')
  updateAutoAcquisitionConfigStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      enabled?: boolean;
      riskConfirmation?: BackendRiskConfirmationInput;
    },
  ) {
    if (body?.enabled !== false) {
      this.assertLegacySchedulerConfirmation(request, body.riskConfirmation);
    }
    return this.aiEmployeeService.updateAutoAcquisitionConfigStatus(id, body);
  }

  @Post('auto-acquisition/:id')
  updateAutoAcquisitionConfig(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: AutoAcquisitionConfigInput & {
      riskConfirmation?: BackendRiskConfirmationInput;
    },
  ) {
    if (body?.enabled !== false) {
      this.assertLegacySchedulerConfirmation(request, body.riskConfirmation);
    }
    return this.aiEmployeeService.updateAutoAcquisitionConfig(id, body);
  }

  @Delete('auto-acquisition/:id')
  deleteAutoAcquisitionConfig(@Param('id') id: string) {
    return this.aiEmployeeService.deleteAutoAcquisitionConfig(id);
  }

  @Post('sessions/:id/stop')
  stopSession(@Param('id') id: string) {
    return this.aiEmployeeService.stopSession(id);
  }

  @Delete('sessions/:id')
  archiveSession(
    @Param('id') id: string,
    @Body() body: ArchiveAgentSessionInput = {},
  ) {
    return this.aiEmployeeService.archiveSession(id, body);
  }

  @Post('douyin/link-leads')
  findDouyinLeadsByLink(@Body() body: DouyinLinkLeadInput) {
    return this.aiEmployeeService.findDouyinLeadsByLink(body);
  }

  @Post('douyin/search-leads')
  findDouyinLeadsByKeyword(@Body() body: DouyinSearchLeadInput) {
    return this.aiEmployeeService.findDouyinLeadsByKeyword(body);
  }

  @Post('douyin/hot-video-leads')
  findDouyinHotVideoLeads(@Body() body: DouyinHotVideoLeadInput) {
    return this.aiEmployeeService.findDouyinHotVideoLeads(body);
  }

  @Post('douyin/targeted-leads')
  findDouyinTargetedLeads(@Body() body: DouyinTargetedLeadInput) {
    return this.aiEmployeeService.findDouyinTargetedLeads(body);
  }

  @Post('douyin/retention-leads')
  findDouyinRetentionLeads(@Body() body: DouyinRetentionLeadInput) {
    return this.aiEmployeeService.findDouyinRetentionLeads(body);
  }

  @Post('douyin/follow-up-plan')
  planDouyinFollowUp(@Body() body: DouyinFollowUpPlanInput) {
    return this.aiEmployeeService.planDouyinFollowUp(body);
  }

  @Post('douyin/follow-up-execute')
  executeDouyinFollowUp(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: DouyinFollowUpExecuteInput & {
      riskConfirmation?: BackendRiskConfirmationInput;
    },
  ) {
    this.assertRealTouchConfirmation(
      request,
      body?.riskConfirmation,
      `抖音线索跟进：${Array.isArray(body?.targets) ? body.targets.length : 0} 条`,
    );
    return this.aiEmployeeService.executeDouyinFollowUp(body);
  }

  @Post('p1/readiness')
  checkP1ClosureReadiness(@Body() body: P1ClosureReadinessInput) {
    return this.aiEmployeeService.checkP1ClosureReadiness(body);
  }

  @Post('p2/readiness')
  checkP2WechatReadiness(@Body() body: P2WechatReadinessInput) {
    return this.aiEmployeeService.checkP2WechatReadiness(body);
  }

  @Post('video/template-clip')
  clipVideoWithTemplate(@Body() body: VideoTemplateClipInput) {
    return this.aiEmployeeService.clipVideoWithTemplate(body);
  }

  private assertRealTouchConfirmation(
    request: AuthenticatedRequest,
    riskConfirmation: BackendRiskConfirmationInput | undefined,
    target: string,
  ) {
    if (process.env.GROWTH_EXECUTION_ENABLED !== 'true') {
      throw new BadRequestException({
        message:
          '真实触达总开关未开启：需要显式设置 GROWTH_EXECUTION_ENABLED=true 后才允许执行外部评论或私信。',
      });
    }
    assertBackendRiskGate({
      action: 'batch-touch',
      target,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
      reason: '历史获客入口执行外部评论或私信，必须人工确认。',
    });
  }

  private async assertAutoAcquisitionExecutionConfirmation(
    request: AuthenticatedRequest,
    config: AutoAcquisitionConfig,
    riskConfirmation: BackendRiskConfirmationInput | undefined,
  ) {
    this.assertRealTouchEnabled();
    const riskPolicyService = this.requireRiskPolicyService();
    const actor = this.autoAcquisitionRiskActor(request, config.tenantId);
    await assertRiskWithPolicy(
      riskPolicyService,
      {
        action: 'batch-touch',
        target: this.autoAcquisitionExecutionTarget(config),
        riskLevel: 'high',
        requiresConfirmation: true,
        confirmation: riskConfirmation,
        context: createRiskContextFromRequest(request),
        reason:
          '历史获客入口执行外部评论或私信，必须使用服务端签发的一次性确认。',
      },
      {
        plan: request.authUser?.kaypalPlan || 'FREE',
        role: request.authUser?.role || null,
        platformRole: request.authUser?.kaypalPlatformRole || null,
        tenantId: config.tenantId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        operator: actor.operator,
      },
    );
  }

  private assertRealTouchEnabled() {
    if (process.env.GROWTH_EXECUTION_ENABLED !== 'true') {
      throw new BadRequestException({
        message:
          '真实触达总开关未开启：需要显式设置 GROWTH_EXECUTION_ENABLED=true 后才允许执行外部评论或私信。',
      });
    }
  }

  private autoAcquisitionExecutionTarget(config: AutoAcquisitionConfig) {
    return `历史自动获客配置：${config.taskName} · ${config.id} · ${config.updatedAt}`;
  }

  private autoAcquisitionRiskActor(
    request: AuthenticatedRequest,
    tenantId: string,
  ) {
    const userId = request.authUser?.id;
    const sessionId = request.authSessionId;
    if (!userId || !sessionId) {
      throw new BadRequestException('高风险操作需要当前登录会话的一次性确认');
    }
    return {
      tenantId,
      userId,
      sessionId,
      operator:
        request.authUser?.name ||
        request.authUser?.username ||
        request.authUser?.email ||
        userId,
    };
  }

  private requireRiskPolicyService() {
    if (!this.riskPolicyService) {
      throw new ServiceUnavailableException(
        '高风险确认服务不可用，已阻止立即执行',
      );
    }
    return this.riskPolicyService;
  }

  private assertLegacySchedulerConfirmation(
    request: AuthenticatedRequest,
    riskConfirmation: BackendRiskConfirmationInput | undefined,
  ) {
    if (!this.isLegacyAutoAcquisitionSchedulerArmed()) return;
    assertBackendRiskGate({
      action: 'schedule-enable',
      target: '历史自动获客定时任务',
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
      reason:
        '历史自动获客 scheduler 已被武装，启用配置会进入无人值守真实触达队列。',
    });
  }

  private isLegacyAutoAcquisitionSchedulerArmed() {
    return (
      process.env.GROWTH_EXECUTION_ENABLED === 'true' &&
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER === 'true' &&
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED === 'true'
    );
  }

  private assertWorkflowRunConfirmation(
    request: AuthenticatedRequest,
    definition: {
      title: string;
      executionPolicy: {
        hasCustomerActions: boolean;
        requiresConfirmation: boolean;
      };
    },
    riskConfirmation?: BackendRiskConfirmationInput,
    source: 'manual' | 'retry' = 'manual',
  ): AiEmployeeWorkflowConfirmationMetadata {
    if (
      definition.executionPolicy.hasCustomerActions &&
      process.env.GROWTH_EXECUTION_ENABLED !== 'true'
    ) {
      throw new BadRequestException({
        message:
          '真实触达总开关未开启：候选读取仍可运行，客户评论或私信步骤会保持阻断。',
      });
    }
    const audit = assertBackendRiskGate({
      action: 'runtime-control',
      target: definition.title,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
      reason: definition.executionPolicy.requiresConfirmation
        ? '工作流包含真实客户或平台动作，启动或重试前必须确认。'
        : '启动或重试工作流前必须由当前用户明确确认。',
    });
    return this.toWorkflowConfirmationMetadata(audit, request, source);
  }

  private toWorkflowConfirmationMetadata(
    audit: BackendRiskAuditEvent,
    request: AuthenticatedRequest,
    source: 'manual' | 'retry',
  ): AiEmployeeWorkflowConfirmationMetadata {
    const record = audit.confirmationRecord;
    if (!record?.confirmed) {
      throw new BadRequestException('请先确认本次工作流操作');
    }
    return {
      auditId: audit.id,
      confirmationId: record.confirmationId || audit.id,
      action: audit.action,
      riskLevel: audit.riskLevel,
      operator: request.authUser?.id || record.operator || audit.account.name,
      operatorId: request.authUser?.id,
      reason: audit.reason,
      confirmedAt: audit.createdAt,
      appliedAt: new Date().toISOString(),
      source,
      checklist: record.checklist,
    };
  }
}
