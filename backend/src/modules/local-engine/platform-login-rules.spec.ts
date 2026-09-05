import { describe, it, expect } from '@jest/globals';
import {
  PLATFORM_PROFILES,
  getPlatformProfile,
  isLoginLikeUrl,
  hasXiaohongshuLoginPrompt,
  isXiaohongshuBackendUrl,
  isXiaohongshuAuthenticatedPage,
  resolvePlatformLoginState,
} from './platform-login-rules';

/**
 * platform-login-rules.spec.ts — 阶段 5 第一站（2026-09-04）
 * 平台档案 + 登录态判定纯函数测试。
 *
 * 这些规则是引擎 page 版与面板桥版**共用**的唯一规格（防双端漂移），
 * 引擎侧行为由 local-browser-engine.service.spec 既有 xhs 用例锁定。
 */

describe('平台注册表 PLATFORM_PROFILES', () => {
  it('xiaohongshu 档案：登录起点 + 域名白名单（含短链/静态资源域）', () => {
    const profile = getPlatformProfile('xiaohongshu');
    expect(profile).not.toBeNull();
    expect(profile!.loginUrl).toBe('https://www.xiaohongshu.com');
    expect(profile!.allowDomains).toContain('xiaohongshu.com');
    expect(profile!.allowDomains).toContain('xhslink.com');
    expect(profile!.allowDomains).toContain('fegine.com');
  });

  it('douyin 档案：登录起点=创作者中心，域名收敛 legacy type3 映射', () => {
    const profile = getPlatformProfile('douyin');
    expect(profile).not.toBeNull();
    expect(profile!.loginUrl).toBe('https://creator.douyin.com/');
    expect(profile!.allowDomains).toEqual([
      'douyin.com',
      'bytedance.com',
      'iesdouyin.com',
    ]);
  });

  it('wechat-channel 档案：登录起点=视频号助手，域名收敛 legacy type2 映射', () => {
    const profile = getPlatformProfile('wechat-channel');
    expect(profile).not.toBeNull();
    expect(profile!.loginUrl).toBe('https://channels.weixin.qq.com/platform');
    expect(profile!.allowDomains).toEqual([
      'channels.weixin.qq.com',
      'weixin.qq.com',
      'qq.com',
    ]);
  });

  it('未注册平台 → null（general-web 不进注册表，行为不变）', () => {
    expect(getPlatformProfile('general-web')).toBeNull();
    expect(getPlatformProfile('kuaishou')).toBeNull();
  });

  it('PLATFORM_PROFILES 键与 profile.platform 一致（防注册表键名漂移）', () => {
    for (const [key, profile] of Object.entries(PLATFORM_PROFILES)) {
      expect(profile.platform).toBe(key);
    }
  });
});

describe('isLoginLikeUrl / hasXiaohongshuLoginPrompt', () => {
  it('login 形态 URL 识别', () => {
    expect(isLoginLikeUrl('https://www.xiaohongshu.com/login')).toBe(true);
    expect(isLoginLikeUrl('https://passport.example.com/sso?next=/')).toBe(true);
    expect(isLoginLikeUrl('https://www.xiaohongshu.com/explore')).toBe(false);
  });

  it('登录提示词（扫码/验证码/请先登录…）', () => {
    expect(hasXiaohongshuLoginPrompt('https://www.xiaohongshu.com/explore', '扫码登录后可查看')).toBe(true);
    expect(hasXiaohongshuLoginPrompt('https://www.xiaohongshu.com/explore', '登录/注册')).toBe(true);
    expect(hasXiaohongshuLoginPrompt('https://www.xiaohongshu.com/explore', '今天去哪玩 美食推荐')).toBe(false);
    // URL login 形态：文本再干净也算提示
    expect(hasXiaohongshuLoginPrompt('https://www.xiaohongshu.com/login', '')).toBe(true);
  });
});

describe('isXiaohongshuBackendUrl / isXiaohongshuAuthenticatedPage', () => {
  it('创作者后台 URL 精确匹配（/new 前缀，不吃别的路径）', () => {
    expect(isXiaohongshuBackendUrl('https://creator.xiaohongshu.com/new')).toBe(true);
    expect(isXiaohongshuBackendUrl('https://creator.xiaohongshu.com/new?from=home')).toBe(true);
    expect(isXiaohongshuBackendUrl('https://creator.xiaohongshu.com/newX')).toBe(false);
    expect(isXiaohongshuBackendUrl('https://www.xiaohongshu.com/new')).toBe(false);
  });

  it('网页版已登录：有账号工具栏 + 无登录提示', () => {
    expect(
      isXiaohongshuAuthenticatedPage(
        'https://www.xiaohongshu.com/explore',
        '发布 通知 消息 我 今天去哪玩',
      ),
    ).toBe(true);
  });

  it('网页版未登录：出现扫码/登录提示 → false', () => {
    expect(
      isXiaohongshuAuthenticatedPage(
        'https://www.xiaohongshu.com/explore',
        '扫码登录 验证码登录',
      ),
    ).toBe(false);
  });

  it('网页版登录入口文案（立即登录）→ false', () => {
    expect(
      isXiaohongshuAuthenticatedPage(
        'https://www.xiaohongshu.com/explore',
        '发布 通知 消息 我 立即登录',
      ),
    ).toBe(false);
  });

  it('创作者后台已登录：后台特征词 + 无提示', () => {
    expect(
      isXiaohongshuAuthenticatedPage(
        'https://creator.xiaohongshu.com/new',
        '小红书创作服务平台 笔记管理 数据中心',
      ),
    ).toBe(true);
  });

  it('创作者后台未登录：login URL / 提示词 → false', () => {
    expect(
      isXiaohongshuAuthenticatedPage(
        'https://creator.xiaohongshu.com/new/login',
        '登录后使用',
      ),
    ).toBe(false);
    expect(
      isXiaohongshuAuthenticatedPage(
        'https://creator.xiaohongshu.com/new',
        '二维码 请先登录',
      ),
    ).toBe(false);
  });

  it('非小红书域 → false', () => {
    expect(
      isXiaohongshuAuthenticatedPage('https://kaypal.cn/x', '发布 通知 消息 我'),
    ).toBe(false);
  });
});

describe('resolvePlatformLoginState 三态判定', () => {
  it('logged_in：网页版 + 账号工具栏', () => {
    expect(
      resolvePlatformLoginState(
        'xiaohongshu',
        'https://www.xiaohongshu.com/explore',
        '发布 通知 消息 我 美食推荐',
      ),
    ).toBe('logged_in');
  });

  it('logged_in：创作者后台 + 后台特征词', () => {
    expect(
      resolvePlatformLoginState(
        'xiaohongshu',
        'https://creator.xiaohongshu.com/new',
        '笔记管理 发布笔记',
      ),
    ).toBe('logged_in');
  });

  it('login_prompt：平台域上出现登录提示', () => {
    expect(
      resolvePlatformLoginState(
        'xiaohongshu',
        'https://www.xiaohongshu.com/login',
        '',
      ),
    ).toBe('login_prompt');
  });

  it('login_prompt：平台域上但既无工具栏也无提示（纯浏览未登录可见内容）', () => {
    expect(
      resolvePlatformLoginState(
        'xiaohongshu',
        'https://www.xiaohongshu.com/explore',
        '今天去哪玩 美食推荐',
      ),
    ).toBe('login_prompt');
  });

  it('unknown：不在平台域名上（不瞎猜）', () => {
    expect(
      resolvePlatformLoginState('xiaohongshu', 'https://kaypal.cn/x', '发布 通知'),
    ).toBe('unknown');
  });

  it('unknown：非注册平台（general-web 等）', () => {
    expect(
      resolvePlatformLoginState('general-web', 'https://www.xiaohongshu.com/explore', '发布 通知'),
    ).toBe('unknown');
  });
});

describe('resolvePlatformLoginState：douyin 三态', () => {
  it('logged_in：创作者中心 + 后台特征词', () => {
    expect(
      resolvePlatformLoginState(
        'douyin',
        'https://creator.douyin.com/',
        '创作者中心 内容管理 数据中心 粉丝管理',
      ),
    ).toBe('logged_in');
  });

  it('login_prompt：扫码登录提示', () => {
    expect(
      resolvePlatformLoginState(
        'douyin',
        'https://creator.douyin.com/',
        '扫码登录 验证码登录',
      ),
    ).toBe('login_prompt');
  });

  it('login_prompt：登录页营销文案命中特征词也必须是 login_prompt（2026-09-04 只读校准真机误报回归）', () => {
    // 真机取证：creator.douyin.com 登录页 innerText（节选）——
    // 「抖音创作者中心·创作者…一站式服务平台」命中「创作者中心」，
    // 同页含「扫码登录/验证码登录」→ 强登录页标志词优先，不得判 logged_in
    const loginPageInnerText =
      '网址 抖音 抖音创作者中心·创作者 抖音创作者中心是抖音创作者的一站式服务平台 · ' +
      '致力于助力创作者高效运营 我是创作者 我是MCN机构 扫码登录 如何扫码 ' +
      '打开「抖音APP」点击左上角 扫一扫 验证码登录 密码登录 获取验证码 登录 ' +
      '登录即代表同意用户协议和隐私政策 作品发布及管理 作品数据分析 商单任务变现';
    expect(
      resolvePlatformLoginState('douyin', 'https://creator.douyin.com/', loginPageInnerText),
    ).toBe('login_prompt');
  });

  it('logged_in：后台特征词命中且无强登录页标志词（含「二维码」弱词不否决）', () => {
    expect(
      resolvePlatformLoginState(
        'douyin',
        'https://creator.douyin.com/',
        '创作者中心 内容管理 数据中心 粉丝管理 直播二维码',
      ),
    ).toBe('logged_in');
  });

  it('login_prompt：login 形态 URL', () => {
    expect(
      resolvePlatformLoginState('douyin', 'https://creator.douyin.com/login', ''),
    ).toBe('login_prompt');
  });

  it('login_prompt：douyin.com 纯浏览无后台特征词（不瞎猜已登录）', () => {
    expect(
      resolvePlatformLoginState(
        'douyin',
        'https://www.douyin.com/discover',
        '推荐 热点 直播',
      ),
    ).toBe('login_prompt');
  });

  it('unknown：资源域 bytedance.com 不承载登录态 UI（判定域收窄）', () => {
    expect(
      resolvePlatformLoginState(
        'douyin',
        'https://sf3-dycdn-tos.pstatp.com/x',
        '创作者中心 数据中心',
      ),
    ).toBe('unknown');
  });

  it('unknown：非 douyin 域', () => {
    expect(
      resolvePlatformLoginState('douyin', 'https://kaypal.cn/x', '创作者中心'),
    ).toBe('unknown');
  });
});

describe('resolvePlatformLoginState：wechat-channel 三态', () => {
  it('logged_in：视频号助手后台特征词', () => {
    expect(
      resolvePlatformLoginState(
        'wechat-channel',
        'https://channels.weixin.qq.com/platform',
        '发表视频 数据中心 内容管理 互动中心',
      ),
    ).toBe('logged_in');
  });

  it('logged_in：工作台首页真实 innerText（2026-09-04 真机校准，菜单折叠场景）', () => {
    // 真机取证：首页 observe 前 2000 字符里没有「内容管理/数据中心」等
    // 折叠菜单词，只有顶栏+首页卡片特异词——修复前误判 login_prompt。
    const realHomeText =
      '视频号 · 助手 145 杨宏宇大神 申请认证 视频号ID: sphDFNT58iFTRqZ 视频137 关注者3956 ' +
      '作品优化建议 8月11日 昨日数据 净增关注 0 新增播放 6 新增评论 0';
    expect(
      resolvePlatformLoginState(
        'wechat-channel',
        'https://channels.weixin.qq.com/platform/',
        realHomeText,
      ),
    ).toBe('logged_in');
  });

  it('login_prompt：微信扫码提示', () => {
    expect(
      resolvePlatformLoginState(
        'wechat-channel',
        'https://channels.weixin.qq.com/platform',
        '微信扫码登录 二维码',
      ),
    ).toBe('login_prompt');
  });

  it('unknown：weixin.qq.com 其他业务页不进判定（防微信系域误报）', () => {
    expect(
      resolvePlatformLoginState(
        'wechat-channel',
        'https://mail.weixin.qq.com/',
        '发表视频 数据中心',
      ),
    ).toBe('unknown');
  });

  it('login_prompt：platform 页加载中无特征词（fail-closed 不判已登录）', () => {
    expect(
      resolvePlatformLoginState(
        'wechat-channel',
        'https://channels.weixin.qq.com/platform',
        '',
      ),
    ).toBe('login_prompt');
  });

  it('unknown：非 wechat 域', () => {
    expect(
      resolvePlatformLoginState(
        'wechat-channel',
        'https://kaypal.cn/x',
        '发表视频 数据中心',
      ),
    ).toBe('unknown');
  });
});
