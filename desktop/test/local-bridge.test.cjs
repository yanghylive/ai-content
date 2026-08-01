'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  ACTION_PATHS, buildError, createNonceCache, isPlainObject, requestBackend, sanitizeResponse,
  shouldUseE2EUserData, validateRequest, validateResponse,
} = require('../local-bridge');

function request(overrides = {}) {
  return { protocol: 'jiuzhang-local-bridge', version: 1, type: 'request', traceId: 'trace-123',
    action: 'JZ_BRIDGE_CHECK_STATUS', timestamp: Date.now(), nonce: 'ab'.repeat(16), data: {}, ...overrides };
}
function validData(action) {
  if (action === 'JZ_BRIDGE_CHECK_STATUS') return { online: true, status: 'ready', service: 'jiuzhang-local-bridge', version: '1', protocolVersion: 1, actions: Object.keys(ACTION_PATHS), checkedAt: 'now' };
  if (action === 'JZ_BRIDGE_LIST_CAPABILITIES') return [{ platform: 'x', displayName: 'X', contentKinds: ['article'], executionModes: ['cdp'], supportsSchedule: false, supportsDraft: true, supportsCover: false, supportsReadback: true, supportsAccountDetection: true, riskLevel: 'high', adapterVersion: '1' }];
  return [{ id: '1', platform: 'x', displayName: 'X', accountName: 'a', status: 'ready', statusLabel: '可用', avatarUrl: null, lastCheckedAt: null }];
}
function response(req, overrides = {}) {
  return { protocol: 'jiuzhang-local-bridge', version: 1, type: 'response', traceId: req.traceId,
    action: req.action, ok: true, code: 200, data: validData(req.action), message: 'ok', timestamp: Date.now(), ...overrides };
}
function mockHttp(handler) {
  return { get(options, callback) { const req = new EventEmitter(); req.destroy = () => { req.destroyed = true; }; process.nextTick(() => handler({ options, callback, req })); return req; } };
}
function send(callback, body, statusCode = 200, end = true) {
  const res = new EventEmitter(); res.statusCode = statusCode; res.resume = () => {}; res.destroy = () => { res.destroyed = true; };
  callback(res); if (body !== undefined) res.emit('data', Buffer.from(body)); if (end) res.emit('end'); return res;
}

// 净化后 DTO／envelope 不得残留任何敏感键（比 JSON.stringify.includes 子串匹配更严格，杜绝误报）
const SENSITIVE_KEYS = ['token', 'cookie', 'Cookie', 'credential', 'engineUrl', 'filePath'];
function assertNoSensitiveKeys(node, label = 'data') {
  assert.ok(node !== null && node !== undefined, `${label} 不应为 null/undefined`);
  const targets = Array.isArray(node) ? node : [node];
  for (const target of targets) {
    if (target === null || target === undefined) continue;
    for (const key of SENSITIVE_KEYS) assert.equal(Object.hasOwn(target, key), false, `敏感键 ${key} 应被净化 (${label})`);
  }
}

test('三项 action 使用固定路径并净化结果', async () => {
  for (const [action, expectedPath] of Object.entries(ACTION_PATHS)) {
    const reqValue = request({ action, nonce: action.length.toString(16).padStart(32, '0') });
    let captured;
    const dirty = response(reqValue); dirty.data.token = 'secret';
    const result = await requestBackend({ request: reqValue, host: 'localhost', cookieHeader: 'session=secret',
      httpModule: mockHttp(({ options, callback }) => { captured = options; send(callback, JSON.stringify(dirty)); }) });
    assert.equal(result.ok, true); assert.equal(captured.path, expectedPath); assert.equal(captured.method, 'GET');
    assert.equal(captured.port, 3011); assert.equal(captured.headers.Accept, 'application/json');
    assert.equal(captured.headers.Cookie, 'session=secret'); assertNoSensitiveKeys(result.data, 'response.data');
  }
});

test('validateRequest total 且拒绝非法输入', () => {
  for (const bad of [request({ action: 'DELETE_ALL' }), request({ timestamp: Date.now() - 60_001 }), request({ nonce: 'not-hex' }), request({ traceId: '../bad trace' }), request({ data: [] }), request({ traceId: Symbol('x') }), request({ nonce: Symbol('x') })]) assert.equal(validateRequest(bad), false);
  assert.equal(validateRequest(new Proxy({}, { get() { throw new Error('trap'); } })), false);
});

test('响应 guard 检查关联、时间和判别联合', () => {
  const reqValue = request();
  assert.equal(validateResponse(response(reqValue), reqValue), true);
  assert.equal(validateResponse(response(reqValue, { action: 'JZ_BRIDGE_LIST_ACCOUNTS' }), reqValue), false);
  assert.equal(validateResponse(response(reqValue, { traceId: 'other' }), reqValue), false);
  assert.equal(validateResponse(response(reqValue, { timestamp: Date.now() - 60_001 }), reqValue), false);
  assert.equal(validateResponse(response(reqValue, { ok: false, code: 500, data: null, errorCode: 'UNKNOWN' }), reqValue), false);
});

test('三类 DTO 仅输出字段白名单并拒绝坏 schema', () => {
  for (const action of Object.keys(ACTION_PATHS)) {
    const reqValue = request({ action }); const dirty = response(reqValue);
    if (Array.isArray(dirty.data)) dirty.data[0].credential = 'leak'; else dirty.data.engineUrl = 'leak';
    const clean = sanitizeResponse(dirty, reqValue);
    assert.ok(clean); assertNoSensitiveKeys(clean.data, 'clean.data');
  }
  const reqValue = request({ action: 'JZ_BRIDGE_LIST_ACCOUNTS' });
  assert.equal(sanitizeResponse(response(reqValue, { data: [{ ...validData(reqValue.action)[0], status: 'invalid' }] }), reqValue), null);
});

test('错误 envelope 保留合法关联字段', () => {
  const reqValue = request({ action: 'JZ_BRIDGE_LIST_ACCOUNTS', traceId: 'keep-me' });
  const error = buildError(reqValue, 'INTERNAL_ERROR', '失败', 500);
  assert.equal(error.action, reqValue.action); assert.equal(error.traceId, reqValue.traceId); assert.equal(validateResponse(error, reqValue), true);
});

test('socket timeout 映射为稳定离线错误', async () => {
  const result = await requestBackend({ request: request(), host: '127.0.0.1', httpModule: mockHttp(({ req }) => req.emit('timeout')) });
  assert.equal(result.errorCode, 'BRIDGE_OFFLINE'); assert.equal(result.code, 504);
});

test('wall-clock deadline 终止持续滴流且销毁请求响应', async () => {
  let reqRef; let resRef;
  const result = await requestBackend({ request: request(), host: 'localhost', deadlineMs: 20,
    httpModule: mockHttp(({ req, callback }) => { reqRef = req; resRef = send(callback, '{', 200, false); const timer = setInterval(() => resRef.emit('data', Buffer.from(' ')), 2); setTimeout(() => clearInterval(timer), 40); }) });
  assert.equal(result.errorCode, 'BRIDGE_OFFLINE'); assert.equal(result.code, 504);
  assert.equal(reqRef.destroyed, true); assert.equal(resRef.destroyed, true);
});

test('非 JSON、过大和错误关联字段被拒绝', async () => {
  const cases = [({ callback }) => send(callback, 'not-json'), ({ callback }) => send(callback, 'x'.repeat(64 * 1024 + 1)),
    ({ callback }) => send(callback, JSON.stringify(response(request(), { traceId: 'wrong' }))),
    ({ callback }) => send(callback, JSON.stringify(response(request(), { action: 'JZ_BRIDGE_LIST_ACCOUNTS' })))];
  for (const handler of cases) { const reqValue = request(); const result = await requestBackend({ request: reqValue, host: 'localhost', httpModule: mockHttp(handler) }); assert.equal(result.errorCode, 'INTERNAL_ERROR'); assert.equal(result.traceId, reqValue.traceId); }
});

test('401 与 cookie 不泄露', async () => {
  const result = await requestBackend({ request: request(), host: 'localhost', cookieHeader: 'httpOnlySession=top-secret', httpModule: mockHttp(({ callback }) => send(callback, undefined, 401)) });
  assert.equal(result.errorCode, 'PERMISSION_DENIED'); assert.equal(Object.hasOwn(result, 'cookieHeader'), false); assert.equal(Object.hasOwn(result, 'Cookie'), false);
});

test('有界 nonce cache 阻止重放、清理过期并淘汰最旧', () => {
  const cache = createNonceCache({ ttlMs: 10, maxEntries: 2 });
  assert.equal(cache.accept('o', 'a', 0), true); assert.equal(cache.accept('o', 'a', 1), false);
  assert.equal(cache.accept('o', 'b', 1), true); assert.equal(cache.accept('o', 'c', 2), true); assert.equal(cache.size, 2);
  assert.equal(cache.accept('o', 'a', 3), true); assert.equal(cache.size, 2);
  assert.equal(cache.accept('o', 'a', 20), true); assert.equal(cache.size, 1);
});

test('E2E userData 仅非打包显式测试模式绝对路径启用', () => {
  const base = { nodeEnv: 'test', e2eMode: '1', isPackaged: false, target: '/tmp/e2e' };
  assert.equal(shouldUseE2EUserData(base), true);
  assert.equal(shouldUseE2EUserData({ ...base, isPackaged: true }), false);
  assert.equal(shouldUseE2EUserData({ ...base, e2eMode: undefined }), false);
  assert.equal(shouldUseE2EUserData({ ...base, nodeEnv: 'production' }), false);
  assert.equal(shouldUseE2EUserData({ ...base, target: 'relative' }), false);
});
