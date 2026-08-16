import { createRequire } from "node:module";
const require = createRequire("/Users/yanghy/Documents/New project/ai-content/backend/package.json");
const { chromium } = require("playwright");

const BASE = "http://localhost:3010";
const TOKEN = "WfVBkA-aPsTlZUKQBgK1UMRm7Pv1-zYnn-w2Qp3-vcI";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: "ai_content_session", value: TOKEN, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const log = (m) => console.log("  " + m);

  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/growth/acquisition") && r.request().method() === "POST") {
      console.log("  [POST]", r.status(), u.split("3010")[1]);
    }
  });

  await page.goto(BASE + "/auto-acquisition/create", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3500);
  log("页面已加载, URL: " + page.url().split("3010")[1]);

  // 填关键词
  const kwInput = page.locator("textarea").first();
  await kwInput.fill("空气净化器测试");
  await page.waitForTimeout(500);
  log("已填关键词");

  // 点创建按钮（用 getByRole 更稳）
  const submitBtn = page.getByRole("button", { name: /创建获客任务/ }).last();
  log("提交按钮存在: " + (await submitBtn.count()));
  await submitBtn.click({ timeout: 10000 }).catch(async () => {
    log("普通点击失败，滚动");
    await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await submitBtn.click({ force: true, timeout: 10000 }).catch((e) => log("force失败: " + e.message.slice(0, 80)));
  });
  await page.waitForTimeout(4000);

  // 结果
  const errText = await page.evaluate(() => {
    const m = document.body.innerText.match(/创建获客任务失败[^\n]*/);
    return m ? m[0] : "";
  });
  log("失败提示: " + (errText || "无"));
  log("跳转后 URL: " + page.url().split("3010")[1]);
  await page.screenshot({ path: "/tmp/acq-result.png" });
  log("截图 /tmp/acq-result.png");

  await browser.close();
}
run().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
