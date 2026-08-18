import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** 对象类型白名单 */
export const ATTRIBUTION_TYPES = [
  'content',
  'publish',
  'interaction',
  'lead',
  'customer',
  'opportunity',
] as const;
export type AttributionType = (typeof ATTRIBUTION_TYPES)[number];

/** 归因模型（报告 9.2 B 三层归因） */
export const ATTRIBUTION_MODELS = [
  'deterministic', // 确定：字段 ID 直连
  'rule_based', // 规则：URL/评论引用/UTM 匹配
  'inferred', // 推断：时间窗口/身份/行为序列，低置信度
] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export interface AttributionLinkInput {
  fromType: AttributionType;
  fromId: string;
  toType: AttributionType;
  toId: string;
  model?: AttributionModel;
  confidence?: 'high' | 'medium' | 'low';
  label?: string;
  evidence?: Record<string, unknown>;
}

/**
 * 归因链接（六步闭环报告 3.1 AttributionLink）：通用关系表，
 * 记录「谁影响了谁」+ 归因模型 + 置信度 + 关系标签。
 *
 * 方向：from = 上游（原因），to = 下游（结果）。例如
 *   content→publish→interaction→lead→customer→opportunity。
 * 幂等：同一 (from, to, model) 只存一条，重复 upsert 覆盖证据。
 */
@Injectable()
export class AttributionLinkService {
  constructor(private readonly prisma: PrismaService) {}

  private validate(input: AttributionLinkInput): void {
    if (!ATTRIBUTION_TYPES.includes(input.fromType) || !ATTRIBUTION_TYPES.includes(input.toType)) {
      throw new BadRequestException(
        `不支持的对象类型（from=${input.fromType} to=${input.toType}，白名单：${ATTRIBUTION_TYPES.join('/')}）`,
      );
    }
    const model = input.model ?? 'deterministic';
    if (!ATTRIBUTION_MODELS.includes(model)) {
      throw new BadRequestException(
        `不支持的归因模型：${model}（白名单：${ATTRIBUTION_MODELS.join('/')}）`,
      );
    }
    if (input.confidence && !CONFIDENCE_LEVELS.includes(input.confidence)) {
      throw new BadRequestException(`不支持的置信度：${input.confidence}`);
    }
  }

  /** 记录一条归因链接（幂等 upsert） */
  async link(
    input: AttributionLinkInput,
    owner: { userId: string; tenantId?: string | null },
  ) {
    this.validate(input);
    const model = input.model ?? 'deterministic';
    return this.prisma.attributionLink.upsert({
      where: {
        tenantId_fromType_fromId_toType_toId_model: {
          tenantId: owner.tenantId ?? 'legacy-local-desktop',
          fromType: input.fromType,
          fromId: input.fromId,
          toType: input.toType,
          toId: input.toId,
          model,
        },
      },
      create: {
        tenantId: owner.tenantId ?? 'legacy-local-desktop',
        userId: owner.userId,
        fromType: input.fromType,
        fromId: input.fromId,
        toType: input.toType,
        toId: input.toId,
        model,
        confidence: input.confidence ?? 'high',
        label: input.label,
        evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        confidence: input.confidence ?? 'high',
        label: input.label,
        evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** 查上游链（谁影响了这个对象） */
  async resolveUpstream(toType: AttributionType, toId: string) {
    return this.prisma.attributionLink.findMany({
      where: { toType, toId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 查下游链（这个对象影响了谁） */
  async resolveDownstream(fromType: AttributionType, fromId: string) {
    return this.prisma.attributionLink.findMany({
      where: { fromType, fromId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
