#!/usr/bin/env node
/* ============================================================
 * static-server.mjs —— Next export 静态服务器
 * 支持 .html fallback + /api 代理到后端 3011
 * 用法：node static-server.mjs --port 3421 --root out-mobile
 *   --port  监听端口（默认 3421）
 *   --root  out 产物目录名（相对 frontend/，默认 out）
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
const ROOT = path.join(FRONTEND_ROOT, parseArg("--root", "out"));
const API_BASE = "http://127.0.0.1:3011";

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

http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  /* /api 以及旧版 /auth 入口代理到后端。后端实际统一挂在 /api 下。短链 /r/:code 走 exclude 无 api 前缀，同样反代。 */
  const isApiRequest = urlPath === "/api" || urlPath.startsWith("/api/");
  const isLegacyAuthRequest = urlPath === "/auth" || urlPath.startsWith("/auth/");
  const isShortLinkRequest = urlPath === "/r" || urlPath.startsWith("/r/");
  if (isApiRequest || isLegacyAuthRequest || isShortLinkRequest) {
    const target = API_BASE + (isLegacyAuthRequest ? "/api" : "") + req.url;
    const proxyReq = http.request(target, { method: req.method, headers: { ...req.headers, host: "127.0.0.1:3011" } }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
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
    const decodedImageUrl = decodeURIComponent(imageUrl);
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
    if (fs.existsSync(imageFile) && fs.statSync(imageFile).isFile()) {
      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(imageFile)] || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      });
      fs.createReadStream(imageFile).pipe(res);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
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
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(notFoundFile).pipe(res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
      }
      return;
    }
  }
  if (fs.statSync(file).isDirectory()) {
    if (fs.existsSync(file + ".html")) file = file + ".html";
    else {
      file = path.join(file, "index.html");
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    }
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`✅ static server on ${PORT} -> ${ROOT}`));

/* 进程级兜底：异常/畸形客户端请求不得让服务退出（2026-08-11 安全修复） */
process.on("uncaughtException", (err) => {
  console.error(`[static-server] uncaught: ${err?.message || err}`);
});
process.on("unhandledRejection", (err) => {
  console.error(`[static-server] unhandled rejection: ${err?.message || err}`);
});
