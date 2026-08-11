// 发布前体检（platform preflight）：按平台规则检查标题/正文/话题/封面，纯规则零外部依赖。
// 思路借鉴 ss-media-tools 的"平台适配检查"（该仓库无许可证，此实现为完全自研，规则值按本项目现状定义）。
import { Injectable } from '@nestjs/common';

export interface PlatformPreflightInput {
  platform: string;
  title: string;
  content: string;
  tags?: string[];
  coverUrl?: string | null;
}

export interface PlatformPreflightResult {
  platform: string;
  platformName: string;
  valid: boolean;
  errors: string[];
  suggestions: string[];
}

interface PlatformRule {
  platformName: string;
  titleMax: number;
  contentMin: number;
  tagMax: number; // 0 = 不支持话题
  forbiddenWords: string[];
}

const PLATFORM_RULES: Record<string, PlatformRule> = {
  douyin: {
    platformName: '抖音',
    titleMax: 55,
    contentMin: 1,
    tagMax: 5,
    forbiddenWords: ['微信', 'vx', '加我', '私聊我'],
  },
  'wechat-channel': {
    platformName: '视频号',
    titleMax: 50,
    contentMin: 100,
    tagMax: 0,
    forbiddenWords: ['加微信', '微信号'],
  },
  xiaohongshu: {
    platformName: '小红书',
    titleMax: 20,
    contentMin: 1,
    tagMax: 5,
    forbiddenWords: ['加我微信', '私信我'],
  },
  kuaishou: {
    platformName: '快手',
    titleMax: 30,
    contentMin: 1,
    tagMax: 4,
    forbiddenWords: ['加微信', 'vx'],
  },
  bilibili: {
    platformName: 'B站',
    titleMax: 80,
    contentMin: 1,
    tagMax: 3,
    forbiddenWords: [],
  },
};

/** 清理话题：去 # 号、去重、截断到平台上限 */
export function normalizePublishTags(
  tags: string[] | undefined,
  tagMax: number,
): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    if (result.length >= tagMax) break;
    const tag = String(raw ?? '')
      .replace(/^#+/, '')
      .trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function checkPlatformPreflight(
  input: PlatformPreflightInput,
): PlatformPreflightResult {
  const rule = PLATFORM_RULES[input.platform];
  if (!rule) {
    return {
      platform: input.platform,
      platformName: input.platform,
      valid: true,
      errors: [],
      suggestions: [],
    };
  }
  const errors: string[] = [];
  const suggestions: string[] = [];
  const title = String(input.title ?? '').trim();
  const content = String(input.content ?? '').trim();
  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  const normalizedTags = normalizePublishTags(rawTags, rule.tagMax);

  if (!title) {
    errors.push('标题不能为空');
  } else if (title.length > rule.titleMax) {
    errors.push(`标题 ${title.length} 字，超过 ${rule.platformName} 上限 ${rule.titleMax} 字`);
    suggestions.push(`精简标题到 ${rule.titleMax} 字以内（当前 ${title.length} 字）`);
  }
  if (content.length < rule.contentMin) {
    errors.push(
      rule.contentMin > 1
        ? `正文 ${content.length} 字，${rule.platformName} 要求至少 ${rule.contentMin} 字`
        : '正文不能为空',
    );
    if (rule.contentMin > 1) {
      suggestions.push(`补充正文到 ${rule.contentMin} 字以上（当前 ${content.length} 字）`);
    }
  }
  if (rule.tagMax > 0) {
    if (rawTags.length > rule.tagMax) {
      errors.push(`话题 ${rawTags.length} 个，超过 ${rule.platformName} 上限 ${rule.tagMax} 个`);
      suggestions.push(`话题最多保留 ${rule.tagMax} 个`);
    }
    const duplicated = rawTags.length - normalizedTags.length;
    if (duplicated > 0) {
      suggestions.push(`已去重/清理 ${duplicated} 个话题`);
    }
  }
  for (const word of rule.forbiddenWords) {
    if (title.includes(word) || content.includes(word)) {
      errors.push(`内容包含平台敏感词「${word}」`);
      suggestions.push(`删除「${word}」相关内容，避免平台限流`);
    }
  }
  if (rule.tagMax === 0 && rawTags.length > 0) {
    suggestions.push(`${rule.platformName} 不支持话题，已忽略 ${rawTags.length} 个话题`);
  }

  return {
    platform: input.platform,
    platformName: rule.platformName,
    valid: errors.length === 0,
    errors,
    suggestions,
  };
}

@Injectable()
export class PlatformPreflightService {
  check(input: PlatformPreflightInput): PlatformPreflightResult {
    return checkPlatformPreflight(input);
  }
}
