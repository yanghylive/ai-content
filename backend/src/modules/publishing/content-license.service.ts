// 素材版权/授权校验（开发计划 C 档横切，2026-08-16）
// 发布前检查 ContentVariant 的版权状态：unauthorized 禁止发布、unknown 警告提示补录、authorized 放行。
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type LicenseStatus = 'unknown' | 'authorized' | 'unauthorized' | 'pending';

export interface LicenseCheckResult {
  licenseStatus: LicenseStatus;
  allowedToPublish: boolean;
  /** 阻断时给用户的明确原因 */
  reason: string | null;
}

@Injectable()
export class ContentLicenseService {
  constructor(private readonly prisma: PrismaService) {}

  /** 发布前版权检查（preflight 的一环） */
  async checkLicense(input: {
    tenantId: string;
    variantId: string;
  }): Promise<LicenseCheckResult> {
    const variant = await this.prisma.contentVariant.findFirst({
      where: { id: input.variantId, tenantId: input.tenantId },
      select: { id: true, licenseStatus: true, copyrightNotice: true },
    });
    if (!variant) {
      // 变体不存在（可能还是旧 Article 直发）→ 未知状态，警告但允许（不阻断旧流程）
      return {
        licenseStatus: 'unknown',
        allowedToPublish: true,
        reason: '素材未登记版权状态（旧流程），建议补录授权信息',
      };
    }
    switch (variant.licenseStatus) {
      case 'unauthorized':
        return {
          licenseStatus: 'unauthorized',
          allowedToPublish: false,
          reason: `素材未获授权（${variant.copyrightNotice ?? '无版权说明'}），禁止发布`,
        };
      case 'authorized':
        return {
          licenseStatus: 'authorized',
          allowedToPublish: true,
          reason: null,
        };
      case 'pending':
        return {
          licenseStatus: 'pending',
          allowedToPublish: false,
          reason: '素材授权审核中，通过后放行',
        };
      case 'unknown':
      default:
        return {
          licenseStatus: 'unknown',
          allowedToPublish: true,
          reason: '素材版权状态未知，建议补录授权信息后发布',
        };
    }
  }

  /** 登记/更新版权状态 */
  async setLicense(input: {
    tenantId: string;
    variantId: string;
    status: LicenseStatus;
    notice?: string;
  }): Promise<{ id: string; licenseStatus: LicenseStatus }> {
    const existing = await this.prisma.contentVariant.findFirst({
      where: { id: input.variantId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('素材变体不存在');
    const updated = await this.prisma.contentVariant.update({
      where: { id: input.variantId },
      data: {
        licenseStatus: input.status,
        copyrightNotice: input.notice,
      },
    });
    return { id: updated.id, licenseStatus: updated.licenseStatus as LicenseStatus };
  }

  /** 批量检查（批量发布前） */
  async checkMany(input: { tenantId: string; variantIds: string[] }) {
    const results: Array<{ variantId: string } & LicenseCheckResult> = [];
    for (const variantId of input.variantIds) {
      results.push({
        variantId,
        ...(await this.checkLicense({ tenantId: input.tenantId, variantId })),
      });
    }
    const blocked = results.filter((r) => !r.allowedToPublish);
    return { results, blockedCount: blocked.length };
  }
}
