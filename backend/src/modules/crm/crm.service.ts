import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { safeText } from '../../common/text.utils';
import { AppMarketService } from '../app-market/app-market.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

/** S0-P1-8：商机阶段白名单（报告 7.2 C 的 new→qualified→…→won/lost/nurture） */
const OPPORTUNITY_STAGES = [
  'new',
  'qualified',
  'discovery',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'nurture',
] as const;
type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

interface CollectionQuery {
  q?: string;
  status?: string;
  stage?: string;
  customerId?: string;
}

interface CustomerInput {
  displayName?: string;
  companyId?: string | null;
  companyName?: string;
  title?: string;
  email?: string;
  phone?: string;
  wechat?: string;
  status?: string;
  sourcePlatform?: string;
  sourceKeyword?: string;
  matchedKeyword?: string;
  sourceUrl?: string;
  sourceText?: string;
  latestReply?: string;
  score?: number;
  tags?: unknown;
  profileUrl?: string;
  externalUserId?: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
  dedupeKey?: string;
  metadata?: unknown;
}

interface CompanyInput {
  name?: string;
  domain?: string;
  industry?: string;
  phone?: string;
  website?: string;
  city?: string;
  employees?: number;
  annualRevenueCents?: number;
  tags?: unknown;
  metadata?: unknown;
}

interface OpportunityInput {
  name?: string;
  stage?: string;
  amountCents?: number;
  currency?: string;
  probability?: number;
  companyId?: string | null;
  companyName?: string;
  primaryCustomerId?: string | null;
  closeDate?: string | Date | null;
  nextStep?: string;
  competitor?: string;
  source?: string;
  winReason?: string;
  loseReason?: string;
  metadata?: unknown;
}

interface TaskInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  dueAt?: string | Date | null;
  assigneeId?: string;
  companyId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  metadata?: unknown;
}

interface NoteInput {
  body?: string;
  createdBy?: string;
  companyId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  metadata?: unknown;
}

interface WelcomeMessageTemplateInput {
  name?: string;
  body?: string;
  channel?: string;
}

interface WelcomeMessagePreparationInput {
  templateId?: string;
  message?: string;
  channel?: string;
  accountId?: string;
  accountName?: string;
}

interface CustomerConversationLinkInput {
  interactionTaskId?: string;
  preparationId?: string;
}

const CRM_WELCOME_TEMPLATE_CREATED_BY = 'crm:welcome-message-template';
const CRM_WELCOME_TEMPLATE_KIND = 'welcome_message_template';
const CRM_WELCOME_PREPARATION_EVENT = 'welcome_message_prepared';

interface CrmAutoAcquisitionTargetInput {
  index?: number;
  text?: string;
  sourceText?: string;
  sourceUrl?: string;
  profileUrl?: string;
  targetName?: string;
  videoTitle?: string;
  videoUrl?: string;
  kind?: string;
  commentMode?: string;
  score?: number;
  engagementScore?: number;
  commentReplyText?: string;
  commentTaskEnabled?: boolean;
  reason?: string;
}

interface CrmAutoAcquisitionExecutionResultInput {
  index: number;
  targetName?: string;
  targetText?: string;
  replyText?: string;
  ok: boolean;
  status: string;
  message: string;
  evidenceUrl?: string;
}

export interface CrmAutoAcquisitionCaptureInput {
  configId: string;
  recordId: string;
  taskName: string;
  trigger: string;
  keyword: string;
  accountId?: string;
  accountName?: string;
  status: string;
  message: string;
  evidenceUrl?: string;
  targets?: CrmAutoAcquisitionTargetInput[];
  executionResults?: CrmAutoAcquisitionExecutionResultInput[];
  createdAt?: string;
}

export interface CrmCapturedCustomerRef {
  targetIndex?: number;
  leadId?: string;
  customerId: string;
  displayName: string;
  dedupeKey: string;
}

export interface CrmAutoAcquisitionCaptureResult {
  enabled: boolean;
  capturedCount: number;
  skippedCount: number;
  message: string;
  capturedCustomers: CrmCapturedCustomerRef[];
}

export interface CrmGrowthLeadCaptureInput {
  leadId: string;
  platform?: string;
  sourceType?: string;
  sourceTaskId?: string;
  sourceRunId?: string;
  nickname?: string;
  profileUrl?: string;
  externalUserId?: string;
  sourceText?: string;
  sourceUrl?: string;
  videoTitle?: string;
  videoUrl?: string;
  matchedKeywords?: string[];
  score?: number;
  scoreReasons?: string[];
  status?: string;
  latestReply?: string;
  evidenceUrls?: string[];
  dedupeKey?: string;
}

interface CrmImportCommitInput {
  filename?: string;
  rows?: unknown[];
  sourceType?: string;
  mapping?: Record<string, string>;
  proofHash?: string;
  dryRunId?: string;
  confirmationGate?: string;
  commit?: boolean;
}

interface CrmImportRollbackInput {
  importCommitId?: string;
  rollbackToken?: string;
  customerIds?: unknown[];
  reason?: string;
}

interface HubSpotVaultTokenInput {
  token?: string;
  label?: string;
  portalId?: string;
  expiresAt?: string | Date | null;
}

interface HubSpotReadOnlyRunInput {
  objects?: unknown;
  maxRowsPerObject?: unknown;
}

type HubSpotObjectKey = 'companies' | 'contacts' | 'deals';

type CrmMembershipScope = {
  tenantId: string | null;
  role: string;
  permissions: string[];
  legacy: boolean;
};

const CRM_CONNECTOR_VAULT_WRITE_TABLES = [
  'crm_connector_vault_records',
  'crm_connector_vault_handles',
  'crm_audit_events',
] as const;

const HUBSPOT_READ_ONLY_OBJECTS: Record<
  HubSpotObjectKey,
  {
    apiObject: string;
    displayName: string;
    properties: string[];
  }
> = {
  companies: {
    apiObject: 'companies',
    displayName: '公司',
    properties: ['name', 'domain', 'industry', 'city', 'phone', 'website'],
  },
  contacts: {
    apiObject: 'contacts',
    displayName: '联系人',
    properties: [
      'firstname',
      'lastname',
      'email',
      'phone',
      'jobtitle',
      'company',
    ],
  },
  deals: {
    apiObject: 'deals',
    displayName: '交易',
    properties: ['dealname', 'dealstage', 'amount', 'closedate', 'pipeline'],
  },
};

const HUBSPOT_SENSITIVE_PROPERTIES = new Set([
  'email',
  'phone',
  'mobilephone',
  'firstname',
  'lastname',
]);

export interface HubSpotReadOnlyObjectResult {
  object: HubSpotObjectKey;
  displayName: string;
  requestedLimit: number;
  returnedCount: number;
  hasMore: boolean;
  rows: Array<Record<string, unknown>>;
}

@Injectable()
export class CrmService {
  private static readonly LOCAL_IMPORT_COMMIT_GATE =
    'MIGO_LOCAL_CRM_IMPORT_APPROVED';

  constructor(
    private readonly prisma: PrismaService,
    private readonly appMarketService: AppMarketService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  async getSummary(userId: string) {
    const customerScope =
      await this.scopedCrmWhere<Prisma.CrmCustomerWhereInput>(userId);
    const companyScope =
      await this.scopedCrmWhere<Prisma.CrmCompanyWhereInput>(userId);
    const opportunityScope =
      await this.scopedCrmWhere<Prisma.CrmOpportunityWhereInput>(userId);
    const taskScope =
      await this.scopedCrmWhere<Prisma.CrmTaskWhereInput>(userId);
    const noteScope =
      await this.scopedCrmWhere<Prisma.CrmNoteWhereInput>(userId);
    const timelineScope =
      await this.scopedCrmWhere<Prisma.CrmTimelineEventWhereInput>(userId);
    const [
      totalCustomers,
      activeCustomers,
      archivedCustomers,
      totalCompanies,
      activeOpportunities,
      wonOpportunities,
      openTasks,
      overdueTasks,
      notes,
      timelineEvents,
      pipelineAmount,
      wonAmount,
    ] = await Promise.all([
      this.prisma.crmCustomer.count({ where: customerScope }),
      this.prisma.crmCustomer.count({
        where: { ...customerScope, archivedAt: null },
      }),
      this.prisma.crmCustomer.count({
        where: { ...customerScope, archivedAt: { not: null } },
      }),
      this.prisma.crmCompany.count({
        where: { ...companyScope, archivedAt: null },
      }),
      this.prisma.crmOpportunity.count({
        where: {
          ...opportunityScope,
          archivedAt: null,
          stage: { notIn: ['won', 'lost'] },
        },
      }),
      this.prisma.crmOpportunity.count({
        where: { ...opportunityScope, archivedAt: null, stage: 'won' },
      }),
      this.prisma.crmTask.count({
        where: { ...taskScope, archivedAt: null, status: { not: 'done' } },
      }),
      this.prisma.crmTask.count({
        where: {
          ...taskScope,
          archivedAt: null,
          status: { not: 'done' },
          dueAt: { lt: new Date() },
        },
      }),
      this.prisma.crmNote.count({
        where: {
          ...noteScope,
          archivedAt: null,
          NOT: { createdBy: CRM_WELCOME_TEMPLATE_CREATED_BY },
        },
      }),
      this.prisma.crmTimelineEvent.count({ where: timelineScope }),
      this.prisma.crmOpportunity.aggregate({
        where: {
          ...opportunityScope,
          archivedAt: null,
          stage: { notIn: ['won', 'lost'] },
        },
        _sum: { amountCents: true },
      }),
      this.prisma.crmOpportunity.aggregate({
        where: { ...opportunityScope, archivedAt: null, stage: 'won' },
        _sum: { amountCents: true },
      }),
    ]);
    return {
      totalCustomers,
      activeCustomers,
      archivedCustomers,
      timelineEvents,
      totalCompanies,
      activeOpportunities,
      wonOpportunities,
      openTasks,
      overdueTasks,
      notes,
      pipelineAmountCents: pipelineAmount._sum.amountCents ?? 0,
      wonAmountCents: wonAmount._sum.amountCents ?? 0,
    };
  }

  async listCustomers(userId: string, query: CollectionQuery = {}) {
    const where =
      await this.scopedCrmWhere<Prisma.CrmCustomerWhereInput>(userId);
    const status = this.optionalString(query.status);
    if (status && status !== 'all') {
      where.status = status;
    }
    const q = this.optionalString(query.q);
    if (q) {
      where.OR = [
        { displayName: { contains: q } },
        { title: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { wechat: { contains: q } },
        { sourceKeyword: { contains: q } },
        { matchedKeyword: { contains: q } },
        { sourceText: { contains: q } },
        { company: { name: { contains: q } } },
      ];
    }

    const customers = await this.prisma.crmCustomer.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
      include: {
        company: true,
        _count: {
          select: { timelineEvents: true, tasks: true, notes: true },
        },
      },
    });

    return customers.map((customer) => this.toCustomerDto(customer));
  }

  async listContacts(userId: string, query: CollectionQuery = {}) {
    return this.listCustomers(userId, query);
  }

  async createCustomer(userId: string, input: CustomerInput) {
    await this.requireCrmMutationScope(userId);
    const tenantId = await this.resolveCrmTenantId(userId);
    const displayName = this.requiredString(
      input.displayName,
      '客户名称不能为空',
    );
    const sourceAccountId = this.optionalString(input.sourceAccountId);
    if (sourceAccountId) {
      await this.assertCrmPlatformAccountScope(
        userId,
        input.sourcePlatform,
        sourceAccountId,
      );
    }
    const companyId = await this.resolveCompanyId(userId, input);
    const dedupeKey =
      this.optionalString(input.dedupeKey) ||
      this.createManualDedupeKey(displayName, input);
    const data = {
      ownerId: userId,
      actorUserId: userId,
      tenantId,
      displayName,
      companyId,
      title: this.optionalString(input.title),
      email: this.optionalString(input.email),
      phone: this.optionalString(input.phone),
      wechat: this.optionalString(input.wechat),
      status: this.optionalString(input.status) || 'new',
      sourcePlatform: this.optionalString(input.sourcePlatform),
      sourceKeyword: this.optionalString(input.sourceKeyword),
      matchedKeyword: this.optionalString(input.matchedKeyword),
      sourceUrl: this.optionalString(input.sourceUrl),
      sourceText: this.optionalString(input.sourceText),
      latestReply: this.optionalString(input.latestReply),
      score: this.normalizeScore(input.score),
      tags: this.toStringArray(input.tags),
      profileUrl: this.optionalString(input.profileUrl),
      externalUserId: this.optionalString(input.externalUserId),
      dedupeKey,
      metadata: this.mergeCustomerMetadata({}, input),
    };

    const customer = await this.prisma.crmCustomer.upsert({
      where: this.customerDedupeWhere(userId, tenantId, dedupeKey),
      create: data,
      update: {
        tenantId,
        displayName: data.displayName,
        companyId: data.companyId,
        title: data.title,
        email: data.email,
        phone: data.phone,
        wechat: data.wechat,
        status: data.status,
        sourcePlatform: data.sourcePlatform,
        sourceKeyword: data.sourceKeyword,
        matchedKeyword: data.matchedKeyword,
        sourceUrl: data.sourceUrl,
        sourceText: data.sourceText,
        latestReply: data.latestReply,
        score: data.score,
        tags: data.tags,
        profileUrl: data.profileUrl,
        externalUserId: data.externalUserId,
        metadata: data.metadata,
        archivedAt: null,
      },
    });

    await this.appendTimeline(userId, {
      customerId: customer.id,
      companyId: customer.companyId,
      eventType: 'customer_created',
      channel: data.sourcePlatform || 'manual',
      content: data.sourceText || `创建客户：${data.displayName}`,
      replyContent: data.latestReply,
      status: customer.status,
      metadata: {
        sourceKeyword: data.sourceKeyword,
        matchedKeyword: data.matchedKeyword,
        dedupeKey,
      },
    });

    return this.getCustomer(userId, customer.id);
  }

  async getCustomer(userId: string, customerId: string) {
    const scope =
      await this.scopedCrmWhere<Prisma.CrmCustomerWhereInput>(userId);
    const customer = await this.prisma.crmCustomer.findFirst({
      where: { ...scope, id: customerId },
      include: {
        company: true,
        _count: {
          select: { timelineEvents: true, tasks: true, notes: true },
        },
      },
    });
    if (!customer) throw new NotFoundException('客户不存在');
    return this.toCustomerDto(customer);
  }

  async getCustomerContinuity(userId: string, customerId: string) {
    const customer = await this.getCustomer(userId, customerId);
    const [tasks, notes, timeline] = await Promise.all([
      this.listTasks(userId, { customerId }),
      this.listNotes(userId, { customerId }),
      this.listTimeline(userId, { customerId }),
    ]);

    return {
      customer,
      tasks,
      notes,
      timeline,
    };
  }

  async updateCustomer(
    userId: string,
    customerId: string,
    input: CustomerInput,
  ) {
    await this.requireCrmMutationScope(userId);
    const current = await this.getCustomer(userId, customerId);
    const sourceAccountId = this.optionalString(input.sourceAccountId);
    if (sourceAccountId) {
      await this.assertCrmPlatformAccountScope(
        userId,
        input.sourcePlatform || current.sourcePlatform,
        sourceAccountId,
        current.sourceAccount?.id,
      );
    }
    const updateData: Prisma.CrmCustomerUpdateInput = {};
    for (const key of [
      'displayName',
      'title',
      'email',
      'phone',
      'wechat',
      'status',
      'sourcePlatform',
      'sourceKeyword',
      'matchedKeyword',
      'sourceUrl',
      'sourceText',
      'latestReply',
      'profileUrl',
      'externalUserId',
      'dedupeKey',
    ] as const) {
      if (key in input) {
        const value = this.optionalString(input[key]);
        if (value !== null || !['displayName', 'status'].includes(key)) {
          (updateData as Record<string, unknown>)[key] = value;
        }
      }
    }
    if ('companyId' in input || 'companyName' in input) {
      const companyId = await this.resolveCompanyId(userId, input);
      updateData.company = companyId
        ? {
            connect: {
              id: companyId,
            },
          }
        : { disconnect: true };
    }
    if ('score' in input) updateData.score = this.normalizeScore(input.score);
    if ('tags' in input) updateData.tags = this.toStringArray(input.tags);
    if (
      'metadata' in input ||
      'sourceAccountId' in input ||
      'sourceAccountName' in input ||
      'sourcePlatform' in input
    ) {
      updateData.metadata = this.mergeCustomerMetadata(current.metadata, input);
    }

    const customer = await this.prisma.crmCustomer.update({
      where: { id: customerId },
      data: updateData,
    });
    await this.appendTimeline(userId, {
      customerId,
      companyId: customer.companyId,
      eventType: 'customer_updated',
      channel: 'crm',
      content: '更新客户资料',
      status: this.optionalString(input.status),
      metadata: { changedFields: Object.keys(updateData) },
    });
    return this.getCustomer(userId, customerId);
  }

  async archiveCustomer(userId: string, customerId: string) {
    await this.requireCrmMutationScope(userId);
    await this.getCustomer(userId, customerId);
    const customer = await this.prisma.crmCustomer.update({
      where: { id: customerId },
      data: {
        status: 'archived',
        archivedAt: new Date(),
      },
    });
    await this.appendTimeline(userId, {
      customerId,
      companyId: customer.companyId,
      eventType: 'customer_archived',
      channel: 'crm',
      content: '客户已归档',
      status: 'archived',
    });
    return this.getCustomer(userId, customerId);
  }

  async listCompanies(userId: string, query: CollectionQuery = {}) {
    const where =
      await this.scopedCrmWhere<Prisma.CrmCompanyWhereInput>(userId);
    if (query.status !== 'archived') where.archivedAt = null;
    const q = this.optionalString(query.q);
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { domain: { contains: q } },
        { industry: { contains: q } },
        { city: { contains: q } },
      ];
    }
    const companies = await this.prisma.crmCompany.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
      include: {
        _count: {
          select: {
            customers: true,
            opportunities: true,
            tasks: true,
            notes: true,
          },
        },
      },
    });
    return companies.map((company) => this.toCompanyDto(company));
  }

  async createCompany(userId: string, input: CompanyInput) {
    await this.requireCrmMutationScope(userId);
    const tenantId = await this.resolveCrmTenantId(userId);
    const name = this.requiredString(input.name, '公司名称不能为空');
    const company = await this.prisma.crmCompany.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId,
        name,
        domain: this.optionalString(input.domain),
        industry: this.optionalString(input.industry),
        phone: this.optionalString(input.phone),
        website: this.optionalString(input.website),
        city: this.optionalString(input.city),
        employees: this.optionalInt(input.employees),
        annualRevenueCents: this.optionalInt(input.annualRevenueCents) ?? 0,
        tags: this.toStringArray(input.tags),
        metadata: this.toRecord(input.metadata),
      },
    });
    await this.appendTimeline(userId, {
      companyId: company.id,
      eventType: 'company_created',
      channel: 'crm',
      content: `创建公司：${company.name}`,
    });
    return this.getCompany(userId, company.id);
  }

  async getCompany(userId: string, companyId: string) {
    const scope =
      await this.scopedCrmWhere<Prisma.CrmCompanyWhereInput>(userId);
    const company = await this.prisma.crmCompany.findFirst({
      where: { ...scope, id: companyId },
      include: {
        customers: {
          where: { archivedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        },
        opportunities: {
          where: { archivedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        },
        _count: {
          select: {
            customers: true,
            opportunities: true,
            tasks: true,
            notes: true,
          },
        },
      },
    });
    if (!company) throw new NotFoundException('公司不存在');
    return this.toCompanyDto(company);
  }

  async updateCompany(userId: string, companyId: string, input: CompanyInput) {
    await this.requireCrmMutationScope(userId);
    await this.getCompany(userId, companyId);
    const data: Prisma.CrmCompanyUpdateInput = {};
    for (const key of [
      'name',
      'domain',
      'industry',
      'phone',
      'website',
      'city',
    ] as const) {
      if (key in input) {
        const value = this.optionalString(input[key]);
        if (value !== null || key !== 'name') {
          (data as Record<string, unknown>)[key] = value;
        }
      }
    }
    if ('employees' in input)
      data.employees = this.optionalInt(input.employees);
    if ('annualRevenueCents' in input) {
      data.annualRevenueCents = this.optionalInt(input.annualRevenueCents) ?? 0;
    }
    if ('tags' in input) data.tags = this.toStringArray(input.tags);
    if ('metadata' in input) data.metadata = this.toRecord(input.metadata);
    const company = await this.prisma.crmCompany.update({
      where: { id: companyId },
      data,
    });
    await this.appendTimeline(userId, {
      companyId,
      eventType: 'company_updated',
      channel: 'crm',
      content: `更新公司：${company.name}`,
      metadata: { changedFields: Object.keys(data) },
    });
    return this.getCompany(userId, companyId);
  }

  async archiveCompany(userId: string, companyId: string) {
    await this.requireCrmMutationScope(userId);
    const current = await this.getCompany(userId, companyId);
    await this.prisma.crmCompany.update({
      where: { id: companyId },
      data: { archivedAt: new Date() },
    });
    await this.appendTimeline(userId, {
      companyId,
      eventType: 'company_archived',
      channel: 'crm',
      content: `公司已归档：${current.name}`,
      status: 'archived',
    });
    return this.getCompany(userId, companyId);
  }

  async listOpportunities(userId: string, query: CollectionQuery = {}) {
    const where: Prisma.CrmOpportunityWhereInput = {
      ...(await this.scopedCrmWhere<Prisma.CrmOpportunityWhereInput>(userId)),
      archivedAt: null,
    };
    const stage = this.optionalString(query.stage || query.status);
    if (stage && stage !== 'all') where.stage = stage;
    const q = this.optionalString(query.q);
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { stage: { contains: q } },
        { nextStep: { contains: q } },
        { competitor: { contains: q } },
        { company: { name: { contains: q } } },
        { primaryCustomer: { displayName: { contains: q } } },
      ];
    }
    const opportunities = await this.prisma.crmOpportunity.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
      include: {
        company: true,
        primaryCustomer: true,
        _count: { select: { tasks: true, notes: true, timelineEvents: true } },
      },
    });
    return opportunities.map((opportunity) =>
      this.toOpportunityDto(opportunity),
    );
  }

  /** S0-P1-8：商机阶段白名单校验，防自由字符串（如 won+0 / 无原因关闭） */
  private validateOpportunityStage(stage: string): void {
    if (!(OPPORTUNITY_STAGES as readonly string[]).includes(stage)) {
      throw new BadRequestException(
        `不支持的商机阶段：${stage}（可选：${OPPORTUNITY_STAGES.join(' / ')}）`,
      );
    }
  }

  async createOpportunity(userId: string, input: OpportunityInput) {
    await this.requireCrmMutationScope(userId);
    const tenantId = await this.resolveCrmTenantId(userId);
    const name = this.requiredString(input.name, '商机名称不能为空');
    const stage = (this.optionalString(input.stage) || 'qualified') as string;
    this.validateOpportunityStage(stage);
    const companyId = await this.resolveCompanyId(userId, input);
    const primaryCustomerId = await this.resolveCustomerId(
      userId,
      input.primaryCustomerId,
    );
    const opportunity = await this.prisma.crmOpportunity.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId,
        name,
        stage,
        amountCents: this.optionalInt(input.amountCents) ?? 0,
        currency: this.optionalString(input.currency) || 'CNY',
        probability: this.normalizeProbability(input.probability),
        companyId,
        primaryCustomerId,
        closeDate: this.optionalDate(input.closeDate),
        nextStep: this.optionalString(input.nextStep),
        competitor: this.optionalString(input.competitor),
        source: this.optionalString(input.source),
        winReason: this.optionalString(input.winReason),
        loseReason: this.optionalString(input.loseReason),
        metadata: this.toRecord(input.metadata),
      },
    });
    await this.appendTimeline(userId, {
      companyId: opportunity.companyId,
      customerId: opportunity.primaryCustomerId,
      opportunityId: opportunity.id,
      eventType: 'opportunity_created',
      channel: 'crm',
      content: `创建商机：${opportunity.name}`,
      status: opportunity.stage,
    });
    return this.getOpportunity(userId, opportunity.id);
  }

  async getOpportunity(userId: string, opportunityId: string) {
    const scope =
      await this.scopedCrmWhere<Prisma.CrmOpportunityWhereInput>(userId);
    const opportunity = await this.prisma.crmOpportunity.findFirst({
      where: { ...scope, id: opportunityId },
      include: {
        company: true,
        primaryCustomer: true,
        tasks: { where: { archivedAt: null }, orderBy: { updatedAt: 'desc' } },
        notes: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' } },
        _count: { select: { tasks: true, notes: true, timelineEvents: true } },
      },
    });
    if (!opportunity) throw new NotFoundException('商机不存在');
    return this.toOpportunityDto(opportunity);
  }

  async updateOpportunity(
    userId: string,
    opportunityId: string,
    input: OpportunityInput,
  ) {
    await this.requireCrmMutationScope(userId);
    await this.getOpportunity(userId, opportunityId);
    const data: Prisma.CrmOpportunityUpdateInput = {};
    for (const key of [
      'name',
      'stage',
      'currency',
      'nextStep',
      'competitor',
      'source',
      'winReason',
      'loseReason',
    ] as const) {
      if (key in input) {
        const value = this.optionalString(input[key]);
        if (key === 'stage' && value) {
          this.validateOpportunityStage(value);
        }
        if (value !== null || !['name', 'stage', 'currency'].includes(key)) {
          (data as Record<string, unknown>)[key] = value;
        }
      }
    }
    if ('amountCents' in input)
      data.amountCents = this.optionalInt(input.amountCents) ?? 0;
    if ('probability' in input)
      data.probability = this.normalizeProbability(input.probability);
    if ('closeDate' in input)
      data.closeDate = this.optionalDate(input.closeDate);
    if ('metadata' in input) data.metadata = this.toRecord(input.metadata);
    if ('companyId' in input || 'companyName' in input) {
      const companyId = await this.resolveCompanyId(userId, input);
      data.company = companyId
        ? { connect: { id: companyId } }
        : { disconnect: true };
    }
    if ('primaryCustomerId' in input) {
      const customerId = await this.resolveCustomerId(
        userId,
        input.primaryCustomerId,
      );
      data.primaryCustomer = customerId
        ? { connect: { id: customerId } }
        : { disconnect: true };
    }
    const opportunity = await this.prisma.crmOpportunity.update({
      where: { id: opportunityId },
      data,
    });
    await this.appendTimeline(userId, {
      companyId: opportunity.companyId,
      customerId: opportunity.primaryCustomerId,
      opportunityId,
      eventType: 'opportunity_updated',
      channel: 'crm',
      content: `更新商机：${opportunity.name}`,
      status: opportunity.stage,
      metadata: { changedFields: Object.keys(data) },
    });
    return this.getOpportunity(userId, opportunityId);
  }

  async archiveOpportunity(userId: string, opportunityId: string) {
    await this.requireCrmMutationScope(userId);
    const current = await this.getOpportunity(userId, opportunityId);
    const opportunity = await this.prisma.crmOpportunity.update({
      where: { id: opportunityId },
      data: { archivedAt: new Date() },
    });
    await this.appendTimeline(userId, {
      companyId: opportunity.companyId,
      customerId: opportunity.primaryCustomerId,
      opportunityId,
      eventType: 'opportunity_archived',
      channel: 'crm',
      content: `商机已归档：${current.name}`,
      status: 'archived',
    });
    return this.getOpportunity(userId, opportunityId);
  }

  async listTasks(userId: string, query: CollectionQuery = {}) {
    const where: Prisma.CrmTaskWhereInput = {
      ...(await this.scopedCrmWhere<Prisma.CrmTaskWhereInput>(userId)),
      archivedAt: null,
    };
    const status = this.optionalString(query.status);
    if (status && status !== 'all') where.status = status;
    const customerId = this.optionalString(query.customerId);
    if (customerId) where.customerId = customerId;
    const q = this.optionalString(query.q);
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { description: { contains: q } },
        { company: { name: { contains: q } } },
        { customer: { displayName: { contains: q } } },
        { opportunity: { name: { contains: q } } },
      ];
    }
    const tasks = await this.prisma.crmTask.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
      include: { company: true, customer: true, opportunity: true },
    });
    return tasks.map((task) => this.toTaskDto(task));
  }

  async createTask(userId: string, input: TaskInput) {
    await this.requireCrmMutationScope(userId);
    const tenantId = await this.resolveCrmTenantId(userId);
    const title = this.requiredString(input.title, '任务标题不能为空');
    const customerId = await this.resolveCustomerId(userId, input.customerId);
    const opportunityId = await this.resolveOpportunityId(
      userId,
      input.opportunityId,
    );
    const companyId = await this.resolveRelatedCompanyId(userId, {
      companyId: input.companyId,
      customerId,
      opportunityId,
    });
    const task = await this.prisma.crmTask.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId,
        title,
        description: this.optionalString(input.description),
        status: this.optionalString(input.status) || 'open',
        priority: this.optionalString(input.priority) || 'normal',
        dueAt: this.optionalDate(input.dueAt),
        assigneeId: this.optionalString(input.assigneeId) || userId,
        companyId,
        customerId,
        opportunityId,
        metadata: this.toRecord(input.metadata),
      },
    });
    await this.appendTimeline(userId, {
      companyId: task.companyId,
      customerId: task.customerId,
      opportunityId: task.opportunityId,
      taskId: task.id,
      eventType: 'task_created',
      channel: 'crm',
      content: `创建任务：${task.title}`,
      status: task.status,
    });
    return this.getTask(userId, task.id);
  }

  async getTask(userId: string, taskId: string) {
    const scope = await this.scopedCrmWhere<Prisma.CrmTaskWhereInput>(userId);
    const task = await this.prisma.crmTask.findFirst({
      where: { ...scope, id: taskId },
      include: { company: true, customer: true, opportunity: true },
    });
    if (!task) throw new NotFoundException('任务不存在');
    return this.toTaskDto(task);
  }

  async updateTask(userId: string, taskId: string, input: TaskInput) {
    await this.requireCrmMutationScope(userId);
    await this.getTask(userId, taskId);
    const data: Prisma.CrmTaskUpdateInput = {};
    for (const key of [
      'title',
      'description',
      'status',
      'priority',
      'assigneeId',
    ] as const) {
      if (key in input) {
        const value = this.optionalString(input[key]);
        if (value !== null || !['title', 'status', 'priority'].includes(key)) {
          (data as Record<string, unknown>)[key] = value;
        }
      }
    }
    if ('dueAt' in input) data.dueAt = this.optionalDate(input.dueAt);
    if ('metadata' in input) data.metadata = this.toRecord(input.metadata);
    if ('companyId' in input) {
      const companyId = await this.resolveCompanyId(userId, input);
      data.company = companyId
        ? { connect: { id: companyId } }
        : { disconnect: true };
    }
    if ('customerId' in input) {
      const customerId = await this.resolveCustomerId(userId, input.customerId);
      data.customer = customerId
        ? { connect: { id: customerId } }
        : { disconnect: true };
    }
    if ('opportunityId' in input) {
      const opportunityId = await this.resolveOpportunityId(
        userId,
        input.opportunityId,
      );
      data.opportunity = opportunityId
        ? { connect: { id: opportunityId } }
        : { disconnect: true };
    }
    if (
      !('companyId' in input) &&
      ('customerId' in input || 'opportunityId' in input)
    ) {
      const scope = await this.scopedCrmWhere<Prisma.CrmTaskWhereInput>(userId);
      const current = await this.prisma.crmTask.findFirst({
        where: { ...scope, id: taskId },
      });
      const customerId =
        'customerId' in input
          ? await this.resolveCustomerId(userId, input.customerId)
          : (current?.customerId ?? null);
      const opportunityId =
        'opportunityId' in input
          ? await this.resolveOpportunityId(userId, input.opportunityId)
          : (current?.opportunityId ?? null);
      const companyId = await this.resolveRelatedCompanyId(userId, {
        customerId,
        opportunityId,
      });
      data.company = companyId
        ? { connect: { id: companyId } }
        : { disconnect: true };
    }
    const task = await this.prisma.crmTask.update({
      where: { id: taskId },
      data,
    });
    await this.appendTimeline(userId, {
      companyId: task.companyId,
      customerId: task.customerId,
      opportunityId: task.opportunityId,
      taskId,
      eventType: 'task_updated',
      channel: 'crm',
      content: `更新任务：${task.title}`,
      status: task.status,
      metadata: { changedFields: Object.keys(data) },
    });
    return this.getTask(userId, taskId);
  }

  async completeTask(userId: string, taskId: string) {
    await this.requireCrmMutationScope(userId);
    await this.getTask(userId, taskId);
    const task = await this.prisma.crmTask.update({
      where: { id: taskId },
      data: { status: 'done', completedAt: new Date() },
    });
    await this.appendTimeline(userId, {
      companyId: task.companyId,
      customerId: task.customerId,
      opportunityId: task.opportunityId,
      taskId,
      eventType: 'task_completed',
      channel: 'crm',
      content: `完成任务：${task.title}`,
      status: 'done',
    });
    return this.getTask(userId, taskId);
  }

  async archiveTask(userId: string, taskId: string) {
    await this.requireCrmMutationScope(userId);
    const current = await this.getTask(userId, taskId);
    const task = await this.prisma.crmTask.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });
    await this.appendTimeline(userId, {
      companyId: task.companyId,
      customerId: task.customerId,
      opportunityId: task.opportunityId,
      taskId,
      eventType: 'task_archived',
      channel: 'crm',
      content: `任务已归档：${current.title}`,
      status: 'archived',
    });
    return this.getTask(userId, taskId);
  }

  async listNotes(userId: string, query: CollectionQuery = {}) {
    const where: Prisma.CrmNoteWhereInput = {
      ...(await this.scopedCrmWhere<Prisma.CrmNoteWhereInput>(userId)),
      archivedAt: null,
      NOT: { createdBy: CRM_WELCOME_TEMPLATE_CREATED_BY },
    };
    const customerId = this.optionalString(query.customerId);
    if (customerId) where.customerId = customerId;
    const q = this.optionalString(query.q);
    if (q) {
      where.OR = [
        { body: { contains: q } },
        { company: { name: { contains: q } } },
        { customer: { displayName: { contains: q } } },
        { opportunity: { name: { contains: q } } },
      ];
    }
    const notes = await this.prisma.crmNote.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      include: { company: true, customer: true, opportunity: true },
    });
    return notes.map((note) => this.toNoteDto(note));
  }

  async createNote(userId: string, input: NoteInput) {
    await this.requireCrmMutationScope(userId);
    const tenantId = await this.resolveCrmTenantId(userId);
    const body = this.requiredString(input.body, '备注内容不能为空');
    const customerId = await this.resolveCustomerId(userId, input.customerId);
    const opportunityId = await this.resolveOpportunityId(
      userId,
      input.opportunityId,
    );
    const companyId = await this.resolveRelatedCompanyId(userId, {
      companyId: input.companyId,
      customerId,
      opportunityId,
    });
    const note = await this.prisma.crmNote.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId,
        body,
        createdBy: this.optionalString(input.createdBy) || userId,
        companyId,
        customerId,
        opportunityId,
        metadata: this.toRecord(input.metadata),
      },
    });
    await this.appendTimeline(userId, {
      companyId: note.companyId,
      customerId: note.customerId,
      opportunityId: note.opportunityId,
      noteId: note.id,
      eventType: 'note_created',
      channel: 'crm',
      content: body,
    });
    return this.getNote(userId, note.id);
  }

  async getNote(userId: string, noteId: string) {
    const scope = await this.scopedCrmWhere<Prisma.CrmNoteWhereInput>(userId);
    const note = await this.prisma.crmNote.findFirst({
      where: {
        ...scope,
        id: noteId,
        NOT: { createdBy: CRM_WELCOME_TEMPLATE_CREATED_BY },
      },
      include: { company: true, customer: true, opportunity: true },
    });
    if (!note) throw new NotFoundException('备注不存在');
    return this.toNoteDto(note);
  }

  async updateNote(userId: string, noteId: string, input: NoteInput) {
    await this.requireCrmMutationScope(userId);
    await this.getNote(userId, noteId);
    const data: Prisma.CrmNoteUpdateInput = {};
    if ('body' in input)
      data.body = this.requiredString(input.body, '备注内容不能为空');
    if ('createdBy' in input)
      data.createdBy = this.optionalString(input.createdBy);
    if ('metadata' in input) data.metadata = this.toRecord(input.metadata);
    if ('companyId' in input) {
      const companyId = await this.resolveCompanyId(userId, input);
      data.company = companyId
        ? { connect: { id: companyId } }
        : { disconnect: true };
    }
    if ('customerId' in input) {
      const customerId = await this.resolveCustomerId(userId, input.customerId);
      data.customer = customerId
        ? { connect: { id: customerId } }
        : { disconnect: true };
    }
    if ('opportunityId' in input) {
      const opportunityId = await this.resolveOpportunityId(
        userId,
        input.opportunityId,
      );
      data.opportunity = opportunityId
        ? { connect: { id: opportunityId } }
        : { disconnect: true };
    }
    if (
      !('companyId' in input) &&
      ('customerId' in input || 'opportunityId' in input)
    ) {
      const scope = await this.scopedCrmWhere<Prisma.CrmNoteWhereInput>(userId);
      const current = await this.prisma.crmNote.findFirst({
        where: { ...scope, id: noteId },
      });
      const customerId =
        'customerId' in input
          ? await this.resolveCustomerId(userId, input.customerId)
          : (current?.customerId ?? null);
      const opportunityId =
        'opportunityId' in input
          ? await this.resolveOpportunityId(userId, input.opportunityId)
          : (current?.opportunityId ?? null);
      const companyId = await this.resolveRelatedCompanyId(userId, {
        customerId,
        opportunityId,
      });
      data.company = companyId
        ? { connect: { id: companyId } }
        : { disconnect: true };
    }
    const note = await this.prisma.crmNote.update({
      where: { id: noteId },
      data,
    });
    await this.appendTimeline(userId, {
      companyId: note.companyId,
      customerId: note.customerId,
      opportunityId: note.opportunityId,
      noteId,
      eventType: 'note_updated',
      channel: 'crm',
      content: '更新备注',
      metadata: { changedFields: Object.keys(data) },
    });
    return this.getNote(userId, noteId);
  }

  async archiveNote(userId: string, noteId: string) {
    await this.requireCrmMutationScope(userId);
    await this.getNote(userId, noteId);
    const note = await this.prisma.crmNote.update({
      where: { id: noteId },
      data: { archivedAt: new Date() },
    });
    await this.appendTimeline(userId, {
      companyId: note.companyId,
      customerId: note.customerId,
      opportunityId: note.opportunityId,
      noteId,
      eventType: 'note_archived',
      channel: 'crm',
      content: '备注已归档',
      status: 'archived',
    });
    return this.getNote(userId, noteId);
  }

  async listWelcomeMessageTemplates(userId: string) {
    const scope = await this.scopedCrmWhere<Prisma.CrmNoteWhereInput>(userId);
    const templates = await this.prisma.crmNote.findMany({
      where: {
        ...scope,
        createdBy: CRM_WELCOME_TEMPLATE_CREATED_BY,
        archivedAt: null,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 100,
    });
    return templates.map((template) =>
      this.toWelcomeMessageTemplateDto(template),
    );
  }

  async createWelcomeMessageTemplate(
    userId: string,
    input: WelcomeMessageTemplateInput,
  ) {
    await this.requireCrmMutationScope(userId);
    const name = this.requiredString(input.name, '模板名称不能为空');
    const body = this.requiredString(input.body, '模板内容不能为空');
    const channel = this.normalizeWelcomeMessageChannel(input.channel);
    const template = await this.prisma.crmNote.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId: await this.resolveCrmTenantId(userId),
        body,
        createdBy: CRM_WELCOME_TEMPLATE_CREATED_BY,
        metadata: {
          kind: CRM_WELCOME_TEMPLATE_KIND,
          name,
          channel,
        },
      },
    });
    return this.toWelcomeMessageTemplateDto(template);
  }

  async getWelcomeMessageTemplate(userId: string, templateId: string) {
    const scope = await this.scopedCrmWhere<Prisma.CrmNoteWhereInput>(userId);
    const template = await this.prisma.crmNote.findFirst({
      where: {
        ...scope,
        id: templateId,
        createdBy: CRM_WELCOME_TEMPLATE_CREATED_BY,
        archivedAt: null,
      },
    });
    if (!template) throw new NotFoundException('欢迎消息模板不存在');
    return this.toWelcomeMessageTemplateDto(template);
  }

  async updateWelcomeMessageTemplate(
    userId: string,
    templateId: string,
    input: WelcomeMessageTemplateInput,
  ) {
    await this.requireCrmMutationScope(userId);
    const current = await this.getWelcomeMessageTemplate(userId, templateId);
    const name =
      'name' in input
        ? this.requiredString(input.name, '模板名称不能为空')
        : current.name;
    const body =
      'body' in input
        ? this.requiredString(input.body, '模板内容不能为空')
        : current.body;
    const channel =
      'channel' in input
        ? this.normalizeWelcomeMessageChannel(input.channel)
        : current.channel;
    const template = await this.prisma.crmNote.update({
      where: { id: templateId },
      data: {
        body,
        metadata: {
          ...this.toRecord(current.metadata),
          kind: CRM_WELCOME_TEMPLATE_KIND,
          name,
          channel,
        },
      },
    });
    return this.toWelcomeMessageTemplateDto(template);
  }

  async archiveWelcomeMessageTemplate(userId: string, templateId: string) {
    await this.requireCrmMutationScope(userId);
    await this.getWelcomeMessageTemplate(userId, templateId);
    const template = await this.prisma.crmNote.update({
      where: { id: templateId },
      data: { archivedAt: new Date() },
    });
    return this.toWelcomeMessageTemplateDto(template);
  }

  async prepareWelcomeMessage(
    userId: string,
    customerId: string,
    input: WelcomeMessagePreparationInput,
  ) {
    await this.requireCrmMutationScope(userId, { platformAccount: true });
    const customer = await this.getCustomer(userId, customerId);
    const templateId = this.optionalString(input.templateId);
    const template = templateId
      ? await this.getWelcomeMessageTemplate(userId, templateId)
      : null;
    const rawMessage =
      this.optionalString(input.message) ||
      this.optionalString(template?.body) ||
      null;
    if (!rawMessage) {
      throw new BadRequestException('请选择模板或填写欢迎消息');
    }
    const message = this.renderWelcomeMessage(rawMessage, customer);
    const channel = this.normalizeWelcomeMessageChannel(
      input.channel ||
        template?.channel ||
        customer.sourcePlatform ||
        undefined,
    );
    const accountId =
      this.optionalString(input.accountId) ||
      customer.sourceAccount?.id ||
      null;
    const accountName =
      this.optionalString(input.accountName) ||
      customer.sourceAccount?.name ||
      null;
    if (accountId) {
      await this.assertCrmPlatformAccountScope(
        userId,
        channel,
        accountId,
        customer.sourceAccount?.id,
      );
    }
    const targetName =
      customer.externalUserId ||
      customer.wechat ||
      customer.phone ||
      customer.email ||
      customer.displayName;
    const prepared = await this.appendTimeline(userId, {
      customerId: customer.id,
      companyId: customer.companyId,
      eventType: CRM_WELCOME_PREPARATION_EVENT,
      channel,
      content: '欢迎消息测试发送已准备，尚未发送',
      replyContent: message,
      status: 'prepared',
      metadata: {
        templateId: template?.id || null,
        templateName: template?.name || null,
        targetName,
        accountId,
        accountName,
        sendMode: 'auto-send',
        externalSendRequested: false,
        deliveryConfirmed: false,
        requiresExternalReadback: true,
      },
    });
    return this.toWelcomeMessagePreparationDto(prepared, customer);
  }

  async getWelcomeMessagePreparation(
    userId: string,
    customerId: string,
    preparationId: string,
  ) {
    const customer = await this.getCustomer(userId, customerId);
    const scope =
      await this.scopedCrmWhere<Prisma.CrmTimelineEventWhereInput>(userId);
    const preparation = await this.prisma.crmTimelineEvent.findFirst({
      where: {
        ...scope,
        id: preparationId,
        customerId,
        eventType: CRM_WELCOME_PREPARATION_EVENT,
      },
    });
    if (!preparation) throw new NotFoundException('欢迎消息准备记录不存在');
    return this.toWelcomeMessagePreparationDto(preparation, customer);
  }

  async linkCustomerConversation(
    userId: string,
    customerId: string,
    input: CustomerConversationLinkInput,
  ) {
    const membership = await this.requireCrmMutationScope(userId, {
      platformAccount: true,
    });
    const interactionTaskId = this.requiredString(
      input.interactionTaskId,
      '互动任务 ID 不能为空',
    );
    const preparationId = this.requiredString(
      input.preparationId,
      '准备记录 ID 不能为空',
    );
    const preparation = await this.getWelcomeMessagePreparation(
      userId,
      customerId,
      preparationId,
    );
    const interactionTask = await this.prisma.interactionTask.findFirst({
      where: {
        id: interactionTaskId,
        userId,
        tenantId: membership.tenantId || undefined,
      },
      select: {
        id: true,
        taskType: true,
        accountId: true,
        sendMode: true,
        status: true,
      },
    });
    if (!interactionTask) throw new NotFoundException('互动任务不存在');
    if (interactionTask.accountId) {
      await this.assertCrmPlatformAccountScope(
        userId,
        preparation.channel,
        interactionTask.accountId,
        preparation.accountId,
      );
    }

    const customer = await this.getCustomer(userId, customerId);
    await this.prisma.crmCustomer.update({
      where: { id: customerId },
      data: {
        firstInteractionTaskId:
          customer.firstInteractionTaskId || interactionTaskId,
        latestInteractionTaskId: interactionTaskId,
      },
    });
    const status = String(interactionTask.status).toLowerCase();
    await this.appendTimeline(userId, {
      customerId,
      companyId: customer.companyId,
      relatedInteractionTaskId: interactionTaskId,
      eventType: 'welcome_message_interaction_started',
      channel: preparation.channel,
      content: '欢迎消息测试发送已交给客户互动任务',
      replyContent: preparation.message,
      status,
      metadata: {
        preparationId,
        accountId: interactionTask.accountId || preparation.accountId,
        sendMode: interactionTask.sendMode,
        externalSendRequested: true,
        deliveryConfirmed: false,
        requiresExternalReadback: true,
      },
    });

    return {
      customerId,
      preparationId,
      interactionTaskId,
      status,
      deliveryConfirmed: false,
      requiresExternalReadback: true,
    };
  }

  async getTimeline(userId: string, customerId: string) {
    await this.getCustomer(userId, customerId);
    return this.listTimeline(userId, { customerId });
  }

  async listTimeline(
    userId: string,
    filters: {
      customerId?: string | null;
      companyId?: string | null;
      opportunityId?: string | null;
      taskId?: string | null;
      noteId?: string | null;
    } = {},
  ) {
    const where =
      await this.scopedCrmWhere<Prisma.CrmTimelineEventWhereInput>(userId);
    for (const key of [
      'customerId',
      'companyId',
      'opportunityId',
      'taskId',
      'noteId',
    ] as const) {
      const value = this.optionalString(filters[key]);
      if (value) where[key] = value;
    }
    const events = await this.prisma.crmTimelineEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return events.map((event) => this.toTimelineDto(event));
  }

  async listImportBatches(userId: string) {
    const where =
      await this.scopedCrmWhere<Prisma.CrmImportBatchWhereInput>(userId);
    const batches = await this.prisma.crmImportBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        auditEvents: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    return batches.map((batch) => this.toImportBatchDto(batch));
  }

  async listAuditEvents(
    userId: string,
    filters: { importBatchId?: string | null; eventType?: string | null } = {},
  ) {
    const where =
      await this.scopedCrmWhere<Prisma.CrmAuditEventWhereInput>(userId);
    const importBatchId = this.optionalString(filters.importBatchId);
    if (importBatchId) where.importBatchId = importBatchId;
    const eventType = this.optionalString(filters.eventType);
    if (eventType) where.eventType = eventType;
    const events = await this.prisma.crmAuditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return events.map((event) => this.toAuditEventDto(event));
  }

  async getCloserAdvice(userId: string) {
    const generatedAtDate = new Date();
    const generatedAt = generatedAtDate.toISOString();
    const customerScope =
      await this.scopedCrmWhere<Prisma.CrmCustomerWhereInput>(userId);
    const opportunityScope =
      await this.scopedCrmWhere<Prisma.CrmOpportunityWhereInput>(userId);
    const taskScope =
      await this.scopedCrmWhere<Prisma.CrmTaskWhereInput>(userId);
    const timelineScope =
      await this.scopedCrmWhere<Prisma.CrmTimelineEventWhereInput>(userId);

    const [customers, opportunities, tasks, timelineEvents] = await Promise.all(
      [
        this.prisma.crmCustomer.findMany({
          where: { ...customerScope, archivedAt: null },
          orderBy: [{ updatedAt: 'desc' }],
          take: 100,
          include: {
            company: true,
            _count: {
              select: { timelineEvents: true, tasks: true, notes: true },
            },
          },
        }),
        this.prisma.crmOpportunity.findMany({
          where: {
            ...opportunityScope,
            archivedAt: null,
            stage: { notIn: ['won', 'lost'] },
          },
          orderBy: [{ closeDate: 'asc' }, { updatedAt: 'desc' }],
          take: 100,
          include: {
            company: true,
            primaryCustomer: true,
            _count: {
              select: { tasks: true, notes: true, timelineEvents: true },
            },
          },
        }),
        this.prisma.crmTask.findMany({
          where: {
            ...taskScope,
            archivedAt: null,
            status: { not: 'done' },
          },
          orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
          take: 100,
          include: { company: true, customer: true, opportunity: true },
        }),
        this.prisma.crmTimelineEvent.findMany({
          where: timelineScope,
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
      ],
    );

    const timelineStats = this.buildTimelineStats(timelineEvents);
    const adviceCandidates = [
      ...tasks.map((task) =>
        this.createTaskCloserAdvice(task, generatedAtDate, timelineStats),
      ),
      ...opportunities.map((opportunity) =>
        this.createOpportunityCloserAdvice(
          opportunity,
          generatedAtDate,
          timelineStats,
        ),
      ),
      ...customers.map((customer) =>
        this.createCustomerCloserAdvice(
          customer,
          generatedAtDate,
          timelineStats,
        ),
      ),
    ].filter(Boolean) as Array<Record<string, unknown>>;
    const advice = adviceCandidates
      .sort((left, right) => {
        const scoreDelta = Number(right.score) - Number(left.score);
        if (scoreDelta !== 0) return scoreDelta;
        return String(left.sortKey).localeCompare(String(right.sortKey));
      })
      .slice(0, 12)
      .map(({ sortKey: _sortKey, ...item }) => item);
    const risks = this.createCloserRisks(
      customers,
      opportunities,
      tasks,
      generatedAtDate,
      timelineStats,
    );
    const overdueTaskCount = tasks.filter((task) =>
      this.isOverdue(task.dueAt, generatedAtDate),
    ).length;
    const newLeadCount = customers.filter((customer) =>
      this.isSameDay(customer.createdAt, generatedAtDate),
    ).length;
    const dueTodayCount = tasks.filter((task) =>
      this.isDueToday(task.dueAt, generatedAtDate),
    ).length;

    return {
      generatedAt,
      engine: 'deterministic-crm-rules-v1',
      mode: 'read-only-advice',
      noExternalLlm: true,
      safety: {
        humanReviewRequired: true,
        autoSend: false,
        autoWrite: false,
        writeTables: [],
        boundary:
          '基于 CRM 现有数据生成建议，不调用外部 LLM，不自动外发，不写客户或商机表。',
      },
      todayFollowUps: advice,
      risks,
      talkTracks: advice.map((item) => ({
        adviceId: item.id,
        targetName: item.targetName,
        script: item.script,
        sources: item.sources,
      })),
      dailySummary: {
        date: generatedAt.slice(0, 10),
        newLeads: newLeadCount,
        pendingFollowUps: tasks.length,
        dueToday: dueTodayCount,
        overdueTasks: overdueTaskCount,
        openOpportunities: opportunities.length,
        riskCount: risks.length,
        recommendedActionCount: advice.length,
        headline: `今日建议 ${advice.length} 个跟进动作，含 ${overdueTaskCount} 个逾期任务、${risks.length} 个风险提醒。`,
        recommendedSequence: advice.slice(0, 5).map((item) => ({
          adviceId: item.id,
          title: item.title,
          action: item.action,
        })),
      },
      sourceSnapshot: {
        customers: customers.length,
        opportunities: opportunities.length,
        openTasks: tasks.length,
        timelineEvents: timelineEvents.length,
      },
      audit: {
        actorUserId: userId,
        action: 'crm.closer.advice.generate',
        deterministic: true,
        externalNetwork: false,
        externalLlm: false,
        persisted: false,
        proofHash: this.createProofHash({
          generatedAt: generatedAt.slice(0, 10),
          customers: customers.map((customer) => customer.id),
          opportunities: opportunities.map((opportunity) => opportunity.id),
          tasks: tasks.map((task) => task.id),
          timelineEvents: timelineEvents.map((event) => event.id),
          adviceIds: advice.map((item) => item.id),
        }),
      },
    };
  }

  async getCloserSummary(
    userId: string,
    _input: { horizonDays?: unknown; includeDormant?: unknown } = {},
  ) {
    const advice = await this.generateCloserAdvice(userId, {});
    return advice.summary;
  }

  async generateCloserAdvice(
    userId: string,
    _input: {
      limit?: unknown;
      horizonDays?: unknown;
      includeDormant?: unknown;
    } = {},
  ) {
    const raw = (await this.getCloserAdvice(userId)) as {
      generatedAt: string;
      todayFollowUps: Array<Record<string, unknown>>;
      risks: Array<Record<string, unknown>>;
      dailySummary: Record<string, unknown>;
      safety?: Record<string, unknown>;
      audit?: { proofHash?: string };
    };
    const advice = raw.todayFollowUps.map((item) => ({
      id: String(item.id),
      title: safeText(item.title || '销售建议'),
      customerId: this.nullableString(item.customerId),
      customerName: this.nullableString(item.customerName),
      companyId: this.nullableString(item.companyId),
      companyName: this.nullableString(item.companyName),
      opportunityId: this.nullableString(item.opportunityId),
      opportunityName: this.nullableString(item.opportunityName),
      taskId: this.nullableString(item.taskId),
      priority:
        item.priority === 'urgent'
          ? 'high'
          : safeText(item.priority || 'medium'),
      riskLevel:
        item.priority === 'urgent' || item.priority === 'high'
          ? 'high'
          : 'medium',
      reason: safeText(item.reason || ''),
      recommendedAction: safeText(item.action || ''),
      suggestedScript: this.renderCloserScript(item.script),
      nextStep: safeText(
        (item.nextTask as { title?: string } | undefined)?.title ||
          item.action ||
          '完成一次有效跟进并记录反馈',
      ),
      riskPoints: Array.isArray(item.risks)
        ? item.risks.map((risk) => String(risk))
        : [],
      evidence: Array.isArray(item.sources)
        ? item.sources.map((source) => {
            const sourceRecord = source as Record<string, unknown>;
            return {
              type: safeText(sourceRecord.kind || 'crm'),
              id: this.nullableString(sourceRecord.id),
              label: safeText(sourceRecord.label || 'CRM 证据'),
            };
          })
        : [],
      dueAt: this.nullableString(
        (item.nextTask as { dueAt?: string } | undefined)?.dueAt,
      ),
      channel: 'crm',
      status: safeText(item.type || 'advice'),
      createdAt: raw.generatedAt,
    }));
    const highPriorityCount = advice.filter(
      (item) => item.priority === 'high',
    ).length;
    const dailySummary = raw.dailySummary || {};
    const summary = {
      generatedAt: raw.generatedAt,
      totalAdvice: advice.length,
      highPriorityCount,
      dormantCustomerCount: raw.risks.filter(
        (risk) => risk.type === 'stale_opportunity',
      ).length,
      overdueTaskCount: Number(dailySummary.overdueTasks || 0),
      riskOpportunityCount: raw.risks.filter((risk) =>
        safeText(risk.type || '').includes('opportunity'),
      ).length,
      newLeadCount: Number(dailySummary.newLeads || 0),
      pendingFollowupCount: Number(dailySummary.pendingFollowUps || 0),
      summary: safeText(
        dailySummary.headline ||
          `生成 ${advice.length} 条销售推进建议，高优先级 ${highPriorityCount} 条。`,
      ),
      dailyReport: {
        title: 'Kaypal Closer 日报',
        summary: safeText(dailySummary.headline || ''),
        newLeadCount: Number(dailySummary.newLeads || 0),
        pendingFollowupCount: Number(dailySummary.pendingFollowUps || 0),
        riskOpportunityCount: raw.risks.length,
        suggestedActionCount: advice.length,
        highlights: advice.slice(0, 3).map((item) => item.title),
        risks: raw.risks
          .slice(0, 3)
          .map((risk) => safeText(risk.title || risk.reason || '风险提醒')),
        nextActions: advice.slice(0, 5).map((item) => item.nextStep),
      },
      nextActions: advice.slice(0, 5).map((item) => item.recommendedAction),
      disclaimer:
        '本结果基于 CRM 本地数据确定性生成，不调用外部 LLM，不自动外发。',
    };
    return {
      generatedAt: raw.generatedAt,
      summary,
      advice,
      auditId: raw.audit?.proofHash
        ? `closer_${raw.audit.proofHash.slice(0, 16)}`
        : undefined,
      safety: {
        ...(raw.safety || {}),
        readOnly: true,
        autoWrite: false,
        autoSend: false,
        writeTables: [],
        externalNetwork: false,
      },
      audit: raw.audit || null,
      warnings:
        advice.length === 0
          ? ['暂无可推进建议：请先导入客户、创建任务或补充商机下一步。']
          : [],
    };
  }

  getConnectorReadiness(userId: string) {
    const generatedAt = new Date().toISOString();
    const rawConnectors = this.createConnectorContracts(generatedAt);
    const connectors = rawConnectors.map((connector) => ({
      ...connector,
      connectorKey: connector.key,
      connectorName: connector.displayName,
      summary: `${connector.displayName} 已具备 contract-only dry-run 合同，不联网、不收 token、不写外部系统。`,
      mode: connector.mode.includes('no-token')
        ? 'contract-only'
        : 'dry-run-only',
      status: connector.status,
      readinessStatus:
        connector.readiness === 'dry-run-ready'
          ? 'dry-run-ready'
          : 'contract-ready',
      safetyBoundary: {
        noNetwork: connector.safety.noNetwork,
        noToken: connector.safety.noToken,
        noWrite: connector.safety.noWrite,
        writeTables: [],
        requiredFutureGate: '11G',
        notes: [connector.safety.boundary],
      },
      fieldMappings: this.connectorFieldMappingToPairs(connector.fieldMapping),
      warnings: ['生产写入尚未开放，必须经过 11G 写入门禁。'],
      nextActions: connector.futureGate,
    }));
    return {
      generatedAt,
      ownerId: userId,
      actorUserId: userId,
      status: 'contract-ready',
      ready: true,
      summary:
        '连接器当前为合同/干跑阶段：可做字段映射、预检和证据生成，不保存 token、不联网、不写外部系统。',
      summaryStats: {
        contractReady: true,
        dryRunReady: true,
        noTokenRequired: true,
        noNetwork: true,
        noWrite: true,
        writeTables: [],
        requiredFutureGate: '11G',
        connectorCount: connectors.length,
      },
      contractReady: true,
      dryRunReady: true,
      writeTables: [],
      requiredFutureGate: '11G',
      safetyBoundaries: [
        'Phase 1 只返回 connector contract，不收 token、不 OAuth、不注册 webhook。',
        '外部 CRM 均为 no-network / no-token / no-write；CSV/Excel 仅支持 dry-run preview。',
        '没有 11G 生产写入 gate、人工确认、回滚计划和写后校验前，不允许写正式 CRM 表。',
      ],
      connectors,
      blockers: [],
      warnings: ['真实 OAuth、外部写入和回滚需要后续 11G 写入门禁。'],
      nextActions: [
        '先完成 CSV/Excel 或 CRM connector dry-run 字段对齐。',
        '进入付费 Beta 前补 OAuth、密钥托管、审批和回滚。',
      ],
      audit: {
        actorUserId: userId,
        action: 'crm.connector.readiness.contract',
        externalNetwork: false,
        tokenAccessed: false,
        persisted: false,
        writeTables: [],
        proofHash: this.createProofHash({
          generatedAt: generatedAt.slice(0, 10),
          connectors: connectors.map((connector) => connector.id),
          writeTables: [],
        }),
      },
    };
  }

  getConnectorContract(userId: string, connectorId: string) {
    const readiness = this.getConnectorReadiness(userId);
    const normalizedId = safeText(connectorId || '').toLowerCase();
    const canonicalId = [
      'csv',
      'excel',
      'xlsx',
      'excel_like',
      'csv_excel',
    ].includes(normalizedId)
      ? 'csv-excel'
      : normalizedId;
    const connector = readiness.connectors.find(
      (item) =>
        item.id === canonicalId ||
        item.key === canonicalId ||
        item.connectorKey === canonicalId,
    );
    if (!connector) throw new NotFoundException('Connector contract 不存在');
    return {
      ...connector,
      generatedAt: readiness.generatedAt,
      ownerId: userId,
      actorUserId: userId,
      audit: {
        ...readiness.audit,
        connectorId: connector.id,
        action: 'crm.connector.contract.read',
      },
    };
  }

  createConnectorContract(
    userId: string,
    input: {
      connectorKey?: string;
      includeProof?: boolean;
      requestedBy?: string;
    },
  ) {
    const connectorKey = this.optionalString(input.connectorKey) || 'csv-excel';
    const contract = this.getConnectorContract(userId, connectorKey) as Record<
      string,
      unknown
    >;
    const safety = (contract.safetyBoundary ||
      (contract.safety as Record<string, unknown>) ||
      {}) as Record<string, unknown>;
    const generatedAt = safeText(
      contract.generatedAt || new Date().toISOString(),
    );
    const hash = this.createProofHash({
      userId,
      requestedBy: this.optionalString(input.requestedBy) || userId,
      connectorKey,
      generatedAt,
      noToken: true,
      noNetwork: true,
      noWrite: true,
    });
    return {
      id: `connector_contract_${hash.slice(0, 12)}`,
      connectorKey: safeText(contract.key || connectorKey),
      connectorName: safeText(
        contract.displayName || contract.connectorName || connectorKey,
      ),
      contractVersion: 'migo-13m-contract-only-v1',
      status: safeText(contract.status || 'contract-ready'),
      mode: safeText(contract.mode || 'contract-only'),
      generatedAt,
      fieldMapping: contract.fieldMapping || {},
      fieldMappings: this.connectorFieldMappingToPairs(contract.fieldMapping),
      readScopes: Array.isArray(contract.supportedObjects)
        ? contract.supportedObjects
        : [],
      writeTables: [],
      requiredFutureGate: '11G',
      safetyBoundary: {
        noNetwork: safety.noNetwork !== false,
        noToken: safety.noToken !== false,
        noWrite: safety.noWrite !== false,
        writeTables: [],
        requiredFutureGate: '11G',
        notes: [
          safeText(
            safety.boundary ||
              'contract-only；不联网、不收 token、不写外部系统。',
          ),
        ],
      },
      proof:
        input.includeProof === false
          ? undefined
          : {
              ownerId: userId,
              actorUserId: userId,
              requestedBy: this.optionalString(input.requestedBy) || userId,
              connectorKey,
              hash,
              noNetwork: true,
              noToken: true,
              noWrite: true,
            },
      auditId: `audit_${hash.slice(0, 16)}`,
      warnings: ['当前只生成合同证据；真实写入需要 11G 门禁、审批和回滚。'],
      nextActions: Array.isArray(contract.futureGate)
        ? contract.futureGate
        : ['补齐 OAuth sandbox、审批、回滚和写后校验。'],
    };
  }

  async saveHubSpotVaultToken(userId: string, input: HubSpotVaultTokenInput) {
    const membership = await this.requireCrmMutationScope(userId);
    const token = this.requiredString(
      input.token,
      'HubSpot sandbox token 不能为空',
    );
    this.assertHubSpotPrivateAppTokenShape(token);
    await this.ensureConnectorVaultTables();

    const tenantId = membership.tenantId;
    const generatedAt = new Date().toISOString();
    const recordId = `crm_vault_${crypto.randomUUID()}`;
    const handleId = `crm_vault_handle_${crypto.randomUUID()}`;
    const encrypted = this.encryptConnectorSecret(token);
    const secretHash = crypto.createHash('sha256').update(token).digest('hex');
    const credentialFingerprint = secretHash.slice(0, 16);
    const label =
      this.optionalString(input.label) ||
      `HubSpot sandbox ${generatedAt.slice(0, 10)}`;
    const expiresAt = this.optionalDate(input.expiresAt);
    const metadata = {
      portalId: this.optionalString(input.portalId) || null,
      source: 'crm-connectors-hubspot-vault-token',
      plaintextReturned: false,
      tokenPreview: this.maskSecretPreview(token),
    };

    await this.prisma.$executeRaw`
      UPDATE crm_connector_vault_records
      SET status = 'rotated', updated_at = CURRENT_TIMESTAMP
      WHERE owner_id = ${userId}
        AND ${tenantId ? Prisma.sql`tenant_id = ${tenantId}` : Prisma.sql`tenant_id IS NULL`}
        AND connector_key = 'hubspot'
        AND credential_kind = 'private_app_token'
        AND status = 'active'
    `;
    await this.prisma.$executeRaw`
      UPDATE crm_connector_vault_handles
      SET status = 'rotated', updated_at = CURRENT_TIMESTAMP
      WHERE owner_id = ${userId}
        AND ${tenantId ? Prisma.sql`tenant_id = ${tenantId}` : Prisma.sql`tenant_id IS NULL`}
        AND connector_key = 'hubspot'
        AND credential_kind = 'private_app_token'
        AND status = 'active'
    `;
    await this.prisma.$executeRaw`
      INSERT INTO crm_connector_vault_records (
        id, owner_id, tenant_id, connector_key, credential_kind, label, status,
        encrypted_secret, secret_hash, key_fingerprint, metadata, expires_at,
        created_at, updated_at
      ) VALUES (
        ${recordId},
        ${userId},
        ${tenantId},
        'hubspot',
        'private_app_token',
        ${label},
        'active',
        ${encrypted.payload},
        ${secretHash},
        ${encrypted.keyFingerprint},
        ${JSON.stringify(metadata)},
        ${expiresAt ?? null},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
    await this.prisma.$executeRaw`
      INSERT INTO crm_connector_vault_handles (
        id, vault_record_id, owner_id, tenant_id, connector_key, credential_kind,
        handle, status, key_fingerprint, metadata, created_at, updated_at
      ) VALUES (
        ${handleId},
        ${recordId},
        ${userId},
        ${tenantId},
        'hubspot',
        'private_app_token',
        ${'hubspot_' + crypto.randomUUID()},
        'active',
        ${encrypted.keyFingerprint},
        ${JSON.stringify({
          label,
          credentialFingerprint,
          plaintextReturned: false,
        })},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;

    const proofHash = this.createProofHash({
      userId,
      tenantId,
      connectorKey: 'hubspot',
      credentialKind: 'private_app_token',
      recordId,
      handleId,
      keyFingerprint: encrypted.keyFingerprint,
      credentialFingerprint,
      generatedAt,
      plaintextReturned: false,
      writeTables: CRM_CONNECTOR_VAULT_WRITE_TABLES,
    });
    const auditEvent = await this.prisma.crmAuditEvent.create({
      data: {
        ownerId: userId,
        tenantId,
        eventType: 'crm_connector_secret_vault_record_created',
        action: 'crm.connector.hubspot.vault_token.created',
        status: 'success',
        proofHash,
        externalNetwork: false,
        externalCrmTouched: false,
        writeTables: [...CRM_CONNECTOR_VAULT_WRITE_TABLES],
        readTables: [],
        summary: 'HubSpot sandbox token 已加密写入本地 vault，未返回明文。',
        payload: {
          connectorKey: 'hubspot',
          credentialKind: 'private_app_token',
          handleId,
          keyFingerprint: encrypted.keyFingerprint,
          credentialFingerprint,
          plaintextReturned: false,
        },
        metadata,
      },
    });

    return {
      connectorKey: 'hubspot',
      status: 'active',
      tokenStored: true,
      plaintextReturned: false,
      handle: {
        id: handleId,
        status: 'active',
        keyFingerprint: encrypted.keyFingerprint,
        credentialFingerprint,
        label,
        createdAt: generatedAt,
        expiresAt: expiresAt?.toISOString() || null,
      },
      safety: {
        encryptedSecretPersisted: true,
        noPlaintextSecretPersistence: true,
        noRendererSecretExposure: true,
        externalNetwork: false,
        externalCrmTouched: false,
        externalCrmWrite: false,
        writeTables: [...CRM_CONNECTOR_VAULT_WRITE_TABLES],
      },
      audit: {
        id: auditEvent.id,
        proofHash,
      },
      warnings: this.connectorVaultKeyWarnings(),
    };
  }

  async getHubSpotVaultStatus(userId: string) {
    await this.ensureConnectorVaultTables();
    const tenantId = await this.resolveCrmTenantId(userId);
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, label, status, key_fingerprint, metadata, expires_at, created_at, updated_at
      FROM crm_connector_vault_records
      WHERE owner_id = ${userId}
        AND ${tenantId ? Prisma.sql`tenant_id = ${tenantId}` : Prisma.sql`tenant_id IS NULL`}
        AND connector_key = 'hubspot'
        AND credential_kind = 'private_app_token'
      ORDER BY created_at DESC
      LIMIT 10
    `;
    const activeRows = rows.filter((row) => row.status === 'active');
    return {
      connectorKey: 'hubspot',
      tokenState: activeRows.length > 0 ? 'active' : 'missing',
      activeHandleCount: activeRows.length,
      latest: rows[0]
        ? {
            id: this.optionalString(rows[0].id),
            label: this.optionalString(rows[0].label),
            status: this.optionalString(rows[0].status),
            keyFingerprint: this.optionalString(rows[0].key_fingerprint),
            expiresAt: this.optionalString(rows[0].expires_at),
            createdAt: this.optionalString(rows[0].created_at),
            updatedAt: this.optionalString(rows[0].updated_at),
          }
        : null,
      plaintextReturned: false,
      encryptedSecretReturned: false,
      warnings: this.connectorVaultKeyWarnings(),
    };
  }

  async runHubSpotReadOnlySandbox(
    userId: string,
    input: HubSpotReadOnlyRunInput,
  ) {
    const membership = await this.requireCrmMutationScope(userId);
    await this.ensureConnectorVaultTables();
    const vaultRecord = await this.resolveLatestHubSpotVaultRecord(
      userId,
      membership.tenantId,
    );
    if (!vaultRecord) {
      throw new BadRequestException({
        code: 'crm_hubspot_vault_token_required',
        message:
          'HubSpot read-only sandbox requires an active HubSpot token in CRM connector vault',
      });
    }
    const token = this.decryptConnectorSecret(
      this.requiredString(vaultRecord.encrypted_secret, 'HubSpot token 缺失'),
    );
    this.assertHubSpotPrivateAppTokenShape(token);

    const objects = this.normalizeHubSpotObjects(input.objects);
    const limit = this.normalizeBoundedInt(input.maxRowsPerObject, 1, 10, 3);
    const generatedAt = new Date().toISOString();
    const objectResults: HubSpotReadOnlyObjectResult[] = [];
    for (const objectKey of objects) {
      const descriptor = HUBSPOT_READ_ONLY_OBJECTS[objectKey];
      const url = new URL(
        `https://api.hubapi.com/crm/v3/objects/${descriptor.apiObject}`,
      );
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('archived', 'false');
      url.searchParams.set('properties', descriptor.properties.join(','));
      const responsePayload = await this.fetchHubSpotReadOnly(
        token,
        url.toString(),
      );
      const rows = Array.isArray(responsePayload.results)
        ? responsePayload.results.slice(0, limit)
        : [];
      objectResults.push({
        object: objectKey,
        displayName: descriptor.displayName,
        requestedLimit: limit,
        returnedCount: rows.length,
        hasMore: Boolean(
          (responsePayload.paging as { next?: unknown } | undefined)?.next,
        ),
        rows: rows.map((row) =>
          this.redactHubSpotObjectRow(row, descriptor.properties),
        ),
      });
    }

    const tenantId = await this.resolveCrmTenantId(userId);
    const proofHash = this.createProofHash({
      userId,
      tenantId,
      connectorKey: 'hubspot',
      objects,
      limit,
      generatedAt,
      vaultRecordId: this.optionalString(vaultRecord.id),
      keyFingerprint: this.optionalString(vaultRecord.key_fingerprint),
      rawPayloadReturned: false,
      rawPayloadPersisted: false,
      writeTables: ['crm_audit_events'],
    });
    const auditEvent = await this.prisma.crmAuditEvent.create({
      data: {
        ownerId: userId,
        tenantId,
        eventType: 'crm_connector_hubspot_read_only_run',
        action: 'crm.connector.hubspot.read_only_sandbox',
        status: 'success',
        proofHash,
        externalNetwork: true,
        externalCrmTouched: true,
        writeTables: ['crm_audit_events'],
        readTables: [
          'crm_connector_vault_records',
          'crm_connector_vault_handles',
        ],
        summary: `HubSpot sandbox 只读探针完成：${objects.join(', ')}`,
        payload: {
          connectorKey: 'hubspot',
          objects,
          limit,
          objectResults: objectResults as unknown as Prisma.InputJsonArray,
          rawPayloadReturned: false,
          rawPayloadPersisted: false,
        } as Prisma.InputJsonObject,
        metadata: {
          vaultRecordId: this.optionalString(vaultRecord.id),
          keyFingerprint: this.optionalString(vaultRecord.key_fingerprint),
        },
      },
    });

    return {
      connectorKey: 'hubspot',
      mode: 'read-only-sandbox',
      status: 'success',
      generatedAt,
      objects,
      maxRowsPerObject: limit,
      objectResults,
      rawPayloadReturned: false,
      rawPayloadPersisted: false,
      safety: {
        externalNetwork: true,
        externalCrmTouched: true,
        externalCrmWrite: false,
        writeTables: ['crm_audit_events'],
        noLocalCrmWrite: true,
        tokenReturned: false,
      },
      audit: {
        id: auditEvent.id,
        proofHash,
      },
    };
  }

  createImportDryRun(
    userId: string,
    input: { filename?: string; rows?: unknown[]; sourceType?: string },
  ) {
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const previewSourceRows = rows.slice(0, 20);
    const filename = this.optionalString(input.filename) || 'crm-import.csv';
    const sourceType = this.optionalString(input.sourceType) || 'manual';
    const generatedAt = new Date().toISOString();
    const headers = this.extractImportHeaders(rows);
    const fieldSuggestions = this.suggestImportFields(headers);
    const mapping = this.createImportMapping(fieldSuggestions);
    const piiDetections = this.createPiiDetections(fieldSuggestions);
    const duplicateKeys = this.findImportDuplicateKeys(rows, mapping);
    const qualityIssues = this.createImportQualityIssues(
      rows,
      mapping,
      duplicateKeys,
    );
    const previewRows = previewSourceRows.map((row, index) => {
      const rowIssues = qualityIssues.filter(
        (issue) => issue.rowNumber === index + 1,
      );
      return {
        rowNumber: index + 1,
        raw: row,
        status: 'preview',
        rowStatus: rowIssues.some((issue) => issue.severity === 'error')
          ? 'invalid'
          : rowIssues.length > 0
            ? 'warning'
            : 'valid',
        normalized: this.normalizeImportRow(row, mapping),
        pii: this.redactImportRow(row, fieldSuggestions),
        warnings: rowIssues.map((issue) => issue.message),
        qualityIssues: rowIssues,
      };
    });
    const proofHash = this.createProofHash({
      filename,
      sourceType,
      rows,
      mapping,
      qualityIssues: qualityIssues.map((issue) => ({
        code: issue.code,
        rowNumber: issue.rowNumber,
        field: issue.field,
      })),
    });
    const warnings = [
      ...(rows.length === 0 ? ['未上传数据，本次仅返回导入 dry-run 结构'] : []),
      ...(qualityIssues.length > 0
        ? ['存在质量问题，需人工确认后才能进入正式导入']
        : []),
      'dry-run 不写入 CRM 正式表；生产写入需要人工确认和 11G gate。',
    ];
    return {
      id: `dryrun_${proofHash.slice(0, 12)}`,
      ownerId: userId,
      actorUserId: userId,
      filename,
      sourceType,
      status: 'preview',
      rowCount: rows.length,
      validCount: previewRows.length,
      invalidCount: qualityIssues.filter((issue) => issue.severity === 'error')
        .length,
      duplicateCount: duplicateKeys.size,
      mapping,
      fieldSuggestions,
      previewRows,
      qualityIssues,
      errors: qualityIssues.filter((issue) => issue.severity === 'error'),
      warnings,
      piiFlags: ['phone', 'email', 'wechat'],
      piiDetections,
      proof: {
        id: `proof_${proofHash.slice(0, 16)}`,
        hash: proofHash,
        hashAlgorithm: 'sha256',
        generatedAt,
        rowCount: rows.length,
        previewRowLimit: 20,
        dryRun: true,
        writeTables: [],
        readTables: [],
        requiredFutureGate: '11G',
      },
      audit: {
        actorUserId: userId,
        action: 'crm.import.dry_run.preview',
        dryRun: true,
        externalNetwork: false,
        persisted: false,
        writeTables: [],
        blockedWrites: ['crm_customers', 'crm_companies', 'crm_opportunities'],
        proofHash,
      },
      safety: {
        dryRunOnly: true,
        noWrite: true,
        writeTables: [],
        boundary:
          '本接口只做字段识别、PII 标记、质量检查和 proof 生成，不写库。',
      },
      createdAt: generatedAt,
    };
  }

  async commitImportToLocalCrm(userId: string, input: CrmImportCommitInput) {
    const membership = await this.requireCrmMutationScope(userId);
    const gate = this.optionalString(input.confirmationGate);
    if (input.commit !== true || gate !== CrmService.LOCAL_IMPORT_COMMIT_GATE) {
      throw new BadRequestException({
        code: 'crm_import_commit_gate_required',
        message: `CRM 导入写入需要 ${CrmService.LOCAL_IMPORT_COMMIT_GATE} gate`,
        requiredGate: CrmService.LOCAL_IMPORT_COMMIT_GATE,
      });
    }

    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'crm_import_empty_source',
        message: 'CRM 导入写入需要至少 1 行有效数据',
      });
    }

    const filename = this.optionalString(input.filename) || 'crm-import.csv';
    const sourceType = this.optionalString(input.sourceType) || 'manual';
    const generatedAtDate = new Date();
    const generatedAt = generatedAtDate.toISOString();
    const tenantId = membership.tenantId;
    const headers = this.extractImportHeaders(rows);
    const fieldSuggestions = this.suggestImportFields(headers);
    const mapping = this.resolveImportMapping(input.mapping, fieldSuggestions);
    const duplicateKeys = this.findImportDuplicateKeys(rows, mapping);
    const qualityIssues = this.createImportQualityIssues(
      rows,
      mapping,
      duplicateKeys,
    );
    const blockingIssues = qualityIssues.filter(
      (issue) => issue.severity === 'error',
    );
    if (blockingIssues.length > 0) {
      throw new BadRequestException({
        code: 'crm_import_quality_blocked',
        message: 'CRM 导入存在阻塞质量问题，未写入任何客户数据',
        errors: blockingIssues,
      });
    }

    const commitHash = this.createProofHash({
      filename,
      sourceType,
      rows,
      mapping,
      dryRunId: input.dryRunId || null,
      dryRunProofHash: input.proofHash || null,
      gate,
      writeTables: ['crm_customers', 'crm_companies', 'crm_timeline_events'],
    });
    // commitHash 是内容哈希（同一文件重复导入会相同），追加随机段保证批次令牌唯一
    const importCommitId = `crm_import_${commitHash.slice(0, 16)}_${crypto.randomUUID().slice(0, 8)}`;
    const rollbackToken = `rollback_${commitHash.slice(0, 16)}_${crypto.randomUUID().slice(0, 8)}`;
    const writeTables = [
      'crm_customers',
      'crm_companies',
      'crm_timeline_events',
      'crm_import_batches',
      'crm_audit_events',
    ];
    const results: Array<{
      rowNumber: number;
      status: 'upserted' | 'skipped';
      customerId?: string;
      displayName?: string;
      dedupeKey?: string;
      createdByImport?: boolean;
      warnings: string[];
      message?: string;
    }> = [];
    let importBatch: unknown = null;
    let auditEvent: unknown = null;

    await this.runCrmWriteTransaction(async (tx) => {
      for (const [index, row] of rows.entries()) {
        const rowNumber = index + 1;
        const normalized = this.normalizeImportRow(row, mapping);
        const rowWarnings = qualityIssues
          .filter((issue) => issue.rowNumber === rowNumber)
          .map((issue) => issue.message);
        const hasAnyValue = Object.values(normalized).some((value) =>
          Boolean(this.optionalString(value)),
        );
        if (!hasAnyValue) {
          results.push({
            rowNumber,
            status: 'skipped',
            warnings: rowWarnings,
            message: '空行已跳过',
          });
          continue;
        }

        const dedupeKey =
          this.optionalString(normalized.dedupeKey) ||
          this.importDedupeKey(normalized) ||
          `import:${commitHash.slice(0, 12)}:${rowNumber}`;
        const displayName =
          this.optionalString(normalized.displayName) ||
          this.optionalString(normalized.companyName) ||
          `未命名客户 ${rowNumber}`;
        const customer = await this.upsertImportedCustomerWithClient(tx, {
          userId,
          tenantId,
          importCommitId,
          commitHash,
          generatedAt,
          filename,
          sourceType,
          dryRunId: input.dryRunId || null,
          dryRunProofHash: input.proofHash || null,
          rowNumber,
          normalized,
          displayName,
          dedupeKey,
        });

        results.push({
          rowNumber,
          status: 'upserted',
          customerId: customer.id,
          displayName: customer.displayName,
          dedupeKey,
          createdByImport: customer.createdByImport,
          warnings: rowWarnings,
        });
      }

      const committedResults = results.filter(
        (result) => result.status === 'upserted',
      );
      const customerIds = committedResults
        .map((result) => result.customerId)
        .filter((id): id is string => Boolean(id));
      const createdByImportCustomerIds = committedResults
        .filter((result) => result.createdByImport !== false)
        .map((result) => result.customerId)
        .filter((id): id is string => Boolean(id));
      const updatedExistingCustomerIds = committedResults
        .filter((result) => result.createdByImport === false)
        .map((result) => result.customerId)
        .filter((id): id is string => Boolean(id));

      importBatch = await tx.crmImportBatch.create({
        data: {
          id: importCommitId,
          ownerId: userId,
          tenantId,
          sourceType,
          filename,
          status: 'committed',
          mode: 'local-crm-write',
          rowCount: rows.length,
          committedCount: committedResults.length,
          skippedCount: results.length - committedResults.length,
          duplicateCount: duplicateKeys.size,
          warningCount: qualityIssues.length,
          dryRunId: this.optionalString(input.dryRunId),
          dryRunProofHash: this.optionalString(input.proofHash),
          commitProofHash: commitHash,
          rollbackToken,
          mapping: mapping as Prisma.InputJsonObject,
          qualityIssues: qualityIssues as unknown as Prisma.InputJsonArray,
          customerIds,
          writeTables,
          externalNetwork: false,
          externalCrmTouched: false,
          committedAt: generatedAtDate,
          metadata: {
            gate,
            createdByImportCustomerIds,
            updatedExistingCustomerIds,
          },
        },
      });

      await this.appendTimelineWithClient(tx, userId, tenantId, {
        eventType: 'crm_import_committed',
        channel: 'crm_import',
        content: `受控导入本地 CRM：${committedResults.length}/${rows.length} 条`,
        status: 'committed',
        evidence: {
          proofHash: commitHash,
          dryRunId: input.dryRunId || null,
          dryRunProofHash: input.proofHash || null,
          externalCrmTouched: false,
        },
        metadata: {
          importCommitId,
          filename,
          sourceType,
          rowCount: rows.length,
          committedCount: committedResults.length,
          skippedCount: results.length - committedResults.length,
          customerIds,
          writeTables,
        },
      });

      auditEvent = await this.appendAuditWithClient(tx, userId, tenantId, {
        importBatchId: importCommitId,
        eventType: 'crm_import_committed',
        action: 'crm.import.commit.local',
        status: 'success',
        proofHash: commitHash,
        writeTables,
        summary: `受控导入本地 CRM：${committedResults.length}/${rows.length} 条`,
        payload: {
          filename,
          sourceType,
          rowCount: rows.length,
          committedCount: committedResults.length,
          skippedCount: results.length - committedResults.length,
          duplicateCount: duplicateKeys.size,
          warningCount: qualityIssues.length,
          customerIds,
          dryRunId: input.dryRunId || null,
          dryRunProofHash: input.proofHash || null,
        },
        metadata: {
          gate,
          externalCrmTouched: false,
        },
      });
    });

    const committedResults = results.filter(
      (result) => result.status === 'upserted',
    );
    const customerIds = committedResults
      .map((result) => result.customerId)
      .filter((id): id is string => Boolean(id));

    return {
      id: importCommitId,
      importBatch,
      ownerId: userId,
      actorUserId: userId,
      filename,
      sourceType,
      status: 'committed',
      mode: 'local-crm-write',
      rowCount: rows.length,
      committedCount: committedResults.length,
      upsertedCount: committedResults.length,
      skippedCount: results.length - committedResults.length,
      duplicateCount: duplicateKeys.size,
      warningCount: qualityIssues.length,
      mapping,
      results,
      externalWrites: [],
      externalNetwork: false,
      externalCrmTouched: false,
      writeTables,
      proof: {
        id: `proof_${commitHash.slice(0, 16)}`,
        hash: commitHash,
        hashAlgorithm: 'sha256',
        generatedAt,
        dryRunId: input.dryRunId || null,
        dryRunProofHash: input.proofHash || null,
        gate,
        localWrite: true,
        externalWrite: false,
        customerIds,
      },
      rollbackPlan: {
        importCommitId,
        rollbackToken,
        strategy:
          '按 crm_import_batches + metadata.importCommit 定位本批新建客户；旧客户命中只跳过并保留审计。',
        customerIds,
        timelineEventTypes: ['customer_created'],
      },
      audit: {
        actorUserId: userId,
        action: 'crm.import.commit.local',
        persisted: true,
        externalNetwork: false,
        externalCrmTouched: false,
        proofHash: commitHash,
        writeTables,
        auditEvent,
      },
      safety: {
        gate: CrmService.LOCAL_IMPORT_COMMIT_GATE,
        localCrmOnly: true,
        noExternalToken: true,
        noExternalNetwork: true,
      },
      createdAt: generatedAt,
    };
  }

  async rollbackLocalCrmImport(userId: string, input: CrmImportRollbackInput) {
    const membership = await this.requireCrmMutationScope(userId);
    const importCommitId = this.requiredString(
      input.importCommitId,
      '导入批次不能为空',
    );
    const rollbackToken = this.requiredString(
      input.rollbackToken,
      '回滚令牌不能为空',
    );
    const batchScope =
      await this.scopedCrmWhere<Prisma.CrmImportBatchWhereInput>(userId);
    const batch = await this.prisma.crmImportBatch.findFirst({
      where: { ...batchScope, id: importCommitId },
    });
    const expectedToken =
      batch?.rollbackToken || this.rollbackTokenForImportCommit(importCommitId);
    if (!expectedToken || rollbackToken !== expectedToken) {
      throw new BadRequestException({
        code: 'crm_import_rollback_token_invalid',
        message: 'CRM 导入回滚令牌无效',
      });
    }

    const batchCustomerIds = Array.isArray(batch?.customerIds)
      ? (batch.customerIds as unknown[])
      : [];
    const customerIds = (
      Array.isArray(input.customerIds) && input.customerIds.length > 0
        ? input.customerIds
        : batchCustomerIds
    )
      .map((id) => this.optionalString(id))
      .filter((id): id is string => Boolean(id));
    if (customerIds.length === 0) {
      throw new BadRequestException({
        code: 'crm_import_rollback_customer_ids_required',
        message: 'CRM 导入回滚需要至少 1 个客户 ID',
      });
    }

    const scope =
      await this.scopedCrmWhere<Prisma.CrmCustomerWhereInput>(userId);
    const customers = await this.prisma.crmCustomer.findMany({
      where: {
        ...scope,
        id: { in: Array.from(new Set(customerIds)) },
      },
      select: {
        id: true,
        displayName: true,
        companyId: true,
        archivedAt: true,
        metadata: true,
      },
    });
    const customerById = new Map(
      customers.map((customer) => [customer.id, customer]),
    );
    const now = new Date();
    const reason =
      this.optionalString(input.reason) ||
      'controlled local CRM import rollback';
    const results: Array<{
      customerId: string;
      displayName?: string;
      status: 'archived' | 'already_archived' | 'not_found' | 'blocked';
      message: string;
    }> = [];
    const tenantId = membership.tenantId;
    let archivedCount = 0;
    let skippedCount = 0;
    let proofHash = '';
    let auditEvent: unknown = null;
    const writeTables = [
      'crm_customers',
      'crm_timeline_events',
      'crm_import_batches',
      'crm_audit_events',
    ];

    await this.runCrmWriteTransaction(async (tx) => {
      for (const customerId of customerIds) {
        const customer = customerById.get(customerId);
        if (!customer) {
          results.push({
            customerId,
            status: 'not_found',
            message: '客户不存在或不属于当前用户/租户',
          });
          continue;
        }
        const importInfo = this.customerImportCommitInfo(customer.metadata);
        if (importInfo?.id !== importCommitId) {
          results.push({
            customerId,
            displayName: customer.displayName,
            status: 'blocked',
            message: '客户不属于该导入批次，已跳过',
          });
          continue;
        }
        if (importInfo.createdByImport === false) {
          results.push({
            customerId,
            displayName: customer.displayName,
            status: 'blocked',
            message: '客户为导入命中的既有客户，不能被批次回滚归档',
          });
          continue;
        }
        if (customer.archivedAt) {
          results.push({
            customerId,
            displayName: customer.displayName,
            status: 'already_archived',
            message: '客户此前已归档',
          });
          continue;
        }

        await tx.crmCustomer.update({
          where: { id: customerId },
          data: {
            status: 'archived',
            archivedAt: now,
          },
        });
        await this.appendTimelineWithClient(tx, userId, tenantId, {
          customerId,
          companyId: customer.companyId,
          eventType: 'crm_import_rollback_archived',
          channel: 'crm_import',
          content: `回滚导入批次：${importCommitId}`,
          status: 'archived',
          metadata: {
            importCommitId,
            rollbackToken,
            reason,
          },
        });
        results.push({
          customerId,
          displayName: customer.displayName,
          status: 'archived',
          message: '已归档',
        });
      }

      archivedCount = results.filter(
        (result) => result.status === 'archived',
      ).length;
      skippedCount = results.length - archivedCount;
      proofHash = this.createProofHash({
        importCommitId,
        rollbackToken,
        customerIds,
        archivedCount,
        skippedCount,
        reason,
        action: 'crm.import.rollback.local_archive',
      });

      await this.appendTimelineWithClient(tx, userId, tenantId, {
        eventType: 'crm_import_rollback_completed',
        channel: 'crm_import',
        content: `回滚导入批次：${importCommitId}，归档 ${archivedCount} 条`,
        status: archivedCount > 0 ? 'rolled_back' : 'no_changes',
        evidence: {
          proofHash,
          rollbackToken,
          externalCrmTouched: false,
        },
        metadata: {
          importCommitId,
          archivedCount,
          skippedCount,
          strategy: 'local-archive',
          reason,
        },
      });

      if (batch) {
        await tx.crmImportBatch.update({
          where: { id: importCommitId },
          data: {
            status: archivedCount > 0 ? 'rolled_back' : 'rollback_no_changes',
            rolledBackAt: new Date(),
            rollbackProofHash: proofHash,
            rollbackReason: reason,
            metadata: {
              ...(this.toRecord(batch.metadata) as Record<string, unknown>),
              rollback: {
                archivedCount,
                skippedCount,
                resultStatuses: results.map((result) => ({
                  customerId: result.customerId,
                  status: result.status,
                })),
              },
            },
          },
        });
      }

      auditEvent = await this.appendAuditWithClient(tx, userId, tenantId, {
        importBatchId: batch ? importCommitId : null,
        eventType: 'crm_import_rollback_completed',
        action: 'crm.import.rollback.local_archive',
        status: archivedCount > 0 ? 'success' : 'no_changes',
        proofHash,
        writeTables,
        summary: `回滚导入批次：${importCommitId}，归档 ${archivedCount} 条，跳过 ${skippedCount} 条`,
        payload: {
          importCommitId,
          rollbackToken,
          customerIds,
          archivedCount,
          skippedCount,
          reason,
          results,
        },
        metadata: {
          externalCrmTouched: false,
          batchPersisted: Boolean(batch),
        },
      });
    });

    return {
      id: `crm_import_rollback_${proofHash.slice(0, 16)}`,
      importCommitId,
      status: archivedCount > 0 ? 'rolled_back' : 'no_changes',
      strategy: 'local-archive',
      archivedCount,
      skippedCount,
      externalNetwork: false,
      externalCrmTouched: false,
      writeTables,
      results,
      proof: {
        id: `proof_${proofHash.slice(0, 16)}`,
        hash: proofHash,
        hashAlgorithm: 'sha256',
        generatedAt: new Date().toISOString(),
        rollbackToken,
        localWrite: true,
        externalWrite: false,
      },
      audit: {
        actorUserId: userId,
        action: 'crm.import.rollback.local_archive',
        persisted: true,
        externalNetwork: false,
        externalCrmTouched: false,
        proofHash,
        auditEvent,
      },
    };
  }

  async captureAutoAcquisitionLeads(
    userId: string,
    input: CrmAutoAcquisitionCaptureInput,
  ): Promise<CrmAutoAcquisitionCaptureResult> {
    await this.requireCrmMutationScope(userId);
    const state = await this.appMarketService.getCrmState(userId);
    const targets = Array.isArray(input.targets) ? input.targets : [];
    const successfulResults = (input.executionResults || []).filter(
      (result) => result.ok === true,
    );
    if (!state.installed) {
      return {
        enabled: false,
        capturedCount: 0,
        skippedCount: successfulResults.length || targets.length,
        message: 'CRM 未安装，自动获客结果未沉淀到客户池',
        capturedCustomers: [],
      };
    }
    if (input.accountId) {
      await this.assertCrmPlatformAccountScope(
        userId,
        'douyin',
        input.accountId,
      );
    }

    const resultByIndex = new Map<
      number,
      CrmAutoAcquisitionExecutionResultInput
    >();
    successfulResults.forEach((result) =>
      resultByIndex.set(result.index, result),
    );

    let capturedCount = 0;
    let skippedCount = 0;
    const capturedCustomers: CrmCapturedCustomerRef[] = [];
    for (const target of targets) {
      const targetIndex = Number(target.index);
      const executionResult = Number.isFinite(targetIndex)
        ? resultByIndex.get(targetIndex)
        : undefined;
      if (!executionResult || target.commentTaskEnabled === false) {
        skippedCount += 1;
        continue;
      }

      const displayName = this.autoAcquisitionDisplayName(
        target,
        executionResult,
        input.keyword,
      );
      const sourceText =
        this.optionalString(executionResult.targetText) ||
        this.optionalString(target.sourceText) ||
        this.optionalString(target.text) ||
        input.keyword;
      const replyText =
        this.optionalString(executionResult.replyText) ||
        this.optionalString(target.commentReplyText);
      const sourceUrl =
        this.optionalString(target.videoUrl) ||
        this.optionalString(target.sourceUrl);
      const dedupeKey = this.createAutoAcquisitionDedupeKey(
        input,
        target,
        executionResult,
      );
      const metadata = {
        autoAcquisition: {
          configId: input.configId,
          recordId: input.recordId,
          taskName: input.taskName,
          trigger: input.trigger,
          accountId: input.accountId || null,
          accountName: input.accountName || null,
          targetIndex: executionResult.index,
          kind: target.kind || null,
          commentMode: target.commentMode || null,
          videoTitle: target.videoTitle || null,
          videoUrl: target.videoUrl || null,
          reason: target.reason || null,
          runStatus: input.status,
          runMessage: input.message,
        },
      } satisfies Prisma.InputJsonObject;
      const evidence = {
        recordEvidenceUrl: input.evidenceUrl || null,
        executionEvidenceUrl: executionResult.evidenceUrl || null,
      } satisfies Prisma.InputJsonObject;
      const tenantId = await this.resolveCrmTenantId(userId);

      const customer = await this.prisma.crmCustomer.upsert({
        where: this.customerDedupeWhere(userId, tenantId, dedupeKey),
        create: {
          ownerId: userId,
          actorUserId: userId,
          tenantId,
          displayName,
          status: 'contacted',
          sourcePlatform: 'douyin',
          sourceKeyword: input.keyword,
          matchedKeyword: this.optionalString(target.reason),
          sourceUrl,
          sourceText,
          latestReply: replyText,
          score: this.normalizeScore(
            target.score ?? target.engagementScore ?? 60,
          ),
          tags: this.autoAcquisitionTags(target),
          profileUrl: this.optionalString(target.profileUrl),
          externalUserId: this.optionalString(target.targetName),
          dedupeKey,
          firstInteractionTaskId: input.recordId,
          latestInteractionTaskId: input.recordId,
          metadata,
        },
        update: {
          tenantId,
          displayName,
          status: 'contacted',
          sourcePlatform: 'douyin',
          sourceKeyword: input.keyword,
          matchedKeyword: this.optionalString(target.reason),
          sourceUrl,
          sourceText,
          latestReply: replyText,
          score: this.normalizeScore(
            target.score ?? target.engagementScore ?? 60,
          ),
          tags: this.autoAcquisitionTags(target),
          profileUrl: this.optionalString(target.profileUrl),
          externalUserId: this.optionalString(target.targetName),
          latestInteractionTaskId: input.recordId,
          metadata,
          archivedAt: null,
        },
      });

      await this.appendTimeline(userId, {
        customerId: customer.id,
        companyId: customer.companyId,
        relatedInteractionTaskId: input.recordId,
        eventType: 'auto_acquisition_comment_replied',
        channel: 'douyin',
        content: sourceText,
        replyContent: replyText,
        status: executionResult.status,
        evidence,
        metadata,
      });
      capturedCount += 1;
      capturedCustomers.push({
        targetIndex: executionResult.index,
        customerId: customer.id,
        displayName: customer.displayName,
        dedupeKey,
      });
    }

    return {
      enabled: true,
      capturedCount,
      skippedCount,
      message: `已沉淀 ${capturedCount} 条自动获客线索到 CRM`,
      capturedCustomers,
    };
  }

  async captureGrowthLead(
    userId: string,
    input: CrmGrowthLeadCaptureInput,
  ): Promise<CrmAutoAcquisitionCaptureResult> {
    await this.requireCrmMutationScope(userId);
    const state = await this.appMarketService.getCrmState(userId);
    if (!state.installed) {
      return {
        enabled: false,
        capturedCount: 0,
        skippedCount: 1,
        message: 'CRM 未安装，增长线索未沉淀到客户池',
        capturedCustomers: [],
      };
    }

    const leadId = this.requiredString(input.leadId, '线索 ID 不能为空');
    const platform = this.optionalString(input.platform) || 'growth';
    const sourceText =
      this.optionalString(input.sourceText) ||
      this.optionalString(input.latestReply) ||
      '增长获客线索';
    const latestReply = this.optionalString(input.latestReply);
    const displayName =
      this.optionalString(input.nickname) ||
      `${platform}线索：${sourceText.slice(0, 18)}`;
    const sourceUrl =
      this.optionalString(input.sourceUrl) ||
      this.optionalString(input.videoUrl);
    const matchedKeywords = this.toStringArray(input.matchedKeywords);
    const scoreReasons = this.toStringArray(input.scoreReasons);
    const sourceKeyword = matchedKeywords[0] || null;
    const dedupeKey =
      this.optionalString(input.dedupeKey) ||
      this.createGrowthLeadDedupeKey(input);
    const tenantId = await this.resolveCrmTenantId(userId);
    const taskId =
      this.optionalString(input.sourceRunId) ||
      this.optionalString(input.sourceTaskId) ||
      leadId;
    const status = this.optionalString(input.status) || 'synced';
    const metadata = {
      growthLead: {
        leadId,
        sourceType: input.sourceType || null,
        sourceTaskId: input.sourceTaskId || null,
        sourceRunId: input.sourceRunId || null,
        videoTitle: input.videoTitle || null,
        videoUrl: input.videoUrl || null,
        matchedKeywords,
        scoreReasons,
        status,
      },
    } satisfies Prisma.InputJsonObject;
    const evidence = {
      growthLeadId: leadId,
      evidenceUrls: this.toStringArray(input.evidenceUrls),
    } satisfies Prisma.InputJsonObject;
    const customerStatus = this.growthLeadStatusToCustomerStatus(status);

    // S0-6 原子化：建客户 + 写时间线包进一个事务，任一步失败整体回滚，
    // 杜绝「客户已建但时间线丢失」的半成品状态。
    const customer = await this.prisma.$transaction(async (tx) => {
      const c = await tx.crmCustomer.upsert({
        where: this.customerDedupeWhere(userId, tenantId, dedupeKey),
        create: {
          ownerId: userId,
          actorUserId: userId,
          tenantId,
          displayName,
          status: customerStatus,
          sourcePlatform: platform,
          sourceKeyword,
          matchedKeyword: matchedKeywords.join('、') || null,
          sourceUrl,
          sourceText,
          latestReply,
          score: this.normalizeScore(input.score ?? 60),
          tags: this.growthLeadTags(input),
          profileUrl: this.optionalString(input.profileUrl),
          externalUserId: this.optionalString(input.externalUserId),
          dedupeKey,
          firstInteractionTaskId: taskId,
          latestInteractionTaskId: taskId,
          metadata,
        },
        update: {
          tenantId,
          displayName,
          sourcePlatform: platform,
          sourceKeyword,
          matchedKeyword: matchedKeywords.join('、') || null,
          sourceUrl,
          sourceText,
          latestReply,
          score: this.normalizeScore(input.score ?? 60),
          tags: this.growthLeadTags(input),
          profileUrl: this.optionalString(input.profileUrl),
          externalUserId: this.optionalString(input.externalUserId),
          latestInteractionTaskId: taskId,
          metadata,
        },
      });

      await this.appendTimelineWithClient(tx, userId, tenantId, {
        customerId: c.id,
        companyId: c.companyId,
        relatedInteractionTaskId: taskId,
        eventType: 'growth_lead_synced',
        channel: platform,
        content: sourceText,
        replyContent: latestReply,
        status,
        evidence,
        metadata,
      });

      return c;
    });

    return {
      enabled: true,
      capturedCount: 1,
      skippedCount: 0,
      message: '已沉淀 1 条增长线索到 CRM',
      capturedCustomers: [
        {
          leadId,
          customerId: customer.id,
          displayName: customer.displayName,
          dedupeKey,
        },
      ],
    };
  }

  private buildTimelineStats(
    events: Array<{
      customerId?: string | null;
      companyId?: string | null;
      opportunityId?: string | null;
      createdAt: Date;
    }>,
  ) {
    const stats = {
      byCustomer: new Map<string, { count: number; lastAt: Date }>(),
      byCompany: new Map<string, { count: number; lastAt: Date }>(),
      byOpportunity: new Map<string, { count: number; lastAt: Date }>(),
    };
    for (const event of events) {
      this.rememberTimelineStat(
        stats.byCustomer,
        event.customerId,
        event.createdAt,
      );
      this.rememberTimelineStat(
        stats.byCompany,
        event.companyId,
        event.createdAt,
      );
      this.rememberTimelineStat(
        stats.byOpportunity,
        event.opportunityId,
        event.createdAt,
      );
    }
    return stats;
  }

  private rememberTimelineStat(
    bucket: Map<string, { count: number; lastAt: Date }>,
    id: string | null | undefined,
    createdAt: Date,
  ) {
    if (!id) return;
    const current = bucket.get(id);
    if (!current) {
      bucket.set(id, { count: 1, lastAt: createdAt });
      return;
    }
    current.count += 1;
    if (createdAt.getTime() > current.lastAt.getTime()) {
      current.lastAt = createdAt;
    }
  }

  private createTaskCloserAdvice(
    task: {
      id: string;
      title: string;
      priority: string;
      dueAt: Date | null;
      customerId: string | null;
      customer?: { id: string; displayName: string } | null;
      companyId: string | null;
      company?: { id: string; name: string } | null;
      opportunityId: string | null;
      opportunity?: { id: string; name: string } | null;
      updatedAt: Date;
    },
    now: Date,
    timelineStats: ReturnType<CrmService['buildTimelineStats']>,
  ) {
    const overdue = this.isOverdue(task.dueAt, now);
    const dueToday = this.isDueToday(task.dueAt, now);
    const targetName =
      task.customer?.displayName ||
      task.company?.name ||
      task.opportunity?.name ||
      task.title;
    const reasons = [
      overdue ? '任务已逾期' : dueToday ? '任务今天到期' : '存在未完成跟进任务',
      task.opportunity ? `关联商机「${task.opportunity.name}」` : null,
      this.lastTouchReason(
        this.latestTimelineAt(timelineStats, {
          customerId: task.customerId,
          companyId: task.companyId,
          opportunityId: task.opportunityId,
        }),
        now,
      ),
    ].filter(Boolean);
    const priorityBoost = ['urgent', 'high'].includes(
      String(task.priority).toLowerCase(),
    )
      ? 12
      : 0;
    const score = Math.min(
      100,
      50 + (overdue ? 35 : dueToday ? 20 : 5) + priorityBoost,
    );
    return {
      id: `closer_task_${task.id}`,
      type: 'task_follow_up',
      priority: overdue ? 'urgent' : dueToday ? 'high' : 'normal',
      score,
      title: overdue ? `立即补跟：${task.title}` : `今日跟进：${task.title}`,
      targetName,
      customerId: task.customerId,
      customerName: task.customer?.displayName ?? null,
      companyId: task.companyId,
      companyName: task.company?.name ?? null,
      opportunityId: task.opportunityId,
      opportunityName: task.opportunity?.name ?? null,
      reason: reasons.join('；'),
      action: `先完成任务「${task.title}」，同步确认下一步时间和负责人。`,
      nextTask: {
        title: `跟进：${targetName}`,
        dueAt: this.nextBusinessTouch(now).toISOString(),
        priority: overdue ? 'high' : task.priority,
      },
      script: this.createCloserScript(
        targetName,
        task.opportunity?.name || task.title,
        overdue ? '补齐上次约定事项' : '推进今天的跟进动作',
      ),
      risks: [
        ...(overdue ? ['跟进逾期可能导致客户热度下降'] : []),
        ...(!task.customerId && !task.companyId
          ? ['任务缺少客户或公司关联，后续归因不完整']
          : []),
      ],
      sources: [
        this.createAdviceSource('task', task.id, task.title),
        ...(task.opportunity
          ? [
              this.createAdviceSource(
                'opportunity',
                task.opportunityId,
                task.opportunity.name,
              ),
            ]
          : []),
      ],
      sortKey: `task:${task.dueAt?.toISOString() || task.updatedAt.toISOString()}:${task.id}`,
    };
  }

  private createOpportunityCloserAdvice(
    opportunity: {
      id: string;
      name: string;
      stage: string;
      amountCents: number;
      probability: number;
      companyId: string | null;
      company?: { id: string; name: string } | null;
      primaryCustomerId: string | null;
      primaryCustomer?: { id: string; displayName: string } | null;
      closeDate: Date | null;
      nextStep: string | null;
      updatedAt: Date;
    },
    now: Date,
    timelineStats: ReturnType<CrmService['buildTimelineStats']>,
  ) {
    const daysToClose = this.daysUntil(opportunity.closeDate, now);
    const staleDays = this.daysSince(opportunity.updatedAt, now);
    const noNextStep = !this.optionalString(opportunity.nextStep);
    const targetName =
      opportunity.primaryCustomer?.displayName ||
      opportunity.company?.name ||
      opportunity.name;
    const closeSoon = daysToClose !== null && daysToClose <= 7;
    const reasons = [
      `商机阶段：${opportunity.stage}`,
      opportunity.amountCents > 0
        ? `金额约 ${Math.round(opportunity.amountCents / 100)} ${opportunity.amountCents ? '元' : ''}`
        : null,
      closeSoon ? `预计 ${Math.max(daysToClose || 0, 0)} 天内收口` : null,
      noNextStep ? '缺少明确下一步' : `下一步：${opportunity.nextStep}`,
      staleDays > 7 ? `${staleDays} 天未更新` : null,
      this.lastTouchReason(
        this.latestTimelineAt(timelineStats, {
          companyId: opportunity.companyId,
          customerId: opportunity.primaryCustomerId,
          opportunityId: opportunity.id,
        }),
        now,
      ),
    ].filter(Boolean);
    const score = Math.min(
      100,
      45 +
        (opportunity.amountCents >= 5000000
          ? 18
          : opportunity.amountCents > 0
            ? 8
            : 0) +
        (closeSoon ? 18 : 0) +
        (noNextStep ? 14 : 0) +
        (staleDays > 7 ? 10 : 0),
    );
    return {
      id: `closer_opportunity_${opportunity.id}`,
      type: 'opportunity_push',
      priority: score >= 80 ? 'high' : 'normal',
      score,
      title: `推进商机：${opportunity.name}`,
      targetName,
      customerId: opportunity.primaryCustomerId,
      customerName: opportunity.primaryCustomer?.displayName ?? null,
      companyId: opportunity.companyId,
      companyName: opportunity.company?.name ?? null,
      opportunityId: opportunity.id,
      opportunityName: opportunity.name,
      reason: reasons.join('；'),
      action: noNextStep
        ? '补齐下一步：确认预算、决策人、试点范围和下次会议时间。'
        : `推进下一步：${opportunity.nextStep}`,
      nextTask: {
        title: `推进商机：${opportunity.name}`,
        dueAt: this.nextBusinessTouch(now).toISOString(),
        priority: score >= 80 ? 'high' : 'normal',
      },
      script: this.createCloserScript(
        targetName,
        opportunity.name,
        noNextStep
          ? '确认下一步和决策路径'
          : opportunity.nextStep || '推进商机',
      ),
      risks: [
        ...(noNextStep ? ['没有下一步会降低预测准确性'] : []),
        ...(closeSoon && opportunity.probability < 50
          ? ['临近 close date 但赢率偏低']
          : []),
        ...(staleDays > 14 ? ['商机长时间未更新'] : []),
      ],
      sources: [
        this.createAdviceSource(
          'opportunity',
          opportunity.id,
          opportunity.name,
        ),
        ...(opportunity.company
          ? [
              this.createAdviceSource(
                'company',
                opportunity.companyId,
                opportunity.company.name,
              ),
            ]
          : []),
      ],
      sortKey: `opportunity:${opportunity.closeDate?.toISOString() || opportunity.updatedAt.toISOString()}:${opportunity.id}`,
    };
  }

  private createCustomerCloserAdvice(
    customer: {
      id: string;
      displayName: string;
      companyId: string | null;
      company?: { id: string; name: string } | null;
      email: string | null;
      phone: string | null;
      wechat: string | null;
      status: string;
      latestReply: string | null;
      score: number;
      sourceKeyword: string | null;
      updatedAt: Date;
      createdAt: Date;
      _count?: { timelineEvents?: number; tasks?: number; notes?: number };
    },
    now: Date,
    timelineStats: ReturnType<CrmService['buildTimelineStats']>,
  ) {
    const timelineStat = timelineStats.byCustomer.get(customer.id);
    const staleDays = this.daysSince(
      timelineStat?.lastAt || customer.updatedAt,
      now,
    );
    const newLead = this.isSameDay(customer.createdAt, now);
    const hasContact = Boolean(
      customer.email || customer.phone || customer.wechat,
    );
    const targetName = customer.displayName;
    const reasons = [
      newLead ? '今日新增线索' : null,
      customer.score > 0 ? `线索分 ${customer.score}` : null,
      customer.sourceKeyword ? `来源关键词：${customer.sourceKeyword}` : null,
      staleDays > 7 ? `${staleDays} 天未互动` : null,
      !hasContact ? '缺少电话/邮箱/微信联系方式' : null,
      customer.latestReply ? `最近回复：${customer.latestReply}` : null,
    ].filter(Boolean);
    const score = Math.min(
      100,
      32 +
        Math.round(customer.score * 0.35) +
        (newLead ? 20 : 0) +
        (staleDays > 7 ? 12 : 0) +
        (!hasContact ? 8 : 0),
    );
    return {
      id: `closer_customer_${customer.id}`,
      type: newLead ? 'new_lead_follow_up' : 'customer_reactivation',
      priority: score >= 75 ? 'high' : 'normal',
      score,
      title: newLead ? `新线索首触：${targetName}` : `客户唤醒：${targetName}`,
      targetName,
      customerId: customer.id,
      customerName: customer.displayName,
      companyId: customer.companyId,
      companyName: customer.company?.name ?? null,
      opportunityId: null,
      opportunityName: null,
      reason: reasons.join('；') || '客户存在可跟进信号',
      action: newLead
        ? '今天完成首触，确认需求、预算和可约时间。'
        : '发送轻量唤醒消息，围绕上次需求补一个具体价值点。',
      nextTask: {
        title: `${newLead ? '首触' : '唤醒'}：${targetName}`,
        dueAt: this.nextBusinessTouch(now).toISOString(),
        priority: score >= 75 ? 'high' : 'normal',
      },
      script: this.createCloserScript(
        targetName,
        customer.sourceKeyword || customer.company?.name || '业务需求',
        newLead ? '快速确认真实需求' : '重新打开沟通窗口',
      ),
      risks: [
        ...(!hasContact ? ['联系方式不完整，可能无法触达'] : []),
        ...(staleDays > 14 ? ['长时间未互动，需降低推销感'] : []),
      ],
      sources: [
        this.createAdviceSource('customer', customer.id, customer.displayName),
        ...(customer.company
          ? [
              this.createAdviceSource(
                'company',
                customer.companyId,
                customer.company.name,
              ),
            ]
          : []),
      ],
      sortKey: `customer:${customer.updatedAt.toISOString()}:${customer.id}`,
    };
  }

  private createCloserRisks(
    customers: Array<{
      id: string;
      displayName: string;
      email: string | null;
      phone: string | null;
      wechat: string | null;
      updatedAt: Date;
    }>,
    opportunities: Array<{
      id: string;
      name: string;
      amountCents: number;
      probability: number;
      closeDate: Date | null;
      nextStep: string | null;
      updatedAt: Date;
    }>,
    tasks: Array<{ id: string; title: string; dueAt: Date | null }>,
    now: Date,
    timelineStats: ReturnType<CrmService['buildTimelineStats']>,
  ) {
    const risks: Array<Record<string, unknown>> = [];
    for (const task of tasks) {
      if (!this.isOverdue(task.dueAt, now)) continue;
      risks.push({
        id: `risk_task_${task.id}`,
        severity: 'high',
        type: 'overdue_task',
        title: `逾期任务：${task.title}`,
        reason: '任务已过期但仍未完成',
        sources: [this.createAdviceSource('task', task.id, task.title)],
      });
    }
    for (const opportunity of opportunities) {
      const daysToClose = this.daysUntil(opportunity.closeDate, now);
      if (!this.optionalString(opportunity.nextStep)) {
        risks.push({
          id: `risk_opportunity_next_step_${opportunity.id}`,
          severity: 'medium',
          type: 'missing_next_step',
          title: `商机缺少下一步：${opportunity.name}`,
          reason: '没有下一步会影响预测和团队协作',
          sources: [
            this.createAdviceSource(
              'opportunity',
              opportunity.id,
              opportunity.name,
            ),
          ],
        });
      }
      if (
        daysToClose !== null &&
        daysToClose <= 7 &&
        opportunity.probability < 50
      ) {
        risks.push({
          id: `risk_opportunity_close_${opportunity.id}`,
          severity: 'high',
          type: 'close_date_low_probability',
          title: `临近收口但赢率偏低：${opportunity.name}`,
          reason: `预计 ${Math.max(daysToClose, 0)} 天内收口，当前赢率 ${opportunity.probability}%`,
          sources: [
            this.createAdviceSource(
              'opportunity',
              opportunity.id,
              opportunity.name,
            ),
          ],
        });
      }
      const timelineStat = timelineStats.byOpportunity.get(opportunity.id);
      const staleDays = this.daysSince(
        timelineStat?.lastAt || opportunity.updatedAt,
        now,
      );
      if (staleDays > 14) {
        risks.push({
          id: `risk_opportunity_stale_${opportunity.id}`,
          severity: 'medium',
          type: 'stale_opportunity',
          title: `商机 ${staleDays} 天未互动：${opportunity.name}`,
          reason: '长时间未互动会降低成交概率',
          sources: [
            this.createAdviceSource(
              'opportunity',
              opportunity.id,
              opportunity.name,
            ),
          ],
        });
      }
    }
    for (const customer of customers) {
      if (customer.email || customer.phone || customer.wechat) continue;
      risks.push({
        id: `risk_customer_contact_${customer.id}`,
        severity: 'medium',
        type: 'missing_contact_channel',
        title: `客户缺少触达方式：${customer.displayName}`,
        reason: '缺少电话、邮箱和微信，无法完成稳定跟进',
        sources: [
          this.createAdviceSource(
            'customer',
            customer.id,
            customer.displayName,
          ),
        ],
      });
    }
    return risks.slice(0, 12);
  }

  private createCloserScript(
    targetName: string,
    context: string,
    goal: string,
  ) {
    return {
      opener: `${targetName}，我根据之前记录看到你关注「${context}」，想用 2 分钟确认下现在是否仍是优先事项。`,
      discovery: `现在最需要先解决的是成本、效率、风险，还是内部推动节奏？`,
      valuePoint: `我可以先按「${goal}」给你一个轻量方案，不需要你现在做长期承诺。`,
      close: `如果方向对，今天先约一个 15 分钟确认会，把下一步和负责人定下来。`,
    };
  }

  private createAdviceSource(kind: string, id: string | null, label: string) {
    return { kind, id, label };
  }

  private latestTimelineAt(
    timelineStats: ReturnType<CrmService['buildTimelineStats']>,
    ids: {
      customerId?: string | null;
      companyId?: string | null;
      opportunityId?: string | null;
    },
  ) {
    const dates = [
      ids.customerId
        ? timelineStats.byCustomer.get(ids.customerId)?.lastAt
        : null,
      ids.companyId ? timelineStats.byCompany.get(ids.companyId)?.lastAt : null,
      ids.opportunityId
        ? timelineStats.byOpportunity.get(ids.opportunityId)?.lastAt
        : null,
    ].filter(Boolean) as Date[];
    if (dates.length === 0) return null;
    return dates.sort((left, right) => right.getTime() - left.getTime())[0];
  }

  private lastTouchReason(lastAt: Date | null, now: Date) {
    if (!lastAt) return '暂无可追溯互动记录';
    const days = this.daysSince(lastAt, now);
    if (days <= 1) return '最近 24 小时内有互动';
    return `最近一次互动在 ${days} 天前`;
  }

  private async ensureConnectorVaultTables() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS crm_connector_vault_records (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        connector_key TEXT NOT NULL,
        credential_kind TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        encrypted_secret TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        key_fingerprint TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        expires_at TIMESTAMP NULL,
        revoked_at TIMESTAMP NULL,
        quarantined_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS crm_connector_vault_handles (
        id TEXT PRIMARY KEY,
        vault_record_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        connector_key TEXT NOT NULL,
        credential_kind TEXT NOT NULL,
        handle TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        key_fingerprint TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_crm_connector_vault_records_owner ON crm_connector_vault_records(owner_id, connector_key, status)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_crm_connector_vault_records_tenant ON crm_connector_vault_records(tenant_id, connector_key, status)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_crm_connector_vault_handles_owner ON crm_connector_vault_handles(owner_id, connector_key, status)`,
    );
  }

  private async resolveLatestHubSpotVaultRecord(
    userId: string,
    tenantId: string | null,
  ) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, owner_id, tenant_id, encrypted_secret, key_fingerprint, metadata, expires_at, created_at
      FROM crm_connector_vault_records
      WHERE owner_id = ${userId}
        AND ${tenantId ? Prisma.sql`tenant_id = ${tenantId}` : Prisma.sql`tenant_id IS NULL`}
        AND connector_key = 'hubspot'
        AND credential_kind = 'private_app_token'
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }

  private encryptConnectorSecret(secret: string) {
    const keyConfig = this.connectorVaultKeyConfig();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyConfig.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      payload: [
        'v1',
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.'),
      keyFingerprint: keyConfig.fingerprint,
    };
  }

  private decryptConnectorSecret(payload: string) {
    const [version, rawIv, rawTag, rawCiphertext] = payload.split('.');
    if (version !== 'v1' || !rawIv || !rawTag || !rawCiphertext) {
      throw new BadRequestException('CRM connector vault 密文格式不正确');
    }
    const keyConfig = this.connectorVaultKeyConfig();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyConfig.key,
      Buffer.from(rawIv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(rawTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(rawCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private connectorVaultKeyConfig() {
    const explicit =
      this.optionalString(process.env.HUBSPOT_CONNECTOR_VAULT_KEY) ||
      this.optionalString(process.env.CRM_HUBSPOT_VAULT_KEY);
    const developmentMode = ['development', 'test'].includes(
      process.env.NODE_ENV || 'development',
    );
    if (!explicit && !developmentMode) {
      throw new BadRequestException(
        'HubSpot 连接需要配置独立保管密钥，当前操作已停止',
      );
    }
    const material =
      explicit ||
      ['ai-content-local-connector-vault-development-key']
        .filter(Boolean)
        .join(':');
    const key = crypto.createHash('sha256').update(material).digest();
    return {
      key,
      fingerprint: crypto
        .createHash('sha256')
        .update(`crm-connector-vault:${material}`)
        .digest('hex')
        .slice(0, 16),
      explicit: Boolean(explicit),
    };
  }

  private connectorVaultKeyWarnings() {
    return this.connectorVaultKeyConfig().explicit
      ? []
      : [
          '当前仅在开发环境使用本地保管密钥；正式环境必须配置 HubSpot 独立密钥。',
        ];
  }

  private async fetchHubSpotReadOnly(token: string, url: string) {
    if (!globalThis.fetch) {
      throw new BadRequestException(
        '当前 Node 运行时不支持 fetch，无法执行 HubSpot 只读探针',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await globalThis.fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        throw new BadRequestException({
          code: 'crm_hubspot_read_only_failed',
          message: `HubSpot 只读探针失败：${response.status}`,
          hubspotStatus: response.status,
          error: this.redactHubSpotError(payload),
        });
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  private redactHubSpotError(payload: Record<string, unknown>) {
    return {
      status: this.optionalString(payload.status),
      category: this.optionalString(payload.category),
      message: this.optionalString(payload.message),
      correlationId: this.optionalString(payload.correlationId),
    };
  }

  private redactHubSpotObjectRow(row: unknown, properties: string[]) {
    const record =
      row && typeof row === 'object' && !Array.isArray(row)
        ? (row as Record<string, unknown>)
        : {};
    const rawProperties =
      record.properties &&
      typeof record.properties === 'object' &&
      !Array.isArray(record.properties)
        ? (record.properties as Record<string, unknown>)
        : {};
    const redactedProperties: Record<string, string | null> = {};
    for (const property of properties) {
      const raw = this.optionalString(rawProperties[property]);
      redactedProperties[property] = HUBSPOT_SENSITIVE_PROPERTIES.has(property)
        ? this.maskPii(raw)
        : raw;
    }
    return {
      id: this.optionalString(record.id),
      archived: Boolean(record.archived),
      properties: redactedProperties,
      createdAt: this.optionalString(record.createdAt),
      updatedAt: this.optionalString(record.updatedAt),
    };
  }

  private normalizeHubSpotObjects(value: unknown): HubSpotObjectKey[] {
    const requested = Array.isArray(value)
      ? value
      : this.optionalString(value)
        ? String(value)
            .split(',')
            .map((item) => item.trim())
        : [];
    const aliases: Record<string, HubSpotObjectKey> = {
      company: 'companies',
      companies: 'companies',
      contact: 'contacts',
      contacts: 'contacts',
      people: 'contacts',
      deal: 'deals',
      deals: 'deals',
      opportunity: 'deals',
      opportunities: 'deals',
    };
    const uniqueObjects = Array.from(
      new Set(
        requested
          .map((item) => aliases[String(item).toLowerCase()])
          .filter((item): item is HubSpotObjectKey => Boolean(item)),
      ),
    ).slice(0, 3);
    return uniqueObjects.length > 0
      ? uniqueObjects
      : ['companies', 'contacts', 'deals'];
  }

  private assertHubSpotPrivateAppTokenShape(token: string) {
    if (token.length < 20 || /\s/.test(token)) {
      throw new BadRequestException({
        code: 'crm_hubspot_token_invalid',
        message: 'HubSpot token 格式不正确，需使用 sandbox/private app token',
      });
    }
  }

  private normalizeBoundedInt(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) {
    const number = Number(value ?? fallback);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  private maskSecretPreview(value: string) {
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  }

  private sqlValue(value: unknown) {
    const raw = this.optionalString(value);
    if (!raw) return 'NULL';
    return `'${raw.replace(/'/g, "''")}'`;
  }

  private sqlDateValue(value: Date | null) {
    return value ? this.sqlValue(value.toISOString()) : 'NULL';
  }

  private sqlJsonValue(value: unknown) {
    return this.sqlValue(JSON.stringify(value ?? {}));
  }

  private connectorFieldMappingToPairs(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    const pairs: Array<{ source: string; target: string; note?: string }> = [];
    for (const [targetGroup, rawSources] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const sources = Array.isArray(rawSources) ? rawSources : [rawSources];
      for (const source of sources) {
        const sourceField =
          typeof source === 'string' || typeof source === 'number'
            ? String(source)
            : '';
        if (!sourceField.trim()) continue;
        pairs.push({
          source: sourceField,
          target: `crm.${targetGroup}`,
        });
      }
    }
    return pairs;
  }

  private createConnectorContracts(generatedAt: string) {
    const baseSafety = {
      noToken: true,
      noNetwork: true,
      noWrite: true,
      noWebhook: true,
      writeTables: [],
      requiredFutureGate: '11G',
      boundary: 'contract-only；不会连接外部系统，也不会写入 CRM 表。',
    };
    const fieldMapping = {
      company: ['name', 'domain', 'industry', 'city'],
      customer: ['displayName', 'email', 'phone', 'wechat', 'title'],
      opportunity: ['name', 'stage', 'amountCents', 'probability', 'closeDate'],
      task: ['title', 'dueAt', 'priority', 'status'],
      timeline: ['eventType', 'channel', 'content', 'evidence'],
    };
    return [
      {
        id: 'twenty',
        key: 'twenty',
        displayName: 'Twenty',
        status: 'contract-only',
        mode: 'no-token-no-network-no-write',
        readiness: 'contract-ready',
        generatedAt,
        supportedObjects: [
          'companies',
          'people',
          'opportunities',
          'tasks',
          'notes',
        ],
        fieldMapping,
        dryRun: { supported: true, writes: false, proofRequired: true },
        auth: { tokenRequiredNow: false, tokenState: 'no-token', oauth: false },
        safety: baseSafety,
        futureGate: [
          'OAuth app review',
          'read-only sandbox',
          '11G write gate',
          'rollback plan',
        ],
      },
      {
        id: 'hubspot',
        key: 'hubspot',
        displayName: 'HubSpot',
        status: 'contract-only',
        mode: 'no-token-no-network-no-write',
        readiness: 'contract-ready',
        generatedAt,
        supportedObjects: [
          'companies',
          'contacts',
          'deals',
          'tasks',
          'engagements',
        ],
        fieldMapping,
        dryRun: { supported: true, writes: false, proofRequired: true },
        auth: { tokenRequiredNow: false, tokenState: 'no-token', oauth: false },
        safety: baseSafety,
        futureGate: [
          'private app scope review',
          'read-only sandbox',
          '11G write gate',
          'post-write verification',
        ],
      },
      {
        id: 'salesforce',
        key: 'salesforce',
        displayName: 'Salesforce',
        status: 'contract-only',
        mode: 'no-token-no-network-no-write',
        readiness: 'contract-ready',
        generatedAt,
        supportedObjects: [
          'accounts',
          'contacts',
          'opportunities',
          'tasks',
          'events',
        ],
        fieldMapping,
        dryRun: { supported: true, writes: false, proofRequired: true },
        auth: { tokenRequiredNow: false, tokenState: 'no-token', oauth: false },
        safety: baseSafety,
        futureGate: [
          'connected app review',
          'read-only sandbox',
          '11G write gate',
          'field-level security audit',
        ],
      },
      {
        id: 'feishu',
        key: 'feishu',
        displayName: 'Feishu',
        status: 'contract-only',
        mode: 'no-token-no-network-no-write',
        readiness: 'contract-ready',
        generatedAt,
        supportedObjects: [
          'bitable_companies',
          'bitable_contacts',
          'bitable_deals',
          'tasks',
        ],
        fieldMapping,
        dryRun: { supported: true, writes: false, proofRequired: true },
        auth: { tokenRequiredNow: false, tokenState: 'no-token', oauth: false },
        safety: baseSafety,
        futureGate: [
          'tenant app approval',
          'read-only table test',
          '11G write gate',
          'operator audit',
        ],
      },
      {
        id: 'csv-excel',
        key: 'csv-excel',
        displayName: 'CSV/Excel',
        status: 'dry-run-ready',
        mode: 'local-preview-no-write',
        readiness: 'dry-run-ready',
        generatedAt,
        supportedObjects: ['companies', 'customers', 'opportunities', 'notes'],
        fieldMapping,
        dryRun: { supported: true, writes: false, proofRequired: true },
        auth: { tokenRequiredNow: false, tokenState: 'no-token', oauth: false },
        safety: {
          ...baseSafety,
          noNetwork: true,
          boundary:
            '本地文件 preview / dry-run；只做字段映射、PII 标记和质量检查。',
        },
        futureGate: [
          'human confirm',
          'duplicate policy',
          '11G write gate',
          'rollback export',
        ],
      },
    ];
  }

  private extractImportHeaders(rows: unknown[]) {
    const headers = new Set<string>();
    for (const row of rows.slice(0, 20)) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        Object.keys(row as Record<string, unknown>).forEach((key) =>
          headers.add(key),
        );
      } else if (Array.isArray(row)) {
        row.forEach((_value, index) => headers.add(`column_${index + 1}`));
      }
    }
    return Array.from(headers);
  }

  private suggestImportFields(headers: string[]) {
    const aliases = [
      {
        crmField: 'companyName',
        label: '公司名称',
        pii: false,
        aliases: [
          '公司名称',
          '公司',
          '企业',
          'company',
          'companyname',
          'account',
        ],
      },
      {
        crmField: 'displayName',
        label: '客户名称',
        pii: false,
        aliases: [
          '客户名称',
          '联系人',
          '姓名',
          '名称',
          'displayname',
          'name',
          'contact',
        ],
      },
      {
        crmField: 'title',
        label: '职位',
        pii: false,
        aliases: ['职位', '职务', 'title', 'jobtitle'],
      },
      {
        crmField: 'phone',
        label: '手机号',
        pii: true,
        aliases: ['手机号', '手机', '电话', 'phone', 'mobile', 'tel'],
      },
      {
        crmField: 'email',
        label: '邮箱',
        pii: true,
        aliases: ['邮箱', '邮件', 'email', 'mail'],
      },
      {
        crmField: 'wechat',
        label: '微信',
        pii: true,
        aliases: ['微信', '企微', 'wechat', 'wecom'],
      },
      {
        crmField: 'opportunityName',
        label: '商机名称',
        pii: false,
        aliases: ['商机', '商机名称', 'deal', 'opportunity'],
      },
      {
        crmField: 'amountCents',
        label: '金额',
        pii: false,
        aliases: ['金额', '预算', 'amount', 'revenue', 'value'],
      },
      {
        crmField: 'sourceText',
        label: '来源备注',
        pii: false,
        aliases: [
          '来源备注',
          '备注',
          '需求',
          '线索内容',
          'note',
          'remark',
          'source',
        ],
      },
      {
        crmField: 'sourceUrl',
        label: '来源链接',
        pii: false,
        aliases: ['链接', '来源链接', 'url', 'profile', 'sourceurl'],
      },
    ];
    if (headers.length === 0) {
      return aliases.slice(0, 6).map((item) => ({
        crmField: item.crmField,
        label: item.label,
        sourceField: item.label,
        confidence: 0.4,
        pii: item.pii,
        reason: '默认字段建议，等待上传数据后重新匹配',
      }));
    }
    const usedHeaders = new Set<string>();
    return aliases
      .map((item) => {
        const match = this.findBestHeader(headers, item.aliases, usedHeaders);
        if (!match) return null;
        usedHeaders.add(match.header);
        return {
          crmField: item.crmField,
          label: item.label,
          sourceField: match.header,
          confidence: match.confidence,
          pii: item.pii,
          reason:
            match.confidence >= 0.9
              ? '字段名直接匹配'
              : '字段名相似匹配，建议人工确认',
        };
      })
      .filter(
        (
          item,
        ): item is {
          crmField: string;
          label: string;
          sourceField: string;
          confidence: number;
          pii: boolean;
          reason: string;
        } => Boolean(item),
      );
  }

  private findBestHeader(
    headers: string[],
    aliases: string[],
    usedHeaders: Set<string>,
  ) {
    let best: { header: string; confidence: number } | null = null;
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const normalizedHeader = this.normalizeHeader(header);
      for (const alias of aliases) {
        const normalizedAlias = this.normalizeHeader(alias);
        const exact = normalizedHeader === normalizedAlias;
        const partial =
          normalizedHeader.includes(normalizedAlias) ||
          normalizedAlias.includes(normalizedHeader);
        if (!exact && !partial) continue;
        const confidence = exact ? 0.96 : 0.72;
        if (!best || confidence > best.confidence) {
          best = { header, confidence };
        }
      }
    }
    return best;
  }

  private normalizeHeader(value: string) {
    return value.toLowerCase().replace(/[\s_\-:/\\（）()]/g, '');
  }

  private createImportMapping(
    suggestions: Array<{ crmField: string; sourceField: string }>,
  ) {
    const mapping: Record<string, string> = {};
    for (const suggestion of suggestions) {
      mapping[suggestion.crmField] = suggestion.sourceField;
    }
    return {
      companyName: mapping.companyName || '公司名称',
      displayName: mapping.displayName || '客户名称',
      phone: mapping.phone || '手机号',
      email: mapping.email || '邮箱',
      wechat: mapping.wechat || '微信',
      sourceText: mapping.sourceText || '来源备注',
      ...mapping,
    };
  }

  private resolveImportMapping(
    inputMapping: Record<string, string> | null | undefined,
    suggestions: Array<{ crmField: string; sourceField: string }>,
  ) {
    const mapping = this.createImportMapping(suggestions);
    if (!inputMapping || typeof inputMapping !== 'object') return mapping;

    const knownCrmFields = new Set([
      'companyName',
      'displayName',
      'title',
      'email',
      'phone',
      'wechat',
      'status',
      'sourcePlatform',
      'sourceKeyword',
      'sourceText',
      'latestReply',
      'score',
      'tags',
      'profileUrl',
      'externalUserId',
      'dedupeKey',
      'sourceUrl',
      'opportunityName',
      'amountCents',
    ]);

    for (const [left, right] of Object.entries(inputMapping)) {
      const sourceField = this.optionalString(left);
      const crmField = this.optionalString(right);
      if (!sourceField || !crmField) continue;

      if (knownCrmFields.has(sourceField)) {
        mapping[sourceField] = crmField;
        continue;
      }
      if (knownCrmFields.has(crmField)) {
        mapping[crmField] = sourceField;
      }
    }
    return mapping;
  }

  private createPiiDetections(
    suggestions: Array<{
      crmField: string;
      sourceField: string;
      pii: boolean;
      confidence: number;
    }>,
  ) {
    return suggestions
      .filter((suggestion) => suggestion.pii)
      .map((suggestion) => ({
        crmField: suggestion.crmField,
        sourceField: suggestion.sourceField,
        detected: true,
        classification: 'personal_contact',
        confidence: suggestion.confidence,
        handling: 'flag-only-in-dry-run; no persistence',
      }));
  }

  private findImportDuplicateKeys(
    rows: unknown[],
    mapping: Record<string, string>,
  ) {
    const seen = new Map<string, number>();
    const duplicateRows = new Set<number>();
    rows.forEach((row, index) => {
      const normalized = this.normalizeImportRow(row, mapping);
      const key = this.importDedupeKey(normalized);
      if (!key) return;
      const rowNumber = index + 1;
      const first = seen.get(key);
      if (first) {
        duplicateRows.add(first);
        duplicateRows.add(rowNumber);
      } else {
        seen.set(key, rowNumber);
      }
    });
    return duplicateRows;
  }

  private createImportQualityIssues(
    rows: unknown[],
    mapping: Record<string, string>,
    duplicateRows: Set<number>,
  ) {
    const issues: Array<{
      severity: 'warning' | 'error';
      code: string;
      rowNumber: number;
      field?: string;
      message: string;
    }> = [];
    rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const normalized = this.normalizeImportRow(row, mapping);
      const hasAnyValue = Object.values(normalized).some((value) =>
        Boolean(this.optionalString(value)),
      );
      if (!hasAnyValue) {
        issues.push({
          severity: 'error',
          code: 'empty_row',
          rowNumber,
          message: '空行无法导入',
        });
        return;
      }
      if (!normalized.displayName && !normalized.companyName) {
        issues.push({
          severity: 'error',
          code: 'missing_identity',
          rowNumber,
          field: 'displayName',
          message: '缺少客户名称或公司名称',
        });
      }
      if (
        normalized.email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)
      ) {
        issues.push({
          severity: 'warning',
          code: 'invalid_email',
          rowNumber,
          field: 'email',
          message: '邮箱格式疑似异常',
        });
      }
      if (normalized.phone) {
        const digits = normalized.phone.replace(/\D/g, '');
        if (digits.length < 6 || digits.length > 20) {
          issues.push({
            severity: 'warning',
            code: 'invalid_phone',
            rowNumber,
            field: 'phone',
            message: '手机号/电话格式疑似异常',
          });
        }
      }
      if (!normalized.email && !normalized.phone && !normalized.wechat) {
        issues.push({
          severity: 'warning',
          code: 'missing_contact_channel',
          rowNumber,
          message: '缺少电话、邮箱或微信，后续触达能力不足',
        });
      }
      if (duplicateRows.has(rowNumber)) {
        issues.push({
          severity: 'warning',
          code: 'duplicate_candidate',
          rowNumber,
          message: '疑似重复联系人或公司线索',
        });
      }
    });
    return issues;
  }

  private normalizeImportRow(row: unknown, mapping: Record<string, string>) {
    const normalized: Record<string, string | null> = {};
    for (const [crmField, sourceField] of Object.entries(mapping)) {
      normalized[crmField] = this.optionalString(
        this.readImportValue(row, sourceField),
      );
    }
    return normalized;
  }

  private readImportValue(row: unknown, sourceField: string) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      return (row as Record<string, unknown>)[sourceField];
    }
    if (Array.isArray(row)) {
      const match = /^column_(\d+)$/.exec(sourceField);
      if (!match) return null;
      return (row as unknown[])[Number(match[1]) - 1];
    }
    return null;
  }

  private redactImportRow(
    row: unknown,
    suggestions: Array<{ crmField: string; sourceField: string; pii: boolean }>,
  ) {
    const piiPreview: Record<
      string,
      { sourceField: string; value: string | null }
    > = {};
    for (const suggestion of suggestions) {
      if (!suggestion.pii) continue;
      piiPreview[suggestion.crmField] = {
        sourceField: suggestion.sourceField,
        value: this.maskPii(
          this.optionalString(
            this.readImportValue(row, suggestion.sourceField),
          ),
        ),
      };
    }
    return piiPreview;
  }

  private maskPii(value: string | null) {
    if (!value) return null;
    if (value.includes('@')) {
      const [name, domain] = value.split('@');
      return `${name.slice(0, 1)}***@${domain}`;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 4) return `***${digits.slice(-4)}`;
    return '***';
  }

  private importDedupeKey(row: Record<string, string | null>) {
    return (
      row.email ||
      row.phone ||
      row.wechat ||
      [row.displayName, row.companyName].filter(Boolean).join('@') ||
      null
    );
  }

  private importScore(value: string | null | undefined) {
    const score = Number(value);
    return Number.isFinite(score) ? score : undefined;
  }

  private importTags(value: string | null | undefined) {
    const raw = this.optionalString(value);
    if (!raw) return [];
    return raw
      .split(/[;,，；|]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  private rollbackTokenForImportCommit(importCommitId: string) {
    const match = /^crm_import_([a-f0-9]{16})$/.exec(importCommitId);
    return match ? `rollback_${match[1]}` : null;
  }

  private customerImportCommitInfo(
    metadata: unknown,
  ): { id?: string; createdByImport?: boolean; [key: string]: unknown } | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const importCommit = (metadata as { importCommit?: unknown }).importCommit;
    if (!importCommit || typeof importCommit !== 'object') return null;
    return importCommit as {
      id?: string;
      createdByImport?: boolean;
      [key: string]: unknown;
    };
  }

  private customerMatchesImportCommit(
    metadata: unknown,
    importCommitId: string,
  ) {
    return this.customerImportCommitInfo(metadata)?.id === importCommitId;
  }

  private createProofHash(value: unknown) {
    return crypto
      .createHash('sha256')
      .update(this.stableJson(value))
      .digest('hex');
  }

  private stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object')
      return JSON.stringify(value);
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableJson(record[key])}`)
      .join(',')}}`;
  }

  private daysSince(date: Date | null | undefined, now: Date) {
    if (!date) return Number.POSITIVE_INFINITY;
    return Math.max(
      0,
      Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)),
    );
  }

  private daysUntil(date: Date | null | undefined, now: Date) {
    if (!date) return null;
    return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  }

  private isOverdue(date: Date | null | undefined, now: Date) {
    return Boolean(date && date.getTime() < now.getTime());
  }

  private isDueToday(date: Date | null | undefined, now: Date) {
    if (!date) return false;
    return this.isSameDay(date, now);
  }

  private isSameDay(left: Date, right: Date) {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  private nextBusinessTouch(now: Date) {
    const next = new Date(now);
    next.setHours(Math.max(10, now.getHours() + 2), 0, 0, 0);
    if (next.getHours() >= 18) {
      next.setDate(next.getDate() + 1);
      next.setHours(10, 0, 0, 0);
    }
    return next;
  }

  private async runCrmWriteTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const prismaWithTransaction = this.prisma as unknown as {
      $transaction?: <TResult>(
        fn: (tx: Prisma.TransactionClient) => Promise<TResult>,
      ) => Promise<TResult>;
    };
    if (prismaWithTransaction.$transaction) {
      return prismaWithTransaction.$transaction(callback);
    }
    return callback(this.prisma as unknown as Prisma.TransactionClient);
  }

  private scopedCrmWhereForTenant<T extends object>(
    userId: string,
    tenantId: string | null,
  ): T {
    if (!tenantId) return { ownerId: userId } as T;
    return {
      AND: [
        {
          OR: [{ tenantId }, { ownerId: userId, tenantId: null }],
        },
      ],
    } as T;
  }

  private async resolveImportCompanyIdWithClient(
    tx: Prisma.TransactionClient,
    userId: string,
    tenantId: string | null,
    input: { companyId?: string | null; companyName?: string | null },
  ) {
    const scope = this.scopedCrmWhereForTenant<Prisma.CrmCompanyWhereInput>(
      userId,
      tenantId,
    );
    const companyId = this.optionalString(input.companyId);
    if (companyId) {
      const company = await tx.crmCompany.findFirst({
        where: { ...scope, id: companyId },
      });
      if (!company) throw new BadRequestException('关联公司不存在');
      return company.id;
    }
    if ('companyId' in input && !companyId) return null;
    const companyName = this.optionalString(input.companyName);
    if (!companyName) return null;
    const existing = await tx.crmCompany.findFirst({
      where: { ...scope, name: companyName, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) return existing.id;
    const company = await tx.crmCompany.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId,
        name: companyName,
        metadata: { source: 'crm_import_inline_create' },
      },
    });
    await this.appendTimelineWithClient(tx, userId, tenantId, {
      companyId: company.id,
      eventType: 'company_created',
      channel: 'crm_import',
      content: `创建公司：${company.name}`,
      metadata: { source: 'import_inline' },
    });
    return company.id;
  }

  private async upsertImportedCustomerWithClient(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      tenantId: string | null;
      importCommitId: string;
      commitHash: string;
      generatedAt: string;
      filename: string;
      sourceType: string;
      dryRunId: string | null;
      dryRunProofHash: string | null;
      rowNumber: number;
      normalized: Record<string, string | null>;
      displayName: string;
      dedupeKey: string;
    },
  ) {
    const companyId = await this.resolveImportCompanyIdWithClient(
      tx,
      input.userId,
      input.tenantId,
      {
        companyName:
          this.optionalString(input.normalized.companyName) || undefined,
      },
    );
    const dedupeWhere = this.customerDedupeWhere(
      input.userId,
      input.tenantId,
      input.dedupeKey,
    );
    const existing = await tx.crmCustomer.findFirst({
      where: {
        ...this.scopedCrmWhereForTenant<Prisma.CrmCustomerWhereInput>(
          input.userId,
          input.tenantId,
        ),
        dedupeKey: input.dedupeKey,
      },
      select: { id: true },
    });
    const createdByImport = !existing;
    const importCommit = {
      id: input.importCommitId,
      rowNumber: input.rowNumber,
      filename: input.filename,
      sourceType: input.sourceType,
      dryRunId: input.dryRunId,
      dryRunProofHash: input.dryRunProofHash,
      proofHash: input.commitHash,
      committedAt: input.generatedAt,
      createdByImport,
      preExistingCustomerId: existing?.id || null,
    };
    const data = {
      tenantId: input.tenantId,
      displayName: input.displayName,
      companyId,
      title: this.optionalString(input.normalized.title),
      email: this.optionalString(input.normalized.email),
      phone: this.optionalString(input.normalized.phone),
      wechat: this.optionalString(input.normalized.wechat),
      status: this.optionalString(input.normalized.status) || 'new',
      sourcePlatform: input.sourceType,
      sourceKeyword: this.optionalString(input.normalized.sourceKeyword),
      sourceUrl: this.optionalString(input.normalized.sourceUrl),
      sourceText: this.optionalString(input.normalized.sourceText),
      latestReply: this.optionalString(input.normalized.latestReply),
      score: this.importScore(input.normalized.score),
      tags: this.importTags(input.normalized.tags),
      profileUrl: this.optionalString(input.normalized.profileUrl),
      externalUserId: this.optionalString(input.normalized.externalUserId),
      metadata: { importCommit },
      archivedAt: null,
    };
    const customer = await tx.crmCustomer.upsert({
      where: dedupeWhere,
      create: {
        ownerId: input.userId,
        dedupeKey: input.dedupeKey,
        ...data,
      },
      update: data,
    });
    await this.appendTimelineWithClient(tx, input.userId, input.tenantId, {
      customerId: customer.id,
      companyId: customer.companyId,
      eventType: createdByImport ? 'customer_created' : 'customer_updated',
      channel: input.sourceType || 'crm_import',
      content:
        this.optionalString(input.normalized.sourceText) ||
        `导入客户：${customer.displayName}`,
      replyContent: this.optionalString(input.normalized.latestReply),
      status: customer.status,
      metadata: {
        sourceKeyword: data.sourceKeyword,
        dedupeKey: input.dedupeKey,
        importCommit,
      },
    });
    return {
      id: customer.id,
      displayName: customer.displayName,
      createdByImport,
    };
  }

  private async appendAuditWithClient(
    tx: Prisma.TransactionClient,
    userId: string,
    tenantId: string | null,
    input: {
      importBatchId?: string | null;
      eventType: string;
      action: string;
      status?: string;
      proofHash?: string | null;
      externalNetwork?: boolean;
      externalCrmTouched?: boolean;
      writeTables?: string[];
      readTables?: string[];
      summary?: string | null;
      payload?: Prisma.InputJsonObject;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    return tx.crmAuditEvent.create({
      data: {
        ownerId: userId,
        tenantId,
        importBatchId: input.importBatchId || null,
        eventType: input.eventType,
        action: input.action,
        status: input.status || 'success',
        proofHash: input.proofHash || null,
        externalNetwork: input.externalNetwork ?? false,
        externalCrmTouched: input.externalCrmTouched ?? false,
        writeTables: input.writeTables || [],
        readTables: input.readTables || [],
        summary: input.summary || null,
        payload: input.payload || {},
        metadata: input.metadata || {},
      },
    });
  }

  private async appendTimeline(
    userId: string,
    input: {
      customerId?: string | null;
      companyId?: string | null;
      opportunityId?: string | null;
      taskId?: string | null;
      noteId?: string | null;
      relatedInteractionTaskId?: string | null;
      relatedRuntimeExecutionId?: string | null;
      eventType: string;
      channel?: string | null;
      content?: string | null;
      replyContent?: string | null;
      status?: string | null;
      failureReason?: string | null;
      evidence?: Prisma.InputJsonObject;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    return this.appendTimelineWithClient(
      this.prisma as unknown as Prisma.TransactionClient,
      userId,
      await this.resolveCrmTenantId(userId),
      input,
    );
  }

  private async appendTimelineWithClient(
    tx: Prisma.TransactionClient,
    userId: string,
    tenantId: string | null,
    input: {
      customerId?: string | null;
      companyId?: string | null;
      opportunityId?: string | null;
      taskId?: string | null;
      noteId?: string | null;
      relatedInteractionTaskId?: string | null;
      relatedRuntimeExecutionId?: string | null;
      eventType: string;
      channel?: string | null;
      content?: string | null;
      replyContent?: string | null;
      status?: string | null;
      failureReason?: string | null;
      evidence?: Prisma.InputJsonObject;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    return tx.crmTimelineEvent.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId,
        customerId: input.customerId || null,
        companyId: input.companyId || null,
        opportunityId: input.opportunityId || null,
        taskId: input.taskId || null,
        noteId: input.noteId || null,
        relatedInteractionTaskId: input.relatedInteractionTaskId || null,
        relatedRuntimeExecutionId: input.relatedRuntimeExecutionId || null,
        eventType: input.eventType,
        channel: input.channel || null,
        content: input.content || null,
        replyContent: input.replyContent || null,
        status: input.status || null,
        failureReason: input.failureReason || null,
        evidence: input.evidence || {},
        metadata: input.metadata || {},
      },
    });
  }

  private async resolveCrmMembership(
    userId: string,
  ): Promise<CrmMembershipScope | null> {
    const tenantMemberDelegate = (
      this.prisma as unknown as {
        tenantMember?: {
          findFirst?: (args: unknown) => Promise<{
            tenantId: string;
            role?: string | null;
            permissions?: unknown;
          } | null>;
        };
      }
    ).tenantMember;
    if (!tenantMemberDelegate?.findFirst) {
      return null;
    }

    try {
      const selectedTenantId = await this.resolveRequestTenantId(userId);
      const member = await Promise.resolve(
        tenantMemberDelegate.findFirst({
          where: {
            userId,
            status: 'active',
            ...(selectedTenantId ? { tenantId: selectedTenantId } : {}),
          },
          orderBy: { joinedAt: 'asc' },
          select: { tenantId: true, role: true, permissions: true },
        }),
      );
      if (!member?.tenantId) return null;
      return {
        tenantId: member.tenantId,
        role: this.optionalString(member.role) || 'member',
        permissions: this.toStringArray(member.permissions),
        legacy: false,
      };
    } catch (error) {
      if (this.isMissingTenantMembershipStorage(error)) return null;
      throw error;
    }
  }

  private async resolveRequestTenantId(userId: string) {
    const context = this.authRequestContext?.get();
    if (!context?.user || context.user.id !== userId) return undefined;
    return this.authRequestContext!.resolveTenantId(this.prisma);
  }

  private async requireCrmMutationScope(
    userId: string,
    options: { platformAccount?: boolean } = {},
  ): Promise<CrmMembershipScope> {
    const tenantMemberDelegate = (
      this.prisma as unknown as { tenantMember?: unknown }
    ).tenantMember;
    if (!tenantMemberDelegate) {
      return {
        tenantId: null,
        role: 'admin',
        permissions: ['*'],
        legacy: true,
      };
    }

    const membership = await this.resolveCrmMembership(userId);
    if (!membership) {
      throw new ForbiddenException('当前账号不属于可用组织，不能修改 CRM 数据');
    }
    if (!this.canMutateTenantDomain(membership, 'crm')) {
      throw new ForbiddenException('当前组织权限不允许修改 CRM 数据');
    }
    if (
      options.platformAccount &&
      !this.canUseTenantPlatformAccount(membership)
    ) {
      throw new ForbiddenException('当前组织权限不允许使用平台账号');
    }
    return membership;
  }

  /** 全功能开放（大王决策 2026-08-11）：登录用户默认可用所有功能，不按 role/permissions 拦截 */
  private canMutateTenantDomain(_membership: CrmMembershipScope, _domain: 'crm') {
    return true;
  }

  private canUseTenantPlatformAccount(_membership: CrmMembershipScope) {
    return true;
  }

  private async assertCrmPlatformAccountScope(
    userId: string,
    platformInput: unknown,
    accountId: string,
    trustedCustomerAccountId?: string | null,
  ) {
    const membership = await this.requireCrmMutationScope(userId, {
      platformAccount: true,
    });
    if (trustedCustomerAccountId === accountId) return;
    const platform = this.optionalString(platformInput);
    const accountWhere = membership.tenantId
      ? {
          accountId,
          tenantId: membership.tenantId,
          ...(platform ? { platform } : {}),
        }
      : {
          accountId,
          userId,
          tenantId: null,
          ...(platform ? { platform } : {}),
        };
    const prisma = this.prisma as unknown as {
      growthAccountHealth?: {
        findFirst?: (args: unknown) => Promise<{ id: string } | null>;
      };
      growthAcquisitionConfig?: {
        findFirst?: (args: unknown) => Promise<{ id: string } | null>;
      };
    };
    if (
      !prisma.growthAccountHealth?.findFirst &&
      !prisma.growthAcquisitionConfig?.findFirst
    ) {
      if (membership.legacy) return;
      throw new ForbiddenException('当前组织无法验证该平台账号');
    }
    const [health, config] = await Promise.all([
      prisma.growthAccountHealth?.findFirst?.({
        where: accountWhere,
        select: { id: true },
      }) ?? null,
      prisma.growthAcquisitionConfig?.findFirst?.({
        where: accountWhere,
        select: { id: true },
      }) ?? null,
    ]);
    if (!health && !config) {
      throw new ForbiddenException('该平台账号不属于当前组织');
    }
  }

  private isMissingTenantMembershipStorage(error: unknown) {
    const record =
      error && typeof error === 'object'
        ? (error as { code?: unknown; message?: unknown })
        : {};
    const code = typeof record.code === 'string' ? record.code : '';
    const message =
      typeof record.message === 'string' ? record.message.toLowerCase() : '';
    return (
      code === 'P2021' ||
      message.includes('tenant_members') ||
      message.includes('tenantmember')
    );
  }

  private async resolveCrmTenantId(userId: string) {
    return (await this.resolveCrmMembership(userId))?.tenantId || null;
  }

  private async scopedCrmWhere<T extends object>(userId: string): Promise<T> {
    const tenantId = await this.resolveCrmTenantId(userId);
    if (!tenantId) {
      return { ownerId: userId } as T;
    }
    return {
      AND: [
        {
          OR: [{ tenantId }, { ownerId: userId, tenantId: null }],
        },
      ],
    } as T;
  }

  private customerDedupeWhere(
    userId: string,
    tenantId: string | null,
    dedupeKey: string,
  ): Prisma.CrmCustomerWhereUniqueInput {
    if (tenantId) {
      return { tenantId_dedupeKey: { tenantId, dedupeKey } };
    }
    return { ownerId_dedupeKey: { ownerId: userId, dedupeKey } };
  }

  private async resolveCompanyId(
    userId: string,
    input: { companyId?: string | null; companyName?: string },
  ) {
    const scope =
      await this.scopedCrmWhere<Prisma.CrmCompanyWhereInput>(userId);
    const companyId = this.optionalString(input.companyId);
    if (companyId) {
      const company = await this.prisma.crmCompany.findFirst({
        where: { ...scope, id: companyId },
      });
      if (!company) throw new BadRequestException('关联公司不存在');
      return company.id;
    }
    if ('companyId' in input && !companyId) return null;
    const companyName = this.optionalString(input.companyName);
    if (!companyName) return null;
    const existing = await this.prisma.crmCompany.findFirst({
      where: { ...scope, name: companyName, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) return existing.id;
    const company = await this.prisma.crmCompany.create({
      data: {
        ownerId: userId,
        actorUserId: userId,
        tenantId: await this.resolveCrmTenantId(userId),
        name: companyName,
        metadata: { source: 'crm_inline_create' },
      },
    });
    await this.appendTimeline(userId, {
      companyId: company.id,
      eventType: 'company_created',
      channel: 'crm',
      content: `创建公司：${company.name}`,
      metadata: { source: 'inline' },
    });
    return company.id;
  }

  private async resolveCustomerId(userId: string, customerId?: string | null) {
    const id = this.optionalString(customerId);
    if (!id) return null;
    const scope =
      await this.scopedCrmWhere<Prisma.CrmCustomerWhereInput>(userId);
    const customer = await this.prisma.crmCustomer.findFirst({
      where: { ...scope, id },
    });
    if (!customer) throw new BadRequestException('关联客户不存在');
    return customer.id;
  }

  private async resolveOpportunityId(
    userId: string,
    opportunityId?: string | null,
  ) {
    const id = this.optionalString(opportunityId);
    if (!id) return null;
    const scope =
      await this.scopedCrmWhere<Prisma.CrmOpportunityWhereInput>(userId);
    const opportunity = await this.prisma.crmOpportunity.findFirst({
      where: { ...scope, id },
    });
    if (!opportunity) throw new BadRequestException('关联商机不存在');
    return opportunity.id;
  }

  private async resolveRelatedCompanyId(
    userId: string,
    input: {
      companyId?: string | null;
      customerId?: string | null;
      opportunityId?: string | null;
    },
  ) {
    const explicitCompanyId = this.optionalString(input.companyId);
    if (explicitCompanyId) {
      return this.resolveCompanyId(userId, { companyId: explicitCompanyId });
    }
    if (input.companyId === null) {
      return null;
    }
    const opportunityId = this.optionalString(input.opportunityId);
    if (opportunityId) {
      const opportunityScope =
        await this.scopedCrmWhere<Prisma.CrmOpportunityWhereInput>(userId);
      const opportunity = await this.prisma.crmOpportunity.findFirst({
        where: { ...opportunityScope, id: opportunityId },
        select: { companyId: true },
      });
      if (opportunity?.companyId) return opportunity.companyId;
    }
    const customerId = this.optionalString(input.customerId);
    if (customerId) {
      const customerScope =
        await this.scopedCrmWhere<Prisma.CrmCustomerWhereInput>(userId);
      const customer = await this.prisma.crmCustomer.findFirst({
        where: { ...customerScope, id: customerId },
        select: { companyId: true },
      });
      if (customer?.companyId) return customer.companyId;
    }
    return null;
  }

  private toCustomerDto(customer: {
    id: string;
    displayName: string;
    companyId: string | null;
    company?: { id: string; name: string } | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    wechat: string | null;
    status: string;
    sourcePlatform: string | null;
    sourceKeyword: string | null;
    matchedKeyword: string | null;
    sourceUrl: string | null;
    sourceText: string | null;
    latestReply: string | null;
    score: number;
    tags: unknown;
    profileUrl: string | null;
    externalUserId: string | null;
    dedupeKey: string | null;
    assignedUserId: string | null;
    firstInteractionTaskId: string | null;
    latestInteractionTaskId: string | null;
    metadata: unknown;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count?: { timelineEvents?: number; tasks?: number; notes?: number };
  }) {
    return {
      id: customer.id,
      displayName: customer.displayName,
      companyId: customer.companyId,
      companyName: customer.company?.name ?? null,
      title: customer.title,
      email: customer.email,
      phone: customer.phone,
      wechat: customer.wechat,
      status: customer.status,
      sourcePlatform: customer.sourcePlatform,
      sourceAccount: this.customerSourceAccount(
        customer.metadata,
        customer.sourcePlatform,
      ),
      sourceKeyword: customer.sourceKeyword,
      matchedKeyword: customer.matchedKeyword,
      sourceUrl: customer.sourceUrl,
      sourceText: customer.sourceText,
      latestReply: customer.latestReply,
      score: customer.score,
      tags: this.toStringArray(customer.tags),
      profileUrl: customer.profileUrl,
      externalUserId: customer.externalUserId,
      dedupeKey: customer.dedupeKey,
      assignedUserId: customer.assignedUserId,
      firstInteractionTaskId: customer.firstInteractionTaskId,
      latestInteractionTaskId: customer.latestInteractionTaskId,
      metadata: customer.metadata,
      archived: Boolean(customer.archivedAt),
      archivedAt: customer.archivedAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      timelineCount: customer._count?.timelineEvents ?? 0,
      taskCount: customer._count?.tasks ?? 0,
      noteCount: customer._count?.notes ?? 0,
    };
  }

  private toCompanyDto(company: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    phone: string | null;
    website: string | null;
    city: string | null;
    employees: number | null;
    annualRevenueCents: number;
    ownerUserId: string | null;
    tags: unknown;
    metadata: unknown;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    customers?: unknown[];
    opportunities?: unknown[];
    _count?: {
      customers?: number;
      opportunities?: number;
      tasks?: number;
      notes?: number;
    };
  }) {
    return {
      id: company.id,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      phone: company.phone,
      website: company.website,
      city: company.city,
      employees: company.employees,
      annualRevenueCents: company.annualRevenueCents,
      ownerUserId: company.ownerUserId,
      tags: this.toStringArray(company.tags),
      metadata: company.metadata,
      archived: Boolean(company.archivedAt),
      archivedAt: company.archivedAt?.toISOString() ?? null,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
      customerCount:
        company._count?.customers ?? company.customers?.length ?? 0,
      opportunityCount:
        company._count?.opportunities ?? company.opportunities?.length ?? 0,
      taskCount: company._count?.tasks ?? 0,
      noteCount: company._count?.notes ?? 0,
    };
  }

  private toOpportunityDto(opportunity: {
    id: string;
    name: string;
    stage: string;
    amountCents: number;
    currency: string;
    probability: number;
    companyId: string | null;
    company?: { id: string; name: string } | null;
    primaryCustomerId: string | null;
    primaryCustomer?: { id: string; displayName: string } | null;
    closeDate: Date | null;
    nextStep: string | null;
    competitor: string | null;
    source: string | null;
    metadata: unknown;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count?: { tasks?: number; notes?: number; timelineEvents?: number };
  }) {
    return {
      id: opportunity.id,
      name: opportunity.name,
      stage: opportunity.stage,
      amountCents: opportunity.amountCents,
      currency: opportunity.currency,
      probability: opportunity.probability,
      companyId: opportunity.companyId,
      companyName: opportunity.company?.name ?? null,
      primaryCustomerId: opportunity.primaryCustomerId,
      primaryCustomerName: opportunity.primaryCustomer?.displayName ?? null,
      closeDate: opportunity.closeDate?.toISOString() ?? null,
      nextStep: opportunity.nextStep,
      competitor: opportunity.competitor,
      source: opportunity.source,
      metadata: opportunity.metadata,
      archived: Boolean(opportunity.archivedAt),
      archivedAt: opportunity.archivedAt?.toISOString() ?? null,
      createdAt: opportunity.createdAt.toISOString(),
      updatedAt: opportunity.updatedAt.toISOString(),
      taskCount: opportunity._count?.tasks ?? 0,
      noteCount: opportunity._count?.notes ?? 0,
      timelineCount: opportunity._count?.timelineEvents ?? 0,
    };
  }

  private toTaskDto(task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    dueAt: Date | null;
    completedAt: Date | null;
    assigneeId: string | null;
    companyId: string | null;
    company?: { id: string; name: string } | null;
    customerId: string | null;
    customer?: { id: string; displayName: string } | null;
    opportunityId: string | null;
    opportunity?: { id: string; name: string } | null;
    metadata: unknown;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      assigneeId: task.assigneeId,
      companyId: task.companyId,
      companyName: task.company?.name ?? null,
      customerId: task.customerId,
      customerName: task.customer?.displayName ?? null,
      opportunityId: task.opportunityId,
      opportunityName: task.opportunity?.name ?? null,
      metadata: task.metadata,
      archived: Boolean(task.archivedAt),
      archivedAt: task.archivedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private toNoteDto(note: {
    id: string;
    body: string;
    createdBy: string | null;
    companyId: string | null;
    company?: { id: string; name: string } | null;
    customerId: string | null;
    customer?: { id: string; displayName: string } | null;
    opportunityId: string | null;
    opportunity?: { id: string; name: string } | null;
    metadata: unknown;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: note.id,
      body: note.body,
      createdBy: note.createdBy,
      companyId: note.companyId,
      companyName: note.company?.name ?? null,
      customerId: note.customerId,
      customerName: note.customer?.displayName ?? null,
      opportunityId: note.opportunityId,
      opportunityName: note.opportunity?.name ?? null,
      metadata: note.metadata,
      archived: Boolean(note.archivedAt),
      archivedAt: note.archivedAt?.toISOString() ?? null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  private toWelcomeMessageTemplateDto(template: {
    id: string;
    body: string;
    metadata: unknown;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const metadata = this.toRecord(template.metadata);
    return {
      id: template.id,
      name: this.optionalString(metadata.name) || '未命名模板',
      body: template.body,
      channel: this.normalizeWelcomeMessageChannel(metadata.channel),
      metadata,
      archived: Boolean(template.archivedAt),
      archivedAt: template.archivedAt?.toISOString() ?? null,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }

  private toWelcomeMessagePreparationDto(
    preparation: {
      id: string;
      channel: string | null;
      replyContent: string | null;
      status: string | null;
      metadata: unknown;
      createdAt: Date;
    },
    customer: {
      id: string;
      displayName: string;
      sourceText: string | null;
      sourceUrl: string | null;
      profileUrl: string | null;
      sourceAccount?: { id: string | null; name: string | null } | null;
    },
  ) {
    const metadata = this.toRecord(preparation.metadata);
    return {
      id: preparation.id,
      customerId: customer.id,
      customerName: customer.displayName,
      targetName:
        this.optionalString(metadata.targetName) || customer.displayName,
      templateId: this.optionalString(metadata.templateId),
      templateName: this.optionalString(metadata.templateName),
      channel: this.normalizeWelcomeMessageChannel(preparation.channel),
      accountId:
        this.optionalString(metadata.accountId) ||
        customer.sourceAccount?.id ||
        null,
      accountName:
        this.optionalString(metadata.accountName) ||
        customer.sourceAccount?.name ||
        null,
      message: preparation.replyContent || '',
      sourceText: customer.sourceText,
      sourceUrl: customer.sourceUrl,
      profileUrl: customer.profileUrl,
      sendMode: 'auto-send' as const,
      status: preparation.status || 'prepared',
      deliveryStatus: 'not_sent' as const,
      externalSendRequested: false,
      deliveryConfirmed: false,
      requiresExternalReadback: true,
      createdAt: preparation.createdAt.toISOString(),
    };
  }

  private toTimelineDto(event: {
    id: string;
    customerId: string | null;
    companyId: string | null;
    opportunityId: string | null;
    taskId: string | null;
    noteId: string | null;
    eventType: string;
    channel: string | null;
    content: string | null;
    replyContent: string | null;
    status: string | null;
    failureReason: string | null;
    evidence: unknown;
    metadata: unknown;
    relatedInteractionTaskId: string | null;
    relatedRuntimeExecutionId: string | null;
    createdAt: Date;
  }) {
    return {
      id: event.id,
      customerId: event.customerId,
      companyId: event.companyId,
      opportunityId: event.opportunityId,
      taskId: event.taskId,
      noteId: event.noteId,
      eventType: event.eventType,
      channel: event.channel,
      content: event.content,
      replyContent: event.replyContent,
      status: event.status,
      failureReason: event.failureReason,
      evidence: event.evidence,
      metadata: event.metadata,
      relatedInteractionTaskId: event.relatedInteractionTaskId,
      relatedRuntimeExecutionId: event.relatedRuntimeExecutionId,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private toImportBatchDto(batch: {
    id: string;
    ownerId: string;
    tenantId: string | null;
    sourceType: string;
    filename: string | null;
    status: string;
    mode: string;
    rowCount: number;
    committedCount: number;
    skippedCount: number;
    duplicateCount: number;
    warningCount: number;
    dryRunId: string | null;
    dryRunProofHash: string | null;
    commitProofHash: string;
    rollbackToken: string;
    rollbackProofHash: string | null;
    rollbackReason: string | null;
    mapping: unknown;
    qualityIssues: unknown;
    customerIds: unknown;
    writeTables: unknown;
    externalNetwork: boolean;
    externalCrmTouched: boolean;
    committedAt: Date | null;
    rolledBackAt: Date | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
    auditEvents?: Array<{
      id: string;
      ownerId: string;
      tenantId: string | null;
      importBatchId: string | null;
      eventType: string;
      action: string;
      status: string;
      proofHash: string | null;
      externalNetwork: boolean;
      externalCrmTouched: boolean;
      writeTables: unknown;
      readTables: unknown;
      summary: string | null;
      payload: unknown;
      metadata: unknown;
      createdAt: Date;
    }>;
  }) {
    return {
      id: batch.id,
      ownerId: batch.ownerId,
      tenantId: batch.tenantId,
      sourceType: batch.sourceType,
      filename: batch.filename,
      status: batch.status,
      mode: batch.mode,
      rowCount: batch.rowCount,
      committedCount: batch.committedCount,
      skippedCount: batch.skippedCount,
      duplicateCount: batch.duplicateCount,
      warningCount: batch.warningCount,
      dryRunId: batch.dryRunId,
      dryRunProofHash: batch.dryRunProofHash,
      commitProofHash: batch.commitProofHash,
      rollbackToken: batch.rollbackToken,
      rollbackProofHash: batch.rollbackProofHash,
      rollbackReason: batch.rollbackReason,
      mapping: this.toRecord(batch.mapping),
      qualityIssues: Array.isArray(batch.qualityIssues)
        ? batch.qualityIssues
        : [],
      customerIds: Array.isArray(batch.customerIds) ? batch.customerIds : [],
      writeTables: this.toStringArray(batch.writeTables),
      externalNetwork: batch.externalNetwork,
      externalCrmTouched: batch.externalCrmTouched,
      committedAt: batch.committedAt?.toISOString() ?? null,
      rolledBackAt: batch.rolledBackAt?.toISOString() ?? null,
      metadata: this.toRecord(batch.metadata),
      auditEvents: (batch.auditEvents || []).map((event) =>
        this.toAuditEventDto(event),
      ),
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    };
  }

  private toAuditEventDto(event: {
    id: string;
    ownerId: string;
    tenantId: string | null;
    importBatchId: string | null;
    eventType: string;
    action: string;
    status: string;
    proofHash: string | null;
    externalNetwork: boolean;
    externalCrmTouched: boolean;
    writeTables: unknown;
    readTables: unknown;
    summary: string | null;
    payload: unknown;
    metadata: unknown;
    createdAt: Date;
  }) {
    return {
      id: event.id,
      ownerId: event.ownerId,
      tenantId: event.tenantId,
      importBatchId: event.importBatchId,
      eventType: event.eventType,
      action: event.action,
      status: event.status,
      proofHash: event.proofHash,
      externalNetwork: event.externalNetwork,
      externalCrmTouched: event.externalCrmTouched,
      writeTables: this.toStringArray(event.writeTables),
      readTables: this.toStringArray(event.readTables),
      summary: event.summary,
      payload: this.toRecord(event.payload),
      metadata: this.toRecord(event.metadata),
      createdAt: event.createdAt.toISOString(),
    };
  }

  private nullableString(value: unknown) {
    return this.optionalString(value);
  }

  private renderCloserScript(script: unknown) {
    if (!script || typeof script !== 'object' || Array.isArray(script)) {
      return this.optionalString(script) || '';
    }
    const record = script as Record<string, unknown>;
    return [
      this.optionalString(record.opener),
      this.optionalString(record.discovery),
      this.optionalString(record.valuePoint),
      this.optionalString(record.close),
    ]
      .filter(Boolean)
      .join('\n');
  }

  private optionalString(value: unknown) {
    const normalized = safeText(value ?? '').trim();
    return normalized || null;
  }

  private requiredString(value: unknown, message: string) {
    const normalized = this.optionalString(value);
    if (!normalized) throw new BadRequestException(message);
    return normalized;
  }

  private optionalInt(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(0, Math.round(number));
  }

  private normalizePositiveInt(value: unknown, fallback: number) {
    const number = Number(value ?? fallback);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(1, Math.round(number));
  }

  private normalizeBoolean(value: unknown, fallback: boolean) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = safeText(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
    return fallback;
  }

  private optionalDate(value: unknown) {
    const raw = this.optionalString(value);
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('日期格式不正确');
    }
    return date;
  }

  private normalizeScore(value: unknown) {
    const score = Number(value ?? 0);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private normalizeProbability(value: unknown) {
    const probability = Number(value ?? 20);
    if (!Number.isFinite(probability)) return 20;
    return Math.max(0, Math.min(100, Math.round(probability)));
  }

  private toStringArray(value: unknown) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    const raw = this.optionalString(value);
    if (!raw) return [];
    return raw
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private mergeCustomerMetadata(
    current: unknown,
    input: Pick<
      CustomerInput,
      'metadata' | 'sourceAccountId' | 'sourceAccountName' | 'sourcePlatform'
    >,
  ): Prisma.InputJsonObject {
    const metadata = {
      ...this.toRecord(current),
      ...this.toRecord(input.metadata),
    } as Prisma.InputJsonObject;
    const existingAccount = this.toRecord(metadata.sourceAccount);
    const hasAccountInput =
      'sourceAccountId' in input || 'sourceAccountName' in input;
    const accountId =
      'sourceAccountId' in input
        ? this.optionalString(input.sourceAccountId)
        : this.optionalString(existingAccount.id);
    const accountName =
      'sourceAccountName' in input
        ? this.optionalString(input.sourceAccountName)
        : this.optionalString(existingAccount.name);
    if (!hasAccountInput && !accountId && !accountName) return metadata;
    if (!accountId && !accountName) {
      return Object.fromEntries(
        Object.entries(metadata).filter(([key]) => key !== 'sourceAccount'),
      );
    }
    return {
      ...metadata,
      sourceAccount: {
        id: accountId,
        name: accountName,
        platform:
          this.optionalString(input.sourcePlatform) ||
          this.optionalString(existingAccount.platform),
      },
    };
  }

  private customerSourceAccount(
    metadataValue: unknown,
    sourcePlatform: string | null,
  ) {
    const metadata = this.toRecord(metadataValue);
    const direct = this.toRecord(metadata.sourceAccount);
    const acquisition = this.toRecord(metadata.autoAcquisition);
    const id =
      this.optionalString(direct.id) ||
      this.optionalString(acquisition.accountId);
    const name =
      this.optionalString(direct.name) ||
      this.optionalString(acquisition.accountName);
    if (!id && !name) return null;
    return {
      id,
      name,
      platform:
        this.optionalString(direct.platform) || sourcePlatform || 'douyin',
    };
  }

  private normalizeWelcomeMessageChannel(value: unknown) {
    const channel = (this.optionalString(value) || 'douyin')
      .toLowerCase()
      .replace(/_/g, '-');
    if (channel === 'wechat' || channel === 'wechat-channel') return channel;
    return 'douyin';
  }

  private renderWelcomeMessage(
    template: string,
    customer: {
      displayName: string;
      companyName: string | null;
      sourceKeyword: string | null;
      sourceAccount?: { name: string | null } | null;
    },
  ) {
    const values: Record<string, string> = {
      customer_name: customer.displayName,
      customerName: customer.displayName,
      company_name: customer.companyName || '',
      companyName: customer.companyName || '',
      source_account: customer.sourceAccount?.name || '',
      sourceAccount: customer.sourceAccount?.name || '',
      source_keyword: customer.sourceKeyword || '',
      sourceKeyword: customer.sourceKeyword || '',
    };
    const unknownVariables = new Set<string>();
    const rendered = template.replace(
      /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
      (match, key: string) => {
        if (key in values) return values[key];
        unknownVariables.add(key);
        return match;
      },
    );
    if (unknownVariables.size) {
      throw new BadRequestException(
        `模板包含无法识别的变量：${Array.from(unknownVariables).join('、')}`,
      );
    }
    return this.requiredString(rendered, '欢迎消息渲染后不能为空');
  }

  private toRecord(value: unknown): Prisma.InputJsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Prisma.InputJsonObject)
      : {};
  }

  private autoAcquisitionDisplayName(
    target: CrmAutoAcquisitionTargetInput,
    result: CrmAutoAcquisitionExecutionResultInput,
    keyword: string,
  ) {
    const targetName =
      this.optionalString(result.targetName) ||
      this.optionalString(target.targetName);
    if (targetName) return targetName;
    const videoTitle = this.optionalString(target.videoTitle);
    if (this.isVideoCommentTarget(target)) {
      return `视频直评：${videoTitle || keyword || '抖音视频'}`;
    }
    return `抖音评论用户：${keyword || '自动获客'}`;
  }

  private autoAcquisitionTags(target: CrmAutoAcquisitionTargetInput) {
    return [
      '自动获客',
      '抖音',
      this.isVideoCommentTarget(target) ? '视频直评' : '评论回复',
    ];
  }

  private growthLeadTags(input: CrmGrowthLeadCaptureInput) {
    return [
      '增长获客',
      this.optionalString(input.platform) || '增长线索',
      this.optionalString(input.sourceType) || '线索池',
    ];
  }

  private growthLeadStatusToCustomerStatus(status: string) {
    if (status === 'converted') return 'customer';
    if (status === 'qualified' || status === 'replied') return 'qualified';
    if (status === 'contacted') return 'contacted';
    return 'new';
  }

  private createAutoAcquisitionDedupeKey(
    input: CrmAutoAcquisitionCaptureInput,
    target: CrmAutoAcquisitionTargetInput,
    result: CrmAutoAcquisitionExecutionResultInput,
  ) {
    const raw = [
      'auto-acquisition',
      input.configId,
      this.optionalString(target.profileUrl) || '',
      this.optionalString(target.targetName) ||
        this.optionalString(result.targetName) ||
        '',
      this.optionalString(target.videoUrl) ||
        this.optionalString(target.sourceUrl) ||
        '',
      this.optionalString(target.text) ||
        this.optionalString(result.targetText) ||
        '',
      String(result.index),
    ].join(':');
    return `crm:auto-acquisition:${crypto.createHash('sha1').update(raw).digest('hex')}`;
  }

  private createGrowthLeadDedupeKey(input: CrmGrowthLeadCaptureInput) {
    const raw = [
      'growth-lead',
      this.optionalString(input.leadId) || '',
      this.optionalString(input.platform) || '',
      this.optionalString(input.profileUrl) || '',
      this.optionalString(input.externalUserId) || '',
      this.optionalString(input.sourceUrl) ||
        this.optionalString(input.videoUrl) ||
        '',
      this.optionalString(input.nickname) || '',
      this.optionalString(input.sourceText) || '',
    ].join(':');
    return `crm:growth-lead:${crypto.createHash('sha1').update(raw).digest('hex')}`;
  }

  private isVideoCommentTarget(target: CrmAutoAcquisitionTargetInput) {
    const kind = safeText(target.kind || '').toLowerCase();
    const commentMode = safeText(target.commentMode || '').toLowerCase();
    return (
      commentMode === 'video-comment' ||
      /direct-comment|video-comment|视频直评|直评/.test(kind)
    );
  }

  private createManualDedupeKey(displayName: string, input: CustomerInput) {
    const raw = [
      'manual',
      displayName,
      this.optionalString(input.email) || '',
      this.optionalString(input.phone) || '',
      this.optionalString(input.wechat) || '',
      this.optionalString(input.sourcePlatform) || '',
      this.optionalString(input.profileUrl) || '',
      this.optionalString(input.externalUserId) || '',
    ].join(':');
    return `crm:${crypto.createHash('sha1').update(raw).digest('hex')}`;
  }
}
