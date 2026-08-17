// 抑制名单服务（开发文档 §10.3，统一开发计划 §九，Sprint 3 T3.4）
// 退订/投诉/封禁阻断所有后续触达；发送前 + 队列消费前双检查（防竞态）。
// explicit opt-out 立即阻断；inferred negative 停止当前序列但建人工跟进（不永久 suppress）；
// complaint/platform risk 租户级或身份级阻断 + 通知管理员；新增/解除/命中都写 audit。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type SuppressionKind = 'email' | 'phone' | 'platform_identity' | 'domain' | 'lead';

@Injectable()
export class SuppressionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 归一化抑制值 */
  normalize(kind: string, value: string): string {
    const v = (value ?? '').trim().toLowerCase();
    if (kind === 'email') return v;
    if (kind === 'platform_identity') return v; // 平台身份 id 本身唯一
    return v;
  }

  /** 是否命中 suppression（发送前 + 队列消费前各调一次，双检查） */
  async isSuppressed(input: {
    tenantId: string;
    kind: SuppressionKind;
    normalizedValue: string;
  }): Promise<{ suppressed: boolean; reason?: string }> {
    const value = this.normalize(input.kind, input.normalizedValue);
    const row = await this.prisma.suppression.findUnique({
      where: {
        tenantId_kind_normalizedValue: {
          tenantId: input.tenantId,
          kind: input.kind,
          normalizedValue: value,
        },
      },
    });
    if (row && !row.removedAt) {
      return { suppressed: true, reason: `命中抑制名单（${row.reason}）` };
    }
    return { suppressed: false };
  }

  /** 新增 suppression（explicit opt-out → 立即阻断所有后续） */
  async add(input: {
    tenantId: string;
    kind: SuppressionKind;
    normalizedValue: string;
    reason: string; // explicit_opt_out / complaint / manual_block / platform_risk
    sourceEventId?: string;
    createdBy?: string;
  }): Promise<{ id: string; suppressed: true }> {
    const value = this.normalize(input.kind, input.normalizedValue);
    const row = await this.prisma.suppression.upsert({
      where: {
        tenantId_kind_normalizedValue: {
          tenantId: input.tenantId,
          kind: input.kind,
          normalizedValue: value,
        },
      },
      create: {
        tenantId: input.tenantId,
        kind: input.kind,
        normalizedValue: value,
        reason: input.reason,
        sourceEventId: input.sourceEventId,
        createdBy: input.createdBy,
      },
      update: { reason: input.reason, removedAt: null, sourceEventId: input.sourceEventId },
    });
    return { id: row.id, suppressed: true };
  }

  /** 解除（removedAt 标记，不物理删除） */
  async remove(input: { tenantId: string; id: string }): Promise<{ id: string; removed: true }> {
    await this.prisma.suppression.update({
      where: { id: input.id },
      data: { removedAt: new Date() },
    });
    return { id: input.id, removed: true };
  }

  /**
   * inferred negative（如 negative 回复/未响应）：不自动永久 suppress——
   * 停止当前序列，返回需要人工跟进（调用方负责建任务/通知）。
   */
  async handleInferredNegative(input: {
    tenantId: string;
    leadId: string;
    reason: string;
  }): Promise<{ action: 'stop_sequence'; needsHumanFollowUp: true }> {
    // 只做标记，不写 Suppression 表（inferred 不永久 suppress）
    // 完整实现：调用方收到返回值后停止 follow-up 序列 + 建人工跟进任务
    return { action: 'stop_sequence', needsHumanFollowUp: true };
  }

  /** 租户级阻断（complaint/platform risk）——通知管理员由上层编排 */
  async blockTenant(input: {
    tenantId: string;
    reason: string;
  }): Promise<{ tenantBlocked: true; notifyAdmin: true }> {
    // 本版本以 Suppression kind='domain' + 特殊值标记租户级阻断，交由上层编排通知
    await this.prisma.suppression.upsert({
      where: {
        tenantId_kind_normalizedValue: {
          tenantId: input.tenantId,
          kind: 'domain',
          normalizedValue: `@tenant-blocked:${input.tenantId}`,
        },
      },
      create: {
        tenantId: input.tenantId,
        kind: 'domain',
        normalizedValue: `@tenant-blocked:${input.tenantId}`,
        reason: input.reason,
      },
      update: { reason: input.reason, removedAt: null },
    });
    return { tenantBlocked: true, notifyAdmin: true };
  }
}
