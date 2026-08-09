# 5409 真下线交接 (2026-06-05 01:35 PDT)

## 目标

终极代码合并口径：用户入口只有 `3010`，后端能力由 `3011` 提供，原 `5409 auto-upload` 不再作为独立运行服务、数据源或兜底引擎使用。

当前链路：

```text
3010 Next.js UI
  -> 3011 NestJS API
  -> 3011 in-process Runtime / Playwright MCP / Agent-S
  -> 平台网页、浏览器、桌面能力
```

## 当前结论

`5409` 运行路径已经从主要业务代码里下线。

已确认的原则：
- 不再 HTTP 调 `127.0.0.1:5409`。
- 不再读取 `~/auto-upload/db/database.db` 作为账号真源。
- 不再读取 `~/auto-upload/videoFile` 作为素材真源。
- 不再因为旧引擎返回 taskId、`sent=true` 或 `status=sent` 就判商用成功。
- 发布没有平台回执或页面回读时，只能返回 `pending_manual` / `not_integrated`，不能返回成功。
- 客户互动发送、草稿、回读必须走 3011 Runtime 的证据链。

## 已迁移接口

| 能力 | 当前实现 | 代码位置 |
|---|---|---|
| health | `PlaywrightMcpService.getStatus()`，返回 `internal://playwright-mcp` | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| cdp sessions | 读 `publish_accounts` + MCP 状态，返回 3011 Runtime 会话信息 | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| interaction capabilities | 返回四条客户互动能力和本地证据目录 | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| evidence cleanup preview/execute | 扫描/清理 `backend/.local-logs/browser-evidence` | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| accounts | 读 Postgres `publish_accounts` | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| open accounts | 用 Playwright MCP 打开平台后台 | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| login url / cancel login | 返回平台登录页；取消时关闭 MCP 浏览器 tab | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| refresh avatar | 打开平台页面并保存截图到 `backend/data/avatars`，通过 `/api/auto-upload/avatars/:filename` 访问 | `backend/src/modules/auto-upload/auto-upload.client.ts`, `backend/src/modules/auto-upload/auto-upload.controller.ts` |
| open interaction entry | 用 Playwright MCP 进入抖音/视频号评论或私信入口 | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| read comments/messages | 读 Postgres `interaction_tasks`，展示已执行记录 | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| logs | 读 `runtime_executions` + interaction log | `backend/src/modules/auto-upload/auto-upload.service.ts` |
| tasks | 读 `interaction_tasks` | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| materials list/upload/delete/preview | 使用 `backend/data/materials` + `index.json` | `backend/src/modules/auto-upload/auto-upload.client.ts` |
| import article materials | 从文章的小红书成品卡图下载后写入 `backend/data/materials` | `backend/src/modules/auto-upload/auto-upload.service.ts` |
| preflight publish | 检查 3011 Runtime、账号、素材、封面、排期参数 | `backend/src/modules/auto-upload/auto-upload.service.ts` |
| publish | 已迁入 3011 Runtime：抖音/视频号/小红书/快手图文与视频、B站视频走浏览器真实执行；B站图文等未迁入能力继续返回 `not_integrated` | `backend/src/modules/auto-upload/auto-upload.client.ts`, `backend/src/modules/auto-upload/auto-upload.service.ts`, `backend/src/modules/runtime/platforms/publishing/platform-publish.service.ts` |
| delete account | 删除 Postgres `publish_accounts`，需要高风险确认 | `backend/src/modules/auto-upload/auto-upload.service.ts` |
| retry task | 客户互动任务不按发布任务重试；发布任务重试必须重新预检并保留风险确认 | `backend/src/modules/auto-upload/auto-upload.service.ts` |
| 微信桌面状态/窗口/联系人/弹窗/草稿 | 明确阻断到 Agent-S/local-controller，未接入前不假执行 | `backend/src/modules/auto-upload/auto-upload.client.ts` |

## 数据与目录

| 数据 | 当前真源 |
|---|---|
| 平台账号 | Postgres `publish_accounts` |
| 客户互动任务 | Postgres `interaction_tasks` |
| 执行日志 | Postgres `runtime_executions` |
| 素材文件 | `backend/data/materials` |
| 素材索引 | `backend/data/materials/index.json` |
| 账号头像 | `backend/data/avatars` |
| 浏览器 profile | `LOCAL_BROWSER_PROFILE_ROOT` -> `backend/data/browser-profiles`；只有显式配置 `LEGACY_AUTO_UPLOAD_ROOT` / `LEGACY_AUTO_UPLOAD_BROWSER_PROFILE_ROOT` 时才迁移旧 profile |
| 浏览器证据 | `LOCAL_BROWSER_EVIDENCE_ROOT` -> `backend/.local-logs/browser-evidence` |
| 系统日志 | `.local-logs` |

## 必须守住的商用边界

1. `taskId` 只代表任务创建，不代表发布成功。
2. `completed` 只代表内部任务结束，不代表平台回读成功。
3. `sent=true` / `status=sent` 不能单独作为成功证据。
4. 真实成功必须至少有一类证据：平台 API 回执、平台页面回读、截图/文本证据、失败原因。
5. `DISPATCH_MOCK=true` 只能硬失败，不能返回成功。
6. 微信桌面能力未接入 Agent-S/local-controller 前，不允许执行真实微信窗口操作。

## 已验证

执行时间：2026-06-05 01:35 PDT。

本轮验证：
- `cd backend && npm run build` 通过。
- 相关单测通过：`local-runtime-engine.client.spec.ts`、`browser-control.service.spec.ts`、`interaction-task-runtime.mapper.spec.ts`、`auto-upload.service.spec.ts`，共 29 条。
- `local-runtime-engine.client.spec.ts` 已从旧 HTTP/fetch 版改成 3011 in-process Runtime 版。
- 测试中不再把 `127.0.0.1:5409`、`AUTO_UPLOAD_ENGINE_URL`、`本地发布服务` 当作预期路径。

已做过接口冒烟：
- `/api/auto-upload/health`
- `/api/auto-upload/cdp-sessions`
- `/api/auto-upload/interaction/capabilities`
- `/api/local-engine/health`
- `/api/local-engine/files/status`
- `/api/auto-upload/materials`
- `/api/auto-upload/preflight`
- `/api/auto-upload/publish`

关键结果：
- 上传到 `backend/data/materials` 可用。
- 图片素材 preflight 可通过。
- 发布接口已经不再依赖 5409：抖音/视频号/小红书/快手图文与视频、B站视频进入 `platform-publish` Runtime。
- 小红书图文真实执行已验证到账号登录阻断：返回 `login_required`，不是 `not_integrated`，也不是假成功。
- 未迁入能力仍返回 `not_integrated` 或在 preflight 阶段明确阻断，不会假装成功。

## 仍未完成但不属于 5409 下线的问题

这些是后续业务能力，不是 5409 残留：

1. 发布中心还缺真实账号登录后的完整回读验收：已进 Runtime 的平台需要用真实登录态跑成功页/管理页回读。
2. B站图文发布旧 5409 也没有真实图文 uploader；当前已在 preflight 阶段返回 `platform_not_supported`，提示只支持 B站视频投稿。
3. 四条客户互动仍需要真实账号连续验收：抖音评论、抖音私信、视频号评论、视频号私信，各 5 轮。
4. 微信桌面能力还没接入 Agent-S/local-controller：微信群发、朋友圈、微信聊天窗口操作应继续阻断。
5. `backend/src/modules/runtime/README.md` 仍是老阶段说明，可以后续单独更新文档，不影响运行代码。
6. 真实平台 selector 需要在平台页面变化后继续维护。

## 下次继续时先做

1. 不要重启或恢复 5409。
2. 先跑：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/backend
npm run build
npm test -- --runInBand src/modules/runtime/local-runtime-engine.client.spec.ts src/modules/runtime/browser-control/browser-control.service.spec.ts src/modules/runtime/orchestrator/interaction-task-runtime.mapper.spec.ts src/modules/auto-upload/auto-upload.service.spec.ts
```

3. 如果要验证运行态，重启 3011 后用 cookie 调接口，不要只看前端按钮：

```bash
curl -s -c /tmp/ai-content-auth.cookies \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin123!@#"}' \
  http://localhost:3011/api/auth/login

curl -s -b /tmp/ai-content-auth.cookies \
  http://localhost:3011/api/auto-upload/health
```

4. 已迁入的发布能力不应再返回 `not_integrated`；未登录应返回 `login_required`，缺素材应返回 `material_error`，页面/发送失败应返回 `failed`。B站图文应在 preflight 阶段返回 `platform_not_supported`。
