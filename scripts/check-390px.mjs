// 390px 手机端视口回归检查（主文档检查清单项）
// 用法：node check-390px.mjs <页面路由...>（默认核心页）
import { chromium } from 'playwright';

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['today', 'content', 'video-studio', 'account-health-v2', 'seedance-video', 'workbench', 'platforms', 'calendar', 'distribution', 'knowledge'];

const BASE = 'http://127.0.0.1:3900';
const VIEWPORT = { width: 390, height: 844 };

const browser = await chromium.launch();
const results = [];
for (const page of PAGES) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/${page}.html`, { waitUntil: 'networkidle', timeout: 20000 });
    await pg.waitForTimeout(1500);
    const metrics = await pg.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const scrollW = document.documentElement.scrollWidth;
      const offenders = [];
      if (scrollW > vw + 2) {
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.right > vw + 2 && st.position !== 'fixed' && st.position !== 'absolute' && r.width > 0) {
            const cls = String(el.className || '').slice(0, 50);
            const tag = el.tagName.toLowerCase();
            offenders.push({ tag, cls: cls || '(no-class)', right: Math.round(r.right), width: Math.round(r.width) });
          }
        });
      }
      return {
        vw,
        scrollW,
        overflowX: scrollW > vw + 2,
        offenders: offenders.slice(0, 6),
      };
    });
    const status = metrics.overflowX ? '❌ 横向溢出' : '✅ 正常';
    results.push({ page, status, ...metrics });
    if (metrics.overflowX) {
      await pg.screenshot({ path: `/tmp/390px-${page}.png`, fullPage: false });
    }
  } catch (e) {
    results.push({ page, status: `⚠️ 加载失败: ${e.message.slice(0, 60)}` });
  }
  await ctx.close();
}
await browser.close();

for (const r of results) {
  if (r.status.includes('❌') || r.status.includes('⚠️')) {
    console.log(`\n${r.page}: ${r.status}`);
    if (r.offenders) r.offenders.forEach((o) => console.log(`  ${o.tag}.${o.cls} → right=${o.right}px width=${o.width}px`));
  } else {
    console.log(`${r.page}: ${r.status}`);
  }
}
const bad = results.filter((r) => r.status.includes('❌')).length;
console.log(`\n=== 结果：${results.length - bad}/${results.length} 正常，${bad} 个溢出 ===`);
