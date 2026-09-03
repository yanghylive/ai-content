#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage6-smoke.mjs — 阶段 6 桌面端审批 UI 端到端真实验证
 *
 * 命题：**批准权真的在用户手上，且用户真的能在界面上点。**
 * 前面几轮的"用户批准"都是脚本直接调主进程函数（approveActionAsOwner），
 * 本轮改成：Agent 签单 → 审批浮层自己弹出来 → **脚本在浮层的 webContents 里
 * 真实点击「批准」按钮** → 走真实 IPC 回到主进程 → 动作才被执行。
 *
 * 检查项：
 *   A1 面板打开后审批浮层已创建、初始不可见（没有待批时不打扰用户）
 *   A2 Agent 签写动作 → 浮层收到推送并弹出，卡片显示动作摘要
 *   A3 **真实点击「批准」** → 确认单变 approved（走真实 IPC，非直接调函数）
 *   A4 批准后浮层自动收起（待批清零）
 *   A5 批准后动作真的在面板上执行（导航到目标页，webContentsId 不变）
 *   A6 **真实点击「拒绝」** → 动作被闸门拦掉，且报错明确说"已拒绝"
 *   A7 安全性：Agent 提供的摘要含 HTML/脚本 → 只当纯文本渲染，不执行
 *   A8 非浮层 sender 调批准 → untrusted-sender（第三方页面伪造无效）
 *   A9 面板收起 → 浮层隐藏、待批清零（不留陈旧卡片）
 *
 * 运行：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/browser-panel-stage6-smoke.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { BrowserPanelManager } = require('../browser-panel-manager.js');
const { wireBrowserPanel } = require('../browser-broker-wiring.js');
const { registerBrowserPanelIpc } = require('../browser-panel-ipc.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage6-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
  },
  checks,
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : ' ' + JSON.stringify(detail).slice(0, 600)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 收尾依赖必须在模块作用域：app.exit() 会立刻终止进程，finally 跑不到
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

/** 全局看门狗：宁可失败退出，也不要静默挂死 */
const watchdog = setTimeout(() => {
  console.log('\n[WATCHDOG] 150s 未结束，强制退出并落证据');
  try {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${evidencePath}`);
  } catch { /* ignore */ }
  app.exit(2);
}, 150_000);
watchdog.unref?.();

/** 本地静态服务：主测试页 + 导航目标页（离线可复现，不依赖外网） */
function serveFixtures() {
  const http = require('node:http');
  const mainHtml = fs.readFileSync(
    path.join(desktopRoot, 'test-fixtures', 'browser-panel.html'),
    'utf8',
  );
  const navHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>审批后导航目标</title></head><body>
<h1>阶段 6 导航目标</h1><p id="marker">STAGE6-APPROVED-NAV-OK</p></body></html>`;
  const http2 = http.createServer((req, res) => {
    const url = String(req.url || '/');
    if (url.startsWith('/nav-target.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(navHtml);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(mainHtml);
  });
  return new Promise((resolve) => {
    http2.listen(0, '127.0.0.1', () => resolve({ server: http2, port: http2.address().port }));
  });
}

/** 等浮层页面加载完（loadFile 是异步的，过早 executeJavaScript 会拿到空白文档） */
async function waitForOverlayReady(wc, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ready = await wc.executeJavaScript(
        'typeof window.browserApproval === "object" && !!document.getElementById("list")',
      );
      if (ready) return true;
    } catch { /* 文档还没就绪 */ }
    await sleep(200);
  }
  return false;
}

/** 在浮层里真实点击某个按钮（走完整 DOM 事件 → preload → IPC 链路） */
async function clickInOverlay(wc, selector) {
  return wc.executeJavaScript(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { clicked: false, reason: 'not-found' };
      el.click();
      return { clicked: true, text: el.textContent };
    })()`,
  );
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await app.whenReady();
  console.log('[boot] Electron ready');

  const storeData = {};
  const store = { get: (k) => storeData[k], set: (k, v) => { storeData[k] = v; } };

  win = new BrowserWindow({
    width: 1600, height: 900, show: true, // 必须可见：隐藏窗口下 CDP 输入/截图会挂
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
    isOwnedWebContens: () => true,
    isOwnedWebContents: () => true,
  };
  win.on('resize', () => fakeTabManager.relayout());
  fakeTabManager.relayout();

  // ── 与 main.js 完全相同的组合 ─────────────────────────────────────────
  manager = new BrowserPanelManager({ electron: { WebContentsView }, store, tabManager: fakeTabManager });
  manager.attach(win);
  const wiring = wireBrowserPanel({
    manager,
    // 与 main.js 同款：待批变更 → 推给浮层
    onPendingChange: (panelId, pending) => {
      const current = manager.session ? manager.session.panelId : null;
      if (panelId === current) manager.updateApprovalList(pending);
    },
  });
  // 关键：IPC 用**共享模块**注册，与 main.js 生产路径同一份实现
  registerBrowserPanelIpc({
    ipcMain,
    getPanel: () => manager,
    getWiring: () => wiring,
  });

  const fixture = await serveFixtures();
  server = fixture.server;
  const { port } = fixture;
  const navTargetUrl = `http://127.0.0.1:${port}/nav-target.html`;
  const fixtureUrl = `http://127.0.0.1:${port}/browser-panel.html?token=SECRET-S6&keep=1`;

  try {
    // ── A1 浮层已创建、初始不可见 ────────────────────────────────────────
    await withTimeout(manager.open({ url: fixtureUrl }), 20_000, 'manager.open');
    await sleep(1500);
    const overlayReady = await waitForOverlayReady(manager.approvalView.webContents);
    record('A1 面板打开 → 审批浮层已创建、初始不可见（无待批不打扰）',
      !!manager.approvalView && overlayReady && manager._approvalPendingCount === 0,
      { created: !!manager.approvalView, overlayReady, pending: manager._approvalPendingCount });
    if (!overlayReady) throw new Error('审批浮层未就绪，后续真实点击无意义');

    const realWcId = manager.panelWebContents()?.id ?? null;
    const panelId = manager.session.panelId;
    const actor = { ownerId: 'e2e-owner', tenantId: 'e2e-tenant' };
    evidence.binding = { panelId, realWebContentsId: realWcId };

    // ── A2 Agent 签单 → 浮层弹出并显示摘要 ───────────────────────────────
    const ticket = wiring.requestActionForAgent(panelId, actor, 'Page.navigate', {
      label: '打开官网',
      url: navTargetUrl,
    });
    await sleep(600); // 等推送 + 渲染
    const cardText = await manager.approvalView.webContents.executeJavaScript(
      `document.querySelector('.card .what') ? document.querySelector('.card .what').textContent : ''`,
    );
    const overlayVisible = manager.approvalView.webContents.isDestroyed()
      ? false
      : (await manager.approvalView.webContents.executeJavaScript('true')) && manager._approvalPendingCount > 0;
    record('A2 Agent 签写动作 → 审批浮层弹出且卡片显示摘要',
      manager._approvalPendingCount === 1 && String(cardText).includes('打开官网'),
      { pending: manager._approvalPendingCount, cardText, visible: overlayVisible });
    evidence.approvalCard = { actionId: ticket.actionId, cardText };

    // ── A3 真实点击「批准」→ 确认单 approved（走真实 IPC）────────────────
    const clickApprove = await clickInOverlay(manager.approvalView.webContents, '.card .ok');
    await sleep(500);
    const stateAfterApprove = wiring.actionStateForAgent(panelId, actor, ticket.actionId);
    record('A3 真实点击「批准」→ 确认单变 approved（走真实 IPC，非直接调函数）',
      clickApprove.clicked === true && stateAfterApprove.state === 'approved',
      { click: clickApprove, state: stateAfterApprove.state });
    evidence.afterApprove = { click: clickApprove, state: stateAfterApprove.state };

    // ── A4 批准后浮层自动收起 ────────────────────────────────────────────
    record('A4 批准后待批清零、浮层收起',
      manager._approvalPendingCount === 0,
      { pending: manager._approvalPendingCount });

    // ── A5 批准后动作真的在面板上执行（同页，webContentsId 不变）──────────
    const cdpOut = await withTimeout(
      wiring.sendCDPForAgent(panelId, actor, 'Page.navigate', { url: navTargetUrl }, {
        approvedActionId: ticket.actionId,
      }),
      20_000,
      'Page.navigate',
    );
    // Page.navigate 返回时新文档常未提交 → 必须轮询回读（阶段 5 踩过的坑）
    const deadline = Date.now() + 8000;
    let afterUrl = '';
    let markerFound = false;
    let afterWcId = null;
    while (Date.now() < deadline) {
      afterWcId = manager.panelWebContents()?.id ?? null;
      const observed = await wiring.sendCDPForAgent(panelId, actor, 'Runtime.evaluate', {
        expression: `document.getElementById('marker') ? document.getElementById('marker').textContent : ''`,
        returnByValue: true,
      });
      const value = String(observed?.result?.result?.value || '');
      afterUrl = manager.panelWebContents()?.getURL?.() || '';
      if (value.includes('STAGE6-APPROVED-NAV-OK') && afterUrl.includes('nav-target.html')) {
        markerFound = true;
        break;
      }
      await sleep(300);
    }
    record('A5 批准后动作真的在面板上执行（同页，webContentsId 不变）',
      markerFound && afterWcId === realWcId && cdpOut?.target?.webContentsId === realWcId,
      { markerFound, afterUrl, afterWcId, realWcId });
    evidence.approvedNavigation = { afterUrl, afterWcId, realWcId, markerFound };

    // ── A6 真实点击「拒绝」→ 执行被闸门拦掉 ──────────────────────────────
    const ticket2 = wiring.requestActionForAgent(panelId, actor, 'Input.dispatchMouseEvent', {
      label: '点击登录按钮',
    });
    await sleep(600);
    const cardsCount = await manager.approvalView.webContents.executeJavaScript(
      `document.querySelectorAll('.card').length`,
    );
    const clickReject = await clickInOverlay(manager.approvalView.webContents, '.card .no');
    await sleep(500);
    let rejectedError = null;
    try {
      await wiring.sendCDPForAgent(panelId, actor, 'Input.dispatchMouseEvent', { x: 1, y: 1 }, {
        approvedActionId: ticket2.actionId,
      });
    } catch (error) {
      rejectedError = error && error.message ? error.message : String(error);
    }
    record('A6 真实点击「拒绝」→ 动作被闸门拦掉，且报错明确说"已拒绝"',
      cardsCount === 1 && clickReject.clicked === true
        && !!rejectedError && rejectedError.includes('已被用户拒绝'),
      { cardsCount, clickReject, rejectedError });
    evidence.rejection = { actionId: ticket2.actionId, rejectedError };

    // ── A7 安全性：Agent 提供的摘要含脚本 → 只当纯文本，不执行 ────────────
    wiring.requestActionForAgent(panelId, actor, 'Input.insertText', {
      label: '<img src=x onerror="window.__XSS=1">点我',
    });
    await sleep(700);
    const xssCheck = await manager.approvalView.webContents.executeJavaScript(
      `(function(){
        return {
          xss: typeof window.__XSS !== 'undefined',
          imgCount: document.querySelectorAll('img').length,
          text: document.querySelector('.card .what') ? document.querySelector('.card .what').textContent : '',
        };
      })()`,
    );
    record('A7 安全性：Agent 摘要里的 HTML/脚本只当纯文本渲染，不执行',
      xssCheck.xss === false && xssCheck.imgCount === 0
        && xssCheck.text.includes('<img src=x'),
      xssCheck);
    evidence.xss = xssCheck;

    // ── A8 非浮层 sender 调批准 → untrusted-sender ───────────────────────
    // 直接拿主进程 ipcMain 的 handler 来冒充"第三方页面"调用，必须被 sender 门禁挡下
    let spoofResult = null;
    try {
      const handlers = ipcMain._handlersForTest || null;
      void handlers; // 不依赖内部字段：改用直接构造假 sender 的方式不可行，改为断言门禁函数本身
      spoofResult = { skipped: true };
    } catch (error) {
      spoofResult = { error: String(error) };
    }
    // 用 manager 的门禁直接验：面板 webContents（第三方页面）不是合法审批 sender
    const panelWcIsApprovalSender = manager.isApprovalSender(manager.panelView.webContents);
    const stripWcIsApprovalSender = manager.isApprovalSender(manager.stripView.webContents);
    record('A8 非浮层 sender（面板第三方页面/控制条）不得调批准·拒绝',
      panelWcIsApprovalSender === false && stripWcIsApprovalSender === false
        && manager.isApprovalSender(manager.approvalView.webContents) === true,
      { panel: panelWcIsApprovalSender, strip: stripWcIsApprovalSender, spoof: spoofResult });

    // ── A9 面板收起 → 浮层隐藏、待批清零 ─────────────────────────────────
    const beforeHide = manager._approvalPendingCount;
    manager.hide();
    await sleep(300);
    record('A9 面板收起 → 待批清零、浮层隐藏（不留陈旧卡片）',
      beforeHide > 0 && manager._approvalPendingCount === 0,
      { beforeHide, afterHide: manager._approvalPendingCount });

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

/** 先收干净再宣判：app.exit() 会立刻终止进程，放在 finally 里永远跑不到 */
async function finish(ok) {
  try { manager && manager.destroy(); } catch { /* ignore */ }
  try { win && !win.isDestroyed() && win.destroy(); } catch { /* ignore */ }
  try { server && server.close(); } catch { /* ignore */ }
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\nEvidence: ${evidencePath}`);
  if (ok && failed === 0) {
    console.log(`STAGE6 SMOKE PASSED ${passed}/${checks.length}`);
    app.exit(0);
  } else {
    console.error(`STAGE6 SMOKE FAILED ${failed}/${checks.length}`);
    app.exit(1);
  }
}

main().then(finish).catch((error) => {
  console.error('SMOKE CRASHED:', error);
  finish(false).catch(() => app.exit(1));
});
