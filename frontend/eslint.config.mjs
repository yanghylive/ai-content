import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import demoGuard from "../eslint-plugins/eslint-plugin-demo-guard/index.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 演示舱隔离护栏（本仓库 eslint-plugins/eslint-plugin-demo-guard）
  {
    plugins: {
      "demo-guard": demoGuard,
    },
    rules: {
      "demo-guard/no-demo-in-prod": "error",
      "demo-guard/no-ignore-build-errors": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
