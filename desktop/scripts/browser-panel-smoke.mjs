#!/usr/bin/env node
'use strict';
/**
 * browser-panel-smoke.mjs — 阶段 1 P0 同页控制技术验证（工作流文档 §4 阶段 1）
 *
 * 验证命题（文档 §9）：
 *   用户在右侧看到的页面、Agent 读取的页面、Agent 执行动作的页面、截图证据对应的页面，
 *   必须由同一个 session 和同一个页面目标（webContentsId）产生。
 *
 * 7 项检查：
 *   C1 WebContentsView 加载 fixture
 *   C2 webContents.debugger CDP attach
 *   C3 读 URL/标题/DOM 快照（Accessibility）
 *   C4 真实 CDP 点击 / 输入 / 键盘 + 截图
 *   C5 "用户通道"操作后 Agent 侧读到同一变化（同帧 DOM）
 *   C6 Agent 操作在视图侧可见（页面 URL/webContentsId 一致 + 渲染器存活）
 *   C7 新 tab 被拦截可观测 / 导航失败状态可读
 *
 * 运行：
 *   ELECTRON_RUN_AS_NODE= node_modules/.bin/electron scripts/browser-panel-smoke.mjs
 *   （需要能创建窗口；CI/headless 场景本机 macOS 可用）
 *
 * 输出：docs/browser-panel-baseline/smoke-evidence-<timestamp>.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const {
  app,
  BrowserWindow,
  WebContentsView,
  session: electronSession,
} = require('electron');
const { BrowserPanelBroker } = require('../browser-panel-broker.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const fixturePath = path.join(desktopRoot, 'test-fixtures', 'browser-panel.html');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `smoke-evidence-${stamp}.json`);

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    fixture: path.relative(repoRoot, fixturePath),
  },
  checks,
  events: [],
  binding: null,
  screenshots: [],
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}`);
  if (!pass && detail) console.log(`       detail: ${JSON.stringify(detail).slice(0, 400)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const html = fs.readFileSync(fixturePath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
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
    show: true, // 必须可见：隐藏窗口无合成帧 → captureScreenshot/输入派发会挂起
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const blankView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.contentView.addChildView(blankView);
  blankView.setBackgroundColor('#222');
  blankView.setBounds({ x: 0, y: 0, width: 200, height: 60 });

  // ---- Broker：会话与权限事实源（webContentsResolver 注入真实视图映射）----
  const views = new Map();
  const broker = new BrowserPanelBroker({
    webContentsResolver: (panelId) => views.get(panelId) || null,
  });
  const { panelId, sessionId, capabilityToken } = broker.createPanel({
    panelId: 'panel-p0',
    sessionId: 'sess-p0-001',
    ownerId: 'user-p0',
    tenantId: 'tenant-p0',
    platform: 'general-web',
  });

  // ---- C1: WebContentsView 加载（独立持久 partition，按账号隔离）----
  const panelSession = await electronSession.fromPartition(
    'persist:kaypal-browser-user-p0',
  );
  void panelSession; // partition 可用性本身也是检查点
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:kaypal-browser-user-p0',
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 200, y: 0, width: 700, height: 700 });
  views.set(panelId, view.webContents);

  let loadFailed = null;
  const loaded = new Promise((resolve, reject) => {
    view.webContents.once('did-finish-load', resolve);
    view.webContents.once('did-fail-load', (_e, code, desc) =>
      reject(new Error(`${code} ${desc}`)),
    );
    setTimeout(() => reject(new Error('load timeout 10s')), 10_000).unref?.();
  });
  view.webContents.loadURL(baseUrl);
  try {
    await loaded;
    record('C1 WebContentsView 加载 fixture', true, { url: view.webContents.getURL() });
  } catch (error) {
    loadFailed = error.message;
    record('C1 WebContentsView 加载 fixture', false, { error: loadFailed });
  }

  // ---- C2: debugger attach ----
  let attached = false;
  try {
    view.webContents.debugger.attach('1.3');
    attached = view.webContents.debugger.isAttached();
  } catch (error) {
    record('C2 CDP attach', false, { error: error.message });
  }
  if (attached) record('C2 webContents.debugger CDP attach', true, { version: '1.3' });

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`CDP 超时 ${ms}ms: ${label}`)), ms).unref?.(),
      ),
    ]);
  const dbg = (method, params) =>
    withTimeout(view.webContents.debugger.sendCommand(method, params), 8000, method);
  const probe = () =>
    view.webContents.executeJavaScript('window.__panelProbe()');

  // ---- C3: URL/标题/DOM 快照 ----
  const target = broker.resolveTarget(panelId, capabilityToken);
  evidence.binding = {
    panelId,
    sessionId,
    webContentsId: view.webContents.id,
    brokerResolved: target,
    sameWebContents: target.webContentsId === view.webContents.id,
    sameSession: target.sessionId === sessionId,
  };
  const snapshotChecks = [];
  try {
    const title = view.webContents.getTitle();
    const url = view.webContents.getURL();
    // DOM.getDocument 返回 { root: Node }（不是 nodes）
    const domDoc = await dbg('DOM.getDocument');
    const ax = await dbg('Accessibility.enable').then(() =>
      dbg('Accessibility.getFullAXTree').catch(() => ({ nodes: [] })),
    );
    const hasDomRoot = !!(domDoc && domDoc.root && domDoc.root.nodeId);
    snapshotChecks.push({
      title,
      url,
      domRoot: hasDomRoot,
      axNodes: ax.nodes?.length || 0,
    });
    record(
      'C3 读 URL/标题/DOM 快照（含 AX 树）',
      title === 'BrowserPanel P0 Fixture' && hasDomRoot && (ax.nodes?.length || 0) > 0,
      snapshotChecks[0],
    );
  } catch (error) {
    record('C3 读 URL/标题/DOM 快照', false, { error: error.message });
  }

  // CDP 通道封装：Broker 的确认单是一次性的——每条 CDP 写命令
  // 都要独立走 request→approve→send，不允许复用 actionId。
  async function cdpAction(method, params, summary) {
    const { actionId } = broker.requestAction(
      panelId,
      capabilityToken,
      method,
      summary,
    );
    broker.approveAction(actionId, capabilityToken, capabilityToken);
    return broker.sendCDP(panelId, capabilityToken, method, params, {
      approvedActionId: actionId,
    });
  }

  // ---- C4: 真实 CDP 点击（经 Broker 审批闸门）----
  const hashOf = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  try {
    const before = await probe();
    // 用 CDP 获取按钮真实坐标（DOM → 布局坐标）
    const box = await dbg('Runtime.evaluate', {
      expression: `(() => { const r = document.getElementById('inc').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      returnByValue: true,
    });
    const { x, y } = box.result.value;
    await cdpAction(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button: 'left', clickCount: 1 },
      { label: '按下 +1', x, y },
    );
    await cdpAction(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
      { label: '释放 +1', x, y },
    );
    const after = await probe();
    record(
      'C4a CDP 真实点击 → 页面状态变化（计数 +1）',
      Number(after.counter) === Number(before.counter) + 1,
      { before: before.counter, after: after.counter, x, y },
    );

    // CDP 输入文本 + Enter 键
    const inputBox = await dbg('Runtime.evaluate', {
      expression: `(() => { const r = document.getElementById('field').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      returnByValue: true,
    });
    const ix = inputBox.result.value.x;
    const iy = inputBox.result.value.y;
    await cdpAction(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: ix, y: iy, button: 'left', clickCount: 1 },
      { label: '聚焦输入框按下' },
    );
    await cdpAction(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: ix, y: iy, button: 'left', clickCount: 1 },
      { label: '聚焦输入框释放' },
    );
    await cdpAction('Input.insertText', { text: 'agent-typed' }, { label: '输入文本' });
    await cdpAction(
      'Input.dispatchKeyEvent',
      { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      { label: '回车按下' },
    );
    await cdpAction(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      { label: '回车释放' },
    );
    const afterInput = await probe();
    record(
      'C4b CDP 输入文本 + 键盘事件 → 页面读取一致',
      afterInput.keylog === 'enter:agent-typed',
      { keylog: afterInput.keylog },
    );

    // 截图证据
    const shot = await dbg('Page.captureScreenshot', { format: 'png' });
    const shotBuf = Buffer.from(shot.data, 'base64');
    const shotPath = path.join(evidenceDir, `smoke-screenshot-${stamp}.png`);
    fs.writeFileSync(shotPath, shotBuf);
    evidence.screenshots.push({
      file: path.relative(repoRoot, shotPath),
      sha256_16: hashOf(shotBuf),
      bytes: shotBuf.length,
      webContentsId: view.webContents.id,
    });
    record('C4c CDP 截图产出证据文件', shotBuf.length > 1000, { bytes: shotBuf.length });
  } catch (error) {
    record('C4 CDP click/input/screenshot', false, { error: error.message });
  }

  // ---- C5: 用户通道操作 → Agent 侧同一变化 ----
  try {
    await view.webContents.executeJavaScript('window.__simulateUserTyping("user-typed-abc")');
    const viaDebugger = await dbg('Runtime.evaluate', {
      expression: 'document.getElementById("userops").textContent',
      returnByValue: true,
    });
    const viaPreload = await probe();
    record(
      'C5 用户操作（页面内事件）→ CDP 侧读到同一变化',
      viaDebugger.result.value === 'input:user-typed-abc' && viaPreload.field === 'user-typed-abc',
      {
        cdp: viaDebugger.result.value,
        inPage: viaPreload.field,
      },
    );
  } catch (error) {
    record('C5 用户→Agent 同帧一致性', false, { error: error.message });
  }

  // ---- C6: Agent 操作在视图侧可见 ----
  try {
    // 拿页面当前 URL 与 Broker 侧记录 URL 比对（同一视图实时同步）
    const inPageUrl = (await probe()).url;
    const brokerUrl = broker.resolveTarget(panelId, capabilityToken).url;
    const sameDoc = await dbg('Runtime.evaluate', {
      expression: 'document.getElementById("field").value',
      returnByValue: true,
    });
    record(
      'C6 Agent 操作对视图实时可见（URL 一致 + 页面值同一文档）',
      inPageUrl === brokerUrl && sameDoc.result.value === 'user-typed-abc',
      { inPageUrl, brokerUrl, fieldValue: sameDoc.result.value },
    );
  } catch (error) {
    record('C6 视图一致性', false, { error: error.message });
  }

  // ---- C7: 新 tab 拦截 / 导航失败 / 崩溃可观测 ----
  try {
    let intercepted = null;
    view.webContents.setWindowOpenHandler((details) => {
      intercepted = details.url;
      return { action: 'deny' };
    });
    await view.webContents.executeJavaScript('window.__openTab()');
    await sleep(200);
    record(
      'C7a 新 tab 被拦截且可观测',
      !!intercepted,
      { interceptedUrl: intercepted },
    );

    const failEvents = [];
    const onError = (_e, code, desc) => failEvents.push({ code, desc });
    view.webContents.on('did-fail-load', onError);
    await view.webContents.loadURL('http://127.0.0.1:59999/does-not-exist').catch(() => undefined);
    await sleep(500);
    view.webContents.off('did-fail-load', onError);
    record(
      'C7b 导航失败状态可读',
      failEvents.length > 0,
      { failEvents },
    );
    // 回到 fixture
    await view.webContents.loadURL(baseUrl);
    await sleep(300);
    record('C7c 失败后可恢复', view.webContents.getURL() === baseUrl, {
      url: view.webContents.getURL(),
    });
  } catch (error) {
    record('C7 异常路径可观测', false, { error: error.message });
  }

  // ---- 汇总 ----
  evidence.events = broker.listEvents(panelId, capabilityToken);
  try { view.webContents.debugger.detach(); } catch { /* ignore */ }
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence: ${evidencePath}`);

  const passed = checks.filter((c) => c.pass).length;
  const allPassed = passed === checks.length && checks.length > 0;
  console.log(`\nSMOKE ${allPassed ? 'PASSED' : 'FAILED'} ${passed}/${checks.length} (electron ${process.versions.electron})`);
  server.close();
  app.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('SMOKE CRASHED:', error);
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, crashed: String(error) }, null, 2));
  } catch { /* ignore */ }
  app.exit(1);
});
