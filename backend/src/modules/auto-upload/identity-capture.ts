// 移植自 s840207702/auto-upload myUtils/avatar.py (Apache-2.0)：
// 头像/昵称三层抓取（平台 API 直取 → 平台选择器 → 全 DOM 评分兜底），已按本仓库风格重写为 TS。
// 本文件为纯函数，不依赖 Nest 注入，便于单测与替换。
import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeText } from '../../common/text.utils';

export interface CapturedIdentity {
  /** 头像元素截图文件名（存于 avatarDir 下），未抓到为 null */
  avatarPath?: string | null;
  /** 真实昵称（API/选择器/评分三层），未识别到为 null */
  userName?: string | null;
}

/** 平台类型：1=小红书 2=视频号 3=抖音 4=快手 5=B站（与 auto-upload 常量一致） */
const PLATFORM_IDENTITY_SELECTORS: Record<
  number,
  { avatar: string[]; name: string[] }
> = {
  1: {
    avatar: ['.user_avatar', '.user-info img'],
    name: ['.user-info .name-box', '.user-info .name'],
  },
  2: {
    avatar: [
      '.finder-info img.avatar',
      '.account-info img.avatar',
      "img[alt*='视频号头像']",
    ],
    name: ['.finder-nickname', '.account-info .name'],
  },
  3: {
    avatar: [
      "#header-avatar [class*='avatar']",
      '#header-avatar',
      "[class*='header-avatar'] img",
      "[class*='avatar'] img[class*='avatar']",
    ],
    name: ['#header-avatar', "[class*='header'] [class*='avatar']"],
  },
  4: {
    avatar: ['.user-info-dpd img', '.user-info img'],
    name: ['.user-info-name', '.user-info-dpd .user-info-name'],
  },
  5: {
    avatar: ['.cc-header .custom-lazy-img', '.header .custom-lazy-img'],
    name: ['.cc-header .user-name', ".cc-header [class*='name']"],
  },
};

const NAME_BLACKLIST = [
  '首页',
  '发布',
  '发布视频',
  '内容管理',
  '数据中心',
  '账号管理',
  '素材管理',
  '创作中心',
  '创作者中心',
  '创作服务平台',
  '消息',
  '通知',
  '设置',
  '退出',
  '退出登录',
  '登录',
  '立即登录',
  '上传',
  '管理',
  '平台',
  '服务平台',
  '个人中心',
  '粉丝管理',
  '稿件管理',
  '身份认证',
  '账号正常',
  '遇到问题',
  '主站',
  '网址',
  '帮助',
];

/** 昵称合法性：长度 2-32、非导航词、非文件后缀 */
export function looksLikeDisplayName(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 32) return false;
  if (NAME_BLACKLIST.some((word) => text.includes(word))) return false;
  return !/\.(json|png|jpg|jpeg|webp)$/i.test(text);
}

async function firstVisibleLocator(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (
        (await locator.count()) > 0 &&
        (await locator.isVisible({ timeout: 1200 }))
      ) {
        return locator;
      }
    } catch {
      // 候选无效，继续下一个
    }
  }
  return null;
}

/** L1：页面内 fetch 平台自身 API 取真实昵称（绕开 DOM 改版，最高优先） */
export async function fetchDisplayNameFromPlatformApi(
  page: Page,
  platformType?: number,
): Promise<string | null> {
  if (platformType === 3) {
    const endpoints = [
      'https://creator.douyin.com/aweme/v1/creator/user/info/',
      'https://creator.douyin.com/web/api/media/user/info/',
    ];
    for (const endpoint of endpoints) {
      try {
        const data = await page.evaluate<
          Record<string, unknown> | null,
          string
        >(async (url) => {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) return null;
          return (await res.json()) as Record<string, unknown>;
        }, endpoint);
        if (!data || typeof data !== 'object') continue;
        const userProfile = data.user_profile as
          Record<string, unknown> | undefined;
        const verifyInfo = data.douyin_user_verify_info as
          Record<string, unknown> | undefined;
        const user = data.user as Record<string, unknown> | undefined;
        const candidates = [
          userProfile?.nick_name,
          verifyInfo?.nick_name,
          user?.nickname,
        ];
        for (const candidate of candidates) {
          if (looksLikeDisplayName(safeText(candidate))) {
            return safeText(candidate).replace(/\s+/g, ' ').trim();
          }
        }
      } catch {
        // 端点失败，试下一个
      }
    }
  }
  if (platformType === 5) {
    try {
      const data = await page.evaluate<{ data?: { uname?: unknown } } | null>(
        async () => {
          const res = await fetch(
            'https://api.bilibili.com/x/web-interface/nav',
            {
              credentials: 'include',
            },
          );
          if (!res.ok) return null;
          return (await res.json()) as { data?: { uname?: unknown } };
        },
      );
      const candidate = data?.data?.uname;
      if (looksLikeDisplayName(safeText(candidate))) {
        return safeText(candidate).replace(/\s+/g, ' ').trim();
      }
    } catch {
      // 忽略，落到选择器层
    }
  }
  return null;
}

/** L3 头像 DOM 评分：可见 img/背景图 + 关键词打分，返回是否命中并标记候选元素 */
const AVATAR_SCORING_SCRIPT = `
() => {
  const nodes = Array.from(document.querySelectorAll('img, [style*="background-image"]'));
  const scored = nodes.map((node, index) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const background = style.backgroundImage || '';
    const text = [
      node.alt || '', node.className || '', node.id || '', node.src || '',
      background, node.parentElement ? node.parentElement.className || '' : ''
    ].join(' ').toLowerCase();
    const visible = rect.width >= 24 && rect.height >= 24 &&
      rect.width <= 180 && rect.height <= 180 &&
      style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.bottom > 0 && rect.right > 0;
    if (!visible) return null;
    let score = 0;
    if (/avatar|head|user|profile|face|account|portrait|uhead|qlogo|bfs\\/face|aweme-avatar/.test(text)) score += 90;
    if (Math.abs(rect.width - rect.height) <= 12) score += 30;
    if (rect.top < 170 || rect.left > window.innerWidth * 0.55) score += 22;
    if (/qrcode|qr|logo|icon|banner|cover|video-card/.test(text)) score -= 80;
    return { index, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < 35) return false;
  nodes.forEach(node => node.removeAttribute('data-sau-avatar-candidate'));
  nodes[scored[0].index].setAttribute('data-sau-avatar-candidate', '1');
  return true;
}
`;

/** L2+L3 头像抓取：选择器元素截图 → DOM 评分兜底 */
export async function captureAvatarFromPage(
  page: Page,
  avatarName: string,
  avatarDir: string,
  platformType?: number,
): Promise<string | null> {
  mkdirSync(avatarDir, { recursive: true });
  const safeName = avatarName.endsWith('.png')
    ? avatarName
    : `${avatarName.replace(/\.[^.]+$/, '') || 'account'}.png`;
  const avatarFile = join(avatarDir, safeName);
  try {
    await page.waitForTimeout(1800).catch(() => undefined);
    const selectors =
      PLATFORM_IDENTITY_SELECTORS[platformType ?? 0]?.avatar ?? [];
    const locator = await firstVisibleLocator(page, selectors);
    if (locator) {
      try {
        await locator
          .scrollIntoViewIfNeeded({ timeout: 1500 })
          .catch(() => undefined);
        await locator.screenshot({ path: avatarFile });
        return safeName;
      } catch {
        // 元素截图失败，落到评分兜底
      }
    }
    const found = await page.evaluate<boolean>(AVATAR_SCORING_SCRIPT);
    if (!found) return null;
    const target = page.locator('[data-sau-avatar-candidate="1"]').first();
    await target
      .scrollIntoViewIfNeeded({ timeout: 1500 })
      .catch(() => undefined);
    await target.screenshot({ path: avatarFile });
    return safeName;
  } catch {
    return null;
  }
}

/** 抖音右上角浮层昵称扫描（hover #header-avatar 后取最右文本） */
const DOUYIN_HOVER_NAME_SCRIPT = `
() => {
  const blocked = ['通知', '网址', '身份认证', '退出账号'];
  const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
  const nodes = Array.from(document.querySelectorAll('span, div, a'));
  const candidates = nodes.map(node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const text = normalize(node.innerText || node.textContent);
    const visible = rect.width > 4 && rect.height > 4 &&
      style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.top >= 0 && rect.top < 64 && rect.left > window.innerWidth - 180;
    return { text, left: rect.left, visible };
  }).filter(item => item.visible && item.text && !blocked.some(word => item.text.includes(word)));
  candidates.sort((a, b) => b.left - a.left);
  return candidates.length ? candidates[0].text : null;
}
`;

/** B站头部昵称扫描（cc-header 内首个候选） */
const BILIBILI_HEADER_NAME_SCRIPT = `
() => {
  const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
  const header = document.querySelector('.cc-header, .header');
  if (!header) return null;
  const nodes = Array.from(header.querySelectorAll('span, div, a'));
  const blocked = ['主站', '直播姬', '必剪', 'bilibili开课', '在bilibili星球', '投稿', '退出登录', '个人中心'];
  const candidates = nodes.map(node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const text = normalize(node.innerText || node.textContent);
    const visible = rect.width > 8 && rect.height > 8 &&
      style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.top >= 0 && rect.top < 64;
    return { text, left: rect.left, visible };
  }).filter(item => item.visible && item.text && !blocked.some(word => item.text.includes(word)));
  candidates.sort((a, b) => a.left - b.left);
  return candidates.length ? candidates[0].text : null;
}
`;

/** L3 昵称全 DOM 评分：黑名单过滤 + meta 关键词打分 */
const NAME_SCORING_SCRIPT = `
() => {
  const blacklist = [
    '首页', '发布', '发布视频', '内容管理', '数据中心', '账号管理', '素材管理',
    '创作中心', '创作者中心', '消息', '设置', '登录', '退出登录', '立即登录',
    '上传', '管理', '平台', '服务平台', '个人中心', '创作服务平台'
  ];
  const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
  const isBadText = (text) => {
    if (!text || text.length < 2 || text.length > 32) return true;
    if (/^[\\d\\W_]+$/.test(text)) return true;
    if (/\\.json|http|https|cookie|登录态|二维码|扫码/i.test(text)) return true;
    return blacklist.some(word => text === word || text.includes(word));
  };
  const nodes = Array.from(document.querySelectorAll('span, div, p, a, strong, b'));
  const candidates = [];
  nodes.forEach((node) => {
    const text = normalize(node.innerText || node.textContent);
    if (isBadText(text)) return;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    if (
      rect.width < 8 || rect.height < 8 || rect.width > 420 || rect.height > 82 ||
      rect.bottom <= 0 || rect.right <= 0 ||
      style.display === 'none' || style.visibility === 'hidden'
    ) return;
    const meta = [
      node.className || '', node.id || '',
      node.getAttribute('aria-label') || '', node.getAttribute('title') || '',
      node.parentElement ? node.parentElement.className || '' : ''
    ].join(' ').toLowerCase();
    let score = 0;
    if (/nick|nickname|user-name|username|display-name|account-name|profile-name/.test(meta)) score += 90;
    if (/user|account|profile|author|creator|avatar|name/.test(meta)) score += 42;
    if (rect.top < 220) score += 24;
    if (rect.left > window.innerWidth * 0.45) score += 16;
    if (/^[\\u4e00-\\u9fa5A-Za-z0-9_\\-.·]{2,20}$/.test(text)) score += 16;
    if (node.children.length > 2) score -= 24;
    candidates.push({ text, score, top: rect.top, left: rect.left });
  });
  candidates.sort((a, b) => b.score - a.score || a.top - b.top || b.left - a.left);
  return candidates.length && candidates[0].score >= 54 ? candidates[0].text : null;
}
`;

/** L1+L2+L3 昵称检测：API → 选择器（含抖音浮层/B站头部）→ 全 DOM 评分 */
export async function detectDisplayNameFromPage(
  page: Page,
  platformType?: number,
): Promise<string | null> {
  try {
    await page.waitForTimeout(800).catch(() => undefined);
    const apiName = await fetchDisplayNameFromPlatformApi(page, platformType);
    if (apiName) return apiName;

    if (platformType === 3) {
      try {
        await page.locator('#header-avatar').hover({ timeout: 1800 });
        await page.waitForTimeout(500).catch(() => undefined);
      } catch {
        // hover 失败不影响后续
      }
    }

    const selectors =
      PLATFORM_IDENTITY_SELECTORS[platformType ?? 0]?.name ?? [];
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (
          (await locator.count()) === 0 ||
          !(await locator.isVisible({ timeout: 1000 }))
        ) {
          continue;
        }
        let name: string;
        if (platformType === 3 && selector === '#header-avatar') {
          name =
            (await page.evaluate<string | null>(DOUYIN_HOVER_NAME_SCRIPT)) ??
            '';
        } else {
          name = await locator.innerText({ timeout: 1000 });
        }
        name = name.replace(/\s+/g, ' ').trim();
        if (looksLikeDisplayName(name)) return name;
      } catch {
        // 候选失败，继续
      }
    }

    if (platformType === 5) {
      const name =
        (await page.evaluate<string | null>(BILIBILI_HEADER_NAME_SCRIPT)) ?? '';
      const normalized = name.replace(/\s+/g, ' ').trim();
      if (looksLikeDisplayName(normalized)) return normalized;
    }

    const scored = await page.evaluate<string | null>(NAME_SCORING_SCRIPT);
    if (scored && looksLikeDisplayName(scored)) {
      return scored.replace(/\s+/g, ' ').trim();
    }
    return null;
  } catch {
    return null;
  }
}

/** 组合入口：登录成功后抓头像元素图 + 真实昵称 */
export async function captureAccountIdentity(
  page: Page,
  platformType: number,
  engineAccountId: number | string,
  avatarDir: string,
): Promise<CapturedIdentity> {
  const avatarPath = await captureAvatarFromPage(
    page,
    `account_${engineAccountId}.png`,
    avatarDir,
    platformType,
  );
  const userName = await detectDisplayNameFromPage(page, platformType);
  return { avatarPath, userName };
}
