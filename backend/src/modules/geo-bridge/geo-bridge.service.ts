import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertGeoBridgeTaskInput {
  actionId: string;
  actionType: string;
  actionTitle: string;
  status?: string;
  source?: string;
  brandId?: string;
  brandName?: string;
  platform?: string;
  brief?: string;
  goal?: string;
  reason?: string;
  retestWindow?: string;
  returnUrl?: string;
  callbackUrl?: string;
  keyword?: string;
  contentPreview?: string;
  resultUrl?: string;
  publishedUrl?: string;
  lastCallbackAt?: string;
}

export interface PatchGeoBridgeTaskInput {
  actionId: string;
  status?: string;
  resultUrl?: string;
  publishedUrl?: string;
  lastCallbackAt?: string;
}

@Injectable()
export class GeoBridgeService {
  constructor(private readonly prisma: PrismaService) {}

  listTasks(limit = 50) {
    return this.prisma.geoBridgeTask.findMany({
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async upsertTask(input: UpsertGeoBridgeTaskInput) {
    this.assertRequired(input);

    const data = {
      actionType: input.actionType,
      actionTitle: input.actionTitle,
      status: input.status || 'sent_to_ai_content',
      source: input.source || 'kaypal-geo',
      brandId: input.brandId || null,
      brandName: input.brandName || null,
      platform: input.platform || null,
      brief: input.brief || null,
      goal: input.goal || null,
      reason: input.reason || null,
      retestWindow: input.retestWindow || null,
      returnUrl: input.returnUrl || null,
      callbackUrl: input.callbackUrl || null,
      keyword: input.keyword || null,
      contentPreview: input.contentPreview || null,
      resultUrl: input.resultUrl || null,
      publishedUrl: input.publishedUrl || null,
      lastCallbackAt: input.lastCallbackAt
        ? new Date(input.lastCallbackAt)
        : null,
    };

    return this.prisma.geoBridgeTask.upsert({
      where: { actionId: input.actionId },
      create: {
        actionId: input.actionId,
        ...data,
      },
      update: data,
    });
  }

  async patchTask(input: PatchGeoBridgeTaskInput) {
    if (!input.actionId?.trim()) {
      throw new BadRequestException('缺少 GEO 动作 ID');
    }

    const existing = await this.prisma.geoBridgeTask.findUnique({
      where: { actionId: input.actionId },
    });
    if (!existing) {
      throw new NotFoundException('GEO 联动任务不存在');
    }

    return this.prisma.geoBridgeTask.update({
      where: { actionId: input.actionId },
      data: {
        status: input.status || existing.status,
        resultUrl: input.resultUrl ?? existing.resultUrl,
        publishedUrl: input.publishedUrl ?? existing.publishedUrl,
        lastCallbackAt: input.lastCallbackAt
          ? new Date(input.lastCallbackAt)
          : existing.lastCallbackAt,
      },
    });
  }

  private assertRequired(input: UpsertGeoBridgeTaskInput) {
    if (!input.actionId?.trim()) {
      throw new BadRequestException('缺少 GEO 动作 ID');
    }
    if (!input.actionType?.trim()) {
      throw new BadRequestException('缺少 GEO 动作类型');
    }
    if (!input.actionTitle?.trim()) {
      throw new BadRequestException('缺少 GEO 动作标题');
    }
  }
}
