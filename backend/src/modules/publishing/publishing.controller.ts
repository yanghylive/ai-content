import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { PublishingService } from './publishing.service';

@Controller('publishing')
export class PublishingController {
    constructor(private readonly publishingService: PublishingService) { }

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
    async createAccount(@Body() dto: any) {
        return this.publishingService.createAccount(dto);
    }

    @Put('accounts/:id')
    async updateAccount(@Param('id') id: string, @Body() dto: any) {
        return this.publishingService.updateAccount(id, dto);
    }

    @Delete('accounts/:id')
    async deleteAccount(@Param('id') id: string) {
        return this.publishingService.deleteAccount(id);
    }

    // ---- 发布操作 API ----

    @Post('publish')
    async publishArticle(@Body() dto: { articleId: string; accountId: string }) {
        return this.publishingService.publishArticle(dto.articleId, dto.accountId);
    }

    @Get('records/:articleId')
    async getRecords(@Param('articleId') articleId: string) {
        return this.publishingService.getRecordsByArticle(articleId);
    }

    private isTruthy(value?: string) {
        return value === '1' || value === 'true' || value === 'yes';
    }
}
