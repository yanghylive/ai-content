import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { existsSync } from 'node:fs';
import { PlaywrightBrowserRuntimeService } from '../local-engine/playwright-browser-runtime.service';
import type { BossLoginCheckResult } from './boss-recruit.types';

/** Boss 直聘招聘端入口（Boss 登录后可访问） */
const BOSS_HOME_URL = 'https://www.zhipin.com/web/recruit';
const BOSS_JOB_URL = 'https://www.zhipin.com/web/recruit/position';
const BOSS_CHAT_URL = 'https://www.zhipin.com/web/recruit/chat';

/**
 * Boss 直聘 Playwright 自动化客户端（借鉴炼刀 boss_service 的网页自动化思路）：
 * 打开 zhipin.com 招聘端 → 检测登录态（storageState）→ 刷新职位 / 打招呼。
 * 登录态由用户先在浏览器登录 Boss 后导出 storageState 传入。
 */
@Injectable()
export class BossPlaywrightClient {
  private readonly logger = new Logger('BossPlaywrightClient');

  constructor(
    private readonly config: ConfigService,
    private readonly browserRuntime: PlaywrightBrowserRuntimeService,
  ) {}

  async checkLogin(storageStatePath?: string): Promise<BossLoginCheckResult> {
    const { browser, context } = await this.launch(storageStatePath);
    try {
      const page = await context.newPage();
      await page.goto(BOSS_HOME_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page
        .waitForLoadState('networkidle', { timeout: 8000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200).catch(() => undefined);
      const url = page.url();
      const title = await page.title().catch(() => '');
      // 未登录会跳转登录页（login.zhipin.com 或 /web/user/?ka=header-login）
      const notLoggedIn =
        url.includes('login') ||
        url.includes('passport') ||
        (await page
          .locator('input[placeholder*="手机号"], input[placeholder*="手机"]')
          .count()) > 0;
      return {
        ok: !notLoggedIn,
        status: notLoggedIn ? 'not_logged_in' : 'logged_in',
        url,
        title: title.slice(0, 60),
      };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  /** 刷新职位（招聘端职位管理页下拉刷新，保持职位活跃） */
  async refreshPositions(
    storageStatePath: string,
    limit = 3,
  ): Promise<{
    refreshed: number;
    checkedAt: string;
  }> {
    const { browser, context } = await this.launch(storageStatePath);
    try {
      const page = await context.newPage();
      await page.goto(BOSS_JOB_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000).catch(() => undefined);
      // 定位"刷新"按钮（职位管理常见操作），点 limit 次
      let refreshed = 0;
      for (let i = 0; i < limit; i += 1) {
        const refreshBtn = page
          .locator('text=刷新')
          .first()
          .or(
            page.locator('[class*="refresh"], button:has-text("刷新")').first(),
          );
        const visible = await refreshBtn.isVisible().catch(() => false);
        if (!visible) break;
        await refreshBtn.click({ timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(1500).catch(() => undefined);
        refreshed += 1;
      }
      return { refreshed, checkedAt: new Date().toISOString() };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  /** 向候选人打招呼（聊天页搜索候选人 → 发送默认问候语） */
  async sendHello(
    storageStatePath: string,
    candidateName: string,
    message = '您好，看到您的简历很匹配我们正在招聘的岗位，方便聊聊吗？',
  ): Promise<{ ok: boolean; candidate: string; messageSent: boolean }> {
    const { browser, context } = await this.launch(storageStatePath);
    try {
      const page = await context.newPage();
      await page.goto(BOSS_CHAT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000).catch(() => undefined);
      // 搜索候选人
      const searchInput = page
        .locator('input[placeholder*="搜索"], input[type="search"]')
        .first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill(candidateName);
        await searchInput.press('Enter');
        await page.waitForTimeout(1500).catch(() => undefined);
      }
      // 点击候选人会话
      const candidateRow = page.locator(`text=${candidateName}`).first();
      if (!(await candidateRow.isVisible().catch(() => false))) {
        return { ok: false, candidate: candidateName, messageSent: false };
      }
      await candidateRow.click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(1000).catch(() => undefined);
      // 输入并发送
      const editor = page.locator('textarea, [contenteditable="true"]').first();
      if (!(await editor.isVisible().catch(() => false))) {
        return { ok: false, candidate: candidateName, messageSent: false };
      }
      await editor.fill(message).catch(() => editor.pressSequentially(message));
      await page.waitForTimeout(300).catch(() => undefined);
      await page.keyboard.press('Enter').catch(() => undefined);
      await page.waitForTimeout(800).catch(() => undefined);
      return { ok: true, candidate: candidateName, messageSent: true };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private async launch(storageStatePath?: string): Promise<{
    browser: Browser;
    context: BrowserContext;
  }> {
    const runtime = this.browserRuntime.resolve();
    if (!runtime.exists) {
      throw new ServiceUnavailableException(runtime.message);
    }
    const browser = await chromium.launch({
      headless: true,
      executablePath: runtime.executablePath,
    });
    const context = await browser.newContext({
      ...(storageStatePath && existsSync(storageStatePath)
        ? { storageState: storageStatePath }
        : {}),
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    return { browser, context };
  }
}
