import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ContentQualityInput,
  ContentQualityResult,
  ContentQualityVerdict,
  QualityCheckKey,
  QualityCheckResult,
} from './content-quality-gate.types';

/** 方案 5.3：内容质量门六项检查（确定性规则，fail-closed） */

const CHECK_LABEL: Record<QualityCheckKey, string> = {
  evidence: '事实证据来源',
  absolute_claim: '绝对化或无法证明的承诺',
  duplicate: '与历史内容重复',
  platform_format: '平台长度和格式',
  cta: 'CTA 明确且可追踪',
  asset_completeness: '素材/链接/标签完整性',
};

/** 绝对化 / 无法证明的承诺词表（高风险） */
const ABSOLUTE_TERMS = [
  '全网第一',
  '第一名',
  '第一名',
  '百分百',
  '百分之百',
  '稳赚',
  '稳赢',
  '零风险',
  '包治',
  '根治',
  '药到病除',
  '立即见效',
  '永久',
  '绝对有效',
  '保证翻倍',
];

/** 收益 / 医疗功效类承诺词（高风险，需证据） */
const CLAIM_TERMS = ['收益', '回报', '治愈', '疗效', '根治', '翻倍', '暴涨'];

/** 各平台标题最大长度（字符） */
const TITLE_MAX: Record<string, number> = {
  xiaohongshu: 20,
  douyin: 30,
  article: 60,
  video_script: 40,
  default: 60,
};

/** 各平台正文最大长度（字符，粗略） */
const CONTENT_MAX: Record<string, number> = {
  xiaohongshu: 1000,
  douyin: 300,
  article: 20000,
  video_script: 2000,
  default: 20000,
};

@Injectable()
export class ContentQualityGateService {
  constructor(private readonly prisma: PrismaService) {}

  /** 对一条内容跑六项质量检查，输出 pass/warning/block */
  async check(input: ContentQualityInput): Promise<ContentQualityResult> {
    const checks: QualityCheckResult[] = [];

    checks.push(this.checkEvidence(input));
    checks.push(this.checkAbsoluteClaim(input));
    checks.push(await this.checkDuplicate(input));
    checks.push(this.checkPlatformFormat(input));
    checks.push(this.checkCta(input));
    checks.push(this.checkAssetCompleteness(input));

    const verdict = this.resolveVerdict(checks);
    const suggestions = checks.flatMap((c) => c.suggestions);

    return {
      verdict,
      checks,
      suggestions,
      checkedAt: new Date().toISOString(),
    };
  }

  /** 1. 事实是否有证据来源 */
  private checkEvidence(input: ContentQualityInput): QualityCheckResult {
    const text = `${input.title ?? ''}\n${input.content}`;
    const hasClaim = CLAIM_TERMS.some((t) => text.includes(t));
    const hasEvidence = (input.evidenceSources ?? []).length > 0;

    if (hasClaim && !hasEvidence) {
      return this.result(
        'evidence',
        'warning',
        '内容包含收益/功效类表述，但未提供事实证据来源',
        ['为效果类表述补充可核实的来源或数据', '或删除无法证明的效果承诺'],
      );
    }
    if (hasClaim && hasEvidence) {
      return this.result('evidence', 'pass', '已提供事实证据来源', []);
    }
    return this.result('evidence', 'pass', '未检测到需要证据支撑的表述', []);
  }

  /** 2. 是否有绝对化或无法证明的承诺 */
  private checkAbsoluteClaim(input: ContentQualityInput): QualityCheckResult {
    const text = `${input.title ?? ''}\n${input.content}`;
    const hits = ABSOLUTE_TERMS.filter((t) => text.includes(t));
    if (hits.length > 0) {
      return this.result(
        'absolute_claim',
        'block',
        '命中绝对化或无法证明的承诺表达',
        [
          '将绝对化表达改为可验证的范围或概率口径',
          '删除收益保证类承诺并补充风险提示',
        ],
        hits,
      );
    }
    return this.result('absolute_claim', 'pass', '未命中绝对化承诺表达', []);
  }

  /** 3. 是否与历史内容重复（按 contentHash 查已存版本） */
  private async checkDuplicate(
    input: ContentQualityInput,
  ): Promise<QualityCheckResult> {
    const content = (input.content ?? '').trim();
    if (!content) {
      return this.result('duplicate', 'pass', '无正文可查重', []);
    }
    try {
      const hash = createHash('sha256').update(content).digest('hex');
      const platform = this.normalizePlatform(input.platform);
      const existing = await this.prisma.contentVariant.findFirst({
        where:
          platform === 'all'
            ? { contentHash: hash }
            : { contentHash: hash, platform },
        select: { id: true },
      });
      if (existing) {
        return this.result(
          'duplicate',
          'warning',
          '正文与历史内容完全一致，可能是重复发布',
          [
            '确认是否为有意重复；否则改写或合并',
            '如需多平台分发，使用平台变体而非同文重复',
          ],
        );
      }
      return this.result('duplicate', 'pass', '未与历史内容重复', []);
    } catch {
      // 查重库不可用 → 不 fail-open，标记 unavailable（verdict 不计 block）
      return this.result(
        'duplicate',
        'unavailable',
        '历史内容查重服务暂不可用',
        ['稍后重试查重，或由负责人人工确认未重复'],
      );
    }
  }

  /** 4. 是否符合平台长度和格式 */
  private checkPlatformFormat(input: ContentQualityInput): QualityCheckResult {
    const platform = this.normalizePlatform(input.platform);
    const title = input.title ?? '';
    const content = input.content ?? '';
    const problems: string[] = [];
    const suggestions: string[] = [];

    if (!title.trim()) {
      problems.push('缺少标题');
      suggestions.push('补充标题');
    } else if (title.length > (TITLE_MAX[platform] ?? TITLE_MAX.default)) {
      problems.push(
        `标题 ${title.length} 字超过平台上限 ${TITLE_MAX[platform] ?? TITLE_MAX.default} 字`,
      );
      suggestions.push('精简标题至平台允许长度');
    }

    if (!content.trim()) {
      problems.push('缺少正文');
      suggestions.push('补充正文内容');
    } else if (
      content.length > (CONTENT_MAX[platform] ?? CONTENT_MAX.default)
    ) {
      problems.push(
        `正文 ${content.length} 字超过平台上限 ${CONTENT_MAX[platform] ?? CONTENT_MAX.default} 字`,
      );
      suggestions.push('精简正文或拆分为多篇');
    }

    if (problems.length > 0) {
      return this.result(
        'platform_format',
        'block',
        problems.join('；'),
        suggestions,
      );
    }
    return this.result('platform_format', 'pass', '符合平台长度和格式要求', []);
  }

  /** 5. CTA 是否明确且可追踪 */
  private checkCta(input: ContentQualityInput): QualityCheckResult {
    const hasCta = Boolean((input.cta ?? '').trim());
    const hasTracking = Boolean((input.trackingUrl ?? '').trim());

    if (hasCta && hasTracking) {
      return this.result('cta', 'pass', 'CTA 明确且含可追踪链接', []);
    }
    if (hasCta && !hasTracking) {
      return this.result(
        'cta',
        'warning',
        '有 CTA 但缺少可追踪链接，无法衡量转化',
        ['为 CTA 补充带追踪参数的链接或埋点'],
      );
    }
    return this.result('cta', 'warning', '未检测到明确的行动号召（CTA）', [
      '在结尾补充明确的下一步行动引导',
      '如为纯内容可不设 CTA，但建议至少给出互动引导',
    ]);
  }

  /** 6. 素材、链接、标签是否完整 */
  private checkAssetCompleteness(
    input: ContentQualityInput,
  ): QualityCheckResult {
    const platform = this.normalizePlatform(input.platform);
    const materialCount = input.materialCount ?? 0;
    const tags = (input.tags ?? []).filter((t) => t.trim());
    const links = (input.links ?? []).filter((l) => l.trim());
    const problems: string[] = [];
    const suggestions: string[] = [];

    // 小红书 / 视频脚本需要素材；纯文章可无图
    const needsMaterial = platform === 'xiaohongshu' || platform === 'douyin';
    if (needsMaterial && materialCount === 0) {
      problems.push(
        `${platform === 'xiaohongshu' ? '小红书' : '抖音'}内容建议至少 1 个素材`,
      );
      suggestions.push('补充图片或视频素材');
    }
    if (platform === 'xiaohongshu' && tags.length === 0) {
      problems.push('小红书内容建议带话题标签');
      suggestions.push('补充 3-5 个相关话题标签');
    }

    if (problems.length > 0) {
      return this.result(
        'asset_completeness',
        'warning',
        problems.join('；'),
        suggestions,
      );
    }
    return this.result(
      'asset_completeness',
      'pass',
      `素材 ${materialCount} 个 / 标签 ${tags.length} 个 / 链接 ${links.length} 个，完整性达标`,
      [],
    );
  }

  /** 任一 block → block；否则任一 warning → warning；否则 pass */
  private resolveVerdict(checks: QualityCheckResult[]): ContentQualityVerdict {
    if (checks.some((c) => c.status === 'block')) return 'block';
    if (checks.some((c) => c.status === 'warning')) return 'warning';
    return 'pass';
  }

  private normalizePlatform(platform?: string): string {
    const p = (platform ?? '').trim().toLowerCase();
    if (!p || p === 'all') return 'all';
    return p;
  }

  private result(
    key: QualityCheckKey,
    status: QualityCheckResult['status'],
    reason: string,
    suggestions: string[],
    matchedText?: string[],
  ): QualityCheckResult {
    return {
      key,
      label: CHECK_LABEL[key],
      status,
      reason,
      suggestions,
      matchedText,
    };
  }
}
