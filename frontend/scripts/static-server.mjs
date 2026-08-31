#!/usr/bin/env node
/* ============================================================
 * static-server.mjs —— Next export 静态服务器
 * 支持 .html fallback + /api 代理到后端 3011
 * 用法：node static-server.mjs --port 3421 --root out-mobile
 *   --port  监听端口（默认 3421）
 *   --root  out 产物目录名（相对 frontend/，默认 out）；也支持绝对路径
 * ============================================================ */
import http from "node:http";
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
 * P0-1: 检查请求是否已认证（仅检查 cookie 存在性，不验证 session 有效性）
 * session 有效性由后端 /api/auth/me 验证；此处只做快速拦截，避免未登录用户
 * 下载 JS 后才发现需要跳转登录页。
 */
function isAuthenticated(req) {
  const cookie = getCookie(req.headers.cookie, AUTH_COOKIE_NAME);
  return Boolean(cookie);
}

function endWithError(res, statusCode, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
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

http.createServer((req, res) => {
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    console.error(`[static-server] request timeout: ${req.method} ${req.url}`);
    endWithError(res, 504, "请求超时");
  });
  const urlPath = (req.url || "/").split("?")[0];
  /* /api 以及旧版 /auth 入口代理到后端。后端实际统一挂在 /api 下。短链 /r/:code 走 exclude 无 api 前缀，同样反代。 */
  const isApiRequest = urlPath === "/api" || urlPath.startsWith("/api/");
  const isLegacyAuthRequest = urlPath === "/auth" || urlPath.startsWith("/auth/");
  const isShortLinkRequest = urlPath === "/r" || urlPath.startsWith("/r/");
  if (isApiRequest || isLegacyAuthRequest || isShortLinkRequest) {
    const target = API_BASE + (isLegacyAuthRequest ? "/api" : "") + req.url;
    let proxyReq;
    try {
      proxyReq = http.request(
        target,
        {
          method: req.method,
          headers: { ...req.headers, host: "127.0.0.1:3011" },
        },
        (proxyRes) => {
          proxyRes.once("error", (error) => {
            console.error(`[static-server] upstream read failed: ${error?.message || error}`);
            endWithError(res, 502, "后端响应读取失败");
          });
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
    } catch (error) {
      console.error(`[static-server] proxy setup failed: ${error?.message || error}`);
      endWithError(res, 502, "后端代理失败");
      return;
    }
    proxyReq.setTimeout(REQUEST_TIMEOUT_MS, () => {
      proxyReq.destroy(new Error("upstream request timeout"));
    });
    proxyReq.on("error", (e) => {
      console.error(`[static-server] upstream request failed: ${e?.message || e}`);
      endWithError(res, 502, "后端代理失败");
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

  /* P0-1: HTML 层鉴权 —— 未登录用户直接 302 到登录页，不返回 HTML/JS */
  if (!isPublicPath(urlPath) && !isAuthenticated(req)) {
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
  streamFile(res, file, 200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
}).listen(PORT, "127.0.0.1", () => console.log(`✅ static server on ${PORT} -> ${ROOT}`));

/* 进程级兜底：异常/畸形客户端请求不得让服务退出（2026-08-11 安全修复） */
process.on("uncaughtException", (err) => {
  console.error(`[static-server] uncaught: ${err?.message || err}`);
});
process.on("unhandledRejection", (err) => {
  console.error(`[static-server] unhandled rejection: ${err?.message || err}`);
});
