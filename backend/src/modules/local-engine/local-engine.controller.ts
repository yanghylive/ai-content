import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { Request } from 'express';
import type { Response } from 'express';
import { createRiskContextFromRequest } from '../auth/risk-control';
import { RequirePlans } from '../auth/roles.decorator';
import { isKaypalPlanAtLeast } from '../auth/plan-order';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LocalEngineService } from './local-engine.service';
import type { AutoUploadUploadFile } from '../auto-upload/auto-upload.client';
import type {
  AgentConfirmationDecisionInput,
  AgentConfirmationStatus,
  AgentExecutionScope,
  AgentRiskLevel,
  ArchiveAgentSessionInput,
  ContinueAgentSessionInput,
  CustomerServiceReplyPlatform,
  CreateCustomerServiceReplyTaskInput,
  CreateAgentSessionInput,
  InteractionApprovalInput,
  CreateInteractionTaskInput,
  ResendGroupBroadcastPlanInput,
  RetryInteractionTaskInput,
  AgentSessionSource,
  AgentSessionStatus,
  InteractionTaskStatus,
  InteractionTaskType,
  LocalEngineRuntimeAction,
  LocalEngineRuntimeServiceKey,
  UpsertWechatContactInput,
  UpdateWechatSessionConfirmationInput,
  AlignWechatSessionInput,
  WechatContactsSyncInput,
  WechatSessionControlInput,
  SyncWechatChatHistoryInput,
  UpdateInteractionReplyRuleInput,
} from './local-engine.types';

type RiskRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
};

@Controller('local-engine')
export class LocalEngineController {
  constructor(private readonly localEngineService: LocalEngineService) {}

  private async toDisplayTask(taskPromise: Promise<{ id: string }>) {
    const task = await taskPromise;
    return this.localEngineService.getTaskForDisplay(task.id);
  }

  @Get('health')
  getHealth(@Req() request?: RiskRequest) {
    return this.localEngineService.getHealth(request?.authUser);
  }

  @Get('runtime/status')
  getRuntimeStatus() {
    return this.localEngineService.getRuntimeStatus();
  }

  @Get('runtime/logs/:key')
  getRuntimeLog(
    @Param('key') key: LocalEngineRuntimeServiceKey,
    @Query('lines') lines?: string,
  ) {
    const parsedLines = lines ? Number(lines) : undefined;

    return this.localEngineService.getRuntimeLog(
      key,
      Number.isInteger(parsedLines) ? parsedLines : undefined,
    );
  }

  @RequirePlans('PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('runtime/:action')
  runRuntimeAction(
    @Param('action') action: LocalEngineRuntimeAction,
    @Body('riskConfirmation') riskConfirmation: unknown,
    @Req() request?: RiskRequest,
  ) {
    return this.localEngineService.runRuntimeAction(action, {
      riskConfirmation: riskConfirmation as never,
      riskContext: createRiskContextFromRequest(request),
    });
  }

  @Get('readiness')
  getReadiness(@Req() request?: RiskRequest) {
    return this.localEngineService.getReadiness(request?.authUser);
  }

  @Get('browser/status')
  getBrowserStatus() {
    return this.localEngineService.getBrowserStatus();
  }

  @Get('executors/status')
  getExecutorsStatus() {
    return this.localEngineService.getExecutorsStatus();
  }

  @Get('desktop/status')
  getDesktopStatus() {
    return this.localEngineService.getDesktopStatus();
  }

  @Get('desktop/preflight')
  getDesktopCommercialPreflight() {
    return this.localEngineService.getDesktopCommercialPreflight();
  }

  @Get('wechat/session/status')
  getWechatSessionStatus() {
    return this.localEngineService.getWechatSessionStatus();
  }

  @Post('wechat/session/confirm')
  confirmWechatSession(@Body() input: UpdateWechatSessionConfirmationInput) {
    return this.localEngineService.confirmWechatSession(input);
  }

  @Post('wechat/session/align')
  alignWechatSession(@Body() input: AlignWechatSessionInput) {
    return this.localEngineService.alignWechatSession(input);
  }

  @Post('wechat/session/takeover')
  takeoverWechatSession(
    @Body() input: WechatSessionControlInput,
    @Req() request?: RiskRequest,
  ) {
    return this.localEngineService.takeoverWechatSession(
      input,
      createRiskContextFromRequest(request),
    );
  }

  @Post('wechat/session/stop')
  stopWechatSession(@Body() input: WechatSessionControlInput) {
    return this.localEngineService.stopWechatSession(input);
  }

  @Get('wechat/contacts')
  getWechatContacts() {
    return this.localEngineService.getWechatContacts();
  }

  @Get('wechat/contacts/readiness')
  getWechatContactsReadiness() {
    return this.localEngineService.getWechatContactsReadiness();
  }

  @Post('wechat/contacts')
  upsertWechatContact(@Body() input: UpsertWechatContactInput) {
    return this.localEngineService.upsertWechatContact(input);
  }

  @Get('wechat/contacts/export')
  exportWechatContacts() {
    return this.localEngineService.exportWechatContacts();
  }

  @Get('wechat/contacts/diagnostics/export')
  exportWechatContactSyncDiagnostics() {
    return this.localEngineService.exportWechatContactSyncDiagnostics();
  }

  @Delete('wechat/contacts')
  clearWechatContacts() {
    return this.localEngineService.clearWechatContacts();
  }

  @Delete('wechat/contacts/:wxid')
  removeWechatContact(@Param('wxid') wxid: string) {
    return this.localEngineService.removeWechatContact(wxid);
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('wechat/contacts/sync')
  syncWechatContacts(@Body() input?: WechatContactsSyncInput) {
    return this.localEngineService.syncWechatContacts(input);
  }

  @Get('wechat/chat-sessions')
  getWechatChatSessions() {
    return this.localEngineService.getWechatChatSessions();
  }

  @Get('wechat/chat-history')
  getWechatChatHistory(
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.localEngineService.getWechatChatHistory(
      sessionId || '',
      Number.isInteger(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('wechat/chat-history/sync')
  syncWechatChatHistory(@Body() input: SyncWechatChatHistoryInput) {
    return this.localEngineService.syncWechatChatHistory(input || {});
  }

  @Get('files/status')
  getFileAccessStatus() {
    return this.localEngineService.getFileAccessStatus();
  }

  @Post('interaction-assets')
  @UseInterceptors(FileInterceptor('file'))
  uploadInteractionAsset(
    @UploadedFile() file: AutoUploadUploadFile | undefined,
  ) {
    return this.localEngineService.saveInteractionAsset(file);
  }

  @Get('agent-sessions')
  async listAgentSessions(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('executionScope') executionScope?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('targetApp') targetApp?: string,
    @Query('hasPendingConfirmation') hasPendingConfirmation?: string,
    @Query('hasEvidence') hasEvidence?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.localEngineService.listAgentSessions(this.parseLimit(limit), {
      status: this.parseAgentSessionStatus(status),
      source: this.parseAgentSessionSource(source),
      executionScope: this.parseAgentExecutionScope(executionScope),
      riskLevel: this.parseAgentRiskLevel(riskLevel),
      targetApp,
      hasPendingConfirmation: this.parseOptionalBoolean(hasPendingConfirmation),
      hasEvidence: this.parseOptionalBoolean(hasEvidence),
      keyword,
    });
  }

  @Post('agent-sessions')
  async createAgentSession(@Body() input: CreateAgentSessionInput) {
    return this.localEngineService.createAgentSession(input);
  }

  @Get('agent-sessions/:id')
  async getAgentSession(@Param('id') id: string) {
    return this.localEngineService.getAgentSession(id);
  }

  @Get('agent-sessions/:id/confirmations')
  async listAgentSessionConfirmations(
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listAgentSessionConfirmations(
      id,
      this.parseAgentConfirmationStatus(status),
    );
  }

  @Get('agent-sessions/:id/evidence')
  async listAgentSessionEvidence(@Param('id') id: string) {
    return this.localEngineService.listAgentSessionEvidence(id);
  }

  @Get('evidence/file')
  async serveEvidenceFile(
    @Query('path') filePath: string | undefined,
    @Res() response: Response,
  ) {
    const resolved = this.localEngineService.resolveEvidenceFilePath(filePath);
    const buffer = await readFile(resolved.filePath);
    response.setHeader(
      'Content-Type',
      this.evidenceFileContentType(resolved.filePath),
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.send(buffer);
  }

  @Get('browser/evidence/:filename')
  async serveBrowserEvidenceFile(
    @Param('filename') filename: string | undefined,
    @Res() response: Response,
  ) {
    const resolved =
      this.localEngineService.resolveBrowserEvidenceFilePath(filename);
    const buffer = await readFile(resolved.filePath);
    response.setHeader(
      'Content-Type',
      this.evidenceFileContentType(resolved.filePath),
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.send(buffer);
  }

  @Get('agent-sessions/:id/evidence/export')
  async exportAgentSessionEvidence(@Param('id') id: string) {
    return this.localEngineService.exportAgentSessionEvidence(id);
  }

  @Post('agent-sessions/:id/continue')
  async continueAgentSession(
    @Param('id') id: string,
    @Body() input: ContinueAgentSessionInput,
  ) {
    return this.localEngineService.continueAgentSession(id, input);
  }

  @Post('agent-sessions/:id/stop')
  async stopAgentSession(@Param('id') id: string) {
    return this.localEngineService.stopAgentSession(id);
  }

  @Delete('agent-sessions/:id')
  async archiveAgentSession(
    @Param('id') id: string,
    @Body() input: ArchiveAgentSessionInput = {},
  ) {
    return this.localEngineService.archiveAgentSession(id, input);
  }

  @Get('confirmations')
  async listAgentConfirmations(
    @Query('status') status?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.localEngineService.listAgentConfirmations(
      this.parseAgentConfirmationStatus(status),
      sessionId,
    );
  }

  @Post('confirmations/:id/approve')
  async approveAgentConfirmation(
    @Param('id') id: string,
    @Body() input: AgentConfirmationDecisionInput,
    @Req() request?: RiskRequest,
  ) {
    return this.localEngineService.approveAgentConfirmation(
      id,
      input,
      createRiskContextFromRequest(request),
    );
  }

  @Post('confirmations/:id/reject')
  async rejectAgentConfirmation(
    @Param('id') id: string,
    @Body() input: AgentConfirmationDecisionInput,
  ) {
    return this.localEngineService.rejectAgentConfirmation(id, input);
  }

  @Delete('confirmations/clear-pending')
  async clearPendingConfirmations() {
    return this.localEngineService.clearPendingConfirmations();
  }

  @Get('reply-rules')
  getReplyRule() {
    return this.localEngineService.getReplyRule();
  }

  @Get('rules')
  getRuleAlias() {
    return this.localEngineService.getReplyRule();
  }

  @Post('reply-rules')
  updateReplyRule(@Body() input: UpdateInteractionReplyRuleInput) {
    return this.localEngineService.updateReplyRule(input);
  }

  @Get('reply-bots')
  listReplyBots() {
    return this.localEngineService.listReplyBots();
  }

  @Post('reply-bots')
  createReplyBot(@Body() input: UpdateInteractionReplyRuleInput) {
    return this.localEngineService.createReplyBot(input);
  }

  @Get('reply-bots/:id')
  getReplyBot(@Param('id') id: string) {
    return this.localEngineService.getReplyBot(id);
  }

  @Post('reply-bots/:id')
  updateReplyBot(
    @Param('id') id: string,
    @Body() input: UpdateInteractionReplyRuleInput,
  ) {
    return this.localEngineService.updateReplyBot(id, input);
  }

  @Post('reply-bots/:id/enabled')
  setReplyBotEnabled(
    @Param('id') id: string,
    @Body() input: { enabled?: boolean; expectedRevision?: number },
  ) {
    return this.localEngineService.setReplyBotEnabled(
      id,
      input.enabled === true,
      input.expectedRevision,
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('reply-bots/:id/tasks')
  async createReplyBotTask(
    @Param('id') id: string,
    @Body() input: CreateCustomerServiceReplyTaskInput,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createCustomerServiceReplyTask(id, {
        ...input,
        commercialExecutionRequested:
          input.commercialExecutionRequested !== false,
      }),
    );
  }

  @Post('rules')
  updateRuleAlias(@Body() input: UpdateInteractionReplyRuleInput) {
    return this.localEngineService.updateReplyRule(input);
  }

  @Post('reply/generate')
  generateInteractionReply(
    @Body()
    input: {
      sourceText?: string;
      targetName?: string;
      accountName?: string;
      botId?: string;
      platform?: CustomerServiceReplyPlatform;
      contactLabels?: string[];
    },
  ) {
    return this.localEngineService.generateInteractionReply(input);
  }

  @Get('tasks')
  async listTasks(
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listTasks(this.parseLimit(limit), {
      type: this.parseTaskType(type),
      status: this.parseTaskStatus(status, false),
    });
  }

  @Get('automation/tasks')
  async listAutomationTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listAutomationTasks(this.parseLimit(limit), {
      status,
    });
  }

  @Get('automation/tasks/:id')
  async getAutomationTask(@Param('id') id: string) {
    return this.localEngineService.getAutomationTask(id);
  }

  @Get('records')
  async listRecords(
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listRecords(this.parseLimit(limit), {
      type: this.parseTaskType(type),
      status: this.parseTaskStatus(status, true),
    });
  }

  @Get('records/export')
  async exportRecords(
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.exportRecords(
      this.parseLimit(limit) || 200,
      {
        type: this.parseTaskType(type),
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('evidence/cleanup-preview')
  async previewEvidenceCleanup(@Query('retentionDays') retentionDays?: string) {
    return this.localEngineService.previewEvidenceCleanup(
      this.parseRetentionDays(retentionDays),
    );
  }

  @Post('evidence/cleanup')
  async cleanupEvidence(
    @Body('retentionDays') retentionDays?: number,
    @Body('riskConfirmation') riskConfirmation?: unknown,
    @Req() request?: RiskRequest,
  ) {
    return this.localEngineService.cleanupEvidence(
      this.parseRetentionDays(retentionDays),
      {
        riskConfirmation: riskConfirmation as never,
        riskContext: createRiskContextFromRequest(request),
      },
    );
  }

  @Get('tasks/:id')
  async getTask(@Param('id') id: string) {
    return this.localEngineService.getTaskForDisplay(id);
  }

  @Get('tasks/:id/diagnostics/export')
  async exportTaskDiagnostics(@Param('id') id: string) {
    return this.localEngineService.exportTaskDiagnostics(id);
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('tasks')
  async createTask(@Body() input: CreateInteractionTaskInput) {
    return this.toDisplayTask(this.localEngineService.createTask(input));
  }

  @Get('comments/tasks')
  async listCommentTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'comments',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('comments/tasks')
  async createCommentTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'comments',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('comments/records')
  async listCommentRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'comments',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('messages/tasks')
  async listMessageTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'messages',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('messages/tasks')
  async createMessageTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'messages',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('messages/records')
  async listMessageRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'messages',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('channel-comments/tasks')
  async listChannelCommentTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'channel-comments',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('channel-comments/tasks')
  async createChannelCommentTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'channel-comments',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('channel-comments/records')
  async listChannelCommentRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'channel-comments',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('channel-messages/tasks')
  async listChannelMessageTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'channel-messages',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('channel-messages/tasks')
  async createChannelMessageTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'channel-messages',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('channel-messages/records')
  async listChannelMessageRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'channel-messages',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('wechat/tasks')
  async listWechatTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'wechat',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('wechat/tasks')
  async createWechatTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'wechat',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('wechat/records')
  async listWechatRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'wechat',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('groups/tasks')
  async listGroupTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'groups',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('groups/tasks')
  async createGroupTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'groups',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('groups/records')
  async listGroupRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'groups',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('groups/plans')
  async listGroupBroadcastPlans(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'groups',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  /**
   * 群发计划默认配置与能力边界（对标炼刀 /message_send_plan/config）
   * GET /api/local-engine/groups/plans/config
   */
  @Get('groups/plans/config')
  getGroupBroadcastPlanConfig() {
    return {
      planKinds: ['wechat-group-broadcast'],
      defaultDailyLimit: 200,
      dailyLimitRange: [1, 1000],
      intervalSecondsRange: [0, 3600],
      defaultIntervalSeconds: 0,
      maxTargetsPerPlan: 500,
      statuses: ['queued', 'waiting', 'running', 'paused', 'completed', 'failed', 'cancelled'],
      supportedFields: [
        'targetName',
        'replyText',
        'dailyLimit',
        'intervalSeconds',
        'scheduleStartTime',
        'associatedWeChat',
        'batchTargets',
      ],
    };
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('groups/plans')
  async createGroupBroadcastPlan(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'groups',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('groups/plans/:id/detail-list')
  async getGroupBroadcastPlanDetailList(@Param('id') id: string) {
    return this.localEngineService.getGroupBroadcastPlanDetails(id);
  }

  @Post('groups/plans/:id/pause')
  async pauseGroupBroadcastPlan(@Param('id') id: string) {
    return this.toDisplayTask(this.localEngineService.pauseTask(id));
  }

  @Post('groups/plans/:id/resume')
  async resumeGroupBroadcastPlan(
    @Param('id') id: string,
    @Body() input: InteractionApprovalInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.resumeTask(
        id,
        input || {},
        createRiskContextFromRequest(request),
      ),
    );
  }

  @Post('groups/plans/:id/resume-confirmation')
  createGroupBroadcastResumeConfirmation(@Param('id') id: string) {
    return this.localEngineService.createTaskResumeConfirmation(id);
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('groups/plans/:id/resend')
  async resendGroupBroadcastPlan(
    @Param('id') id: string,
    @Body() input: ResendGroupBroadcastPlanInput,
  ) {
    return this.toDisplayTask(
      this.localEngineService.resendGroupBroadcastPlan(id, input || {}),
    );
  }

  @Delete('groups/plans/:id')
  async removeGroupBroadcastPlan(@Param('id') id: string) {
    return this.toDisplayTask(
      this.localEngineService.removeGroupBroadcastPlan(id),
    );
  }

  @Post('groups/plans/:id/remove')
  async removeGroupBroadcastPlanByAction(@Param('id') id: string) {
    return this.toDisplayTask(
      this.localEngineService.removeGroupBroadcastPlan(id),
    );
  }

  @Get('moments/tasks')
  async listMomentsTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'moments',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('moments/tasks')
  async createMomentsTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'moments',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('moments/records')
  async listMomentsRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'moments',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Get('customers/tasks')
  async listCustomerTasks(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessTasks(
      'customers',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, false),
      },
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('customers/tasks')
  async createCustomerTask(
    @Body() input: CreateInteractionTaskInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.createBusinessTask(
        'customers',
        this.withCallerCommercial(input, request),
      ),
    );
  }

  @Get('customers/records')
  async listCustomerRecords(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.localEngineService.listBusinessRecords(
      'customers',
      this.parseLimit(limit),
      {
        status: this.parseTaskStatus(status, true),
      },
    );
  }

  @Post('tasks/:id/approve')
  async approveTask(
    @Param('id') id: string,
    @Body() input: InteractionApprovalInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.approveTask(
        id,
        input,
        createRiskContextFromRequest(request),
      ),
    );
  }

  @Post('tasks/:id/skip')
  async skipTask(@Param('id') id: string) {
    return this.toDisplayTask(this.localEngineService.skipTask(id));
  }

  @Post('tasks/:id/pause')
  async pauseTask(@Param('id') id: string) {
    return this.toDisplayTask(this.localEngineService.pauseTask(id));
  }

  @Post('tasks/:id/resume')
  async resumeTask(
    @Param('id') id: string,
    @Body() input: InteractionApprovalInput,
    @Req() request?: RiskRequest,
  ) {
    return this.toDisplayTask(
      this.localEngineService.resumeTask(
        id,
        input || {},
        createRiskContextFromRequest(request),
      ),
    );
  }

  @Post('tasks/:id/resume-confirmation')
  createTaskResumeConfirmation(@Param('id') id: string) {
    return this.localEngineService.createTaskResumeConfirmation(id);
  }

  @Post('tasks/:id/continue')
  async continueTask(@Param('id') id: string) {
    return this.toDisplayTask(this.localEngineService.continueTask(id));
  }

  @Post('tasks/:id/fail')
  async failTask(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.toDisplayTask(this.localEngineService.failTask(id, reason));
  }

  @Post('tasks/:id/retry')
  async retryTask(
    @Param('id') id: string,
    @Body() input: RetryInteractionTaskInput,
  ) {
    return this.toDisplayTask(
      this.localEngineService.retryTask(id, input || {}),
    );
  }

  private parseLimit(limit?: string) {
    const parsedLimit = limit ? Number(limit) : undefined;

    return Number.isInteger(parsedLimit) ? parsedLimit : undefined;
  }

  private parseRetentionDays(value?: string | number) {
    const parsedValue = Number(value ?? 7);
    if (!Number.isFinite(parsedValue)) {
      return 7;
    }
    return Math.max(0, Math.floor(parsedValue));
  }

  private parseOptionalBoolean(value?: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }

  private parseTaskType(type?: string): InteractionTaskType | undefined {
    if (
      type === 'douyin-comment-reply' ||
      type === 'douyin-direct-message-reply' ||
      type === 'wechat-channel-comment-reply' ||
      type === 'wechat-channel-direct-message-reply' ||
      type === 'wechat-reply-draft' ||
      type === 'wechat-friend-accept' ||
      type === 'wechat-group-broadcast' ||
      type === 'wechat-contact-add' ||
      type === 'wechat-moments-publish' ||
      type === 'wechat-moments-marketing' ||
      type === 'customer-follow-up'
    ) {
      return type;
    }
    return undefined;
  }

  private withCallerCommercial(
    input: CreateInteractionTaskInput,
    request?: RiskRequest,
  ): CreateInteractionTaskInput & {
    callerCommercialAllowed?: boolean;
    callerRole?: string;
  } {
    const user = request?.authUser;
    const kaypalPlanAllowsExecution =
      Boolean(user?.kaypalPlan) &&
      user?.kaypalPlanExpired !== true &&
      isKaypalPlanAtLeast(user?.kaypalPlan, 'STANDARD');
    return {
      ...input,
      callerRole: user?.role ?? 'operator',
      callerCommercialAllowed:
        user?.commercialExecutionAllowed === true || kaypalPlanAllowsExecution,
    };
  }

  private parseTaskStatus(
    status?: string,
    recordsOnly = false,
  ): InteractionTaskStatus | undefined {
    const allowed: InteractionTaskStatus[] = recordsOnly
      ? ['completed', 'failed', 'blocked', 'skipped', 'no_target']
      : [
          'queued',
          'running',
          'paused',
          'blocked',
          'waiting_for_send_confirmation',
          'completed',
          'failed',
          'skipped',
          'no_target',
        ];
    return allowed.includes(status as InteractionTaskStatus)
      ? (status as InteractionTaskStatus)
      : undefined;
  }

  private parseAgentConfirmationStatus(
    status?: string,
  ): AgentConfirmationStatus | undefined {
    const allowed: AgentConfirmationStatus[] = [
      'pending',
      'approved',
      'rejected',
      'expired',
    ];
    return allowed.includes(status as AgentConfirmationStatus)
      ? (status as AgentConfirmationStatus)
      : undefined;
  }

  private parseAgentSessionStatus(
    status?: string,
  ): AgentSessionStatus | undefined {
    const allowed: AgentSessionStatus[] = [
      'draft',
      'running',
      'waiting_for_confirmation',
      'completed',
      'failed',
      'cancelled',
    ];
    return allowed.includes(status as AgentSessionStatus)
      ? (status as AgentSessionStatus)
      : undefined;
  }

  private parseAgentSessionSource(
    source?: string,
  ): AgentSessionSource | undefined {
    const allowed: AgentSessionSource[] = [
      'web',
      'agent-console',
      'publishing',
      'interaction',
      'system',
    ];
    return allowed.includes(source as AgentSessionSource)
      ? (source as AgentSessionSource)
      : undefined;
  }

  private parseAgentExecutionScope(
    scope?: string,
  ): AgentExecutionScope | undefined {
    const allowed: AgentExecutionScope[] = [
      'browser',
      'desktop',
      'local-files',
      'remote',
      'mixed',
    ];
    return allowed.includes(scope as AgentExecutionScope)
      ? (scope as AgentExecutionScope)
      : undefined;
  }

  private parseAgentRiskLevel(riskLevel?: string): AgentRiskLevel | undefined {
    const allowed: AgentRiskLevel[] = ['low', 'medium', 'high'];
    return allowed.includes(riskLevel as AgentRiskLevel)
      ? (riskLevel as AgentRiskLevel)
      : undefined;
  }

  private evidenceFileContentType(filePath: string) {
    const extension = extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.json': 'application/json; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.log': 'text/plain; charset=utf-8',
    };
    return contentTypes[extension] || 'application/octet-stream';
  }
}
