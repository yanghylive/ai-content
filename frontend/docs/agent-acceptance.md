# Agent 前端验收稿（P1-6）

> 对照《剩余缺口与冻结清单》P1-6：`/agent`、高级模式、任务、审批、证据、手机、记忆的状态稿和响应式稿；
> 桌面、平板、Android 小屏无溢出和状态丢失。
> 数据源：`backend/docs/contracts/`（agent.openapi.yaml / agent-events.schema.json）与后端 `/api/agent/*` 实现。

## 0. 页面清单与契约映射

| 页面 | 路由 | 契约接口 | 关键状态 |
|---|---|---|---|
| Agent 驾驶舱 | `/agent`（`agent-cockpit-canvas`） | sessions / tasks / tools + WS | 会话态 / 任务流 / 审批等待 / 终态 |
| 任务中心 | `/tasks` | `GET tasks`（列表） | 空态 / 多态过滤 / 分页 |
| 任务记录 | `/tasks/records` | tasks 记录 | 空态 / 终态 |
| 审批 | `/tasks/confirmations` | `approval_required` + `POST /tasks/:id/approve` | 待审批 / 已批 / 过期 / 预览变化 |
| 证据 | `/tasks/evidence` | `artifact_created` / evidence | 空态 / 截图 / 平台链接 |
| 运行 | `/tasks/runs` | `tool_started/tool_progress/task_done` | 运行中 / 成功 / 失败 / 取消 |
| 产物 | `/artifacts` | `artifact_created` | 空态 / 列表 / 详情 |
| 记忆 | `/settings/memory`、`/capabilities/memory` | `/api/memory/search\|add\|:id` | 空态 / 搜索 / 删除 |
| 能力/工具 | `/capabilities/tools` 等 | ToolSpec 目录 + `/octop/capabilities` | 能力降级提示 |
| 高级模式 | `/agent?mode=advanced` | octop session / token-exchange | 令牌态 / 降级 |

## 1. 逐页状态矩阵（验收点）

| 页面 | Loading | Empty | Error | Data | 审批等待 | 终态 |
|---|---|---|---|---|---|---|
| Agent 驾驶舱 | 骨架屏 | 引导建会话 | 错误提示+重试 | 六步闭环可见 | `approval_required` 卡片 | `task_done` 收尾 |
| 任务中心 | 骨架 | "暂无任务" | 错误+重试 | 状态筛选 | 待审批角标 | 终态标记 |
| 审批 | 骨架 | "无待审批" | 错误 | 预览 hash 一致 | approve/拒绝按钮 | 已消费禁点 |
| 证据 | 骨架 | "无证据" | 错误 | 图/链接渲染 | — | 只追加 |
| 运行 | 骨架 | 空 | 错误 | 进度条 | 暂停/取消按钮 | 成功/失败/取消 |
| 记忆 | 骨架 | "无记忆" | 降级提示(degraded) | 搜索结果 | — | 删除后消失 |
| 能力/工具 | 骨架 | 空 | 降级(degraded) | 工具列表 | — | — |

## 2. 响应式基线（Tailwind 断点）

| 断点 | 尺寸 | 要求 |
|---|---|---|
| `sm`（平板竖屏） | ≥640px | 双栏可用；审批卡片不挤压 |
| `md`（平板横屏） | ≥768px | 标准布局 |
| `lg`（桌面） | ≥1024px | 三栏驾驶舱 |
| **Android 小屏** | 360px | 单栏堆叠；**无水平溢出、无状态丢失**（`overflow-x-hidden` 兜底 + `grid-cols-1` 起步） |

**无状态丢失规则**：任何断点切换不重置会话/任务/审批上下文（state 持久化于 store/URL，不依赖视口）。

## 3. 验收 Checklist（每页 × 每状态 × 每断点）

- [ ] 每页在 sm/md/lg/360px 四断点渲染，无水平滚动条
- [ ] 六步闭环（内容→获客→发布审批→CRM 审批→复盘）在驾驶舱全可见
- [ ] 审批等待态：approval_required 卡片 + 预览 hash + 过期倒计时；过期/预览变化有明确错误
- [ ] 断线重连：WS lastEventId 重放后 UI 不重复渲染（eventId 去重）
- [ ] 能力降级：Octop 不可用时页面显示 degraded 提示且功能可继续（3010 原生）
- [ ] 空态/错误态/加载态均有明确 UI（非白屏）
- [ ] 记忆删除后即时消失；远程降级时显示 degraded
- [ ] Android 360px：驾驶舱单栏堆叠、审批按钮可点、无元素溢出

## 4. 已知缺口（前端待做）

- `/agent?mode=advanced` 高级模式页（Octop 令牌态/降级）未实现——契约已冻结（octop session/token-exchange）
- `/tasks/runs` 运行页与 `tool_progress` 进度事件尚未完全对齐
- 记忆删除 `?scope=` 兜底参数前端未传
