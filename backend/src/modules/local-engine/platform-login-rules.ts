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
 * 平台注册表（阶段 5 迁移：xiaohongshu → douyin → wechat-channel）。
 * allowDomains 收敛自 cdp-browser-profile.service 的 legacy 域映射
 * （platformType 1/2/3），登录/只读阶段逐平台启用。
 * - xiaohongshu：xhslink.com 是站内分享短链；fegine.com 是小红书静态资源域；
 * - douyin：iesdouyin.com 是分享短链域，bytedance.com 是静态资源域；
 * - wechat-channel：qq.com 域**宽**（微信系资源共享），只进导航白名单——
 *   登录态判定域单独收窄到 channels.weixin.qq.com（见 resolveWechatChannelLoginState）。
 */
export const PLATFORM_PROFILES: Record<string, PlatformProfile> = {
  xiaohongshu: {
    platform: 'xiaohongshu',
    displayName: '小红书',
    loginUrl: 'https://www.xiaohongshu.com',
    allowDomains: ['xiaohongshu.com', 'xhslink.com', 'fegine.com'],
  },
  douyin: {
    platform: 'douyin',
    displayName: '抖音',
    loginUrl: 'https://creator.douyin.com/',
    allowDomains: ['douyin.com', 'bytedance.com', 'iesdouyin.com'],
  },
  'wechat-channel': {
    platform: 'wechat-channel',
    displayName: '视频号',
    loginUrl: 'https://channels.weixin.qq.com/platform',
    allowDomains: ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'],
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
 * 平台登录态三态判定（分派式）：logged_in / login_prompt / unknown。
 * unknown = 当前不在该平台的**登录判定域**上（无法判定，不瞎猜）。
 * 判定是启发式（URL 形态 + 特征词），仅 UI 引导用；douyin/wechat-channel
 * 规则先按通用后台特征词落，真机登录后校准（交底）。
 */
export function resolvePlatformLoginState(
  platform: string,
  url: string,
  text: string,
): PlatformLoginState {
  if (platform === 'xiaohongshu') return resolveXiaohongshuLoginState(url, text);
  if (platform === 'douyin') return resolveDouyinLoginState(url, text);
  if (platform === 'wechat-channel') {
    return resolveWechatChannelLoginState(url, text);
  }
  return 'unknown';
}

/** 小红书：判定域=allowDomains 全集（www 网页版 + creator 后台 + 短链域） */
function resolveXiaohongshuLoginState(
  url: string,
  text: string,
): PlatformLoginState {
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

/** 抖音创作者后台已登录特征词（creator.douyin.com 工作台） */
const DOUYIN_BACKEND_KEYWORDS =
  /创作者中心|内容管理|发布视频|数据中心|互动管理|粉丝管理|作品管理/;

/**
 * 抖音登录态：判定域收窄 douyin.com（白名单里的 bytedance.com/iesdouyin.com
 * 是资源/短链域，页面本身不承载登录态 UI，判 unknown 防误报）。
 */
export function resolveDouyinLoginState(
  url: string,
  text: string,
): PlatformLoginState {
  const normalizedText = normalizePageText(text);
  if (!/douyin\.com/.test(url || '')) return 'unknown';
  if (isLoginLikeUrl(url)) return 'login_prompt';
  if (DOUYIN_BACKEND_KEYWORDS.test(normalizedText)) return 'logged_in';
  if (/扫码登录|验证码登录|二维码|请先登录|未登录/.test(normalizedText)) {
    return 'login_prompt';
  }
  // 在 douyin.com 上但无后台特征词（如 www.douyin.com 纯浏览）：
  // 以创作者后台特征词为准——没有视为未登录（login_prompt）。
  return 'login_prompt';
}

/** 视频号助手已登录特征词（channels.weixin.qq.com/platform 工作台） */
const WECHAT_CHANNEL_BACKEND_KEYWORDS =
  /发表视频|发布视频|数据中心|内容管理|互动中心|主页管理|商品橱窗/;

/**
 * 视频号登录态：判定域**精确**收窄 channels.weixin.qq.com——PROFILE 白名单
 * 里的 weixin.qq.com/qq.com 是微信系资源共享域（邮箱/文档/其他业务），
 * 进判定会把别的微信页面误判成视频号登录态。
 */
export function resolveWechatChannelLoginState(
  url: string,
  text: string,
): PlatformLoginState {
  const normalizedText = normalizePageText(text);
  if (!/channels\.weixin\.qq\.com/.test(url || '')) return 'unknown';
  if (isLoginLikeUrl(url)) return 'login_prompt';
  if (WECHAT_CHANNEL_BACKEND_KEYWORDS.test(normalizedText)) return 'logged_in';
  if (/扫码登录|二维码|微信扫码|请先登录|未登录/.test(normalizedText)) {
    return 'login_prompt';
  }
  // platform 工作台既无后台特征词也无登录提示（加载中/改版）：不瞎猜已登录
  return 'login_prompt';
}
