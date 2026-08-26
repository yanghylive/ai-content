import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { OctopLaunchBridge } from "@/components/octop-launch-bridge";

export const metadata: Metadata = {
  title: "JIUZHANG AI",
  description: "JIUZHANG AI 智能运营系统",
  referrer: "no-referrer",
  manifest: "/manifest.json",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
  },
};

/** 移动端视口：禁止双击缩放延迟，配合 safe-area（PRD 9.2）；viewport-fit=cover 让沉浸式状态栏下 env(safe-area-inset-top) 生效 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#722ed1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          {children}
          {/* Octop 拉起桥（全局）：登录页/任意页面都能响应桌面 tab 条的 octop:request-launch（审计 #6） */}
          <OctopLaunchBridge />
        </Providers>
        {/* 字体放大（PRD 16.3 无障碍）：挂载即应用本机设置 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try { var _s = Number(localStorage.getItem('jiuzhang.fontScale') || '1'); if (_s >= 1 && _s <= 1.5 && _s !== 1) { document.documentElement.style.zoom = String(_s); } } catch (e) {}",
          }}
        />
        {/* 唯一品牌主题（2026-08-23 定稿）：磨砂紫金为默认样式，无 data-vp 注入与切换 */}
        {/* PWA service worker：仅生产环境注册（PRD MOB-PWA-001） */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.startsWith('localhost') && !location.hostname.startsWith('127.0.0.1')) { window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); }); }",
          }}
        />
      </body>
    </html>
  );
}
