# 5409 真下线 + 17 个接口迁移交接 (2026-06-04)

## 1. 背景

**5409 (auto-upload Python 服务)** 是历史上处理所有浏览器自动化 + 多平台账号管理的服务。
**2026-06-04 已完全停掉**：进程不再 spawn、端口空闲、`~/auto-upload/db/database.db` 还在磁盘但生产代码不读。

**新系统**：
- **in-process Chrome** (playwright) 替代 5409 的 puppeteer/CDP 链路
- **microsoft/playwright-mcp** sidecar 暴露 23 个 `browser_*` 工具
- **Agent-S (17777)** 通过 MCP client 调 16 个 `mcp_call` 动作
- **Postgres (ai_content)** 是新真源，prisma 替代 5409 SQLite

## 2. 已完成（10 个）

| 提交 | 干了什么 |
|---|---|
| `7397559` | `desktop/main.js` 删 startPythonService；3 个 service 默认 URL 清零（fail-fast） |
| `cc93a7c` | `getCdpSessions` 返"已下线"占位 |
| `cedac73` | `listLogs` 改读 `runtime_executions` 表（真执行日志） |
| `08d5283` | `getHealth` / `listMaterials` / `listTasks` / `getInteractionCapabilities` 返占位 |
| `7302f8c` | `accountId` 整链路 Int→String（`runtime_executions.accountId` 改 TEXT）；新增 `sessionStatus` 字段（从 runtime_executions 反推） |
| `c0b3d20` | `listAccounts` 改读 `publish_accounts`（Postgres），删 `listAccountsFromLocalDatabase` 5409 SQLite reader；`openAccounts` 返 deprecated |
| 旧 `08d5283` 前 | `interactionTask.accountId` 改 String（之前 5409 写入时 cuid 被强转 int 1，账号关联全断） |

**当前会话中部分完成（未 commit）**：
- `AutoUploadClient` 注入 `PlaywrightMcpService` + `LocalInteractionEngineClient`
- `AutoUploadModule` 加 `imports: [LocalEngineModule]`
- `buildLoginUrl` / `cancelLogin` / `refreshAccountAvatar` 改用 playwright-mcp
- 4 个 `read*Comments/Messages` 改读 `interaction_tasks` 表
- `openInteractionEntry` 改用 playwright-mcp navigate

## 3. 17 个未扒接口（按优先级）

### 3.1 P0: 真账号登录卡点（4 个，必做）

| 接口 | 前端 | 现状 | 目标 | 代码位置 |
|---|---|---|---|---|
| `buildLoginUrl` | `distribution/page.tsx` 账号页"扫码登录" | 部分改：返 `platformLoginUrl()` 拼的真平台 URL | 已 OK | `auto-upload.client.ts:1130` |
| `cancelLogin` | `distribution/page.tsx` "取消登录" | 部分改：调 `browser_close` | 已 OK | `auto-upload.client.ts:1156` |
| `openInteractionEntry` | `workbench` 跳到评论/私信管理 | 部分改：`browser_navigate` | 已 OK | `auto-upload.client.ts:752` |
| `refreshAccountAvatar` | `distribution/page.tsx` "刷新头像" | 部分改：navigate + screenshot 框架搭好，**未保存文件** | 完整：写文件到 `backend/data/avatars/`，前端 `/api/auto-upload/avatars/:filename` 取 | `auto-upload.client.ts:1063` |

**未完 P0**：
- `refreshAccountAvatar` 的 screenshot 字节提取（playwright-mcp 返的是 text/JSON，不是 image bytes；需要用 `browser_take_screenshot` 配 `filename` 让它直接写文件）
- `backend/data/avatars/` 静态文件服务（要加 GET 路由）

### 3.2 P1: Workbench 读评论/私信（4 个）

| 接口 | 前端 | 现状 | 目标 | 代码位置 |
|---|---|---|---|---|
| `readDouyinComments` | `workbench/douyin-comments` | 改读 `interaction_tasks` (DOUYIN_COMMENT_REPLY) | 完整 | `auto-upload.client.ts:823` |
| `readDouyinMessages` | `workbench/douyin-messages` | 改读 `interaction_tasks` (DOUYIN_DIRECT_MESSAGE_REPLY) | 完整 | `auto-upload.client.ts:843` |
| `readWechatChannelComments` | `workbench/channel-comments` | 改读 `interaction_tasks` (WECHAT_CHANNEL_COMMENT_REPLY) | 完整 | `auto-upload.client.ts:863` |
| `readWechatChannelMessages` | `workbench/channel-messages` | 改读 `interaction_tasks` (WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY) | 完整 | `auto-upload.client.ts:883` |

**实现方式**（已写在 `readPlatformInteractions` 私有方法）：
- 查 `prisma.interactionTask.findMany({where: {accountId, taskType}})`
- `comments` / `messages` 字段都返 `draftText`（dispatch 时写的回复内容）
- `summary.usableCount` = `status === 'COMPLETED'` 数量
- 加 `source: 'interaction_tasks (orchestrator dispatched)'` 标识

**已知限制**：
- 5409 是实时 scrape 平台页面（navigate + 解析 a11y 树），新实现是读已 dispatch 的历史
- 用户视角：workbench 显示的是"已发过的回复"而非"待回复的评论"
- 真正实时读：得 navigate + snapshot + 解析。**等真账号登录后再做**

### 3.3 P1: 预检 + 发布（2 个）

| 接口 | 前端 | 现状 | 目标 | 代码位置 |
|---|---|---|---|---|
| `preflight` | `distribution/page.tsx` "预检" | 未改 | 用 `LocalInteractionEngineClient.preflightCheck({accountId, platform})` | `auto-upload.client.ts:??`（找不到 call 站点，可能在 controller） |
| `publish` (publishBatch) | `distribution/page.tsx` "发布" | 未改 | 路由到 `RuntimeOrchestrator.execute()` | `auto-upload.client.ts:1284` (publishBatch) |

**实现方式**：
- `preflight`：直接 `await this.engine.preflightCheck({platform, accountId})`
- `publishBatch`：对于 抖音/视频号 评论/私信，已经走 MCP dispatch。publishBatch 是**视频发布**（postVideoBatch），目前新链路没接，需要：
  - 方案 A：走 Agent-S（要做 video upload 工具）
  - 方案 B：写 Postgres `publish_records` 表 + 标记 todo，等视频上传链路接好

### 3.4 P2: 素材管理（4 个）

| 接口 | 前端 | 现状 | 目标 | 代码位置 |
|---|---|---|---|---|
| `listMaterials` | `distribution/page.tsx` 素材列表 | 返 `[]` 占位 | 读 `backend/data/materials/` 目录 | `auto-upload.client.ts:1149` |
| `uploadMaterial` | `distribution/page.tsx` 上传 | 5409 调 `/uploadSave` | 写文件到 `backend/data/materials/` + `materials` 表 | `auto-upload.client.ts:1189` |
| `deleteMaterial` | `distribution/page.tsx` | 5409 调 `/deleteFile` | 删文件 + DB | `auto-upload.client.ts:1247` |
| `materialPreviewUrl` | `distribution/page.tsx` 预览 | 5409 调 `/getFile` | 返 `/api/auto-upload/materials/preview?filename=xxx` | `auto-upload.client.ts:1223` |
| `fetchMaterialFile` (server-side) | controller 调用 | 5409 fetch `/getFile` | 同上，读文件返 buffer | `auto-upload.client.ts:1223` |

**实现方式**：
- 根目录：`backend/data/materials/` （或 env `MATERIALS_DIR` 可配置）
- `listMaterials` 扫目录 + 读 `materials` 表
- `uploadMaterial` 写文件 + 插 `materials` row
- 预览走 `fs.createReadStream`

### 3.5 P2: 任务 + 账号（3 个）

| 接口 | 前端 | 现状 | 目标 | 代码位置 |
|---|---|---|---|---|
| `listTasks` | `distribution/page.tsx` | 返 `[]` 占位 | 读 `interaction_tasks` 表 | `auto-upload.client.ts:1182` |
| `retryTask` | `distribution/page.tsx` | 5409 调 `/retryTask` | 改 `interaction_tasks.status` 重新入队 | `auto-upload.client.ts:??` |
| `deleteAccount` | `distribution/page.tsx` | 5409 调 `/deleteAccount` | 删 `publish_accounts` row | `auto-upload.client.ts:1085` |

### 3.6 P2: 证据清理 + 心跳（3 个）

| 接口 | 前端 | 现状 | 目标 | 代码位置 |
|---|---|---|---|---|
| `previewInteractionEvidenceCleanup` | 无 | 5409 调 `/interaction/evidence/cleanup-preview` | 扫 `backend/.playwright-mcp/*.yml` 文件 | `auto-upload.client.ts:599` |
| `cleanupInteractionEvidence` | 无 | 5409 调 `/interaction/evidence/cleanup` | 删过期 yml 文件 | `auto-upload.client.ts:620` |
| `checkWechatAlive` | 无 | 5409 调 `/interaction/wechat/desktop/alive` | 调 `LocalBrowserEngine.getStatus()` | `auto-upload.client.ts:933` |

### 3.7 P3: 微信桌面（5 个，AGENTS.md 约束）

按 AGENTS.md：**WeChat 桌面任务不能绕过 Agent-S/local-controller**，除非用户明确要求。

| 接口 | 现状 | 处理方式 |
|---|---|---|
| `getWechatDesktopStatus` | 5409 调 | 返 `online: false`，前端展示 "微信桌面任务走 Agent-S（17777），不要再用旧 5409 端点" |
| `listWechatWindows` | 5409 调 | 同上 |
| `resolveWechatContact` | 5409 调 | 同上 |
| `dismissWechatPopup` | 5409 调 | 同上 |
| `draftWechatReply` | 5409 调 | 同上 |
| `sendWechatReply` | 部分本地 (`executeWechatDesktopScript` Node 脚本) | **保留**，逻辑不变，只是仍走 5409 时代写的 mjs 脚本 |

### 3.8 P3: 死接口（1 个）

| 接口 | 现状 |
|---|---|
| `importArticleMaterials` | 5409 调。无人用。返 deprecated 占位。 |

## 4. 关键架构信息

### 4.1 数据源
| 数据 | 来源 | 备注 |
|---|---|---|
| 账号列表 | `publish_accounts` (Postgres) | cuid `local-engine-1` 等 + `config.engineAccountId` 兼容老 int |
| 真执行日志 | `runtime_executions` (Postgres) | orchestrator 每次 execute 写一条 |
| 互动任务 | `interaction_tasks` (Postgres) | 抖音/视频号 dispatch 任务 |
| 互动任务阶段日志 | `interaction_task_events` (Postgres) | |
| Session 状态 | 从 `runtime_executions` 24h 内最近 dispatch 反推 | `logged_in` / `needs_login` / `error` / `unknown` |
| 素材 | `backend/data/materials/` (文件) + `materials` 表 | 还没建表 |
| 头像 | `backend/data/avatars/` (文件) | 还没接 |

### 4.2 端口（现状）
```
3010 Next.js 前端
3011 NestJS 后端
17777 Agent-S (Python sidecar)
5432 Postgres (kaypal-db 容器)
6380 Redis
5409 空闲 (auto-upload 已停)
8001 空闲 (kaypal-runtime 已停)
```

### 4.3 关键文件
- `backend/src/modules/auto-upload/auto-upload.client.ts` — 17 个 5409 接口都在这里
- `backend/src/modules/auto-upload/auto-upload.controller.ts` — 控制器（路由 + 权限）
- `backend/src/modules/auto-upload/auto-upload.service.ts` — 业务包装
- `backend/src/modules/auto-upload/auto-upload.module.ts` — 已加 `imports: [LocalEngineModule]`
- `backend/src/modules/local-engine/playwright-mcp.service.ts` — MCP RPC client
- `backend/src/modules/local-engine/local-interaction-engine.client.ts` — 引擎入口
- `backend/src/modules/local-engine/local-browser-engine.service.ts` — in-process Chrome
- `backend/src/modules/local-engine/platform-interaction-executor.service.ts` — 真 fill+click
- `desktop/sidecars/agent-s-executor/kaypal_mcp_client.py` — Agent-S 端 MCP client
- `desktop/sidecars/agent-s-executor/runner.py` — Agent-S 主循环 + `_execute_mcp_action`

### 4.4 环境变量
```
KAYPAL_MCP_TOKEN=  # /api/mcp/* 鉴权 (loopback 绕过)
PERSIST_PROFILE=  # 真账号登录用
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_content
AUTH_COOKIE_NAME=ai_content_session
KAYPAL_RUNTIME_SHARED_SECRET=runtime-secret
AGENT_S_BASE_URL=http://127.0.0.1:17777
AUTO_UPLOAD_ENGINE_ROOT=  # 新代码借它当 Chrome profile 根目录 (留)
```

### 4.5 Prisma 模型
- `RuntimeExecution` (`accountId: String?` @id cuid) — 真执行日志
- `InteractionTask` (`accountId: String?` cuid) — 互动任务
- `PublishAccount` (id cuid) — 多平台账号
- `PublishRecord` — 发布记录
- `LocalEngineInteractionTask` — 旧的，未用 (空表)

## 5. 阻塞项

1. **真账号登录**：抖音/视频号账号未登录 (dispatch 看到 login 关键字)。需 `PERSIST_PROFILE=true` + 用户扫码
2. **Windows VM 验**：需要 Windows 机器验
3. **抖音/视频号真发评论/私信选择器**：fill+click 走通，但选择器是占位，需真账号页面调通
4. **`/capabilities/users` 页面** 未删 (commit `220315f` 误解用户需求，审计打脸；待用户决定)
5. **AGENTS.md `WeChat 桌面任务`** 约束：5 个 wechat-desktop 端点需走 Agent-S，没现成工具

## 6. 当前会话未 commit 的代码

```
backend/src/modules/auto-upload/auto-upload.client.ts  (大改, 已上 todo)
backend/src/modules/auto-upload/auto-upload.module.ts  (加 LocalEngineModule import)
```

**没 commit 因为还在改**。下次接着干从这里开始。

## 7. 验收清单

每个接口改完后必须：
1. `cd backend && npx tsc --noEmit` 0 错误
2. `cd backend && npm run build` 0 错误
3. 重启后端: `kill -9 $(lsof -nP -i :3011 -sTCP:LISTEN -t) && cd backend && nohup node --enable-source-maps dist/main.js > /tmp/kaypal-backend.log 2>&1 &`
4. 登录 admin (password: `Admin123!@#`) 拿 cookie
5. `curl -b /tmp/jar http://127.0.0.1:3011/api/auto-upload/<endpoint>` 返 200 + 真数据
6. 提交：`[bugfix] 修 X: <一句白话>`

## 8. 用户关注点

- **说白话**：不要技术黑话
- **说全**：别"前端没调"当借口，5409 时代都调试好，**都得迁**
- **不假装无辜**：之前的错误老实承认
- **看 dist**：`backend/dist/` 是 gitignore，**改完代码一定要 build + restart**，不然前端拿到的是老代码
- **AGENTS.md 4 护栏** 守住
