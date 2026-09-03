'use strict';
/**
 * browser-agent-bridge-server.js — 3011 Agent-S ⇄ desktop 面板上行桥（阶段 4 地基）
 *
 * 文档 §3.2：「对 3011 只开放带随机 capability token 的本地 IPC/RPC；不开放裸 CDP」。
 *
 * 安全姿态：
 *  - 仅绑 127.0.0.1，随机端口，启动即生成随机 bridge token；
 *  - 每个请求 timing-safe 比对 `x-kaypal-bridge-token`，缺失/错配 → 401（fail-closed）；
 *  - nonce 防重放（复用 local-bridge 的 createNonceCache + 时间戳时钟偏差校验）；
 *  - **只暴露受控语义端点（health/target/observe），不代理任意 CDP**；写动作
 *    （action/request）走 wiring → Broker 审批闸门，且服务端拒绝自我批准；
 *  - 所有响应 URL 经 wiring/broker 脱敏，token 不出服务端。
 *
 * 阶段 5（用户已批准接入）：新增 `/execute`，但**桥仍没有执行权**——写动作
 * 必须携带用户已批准的确认单 actionId，由 Broker 闸门消费确认单后放行；
 * 确认单的批准权始终在桌面端用户通道，后端拿不到也伪造不了。
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { MUTATION_METHODS } = require('./browser-panel-broker');

const PROTOCOL = 'kaypal-browser-bridge';
const VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_CLOCK_SKEW_MS = 60_000;
const TOKEN_HEADER = 'x-kaypal-bridge-token';
const NONCE_HEADER = 'x-kaypal-bridge-nonce';
const TS_HEADER = 'x-kaypal-bridge-ts';

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // 长度不等也要做一次等长比较，避免通过时序泄漏长度信息
    const dummy = Buffer.alloc(bufA.length);
    crypto.timingSafeEqual(bufA, dummy);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createNonceCache(ttlMs = 5 * 60_000) {
  const seen = new Map();
  return {
    /** @returns {boolean} true=首次出现（放行）；false=重放（拒绝） */
    use(nonce, now = Date.now()) {
      for (const [key, expires] of seen) {
        if (expires < now) seen.delete(key);
      }
      if (!nonce || seen.has(nonce)) return false;
      seen.set(nonce, now + ttlMs);
      return true;
    },
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{
 *   wiring: { resolveTargetForAgent, sendCDPForAgent, requestActionForAgent, listEventsForAgent, hasHandle },
 *   actorResolver?: (req, body) => { ownerId: string, tenantId: string } | null,
 *   logger?: { warn(...a):void, error(...a):void },
 *   port?: number,
 * }} deps
 */
async function startBrowserBridge(deps) {
  const wiring = deps.wiring;
  if (!wiring || typeof wiring.resolveTargetForAgent !== 'function') {
    throw new Error('startBrowserBridge 需要 wiring');
  }
  const logger = deps.logger || console;
  const token = crypto.randomBytes(24).toString('hex');
  const nonceCache = createNonceCache();

  // observe：只读域——URL/标题/可见文本摘要 + 截图（脱敏后回传）
  async function handleObserve(body) {
    const { panelId, actor } = body;
    const target = wiring.resolveTargetForAgent(panelId, actor);
    // 只允许只读观察方法；写动作不在 observe 内
    await wiring.sendCDPForAgent(panelId, actor, 'Page.getFrameTree');
    const evaluated = await wiring.sendCDPForAgent(panelId, actor, 'Runtime.evaluate', {
      expression:
        'JSON.stringify({title:document.title,text:(document.body&&document.body.innerText||"").slice(0,2000)})',
      returnByValue: true,
    });
    let snapshot = {};
    try {
      snapshot = JSON.parse(evaluated.result.result?.value || '{}');
    } catch {
      snapshot = {};
    }
    const redacted = redactTarget(target);
    // 与 action-request 保持同一协议形状：两条路由都回 `binding`，
    // 便于 Agent 侧用一处代码校验"这次观察落在哪个 session/webContents 上"。
    return {
      binding: {
        panelId: redacted.panelId ?? null,
        sessionId: redacted.sessionId ?? null,
        webContentsId: redacted.webContentsId ?? null,
        url: redacted.url ?? null,
      },
      target: redacted,
      title: snapshot.title ?? null,
      textSample: snapshot.text ?? null,
    };
  }

  function redactTarget(target) {
    // 双保险：即便 broker 已脱敏，出网前再过一遍
    if (!target || typeof target !== 'object') return target;
    const out = { ...target };
    if (typeof out.url === 'string') {
      try {
        const url = new URL(out.url);
        for (const [key] of [...url.searchParams.entries()]) {
          if (
            /(^|[_.-])(token|access[_-]?token|auth|apikey|api[_-]key|secret|password|passwd|pwd|code|sid|session[_-]?id)(?:[_.-]|$)/i.test(
              key,
            )
          ) {
            url.searchParams.set(key, '***');
          }
        }
        out.url = url.toString();
      } catch {
        out.url = '[unparseable-url]';
      }
    }
    return out;
  }

  const routes = {
    'GET /health': async () => ({
      protocol: PROTOCOL,
      version: VERSION,
      ok: true,
    }),
    'POST /observe': (body) => handleObserve(body),
    'POST /action-request': (body) => {
      const { panelId, actor, method, summary } = body;
      // 服务端拒绝自我批准：只签发确认单，批准权在用户通道（阶段 4b）
      return wiring.requestActionForAgent(panelId, actor, method, summary);
    },
    /**
     * 执行（阶段 5 后端接入缝）。
     * **桥本身没有执行权**——写动作必须带用户已批准的确认单 actionId，
     * 由 Broker 的审批闸门消费确认单后放行；缺单/错单/换页后旧单一律拒绝。
     * 只读方法可以无单执行（等价 observe 的能力，白名单由 Broker 把守）。
     */
    'POST /execute': async (body) => {
      const { panelId, actor, actionId, method, params } = body;
      if (!method || typeof method !== 'string') {
        throw new Error('CDP method 必填');
      }
      if (MUTATION_METHODS.has(method) && !actionId) {
        throw new Error(
          `写动作 ${method} 必须携带用户已批准的确认单 actionId（fail-closed，桥不自我批准）`,
        );
      }
      const out = await wiring.sendCDPForAgent(
        panelId,
        actor,
        method,
        params || {},
        { approvedActionId: actionId },
      );
      const redacted = redactTarget(out && out.target) || {};
      return {
        binding: {
          panelId: redacted.panelId ?? null,
          sessionId: redacted.sessionId ?? null,
          webContentsId: redacted.webContentsId ?? null,
          url: redacted.url ?? null,
        },
        method,
        executed: true,
        actionId: actionId ?? null,
        // 写动作只回执（+ 脱敏后的落地 URL），不回传原始 CDP 结果：
        // 避免把页面内容/凭据带回后端进程，写动作的证据走桌面端自有证据链。
        // 例外（阶段 7 round11）：Panel.tabs 的 result 是 tab 台账快照
        // {tabs, activeIndex, url}——面板 UI 结构信息，非页面内容/凭据，
        // 后端组装动作 message（"已切到第 N 个/共 M 个"）需要它。
        result:
          MUTATION_METHODS.has(method) && method !== 'Panel.tabs'
            ? null
            : (out.result ?? null),
      };
    },
    /** 待批确认单列表（供桌面端审批 UI / 排障查询；不含 token） */
    'POST /pending-actions': (body) => ({
      items: wiring.listPendingActions ? wiring.listPendingActions(body.panelId) || [] : [],
    }),
    /** 确认单状态查询（后端执行写动作前的合法前置；查询本身不消费确认单） */
    'POST /action-state': (body) => {
      const { panelId, actor, actionId } = body;
      if (!actionId || typeof actionId !== 'string') {
        throw new Error('actionId 必填');
      }
      return (
        wiring.actionStateForAgent?.(panelId, actor, actionId) || {
          actionId,
          state: 'none',
          panelId: null,
          method: null,
          approvedAt: null,
        }
      );
    },
  };

  function fail(res, status, code) {
    const payload = { success: false, error: { code, protocol: PROTOCOL, version: VERSION } };
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  // 连接台账 + 关闭标志：Node 19+ http 默认 keep-alive，server.close() 只停止
  // accept、会等待空闲连接自然结束——不主动销毁的话，close() 返回后旧 socket
  // 仍能复用发请求（退出后桥仍可调）。这里强制销毁所有在途连接 + fail-closed 标志。
  const sockets = new Set();
  let closed = false;
  const server = http.createServer(async (req, res) => {
    try {
      // 0) 已关闭：fail-closed，任何在途请求一律拒绝
      if (closed) {
        fail(res, 503, 'BRIDGE_CLOSED');
        return;
      }
      // 1) token 鉴权（timing-safe）
      const provided = req.headers[TOKEN_HEADER];
      if (!provided || !timingSafeEqualStr(provided, token)) {
        fail(res, 401, 'UNAUTHORIZED');
        return;
      }
      // 2) nonce + 时钟偏差防重放
      const nonce = req.headers[NONCE_HEADER];
      const ts = Number(req.headers[TS_HEADER]);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
        fail(res, 401, 'STALE_REQUEST');
        return;
      }
      if (!nonceCache.use(nonce)) {
        fail(res, 409, 'REPLAY');
        return;
      }
      const routeKey = `${req.method} ${(req.url || '/').split('?')[0]}`;
      const handler = routes[routeKey];
      if (!handler) {
        fail(res, 404, 'UNKNOWN_ROUTE');
        return;
      }
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const actor = body.actor || null;
      if (routeKey !== 'GET /health') {
        if (!actor || !actor.ownerId || !actor.tenantId) {
          fail(res, 400, 'ACTOR_REQUIRED');
          return;
        }
      }
      const data = await handler({ ...body, actor });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data, protocol: PROTOCOL, version: VERSION }));
    } catch (error) {
      const message = error && error.message ? String(error.message) : 'internal';
      // actor/审批/白名单类错误按 403 透出；其余 500。不回显内部堆栈。
      if (/不一致|拒绝|未登记|需要审批|actor|必填|fail-closed|自我批准/i.test(message)) {
        fail(res, 403, 'POLICY_DENIED');
      } else {
        logger.warn('[browser-bridge] 请求处理失败：', message);
        fail(res, 500, 'INTERNAL_ERROR');
      }
    }
  });

  // 不复用 keep-alive 长连接：桥只在本地短调用，避免端口关闭被空闲连接拖住。
  server.keepAliveTimeout = 1000;
  server.headersTimeout = 5000;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.port || 0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    protocol: PROTOCOL,
    version: VERSION,
    port,
    endpoint: `http://127.0.0.1:${port}`,
    token, // 仅返回给主进程持有者（写入受保护文件/env 注入子进程），不经任何 web 面暴露
    // 关闭 = 端口释放 + token 失效：先置 fail-closed 标志，再销毁所有在途连接，
    // 最后关监听。幂等（before-quit 与手动关闭可能重复触发）。
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve) => {
        for (const socket of sockets) {
          try {
            socket.destroy();
          } catch {
            /* 已断开 */
          }
        }
        sockets.clear();
        if (typeof server.closeAllConnections === 'function') {
          try {
            server.closeAllConnections();
          } catch {
            /* 已关闭 */
          }
        }
        if (typeof server.closeIdleConnections === 'function') {
          try {
            server.closeIdleConnections();
          } catch {
            /* 已关闭 */
          }
        }
        server.close(() => resolve());
      });
    },
  };
}

module.exports = {
  startBrowserBridge,
  createNonceCache,
  timingSafeEqualStr,
  PROTOCOL,
  VERSION,
  TOKEN_HEADER,
  NONCE_HEADER,
  TS_HEADER,
};
