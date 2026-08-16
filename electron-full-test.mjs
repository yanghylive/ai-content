#!/usr/bin/env node
/**
 * Electron 真实窗口全功能测试（CDP 驱动，覆盖壳层行为）
 * 用法：node electron-full-test.mjs
 * 前置：安装版已用 --remote-debugging-port=9333 启动
 * 覆盖：登录跳转、导航拦截回归、消息页、AI客服、获客、CRM、内容、任务、版本号
 */
const CDP = "http://127.0.0.1:9333";

async function getPage() {
  const targets = await (await fetch(CDP + "/json")).json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("3010"));
  if (!page) throw new Error("未找到 Electron 页面");
  return page;
}

async function connect(page) {
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
  return { ws, send };
}

async function main() {
  const page = await getPage();
  const { ws, send } = await connect(page);
  await send("Runtime.enable");
  await send("Page.enable");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let pass = 0, fail = 0;
  const check = (name, ok, detail = "") => {
    console.log((ok ? "✅" : "❌") + " " + name + (detail ? " — " + detail : ""));
    ok ? pass++ : fail++;
  };
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  // ===== 1. 登录页 =====
  await sleep(3000);
  const loginUrl = await evalJs("location.href");
  check("窗口在登录页", loginUrl.includes("/login"), loginUrl);

  // ===== 2. 微信登录跳转（will-navigate 回归）=====
  const clickWechat = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const w = btns.find(b => b.textContent.includes('微信'));
    if (!w) return 'no-btn';
    w.click(); return 'clicked';
  })()`);
  check("微信按钮可点", clickWechat === "clicked", clickWechat);
  await sleep(6000);
  const afterWechat = await evalJs("location.href");
  check("微信跳转不被拦截（卡登录转圈回归）", afterWechat.includes("weixin.qq.com"), afterWechat.slice(0, 80));
  // 跳回登录页（微信扫码页无法自动化，返回）
  await send("Page.navigate", { url: "http://127.0.0.1:3010/login?next=%2F" });
  await sleep(3000);

  // ===== 3. 账号密码登录（本地 session 注入方式验证登录后页面）=====
  const fs = await import("node:fs");
  const token = fs.readFileSync("/tmp/electron-test-token.txt", "utf8").trim();

  // 注入 cookie 后导航到消息页
  await send("Network.enable");
  const cookieR = await send("Network.setCookie", {
    name: "ai_content_session", value: token,
    domain: "127.0.0.1", path: "/",
  });
  await send("Page.navigate", { url: "http://127.0.0.1:3010/message.html" });
  await sleep(4000);
  const msgUrl = await evalJs("location.href");
  check("登录态：消息页不跳登录", !msgUrl.includes("/login"), msgUrl.slice(0, 60));
  const msgText = await evalJs("document.body.innerText");
  check("消息页：AI 客服入口", msgText.includes("AI 客服"));
  check("消息页：企微助手入口", msgText.includes("企微助手"));

  // ===== 4. 核心页面 =====
  const pages = [
    ["AI客服", "/engagement.html", "AI 客服"],
    ["获客创建", "/auto-acquisition/create.html", "执行账号"],
    ["评论获客", "/engagement/comment-acquisition.html", "服务器内部错误"],
    ["CRM", "/crm.html", "服务器内部错误"],
    ["内容", "/content.html", "服务器内部错误"],
    ["任务", "/tasks.html", "服务器内部错误"],
    ["获客中心", "/growth.html", "服务器内部错误"],
    ["工作台", "/workbench.html", "服务器内部错误"],
    ["情报", "/intelligence.html", "服务器内部错误"],
  ];
  for (const [name, route, expected] of pages) {
    await send("Page.navigate", { url: "http://127.0.0.1:3010" + route });
    await sleep(3500);
    const u = await evalJs("location.href");
    const t = await evalJs("document.body.innerText");
    if (expected === "服务器内部错误") {
      check(name + "页无500", !u.includes("/login") && !t.includes("服务器内部错误"), u.slice(0, 50));
    } else {
      check(name + "页内容", t.includes(expected), u.slice(0, 50));
    }
  }

  // ===== 5. 版本号 =====
  await send("Page.navigate", { url: "http://127.0.0.1:3010/release-notes.html" });
  await sleep(3000);
  const ver = await evalJs("document.body.innerText");
  check("更新说明 v1.1.79", ver.includes("v1.1.79"));

  console.log(`\n=== Electron 窗口全功能测试: ${pass} 通过 / ${fail} 失败 ===`);
  ws.close();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
