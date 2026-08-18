import { Injectable } from '@nestjs/common';
import {
  EVIDENCE_LEVELS,
  EvidenceLevel,
  FallbackType,
  PROVENANCE_TYPES,
  ProvenanceType,
} from './enums';

/**
 * 案例发布前服务端校验。
 *
 * 发布阻断规则（架构 §4 + 任务 M1-02）：
 *   1. slug 格式：仅小写字母/数字/连字符，且不以连字符开头或结尾
 *   2. provenanceType 必须为四类来源之一
 *   3. 四类来源必要条件：
 *      - 九章交付（delivery）：需授权记录 + 内部证明（授权审核通过）
 *      - 开源演示（open_source）：需上游地址 + 许可证 + 版本
 *      - 原型/模板（prototype/template）：需演示数据声明
 *   4. evidenceLevel != E0 必须提供 evidenceScope
 *   5. keyFeatures 至少 3 项，每项 title/description 非空
 *   6. 发布需至少 1 条媒体 + 至少 1 个带回退方案的体验入口
 *   7. nextReviewAt 必须晚于当前时间
 *   8. 创建者不能同时是最终审核人（职责分离）
 */

export interface MediaLike {
  id?: string;
}

export interface KeyFeatureLike {
  title?: string;
  description?: string;
}

export interface DemoEndpointLike {
  endpointType?: string;
  fallbackType?: string;
  fallbackTarget?: string | null;
}

export interface AuthorizationLike {
  recordType?: string;
  reviewStatus?: string;
  licenseName?: string | null;
  sourceUrl?: string | null;
  versionOrCommit?: string | null;
}

export interface CasePublishValidationInput {
  slug: string;
  provenanceType: string;
  evidenceLevel: string;
  evidenceScope?: string | null;
  keyFeatures?: KeyFeatureLike[];
  nextReviewAt?: Date | string | null;
  ownerUserId?: string | null;
  reviewerUserId?: string | null;
  media?: MediaLike[];
  demoEndpoints?: DemoEndpointLike[];
  authorizations?: AuthorizationLike[];
  /** 原型/模板案例的演示数据声明 */
  demoDataDeclaration?: boolean;
}

export interface CaseValidationResult {
  ok: boolean;
  errors: string[];
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class CaseValidationService {
  /** 校验 slug 格式：小写字母/数字/连字符 */
  isValidSlug(slug: string): boolean {
    return SLUG_PATTERN.test(slug);
  }

  /** 校验四类来源取值是否合法 */
  isValidProvenanceType(provenanceType: string): boolean {
    return PROVENANCE_TYPES.includes(provenanceType);
  }

  /** 发布前全量校验，返回 ok 与错误清单 */
  validateForPublish(input: CasePublishValidationInput): CaseValidationResult {
    const errors: string[] = [];

    // 1. slug 格式
    if (!this.isValidSlug(input.slug)) {
      errors.push(
        'slug 格式非法：仅允许小写字母/数字/连字符，且不能以连字符开头或结尾',
      );
    }

    // 2. provenanceType 合法
    if (!this.isValidProvenanceType(input.provenanceType)) {
      errors.push(
        `provenanceType 非法：${input.provenanceType}，须为 ${PROVENANCE_TYPES.join('/')}`,
      );
    }

    // 3. 四类来源必要条件
    this.collectProvenanceErrors(input, errors);

    // 4. evidenceLevel 合法性 + E0 之外需 evidenceScope
    if (!EVIDENCE_LEVELS.includes(input.evidenceLevel)) {
      errors.push(
        `evidenceLevel 非法：${input.evidenceLevel}，须为 ${EVIDENCE_LEVELS.join('/')}`,
      );
    } else if (
      input.evidenceLevel !== EvidenceLevel.E0 &&
      (!input.evidenceScope || input.evidenceScope.trim().length === 0)
    ) {
      errors.push(`证据等级为 ${input.evidenceLevel} 时必须提供 evidenceScope`);
    }

    // 5. keyFeatures 至少 3 项，每项 title/description 非空
    const keyFeatures = input.keyFeatures ?? [];
    if (keyFeatures.length < 3) {
      errors.push('发布必须至少包含 3 项关键特性（keyFeatures）');
    } else if (
      keyFeatures.some(
        (feature) =>
          !feature || !feature.title?.trim() || !feature.description?.trim(),
      )
    ) {
      errors.push(
        '每个关键特性（keyFeatures）的 title 和 description 都必须非空',
      );
    }

    // 6. 发布需至少 1 媒体 + 1 带回退方案的体验入口
    if ((input.media ?? []).length === 0) {
      errors.push('发布必须至少包含 1 条媒体');
    }
    const demos = input.demoEndpoints ?? [];
    if (demos.length === 0) {
      errors.push('发布必须至少包含 1 个演示体验入口');
    } else if (
      !demos.some(
        (demo) => demo.fallbackType && demo.fallbackType !== FallbackType.None,
      )
    ) {
      errors.push(
        '演示体验入口必须配置回退方案（fallbackType 不能为空或 none）',
      );
    }

    // 7. nextReviewAt 必须晚于当前时间
    const nextReview = this.toTimestamp(input.nextReviewAt);
    if (nextReview === null) {
      errors.push('发布必须设置 nextReviewAt（下次复核时间）');
    } else if (nextReview <= Date.now()) {
      errors.push('nextReviewAt 必须晚于当前时间');
    }

    // 8. 创建者不能是唯一最终审核人（职责分离）
    if (
      input.ownerUserId &&
      input.reviewerUserId &&
      input.ownerUserId === input.reviewerUserId
    ) {
      errors.push('案例创建者不能同时是最终审核人（职责分离）');
    }

    return { ok: errors.length === 0, errors };
  }

  private collectProvenanceErrors(
    input: CasePublishValidationInput,
    errors: string[],
  ): void {
    const auths = input.authorizations ?? [];

    if (input.provenanceType === ProvenanceType.Delivery) {
      if (auths.length === 0) {
        errors.push('九章交付案例必须提供至少一条授权记录');
      } else if (!auths.some((a) => a.reviewStatus === 'approved')) {
        errors.push('九章交付案例的授权记录须经审核通过（内部证明）');
      }
      return;
    }

    if (input.provenanceType === ProvenanceType.OpenSource) {
      const oss = auths.filter((a) => a.recordType === 'oss_license');
      if (oss.length === 0) {
        errors.push('开源演示案例必须提供开源许可记录（oss_license）');
      } else {
        if (!oss.some((a) => a.sourceUrl)) {
          errors.push('开源演示案例必须提供上游源码地址');
        }
        if (!oss.some((a) => a.licenseName)) {
          errors.push('开源演示案例必须提供许可证名称');
        }
        if (!oss.some((a) => a.versionOrCommit)) {
          errors.push('开源演示案例必须提供版本或提交号');
        }
      }
      return;
    }

    if (
      input.provenanceType === ProvenanceType.Prototype ||
      input.provenanceType === ProvenanceType.Template
    ) {
      if (input.demoDataDeclaration !== true) {
        errors.push(
          '原型/模板案例必须声明演示数据（demoDataDeclaration=true）',
        );
      }
    }
  }

  private toTimestamp(value: Date | string | null | undefined): number | null {
    if (!value) return null;
    const time =
      value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }
}
