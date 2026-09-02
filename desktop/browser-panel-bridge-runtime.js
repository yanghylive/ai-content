'use strict';
/**
 * browser-panel-bridge-runtime.js — 面板上行桥的「生命周期编排」
 *
 * 抽出来的原因：main.js 与阶段 5 的端到端脚本必须跑**同一套**组合
 * （manager × wiring × bridge server × registry），否则 E2E 验的是副本、
 * 生产跑的是另一份，等于没验。
 *
 * 生命周期规则（安全取舍）：
 *   面板 opened / shown   → 起桥（新随机端口 + 新随机 token）+ 写 0600 凭据文件
 *   面板 hidden / destroyed / account-switched → 关桥 + 删凭据文件
 *
 * 为什么隐藏就要关：①Page.captureScreenshot 在隐藏窗口会挂起、真实输入也不派发，
 * 让 Agent 继续"操作"看不见的页面只会产出假证据；②token 暴露窗口压到最短——
 * 只有面板真正可见的那段时间，磁盘上才存在凭据文件、端口才在监听。
 * 每次重新可见都会换一套端口+token（旧凭据自然失效）。
 */
const { startBrowserBridge } = require('./browser-agent-bridge-server');
const { writeRegistry, clearRegistry } = require('./browser-panel-bridge-registry');

/**
 * @param {object} deps
 * @param {object} deps.manager BrowserPanelManager 实例（提供 publicState / onSessionEvent）
 * @param {object} deps.wiring  wireBrowserPanel 返回值
 * @param {() => string | null} deps.getUserDataDir Electron app.getPath('userData') 的取法
 * @param {{log?: Function, warn?: Function}} [deps.logger]
 */
function createBrowserBridgeRuntime({ manager, wiring, getUserDataDir, logger }) {
  const log = (logger && logger.log) || (() => {});
  const warn = (logger && logger.warn) || (() => {});

  let bridge = null;
  let startPromise = null;
  let syncing = false;

  function registryDir() {
    try {
      return getUserDataDir ? getUserDataDir() : null;
    } catch {
      return null;
    }
  }

  function writeCredentials() {
    const dir = registryDir();
    if (!dir || !bridge) return false;
    const state = manager && typeof manager.publicState === 'function'
      ? manager.publicState()
      : null;
    const session = state && state.session;
    try {
      writeRegistry({
        userDataDir: dir,
        endpoint: bridge.endpoint,
        token: bridge.token,
        panelId: (session && session.panelId) || null,
        sessionId: (session && session.sessionId) || null,
        webContentsId: (session && session.webContentsId) || null,
      });
      return true;
    } catch (error) {
      warn(`[BrowserPanel] 写桥凭据文件失败：${error && error.message}`);
      return false;
    }
  }

  function clearCredentials() {
    const dir = registryDir();
    if (!dir) return false;
    try {
      return clearRegistry({ userDataDir: dir });
    } catch (error) {
      warn(`[BrowserPanel] 清理桥凭据文件失败：${error && error.message}`);
      return false;
    }
  }

  async function ensure() {
    if (bridge) return bridge;
    if (!startPromise) {
      startPromise = startBrowserBridge({ wiring, logger: { warn, error: warn } })
        .then((started) => {
          bridge = started;
          return started;
        })
        .catch((error) => {
          startPromise = null;
          throw error;
        });
    }
    return startPromise;
  }

  /**
   * 关桥 = 停监听 + 销毁 token + 删凭据文件。幂等。
   * 即使启动还没完成（startPromise 在飞）也要能收干净。
   */
  async function close() {
    const pending = startPromise;
    startPromise = null;
    const current = bridge;
    bridge = null;
    clearCredentials();
    if (current) {
      await current.close();
    } else if (pending) {
      try {
        const started = await pending;
        await started.close();
      } catch {
        /* 启动未完成，端口本就没起来 */
      }
    }
  }

  /**
   * 依据面板会话事件同步桥状态。
   * @param {{type: string}} event
   */
  async function sync(event) {
    const type = event && event.type;
    if (!type || syncing) return { action: 'skipped', type };
    syncing = true;
    try {
      if (type === 'opened' || type === 'shown') {
        await ensure();
        const wrote = writeCredentials();
        log(`[BrowserPanel] 桥就绪 ${bridge ? bridge.endpoint : '-'}（凭据文件写入${wrote ? '成功' : '失败'}）`);
        return { action: 'started', type, endpoint: bridge ? bridge.endpoint : null, wrote };
      }
      await close();
      return { action: 'stopped', type };
    } catch (error) {
      warn(`[BrowserPanel] 桥生命周期同步失败：${error && error.message}`);
      await close().catch(() => {});
      return { action: 'failed', type, error: error && error.message };
    } finally {
      syncing = false;
    }
  }

  /** 当前桥信息（仅给主进程内部用；token 绝不经 web/前端通道下发） */
  function info() {
    return bridge
      ? { port: bridge.port, endpoint: bridge.endpoint, token: bridge.token }
      : null;
  }

  return { sync, close, info, ensure, writeCredentials, clearCredentials };
}

module.exports = { createBrowserBridgeRuntime };
