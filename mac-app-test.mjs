#!/usr/bin/env node
/**
 * Mac 包（.app）本机完整用户侧功能测试（版本号动态读取 desktop/package.json）
 * 针对 .app 内置 frontend（3010）+ 内置 backend（3011）真实产物
 */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/Users/yanghy/Documents/New project/ai-content/backend/package.json");
const { chromium } = require("playwright");

// BASE 可用 MAC_TEST_BASE 覆盖（本机 3010 常被外部注入 API_BASE=3012 污染，
// 验收时用干净 3015：MAC_TEST_BASE=http://127.0.0.1:3015）
const BASE = process.env.MAC_TEST_BASE || "http://127.0.0.1:3010";
const TOKEN = fs.readFileSync("/tmp/electron-test-token.txt", "utf8").trim();
// P5 复查（2026-08-23）：版本号动态读取，不再硬编码旧版 v1.1.86
const EXPECTED_VERSION = JSON.parse(
  fs.readFileSync("/Users/yanghy/Documents/New project/ai-content/desktop/package.json", "utf8"),
).version;

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: "ai_content_session", value: TOKEN, domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  const log = (m) => console.log(m);
  let pass = 0, fail = 0;
  const check = (name, ok, detail = "") => {
    log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
    ok ? pass++ : fail++;
  };

  // 1. 登录态
  await page.goto(`${BASE}/message.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3500);
  check("登录态：message 页不跳登录", !page.url().includes("/login"), page.url().split("3010")[1]);

  // 2. 消息页入口
  check("消息页：客服机器人入口", await page.evaluate(() => document.body.innerText.includes("客服机器人")));
  check("消息页：企微助手入口", await page.evaluate(() => document.body.innerText.includes("企微助手")));

  // 3. AI 客服页（返回按钮 + 标题；入口在消息页，页面标题为「互动」区）
  await page.goto(`${BASE}/message.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  check("消息页：客服机器人入口可点", await page.locator('text=客服机器人').first().isVisible().catch(() => false));
  await page.goto(`${BASE}/engagement.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  check("互动页：不跳登录无 500", !page.url().includes("/login") && !(await page.evaluate(() => document.body.innerText.includes("服务器内部错误"))));

  // 4. 获客创建页
  await page.goto(`${BASE}/auto-acquisition/create.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  check("获客创建页：执行账号区", await page.evaluate(() => document.body.innerText.includes("执行账号")));

  // 5. 评论获客页（BigInt）
  await page.goto(`${BASE}/engagement/comment-acquisition.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  check("评论获客页：无 500", !(await page.evaluate(() => document.body.innerText.includes("服务器内部错误"))));

  // 6. 核心模块页
  for (const [name, route] of [["CRM", "/crm.html"], ["内容", "/content.html"], ["任务", "/tasks.html"], ["获客中心", "/growth.html"], ["情报", "/intelligence.html"], ["工作台", "/workbench.html"]]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2200);
    const ok = !page.url().includes("/login") && !(await page.evaluate(() => document.body.innerText.includes("服务器内部错误")));
    check(`${name}页`, ok, page.url().split("3010")[1]);
  }

  // 6b. 本次发版核心：发布中心 / 发布任务列表 / 账号矩阵
  for (const [name, route] of [["发布中心", "/distribution.html"], ["发布任务列表", "/distribution/tasks.html"], ["账号矩阵", "/accounts-matrix.html"]]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2200);
    const ok = !page.url().includes("/login") && !(await page.evaluate(() => document.body.innerText.includes("服务器内部错误")));
    check(`${name}页`, ok, page.url().split("3010")[1]);
  }

  // 7. 版本号（动态：EXPECTED_VERSION）
  await page.goto(`${BASE}/release-notes.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2200);
  const verText = await page.evaluate(() => document.body.innerText.match(/v\d+\.\d+\.\d+/)?.[0] || "");
  check(`更新说明 v${EXPECTED_VERSION}`, verText === `v${EXPECTED_VERSION}`, verText || "未找到");

  // 8. 登录页页脚（版本号已移除，改为动态读 electron 版本，只验证页脚文案；
  //    需未登录 context 访问，登录态访问会被 next 重定向到工作台）
  {
    const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await anonPage.waitForTimeout(2200);
    check("登录页页脚文案", await anonPage.evaluate(() => document.body.innerText.includes("数据自有部署")));
    await anonCtx.close();
  }

  await browser.close();
  console.log(`\n=== Mac 包测试结果: ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
