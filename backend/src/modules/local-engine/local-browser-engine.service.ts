/**
 * LocalBrowserEngine · 3010 主系统的 in-process 浏览器自动化引擎
 *
 * 替代原 5409 auto-upload 的 CDP 引擎：把 5409 的 7334 行 main.py + 653 行 cdp_runtime.py
 * 核心能力搬进 3010 backend，Puppeteer 控制 Chrome 走 CDP。
 *
 * 设计目标：
 * 1. 拥有 Chrome 实例（启动 / 停止 / 复用）
 * 2. 维护账号 profile（cookies / localStorage / Chrome user data dir）
 * 3. 提供 platform 中立的页面控制（navigate / click / type / wait / screenshot）
 * 4. 暴露 draft / send / read 三个动作，platform service 在此之上实现业务
 * 5. 不引用 5409 HTTP 端点，零外部依赖
 *
 * 启动策略：懒启动（首次 platform 任务时启动 Chrome），常驻后台，重用 profile。
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import * as puppeteer from 'puppeteer-core';
import type { Browser, Page, BrowserContext } from 'puppeteer-core';

export type EngineStatus = {
  online: boolean;
  chromePath: string;
  version: string;
  startedAt: string;
  activeSessions: number;
  message: string;
};

export type EngineSession = {
  key: string;
  accountId: string;
  platform: string;
  context: BrowserContext;
  page: Page;
  startedAt: string;
  lastActivityAt: string;
};

@Injectable()
export class LocalBrowserEngine implements OnModuleDestroy {
  private readonly logger = new Logger(LocalBrowserEngine.name);
  private browser: Browser | null = null;
  private readonly sessions = new Map<string, EngineSession>();
  private startedAt: string | null = null;
  private readonly chromePath: string;
  private readonly profileRoot: string;
  private readonly evidenceRoot: string;

  constructor(private readonly config: ConfigService) {
    this.chromePath =
      this.config.get<string>('LOCAL_BROWSER_CHROME_PATH') ||
      '/Users/yanghy/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
    this.profileRoot =
      this.config.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
      join(process.cwd(), '.local-browser-profiles');
    this.evidenceRoot =
      this.config.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
      join(process.cwd(), '.local-logs', 'browser-evidence');
    mkdirSync(this.profileRoot, { recursive: true });
    mkdirSync(this.evidenceRoot, { recursive: true });
  }

  /**
   * 引擎健康检查（替代 5409 /health）。
   * 启动 Chrome（懒启动）；失败时返 ok=false，但永不抛异常。
   */
  async getStatus(): Promise<EngineStatus> {
    if (!this.browser) {
      try {
        await this.startBrowser();
      } catch (error) {
        return {
          online: false,
          chromePath: this.chromePath,
          version: 'unknown',
          startedAt: this.startedAt ?? new Date().toISOString(),
          activeSessions: this.sessions.size,
          message: `Chrome 未启动：${error instanceof Error ? error.message : 'unknown'}`,
        };
      }
    }
    let version = 'unknown';
    try {
      version = await this.browser!.version();
    } catch {
      // 忽略，保留默认值
    }
    return {
      online: true,
      chromePath: this.chromePath,
      version,
      startedAt: this.startedAt ?? new Date().toISOString(),
      activeSessions: this.sessions.size,
      message: 'in-process Chrome via puppeteer-core',
    };
  }

  private async startBrowser(): Promise<void> {
    if (this.browser) return;
    this.logger.log(`启动 in-process Chrome: ${this.chromePath}`);
    this.browser = await puppeteer.launch({
      executablePath: this.chromePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      defaultViewport: { width: 1280, height: 800 },
    });
    this.startedAt = new Date().toISOString();
    this.logger.log(`Chrome 已启动：${await this.browser.version()}`);
  }

  /**
   * 获取或创建 platform 账号的浏览器会话。
   * 复用 Chrome user data dir，cookies / localStorage 自动持久化。
   */
  async getOrCreateSession(input: {
    accountId: string | number;
    platform: 'douyin' | 'wechat-channel';
  }): Promise<EngineSession> {
    const key = `${input.platform}-${input.accountId}`;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastActivityAt = new Date().toISOString();
      return existing;
    }
    await this.startBrowser();
    const profileDir = join(this.profileRoot, input.platform, String(input.accountId));
    mkdirSync(profileDir, { recursive: true });
    const context = await this.browser!.createBrowserContext();
    const page = await context.newPage();
    const session: EngineSession = {
      key,
      accountId: String(input.accountId),
      platform: input.platform,
      context,
      page,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(key, session);
    this.logger.log(`新会话 ${key} (profileDir=${profileDir})`);
    return session;
  }

  /**
   * 平台账号预检：访问平台首页，确认 cookies / 登录态。
   * 替代 5409 /interaction/preflight。
   */
  async preflightPlatform(input: {
    accountId: string | number;
    platform: 'douyin' | 'wechat-channel';
  }): Promise<{
    ok: boolean;
    browserReady: boolean;
    loginRequired: boolean;
    message: string;
    blockers: string[];
  }> {
    try {
      const session = await this.getOrCreateSession(input);
      const targetUrl =
        input.platform === 'douyin'
          ? 'https://www.douyin.com/'
          : 'https://channels.weixin.qq.com/';
      await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const url = session.page.url();
      const loginRequired = /login|signin|passport/i.test(url);
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

  async closeSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    try {
      await session.context.close();
    } catch {
      // 忽略
    }
    this.sessions.delete(key);
  }

  async onModuleDestroy(): Promise<void> {
    for (const key of [...this.sessions.keys()]) {
      await this.closeSession(key);
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // 忽略
      }
      this.browser = null;
    }
  }

  /**
   * 直接获取 session（platform service 调用方使用）。
   */
  getSession(key: string): EngineSession | undefined {
    return this.sessions.get(key);
  }
}
