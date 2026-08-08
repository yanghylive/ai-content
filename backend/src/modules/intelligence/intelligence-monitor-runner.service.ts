import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { safeText } from '../../common/text.utils';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RedfoxClientService } from '../redfox/redfox-client.service';
import { RedfoxInterfaceCatalogService } from '../redfox/redfox-interface-catalog.service';
import { RedfoxService } from '../redfox/redfox.service';
import type {
  RedfoxCallLog,
  RedfoxClientRequestOptions,
  RedfoxEffectiveConnection,
  RedfoxScope,
} from '../redfox/redfox.types';
import { RunIntelligenceSearchDto } from './dto/run-intelligence-search.dto';
import { RunIntelligenceMonitorsDto } from './dto/run-intelligence-monitors.dto';
import { IntelligenceService } from './intelligence.service';

type IntelligenceActor =
  | Pick<AuthenticatedUser, 'id' | 'kaypalUserId' | 'kaypalRole' | 'role'>
  | undefined
  | null;

type MonitorWithSkill = Prisma.IntelligenceMonitorGetPayload<{
  include: {
    skillInstall: {
      include: {
        skill: true;
      };
    };
  };
}>;

type CachedIntelligenceItem = Prisma.IntelligenceItemGetPayload<{
  include: { redfoxSkill: true };
}>;

type MonitorExecutionPlan = {
  path: string;
  method: NonNullable<RedfoxClientRequestOptions['method']>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  estimatedCostPoints: number;
};

type MonitorRunTrigger = 'manual' | 'schedule';

const WECHAT_ARTICLE_ENGAGEMENT_ESTIMATED_COST_POINTS = 80;

type MonitorRunSuccess = {
  monitorId: string;
  status: 'success';
  trigger: MonitorRunTrigger;
  callLogId: string | null;
  received: number;
  normalized: number;
  created: number;
  updated: number;
  lastRunAt: string;
  nextRunAt: string;
};

type MonitorRunFailure = {
  monitorId: string;
  status: 'failed';
  error: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

type MonitorRunResult = MonitorRunSuccess | MonitorRunFailure;

type OneOffSearchEndpoint = {
  platform: string;
  platformLabel: string;
  type: string;
  path: string;
  method: NonNullable<RedfoxClientRequestOptions['method']>;
  estimatedCostPoints: number;
};

type RedfoxCommentSkillPlatform = 'douyin' | 'xiaohongshu' | 'bilibili';

type RedfoxCommentSkillConfig = {
  platform: RedfoxCommentSkillPlatform;
  platformLabel: string;
  skillCode: string;
  skillName: string;
};

@Injectable()
export class IntelligenceMonitorRunnerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IntelligenceMonitorRunnerService.name);
  private readonly runningMonitorIds = new Set<string>();
  private daemon?: ReturnType<typeof setInterval>;
  private daemonRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redfoxService: RedfoxService,
    private readonly redfoxClient: RedfoxClientService,
    private readonly redfoxInterfaces: RedfoxInterfaceCatalogService,
    private readonly intelligenceService: IntelligenceService,
  ) {}

  onModuleInit() {
    if (!this.isDaemonArmed()) {
      if (this.config.get<string>('INTELLIGENCE_MONITOR_DAEMON') === 'true') {
        this.logger.warn(
          'Intelligence monitor daemon is configured but not armed. Set INTELLIGENCE_MONITOR_DAEMON_ARMED=true to allow unattended RedFox execution.',
        );
      }
      return;
    }

    const tickMs = this.daemonTickMs();
    this.daemon = setInterval(() => {
      void this.runDaemonTick('interval');
    }, tickMs);
    void this.runDaemonTick('startup');
    this.logger.log(`Intelligence monitor daemon started (tick=${tickMs}ms)`);
  }

  onModuleDestroy() {
    if (this.daemon) {
      clearInterval(this.daemon);
      this.daemon = undefined;
    }
  }

  async runMonitor(actor: IntelligenceActor, monitorId: string) {
    const scope = await this.redfoxService.resolveScope(actor);
    const monitor = await this.findScopedMonitor(scope, monitorId);
    return this.executeMonitor(scope, monitor, 'manual');
  }

  async runDueMonitors(
    actor: IntelligenceActor,
    dto: RunIntelligenceMonitorsDto = {},
  ) {
    const scope = actor ? await this.redfoxService.resolveScope(actor) : null;
    const monitors = await this.findDueMonitors(scope, dto.limit);
    return this.executeMonitorBatch(monitors, 'manual');
  }

  async runSearch(actor: IntelligenceActor, dto: RunIntelligenceSearchDto) {
    const keyword = dto.keyword?.trim();
    if (!keyword) {
      throw new BadRequestException('请输入要搜索的关键词');
    }

    const scope = await this.redfoxService.resolveScope(actor);
    if (dto.target === 'comment') {
      return this.runRedfoxCommentSkillSearch(scope, keyword, dto);
    }
    if (dto.target === 'engagement') {
      return this.runWechatArticleEngagementSearch(scope, keyword, dto);
    }

    const connection = await this.redfoxService.getEffectiveConnection(scope);
    const limit = Math.max(1, Math.min(50, Number(dto.limit || 20)));
    const endpoints = await this.resolveSearchEndpoints(dto);
    const perEndpointLimit = Math.max(1, Math.ceil(limit / endpoints.length));
    const runs = await Promise.all(
      endpoints.map(async (endpoint) => {
        const callLogRef: { current: RedfoxCallLog | null } = {
          current: null,
        };
        try {
          const payload = await this.redfoxClient.request<unknown>(
            scope,
            connection,
            {
              method: endpoint.method,
              path: endpoint.path,
              body: this.searchBody(keyword, perEndpointLimit),
              operation: 'intelligence.search.manual',
              skillCode: `redfox-interface:${endpoint.platform}`,
              estimatedCostPoints: endpoint.estimatedCostPoints,
              requireApiKey: true,
              onCallLogRecorded: (log) => {
                callLogRef.current = log;
              },
            },
          );
          const rawItems = this.extractRawItems(payload).slice(
            0,
            perEndpointLimit,
          );
          const ingestResult =
            await this.intelligenceService.ingestRedfoxItemsForScope(scope, {
              platform: endpoint.platform,
              type: endpoint.type,
              redfoxCallLogId: callLogRef.current?.id,
              status: 'new',
              rawItems,
            });
          return {
            platform: endpoint.platform,
            platformLabel: endpoint.platformLabel,
            endpoint: endpoint.path,
            status: 'success' as const,
            errorCode: null,
            httpStatus: 200,
            callLogId: callLogRef.current?.id || null,
            estimatedCostPoints: endpoint.estimatedCostPoints,
            costPoints: this.redfoxCallLogCostPoints(callLogRef.current),
            received: rawItems.length,
            normalized: ingestResult.normalized,
            created: ingestResult.created,
            updated: ingestResult.updated,
            items: ingestResult.items,
          };
        } catch (error) {
          return {
            platform: endpoint.platform,
            platformLabel: endpoint.platformLabel,
            endpoint: endpoint.path,
            status: 'failed' as const,
            error: this.publicDataServiceError(error),
            errorCode: this.publicDataServiceErrorCode(error),
            httpStatus: this.publicDataServiceHttpStatus(error),
            callLogId: callLogRef.current?.id || null,
            estimatedCostPoints: endpoint.estimatedCostPoints,
            costPoints: this.redfoxCallLogCostPoints(callLogRef.current),
            received: 0,
            normalized: 0,
            created: 0,
            updated: 0,
            items: [],
          };
        }
      }),
    );
    const succeeded = runs.filter((run) => run.status === 'success');
    if (!succeeded.length) {
      const failures = runs.map((run) => ({
        platform: run.platform,
        platformLabel: run.platformLabel,
        error: run.error || '数据服务请求失败',
        errorCode: run.errorCode,
        callLogId: run.callLogId,
      }));
      const insufficientCredits = runs.every(
        (run) =>
          run.errorCode === 'INSUFFICIENT_CREDITS' ||
          /积分余额不足|积分不足|余额不足/i.test(run.error || ''),
      );
      throw new HttpException(
        insufficientCredits
          ? {
              code: 'INSUFFICIENT_CREDITS',
              message: '积分余额不足，请充值或调整任务消耗后再试。',
              publicDetails: { failures },
            }
          : {
              code: 'INTELLIGENCE_SEARCH_ALL_SOURCES_FAILED',
              message: `数据查找暂时不可用：${runs
                .map((run) => run.platformLabel)
                .join('、')}。请查看各平台原因后重试。`,
              publicDetails: { failures },
            },
        insufficientCredits
          ? HttpStatus.PAYMENT_REQUIRED
          : HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const items = runs.flatMap((run) => run.items).slice(0, limit);
    return {
      keyword,
      platform: dto.platform || 'all',
      target: dto.target || 'post',
      received: runs.reduce((sum, run) => sum + run.received, 0),
      normalized: runs.reduce((sum, run) => sum + run.normalized, 0),
      created: runs.reduce((sum, run) => sum + run.created, 0),
      updated: runs.reduce((sum, run) => sum + run.updated, 0),
      endpoints: runs.map((run) => ({
        platform: run.platform,
        platformLabel: run.platformLabel,
        endpoint: run.endpoint,
        status: run.status,
        error: run.status === 'failed' ? run.error : undefined,
        errorCode: run.status === 'failed' ? run.errorCode : undefined,
        callLogId: run.callLogId,
        estimatedCostPoints: run.estimatedCostPoints,
        costPoints: run.costPoints,
        received: run.received,
        normalized: run.normalized,
        created: run.created,
        updated: run.updated,
      })),
      items,
    };
  }

  private async runDaemonTick(source: 'startup' | 'interval') {
    if (!this.isDaemonArmed()) return;
    if (this.daemonRunning) return;
    this.daemonRunning = true;
    try {
      const monitors = await this.findDueMonitors(
        null,
        this.daemonBatchLimit(),
      );
      if (!monitors.length) return;
      await this.executeMonitorBatch(monitors, 'schedule');
    } catch (error) {
      this.logger.warn(
        `Intelligence monitor daemon failed (${source}): ${this.errorMessage(error)}`,
      );
    } finally {
      this.daemonRunning = false;
    }
  }

  private async executeMonitorBatch(
    monitors: MonitorWithSkill[],
    trigger: MonitorRunTrigger,
  ) {
    const results: MonitorRunResult[] = [];
    for (const monitor of monitors) {
      const scope = this.scopeFromMonitor(monitor);
      try {
        results.push(await this.executeMonitor(scope, monitor, trigger));
      } catch (error) {
        results.push({
          monitorId: monitor.id,
          status: 'failed',
          error: this.errorMessage(error),
          lastRunAt: monitor.lastRunAt?.toISOString() || null,
          nextRunAt: monitor.nextRunAt?.toISOString() || null,
        });
      }
    }

    return {
      scanned: monitors.length,
      executed: results.length,
      succeeded: results.filter((result) => result.status === 'success').length,
      failed: results.filter((result) => result.status === 'failed').length,
      results,
    };
  }

  private async resolveSearchEndpoints(
    dto: RunIntelligenceSearchDto,
  ): Promise<OneOffSearchEndpoint[]> {
    const scenario =
      dto.target === 'account' ? 'search_user' : 'search_article';
    const type = dto.target === 'account' ? 'account' : 'keyword';
    const platformCodes = this.searchPlatformCodes(dto.platform);
    const endpoints: OneOffSearchEndpoint[] = [];

    for (const platform of platformCodes) {
      const catalog = await this.redfoxInterfaces.list({
        page: 1,
        limit: 20,
        platform,
        scenario,
        status: 'online',
      });
      const item = catalog.items.find(
        (candidate) =>
          candidate.method === 'POST' &&
          !this.redfoxInterfaces.isBlockedMonitorPath(candidate.path),
      );
      if (item) {
        endpoints.push({
          platform,
          platformLabel: item.platformName || this.platformLabel(platform),
          type,
          path: item.path,
          method: item.method as OneOffSearchEndpoint['method'],
          estimatedCostPoints: 1,
        });
        continue;
      }

      const fallback = this.fallbackSearchEndpoint(platform, scenario);
      if (fallback) {
        endpoints.push({
          ...fallback,
          type,
        });
      }
    }

    if (!endpoints.length) {
      throw new BadRequestException(
        '当前没有可用的数据来源，请稍后重试或换个平台。',
      );
    }
    return endpoints;
  }

  private fallbackSearchEndpoint(
    platform: string,
    scenario: 'search_user' | 'search_article',
  ): Omit<OneOffSearchEndpoint, 'type'> | null {
    const endpoints: Record<
      string,
      {
        search_user?: string;
        search_article?: string;
      }
    > = {
      douyin: {
        search_user: '/story/api/dyData/searchUser',
        search_article: '/story/api/dyData/searchArticle',
      },
      xiaohongshu: {
        search_user: '/story/api/xhsUser/searchUser',
        search_article: '/story/api/xhsUser/searchArticle',
      },
      bilibili: {
        search_user: '/story/api/bili/data/accountSearch',
        search_article: '/story/api/bili/data/workSearch',
      },
      gongzhonghao: {
        search_user: '/story/api/gzhData/searchUser',
        search_article: '/story/api/gzhData/searchArticle',
      },
    };
    const path = endpoints[platform]?.[scenario];
    if (!path) return null;
    return {
      platform,
      platformLabel: this.platformLabel(platform),
      path,
      method: 'POST',
      estimatedCostPoints: 1,
    };
  }

  private async runRedfoxCommentSkillSearch(
    scope: RedfoxScope,
    keyword: string,
    dto: RunIntelligenceSearchDto,
  ) {
    const limit = Math.max(1, Math.min(50, Number(dto.limit || 20)));
    const sourceText = dto.workId || dto.workUrl || keyword;
    const platform = this.resolveCommentSkillPlatform(dto.platform, sourceText);
    const config = this.redfoxCommentSkillConfig(platform);
    const workId = this.extractCommentWorkId(platform, sourceText);
    if (!workId) {
      throw new BadRequestException(
        '评论分析需要作品链接或作品 ID。先用作品搜索找到目标作品，再粘贴抖音作品链接、小红书笔记链接或 B站 BV 号执行评论分析。',
      );
    }

    const connection = await this.redfoxService.getEffectiveConnection(scope);
    const callLogs: RedfoxCallLog[] = [];
    const recordCallLog = (log: RedfoxCallLog) => {
      callLogs.push(log);
    };
    const rawItems = (
      await this.fetchRedfoxCommentSkillItems(
        scope,
        connection,
        config,
        workId,
        keyword,
        dto,
        recordCallLog,
      )
    ).slice(0, limit);

    const callLog = callLogs[callLogs.length - 1] || null;
    if (!rawItems.length) {
      return {
        keyword,
        platform: config.platform,
        target: 'comment',
        received: 0,
        normalized: 0,
        created: 0,
        updated: 0,
        endpoints: [
          {
            platform: config.platform,
            platformLabel: config.platformLabel,
            endpoint: config.skillCode,
            status: 'empty' as const,
            callLogId: callLog?.id || null,
            estimatedCostPoints: this.commentEstimatedCostPoints(
              config.platform,
            ),
            costPoints: this.redfoxCallLogsCostPoints(callLogs),
            received: 0,
            normalized: 0,
            created: 0,
            updated: 0,
            source: 'redfox_skill',
            message: '作品公开评论为空，或系统当前未返回可入库评论。',
          },
        ],
        items: [],
      };
    }

    const ingestResult =
      await this.intelligenceService.ingestRedfoxItemsForScope(scope, {
        platform: config.platform,
        type: 'comment',
        redfoxSkillCode: config.skillCode,
        redfoxCallLogId: callLog?.id,
        status: 'new',
        rawItems,
      });

    return {
      keyword,
      platform: config.platform,
      target: 'comment',
      received: rawItems.length,
      normalized: ingestResult.normalized,
      created: ingestResult.created,
      updated: ingestResult.updated,
      endpoints: [
        {
          platform: config.platform,
          platformLabel: config.platformLabel,
          endpoint: config.skillCode,
          status: 'success' as const,
          callLogId: callLog?.id || null,
          estimatedCostPoints: this.commentEstimatedCostPoints(config.platform),
          costPoints: this.redfoxCallLogsCostPoints(callLogs),
          received: rawItems.length,
          normalized: ingestResult.normalized,
          created: ingestResult.created,
          updated: ingestResult.updated,
          source: 'redfox_skill',
        },
      ],
      items: ingestResult.items,
    };
  }

  private async runWechatArticleEngagementSearch(
    scope: RedfoxScope,
    keyword: string,
    dto: RunIntelligenceSearchDto,
  ) {
    const platform = dto.platform?.trim() || 'wechat';
    if (
      platform !== 'wechat' &&
      platform !== 'gongzhonghao' &&
      platform !== 'all'
    ) {
      throw new BadRequestException(
        '文章互动分析当前只支持公众号文章。请选择公众号并粘贴公众号文章链接。',
      );
    }

    const articleUrl = this.extractWechatArticleUrl(
      dto.workUrl || dto.workId || keyword,
    );
    if (!articleUrl) {
      throw new BadRequestException(
        '公众号文章互动分析需要公众号文章链接。请粘贴 mp.weixin.qq.com 文章链接后再分析。',
      );
    }

    const cachedResult = await this.cachedWechatArticleEngagementResult(
      scope,
      keyword,
      articleUrl,
    );
    if (cachedResult) return cachedResult;

    const connection = await this.redfoxService.getEffectiveConnection(scope);
    const callLogRef: { current: RedfoxCallLog | null } = { current: null };
    const payload = await this.redfoxClient.request<unknown>(
      scope,
      connection,
      {
        method: 'POST',
        path: '/story/api/gzhData/queryArticleDetail',
        body: { url: articleUrl },
        operation: 'intelligence.article_engagement.manual',
        skillCode: 'gzh-query-article',
        estimatedCostPoints: WECHAT_ARTICLE_ENGAGEMENT_ESTIMATED_COST_POINTS,
        requireApiKey: true,
        onCallLogRecorded: (log) => {
          callLogRef.current = log;
        },
      },
    );
    this.assertRedfoxSkillSuccess(payload, '公众号文章互动分析');

    const rawItems = this.formatWechatArticleEngagementItems(
      payload,
      articleUrl,
      keyword,
    );
    if (!rawItems.length) {
      return {
        keyword,
        platform: 'gongzhonghao',
        target: 'engagement',
        received: 0,
        normalized: 0,
        created: 0,
        updated: 0,
        endpoints: [
          {
            platform: 'gongzhonghao',
            platformLabel: '公众号',
            endpoint: '/story/api/gzhData/queryArticleDetail',
            status: 'empty' as const,
            callLogId: callLogRef.current?.id || null,
            estimatedCostPoints:
              WECHAT_ARTICLE_ENGAGEMENT_ESTIMATED_COST_POINTS,
            costPoints: this.redfoxCallLogCostPoints(callLogRef.current),
            received: 0,
            normalized: 0,
            created: 0,
            updated: 0,
            source: 'official_interface',
            message: '公众号文章详情接口没有返回可入库文章指标。',
          },
        ],
        items: [],
      };
    }

    const ingestResult =
      await this.intelligenceService.ingestRedfoxItemsForScope(scope, {
        platform: 'gongzhonghao',
        type: 'article_engagement',
        redfoxSkillCode: 'gzh-query-article',
        redfoxCallLogId: callLogRef.current?.id,
        status: 'new',
        rawItems,
      });

    return {
      keyword,
      platform: 'gongzhonghao',
      target: 'engagement',
      received: rawItems.length,
      normalized: ingestResult.normalized,
      created: ingestResult.created,
      updated: ingestResult.updated,
      endpoints: [
        {
          platform: 'gongzhonghao',
          platformLabel: '公众号',
          endpoint: '/story/api/gzhData/queryArticleDetail',
          status: 'success' as const,
          callLogId: callLogRef.current?.id || null,
          estimatedCostPoints: WECHAT_ARTICLE_ENGAGEMENT_ESTIMATED_COST_POINTS,
          costPoints: this.redfoxCallLogCostPoints(callLogRef.current),
          received: rawItems.length,
          normalized: ingestResult.normalized,
          created: ingestResult.created,
          updated: ingestResult.updated,
          source: 'official_interface',
        },
      ],
      items: ingestResult.items,
    };
  }

  private async fetchRedfoxCommentSkillItems(
    scope: RedfoxScope,
    connection: RedfoxEffectiveConnection,
    config: RedfoxCommentSkillConfig,
    workId: string,
    keyword: string,
    dto: RunIntelligenceSearchDto,
    onCallLogRecorded: (log: RedfoxCallLog) => void,
  ) {
    if (config.platform === 'douyin') {
      const payload = await this.redfoxClient.request<unknown>(
        scope,
        connection,
        {
          method: 'POST',
          path: '/story/api/dy/work/comment',
          body: {
            videoId: workId,
            offset: String(this.commentOffset(dto)),
            source: 'KAYPAL AI RedFox 抖音评论分析',
          },
          operation: 'intelligence.comment.skill',
          skillCode: config.skillCode,
          estimatedCostPoints: this.commentEstimatedCostPoints(config.platform),
          requireApiKey: true,
          onCallLogRecorded,
        },
      );
      this.assertRedfoxSkillSuccess(payload, config.skillName);
      return this.formatRedfoxCommentItems(config, payload, workId, keyword);
    }

    if (config.platform === 'xiaohongshu') {
      const payload = await this.redfoxClient.request<unknown>(
        scope,
        connection,
        {
          method: 'POST',
          path: '/story/api/xhs/ability/commentList',
          body: {
            noteId: workId,
            cursor: dto.cursor || '',
            sort: '',
            source: 'KAYPAL AI RedFox 小红书评论分析',
          },
          operation: 'intelligence.comment.skill',
          skillCode: config.skillCode,
          estimatedCostPoints: this.commentEstimatedCostPoints(config.platform),
          requireApiKey: true,
          onCallLogRecorded,
        },
      );
      this.assertRedfoxSkillSuccess(payload, config.skillName);
      return this.formatRedfoxCommentItems(config, payload, workId, keyword);
    }

    const submitPayload = await this.redfoxClient.request<unknown>(
      scope,
      connection,
      {
        method: 'POST',
        path: '/story/api/bili/commentSubmit',
        body: {
          opusId: workId,
          sortType: '1',
          dataNum: String(Math.max(1, Math.min(50, Number(dto.limit || 20)))),
          offset: String(this.commentOffset(dto)),
          source: 'KAYPAL AI RedFox B站评论分析',
        },
        operation: 'intelligence.comment.skill',
        skillCode: config.skillCode,
        estimatedCostPoints: this.commentEstimatedCostPoints(config.platform),
        requireApiKey: true,
        onCallLogRecorded,
      },
    );
    this.assertRedfoxSkillSuccess(submitPayload, config.skillName);
    const taskId = this.firstText(
      [this.redfoxSkillData(submitPayload)],
      ['taskId', 'task_id', 'id'],
    );
    if (!taskId) {
      throw new BadRequestException(
        'B站评论分析没有返回任务 ID，无法读取结果。',
      );
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const resultPayload = await this.redfoxClient.request<unknown>(
        scope,
        connection,
        {
          method: 'POST',
          path: '/story/api/bili/commentResult',
          body: {
            taskId,
            source: 'KAYPAL AI RedFox B站评论分析',
          },
          bodyEncoding: 'form',
          operation: 'intelligence.comment.skill',
          skillCode: config.skillCode,
          estimatedCostPoints: 0,
          requireApiKey: true,
          onCallLogRecorded,
        },
      );
      this.assertRedfoxSkillSuccess(resultPayload, config.skillName);
      const data = this.redfoxSkillData(resultPayload);
      const status = this.firstText([data], ['status', 'state']).toLowerCase();
      const items = this.formatRedfoxCommentItems(
        config,
        resultPayload,
        workId,
        keyword,
      );
      if (items.length || ['success', 'finished', 'done'].includes(status)) {
        return items;
      }
      await this.sleep(2000);
    }

    throw new BadRequestException('B站评论分析任务超时，请稍后重试。');
  }

  private resolveCommentSkillPlatform(
    platformRaw: string | undefined,
    sourceText: string,
  ): RedfoxCommentSkillPlatform {
    const platform = platformRaw?.trim();
    if (
      platform === 'douyin' ||
      platform === 'xiaohongshu' ||
      platform === 'bilibili'
    ) {
      return platform;
    }
    if (platform && platform !== 'all') {
      throw new BadRequestException(
        '评论分析当前只支持抖音、小红书和 B站。公众号请选择“文章互动”，系统会读取文章阅读、点赞、评论数、分享等真实指标。',
      );
    }

    const text = sourceText.toLowerCase();
    if (text.includes('xiaohongshu.com') || text.includes('xhslink.com')) {
      return 'xiaohongshu';
    }
    if (text.includes('bilibili.com') || /\bBV[a-z0-9]+\b/i.test(sourceText)) {
      return 'bilibili';
    }
    if (text.includes('douyin.com') || /^\d{8,}$/.test(sourceText.trim())) {
      return 'douyin';
    }
    throw new BadRequestException(
      '无法从输入识别评论平台。请先选择抖音、小红书或 B站，并粘贴对应作品链接或作品 ID。',
    );
  }

  private extractWechatArticleUrl(sourceText: string) {
    const text = sourceText.trim();
    if (!text) return '';
    const url = text.match(/https?:\/\/[^\s]+/)?.[0] || '';
    if (!url) return '';
    try {
      const parsed = new URL(url);
      if (
        parsed.hostname.includes('mp.weixin.qq.com') ||
        parsed.hostname.includes('weixin.qq.com')
      ) {
        return this.normalizeWechatArticleUrlForRequest(url);
      }
    } catch {
      return '';
    }
    return '';
  }

  private async cachedWechatArticleEngagementResult(
    scope: RedfoxScope,
    keyword: string,
    articleUrl: string,
  ) {
    const sourceUrlCandidates = this.wechatArticleUrlCandidates(articleUrl);
    const cachedItem = await this.prisma.intelligenceItem.findFirst({
      where: {
        AND: [
          this.intelligenceItemScopeWhere(scope),
          {
            platform: 'gongzhonghao',
            type: 'article_engagement',
          },
          this.wechatArticleSourceUrlWhere(articleUrl, sourceUrlCandidates),
        ],
      },
      include: { redfoxSkill: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (cachedItem) {
      return {
        keyword,
        platform: 'gongzhonghao',
        target: 'engagement',
        received: 1,
        normalized: 1,
        created: 0,
        updated: 0,
        endpoints: [
          {
            platform: 'gongzhonghao',
            platformLabel: '公众号',
            endpoint: '/story/api/gzhData/queryArticleDetail',
            status: 'cached' as const,
            callLogId: cachedItem.redfoxCallLogId || null,
            estimatedCostPoints: 0,
            costPoints: 0,
            received: 1,
            normalized: 1,
            created: 0,
            updated: 0,
            source: 'local_cache',
            message: '已复用这篇文章的历史互动指标，本次未再次扣积分。',
          },
        ],
        items: [this.cachedItemView(cachedItem)],
      };
    }

    const previousEmptyLog = await this.prisma.redfoxCallLog.findFirst({
      where: {
        AND: [
          this.redfoxCallLogScopeWhere(scope),
          {
            requestHash: this.redfoxRequestHash(
              'POST',
              '/story/api/gzhData/queryArticleDetail',
              undefined,
              { url: articleUrl },
            ),
            skillCode: 'gzh-query-article',
            status: 'success',
            httpStatus: 200,
            intelligenceItems: { none: {} },
          },
        ],
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!previousEmptyLog) return null;
    return {
      keyword,
      platform: 'gongzhonghao',
      target: 'engagement',
      received: 0,
      normalized: 0,
      created: 0,
      updated: 0,
      endpoints: [
        {
          platform: 'gongzhonghao',
          platformLabel: '公众号',
          endpoint: '/story/api/gzhData/queryArticleDetail',
          status: 'empty' as const,
          callLogId: previousEmptyLog.id,
          estimatedCostPoints: 0,
          costPoints: 0,
          received: 0,
          normalized: 0,
          created: 0,
          updated: 0,
          source: 'local_cache',
          message:
            '这篇文章此前没有返回可用互动指标，本次未再次调用外部数据，也没有扣积分。',
        },
      ],
      items: [],
    };
  }

  private wechatArticleUrlCandidates(articleUrl: string) {
    const candidates = new Set([articleUrl]);
    try {
      const parsed = new URL(articleUrl);
      parsed.hash = '';
      candidates.add(parsed.toString());
    } catch {
      // Keep the original URL only.
    }
    return Array.from(candidates);
  }

  private normalizeWechatArticleUrlForRequest(articleUrl: string) {
    try {
      const parsed = new URL(articleUrl.trim());
      parsed.hash = '';
      parsed.searchParams.sort();
      if (this.isWechatShortArticlePath(parsed.pathname)) {
        parsed.search = '';
      }
      return parsed.toString();
    } catch {
      return articleUrl.trim();
    }
  }

  private wechatArticleSourceUrlWhere(
    articleUrl: string,
    sourceUrlCandidates: string[],
  ): Prisma.IntelligenceItemWhereInput {
    const matches: Prisma.IntelligenceItemWhereInput[] = [
      { sourceUrl: { in: sourceUrlCandidates } },
    ];

    try {
      const parsed = new URL(articleUrl);
      if (this.isWechatShortArticlePath(parsed.pathname)) {
        matches.push({
          sourceUrl: { contains: parsed.pathname.replace(/\/$/, '') },
        });
      }

      const stableQueryMatches = this.wechatStableQueryMatchWhere(parsed);
      if (stableQueryMatches) matches.push(stableQueryMatches);
    } catch {
      // Fall back to exact candidates only.
    }

    return { OR: matches };
  }

  private isWechatShortArticlePath(pathname: string) {
    return /^\/s\/[^/]+\/?$/.test(pathname);
  }

  private wechatStableQueryMatchWhere(
    parsed: URL,
  ): Prisma.IntelligenceItemWhereInput | null {
    const keys = ['mid', 'idx', 'sn'];
    const filters: Prisma.IntelligenceItemWhereInput[] = [];
    for (const key of keys) {
      const value = parsed.searchParams.get(key)?.trim();
      if (!value) continue;
      const encoded = encodeURIComponent(value);
      const variants = new Set([`${key}=${value}`, `${key}=${encoded}`]);
      filters.push({
        OR: Array.from(variants).map((fragment) => ({
          sourceUrl: { contains: fragment },
        })),
      });
    }

    if (filters.length < 2) return null;
    return { AND: filters };
  }

  private cachedItemView(item: CachedIntelligenceItem) {
    return {
      id: item.id,
      tenantId: item.tenantId,
      userId: item.userId,
      platform: item.platform,
      type: item.type,
      title: item.title,
      content: item.content,
      summary: item.summary,
      sourceUrl: item.sourceUrl,
      sourceExternalId: item.sourceExternalId,
      author: item.author,
      authorUrl: item.authorUrl,
      publishDate: item.publishDate?.toISOString() || null,
      metrics: item.metrics,
      keywords: this.asStringArray(item.keywords),
      raw: item.raw,
      status: item.status,
      dedupeKey: item.dedupeKey,
      redfoxSkill: item.redfoxSkill
        ? {
            id: item.redfoxSkill.id,
            code: item.redfoxSkill.code,
            skillNo: item.redfoxSkill.skillNo,
            name: item.redfoxSkill.name,
            platform: item.redfoxSkill.platform,
            category: item.redfoxSkill.category,
          }
        : null,
      redfoxCallLogId: item.redfoxCallLogId,
      materialId: item.materialId,
      topicId: item.topicId,
      growthLeadId: item.growthLeadId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private redfoxCommentSkillConfig(
    platform: RedfoxCommentSkillPlatform,
  ): RedfoxCommentSkillConfig {
    if (platform === 'xiaohongshu') {
      return {
        platform,
        platformLabel: '小红书',
        skillCode: 'xiaohongshu-comment',
        skillName: '小红书评论分析',
      };
    }
    if (platform === 'bilibili') {
      return {
        platform,
        platformLabel: 'B站',
        skillCode: 'bilibili-comment',
        skillName: 'B站评论分析',
      };
    }
    return {
      platform,
      platformLabel: '抖音',
      skillCode: 'douyin-comment',
      skillName: '抖音评论分析',
    };
  }

  private extractCommentWorkId(
    platform: RedfoxCommentSkillPlatform,
    sourceText: string,
  ) {
    const text = sourceText.trim();
    if (!text) return '';
    if (platform === 'bilibili') {
      return text.match(/\b(BV[a-zA-Z0-9]+)\b/)?.[1] || '';
    }
    if (platform === 'xiaohongshu') {
      return (
        text.match(/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/)?.[1] ||
        text.match(/\b([0-9a-fA-F]{16,32})\b/)?.[1] ||
        ''
      );
    }
    return (
      text.match(/(?:video|note)\/(\d{8,})/)?.[1] ||
      text.match(/\b(\d{8,})\b/)?.[1] ||
      ''
    );
  }

  private commentOffset(dto: RunIntelligenceSearchDto) {
    const page = Math.max(1, Number(dto.page || 1));
    return Math.max(0, page - 1);
  }

  private assertRedfoxSkillSuccess(payload: unknown, skillName: string) {
    const record = this.readJsonRecord(payload);
    const code = record.code;
    if (code === undefined || code === null || safeText(code) === '2000')
      return;
    const message =
      this.firstText([record], ['msg', 'message', 'error', 'errorMessage']) ||
      'RedFox 返回非成功状态';
    throw new BadRequestException(`${skillName} 执行失败：${message}`);
  }

  private redfoxSkillData(payload: unknown) {
    const record = this.readJsonRecord(payload);
    return this.isRecord(record.data) ? record.data : record;
  }

  private formatRedfoxCommentItems(
    config: RedfoxCommentSkillConfig,
    payload: unknown,
    workId: string,
    keyword: string,
  ) {
    const data = this.redfoxSkillData(payload);
    return this.extractRedfoxCommentArray(data).map((comment, index) =>
      this.redfoxCommentToRawItem(config, comment, workId, keyword, index),
    );
  }

  private formatWechatArticleEngagementItems(
    payload: unknown,
    articleUrl: string,
    keyword: string,
  ) {
    const data = this.redfoxSkillData(payload);
    if (!Object.keys(data).length) return [];

    const readCount = this.firstNumber([data], ['readCount']);
    const watchCount = this.firstNumber([data], ['watchCount']);
    const likeCount = this.firstNumber([data], ['likeCount']);
    const commentCount = this.firstNumber([data], ['commentCount']);
    const collectCount = this.firstNumber([data], ['collectCount']);
    const shareCount = this.firstNumber([data], ['shareCount']);
    const rewardCount = this.firstNumber([data], ['rewardCount']);
    const title = this.firstText([data], ['title', 'workTitle']);
    const content = this.firstText([data], ['content', 'text']);
    const summary = this.firstText([data], ['summary', 'memo']);
    const author = this.firstText(
      [data],
      ['author', 'accountName', 'accountNickname', 'originalAuthor'],
    );
    const publishTime = this.firstText(
      [data],
      ['publishTime', 'publishDate', 'publishedAt'],
    );
    const workUuid = this.firstText([data], ['workUuid', 'id', 'externalId']);
    const hasInteractionMetric = [
      readCount,
      watchCount,
      likeCount,
      commentCount,
      collectCount,
      shareCount,
      rewardCount,
    ].some((value) => value > 0);
    const hasArticleIdentity = Boolean(
      title || content || summary || author || publishTime || workUuid,
    );
    if (!hasInteractionMetric && !hasArticleIdentity) return [];

    const summaryParts = [
      readCount ? `阅读 ${readCount}` : '',
      watchCount ? `在看 ${watchCount}` : '',
      likeCount ? `点赞 ${likeCount}` : '',
      commentCount ? `评论 ${commentCount}` : '',
      collectCount ? `收藏 ${collectCount}` : '',
      shareCount ? `分享 ${shareCount}` : '',
      rewardCount ? `赞赏 ${rewardCount}` : '',
    ].filter(Boolean);

    return [
      {
        ...data,
        sourceUrl:
          this.firstText([data], ['sourceUrl', 'workUrl', 'url']) || articleUrl,
        workUrl: this.firstText([data], ['workUrl']) || articleUrl,
        url: articleUrl,
        summary:
          summary ||
          (summaryParts.length
            ? `公众号文章互动指标：${summaryParts.join('，')}`
            : '公众号文章互动指标已获取'),
        keywords: [keyword, '公众号文章互动'].filter(Boolean),
        metrics: {
          readCount,
          watchCount,
          likeCount,
          commentCount,
          collectCount,
          shareCount,
          rewardCount,
          isOriginal: data.isOriginal ?? null,
        },
        rawType: 'wechat_article_engagement',
      },
    ];
  }

  private extractRedfoxCommentArray(value: unknown) {
    const record = this.readJsonRecord(value);
    for (const key of [
      'commentList',
      'comments',
      'comment_list',
      'list',
      'items',
      'records',
      'rows',
      'data',
    ]) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        return nested.filter((item): item is Record<string, unknown> =>
          this.isRecord(item),
        );
      }
      if (this.isRecord(nested)) {
        const nestedItems = this.extractRedfoxCommentArray(nested);
        if (nestedItems.length) return nestedItems;
      }
    }
    return [];
  }

  private redfoxCommentToRawItem(
    config: RedfoxCommentSkillConfig,
    comment: Record<string, unknown>,
    workId: string,
    keyword: string,
    index: number,
  ) {
    const content = this.firstText(
      [comment],
      ['text', 'commentText', 'content', 'message'],
    );
    const author = this.firstText(
      [comment],
      ['authorName', 'userName', 'nickname', 'name'],
    );
    const commentId =
      this.firstText([comment], ['commentId', 'id', 'cid', 'rpid']) ||
      `${config.skillCode}:${workId}:${index + 1}`;
    return {
      id: commentId,
      title: `${config.platformLabel}评论 ${index + 1}`,
      content,
      summary: `${config.skillName}返回的真实评论`,
      sourceUrl: this.commentSourceUrl(config.platform, workId),
      externalId: commentId,
      platform: config.platform,
      author,
      authorUrl: this.firstText(
        [comment],
        ['authorSecUid', 'authorUid', 'userUid', 'accountId', 'commenterUid'],
      ),
      publishTime: this.firstText(
        [comment],
        ['publishTime', 'postTime', 'createTime', 'ctime'],
      ),
      keywords: [keyword, workId],
      metrics: {
        likeCount: this.firstNumber(
          [comment],
          ['likeCount', 'thumbCount', 'likeNum', 'like'],
        ),
        replyCount: this.firstNumber(
          [comment],
          ['replyCount', 'replyNum', 'reply'],
        ),
        ipLocation: this.firstText([comment], ['ipLocation', 'ipRegion']),
        isTop: comment.isTop ?? comment.isPinned ?? null,
      },
      rawType: 'redfox_comment_skill',
      redfoxSkillCode: config.skillCode,
      raw: comment,
    };
  }

  private commentSourceUrl(
    platform: RedfoxCommentSkillPlatform,
    workId: string,
  ) {
    if (platform === 'xiaohongshu') {
      return `https://www.xiaohongshu.com/explore/${workId}`;
    }
    if (platform === 'bilibili') {
      return `https://www.bilibili.com/video/${workId}`;
    }
    return `https://www.douyin.com/video/${workId}`;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private searchPlatformCodes(platform?: string) {
    const value = this.normalizeSearchPlatform(platform);
    if (value === 'all') {
      return ['douyin', 'xiaohongshu', 'bilibili', 'gongzhonghao'];
    }
    return [value];
  }

  private platformLabel(platform: string) {
    const normalized = this.normalizeSearchPlatform(platform);
    if (normalized === 'douyin') return '抖音';
    if (normalized === 'xiaohongshu') return '小红书';
    if (normalized === 'bilibili') return 'B站';
    if (normalized === 'gongzhonghao') return '公众号';
    return normalized;
  }

  private normalizeSearchPlatform(platform?: string) {
    const value = platform?.trim().toLowerCase().replace(/\s+/g, '') || 'all';
    const aliases: Record<string, string> = {
      全部: 'all',
      全网: 'all',
      全平台: 'all',
      所有: 'all',
      all: 'all',
      抖音: 'douyin',
      dy: 'douyin',
      douyin: 'douyin',
      小红书: 'xiaohongshu',
      小紅書: 'xiaohongshu',
      xhs: 'xiaohongshu',
      redbook: 'xiaohongshu',
      xiaohongshu: 'xiaohongshu',
      b站: 'bilibili',
      哔哩哔哩: 'bilibili',
      嗶哩嗶哩: 'bilibili',
      bili: 'bilibili',
      bilibili: 'bilibili',
      微信: 'gongzhonghao',
      公众号: 'gongzhonghao',
      微信公众号: 'gongzhonghao',
      微信公众平台: 'gongzhonghao',
      wechat: 'gongzhonghao',
      weixin: 'gongzhonghao',
      gzh: 'gongzhonghao',
      gongzhonghao: 'gongzhonghao',
    };
    return aliases[value] || value;
  }

  private searchBody(keyword: string, limit: number) {
    return {
      keyword,
      query: keyword,
      q: keyword,
      page: 1,
      pageNo: 1,
      pageNum: 1,
      pageSize: limit,
      limit,
    };
  }

  private async executeMonitor(
    scope: RedfoxScope,
    monitor: MonitorWithSkill,
    trigger: MonitorRunTrigger,
  ): Promise<MonitorRunSuccess> {
    if (monitor.status === 'archived') {
      throw new BadRequestException('已归档监控不能执行');
    }
    if (this.runningMonitorIds.has(monitor.id)) {
      throw new BadRequestException('这条监控正在执行');
    }

    this.runningMonitorIds.add(monitor.id);
    const startedAt = new Date();
    const callLogRef: { current: RedfoxCallLog | null } = { current: null };
    try {
      const plan = this.resolveExecutionPlan(monitor);
      const connection = await this.redfoxService.getEffectiveConnection(scope);
      const payload = await this.redfoxClient.request<unknown>(
        scope,
        connection,
        {
          method: plan.method,
          path: plan.path,
          query: plan.query,
          body: plan.body,
          operation: `intelligence.monitor.${trigger}`,
          skillCode: monitor.skillInstall?.skill.code || null,
          estimatedCostPoints: plan.estimatedCostPoints,
          requireApiKey: true,
          onCallLogRecorded: (log) => {
            callLogRef.current = log;
          },
        },
      );
      const rawItems = this.extractRawItems(payload);
      const ingestResult =
        await this.intelligenceService.ingestRedfoxItemsForScope(scope, {
          platform:
            monitor.platform ||
            monitor.skillInstall?.skill.platform ||
            'redfox',
          type: monitor.type,
          redfoxSkillId: monitor.skillInstall?.skill.id,
          redfoxSkillCode: monitor.skillInstall?.skill.code,
          redfoxCallLogId: callLogRef.current?.id,
          status: 'new',
          rawItems,
        });
      const nextRunAt = this.nextRunAt(monitor.schedule, startedAt);
      await this.prisma.intelligenceMonitor.update({
        where: { id: monitor.id },
        data: {
          status: 'active',
          lastRunAt: startedAt,
          nextRunAt,
          lastError: null,
        },
      });
      if (monitor.skillInstallId) {
        await this.prisma.redfoxSkillInstall.update({
          where: { id: monitor.skillInstallId },
          data: { lastUsedAt: startedAt },
        });
      }

      return {
        monitorId: monitor.id,
        status: 'success',
        trigger,
        callLogId: callLogRef.current?.id || null,
        received: ingestResult.received,
        normalized: ingestResult.normalized,
        created: ingestResult.created,
        updated: ingestResult.updated,
        lastRunAt: startedAt.toISOString(),
        nextRunAt: nextRunAt.toISOString(),
      };
    } catch (error) {
      const message = this.errorMessage(error);
      const nextRunAt = this.nextRunAt(monitor.schedule, startedAt);
      await this.prisma.intelligenceMonitor.update({
        where: { id: monitor.id },
        data: {
          status: 'error',
          lastRunAt: startedAt,
          nextRunAt,
          lastError: message,
        },
      });
      throw error;
    } finally {
      this.runningMonitorIds.delete(monitor.id);
    }
  }

  private async findScopedMonitor(scope: RedfoxScope, monitorId: string) {
    const monitor = await this.prisma.intelligenceMonitor.findFirst({
      where: {
        id: monitorId,
        AND: [this.monitorScopeWhere(scope)],
      },
      include: this.monitorInclude(),
    });
    if (!monitor) {
      throw new BadRequestException('监控配置不存在或无权执行');
    }
    return monitor;
  }

  private async findDueMonitors(scope: RedfoxScope | null, limit?: number) {
    const now = new Date();
    const where: Prisma.IntelligenceMonitorWhereInput = {
      status: 'active',
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      ...(scope ? { AND: [this.monitorScopeWhere(scope)] } : {}),
    };
    return this.prisma.intelligenceMonitor.findMany({
      where,
      include: this.monitorInclude(),
      orderBy: [{ nextRunAt: 'asc' }, { updatedAt: 'asc' }],
      take: Math.max(1, Math.min(50, Number(limit || 5))),
    });
  }

  private resolveExecutionPlan(
    monitor: MonitorWithSkill,
  ): MonitorExecutionPlan {
    const monitorConfig = this.readJsonRecord(monitor.config);
    const installConfig = this.readJsonRecord(monitor.skillInstall?.config);
    const skill = monitor.skillInstall?.skill || null;
    const skillRaw = this.readJsonRecord(skill?.raw);
    const skillInputSchema = this.readJsonRecord(skill?.inputSchema);

    const candidates = [
      monitorConfig,
      installConfig,
      skillRaw,
      this.readJsonRecord(skillRaw.api),
      this.readJsonRecord(skillRaw.request),
      this.readJsonRecord(skillRaw.interface),
      skillInputSchema,
    ];
    const path = this.firstText(candidates, [
      'endpoint',
      'path',
      'apiPath',
      'api_path',
      'url',
    ]);
    if (!path) {
      throw new BadRequestException(
        '监控未绑定可执行 RedFox 正式平台接口，请先同步官方接口目录并绑定抖音/小红书/公众号等明确 endpoint',
      );
    }
    const normalizedPath = this.normalizePath(path);
    if (this.redfoxInterfaces.isBlockedMonitorPath(normalizedPath)) {
      throw new BadRequestException(
        '这个 RedFox endpoint 只是官网目录/首页接口，不能作为正式采集入口。请改用搜账号、搜作品、账号详情或作品详情接口。',
      );
    }

    const method = this.normalizeMethod(
      this.firstText(candidates, ['method', 'httpMethod', 'http_method']),
    );
    const baseInput = this.monitorInput(monitor);
    const query = {
      ...baseInput,
      ...this.readJsonRecord(monitorConfig.query),
      ...this.readJsonRecord(monitorConfig.params),
      ...this.readJsonRecord(installConfig.query),
      ...this.readJsonRecord(installConfig.params),
    };
    const body = {
      ...baseInput,
      ...this.readJsonRecord(monitorConfig.body),
      ...this.readJsonRecord(installConfig.body),
    };
    const estimatedCostPoints =
      this.firstNumber(candidates, [
        'estimatedCostPoints',
        'estimated_cost_points',
        'costPoints',
        'cost_points',
      ]) || 1;

    return {
      path: normalizedPath,
      method,
      query: method === 'GET' ? this.cleanObject(query) : undefined,
      body: method === 'GET' ? undefined : this.cleanObject(body),
      estimatedCostPoints,
    };
  }

  private monitorInput(monitor: MonitorWithSkill) {
    return this.cleanObject({
      keyword: monitor.keyword,
      query: monitor.keyword,
      q: monitor.keyword,
      accountExternalId: monitor.accountExternalId,
      account: monitor.accountExternalId,
      industry: monitor.industry,
      platform: monitor.platform || monitor.skillInstall?.skill.platform,
      type: monitor.type,
      limit: this.readJsonRecord(monitor.config).limit || 20,
    });
  }

  private extractRawItems(payload: unknown): Record<string, unknown>[] {
    const candidates = [
      payload,
      this.pick(payload, 'data'),
      this.pick(this.pick(payload, 'data'), 'data'),
      this.pick(payload, 'result'),
      this.pick(payload, 'payload'),
    ];

    for (const candidate of candidates) {
      const items = this.extractArray(candidate);
      if (items.length) return items;
    }

    const record = this.readJsonRecord(payload);
    return Object.keys(record).length ? [record] : [];
  }

  private extractArray(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        this.isRecord(item),
      );
    }
    const record = this.readJsonRecord(value);
    for (const key of [
      'items',
      'list',
      'records',
      'rows',
      'results',
      'data',
      'workList',
      'accountList',
      'articleList',
      'noteList',
      'videoList',
      'userList',
      'commentList',
      'comments',
      'works',
      'accounts',
      'hot',
      'hots',
      'hotList',
    ]) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        return nested.filter((item): item is Record<string, unknown> =>
          this.isRecord(item),
        );
      }
      if (this.isRecord(nested)) {
        const nestedItems = this.extractArray(nested);
        if (nestedItems.length) return nestedItems;
      }
    }
    return [];
  }

  private nextRunAt(schedule: string, from: Date) {
    const trimmed = schedule.trim();
    const next = new Date(from);
    const everyMinutes = trimmed.match(/^\*\/(\d+) \* \* \* \*$/);
    if (everyMinutes) {
      next.setMinutes(next.getMinutes() + Number(everyMinutes[1]));
      return next;
    }

    const everyHours = trimmed.match(/^0 \*\/(\d+) \* \* \*$/);
    if (everyHours) {
      next.setHours(next.getHours() + Number(everyHours[1]));
      return next;
    }

    const dailyAtHour = trimmed.match(/^0 (\d{1,2}) \* \* \*$/);
    if (dailyAtHour) {
      const hour = Math.max(0, Math.min(23, Number(dailyAtHour[1])));
      next.setHours(hour, 0, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next;
    }

    if (trimmed === '@hourly') {
      next.setHours(next.getHours() + 1, 0, 0, 0);
      return next;
    }
    if (trimmed === '@daily') {
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      return next;
    }

    next.setHours(next.getHours() + 6);
    return next;
  }

  private monitorInclude() {
    return {
      skillInstall: {
        include: {
          skill: true,
        },
      },
    } satisfies Prisma.IntelligenceMonitorInclude;
  }

  private scopeFromMonitor(monitor: MonitorWithSkill): RedfoxScope {
    return {
      key: `${monitor.tenantId || monitor.userId}:${monitor.userId}`,
      tenantId: monitor.tenantId || undefined,
      userId: monitor.userId,
    };
  }

  private intelligenceItemScopeWhere(
    scope: RedfoxScope,
  ): Prisma.IntelligenceItemWhereInput {
    if (scope.tenantId) {
      return {
        OR: [
          { tenantId: scope.tenantId },
          { userId: scope.userId, tenantId: null },
        ],
      };
    }
    return { userId: scope.userId };
  }

  private redfoxCallLogScopeWhere(
    scope: RedfoxScope,
  ): Prisma.RedfoxCallLogWhereInput {
    if (scope.tenantId) {
      return {
        OR: [
          { tenantId: scope.tenantId },
          { userId: scope.userId, tenantId: null },
        ],
      };
    }
    return { userId: scope.userId };
  }

  private monitorScopeWhere(
    scope: RedfoxScope,
  ): Prisma.IntelligenceMonitorWhereInput {
    if (scope.tenantId) {
      return {
        OR: [
          { tenantId: scope.tenantId },
          { userId: scope.userId, tenantId: null },
        ],
      };
    }
    return { userId: scope.userId };
  }

  private normalizeMethod(value?: string) {
    const method = value?.trim().toUpperCase();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method || '')) {
      return method as MonitorExecutionPlan['method'];
    }
    return 'GET';
  }

  private normalizePath(path: string) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        const parsed = new URL(path);
        return `${parsed.pathname}${parsed.search}`;
      } catch {
        return path;
      }
    }
    return path.startsWith('/') ? path : `/${path}`;
  }

  private firstText(records: Record<string, unknown>[], keys: string[]) {
    for (const record of records) {
      for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
    return '';
  }

  private firstNumber(records: Record<string, unknown>[], keys: string[]) {
    for (const record of records) {
      for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }
      }
    }
    return 0;
  }

  private redfoxCallLogCostPoints(log?: RedfoxCallLog | null) {
    const costPoints = Number(log?.costPoints);
    return Number.isFinite(costPoints) && costPoints > 0
      ? Math.round(costPoints)
      : 0;
  }

  private redfoxCallLogsCostPoints(logs: RedfoxCallLog[]) {
    return logs.reduce(
      (sum, log) => sum + this.redfoxCallLogCostPoints(log),
      0,
    );
  }

  private commentEstimatedCostPoints(platform: RedfoxCommentSkillPlatform) {
    if (platform === 'xiaohongshu') return 27;
    return 80;
  }

  private cleanObject(record: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(record).filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      ),
    );
  }

  private readJsonRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private redfoxRequestHash(
    method: string,
    path: string,
    query?: Record<string, unknown>,
    body?: unknown,
  ) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          method,
          path,
          query: this.cleanRedfoxQuery(query),
          body: this.sanitizeRedfoxBody(body),
        }),
      )
      .digest('hex');
  }

  private sanitizeRedfoxBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    if (Array.isArray(body)) {
      return body.map((item) => this.sanitizeRedfoxBody(item));
    }
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([key, value]) => [
        key,
        /api[-_]?key|token|secret|password/i.test(key)
          ? '[redacted]'
          : this.sanitizeRedfoxBody(value),
      ]),
    );
  }

  private cleanRedfoxQuery(query?: Record<string, unknown>) {
    if (!query) return undefined;
    return Object.fromEntries(
      Object.entries(query).filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      ),
    );
  }

  private asStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
  }

  private pick(value: unknown, key: string) {
    return this.isRecord(value) ? value[key] : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private errorMessage(error: unknown) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        if (Array.isArray(message)) {
          return message
            .filter((item): item is string => typeof item === 'string')
            .join('; ');
        }
        if (typeof message === 'string') return message;
      }
    }
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '监控执行失败';
  }

  private publicDataServiceError(error: unknown) {
    const message = this.errorMessage(error);
    const code = this.publicDataServiceErrorCode(error);
    if (
      code === 'INSUFFICIENT_CREDITS' ||
      /积分余额不足|积分不足|余额不足/i.test(message)
    ) {
      return '积分余额不足，请充值或调整任务消耗后再试。';
    }
    if (code === 'REDFOX_TIMEOUT' || /请求超时|timeout/i.test(message)) {
      return '数据服务响应超时，请稍后重试。';
    }
    if (code === 'REDFOX_RATE_LIMITED') {
      return '数据服务调用频率受限，请稍后重试。';
    }
    if (
      code === 'REDFOX_UNAUTHORIZED' ||
      code === 'REDFOX_FORBIDDEN' ||
      code === 'REDFOX_API_KEY_REQUIRED' ||
      /api key|key required|unauthorized|forbidden/i.test(message)
    ) {
      return '数据服务授权不可用，请联系管理员检查连接配置。';
    }
    if (
      code === 'REDFOX_NETWORK_ERROR' ||
      code === 'REDFOX_UPSTREAM_UNAVAILABLE'
    ) {
      return '数据服务暂时不可达，请稍后重试。';
    }
    if (code === 'REDFOX_UPSTREAM_BAD_REQUEST') {
      return '数据服务未接受本次查询条件，请调整后重试。';
    }
    return '数据服务请求失败，请稍后重试。';
  }

  private publicDataServiceErrorCode(error: unknown) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (response && typeof response === 'object' && 'code' in response) {
        const code = (response as { code?: unknown }).code;
        if (typeof code === 'string' && code.trim()) return code.trim();
      }
    }
    return 'DATA_SERVICE_ERROR';
  }

  private publicDataServiceHttpStatus(error: unknown) {
    return error instanceof HttpException
      ? error.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private daemonTickMs() {
    return Math.max(
      30_000,
      Number(this.config.get<string>('INTELLIGENCE_MONITOR_TICK_MS') || 60_000),
    );
  }

  private daemonBatchLimit() {
    return Math.max(
      1,
      Math.min(
        20,
        Number(
          this.config.get<string>('INTELLIGENCE_MONITOR_BATCH_LIMIT') || 5,
        ),
      ),
    );
  }

  private isDaemonArmed() {
    return (
      this.config.get<string>('INTELLIGENCE_MONITOR_DAEMON') === 'true' &&
      this.config.get<string>('INTELLIGENCE_MONITOR_DAEMON_ARMED') === 'true'
    );
  }
}
