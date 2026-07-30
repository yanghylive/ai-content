import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "export",
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
