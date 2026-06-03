import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import type { AutoUploadAccount } from '../auto-upload/auto-upload.client';

@Injectable()
export class PublishingService {
    private readonly logger = new Logger(PublishingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly wechatPublisher: WechatPublisherService,
        private readonly autoUploadService: AutoUploadService,
    ) { }

    // ================= 账号管理接口 =================

    async getAccounts(options: { validate?: boolean; force?: boolean; ids?: number[]; source?: string; platform?: string } = {}) {
        if (options.force || options.validate || options.ids?.length) {
            await this.syncLocalEngineAccounts(options);
        }
        const rows = await this.prisma.publishAccount.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return rows
            .map((account) => this.expandPublishAccount(account))
            .filter((account) => this.matchesAccountFilters(account, options));
    }

    async createAccount(data: { platform: string; name: string; appId?: string; apiToken?: string; config?: any }) {
        return this.prisma.publishAccount.create({ data });
    }

    async updateAccount(id: string, data: any) {
        return this.prisma.publishAccount.update({ where: { id }, data });
    }

    async deleteAccount(id: string) {
        return this.prisma.publishAccount.delete({ where: { id } });
    }

    private async syncLocalEngineAccounts(options: { validate?: boolean; force?: boolean; ids?: number[] }) {
        let accounts: AutoUploadAccount[] = [];
        try {
            accounts = await this.autoUploadService.listAccounts({
                validate: options.validate,
                force: options.force,
                ids: options.ids,
            });
        } catch (error) {
            this.logger.warn(`同步本地发布账号失败: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        await Promise.all(
            accounts.map((account) =>
                this.prisma.publishAccount.upsert({
                    where: { id: this.localEnginePublishAccountId(account.id) },
                    create: {
                        id: this.localEnginePublishAccountId(account.id),
                        platform: this.resolvePublishPlatform(account.type),
                        name: account.profileName || account.userName || `本地账号 ${account.id}`,
                        config: this.buildLocalEngineAccountConfig(account),
                    },
                    update: {
                        platform: this.resolvePublishPlatform(account.type),
                        name: account.profileName || account.userName || `本地账号 ${account.id}`,
                        config: this.buildLocalEngineAccountConfig(account),
                    },
                }),
            ),
        );
    }

    private localEnginePublishAccountId(engineAccountId: number) {
        return `local-engine-${engineAccountId}`;
    }

    private resolvePublishPlatform(type: number) {
        const map: Record<number, string> = {
            1: 'xiaohongshu',
            2: 'wechat-channel',
            3: 'douyin',
            4: 'kuaishou',
            5: 'bilibili',
        };
        return map[type] || `platform-${type}`;
    }

    private buildLocalEngineAccountConfig(account: AutoUploadAccount) {
        return {
            source: 'local-engine',
            engineAccountId: account.id,
            platformType: account.type,
            filePath: account.filePath,
            userName: account.userName,
            profileName: account.profileName ?? null,
            avatarPath: account.avatarPath ?? null,
            avatarUrl: account.avatarUrl ?? null,
            status: account.status === 1 ? 'ready' : 'expired',
            statusLabel: account.statusLabel,
            avatarUpdatedAt: account.avatarUpdatedAt ?? null,
            syncedAt: new Date().toISOString(),
        };
    }

    private expandPublishAccount(account: Awaited<ReturnType<PrismaService['publishAccount']['findMany']>>[number]) {
        const config = (account.config || {}) as Record<string, any>;
        if (config.source !== 'local-engine') {
            return account;
        }
        return {
            ...account,
            source: 'local-engine',
            engineAccountId: config.engineAccountId,
            filePath: config.filePath,
            status: config.status,
            statusLabel: config.statusLabel,
        };
    }

    private matchesAccountFilters(
        account: Awaited<ReturnType<PrismaService['publishAccount']['findMany']>>[number] & { source?: string },
        options: { source?: string; platform?: string },
    ) {
        if (options.source === 'api' && account.source === 'local-engine') {
            return false;
        }

        if (options.source === 'local-engine' && account.source !== 'local-engine') {
            return false;
        }

        if (options.platform && account.platform !== options.platform) {
            return false;
        }

        return true;
    }

    // ================= 发布调度接口 =================

    /**
     * 将文章发往指定账号
     */
    async publishArticle(articleId: string, accountId: string): Promise<any> {
        const article = await this.prisma.article.findUnique({ where: { id: articleId } });
        if (!article) throw new NotFoundException('文章不存在');

        const account = await this.prisma.publishAccount.findUnique({ where: { id: accountId } });
        if (!account) throw new NotFoundException('发布账号不存在');

        // 初始化一条待发布状态的记录
        const record = await this.prisma.publishRecord.create({
            data: {
                articleId: article.id,
                accountId: account.id,
                platform: account.platform,
                status: 'pending',
            },
        });

        try {
            let result;

            // 路由到具体的平台 Service
            if (account.platform === 'wechat') {
                if (!account.apiToken || !account.appId) {
                    throw new BadRequestException('微信发布需要配置 apiToken 和 appId');
                }

                const config = (account.config as Record<string, any>) || {};

                result = await this.wechatPublisher.publish({
                    apiToken: account.apiToken,
                    authorizerAppid: account.appId,
                    apiUrl: config.apiUrl || 'https://mp.idouq.com/api/open/article',
                    title: article.title,
                    markdownContent: article.contentFormat === 'markdown' ? article.content : undefined,
                    htmlContent: article.finalHtml || (article.contentFormat === 'html' ? article.content : undefined),
                    coverUrl: article.coverImage || undefined,
                    categoryId: config.categoryId,
                    needOpenComment: config.openComment !== undefined ? Number(config.openComment) : 1,
                    onlyFansCanComment: config.onlyFansCanComment !== undefined ? Number(config.onlyFansCanComment) : 0,
                });
            } else {
                throw new BadRequestException('暂时只支持 wechat 平台的发布');
            }

            // 更新记录为成功
            await this.prisma.$transaction([
                this.prisma.publishRecord.update({
                    where: { id: record.id },
                    data: {
                        status: 'success',
                        publishUrl: result.publishUrl || result.articleId, // 暂存 ID 或链接
                    },
                }),
                this.prisma.article.update({
                    where: { id: article.id },
                    data: { status: 'published' },
                }),
            ]);

            return { success: true, articleId: result.articleId };

        } catch (error) {
            this.logger.error(`发布失败 [articleId: ${articleId}, accountId: ${accountId}]: ${error.message}`);

            // 更新记录为失败
            await this.prisma.publishRecord.update({
                where: { id: record.id },
                data: {
                    status: 'failed',
                    errorMessage: error.message,
                },
            });

            throw new BadRequestException(`发布失败: ${error.message}`);
        }
    }

    /**
     * 获取某篇文章的发布记录
     */
    async getRecordsByArticle(articleId: string) {
        return this.prisma.publishRecord.findMany({
            where: { articleId },
            include: { account: true },
            orderBy: { createdAt: 'desc' },
        });
    }
}
