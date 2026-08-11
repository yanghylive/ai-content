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
  /* /api 与 /auth 代理到后端 */
  if (urlPath.startsWith("/api") || urlPath.startsWith("/auth")) {
    const target = API_BASE + req.url;
    const proxyReq = http.request(target, { method: req.method, headers: { ...req.headers, host: "127.0.0.1:3011" } }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(proxyReq);
    return;
  }
  let p = decodeURIComponent(urlPath);
  if (p === "/" || p === "") p = "/index.html";
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file)) {
    if (fs.existsSync(file + ".html")) file = file + ".html";
    else { res.writeHead(404); res.end("not found"); return; }
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
