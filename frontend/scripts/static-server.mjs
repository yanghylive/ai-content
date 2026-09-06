#!/usr/bin/env node
/* ============================================================
 * static-server.mjs —— Next export 静态服务器
 * 支持 .html fallback + /api 代理到后端 3011
 * 用法：node static-server.mjs --port 3421 --root out-mobile
 *   --port  监听端口（默认 3421）
 *   --root  out 产物目录名（相对 frontend/，默认 out）；也支持绝对路径
 * ============================================================ */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, "..");

function parseArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PORT = Number(parseArg("--port", "3421"));
const rootArg = parseArg("--root", "out");
const ROOT = path.resolve(FRONTEND_ROOT, rootArg);
const API_BASE = process.env.API_BASE || "http://127.0.0.1:3011";
const REQUEST_TIMEOUT_MS = 10_000;

// P0-1: 认证 cookie 名（与后端 auth.constants.ts 保持一致）
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "ai_content_session";

// P0-1: 不需要鉴权的路径前缀（静态资源、PWA、API 等）
const PUBLIC_PATH_PREFIXES = [
  "/_next/",
  "/brand/",
  "/manifest.json",
  "/sw.js",
  "/sw.js.map",
  "/favicon.ico",
  "/robots.txt",
  "/icon-",
  "/apple-icon",
];

// P0-1: 不需要鉴权的页面（登录页本身）
const PUBLIC_PAGES = ["/login", "/login.html"];

if (!fs.existsSync(ROOT)) {
  console.error(`❌ root 不存在: ${ROOT}`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

/**
 * P0-1: 从 Cookie header 解析指定 cookie 值
 */
function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * P0-1: 判断路径是否为公开路径（不需要鉴权）
 */
function isPublicPath(urlPath) {
  // 公开页面
  const normalizedPath = urlPath.replace(/\.html$/, "");
  if (PUBLIC_PAGES.includes(normalizedPath) || PUBLIC_PAGES.includes(urlPath)) {
    return true;
  }
  // 公开静态资源前缀
  return PUBLIC_PATH_PREFIXES.some((prefix) => urlPath.startsWith(prefix));
}

/**
 * P0-1: 通过后端 /api/auth/me 验证 session，而不是把任意 cookie 当成登录态。
 * 静态服务器只转发当前认证 cookie，不信任浏览器自报的身份头。
 */
function isAuthenticated(req) {
  const cookie = getCookie(req.headers.cookie, AUTH_COOKIE_NAME);
  if (!cookie) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const target = new URL("/api/auth/me", API_BASE);
      const client = target.protocol === "https:" ? https : http;
      const authReq = client.request(
        target,
        {
          method: "GET",
          headers: { cookie: `${AUTH_COOKIE_NAME}=${cookie}`, host: target.host },
        },
        (authRes) => {
          authRes.resume();
          finish((authRes.statusCode || 500) >= 200 && (authRes.statusCode || 500) < 300);
        },
      );
      authReq.setTimeout(REQUEST_TIMEOUT_MS, () => {
        authReq.destroy();
        finish(false);
      });
      authReq.once("error", () => finish(false));
      authReq.end();
    } catch {
      finish(false);
    }
  });
}

function endWithError(res, statusCode, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

/**
 * 代理层错误统一以 JSON 返回（与后端 TransformInterceptor 结构对齐），
 * 前端 api client 能解析出 message/code，而不是收到 text/plain 后兜底成
 * 「请求失败: 502」。code 供前端按场景给操作指引。
 */
function endWithProxyError(res, statusCode, code, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    JSON.stringify({
      success: false,
      code,
      message,
      status: statusCode,
      retryable: true,
      timestamp: new Date().toISOString(),
    }),
  );
}

function streamFile(res, file, statusCode, headers = {}) {
  try {
    fs.accessSync(file, fs.constants.R_OK);
  } catch (error) {
    console.error(`[static-server] access failed: ${file}: ${error?.message || error}`);
    endWithError(res, 503, "静态资源暂不可用");
    return;
  }
  const stream = fs.createReadStream(file);
  stream.once("error", (error) => {
    console.error(`[static-server] read failed: ${file}: ${error?.message || error}`);
    endWithError(res, 500, "静态资源读取失败");
  });
  res.writeHead(statusCode, headers);
  stream.pipe(res);
}

http.createServer(async (req, res) => {
  // 2026-09-02（登录 SSE 断线根因修复 #2）：不要对 SSE/长响应设置 socket
  // 空闲超时。原实现对所有响应设 10s 空闲超时，EventSource 登录流等待
  // 二维码/扫码识别期间无输出字节 → 10s 后被服务端掐断 → 前端转轮询 →
  // 用户已完成平台登录却显示失败。SSE 请求跳过超时（关闭/上游断开自然结束）。
  const isSseRequest = /text\/event-stream/i.test(req.headers.accept || "");
  const urlPath = (req.url || "/").split("?")[0];
  /* /api 以及旧版 /auth 入口代理到后端。后端实际统一挂在 /api 下。短链 /r/:code 走 exclude 无 api 前缀，同样反代。 */
  const isApiRequest = urlPath === "/api" || urlPath.startsWith("/api/");
  const isLegacyAuthRequest = urlPath === "/auth" || urlPath.startsWith("/auth/");
  const isShortLinkRequest = urlPath === "/r" || urlPath.startsWith("/r/");
  const isProxyRoute = isApiRequest || isLegacyAuthRequest || isShortLinkRequest;
  // 代理路由的超时由 proxyReq.setTimeout 精确管理(区分上游超时/连接失败,
  // 后端慢处理时给用户明确提示而不是静默掐断);res 级兜底只用于静态文件,
  // 避免 res 空闲超时与代理超时双重触发产生文本/JSON 竞态。
  if (!isSseRequest && !isProxyRoute) {
    res.setTimeout(REQUEST_TIMEOUT_MS, () => {
      console.error(`[static-server] request timeout: ${req.method} ${req.url}`);
      endWithError(res, 504, "请求超时");
    });
  }
  if (isProxyRoute) {
    const target = API_BASE + (isLegacyAuthRequest ? "/api" : "") + req.url;
    // 2026-09-01（审计 #14）：按目标协议选 http/https client——
    // 原实现恒用 http.request，API_BASE=https 时抛 "Protocol https not supported"。
    const targetUrl = new URL(target);
    const client = targetUrl.protocol === "https:" ? https : http;
    let proxyReq;
    try {
      proxyReq = client.request(
        targetUrl,
        {
          method: req.method,
          headers: { ...req.headers, host: "127.0.0.1:3011" },
        },
        (proxyRes) => {
          proxyRes.once("error", (error) => {
            console.error(`[static-server] upstream read failed: ${error?.message || error}`);
            endWithProxyError(res, 502, "UPSTREAM_READ_FAILED", "后端响应中断，请稍后重试");
          });
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
    } catch (error) {
      console.error(`[static-server] proxy setup failed: ${error?.message || error}`);
      endWithProxyError(res, 502, "UPSTREAM_CONNECT_FAILED", "无法连接后端服务，请确认本地服务已启动后重试");
      return;
    }
    // 2026-09-02（登录 SSE 断线根因修复）：EventSource 请求（Accept:
    // text/event-stream，如 /api/auto-upload/accounts/login 登录流）是长连接，
    // 等待二维码/扫码识别期间后端可能数分钟无输出字节。socket 空闲超时
    // 会让登录流 10s 必断 → 前端转轮询 → 用户已完成平台登录却显示失败。
    // SSE 禁用代理超时（浏览器关闭/上游断开会自行结束）；普通 API 维持
    // 原 10s 超时（响应快，超时=上游卡死）。
    const isSse = /text\/event-stream/i.test(req.headers.accept || "");
    proxyReq.setTimeout(isSse ? 0 : REQUEST_TIMEOUT_MS, () => {
      console.error(`[static-server] upstream timeout: ${req.method} ${req.url}`);
      // 2026-09-04: 后端处理超过 10s(如运行类动作)语义应为 504 而非 502。
      // 任务可能仍在后台执行,先响应给用户明确提示,避免前端兜底成"请求失败: 502"。
      endWithProxyError(
        res,
        504,
        "UPSTREAM_TIMEOUT",
        "后端处理超时（超过 10 秒未响应）。任务可能仍在后台执行，请稍后查看任务列表确认结果",
      );
      proxyReq.destroy(new Error("upstream request timeout"));
    });
    proxyReq.on("error", (e) => {
      const msg = e?.message || String(e);
      console.error(`[static-server] upstream request failed: ${msg}`);
      // destroy 已触发过 timeout 分支时 headersSent=true,响应已完整发出,不额外动作
      if (!res.headersSent) {
        endWithProxyError(res, 502, "UPSTREAM_UNAVAILABLE", "后端服务暂不可用，请稍后重试");
      }
    });
    req.on("aborted", () => proxyReq.destroy());
    req.pipe(proxyReq);
    return;
  }
  /* next/image 优化端点回源：静态导出（output:export）下 <Image> 组件默认
     请求 /_next/image?url=%2Fbrand%2Fxxx.png&w=640&q=75。静态服务器不提供
     图片优化服务，直接解析 url 参数回源原始静态文件（忽略 w/q），
     否则 logo/图片 404 破图（2026-08-19 登录页 logo 丢失根因）。 */
  if (urlPath === "/_next/image") {
    let imageUrl = "";
    try {
      imageUrl = new URL(req.url || "/", "http://localhost").searchParams.get(
        "url",
      ) || "";
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }
    if (
      !imageUrl.startsWith("/") ||
      imageUrl.startsWith("//") ||
      /^[a-z][a-z\d+.-]*:/i.test(imageUrl)
    ) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }
    let decodedImageUrl;
    try {
      decodedImageUrl = decodeURIComponent(imageUrl);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }
    const rootResolved = path.resolve(ROOT);
    const imageFile = path.resolve(
      rootResolved,
      decodedImageUrl.replace(/^[/\\]+/, ""),
    );
    if (
      imageFile !== rootResolved &&
      !imageFile.startsWith(rootResolved + path.sep)
    ) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    let imageIsFile = false;
    try { imageIsFile = fs.existsSync(imageFile) && fs.statSync(imageFile).isFile(); } catch { imageIsFile = false; }
    if (imageIsFile) {
      streamFile(res, imageFile, 200, {
        "Content-Type":
          MIME[path.extname(imageFile)] || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      });
    } else {
      res.writeHead(404);
      res.end("not found");
    }
    return;
  }

  /* P0-1b（2026-09-05 真机两连「登录后乱码」根因）：RSC payload 文件（Next
     静态导出给每个路由生成 <route>.txt，text/plain 内容是 chunk/RSC 序列化流）
     不是给人顶层导航的页面。用 Accept 头区分两种访问：
     - 顶层导航（Accept: text/html）= 误触（地址栏/历史补全/next 循环）→
       302 回对应页面（登录态回 /，未登录回 /login，不带 next 防循环）；
     - Router fetch（Accept: text/x-component）= 正常数据请求 → 照常走鉴权
       服务文件（公开页的 payload 未登录也放行，保证登录页预取不挂）。 */
  if (!isPublicPath(urlPath) && urlPath.endsWith(".txt")) {
    const wantsHtml = /text\/html/i.test(req.headers.accept || "");
    if (wantsHtml) {
      const redirectUrl = (await isAuthenticated(req)) ? "/" : "/login";
      res.writeHead(302, {
        "Location": redirectUrl,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    const rscRoute = urlPath.slice(0, -".txt".length);
    if (!isPublicPath(rscRoute) && !(await isAuthenticated(req))) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
  }

  /* P0-1: HTML 层鉴权 —— 未登录用户直接 302 到登录页，不返回 HTML/JS。
     豁免：公开页（/login）的 RSC payload（/login.txt）——Router fetch 需要
     未登录也能拿到（登录页预取）；顶层导航形态已被上方 P0-1b 拦走。 */
  if (
    !isPublicPath(urlPath) &&
    !(urlPath.endsWith(".txt") && isPublicPath(urlPath.slice(0, -".txt".length))) &&
    !(await isAuthenticated(req))
  ) {
    const redirectUrl = `/login?next=${encodeURIComponent(urlPath)}`;
    res.writeHead(302, {
      "Location": redirectUrl,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }
  if (p === "/" || p === "") p = "/index.html";
  /* 目录边界防护：resolve 规范化 + 带分隔符前缀判断。
     不能裸用 file.startsWith(ROOT)：单 ../ 会被 join 规范化为兄弟目录
     （frontend/out-desktop），字符串前缀会误判在根内（2026-08-11 安全修复）。 */
  const rootResolved = path.resolve(ROOT);
  let file = path.resolve(rootResolved, p.replace(/^[/\\]+/, ""));
  if (file !== rootResolved && !file.startsWith(rootResolved + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(file)) {
    if (fs.existsSync(file + ".html")) file = file + ".html";
    else {
      /* 品牌 404：回源 next export 生成的 out/404.html，而不是裸文本 "not found" */
      const notFoundFile = path.join(ROOT, "404.html");
      if (fs.existsSync(notFoundFile)) {
        streamFile(res, notFoundFile, 404, { "Content-Type": "text/html; charset=utf-8" });
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
      }
      return;
    }
  }
  let fileStat;
  try {
    fileStat = fs.statSync(file);
  } catch (error) {
    console.error(`[static-server] stat failed: ${file}: ${error?.message || error}`);
    endWithError(res, 503, "静态资源暂不可用");
    return;
  }
  if (fileStat.isDirectory()) {
    if (fs.existsSync(file + ".html")) file = file + ".html";
    else {
      file = path.join(file, "index.html");
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    }
  }
  /* 2026-09-01（审计 #15）：realpath 双校验——resolve+前缀只挡 ../，
     symlink 场景（out/ 下链接指向根外）可绕过；最终文件真实路径必须仍在根内。 */
  let realFile = file;
  let rootReal = rootResolved;
  try {
    realFile = fs.realpathSync(file);
    rootReal = fs.realpathSync(rootResolved);
  } catch {
    // realpath 失败（权限/竞态）按原路径继续，下方 stat/read 兜底
  }
  if (realFile !== rootReal && !realFile.startsWith(rootReal + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  /* 2026-09-07 修复「构建后刷新仍见旧页面」：此前静态文件不带任何 Cache-Control，
     浏览器按启发式缓存 HTML —— 新构建发布后普通刷新仍命中旧 HTML（引用旧 chunk），
     表现为改了源码+重新部署但用户永远看到旧版。分型给头：
     - HTML：no-store，每次回源（静态导出页很小，成本可忽略）；
     - /_next/static/ 内容哈希资源：immutable 一年（文件名即版本，永不冲突）；
     - 其余（brand 图片/字体等按 URL 覆盖的资产）：no-cache，强制带条件回源。 */
  const cacheHeaders = file.endsWith(".html")
    ? { "Cache-Control": "no-store" }
    : file.startsWith(path.join(rootReal, "_next", "static"))
      ? { "Cache-Control": "public, max-age=31536000, immutable" }
      : { "Cache-Control": "no-cache" };
  streamFile(res, file, 200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    ...cacheHeaders,
  });
}).listen(PORT, "127.0.0.1", () => console.log(`✅ static server on ${PORT} -> ${ROOT}`));

/* 进程级兜底：异常/畸形客户端请求不得让服务退出（2026-08-11 安全修复） */
process.on("uncaughtException", (err) => {
  console.error(`[static-server] uncaught: ${err?.message || err}`);
});
process.on("unhandledRejection", (err) => {
  console.error(`[static-server] unhandled rejection: ${err?.message || err}`);
});
