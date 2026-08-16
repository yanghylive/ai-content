import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

/** 内容资产类型：策略 / 策略模板 / 风格 */
export type ContentAssetType = 'strategy' | 'strategy_template' | 'style';

/**
 * 内容资产版本化（报告 16.3 第 8 项）：策略/风格/策略模板 每次改动留痕，
 * 支持历史查询 + 回滚，记录操作人（actorUserId）。
 *
 * 设计要点：
 * - recordVersion 是「记账旁路」：失败不阻断资产主流程（try/catch 吞掉）。
 * - 幂等：snapshot 与最新版本相同时跳过，避免记录无变化的版本。
 * - snapshot 存 JSON 字符串，由各资产 service 构造（它们知道自己有哪些内容字段）。
 */
@Injectable()
export class ContentAssetVersioningService {
  private readonly logger = new Logger(ContentAssetVersioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  private actor() {
    const ctx = this.authRequestContext?.get();
    return {
      tenantId: ctx?.tenantId ?? null,
      actorUserId: ctx?.user?.id ?? null,
    };
  }

  /** 记录一次资产改动（幂等旁路） */
  async recordVersion(input: {
    assetType: ContentAssetType;
    assetId: string;
    snapshot: Record<string, unknown>;
    changeSummary: string;
  }): Promise<void> {
    try {
      const { tenantId, actorUserId } = this.actor();
      const snapshotJson = JSON.stringify(input.snapshot);

      const latest = await this.prisma.contentAssetVersion.findFirst({
        where: { assetType: input.assetType, assetId: input.assetId },
        orderBy: { versionNo: 'desc' },
      });
      // 内容无变化则跳过（幂等）
      if (latest && latest.snapshot === snapshotJson) {
        return;
      }

      const versionNo = (latest?.versionNo ?? 0) + 1;
      await this.prisma.contentAssetVersion.create({
        data: {
          tenantId,
          assetType: input.assetType,
          assetId: input.assetId,
          versionNo,
          snapshot: snapshotJson,
          changeSummary: input.changeSummary,
          actorUserId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `资产版本记录失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 查询资产的版本历史（倒序，不含 snapshot 正文） */
  async listVersions(assetType: ContentAssetType, assetId: string) {
    return this.prisma.contentAssetVersion.findMany({
      where: { assetType, assetId },
      orderBy: { versionNo: 'desc' },
      select: {
        id: true,
        versionNo: true,
        changeSummary: true,
        actorUserId: true,
        createdAt: true,
      },
    });
  }

  /** 读取某版本的快照（供回滚） */
  async getSnapshot(
    assetType: ContentAssetType,
    assetId: string,
    versionNo: number,
  ): Promise<Record<string, unknown> | null> {
    const record = await this.prisma.contentAssetVersion.findUnique({
      where: {
        assetType_assetId_versionNo: {
          assetType,
          assetId,
          versionNo,
        },
      },
    });
    if (!record?.snapshot) return null;
    try {
      return JSON.parse(record.snapshot) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
