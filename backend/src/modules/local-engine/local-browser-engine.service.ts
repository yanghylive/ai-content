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
import { join } from 'path';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { chromium, type BrowserContext, type Cookie, type Page } from 'playwright';
import { CdpBrowserProfileService } from './cdp-browser-profile.service';
import {
  PlaywrightBrowserRuntimeService,
  type PlaywrightBrowserRuntimeInfo,
} from './playwright-browser-runtime.service';

export type LocalBrowserPlatform =
  | 'douyin'
  | 'wechat-channel'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'bilibili';

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

export type EngineSession = {
  key: string;
  accountId: string;
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
};

export type EngineSessionSummary = {
  key: string;
  accountId: string;
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

  constructor(
    private readonly config: ConfigService,
    private readonly profiles: CdpBrowserProfileService,
    private readonly browsers: PlaywrightBrowserRuntimeService,
  ) {
    this.browserRuntime = this.browsers.resolve();
    this.chromePath = this.browserRuntime.executablePath;
    this.profileRoot =
      this.config.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
      join(process.cwd(), 'data', 'browser-profiles');
    this.evidenceRoot =
      this.config.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
      join(process.cwd(), '.local-logs', 'browser-evidence');
    this.visibleWindow = this.config.get<string>('LOCAL_BROWSER_HEADLESS') !== 'true';
    this.isolated = this.config.get<string>('LOCAL_BROWSER_ISOLATED') === 'true';
    mkdirSync(this.profileRoot, { recursive: true });
    mkdirSync(this.evidenceRoot, { recursive: true });
  }

  /**
   * 引擎健康检查（替代 5409 /health）。
   * 启动 Chrome（懒启动）；失败时返 ok=false，但永不抛异常。
   */
  async getStatus(): Promise<EngineStatus> {
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
  }): Promise<EngineSession> {
    const key = `${input.platform}-${input.accountId}`;
    const existing = this.sessions.get(key);
    if (existing) {
      try {
        await existing.page.bringToFront();
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

  private async createSession(
    input: {
      accountId: string | number;
      platform: LocalBrowserPlatform;
    },
    key: string,
  ): Promise<EngineSession> {
    if (!existsSync(this.chromePath)) {
      throw new Error(`未找到内置 Playwright Chromium 可执行文件：${this.chromePath}`);
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
    );
    const context = cdpSession.context;
    await this.loadProfileCookies(context, profileDir, key);
    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront().catch(() => undefined);
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
    this.startedAt = this.startedAt ?? session.startedAt;
    this.logger.log(`新持久会话 ${key}`);
    return session;
  }

  private async launchCdpContextWithRecovery(
    key: string,
    profileDir: string,
    platform: string,
    accountId: string,
  ): Promise<{
    context: BrowserContext;
    debuggingPort: number;
    process?: ChildProcess;
    reused: boolean;
  }> {
    try {
      return await this.launchCdpContext(profileDir, platform, accountId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/SingletonLock|CDP 端口|existing browser session/i.test(message)) {
        throw error;
      }
      this.logger.warn(`会话 ${key} CDP 启动失败，清理 profile/端口后重试一次：${message}`);
      this.terminateProcessesUsingProfile(profileDir);
      this.cleanupProfileLockFiles(profileDir);
      return await this.launchCdpContext(profileDir, platform, accountId, {
        forceNewPort: true,
      });
    }
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
    const port = await this.pickCdpPort(platform, accountId, profileDir, options);
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
      this.logger.log(`复用已有 CDP 浏览器: port=${port}, profile=${profileDir}`);
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

  private async launchPersistentContext(profileDir: string): Promise<BrowserContext> {
    return await chromium.launchPersistentContext(profileDir, {
      executablePath: this.chromePath,
      headless: !this.visibleWindow,
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
      '--no-first-run',
      '--no-default-browser-check',
      '--restore-last-session=false',
      '--mute-audio',
      '--lang=zh-CN',
    ];
  }

  private async pickCdpPort(
    platform: string,
    accountId: string,
    profileDir: string,
    options: { forceNewPort?: boolean } = {},
  ): Promise<number> {
    const start = Number(this.config.get<string>('INTERACTION_CDP_PORT_START') || 9223);
    const maxOffset = 200;
    const preferred = start + (this.hash(`${platform}:${accountId}`) % maxOffset);
    for (let offset = 0; offset < maxOffset; offset += 1) {
      const port = start + ((preferred - start + offset) % maxOffset);
      if (options.forceNewPort && offset === 0) continue;
      if (await this.isPortAvailable(port)) return port;
      const existingProfile = await this.getCdpProfileDir(port);
      if (this.profileMatches(profileDir, existingProfile)) return port;
    }
    throw new Error(`没有可用的 CDP 端口给 ${platform}:${accountId}`);
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

  private profileMatches(expectedProfile: string, actualProfile: string): boolean {
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
      const output = execFileSync('ps', ['ax', '-o', 'pid=', '-o', 'command='], {
        encoding: 'utf8',
      });
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
      const targetUrl = this.resolvePreflightUrl(input.platform, input.taskType);
      const currentUrl = session.page.url();
      if (!this.isSamePlatformBusinessPage(input.platform, currentUrl, input.taskType)) {
        await this.gotoBestEffort(session.page, targetUrl, 20000);
      }
      const url = session.page.url();
      const pageText = await session.page
        .locator('body')
        .innerText({ timeout: 3000 })
        .catch(() => '');
      const loginPrompt =
        /扫码登录|验证码登录|密码登录|账号登录|登录后|请先登录|未登录|二维码/.test(pageText);
      const wechatChannelLoggedInHome =
        input.platform === 'wechat-channel' &&
        /视频号助手/.test(pageText) &&
        /多人运营|内容管理|互动管理|数据中心|认证管理/.test(pageText) &&
        !loginPrompt;
      let loginRequired =
        !wechatChannelLoggedInHome &&
        (/login|signin|passport/i.test(url) || loginPrompt);
      if (loginRequired && input.platform === 'wechat-channel') {
        const recovered = await this.recoverSessionFromLegacyProfile({
          accountId: input.accountId,
          platform: 'wechat-channel',
          taskType: input.taskType,
        });
        if (recovered) {
          const recoveredUrl = recovered.page.url();
          const recoveredText = await recovered.page
            .locator('body')
            .innerText({ timeout: 3000 })
            .catch(() => '');
          const recoveredLoginPrompt =
            /扫码登录|验证码登录|密码登录|账号登录|登录后|请先登录|未登录|二维码/.test(
              recoveredText,
            );
          const recoveredLoggedInHome =
            /视频号助手/.test(recoveredText) &&
            /多人运营|内容管理|互动管理|数据中心|认证管理/.test(recoveredText) &&
            !recoveredLoginPrompt;
          loginRequired =
            !recoveredLoggedInHome &&
            (/login|signin|passport/i.test(recoveredUrl) || recoveredLoginPrompt);
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
    platform: 'wechat-channel';
    taskType?: 'comment-reply' | 'direct-message-reply';
  }): Promise<EngineSession | null> {
    const key = `${input.platform}-${input.accountId}`;
    await this.closeSession(key);
    const restoredProfileDir = this.profiles.restoreLegacyProfileSnapshot(
      input.platform,
      String(input.accountId),
    );
    if (!restoredProfileDir) {
      return null;
    }
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

  private isSamePlatformBusinessPage(
    platform: 'douyin' | 'wechat-channel',
    currentUrl: string,
    taskType?: 'comment-reply' | 'direct-message-reply',
  ): boolean {
    if (!currentUrl || currentUrl === 'about:blank') return false;
    if (platform === 'douyin') {
      if (!currentUrl.includes('creator.douyin.com')) return false;
      if (taskType === 'comment-reply') return currentUrl.includes('/interactive/comment');
      if (taskType === 'direct-message-reply') return currentUrl.includes('/following/chat');
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
  async open(sessionKey: string, url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<string> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`会话不存在: ${sessionKey}`);
    await session.page.goto(url, { waitUntil: options?.waitUntil ?? 'domcontentloaded', timeout: 30000 });
    session.lastActivityAt = new Date().toISOString();
    return session.page.url();
  }

  /**
   * 点击元素（替代 5409 click()，用 playwright page.click）
   */
  async click(sessionKey: string, selector: string, options?: { timeout?: number }): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`会话不存在: ${sessionKey}`);
    await session.page.click(selector, { timeout: options?.timeout ?? 10000 });
    session.lastActivityAt = new Date().toISOString();
  }

  /**
   * 填写输入框（替代 5409 type()，用 playwright page.fill）
   */
  async fill(sessionKey: string, selector: string, text: string, options?: { timeout?: number }): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`会话不存在: ${sessionKey}`);
    await session.page.fill(selector, text, { timeout: options?.timeout ?? 10000 });
    session.lastActivityAt = new Date().toISOString();
  }

  /**
   * 等待元素出现（替代 5409 waitFor，playwright auto-wait）
   */
  async waitForSelector(sessionKey: string, selector: string, options?: { timeout?: number; state?: 'visible' | 'attached' | 'hidden' }): Promise<void> {
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

  async loadStorageStateCookies(input: {
    sessionKey: string;
    storagePath?: string | null;
  }): Promise<number> {
    if (!input.storagePath || !existsSync(input.storagePath)) return 0;
    const session = this.sessions.get(input.sessionKey);
    if (!session) {
      throw new Error(`会话不存在: ${input.sessionKey}`);
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

  private async loadProfileCookies(
    context: BrowserContext,
    profileDir: string,
    key: string,
  ): Promise<void> {
    const legacyProfileMarker = join(profileDir, '.legacy-profile-imported.json');
    if (existsSync(legacyProfileMarker)) {
      this.logger.log(`会话 ${key} 使用完整 legacy 浏览器 profile，跳过额外 cookie 注入`);
      return;
    }
    const cookiesPath = join(profileDir, '.login-cookies.json');
    if (!existsSync(cookiesPath)) return;
    try {
      const state = JSON.parse(readFileSync(cookiesPath, 'utf8')) as {
        cookies?: unknown;
      };
      const cookies = Array.isArray(state.cookies)
        ? (state.cookies.filter(
            (cookie): cookie is Cookie =>
              Boolean(
                cookie &&
                  typeof cookie === 'object' &&
                  typeof (cookie as Cookie).name === 'string' &&
                  typeof (cookie as Cookie).value === 'string',
              ),
          ) as Cookie[])
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
        ? (state.cookies.filter(
            (cookie): cookie is Cookie =>
              Boolean(
                cookie &&
                  typeof cookie === 'object' &&
                  typeof (cookie as Cookie).name === 'string' &&
                  typeof (cookie as Cookie).value === 'string',
              ),
          ) as Cookie[])
        : [];
      if (!cookies.length) return 0;
      await context.addCookies(cookies);
      this.logger.log(`会话 ${key} 从 storageState 加载 cookies: ${cookies.length}`);
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
}
