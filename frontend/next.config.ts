import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

/**
 * 演示舱编译期剔除（合规边界确认书 v2 第五节第 2 条）
 *
 * NEXT_PUBLIC_ENABLE_DEMO !== 'true' 时（默认，含所有生产/CI 构建）：
 *   webpack IgnorePlugin 把 src/app/demo/** 从产物中物理剔除——
 *   demo 实现代码一个字节都不进发布包。
 * NEXT_PUBLIC_ENABLE_DEMO === 'true' 时（本地演示构建）：
 *   demo 组件正常打包，配合 isDemoModeEnabled() 渲染完整可交互演示界面。
 *
 * 2026-08-18 S9 修复：原 resourceRegExp 指向不存在的 src/components/demo/，
 * 而 demo 实现在 src/app/demo/**（app router 路由），导致剔除从未生效、
 * out/demo/*.html 进入产物。已修正为 src/app/demo/。
 */
const isDemoBuild = process.env.NEXT_PUBLIC_ENABLE_DEMO === "true";

const nextConfig: NextConfig = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})({
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactCompiler: true,
  output: "export",
  skipTrailingSlashRedirect: true,
  // 静态导出（output: export）必须 unoptimized：next/image 默认生成 /_next/image
  // 优化端点，Electron 内置静态服务器对该端点返回 404 → 桌面端图标全部挂掉
  // （2026-08-20 登录页两个图标掉事故根因）。unoptimized 后 Image 直接输出原图 URL。
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // 显式声明空 turbopack 配置，告知 Next.js 我们选择 webpack 路径，
  // 避免 dev 启动时 Turbopack 警告阻断编译。
  turbopack: {},
  // P1-4 优化：按需导入大型图标/组件库，减少 bundle 体积
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@heroui/react",
      "recharts",
      "reactflow",
      "framer-motion",
    ],
  },
  webpack(config, { webpack }) {
    if (!isDemoBuild) {
      config.plugins.push(
        new webpack.IgnorePlugin({
          // S9 修复：demo 实际位于 app router 的 src/app/demo/**（原指向不存在的
          // src/components/demo/，导致剔除从未生效、out/demo/*.html 泄漏进产物）
          resourceRegExp: /src[\\/]app[\\/]demo[\\/]/,
        }),
      );
    }
    return config;
  },
});

export default nextConfig;
