import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ContentPlanInput {
  name: string;
  goal: string;
  audience?: string;
  coreClaim?: string;
  offer?: string;
  platforms?: unknown[];
  successMetric?: string;
  evidenceRefs?: unknown[];
}

const PLAN_GOALS = ['品牌认知', '教育', '咨询', '留资', '转化'];

/**
 * 内容计划（六步闭环报告 3.1 ContentPlan）：从「写文章」升级为
 * 「创建内容任务包」——说明为什么做这条内容、目标受众、CTA、怎么算成功。
 * ReviewRun 复盘会回写到这里（复制为新计划）。
 */
@Injectable()
export class ContentPlanService {
  constructor(private readonly prisma: PrismaService) {}

  private validateGoal(goal: string): void {
    if (!PLAN_GOALS.includes(goal)) {
      throw new BadRequestException(
        `不支持的内容目标：${goal}（可选：${PLAN_GOALS.join(' / ')}）`,
      );
    }
  }

  async create(input: ContentPlanInput, owner: { userId: string; tenantId?: string | null; actorUserId?: string | null }) {
    this.validateGoal(input.goal);
    return this.prisma.contentPlan.create({
      data: {
        tenantId: owner.tenantId ?? null,
        userId: owner.userId,
        actorUserId: owner.actorUserId ?? null,
        name: input.name,
        goal: input.goal,
        audience: input.audience,
        coreClaim: input.coreClaim,
        offer: input.offer,
        platforms: (input.platforms ?? []) as Prisma.InputJsonValue,
        successMetric: input.successMetric,
        evidenceRefs: (input.evidenceRefs ?? []) as Prisma.InputJsonValue,
      },
    });
  }

  async list(owner: { userId: string; tenantId?: string | null }, status?: string) {
    return this.prisma.contentPlan.findMany({
      where: {
        userId: owner.userId,
        ...(status ? { status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('内容计划不存在');
    return plan;
  }

  async update(id: string, data: Partial<ContentPlanInput>) {
    await this.findOne(id);
    if (data.goal) this.validateGoal(data.goal);
    return this.prisma.contentPlan.update({
      where: { id },
      data: {
        name: data.name,
        goal: data.goal,
        audience: data.audience,
        coreClaim: data.coreClaim,
        offer: data.offer,
        platforms: data.platforms as Prisma.InputJsonValue | undefined,
        successMetric: data.successMetric,
        evidenceRefs: data.evidenceRefs as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.contentPlan.delete({ where: { id } });
  }

  async activate(id: string) {
    await this.findOne(id);
    return this.prisma.contentPlan.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  async archive(id: string) {
    await this.findOne(id);
    return this.prisma.contentPlan.update({
      where: { id },
      data: { status: 'archived' },
    });
  }
}
