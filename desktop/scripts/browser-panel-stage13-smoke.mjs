#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage13-smoke.mjs — 阶段 7 续（第十二轮）：screenshot 真机冒烟
 *
 * 验证命题：面板模式 screenshot 走 Page.captureScreenshot（READONLY_METHODS，
 * 免单通道，同 extract/probe）——无单直接执行成功；真机返回真实 PNG（魔数+
 * 合理尺寸）；binding 反映当前页面；readonly 无台账副作用；事件流不含 base64
 * 数据（只进 result 专用字段）；面板销毁后显式失败不回退。
 *
 * 8 项检查：
 *   S1 面板 open fixture A（真实 BrowserPanelManager）
 *   S2 screenshot 无单直接执行 → 成功（免单证明：不 requestAction 不 approve）
 *   S3 PNG 魔数校验（base64 以 iVBORw0KGgo 开头）
 *   S4 截图尺寸合理（base64 > 5000 字符，1600x900 面板不可能小图）
 *   S5 goto B（批准放行）后再截图 → binding.url 含 page-b（fresh binding）
 *   S6 连续两张截图均成功 + tabCount 保持 1（readonly 无台账副作用）
 *   S7 事件流不含 base64（listEventsForAgent 序列化无 PNG 数据；销毁前查）
 *   S8 面板销毁后截图 → 显式抛错（fail-closed，不回退）
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage13-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage13-evidence-<timestamp>.json
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
const evidencePath = path.join(evidenceDir, `stage13-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    scenario: 'stage7 续：screenshot 全链真机（免单 readonly + PNG 校验 + fresh binding + 事件流无数据）',
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
    console.error('STAGE13 WATCHDOG: 120s 强制退出');
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
  const wiring = wireBrowserPanel({ manager });
  const ACTOR = { ownerId: 'u1', tenantId: 't1' };

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`超时 ${ms}ms: ${label}`)), ms).unref?.(),
      ),
    ]);

  /** readonly 免单截图：直接 sendCDPForAgent（不 requestAction 不 approve） */
  const shot = async () =>
    withTimeout(
      wiring.sendCDPForAgent(
        manager.session.panelId, ACTOR, 'Page.captureScreenshot', { format: 'png' }, {},
      ),
      8000,
      'Page.captureScreenshot',
    );

  /** 签单 → owner 批准 → 带单执行（写动作三步，与 executor 行为同构） */
  const approvedExecute = async (method, params, summary) => {
    const ticket = wiring.requestActionForAgent(manager.session.panelId, ACTOR, method, summary);
    wiring.approveActionAsOwner(manager.session.panelId, ticket.actionId);
    return wiring.sendCDPForAgent(
      manager.session.panelId, ACTOR, method, params,
      { approvedActionId: ticket.actionId },
    );
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

    // ---- S2 screenshot 无单直接执行 → 成功（免单证明）----
    let first;
    try {
      first = await shot();
      record(
        'S2 screenshot 无单直接执行 → 成功（readonly 免单通道，同 extract）',
        !!first?.result?.data,
        { dataLen: first?.result?.data?.length ?? 0 },
      );
    } catch (error) {
      record('S2 screenshot 无单直接执行 → 成功（readonly 免单通道，同 extract）', false, { error: error.message });
    }

    // ---- S3 PNG 魔数校验 ----
    try {
      const data = first?.result?.data || '';
      record(
        'S3 PNG 魔数校验（base64 以 iVBORw0KGgo 开头）',
        data.startsWith('iVBORw0KGgo'),
        { head: data.slice(0, 16) },
      );
    } catch (error) {
      record('S3 PNG 魔数校验（base64 以 iVBORw0KGgo 开头）', false, { error: error.message });
    }

    // ---- S4 截图尺寸合理 ----
    try {
      const len = first?.result?.data?.length || 0;
      record(
        'S4 截图尺寸合理（base64 > 5000 字符，1600x900 面板不可能小图）',
        len > 5000,
        { len },
      );
    } catch (error) {
      record('S4 截图尺寸合理（base64 > 5000 字符，1600x900 面板不可能小图）', false, { error: error.message });
    }

    // ---- S5 goto B 后再截图 → binding.url 含 page-b（fresh binding）----
    try {
      await approvedExecute('Page.navigate', { url: urlB }, { label: '导航', url: urlB });
      await sleep(600);
      const done = await shot();
      record(
        'S5 goto B 后再截图 → 成功且 binding.url 含 page-b（fresh binding）',
        !!done?.result?.data && (done.target?.url || '').includes('/page-b'),
        { targetUrl: done?.target?.url, dataLen: done?.result?.data?.length ?? 0 },
      );
    } catch (error) {
      record('S5 goto B 后再截图 → 成功且 binding.url 含 page-b（fresh binding）', false, { error: error.message });
    }

    // ---- S6 连续两张截图均成功 + 台账无副作用 ----
    try {
      const s1 = await shot();
      const s2 = await shot();
      record(
        'S6 连续两张截图均成功 + tabCount 保持 1（readonly 无台账副作用）',
        !!s1?.result?.data && !!s2?.result?.data && manager._panelTabs.length === 1,
        { len1: s1?.result?.data?.length ?? 0, len2: s2?.result?.data?.length ?? 0, tabs: manager._panelTabs.length },
      );
    } catch (error) {
      record('S6 连续两张截图均成功 + tabCount 保持 1（readonly 无台账副作用）', false, { error: error.message });
    }

    // ---- S7 事件流不含 base64（销毁前查）----
    try {
      const events = wiring.listEventsForAgent(manager.session.panelId, ACTOR) || [];
      const serialized = JSON.stringify(events);
      record(
        'S7 事件流不含 base64 数据（readonly completed 只带 method+target）',
        !serialized.includes('iVBORw0KGgo') && serialized.length < 200_000,
        { eventCount: events.length, serializedLen: serialized.length },
      );
    } catch (error) {
      record('S7 事件流不含 base64 数据（readonly completed 只带 method+target）', false, { error: error.message });
    }
    // ---- S8 面板销毁后截图 → 显式抛错（fail-closed）----
    try {
      manager.destroy();
      let destroyed = false;
      try {
        await shot();
      } catch (error) {
        destroyed = true;
      }
      record(
        'S8 面板销毁后截图 → 显式抛错（fail-closed，不回退）',
        destroyed,
        { destroyed },
      );
    } catch (error) {
      record('S8 面板销毁后截图 → 显式抛错（fail-closed，不回退）', false, { error: error.message });
    }

  } finally {
    // 先写证据再收尾（app.exit 后 finally 跑不到——skill 坑 6）
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    const failed = checks.filter((c) => !c.pass).length;
    console.log(`\nSTAGE13 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
    console.log(`evidence: ${evidencePath}`);
    try { wiring.dispose(); } catch {}
    try { win.destroy(); } catch {}
    try { server.close(); } catch {}
    app.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error('STAGE13 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
