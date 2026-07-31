# 团队代码质量护栏（Code Quality Gates）

> **目的**：让团队技术能力提升靠**制度而非人**——所有规则都在 CI 上自动跑，编辑器里红线提示，本地能自查。
> **维护者**：高级开发工程师（吴八哥）
> **依据**：《合规边界确认书 v2》《DEMO_MODULE_CONTRACT.md》

---

## 🎯 5 道质量门（任何一道不过都阻断 PR 合并）

| 门 | 工具 | 检查什么 | 在哪报红 |
|---|---|---|---|
| ① Demo舱隔离规范 | `scripts/ci/demo-guard-ci.mjs` | production 路径不能 import demo；release 不能开 demo；demo 不能有真实凭证/账号 | CI、PR 评论 |
| ② 前端 ESLint（含演示舱两条自定义规则） | `eslint-plugins/eslint-plugin-demo-guard` | demo-guard/no-demo-in-prod + demo-guard/no-ignore-build-errors | 编辑器 + `npm run lint` + CI |
| ③ 前端 TypeScript 严格类型 | `tsc --noEmit` | 16 个 tsc 错误 → 打包失败（曾因 `ignoreBuildErrors:true` 静默吞掉，2026-07-30 修复） | CI |
| ④ 后端 ESLint（含演示舱规则） | 同上 | 同上 | `npm run lint` + CI |
| ⑤ 后端 TypeScript 严格类型 | `tsc --noEmit` | 类型安全 | CI |

---

## 🚀 写代码的 4 步走

### 1. 写 demo 前（仅当确实需要演示舱模块）
- 读 [`DEMO_MODULE_CONTRACT.md`](./DEMO_MODULE_CONTRACT.md)
- 建立 `**/demo/` 目录或 `*.demo.tsx` 文件
- 用 `isDemoModeEnabled()` / `requireDemoMode()` 守卫

### 2. 写非 demo 代码前
- 任何 import 路径**不要**含 `/demo/`、`@/demo/`、`~/demo/`
- 编辑器会立刻红线（demo-guard/no-demo-in-prod）
- 不要把 `next.config.ts` 的 `typescript.ignoreBuildErrors` 改回 `true`
- 编辑器会立刻红线（demo-guard/no-ignore-build-errors）

### 3. 提交前
```bash
# 演示舱自检（dev 自查用，不阻塞）
npm run demo:check

# CI 守门同步（应当与本地一致）
npm run demo:guard

# 前端 ESLint（含 demo-guard 两条规则）
cd frontend && npm run lint

# 前端 tsc
cd frontend && npm run typecheck

# 后端 ESLint
cd backend && npm run lint
```

### 4. 推 PR 时
- GitHub Actions 会自动跑完 5 道质量门
- 任何一道红 → PR 不可合并
- 标 ✅ 后由 reviewer 接管 code review

---

## 📂 护栏相关文件位置

```
仓库根
├── CODE_QUALITY_GATES.md                   ← 本文件（团队使用手册）
├── DEMO_MODULES_DISCLAIMER.md              ← 演示舱免责说明
├── DEMO_MODULE_CONTRACT.md                 ← 写 demo 前的强制契约
├── eslint-plugins/
│   └── eslint-plugin-demo-guard/
│       └── index.js                        ← 2 条自定义规则
├── scripts/
│   ├── ci/demo-guard-ci.mjs               ← CI 守门
│   └── demo-guard.mjs                      ← 本机自检
└── .github/workflows/
    ├── demo-guard.yml                      ← ① demo 守门
    └── quality-gates.yml                   ← ② ③ ④ ⑤ 4 道门
```

---

## 🔧 5 道门挂载位置

| 门 | 触发位置 | 触发方式 |
|---|---|---|
| ① demo-guard | `quality-gates.yml` job 1 | `uses: ./.github/workflows/demo-guard.yml`（复用既有） |
| ② ③ 前端 lint + tsc | `quality-gates.yml` job 2/3 | `cd frontend && npm CI && npm run lint / typecheck` |
| ④ ⑤ 后端 lint + tsc | `quality-gates.yml` job 4/5 | `cd backend && npm CI && npm run lint && npx tsc --noEmit` |

---

## 🛡️ 三道以前没的护栏（高级开发落地）

### 1. ESLint 自定义规则
- `no-demo-in-prod` — production 路径禁止 `@/demo/`、`/demo/` 等字符串字面量
- `no-ignore-build-errors` — `next.config.ts` 改回 `true` 立即红线
- **比 CI 早一步**：开发者保存文件时编辑器就报告

### 2. 演示舱门禁模块
- 前端 `frontend/src/lib/demo/isDemoModeEnabled.ts` — env + token + production 三重校验
- 后端 `backend/src/lib/demo/demo-mode.ts` — `requireDemoMode()` 守卫

### 3. CI 质量门集中
- 旧有：分散的 `demo-guard.yml` + 各类手写脚本
- 现在：5 道门集中到 `quality-gates.yml`，一处配置、一次跑通

---

## 📋 加新门时的 3 条规则

1. **先写本地脚本**：在 `scripts/ci/` 或 `scripts/` 落地可独立执行的检查
2. **挂到 quality-gates.yml**：作为新 job 串行加入
3. **更新本文档**：表格加一行 + 同步挂载方式

**永远不要打散 quality-gates.yml**——这是单点入口，新人提交的每一次改动都必须经过这 5 道门。

---

## 🆘 常见问题

### Q：发现真违规被守门拦下了，但项目确实需要这个能力怎么办？
A：先看是否属「演示舱」范畴。是 → 走 `requireDemoMode()` 守卫按 demo 路径走；否 → 走《合规边界确认书 v2》签字流程后重新评估。**绝不**绕守门。

### Q：CI 跑失败但本地没问题？
A：99% 是 NODE_OPTIONS 或代理环境差异。CI 显式 `env: NODE_OPTIONS: ''` 清理。**永远不要**为了绕过 CI 而加 `--no-verify` 之类。

### Q：自定义规则与社区规则冲突了？
A：优先级：本仓库 `eslint-plugins/eslint-plugin-demo-guard` > 第三方插件。在 config 里显式声明。

---

**📅 维护历史**：
- 2026-07-30 22:24 — 吴八哥首版：5 门集中 + 2 条自定义规则 + 团队使用手册
- 2026-07-30 22:36 — 整合 demo-guard-ci + 类型检查 + ESLint 自定义规则到 quality-gates.yml
