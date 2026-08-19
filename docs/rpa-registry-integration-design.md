# RpaDriverRegistry 接入获客主流程 — 设计文档

> 状态：A/B/C/D(前端工作台) 已落地；剩六平台真实账号验收
> 日期：2026-08-18
> 背景：第三轮复核指出"统一 RPA 注册表没有接入增长主流程，实际仍走旧的 AiEmployeeService 和平台分支逻辑"——属实。本文设计如何把 `RpaDriverRegistry` 渐进式接入 `GrowthService`，**不破坏成熟抖音链路**，并把 RPA 执行记录升级为真实状态机。

---

## 1. 现状（两条并行的执行路径）

### 1.1 旧链路（成熟，抖音为主）

`GrowthService.executeConfig` → `fetchCandidatesWithAiEmployee`：

| 平台 | 模式 | 走哪 |
|---|---|---|
| douyin | search-account / video-link / target-account / retention / keyword | `AiEmployeeService.findDouyin*`（runtime 执行器，成熟） |
| douyin | manual-import | 本地构造候选 |
| 非 douyin | manual-import / video-link / target-account | `fetchCandidatesWithPlatformAdapter`（本地构造，**不真发现**） |
| 非 douyin | 其他 | 抛 `unsupported` |

跟进：`executePlatformFollowUp` → douyin 走 `executeDouyinFollowUp`（autoSend），wechat-channel 走桌面，其余抛 `unsupported`。

### 1.2 新链路（骨架，未接入主流程）

`RpaDriverRegistry` 已注册 6 平台 driver：
- `SearchWebRpaDriver`（douyin/kuaishou/xiaohongshu）：`discover-keyword` + `discover-account-works` 包装 `DiscoveryBrowserRunner`（浏览器会话搜索）；读评论/回复/私信显式 unsupported
- `WechatFamilyRpaDriver`（视频号/微信/企微）：全部 unsupported（诚实声明）

`RpaExecutionStore` 已持久化执行记录（账号/会话/模式/步骤/断点/证据/指纹/原因码/下一动作），但当前是**任务结束后异步写一条合成记录**（非逐步状态机）。

### 1.3 核心矛盾

- 抖音：旧链路**成熟**（真实执行 + 证据），新 driver 只有发现能力 → 不应替换
- 快手/小红书：旧链路**没有真发现**（抛 unsupported），新 driver **有真发现**（浏览器搜索）→ 应接入
- 视频号/微信/企微：两套都无自动发现 → 维持 unsupported（需外部资源）

---

## 2. 设计原则

1. **渐进式、fail-safe**：新增 driver 路径失败时回退旧链路，绝不因新骨架破坏旧执行。
2. **不替换成熟能力**：抖音继续走 AiEmployeeService（有真实执行+证据），driver 只作为"发现前置"，不接管抖音执行。
3. **每个平台按能力接入**：能用 driver 的用 driver（快手/小红书发现），不能用的保持旧/unsupported（诚实）。
4. **执行记录升级为真实状态机**：openSession → execute 逐步 → finalize，与 driver 生命周期一致。

---

## 3. 接入方案

### 3.1 依赖注入

`GrowthService` 构造加 `@Optional() rpaDriverRegistry?: RpaDriverRegistry`（RpaModule 已 exports，无环）。

### 3.2 发现阶段接入点（`fetchCandidatesWithAiEmployee`）

在现有逻辑**之前**插入 driver 优先路径：

```
fetchCandidatesWithAiEmployee(config, remaining):
  driver = rpaDriverRegistry?.get(config.platform)
  # 仅当平台有 driver 且 driver 声明支持该动作时走新路径
  if driver 且 driver.capabilities().discover-keyword/discover-account-works 支持:
    session = driver.openSession({userId, accountId, runId})
    items = driver.execute(session, {action: discover-*, input: {keyword/targetId}})
    if items 非空:
      candidates = mapDiscoveryItemsToCandidates(items)   # RpaStepResult.items → DouyinFollowUpCandidateInput
      persistRpaExecution(真实逐步记录)
      return candidates
    if 明确失败(非空错误):
      # fail-safe：回退旧链路
  # 旧链路原样保留
  return 原逻辑
```

**关键**：driver 失败/不支持时**静默回退旧链路**，不抛错、不改变现有行为。

### 3.3 跟进阶段（`executePlatformFollowUp`）

本轮**不接入**（抖音继续旧链路，其余保持 unsupported）。原因：driver 的回复/私信动作尚未实现，接入会引入半成品执行，违背"不伪装"原则。留给 driver 动作补齐后。

### 3.4 执行记录升级为真实状态机

`RpaExecutionStore` 加生命周期方法，`GrowthService` 在执行过程中逐步写：

```
openSession → create(记录 sessionId + 初始步骤)
execute(discover) → update(追加步骤 + evidence + pageFingerprint)
execute(followUp) → update(追加步骤 + evidence)
完成/失败 → finalize(终态 + reasonCode + nextAction)
```

当前是"任务结束异步写一条合成记录"（`persistRpaExecution`），升级为：**在 executeConfig 主流程内同步 create → 各执行点 update → 末尾 finalize**，使步骤/断点/证据反映真实执行。

### 3.5 补齐执行接口（`RpaController`）

新增端点（供前端工作台 + 人工接管用）：

| 端点 | 动作 |
|---|---|
| `POST /rpa/executions` | 创建执行任务（openSession） |
| `POST /rpa/executions/:id/steps` | 执行一个步骤（execute，逐步） |
| `POST /rpa/executions/:id/pause` | 暂停（记录断点） |
| `POST /rpa/executions/:id/resume` | 恢复（从 resumeStep 续跑） |
| `POST /rpa/executions/:id/cancel` | 取消 |
| `POST /rpa/executions/:id/manual-takeover` | 人工接管（标记 needs-human） |
| `POST /rpa/executions/:id/finalize` | 完成回读 |

**全部带 owner scope**（沿用本轮 IDOR 修复的模式）。

---

## 4. 分阶段实施

| 阶段 | 内容 | 风险 | 状态 |
|---|---|---|---|
| **A（本轮设计后第一轮）** | 注入 registry + 发现阶段 driver 优先（快手/小红书走浏览器搜索）+ fail-safe 回退 | 低（有回退） | ✅ 已落地（2026-08-18） |
| **B** | 执行记录升级真实状态机 + 执行接口（3.4/3.5） | 中（改主流程写点） | ✅ 已落地（2026-08-18）：driver 路径 openSession→create→appendStep→finalize 逐步写；合成记录对 driver 成功路径跳过（防重复）；createExecution 真正 openSession（失败降级）；执行接口 create/steps/pause/resume/cancel/manual-takeover/finalize 全带 owner scope |
| **C** | driver 补齐读评论/回复/私信动作 + 跟进阶段接入 | 高（需真实账号） | ✅ 已落地（2026-08-18）：runner 补 readComments（只读）+ driver 声明 read-comments 支持；reply-comment/send-direct-message 保持 unsupported（真实触达高风险，诚实声明）；executePlatformFollowUp 打通 driver 触达路径（driver 声明支持时走 driver，当前触达未实现仍诚实报错） |
| **D** | 六平台真实账号验收 + 前端 RPA 工作台 | 需业务资源 | 前端工作台 ✅（/growth/rpa-workbench：能力总览+执行列表+详情时间线+创建/暂停/恢复/取消/人工接管/完成回读）；六平台真实账号验收待大王登录（read-comments 评论解析选择器需按平台实测校准） |

---

## 5. 验收标准

- 快手/小红书发现：driver 返回候选 → 入线索池（需真实账号/浏览器会话）
- 抖音：行为**完全不变**（回归验证：现有 E2E + 单元测试全绿）
- 回退：driver 不可用（无浏览器会话）→ 回退旧链路，不抛错
- 执行记录：步骤/断点/证据真实反映执行过程，非合成
- 全量测试 + lint 全绿

---

## 6. 明确不做的（诚实边界）

- 视频号/微信/企微自动发现：无网页入口/需桌面会话，维持 unsupported（需官方授权或桌面 RPA，业务决策）
- 抖音执行切换 driver：成熟链路不动
- 自动发送逐 action 确认：当前任务级审批，逐 action 确认是更大改造（方案 8.5 远期）
- 前端 RPA 工作台：执行接口就绪后做（依赖 B 阶段）
