// 静态导出验证服务器：服务 frontend/out 目录，带 .html fallback + SPA 回退，/api 反代到后端。
// 用法：node scripts/serve-static.mjs                （默认 3010，反代 127.0.0.1:3011）
//       PORT=3000 API_TARGET=http://127.0.0.1:3011 FRONTEND_OUT=/path/to/out node scripts/serve-static.mjs
import { createServer, request as httpRequest } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "frontend",
  "out",
);
const ROOT = process.env.FRONTEND_OUT || DEFAULT_ROOT;
const PORT = Number(process.env.PORT || 3010);
const API_TARGET = process.env.API_TARGET || "http://127.0.0.1:3011";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = normalize(decoded).replace(/^[/.]*/, "");
  const candidate = join(ROOT, clean);
  // 1. 目录 → index.html；无 index.html 时尝试 <dir>.html（Next 单文件导出）
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const idx = join(candidate, "index.html");
    if (existsSync(idx)) return idx;
    const alt = `${candidate}.html`;
    if (existsSync(alt)) return alt;
    return null;
  }
  // 2. 直接文件
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  // 3. 无扩展名 → .html fallback
  if (!extname(candidate)) {
    const alt = `${candidate}.html`;
    if (existsSync(alt)) return alt;
  }
  return null;
}

function proxyApi(req, res) {
  const target = new URL(API_TARGET);
  const proxyReq = httpRequest(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url, // 完整透传（含 query string），不要二次拼接
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("502 Bad Gateway (API target unreachable)");
  });
  req.pipe(proxyReq);
}

createServer((req, res) => {
  const urlPath = req.url || "/";
  // /api/* 反代到后端（与生产 nginx /api 反代同口径）
  if (urlPath.startsWith("/api/") || urlPath === "/api") {
    return proxyApi(req, res);
  }
  const file = resolveFile(urlPath);
  if (file && existsSync(file) && statSync(file).isFile()) {
    const ext = extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  } else {
    // SPA 回退：未命中的页面路由交给前端 index.html（Next 静态导出支持客户端路由）
    const idx = join(ROOT, "index.html");
    if (existsSync(idx)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      createReadStream(idx).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
    }
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`static server on http://127.0.0.1:${PORT} (root: ${ROOT}, /api -> ${API_TARGET})`);
});
