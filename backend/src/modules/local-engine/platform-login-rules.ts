/**
 * 2026-09-04（阶段 5 第一站：小红书登录/只读）：平台档案 + 登录态判定纯函数。
 *
 * 为什么独立成模块：登录态判定规则此前只存在于 LocalBrowserEngine 私有方法
 * （page 版），面板模式（无 page，走桥 CDP）无法复用——复制一份就会重蹈
 * probe/extract「双端两份规格漂移」的覆辙。引擎与面板模式都必须引用本模块。
 *
 * 判定是**启发式**（URL 形态 + 页面文本关键词），不是鉴权级校验：只用于
 * 「登录/只读」阶段的 UI 引导（提示用户扫码接管），不作为任何写动作的放行
 * 依据（写动作仍走确认单审批链）。
 */

export type PlatformLoginState = 'logged_in' | 'login_prompt' | 'unknown';

export interface PlatformProfile {
  platform: string;
  displayName: string;
  /** 登录起点（面板打开的第一个页面；扫码由用户人工接管） */
  loginUrl: string;
  /** 会话域名白名单推导（裸域，会话创建时并入 allowDomains） */
  allowDomains: string[];
}

/**
 * 平台注册表（阶段 5 迁移顺序逐个补充：general-web → xiaohongshu → douyin → wechat-channel）。
 * xiaohongshu 域名取自 cdp-browser-profile.service 既有映射（platformType=1 → xiaohongshu.com），
 * xhslink.com 是站内分享短链；fegine.com 是小红书静态资源域。
 */
export const PLATFORM_PROFILES: Record<string, PlatformProfile> = {
  xiaohongshu: {
    platform: 'xiaohongshu',
    displayName: '小红书',
    loginUrl: 'https://www.xiaohongshu.com',
    allowDomains: ['xiaohongshu.com', 'xhslink.com', 'fegine.com'],
  },
};

export function getPlatformProfile(platform: string): PlatformProfile | null {
  return PLATFORM_PROFILES[platform] ?? null;
}

export function isLoginLikeUrl(url: string): boolean {
  return /login|signin|passport|sso/i.test(url || '');
}

export function normalizePageText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** 引擎 hasLoginPrompt 的同款规则（xhs 场景）：URL 形态 + 通用登录提示词 */
export function hasXiaohongshuLoginPrompt(url: string, text: string): boolean {
  if (isLoginLikeUrl(url)) return true;
  const normalizedText = normalizePageText(text);
  return true === /扫码登录|验证码登录|密码登录|账号登录|登录\/注册|登录或注册|登录后|请先登录|未登录|二维码/.test(
    normalizedText,
  );
}

/** 创作者后台 URL（creator.xiaohongshu.com/new） */
export function isXiaohongshuBackendUrl(url: string): boolean {
  return /creator\.xiaohongshu\.com\/new(?:[/?#]|$)/.test(url || '');
}

/**
 * 小红书已登录页判定（规则同步自 LocalBrowserEngine.isXiaohongshuAuthenticatedPage，
 * 该私有方法已改为转发本函数——引擎行为由既有 spec 锁定）。
 * 网页版（www.xiaohongshu.com）：登录用户有 发布/通知/消息/我 工具栏；
 * 未登录出现 登录/注册/扫码。创作者后台独立判定。
 */
export function isXiaohongshuAuthenticatedPage(url: string, text: string): boolean {
  const normalizedText = normalizePageText(text);
  if (/www\.xiaohongshu\.com/.test(url || '')) {
    return (
      !hasXiaohongshuLoginPrompt(url, normalizedText) &&
      /发布|通知|消息|我/.test(normalizedText) &&
      !/登录后使用|立即登录/.test(normalizedText)
    );
  }
  if (!isXiaohongshuBackendUrl(url)) return false;
  if (isLoginLikeUrl(url)) return false;
  if (hasXiaohongshuLoginPrompt(url, normalizedText)) return false;
  return /小红书创作服务平台|创作服务平台|笔记管理|发布笔记|数据中心|账号设置|服务市场|技能中心|蒲公英|素材中心/.test(
    normalizedText,
  );
}

/**
 * 平台登录态三态判定：logged_in / login_prompt / unknown。
 * unknown = 当前不在该平台域名上（无法判定，不瞎猜）。
 */
export function resolvePlatformLoginState(
  platform: string,
  url: string,
  text: string,
): PlatformLoginState {
  if (platform !== 'xiaohongshu') return 'unknown';
  const profile = PLATFORM_PROFILES.xiaohongshu;
  const onPlatform = (profile.allowDomains ?? []).some((domain) =>
    String(url || '').includes(domain),
  );
  if (!onPlatform) return 'unknown';
  if (isXiaohongshuAuthenticatedPage(url, text)) return 'logged_in';
  if (hasXiaohongshuLoginPrompt(url, text)) return 'login_prompt';
  // 在平台域上但既无登录提示也无账号工具栏（如纯浏览未登录可见内容）：
  // 以网页版首页是否出现账号工具栏为准——没有工具栏视为未登录（login_prompt）。
  return 'login_prompt';
}
