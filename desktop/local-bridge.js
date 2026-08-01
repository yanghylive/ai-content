'use strict';

const http = require('http');
const path = require('path');

const PROTOCOL = 'jiuzhang-local-bridge';
const VERSION = 1;
const MAX_CLOCK_SKEW_MS = 60_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 2_500;
const ACTION_PATHS = Object.freeze({
  JZ_BRIDGE_CHECK_STATUS: { method: 'GET', path: '/api/local-bridge/status' },
  JZ_BRIDGE_LIST_CAPABILITIES: { method: 'GET', path: '/api/local-bridge/capabilities' },
  JZ_BRIDGE_LIST_ACCOUNTS: { method: 'GET', path: '/api/local-bridge/accounts' },
  JZ_BRIDGE_OPEN_ACCOUNTS: { method: 'POST', path: '/api/local-bridge/accounts/open' },
  JZ_BRIDGE_REFRESH_ACCOUNTS: { method: 'POST', path: '/api/local-bridge/accounts/refresh' },
  JZ_BRIDGE_EXECUTE_PUBLISH: { method: 'POST', path: '/api/local-bridge/publish' },
  JZ_BRIDGE_GET_TASK_STATUS: { method: 'GET', path: '/api/local-bridge/tasks/' },
  JZ_BRIDGE_CANCEL_TASK: { method: 'POST', path: '/api/local-bridge/tasks/' },
  JZ_BRIDGE_LIST_PUBLISH_HISTORY: { method: 'GET', path: '/api/local-bridge/history' },
  JZ_BRIDGE_RETRY_PUBLISH: { method: 'POST', path: '/api/local-bridge/retry' },
  JZ_BRIDGE_DELETE_PUBLISH_RECORD: { method: 'POST', path: '/api/local-bridge/delete' },
  JZ_BRIDGE_SCRAPE_ARTICLE: { method: 'POST', path: '/api/local-bridge/scrape' },
});
const ERROR_CODES = new Set([
  'BRIDGE_OFFLINE', 'INVALID_REQUEST', 'PERMISSION_DENIED', 'INTERNAL_ERROR',
  'UNAUTHORIZED_ORIGIN', 'UNSUPPORTED_ACTION', 'ENGINE_UNAVAILABLE',
  'CONFIRMATION_REQUIRED', 'IDEMPOTENCY_CONFLICT', 'TASK_NOT_FOUND',
  'CANCELLATION_UNSUPPORTED', 'WRITE_PATH_NOT_READY',
]);
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;
const NONCE_PATTERN = /^(?:[A-Fa-f0-9]{2}){16,64}$/;
const ACCOUNT_STATUSES = new Set(['ready', 'needs_login', 'error', 'unknown']);
const CONTENT_KINDS = new Set(['article', 'video']);
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const EXECUTION_MODES = new Set(['cdp']);

function isPlainObject(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function validateRequest(value, now = Date.now()) {
  try {
    if (!isPlainObject(value)
      || typeof value.traceId !== 'string'
      || typeof value.nonce !== 'string'
      || typeof value.action !== 'string') return false;
    return value.protocol === PROTOCOL
      && value.version === VERSION
      && value.type === 'request'
      && TRACE_ID_PATTERN.test(value.traceId)
      && typeof value.timestamp === 'number'
      && Number.isFinite(value.timestamp)
      && Number.isFinite(now)
      && Math.abs(now - value.timestamp) <= MAX_CLOCK_SKEW_MS
      && NONCE_PATTERN.test(value.nonce)
      && isPlainObject(value.data)
      && Object.prototype.hasOwnProperty.call(ACTION_PATHS, value.action);
  } catch {
    return false;
  }
}

function strings(value, allowed) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && allowed.has(item));
}

function sanitizeStatus(data) {
  if (!isPlainObject(data)
    || typeof data.online !== 'boolean'
    || typeof data.status !== 'string'
    || typeof data.service !== 'string'
    || typeof data.version !== 'string'
    || data.protocolVersion !== VERSION
    || !Array.isArray(data.actions)
    || !data.actions.every((action) => typeof action === 'string' && Object.hasOwn(ACTION_PATHS, action))
    || typeof data.checkedAt !== 'string') return null;
  return {
    online: data.online, status: data.status, service: data.service, version: data.version,
    protocolVersion: data.protocolVersion, actions: [...data.actions], checkedAt: data.checkedAt,
  };
}

function sanitizeCapabilities(data) {
  if (!Array.isArray(data)) return null;
  const clean = [];
  for (const item of data) {
    if (!isPlainObject(item)
      || typeof item.platform !== 'string'
      || typeof item.displayName !== 'string'
      || !strings(item.contentKinds, CONTENT_KINDS)
      || !strings(item.executionModes, EXECUTION_MODES)
      || typeof item.supportsSchedule !== 'boolean'
      || typeof item.supportsDraft !== 'boolean'
      || typeof item.supportsCover !== 'boolean'
      || typeof item.supportsReadback !== 'boolean'
      || typeof item.supportsAccountDetection !== 'boolean'
      || item.riskLevel !== 'high'
      || typeof item.adapterVersion !== 'string') return null;
    clean.push({
      platform: item.platform, displayName: item.displayName, contentKinds: [...item.contentKinds],
      executionModes: [...item.executionModes], supportsSchedule: item.supportsSchedule,
      supportsDraft: item.supportsDraft, supportsCover: item.supportsCover,
      supportsReadback: item.supportsReadback, supportsAccountDetection: item.supportsAccountDetection,
      riskLevel: item.riskLevel, adapterVersion: item.adapterVersion,
    });
  }
  return clean;
}

function sanitizeAccounts(data) {
  if (!Array.isArray(data)) return null;
  const clean = [];
  for (const item of data) {
    if (!isPlainObject(item)
      || typeof item.id !== 'string'
      || typeof item.platform !== 'string'
      || typeof item.displayName !== 'string'
      || typeof item.accountName !== 'string'
      || typeof item.status !== 'string' || !ACCOUNT_STATUSES.has(item.status)
      || typeof item.statusLabel !== 'string'
      || (item.avatarUrl !== null && typeof item.avatarUrl !== 'string')
      || (item.lastCheckedAt !== null && typeof item.lastCheckedAt !== 'string')) return null;
    clean.push({
      id: item.id, platform: item.platform, displayName: item.displayName,
      accountName: item.accountName, status: item.status, statusLabel: item.statusLabel,
      avatarUrl: item.avatarUrl, lastCheckedAt: item.lastCheckedAt,
    });
  }
  return clean;
}

function sanitizeExecutePublish(data) {
  if (!isPlainObject(data)
    || data.accepted !== true
    || !Number.isInteger(data.taskId) || data.taskId <= 0
    || data.status !== 'waiting'
    || typeof data.idempotencyKey !== 'string') return null;
  return {
    accepted: true, taskId: data.taskId, status: 'waiting', idempotencyKey: data.idempotencyKey,
  };
}

function sanitizeTaskStatus(data) {
  if (!isPlainObject(data)
    || !Number.isInteger(data.taskId) || data.taskId <= 0
    || typeof data.status !== 'string'
    || !isPlainObject(data.result)) return null;
  return { taskId: data.taskId, status: data.status, result: data.result };
}

function sanitizeCancelTask(data) {
  if (!isPlainObject(data) || typeof data.cancelled !== 'boolean') return null;
  return { cancelled: data.cancelled };
}

function sanitizeResponse(value, request, now = Date.now()) {
  try {
    if (!isPlainObject(value) || !validateRequest(request, now)) return null;
    if (value.protocol !== PROTOCOL || value.version !== VERSION || value.type !== 'response'
      || value.action !== request.action || value.traceId !== request.traceId
      || typeof value.message !== 'string' || typeof value.timestamp !== 'number'
      || !Number.isFinite(value.timestamp) || Math.abs(now - value.timestamp) > MAX_CLOCK_SKEW_MS) return null;

    const base = {
      protocol: PROTOCOL, version: VERSION, type: 'response', traceId: request.traceId,
      action: request.action, message: value.message, timestamp: value.timestamp,
    };
    if (value.ok === false) {
      if (!Number.isInteger(value.code) || value.code < 400 || value.code > 599
        || value.data !== null || typeof value.errorCode !== 'string' || !ERROR_CODES.has(value.errorCode)) return null;
      return { ...base, ok: false, code: value.code, data: null, errorCode: value.errorCode };
    }
    if (value.ok !== true || value.code !== 200 || Object.hasOwn(value, 'errorCode')) return null;
    let data = null;
    if (request.action === 'JZ_BRIDGE_CHECK_STATUS') data = sanitizeStatus(value.data);
    else if (request.action === 'JZ_BRIDGE_LIST_CAPABILITIES') data = sanitizeCapabilities(value.data);
    else if (request.action === 'JZ_BRIDGE_LIST_ACCOUNTS') data = sanitizeAccounts(value.data);
    else if (request.action === 'JZ_BRIDGE_EXECUTE_PUBLISH') data = sanitizeExecutePublish(value.data);
    else if (request.action === 'JZ_BRIDGE_GET_TASK_STATUS') data = sanitizeTaskStatus(value.data);
    else if (request.action === 'JZ_BRIDGE_CANCEL_TASK') data = sanitizeCancelTask(value.data);
    return data === null ? null : { ...base, ok: true, code: 200, data };
  } catch {
    return null;
  }
}

function validateResponse(value, request, now = Date.now()) {
  return sanitizeResponse(value, request, now) !== null;
}

function safeRequestIdentity(request) {
  try {
    return {
      action: typeof request?.action === 'string' && Object.hasOwn(ACTION_PATHS, request.action)
        ? request.action : 'JZ_BRIDGE_CHECK_STATUS',
      traceId: typeof request?.traceId === 'string' && TRACE_ID_PATTERN.test(request.traceId)
        ? request.traceId : 'invalid-request',
    };
  } catch {
    return { action: 'JZ_BRIDGE_CHECK_STATUS', traceId: 'invalid-request' };
  }
}

function resolveBackendPath(action, data) {
  const route = ACTION_PATHS[action];
  if (!route) return null;
  if (action === 'JZ_BRIDGE_GET_TASK_STATUS') {
    const taskId = data?.taskId;
    if (!Number.isInteger(taskId) || taskId <= 0) return null;
    return `${route.path}${taskId}`;
  }
  if (action === 'JZ_BRIDGE_CANCEL_TASK') {
    const taskId = data?.taskId;
    if (!Number.isInteger(taskId) || taskId <= 0) return null;
    return `${route.path}${taskId}/cancel`;
  }
  return route.path;
}

function buildError(request, errorCode, message, code = 500, now = Date.now()) {
  const { action, traceId } = safeRequestIdentity(request);
  return {
    protocol: PROTOCOL, version: VERSION, type: 'response', traceId, action,
    ok: false, code, data: null, message, timestamp: now,
    errorCode: ERROR_CODES.has(errorCode) ? errorCode : 'INTERNAL_ERROR',
  };
}

function createNonceCache({ ttlMs = 5 * 60 * 1000, maxEntries = 2048 } = {}) {
  const entries = new Map();
  return {
    accept(origin, nonce, now = Date.now()) {
      for (const [key, expiresAt] of entries) if (expiresAt <= now) entries.delete(key);
      const key = `${origin}\u0000${nonce}`;
      if (entries.has(key)) return false;
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, now + ttlMs);
      return true;
    },
    get size() { return entries.size; },
  };
}

function shouldUseE2EUserData({ nodeEnv, e2eMode, isPackaged, target }) {
  return nodeEnv === 'test' && e2eMode === '1' && isPackaged === false
    && typeof target === 'string' && path.isAbsolute(target);
}

function requestBackend({ request, host, cookieHeader = '', httpModule = http, deadlineMs = REQUEST_TIMEOUT_MS }) {
  if (!validateRequest(request)) return Promise.resolve(buildError(request, 'INVALID_REQUEST', '请求无效', 400));
  if (host !== 'localhost' && host !== '127.0.0.1') return Promise.resolve(buildError(request, 'INVALID_REQUEST', '请求来源无效', 400));

  const route = ACTION_PATHS[request.action];
  const backendPath = resolveBackendPath(request.action, request.data);
  if (!route || !backendPath) return Promise.resolve(buildError(request, 'INVALID_REQUEST', '请求路径无效', 400));

  const isPost = route.method === 'POST';
  let bodyJson = '';
  if (isPost) {
    try {
      bodyJson = JSON.stringify(request.data);
    } catch {
      return Promise.resolve(buildError(request, 'INVALID_REQUEST', '请求体序列化失败', 400));
    }
    if (Buffer.byteLength(bodyJson, 'utf8') > MAX_REQUEST_BODY_BYTES) {
      return Promise.resolve(buildError(request, 'INVALID_REQUEST', '请求体过大', 400));
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    let req;
    let res;
    const finish = (value, destroy = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (destroy) {
        try { res?.destroy(); } catch {}
        try { req?.destroy(); } catch {}
      }
      resolve(value);
    };
    const deadline = setTimeout(() => {
      finish(buildError(request, 'BRIDGE_OFFLINE', '本地服务请求超时', 504), true);
    }, deadlineMs);
    const headers = { Accept: 'application/json', 'x-jiuzhang-trace-id': request.traceId };
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (isPost) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyJson, 'utf8');
    }

    try {
      const requestOptions = {
        host, port: 3011, path: backendPath,
        method: route.method, timeout: REQUEST_TIMEOUT_MS, headers,
      };
      const handleResponse = (incoming) => {
        res = incoming;
        if (res.statusCode === 401 || res.statusCode === 403) {
          res.resume();
          finish(buildError(request, 'PERMISSION_DENIED', '无权访问本地服务', 403), true);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          finish(buildError(request, 'BRIDGE_OFFLINE', '本地服务不可用', 503), true);
          return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            finish(buildError(request, 'INTERNAL_ERROR', '本地服务响应过大', 502), true);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          let parsed;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { finish(buildError(request, 'INTERNAL_ERROR', '本地服务响应无效', 502), true); return; }
          const clean = sanitizeResponse(parsed, request);
          finish(clean || buildError(request, 'INTERNAL_ERROR', '本地服务响应无效', 502), !clean);
        });
        res.on('error', () => finish(buildError(request, 'BRIDGE_OFFLINE', '本地服务不可用', 503), true));
      };
      if (isPost) {
        req = httpModule.request(requestOptions, handleResponse);
        req.write(bodyJson);
        req.end();
      } else {
        req = httpModule.get(requestOptions, handleResponse);
      }
      req.on('timeout', () => finish(buildError(request, 'BRIDGE_OFFLINE', '本地服务请求超时', 504), true));
      req.on('error', () => finish(buildError(request, 'BRIDGE_OFFLINE', '本地服务不可用', 503), true));
    } catch {
      finish(buildError(request, 'BRIDGE_OFFLINE', '本地服务不可用', 503), true);
    }
  });
}

module.exports = {
  ACTION_PATHS, ERROR_CODES, MAX_CLOCK_SKEW_MS, MAX_REQUEST_BODY_BYTES, MAX_RESPONSE_BYTES,
  NONCE_PATTERN, PROTOCOL, REQUEST_TIMEOUT_MS, TRACE_ID_PATTERN, VERSION,
  buildError, createNonceCache, isPlainObject, requestBackend, resolveBackendPath,
  sanitizeResponse, shouldUseE2EUserData, validateRequest, validateResponse,
};
