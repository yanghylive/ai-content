// 只读诊断：headful 模式打开同一个详情页，对比 headless 是否被风控拦截。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = `${process.env.HOME}/Library/Application Support/ai-content-desktop/data/browser-profiles/kuaishou-2`;
const TARGET_URL = 'https://www.kuaishou.com/short-video/5227271991363579431';

// headless=false：弹真实窗口（非无头）
const browser = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const page = browser.pages()[0] ?? (await browser.newPage());

console.log('=== headful 打开详情页 ===');
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
console.log('URL:', page.url());
console.log('Title:', await page.title().catch(() => '<读取失败>'));

const text = await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 400));
console.log('\n=== body 前 400 字 ===');
console.log(text);

const commentCount = await page.evaluate(
  () => document.querySelectorAll('.comment-item').length,
);
console.log('\n=== .comment-item 数量 ===', commentCount);

await page.screenshot({ path: join(__dirname, '..', '.kuaishou-comments-headful.png'), fullPage: false });
console.log('\n截图已存: .kuaishou-comments-headful.png');

await browser.close();
console.log('\n已关 browser');