"use strict";

/**
 * eslint-plugin-demo-guard
 *
 * 两道防线（编辑器红线 + CI 守门）：
 *   1. no-demo-in-prod           禁止 production 路径 import 本地 demo 模块
 *   2. no-ignore-build-errors    防止 next.config.ts 把 typescript.ignoreBuildErrors 改回 true
 *
 * 不依赖任何 npm 包，纯 Node 原生。
 * 见：合规边界确认书 v2 第五节 + 安全护栏 盾甲甲加固
 */

const path = require("node:path");

// ────────────────────────────────────────────────────────────
// 规则 1：no-demo-in-prod
// ────────────────────────────────────────────────────────────
const DEMO_HINTS = [
  "/demo/",
  "/demo.",
  "@/demo/",
  "~/demo/",
  "../../demo",
  "../demo",
  "./demo/",
];

/** @type {import('eslint').Rule.RuleModule} */
const noDemoInProdRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "禁止 production 路径 import 本地 demo 模块。demo 代码必须物理隔离在 **/demo/** 下，详见 DEMO_MODULE_CONTRACT.md。",
    },
    schema: [],
    messages: {
      noDemoImport:
        "production 文件 {{file}} 不允许 import demo 模块 '{{source}}'。demo 模块必须放在 **/demo/** 目录下，或改用合规 API。详见 DEMO_MODULE_CONTRACT.md 与合规边界确认书 v2 第五节。",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    const normalized = filename.split(path.sep).join("/");

    // 文件本身就在 demo 目录下，放行（demo 文件互相 import OK）
    const isDemoFile =
      normalized.includes("/demo/") ||
      normalized.endsWith(".demo.ts") ||
      normalized.endsWith(".demo.tsx") ||
      normalized.endsWith(".demo.js");

    if (isDemoFile) return {};

    function checkSource(node) {
      const source = node.source && node.source.value;
      if (typeof source !== "string") return;

      // 仅拦截本地 demo 路径。外部 npm 包不算。
      if (source.startsWith(".") || source.startsWith("@/") || source.startsWith("~/")) {
        const hits = DEMO_HINTS.some((hint) => source.includes(hint));
        if (hits) {
          context.report({
            node: node.source,
            messageId: "noDemoImport",
            data: {
              file: path.basename(filename),
              source,
            },
          });
        }
      }
    }

    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression: checkSource,
    };
  },
};

// ────────────────────────────────────────────────────────────
// 规则 2：no-ignore-build-errors
// ────────────────────────────────────────────────────────────
/** @type {import('eslint').Rule.RuleModule} */
const noIgnoreBuildErrorsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "禁止把 next.config.ts 的 typescript.ignoreBuildErrors 改回 true（曾因 true 吞掉 18 个 tsc 错误，2026-07-30 盾甲甲修复）。",
    },
    schema: [],
    messages: {
      noIgnoreBuildErrors:
        "typescript.ignoreBuildErrors 必须是 false。true 会让打包时静默吞掉所有类型错误，破坏类型安全护栏。",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    const normalized = filename.split(path.sep).join("/");

    // 仅对 next.config 系列生效
    const isTargetFile =
      /(?:^|[\\/])(?:next|vite)\.config\.(?:ts|mjs|cjs|js)$/.test(normalized);
    if (!isTargetFile) return {};

    return {
      Property(node) {
        if (
          node.key &&
          ((node.key.type === "Identifier" && node.key.name === "ignoreBuildErrors") ||
            (node.key.type === "Literal" && node.key.value === "ignoreBuildErrors") ||
            (node.key.type === "MemberExpression" &&
              node.key.property &&
              node.key.property.name === "ignoreBuildErrors"))
        ) {
          // 必须是 false；true / 没设都报错
          const value = node.value && node.value.value;
          if (value !== false) {
            context.report({
              node: node.key,
              messageId: "noIgnoreBuildErrors",
            });
          }
        }
      },
    };
  },
};

// ────────────────────────────────────────────────────────────
// 插件导出
// ────────────────────────────────────────────────────────────
module.exports = {
  rules: {
    "no-demo-in-prod": noDemoInProdRule,
    "no-ignore-build-errors": noIgnoreBuildErrorsRule,
  },
  configs: {
    recommended: {
      plugins: ["demo-guard"],
      rules: {
        "demo-guard/no-demo-in-prod": "error",
        "demo-guard/no-ignore-build-errors": "error",
      },
    },
  },
};
