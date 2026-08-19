/**
 * 内容质量门（方案 5.3）。
 *
 * 对一条待发布内容跑 6 项确定性检查，输出 pass / warning / block 与修复建议。
 * 合规/质量检查不可用时必须显示「检查不可用」，禁止 fail-open 显示「通过」。
 */

/** 质量门判定 */
export type ContentQualityVerdict = 'pass' | 'warning' | 'block';

/** 单项检查的状态 */
export type QualityCheckStatus = 'pass' | 'warning' | 'block' | 'unavailable';

/** 六项检查的键 */
export type QualityCheckKey =
  | 'evidence' // 1. 事实是否有证据来源
  | 'absolute_claim' // 2. 是否有绝对化或无法证明的承诺
  | 'duplicate' // 3. 是否与历史内容重复
  | 'platform_format' // 4. 是否符合平台长度和格式
  | 'cta' // 5. CTA 是否明确且可追踪
  | 'asset_completeness'; // 6. 素材、链接、标签是否完整

/** 单项检查结果 */
export interface QualityCheckResult {
  key: QualityCheckKey;
  label: string;
  status: QualityCheckStatus;
  /** 命中说明 / 原因 */
  reason?: string;
  /** 修复建议 */
  suggestions: string[];
  /** 命中的具体文本（如有） */
  matchedText?: string[];
}

/** 质量门检查入参 */
export interface ContentQualityInput {
  /** 正文 */
  content: string;
  /** 标题 */
  title?: string;
  /** 目标平台（影响长度/格式/素材要求） */
  platform?: string;
  /** 内容类型：article / xiaohongshu / video_script / comment_reply */
  contentType?: string;
  /** 是否声明了事实证据来源（第 1 项） */
  evidenceSources?: string[];
  /** CTA 文案 / 行动号召（第 5 项） */
  cta?: string;
  /** 是否含可追踪链接（第 5 项） */
  trackingUrl?: string;
  /** 素材（图片/视频）数量（第 6 项） */
  materialCount?: number;
  /** 标签（第 6 项） */
  tags?: string[];
  /** 链接（第 6 项） */
  links?: string[];
}

/** 质量门检查结果 */
export interface ContentQualityResult {
  verdict: ContentQualityVerdict;
  checks: QualityCheckResult[];
  /** 汇总修复建议 */
  suggestions: string[];
  /** 检查时间 */
  checkedAt: string;
  /** 检查不可用时的说明（fail-closed） */
  unavailable?: string;
}
