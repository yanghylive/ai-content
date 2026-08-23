# API 迁移表（P0-1：现状 API 与目标 API）

> 对照《剩余缺口与冻结清单》P0-1。目标实现已落地（agent-gateway 契约包，见 `docs/contracts/`）。
> 本表给出旧路由 → 目标路由映射、兼容期、切换开关与建议废弃时间。

## 1. 迁移映射

### 1.1 对话层

| 旧路由 | 目标路由 | 说明 | 兼容策略 |
|---|---|---|---|
| `POST /api/ai-gateway/chat`（SSE） | `POST /api/agent/sessions` → `POST /api/agent/tasks` → `POST /api/agent/tools/:name` | 会话式多步任务替代单次 chat | 旧 chat 保留为只读兼容入口（新调用方禁止使用） |
| SSE 事件流（`text/tool_exec/tool_done/done/error`） | WS `/api/agent/octop/ws`（`message/tool_started/tool_progress/approval_required/artifact_created/task_done`） | 统一事件协议（见 `agent-events.schema.json`） | 旧 SSE 事件仅存量客户端消费 |

### 1.2 事件层

| 旧事件 | 目标事件 | 映射 |
|---|---|---|
| `text` | `message` | 1:1 |
| `tool_exec` | `tool_started` + `tool_progress` | 1:N（带 toolCallId） |
| `tool_done` | `artifact_created` + `task_done` | 1:N（产物拆分） |
| `error` | `task_failed` | 1:1（payload 带 error code） |

### 1.3 记忆层

| 旧路由 | 目标路由 | 说明 |
|---|---|---|
| `GET /api/memory`（前端直连） | `POST /api/memory/search` | 前端只调 3010，后端代理 Kaypal |
| `POST /api/memory/persona` | `POST /api/memory/add` | scope=persona 语义 |
| `DELETE /api/memory/:id` | `DELETE /api/memory/:id?scope=` | 删除语义对齐（scope 兜底） |
| `DELETE /api/memory`（清空） | 保留（等价 scope 全删） | 迁移期暂存 |

### 1.4 移动执行器层

| 旧路由 | 目标路由 | 说明 |
|---|---|---|
| `POST /api/mobile-executor/devices` | Agent Tool Gateway 统一调用（`/api/agent/...`） | 设备租约经 DeviceLease 表统一管理 |
| `POST /api/mobile-executor/tasks` / `tasks/claim` | `/api/agent/tasks` + 工具注册表 | 任务/租约/证据链对齐 `agent_gateway_*` |
| `POST /api/mobile-executor/approvals/:id/consume` | `/api/agent/tasks/:id/approve` | 审批一次性消费语义对齐 |
| `POST /api/mobile-executor/runs/:id/step` | 引擎工具执行（ToolCall） | 步骤证据走 `agent_gateway_evidence` |

## 2. 兼容期与切换开关

| 开关 | 位置 | 默认 | 语义 |
|---|---|---|---|
| `AGENT_GATEWAY_PERSISTENCE` | `backend/.env` | 空（内存态） | `prisma` = 引擎全持久化 |
| `AGENT_GATEWAY_REAL_BUSINESS` | `backend/.env` | 空 | `true` = 真实 3010 业务工具（crm_create 等） |
| `OCTOP_ENABLED` | `backend/.env` | `false` | `true` = 真实 Octop 适配器 |
| 旧 chat 路由 | `src/modules/ai-gateway/` | 保留 | 存量客户端迁移完成后下线 |

## 3. 建议废弃时间线

| 阶段 | 动作 | 条件 |
|---|---|---|
| 兼容期（当前） | 新旧并存；新调用方一律走目标路由 | 目标路由 5.2/5.3 契约验收通过（已完成） |
| 切换期 | 旧 chat / 旧 memory 前端路由标记 deprecated | 前端迁移完成（P1-6 前端验收稿） |
| 废弃 | 下线旧 chat SSE 与旧 memory 直连 | 存量客户端 < 1% + Runbook 演练通过（P1-4） |
