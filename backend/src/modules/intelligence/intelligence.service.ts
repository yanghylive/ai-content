import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RedfoxService } from '../redfox/redfox.service';
import type { RedfoxScope } from '../redfox/redfox.types';
import { CreateIntelligenceReportDto } from './dto/create-intelligence-report.dto';
import { CreateIntelligenceMonitorDto } from './dto/create-intelligence-monitor.dto';
import { DispatchIntelligenceItemDto } from './dto/dispatch-intelligence-item.dto';
import { GenerateIntelligenceTopicDto } from './dto/generate-intelligence-topic.dto';
import { IngestRedfoxItemsDto } from './dto/ingest-redfox-items.dto';
import { ImportIntelligenceMaterialDto } from './dto/import-intelligence-material.dto';
import {
  ProcessIntelligenceDispatchRecordDto,
  type IntelligenceDispatchRecordAction,
} from './dto/process-intelligence-dispatch-record.dto';
import {
  ProcessIntelligenceReportDto,
  type IntelligenceReportAction,
} from './dto/process-intelligence-report.dto';
import { QueryIntelligenceDispatchRecordsDto } from './dto/query-intelligence-dispatch-records.dto';
import { QueryIntelligenceItemsDto } from './dto/query-intelligence-items.dto';
import { QueryIntelligenceMonitorsDto } from './dto/query-intelligence-monitors.dto';
import { QueryIntelligenceOverviewDto } from './dto/query-intelligence-overview.dto';
import { QueryIntelligenceReportsDto } from './dto/query-intelligence-reports.dto';
import { UpdateIntelligenceMonitorDto } from './dto/update-intelligence-monitor.dto';
import {
  IntelligenceNormalizerService,
  NormalizedIntelligenceItem,
  NormalizeRedfoxPayloadInput,
} from './intelligence-normalizer.service';
import { IntelligenceImportService } from './intelligence-import.service';

type IntelligenceActor =
  | Pick<AuthenticatedUser, 'id' | 'kaypalUserId' | 'kaypalRole' | 'role'>
  | undefined
  | null;

type IntelligenceItemRecord = Prisma.IntelligenceItemGetPayload<{
  include: {
    redfoxSkill: true;
    redfoxCallLog: true;
  };
}>;

type DispatchKind =
  | 'risk_review'
  | 'rule_seed'
  | 'benchmark_account'
  | 'comment_insight'
  | 'manual_queue';

type DispatchRecordsKind = 'risks' | 'rules' | 'accounts' | 'leads';

type CommentInsightWithItem = Prisma.CommentInsightGetPayload<{
  include: { intelligenceItem: true };
}>;

type IntelligenceReportRecord = Prisma.IntelligenceReportGetPayload<object>;

@Injectable()
export class IntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redfoxService: RedfoxService,
    private readonly importService: IntelligenceImportService,
    private readonly normalizer: IntelligenceNormalizerService,
  ) {}

  async getOverview(
    actor: IntelligenceActor,
    query: QueryIntelligenceOverviewDto = {},
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const limit = Math.max(1, Math.min(50, Number(query.limit || 8)));
    const where = this.buildWhere(scope, {
      from: query.from,
      to: query.to,
      limit,
    });

    const [
      recentItems,
      totalItems,
      byStatus,
      byType,
      byPlatform,
      activeMonitors,
      monitorErrors,
      monitors,
      connection,
      skills,
      costs,
    ] = await Promise.all([
      this.prisma.intelligenceItem.findMany({
        where,
        include: this.itemInclude(),
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.intelligenceItem.count({ where }),
      this.prisma.intelligenceItem.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.intelligenceItem.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
      }),
      this.prisma.intelligenceItem.groupBy({
        by: ['platform'],
        where,
        _count: { _all: true },
      }),
      this.prisma.intelligenceMonitor.count({
        where: {
          AND: [this.monitorScopeWhere(scope), { status: 'active' }],
        },
      }),
      this.prisma.intelligenceMonitor.count({
        where: {
          AND: [
            this.monitorScopeWhere(scope),
            { status: { not: 'archived' } },
            { OR: [{ status: 'error' }, { lastError: { not: null } }] },
          ],
        },
      }),
      this.prisma.intelligenceMonitor.findMany({
        where: { AND: [this.monitorScopeWhere(scope)] },
        orderBy: [{ lastRunAt: 'desc' }, { updatedAt: 'desc' }],
        take: 6,
      }),
      this.redfoxService.getConnection(actor),
      this.redfoxService.listSkills(actor, { page: 1, limit: 6 }),
      this.redfoxService.getCostSummary(actor, {
        from: query.from,
        to: query.to,
      }),
    ]);

    return {
      range: {
        from: this.toDate(query.from)?.toISOString() || null,
        to: this.toDate(query.to)?.toISOString() || null,
      },
      metrics: {
        totalItems,
        newItems: this.pickGroupCount(byStatus, 'status', 'new'),
        importedMaterials: this.pickGroupCount(
          byStatus,
          'status',
          'imported_material',
        ),
        generatedTopics: this.pickGroupCount(
          byStatus,
          'status',
          'generated_topic',
        ),
        activeMonitors,
        monitorErrors,
      },
      byStatus: this.groupRows(byStatus, 'status'),
      byType: this.groupRows(byType, 'type'),
      byPlatform: this.groupRows(byPlatform, 'platform'),
      recentItems: recentItems.map((item) => this.toItemView(item)),
      monitors: monitors.map((monitor) => this.toMonitorView(monitor)),
      redfox: {
        connection,
        skills: {
          total: skills.total,
          enabled: skills.items.filter((skill) => skill.enabled).length,
          items: skills.items,
        },
        costs,
      },
    };
  }

  async listItems(
    actor: IntelligenceActor,
    query: QueryIntelligenceItemsDto = {},
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    const where = this.buildWhere(scope, query);
    const orderBy = this.sortOrder(query);
    const [items, total] = await Promise.all([
      this.prisma.intelligenceItem.findMany({
        where,
        include: this.itemInclude(),
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.intelligenceItem.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toItemView(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getItem(actor: IntelligenceActor, itemId: string) {
    const scope = await this.redfoxService.resolveScope(actor);
    const item = await this.findItem(scope, itemId);
    return this.toItemView(item);
  }

  async listMonitors(
    actor: IntelligenceActor,
    query: QueryIntelligenceMonitorsDto = {},
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    const where = this.buildMonitorWhere(scope, query);
    const orderBy = this.monitorSortOrder(query);
    const [monitors, total] = await Promise.all([
      this.prisma.intelligenceMonitor.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.intelligenceMonitor.count({ where }),
    ]);

    return {
      items: monitors.map((monitor) => this.toMonitorView(monitor)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async createMonitor(
    actor: IntelligenceActor,
    dto: CreateIntelligenceMonitorDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const skillInstallId = await this.resolveSkillInstallId(
      scope,
      dto.skillInstallId,
    );

    // 简单表单创建的监控常不带 endpoint（执行时会报「未绑定接口」）：
    // 按平台自动绑定默认搜索接口，让监控开箱即可执行
    const dtoConfig = dto.config || {};
    if (!skillInstallId && !dtoConfig.endpoint) {
      const endpoint = this.defaultEndpointForPlatform(dto.platform);
      if (endpoint) {
        dto.config = { ...dtoConfig, endpoint } as never;
      }
    }

    const monitor = await this.prisma.intelligenceMonitor.create({
      data: this.toUncheckedMonitorCreateData(scope, dto, skillInstallId),
    });

    return this.toMonitorView(monitor);
  }

  /** 各平台默认搜索接口（RedFox 数据接口目录实测可用） */
  private defaultEndpointForPlatform(platform?: string): string | null {
    const p = (platform || 'douyin').trim().toLowerCase();
    const map: Record<string, string> = {
      douyin: '/story/api/dy/data/searchWork',
      wechat: '/story/api/gzh/data/searchArticle',
      gzh: '/story/api/gzh/data/searchArticle',
      xiaohongshu: '/story/api/xhsUser/searchArticle',
      xhs: '/story/api/xhsUser/searchArticle',
      bilibili: '/story/api/bili/data/workSearch',
      bili: '/story/api/bili/data/workSearch',
    };
    return map[p] || map.douyin;
  }

  async updateMonitor(
    actor: IntelligenceActor,
    monitorId: string,
    dto: UpdateIntelligenceMonitorDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const monitor = await this.findMonitor(scope, monitorId);
    const skillInstallId =
      dto.skillInstallId === undefined
        ? undefined
        : await this.resolveSkillInstallId(scope, dto.skillInstallId);
    const updated = await this.prisma.intelligenceMonitor.update({
      where: { id: monitor.id },
      data: this.toUncheckedMonitorUpdateData(dto, skillInstallId),
    });

    return this.toMonitorView(updated);
  }

  async archiveMonitor(actor: IntelligenceActor, monitorId: string) {
    const scope = await this.redfoxService.resolveScope(actor);
    const monitor = await this.findMonitor(scope, monitorId);
    const archived = await this.prisma.intelligenceMonitor.update({
      where: { id: monitor.id },
      data: { status: 'archived' },
    });

    return this.toMonitorView(archived);
  }

  async listDispatchRecords(
    actor: IntelligenceActor,
    kindInput: string,
    query: QueryIntelligenceDispatchRecordsDto = {},
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const kind = this.dispatchRecordsKind(kindInput);
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    const skip = (page - 1) * limit;

    if (kind === 'accounts') {
      const where = this.buildBenchmarkWhere(scope, query);
      const [records, total] = await Promise.all([
        this.prisma.benchmarkAccount.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.benchmarkAccount.count({ where }),
      ]);
      return this.paginatedDispatchRecords(
        records.map((record) => this.toBenchmarkDispatchRecord(record)),
        total,
        page,
        limit,
      );
    }

    if (kind === 'leads') {
      const where = this.buildCommentInsightWhere(scope, query);
      const [records, total] = await Promise.all([
        this.prisma.commentInsight.findMany({
          where,
          include: { intelligenceItem: true },
          orderBy: { analyzedAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.commentInsight.count({ where }),
      ]);
      return this.paginatedDispatchRecords(
        records.map((record) => this.toCommentInsightDispatchRecord(record)),
        total,
        page,
        limit,
      );
    }

    const where = this.buildComplianceDispatchWhere(scope, kind, query);
    const [records, total] = await Promise.all([
      this.prisma.complianceCheck.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.complianceCheck.count({ where }),
    ]);

    return this.paginatedDispatchRecords(
      records.map((record) => this.toComplianceDispatchRecord(record, kind)),
      total,
      page,
      limit,
    );
  }

  async processDispatchRecord(
    actor: IntelligenceActor,
    kindInput: string,
    recordId: string,
    dto: ProcessIntelligenceDispatchRecordDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const kind = this.dispatchRecordsKind(kindInput);
    this.assertDispatchActionAllowed(actor, kind, dto.action);

    if (kind === 'accounts') {
      return this.processBenchmarkDispatchRecord(scope, recordId, dto);
    }
    if (kind === 'leads') {
      return this.processCommentInsightDispatchRecord(scope, recordId, dto);
    }
    return this.processComplianceDispatchRecord(scope, kind, recordId, dto);
  }

  async listReports(
    actor: IntelligenceActor,
    query: QueryIntelligenceReportsDto = {},
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    const where = this.buildReportWhere(scope, query);
    const [records, total] = await Promise.all([
      this.prisma.intelligenceReport.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.intelligenceReport.count({ where }),
    ]);

    return this.paginatedDispatchRecords(
      records.map((record) => this.toReportView(record)),
      total,
      page,
      limit,
    );
  }

  async createReport(
    actor: IntelligenceActor,
    dto: CreateIntelligenceReportDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    this.assertReportStatusAllowed(actor, dto.status || 'draft');
    const report = await this.prisma.intelligenceReport.create({
      data: this.toUncheckedReportCreateData(scope, dto),
    });

    return this.toReportView(report);
  }

  async getReport(actor: IntelligenceActor, reportId: string) {
    const scope = await this.redfoxService.resolveScope(actor);
    const report = await this.findReport(scope, reportId);
    return this.toReportView(report);
  }

  async processReport(
    actor: IntelligenceActor,
    reportId: string,
    dto: ProcessIntelligenceReportDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const report = await this.findReport(scope, reportId);
    this.assertReportActionAllowed(actor, dto.action);
    const next = this.reportActionResult(dto.action);
    const metadata = this.asRecord(report.metadata);
    const actionLog = this.jsonRecordArray(metadata.actionLog);
    const updated = await this.prisma.intelligenceReport.update({
      where: { id: report.id },
      data: {
        status: next.status,
        metadata: this.toInputJson(
          {
            ...metadata,
            lastAction: dto.action,
            lastActionNote: dto.note || null,
            actionLog: [
              {
                action: dto.action,
                note: dto.note || null,
                actorRole: actor?.role || null,
                at: new Date().toISOString(),
              },
              ...actionLog,
            ].slice(0, 20),
          },
          null,
        ),
      },
    });

    return {
      action: dto.action,
      status: next.status,
      message: next.message,
      report: this.toReportView(updated),
    };
  }

  async importItemToMaterial(
    actor: IntelligenceActor,
    itemId: string,
    dto: ImportIntelligenceMaterialDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    return this.importService.importItemToMaterial(scope, itemId, dto);
  }

  async generateTopicFromItem(
    actor: IntelligenceActor,
    itemId: string,
    dto: GenerateIntelligenceTopicDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    return this.importService.generateTopicFromItem(scope, itemId, dto);
  }

  async dispatchItem(
    actor: IntelligenceActor,
    itemId: string,
    dto: DispatchIntelligenceItemDto,
  ) {
    const scope = await this.redfoxService.resolveScope(actor);
    const item = await this.findItem(scope, itemId);
    const kind = this.dispatchKind(dto);
    const result =
      kind === 'risk_review'
        ? await this.createRiskReviewDispatch(scope, item, dto)
        : kind === 'rule_seed'
          ? await this.createRuleSeedDispatch(scope, item, dto)
          : kind === 'benchmark_account'
            ? await this.createBenchmarkAccountDispatch(scope, item, dto)
            : kind === 'comment_insight'
              ? await this.createCommentInsightDispatch(scope, item, dto)
              : await this.createManualDispatch(scope, item, dto);

    const updated = await this.prisma.intelligenceItem.update({
      where: { id: item.id },
      data: { status: result.itemStatus },
      include: this.itemInclude(),
    });

    return {
      intelligenceItemId: item.id,
      action: kind,
      label: dto.label || dto.action,
      target: dto.target || result.target,
      href: dto.href || result.href,
      risk: this.dispatchRiskLevel(dto, item),
      status: result.status,
      recordType: result.recordType,
      recordId: result.recordId,
      message: result.message,
      item: this.toItemView(updated),
      createdAt: result.createdAt.toISOString(),
    };
  }

  async ingestRedfoxItems(actor: IntelligenceActor, dto: IngestRedfoxItemsDto) {
    const scope = await this.redfoxService.resolveScope(actor);
    return this.ingestRedfoxItemsForScope(scope, dto);
  }

  async ingestRedfoxItemsForScope(
    scope: RedfoxScope,
    dto: IngestRedfoxItemsDto,
  ) {
    const skill = await this.resolveRedfoxSkill(dto);
    const normalized = this.normalizer.normalizeRedfoxPayload({
      tenantId: scope.tenantId || null,
      userId: scope.userId,
      platform: dto.platform.trim(),
      type: dto.type.trim(),
      redfoxSkillId: skill?.id || null,
      redfoxCallLogId: dto.redfoxCallLogId?.trim() || null,
      rawItems: dto.rawItems,
    });

    const created: IntelligenceItemRecord[] = [];
    const updated: IntelligenceItemRecord[] = [];

    for (const item of normalized) {
      const saved = await this.upsertNormalizedItem(scope, item, dto.status);
      if (saved.created) {
        created.push(saved.item);
      } else {
        updated.push(saved.item);
      }
    }

    return {
      received: dto.rawItems.length,
      normalized: normalized.length,
      created: created.length,
      updated: updated.length,
      items: [...created, ...updated].map((item) => this.toItemView(item)),
    };
  }

  normalizeRedfoxPayload(input: NormalizeRedfoxPayloadInput) {
    return this.normalizer.normalizeRedfoxPayload(input);
  }

  private async createRiskReviewDispatch(
    scope: RedfoxScope,
    item: IntelligenceItemRecord,
    dto: DispatchIntelligenceItemDto,
  ) {
    const record = await this.prisma.complianceCheck.create({
      data: {
        tenantId: scope.tenantId || null,
        userId: scope.userId,
        materialId: item.materialId,
        topicId: item.topicId,
        redfoxCallLogId: item.redfoxCallLogId,
        targetType: 'intelligence_item',
        targetId: item.id,
        platform: item.platform,
        riskLevel: this.dispatchRiskLevel(dto, item),
        status: 'pending_review',
        findings: this.toInputJson(
          this.dispatchEvidence(item),
          [],
        ) as Prisma.InputJsonArray,
        suggestions: this.toInputJson(
          this.dispatchSuggestions(item, dto),
          [],
        ) as Prisma.InputJsonArray,
        raw: this.toInputJson(this.dispatchMetadata(item, dto), null),
      },
    });

    return {
      itemStatus: 'pending_compliance',
      status: 'pending_review',
      target: '风险审核',
      href: '/intelligence/risks',
      recordType: 'compliance_check',
      recordId: record.id,
      createdAt: record.createdAt,
      message: '已创建风险审核记录，等待合规负责人确认。',
    };
  }

  private async createRuleSeedDispatch(
    scope: RedfoxScope,
    item: IntelligenceItemRecord,
    dto: DispatchIntelligenceItemDto,
  ) {
    const record = await this.prisma.complianceCheck.create({
      data: {
        tenantId: scope.tenantId || null,
        userId: scope.userId,
        materialId: item.materialId,
        topicId: item.topicId,
        redfoxCallLogId: item.redfoxCallLogId,
        targetType: 'intelligence_rule_seed',
        targetId: item.id,
        platform: item.platform,
        riskLevel: this.dispatchRiskLevel(dto, item),
        status: 'rule_seeded',
        findings: this.toInputJson(
          this.dispatchEvidence(item),
          [],
        ) as Prisma.InputJsonArray,
        suggestions: this.toInputJson(
          this.dispatchSuggestions(item, dto),
          [],
        ) as Prisma.InputJsonArray,
        raw: this.toInputJson(
          {
            ...this.dispatchMetadata(item, dto),
            ruleSeed: {
              title: item.title,
              keywords: this.asStringArray(item.keywords),
              boundary: this.dispatchBoundary(item),
            },
          },
          null,
        ),
      },
    });

    return {
      itemStatus: 'rule_seeded',
      status: 'done',
      target: '情报规则',
      href: '/intelligence/rules',
      recordType: 'compliance_check',
      recordId: record.id,
      createdAt: record.createdAt,
      message: '已沉淀规则种子，后续可在情报规则中整理为正式拦截规则。',
    };
  }

  private async createBenchmarkAccountDispatch(
    scope: RedfoxScope,
    item: IntelligenceItemRecord,
    dto: DispatchIntelligenceItemDto,
  ) {
    const externalUserId =
      item.sourceExternalId ||
      this.readString(this.asRecord(item.raw), ['userId', 'uid', 'authorId']);
    const data = {
      tenantId: scope.tenantId || null,
      userId: scope.userId,
      intelligenceItemId: item.id,
      platform: item.platform,
      nickname: item.author || item.title,
      externalUserId,
      profileUrl: item.authorUrl || item.sourceUrl,
      metrics: this.toInputJson(
        this.asRecord(item.metrics),
        {},
      ) as Prisma.InputJsonObject,
      reason:
        dto.reason?.trim() || item.summary || '从情报对象派发进入对标账号池。',
      diagnosis: this.toInputJson(
        {
          source: 'intelligence-dispatch',
          evidence: this.dispatchEvidence(item),
          boundary: this.dispatchBoundary(item),
        },
        null,
      ),
      status: 'watching',
      raw: this.toInputJson(this.dispatchMetadata(item, dto), null),
    } satisfies Prisma.BenchmarkAccountUncheckedCreateInput;

    const existing = externalUserId
      ? await this.prisma.benchmarkAccount.findFirst({
          where: {
            AND: [
              this.benchmarkAccountScopeWhere(scope),
              { platform: item.platform, externalUserId },
            ],
          },
        })
      : null;
    const record = existing
      ? await this.prisma.benchmarkAccount.update({
          where: { id: existing.id },
          data: {
            intelligenceItemId: item.id,
            nickname: data.nickname,
            profileUrl: data.profileUrl,
            metrics: data.metrics,
            reason: data.reason,
            diagnosis: data.diagnosis,
            status: 'watching',
            raw: data.raw,
          },
        })
      : await this.prisma.benchmarkAccount.create({ data });

    return {
      itemStatus: 'benchmarked_account',
      status: 'done',
      target: '对标账号',
      href: '/intelligence/accounts',
      recordType: 'benchmark_account',
      recordId: record.id,
      createdAt: record.createdAt,
      message: '已进入对标账号池，可继续观察栏目、互动和评论异议。',
    };
  }

  private async createCommentInsightDispatch(
    scope: RedfoxScope,
    item: IntelligenceItemRecord,
    dto: DispatchIntelligenceItemDto,
  ) {
    const raw = this.asRecord(item.raw);
    const keywords = this.asStringArray(item.keywords);
    const evidence = this.dispatchEvidence(item);
    const record = await this.prisma.commentInsight.create({
      data: {
        tenantId: scope.tenantId || null,
        userId: scope.userId,
        intelligenceItemId: item.id,
        redfoxCallLogId: item.redfoxCallLogId,
        platform: item.platform,
        sourceUrl: item.sourceUrl,
        sourceExternalId: item.sourceExternalId,
        painPoints: this.toInputJson(
          this.uniqueStrings([
            ...this.readStringArray(raw, ['painPoints', 'pain_points']),
            ...evidence.slice(0, 3),
          ]),
          [],
        ) as Prisma.InputJsonArray,
        intentKeywords: this.toInputJson(
          this.uniqueStrings([
            ...keywords,
            ...this.readStringArray(raw, ['intentKeywords', 'intent_keywords']),
          ]),
          [],
        ) as Prisma.InputJsonArray,
        demandSignals: this.toInputJson(
          this.uniqueStrings([
            item.summary || '',
            dto.reason || '',
            ...this.readStringArray(raw, ['demandSignals', 'demand_signals']),
          ]),
          [],
        ) as Prisma.InputJsonArray,
        objections: this.toInputJson(
          this.readStringArray(raw, ['objections', 'concerns']),
          [],
        ) as Prisma.InputJsonArray,
        replySuggestions: this.toInputJson(
          [
            '仅作为人工判断输入，不自动触达用户。',
            this.dispatchBoundary(item),
          ].filter(Boolean),
          [],
        ) as Prisma.InputJsonArray,
        raw: this.toInputJson(this.dispatchMetadata(item, dto), null),
      },
    });

    return {
      itemStatus: 'comment_insight',
      status: 'done',
      target: '线索洞察',
      href: '/intelligence/leads',
      recordType: 'comment_insight',
      recordId: record.id,
      createdAt: record.createdAt,
      message: '已沉淀为线索洞察，只作为人工确认输入。',
    };
  }

  private async createManualDispatch(
    scope: RedfoxScope,
    item: IntelligenceItemRecord,
    dto: DispatchIntelligenceItemDto,
  ) {
    const record = await this.prisma.complianceCheck.create({
      data: {
        tenantId: scope.tenantId || null,
        userId: scope.userId,
        materialId: item.materialId,
        topicId: item.topicId,
        redfoxCallLogId: item.redfoxCallLogId,
        targetType: 'intelligence_dispatch',
        targetId: item.id,
        platform: item.platform,
        riskLevel: this.dispatchRiskLevel(dto, item),
        status: 'queued',
        findings: this.toInputJson(
          this.dispatchEvidence(item),
          [],
        ) as Prisma.InputJsonArray,
        suggestions: this.toInputJson(
          this.dispatchSuggestions(item, dto),
          [],
        ) as Prisma.InputJsonArray,
        raw: this.toInputJson(this.dispatchMetadata(item, dto), null),
      },
    });

    return {
      itemStatus: 'dispatch_queued',
      status: 'queued',
      target: dto.target || '人工队列',
      href: dto.href || '/intelligence/inbox',
      recordType: 'compliance_check',
      recordId: record.id,
      createdAt: record.createdAt,
      message: '已写入人工派发队列，等待目标模块继续处理。',
    };
  }

  private async upsertNormalizedItem(
    scope: RedfoxScope,
    item: NormalizedIntelligenceItem,
    status?: string,
  ) {
    const dedupeKey = this.buildDedupeKey(item);
    const existing = await this.prisma.intelligenceItem.findFirst({
      where: {
        dedupeKey,
        AND: [this.scopeWhere(scope)],
      },
      include: this.itemInclude(),
    });
    const data = this.toUncheckedItemData(scope, item, dedupeKey, status);

    if (existing) {
      const updated = await this.prisma.intelligenceItem.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: status?.trim() || existing.status,
        },
        include: this.itemInclude(),
      });
      return { created: false, item: updated };
    }

    const created = await this.prisma.intelligenceItem.create({
      data: {
        ...data,
        status: status?.trim() || 'new',
      },
      include: this.itemInclude(),
    });
    return { created: true, item: created };
  }

  private async resolveRedfoxSkill(dto: IngestRedfoxItemsDto) {
    const candidates = [dto.redfoxSkillId, dto.redfoxSkillCode]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    if (!candidates.length) return null;

    return this.prisma.redfoxSkill.findFirst({
      where: {
        OR: [
          { id: { in: candidates } },
          { code: { in: candidates } },
          { skillNo: { in: candidates } },
        ],
      },
    });
  }

  private async resolveSkillInstallId(scope: RedfoxScope, value?: string) {
    const trimmed = value?.trim();
    if (value === undefined) return undefined;
    if (!trimmed) return null;

    const install = await this.prisma.redfoxSkillInstall.findFirst({
      where: {
        AND: [
          this.skillInstallScopeWhere(scope),
          {
            OR: [
              { id: trimmed },
              { skillId: trimmed },
              {
                skill: {
                  OR: [
                    { id: trimmed },
                    { code: trimmed },
                    { skillNo: trimmed },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    if (!install) {
      throw new BadRequestException('请选择已启用的 RedFox Skill 后再绑定监控');
    }

    return install.id;
  }

  private toUncheckedItemData(
    scope: RedfoxScope,
    item: NormalizedIntelligenceItem,
    dedupeKey: string,
    status?: string,
  ): Prisma.IntelligenceItemUncheckedCreateInput {
    return {
      tenantId: scope.tenantId || null,
      userId: scope.userId,
      platform: item.platform,
      type: item.type,
      title: item.title,
      content: item.content || null,
      summary: item.summary || null,
      sourceUrl: item.sourceUrl || null,
      sourceExternalId: item.sourceExternalId || null,
      author: item.author || null,
      authorUrl: item.authorUrl || null,
      publishDate: item.publishDate || null,
      metrics: this.toInputJson(item.metrics, {}) as Prisma.InputJsonObject,
      keywords: this.toInputJson(item.keywords, []) as Prisma.InputJsonArray,
      raw: this.toInputJson(item.raw, null),
      status: status?.trim() || 'new',
      dedupeKey,
      redfoxSkillId: item.redfoxSkillId || null,
      redfoxCallLogId: item.redfoxCallLogId || null,
    };
  }

  private buildWhere(scope: RedfoxScope, query: QueryIntelligenceItemsDto) {
    const where: Prisma.IntelligenceItemWhereInput = {
      AND: [this.scopeWhere(scope)],
    };
    const and = where.AND as Prisma.IntelligenceItemWhereInput[];
    if (query.status?.trim()) where.status = query.status.trim();
    if (query.type?.trim()) where.type = query.type.trim();
    if (query.platform?.trim()) where.platform = query.platform.trim();
    if (query.skillCode?.trim()) {
      where.redfoxSkill = { code: query.skillCode.trim() };
    }
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      and.push({
        OR: [
          { title: { contains: keyword } },
          { summary: { contains: keyword } },
          { content: { contains: keyword } },
          { author: { contains: keyword } },
        ],
      });
    }
    const range = this.timeRange(query.from, query.to);
    if (range) where.createdAt = range;
    return where;
  }

  private sortOrder(query: QueryIntelligenceItemsDto) {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    if (query.sortBy === 'updatedAt') return { updatedAt: direction } as const;
    if (query.sortBy === 'publishDate') {
      return { publishDate: direction } as const;
    }
    if (query.sortBy === 'title') return { title: direction } as const;
    return { createdAt: direction } as const;
  }

  private buildMonitorWhere(
    scope: RedfoxScope,
    query: QueryIntelligenceMonitorsDto,
  ) {
    const where: Prisma.IntelligenceMonitorWhereInput = {
      AND: [this.monitorScopeWhere(scope)],
    };
    const and = where.AND as Prisma.IntelligenceMonitorWhereInput[];
    if (query.status?.trim()) where.status = query.status.trim();
    if (query.type?.trim()) where.type = query.type.trim();
    if (query.platform?.trim()) where.platform = query.platform.trim();
    if (query.industry?.trim()) where.industry = query.industry.trim();
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      and.push({
        OR: [
          { keyword: { contains: keyword } },
          { accountExternalId: { contains: keyword } },
          { industry: { contains: keyword } },
          { platform: { contains: keyword } },
          { type: { contains: keyword } },
        ],
      });
    }
    return where;
  }

  private buildReportWhere(
    scope: RedfoxScope,
    query: QueryIntelligenceReportsDto,
  ) {
    const where: Prisma.IntelligenceReportWhereInput = {
      AND: [this.reportScopeWhere(scope)],
    };
    const and = where.AND as Prisma.IntelligenceReportWhereInput[];
    if (query.status?.trim()) where.status = query.status.trim();
    if (query.kind?.trim()) where.kind = query.kind.trim();
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      and.push({
        OR: [
          { title: { contains: keyword } },
          { markdown: { contains: keyword } },
          { owner: { contains: keyword } },
          { audience: { contains: keyword } },
        ],
      });
    }
    return where;
  }

  private monitorSortOrder(query: QueryIntelligenceMonitorsDto) {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    if (query.sortBy === 'createdAt') return { createdAt: direction } as const;
    if (query.sortBy === 'nextRunAt') return { nextRunAt: direction } as const;
    if (query.sortBy === 'lastRunAt') return { lastRunAt: direction } as const;
    return { updatedAt: direction } as const;
  }

  private async findMonitor(scope: RedfoxScope, monitorId: string) {
    const monitor = await this.prisma.intelligenceMonitor.findFirst({
      where: {
        id: monitorId,
        AND: [this.monitorScopeWhere(scope)],
      },
    });

    if (!monitor) {
      throw new NotFoundException('监控配置不存在');
    }

    return monitor;
  }

  private async findItem(scope: RedfoxScope, itemId: string) {
    const item = await this.prisma.intelligenceItem.findFirst({
      where: {
        id: itemId,
        AND: [this.scopeWhere(scope)],
      },
      include: this.itemInclude(),
    });

    if (!item) {
      throw new NotFoundException('情报条目不存在');
    }

    return item;
  }

  private async findReport(scope: RedfoxScope, reportId: string) {
    const report = await this.prisma.intelligenceReport.findFirst({
      where: {
        id: reportId,
        AND: [this.reportScopeWhere(scope)],
      },
    });

    if (!report) {
      throw new NotFoundException('情报报告不存在');
    }

    return report;
  }

  private async processComplianceDispatchRecord(
    scope: RedfoxScope,
    kind: Extract<DispatchRecordsKind, 'risks' | 'rules'>,
    recordId: string,
    dto: ProcessIntelligenceDispatchRecordDto,
  ) {
    const record = await this.prisma.complianceCheck.findFirst({
      where: {
        id: recordId,
        AND: [
          this.complianceCheckScopeWhere(scope),
          kind === 'rules'
            ? { targetType: 'intelligence_rule_seed' }
            : {
                targetType: {
                  in: ['intelligence_item', 'intelligence_dispatch'],
                },
              },
        ],
      },
    });

    if (!record) {
      throw new NotFoundException('情报处理记录不存在');
    }

    const status = this.complianceActionStatus(kind, dto);
    const updated = await this.prisma.complianceCheck.update({
      where: { id: record.id },
      data: {
        status,
        raw: this.dispatchActionRaw(record.raw, dto, status),
      },
    });

    const itemStatus = this.intelligenceItemStatusForComplianceAction(
      kind,
      dto.action,
      status,
    );
    if (record.targetId && itemStatus) {
      await this.prisma.intelligenceItem.updateMany({
        where: {
          id: record.targetId,
          AND: [this.scopeWhere(scope)],
        },
        data: { status: itemStatus },
      });
    }

    return {
      kind,
      action: dto.action,
      status,
      message:
        kind === 'rules'
          ? '规则种子处理完成，状态已写回情报规则台。'
          : '风险审核处理完成，状态已写回风险审核台。',
      record: this.toComplianceDispatchRecord(updated, kind),
    };
  }

  private async processBenchmarkDispatchRecord(
    scope: RedfoxScope,
    recordId: string,
    dto: ProcessIntelligenceDispatchRecordDto,
  ) {
    const record = await this.prisma.benchmarkAccount.findFirst({
      where: {
        id: recordId,
        AND: [this.benchmarkAccountScopeWhere(scope)],
      },
    });

    if (!record) {
      throw new NotFoundException('情报处理记录不存在');
    }

    const status = this.benchmarkActionStatus(dto, record.status);
    const diagnosis = this.asRecord(record.diagnosis);
    const updated = await this.prisma.benchmarkAccount.update({
      where: { id: record.id },
      data: {
        status,
        diagnosis: this.dispatchActionRaw(diagnosis, dto, status, {
          observationLevel: status === 'priority' ? 'priority' : undefined,
        }),
        raw: this.dispatchActionRaw(record.raw, dto, status),
      },
    });

    return {
      kind: 'accounts' as const,
      action: dto.action,
      status,
      message:
        status === 'priority'
          ? '已设为重点观察账号。'
          : status === 'archived'
            ? '已归档该对标账号。'
            : '对标账号处理状态已更新。',
      record: this.toBenchmarkDispatchRecord(updated),
    };
  }

  private async processCommentInsightDispatchRecord(
    scope: RedfoxScope,
    recordId: string,
    dto: ProcessIntelligenceDispatchRecordDto,
  ) {
    const record = await this.prisma.commentInsight.findFirst({
      where: {
        id: recordId,
        AND: [this.commentInsightScopeWhere(scope)],
      },
      include: { intelligenceItem: true },
    });

    if (!record) {
      throw new NotFoundException('情报处理记录不存在');
    }

    if (dto.action === 'create_growth_lead') {
      const lead = await this.upsertGrowthLeadFromCommentInsight(scope, record);
      const status = 'lead_created';
      const updated = await this.prisma.commentInsight.update({
        where: { id: record.id },
        data: {
          growthLeadId: lead.id,
          raw: this.dispatchActionRaw(record.raw, dto, status, {
            growthLeadId: lead.id,
          }),
        },
        include: { intelligenceItem: true },
      });
      if (record.intelligenceItemId) {
        await this.prisma.intelligenceItem.updateMany({
          where: {
            id: record.intelligenceItemId,
            AND: [this.scopeWhere(scope)],
          },
          data: { growthLeadId: lead.id, status: 'growth_lead_created' },
        });
      }
      return {
        kind: 'leads' as const,
        action: dto.action,
        status,
        growthLeadId: lead.id,
        message: '已转入增长线索池，等待人工确认和后续跟进。',
        record: this.toCommentInsightDispatchRecord(updated),
      };
    }

    const status = this.commentInsightActionStatus(dto);
    const updated = await this.prisma.commentInsight.update({
      where: { id: record.id },
      data: {
        raw: this.dispatchActionRaw(record.raw, dto, status),
      },
      include: { intelligenceItem: true },
    });

    return {
      kind: 'leads' as const,
      action: dto.action,
      status,
      message: '线索洞察处理状态已更新。',
      record: this.toCommentInsightDispatchRecord(updated),
    };
  }

  private dispatchRecordsKind(kind: string): DispatchRecordsKind {
    if (kind === 'risks') return 'risks';
    if (kind === 'rules') return 'rules';
    if (kind === 'accounts') return 'accounts';
    if (kind === 'leads') return 'leads';
    throw new BadRequestException('未知的情报处理记录类型');
  }

  private buildComplianceDispatchWhere(
    scope: RedfoxScope,
    kind: DispatchRecordsKind,
    query: QueryIntelligenceDispatchRecordsDto,
  ): Prisma.ComplianceCheckWhereInput {
    const where: Prisma.ComplianceCheckWhereInput = {
      AND: [
        this.complianceCheckScopeWhere(scope),
        kind === 'rules'
          ? { targetType: 'intelligence_rule_seed' }
          : {
              targetType: {
                in: ['intelligence_item', 'intelligence_dispatch'],
              },
            },
      ],
    };
    const and = where.AND as Prisma.ComplianceCheckWhereInput[];
    if (query.status?.trim()) {
      where.status = query.status.trim();
    }
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      and.push({
        OR: [
          { targetId: { contains: keyword } },
          { platform: { contains: keyword } },
          { status: { contains: keyword } },
        ],
      });
    }
    return where;
  }

  private buildBenchmarkWhere(
    scope: RedfoxScope,
    query: QueryIntelligenceDispatchRecordsDto,
  ): Prisma.BenchmarkAccountWhereInput {
    const where: Prisma.BenchmarkAccountWhereInput = {
      AND: [this.benchmarkAccountScopeWhere(scope)],
    };
    const and = where.AND as Prisma.BenchmarkAccountWhereInput[];
    if (query.status?.trim()) where.status = query.status.trim();
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      and.push({
        OR: [
          { nickname: { contains: keyword } },
          { platform: { contains: keyword } },
          { externalUserId: { contains: keyword } },
          { reason: { contains: keyword } },
        ],
      });
    }
    return where;
  }

  private buildCommentInsightWhere(
    scope: RedfoxScope,
    query: QueryIntelligenceDispatchRecordsDto,
  ): Prisma.CommentInsightWhereInput {
    const where: Prisma.CommentInsightWhereInput = {
      AND: [this.commentInsightScopeWhere(scope)],
    };
    const and = where.AND as Prisma.CommentInsightWhereInput[];
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      and.push({
        OR: [
          { platform: { contains: keyword } },
          { sourceExternalId: { contains: keyword } },
          { sourceUrl: { contains: keyword } },
        ],
      });
    }
    return where;
  }

  private paginatedDispatchRecords<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
  ) {
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private toComplianceDispatchRecord(
    record: Prisma.ComplianceCheckGetPayload<object>,
    kind: DispatchRecordsKind,
  ) {
    const raw = this.asRecord(record.raw);
    const findings = this.jsonStringArray(record.findings);
    const suggestions = this.jsonStringArray(record.suggestions);
    const title =
      this.readString(raw, ['title', 'sourceTitle']) ||
      (kind === 'rules' ? '情报规则种子' : '风险审核记录');
    const reason = this.readString(raw, ['reason']);
    return {
      id: record.id,
      recordType: kind === 'rules' ? 'rule_seed' : 'risk_review',
      intelligenceItemId:
        this.readString(raw, ['intelligenceItemId']) || record.targetId,
      title,
      platform: record.platform,
      status: record.status,
      risk: this.normalizeRiskLevel(record.riskLevel),
      owner: kind === 'rules' ? '合规负责人' : '合规负责人',
      source: this.readString(raw, ['label', 'action']) || record.targetType,
      summary: reason || suggestions[0] || findings[0] || '',
      evidence: findings,
      boundary: suggestions[0] || '',
      href: kind === 'rules' ? '/intelligence/rules' : '/intelligence/risks',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toBenchmarkDispatchRecord(
    record: Prisma.BenchmarkAccountGetPayload<object>,
  ) {
    const diagnosis = this.asRecord(record.diagnosis);
    const raw = this.asRecord(record.raw);
    return {
      id: record.id,
      recordType: 'benchmark_account',
      intelligenceItemId: record.intelligenceItemId,
      title: record.nickname,
      platform: record.platform,
      status: record.status,
      risk: 'low',
      owner: '增长负责人',
      source:
        this.readString(raw, ['label', 'action']) || '情报派发 / 对标账号池',
      summary: record.reason || '',
      evidence: this.jsonStringArray(diagnosis.evidence),
      boundary: this.readString(diagnosis, ['boundary']),
      href: '/intelligence/accounts',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toCommentInsightDispatchRecord(record: CommentInsightWithItem) {
    const raw = this.asRecord(record.raw);
    const painPoints = this.jsonStringArray(record.painPoints);
    const demandSignals = this.jsonStringArray(record.demandSignals);
    const objections = this.jsonStringArray(record.objections);
    const replySuggestions = this.jsonStringArray(record.replySuggestions);
    const status =
      record.growthLeadId ||
      this.readString(raw, ['growthLeadId', 'growth_lead_id'])
        ? 'lead_created'
        : this.readString(raw, ['dispatchStatus', 'status']) || 'insight_ready';
    return {
      id: record.id,
      recordType: 'comment_insight',
      intelligenceItemId: record.intelligenceItemId,
      title: record.intelligenceItem?.title || painPoints[0] || '线索洞察',
      platform: record.platform,
      status,
      risk: 'medium',
      owner: '增长负责人',
      source:
        this.readString(raw, ['label', 'action']) || '情报派发 / 线索洞察',
      summary: demandSignals[0] || painPoints[0] || '',
      evidence: this.uniqueStrings([
        ...painPoints,
        ...demandSignals,
        ...objections,
      ]),
      boundary: replySuggestions[0] || '只作为人工判断输入，不自动触达。',
      href: status === 'lead_created' ? '/growth/leads' : '/intelligence/leads',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private complianceActionStatus(
    kind: Extract<DispatchRecordsKind, 'risks' | 'rules'>,
    dto: ProcessIntelligenceDispatchRecordDto,
  ) {
    const custom = dto.status?.trim();
    if (custom) return custom;
    if (kind === 'rules') {
      if (dto.action === 'publish_rule') return 'active_rule';
      if (dto.action === 'approve') return 'approved_rule';
      if (dto.action === 'reject') return 'rejected_rule';
      if (dto.action === 'archive') return 'archived';
      return 'rule_reviewed';
    }
    if (dto.action === 'approve') return 'approved';
    if (dto.action === 'reject') return 'rejected';
    if (dto.action === 'archive') return 'archived';
    return 'reviewed';
  }

  private benchmarkActionStatus(
    dto: ProcessIntelligenceDispatchRecordDto,
    fallback: string,
  ) {
    const custom = dto.status?.trim();
    if (custom) return custom;
    if (dto.action === 'watch_priority') return 'priority';
    if (dto.action === 'archive') return 'archived';
    if (dto.action === 'mark_done') return 'watching';
    return fallback || 'watching';
  }

  private commentInsightActionStatus(
    dto: ProcessIntelligenceDispatchRecordDto,
  ) {
    const custom = dto.status?.trim();
    if (custom) return custom;
    if (dto.action === 'archive') return 'archived';
    if (dto.action === 'reject') return 'rejected';
    if (dto.action === 'mark_done') return 'reviewed';
    return 'insight_ready';
  }

  private intelligenceItemStatusForComplianceAction(
    kind: Extract<DispatchRecordsKind, 'risks' | 'rules'>,
    action: IntelligenceDispatchRecordAction,
    status: string,
  ) {
    if (kind === 'rules') {
      if (status === 'active_rule') return 'rule_active';
      if (action === 'reject') return 'rule_rejected';
      if (action === 'archive') return 'rule_archived';
      return 'rule_reviewed';
    }
    if (action === 'approve') return 'compliance_approved';
    if (action === 'reject') return 'compliance_rejected';
    if (action === 'archive') return 'compliance_archived';
    return 'compliance_reviewed';
  }

  private dispatchActionRaw(
    value: unknown,
    dto: ProcessIntelligenceDispatchRecordDto,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    const previous = this.asRecord(value);
    const action = this.compactRecord({
      action: dto.action,
      status,
      note: dto.note?.trim(),
      processedAt: new Date().toISOString(),
    });
    const history = [
      action,
      ...this.jsonRecordArray(previous.actionHistory),
    ].slice(0, 20);

    return this.toInputJson(
      this.compactRecord({
        ...previous,
        ...extra,
        dispatchStatus: status,
        lastAction: action,
        actionHistory: history,
      }),
      null,
    );
  }

  private async upsertGrowthLeadFromCommentInsight(
    scope: RedfoxScope,
    record: CommentInsightWithItem,
  ) {
    const item = record.intelligenceItem;
    const leadId = this.growthLeadId(record);
    const painPoints = this.jsonStringArray(record.painPoints);
    const demandSignals = this.jsonStringArray(record.demandSignals);
    const intentKeywords = this.jsonStringArray(record.intentKeywords);
    const objections = this.jsonStringArray(record.objections);
    const replySuggestions = this.jsonStringArray(record.replySuggestions);
    const evidenceUrls = this.uniqueStrings([
      record.sourceUrl || '',
      item?.sourceUrl || '',
      item?.authorUrl || '',
    ]);
    const sourceText =
      this.uniqueStrings([
        ...demandSignals,
        ...painPoints,
        item?.summary || '',
        item?.content || '',
      ]).join('\n') || '情报线索';
    const score = this.growthLeadScore(
      sourceText,
      intentKeywords,
      demandSignals,
    );
    const now = new Date();
    const base = {
      id: leadId,
      userId: scope.userId,
      tenantId: scope.tenantId || null,
      platform: this.growthPlatform(record.platform),
      sourceType: 'intelligence-comment',
      sourceTaskId: 'intelligence',
      sourceRunId: record.redfoxCallLogId,
      nickname: item?.author || item?.title || painPoints[0] || '情报线索',
      profileUrl: item?.authorUrl || record.sourceUrl || item?.sourceUrl,
      avatarUrl: null,
      externalUserId: record.sourceExternalId || item?.sourceExternalId,
      sourceText,
      sourceUrl: record.sourceUrl || item?.sourceUrl,
      videoTitle: item?.title,
      videoUrl: item?.sourceUrl,
      commentTime: record.analyzedAt.toISOString(),
      matchedKeywords: this.toInputJson(
        this.uniqueStrings(intentKeywords),
        [],
      ) as Prisma.InputJsonArray,
      score,
      scoreReasons: this.toInputJson(
        this.uniqueStrings([
          '情报评论洞察',
          ...demandSignals.slice(0, 2),
          ...objections.slice(0, 2),
        ]),
        [],
      ) as Prisma.InputJsonArray,
      status: 'new',
      nextFollowUpAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ownerUserId: scope.userId,
      notes: this.toInputJson(
        [
          {
            id: this.shortHash(`${leadId}:note`),
            type: 'intelligence',
            text: replySuggestions[0] || '从情报线索洞察转入增长线索池。',
            createdAt: now.toISOString(),
            createdBy: scope.userId,
          },
        ],
        [],
      ) as Prisma.InputJsonArray,
      evidenceUrls: this.toInputJson(evidenceUrls, []) as Prisma.InputJsonArray,
      latestReply: replySuggestions[0] || null,
      createdAt: now,
      updatedAt: now,
    } satisfies Prisma.GrowthLeadUncheckedCreateInput;

    return this.prisma.growthLead.upsert({
      where: { id: leadId },
      create: base,
      update: {
        tenantId: base.tenantId,
        platform: base.platform,
        sourceType: base.sourceType,
        sourceTaskId: base.sourceTaskId,
        sourceRunId: base.sourceRunId,
        nickname: base.nickname,
        profileUrl: base.profileUrl,
        externalUserId: base.externalUserId,
        sourceText: base.sourceText,
        sourceUrl: base.sourceUrl,
        videoTitle: base.videoTitle,
        videoUrl: base.videoUrl,
        commentTime: base.commentTime,
        matchedKeywords: base.matchedKeywords,
        score: base.score,
        scoreReasons: base.scoreReasons,
        ownerUserId: base.ownerUserId,
        notes: base.notes,
        evidenceUrls: base.evidenceUrls,
        latestReply: base.latestReply,
      },
    });
  }

  private growthLeadId(record: CommentInsightWithItem) {
    return `intel-lead-${this.shortHash(
      [
        record.tenantId || '',
        record.userId,
        record.id,
        record.sourceExternalId || '',
        record.sourceUrl || '',
      ].join('|'),
    )}`;
  }

  private shortHash(value: string) {
    return createHash('sha256').update(value).digest('hex').slice(0, 20);
  }

  private growthLeadScore(
    sourceText: string,
    intentKeywords: string[],
    demandSignals: string[],
  ) {
    const base = 58;
    const intentScore = Math.min(18, intentKeywords.length * 4);
    const demandScore = Math.min(18, demandSignals.length * 5);
    const textScore = /价格|报价|预约|到店|咨询|购买|链接|联系方式/.test(
      sourceText,
    )
      ? 12
      : 0;
    return Math.max(
      50,
      Math.min(95, base + intentScore + demandScore + textScore),
    );
  }

  private growthPlatform(value: string) {
    const text = value.toLowerCase();
    if (text.includes('douyin') || value.includes('抖音')) return 'douyin';
    if (text.includes('wechat-channel') || value.includes('视频号')) {
      return 'wechat-channel';
    }
    if (text.includes('wechat') || value.includes('微信')) return 'wechat';
    if (text.includes('kuaishou') || value.includes('快手')) return 'kuaishou';
    return 'xiaohongshu';
  }

  private jsonRecordArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        )
      : [];
  }

  private compactRecord(record: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined),
    );
  }

  private normalizeRiskLevel(value: string): 'low' | 'medium' | 'high' {
    if (value === 'high' || value === 'medium' || value === 'low') {
      return value;
    }
    if (value.includes('高')) return 'high';
    if (value.includes('中')) return 'medium';
    if (value.includes('低')) return 'low';
    return 'medium';
  }

  private jsonStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'number') return String(item);
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return this.readString(record, [
            'title',
            'label',
            'message',
            'reason',
            'note',
            'value',
          ]);
        }
        return '';
      })
      .filter(Boolean);
  }

  private dispatchKind(dto: DispatchIntelligenceItemDto): DispatchKind {
    const text = [dto.action, dto.label, dto.target, dto.href]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (
      text.includes('rule') ||
      text.includes('rules') ||
      text.includes('规则') ||
      text.includes('沉淀')
    ) {
      return 'rule_seed';
    }
    if (
      text.includes('risk') ||
      text.includes('compliance') ||
      text.includes('风险') ||
      text.includes('合规')
    ) {
      return 'risk_review';
    }
    if (
      text.includes('account') ||
      text.includes('benchmark') ||
      text.includes('账号') ||
      text.includes('对标')
    ) {
      return 'benchmark_account';
    }
    if (
      text.includes('lead') ||
      text.includes('comment') ||
      text.includes('线索') ||
      text.includes('评论') ||
      text.includes('洞察')
    ) {
      return 'comment_insight';
    }
    return 'manual_queue';
  }

  private dispatchRiskLevel(
    dto: DispatchIntelligenceItemDto,
    item: IntelligenceItemRecord,
  ) {
    if (dto.risk) return dto.risk;
    const raw = this.asRecord(item.raw);
    const metrics = this.asRecord(item.metrics);
    const riskText = this.readString(raw, [
      'risk',
      'riskLevel',
      'risk_level',
    ]).toLowerCase();
    if (riskText.includes('high') || riskText.includes('高')) return 'high';
    if (riskText.includes('medium') || riskText.includes('中')) {
      return 'medium';
    }
    if (riskText.includes('low') || riskText.includes('低')) return 'low';
    const riskScore = Number(
      metrics.riskScore ?? metrics.risk_score ?? metrics.risk,
    );
    if (Number.isFinite(riskScore)) {
      if (riskScore >= 70) return 'high';
      if (riskScore >= 40) return 'medium';
    }
    return item.status.includes('risk') || item.status.includes('compliance')
      ? 'high'
      : 'low';
  }

  private dispatchEvidence(item: IntelligenceItemRecord) {
    const raw = this.asRecord(item.raw);
    return this.uniqueStrings([
      ...this.readStringArray(raw, ['evidence', 'evidences', 'proofs']),
      item.summary || '',
      item.sourceUrl ? `来源链接：${item.sourceUrl}` : '',
      item.sourceExternalId ? `外部 ID：${item.sourceExternalId}` : '',
      item.redfoxSkill?.name ? `采集 Skill：${item.redfoxSkill.name}` : '',
    ]);
  }

  private dispatchSuggestions(
    item: IntelligenceItemRecord,
    dto: DispatchIntelligenceItemDto,
  ) {
    return this.uniqueStrings([
      dto.reason || '',
      this.dispatchBoundary(item),
      item.summary || '',
    ]);
  }

  private dispatchBoundary(item: IntelligenceItemRecord) {
    const raw = this.asRecord(item.raw);
    return (
      this.readString(raw, ['boundary', 'riskBoundary', 'risk_boundary']) ||
      '保留来源和证据，不自动触达，不直接复用第三方原文素材。'
    );
  }

  private dispatchMetadata(
    item: IntelligenceItemRecord,
    dto: DispatchIntelligenceItemDto,
  ) {
    return {
      source: 'intelligence-dispatch',
      intelligenceItemId: item.id,
      action: dto.action,
      label: dto.label,
      target: dto.target,
      href: dto.href,
      reason: dto.reason,
      risk: this.dispatchRiskLevel(dto, item),
      title: item.title,
      platform: item.platform,
      type: item.type,
      redfoxSkillId: item.redfoxSkillId,
      redfoxCallLogId: item.redfoxCallLogId,
    };
  }

  private normalizeReportStatus(status?: string) {
    const value = status?.trim();
    if (!value) return 'draft';
    const allowed = ['draft', 'in_review', 'delivered', 'archived'];
    return allowed.includes(value) ? value : 'draft';
  }

  private assertReportStatusAllowed(actor: IntelligenceActor, status: string) {
    if (!['delivered', 'archived'].includes(status)) return;
    if (this.canManageReports(actor)) return;
    throw new ForbiddenException(
      '只有 manager 或 admin 可以直接创建已交付/已归档报告',
    );
  }

  private assertReportActionAllowed(
    actor: IntelligenceActor,
    action: IntelligenceReportAction,
  ) {
    if (action === 'submit_review') return;
    if (this.canManageReports(actor)) return;
    throw new ForbiddenException(
      '只有 manager 或 admin 可以交付、归档或重开报告',
    );
  }

  private assertDispatchActionAllowed(
    actor: IntelligenceActor,
    kind: DispatchRecordsKind,
    action: IntelligenceDispatchRecordAction,
  ) {
    const requiresManager =
      (kind === 'risks' && action === 'approve') ||
      (kind === 'rules' && action === 'publish_rule');
    if (!requiresManager || this.canManageReports(actor)) return;
    throw new ForbiddenException(
      '只有 manager 或 admin 可以批准风险或发布情报规则',
    );
  }

  /** 全功能开放（大王决策 2026-08-11）：交付/归档/批准不再限 manager/admin */
  private canManageReports(_actor: IntelligenceActor) {
    return true;
  }

  private reportActionResult(action: IntelligenceReportAction) {
    if (action === 'submit_review') {
      return { status: 'in_review', message: '报告已提交复核。' };
    }
    if (action === 'mark_delivered') {
      return { status: 'delivered', message: '报告已标记为已交付。' };
    }
    if (action === 'archive') {
      return { status: 'archived', message: '报告已归档。' };
    }
    return { status: 'draft', message: '报告已重开为草稿。' };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readString(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return '';
  }

  private readStringArray(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .map((item) => item.trim());
      }
    }
    return [];
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private toUncheckedMonitorCreateData(
    scope: RedfoxScope,
    dto: CreateIntelligenceMonitorDto,
    skillInstallId?: string | null,
  ): Prisma.IntelligenceMonitorUncheckedCreateInput {
    return {
      tenantId: scope.tenantId || null,
      userId: scope.userId,
      type: dto.type.trim(),
      schedule: dto.schedule.trim(),
      platform: this.optionalText(dto.platform),
      keyword: this.optionalText(dto.keyword),
      accountExternalId: this.optionalText(dto.accountExternalId),
      industry: this.optionalText(dto.industry),
      skillInstallId: skillInstallId ?? null,
      status: dto.status?.trim() || 'active',
      costLimitPoints: dto.costLimitPoints,
      nextRunAt: dto.nextRunAt ? this.toDate(dto.nextRunAt) : undefined,
      config:
        dto.config === undefined
          ? undefined
          : this.toInputJson(dto.config, null),
    };
  }

  private toUncheckedReportCreateData(
    scope: RedfoxScope,
    dto: CreateIntelligenceReportDto,
  ): Prisma.IntelligenceReportUncheckedCreateInput {
    return {
      tenantId: scope.tenantId || null,
      userId: scope.userId,
      kind: dto.kind.trim(),
      title: dto.title.trim(),
      audience: this.optionalText(dto.audience),
      owner: this.optionalText(dto.owner),
      rangeKey: this.optionalText(dto.rangeKey),
      status: this.normalizeReportStatus(dto.status),
      completeness: Math.max(0, Math.min(100, Number(dto.completeness || 0))),
      findings: this.toInputJson(
        this.uniqueStrings(dto.findings || []),
        [],
      ) as Prisma.InputJsonArray,
      evidence: this.toInputJson(
        this.uniqueStrings(dto.evidence || []),
        [],
      ) as Prisma.InputJsonArray,
      markdown: dto.markdown.trim(),
      metadata: this.toInputJson(
        {
          ...(dto.metadata || {}),
          source: 'intelligence-report-center',
          savedAt: new Date().toISOString(),
        },
        null,
      ),
    };
  }

  private toUncheckedMonitorUpdateData(
    dto: UpdateIntelligenceMonitorDto,
    skillInstallId?: string | null,
  ): Prisma.IntelligenceMonitorUncheckedUpdateInput {
    return {
      ...(dto.type !== undefined ? { type: dto.type.trim() } : {}),
      ...(dto.schedule !== undefined ? { schedule: dto.schedule.trim() } : {}),
      ...(dto.platform !== undefined
        ? { platform: this.optionalText(dto.platform) }
        : {}),
      ...(dto.keyword !== undefined
        ? { keyword: this.optionalText(dto.keyword) }
        : {}),
      ...(dto.accountExternalId !== undefined
        ? { accountExternalId: this.optionalText(dto.accountExternalId) }
        : {}),
      ...(dto.industry !== undefined
        ? { industry: this.optionalText(dto.industry) }
        : {}),
      ...(skillInstallId !== undefined ? { skillInstallId } : {}),
      ...(dto.status !== undefined ? { status: dto.status.trim() } : {}),
      ...(dto.costLimitPoints !== undefined
        ? { costLimitPoints: dto.costLimitPoints }
        : {}),
      ...(dto.lastRunAt !== undefined
        ? { lastRunAt: this.toDate(dto.lastRunAt) }
        : {}),
      ...(dto.nextRunAt !== undefined
        ? { nextRunAt: this.toDate(dto.nextRunAt) }
        : {}),
      ...(dto.lastError !== undefined
        ? { lastError: this.optionalText(dto.lastError) }
        : {}),
      ...(dto.config !== undefined
        ? { config: this.toInputJson(dto.config, null) }
        : {}),
    };
  }

  private scopeWhere(scope: RedfoxScope): Prisma.IntelligenceItemWhereInput {
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

  private benchmarkAccountScopeWhere(
    scope: RedfoxScope,
  ): Prisma.BenchmarkAccountWhereInput {
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

  private complianceCheckScopeWhere(
    scope: RedfoxScope,
  ): Prisma.ComplianceCheckWhereInput {
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

  private commentInsightScopeWhere(
    scope: RedfoxScope,
  ): Prisma.CommentInsightWhereInput {
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

  private reportScopeWhere(
    scope: RedfoxScope,
  ): Prisma.IntelligenceReportWhereInput {
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

  private skillInstallScopeWhere(
    scope: RedfoxScope,
  ): Prisma.RedfoxSkillInstallWhereInput {
    if (scope.tenantId) {
      return {
        OR: [{ tenantId: scope.tenantId }, { userId: scope.userId }],
      };
    }
    return { userId: scope.userId };
  }

  private itemInclude() {
    return {
      redfoxSkill: true,
      redfoxCallLog: true,
    } satisfies Prisma.IntelligenceItemInclude;
  }

  private buildDedupeKey(item: NormalizedIntelligenceItem) {
    const identity = [
      item.platform,
      item.type,
      item.sourceExternalId || item.sourceUrl || item.title,
      item.author || '',
    ]
      .map((value) =>
        String(value || '')
          .trim()
          .toLowerCase(),
      )
      .join('|');
    return createHash('sha256').update(identity).digest('hex');
  }

  private timeRange(from?: string, to?: string) {
    const gte = this.toDate(from);
    const lte = this.toDate(to);
    if (!gte && !lte) return null;
    return {
      ...(gte ? { gte } : {}),
      ...(lte ? { lte } : {}),
    };
  }

  private toDate(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private optionalText(value?: string) {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private groupRows<T extends Record<string, unknown>>(
    rows: Array<T & { _count: { _all: number } }>,
    key: keyof T,
  ) {
    return rows.map((row) => ({
      key: String(row[key] || ''),
      count: row._count._all,
    }));
  }

  private pickGroupCount<T extends Record<string, unknown>>(
    rows: Array<T & { _count: { _all: number } }>,
    key: keyof T,
    value: string,
  ) {
    return rows.find((row) => row[key] === value)?._count._all || 0;
  }

  private toItemView(item: IntelligenceItemRecord) {
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

  private toMonitorView(monitor: Prisma.IntelligenceMonitorGetPayload<object>) {
    return {
      id: monitor.id,
      tenantId: monitor.tenantId,
      userId: monitor.userId,
      skillInstallId: monitor.skillInstallId,
      type: monitor.type,
      platform: monitor.platform,
      keyword: monitor.keyword,
      accountExternalId: monitor.accountExternalId,
      industry: monitor.industry,
      schedule: monitor.schedule,
      status: monitor.status,
      costLimitPoints: monitor.costLimitPoints,
      lastRunAt: monitor.lastRunAt?.toISOString() || null,
      nextRunAt: monitor.nextRunAt?.toISOString() || null,
      lastError: monitor.lastError,
      config: monitor.config,
      createdAt: monitor.createdAt.toISOString(),
      updatedAt: monitor.updatedAt.toISOString(),
    };
  }

  private toReportView(report: IntelligenceReportRecord) {
    return {
      id: report.id,
      tenantId: report.tenantId,
      userId: report.userId,
      kind: report.kind,
      title: report.title,
      audience: report.audience,
      owner: report.owner,
      rangeKey: report.rangeKey,
      status: report.status,
      completeness: report.completeness,
      findings: this.jsonStringArray(report.findings),
      evidence: this.jsonStringArray(report.evidence),
      markdown: report.markdown,
      metadata: this.asRecord(report.metadata),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }

  private asStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
  }

  private toInputJson(
    value: unknown,
    fallback: Prisma.InputJsonValue | null,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === undefined || value === null) {
      return fallback === null ? Prisma.JsonNull : fallback;
    }
    return value as Prisma.InputJsonValue;
  }
}
