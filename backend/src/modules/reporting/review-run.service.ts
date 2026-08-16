import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FunnelReportService } from './funnel-report.service';

/** 洞察（报告 9.2 D：observation/evidence/confidence/decision） */
export interface ReviewInsight {
  observation: string;
  evidence: string;
  confidence: string;
  decision: string;
}

/** 下一步动作（报告 9.2 D：action/expectedSignal） */
export interface ReviewAction {
  action: string;
  expectedSignal: string;
}

export interface ReviewRunInput {
  period: '7d' | '30d';
  generatedFrom?: string; // articleId 或 'global'
  insights: ReviewInsight[];
  actions: ReviewAction[];
}

/**
 * 复盘运行（六步闭环报告 3.1 ReviewRun）：把「复盘结果」从一次性数字
 * 变成「可复现 + 可回写」的对象。保存六步漏斗快照 + 洞察 + 下一步动作，
 * 支持回写为新内容计划（复盘产生下一轮输入）。
 */
@Injectable()
export class ReviewRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funnelReport: FunnelReportService,
  ) {}

  /** 生成复盘：先算漏斗快照，再存洞察 + 动作 */
  async generate(
    input: ReviewRunInput,
    owner: { userId: string; tenantId?: string | null; actorUserId?: string | null },
  ) {
    const funnel = input.generatedFrom
      ? await this.funnelReport.articleFunnel(input.generatedFrom)
      : await this.funnelReport.funnel(input.period === '30d' ? 30 : 7);

    return this.prisma.reviewRun.create({
      data: {
        tenantId: owner.tenantId ?? null,
        userId: owner.userId,
        actorUserId: owner.actorUserId ?? null,
        period: input.period,
        filters: {},
        funnel: funnel as Prisma.InputJsonValue,
        insights: input.insights as unknown as Prisma.InputJsonValue,
        actions: input.actions as unknown as Prisma.InputJsonValue,
        generatedFrom: input.generatedFrom ?? null,
      },
    });
  }

  async list(owner: { userId: string; tenantId?: string | null }) {
    return this.prisma.reviewRun.findMany({
      where: { userId: owner.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const run = await this.prisma.reviewRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('复盘记录不存在');
    return run;
  }

  /** 回写：把一条复盘动作复制为新内容计划（报告 9.2 E「复制为新 ContentPlan」） */
  async copyActionToContentPlan(
    runId: string,
    actionIndex: number,
    owner: { userId: string; tenantId?: string | null; actorUserId?: string | null },
  ) {
    const run = await this.findOne(runId);
    const actions = Array.isArray(run.actions) ? run.actions : [];
    const action = actions[actionIndex] as unknown as ReviewAction | undefined;
    if (!action) throw new NotFoundException('该复盘没有对应的动作');

    return this.prisma.contentPlan.create({
      data: {
        tenantId: owner.tenantId ?? null,
        userId: owner.userId,
        actorUserId: owner.actorUserId ?? null,
        name: action.action.slice(0, 180),
        goal: '转化',
        audience: run.generatedFrom ?? undefined,
        successMetric: action.expectedSignal,
        evidenceRefs: [
          { type: 'review_run', id: run.id, generatedFrom: run.generatedFrom },
        ] as Prisma.InputJsonValue,
      },
    });
  }
}
