/**
 * JIUZHANG AI Service Worker（PRD MOB-PWA-001 / 16.4）
 *
 * 缓存策略（严格遵循 PRD 16.4）：
 * - 只缓存应用壳与静态资源（JS/CSS/字体/图标/页面 HTML）
 * - 敏感 API 响应一律不缓存（客户/消息/账单/平台账号等走网络，no-store）
 * - 弱网时静态资源走缓存兜底，数据请求失败走网络错误
 */
const CACHE_NAME = "jiuzhang-shell-v1";

const SHELL_ASSET = [
  "/",
  "/today",
  "/content",
  "/distribution",
  "/message",
  "/mine",
  "/brand/jiuzhang-ai-icon.png",
  "/brand/jiuzhang-ai-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSET))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1) API 请求：永不缓存（PRD 16.4 敏感数据不落盘）
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 2) 静态资源（/_next/ 与品牌图标）：缓存优先，网络兜底
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request)
            .then((response) => {
              if (response.ok) {
                const clone = response.clone();
                void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
              }
              return response;
            })
            .catch(() => cached || undefined),
      ),
    );
    return;
  }

  // 3) 页面导航：网络优先（保证新鲜），失败时回退缓存壳
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || caches.match("/")),
        ),
    );
  }
});

/* ---------- Web Push（PRD 16.x：移动端 PWA 推送） ---------- */

// 接收推送：解析 JSON payload 后展示系统通知
self.addEventListener("push", (event) => {
  let data = { title: "JIUZHANG AI", body: "", url: "/today", tag: "default" };
  try {
    const parsed = event.data ? JSON.parse(event.data.text()) : {};
    data = { ...data, ...parsed };
  } catch {
    // 非 JSON payload 兜底
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/brand/jiuzhang-ai-icon.png",
      badge: "/brand/jiuzhang-ai-icon.png",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

// 点击通知：聚焦已开窗口或打开对应页面
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/today";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
