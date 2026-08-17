// 线索信号存取（LeadSignal 表，开发文档 §6.4）
// 信号 = 一次加减分的证据点，幂等写入（同 leadId+type+evidenceId 只保留一条）。
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type LeadSignalInput = {
  tenantId: string;
  userId: string;
  leadId: string;
  type: string;
  value?: number;
  evidenceId?: string | null;
  source?: string | null;
  observedAt: Date;
  expiresAt?: Date | null;
  confidence?: number;
};

@Injectable()
export class LeadSignalStore {
  constructor(private readonly prisma: PrismaService) {}

  /** 幂等写入多条信号：同 leadId+type+evidenceId 已存在则跳过 */
  async saveSignals(inputs: LeadSignalInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    let created = 0;
    for (const s of inputs) {
      const existing = await this.prisma.leadSignal.findFirst({
        where: {
          tenantId: s.tenantId,
          leadId: s.leadId,
          type: s.type,
          evidenceId: s.evidenceId ?? null,
        },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.leadSignal.create({
        data: {
          tenantId: s.tenantId,
          userId: s.userId,
          leadId: s.leadId,
          type: s.type,
          value: s.value ?? 1,
          evidenceId: s.evidenceId ?? undefined,
          source: s.source ?? undefined,
          observedAt: s.observedAt,
          expiresAt: s.expiresAt ?? undefined,
          confidence: s.confidence ?? 100,
        },
      });
      created += 1;
    }
    return created;
  }

  /** 按 leadId 列出全部信号（未过期优先，最近优先） */
  async listSignals(tenantId: string, leadId: string): Promise<LeadSignalInput[]> {
    const rows = await this.prisma.leadSignal.findMany({
      where: { tenantId, leadId },
      orderBy: [{ observedAt: 'desc' }],
    });
    return rows.map((r) => ({
      tenantId: r.tenantId,
      userId: r.userId,
      leadId: r.leadId,
      type: r.type,
      value: r.value,
      evidenceId: r.evidenceId,
      source: r.source,
      observedAt: r.observedAt,
      expiresAt: r.expiresAt,
      confidence: r.confidence,
    }));
  }

  /** 清空某线索信号（供重建评分用） */
  async clearSignals(tenantId: string, leadId: string): Promise<void> {
    await this.prisma.leadSignal.deleteMany({ where: { tenantId, leadId } });
  }
}

// 供 service 层使用的 Prisma 类型别名
export type LeadSignalRow = Prisma.LeadSignalGetPayload<Record<string, never>>;
