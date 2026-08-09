# AI Content 一体化桌面安装包迁移执行记录 · Phase 0/1

日期：2026-06-08

目标：不做 PyInstaller/Nuitka，不让用户安装 Python、Docker、Postgres、Redis、Chrome。产品主线迁到 Electron + Node backend + SQLite + Node Agent Runtime + bundled Playwright Chromium。

## 三专家分工

| 方向 | 结论 |
|---|---|
| 运行时/桌面打包 | 当前 `desktop/main.js` 仍会启动 Python Agent-S sidecar；`desktop/package.json` 仍会把 `sidecars/agent-s-executor` 打进包；安装器仍检测/下载 Python 和 Postgres。Phase 1 先把浏览器主链路统一到 Node Playwright runtime，避免运行时 `npx @playwright/mcp@latest` 和系统 Chrome 假设。 |
| 数据存储/队列 | Redis/BullMQ 不是当前主矛盾，真实队列已经是单进程轮询 + Prisma 表。主矛盾是 Prisma/Postgres 直连，以及 `String[]` 字段阻断 SQLite provider 切换。 |
| 自动化执行/Agent-S | Phase 1 要保留 `/agent-s/*` API 形状，先让前端和 Router 不变；内部实现逐步从 Python sidecar 换成 Node Agent Runtime。平台 selector 和发送逻辑暂不散点改。 |

## Phase 0 已落地

- 新增静态依赖审计脚本：`scripts/audit-one-click-runtime-deps.mjs`。
- 新增 Node Agent Runtime 兼容契约：`backend/src/modules/runtime/node-agent-runtime/node-agent-runtime.contract.ts`。
- 新增 Node Agent Runtime mock-compatible service：`backend/src/modules/runtime/node-agent-runtime/node-agent-runtime.service.ts`。
- `/agent-s/*` controller 增加开关：`KAYPAL_NODE_AGENT_RUNTIME=1` 时走 Node runtime；默认仍走旧 `AgentSService`。
- `desktop/main.js` 增加同一开关：`KAYPAL_NODE_AGENT_RUNTIME=1` 时不启动 Python sidecar，并把开关注入后端 env。
- 新增开关分流单测：`backend/src/modules/local-engine/agent-s.controller.spec.ts`。
- `PlaywrightMcpService` 不再运行时 `npx @playwright/mcp@latest` 下载，改为解析本地已安装/已打包的 `@playwright/mcp/cli.js`。
- 修复旧 Python sidecar approval 兼容：3011 仍暴露 `/agent-s/sessions/:id/approve`，旧 sidecar 实际是 `/sessions/:id/approval`，`AgentSService.approveSession()` 现在先试 `/approve`，404 时 fallback 到 `/approval`。
- 修复打包资源缺口：`desktop/package.json` 已把 `backend/node_modules/@playwright/mcp` 打进 `resources/backend/node_modules/@playwright/mcp`，避免打包后找不到本地 MCP CLI。
- 保持现有执行逻辑不变，不接管路由，不改平台 selector。

## 依赖事实

| 依赖 | 当前事实 | 迁移判断 |
|---|---|---|
| Python | `desktop/main.js` 找 Python 3.12、建 venv、启动 `agent-s-executor/main.py`。 | 产品主线必须替换；Phase 1 固定 API 契约，后续实现 Node runtime。 |
| Postgres | `backend/prisma/schema.prisma` datasource 是 `postgresql`；`desktop/backend.env` 默认 Postgres URL。 | Phase 2 切 SQLite；先处理 `String[]` 字段和 store 抽象。 |
| Redis | package/compose 有残留；运行时核心队列不是 Redis。 | Phase 2 清理产品包依赖，不作为第一阻塞项。 |
| Chrome | CDP 引擎会找系统 Chrome 或 Playwright cache。 | Phase 3 改成 bundled Playwright Chromium 默认路径。 |
| Playwright MCP | 原先存在 `npx @playwright/mcp@latest` 现场拉包假设，现已改成本地 CLI 解析。 | 后续 Phase 3 再决定保留本地 MCP sidecar，还是彻底改成直接 Node Playwright controller。 |

## Phase 1 当前边界

1. 固定 Node Agent Runtime API：
   - `GET /agent-s/status`
   - `GET /agent-s/health`
   - `POST /agent-s/sessions`
   - `POST /agent-s/sessions/:sessionId/run`
   - `GET /agent-s/sessions/:sessionId/events`
   - `POST /agent-s/sessions/:sessionId/cancel`
   - `POST /agent-s/sessions/:sessionId/approve`
   - `GET /agent-s/sessions/:sessionId/artifacts`
2. 不改变前端调用口，不改变 `LocalEngineController` 现有 agent session 工作流。
3. 不继续堆平台 selector 修补。
4. 先让静态审计脚本成为每个阶段的入口检查。

## 下一步

1. 把 Node runtime 从 mock-compatible 推进到 Playwright browser controller，但仍保持 API 形状不变。
2. 设计 Phase 2 的 SQLite schema/provider 切换方案，优先处理 `String[]` 字段。

## 当前验证

- `node scripts/audit-one-click-runtime-deps.mjs --summary` 可运行。
- `npx tsc --noEmit -p backend/tsconfig.json` 通过。
- `node --check desktop/main.js` 通过。
- 直接实例化 `NodeAgentRuntimeService` 的 create/run/events/artifacts smoke 通过。
- `npm test -- agent-s.controller.spec.ts agent-s.service.spec.ts runtime-module-wiring.spec.ts --runInBand` 通过。

## 本轮 bug 复查结论

1. 默认路径未切换：`KAYPAL_NODE_AGENT_RUNTIME` 不等于 `1` 时，`/agent-s/*` 仍走旧 `AgentSService`，desktop 仍会启动 Python sidecar。
2. Node runtime 路径可切换：`KAYPAL_NODE_AGENT_RUNTIME=1` 时，desktop 不启动 Python sidecar，后端 `/agent-s/*` 走 Node mock-compatible runtime。
3. 旧 sidecar approval 路径已兼容：避免前端点 `/approve` 时旧 FastAPI sidecar 只有 `/approval` 导致 404。
4. Playwright MCP 不再运行时下载：代码里已无 `spawn('npx')` / `@playwright/mcp@latest` 运行调用；剩余关键词是执行记录中的历史描述。
5. 打包资源已补：本地 MCP CLI 会随桌面包进入 `resources/backend/node_modules/@playwright/mcp`。

## 暂不做

- 不切 SQLite provider。
- 不删除 Python 文件。
- 不改抖音/视频号执行 selector。
- 不改安装器依赖下载逻辑。
- 不打安装包。
