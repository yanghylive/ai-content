import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { safeText } from '../../common/text.utils';
import { CrmAppGuard } from './crm-app.guard';
import { CrmService } from './crm.service';

type AuthenticatedRequest = Request & { authUser?: { id?: string } };

@UseGuards(CrmAppGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get('summary')
  getSummary(@Req() request: AuthenticatedRequest) {
    return this.crmService.getSummary(this.getUserId(request));
  }

  @Get('customers')
  listCustomers(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.crmService.listCustomers(this.getUserId(request), {
      q,
      status,
    });
  }

  @Post('customers')
  createCustomer(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.createCustomer(this.getUserId(request), body);
  }

  @Get('customers/:id')
  getCustomer(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.crmService.getCustomer(this.getUserId(request), id);
  }

  @Get('customers/:id/continuity')
  getCustomerContinuity(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.getCustomerContinuity(this.getUserId(request), id);
  }

  @Patch('customers/:id')
  updateCustomer(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.updateCustomer(this.getUserId(request), id, body);
  }

  @Post('customers/:id/archive')
  archiveCustomer(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.archiveCustomer(this.getUserId(request), id);
  }

  @Post('customers/:id/merge')
  mergeCustomer(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.mergeCustomer(
      this.getUserId(request),
      id,
      safeText(body.sourceCustomerId),
    );
  }

  @Post('customers/:id/welcome-message/prepare')
  prepareWelcomeMessage(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      templateId?: string;
      message?: string;
      channel?: string;
      accountId?: string;
      accountName?: string;
    },
  ) {
    return this.crmService.prepareWelcomeMessage(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Get('customers/:id/welcome-message/preparations/:preparationId')
  getWelcomeMessagePreparation(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('preparationId') preparationId: string,
  ) {
    return this.crmService.getWelcomeMessagePreparation(
      this.getUserId(request),
      id,
      preparationId,
    );
  }

  @Post('customers/:id/conversations/link')
  linkCustomerConversation(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { interactionTaskId?: string; preparationId?: string },
  ) {
    return this.crmService.linkCustomerConversation(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Get('customers/:id/timeline')
  getCustomerTimeline(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.getTimeline(this.getUserId(request), id);
  }

  @Get('timeline/:customerId')
  getTimeline(
    @Req() request: AuthenticatedRequest,
    @Param('customerId') customerId: string,
  ) {
    return this.crmService.getTimeline(this.getUserId(request), customerId);
  }

  @Get('companies')
  listCompanies(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.crmService.listCompanies(this.getUserId(request), {
      q,
      status,
    });
  }

  @Post('companies')
  createCompany(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.createCompany(this.getUserId(request), body);
  }

  @Get('companies/:id')
  getCompany(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.crmService.getCompany(this.getUserId(request), id);
  }

  @Patch('companies/:id')
  updateCompany(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.updateCompany(this.getUserId(request), id, body);
  }

  @Post('companies/:id/archive')
  archiveCompany(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.archiveCompany(this.getUserId(request), id);
  }

  @Get('companies/:id/timeline')
  getCompanyTimeline(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.listTimeline(this.getUserId(request), {
      companyId: id,
    });
  }

  @Get('contacts')
  listContacts(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.crmService.listContacts(this.getUserId(request), { q, status });
  }

  @Get('opportunities')
  listOpportunities(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('stage') stage?: string,
    @Query('status') status?: string,
  ) {
    return this.crmService.listOpportunities(this.getUserId(request), {
      q,
      stage,
      status,
    });
  }

  @Post('opportunities')
  createOpportunity(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.createOpportunity(this.getUserId(request), body);
  }

  @Get('opportunities/:id')
  getOpportunity(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.getOpportunity(this.getUserId(request), id);
  }

  @Patch('opportunities/:id')
  updateOpportunity(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.updateOpportunity(this.getUserId(request), id, body);
  }

  @Post('opportunities/:id/archive')
  archiveOpportunity(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.archiveOpportunity(this.getUserId(request), id);
  }

  @Get('opportunities/:id/timeline')
  getOpportunityTimeline(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.listTimeline(this.getUserId(request), {
      opportunityId: id,
    });
  }

  @Get('tasks')
  listTasks(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.crmService.listTasks(this.getUserId(request), {
      q,
      status,
      customerId,
    });
  }

  @Post('tasks')
  createTask(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.createTask(this.getUserId(request), body);
  }

  @Get('tasks/:id')
  getTask(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.crmService.getTask(this.getUserId(request), id);
  }

  @Patch('tasks/:id')
  updateTask(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.updateTask(this.getUserId(request), id, body);
  }

  @Post('tasks/:id/complete')
  completeTask(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.crmService.completeTask(this.getUserId(request), id);
  }

  @Post('tasks/:id/archive')
  archiveTask(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.crmService.archiveTask(this.getUserId(request), id);
  }

  @Get('notes')
  listNotes(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.crmService.listNotes(this.getUserId(request), {
      q,
      customerId,
    });
  }

  @Post('notes')
  createNote(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.createNote(this.getUserId(request), body);
  }

  @Get('notes/:id')
  getNote(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.crmService.getNote(this.getUserId(request), id);
  }

  @Patch('notes/:id')
  updateNote(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.updateNote(this.getUserId(request), id, body);
  }

  @Post('notes/:id/archive')
  archiveNote(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.crmService.archiveNote(this.getUserId(request), id);
  }

  @Get('welcome-templates')
  listWelcomeMessageTemplates(@Req() request: AuthenticatedRequest) {
    return this.crmService.listWelcomeMessageTemplates(this.getUserId(request));
  }

  @Post('welcome-templates')
  createWelcomeMessageTemplate(
    @Req() request: AuthenticatedRequest,
    @Body() body: { name?: string; body?: string; channel?: string },
  ) {
    return this.crmService.createWelcomeMessageTemplate(
      this.getUserId(request),
      body || {},
    );
  }

  @Patch('welcome-templates/:id')
  updateWelcomeMessageTemplate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; body?: string; channel?: string },
  ) {
    return this.crmService.updateWelcomeMessageTemplate(
      this.getUserId(request),
      id,
      body || {},
    );
  }

  @Post('welcome-templates/:id/archive')
  archiveWelcomeMessageTemplate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.crmService.archiveWelcomeMessageTemplate(
      this.getUserId(request),
      id,
    );
  }

  @Get('timeline')
  listTimeline(
    @Req() request: AuthenticatedRequest,
    @Query('customerId') customerId?: string,
    @Query('companyId') companyId?: string,
    @Query('opportunityId') opportunityId?: string,
    @Query('taskId') taskId?: string,
    @Query('noteId') noteId?: string,
  ) {
    return this.crmService.listTimeline(this.getUserId(request), {
      customerId,
      companyId,
      opportunityId,
      taskId,
      noteId,
    });
  }

  @Get('import/batches')
  listImportBatches(@Req() request: AuthenticatedRequest) {
    return this.crmService.listImportBatches(this.getUserId(request));
  }

  @Get('audit/events')
  listAuditEvents(
    @Req() request: AuthenticatedRequest,
    @Query('importBatchId') importBatchId?: string,
    @Query('eventType') eventType?: string,
  ) {
    return this.crmService.listAuditEvents(this.getUserId(request), {
      importBatchId,
      eventType,
    });
  }

  @Get('closer')
  getCloser(@Req() request: AuthenticatedRequest) {
    return this.crmService.getCloserAdvice(this.getUserId(request));
  }

  @Get('closer/advice')
  getCloserAdvice(@Req() request: AuthenticatedRequest) {
    return this.crmService.getCloserAdvice(this.getUserId(request));
  }

  @Get('connectors')
  getConnectors(@Req() request: AuthenticatedRequest) {
    return this.crmService.getConnectorReadiness(this.getUserId(request));
  }

  @Post('connectors/hubspot/vault-token')
  saveHubSpotVaultToken(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      token?: string;
      label?: string;
      portalId?: string;
      expiresAt?: string;
    },
  ) {
    return this.crmService.saveHubSpotVaultToken(
      this.getUserId(request),
      body || {},
    );
  }

  @Get('connectors/hubspot/vault-status')
  getHubSpotVaultStatus(@Req() request: AuthenticatedRequest) {
    return this.crmService.getHubSpotVaultStatus(this.getUserId(request));
  }

  @Post('connectors/hubspot/read-only-run')
  runHubSpotReadOnlySandbox(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      objects?: unknown;
      maxRowsPerObject?: unknown;
    },
  ) {
    return this.crmService.runHubSpotReadOnlySandbox(
      this.getUserId(request),
      body || {},
    );
  }

  @Get('connectors/:connectorId/contract')
  getConnectorContract(
    @Req() request: AuthenticatedRequest,
    @Param('connectorId') connectorId: string,
  ) {
    return this.crmService.getConnectorContract(
      this.getUserId(request),
      connectorId,
    );
  }

  @Post('import/preview')
  previewImport(
    @Req() request: AuthenticatedRequest,
    @Body() body: { filename?: string; rows?: unknown[]; sourceType?: string },
  ) {
    return this.crmService.createImportDryRun(
      this.getUserId(request),
      body || {},
    );
  }

  @Post('import/dry-run')
  dryRunImport(
    @Req() request: AuthenticatedRequest,
    @Body() body: { filename?: string; rows?: unknown[]; sourceType?: string },
  ) {
    return this.crmService.createImportDryRun(
      this.getUserId(request),
      body || {},
    );
  }

  @Post('import/commit')
  commitImport(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      filename?: string;
      rows?: unknown[];
      sourceType?: string;
      mapping?: Record<string, string>;
      proofHash?: string;
      dryRunId?: string;
      confirmationGate?: string;
      commit?: boolean;
    },
  ) {
    return this.crmService.commitImportToLocalCrm(
      this.getUserId(request),
      body || {},
    );
  }

  @Post('import/rollback')
  rollbackImport(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      importCommitId?: string;
      rollbackToken?: string;
      customerIds?: unknown[];
      reason?: string;
    },
  ) {
    return this.crmService.rollbackLocalCrmImport(
      this.getUserId(request),
      body || {},
    );
  }

  @Get('closer/summary')
  getCloserSummary(
    @Req() request: AuthenticatedRequest,
    @Query('horizonDays') horizonDays?: string,
    @Query('includeDormant') includeDormant?: string,
  ) {
    return this.crmService.getCloserSummary(this.getUserId(request), {
      horizonDays,
      includeDormant,
    });
  }

  @Post('closer/advice')
  generateCloserAdvice(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: { limit?: number; horizonDays?: number; includeDormant?: boolean },
  ) {
    return this.crmService.generateCloserAdvice(
      this.getUserId(request),
      body || {},
    );
  }

  @Get('connectors/readiness')
  getConnectorReadiness(@Req() request: AuthenticatedRequest) {
    return this.crmService.getConnectorReadiness(this.getUserId(request));
  }

  @Post('connectors/contract')
  createConnectorContract(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      connectorKey?: string;
      includeProof?: boolean;
      requestedBy?: string;
    },
  ) {
    return this.crmService.createConnectorContract(
      this.getUserId(request),
      body || {},
    );
  }

  private getUserId(request: AuthenticatedRequest) {
    return request.authUser?.id || 'local-user';
  }
}
