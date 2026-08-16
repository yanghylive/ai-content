#!/usr/bin/env node
/**
 * Electron 真实窗口全路由扫描（CDP 驱动，147 路由）
 * 检查：跳登录 / 404 / 500 / 白屏 / console error
 * 用法：node electron-routes-scan.mjs
 */
import fs from "node:fs";

const CDP = "http://127.0.0.1:9333";
const TOKEN = fs.readFileSync("/tmp/electron-test-token.txt", "utf8").trim();
const routes = fs.readFileSync("/tmp/all-routes.txt", "utf8").split("\n").filter(Boolean);

async function main() {
  const targets = await (await fetch(CDP + "/json")).json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("3010"));
  if (!page) throw new Error("未找到 Electron 页面");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Network.setCookie", { name: "ai_content_session", value: TOKEN, domain: "127.0.0.1", path: "/" });

  let pass = 0, fail = 0;
  const problems = [];
  const startTime = Date.now();

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const url = "http://127.0.0.1:3010" + route;
    const errors = [];
    const consoleHandler = (evt) => {
      const m = JSON.parse(evt.data);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        errors.push((m.params.args?.[0]?.value || "").slice(0, 80));
      }
      if (m.method === "Runtime.exceptionThrown") {
        errors.push((m.params.exceptionDetails?.exception?.description || "exception").slice(0, 100));
      }
    };
    ws.addEventListener("message", consoleHandler);
    try {
      await send("Page.navigate", { url });
      await sleep(2200);
      const u = await ev("location.href");
      const bodyText = await ev("document.body.innerText") || "";
      const notFound = errors.some((e) => e.includes("404") || e.includes("Failed to load resource"));
      const hasServerError = bodyText.includes("服务器内部错误") || bodyText.includes("Internal Server Error");
      const blank = bodyText.trim().length < 10 && !u.includes("/login");

      if (u.includes("/login")) {
        problems.push(`${route} → 跳登录`);
        fail++;
      } else if (hasServerError) {
        problems.push(`${route} → 500`);
        fail++;
      } else if (blank) {
        problems.push(`${route} → 白屏(textLength=${bodyText.length})`);
        fail++;
      } else if (notFound && !route.includes("_next")) {
        problems.push(`${route} → 404资源`);
        fail++;
      } else {
        pass++;
      }
      if ((i + 1) % 25 === 0) {
        console.log(`[${i + 1}/${routes.length}] 通过=${pass} 失败=${fail} 耗时=${((Date.now() - startTime) / 1000).toFixed(0)}s`);
      }
    } catch (e) {
      problems.push(`${route} → 导航异常: ${e.message.slice(0, 60)}`);
      fail++;
    }
    ws.removeEventListener("message", consoleHandler);
  }

  console.log(`\n========== Electron 全路由扫描结果 ==========`);
  console.log(`路由: ${routes.length}  通过: ${pass}  失败: ${fail}  耗时: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
  if (problems.length) {
    console.log(`\n失败清单 (${problems.length}):`);
    problems.forEach((p) => console.log("  ❌", p));
  }
  ws.close();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
