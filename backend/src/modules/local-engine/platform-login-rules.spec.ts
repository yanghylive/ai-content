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

  it('未注册平台 → null（general-web 不进注册表，行为不变）', () => {
    expect(getPlatformProfile('general-web')).toBeNull();
    expect(getPlatformProfile('douyin')).toBeNull();
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
