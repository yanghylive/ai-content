import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { RequirePlans } from '../auth/roles.decorator';

@Controller('publishing')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  // ---- 账号管理 API ----

  @Get('accounts')
  async getAccounts(
    @Query('validate') validate?: string,
    @Query('force') force?: string,
    @Query('ids') ids?: string,
    @Query('source') source?: string,
    @Query('platform') platform?: string,
  ) {
    return this.publishingService.getAccounts({
      validate: this.isTruthy(validate),
      force: this.isTruthy(force),
      ids: ids
        ?.split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0),
      source,
      platform,
    });
  }

  @Post('accounts')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  async createAccount(@Body() dto: any) {
    return this.publishingService.createAccount(dto);
  }

  @Post('accounts/:id/delete/confirmations')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createAccountDeleteConfirmation(@Param('id') id: string) {
    return this.publishingService.createAccountDeleteConfirmation(id);
  }

  @Put('accounts/:id')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  async updateAccount(@Param('id') id: string, @Body() dto: any) {
    return this.publishingService.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  async deleteAccount(
    @Param('id') id: string,
    @Body() dto: { confirmationId?: string },
  ) {
    return this.publishingService.deleteAccount(id, dto?.confirmationId);
  }

  // ---- 发布操作 API ----

  @Post('publish/confirmations')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  async createPublishConfirmation(
    @Body()
    dto: {
      articleId: string;
      accountId: string;
      sourceUrl?: string;
    },
  ) {
    return this.publishingService.createPublishConfirmation(
      dto.articleId,
      dto.accountId,
      dto.sourceUrl,
    );
  }

  @Post('publish')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  async publishArticle(
    @Body()
    dto: {
      articleId: string;
      accountId: string;
      confirmationId?: string;
      sourceUrl?: string;
    },
  ) {
    return this.publishingService.publishArticle(
      dto.articleId,
      dto.accountId,
      dto.confirmationId,
      dto.sourceUrl,
    );
  }

  @Get('records/:articleId')
  async getRecords(@Param('articleId') articleId: string) {
    return this.publishingService.getRecordsByArticle(articleId);
  }

  @Get('wechat/previews/:articleId')
  getJpagePreview(@Param('articleId') articleId: string) {
    return this.publishingService.getJpagePreview(articleId);
  }

  @Post('wechat/previews/confirmations')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createJpagePreviewConfirmation(
    @Body() dto: { articleId: string; jpageAccountId: string },
  ) {
    return this.publishingService.createJpagePreviewConfirmation(
      dto.articleId,
      dto.jpageAccountId,
    );
  }

  @Post('wechat/previews')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createJpagePreview(
    @Body()
    dto: {
      articleId: string;
      jpageAccountId: string;
      confirmationId?: string;
    },
  ) {
    return this.publishingService.createJpagePreview(
      dto.articleId,
      dto.jpageAccountId,
      dto.confirmationId,
    );
  }

  @Post('wechat/previews/:articleId/render/confirmations')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createJpageRemoteRenderConfirmation(@Param('articleId') articleId: string) {
    return this.publishingService.createJpageRemoteRenderConfirmation(
      articleId,
    );
  }

  @Post('wechat/previews/:articleId/render/confirm')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  confirmJpageRemoteRender(
    @Param('articleId') articleId: string,
    @Body() dto: { confirmationId?: string },
  ) {
    return this.publishingService.confirmJpageRemoteRender(
      articleId,
      dto?.confirmationId,
    );
  }

  @Post('wechat/drafts/confirmations')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createWechatDraftConfirmation(
    @Body() dto: { articleId: string; accountId: string; sourceUrl?: string },
  ) {
    return this.publishingService.createWechatDraftConfirmation(
      dto.articleId,
      dto.accountId,
      dto.sourceUrl,
    );
  }

  @Post('wechat/drafts')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createWechatDraft(
    @Body()
    dto: {
      articleId: string;
      accountId: string;
      confirmationId?: string;
      sourceUrl?: string;
    },
  ) {
    return this.publishingService.createWechatOfficialDraft(
      dto.articleId,
      dto.accountId,
      dto.confirmationId,
      dto.sourceUrl,
    );
  }

  @Post('wechat/drafts/:recordId/readback/confirmations')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createWechatDraftReadbackConfirmation(@Param('recordId') recordId: string) {
    return this.publishingService.createWechatDraftReadbackConfirmation(
      recordId,
    );
  }

  @Post('wechat/drafts/:recordId/readback/reconcile')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  reconcileWechatDraft(
    @Param('recordId') recordId: string,
    @Body() dto: { confirmationId?: string },
  ) {
    return this.publishingService.reconcileWechatOfficialDraft(
      recordId,
      dto?.confirmationId,
    );
  }

  @Post('wechat/publish/confirmations')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createWechatPublishConfirmation(
    @Body() dto: { articleId: string; accountId: string; mediaId: string },
  ) {
    return this.publishingService.createWechatOfficialPublishConfirmation(
      dto.articleId,
      dto.accountId,
      dto.mediaId,
    );
  }

  @Post('wechat/publish')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  submitWechatPublish(
    @Body()
    dto: {
      articleId: string;
      accountId: string;
      mediaId: string;
      confirmationId?: string;
    },
  ) {
    return this.publishingService.submitWechatOfficialPublish(
      dto.articleId,
      dto.accountId,
      dto.mediaId,
      dto.confirmationId,
    );
  }

  @Post('wechat/publish/:recordId/refresh')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  refreshWechatPublish(@Param('recordId') recordId: string) {
    return this.publishingService.refreshWechatOfficialPublish(recordId);
  }

  private isTruthy(value?: string) {
    return value === '1' || value === 'true' || value === 'yes';
  }
}
