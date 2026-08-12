/**
 * LocalBrowserEngine · 3010 主系统的 in-process 浏览器自动化引擎
 *
 * 替代原 5409 auto-upload 的 CDP 引擎：把 5409 的 7334 行 main.py + 653 行 cdp_runtime.py
 * 核心能力搬进 3010 backend，Playwright (microsoft/playwright) 控制 Chrome 走 CDP。
 *
 * 设计目标：
 * 1. 拥有 Chrome 实例（启动 / 停止 / 复用）
 * 2. 维护账号 profile（cookies / localStorage / Chrome user data dir）
 * 3. 提供 platform 中立的页面控制（navigate / click / type / wait / screenshot）
 * 4. 暴露 open / click / type / fill / screenshot 五个原子操作
 * 5. 不引用 5409 HTTP 端点，零外部依赖
 *
 * 启动策略：懒启动（首次 platform 任务时启动 Chrome），常驻后台，重用 profile。
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { basename, join } from 'path';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs';
import {
  chromium,
  type BrowserContext,
  type Cookie,
  type Page,
} from 'playwright';
import { CdpBrowserProfileService } from './cdp-browser-profile.service';
import {
  PlaywrightBrowserRuntimeService,
  type PlaywrightBrowserRuntimeInfo,
} from './playwright-browser-runtime.service';
import { safeText } from '../../common/text.utils';
import {
  resolveProjectDataPath,
  resolveProjectLogPath,
} from '../../common/project-paths';

export type LocalBrowserPlatform =
  | 'douyin'
  | 'wechat-channel'
  | 'wechat-official'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'bilibili'
  | 'weibo'
  | 'zhihu'
  | 'toutiao'
  | 'general-web'; // AI 网页代操作通用会话（不碰社媒登录态）

export type EngineStatus = {
  online: boolean;
  chromePath: string;
  version: string;
  startedAt: string;
  activeSessions: number;
  visibleWindow: boolean;
  isolated: boolean;
  message: string;
};

const RECOVER_COOLDOWN_MS = 120_000;

export type EngineSession = {
  key: string;
  accountId: string;
  sourceAccountId?: string;
  platform: string;
  profileDir: string;
  context: BrowserContext;
  page: Page;
  debuggingPort?: number;
  browser?: string;
  browserProcess?: ChildProcess;
  browserReused?: boolean;
  visibleWindow: boolean;
  startedAt: string;
  lastActivityAt: string;
  /** 最近一次从 .login-cookies.json 恢复登录态的时间（用于冷却，防 cookie 失效时反复 recover + bringToFront 弹窗） */
  recoveredAt?: string;
};

export type EngineSessionSummary = {
  key: string;
  accountId: string;
  sourceAccountId?: string;
  platform: string;
  profileDir: string;
  status: 'ready' | 'blocked';
  visibleWindow: boolean;
  currentUrl?: string;
  browser?: string;
  debuggingPort?: number;
  browserReused?: boolean;
  startedAt: string;
  lastActivityAt: string;
  runtimeMode: 'persistent-cdp-browser';
};

@Injectable()
export class LocalBrowserEngine implements OnModuleDestroy {
  private readonly logger = new Logger(LocalBrowserEngine.name);
  private readonly sessions = new Map<string, EngineSession>();
  private readonly sessionLaunches = new Map<string, Promise<EngineSession>>();
  private startedAt: string | null = null;
  private readonly browserRuntime: PlaywrightBrowserRuntimeInfo;
  private readonly chromePath: string;
  private readonly profileRoot: string;
  private readonly evidenceRoot: string;
  private readonly visibleWindow: boolean;
  private readonly isolated: boolean;
  /** ③ 弹窗打扰预算：最近一次 bringToFront 时间（防止高频调度/轮询反复弹窗） */
  private lastBringToFrontAt = 0;
  /** 弹窗冷却（毫秒）：60 秒内非用户主动操作只弹一次 */
  private readonly BRING_TO_FRONT_COOLDOWN_MS = 60_000;

  constructor(
    private readonly config: ConfigService,
    private readonly profiles: CdpBrowserProfileService,
    private readonly browsers: PlaywrightBrowserRuntimeService,
  ) {
    this.browserRuntime = this.browsers.resolve();
    this.chromePath = this.browserRuntime.executablePath;
    this.profileRoot =
      this.config.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
      resolveProjectDataPath('browser-profiles');
    this.evidenceRoot =
      this.config.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
      resolveProjectLogPath('browser-evidence');
    this.visibleWindow =
      this.config.get<string>('LOCAL_BROWSER_HEADLESS') !== 'true';
    this.isolated =
      this.config.get<string>('LOCAL_BROWSER_ISOLATED') === 'true';
    mkdirSync(this.profileRoot, { recursive: true });
    mkdirSync(this.evidenceRoot, { recursive: true });
  }

  /**
   * 引擎健康检查（替代 5409 /health）。
   * 启动 Chrome（懒启动）；失败时返 ok=false，但永不抛异常。
   */
  getStatus(): EngineStatus {
    const chromeExists = existsSync(this.chromePath);
    let version = 'unknown';
    for (const session of this.sessions.values()) {
      try {
        version = session.context.browser()?.version() || version;
        if (version !== 'unknown') break;
      } catch {
        // 忽略，保留默认值
      }
    }
    return {
      online: chromeExists,
      chromePath: this.chromePath,
      version,
      startedAt: this.startedAt ?? new Date().toISOString(),
      activeSessions: this.sessions.size,
      visibleWindow: this.visibleWindow,
      isolated: this.isolated,
      message: chromeExists
        ? `in-process persistent Playwright Chromium via ${this.browserRuntime.source} (${this.visibleWindow ? 'visible' : 'headless'})`
        : this.browserRuntime.message,
    };
  }

  /**
   * 获取或创建 platform 账号的浏览器会话。
   * 复用持久 BrowserContext（独立 cookie jar + localStorage），cookies 自动持久化到 user data dir。
   */
  async getOrCreateSession(input: {
    accountId: string | number;
    platform: LocalBrowserPlatform;
    reuseLoggedInSession?: boolean;
    /** 探活档（②探活/执行分离）：只读检查用，不弹窗（不恢复登录态、不 bringToFront、新会话 headless） */
    probe?: boolean;
  }): Promise<EngineSession> {
    const key = `${input.platform}-${input.accountId}`;
    const existing = this.sessions.get(key);
    if (existing) {
      try {
        const currentPage =
          this.selectBestSessionPage(
            existing.context.pages(),
            input.platform,
          ) || existing.page;
        existing.page = currentPage;
        if (await this.sessionLooksLoggedOut(existing, input.platform)) {
          const lastRecoveredAt = existing.recoveredAt
            ? new Date(existing.recoveredAt).getTime()
            : 0;
          if (Date.now() - lastRecoveredAt >= RECOVER_COOLDOWN_MS) {
            // 探活档：不恢复登录态（恢复会启动浏览器弹窗），直接返回现有会话
            if (input.probe) {
              existing.lastActivityAt = new Date().toISOString();
              return existing;
            }
            const recovered = await this.recoverSessionFromSavedCookies(
              existing,
              input.platform,
            );
            // 无论成败都记录尝试时间：cookie 失效时恢复会失败，不记录会导致高频重试+弹窗
            existing.recoveredAt = new Date().toISOString();
            if (recovered) {
              return recovered;
            }
          } else {
            this.logger.warn(
              `会话 ${key} 登录态未确认且刚尝试恢复过（冷却期内），跳过恢复避免反复弹窗`,
            );
            // 冷却期内直接返回现有会话：不恢复、不 bringToFront，避免高频调用弹窗打扰
            existing.lastActivityAt = new Date().toISOString();
            return existing;
          }
          if (input.reuseLoggedInSession === true) {
            const replacement =
              await this.findReusableLoggedInSamePlatformSession(
                input,
                key,
                new Set([existing.profileDir]),
              );
            if (replacement) {
              await this.closeSession(key);
              this.sessions.set(key, replacement);
              this.startedAt = this.startedAt ?? replacement.startedAt;
              this.logger.log(
                `会话 ${key} 当前 profile 未登录，改用同平台已登录 profile=${replacement.profileDir}`,
              );
              return replacement;
            }
          }
        }
        // 探活档：不 bringToFront（不弹窗）
        if (!input.probe) {
          await this.bringToFrontWithinBudget(existing.page, key);
        }
        existing.lastActivityAt = new Date().toISOString();
        return existing;
      } catch (error) {
        this.logger.warn(
          `会话 ${key} 已失效，重新创建：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.closeSession(key);
      }
    }

    const launching = this.sessionLaunches.get(key);
    if (launching) {
      return launching;
    }

    const launch = this.createSession(input, key).finally(() => {
      this.sessionLaunches.delete(key);
    });
    this.sessionLaunches.set(key, launch);
    return launch;
  }

  /**
   * ③ 弹窗打扰预算：60 秒冷却内不重复 bringToFront（防止调度/轮询高频拉会话反复弹窗）。
   * 用户主动操作（createSession 首次启动）不受限——本方法只用于复用会话的 bringToFront。
   */
  private async bringToFrontWithinBudget(
    page: EngineSession['page'],
    key: string,
  ): Promise<void> {
    const now = Date.now();
    if (now - this.lastBringToFrontAt < this.BRING_TO_FRONT_COOLDOWN_MS) {
      this.logger.warn(
        `会话 ${key} bringToFront 触发过于频繁（${Math.round(
          (now - this.lastBringToFrontAt) / 1000,
        )}s 内），已跳过弹窗（打扰预算熔断）`,
      );
      return;
    }
    this.lastBringToFrontAt = now;
    try {
      await page.bringToFront();
    } catch {
      // 页面可能已关闭，忽略
    }
  }

  private async createSession(
    input: {
      accountId: string | number;
      platform: LocalBrowserPlatform;
      reuseLoggedInSession?: boolean;
      probe?: boolean;
    },
    key: string,
  ): Promise<EngineSession> {
    if (input.reuseLoggedInSession === true) {
      const reusable = await this.findReusableLoggedInSamePlatformSession(
        input,
        key,
      );
      if (reusable) {
        this.sessions.set(key, reusable);
        this.startedAt = this.startedAt ?? reusable.startedAt;
        this.logger.log(
          `复用同平台已登录浏览器会话 ${key}: profile=${reusable.profileDir}, sourceAccount=${reusable.sourceAccountId ?? reusable.accountId}`,
        );
        return reusable;
      }
    }

    if (!existsSync(this.chromePath)) {
      throw new Error(
        `未找到内置 Playwright Chromium 可执行文件：${this.chromePath}`,
      );
    }

    const profileDir = this.profiles.ensureProfileExists(
      input.platform,
      String(input.accountId),
    );
    await this.profiles.ensureProfileCookiesCurrent(
      input.platform,
      String(input.accountId),
    );
    this.logger.log(
      `启动持久浏览器会话 ${key}: profile=${profileDir}, visible=${this.visibleWindow}`,
    );
    const cdpSession = await this.launchCdpContextWithRecovery(
      key,
      profileDir,
      input.platform,
      String(input.accountId),
      input.probe,
    );
    const context = cdpSession.context;
    await this.loadProfileCookies(context, profileDir, key, input.platform);
    const page =
      this.selectBestSessionPage(context.pages(), input.platform) ||
      (await context.newPage());
    // 探活档不 bringToFront（不弹窗）
    if (!input.probe) {
      await page.bringToFront().catch(() => undefined);
    }
    const session: EngineSession = {
      key,
      accountId: String(input.accountId),
      platform: input.platform,
      profileDir,
      context,
      page,
      debuggingPort: cdpSession.debuggingPort,
      browser: this.chromePath,
      browserProcess: cdpSession.process,
      browserReused: cdpSession.reused,
      visibleWindow: this.visibleWindow,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(key, session);
    if (!input.probe && (await this.sessionLooksLoggedOut(session, input.platform))) {
      await this.recoverSessionFromSavedCookies(session, input.platform);
    }
    this.startedAt = this.startedAt ?? session.startedAt;
    this.logger.log(`新持久会话 ${key}`);
    return session;
  }

  private async recoverSessionFromSavedCookies(
    session: EngineSession,
    platform: LocalBrowserPlatform,
    options: { targetUrl?: string } = {},
  ): Promise<EngineSession | null> {
    if (
      !session.key ||
      !session.profileDir ||
      !session.context ||
      !session.page
    ) {
      return null;
    }
    const cookiesPath = join(session.profileDir, '.login-cookies.json');
    if (!existsSync(cookiesPath)) return null;
    if (!this.storageStateMatchesPlatform(cookiesPath, platform)) return null;

    const loaded = await this.addCookiesFromStoragePath(
      session.context,
      cookiesPath,
      session.key,
    );
    if (loaded <= 0) return null;

    const targetUrl =
      options.targetUrl || this.resolvePlatformHomeUrl(platform);
    await this.gotoBestEffort(session.page, targetUrl, 20000);
    const page =
      this.selectBestSessionPage(session.context.pages(), platform) ||
      session.page;
    session.page = page;
    session.lastActivityAt = new Date().toISOString();
    if (await this.pageLooksLoggedIn(page, platform)) {
      // 仅恢复成功才把窗口带到前台（恢复失败高频调用时不打扰用户）
      await page.bringToFront().catch(() => undefined);
      this.logger.log(
        `会话 ${session.key} 已从 .login-cookies.json 恢复登录态`,
      );
      return session;
    }
    return null;
  }

  private async findReusableLoggedInSamePlatformSession(
    input: {
      accountId: string | number;
      platform: LocalBrowserPlatform;
    },
    key: string,
    excludedProfileDirs = new Set<string>(),
  ): Promise<EngineSession | null> {
    for (const existing of this.sessions.values()) {
      if (existing.platform !== input.platform || existing.key === key)
        continue;
      // 多账号隔离：仅当会话本就属于该账号时才可复用，禁止跨账号抢占过户。
      const existingAccountId =
        existing.sourceAccountId ?? existing.accountId;
      if (String(existingAccountId) !== String(input.accountId)) continue;
      if (excludedProfileDirs.has(existing.profileDir)) continue;
      try {
        const page =
          this.selectBestSessionPage(
            existing.context.pages(),
            input.platform,
          ) || existing.page;
        if (!(await this.pageLooksLoggedIn(page, input.platform))) continue;
        existing.page = page;
        await page.bringToFront().catch(() => undefined);
        const sourceKey = existing.key;
        const sourceAccountId = existing.sourceAccountId ?? existing.accountId;
        existing.key = key;
        existing.accountId = String(input.accountId);
        existing.sourceAccountId = sourceAccountId;
        existing.lastActivityAt = new Date().toISOString();
        this.sessions.delete(sourceKey);
        return existing;
      } catch {
        // 继续检查其他候选会话。
      }
    }

    for (const candidate of this.findRunningCdpProfileCandidates(
      input.platform,
    )) {
      if (excludedProfileDirs.has(candidate.profileDir)) continue;
      if (!(await this.isCdpResponding(candidate.port))) continue;
      try {
        const browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${candidate.port}`,
        );
        const context = browser.contexts()[0];
        if (!context) {
          await browser.close().catch(() => undefined);
          continue;
        }
        const page =
          this.selectBestSessionPage(context.pages(), input.platform) ||
          context.pages()[0] ||
          (await context.newPage());
        if (!(await this.pageLooksLoggedIn(page, input.platform))) {
          await browser.close().catch(() => undefined);
          continue;
        }
        await page.bringToFront().catch(() => undefined);
        const now = new Date().toISOString();
        return {
          key,
          accountId: String(input.accountId),
          sourceAccountId: candidate.accountId,
          platform: input.platform,
          profileDir: candidate.profileDir,
          context,
          page,
          debuggingPort: candidate.port,
          browser: this.chromePath,
          browserReused: true,
          visibleWindow: this.visibleWindow,
          startedAt: now,
          lastActivityAt: now,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug(
          `同平台 CDP 登录会话复用失败 ${input.platform}@${candidate.port}: ${message}`,
        );
        if (this.isRecoverableCdpLaunchError(message)) {
          this.terminateProcessesUsingProfile(candidate.profileDir);
          this.cleanupProfileLockFiles(candidate.profileDir);
        }
      }
    }
    return null;
  }

  private findRunningCdpProfileCandidates(
    platform: LocalBrowserPlatform,
  ): Array<{
    port: number;
    profileDir: string;
    accountId: string;
  }> {
    if (process.platform === 'win32') return [];
    try {
      const output = execFileSync('ps', ['ax', '-o', 'command='], {
        encoding: 'utf8',
      });
      const prefix = `${platform}-`;
      const candidates = new Map<
        string,
        { port: number; profileDir: string; accountId: string }
      >();
      for (const line of output.split('\n')) {
        const portMatch = line.match(/--remote-debugging-port=(\d+)/);
        const profileMatch = line.match(
          /--user-data-dir=(.+?)(?=\s+--[a-zA-Z0-9][\w-]*(?:=|\s|$)|$)/,
        );
        if (!portMatch || !profileMatch) continue;
        const port = Number(portMatch[1]);
        const profileDir = profileMatch[1].trim().replace(/\/+$/, '');
        const profileName = basename(profileDir);
        if (!profileName.startsWith(prefix)) continue;
        const accountId = profileName.slice(prefix.length);
        if (!accountId || !Number.isFinite(port)) continue;
        candidates.set(`${port}:${profileDir}`, {
          port,
          profileDir,
          accountId,
        });
      }
      return [...candidates.values()];
    } catch {
      return [];
    }
  }

  private async sessionLooksLoggedOut(
    session: EngineSession,
    platform: LocalBrowserPlatform,
  ): Promise<boolean> {
    try {
      return !(await this.pageLooksLoggedIn(session.page, platform));
    } catch {
      return false;
    }
  }

  private async pageLooksLoggedIn(
    page: Page,
    platform: LocalBrowserPlatform,
  ): Promise<boolean> {
    const url = page.url();
    if (!this.isSamePlatformNonLoginPage(platform, url)) return false;
    const text = await page
      .locator('body')
      .innerText({ timeout: 1500 })
      .catch(() => '');
    if (platform === 'wechat-channel') {
      return this.isWechatChannelAuthenticatedPage(url, text);
    }
    if (platform === 'xiaohongshu') {
      return this.isXiaohongshuAuthenticatedPage(url, text);
    }
    return !this.hasLoginPrompt(platform, url, text);
  }

  private normalizePageText(text: string): string {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isWechatChannelBackendUrl(url: string): boolean {
    return /channels\.weixin\.qq\.com\/(?:platform|micro)(?:[/?#]|$)/.test(
      url || '',
    );
  }

  private isWechatChannelMarketingLandingText(text: string): boolean {
    const normalizedText = this.normalizePageText(text);
    return (
      /一站式服务/.test(normalizedText) &&
      /让创作更简单|多人运营|内容管理|互动管理|数据中心|认证管理/.test(
        normalizedText,
      ) &&
      !/发表记录|评论管理|私信管理|数据概览|创作管理|发布视频|创建直播|作品管理|全部私信|打招呼消息/.test(
        normalizedText,
      )
    );
  }

  private isWechatChannelAuthenticatedPage(url: string, text: string): boolean {
    const normalizedText = this.normalizePageText(text);
    const isBackendUrl = this.isWechatChannelBackendUrl(url);
    const isChannelUrl = /channels\.weixin\.qq\.com(?:[/?#]|$)/.test(url || '');
    if (!isBackendUrl && !isChannelUrl) return false;
    if (this.isLoginLikeUrl(url)) return false;
    if (this.isWechatChannelMarketingLandingText(normalizedText)) return false;
    if (
      /扫码登录|验证码登录|密码登录|账号登录|登录后|请先登录|未登录|二维码|微信扫一扫/.test(
        normalizedText,
      )
    ) {
      return false;
    }
    if (isBackendUrl) return true;
    return /发表记录|评论管理|私信管理|数据概览|创作管理|发布视频|创建直播|作品管理|全部私信|全部消息|打招呼消息/.test(
      normalizedText,
    );
  }

  private isXiaohongshuBackendUrl(url: string): boolean {
    return /creator\.xiaohongshu\.com\/new(?:[/?#]|$)/.test(url || '');
  }

  private isXiaohongshuAuthenticatedPage(url: string, text: string): boolean {
    const normalizedText = this.normalizePageText(text);
    if (!this.isXiaohongshuBackendUrl(url)) return false;
    if (this.isLoginLikeUrl(url)) return false;
    if (this.hasLoginPrompt('xiaohongshu', url, normalizedText)) return false;
    return /小红书创作服务平台|创作服务平台|笔记管理|发布笔记|数据中心|账号设置|服务市场|技能中心|蒲公英|素材中心/.test(
      normalizedText,
    );
  }

  private hasLoginPrompt(
    platform: LocalBrowserPlatform,
    url: string,
    text: string,
  ): boolean {
    const normalizedText = this.normalizePageText(text);
    if (this.isLoginLikeUrl(url)) return true;
    if (
      /扫码登录|验证码登录|密码登录|账号登录|登录\/注册|登录或注册|登录后|请先登录|未登录|二维码/.test(
        normalizedText,
      )
    ) {
      return true;
    }
    if (
      platform === 'wechat-channel' &&
      this.isWechatChannelMarketingLandingText(normalizedText)
    ) {
      return true;
    }
    return false;
  }

  private async launchCdpContextWithRecovery(
    key: string,
    profileDir: string,
    platform: string,
    accountId: string,
    probe?: boolean,
  ): Promise<{
    context: BrowserContext;
    debuggingPort?: number;
    process?: ChildProcess;
    reused: boolean;
  }> {
    try {
      return await this.launchCdpContext(profileDir, platform, accountId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.isRecoverableCdpLaunchError(message)) {
        throw error;
      }
      if (this.shouldFallbackToPersistentContext(message)) {
        this.logger.warn(
          `会话 ${key} CDP 连接不兼容，改用 Playwright persistent context：${message}`,
        );
        this.terminateProcessesUsingProfile(profileDir);
        this.cleanupProfileLockFiles(profileDir);
        return {
          context: await this.launchPersistentContext(profileDir, probe),
          reused: false,
        };
      }
      this.logger.warn(
        `会话 ${key} CDP 启动失败，清理 profile/端口后重试一次：${message}`,
      );
      this.terminateProcessesUsingProfile(profileDir);
      this.cleanupProfileLockFiles(profileDir);
      try {
        return await this.launchCdpContext(profileDir, platform, accountId, {
          forceNewPort: true,
        });
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        if (this.shouldFallbackToPersistentContext(retryMessage)) {
          this.logger.warn(
            `会话 ${key} CDP 重试仍不兼容，改用 Playwright persistent context：${retryMessage}`,
          );
          this.terminateProcessesUsingProfile(profileDir);
          this.cleanupProfileLockFiles(profileDir);
          return {
            context: await this.launchPersistentContext(profileDir, probe),
            reused: false,
          };
        }
        throw retryError;
      }
    }
  }

  private isRecoverableCdpLaunchError(message: string): boolean {
    return /SingletonLock|CDP 端口|existing browser session|Browser\.setDownloadBehavior|Browser context management is not supported|connectOverCDP.*(?:Protocol error|Timeout)|browserType\.connectOverCDP:\s*Timeout/i.test(
      message,
    );
  }

  private shouldFallbackToPersistentContext(message: string): boolean {
    return (
      process.platform === 'win32' &&
      /Browser\.setDownloadBehavior|Browser context management is not supported|connectOverCDP.*Protocol error/i.test(
        message,
      )
    );
  }

  private async launchCdpContext(
    profileDir: string,
    platform: string,
    accountId: string,
    options: { forceNewPort?: boolean } = {},
  ): Promise<{
    context: BrowserContext;
    debuggingPort: number;
    process?: ChildProcess;
    reused: boolean;
  }> {
    const port = await this.pickCdpPort(
      platform,
      accountId,
      profileDir,
      options,
    );
    let proc: ChildProcess | undefined;
    let reused = false;

    if (!(await this.isCdpResponding(port))) {
      const args = this.buildCdpLaunchArgs(profileDir, port);
      this.logger.log(
        `启动 5409 同款 CDP 浏览器: port=${port}, profile=${profileDir}`,
      );
      proc = spawn(this.chromePath, args, {
        detached: process.platform !== 'win32',
        stdio: 'ignore',
      });
      proc.unref();
      await this.waitForCdp(port);
    } else {
      reused = true;
      this.logger.log(
        `复用已有 CDP 浏览器: port=${port}, profile=${profileDir}`,
      );
    }

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context =
      browser.contexts()[0] ||
      (await browser.newContext({
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
      }));
    return { context, debuggingPort: port, process: proc, reused };
  }

  private async launchPersistentContext(
    profileDir: string,
    probe?: boolean,
  ): Promise<BrowserContext> {
    return await chromium.launchPersistentContext(profileDir, {
      executablePath: this.chromePath,
      // 探活档强制 headless（不弹窗）；执行档才用可见窗口
      headless: probe === true ? true : !this.visibleWindow,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1600, height: 1000 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--restore-last-session=false',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1600,1000',
        '--window-position=48,36',
        '--mute-audio',
        '--lang=zh-CN',
        ...(this.isolated ? ['--incognito'] : []),
      ],
    });
  }

  private buildCdpLaunchArgs(profileDir: string, port: number): string[] {
    return [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDir}`,
      '--window-size=1600,1000',
      '--window-position=48,36',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=AutomationControlled',
      '--enable-automation',
      '--no-first-run',
      '--no-default-browser-check',
      '--restore-last-session=false',
      '--mute-audio',
      '--lang=zh-CN',
    ];
  }

  private selectBestSessionPage(
    pages: Page[],
    platform: LocalBrowserPlatform,
  ): Page | undefined {
    return (
      pages.find((page) =>
        this.isPreferredBusinessPage(platform, page.url()),
      ) ||
      pages.find((page) =>
        this.isSamePlatformNonLoginPage(platform, page.url()),
      ) ||
      pages.find((page) => this.isUsableBrowserPage(page.url()))
    );
  }

  private isPreferredBusinessPage(
    platform: LocalBrowserPlatform,
    url: string,
  ): boolean {
    if (!url || this.isLoginLikeUrl(url)) return false;
    if (platform === 'douyin') {
      return (
        url.includes('creator.douyin.com') && /\/creator-micro\//.test(url)
      );
    }
    if (platform === 'wechat-channel') {
      return (
        url.includes('channels.weixin.qq.com') && url.includes('/platform/')
      );
    }
    if (platform === 'xiaohongshu') {
      return this.isXiaohongshuBackendUrl(url);
    }
    if (platform === 'kuaishou') {
      return url.includes('cp.kuaishou.com');
    }
    if (platform === 'bilibili') {
      return url.includes('member.bilibili.com');
    }
    return false;
  }

  private isSamePlatformNonLoginPage(
    platform: LocalBrowserPlatform,
    url: string,
  ): boolean {
    if (!url || this.isLoginLikeUrl(url)) return false;
    if (platform === 'douyin') return url.includes('douyin.com');
    if (platform === 'wechat-channel')
      return url.includes('channels.weixin.qq.com');
    if (platform === 'xiaohongshu') return this.isXiaohongshuBackendUrl(url);
    if (platform === 'kuaishou') return url.includes('kuaishou.com');
    if (platform === 'bilibili') return url.includes('bilibili.com');
    return false;
  }

  private isUsableBrowserPage(url: string): boolean {
    return Boolean(
      url &&
      url !== 'about:blank' &&
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-untrusted://') &&
      !url.startsWith('devtools://'),
    );
  }

  private isLoginLikeUrl(url: string): boolean {
    return /login|signin|passport|sso/i.test(url || '');
  }

  private async pickCdpPort(
    platform: string,
    accountId: string,
    profileDir: string,
    options: { forceNewPort?: boolean } = {},
  ): Promise<number> {
    const start = Number(
      this.config.get<string>('INTERACTION_CDP_PORT_START') || 9223,
    );
    const maxOffset = 200;
    const preferred =
      start + (this.hash(`${platform}:${accountId}`) % maxOffset);
    const ports = Array.from(
      { length: maxOffset },
      (_, offset) => start + ((preferred - start + offset) % maxOffset),
    );
    if (!options.forceNewPort) {
      for (const port of this.findCdpPortsUsingProfile(profileDir)) {
        if (await this.isCdpResponding(port)) return port;
      }
      for (const port of ports) {
        if (await this.isPortAvailable(port)) continue;
        const existingProfile = await this.getCdpProfileDir(port);
        if (this.profileMatches(profileDir, existingProfile)) return port;
      }
    }
    for (let index = 0; index < ports.length; index += 1) {
      const port = ports[index];
      if (options.forceNewPort && index === 0) continue;
      if (await this.isPortAvailable(port)) return port;
    }
    throw new Error(`没有可用的 CDP 端口给 ${platform}:${accountId}`);
  }

  private findCdpPortsUsingProfile(profileDir: string): number[] {
    if (process.platform === 'win32') return [];
    try {
      const output = execFileSync('ps', ['ax', '-o', 'command='], {
        encoding: 'utf8',
      });
      const ports = new Set<number>();
      for (const line of output.split('\n')) {
        if (!line.includes(profileDir)) continue;
        const match = line.match(/--remote-debugging-port=(\d+)/);
        if (!match) continue;
        const port = Number(match[1]);
        if (Number.isFinite(port)) ports.add(port);
      }
      return [...ports];
    } catch {
      return [];
    }
  }

  private hash(value: string): number {
    let h = 0;
    for (const ch of value) {
      h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    }
    return h;
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    const net = await import('net');
    return await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(250);
      socket.once('connect', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(true));
    });
  }

  private async isCdpResponding(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { webSocketDebuggerUrl?: string };
      return Boolean(data.webSocketDebuggerUrl);
    } catch {
      return false;
    }
  }

  private async getCdpProfileDir(port: number): Promise<string> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return '';
      const data = (await response.json()) as {
        userDataDir?: string;
        'user-data-dir'?: string;
      };
      return data.userDataDir || data['user-data-dir'] || '';
    } catch {
      return '';
    }
  }

  private profileMatches(
    expectedProfile: string,
    actualProfile: string,
  ): boolean {
    if (!expectedProfile || !actualProfile) return false;
    const expected = expectedProfile.replace(/\/+$/, '');
    const actual = actualProfile.replace(/\/+$/, '');
    return actual === expected || actual.endsWith(expected);
  }

  private async waitForCdp(port: number): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await this.isCdpResponding(port)) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`浏览器启动后 CDP 端口 ${port} 未响应`);
  }

  private cleanupProfileLockFiles(profileDir: string): void {
    for (const filename of [
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'DevToolsActivePort',
      'RunningChromeVersion',
      join('Default', 'LOCK'),
    ]) {
      try {
        rmSync(join(profileDir, filename), { force: true, recursive: true });
      } catch {
        // 忽略残留文件清理失败，后续 launch 会给出真实错误。
      }
    }
  }

  private terminateProcessesUsingProfile(profileDir: string): void {
    if (process.platform === 'win32') return;
    try {
      const output = execFileSync(
        'ps',
        ['ax', '-o', 'pid=', '-o', 'command='],
        {
          encoding: 'utf8',
        },
      );
      const currentPid = process.pid;
      const pids = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes(profileDir))
        .map((line) => Number(line.split(/\s+/, 1)[0]))
        .filter((pid) => Number.isFinite(pid) && pid > 1 && pid !== currentPid);
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // 忽略，可能进程已经退出。
        }
      }
      if (pids.length) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
      }
      for (const pid of pids) {
        try {
          process.kill(pid, 0);
          process.kill(pid, 'SIGKILL');
        } catch {
          // 忽略，可能已经被 SIGTERM 结束。
        }
      }
    } catch (error) {
      this.logger.warn(
        `清理 profile 残留进程失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 平台账号预检：访问平台首页，确认 cookies / 登录态。
   * 替代 5409 /interaction/preflight。
   */
  async preflightPlatform(input: {
    accountId: string | number;
    platform: 'douyin' | 'wechat-channel';
    taskType?: 'comment-reply' | 'direct-message-reply';
  }): Promise<{
    ok: boolean;
    browserReady: boolean;
    loginRequired: boolean;
    message: string;
    blockers: string[];
  }> {
    try {
      const session = await this.getOrCreateSession(input);
      const targetUrl = this.resolvePreflightUrl(
        input.platform,
        input.taskType,
      );
      const currentUrl = session.page.url();
      if (
        !this.isSamePlatformBusinessPage(
          input.platform,
          currentUrl,
          input.taskType,
        )
      ) {
        await this.gotoBestEffort(session.page, targetUrl, 20000);
      }
      const url = session.page.url();
      const pageText = await session.page
        .locator('body')
        .innerText({ timeout: 3000 })
        .catch(() => '');
      const loginPrompt = this.hasLoginPrompt(input.platform, url, pageText);
      const wechatChannelAuthenticated =
        input.platform === 'wechat-channel' &&
        this.isWechatChannelAuthenticatedPage(url, pageText);
      let loginRequired =
        input.platform === 'wechat-channel'
          ? !wechatChannelAuthenticated
          : /login|signin|passport/i.test(url) || loginPrompt;
      if (loginRequired) {
        const cookieRecovered = await this.recoverSessionFromSavedCookies(
          session,
          input.platform,
          { targetUrl },
        );
        if (cookieRecovered) {
          return {
            ok: true,
            browserReady: true,
            loginRequired: false,
            message: '已从本地登录态恢复',
            blockers: [],
          };
        }
        const recovered = await this.recoverSessionFromLegacyProfile({
          accountId: input.accountId,
          platform: input.platform,
          taskType: input.taskType,
        });
        if (recovered) {
          const recoveredUrl = recovered.page.url();
          const recoveredText = await recovered.page
            .locator('body')
            .innerText({ timeout: 3000 })
            .catch(() => '');
          const recoveredLoginPrompt = this.hasLoginPrompt(
            input.platform,
            recoveredUrl,
            recoveredText,
          );
          const recoveredAuthenticated =
            input.platform === 'wechat-channel'
              ? this.isWechatChannelAuthenticatedPage(
                  recoveredUrl,
                  recoveredText,
                )
              : false;
          loginRequired =
            input.platform === 'wechat-channel'
              ? !recoveredAuthenticated
              : /login|signin|passport/i.test(recoveredUrl) ||
                recoveredLoginPrompt;
        }
      }
      return {
        ok: !loginRequired,
        browserReady: true,
        loginRequired,
        message: loginRequired ? '需要登录' : '已登录或首页可访问',
        blockers: loginRequired ? [`${input.platform} 未登录`] : [],
      };
    } catch (error) {
      return {
        ok: false,
        browserReady: false,
        loginRequired: false,
        message: error instanceof Error ? error.message : 'unknown',
        blockers: ['浏览器不可达'],
      };
    }
  }

  private async recoverSessionFromLegacyProfile(input: {
    accountId: string | number;
    platform: 'douyin' | 'wechat-channel';
    taskType?: 'comment-reply' | 'direct-message-reply';
  }): Promise<EngineSession | null> {
    const key = `${input.platform}-${input.accountId}`;
    await this.closeSession(key);
    const restoredProfile = this.profiles.restoreLegacyProfileSnapshot(
      input.platform,
      String(input.accountId),
    );
    if (!restoredProfile) {
      return null;
    }
    this.terminateProcessesUsingProfile(restoredProfile);
    this.cleanupProfileLockFiles(restoredProfile);
    const recovered = await this.getOrCreateSession(input);
    const targetUrl = this.resolvePreflightUrl(input.platform, input.taskType);
    await this.gotoBestEffort(recovered.page, targetUrl, 20000);
    return recovered;
  }

  async recoverWechatChannelSessionFromLegacyProfile(input: {
    accountId: string | number;
    taskType?: 'comment-reply' | 'direct-message-reply';
  }): Promise<EngineSession | null> {
    return this.recoverSessionFromLegacyProfile({
      accountId: input.accountId,
      platform: 'wechat-channel',
      taskType: input.taskType,
    });
  }

  private resolvePreflightUrl(
    platform: 'douyin' | 'wechat-channel',
    taskType?: 'comment-reply' | 'direct-message-reply',
  ): string {
    if (platform === 'douyin') {
      if (taskType === 'comment-reply') {
        return 'https://creator.douyin.com/creator-micro/interactive/comment';
      }
      if (taskType === 'direct-message-reply') {
        return 'https://creator.douyin.com/creator-micro/data/following/chat';
      }
      return 'https://creator.douyin.com/';
    }
    if (taskType === 'comment-reply') {
      return 'https://channels.weixin.qq.com/platform/interaction/comment';
    }
    if (taskType === 'direct-message-reply') {
      return 'https://channels.weixin.qq.com/platform/private_msg';
    }
    return 'https://channels.weixin.qq.com/';
  }

  private resolvePlatformHomeUrl(platform: LocalBrowserPlatform): string {
    if (platform === 'douyin') return 'https://creator.douyin.com/';
    if (platform === 'wechat-channel') return 'https://channels.weixin.qq.com/';
    if (platform === 'xiaohongshu') return 'https://creator.xiaohongshu.com/';
    if (platform === 'kuaishou') return 'https://cp.kuaishou.com/';
    if (platform === 'bilibili') return 'https://member.bilibili.com/';
    return 'about:blank';
  }

  private isSamePlatformBusinessPage(
    platform: 'douyin' | 'wechat-channel',
    currentUrl: string,
    taskType?: 'comment-reply' | 'direct-message-reply',
  ): boolean {
    if (!currentUrl || currentUrl === 'about:blank') return false;
    if (platform === 'douyin') {
      if (!currentUrl.includes('creator.douyin.com')) return false;
      if (taskType === 'comment-reply')
        return currentUrl.includes('/interactive/comment');
      if (taskType === 'direct-message-reply')
        return currentUrl.includes('/following/chat');
      return true;
    }
    if (!currentUrl.includes('channels.weixin.qq.com')) return false;
    if (taskType === 'comment-reply') return currentUrl.includes('/comment');
    if (taskType === 'direct-message-reply') {
      return currentUrl.includes('/private_msg');
    }
    return true;
  }

  private async gotoBestEffort(
    page: Page,
    url: string,
    timeout: number,
  ): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    } catch (error) {
      const currentUrl = page.url();
      const message = error instanceof Error ? error.message : String(error);
      if (currentUrl && currentUrl !== 'about:blank') {
        this.logger.warn(
          `页面导航超时但已进入页面，继续做登录态判断: target=${url}, current=${currentUrl}, error=${message}`,
        );
        return;
      }
      if (/Timeout/i.test(message)) {
        this.logger.warn(
          `页面导航超时且未拿到 URL，继续用当前页面做登录态判断: target=${url}, error=${message}`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * 打开 URL（替代 5409 open()，用 playwright page.goto）
   */
  async open(
    sessionKey: string,
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
  ): Promise<string> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`会话不存在: ${sessionKey}`);
    try {
      await session.page.goto(url, {
        waitUntil: options?.waitUntil ?? 'domcontentloaded',
        timeout: 30000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentUrl = session.page.url();
      if (
        currentUrl &&
        currentUrl !== 'about:blank' &&
        (/ERR_ABORTED|Navigation interrupted|frame was detached|net::ERR_ABORTED/i.test(
          message,
        ) ||
          /Timeout/i.test(message))
      ) {
        this.logger.warn(
          `页面导航未稳定完成，继续读取当前页面: target=${url}, current=${currentUrl}, error=${message}`,
        );
      } else {
        throw error;
      }
    }
    session.lastActivityAt = new Date().toISOString();
    return session.page.url();
  }

  /**
   * 点击元素（替代 5409 click()，用 playwright page.click）
   */
  async click(
    sessionKey: string,
    selector: string,
    options?: { timeout?: number },
  ): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`会话不存在: ${sessionKey}`);
    await session.page.click(selector, { timeout: options?.timeout ?? 10000 });
    session.lastActivityAt = new Date().toISOString();
  }

  /**
   * 填写输入框（替代 5409 type()，用 playwright page.fill）
   */
  async fill(
    sessionKey: string,
    selector: string,
    text: string,
    options?: { timeout?: number },
  ): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`会话不存在: ${sessionKey}`);
    await session.page.fill(selector, text, {
      timeout: options?.timeout ?? 10000,
    });
    session.lastActivityAt = new Date().toISOString();
  }

  /**
   * 等待元素出现（替代 5409 waitFor，playwright auto-wait）
   */
  async waitForSelector(
    sessionKey: string,
    selector: string,
    options?: { timeout?: number; state?: 'visible' | 'attached' | 'hidden' },
  ): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`会话不存在: ${sessionKey}`);
    await session.page.waitForSelector(selector, {
      timeout: options?.timeout ?? 15000,
      state: options?.state ?? 'visible',
    });
    session.lastActivityAt = new Date().toISOString();
  }

  /**
   * 截图证据：写入 evidence 目录并返 URL（前端可直接访问）。
   */
  async captureEvidence(input: {
    sessionKey: string;
    label: string;
  }): Promise<{ path: string; url: string }> {
    const session = this.sessions.get(input.sessionKey);
    if (!session) {
      throw new Error(`会话不存在: ${input.sessionKey}`);
    }
    const filename = `${Date.now()}-${input.sessionKey.replace(/[^a-z0-9-]/gi, '_')}.png`;
    const fullPath = join(this.evidenceRoot, filename);
    await session.page.screenshot({ path: fullPath, fullPage: false });
    return {
      path: fullPath,
      url: `/api/local-engine/browser/evidence/${filename}`,
    };
  }

  /**
   * 只读页面快照：用于 Phase 0 采集 spike。
   * 不点击、不输入、不发送，只读取当前页面文本并保存截图证据。
   */
  async readPageSnapshot(input: {
    sessionKey: string;
    label: string;
    textLimit?: number;
  }): Promise<{
    url: string;
    title: string;
    textSample: string;
    evidencePath: string;
    evidenceUrl: string;
  }> {
    const session = this.sessions.get(input.sessionKey);
    if (!session) {
      throw new Error(`会话不存在: ${input.sessionKey}`);
    }
    const [title, textSample, evidence] = await Promise.all([
      session.page.title().catch(() => ''),
      session.page
        .locator('body')
        .innerText({ timeout: 5000 })
        .then((text) =>
          text
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, input.textLimit ?? 4000),
        )
        .catch(() => ''),
      this.captureEvidence({
        sessionKey: input.sessionKey,
        label: input.label,
      }),
    ]);
    session.lastActivityAt = new Date().toISOString();
    return {
      url: session.page.url(),
      title,
      textSample,
      evidencePath: evidence.path,
      evidenceUrl: evidence.url,
    };
  }

  async loadStorageStateCookies(input: {
    sessionKey: string;
    storagePath?: string | null;
  }): Promise<number> {
    if (!input.storagePath || !existsSync(input.storagePath)) return 0;
    const session = this.sessions.get(input.sessionKey);
    if (!session) {
      throw new Error(`会话不存在: ${input.sessionKey}`);
    }
    if (
      this.shouldPreferPersistentCookieStore(
        session.profileDir,
        input.storagePath,
      )
    ) {
      this.logger.log(
        `会话 ${input.sessionKey} 已有更新的持久 Chrome cookie store，跳过旧 storageState 注入`,
      );
      return 0;
    }
    return this.addCookiesFromStoragePath(
      session.context,
      input.storagePath,
      input.sessionKey,
    );
  }

  async closeSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    try {
      await session.context.close();
    } catch {
      // 忽略
    }
    if (session.browserProcess) {
      try {
        if (process.platform === 'win32') {
          session.browserProcess.kill('SIGTERM');
        } else if (session.browserProcess.pid) {
          process.kill(-session.browserProcess.pid, 'SIGTERM');
        }
      } catch {
        // 忽略，可能已经退出。
      }
    }
    this.sessions.delete(key);
  }

  listSessions(): EngineSessionSummary[] {
    return [...this.sessions.values()].map((session) => {
      let currentUrl: string | undefined;
      let status: EngineSessionSummary['status'] = 'ready';
      try {
        currentUrl = session.page.url();
      } catch {
        status = 'blocked';
      }
      return {
        key: session.key,
        accountId: session.accountId,
        sourceAccountId: session.sourceAccountId,
        platform: session.platform,
        profileDir: session.profileDir,
        status,
        visibleWindow: session.visibleWindow,
        currentUrl,
        browser: session.browser,
        debuggingPort: session.debuggingPort,
        browserReused: session.browserReused,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        runtimeMode: 'persistent-cdp-browser',
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const key of [...this.sessions.keys()]) {
      await this.closeSession(key);
    }
  }

  /**
   * 直接获取 session（platform service 调用方使用）。
   */
  getSession(key: string): EngineSession | undefined {
    return this.sessions.get(key);
  }

  async recoverAccountSessionFromSavedCookies(input: {
    accountId: string | number;
    platform: LocalBrowserPlatform;
    targetUrl?: string;
  }): Promise<EngineSession | null> {
    const key = `${input.platform}-${input.accountId}`;
    const session = this.sessions.get(key);
    if (!session) return null;
    return this.recoverSessionFromSavedCookies(session, input.platform, {
      targetUrl: input.targetUrl,
    });
  }

  private async loadProfileCookies(
    context: BrowserContext,
    profileDir: string,
    key: string,
    platform?: LocalBrowserPlatform,
  ): Promise<void> {
    const legacyProfileMarker = join(
      profileDir,
      '.legacy-profile-imported.json',
    );
    const cookiesPath = join(profileDir, '.login-cookies.json');
    if (existsSync(legacyProfileMarker) && !existsSync(cookiesPath)) {
      this.logger.log(
        `会话 ${key} 使用完整 legacy 浏览器 profile，跳过额外 cookie 注入`,
      );
      return;
    }
    if (!existsSync(cookiesPath)) return;
    if (
      this.shouldPreferPersistentCookieStore(profileDir, cookiesPath, platform)
    ) {
      this.logger.log(
        `会话 ${key} 已有更新的持久 Chrome cookie store，跳过 .login-cookies.json 注入`,
      );
      return;
    }
    try {
      const state = JSON.parse(readFileSync(cookiesPath, 'utf8')) as {
        cookies?: unknown;
      };
      const cookies = Array.isArray(state.cookies)
        ? state.cookies.filter((cookie): cookie is Cookie =>
            Boolean(
              cookie &&
              typeof cookie === 'object' &&
              typeof (cookie as Cookie).name === 'string' &&
              typeof (cookie as Cookie).value === 'string',
            ),
          )
        : [];
      if (cookies.length) {
        await context.addCookies(cookies);
        this.logger.log(`会话 ${key} 加载登录 cookies: ${cookies.length}`);
      }
    } catch (error) {
      this.logger.warn(
        `会话 ${key} 加载 profile cookies 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async addCookiesFromStoragePath(
    context: BrowserContext,
    storagePath: string,
    key: string,
  ): Promise<number> {
    try {
      const state = JSON.parse(readFileSync(storagePath, 'utf8')) as {
        cookies?: unknown;
      };
      const cookies = Array.isArray(state.cookies)
        ? state.cookies.filter((cookie): cookie is Cookie =>
            Boolean(
              cookie &&
              typeof cookie === 'object' &&
              typeof (cookie as Cookie).name === 'string' &&
              typeof (cookie as Cookie).value === 'string',
            ),
          )
        : [];
      if (!cookies.length) return 0;
      await context.addCookies(cookies);
      this.logger.log(
        `会话 ${key} 从 storageState 加载 cookies: ${cookies.length}`,
      );
      return cookies.length;
    } catch (error) {
      this.logger.warn(
        `会话 ${key} 加载 storageState cookies 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }

  private shouldPreferPersistentCookieStore(
    profileDir: string,
    storagePath: string,
    platform?: LocalBrowserPlatform,
  ): boolean {
    const cookieStorePath = join(profileDir, 'Default', 'Cookies');
    if (!existsSync(cookieStorePath) || !existsSync(storagePath)) return false;
    try {
      const cookieStore = statSync(cookieStorePath);
      const storageState = statSync(storagePath);
      if (!cookieStore.isFile() || !storageState.isFile()) return false;
      if (
        platform &&
        !this.storageStateMatchesPlatform(storagePath, platform)
      ) {
        return false;
      }
      // Chrome creates a small SQLite cookie DB even for empty profiles. The size
      // guard keeps legacy storageState useful for first-time bootstrap profiles.
      if (cookieStore.size < 24 * 1024) return false;
      return cookieStore.mtimeMs > storageState.mtimeMs;
    } catch {
      return false;
    }
  }

  private storageStateMatchesPlatform(
    storagePath: string,
    platform: LocalBrowserPlatform,
  ): boolean {
    try {
      const state = JSON.parse(readFileSync(storagePath, 'utf8')) as {
        cookies?: unknown;
        origins?: unknown;
      };
      const cookies = Array.isArray(state.cookies) ? state.cookies : [];
      const origins = Array.isArray(state.origins) ? state.origins : [];
      if (!cookies.length && !origins.length) return false;
      return (
        cookies.every((cookie) => {
          if (!cookie || typeof cookie !== 'object') return false;
          const domain = (cookie as { domain?: unknown }).domain;
          return this.domainMatchesPlatform(safeText(domain || ''), platform);
        }) &&
        origins.every((origin) => {
          if (!origin || typeof origin !== 'object') return false;
          const value = (origin as { origin?: unknown }).origin;
          return this.originMatchesPlatform(safeText(value || ''), platform);
        })
      );
    } catch {
      return false;
    }
  }

  private domainMatchesPlatform(
    value: string,
    platform: LocalBrowserPlatform,
  ): boolean {
    const normalized = value.toLowerCase().replace(/^\./, '');
    const domains = this.platformCookieDomains(platform);
    return domains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    );
  }

  private originMatchesPlatform(
    value: string,
    platform: LocalBrowserPlatform,
  ): boolean {
    try {
      return this.domainMatchesPlatform(new URL(value).hostname, platform);
    } catch {
      return this.domainMatchesPlatform(value, platform);
    }
  }

  private platformCookieDomains(platform: LocalBrowserPlatform): string[] {
    if (platform === 'wechat-channel') {
      return ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'];
    }
    if (platform === 'douyin') {
      return ['douyin.com', 'bytedance.com', 'iesdouyin.com'];
    }
    if (platform === 'xiaohongshu') return ['xiaohongshu.com'];
    if (platform === 'kuaishou') return ['kuaishou.com'];
    if (platform === 'bilibili') return ['bilibili.com'];
    return [];
  }
}
