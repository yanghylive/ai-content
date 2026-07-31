import type { NextConfig } from "next";
import { IgnorePlugin } from "webpack";

/**
 * 演示舱编译期剔除（合规边界确认书 v2 第五节第 2 条）
 *
 * NEXT_PUBLIC_ENABLE_DEMO !== 'true' 时（默认，含所有生产/CI 构建）：
 *   webpack IgnorePlugin 把 src/components/demo/** 从产物中物理剔除——
 *   demo 实现代码一个字节都不进发布包。
 * NEXT_PUBLIC_ENABLE_DEMO === 'true' 时（本地演示构建）：
 *   demo 组件正常打包，配合 isDemoModeEnabled() 渲染完整可交互演示界面。
 */
const isDemoBuild = process.env.NEXT_PUBLIC_ENABLE_DEMO === "true";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "export",
  typescript: {
    ignoreBuildErrors: false,
  },
  // 显式声明空 turbopack 配置，告知 Next.js 我们选择 webpack 路径，
  // 避免 dev 启动时 Turbopack 警告阻断编译。
  turbopack: {},
  webpack(config, { isServer }) {
    if (!isDemoBuild) {
      config.plugins.push(
        new IgnorePlugin({
          resourceRegExp: /src[\\/]components[\\/]demo[\\/]/,
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
