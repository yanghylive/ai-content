# 第三轮报告：阶段 3 会话与安全边界（Broker × manager 接线）

## 本轮目标

工作流文档 §4 阶段 3：实现会话契约接线 + 六条安全验证（跨用户/跨租户 fail-closed、partition 隔离、token 过期/重放/错 owner 拒绝、句柄失效、敏感数据脱敏）；Agent 不得自我批准（硬约束 5）。不动 3011 桥接（阶段 4）。

## 修改文件

| 文件 | 变更与原因 |
|---|---|
| `desktop/browser-broker-wiring.js` | 新增：接线模块——订阅 manager 会话事件（opened/account-switched/hidden/shown/destroyed）同步 Broker 会话；**capability token 只存活主进程内存，`handles()/publicState/IPC 永不携带 token**；`*ForAgent(panelId, actor, …)` 入口全部先 `assertActor`（owner+tenant 双配）；未登记面板拒绝；`dispose()`/destroy 事件 → 全句柄撤销；`approveActionForAgent` **默认拒绝**（Agent 自批=fail-closed，仅测试 harness `allowSelfApprove` 放行，阶段 4 接真实用户审批 UI） |
| `desktop/browser-panel-broker.js` | 新增 `assertActor`（跨 owner/tenant fail-closed 留痕）、`hasPendingHandle`；**全部事件流 URL 脱敏**（`redactUrlForEvidence`：token/access_token/auth/apikey/secret/password/pwd/code/sid/session_id 类 query → `***`，路径保留） |
| `desktop/browser-panel-manager.js` | 会话事件钩子 `onSessionEvent`（open/换账号/hide/show/destroy 广播给订阅方）；`destroy()` 先发事件再清状态（wiring 需在会话存续时撤销 token）；首跑测试抓到换账号 partition 未更新真 bug（已修，见 round2） |
| `desktop/main.js:90-95` | 实例化 `wireBrowserPanel({ manager: browserPanel })`；阶段 4 的 3011 Agent 桥将经 authenticated local IPC 调 `getBrowserWiring().*ForAgent(...)` |
| `desktop/browser-broker-wiring.spec.js` | 新增：阶段 3 安全矩阵 11 用例 |

## 协议/数据变化

- 内部契约：`wiring.resolveTargetForAgent / sendCDPForAgent / requestActionForAgent / approveActionForAgent / listEventsForAgent`，一律 `(panelId, actor{ownerId,tenantId}, …)`；token 无外部读取面。
- 事件流新增语义：`blocked.reason ∈ {actor-missing-identity, actor-tenant-mismatch, invalid-token, token-expired, approval-required, cdp-method-not-allowed, web-content-target-missing}`。
- 未改 IPC 通道/数据库/后端接口（阶段 4 才加 3011 桥）。

## 验证命令与结果

- `node desktop/browser-broker-wiring.spec.js` — **PASS 11/11**：跨 owner 拒、跨 tenant 拒、换账号旧 token 立即失效+新 partition、token 过期拒、接线销毁句柄全失效、manager destroy 事件自动撤销、**事件流不含 SECRET/authcode 且变 ***、非敏感参数保留、Agent 自批拒绝、缺 actor 拒、幽灵面板拒
- `node desktop/browser-panel-broker.spec.js` — PASS 11/11（阶段 1 回归，含脱敏改造）
- `node desktop/browser-panel-manager.spec.js` — PASS 11/11（阶段 2 回归 + 会话事件钩子）
- `electron scripts/browser-panel-smoke.mjs` — **PASSED 11/11**（阶段 1 P0 重跑确认）
- `electron scripts/browser-panel-stage2-smoke.mjs` — **PASSED 9/9**（阶段 2 重跑确认）
- `node -c main.js` 语法过；release-guards.test 过（本轮未动其覆盖面）
- 后端/前端零改动（本轮全在 desktop 主进程侧），既有基线不失效
- 证据：`docs/browser-panel-baseline/{smoke,stage2}-evidence-2026-09-02T17-03-*.json`（滚动保留最新一轮）

## 同页控制证据

- `resolveTargetForAgent` → `{panelId, sessionId, webContentsId}` 三方绑定（spec 用例 1 + 阶段 1/2 smoke 双验）；manager 是视图唯一事实源（wiring 的 `webContentsResolver` 硬绑 `manager.panelWebContents()`，Broker 无第二视图通道）。
- 换账号场景（spec 用例 3）：会话/视图/partition 整体换代，旧 token 与 actor 全部失效——A 的 Agent 会话不可能漂移到 B 的登录态上。

## 未完成与风险

1. **3011 Agent 桥未接**（文档阶段 4 范围）：wiring 入口形状已备好，桥协议（随机 capability token 的本地 IPC/RPC 鉴权）随阶段 4 设计。
2. **审批 UI 未建**：`approveActionForAgent` 默认拒绝，阶段 4 接 3010 审批确认单后由用户点批走 `allowSelfApprove=false` 路径的真实实现。
3. **token 持久性**：当前主进程内存态——重启即失效符合"重启句柄失效"要求；无跨进程泄漏面。
4. Windows 真机 smoke 欠账不变（阶段 6 打包验收补）。

## 需要用户确认的事项

- 批准后进入**阶段 4（Agent-S 接同一页面）**：3011 ↔ desktop wiring 的本地桥协议设计 + observe/navigate/click 首批动作接入 + 证据链落 3011 evidence 目录。
