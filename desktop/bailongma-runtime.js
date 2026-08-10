const http = require("http");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3721;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3010",
  "http://localhost:3010",
]);

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function normalizeVoiceBaseUrl(value) {
  const parsed = new URL(String(value || "http://127.0.0.1:3011/api/voice"));
  if (parsed.protocol !== "http:" || !isLoopbackHost(parsed.hostname)) {
    throw new Error("voiceBaseUrl must use the local KAYPAL voice service");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (!parsed.pathname.endsWith("/api/voice")) {
    throw new Error("voiceBaseUrl must point to /api/voice");
  }
  return parsed.toString().replace(/\/$/, "");
}

function publicError(error, fallback = "本地语音服务未就绪") {
  const code = String(error?.code || "").trim();
  if (code === "ECONNREFUSED") return "KAYPAL 本地服务未启动";
  if (error?.name === "AbortError") return "KAYPAL 本地服务响应超时";
  return String(error?.message || fallback);
}

function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request(
      parsed,
      {
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          resolve({ statusCode: response.statusCode || 0, payload, raw });
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(timeoutMs, () => {
      const error = new Error(`request timed out after ${timeoutMs}ms`);
      error.name = "AbortError";
      request.destroy(error);
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("request body must be valid JSON"));
      }
    });
    request.once("error", reject);
  });
}

function createBaiLongmaRuntime(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const requestedPort = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const logger = options.logger || console;
  const configuredOpenUrl = options.openUrl || "http://127.0.0.1:3010/voice-agent";
  let voiceBaseUrl = normalizeVoiceBaseUrl(options.voiceBaseUrl);
  let accessToken = "";
  let expiresAt = null;
  let server = null;
  let actualPort = requestedPort;
  let phase = "stopped";
  let external = false;
  let lastError = null;
  let startedAt = null;
  let startPromise = null;

  function runtimeUrl() {
    return `http://${host}:${actualPort}`;
  }

  function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (typeof options.isAllowedOrigin === "function") {
      return options.isAllowedOrigin(origin) === true;
    }
    return DEFAULT_ALLOWED_ORIGINS.has(origin);
  }

  function resolveOpenUrl() {
    const value =
      typeof configuredOpenUrl === "function" ? configuredOpenUrl() : configuredOpenUrl;
    return String(value || "http://127.0.0.1:3010/voice-agent");
  }

  function setCorsHeaders(request, response) {
    const origin = String(request.headers.origin || "");
    if (isAllowedOrigin(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }

  function sendJson(request, response, statusCode, payload) {
    setCorsHeaders(request, response);
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
  }

  function isAllowedRequest(request) {
    const address = String(request.socket?.remoteAddress || "");
    const local = address === "127.0.0.1" || address === "::1" || address.endsWith(":127.0.0.1");
    const origin = String(request.headers.origin || "");
    return local && isAllowedOrigin(origin);
  }

  async function probeAuthorization() {
    if (!accessToken) {
      return { connected: false, message: "KAYPAL 账号尚未同步" };
    }
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      accessToken = "";
      return { connected: false, message: "KAYPAL 账号授权已过期" };
    }
    try {
      const result = await requestJson(
        `${voiceBaseUrl}/state`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        timeoutMs,
      );
      const connected = result.statusCode >= 200 && result.statusCode < 300;
      return {
        connected,
        status: result.statusCode,
        message: connected ? "本地语音服务和 KAYPAL 账号均已就绪" : "KAYPAL 账号授权不可用",
      };
    } catch (error) {
      return { connected: false, message: publicError(error) };
    }
  }

  async function ownedStatus() {
    const authorization = await probeAuthorization();
    return {
      ok: true,
      service: "kaypal-bailongma-runtime",
      serviceRunning: phase === "running",
      phase,
      ready: phase === "running" && authorization.connected,
      authorized: authorization.connected,
      external: false,
      url: runtimeUrl(),
      startedAt,
      expiresAt,
      message: authorization.message,
      error: lastError,
    };
  }

  async function probeExistingRuntime() {
    try {
      const result = await requestJson(`${runtimeUrl()}/kaypal-voice/status`, {}, 1200);
      const payload = result.payload;
      const compatible =
        payload?.service === "kaypal-bailongma-runtime" ||
        typeof payload?.kaypalVoice?.ready === "boolean" ||
        typeof payload?.status?.ready === "boolean";
      if (
        result.statusCode >= 200 &&
        result.statusCode < 300 &&
        payload &&
        compatible &&
        typeof payload.ready === "boolean"
      ) {
        return payload;
      }
    } catch {
      // No compatible runtime is listening.
    }
    return null;
  }

  async function handleRequest(request, response) {
    if (!isAllowedRequest(request)) {
      sendJson(request, response, 403, { ok: false, ready: false, error: "forbidden" });
      return;
    }
    if (request.method === "OPTIONS") {
      setCorsHeaders(request, response);
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url || "/", runtimeUrl());
    if (request.method === "GET" && url.pathname === "/kaypal-voice/status") {
      sendJson(request, response, 200, await ownedStatus());
      return;
    }
    if (request.method === "POST" && url.pathname === "/kaypal-voice/authorize") {
      try {
        const body = await readJsonBody(request);
        const nextToken = String(body.accessToken || body.token || "").trim();
        if (!nextToken) throw new Error("accessToken is required");
        const nextVoiceBaseUrl = normalizeVoiceBaseUrl(body.voiceBaseUrl || voiceBaseUrl);
        const previous = { voiceBaseUrl, accessToken, expiresAt };
        voiceBaseUrl = nextVoiceBaseUrl;
        accessToken = nextToken;
        expiresAt = body.expiresAt || null;
        const authorization = await probeAuthorization();
        if (!authorization.connected) {
          ({ voiceBaseUrl, accessToken, expiresAt } = previous);
        }
        sendJson(request, response, 200, {
          ok: authorization.connected,
          ready: authorization.connected,
          service: "kaypal-bailongma-runtime",
          serviceRunning: true,
          authorized: authorization.connected,
          message: authorization.message,
        });
      } catch (error) {
        sendJson(request, response, 400, {
          ok: false,
          ready: false,
          serviceRunning: true,
          error: publicError(error, "账号授权同步失败"),
        });
      }
      return;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/open")) {
      response.writeHead(302, {
        Location: resolveOpenUrl(),
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    sendJson(request, response, 404, { ok: false, ready: false, error: "not found" });
  }

  async function start() {
    if (phase === "running") return getStatus();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      phase = "starting";
      lastError = null;
      const existing = await probeExistingRuntime();
      if (existing) {
        external = true;
        phase = "running";
        startedAt = new Date().toISOString();
        return { ...existing, serviceRunning: true, phase, external: true, url: runtimeUrl() };
      }
      try {
        server = http.createServer((request, response) => {
          void handleRequest(request, response).catch((error) => {
            logger.error?.("[BaiLongma] request failed:", error);
            if (!response.headersSent) sendJson(request, response, 500, { ok: false, ready: false, error: "request failed" });
            else response.destroy();
          });
        });
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(requestedPort, host, resolve);
        });
        const address = server.address();
        actualPort = typeof address === "object" && address ? address.port : requestedPort;
        server.on("error", (error) => {
          lastError = publicError(error);
          logger.error?.("[BaiLongma] runtime error:", error);
        });
        external = false;
        phase = "running";
        startedAt = new Date().toISOString();
        logger.log?.(`[BaiLongma] Local voice runtime listening on ${runtimeUrl()}`);
        return ownedStatus();
      } catch (error) {
        server = null;
        phase = "error";
        lastError = publicError(error, `无法启动本地语音服务端口 ${requestedPort}`);
        throw new Error(lastError);
      }
    })().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  async function getStatus() {
    if (phase !== "running") {
      return {
        ok: false,
        service: "kaypal-bailongma-runtime",
        serviceRunning: false,
        phase,
        ready: false,
        authorized: false,
        external,
        url: runtimeUrl(),
        startedAt,
        error: lastError,
        message: lastError || "本地语音服务未启动",
      };
    }
    if (external) {
      const existing = await probeExistingRuntime();
      if (existing) return { ...existing, serviceRunning: true, phase, external: true, url: runtimeUrl() };
      phase = "error";
      lastError = "外部语音服务已停止";
      return getStatus();
    }
    return ownedStatus();
  }

  async function stop() {
    if (!server) {
      phase = "stopped";
      external = false;
      return;
    }
    const activeServer = server;
    server = null;
    await new Promise((resolve) => activeServer.close(resolve));
    phase = "stopped";
    external = false;
  }

  return { start, stop, getStatus, getUrl: runtimeUrl };
}

module.exports = {
  createBaiLongmaRuntime,
  normalizeVoiceBaseUrl,
};
