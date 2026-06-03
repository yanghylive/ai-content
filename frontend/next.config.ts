import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "export",
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
