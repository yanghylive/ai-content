#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage10-smoke.mjs — 阶段 7 续（第九轮）：press_key（按键）动作真机冒烟
 *
 * 验证命题：一次批准 = 一次逻辑按键。确认单签 Input.dispatchKeyEvent（loop 闸门
 * 指纹），执行 = keyDown（消耗单，method 严格相等）+ keyUp（配对通道，键位一致）。
 * 真实页面 keydown 事件链 + 可打印字符补 text 的拟真键入。
 *
 * 6 项检查：
 *   S1 fixture 加载
 *   S2 聚焦 #field（readonly evaluate focus，真实按键的前置）
 *   S3 单单一次按键：keyDown(带单)+keyUp(配对) → 页面 keydown 监听收到 Enter
 *   S4 可打印字符拟真键入：keyDown 补 text → 输入框值追加且 input 事件触发
 *   S5 负向：无批准单直接 keyDown → 拒绝（fail-closed）
 *   S6 负向：配对一次性（第二次 keyUp 拒）+ 键位不匹配（keyUp 'Tab' 拒且烧单）
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage10-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage10-evidence-<timestamp>.json
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
const evidencePath = path.join(evidenceDir, `stage10-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    fixture: path.relative(repoRoot, fixturePath),
    scenario: 'stage7 续：press_key 按键——一次批准 = keyDown + keyUp（单单 + 配对）',
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
    panelId: 'panel-s10',
    sessionId: 'sess-s10-001',
    ownerId: 'user-s10',
    tenantId: 'tenant-s10',
    platform: 'general-web',
  });

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:kaypal-browser-user-s10',
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

  // 与 executor pressKeyViaPanel 一致：可打印单字符 keyDown 补 text
  const keyParams = (type, key) => {
    const params = { type, key };
    if (type === 'keyDown' && key.length === 1) params.text = key;
    return params;
  };
  const approveKey = (key, label) => {
    // 与 executor pressKeyViaPanel 一致：确认单签 Input.dispatchKeyEvent（loop 闸门指纹）
    const { actionId } = broker.requestAction(
      panelId, capabilityToken, 'Input.dispatchKeyEvent',
      { label: label || '按下按键', key },
    );
    broker.approveAction(actionId, capabilityToken, capabilityToken);
    return actionId;
  };

  // ---- S2: 聚焦 #field（readonly evaluate，真实按键的前置）----
  try {
    await dbg('Runtime.evaluate', {
      expression: `document.getElementById('field').focus();
        document.activeElement && document.activeElement.id`,
      returnByValue: true,
    });
    // 预填文本，让 S3 的 Enter keylog 有内容可断言
    await view.webContents.executeJavaScript(`window.__simulateUserTyping('agent-s10')`);
    const focused = await dbg('Runtime.evaluate', {
      expression: `document.activeElement && document.activeElement.id`,
      returnByValue: true,
    });
    record('S2 聚焦 #field（readonly evaluate）', focused?.result?.value === 'field', {
      activeElement: focused?.result?.value,
    });
  } catch (error) {
    record('S2 聚焦 #field（readonly evaluate）', false, { error: error.message });
    throw error;
  }

  // ---- S3: 单单一次按键（keyDown 消耗单 + keyUp 配对）----
  try {
    const before = await probe();
    const actionId = approveKey('Enter');
    // 第一步：keyDown（消耗 dispatchKeyEvent 型确认单——method 严格相等）
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyDown', 'Enter'), {
      approvedActionId: actionId,
    });
    // 第二步：keyUp（配对通道，不再签单）
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyUp', 'Enter'), {
      approvedActionId: actionId,
    });
    const after = await probe();
    // keydown 事件链实证：#keylog 由页面的 keydown 监听器更新（Enter → 'enter:<值>'）
    record(
      'S3 单单一次按键：keyDown(带单)+keyUp(配对) → 页面 keydown 监听收到 Enter',
      before.keylog !== 'enter:agent-s10' && after.keylog === 'enter:agent-s10',
      { before: before.keylog, after: after.keylog },
    );
  } catch (error) {
    record('S3 单单一次按键：keyDown(带单)+keyUp(配对) → 页面 keydown 监听收到 Enter', false, { error: error.message });
  }

  // ---- S4: 可打印字符拟真键入（keyDown 补 text → input 事件链）----
  try {
    const before = await probe();
    const actionId = approveKey('x');
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyDown', 'x'), {
      approvedActionId: actionId,
    });
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyUp', 'x'), {
      approvedActionId: actionId,
    });
    const after = await probe();
    const userops = await dbg('Runtime.evaluate', {
      expression: `document.getElementById('userops').textContent`,
      returnByValue: true,
    });
    const useropsText = userops?.result?.value;
    // 光标位置语义：focus() 后光标可能在行首，只断言"长度 +1 且 input 事件触发"
    const grewOnce = after.field.length === before.field.length + 1;
    record(
      'S4 可打印字符拟真键入：keyDown 补 text → 值追加且 input 事件触发',
      grewOnce && useropsText === `input:${after.field}`,
      { before: before.field, after: after.field, userops: useropsText },
    );
  } catch (error) {
    record('S4 可打印字符拟真键入：keyDown 补 text → 值追加且 input 事件触发', false, { error: error.message });
  }

  // ---- S5: 无批准单直接 keyDown → 拒 ----
  try {
    const before = await probe();
    let rejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyDown', 'Enter'));
    } catch {
      rejected = true;
    }
    const after = await probe();
    record(
      'S5 负向：无批准单直接 keyDown → 拒绝，页面无变化',
      rejected && after.keylog === before.keylog && after.field === before.field,
      { rejected, keylog: after.keylog },
    );
  } catch (error) {
    record('S5 负向：无批准单直接 keyDown → 拒绝，页面无变化', false, { error: error.message });
  }

  // ---- S6: 配对一次性 + 键位不匹配（fail-closed 烧单）----
  try {
    // 6a 一次性：keyDown+keyUp 放行一次后，同单第二次 keyUp 拒
    const t1 = approveKey('Enter', '一次性验证');
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyDown', 'Enter'), {
      approvedActionId: t1,
    });
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyUp', 'Enter'), {
      approvedActionId: t1,
    });
    let secondRejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyUp', 'Enter'), {
        approvedActionId: t1,
      });
    } catch {
      secondRejected = true;
    }
    // 6b 键位不匹配：keyUp('Tab') 拒且烧单——同单随后正确键位 keyUp('Enter') 也拒
    const t2 = approveKey('Enter', '键位校验');
    await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyDown', 'Enter'), {
      approvedActionId: t2,
    });
    let mismatchRejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyUp', 'Tab'), {
        approvedActionId: t2,
      });
    } catch {
      mismatchRejected = true;
    }
    let burnedRejected = false;
    try {
      await broker.sendCDP(panelId, capabilityToken, 'Input.dispatchKeyEvent', keyParams('keyUp', 'Enter'), {
        approvedActionId: t2,
      });
    } catch {
      burnedRejected = true;
    }
    record(
      'S6 负向：配对一次性 + 键位不匹配拒 + 烧单后同单正确键位也拒',
      secondRejected && mismatchRejected && burnedRejected,
      { secondRejected, mismatchRejected, burnedRejected },
    );
  } catch (error) {
    record('S6 负向：配对一次性 + 键位不匹配拒 + 烧单后同单正确键位也拒', false, { error: error.message });
  }

  // ---- 收尾 ----
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\nSTAGE10 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
  console.log(`evidence: ${evidencePath}`);
  server.close();
  app.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('STAGE10 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
