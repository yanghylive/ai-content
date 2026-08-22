import { createRequire } from "node:module";
const require = createRequire("/Users/yanghy/Documents/New project/ai-content/backend/package.json");
const { chromium } = require("playwright");

const BASE = "http://localhost:3010";
const TOKEN = process.env.TEST_SESSION_TOKEN;
if (!TOKEN) { console.error("缺少 TEST_SESSION_TOKEN 环境变量（会话 token 不再硬编码入库）"); process.exit(1); }

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: "ai_content_session", value: TOKEN, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const log = (m) => console.log("  " + m);

  page.on("response", (r) => {
    if (r.url().includes("/api/growth/") || r.url().includes("/api/auto-upload/")) {
      console.log("  [api]", r.status(), r.url().split("3010")[1]);
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 150));
  });

  // 打开获客创建页
  log("打开获客创建页...");
  await page.goto(`${BASE}/auto-acquisition/create`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(4000);
  log("URL: " + page.url().split("3010")[1]);

  // 看页面是否加载出账号
  const hasAccount = await page.locator("text=执行账号").first().isVisible().catch(() => false);
  log("执行账号区可见: " + hasAccount);
  const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  log("页面文本: " + pageText.replace(/\n/g, " | ").slice(0, 300));

  await browser.close();
}
run().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
