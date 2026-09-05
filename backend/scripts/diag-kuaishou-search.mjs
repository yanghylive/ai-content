// 只读诊断：用 kuaishou-2 真实 profile 打开快手，dump 搜索框 DOM 结构，
// 定位 behaviorSearch 为什么「搜索框未出现」或「降级推荐流」。
// 不写库、不回复、不发任何请求副作用（只 goto + 读 DOM + 截图）。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = `${process.env.HOME}/Library/Application Support/ai-content-desktop/data/browser-profiles/kuaishou-2`;

const browser = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});

const page = browser.pages()[0] ?? (await browser.newPage());

console.log('=== 1. 打开快手首页 ===');
await page.goto('https://www.kuaishou.com/', {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
await page.waitForTimeout(4000);
console.log('URL:', page.url());
console.log('Title:', await page.title().catch(() => '<读取失败>'));

console.log('\n=== 2. 页面文本前 800 字（判断登录墙/验证码/推荐流）===');
const text = await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 800));
console.log(text);

console.log('\n=== 3. 搜索框候选 DOM（input 元素全列）===');
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input')).slice(0, 15).map((el, i) => ({
    i,
    type: el.type,
    placeholder: el.placeholder || '',
    ariaLabel: el.getAttribute('aria-label') || '',
    cls: (el.className || '').toString().slice(0, 60),
    visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
  }));
});
console.log(JSON.stringify(inputs, null, 2));

console.log('\n=== 4. 是否有搜索图标/按钮（点它才展开搜索框）===');
const searchTriggers = await page.evaluate(() => {
  const sel = '[class*="search"], [class*="Search"], svg[class*="search"], .search-icon, [aria-label*="搜索"]';
  return Array.from(document.querySelectorAll(sel)).slice(0, 10).map((el) => ({
    tag: el.tagName,
    cls: (el.className || '').toString().slice(0, 60),
    aria: el.getAttribute('aria-label') || '',
  }));
});
console.log(JSON.stringify(searchTriggers, null, 2));

console.log('\n=== 5. 是否有 video（推荐流已加载）===');
const videoCount = await page.evaluate(() => document.querySelectorAll('video').length);
console.log('video 数量:', videoCount);

await page.screenshot({ path: join(__dirname, '..', '.kuaishou-home.png'), fullPage: false });
console.log('\n截图已存: .kuaishou-home.png');

await browser.close();
