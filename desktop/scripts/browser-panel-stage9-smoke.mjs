#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage9-smoke.mjs — 阶段 7 续：type（输入）动作真机冒烟
 *
 * 验证命题：一次批准 = 一次逻辑输入。确认单签 Input.insertText（loop 闸门
 * 指纹），执行 = 聚焦 mousePressed（消耗单，method 组匹配）+ Input.insertText
 * （配对通道，免坐标）。真实页面输入框值变化 + input 事件链完整。
 *
 * 6 项检查：
 *   S1 fixture 加载
 *   S2 同构探测：#field → 真实坐标
 *   S3 单单一次输入：pressed(带单聚焦)+insertText(配对) → 输入框值正确且 input 事件触发
 *   S4 负向：无批准单直接 insertText → 拒绝（fail-closed），值不变
 *   S5 负向：配对一次性——同单第二次 insertText 拒绝，值只追加一次
 *   S6 负向：insertText 型单不能被 mouseReleased 消耗（method 组匹配收紧）
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage9-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage9-evidence-<timestamp>.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, WebContentsView } = require('electron');
const { BrowserPanelBroker } = require('../browser-panel-broker.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const fixturePath = path.join(desktopRoot, 'test-fixtures', 'browser-panel.html');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage9-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    fixture: path.relative(repoRoot, fixturePath),
    scenario: 'stage7 续：type 输入——一次批准 = 聚焦 + insertText（单单 + 配对）',
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

  const views = new Map();
  const broker = new BrowserPanelBroker({
    webContentsResolver: (panelId) => views.get(panelId) || null,
  });
  const { panelId, capabilityToken } = broker.createPanel({
    panelId: 'panel-s9',
    sessionId: 'sess-s9-001',
    ownerId: 'user-s9',
    tenantId: 'tenant-s9',
    platform: 'general-web',
  });

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:kaypal-browser-user-s9',
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  views.set(panelId, view.webContents);

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
  const probe = () => view.webContents.executeJavaScript('window.__panelProbe()');

  // ---- S2: 同构探测（#field → 坐标）----
  let focusPoint = null;
  try {
    const out = await dbg('Runtime.evaluate', {
      expression: `(() => {
        function visible(el) {
          if (!el || typeof el.getClientRects !== "function" || el.getClientRects().length === 0) return false;
          var style = window.getComputedStyle(el);
          return !!style && style.visibility !== "hidden" && style.display !== "none";
        }
        var el = document.querySelector('#field');
        if (!el || !visible(el)) return { found: false };
        var r = el.getBoundingClientRect();
        return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`,
      returnByValue: true,
    });
    focusPoint = out.result.value;
    record('S2 同构探测：#field → 真实坐标', focusPoint && focusPoint.found === true, focusPoint);
  } catch (error) {
    record('S2 同构探测：#field → 真实坐标', false, { error: error.message });
    throw error;
  }
  const { x, y } = focusPoint;
  const TYPED = 'agent-typed-s9';
  const PRESSED = () => ({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  const approveType = async (label) => {
    // 与 executor typeViaPanel 一致：确认单签 Input.insertText（loop 闸门指纹）
    const { actionId } = broker.requestAction(
      panelId, capabilityToken, 'Input.insertText',
      { label, selector: '#field', text: TYPED },
    );
    broker.approveAction(actionId, capabilityToken, capabilityToken);
    return actionId;
  };

  // ---- S3: 单单一次输入（聚焦消耗单 + insertText 配对）----
  try {
    const before = await probe();
    const actionId = await approveType('输入文本');
    // 第一步：聚焦（消耗 insertText 型确认单——method 组匹配）
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', PRESSED(), {
      approvedActionId: actionId,
    });
    // 第二步：插入文本（配对通道，不再签单）
    await broker.sendCDP(panelId, capabilityToken, 'Input.insertText', { text: TYPED }, {
      approvedActionId: actionId,
    });
    const after = await probe();
    // input 事件链实证：#userops 由页面的 input 监听器更新（CDP insertText
    // 走真实输入管线，React/Vue onChange 类监听同样收得到）
    const userops = await dbg('Runtime.evaluate', {
      expression: `document.getElementById('userops').textContent`,
      returnByValue: true,
    });
    const useropsText = userops?.result?.value;
    record(
      'S3 单单一次输入：聚焦(带单)+insertText(配对) → 值正确且 input 事件触发',
      after.field === TYPED && useropsText === `input:${TYPED}` && before.field !== TYPED,
      { before: before.field, after: after.field, userops: useropsText },
    );
  } catch (error) {
    record('S3 单单一次输入：聚焦(带单)+insertText(配对) → 值正确且 input 事件触发', false, { error: error.message });
  }

  // ---- S4: 无批准单直接 insertText → 拒 ----
  try {
    const before = await probe();
    let rejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.insertText', { text: 'no-ticket' });
    } catch {
      rejected = true;
    }
    const after = await probe();
    record(
      'S4 负向：无批准单直接 insertText → 拒绝，值不变',
      rejected && after.field === before.field,
      { rejected, before: before.field, after: after.field },
    );
  } catch (error) {
    record('S4 负向：无批准单直接 insertText → 拒绝，值不变', false, { error: error.message });
  }

  // ---- S5: 配对一次性——同单第二次 insertText 拒，值只追加一次 ----
  try {
    const before = await probe();
    const actionId = await approveType('一次性验证');
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', PRESSED(), {
      approvedActionId: actionId,
    });
    await broker.sendCDP(panelId, capabilityToken, 'Input.insertText', { text: TYPED }, {
      approvedActionId: actionId,
    });
    const mid = await probe();
    let secondRejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.insertText', { text: TYPED }, {
        approvedActionId: actionId,
      });
    } catch {
      secondRejected = true;
    }
    const after = await probe();
    // 光标语义交底：真实点击聚焦会把光标放到点击位置，insertText 在光标处
    // 插入（拟真输入）。本项只断言"配对一次性"：第二次被拒后值与 mid 一致，
    // 且全流程只追加了一次 TYPED 的长度（before 14 → after 28）。
    const onceOnly =
      before.field.length + TYPED.length === after.field.length;
    record(
      'S5 负向：配对一次性——第二次 insertText 拒绝，值只追加一次',
      secondRejected && after.field === mid.field && onceOnly,
      { secondRejected, before: before.field, mid: mid.field, after: after.field },
    );
  } catch (error) {
    record('S5 负向：配对一次性——第二次 insertText 拒绝，值只追加一次', false, { error: error.message });
  }

  // ---- S6: insertText 型单不能被 mouseReleased 消耗（组匹配收紧）----
  try {
    const before = await probe();
    const actionId = await approveType('组匹配收紧验证');
    let rejected = false;
    try {
      await broker.sendCDP(
        panelId, capabilityToken, 'Input.dispatchMouseEvent',
        { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
        { approvedActionId: actionId },
      );
    } catch {
      rejected = true;
    }
    const after = await probe();
    record(
      'S6 负向：insertText 型单被 mouseReleased 消耗 → 拒绝（只许聚焦半步消耗）',
      rejected && after.field === before.field,
      { rejected },
    );
  } catch (error) {
    record('S6 负向：insertText 型单被 mouseReleased 消耗 → 拒绝（只许聚焦半步消耗）', false, { error: error.message });
  }

  // ---- 收尾 ----
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\nSTAGE9 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
  console.log(`evidence: ${evidencePath}`);
  server.close();
  app.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('STAGE9 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
