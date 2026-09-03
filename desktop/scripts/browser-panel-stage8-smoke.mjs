#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage8-smoke.mjs — 阶段 7 click 动作真机冒烟
 *
 * 验证命题（工作流文档 §4 阶段 7）：
 *   一次批准 = 一次逻辑点击。backend executor 的 click 全链路在 broker 层的
 *   真实表现：一张确认单覆盖 mousePressed + mouseReleased 两次 CDP 调用，
 *   released 走配对通道（同面板、坐标 ≤4px、10s 内、一次性）放行，
 *   真实页面计数器恰好 +1。
 *
 * 6 项检查：
 *   S1 fixture 加载（真实 WebContentsView）
 *   S2 执行器同构探测：selector → 真实坐标（Runtime.evaluate readonly）
 *   S3 单单一次点击：requestAction→approve→pressed(带单)→released(配对)→计数 +1
 *   S4 负向：released 坐标偏移 >4px 拒绝，计数不变（且单已烧，回正坐标也放不了行）
 *   S5 负向：无批准单直接 released → 拒绝（fail-closed）
 *   S6 负向：配对一次性——同单第二次 released 拒绝，计数只 +1
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage8-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage8-evidence-<timestamp>.json
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
const evidencePath = path.join(evidenceDir, `stage8-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    fixture: path.relative(repoRoot, fixturePath),
    scenario: 'stage7 click：一次批准 = 一次逻辑点击（单单 + 配对通道）',
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
    show: true, // 隐藏窗口无合成帧 → 输入派发会挂起
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const views = new Map();
  const broker = new BrowserPanelBroker({
    webContentsResolver: (panelId) => views.get(panelId) || null,
  });
  const { panelId, capabilityToken } = broker.createPanel({
    panelId: 'panel-s8',
    sessionId: 'sess-s8-001',
    ownerId: 'user-s8',
    tenantId: 'tenant-s8',
    platform: 'general-web',
  });

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:kaypal-browser-user-s8',
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

  // ---- S2: 执行器同构探测（selector → 坐标；readonly Runtime.evaluate）----
  // 与 backend buildSelectorProbeExpression 同语义：主 frame、可见元素、外接矩形中心。
  let clickPoint = null;
  try {
    const out = await dbg('Runtime.evaluate', {
      expression: `(() => {
        function visible(el) {
          if (!el || typeof el.getClientRects !== "function" || el.getClientRects().length === 0) return false;
          var style = window.getComputedStyle(el);
          return !!style && style.visibility !== "hidden" && style.display !== "none";
        }
        var el = document.querySelector('#inc');
        if (!el || !visible(el)) return { found: false };
        var r = el.getBoundingClientRect();
        return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`,
      returnByValue: true,
    });
    clickPoint = out.result.value;
    record(
      'S2 执行器同构探测：#inc → 真实坐标',
      clickPoint && clickPoint.found === true,
      clickPoint,
    );
  } catch (error) {
    record('S2 执行器同构探测：#inc → 真实坐标', false, { error: error.message });
    throw error;
  }
  const { x, y } = clickPoint;
  const PRESSED = () => ({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  const RELEASED = (px, py) => ({ type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
  const approveClick = async (label) => {
    const { actionId } = broker.requestAction(
      panelId, capabilityToken, 'Input.dispatchMouseEvent',
      { label, selector: '#inc' },
    );
    broker.approveAction(actionId, capabilityToken, capabilityToken);
    return actionId;
  };

  // ---- S3: 单单一次点击（一次批准覆盖 pressed + released）----
  try {
    const before = await probe();
    const actionId = await approveClick('点击 +1');
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', PRESSED(), {
      approvedActionId: actionId,
    });
    // released 不再签单/审批：走配对通道（同单同坐标）
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', RELEASED(x, y), {
      approvedActionId: actionId,
    });
    const after = await probe();
    record(
      'S3 单单一次点击：pressed(带单)+released(配对) → 计数 +1',
      Number(after.counter) === Number(before.counter) + 1,
      { before: before.counter, after: after.counter, x, y },
    );
  } catch (error) {
    record('S3 单单一次点击：pressed(带单)+released(配对) → 计数 +1', false, { error: error.message });
  }

  // ---- S4: released 坐标偏移 >4px 拒绝 + 烧单 ----
  try {
    const before = await probe();
    const actionId = await approveClick('偏移点击');
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', PRESSED(), {
      approvedActionId: actionId,
    });
    let rejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', RELEASED(x + 10, y), {
        approvedActionId: actionId,
      });
    } catch {
      rejected = true;
    }
    const mid = await probe();
    const noClickOnReject = Number(mid.counter) === Number(before.counter);
    // 烧单语义：坐标改回正确位置也放不了行
    let burnOk = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', RELEASED(x, y), {
        approvedActionId: actionId,
      });
    } catch {
      burnOk = true;
    }
    const after = await probe();
    record(
      'S4 负向：released 偏移 >4px 拒绝且烧单，计数不变',
      rejected && noClickOnReject && burnOk && Number(after.counter) === Number(before.counter),
      { rejected, noClickOnReject, burnOk, before: before.counter, after: after.counter },
    );
  } catch (error) {
    record('S4 负向：released 偏移 >4px 拒绝且烧单，计数不变', false, { error: error.message });
  }

  // ---- S5: 无批准单直接 released → fail-closed 拒绝 ----
  try {
    const before = await probe();
    let rejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', RELEASED(x, y));
    } catch {
      rejected = true;
    }
    const after = await probe();
    record(
      'S5 负向：无批准单直接 released → 拒绝，计数不变',
      rejected && Number(after.counter) === Number(before.counter),
      { rejected, before: before.counter, after: after.counter },
    );
  } catch (error) {
    record('S5 负向：无批准单直接 released → 拒绝，计数不变', false, { error: error.message });
  }

  // ---- S6: 配对一次性——同单第二次 released 拒绝 ----
  try {
    const before = await probe();
    const actionId = await approveClick('一次性验证');
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', PRESSED(), {
      approvedActionId: actionId,
    });
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', RELEASED(x, y), {
      approvedActionId: actionId,
    });
    const mid = await probe();
    let secondRejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchMouseEvent', RELEASED(x, y), {
        approvedActionId: actionId,
      });
    } catch {
      secondRejected = true;
    }
    const after = await probe();
    const plusOneOnly =
      Number(mid.counter) === Number(before.counter) + 1 &&
      Number(after.counter) === Number(before.counter) + 1;
    record(
      'S6 负向：配对一次性——第二次 released 拒绝，计数只 +1',
      secondRejected && plusOneOnly,
      { secondRejected, before: before.counter, mid: mid.counter, after: after.counter },
    );
  } catch (error) {
    record('S6 负向：配对一次性——第二次 released 拒绝，计数只 +1', false, { error: error.message });
  }

  // ---- 收尾 ----
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\nSTAGE8 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
  console.log(`evidence: ${evidencePath}`);
  server.close();
  app.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('STAGE8 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
