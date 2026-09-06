'use strict';
/**
 * browser-panel-bridge-runtime.js — 面板上行桥的「生命周期编排」
 *
 * 抽出来的原因：main.js 与阶段 5 的端到端脚本必须跑**同一套**组合
 * （manager × wiring × bridge server × registry），否则 E2E 验的是副本、
 * 生产跑的是另一份，等于没验。
 *
 * 生命周期规则（2026-09-05 语义修订 + 2026-09-06 心跳续期）：
 *   面板 opened / shown   → 起桥（新随机端口 + 新随机 token）+ 写 0600 凭据文件
 *   面板 hidden / destroyed / account-switched → **不关桥、不删凭据**（桥与 App
 *     同生命周期，引擎经 panel-open 复用；业务写权限由 Broker 的 capability
 *     token 撤销兜底）
 *   面板真正关闭（App 退出）→ 关桥 + 删凭据文件
 *
 * 凭据续期：桥活着期间每 15 分钟心跳刷新 startedAt（凭据文件 60min 老化窗口），
 * 避免面板静置 1 小时后被 3011 判 PANEL_UNAVAILABLE 降级 spawn。
 */
const { startBrowserBridge } = require('./browser-agent-bridge-server');
const { writeRegistry, clearRegistry } = require('./browser-panel-bridge-registry');

// 2026-09-06：凭据 startedAt 心跳刷新周期（15 分钟，须 < 3011 侧 60min 老化窗口）
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

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
  // 2026-09-04 真机修复：原 `syncing` 布尔守卫会**直接丢弃**并发到达的事件——
  // hide 后立刻 open（脚本/快速操作）时 'hidden' 的同步还在飞，紧随的 'opened'
  // 被 skipped → 桥没重启、凭据文件没写回 → 面板开着但 agent 链路全断（health
  // 读不到 registry → isAlive=false → needs-human）。改为**串行队列**：事件逐个
  // 按序消化，一个都不丢（hidden 的 close 先完成，opened 的 ensure 再执行）。
  let syncQueue = Promise.resolve();

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
          startHeartbeat();
          return started;
        })
        .catch((error) => {
          startPromise = null;
          throw error;
        });
    }
    return startPromise;
  }

  // 2026-09-06 修复（面板 1 小时后 PANEL_UNAVAILABLE 根因）：桥凭据文件里的
  // startedAt 只在「面板状态变化」时刷新（writeCredentials），面板静置 1 小时
  // 后凭据被 3011 判老化（DEFAULT_MAX_AGE_MS=60min）→ 引擎降级 spawn 外部窗口。
  // 加定时心跳：只要桥活着，每 15 分钟刷一次凭据 startedAt，凭据永不过期。
  let heartbeatTimer = null;
  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (!bridge) return;
      try {
        writeCredentials();
      } catch (error) {
        warn(`[BrowserPanel] 心跳刷新凭据失败：${error && error.message}`);
      }
    }, HEARTBEAT_INTERVAL_MS);
    if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref();
    }
  }
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  /**
   * 关桥 = 停监听 + 销毁 token + 删凭据文件。幂等。
   * 即使启动还没完成（startPromise 在飞）也要能收干净。
   */
  async function close() {
    stopHeartbeat();
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

  async function _syncNow(event) {
    const type = event && event.type;
    try {
      // 2026-09-05 复核修正（语义变更，如实交底）：桥与 App 同生命周期——
      // hidden/destroyed/account-switched 不再关桥删凭据。原语义「面板不可见
      // = agent 链路收口」会把引擎逼回「兜底 spawn 外部窗口」（大王持续报的
      // 弹窗问题根因之一）；现在引擎经 panel-open（token+nonce+域名白名单
      // 把守）可随时把面板重新展开，任务执行时面板对用户可见，可见性反而
      // 更强。before-quit 仍走 close() 统一收口，磁盘不留 token。
      await ensure();
      const wrote = writeCredentials();
      if (type === 'opened' || type === 'shown') {
        log(`[BrowserPanel] 桥就绪 ${bridge ? bridge.endpoint : '-'}（凭据文件写入${wrote ? '成功' : '失败'}）`);
        return { action: 'started', type, endpoint: bridge ? bridge.endpoint : null, wrote };
      }
      return { action: 'kept', type, wrote };
    } catch (error) {
      warn(`[BrowserPanel] 桥生命周期同步失败：${error && error.message}`);
      await close().catch(() => {});
      return { action: 'failed', type, error: error && error.message };
    }
  }

  /**
   * 依据面板会话事件同步桥状态（串行队列，事件不丢）。
   * @param {{type: string}} event
   */
  function sync(event) {
    const type = event && event.type;
    if (!type) return Promise.resolve({ action: 'skipped', type });
    const result = syncQueue.then(() => _syncNow(event));
    // 队列吞掉失败继续（单事件失败已在 _syncNow 内转为 {action:'failed'}，
    // 这里兜底防队列断链）
    syncQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
