# 3010 × Octop 契约兼容性矩阵（P0-2）

> 本文件是《冻结清单》5.2「必须提交的文件」之一，与下列契约工件共同构成冻结协议：
> `agent.openapi.yaml`、`agent-events.schema.json`、`tool-spec.schema.json`、
> `tool-result.schema.json`、`error-codes.yaml`、`mobile-executor.openapi.yaml`。
>
> 通过条件见文末 §7，逐条对应《冻结清单》5.3。

---

## 1. 契约工件与版本

| 工件 | 路径 | 类型 | 当前版本 | 负责方 |
| --- | --- | --- | --- | --- |
| REST 契约 | `agent.openapi.yaml` | OpenAPI 3.0.3 | `0.1.0` | 3010 后端 |
| WS 事件契约 | `agent-events.schema.json` | JSON Schema (draft-07) | `0.1.0` | 3010 后端 / Octop 适配 |
| 工具规范契约 | `tool-spec.schema.json` | JSON Schema (draft-07) | `0.1.0` | 3010 后端 |
| 工具结果契约 | `tool-result.schema.json` | JSON Schema (draft-07) | `0.1.0` | 3010 后端 |
| 错误码表 | `error-codes.yaml` | YAML | `0.1.0` | 3010 后端 |
| 移动端执行契约 | `mobile-executor.openapi.yaml` | OpenAPI 3.0.3 | `0.1.0` | mobile-executor |
| 兼容性矩阵 | `compatibility-matrix.md` | Markdown | `0.1.0` | 各方 |

**版本号独立演进**：契约版本（`contractVersion`）与 3010 / Octop / mobile-executor 的实现版本互不绑定。
任一方升级实现时，若契约未变，则 `contractVersion` 不变；契约字段变更必须 bump 版本并在 §4 登记。

---

## 2. 版本语义（契约专用）

采用 `[主.次.补]`：

- **主版本 (MAJOR)**：破坏性变更（见 §3）。
- **次版本 (MINOR)**：向后兼容的增量变更（新增可选字段 / 新增端点 / 新增事件类型）。
- **补版本 (PATCH)**：文档/示例修正，无字段变化。

每个契约文件头部 `info.version` / `x-contract-version` 必须与 `error-codes.yaml` 的 `contractVersion` 联动，差异超过 1 个 PATCH 视为不同步，CI 拦截。

---

## 3. 破坏性 vs 增量变更判定

| 变更 | 分类 | 处理 |
| --- | --- | --- |
| 删除字段 / 把必填改可选反向 / 改字段类型 | 破坏性 (MAJOR) | 需双写期 + 回滚开关，旧字段保留至少 1 个 MINOR |
| 字段语义变化（同名不同义） | 破坏性 (MAJOR) | 必须改名或加新字段，旧字段标记 deprecated |
| 新增**可选**字段 | 增量 (MINOR) | 旧客户端忽略即可 |
| 新增端点 / 新增事件 `type` | 增量 (MINOR) | 旧客户端不订阅即无影响 |
| 收紧校验（更严的 required） | 破坏性 (MAJOR) | 分步灰度，先 warn 后 reject |
| 错误码新增 | 增量 (MINOR) | 客户端对未知码按 `retryable=false / 500` 兜底 |
| 错误码语义/HTTP 状态变化 | 破坏性 (MAJOR) | 须 bump 主版本并在 §4 登记 |

**原则**：默认保持向后兼容；任何 MAJOR 变更必须提供过渡窗口与回滚路径（对齐《补充包》10.3）。

---

## 4. 字段变更流程（强制）

1. 提交契约 PR，标注变更类型（MAJOR/MINOR/PATCH）与影响面。
2. 更新对应工件 `x-contract-version`。
3. 在下方「变更登记」追加一行（版本 / 日期 / 改动 / 兼容说明）。
4. CI 跑契约测试（§7.1）与兼容性测试（§7.2）；不通过不得合入。
5. 同步更新前端类型生成源或校验器（§7.3）。

### 变更登记

| 契约版本 | 日期 | 改动 | 兼容说明 |
| --- | --- | --- | --- |
| 0.1.0 | 2026-08-23 | 首版冻结：11 个 REST 接口、9 类事件、22 个错误码、4 类移动工具步骤 | 基线，无历史兼容负担 |

---

## 5. 前后端版本错配兼容规则

| 场景 | 行为 |
| --- | --- |
| 客户端旧 / 服务端新（新增可选字段） | 客户端忽略未知字段；服务端对旧客户端不返回新字段 |
| 客户端新 / 服务端旧（客户端期待新字段） | 新字段缺失时前端按「能力缺失」降级，不报错崩溃 |
| WS `lastEventId` 在窗口内 | 服务端按 `sequence` 重放窗口内事件 |
| WS `lastEventId` 超窗口 | 返回 `RESUME_WINDOW_EXPIRED`，前端改拉取任务快照 |
| 未知事件 `type` | 前端按 `eventId` 去重后忽略，不阻塞渲染（§7.4） |
| 乱序事件 | 前端按 `sequence` 排序，重复 `eventId` 去重（§7.4） |
| 断线重连 | 携带 `lastEventId` 重连；服务端幂等重放（§7.4） |

---

## 6. 控制面 → 契约映射（每个 Controller 都能映射到一条契约）

### 6.1 `agent.openapi.yaml` ↔ 3010 后端 Controller

| REST 端点 | 状态机/模块 | 关键错误码（见 `error-codes.yaml`） |
| --- | --- | --- |
| `POST /api/agent/sessions` | SessionCtrl | 401 / 403 / 429 / OCTOP_UNAVAILABLE |
| `POST /api/agent/sessions/:id/resume` | SessionCtrl / EventBus | 404 / SESSION_EXPIRED / TASK_TERMINAL |
| `POST /api/agent/tasks` | TaskCtrl / StateMachine | INVALID_PLAN / DUPLICATE_REQUEST |
| `POST /api/agent/tasks/:id/approve` | ApprovalSvc | APPROVAL_EXPIRED / PREVIEW_CHANGED |
| `POST /api/agent/tasks/:id/pause` | StateMachine | NOT_PAUSABLE / TASK_TERMINAL |
| `POST /api/agent/tasks/:id/resume` | StateMachine / Checkpoint | CHECKPOINT_MISSING / DEVICE_OFFLINE |
| `POST /api/agent/tasks/:id/cancel` | StateMachine / RPA | CANCEL_TIMEOUT |
| `POST /api/agent/tools/:name` | ToolRegistry / Gateway | TOOL_NOT_ALLOWED / IDEMPOTENCY_CONFLICT |
| `POST /api/memory/search` | MemoryOrchestrator | MEMORY_TIMEOUT / NAMESPACE_INVALID |
| `POST /api/memory/add` | MemoryOrchestrator / Outbox | MEMORY_REJECTED / DUPLICATE_EVENT |
| `GET /api/agent/octop/capabilities` | OctopAdapter | OCTOP_DEGRADED |
| `WS /api/agent/octop/ws` | EventBus（同源代理） | RESUME_WINDOW_EXPIRED |

### 6.2 `mobile-executor.openapi.yaml` ↔ mobile-executor 模块

| 端点 | 模块 | 错误码 |
| --- | --- | --- |
| `POST /v1/leases` | DeviceLeaseSvc | LEASE_CONFLICT / DEVICE_NOT_FOUND |
| `DELETE /v1/leases/{id}` | DeviceLeaseSvc | LEASE_NOT_FOUND |
| `POST /v1/devices/{id}/heartbeat` | DeviceLeaseSvc | DEVICE_OFFLINE |
| `POST /v1/executions` | StepExecutor | LEASE_CONFLICT / CHECKPOINT_MISSING |
| `GET /v1/executions/{id}` | StepExecutor | EXECUTION_NOT_FOUND |
| `POST /v1/executions/{id}/evidence` | EvidenceSvc | EXECUTION_NOT_FOUND |
| `POST /v1/executions/{id}/complete` | StepExecutor | EXECUTION_NOT_RUNNING |
| `GET /v1/capabilities` | CapabilityProbe | — |

### 6.3 外部契约引用

- `tool-result.schema.json` 被 `agent.openapi.yaml` 的 `/tools/:name`、`:id/approve` 响应 `$ref`。
- `agent-events.schema.json` 被 `agent.openapi.yaml` 的 `/sessions/:id/resume` 响应与 WS 扩展 `$ref`，也被 `mobile-executor.openapi.yaml` 的 WS 扩展 `$ref`。

---

## 7. 通过条件（对齐《冻结清单》5.3）

| # | 条件 | 验收方式 |
| --- | --- | --- |
| 7.1 | 前端类型从 Schema 生成或由同一 Schema 校验 | `contract-files.test.ts` 解析全部 YAML/JSON；Ajv 校验示例事件/工具结果/错误 |
| 7.2 | 后端每个 Controller 都能映射到一条契约 | §6.1 / §6.2 映射表，逐一覆盖，无孤儿端点 |
| 7.3 | 未知事件、重复事件、乱序事件、断线重连都有测试 | `event-bus.test.ts` 覆盖重放/去重/乱序/窗口过期；gateway 集成测试覆盖断线恢复 |
| 7.4 | 协议字段变更必须有版本号和兼容说明 | 任何改动须 bump `x-contract-version` 并在 §4 登记，CI 校验版本联动 |

---

## 8. 与 Octop v0.9.26 的兼容边界

- **Octop Remote Phone 属实验能力**：v0.9.26 的手机能力必须经能力探测（`/v1/capabilities`）确认后才可下发，不得默认开启。
- **iOS 不承诺**：移动端契约仅覆盖 Android（Accessibility / MediaProjection）。
- **APK 不内置 Octop 运行时**：高级 Agent 运行在服务端；APK 只负责 RPA 执行与证据回传。
- **设备租约唯一**：同一设备同时仅一个有效 `DeviceLease`；租约过期自动暂停，禁止并发抢占。

---

## 9. 已知限制（冻结状态，未解锁前不得上线写链路）

- 真实 Kaypal 多租户鉴权（P0-3）、Prisma 真实迁移（P0-4）、Octop 生产运行方式（P0-5）、
  真实 RPA 测试资源（P0-6）、移动端租户绑定（P1-1）尚未落地。
- `agent.openapi.yaml` 的 `x-kaypal-ctx` 头仅草案阶段使用；生产必须删除该回退，身份仅从 Kaypal 签名 token 派生。
- 幂等当前为进程内去重；真实环境需 DB 唯一约束 + Kaypal `usageId` 对账。
- 工具执行为 Mock；真实需路由到 3010 业务服务与 RPA。
