import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ArticleScraperService } from './article-scraper.service';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  assertMaterialFileSafe,
  MAX_MATERIAL_SIZE,
} from './material-file.guard';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { AutoUploadService } from './auto-upload.service';
import { resolveProjectDataPath } from '../../common/project-paths';
import { Public } from '../auth/auth.decorator';
import { RequirePlans } from '../auth/roles.decorator';
import {
  createRiskContextFromRequest,
  type BackendRiskConfirmationInput,
} from '../auth/risk-control';
import type {
  AutoUploadPublishPayload,
  AutoUploadUploadFile,
} from './auto-upload.client';

type RiskRequest = Request & {
  authUser?: { id?: string; username?: string; email?: string; name?: string };
  authSessionId?: string;
};

@Controller('auto-upload')
export class AutoUploadController {
  constructor(
    private readonly autoUploadService: AutoUploadService,
    private readonly articleScraper: ArticleScraperService,
  ) {}

  @Public()
  @Get('health')
  getHealth() {
    return this.autoUploadService.getHealth();
  }

  @Get('cdp-sessions')
  getCdpSessions() {
    return this.autoUploadService.getCdpSessions();
  }

  @Get('interaction/cdp/sessions')
  getInteractionCdpSessions() {
    return this.autoUploadService.getCdpSessions();
  }

  @Get('interaction/capabilities')
  getInteractionCapabilities() {
    return this.autoUploadService.getInteractionCapabilities();
  }

  @Get('interaction/evidence/cleanup-preview')
  previewInteractionEvidenceCleanup(
    @Query('retentionDays') retentionDays?: string,
  ) {
    return this.autoUploadService.previewInteractionEvidenceCleanup(
      this.parseOptionalPositiveInt(retentionDays),
    );
  }

  @Post('interaction/evidence/cleanup')
  cleanupInteractionEvidence(
    @Body('retentionDays') bodyRetentionDays?: number,
    @Body('riskConfirmation') riskConfirmation?: BackendRiskConfirmationInput,
    @Query('retentionDays') queryRetentionDays?: string,
    @Req() request?: RiskRequest,
  ) {
    return this.autoUploadService.cleanupInteractionEvidence(
      Number.isInteger(bodyRetentionDays)
        ? bodyRetentionDays
        : this.parseOptionalPositiveInt(queryRetentionDays),
      {
        confirmation: riskConfirmation,
        context: createRiskContextFromRequest(request),
      },
    );
  }

  @Get('accounts')
  listAccounts(
    @Query('validate') validate?: string,
    @Query('force') force?: string,
    @Query('ids') ids?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    const options = {
      validate: this.isTruthy(validate),
      force: this.isTruthy(force),
      ids: ids
        ?.split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0),
    };
    if (page !== undefined || pageSize !== undefined || search !== undefined) {
      return this.autoUploadService.listAccountPage({
        ...options,
        page: this.parseOptionalPageNumber(page),
        pageSize: this.parseOptionalPageNumber(pageSize),
        search: search?.trim() || undefined,
      });
    }
    return this.autoUploadService.listAccounts(options);
  }

  @Get('accounts/health')
  accountHealth(
    @Query('validate') validate?: string,
    @Query('force') force?: string,
  ) {
    return this.autoUploadService.getAccountHealth({
      validate: validate === undefined ? false : this.isTruthy(validate),
      force: this.isTruthy(force),
    });
  }

  @Post('accounts/open')
  openAccounts(
    @Body('ids') ids: number[] | undefined,
    @Body('platform') platform?: string,
  ) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('请选择要打开的账号');
    }

    return this.autoUploadService.openAccounts(ids, {
      platform: platform?.trim() || undefined,
    });
  }

  @Post('interaction/open-entry')
  openInteractionEntry(
    @Body('accountId') accountId?: number | string,
    @Body('entryType') entryType?: string,
  ) {
    const parsedAccountId = this.parsePositiveId(
      String(accountId ?? ''),
      '账号 ID 无效',
    );
    const normalizedEntryType = entryType?.trim();
    if (!normalizedEntryType) {
      throw new BadRequestException('互动入口类型无效');
    }

    return this.autoUploadService.openInteractionEntry({
      accountId: parsedAccountId,
      entryType: normalizedEntryType,
    });
  }

  @Post('accounts/:id/relogin')
  prepareAccountRelogin(
    @Param('id') id: string,
    @Query('platform') platform?: string,
  ) {
    const parsedId = this.parsePositiveId(id, '账号 ID 无效');

    return this.autoUploadService.prepareAccountRelogin(parsedId, {
      platform: platform?.trim() || undefined,
    });
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('accounts/recover-blocked-tasks/confirmations')
  createRecoverBlockedTasksConfirmation(
    @Body('accountId') accountId?: number,
    @Req() request?: RiskRequest,
  ) {
    if (
      accountId !== undefined &&
      (!Number.isInteger(accountId) || accountId <= 0)
    ) {
      throw new BadRequestException('账号 ID 无效');
    }

    return this.autoUploadService.createResumeBlockedTasksConfirmation(
      accountId,
      createRiskContextFromRequest(request),
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('accounts/recover-blocked-tasks')
  recoverBlockedTasks(
    @Body('accountId') accountId?: number,
    @Body('confirmationId') confirmationId?: string,
    @Req() request?: RiskRequest,
  ) {
    if (
      accountId !== undefined &&
      (!Number.isInteger(accountId) || accountId <= 0)
    ) {
      throw new BadRequestException('账号 ID 无效');
    }

    return this.autoUploadService.resumeAccountBlockedTasks(accountId, {
      confirmationId,
      context: createRiskContextFromRequest(request),
    });
  }

  @Post('accounts/:id/avatar')
  refreshAccountAvatar(@Param('id') id: string) {
    const parsedId = this.parsePositiveId(id, '账号 ID 无效');

    return this.autoUploadService.refreshAccountAvatar(parsedId);
  }

  @Get('avatars/:filename')
  async serveAccountAvatar(
    @Param('filename') filename: string,
    @Res() response: Response,
  ) {
    if (!filename || filename.includes('..') || filename.includes('/')) {
      throw new BadRequestException('头像文件名无效');
    }
    if (!(await this.autoUploadService.hasAccountAvatar(filename))) {
      throw new NotFoundException('头像文件不存在');
    }
    const root =
      process.env.AUTO_UPLOAD_AVATARS_DIR || resolveProjectDataPath('avatars');
    const filepath = join(root, filename);
    if (!existsSync(filepath)) {
      throw new NotFoundException('头像文件不存在');
    }
    response.sendFile(filename, { root });
  }

  @Delete('accounts/:id')
  deleteAccount(
    @Param('id') id: string,
    @Query('platform') platform?: string,
    @Body('riskConfirmation') riskConfirmation?: BackendRiskConfirmationInput,
    @Req() request?: RiskRequest,
  ) {
    const parsedId = this.parsePositiveId(id, '账号 ID 无效');

    return this.autoUploadService.deleteAccount(parsedId, {
      platform: platform?.trim() || undefined,
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
    });
  }

  @Get('accounts/login')
  async loginAccount(
    @Query('type') type: string | undefined,
    @Query('profileName') profileName: string | undefined,
    @Query('requestId') requestId: string | undefined,
    @Query('update') update: string | undefined,
    @Query('recordId') recordId: string | undefined,
    @Res() response: Response,
  ) {
    const platformType = Number(type);
    if (![1, 2, 3, 4, 5].includes(platformType)) {
      throw new BadRequestException('请选择有效平台');
    }
    if (!profileName?.trim()) {
      throw new BadRequestException('请填写账号主体名称');
    }
    if (!requestId?.trim()) {
      throw new BadRequestException('登录请求 ID 无效');
    }

    const stream = this.autoUploadService.streamAccountLogin({
      type: platformType,
      profileName: profileName.trim(),
      requestId: requestId.trim(),
      update: this.isTruthy(update),
      recordId: recordId
        ? this.parsePositiveId(recordId, '账号 ID 无效')
        : undefined,
    });
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();
    try {
      for await (const message of stream) {
        response.write(`data: ${message}\n\n`);
        if (['200', '500', 'CANCELLED'].includes(String(message))) break;
      }
    } catch (error) {
      response.write(
        `data: ERROR: 登录页面初始化失败：${
          error instanceof Error ? error.message : String(error)
        }\n\n`,
      );
      response.write('data: 500\n\n');
    }
    response.end();
  }

  @Post('accounts/login/cancel')
  cancelLogin(@Body('requestId') requestId: string | undefined) {
    if (!requestId?.trim()) {
      throw new BadRequestException('登录请求 ID 无效');
    }

    return this.autoUploadService.cancelLogin(requestId.trim());
  }

  @Get('materials')
  listMaterials() {
    return this.autoUploadService.listMaterials();
  }

  @Get('logs')
  listLogs(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Number(limit) : undefined;

    return this.autoUploadService.listLogs(
      Number.isInteger(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get('tasks')
  listTasks(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('platform') platform?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;

    if (
      page !== undefined ||
      pageSize !== undefined ||
      search !== undefined ||
      status !== undefined ||
      platform !== undefined
    ) {
      return this.autoUploadService.listTaskPage({
        page: this.parseOptionalPageNumber(page),
        pageSize: this.parseOptionalPageNumber(pageSize),
        search: search?.trim() || undefined,
        status: status?.trim() || undefined,
        platform: platform?.trim() || undefined,
      });
    }

    return this.autoUploadService.listTasks(
      Number.isInteger(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('tasks/:id/retry/confirmations')
  createRetryTaskConfirmation(
    @Param('id') id: string,
    @Req() request?: RiskRequest,
  ) {
    const parsedId = this.parseTaskId(id, '任务 ID 无效');

    return this.autoUploadService.createRetryPublishConfirmation(
      parsedId,
      createRiskContextFromRequest(request),
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('tasks/:id/retry')
  retryTask(
    @Param('id') id: string,
    @Body('confirmationId') confirmationId?: string,
    @Req() request?: RiskRequest,
  ) {
    const parsedId = this.parseTaskId(id, '任务 ID 无效');

    return this.autoUploadService.retryPublishTask(parsedId, {
      confirmationId,
      context: createRiskContextFromRequest(request),
    });
  }

  @Delete('tasks/:id')
  deleteTask(
    @Param('id') id: string,
    @Body('riskConfirmation') riskConfirmation?: BackendRiskConfirmationInput,
    @Req() request?: RiskRequest,
  ) {
    const parsedId = this.parseTaskId(id, '任务 ID 无效');

    return this.autoUploadService.deletePublishTask(parsedId, {
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
    });
  }

  @Get('tasks/:id/platform-results')
  getPlatformResults(@Param('id') id: string) {
    const parsedId = this.parseTaskId(id, '任务 ID 无效');

    return this.autoUploadService.getPublishBatchResults(parsedId);
  }

  @Post('materials')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MATERIAL_SIZE },
      fileFilter: (_req, file, cb) => {
        // MIME/扩展名白名单：拒绝非图片/视频（第一道防线）
        const allowed =
          /^(image|video)\//i.test(file.mimetype) ||
          /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|avi|mkv)$/i.test(
            file.originalname,
          );
        cb(
          allowed
            ? null
            : new BadRequestException('仅支持图片/视频文件（≤50MB）'),
          allowed,
        );
      },
    }),
  )
  uploadMaterial(
    @UploadedFile() file: AutoUploadUploadFile | undefined,
    @Body('filename') filename?: string,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }
    return this.autoUploadService.uploadMaterial(file, filename);
  }

  @Post('materials/import-article')
  importArticleMaterials(@Body('articleId') articleId?: string) {
    if (!articleId?.trim()) {
      throw new BadRequestException('内容 ID 无效');
    }

    return this.autoUploadService.importArticleMaterials(articleId.trim());
  }

  @Get('materials/preview')
  async previewMaterial(
    @Query('filename') filename: string | undefined,
    @Res() response: Response,
  ) {
    if (!filename || filename.includes('..') || filename.startsWith('/')) {
      throw new BadRequestException('素材文件名无效');
    }

    const file = await this.autoUploadService.fetchMaterialFile(filename);
    response.setHeader('Content-Type', file.contentType);
    if (file.contentLength) {
      response.setHeader('Content-Length', file.contentLength);
    }
    response.send(file.buffer);
  }

  @Delete('materials/:id')
  deleteMaterial(
    @Param('id') id: string,
    @Body('riskConfirmation') riskConfirmation?: BackendRiskConfirmationInput,
    @Req() request?: RiskRequest,
  ) {
    const parsedId = this.parsePositiveId(id, '素材 ID 无效');

    return this.autoUploadService.deleteMaterial(parsedId, {
      confirmation: riskConfirmation,
      context: createRiskContextFromRequest(request),
    });
  }

  @Post('preflight')
  preflightPublishBatch(
    @Body()
    body:
      | AutoUploadPublishPayload[]
      | { payloads?: AutoUploadPublishPayload[] },
  ) {
    const payloads = Array.isArray(body) ? body : body.payloads;
    if (!Array.isArray(payloads)) {
      throw new BadRequestException('发布 payload 无效');
    }

    return this.autoUploadService.preflightPublishBatch(payloads);
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('publish/confirmations')
  createPublishConfirmation(
    @Body()
    body:
      | AutoUploadPublishPayload[]
      | { payloads?: AutoUploadPublishPayload[] },
    @Req() request?: RiskRequest,
  ) {
    const payloads = Array.isArray(body) ? body : body.payloads;
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new BadRequestException('请至少选择一个发布账号');
    }
    return this.autoUploadService.createPublishConfirmation(
      payloads,
      createRiskContextFromRequest(request),
    );
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('publish')
  publishBatch(
    @Body()
    body:
      | AutoUploadPublishPayload[]
      | {
          payloads?: AutoUploadPublishPayload[];
          confirmationId?: string;
        },
    @Req() request?: RiskRequest,
  ) {
    const payloads = Array.isArray(body) ? body : body.payloads;
    const confirmationId = Array.isArray(body)
      ? undefined
      : body.confirmationId;
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new BadRequestException('请至少选择一个发布账号');
    }

    return this.autoUploadService.publishBatch(payloads, {
      confirmationId,
      context: createRiskContextFromRequest(request),
    });
  }

  private isTruthy(value?: string) {
    return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  }

  private parsePositiveId(value: string, message: string) {
    const parsedId = Number(value);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      throw new BadRequestException(message);
    }

    return parsedId;
  }

  private parseTaskId(value: string, message: string) {
    const parsedId = Number(value);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
      throw new BadRequestException(message);
    }

    return parsedId;
  }

  private parseOptionalPositiveInt(value?: string) {
    if (value === undefined || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException('天数参数无效');
    }
    return parsed;
  }

  private parseOptionalPageNumber(value?: string) {
    if (value === undefined || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('分页参数无效');
    }
    return parsed;
  }

  @Post('scrape-article')
  async scrapeArticle(@Body('url') url: string) {
    if (!url || typeof url !== 'string') {
      throw new BadRequestException('请提供文章链接');
    }
    return this.articleScraper.scrapeUrl(url);
  }
}
