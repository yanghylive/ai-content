#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage11-smoke.mjs — 阶段 7 续（第十轮）：extract 定向提取真机冒烟
 *
 * 验证命题：面板模式 extract 对齐旧无头语义——selector 定向 textContent →
 * trim → 截 2000；text= 精确优先于包含；未命中 found:false。
 * 本脚本只验证**提取表达式**在真实页面的行为（executor 的桥接逻辑由 backend
 * jest 覆盖）；表达式是 backend buildTextExtractExpression 的同构拷贝（欠账：
 * 双端两份，改表达式语义必须两侧同步）。
 *
 * 6 项检查：
 *   S1 fixture 加载
 *   S2 CSS 提取 #title → 'browser-panel-p0'
 *   S3 text= 精确匹配（+1 按钮，exact 优先于 partial）
 *   S4 text= 包含匹配（'browser' → h1，textContent 含但不等于）
 *   S5 未命中 → found:false
 *   S6 长文本 2000 截断（页面内临时造 3000 字符节点，fixture 不留残渣）
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage11-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage11-evidence-<timestamp>.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, WebContentsView } = require('electron');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const fixturePath = path.join(desktopRoot, 'test-fixtures', 'browser-panel.html');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage11-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    fixture: path.relative(repoRoot, fixturePath),
    scenario: 'stage7 续：extract 定向提取表达式真机行为（text= 精确>包含/2000 截断/未命中）',
  },
  checks,
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass && detail) console.log(`       detail: ${JSON.stringify(detail).slice(0, 400)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const html = fs.readFileSync(fixturePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/browser-panel.html` });
    });
  });
}

// ── backend buildTextExtractExpression 的同构拷贝（改语义必须两侧同步）──
function buildTextExtractExpression(selector) {
  const selJson = JSON.stringify(String(selector ?? '').trim());
  return (
    '(function extractText() {' +
    '  function visible(el) {' +
    '    if (!el || typeof el.getClientRects !== "function" || el.getClientRects().length === 0) return false;' +
    '    var style = window.getComputedStyle(el);' +
    '    return !!style && style.visibility !== "hidden" && style.display !== "none";' +
    '  }' +
    '  function pick(candidates) {' +
    '    for (var i = 0; i < candidates.length; i++) {' +
    '      var el = candidates[i];' +
    '      if (el && visible(el)) return el;' +
    '    }' +
    '    return null;' +
    '  }' +
    '  var sel = ' + selJson + ';' +
    '  var hit = null;' +
    '  if (sel.indexOf("text=") === 0) {' +
    '    var text = sel.slice(5).trim();' +
    '    var nodes = Array.prototype.slice.call(document.querySelectorAll(' +
    '      "a,button,input,select,textarea,label,summary,[role=button],[onclick],h1,h2,h3,h4,span,div,p,li"' +
    '    ));' +
    '    var exact = nodes.filter(function (el) { return (el.textContent || "").trim() === text; });' +
    '    var partial = nodes.filter(function (el) {' +
    '      if (exact.indexOf(el) !== -1) return false;' +
    '      var t = (el.textContent || "").trim();' +
    '      return t.length > 0 && t.indexOf(text) !== -1;' +
    '    });' +
    '    hit = pick(exact) || pick(partial);' +
    '  } else {' +
    '    try { hit = pick([document.querySelector(sel)]); } catch (e) { hit = null; }' +
    '  }' +
    '  if (!hit) return { found: false };' +
    '  return { found: true, text: ((hit.textContent || "") + "").trim().slice(0, 2000) };' +
    '})()'
  );
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { server, baseUrl } = await startFixtureServer();
  await app.whenReady();

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:kaypal-browser-user-s11',
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });

  // ---- S1: fixture 加载 ----
  const loaded = new Promise((resolve, reject) => {
    view.webContents.once('did-finish-load', resolve);
    view.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`${code} ${desc}`)));
    setTimeout(() => reject(new Error('load timeout 10s')), 10_000).unref?.();
  });
  view.webContents.loadURL(baseUrl);
  try {
    await loaded;
    record('S1 fixture 加载（真实 WebContentsView）', true, { url: view.webContents.getURL() });
  } catch (error) {
    record('S1 fixture 加载（真实 WebContentsView）', false, { error: error.message });
    throw error;
  }
  await sleep(300);

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`CDP 超时 ${ms}ms: ${label}`)), ms).unref?.(),
      ),
    ]);
  const dbg = (method, params) =>
    withTimeout(view.webContents.debugger.sendCommand(method, params), 8000, method);
  view.webContents.debugger.attach('1.3');
  const extract = async (selector) => {
    const out = await dbg('Runtime.evaluate', {
      expression: buildTextExtractExpression(selector),
      returnByValue: true,
    });
    return out?.result?.value;
  };

  // ---- S2: CSS 提取 #title ----
  try {
    const v = await extract('#title');
    record('S2 CSS 提取 #title → 页面标题文本', v && v.found === true && v.text === 'browser-panel-p0', v);
  } catch (error) {
    record('S2 CSS 提取 #title → 页面标题文本', false, { error: error.message });
  }

  // ---- S3: text= 精确匹配（"+1" 按钮）----
  try {
    const v = await extract('text=+1');
    record('S3 text= 精确匹配 → +1 按钮文本', v && v.found === true && v.text === '+1', v);
  } catch (error) {
    record('S3 text= 精确匹配 → +1 按钮文本', false, { error: error.message });
  }

  // ---- S4: text= 包含匹配（'browser' 不精确等于任何节点 → partial 命中 h1）----
  try {
    const v = await extract('text=browser');
    record(
      'S4 text= 包含匹配 → h1（textContent 含 browser 但不等于）',
      v && v.found === true && v.text === 'browser-panel-p0',
      v,
    );
  } catch (error) {
    record('S4 text= 包含匹配 → h1（textContent 含 browser 但不等于）', false, { error: error.message });
  }

  // ---- S5: 未命中 → found:false ----
  try {
    const v = await extract('#not-exist-s11');
    record('S5 未命中 → found:false（executor 据此显式失败）', !!v && v.found === false, v);
  } catch (error) {
    record('S5 未命中 → found:false（executor 据此显式失败）', false, { error: error.message });
  }

  // ---- S6: 长文本 2000 截断（页面内临时造 3000 字符节点，收尾清理）----
  try {
    await dbg('Runtime.evaluate', {
      expression: `(function () {
        var d = document.createElement('div');
        d.id = 's11-long';
        d.textContent = 'x'.repeat(3000);
        document.body.appendChild(d);
        return true;
      })()`,
      returnByValue: true,
    });
    const v = await extract('#s11-long');
    const cleanup = await dbg('Runtime.evaluate', {
      expression: `(function () {
        var d = document.getElementById('s11-long');
        if (d) d.remove();
        return !document.getElementById('s11-long');
      })()`,
      returnByValue: true,
    });
    record(
      'S6 长文本截断：3000 字符 → 提取恰好 2000（页面内 slice），fixture 无残渣',
      v && v.found === true && v.text.length === 2000 && cleanup?.result?.value === true,
      { length: v && v.text ? v.text.length : 0, cleaned: cleanup?.result?.value },
    );
  } catch (error) {
    record('S6 长文本截断：3000 字符 → 提取恰好 2000（页面内 slice），fixture 无残渣', false, { error: error.message });
  }

  // ---- 收尾 ----
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\nSTAGE11 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
  console.log(`evidence: ${evidencePath}`);
  server.close();
  app.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('STAGE11 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
