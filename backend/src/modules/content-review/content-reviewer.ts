/**
 * ContentReviewer —— 图文内容质量审稿器（规则评分）
 *
 * 自研实现。方法论借鉴 ai-trend-publish「自动审稿 → 自动修复 → dry-run/发布」
 * 的编辑流水线理念（仅思路，不抄代码）。
 *
 * 五个维度评分（0-100）：
 * 1. 标题质量 —— 有具体信息、有吸引力、不过长
 * 2. 内容充实度 —— 总字数、每页字数分布
 * 3. 结构完整度 —— 封面/内容/总结齐全、页数达标
 * 4. AI 味残留 —— 复用 ai-flavor 检测结果（外部传入，避免重复计算）
 * 5. 配图齐整度 —— 生成图数量 vs 页数
 *
 * 输出：质量分 + 问题清单（每条带维度/严重度/建议），阈值 70 判 pass。
 */

export interface ReviewIssue {
  dimension: 'title' | 'content' | 'structure' | 'flavor' | 'image';
  severity: 'error' | 'warn';
  message: string;
  suggestion?: string;
}

export interface ContentReviewInput {
  titles: string[];
  /** 每页文案（content 字段） */
  pagesContent: string[];
  /** 每页类型（cover/content/summary） */
  pageTypes: string[];
  /** 已生成配图数量 */
  generatedImageCount: number;
  /** AI 味评分（复用 ai-flavor 检测结果，0-100，越高越 AI） */
  aiFlavorScore?: number;
}

export interface ContentReviewResult {
  score: number;
  pass: boolean;
  issues: ReviewIssue[];
  breakdown: {
    title: number;
    content: number;
    structure: number;
    flavor: number;
    image: number;
  };
}

export const CONTENT_REVIEW_PASS_THRESHOLD = 70;

export function reviewContent(input: ContentReviewInput): ContentReviewResult {
  const issues: ReviewIssue[] = [];
  const breakdown = {
    title: 0,
    content: 0,
    structure: 0,
    flavor: 0,
    image: 0,
  };

  // ---- 1. 标题质量（满分 20）----
  const primaryTitle = input.titles[0] || '';
  if (primaryTitle) {
    breakdown.title = 20;
    if (primaryTitle.length < 6) {
      breakdown.title = Math.max(0, breakdown.title - 12);
      issues.push({
        dimension: 'title',
        severity: 'error',
        message: '主标题过短（不足 6 字），缺乏信息量',
        suggestion: '补充具体信息，如数字、场景、结果',
      });
    } else if (primaryTitle.length > 35) {
      breakdown.title = Math.max(0, breakdown.title - 6);
      issues.push({
        dimension: 'title',
        severity: 'warn',
        message: '主标题过长（超过 35 字），可能被截断',
        suggestion: '压缩到 30 字以内',
      });
    }
    // 标题含通用词/无钩子
    const weakWords = ['介绍', '浅谈', '关于', '浅析', '简述', '之我见', '漫谈'];
    if (weakWords.some((w) => primaryTitle.includes(w))) {
      breakdown.title = Math.max(0, breakdown.title - 5);
      issues.push({
        dimension: 'title',
        severity: 'warn',
        message: '标题含「介绍/浅谈/关于」等弱词，缺乏吸引力',
        suggestion: '换成有数字、有冲突、有承诺的写法',
      });
    }
  } else {
    issues.push({
      dimension: 'title',
      severity: 'error',
      message: '缺少标题',
      suggestion: '为内容生成 3 个候选标题',
    });
  }

  // ---- 2. 内容充实度（满分 25）----
  const totalChars = input.pagesContent.reduce((a, c) => a + (c || '').length, 0);
  if (totalChars >= 500) {
    breakdown.content = 25;
  } else if (totalChars >= 250) {
    breakdown.content = 18;
    issues.push({
      dimension: 'content',
      severity: 'warn',
      message: `内容偏薄（全文约 ${totalChars} 字），建议充实到 500 字以上`,
      suggestion: '每个内容页补充具体细节、案例或数据',
    });
  } else if (totalChars > 0) {
    breakdown.content = 8;
    issues.push({
      dimension: 'content',
      severity: 'error',
      message: `内容过于单薄（仅约 ${totalChars} 字）`,
      suggestion: '大幅充实正文，或减少页数聚焦深度',
    });
  } else {
    issues.push({
      dimension: 'content',
      severity: 'error',
      message: '内容为空',
      suggestion: '重新生成文案',
    });
  }

  // 单页过短（内容页 < 50 字）
  const thinPages = input.pagesContent
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => input.pageTypes[i] === 'content' && c.length < 50);
  if (thinPages.length > 0) {
    breakdown.content = Math.max(0, breakdown.content - 5);
    issues.push({
      dimension: 'content',
      severity: 'warn',
      message: `${thinPages.length} 个内容页过短（< 50 字）`,
      suggestion: '扩充这些页的具体内容',
    });
  }

  // ---- 3. 结构完整度（满分 20）----
  const hasCover = input.pageTypes.includes('cover');
  const hasSummary = input.pageTypes.includes('summary');
  const contentCount = input.pageTypes.filter((t) => t === 'content').length;

  if (hasCover && hasSummary && contentCount >= 2) {
    breakdown.structure = 20;
  } else if (hasCover || hasSummary) {
    breakdown.structure = 12;
    issues.push({
      dimension: 'structure',
      severity: 'warn',
      message: hasCover && !hasSummary
        ? '缺少总结页'
        : !hasCover && hasSummary
          ? '缺少封面页'
          : '结构不完整',
      suggestion: '补充封面/总结页，形成完整图文结构',
    });
  } else {
    breakdown.structure = 5;
    issues.push({
      dimension: 'structure',
      severity: 'error',
      message: '缺少封面页和总结页',
      suggestion: '按 封面→内容→总结 结构重新生成',
    });
  }
  if (contentCount === 0) {
    breakdown.structure = 0;
    issues.push({
      dimension: 'structure',
      severity: 'error',
      message: '没有内容页',
    });
  }

  // ---- 4. AI 味残留（满分 15）----
  const flavor = input.aiFlavorScore ?? 0;
  if (flavor < 20) {
    breakdown.flavor = 15;
  } else if (flavor < 30) {
    breakdown.flavor = 10;
  } else if (flavor < 50) {
    breakdown.flavor = 5;
    issues.push({
      dimension: 'flavor',
      severity: 'warn',
      message: `AI 味明显（评分 ${flavor}），建议先去 AI 味再发布`,
      suggestion: '调用 de-flavor 改写',
    });
  } else {
    breakdown.flavor = 0;
    issues.push({
      dimension: 'flavor',
      severity: 'error',
      message: `AI 味严重（评分 ${flavor}），不建议直接发布`,
      suggestion: '必须先过 de-flavor 改写',
    });
  }

  // ---- 5. 配图齐整度（满分 20）----
  const totalPages = input.pagesContent.length;
  if (totalPages > 0) {
    const ratio = input.generatedImageCount / totalPages;
    if (ratio >= 0.9) {
      breakdown.image = 20;
    } else if (ratio >= 0.5) {
      breakdown.image = 12;
      issues.push({
        dimension: 'image',
        severity: 'warn',
        message: `配图不完整（${input.generatedImageCount}/${totalPages} 页有图）`,
        suggestion: '补全剩余页配图',
      });
    } else if (input.generatedImageCount > 0) {
      breakdown.image = 5;
      issues.push({
        dimension: 'image',
        severity: 'error',
        message: `配图严重缺失（仅 ${input.generatedImageCount}/${totalPages} 页有图）`,
        suggestion: '重新生成配图或手动补充',
      });
    } else {
      issues.push({
        dimension: 'image',
        severity: 'error',
        message: '没有生成任何配图',
        suggestion: '检查生图服务是否可用',
      });
    }
  } else {
    issues.push({
      dimension: 'structure',
      severity: 'error',
      message: '没有页面内容可审',
    });
  }

  const score = Math.round(
    breakdown.title + breakdown.content + breakdown.structure + breakdown.flavor + breakdown.image,
  );
  const hasError = issues.some((i) => i.severity === 'error');
  return {
    score,
    pass: !hasError && score >= CONTENT_REVIEW_PASS_THRESHOLD,
    issues,
    breakdown,
  };
}

/** 问题清单转提示文本（供 LLM 定向修订） */
export function issuesToPrompt(issues: ReviewIssue[]): string {
  return issues
    .map((i) => `- [${i.dimension}/${i.severity}] ${i.message}${i.suggestion ? `（建议：${i.suggestion}）` : ''}`)
    .join('\n');
}
