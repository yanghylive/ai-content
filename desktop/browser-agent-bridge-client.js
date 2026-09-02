'use strict';
/**
 * browser-agent-bridge-client.js — 3011 Agent-S 侧调用 desktop 面板上行桥的客户端 SDK
 * （阶段 4 地基的另一半；协议由 browser-agent-bridge-server.js 定义）
 *
 * 设计边界（AGENTS.md）：
 *  - 本 SDK **不改变 Agent-S 的执行路径**。它只是"以后要接的时候怎么安全调用"的
 *    协议实现；真正把 Agent-S 的浏览器动作切到 desktop 同页面板，需要用户单独批准。
 *  - 只允许回环地址（127.0.0.1 / localhost / ::1），禁止落到任意主机；
 *  - token 必填且只存内存，缺失即抛（fail-closed，不静默降级）；
 *  - 每次请求自动生成 nonce + 时间戳（服务端 5 分钟防重放、±60s 时钟偏差）；
 *  - 4xx 一律原样抛 BridgeError，**不重试、不降级、不伪造成功**。
 *
 * 用法：
 *   const client = createBrowserBridgeClient({ endpoint, token });
 *   const obs = await client.observe({ panelId, actor: { ownerId, tenantId } });
 *   const ticket = await client.requestAction({ panelId, actor, method, params, summary });
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const PROTOCOL = 'kaypal-browser-bridge';
const TOKEN_HEADER = 'x-kaypal-bridge-token';
const NONCE_HEADER = 'x-kaypal-bridge-nonce';
const TS_HEADER = 'x-kaypal-bridge-ts';

class BridgeError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.name = 'BridgeError';
    this.code = code;
    this.status = status;
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/**
 * 校验 endpoint：只允许 http/https + 回环地址，默认拒绝。
 * @returns {{protocol: string, hostname: string, port: number}}
 */
function parseEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BridgeError('BAD_ENDPOINT', 0, 'endpoint 不是合法 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BridgeError('BAD_ENDPOINT', 0, 'endpoint 协议只允许 http/https');
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new BridgeError('BAD_ENDPOINT', 0, 'endpoint 只允许回环地址（127.0.0.1/localhost/::1）');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BridgeError('BAD_ENDPOINT', 0, 'endpoint 端口非法');
  }
  return { protocol: url.protocol, hostname: url.hostname, port };
}

function newNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function requestOnce({ protocol, hostname, port }, token, route, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const transport = protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        protocol,
        host: hostname,
        port,
        path: route,
        method,
        headers: {
          [TOKEN_HEADER]: token,
          [NONCE_HEADER]: newNonce(),
          [TS_HEADER]: String(Date.now()),
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          if (res.statusCode >= 200 && res.statusCode < 300 && json && json.success) {
            resolve(json.data);
            return;
          }
          const code = (json && json.error && json.error.code) || 'UNKNOWN';
          reject(new BridgeError(code, res.statusCode, `${method} ${route} 失败：${code}`));
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new BridgeError('TIMEOUT', 0, `${method} ${route} 超时`));
    });
    req.on('error', (error) => {
      if (error instanceof BridgeError) reject(error);
      else reject(new BridgeError('NETWORK_ERROR', 0, `${method} ${route} 网络错误：${error.message}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 创建桥客户端。
 * @param {object} options
 * @param {string} options.endpoint 形如 http://127.0.0.1:54321
 * @param {string} options.token 主进程下发的随机 token（只存内存）
 */
function createBrowserBridgeClient({ endpoint, token } = {}) {
  if (!endpoint) throw new BridgeError('BAD_ENDPOINT', 0, 'endpoint 必填');
  if (!token || typeof token !== 'string') {
    throw new BridgeError('TOKEN_REQUIRED', 0, 'bridge token 必填（缺失即失败，不静默降级）');
  }
  const target = parseEndpoint(endpoint);

  function call(route, method, body, actor) {
    if (route !== '/health' && (!actor || !actor.ownerId || !actor.tenantId)) {
      return Promise.reject(
        new BridgeError('ACTOR_REQUIRED', 400, 'actor.ownerId / actor.tenantId 必填'),
      );
    }
    return requestOnce(target, token, route, method, body);
  }

  return {
    protocol: PROTOCOL,
    endpoint: `${target.protocol}//${target.hostname}:${target.port}`,

    /** 健康检查（免 actor） */
    health() {
      return requestOnce(target, token, '/health', 'GET');
    },

    /** 只读观察：URL/标题/DOM 文本摘要（出网前服务端已脱敏） */
    observe({ panelId, actor } = {}) {
      if (!panelId) {
        return Promise.reject(new BridgeError('PANEL_REQUIRED', 400, 'panelId 必填'));
      }
      return call('/observe', 'POST', { panelId, actor }, actor);
    },

    /**
     * 申请写动作确认单（只签发，不自批）。
     * 返回 { actionId, binding:{ panelId, sessionId, webContentsId } }，
     * 用户批准后才可向 broker 换取一次性放行。
     */
    requestAction({ panelId, actor, method, params, summary } = {}) {
      if (!panelId) {
        return Promise.reject(new BridgeError('PANEL_REQUIRED', 400, 'panelId 必填'));
      }
      if (!method || typeof method !== 'string') {
        return Promise.reject(new BridgeError('METHOD_REQUIRED', 400, 'CDP method 必填'));
      }
      return call(
        '/action-request',
        'POST',
        { panelId, actor, method, params: params || {}, summary: summary || {} },
        actor,
      );
    },
  /**
   * 执行（阶段 5 后端接入缝）。
   * - 只读方法：可直接调用（白名单由 Broker 把守）；
   * - 写方法（Page.navigate / Input.*）：**必须**带 actionId，且该确认单必须
   *   已被桌面端用户批准。缺单/错单/换页后旧单 → Broker 拒绝（fail-closed）。
   * 拿执行权 ≠ 拿批准权：批准永远在用户手上。
   */
  execute({ panelId, actor, method, params, actionId } = {}) {
    if (!panelId) {
      return Promise.reject(new BridgeError('PANEL_REQUIRED', 400, 'panelId 必填'));
    }
    if (!method || typeof method !== 'string') {
      return Promise.reject(new BridgeError('METHOD_REQUIRED', 400, 'CDP method 必填'));
    }
    return call(
      '/execute',
      'POST',
      { panelId, actor, method, params: params || {}, actionId: actionId || null },
      actor,
    );
  },

  /** 待批确认单列表（不含 token） */
  pendingActions({ panelId, actor } = {}) {
    if (!panelId) {
      return Promise.reject(new BridgeError('PANEL_REQUIRED', 400, 'panelId 必填'));
    }
    return call('/pending-actions', 'POST', { panelId, actor }, actor);
  },
  /**
   * 查确认单状态（pending / approved / none）。
   * 后端执行写动作前的合法前置：只有 approved 才允许带单 execute。
   */
  actionState({ panelId, actor, actionId } = {}) {
    if (!panelId) {
      return Promise.reject(new BridgeError('PANEL_REQUIRED', 400, 'panelId 必填'));
    }
    if (!actionId) {
      return Promise.reject(new BridgeError('METHOD_REQUIRED', 400, 'actionId 必填'));
    }
    return call('/action-state', 'POST', { panelId, actor, actionId }, actor);
  },
  };
}

module.exports = {
  createBrowserBridgeClient,
  parseEndpoint,
  BridgeError,
  PROTOCOL,
  TOKEN_HEADER,
  NONCE_HEADER,
  TS_HEADER,
};
