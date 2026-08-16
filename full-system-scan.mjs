#!/usr/bin/env node
/**
 * 全路由体检：页面加载 + 主按钮点击，收集所有报错/没反应
 * 环境：3010 静态 out（/api 代理到 3011）+ 有效 session cookie
 */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/Users/yanghy/Documents/New project/ai-content/backend/package.json");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:3010";
const TOKEN = "u4-DdJ0_-KBI4T0Nh9KUN3re2vMVIrzNuDhB3wRajbw";
const ROUTES = fs.readFileSync("/tmp/all-routes.txt", "utf8").split("\n").filter(Boolean);

// 跳过需要外部设备/特殊环境的（本地引擎设备、重交互页）
const SKIP = [/\/local-engine/, /\/war-room/, /\/agent/, /\/video/, /\/voice/];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: "ai_content_session", value: TOKEN, domain: "127.0.0.1", path: "/" }]);

  const report = { ok: [], issues: [] };
  const log = (m) => console.log(m);

  for (const [i, route] of ROUTES.entries()) {
    if (SKIP.some((re) => re.test(route))) continue;
    const page = await ctx.newPage();
    const errors = [];
    const badStatus = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 160));
    });
    page.on("response", (r) => {
      const s = r.status();
      if (s >= 400 && s !== 401 && !r.url().includes("/_next/")) {
        badStatus.push(`${s} ${r.url().split("3010")[1] || r.url()}`);
      }
    });

    let finalUrl = "";
    let clickIssue = "";
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2500);
      finalUrl = page.url().split("3010")[1] || page.url();

      // 跳登录 = 问题
      if (finalUrl.includes("/login")) {
        report.issues.push({ route, kind: "auth-redirect", detail: `跳登录: ${finalUrl}` });
        await page.close();
        log(`[${i + 1}/${ROUTES.length}] ${route} → ❌ 跳登录`);
        continue;
      }

      // 找页面主操作按钮（首屏可见的第一个非导航按钮）尝试点击
      const clickable = page.locator("button:not([aria-label]), [role=button]").first();
      if (await clickable.isVisible().catch(() => false)) {
        const before = page.url();
        await clickable.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
        // 点击后如果出现新 console error 或 404，记录
        const freshErrors = errors.filter((e) => !e.includes("favicon"));
        if (freshErrors.length) clickIssue = freshErrors[0];
      }

      const uniqueErrors = [...new Set(errors)].slice(0, 3);
      const uniqueBad = [...new Set(badStatus)].slice(0, 3);
      if (uniqueErrors.length || uniqueBad.length) {
        report.issues.push({
          route, kind: "console-errors",
          errors: uniqueErrors, badStatus: uniqueBad,
        });
        log(`[${i + 1}/${ROUTES.length}] ${route} → ⚠️ ${uniqueErrors[0]?.slice(0, 80) || uniqueBad[0]}`);
      } else {
        report.ok.push(route);
        log(`[${i + 1}/${ROUTES.length}] ${route} → ✅`);
      }
    } catch (e) {
      report.issues.push({ route, kind: "crash", detail: e.message.slice(0, 150) });
      log(`[${i + 1}/${ROUTES.length}] ${route} → ❌ ${e.message.slice(0, 80)}`);
    }
    await page.close();
  }

  await browser.close();
  console.log("\n========== 扫描总结 ==========");
  console.log(`扫描路由: ${report.ok.length + report.issues.length}`);
  console.log(`正常: ${report.ok.length}`);
  console.log(`有问题: ${report.issues.length}`);
  fs.writeFileSync("/tmp/full-scan-report.json", JSON.stringify(report, null, 2));
  console.log("报告: /tmp/full-scan-report.json");
}
run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
