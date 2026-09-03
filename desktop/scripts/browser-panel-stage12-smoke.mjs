#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage12-smoke.mjs — 阶段 7 续（第十一轮）：tabs 真机冒烟
 *
 * 验证命题：面板模式 tabs（new/switch/close）走 broker 主进程伪 method
 * Panel.tabs —— 审批闸门与 CDP 写动作同构（无单拒 / owner 批准放行 / 一次性），
 * manager 原生台账维护多 tab（panelView 恒 = active tab 视图），同页控制命题
 * 在多 tab 下成立：Agent 读/操作的页面 == 用户看到的 active tab。
 *
 * 8 项检查：
 *   S1 面板 open fixture A（真实 BrowserPanelManager）
 *   S2 Panel.tabs 无单 → 拒（mutation 闸门，fail-closed）
 *   S3 tabs new（签单 → owner 批准 → 放行）→ 台账 2、active=1、新 tab 空白页
 *   S4 新 tab goto fixture B → active URL=B + evaluate #title=B（同页证明）
 *   S5 tabs switch 0（批准放行）→ active URL=A + evaluate #title=A（同页控制）
 *   S6 tabs close 1（批准放行）→ 台账 1
 *   S7 负向：close 最后一个 → handler 抛错透传（单已耗，重试需重新签单）
 *   S8 台账一致性：publicState tabCount=1 / session.currentUrl=A
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage12-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage12-evidence-<timestamp>.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, WebContentsView } = require('electron');
const { BrowserPanelManager } = require(path.join(__dirname, '..', 'browser-panel-manager.js'));
const { wireBrowserPanel } = require(path.join(__dirname, '..', 'browser-broker-wiring.js'));

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage12-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    scenario: 'stage7 续：tabs 全链真机（Panel.tabs 审批闸门 + manager 台账 + 同页控制多 tab）',
  },
  checks,
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass && detail) console.log(`       detail: ${JSON.stringify(detail).slice(0, 400)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 双页 fixture：/page-a → title page-a-title；/page-b → title page-b-title */
function startFixtureServer() {
  const page = (title) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body><h1 id="title">${title}</h1><input id="field"/></body></html>`;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const title = (req.url || '').includes('page-b') ? 'page-b-title' : 'page-a-title';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(title));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        urlA: `http://127.0.0.1:${port}/page-a`,
        urlB: `http://127.0.0.1:${port}/page-b`,
      });
    });
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { server, urlA, urlB } = await startFixtureServer();
  await app.whenReady();

  // 全局看门狗（macOS 无 timeout 命令）
  const watchdog = setTimeout(() => {
    console.error('STAGE12 WATCHDOG: 120s 强制退出');
    app.exit(1);
  }, 120_000);
  watchdog.unref?.();

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: true,
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

  const storeData = {};
  const manager = new BrowserPanelManager({
    electron: { WebContentsView },
    store: { get: (k) => storeData[k], set: (k, v) => { storeData[k] = v; } },
    tabManager: fakeTabManager,
  });
  manager.attach(win);
  // wiring 默认（无 allowSelfApprove）——批准走 owner 通道
  const wiring = wireBrowserPanel({ manager });
  const ACTOR = { ownerId: 'u1', tenantId: 't1' };

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`超时 ${ms}ms: ${label}`)), ms).unref?.(),
      ),
    ]);

  /** 签单 → owner 批准 → 带单执行（面板动作三步，与 executor 行为同构） */
  const approvedExecute = async (method, params, summary) => {
    const ticket = wiring.requestActionForAgent(manager.session.panelId, ACTOR, method, summary);
    wiring.approveActionAsOwner(manager.session.panelId, ticket.actionId);
    return wiring.sendCDPForAgent(
      manager.session.panelId, ACTOR, method, params,
      { approvedActionId: ticket.actionId },
    );
  };
  /** 在当前 active tab 上取 #title 文本（同页证明）。
   *  round11 排障：smoke 裸调 wc.debugger.sendCommand，而 broker 只在执行 CDP 时
   *  attach 当时的 active tab——switch 换绑后新 active 未必 attach 过，Electron 会抛
   *  "No target available"。产品链路无此问题（broker 每次 sendCDP 重新 resolve+attach），
   *  这里补 attach 属 harness 行为，不改产品代码。 */
  const activeTitle = async () => {
    const wc = manager.panelWebContents();
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const out = await withTimeout(
      wc.debugger.sendCommand('Runtime.evaluate', {
        expression: 'document.getElementById("title") ? document.getElementById("title").textContent : null',
        returnByValue: true,
      }),
      8000,
      'evaluate #title',
    );
    return out?.result?.value ?? null;
  };

  try {
    // ---- S1 面板 open fixture A ----
    manager.open({ url: urlA, ownerId: 'u1', tenantId: 't1' });
    await sleep(1000);
    const wcA = manager.panelWebContents();
    const urlOk = wcA && wcA.getURL().includes('/page-a');
    record('S1 面板 open fixture A（真实 manager）', !!urlOk, {
      url: wcA?.getURL(), status: manager.session.status,
    });
    await sleep(300);

    // ---- S2 Panel.tabs 无单 → 拒 ----
    try {
      await wiring.sendCDPForAgent(
        manager.session.panelId, ACTOR, 'Panel.tabs', { operation: 'new' }, {},
      );
      record('S2 Panel.tabs 无单 → 拒（mutation 闸门）', false, { state: 'no throw' });
    } catch (error) {
      record('S2 Panel.tabs 无单 → 拒（mutation 闸门）', /需要审批/.test(error.message), {
        error: error.message,
      });
    }

    // ---- S3 tabs new（批准放行）----
    try {
      const done = await approvedExecute(
        'Panel.tabs', { operation: 'new' },
        { label: '标签页操作', operation: 'new' },
      );
      const wc1 = manager.panelWebContents();
      const snap = done.result || {};
      record(
        'S3 tabs new → 台账 2、active=1、panelView 换绑新 tab（空白页）',
        snap.tabs === 2 && snap.activeIndex === 1 &&
          manager._panelTabs.length === 2 &&
          wc1.id !== wcA.id &&
          manager.session.currentUrl === 'about:blank',
        { snap, panelWcId: wc1.id, firstWcId: wcA.id, currentUrl: manager.session.currentUrl },
      );
    } catch (error) {
      record('S3 tabs new → 台账 2、active=1、panelView 换绑新 tab（空白页）', false, { error: error.message });
    }
    await sleep(300);

    // ---- S4 新 tab goto fixture B + 同页证明 ----
    try {
      const done = await approvedExecute(
        'Page.navigate', { url: urlB }, { label: '导航', url: urlB },
      );
      await sleep(600);
      const url = manager.panelWebContents().getURL();
      const title = await activeTitle();
      // round11 语义锁：mutation 的 done.target = 执行前 resolve 的 binding。
      // Page.navigate 前新 tab 是 about:blank（tabsOperation('new') 已 loadURL 修复陈旧问题），
      // 故 bindingUrl 应为 about:blank——页面是否真的到了 B 由上面 url/title 证明。
      record(
        'S4 新 tab goto B → active URL=B 且 evaluate #title=page-b-title（Agent 读的==用户看的）',
        url.includes('/page-b') && title === 'page-b-title' &&
          done.target?.url === 'about:blank',
        { url, title, bindingUrl: done.target?.url },
      );
    } catch (error) {
      record('S4 新 tab goto B → active URL=B 且 evaluate #title=page-b-title（Agent 读的==用户看的）', false, { error: error.message });
    }

    // ---- S5 tabs switch 0 → 回 tab A + 同页证明 ----
    try {
      const ticket = wiring.requestActionForAgent(
        manager.session.panelId, ACTOR, 'Panel.tabs',
        { label: '标签页操作', operation: 'switch', index: 0 },
      );
      wiring.approveActionAsOwner(manager.session.panelId, ticket.actionId);
      let out, step = 'sendCDP';
      try {
        out = await wiring.sendCDPForAgent(
          manager.session.panelId, ACTOR, 'Panel.tabs',
          { operation: 'switch', index: 0 }, { approvedActionId: ticket.actionId },
        );
        step = 'post-eval';
        await sleep(400);
        const url = manager.panelWebContents().getURL();
        const title = await activeTitle();
        step = 'assert';
        record(
          'S5 tabs switch 0 → active URL=A 且 evaluate #title=page-a-title（同页控制跨 tab 成立）',
          url.includes('/page-a') && title === 'page-a-title',
          { url, title },
        );
      } catch (inner) {
        record(
          'S5 tabs switch 0 → active URL=A 且 evaluate #title=page-a-title（同页控制跨 tab 成立）',
          false,
          { step, error: inner.message, activeWcId: manager.panelWebContents().id,
            tabs: manager._panelTabs.map((t) => t.view.webContents.id) },
        );
      }
    } catch (error) {
      record('S5 tabs switch 0 → active URL=A 且 evaluate #title=page-a-title（同页控制跨 tab 成立）', false, { error: error.message });
    }

    // ---- S6 tabs close 1 → 台账 1 ----
    try {
      const done = await approvedExecute(
        'Panel.tabs', { operation: 'close', index: 1 },
        { label: '标签页操作', operation: 'close', index: 1 },
      );
      const snap = done.result || {};
      const closedWcDestroyed = manager._panelTabs.length === 1;
      record(
        'S6 tabs close 1 → 台账 1、active 保持 tab0',
        snap.tabs === 1 && snap.activeIndex === 0 && closedWcDestroyed &&
          manager.panelWebContents().getURL().includes('/page-a'),
        { snap, tabs: manager._panelTabs.length },
      );
    } catch (error) {
      record('S6 tabs close 1 → 台账 1、active 保持 tab0', false, { error: error.message });
    }

    // ---- S7 负向：close 最后一个 → handler 抛错透传 + 单已耗 ----
    try {
      const ticket = wiring.requestActionForAgent(
        manager.session.panelId, ACTOR, 'Panel.tabs',
        { label: '标签页操作', operation: 'close', index: 0 },
      );
      wiring.approveActionAsOwner(manager.session.panelId, ticket.actionId);
      let firstError = null;
      try {
        await wiring.sendCDPForAgent(
          manager.session.panelId, ACTOR, 'Panel.tabs',
          { operation: 'close', index: 0 }, { approvedActionId: ticket.actionId },
        );
      } catch (error) {
        firstError = error.message;
      }
      let replayBlocked = false;
      try {
        await wiring.sendCDPForAgent(
          manager.session.panelId, ACTOR, 'Panel.tabs',
          { operation: 'close', index: 0 }, { approvedActionId: ticket.actionId },
        );
      } catch (error) {
        replayBlocked = /需要审批/.test(error.message);
      }
      record(
        'S7 close 最后一个 → 抛错透传（单已耗）+ 同单重试拒（一次性）',
        /不能关闭最后一个/.test(firstError || '') && replayBlocked &&
          manager._panelTabs.length === 1,
        { firstError, replayBlocked },
      );
    } catch (error) {
      record('S7 close 最后一个 → 抛错透传（单已耗）+ 同单重试拒（一次性）', false, { error: error.message });
    }

    // ---- S8 台账一致性 ----
    try {
      const state = manager.publicState();
      record(
        'S8 台账一致性：publicState tabCount=1 / tabActiveIndex=0 / currentUrl=A',
        state.tabCount === 1 && state.tabActiveIndex === 0 &&
          (state.session?.currentUrl || '').includes('/page-a'),
        { tabCount: state.tabCount, tabActiveIndex: state.tabActiveIndex, currentUrl: state.session?.currentUrl },
      );
    } catch (error) {
      record('S8 台账一致性：publicState tabCount=1 / tabActiveIndex=0 / currentUrl=A', false, { error: error.message });
    }
  } finally {
    // 先写证据再收尾（app.exit 后 finally 跑不到——skill 坑 6）
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    const failed = checks.filter((c) => !c.pass).length;
    console.log(`\nSTAGE12 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
    console.log(`evidence: ${evidencePath}`);
    try { wiring.dispose(); } catch {}
    try { manager.destroy(); } catch {}
    try { win.destroy(); } catch {}
    try { server.close(); } catch {}
    app.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error('STAGE12 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
