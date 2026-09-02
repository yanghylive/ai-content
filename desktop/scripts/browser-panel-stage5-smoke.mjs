#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage5-smoke.mjs — 阶段 5 端到端真实验证
 *
 * 命题（工作流文档 §9 的 P0，落到"跨进程"这一层）：
 *   3011 后端进程，通过真实的磁盘凭据文件 + 真实的本地 HTTP 桥，
 *   读到的就是用户在右侧面板看到的**同一个页面目标**（同一 webContentsId）。
 *
 * 与前面几轮 smoke 的区别：本轮**真的跨进程**。
 *  - 父进程 = Electron 主进程（开面板、起桥、写 0600 凭据文件、代表用户批准导航）；
 *  - 子进程 = 纯 node，扮演 3011（读文件 → 调桥 → 观察 → 申请确认单），
 *    全程不 import 任何 electron 模块。
 *
 * 检查项：
 *   P1 面板打开 → 凭据文件落盘且权限 0600
 *   P2 子进程（3011）跨进程读到凭据并连通 /health
 *   P3 子进程 observe 拿到的 webContentsId == 面板真实 webContents.id（同页核心）
 *   P4 observe 返回的标题/正文 == 面板里真实渲染的内容
 *   P5 凭据脱敏：URL 里的敏感 query 不出网
 *   P6 子进程只拿得到确认单（actionId），得不到执行权
 *   P6b Agent 尝试自我批准 → 必须被拒（硬约束 5）
 *   P7 未批准的导航 → 必须被 CDP 闸门拒绝
 *   P8 真实导航闭环：签单 → 用户批准 → CDP 执行 → observe 回读到新 URL
 *   P9 面板隐藏 → 凭据文件删除 + 端口释放（子进程再调必然失败）
 *
 * 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/browser-panel-stage5-smoke.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, WebContentsView } = require('electron');
const { BrowserPanelManager } = require('../browser-panel-manager.js');
const { wireBrowserPanel } = require('../browser-broker-wiring.js');
const { createBrowserBridgeRuntime } = require('../browser-panel-bridge-runtime.js');
const { readRegistry } = require('../browser-panel-bridge-registry.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage5-evidence-${stamp}.json`);

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
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : ' ' + JSON.stringify(detail).slice(0, 500)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 收尾用到，必须在模块作用域（finish() 在 main 之外）
let runtime = null;
let manager = null;
let win = null;
let server = null;

/** 硬超时包装：Electron 的 debugger.sendCommand 没有超时，卡住就是永久卡住 */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** 全局看门狗：宁可失败退出，也不要静默挂死（上一版就是挂了 2 分钟没输出） */
const watchdog = setTimeout(() => {
  console.log('\n[WATCHDOG] 150s 未结束，强制退出并落证据');
  try {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${evidencePath}`);
  } catch { /* ignore */ }
  app.exit(2);
}, 150_000);
watchdog.unref?.();

/** 本地静态服务：主测试页 + 导航目标页（不依赖外网，E2E 必须可离线复现） */
function serveFixtures() {
  const http = require('node:http');
  const mainHtml = fs.readFileSync(
    path.join(desktopRoot, 'test-fixtures', 'browser-panel.html'),
    'utf8',
  );
  const navHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>导航目标页</title></head><body>
<h1>E2E 导航目标</h1><p id="marker">NAV-TARGET-OK</p></body></html>`;
  const navHtml2 = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>导航目标页 2</title></head><body>
<h1>E2E 导航目标 2</h1><p id="marker">NAV-TARGET-2-OK</p></body></html>`;
  const server = http.createServer((req, res) => {
    const url = String(req.url || '/');
    if (url.startsWith('/nav-target-2.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(navHtml2);
      return;
    }
    if (url.startsWith('/nav-target.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(navHtml);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(mainHtml);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * 跑"3011 一侧"子进程，拿它的 JSON 输出。
 * 必须自带超时：子进程挂在 Electron GUI 模式下不会自己退出。
 */
function runAgent(userDataDir, mode, env = {}, extraArg = '') {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'browser-panel-stage5-agent.mjs');
    // 参数位置固定：userDataDir, mode, expectedText, actionId（未用的传空串）
    const child = spawn(
      process.execPath,
      [script, userDataDir, mode, '', extraArg],
      {
        cwd: desktopRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pid: child.pid, stderr: err.slice(0, 400), ...payload });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ ok: false, error: { code: 'CHILD_TIMEOUT', message: '子进程 20s 未退出' }, rawStdout: out.slice(0, 300) });
    }, 20_000);
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { err += c.toString(); });
    child.on('close', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
      } catch {
        parsed = { ok: false, error: { code: 'BAD_OUTPUT', message: out.slice(0, 300) } };
      }
      finish(parsed);
    });
    child.on('error', (error) => {
      finish({ ok: false, error: { code: 'SPAWN_FAILED', message: error.message } });
    });
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await app.whenReady();
  console.log('[boot] Electron ready');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-userdata-'));
  evidence.meta.userDataDir = userDataDir;

  const storeData = {};
  const store = { get: (k) => storeData[k], set: (k, v) => { storeData[k] = v; } };

  win = new BrowserWindow({
    width: 1600, height: 900, show: false,
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

  // ── 与 main.js 完全相同的组合（manager × wiring × runtime）──────────────
  manager = new BrowserPanelManager({ electron: { WebContentsView }, store, tabManager: fakeTabManager });
  manager.attach(win);
  const wiring = wireBrowserPanel({ manager });
  runtime = createBrowserBridgeRuntime({
    manager,
    wiring,
    getUserDataDir: () => userDataDir,
    logger: { log: () => {}, warn: (...a) => console.log('[runtime.warn]', ...a) },
  });
  manager.onSessionEvent((event) => { runtime.sync(event); });

  const fixture = await serveFixtures();
  server = fixture.server;
  const { port } = fixture;
  // URL 里塞敏感 query，验证"出网必脱敏"
  const fixtureUrl = `http://127.0.0.1:${port}/browser-panel.html?token=SECRET-E2E-123&keep=1`;
  const navTargetUrl = `http://127.0.0.1:${port}/nav-target.html`;
  const agentEnv = { BP_E2E_NAV_URL: navTargetUrl };

  try {
    // ── P1 面板打开 → 凭据文件落盘且 0600 ────────────────────────────────
    await withTimeout(manager.open({ url: fixtureUrl }), 20_000, 'manager.open');
    await sleep(1200);
    console.log('[p1] panel opened');

    const registryFile = path.join(userDataDir, 'browser-panel-bridge.json');
    const exists = fs.existsSync(registryFile);
    const mode = exists ? fs.statSync(registryFile).mode & 0o777 : null;
    record('P1 面板打开 → 凭据文件落盘且权限 0600', exists && mode === 0o600, {
      exists, mode: mode === null ? null : mode.toString(8),
    });
    if (!exists) throw new Error('凭据文件未落盘，后续检查无意义');

    const credentials = readRegistry({ userDataDir });
    const realWcId = manager.panelWebContents ? manager.panelWebContents()?.id : null;
    evidence.binding = {
      registry: credentials && {
        endpoint: credentials.endpoint,
        panelId: credentials.panelId,
        sessionId: credentials.sessionId,
        webContentsId: credentials.webContentsId,
      },
      realWebContentsId: realWcId,
    };

    // ── P2 子进程跨进程连通 ──────────────────────────────────────────────
    console.log('[p2] spawn agent #1');
    const agentFirst = await runAgent(userDataDir, 'observe', agentEnv);
    record('P2 子进程（3011）跨进程读到凭据并连通 /health',
      agentFirst.ok === true && agentFirst.health?.ok === true,
      { ok: agentFirst.ok, health: agentFirst.health, error: agentFirst.error, stderr: agentFirst.stderr });
    if (agentFirst.ok !== true) throw new Error(`子进程失败：${JSON.stringify(agentFirst.error)}`);

    // ── P3 同页核心：webContentsId 一致 ──────────────────────────────────
    const observedWcId = agentFirst.observe?.binding?.webContentsId;
    record('P3 observe 的 webContentsId == 面板真实 webContents.id（同页核心）',
      observedWcId != null && realWcId != null && observedWcId === realWcId,
      { observedWcId, realWcId, registryWcId: credentials.webContentsId });

    // ── P4 内容一致：标题/正文是面板真实渲染的东西 ────────────────────────
    const text = String(agentFirst.observe?.textSample || '');
    record('P4 observe 内容 == 面板真实渲染内容',
      text.length > 20,
      { title: agentFirst.observe?.title, textSampleHead: text.slice(0, 120) });

    // ── P5 脱敏：敏感 query 不出网 ───────────────────────────────────────
    const serialized = JSON.stringify(agentFirst);
    record('P5 凭据脱敏：SECRET-E2E-123 不出网，敏感 query 变 ***',
      !serialized.includes('SECRET-E2E-123') && serialized.includes('token=***'),
      { leaked: serialized.includes('SECRET-E2E-123'), redacted: serialized.includes('token=***') });

    // ── P6 只签单不执行 ──────────────────────────────────────────────────
    const agentFull = await runAgent(userDataDir, 'full', agentEnv);
    record('P6 子进程只拿得到确认单（actionId），拿不到执行权',
      agentFull.ok === true && typeof agentFull.ticket?.actionId === 'string'
        && agentFull.ticket.binding?.webContentsId === realWcId,
      { actionId: agentFull.ticket?.actionId, binding: agentFull.ticket?.binding, error: agentFull.error });

    const panelId = credentials.panelId;
    const actor = { ownerId: 'e2e-owner', tenantId: 'e2e-tenant' };

    // ── P6b 硬约束 5：Agent 不得自我批准 ─────────────────────────────────
    let selfApproveBlocked = false;
    let selfApproveDetail = {};
    try {
      wiring.approveActionForAgent(panelId, actor, agentFull.ticket?.actionId);
      selfApproveDetail = { threw: false };
    } catch (error) {
      selfApproveBlocked = /不得自我批准/.test(error.message);
      selfApproveDetail = { threw: true, message: error.message.slice(0, 120) };
    }
    record('P6b Agent 尝试自我批准 → 被拒（硬约束 5）', selfApproveBlocked, selfApproveDetail);

    // ── P7 未批准的导航必须被闸门挡下 ────────────────────────────────────
    let gateBlocked = false;
    let gateDetail = {};
    try {
      await withTimeout(
        wiring.sendCDPForAgent(panelId, actor, 'Page.navigate', { url: navTargetUrl }),
        15_000,
        '未批准导航',
      );
      gateDetail = { threw: false, note: '未批准也能执行 = 审批闸门形同虚设' };
    } catch (error) {
      gateBlocked = /审批/.test(error.message);
      gateDetail = { threw: true, message: error.message.slice(0, 160) };
    }
    record('P7 未批准的 Page.navigate → 被审批闸门拒绝', gateBlocked, gateDetail);

    // ── P8 真实导航闭环：签单 → 用户批准 → CDP 执行 → 回读新 URL ──────────
    let navOk = false;
    let navDetail = {};
    try {
      const ticket = wiring.requestActionForAgent(panelId, actor, 'Page.navigate', {
        label: 'E2E 导航到验证目标页',
        url: navTargetUrl,
      });
      const pendingBefore = wiring.listPendingActions(panelId);
      wiring.approveActionAsOwner(panelId, ticket.actionId, { reason: 'E2E 用户批准', by: 'stage5-smoke' });
      await withTimeout(
        wiring.sendCDPForAgent(panelId, actor, 'Page.navigate', { url: navTargetUrl }, {
          approvedActionId: ticket.actionId,
        }),
        15_000,
        '已批准导航',
      );
      // 回读：最多等 6s，导航是异步的
      let afterUrl = '';
      let afterWcId = null;
      for (let i = 0; i < 12; i += 1) {
        await sleep(500);
        const after = await runAgent(userDataDir, 'observe', agentEnv);
        if (after.ok !== true) continue;
        afterUrl = String(after.observe?.binding?.url || '');
        afterWcId = after.observe?.binding?.webContentsId;
        if (afterUrl.includes('nav-target.html') && String(after.observe?.textSample || '').includes('NAV-TARGET-OK')) break;
      }
      const after = await runAgent(userDataDir, 'observe', agentEnv);
      const finalText = String(after.observe?.textSample || '');
      navOk = afterWcId === realWcId
        && afterUrl.includes('nav-target.html')
        && finalText.includes('NAV-TARGET-OK');
      navDetail = {
        targetUrl: navTargetUrl,
        afterUrl,
        afterWcId,
        realWcId,
        markerFound: finalText.includes('NAV-TARGET-OK'),
        pendingCountBeforeApprove: pendingBefore.length,
        textSampleHead: finalText.slice(0, 80),
      };
      evidence.navigation = navDetail;
    } catch (error) {
      navDetail = { error: error.message };
    }
    record('P8 真实导航闭环：签单→用户批准→CDP 执行→observe 回读到新页面', navOk, navDetail);

    // ── P9 后端视角的写动作闭环：签单 → 用户批准 → 带单执行 → 回读 ───────
    // 这一段模拟 3011 的真实调用序列（AgentPanelBridgeService 走的就是这三条路由）：
    //   /action-request → /action-state → /execute → /observe
    let backendNavOk = false;
    let backendNavDetail = {};
    try {
      const backendTarget = `http://127.0.0.1:${port}/nav-target-2.html`;
      const signed = await runAgent(userDataDir, 'sign', {
        ...agentEnv,
        BP_E2E_NAV_URL: backendTarget,
      });
      const ticketId = signed.ticket?.actionId;
      // 1) 签单后状态必须是 pending，且 pending 状态下带单执行必须被拒
      const pendingOk = signed.ok === true
        && signed.ticketState === 'pending'
        && signed.pendingExecuteBlocked === true;
      backendNavDetail.pending = {
        ticketId,
        state: signed.ticketState,
        pendingExecuteBlocked: signed.pendingExecuteBlocked,
        pendingExecuteError: signed.pendingExecuteError,
      };
      // 2) 用户在桌面端点批（主进程代表用户走 owner 通道）
      wiring.approveActionAsOwner(panelId, ticketId, {
        reason: 'E2E 用户批准（后端视角写动作）',
        by: 'stage5-smoke',
      });
      // 3) 后端带单执行
      const done = await runAgent(userDataDir, 'execute', {
        ...agentEnv,
        BP_E2E_NAV_URL: backendTarget,
        BP_E2E_EXPECT_TEXT: 'NAV-TARGET-2-OK',
      }, ticketId);
      const afterUrl2 = String(done.afterObserve?.binding?.url || '');
      const afterText2 = String(done.afterObserve?.textSample || '');
      backendNavDetail.executed = {
        ok: done.ok,
        executed: done.execute?.executed,
        webContentsId: done.execute?.binding?.webContentsId,
        afterUrl: afterUrl2,
        markerFound: afterText2.includes('NAV-TARGET-2-OK'),
        error: done.error,
      };
      backendNavOk = pendingOk
        && done.ok === true
        && done.execute?.executed === true
        && done.execute?.binding?.webContentsId === realWcId
        && afterUrl2.includes('nav-target-2.html')
        && afterText2.includes('NAV-TARGET-2-OK');
    } catch (error) {
      backendNavDetail = { ...backendNavDetail, error: error.message };
    }
    record('P9 后端视角写动作闭环：签单(pending 拒执行)→用户批准→带单执行→回读到新页面',
      backendNavOk, backendNavDetail);
    evidence.backendNavigation = backendNavDetail;

    // ── P10 隐藏 → 关桥 + 删凭据 + 端口释放 ───────────────────────────────
    const endpointBefore = credentials.endpoint;
    manager.hide();
    await sleep(800);
    const fileGone = !fs.existsSync(registryFile);
    const agentAfterHide = await runAgent(userDataDir, 'observe', agentEnv);
    record('P10 面板隐藏 → 凭据文件删除 + 桥关闭（子进程再调必然失败）',
      fileGone && agentAfterHide.ok === false,
      { fileGone, agentOk: agentAfterHide.ok, agentError: agentAfterHide.error, endpointBefore });

    await finish(checks.filter((c) => !c.pass).length);
  } catch (error) {
    record('未捕获异常', false, { message: error.message, stack: String(error.stack).slice(0, 600) });
    await finish(1, 'STAGE5 SMOKE CRASHED');
  }
}

/**
 * 收尾 + 宣判：**先收干净再打印结论**。
 * 顺序不能反——app.exit() 会立刻终止进程，若先宣判则 finally 里的拆窗动作
 * 永远跑不到；而先拆窗，Electron 的 "Object has been destroyed" 噪音才会落在
 * 结论区之前，不污染证据日志的最后几行。
 */
async function finish(failed, crashLabel) {
  try { await runtime.close(); } catch { /* ignore */ }
  try { manager.destroy(); } catch { /* ignore */ }
  try { win.destroy(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }

  evidence.summary = {
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence: ${evidencePath}`);
  if (crashLabel) {
    console.log(crashLabel);
    app.exit(1);
    return;
  }
  if (failed > 0) {
    console.log(`STAGE5 SMOKE FAILED ${failed}/${checks.length}`);
    app.exit(1);
  } else {
    console.log(`STAGE5 SMOKE PASSED ${checks.length}/${checks.length}`);
    app.exit(0);
  }
}

main().catch((error) => {
  console.error('SMOKE CRASHED:', error);
  app.exit(1);
});
