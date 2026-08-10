const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createBaiLongmaRuntime } = require("../bailongma-runtime");
const desktopPackage = require("../package.json");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          payload: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
        });
      });
    });
    request.once("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

test("desktop package includes the runtime required by the main process", () => {
  assert.ok(desktopPackage.build.files.includes("bailongma-runtime.js"));
});

test("runtime never reports ready until the local service accepts a valid authorization", async (t) => {
  const voiceServer = http.createServer((request, response) => {
    const authorized = request.headers.authorization === "Bearer valid-token";
    response.writeHead(authorized ? 200 : 401, { "Content-Type": "application/json" });
    response.end(JSON.stringify(authorized ? { success: true, data: {} } : { success: false }));
  });
  const voicePort = await listen(voiceServer);
  const runtime = createBaiLongmaRuntime({
    port: 0,
    voiceBaseUrl: `http://127.0.0.1:${voicePort}/api/voice`,
    logger: { log() {}, error() {} },
  });
  t.after(async () => {
    await runtime.stop();
    await close(voiceServer);
  });

  const started = await runtime.start();
  assert.equal(started.serviceRunning, true);
  assert.equal(started.ready, false);
  assert.equal(started.authorized, false);

  const rejected = await requestJson(`${runtime.getUrl()}/kaypal-voice/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voiceBaseUrl: `http://127.0.0.1:${voicePort}/api/voice`,
      accessToken: "invalid-token",
    }),
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.ready, false);

  const accepted = await requestJson(`${runtime.getUrl()}/kaypal-voice/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voiceBaseUrl: `http://127.0.0.1:${voicePort}/api/voice`,
      accessToken: "valid-token",
    }),
  });
  assert.equal(accepted.payload.ok, true);
  assert.equal(accepted.payload.ready, true);

  const status = await requestJson(`${runtime.getUrl()}/kaypal-voice/status`);
  assert.equal(status.payload.serviceRunning, true);
  assert.equal(status.payload.ready, true);
  assert.equal(status.payload.authorized, true);
});

test("runtime drops ready when the KAYPAL voice backend stops", async (t) => {
  const voiceServer = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ success: true, data: {} }));
  });
  const voicePort = await listen(voiceServer);
  const runtime = createBaiLongmaRuntime({
    port: 0,
    voiceBaseUrl: `http://127.0.0.1:${voicePort}/api/voice`,
    timeoutMs: 300,
    logger: { log() {}, error() {} },
  });
  t.after(() => runtime.stop());
  await runtime.start();
  await requestJson(`${runtime.getUrl()}/kaypal-voice/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken: "valid-token" }),
  });
  await close(voiceServer);

  const status = await requestJson(`${runtime.getUrl()}/kaypal-voice/status`);
  assert.equal(status.payload.serviceRunning, true);
  assert.equal(status.payload.ready, false);
  assert.equal(status.payload.authorized, false);
});

test("runtime rejects browser handoffs from non-KAYPAL origins", async (t) => {
  const runtime = createBaiLongmaRuntime({
    port: 0,
    logger: { log() {}, error() {} },
  });
  t.after(() => runtime.stop());
  await runtime.start();

  const response = await requestJson(`${runtime.getUrl()}/kaypal-voice/status`, {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.payload.ready, false);
});

test("runtime does not trust an unrelated service already using port 3721", async (t) => {
  const unrelated = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ready: true }));
  });
  const port = await listen(unrelated);
  const runtime = createBaiLongmaRuntime({
    port,
    logger: { log() {}, error() {} },
  });
  t.after(async () => {
    await runtime.stop();
    await close(unrelated);
  });

  await assert.rejects(runtime.start(), /EADDRINUSE|address already in use/i);
  const status = await runtime.getStatus();
  assert.equal(status.serviceRunning, false);
  assert.equal(status.ready, false);
});
