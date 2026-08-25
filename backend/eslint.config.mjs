// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import demoGuard from '../eslint-plugins/eslint-plugin-demo-guard/index.js';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'src/test*.js', '**/*.spec.ts', '**/*.test.ts'],
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
      // P0 质量门：禁止空块（空 catch = 吞异常；存量已加注释，新代码写空 catch 直接 CI 红）
      'no-empty': 'error',
      // P1 质量门：业务源码禁止 any（存量文件已文件级豁免，新代码写 any 直接 CI 红）
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // C3：下划线前缀 = 有意忽略的变量/参数（解构占位、未用参数），不报未用
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // sync/async 双兼容设计（内存 store 同步 + Prisma store 异步，接口用同步声明）：
      // gateway 有意 `await` 同步值以兼容 async 实现；mock 方法 async 无 await 是接口约束的合理模式。
      // 这两个是设计误报，非 bug，显式关闭（保留真实 await 语义的其它规则不受影响）。
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/await-thenable': 'off',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
