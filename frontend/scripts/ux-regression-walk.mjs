#!/usr/bin/env node
/**
 * AI 获客体验升级 · UX 回归走查脚本（2026-08-20 固化）
 * 用法：
 *   node scripts/ux-regression-walk.mjs --token <kaypal_auth JWT 或 ai_content_session> [--out <dir>]
 * 说明：
 *   - 走查 9 个核心页 + 10 个灰度页，输出 walk.json（页面文本/交互元素/console 错误/加载卡死检测）
 *   - --token：真实账号登录后的会话（ai_content_session 值或 kaypal_auth JWT）
 *   - 依赖 puppeteer-core（项目 node_modules 或 NODE_PATH）
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const token = (() => {
  const i = args.indexOf("--token");
  return i >= 0 ? args[i + 1] : process.env.UX_WALK_TOKEN || "";
})();
const outDir = (() => {
  const i = args.indexOf("--out");
  return resolve(i >= 0 ? args[i + 1] : "./.ux-regression");
})();
const BASE = "http://127.0.0.1:3010";

const PAGES = [
  // 核心获客页
  ["growth", "/growth"],
  ["growth-acquisition", "/growth/acquisition"],
  ["growth-strategies", "/growth/strategies"],
  ["auto-acquisition-create", "/auto-acquisition/create"],
  ["boss-recruit", "/boss-recruit"],
  ["growth-leads", "/growth/leads"],
  ["growth-reports", "/growth/reports"],
  ["growth-account-health", "/growth/account-health"],
  ["growth-workflows", "/growth/workflows"],
  // 灰度遮罩页
  ["wecom-assistant", "/wecom-assistant"],
  ["wecom-crm", "/wecom-crm"],
  ["savings", "/savings"],
  ["video-workshop", "/video-workshop"],
  ["wechat", "/engagement/wechat"],
  ["wechat-chat-history", "/engagement/wechat/chat-history"],
  ["wechat-contacts", "/engagement/wechat/contacts"],
  ["moments-publish", "/engagement/wechat/moments-publish"],
  ["video-studio", "/video-studio"],
];

const LOADING_PHRASES = ["正在加载", "检查中", "加载账号"];

async function main() {
  if (!token) {
    console.error("缺少 --token <会话>：传 ai_content_session 值或 kaypal_auth JWT");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 900 },
  });

  const results = [];
  for (const [name, path] of PAGES) {
    const page = await browser.newPage();
    const consoleErrors = [];
    const navErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("requestfailed", (r) =>
      navErrors.push(`${r.url().slice(0, 120)} :: ${r.failure()?.errorText || ""}`),
    );
    page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + String(e).slice(0, 300)));

    await page.setCookie({
      name: "ai_content_session",
      value: token,
      domain: "127.0.0.1",
      path: "/",
    });
    const started = Date.now();
    let status = "ok";
    try {
      await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 2500));
      if (page.url().includes("/login")) status = "redirect-login";
      await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
      const text = await page.evaluate(() => document.body.innerText);
      // 加载卡死检测：2.5s 后仍在 loading 短语（>8s 才算卡死，这里标记可疑）
      const stuckPhrases = LOADING_PHRASES.filter((p) => text.includes(p));
      results.push({
        name,
        path,
        status,
        ms: Date.now() - started,
        textLen: text.length,
        suspiciousLoading: stuckPhrases,
        text: text.slice(0, 4000),
        consoleErrors,
        navErrors,
      });
    } catch (e) {
      results.push({
        name,
        path,
        status: "error: " + String(e).slice(0, 200),
        ms: Date.now() - started,
        textLen: 0,
        suspiciousLoading: [],
        text: "",
        consoleErrors,
        navErrors,
      });
    }
    await page.close();
  }
  await browser.close();

  writeFileSync(`${outDir}/walk.json`, JSON.stringify(results, null, 2));
  console.log("DONE pages=" + results.length);
  for (const r of results) {
    console.log(
      `${r.name.padEnd(26)} ${r.status.padEnd(24)} textLen=${r.textLen} ms=${r.ms} susLoad=${r.suspiciousLoading.join(",") || "-"} consErr=${r.consoleErrors.length}`,
    );
  }
  const bad = results.filter((r) => r.status !== "ok");
  if (bad.length) {
    console.error(`\n⚠️ ${bad.length} 页异常：${bad.map((r) => r.name).join(", ")}`);
    process.exit(2);
  }
  console.log("\n✅ 全部页面正常");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
