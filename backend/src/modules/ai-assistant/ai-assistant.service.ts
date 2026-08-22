import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthService } from '../growth/growth.service';
import { LeadConvertService } from '../leads/lead-convert.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

// ============================================================
// P3 AI 助手任务草稿（文档 §7.3 GrowthTaskDraft 契约）
// 意图 -> 结构化草稿 -> 缺失字段/风险 -> 用户确认 -> 后端执行
// 自然语言只能生成草稿，不能绕过 GrowthService 的预检和风险门。
// ============================================================

export type TaskDraftIntent =
  'find_leads' | 'contact_leads' | 'sync_crm' | 'follow_up' | 'report';

export type PlannedAction = {
  type: string;
  label: string;
  risk: 'low' | 'medium' | 'high' | 'blocked';
  requiresConfirmation: boolean;
};

export type GrowthTaskDraft = {
  id: string;
  intent: TaskDraftIntent;
  goal: string;
  platform?: string;
  accountId?: string;
  config?: Record<string, unknown>;
  plannedActions: PlannedAction[];
  missingFields: string[];
  readiness: 'ready' | 'needs-confirmation' | 'needs-input' | 'blocked';
  blockers: string[];
  expiresAt: string;
  status: string;
  draftHash?: string; // §7.3 草稿内容指纹（前端内容比对/防篡改）
  riskSummary?: string;
  configId?: string;
  confirmedAt?: string;
  executedAt?: string;
};

/** 草稿有效期（未确认自动过期，秒） */
const DRAFT_TTL_MS = 30 * 60 * 1000;

/**
 * P1（复查 2026-08-22）：副作用已提交但最终状态更新失败的内部标记——
 * executeDraft 捕获到它时**不回滚**到 confirmed（回滚会导致重试重复执行外部副作用，
 * 如 follow_up 重复创建 CRM 任务），而是把草稿置为 error 终态，提示人工介入。
 */
class SideEffectCommittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SideEffectCommittedError';
  }
}

/**
 * P1（复查第二轮）：executing 状态的陈旧阈值——超过视为执行进程崩溃残留，
 * 回收置 error 终态（副作用是否已执行未知，交人工核对，不允许静默重试）。
 */
const EXECUTING_STALE_MS = 10 * 60 * 1000;

/** 意图 -> 平台/动作的默认映射（NL 解析用） */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const INTENT_PLATFORM_HINT: Record<TaskDraftIntent, string[]> = {
  find_leads: ['douyin', 'xiaohongshu', 'kuaishou'],
  contact_leads: ['wechat-channel'],
  sync_crm: [],
  follow_up: ['wechat-channel'],
  report: [],
};

export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly growth: GrowthService,
    protected readonly authRequestContext?: AuthRequestContextService,
    protected readonly leadConvert?: LeadConvertService,
  ) {}

  /**
   * P3 租户隔离：解析用户真实租户（tenantMember 表）。
   * 无租户归属（本地/legacy）时回落 legacy-local-desktop，保证兼容。
   */
  /**
   * P3 租户 fail-closed：用请求租户上下文（x-tenant-id / membership）解析。
   * 无登录上下文、无租户归属、DB 异常 → 抛 403/401（文档要求跨租户失败必须阻断）。
   */
  async resolveTenantId(userId: string): Promise<string> {
    if (this.authRequestContext) {
      return await this.authRequestContext.resolveTenantId(this.prisma);
    }
    // 无上下文服务（测试/本地）：显式归属才放行，否则拒绝（不回落 legacy）
    try {
      const delegate = (
        this.prisma as unknown as {
          tenantMember?: {
            findFirst?: (args: {
              where: { userId: string };
              select: { tenantId: boolean };
            }) => Promise<{ tenantId: string } | null>;
          };
        }
      ).tenantMember;
      if (!delegate?.findFirst) {
        throw new ForbiddenException(
          '缺少租户上下文，任务草稿无法确定租户归属',
        );
      }
      const membership = await delegate.findFirst({
        where: { userId },
        select: { tenantId: true },
      });
      if (!membership?.tenantId) {
        throw new ForbiddenException(
          '当前账号未归属任何租户，不能创建任务草稿',
        );
      }
      return membership.tenantId;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ForbiddenException(
        `租户解析失败（fail-closed）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 解析 NL 意图（关键词启发式；不确定时归为 needs-input 由用户澄清） */
  parseIntent(raw: string): TaskDraftIntent {
    const text = raw.toLowerCase();
    // 触达/联系类优先于发现类（"联系这些线索"命中 contact 而非 find）
    if (/(联系|触达|私信|评论.*回复|聊|发消息)/.test(text))
      return 'contact_leads';
    if (/(同步|导入.*crm|crm.*同步|转.*客户)/.test(text)) return 'sync_crm';
    if (/(复盘|报告|统计|分析|漏斗|成交)/.test(text)) return 'report';
    if (/(跟进|回访|维护|老客户)/.test(text)) return 'follow_up';
    if (/(找|发现|挖掘|拉|获客|线索|潜客|评论.*用户|目标.*用户)/.test(text))
      return 'find_leads';
    return 'find_leads'; // 默认获客意图（可澄清）
  }

  /** 解析平台名（中文/英文别名 -> slug） */
  parsePlatform(raw: string): string | undefined {
    const text = raw.toLowerCase();
    if (/抖音|douyin/.test(text)) return 'douyin';
    if (/小红书|xiaohongshu|xhs/.test(text)) return 'xiaohongshu';
    if (/快手|kuaishou/.test(text)) return 'kuaishou';
    if (/微信|视频号|wechat|channel/.test(text)) return 'wechat-channel';
    if (/b站|bilibili|哔哩/.test(text)) return 'bilibili';
    return undefined;
  }

  /** 生成草稿哈希（确认内容防篡改：intent+goal+config+actions） */
  private hashDraft(draft: {
    intent: string;
    goal: string;
    config: unknown;
    actions: PlannedAction[];
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify(
          this.sortJson({
            intent: draft.intent,
            goal: draft.goal,
            config: draft.config,
            actions: draft.actions,
          }),
        ),
      )
      .digest('hex');
  }

  /** 递归按键排序（JSON 规范化）：Prisma JSONB 会重排对象键序，哈希前必须稳定化 */
  private sortJson(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.sortJson(v));
    }
    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = this.sortJson(obj[key]);
          return acc;
        }, {});
    }
    return value;
  }

  /**
   * 创建任务草稿（NL -> 结构化草稿）。
   * 只生成草稿，不创建配置、不执行任何外部动作。
   */
  async createDraft(
    userId: string,
    input: { naturalLanguage: string },
  ): Promise<GrowthTaskDraft> {
    const nl = input.naturalLanguage?.trim();
    if (!nl) throw new BadRequestException('自然语言输入不能为空');

    const intent = this.parseIntent(nl);
    const platform = this.parsePlatform(nl);
    const goal = nl;
    const missingFields: string[] = [];
    const blockers: string[] = [];

    if (!platform) missingFields.push('platform');
    // 关键词/来源词：从 NL 粗提取（引号内容或"装修/美业"等词），缺失则提示
    const keywordMatch = nl.match(/["'“”《「]([^"'"“”》」]{1,20})["'“”》」]/);
    if (!keywordMatch) missingFields.push('includeKeywords');

    const plannedActions: PlannedAction[] = this.buildPlannedActions(
      intent,
      platform,
    );
    const readiness =
      missingFields.length > 0
        ? 'needs-input'
        : plannedActions.some((a) => a.risk === 'high' || a.risk === 'blocked')
          ? 'needs-confirmation'
          : 'ready';

    const config: Record<string, unknown> = {
      platform,
      ...(keywordMatch ? { includeKeywords: [keywordMatch[1].trim()] } : {}),
      ...(intent === 'find_leads'
        ? { mode: 'draft-only', riskMode: 'confirm-first' }
        : {}),
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const draftRow = {
      id: randomUUID(),
      intent,
      goal,
      platform,
      config,
      plannedActions,
      missingFields,
      readiness,
      blockers,
    };
    const hash = this.hashDraft({
      intent,
      goal,
      config,
      actions: plannedActions,
    });

    const tenantId = await this.resolveTenantId(userId);
    const saved = await this.prisma.growthTaskDraft.create({
      data: {
        tenantId,
        userId: userId,
        intent,
        goal,
        platform: platform ?? null,
        accountId: null,
        configJson: config as never,
        plannedActions: plannedActions as never,
        missingFields,
        readiness,
        blockers,
        draftHash: hash,
        status: 'draft',
        expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
      },
    });

    return this.toDto(saved);
  }

  private buildPlannedActions(
    intent: TaskDraftIntent,
    platform?: string,
  ): PlannedAction[] {
    switch (intent) {
      case 'find_leads':
        return [
          {
            type: 'discover_candidates',
            label: `发现${platform ? this.platformLabel(platform) : ''}目标用户`,
            risk: 'medium',
            requiresConfirmation: true,
          },
          {
            type: 'enrich_lead',
            label: '线索补全与评分',
            risk: 'low',
            requiresConfirmation: false,
          },
        ];
      case 'contact_leads':
        return [
          {
            type: 'direct_message',
            label: '私信触达线索',
            risk: 'high',
            requiresConfirmation: true,
          },
        ];
      case 'sync_crm':
        return [
          {
            type: 'convert_crm',
            label: '线索转 CRM 客户',
            risk: 'medium',
            requiresConfirmation: true,
          },
        ];
      case 'follow_up':
        return [
          {
            type: 'follow_up',
            label: '老客户跟进触达',
            risk: 'high',
            requiresConfirmation: true,
          },
        ];
      case 'report':
        return [
          {
            type: 'generate_report',
            label: '生成复盘报告',
            risk: 'low',
            requiresConfirmation: false,
          },
        ];
    }
  }

  private platformLabel(p: string): string {
    const map: Record<string, string> = {
      douyin: '抖音',
      xiaohongshu: '小红书',
      kuaishou: '快手',
      'wechat-channel': '视频号',
      bilibili: 'B站',
    };
    return map[p] ?? p;
  }

  async getDraft(userId: string, id: string): Promise<GrowthTaskDraft> {
    const tenantId = await this.resolveTenantId(userId);
    const row = await this.prisma.growthTaskDraft.findFirst({
      where: { id, userId: userId, tenantId },
    });
    if (!row) throw new NotFoundException('任务草稿不存在');
    return this.toDto(row);
  }

  /**
   * 确认草稿：保存操作者/租户/风险摘要/草稿哈希（文档 §7.3 硬性要求），
   * 校验草稿未过期、哈希一致；同步创建 GrowthAcquisitionConfig（draft/confirm-first 态）。
   */
  async confirmDraft(
    userId: string,
    id: string,
    input: { riskSummary?: string } = {},
  ): Promise<GrowthTaskDraft> {
    const tenantId = await this.resolveTenantId(userId);
    const row = await this.prisma.growthTaskDraft.findFirst({
      where: { id, userId: userId, tenantId, status: 'draft' },
    });
    if (!row) throw new NotFoundException('任务草稿不存在或已处理');

    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await this.prisma.growthTaskDraft.update({
        where: { id },
        data: { status: 'expired' },
      });
      throw new ConflictException('任务草稿已过期，请重新创建');
    }

    // 哈希校验：确认内容未被篡改
    const currentHash = this.hashDraft({
      intent: row.intent,
      goal: row.goal,
      config: row.configJson,
      actions: (row.plannedActions ?? []) as PlannedAction[],
    });
    if (row.draftHash && currentHash !== row.draftHash) {
      throw new ConflictException('任务草稿内容已被修改，请重新确认');
    }

    // P1（复查 2026-08-22）：并发幂等——先原子抢占（仅 status='draft' 可确认），
    // 抢占成功后才创建配置；并发确认只有一个成功，失败方不产生任何外部副作用（无孤儿配置）
    const claimed = await this.prisma.growthTaskDraft.updateMany({
      where: { id, status: 'draft' },
      data: {
        status: 'confirmed',
        actorUserId: userId,
        riskSummary: input.riskSummary ?? this.buildRiskSummary(row),
        confirmedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('任务草稿已被确认或处理中，请勿重复提交');
    }

    // 抢占成功后创建对应的获客配置（draft 态，不执行）
    // 失败回滚 confirmed → draft：允许用户重试，且不留孤儿配置
    const config = row.configJson as Record<string, unknown>;
    let configId: string | undefined;
    if (row.intent === 'find_leads' || row.intent === 'contact_leads') {
      try {
        const created = await this.growth.createConfig(userId, {
          platform: row.platform,
          taskName: row.goal.slice(0, 40),
          sourceInputs: Array.isArray(config.includeKeywords)
            ? (config.includeKeywords as string[])
            : [],
          includeKeywords: config.includeKeywords,
          commentTemplates: ['您的需求已收到，稍后专属顾问联系您'],
          mode: 'draft-only',
          riskMode: 'confirm-first',
          status: 'disabled', // 止血：确认草稿创建的配置默认禁用，需手动启用
        });
        configId = created.id;
        const wrote = await this.prisma.growthTaskDraft.updateMany({
          where: { id, status: 'confirmed' },
          data: { configId },
        });
        if (wrote.count !== 1) {
          // P1（复查第二轮）：configId 回写失败——删除刚创建的配置（防孤儿），
          // 回滚草稿到 draft 允许重试
          await this.growth
            .deleteConfig(userId, configId)
            .catch((e: unknown) =>
              this.logger.error(
                `孤儿配置清理失败（${configId}，需人工删除）：${e instanceof Error ? e.message : String(e)}`,
              ),
            );
          await this.prisma.growthTaskDraft
            .updateMany({
              where: { id, status: 'confirmed' },
              data: { status: 'draft' },
            })
            .catch(() => undefined);
          throw new ConflictException(
            '配置关联草稿失败，已清理配置并回滚，请重试',
          );
        }
      } catch (error) {
        if (error instanceof ConflictException) throw error;
        // 回滚占位：配置未创建成功，草稿恢复 draft 允许重新确认（无孤儿配置）
        await this.prisma.growthTaskDraft
          .updateMany({
            where: { id, status: 'confirmed' },
            data: { status: 'draft' },
          })
          .catch(() => undefined);
        throw new ConflictException(
          `配置创建失败，草稿已回滚可重新确认：${(error as Error).message ?? String(error)}`,
        );
      }
    }

    const updated = await this.prisma.growthTaskDraft.findFirst({
      where: { id },
    });
    return this.toDto(updated!);
  }

  private buildRiskSummary(row: {
    intent: string;
    plannedActions: unknown;
    blockers: unknown;
  }): string {
    const actions = (row.plannedActions ?? []) as PlannedAction[];
    const highRisk = actions.filter((a) => a.risk === 'high').length;
    const mediumRisk = actions.filter((a) => a.risk === 'medium').length;
    return `意图 ${row.intent}：${highRisk} 项高风险、${mediumRisk} 项中风险动作需确认后执行`;
  }

  /** 执行已确认草稿：走 GrowthService 统一风险门与执行器 */
  async executeDraft(userId: string, id: string): Promise<GrowthTaskDraft> {
    const tenantId = await this.resolveTenantId(userId);
    // P1（复查第二轮）：先按 id+user+tenant 查任意状态——检测 executing 崩溃残留
    const existing = await this.prisma.growthTaskDraft.findFirst({
      where: { id, userId: userId, tenantId },
    });
    if (!existing) throw new NotFoundException('任务草稿不存在或未确认');
    if (existing.status === 'executing') {
      const staleMs = new Date(existing.updatedAt ?? 0).getTime();
      // updatedAt 缺失/非法 → NaN → 视为陈旧（防御：不允许永久卡 executing）
      const stale = !Number.isFinite(staleMs);
      const isStale = stale || Date.now() - staleMs > EXECUTING_STALE_MS;
      if (isStale) {
        // 进程崩溃残留：副作用是否已执行未知 → 置 error 终态交人工核对（不静默重试）
        await this.prisma.growthTaskDraft.updateMany({
          where: { id, status: 'executing' },
          data: { status: 'error' },
        });
        throw new ConflictException(
          '检测到执行中断的残留任务（执行进程可能已崩溃），已标记为 error，请人工核对副作用后重新发起',
        );
      }
      throw new ConflictException('任务正在执行或已完成，请勿重复提交');
    }
    if (existing.status !== 'confirmed') {
      throw new NotFoundException('任务草稿不存在或未确认');
    }
    const row = existing;

    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await this.prisma.growthTaskDraft.update({
        where: { id },
        data: { status: 'expired' },
      });
      throw new ConflictException('任务草稿已过期，请重新确认');
    }

    // P1（复查 2026-08-22）：并发幂等——先原子占位（仅 confirmed 可执行），
    // 重复执行只成功一次；副作用失败回滚占位允许重试
    const claim = await this.prisma.growthTaskDraft.updateMany({
      where: { id, status: 'confirmed' },
      data: { status: 'executing' },
    });
    if (claim.count !== 1) {
      throw new ConflictException('任务正在执行或已完成，请勿重复提交');
    }
    try {
      return await this.executeDraftInner(userId, id, row, tenantId);
    } catch (error) {
      // P1（复查 2026-08-22）：副作用已提交但状态更新失败——绝不回滚到 confirmed，
      // 否则重试会**重复执行外部副作用**（如 follow_up 重复建 CRM 任务）。
      // 置 error 终态（副作用已发生，提示人工核对），不再允许无脑重试。
      if (error instanceof SideEffectCommittedError) {
        await this.prisma.growthTaskDraft
          .updateMany({
            where: { id, status: 'executing' },
            data: { status: 'error' },
          })
          .catch(() => undefined);
        throw error;
      }
      // 副作用未产生（执行器/预检失败）：回滚 executing → confirmed（允许重试，无重复副作用）
      await this.prisma.growthTaskDraft
        .updateMany({
          where: { id, status: 'executing' },
          data: { status: 'confirmed' },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /** executeDraft 的副作用主体（占位成功后执行，最终置 executed） */
  private async executeDraftInner(
    userId: string,
    id: string,
    row: {
      intent: string;
      configId: string | null;
      configJson: unknown;
      platform: string | null;
      goal: string;
    },
    tenantId: string,
  ): Promise<GrowthTaskDraft> {
    // 同步执行（report 意图直接读报告；获客意图走配置 execute）
    let executed = false;
    if (row.intent === 'report') {
      executed = true; // 报告类由前端拉取 /growth/reports 展示，草稿仅记录执行
    } else if (row.configId) {
      await this.growth.executeConfig(userId, row.configId, {
        confirmedExecution: true,
      });
      executed = true;
    } else if (row.intent === 'find_leads' || row.intent === 'contact_leads') {
      // 确认时配置创建失败则补偿创建（仍走风险门）
      try {
        const cfgInput = (row.configJson ?? {}) as Record<string, unknown>;
        const created = await this.growth.createConfig(userId, {
          platform: row.platform,
          taskName: row.goal.slice(0, 40),
          sourceInputs: Array.isArray(cfgInput.includeKeywords)
            ? (cfgInput.includeKeywords as string[])
            : [],
          includeKeywords: cfgInput.includeKeywords,
          commentTemplates: ['您的需求已收到，稍后专属顾问联系您'],
          mode: 'draft-only',
          riskMode: 'confirm-first',
          status: 'disabled',
        });
        await this.growth.executeConfig(userId, created.id, {
          confirmedExecution: true,
        });
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        if (/不属于可用组织|平台账号|授权/.test(message)) {
          throw new BadRequestException(
            `执行前请先在「发布中心-账号管理」绑定 ${this.platformLabel(row.platform ?? '')} 平台账号：${message}`,
          );
        }
        throw new BadRequestException(`任务执行失败：${message}`);
      }
      executed = true;
    } else if (row.intent === 'sync_crm') {
      // P3 意图闭环（审计 2026-08-22）：把当前租户未同步线索批量转 CRM 客户
      // （LeadConvertService 原子转客户，幂等由 lead.customerId 保证）
      if (!this.leadConvert) {
        throw new BadRequestException('CRM 转换服务不可用，请稍后重试');
      }
      const leads = await this.prisma.lead.findMany({
        where: {
          userId,
          ...(tenantId ? { tenantId } : {}),
          customerId: null,
        },
        take: 20,
      });
      if (leads.length === 0) {
        throw new BadRequestException('当前没有待同步 CRM 的线索');
      }
      let synced = 0;
      for (const lead of leads) {
        try {
          await this.leadConvert.convert({
            leadId: lead.id,
            idempotencyKey: `draft-${id}-${lead.id}`,
            scope: { userId, tenantId: tenantId ?? null },
          });
          synced += 1;
        } catch (error) {
          this.logger.warn(
            `sync_crm 单条失败（线索 ${lead.id}）：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (synced === 0) {
        throw new BadRequestException(
          '线索同步 CRM 失败，请检查线索数据后重试',
        );
      }
      executed = true;
    } else if (row.intent === 'follow_up') {
      // P3 意图闭环：创建跟进任务（7 天后到期，来源标记草稿）
      // P1（复查 2026-08-22）：唯一幂等键——按 metadata.draftId 查重，
      // 重复执行（回滚重试/异常重放）不再创建第二个任务
      const crmFindFirst = (
        this.prisma.crmTask as unknown as {
          findFirst?: (args: {
            where: { metadata: { path: string[]; equals: string } };
          }) => Promise<unknown>;
        }
      ).findFirst;
      const existing = crmFindFirst
        ? await crmFindFirst({
            where: { metadata: { path: ['draftId'], equals: id } },
          }).catch(() => undefined)
        : undefined;
      if (!existing) {
        const dueAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        await this.prisma.crmTask.create({
          data: {
            ownerId: userId,
            ...(tenantId ? { tenantId } : {}),
            title: row.goal.slice(0, 80),
            description: `AI 任务草稿自动创建（${id}）：${row.goal}`,
            status: 'open',
            priority: 'normal',
            dueAt,
            metadata: { source: 'ai-assistant-draft', draftId: id },
          },
        });
      } else {
        this.logger.warn(
          `follow_up 幂等跳过：草稿 ${id} 已存在跟进任务，不重复创建`,
        );
      }
      executed = true;
    }

    if (!executed) {
      throw new BadRequestException('该意图暂不支持自动执行，请手动操作');
    }

    const done = await this.prisma.growthTaskDraft.updateMany({
      where: { id, status: 'executing' },
      data: { status: 'executed', executedAt: new Date() },
    });
    if (done.count !== 1) {
      // P1（复查 2026-08-22）：副作用已产生但最终状态更新失败——
      // 抛 SideEffectCommittedError，外层不回滚（防重试重复副作用）
      throw new SideEffectCommittedError(
        `任务草稿 ${id} 的副作用已执行，但最终状态更新失败（当前状态非 executing），请人工核对`,
      );
    }
    return this.toDto(
      (await this.prisma.growthTaskDraft.findFirst({ where: { id } }))!,
    );
  }

  async listDrafts(
    userId: string,
    status?: string,
  ): Promise<GrowthTaskDraft[]> {
    const tenantId = await this.resolveTenantId(userId);
    const rows = await this.prisma.growthTaskDraft.findMany({
      where: { userId: userId, tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.toDto(r));
  }

  private toDto(row: {
    id: string;
    intent: string;
    goal: string;
    platform: string | null;
    accountId: string | null;
    configJson: unknown;
    plannedActions: unknown;
    missingFields: unknown;
    readiness: string;
    blockers: unknown;
    draftHash: string | null;
    riskSummary: string | null;
    configId: string | null;
    status: string;
    expiresAt: Date;
    confirmedAt: Date | null;
    executedAt: Date | null;
  }): GrowthTaskDraft {
    return {
      id: row.id,
      intent: row.intent as TaskDraftIntent,
      goal: row.goal,
      platform: row.platform ?? undefined,
      accountId: row.accountId ?? undefined,
      config: (row.configJson ?? {}) as Record<string, unknown>,
      plannedActions: (row.plannedActions ?? []) as PlannedAction[],
      missingFields: (row.missingFields ?? []) as string[],
      readiness: row.readiness as GrowthTaskDraft['readiness'],
      blockers: (row.blockers ?? []) as string[],
      expiresAt: row.expiresAt.toISOString(),
      status: row.status,
      draftHash: row.draftHash ?? undefined,
      riskSummary: row.riskSummary ?? undefined,
      configId: row.configId ?? undefined,
      confirmedAt: row.confirmedAt?.toISOString(),
      executedAt: row.executedAt?.toISOString(),
    };
  }
}

/** Nest 可注入包装（依赖构造） */
@Injectable()
export class AiAssistantNestService extends AiAssistantService {
  constructor(
    prisma: PrismaService,
    growth: GrowthService,
    authRequestContext?: AuthRequestContextService,
    leadConvert?: LeadConvertService,
  ) {
    super(prisma, growth, authRequestContext, leadConvert);
  }
}
