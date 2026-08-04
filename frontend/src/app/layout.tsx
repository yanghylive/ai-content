import type { Metadata, Viewport } from "next";
import "./astryx-layers.css";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./globals.css";
import { Providers } from "./providers";

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

/** 移动端视口：禁止双击缩放延迟，配合 safe-area（PRD 9.2） */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#17325b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
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
