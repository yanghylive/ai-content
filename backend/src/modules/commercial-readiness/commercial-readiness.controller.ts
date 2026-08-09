import { Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RequirePlans } from '../auth/roles.decorator';
import { COMMERCIAL_BACKUP_REQUIRED_PLANS } from './commercial-readiness.constants';
import { CommercialReadinessService } from './commercial-readiness.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@Controller('commercial-readiness')
export class CommercialReadinessController {
  constructor(private readonly service: CommercialReadinessService) {}

  @Get()
  getSummary(@Req() request: AuthenticatedRequest) {
    return this.service.getSummary(this.getUser(request));
  }

  @Get('summary')
  getSummaryAlias(@Req() request: AuthenticatedRequest) {
    return this.service.getSummary(this.getUser(request));
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Post('backup/export')
  exportLocalBackup(@Req() request: AuthenticatedRequest) {
    return this.service.createLocalBackup(this.getUser(request));
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Get('backup/status')
  getBackupStatus() {
    return this.service.getBackupStatus();
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Post('backup/restore-dry-run')
  runBackupRestoreDryRun() {
    return this.service.runBackupRestoreDryRun();
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Post('backup/isolated-restore-dry-run')
  runBackupIsolatedRestoreDryRun() {
    return this.service.runBackupIsolatedRestoreDryRun();
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Get('backup/scheduler/status')
  getBackupSchedulerStatus() {
    return this.service.getBackupSchedulerStatus();
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Post('backup/scheduler/run-once')
  runBackupSchedulerOnce(@Req() request: AuthenticatedRequest) {
    return this.service.runBackupSchedulerOnce(this.getUser(request));
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Get('release-rollback/status')
  getReleaseRollbackStatus() {
    return this.service.getReleaseRollbackStatus();
  }

  @RequirePlans(...COMMERCIAL_BACKUP_REQUIRED_PLANS)
  @Post('release-rollback/dry-run')
  runReleaseRollbackDryRun() {
    return this.service.runReleaseRollbackDryRun();
  }

  private getUser(request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.authUser) {
      throw new Error('Authenticated user missing from request context');
    }
    return request.authUser;
  }
}
