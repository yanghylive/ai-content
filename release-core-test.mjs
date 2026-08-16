#!/usr/bin/env node
/**
 * 桌面端发版核心功能测试（v1.1.79）
 * 覆盖：登录态、消息页入口、AI客服返回、获客创建、CRM/内容等核心页面
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/yanghy/Documents/New project/ai-content/backend/package.json");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:3010";
const TOKEN = "szW_zp-YgFmiiQGC1XcTfo-RDofDI0DHy10Y2VHdtfY";

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

  // 1. 登录态（不跳登录）
  await page.goto(`${BASE}/message.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3500);
  check("登录态：message 页不跳登录", !page.url().includes("/login"), page.url().split("3010")[1]);

  // 2. 消息页入口卡片
  const aiCard = await page.evaluate(() => document.body.innerText.includes("AI 客服"));
  check("消息页：AI 客服入口可见", aiCard);
  const wecomCard = await page.evaluate(() => document.body.innerText.includes("企微助手"));
  check("消息页：企微助手入口可见（8 格修复）", wecomCard);

  // 3. AI 客服页（返回按钮 + 页面加载）
  await page.goto(`${BASE}/engagement.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3500);
  const backBtn = await page.locator('button:has-text("返回")').first().isVisible().catch(() => false);
  check("AI 客服页：返回按钮存在", backBtn);
  const pageTitle = await page.locator("text=AI 客服").first().isVisible().catch(() => false);
  check("AI 客服页：标题渲染", pageTitle);

  // 4. 获客创建页（表单可加载）
  await page.goto(`${BASE}/auto-acquisition/create.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3500);
  const acct = await page.locator("text=执行账号").first().isVisible().catch(() => false);
  check("获客创建页：执行账号区可见", acct);

  // 5. 评论获客页（BigInt 修复验证）
  await page.goto(`${BASE}/engagement/comment-acquisition.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3500);
  const caLoaded = !(await page.locator("text=服务器内部错误").first().isVisible().catch(() => false));
  check("评论获客页：无 500 错误", caLoaded);

  // 6. CRM / 内容 / 任务核心页
  for (const [name, route] of [["CRM", "/crm.html"], ["内容", "/content.html"], ["任务", "/tasks.html"], ["获客中心", "/growth.html"]]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2500);
    const ok = !page.url().includes("/login") && !(await page.locator("text=服务器内部错误").first().isVisible().catch(() => false));
    check(`${name}页：正常加载`, ok, page.url().split("3010")[1]);
  }

  // 7. 版本号显示
  await page.goto(`${BASE}/release-notes.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2500);
  const verText = await page.evaluate(() => document.body.innerText.match(/v1\.1\.79/)?.[0] || "");
  check("更新说明页：显示 v1.1.79", verText === "v1.1.79", verText || "未找到");

  await browser.close();
  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
