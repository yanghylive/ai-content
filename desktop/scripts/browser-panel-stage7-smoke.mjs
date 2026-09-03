#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage7-smoke.mjs — 阶段 6 决策 ③ 灰度开关端到端真实验证
 *
 * 命题：**用户在控制条上点一下「AI 代操作」，3011 就能读到 on；再点一下，
 * 文件消失回到 off。全程走真实 DOM 点击 → preload 白名单 → IPC → 主进程
 * → 0600 文件，不直接调 manager 函数。**
 *
 * 检查项：
 *   B1 默认 off：无开关文件 → publicState.agentMode==='off'，按钮不高亮
 *   B2 真实点击「AI 代操作」→ 文件写入（0600，protocol/mode/pid 合法），
 *      回读 agentMode==='on'，按钮紫色高亮
 *   B3 backend 语义对齐：文件形状与 backend readPanelModeRegistry 的校验
 *      逐字段匹配（protocol=kaypal-browser-panel-mode、mode=on、pid 活、未老化）
 *   B4 再点一下 → 文件删除（而非写 off），回读 agentMode==='off'
 *   B5 preload 白名单：未登记通道被拒（toggle 在白名单内、任意外部通道被拒）
 *   B6 destroy() → 主动清掉开关文件（不留残留）
 *
 * 运行：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/browser-panel-stage7-smoke.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { BrowserPanelManager } = require('../browser-panel-manager.js');
const { wireBrowserPanel } = require('../browser-broker-wiring.js');
const { registerBrowserPanelIpc } = require('../browser-panel-ipc.js');
const { readMode } = require('../browser-panel-mode-registry.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage7-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    userDataDir: null,
  },
  checks,
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : ' ' + JSON.stringify(detail).slice(0, 600)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let manager = null;
let win = null;
let server = null;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const watchdog = setTimeout(() => {
  console.log('\n[WATCHDOG] 120s 未结束，强制退出并落证据');
  try {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${evidencePath}`);
  } catch { /* ignore */ }
  app.exit(2);
}, 120_000);
watchdog.unref?.();

function serveFixtures() {
  const http = require('node:http');
  const mainHtml = fs.readFileSync(
    path.join(desktopRoot, 'test-fixtures', 'browser-panel.html'),
    'utf8',
  );
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(mainHtml);
  });
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve({ server: httpServer, port: httpServer.address().port }));
  });
}

/** 等控制条页面就绪（真实 preload + agent-mode 按钮都在） */
async function waitForStripReady(wc, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ready = await wc.executeJavaScript(
        'typeof window.browserControl === "object" && !!document.getElementById("agent-mode")',
      );
      if (ready) return true;
    } catch { /* 文档还没就绪 */ }
    await sleep(200);
  }
  return false;
}

/** 在控制条里真实点击「AI 代操作」按钮（完整 DOM 事件 → preload → IPC 链路） */
async function clickAgentModeToggle(wc) {
  return wc.executeJavaScript(
    `(function(){
      var el = document.getElementById('agent-mode');
      if (!el) return { clicked: false, reason: 'not-found' };
      el.click();
      return { clicked: true, highlighted: el.classList.contains('on') };
    })()`,
  );
}

/** 轮询控制条按钮高亮态（等主进程 _emitState 推送回流） */
async function pollHighlight(wc, expect, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const got = await wc.executeJavaScript(
      `document.getElementById('agent-mode').classList.contains('on')`,
    );
    if (got === expect) return true;
    await sleep(150);
  }
  return false;
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await app.whenReady();
  console.log('[boot] Electron ready');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage7-mode-'));
  evidence.meta.userDataDir = userDataDir;
  const modePath = path.join(userDataDir, 'browser-panel-mode.json');
  const storeData = {};
  const store = { get: (k) => storeData[k], set: (k, v) => { storeData[k] = v; } };

  win = new BrowserWindow({
    width: 1600, height: 900, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const bizView = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(bizView);
  const fakeTabManager = {
    rightInset: 0,
    relayout() {
      const { width, height } = win.getContentBounds();
      bizView.setBounds({ x: 0, y: 38, width: Math.max(0, width - this.rightInset), height: height - 38 });
    },
    broadcast: () => undefined,
    sendToBusiness: () => true,
    isOwnedWebContents: () => true,
  };
  win.on('resize', () => fakeTabManager.relayout());
  fakeTabManager.relayout();

  // 与 main.js 同款组合，getUserDataDir 指向临时目录（生产=app.getPath('userData')）
  manager = new BrowserPanelManager({
    electron: { WebContentsView },
    store,
    tabManager: fakeTabManager,
    getUserDataDir: () => userDataDir,
  });
  manager.attach(win);
  const wiring = wireBrowserPanel({
    manager,
    onPendingChange: (panelId, pending) => {
      const current = manager.session ? manager.session.panelId : null;
      if (panelId === current) manager.updateApprovalList(pending);
    },
  });
  registerBrowserPanelIpc({
    ipcMain,
    getPanel: () => manager,
    getWiring: () => wiring,
  });

  const fixture = await serveFixtures();
  server = fixture.server;
  const fixtureUrl = `http://127.0.0.1:${fixture.port}/browser-panel.html?token=SECRET-S7&keep=1`;

  try {
    await withTimeout(manager.open({ url: fixtureUrl }), 20_000, 'manager.open');
    const stripReady = await waitForStripReady(manager.stripView.webContents);
    if (!stripReady) throw new Error('控制条未就绪（真实 preload 未挂上？），后续点击无意义');

    // ── B1 默认 off ──────────────────────────────────────────────────────
    record('B1 默认 off：无开关文件 → agentMode=off，文件不存在',
      manager.publicState().agentMode === 'off' && !fs.existsSync(modePath),
      { agentMode: manager.publicState().agentMode, exists: fs.existsSync(modePath) });

    // ── B2 真实点击 → on + 0600 文件 + 按钮高亮 ───────────────────────────
    const click1 = await clickAgentModeToggle(manager.stripView.webContents);
    await sleep(400);
    const filePayload = fs.existsSync(modePath)
      ? JSON.parse(fs.readFileSync(modePath, 'utf8')) : null;
    let permOk = null;
    if (filePayload && process.platform !== 'win32') {
      permOk = (fs.statSync(modePath).mode & 0o777) === 0o600;
    }
    const highlightedOn = await pollHighlight(manager.stripView.webContents, true);
    record('B2 真实点击「AI 代操作」→ 0600 文件写入 + agentMode=on + 按钮紫色高亮',
      click1.clicked === true && !!filePayload && filePayload.mode === 'on'
        && manager.publicState().agentMode === 'on'
        && (permOk === null || permOk === true) && highlightedOn === true,
      { click: click1, filePayload, permOk, agentMode: manager.publicState().agentMode, highlightedOn });
    evidence.afterOn = { filePayload, agentMode: manager.publicState().agentMode };

    // ── B3 backend 语义对齐（readMode = backend readPanelModeRegistry 同规则）──
    const backendView = readMode({ userDataDir });
    record('B3 文件形状与 backend 校验规则逐字段匹配（protocol/mode/pid 活/未老化）',
      !!backendView && backendView.mode === 'on'
        && backendView.protocol === undefined // readMode 不回吐 protocol，但内部已校验
        && backendView.pid === process.pid,
      { backendView });
    // protocol 字段必须正好是 backend 认的那个（读原始文件核对）
    record('B3b protocol 字段 = kaypal-browser-panel-mode（backend 硬编码认这个）',
      filePayload && filePayload.protocol === 'kaypal-browser-panel-mode',
      { protocol: filePayload && filePayload.protocol });

    // ── B4 再点一下 → 文件删除 + 回 off ───────────────────────────────────
    const click2 = await clickAgentModeToggle(manager.stripView.webContents);
    await sleep(400);
    const highlightedOff = await pollHighlight(manager.stripView.webContents, false);
    record('B4 再点一下 → 文件删除（而非写 off）+ agentMode=off + 高亮消失',
      click2.clicked === true && !fs.existsSync(modePath)
        && manager.publicState().agentMode === 'off' && highlightedOff === true,
      { click: click2, exists: fs.existsSync(modePath), agentMode: manager.publicState().agentMode, highlightedOff });

    // ── B5 preload 白名单：外部通道被拒 ───────────────────────────────────
    const whitelist = await manager.stripView.webContents.executeJavaScript(
      `window.browserControl.invoke('browser-panel:evil-channel').then(
        () => ({ rejected: false }),
        (e) => ({ rejected: true, message: String(e && e.message) }),
      )`,
    );
    record('B5 preload 白名单：未登记通道被拒（toggle 通道在 B2 已实测放行）',
      whitelist.rejected === true && /not allowed/.test(whitelist.message),
      whitelist);
    evidence.whitelist = whitelist;

    // ── B6 destroy() → 开关文件被清 ───────────────────────────────────────
    await clickAgentModeToggle(manager.stripView.webContents);
    await sleep(400);
    const existsBeforeDestroy = fs.existsSync(modePath);
    manager.destroy();
    record('B6 destroy() → 主动清掉开关文件（不留残留）',
      existsBeforeDestroy === true && !fs.existsSync(modePath),
      { existsBeforeDestroy, existsAfter: fs.existsSync(modePath) });

    evidence.summary = {
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
    };
    return evidence.summary.failed === 0;
  } catch (error) {
    record('未捕获异常', false, { message: error && error.message ? error.message : String(error) });
    evidence.summary = {
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
    };
    return false;
  }
}

async function finish(ok) {
  try { manager && manager.destroy(); } catch { /* ignore */ }
  try { win && !win.isDestroyed() && win.destroy(); } catch { /* ignore */ }
  try { server && server.close(); } catch { /* ignore */ }
  try { fs.rmSync(evidence.meta.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\nEvidence: ${evidencePath}`);
  if (ok && failed === 0) {
    console.log(`STAGE7 SMOKE PASSED ${passed}/${checks.length}`);
    app.exit(0);
  } else {
    console.error(`STAGE7 SMOKE FAILED ${failed}/${checks.length}`);
    app.exit(1);
  }
}

main().then(finish).catch((error) => {
  console.error('SMOKE CRASHED:', error);
  finish(false).catch(() => app.exit(1));
});
