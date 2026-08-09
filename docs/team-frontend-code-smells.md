# 前端代码异味 · 团队规范 v1

> **目的**：把 2026-07-30 清理 26 个 lint warning 时发现的高频问题，提炼成 5 条可防、可查、可分享的规则。
> **维护者**：高级开发工程师（吴八哥）
> **如何验证**：`npm run lint:strict` 0 warning（包含 0 max-warnings）必过 PR。

---

## 规则 1：未使用的 import 当天清

### 现象
- `@heroui/react` 等大型库一次拉 10+ 组件，但只用 3 个
- 重构后忘了删 type import

### 怎么避
- 写完 PR 前，**关闭自动 import**，跑一次 `npm run lint`
- IDE 设置：开启 ESLint on-save 自动删 unused imports（VSCode: `"editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }`）

### 怎么查
- `npm run lint` 直接报，**立刻修**，不要 commit 后再回头

### 真实案例
2026-07-30 清理 19 个 unused import，平均每个文件节省 5-10 行：

| 文件 | 删除内容 |
|---|---|
| `data.ts` | 整行 `import { Article }` |
| `capabilities/risk/page.tsx` | 7 个 @heroui 子组件 |
| `agent-workbench-client.tsx` | 7 个 @heroui Modal/Divider + 2 个 type alias + 1 个 const 表 |
| `workbench/page.tsx` | Card / CardBody |
| `cloud-api-adapter.ts` | 整个 `UpdateEventCallbacks` interface（10 行） |

---

## 规则 2：死函数 / 死常量不要留

### 现象
- 写了 200+ 行的子组件（如 `SessionCard`/`WechatSessionPanel`），但 JSX 从未引用
- 重构时合并调用点，但保留原组件定义

### 怎么避
- 写完组件前，**先**画 JSX 用法，再实现
- 删调用点时，**同时**用 `npm run lint` 找死定义
- 写工具脚本如 `unused-exports` 在 CI 上找未导出 vs 导出但未用

### 怎么查
- ESLint `no-unused-vars` + `@typescript-eslint/no-unused-vars`（含 `varsIgnorePattern: '^_' ` 让 `_<name>` 不报警）
- IDE 装 **TS Quick Fixes** 插件，"Remove Unused" 一键

### 真实案例
| 删除 | 体量 | 原因 |
|---|---|---|
| `agent-workbench-client.tsx` `SessionCard` | 21 行 | 组件被替换为新架构 |
| `local-engine-client.tsx` `WechatSessionPanel` | 287 行 | 整个模块未接入 |
| `interaction-skills.ts` `buildWechatMomentsInstruction` | 30 行 | 朋友圈发布挪到演示舱 |
| `cloud-api-adapter.ts` `UpdateEventCallbacks` | 10 行 | Electron update 流式 API 未对接 |

---

## 规则 3：React Hooks 依赖，宁可少不要假

### 现象
- deps 数组含**模块级常量**或**派生变量**，linter 报"unnecessary dep"
- 漏 deps，linter 报"missing dep"
- 错误用 `// eslint-disable-next-line` 盲目豁免

### 怎么避
- 真的不需要 deps 时，**从 deps 数组移除**（不是加 disable）
- 真的需要 deps 但 linter 误报时，加 disable 注释**必须写在被禁用行之前一行**，并写明原因
- 一次性 `useEffect(() => {...}, [])` 应当**显式空数组**，不依赖隐性推断

### 怎么查
- 每次写 useEffect 必跑 `npm run lint`
- 启用了 `react-hooks/exhaustive-deps` 规则

### 真实案例
| 修复 | 关键决策 |
|---|---|
| `local-engine-client.tsx` `[legacyInteractionRoutes, requestedTab, router]` → `[requestedTab, router]` | `legacyInteractionRoutes` 是模块级常量，从 deps 移除 |
| `local-engine-client.tsx` `[businessRoute, isBusinessRoute, route]` → `[businessRoute, route]` | `isBusinessRoute` 由 `route` 派生 |
| `ops-workbench-view.tsx` 3 个 useEffect 加 `// eslint-disable-next-line` | **真实** 不可去 deps 的（agentS 来自 hook，polling by session id） |

### 反面教训
- ❌ 把 `// eslint-disable-next-line` 放在 `useEffect` **外**（被 detect 误以为是 disable 未生效）
- ❌ 把 `// eslint-disable-next-line` 放在 deps `,` 之后（不是被禁用行的**下一行**）
- ❌ 注释行写"why"但 linter 不读注释（仍然报 warning）

---

## 规则 4：dynamic `<img>` 在 static export 模式下保留

### 现象
- `next/image` 在 build 时会尝试下载远程 URL 优化
- dynamic src（用户上传的截图/视频帧）走 static export 时**会失败**

### 怎么避
- static export 项目（`output: "export"`）：**保留 `<img>` + 注释豁免**
- 用 Next 自托管（`output: "standalone"`）：可改 `<Image unoptimized>`
- 静态资源（public/ 下）：直接 `<Image>` 不豁免

### 怎么查
- linter 报 `@next/next/no-img-element` 时看 `next.config.ts` 输出模式

### 真实案例
`local-engine-client.tsx` 4761 行：用户上传的截图作为证据展示，必须保留 `<img>` + `// eslint-disable-next-line @next/next/no-img-element -- 动态 src 走 static export,next/image 会试图下载优化导致失败`

---

## 规则 5：typescript.ignoreBuildErrors 永远是 false

### 现象
- 上游加新类型错误时，`tsc --noEmit` 报错
- 解法改成 `ignoreBuildErrors: true`，**静默吞掉**
- 生产构建 type 错漏

### 怎么避
- 把"永远 false"写成**自定义 ESLint 规则**自动守门
- CI 上加 `tsc --noEmit` 独立 step（不仅 build 走）
- 任何"`ignoreBuildErrors` 是 true" 的 PR 一律不合并

### 怎么查
- 仓库根 `.workbuddy/.../eslint-plugin-demo-guard/no-ignore-build-errors` 规则自动红线
- `next.config.ts` 文件改动触发守门

### 真实案例
2026-07-30 盾甲甲修复 18 个 tsc 错误后改回 `false`，吴八哥（吴八哥）随后落 `demo-guard/no-ignore-build-errors` 自定义规则护住这个开关。

---

## 🆘 紧急"自助"工具

| 场景 | 命令 | 预期 |
|---|---|---|
| 我代码能不能上 | `npm run lint:strict && npm run typecheck` | 都 0 才过 |
| 我新增的 demo 仓是否合规 | `npm run demo:guard` | 0 violation |
| 我提交前的全套自检 | `cd .. && node scripts/ci/demo-guard-ci.mjs && cd frontend && npm run lint:strict && npm run typecheck` | 全绿 |

---

**📅 维护历史**：
- 2026-07-30 22:47 — v1 吴八哥首版，基于当日清理 26 warning 的 5 类代码异味
