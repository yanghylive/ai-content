import {
  Controller,
  Body,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SolutionsService } from './solutions.service';
import type {
  ApproveSolutionManualTaskRequest,
  ConfirmSolutionOutputDraftsRequest,
  CreateSolutionRunRequest,
  ExecuteSolutionResultActionRequest,
  RunSolutionTaskRedfoxRequest,
} from './solutions.types';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@Controller('solutions')
export class SolutionsController {
  constructor(private readonly solutionsService: SolutionsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('category') category?: string,
  ) {
    this.getUser(request);
    return this.solutionsService.list(
      this.solutionsService.normalizeCategory(category),
    );
  }

  @Get('summary')
  getSummary(@Req() request: AuthenticatedRequest) {
    this.getUser(request);
    return this.solutionsService.getSummary();
  }

  @Get('redfox-mapping-coverage')
  getRedfoxMappingCoverage(@Req() request: AuthenticatedRequest) {
    this.getUser(request);
    return this.solutionsService.getRedfoxMappingCoverage();
  }

  @Get('runs')
  listRuns(
    @Req() request: AuthenticatedRequest,
    @Query('packageCode') packageCode?: string,
  ) {
    return this.solutionsService.listRuns(this.getUser(request), packageCode);
  }

  @Get('runs/:id')
  getRun(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.solutionsService.getRun(this.getUser(request), id);
  }

  @Post('runs/:runId/result-actions')
  executeResultAction(
    @Req() request: AuthenticatedRequest,
    @Param('runId') runId: string,
    @Body() body: ExecuteSolutionResultActionRequest,
  ) {
    return this.solutionsService.executeResultAction(
      this.getUser(request),
      runId,
      body,
    );
  }

  @Post('runs/:runId/tasks/:taskId/redfox-dry-run')
  dryRunRedfoxTask(
    @Req() request: AuthenticatedRequest,
    @Param('runId') runId: string,
    @Param('taskId') taskId: string,
    @Body() body: RunSolutionTaskRedfoxRequest = {},
  ) {
    return this.solutionsService.dryRunRedfoxTask(
      this.getUser(request),
      runId,
      taskId,
      body,
    );
  }

  @Post('runs/:runId/tasks/:taskId/redfox-execute')
  executeRedfoxTask(
    @Req() request: AuthenticatedRequest,
    @Param('runId') runId: string,
    @Param('taskId') taskId: string,
    @Body() body: RunSolutionTaskRedfoxRequest = {},
  ) {
    return this.solutionsService.executeRedfoxTask(
      this.getUser(request),
      runId,
      taskId,
      body,
    );
  }

  @Post('runs/:runId/tasks/:taskId/manual-approve')
  approveManualTask(
    @Req() request: AuthenticatedRequest,
    @Param('runId') runId: string,
    @Param('taskId') taskId: string,
    @Body() body: ApproveSolutionManualTaskRequest = {},
  ) {
    return this.solutionsService.approveManualTask(
      this.getUser(request),
      runId,
      taskId,
      body,
    );
  }

  @Post('runs/:runId/results/:resultId/confirm-output-drafts')
  confirmOutputDrafts(
    @Req() request: AuthenticatedRequest,
    @Param('runId') runId: string,
    @Param('resultId') resultId: string,
    @Body() body: ConfirmSolutionOutputDraftsRequest = {},
  ) {
    return this.solutionsService.confirmOutputDrafts(
      this.getUser(request),
      runId,
      resultId,
      body,
    );
  }

  @Get(':code')
  getByCode(@Req() request: AuthenticatedRequest, @Param('code') code: string) {
    this.getUser(request);
    return this.solutionsService.getByCode(code);
  }

  @Post(':code/run-plan')
  createRunPlan(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
  ) {
    this.getUser(request);
    return this.solutionsService.createRunPlan(code);
  }

  @Post(':code/runs')
  createRun(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() body: CreateSolutionRunRequest = {},
  ) {
    return this.solutionsService.createRun(this.getUser(request), code, body);
  }

  private getUser(request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.authUser) {
      throw new UnauthorizedException('请先登录');
    }
    return request.authUser;
  }
}
