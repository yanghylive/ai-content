#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage15-smoke.mjs — round15：控制条 tab 条 UI 真机冒烟
 *
 * 验证命题：多 tab 时控制条出现 tab 条（单 tab 不出现，零干扰）；用户点 tab
 * 手动切换 = panelView 换绑 + session 跟随（Agent 读写的就是用户看的页）；
 * 点 ✕ 关 tab；Agent 动作（审批链）与 tab 条状态互通（同一 publicState 流）。
 * 交互走真实 strip webContents 的 executeJavaScript 点击（同 stage6/7 姿态）。
 *
 * 8 项检查：
 *   S1 面板 open fixture A（真实 manager + 真实 strip）
 *   S2 Agent 链 new tab（签单→批准→放行）→ strip tab 条出现 2 个 tab、active 高亮第 2 个
 *   S3 strip 真实点击 tab0 → active 切换、panelView 换绑、URL=A、tab 条高亮第 1 个
 *   S4 strip 点 ✕ 关 tab1 → 台账 1、tab 条隐藏（单 tab 零干扰）
 *   S5 Agent 链再 new + goto B → tab 条 2 个、active 高亮第 2 个、标题=B 页 title
 *   S6 越界防护：invoke switch-tab 9 → success:false 不炸
 *   S7 单 tab 阶段 strip 高度 40 / 多 tab 66（stripView bounds 实证）
 *   S8 Agent 动作作用于用户当前看的 tab（switch 后 evaluate 同页证明）
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage15-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage15-evidence-<timestamp>.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { BrowserPanelManager } = require(path.join(__dirname, '..', 'browser-panel-manager.js'));
const { wireBrowserPanel } = require(path.join(__dirname, '..', 'browser-broker-wiring.js'));
const { registerBrowserPanelIpc } = require(path.join(__dirname, '..', 'browser-panel-ipc.js'));

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage15-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    scenario: 'round15：控制条 tab 条 UI（用户手动切/关 tab + 与 Agent 链状态互通）',
  },
  checks,
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass && detail) console.log(`       detail: ${JSON.stringify(detail).slice(0, 400)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 双页 fixture（title 供 tab 条显示） */
function startFixtureServer() {
  const page = (title) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body><h1 id="title">${title}</h1></body></html>`;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const title = (req.url || '').includes('page-b') ? 'page-b-title' : 'page-a-title';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(title));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, urlA: `http://127.0.0.1:${server.address().port}/page-a`, urlB: `http://127.0.0.1:${server.address().port}/page-b` });
    });
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { server, urlA, urlB } = await startFixtureServer();
  await app.whenReady();

  const watchdog = setTimeout(() => {
    console.error('STAGE15 WATCHDOG: 150s 强制退出');
    app.exit(1);
  }, 150_000);
  watchdog.unref?.();

  const win = new BrowserWindow({
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

  const storeData = {};
  const manager = new BrowserPanelManager({
    electron: { WebContentsView },
    store: { get: (k) => storeData[k], set: (k, v) => { storeData[k] = v; } },
    tabManager: fakeTabManager,
    getUserDataDir: () => app.getPath('userData'),
  });
  manager.attach(win);
  const wiring = wireBrowserPanel({ manager });
  // round15：tab 条交互走真实 IPC 层（stripOnly 门禁 + handler 注册，同 stage6/7 姿态）
  registerBrowserPanelIpc({ ipcMain, getPanel: () => manager, getWiring: () => wiring });
  const ACTOR = { ownerId: 'u1', tenantId: 't1' };

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`超时 ${ms}ms: ${label}`)), ms).unref?.(),
      ),
    ]);

  /** 签单 → owner 批准 → 带单执行（Agent 链三步，与 executor 同构） */
  const approvedExecute = async (method, params, summary) => {
    const ticket = wiring.requestActionForAgent(manager.session.panelId, ACTOR, method, summary);
    wiring.approveActionAsOwner(manager.session.panelId, ticket.actionId);
    return wiring.sendCDPForAgent(
      manager.session.panelId, ACTOR, method, params,
      { approvedActionId: ticket.actionId },
    );
  };

  /** 等 strip 页面加载完（loadFile 异步，过早 executeJavaScript 拿到空白文档） */
  async function waitStripReady() {
    const wc = manager.stripView.webContents;
    for (let i = 0; i < 40; i++) {
      try {
        const ready = await wc.executeJavaScript('document.readyState === "complete" && !!document.getElementById("tabbar")');
        if (ready) return true;
      } catch {}
      await sleep(150);
    }
    return false;
  }

  /** 在 strip 里读 tab 条 DOM 状态 */
  const readTabbar = () =>
    manager.stripView.webContents.executeJavaScript(`(() => {
      const bar = document.getElementById('tabbar');
      const tabs = [...bar.querySelectorAll('.tab')];
      return {
        shown: bar.classList.contains('show'),
        count: tabs.length,
        activeIndex: tabs.findIndex((t) => t.classList.contains('active')),
        labels: tabs.map((t) => (t.querySelector('.t') || {}).textContent || ''),
      };
    })()`);

  /** strip 里真实点击：what='switch' 点 tab 主体（.t），what='close' 点 ✕ */
  const clickTab = (i, what = 'switch') =>
    manager.stripView.webContents.executeJavaScript(`(() => {
      const tabs = [...document.querySelectorAll('#tabbar .tab')];
      const el = tabs[${i}];
      if (!el) return { clicked: false, reason: 'not-found' };
      const target = ${what === 'close' ? "el.querySelector('.x')" : "el.querySelector('.t')"};
      if (!target) return { clicked: false, reason: 'no-target' };
      target.click();
      return { clicked: true, what: ${JSON.stringify(what)} };
    })()`);

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
    // ---- S1 open ----
    manager.open({ url: urlA, ownerId: 'u1', tenantId: 't1' });
    await sleep(1000);
    const stripReady = await waitStripReady();
    const bar0 = stripReady ? await readTabbar() : null;
    record(
      'S1 面板 open + strip 就绪；单 tab 时 tab 条隐藏（零干扰）',
      manager.panelWebContents()?.getURL().includes('/page-a') && bar0?.shown === false && bar0?.count === 0,
      { stripReady, bar0 },
    );

    // ---- S2 Agent 链 new tab → tab 条出现 ----
    try {
      await approvedExecute('Panel.tabs', { operation: 'new' }, { label: '标签页操作', operation: 'new' });
      await sleep(400);
      const bar = await readTabbar();
      record(
        'S2 Agent new tab（审批链）→ strip tab 条出现 2 个 tab、active 高亮第 2 个',
        bar?.shown === true && bar?.count === 2 && bar?.activeIndex === 1,
        { bar },
      );
    } catch (error) {
      record('S2 Agent new tab（审批链）→ tab 条出现', false, { error: error.message });
    }

    // ---- S3 strip 真实点击 tab0 → 切换 ----
    try {
      const click = await clickTab(0);
      await sleep(300);
      const bar = await readTabbar();
      const url = manager.panelWebContents().getURL();
      record(
        'S3 strip 真实点击 tab0 → active 切换、panelView 换绑、URL=A、高亮第 1 个',
        click?.clicked && bar?.activeIndex === 0 && url.includes('/page-a') &&
          manager.session.currentUrl.includes('/page-a'),
        { click, bar, url, currentUrl: manager.session.currentUrl },
      );
    } catch (error) {
      record('S3 strip 真实点击 tab0 → 切换', false, { error: error.message });
    }

    // ---- S4 strip 点 ✕ 关 tab1 → 回单 tab、tab 条隐藏 ----
    try {
      const click = await clickTab(1, 'close'); // tabs[1] 的 ✕ → close
      await sleep(300);
      const bar = await readTabbar();
      record(
        'S4 strip 点 ✕ 关 tab1 → 台账 1、tab 条隐藏（单 tab 零干扰）',
        click?.what === 'close' && manager._panelTabs.length === 1 &&
          bar?.shown === false,
        { click, bar, tabs: manager._panelTabs.length },
      );
    } catch (error) {
      record('S4 strip 点 ✕ 关 tab1', false, { error: error.message });
    }

    // ---- S5 Agent 链 new + goto B → tab 条 2 个、标题=B ----
    try {
      await approvedExecute('Panel.tabs', { operation: 'new' }, { label: '标签页操作', operation: 'new' });
      await approvedExecute('Page.navigate', { url: urlB }, { label: '导航', url: urlB });
      await sleep(600);
      const bar = await readTabbar();
      record(
        'S5 Agent new+goto B → tab 条 2 个、active=1、tab 标签含 page-b-title',
        bar?.shown === true && bar?.count === 2 && bar?.activeIndex === 1 &&
          (bar?.labels?.[1] || '').includes('page-b-title'),
        { bar },
      );
    } catch (error) {
      record('S5 Agent new+goto B → tab 条同步', false, { error: error.message });
    }

    // ---- S6 越界防护：invoke switch-tab 9 → success:false ----
    try {
      const out = await manager.stripView.webContents.executeJavaScript(
        `window.browserControl.invoke('browser-panel:switch-tab', 9).then((r) => r).catch((e) => ({ success: false, thrown: String(e) }))`,
      );
      // 语义：stripOnly 包装 success:true（handler 内已转错误对象不抛），ok:false 带原因
      record(
        'S6 越界防护：switch-tab 9 → result.ok=false 带原因（UI 通道不抛不炸）',
        out?.success === true && out?.result?.ok === false && /不存在/.test(out?.result?.error || ''),
        { out },
      );
    } catch (error) {
      record('S6 越界防护', false, { error: error.message });
    }

    // ---- S7 strip 高度：多 tab 66 / 关回单 tab 40 ----
    try {
      const h2 = manager.stripView.getBounds().height;
      await approvedExecute('Panel.tabs', { operation: 'close', index: 1 }, { label: '标签页操作', operation: 'close', index: 1 });
      await sleep(300);
      const h1 = manager.stripView.getBounds().height;
      record(
        'S7 strip 动态高度：多 tab 66 → 单 tab 40',
        h2 === 66 && h1 === 40,
        { h2, h1 },
      );
    } catch (error) {
      record('S7 strip 动态高度', false, { error: error.message });
    }

    // ---- S8 Agent 作用于用户当前看的 tab（同页证明收尾）----
    try {
      // 回到单 tab（S7 已关），goto A 再 evaluate——Agent 与用户同页
      const ticket = wiring.requestActionForAgent(manager.session.panelId, ACTOR, 'Page.navigate', { label: '导航', url: urlA });
      wiring.approveActionAsOwner(manager.session.panelId, ticket.actionId);
      await wiring.sendCDPForAgent(manager.session.panelId, ACTOR, 'Page.navigate', { url: urlA }, { approvedActionId: ticket.actionId });
      await sleep(600);
      const title = await activeTitle();
      record(
        'S8 Agent 动作作用于用户当前 tab（evaluate #title=page-a-title）',
        title === 'page-a-title',
        { title, url: manager.panelWebContents()?.getURL() },
      );
    } catch (error) {
      record('S8 Agent 动作作用于用户当前 tab', false, { error: error.message });
    }
  } finally {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    const failed = checks.filter((c) => !c.pass).length;
    console.log(`\nSTAGE15 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
    console.log(`evidence: ${evidencePath}`);
    try { wiring.dispose(); } catch {}
    try { manager.destroy(); } catch {}
    try { win.destroy(); } catch {}
    try { server.close(); } catch {}
    app.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error('STAGE15 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
