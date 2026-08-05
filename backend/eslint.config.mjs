// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import demoGuard from '../eslint-plugins/eslint-plugin-demo-guard/index.js';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // 演示舱隔离护栏（本仓库 eslint-plugins/eslint-plugin-demo-guard）
  {
    plugins: {
      'demo-guard': demoGuard,
    },
    rules: {
      'demo-guard/no-demo-in-prod': 'error',
    },
  },
  {
    rules: {
      // P1 质量门：业务源码禁止 any（存量文件已文件级豁免，新代码写 any 直接 CI 红）
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
