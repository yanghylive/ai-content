// 只读诊断：用 kuaishou-2 真实 profile 打开快手「搜索结果里的视频详情页」，
// dump 评论区 DOM 结构，定位 extractKuaishouComments 的 .comment-item 选择器为什么失效。
// 不写库、不回复、不发任何请求副作用（只 goto + 读 DOM + 截图）。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = `${process.env.HOME}/Library/Application Support/ai-content-desktop/data/browser-profiles/kuaishou-2`;

// 目标：上轮 scan 命中的真实视频详情页
const TARGET_URL =
  process.argv[2] || 'https://www.kuaishou.com/short-video/5227271991363579431';

const browser = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});

const page = browser.pages()[0] ?? (await browser.newPage());

console.log('=== 1. 打开视频详情页 ===');
await page.goto(TARGET_URL, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
await page.waitForTimeout(3000);
console.log('URL:', page.url());
console.log('Title:', await page.title().catch(() => '<读取失败>'));

console.log('\n=== 2. 页面文本前 600 字（判断登录墙/验证码/内容页）===');
const text = await page.evaluate(
  () => (document.body?.innerText ?? '').slice(0, 600),
);
console.log(text);

console.log('\n=== 3. .comment-item 是否存在 ===');
const legacy = await page.evaluate(() => {
  return {
    count: document.querySelectorAll('.comment-item').length,
  };
});
console.log('旧选择器 .comment-item 数量:', legacy.count);

console.log('\n=== 4. 评论区候选 DOM（class 含 comment 的元素全列）===');
const commentCandidates = await page.evaluate(() => {
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll('[class*="comment"], [class*="Comment"]')) {
    const cls = (el.className || '').toString();
    const tag = el.tagName.toLowerCase();
    if (seen.has(cls + '|' + tag)) continue;
    seen.add(cls + '|' + tag);
    out.push({
      tag,
      cls: cls.slice(0, 80),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    });
    if (out.length >= 40) break;
  }
  return out;
});
console.log(JSON.stringify(commentCandidates, null, 2));

console.log('\n=== 5. 页面里所有 data-* 含 comment 的节点 ===');
const dataNodes = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const attrs = {};
    for (const a of el.attributes) {
      if (/comment|reply/i.test(a.name) || /comment|reply/i.test(a.value || '')) {
        attrs[a.name] = (a.value || '').slice(0, 60);
      }
    }
    if (Object.keys(attrs).length) {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60), attrs });
      if (out.length >= 20) break;
    }
  }
  return out;
});
console.log(JSON.stringify(dataNodes, null, 2));

console.log('\n=== 6. 页面是否出现「登录/验证码/请稍后」拦截 ===');
const blocked = await page.evaluate(() => {
  const t = (document.body?.innerText ?? '');
  return {
    hasLogin: /登录|扫码|验证码|请完成安全|稍后再试|频繁|风控/.test(t),
  };
});
console.log(JSON.stringify(blocked));

await page.screenshot({ path: join(__dirname, '..', '.kuaishou-comments.png'), fullPage: false });
console.log('\n截图已存: .kuaishou-comments.png');

await browser.close();
