# P3 切上层 + 双跑 + 删存量 + 5409 下线 · 真机操作手册

> 单人项目手册（D1-D2 = 2026-06-03 写）
> 配合 docs/kaypal-ai-runtime-unification-project-plan-2026-06-03.html §四 节阅读
> 配合 docs/adr/001 + 002 阅读
>
> **预计工作量**：3-5 天单人密集操作
> **P3 真机部分占 70%**（双跑 3 天 + 5409 归档）；代码侧 P3-D1 + P3-D4 占 30%

---

## 状态交接：P1 + P2 + P3-D1 准备已完成

| 阶段 | 状态 | 关键产出 |
|---|---|---|
| P1 边界+路由 | ✅ done | 5 个 commit；Runtime skeleton + ExecutorRouter + ADR-001/002 |
| P2 D1 引擎 client | ✅ done | LocalRuntimeEngineClient + BrowserControlService |
| P2 D2 平台 services | ✅ done | 4 个 platform service（抖音/视频号 × 评论/私信） |
| P2 D3 证据持久化 | ✅ done | EvidenceService + Prisma runtime_executions 表 |
| P2 D4 缓冲 | ✅ done | ExecutorRouter 接通 EvidenceService |
| P3-D1 准备 | ✅ done | RuntimeOrchestrator 薄壳 wrapper |

**11 个 commit 链，93 个单测全过，零库存文件改动，零 WIP 冲突。**

**关键基础设施**：
- `ExecutorRouter.route(task, ctx)` — 任何互动任务的统一入口；自动证据持久化
- `RuntimeOrchestrator.execute(task, ctx)` — P3 真机切换目标
- `EvidenceService.recordExecutionFireAndForget` — 任务执行完自动记录
- 回滚锚点：`76e15f5`（P2 D4 一轮，Agent-S 真正接通前的最后纯 P1 状态）

---

## P3-D1：切上层 Orchestrator 到 RuntimeOrchestrator

**风险等级**：🟡 中（每步可控，但调用点多）
**预计工作量**：1-2 天
**入口**：`LocalEngineService`（100+ 方法穿透到 `LocalInteractionExecutorService`）
**目标**：把"互动执行"类方法（评论回复、私信回复、群发等）从 `LocalInteractionExecutorService` 改走 `RuntimeOrchestrator.execute()`

### 1.1 切换前的硬性检查

```bash
# 回滚锚点位置（必须能 git checkout）
git log --oneline | grep 76e15f5
# 应该看到 P2 D4 一轮的 commit

# 当前 11 个 commit 链全过
npx jest --testPathPatterns="runtime" 2>&1 | grep "Tests:"
# 期望：93 passed
```

### 1.2 找出要切的 caller

```bash
# LocalEngineService 中调用 LocalInteractionExecutorService 的地方
grep -n "interactionExecutor\." backend/src/modules/local-engine/local-engine.service.ts

# 期望输出 ≈ 8-15 个调用点（execute* 方法的包装）
```

逐个识别：
- `interactionExecutor.executeDouyinCommentReply(...)` → 改 `RuntimeOrchestrator.execute(executorTask, ctx)`
- `interactionExecutor.executeWechatChannelCommentReply(...)` → 同上
- 等等

### 1.3 关键：类型翻译层

旧调用点用 `LocalInteractionExecutorService` 内部类型（如 `InteractionTaskInput`、`InteractionRuleConfig`）。  
新调用点用 `RuntimeOrchestrator.execute(ExecutorTask, ExecutorContext)`。

**必须写一个 mapper**：

```typescript
// 推荐位置：runtime/orchestrator/mappers.ts（新文件，不动旧代码）
// mapInteractionTaskToExecutorTask(input, ctx): { task: ExecutorTask; ctx: ExecutorContext }
//
// 输入：LocalEngineService 现有方法签名
// 输出：ExecutorTask + ExecutorContext
```

**建议 mapper 设计**：
- 维护一张 `taskType ↔ ExecutorTaskType` 映射表
- 维护 `sendMode ↔ ExecutorSendMode` 映射
- payload 透传（旧 payload 通常已是 `Record<string, unknown>`）
- `relatedId` 来自 `input.taskId`
- `relatedType: 'interaction-task'`

### 1.4 Per-call hard switch 模式

**不要**批量替换。**逐个** caller 改：

```bash
# 步骤：
# 1. 选一个 caller（如 executeDouyinCommentReply）
# 2. 写一个 NEW method: executeDouyinCommentReplyViaRouter(input)
# 3. 让 Controller 暂时调 NEW method（不删旧 method）
# 4. 跑 e2e（你的真抖音账号）
# 5. 验证通过后：删旧 method，NEW method 改名覆盖原 method
# 6. commit + push
# 7. 下一个 caller
```

**每次 commit message 模板**：
```
[chore] P3-D1 切 caller: <方法名>

- 新 RuntimeOrchestrator 路径走 ExecutorRouter + EvidenceService
- 旧 LocalInteractionExecutorService 路径保留（双跑期）
- e2e: 5 轮真账号测试无差异
```

### 1.5 D1 出口标准

- 所有互动执行方法都走 RuntimeOrchestrator
- LocalInteractionExecutorService 的 8 个 execute* 方法**还没有**被删（双跑期要并存）
- Controller 完全调新路径
- 每次切换都有 e2e 真账号验证

---

## P3-D2-D3：双跑灰度 ≥ 3 天

**风险等级**：🔴 高（这是 P3 真正可能踩坑的阶段）
**预计工作量**：3 天
**要求**：抖音/视频号 4 条互动各 5 轮，新旧路径结果比对，**差异率为 0**

### 2.1 准备

```bash
# 准备一个 diff 录制脚本
# 位置建议：scripts/commercial-acceptance-gate.mjs（已有，需扩展）
# 录制：旧路径结果 + 新路径结果，并排对比
```

### 2.2 双跑模式

**不是真 feature flag**。**是物理双跑**：
- 同一任务同时调旧路径和新路径
- 旧路径结果写入"老表"（InteractionTask / InteractionTaskEvent）
- 新路径结果写入"新表"（RuntimeExecution）
- 完成后比对

**操作方式**：
1. 在 LocalEngineService 加一个 `executeBoth()` 模式（开发用，生产关闭）
2. 真账号跑 4 互动 × 5 轮 = 20 任务
3. 每任务同时调旧 + 新
4. 写一个 `scripts/diff-run-output.mjs` 比对结果

### 2.3 差异处理

**任何 1 轮有差异，立即停止双跑**：
- 标 P3-D2 中断，定位差异源（旧实现 vs 新实现哪边对）
- 修代码，revert 那 1 轮的切换
- 从头跑双跑

**接受 0 差异才能进 P3-D4**。

### 2.4 D2-D3 出口标准

- 4 互动 × 5 轮 × 2 路径 = 40 条结果，差异 = 0
- 每天 1 次完整跑（连续 3 天）

---

## P3-D4：删存量代码

**风险等级**：🟡 中（机械工作，但量大）
**预计工作量**：半天
**入口**：`LocalInteractionExecutorService` 130KB+ 的 8 个 execute* 方法 + `CdpPlatformInteractionService` + `AutoUploadClient` 复用部分

### 4.1 删除前清单（按顺序）

```bash
# Step 1: 确认所有 caller 已切走
grep -rn "interactionExecutor\.execute" backend/src/
# 期望：无结果（如果有 → 回去补 P3-D1 切换）

# Step 2: 确认 LocalEngineService 不再注入 LocalInteractionExecutorService
grep -n "LocalInteractionExecutorService" backend/src/modules/local-engine/local-engine.service.ts
# 期望：无结果

# Step 3: 删文件
git rm backend/src/modules/local-engine/local-interaction-executor.service.ts
git rm backend/src/modules/local-engine/cdp-platform-interaction.service.ts
# 删 LocalEngineModule 里的 providers
```

### 4.2 AutoUploadClient 复用部分删除

```bash
# AutoUploadClient 1621 行；只删与互动执行相关的
# 保留：getHealth、upload、listAccounts（auto-upload-worker 还在用）
# 删除：draftDouyinCommentReply、sendDouyinCommentReply、draftDouyinMessageReply、sendDouyinMessageReply、draftWechatChannelCommentReply、sendWechatChannelCommentReply、draftWechatChannelMessageReply、sendWechatChannelMessageReply
# 删除对应的 result type
```

### 4.3 移除 3010/3011 对 127.0.0.1:5409 的依赖

```bash
# 搜所有引用
grep -rn "127.0.0.1:5409" backend/src/
grep -rn "5409" backend/src/ | grep -v "interactionExecutor\|cdp-platform\|auto-upload"
# 改：URL 改读 manifest 或 ConfigService（不再硬编码 5409）
```

### 4.4 D4 出口标准

- `LocalInteractionExecutorService` 文件删除
- `CdpPlatformInteractionService` 文件删除
- AutoUploadClient 保留（只删互动相关）
- 主仓搜 `127.0.0.1:5409` 业务直连 = 0
- 5409 端口不再被任何代码尝试启动
- 全部测试仍过

---

## P3-D5：5409 源仓归档

**风险等级**：🟢 低（操作活）
**预计工作量**：1 小时
**要求**：打 `git tag legacy/5409-final` + 归档为只读

### 5.1 在 5409 源仓操作

```bash
cd ~/auto-upload  # 或 5409 源仓路径
git tag -a legacy/5409-final -m "Final snapshot before P3 5409 deprecation"
git push origin legacy/5409-final

# 归档为只读（如果源仓支持）
gh repo edit --enable-archive  # GitHub CLI
# 或
# 在 GitLab/GitHub 网页设置 archive
```

### 5.2 主仓验收

```bash
# 主仓搜 5409 业务直连应为 0
grep -rn "127.0.0.1:5409\|auto-upload.*client\|AutoUploadClient" backend/src/
# 只剩：
# - import type（已 unused，但无副作用）
# - auto-upload.service.ts / auto-upload.module.ts（保留作为 P4 桌面打包的 manifest 来源）

# 主仓搜 5409 启动命令应为 0
grep -rn "127.0.0.1:5409" backend/src/ frontend/src/ desktop/
```

### 5.3 D5 出口标准

- 5409 源仓打 `git tag legacy/5409-final`
- 源仓 archived
- 主仓搜 `127.0.0.1:5409` 业务直连 = 0
- 主仓搜 `auto-upload` 业务直连 = 0（仅 P4 桌面打包用）

---

## P3 整体回滚计划

**回滚锚点**：`76e15f5`（P2 D4 一轮，AGENT-S 真正接通前的最后纯 P1 状态）

```bash
# 完全回滚到 P1+P2 之前
git reset --hard 76e15f5
git push --force  # 慎用

# 单 PR 回滚
git revert <commit-hash>
git push
```

**回滚条件**：
- D1 切换引入 P0 bug 修复时间 > 2 小时 → 立刻 revert
- D2-D3 双跑连续 2 轮差异找不到原因 → 暂停推进，定位问题
- D4 删代码后主仓 build 失败 → revert + 重新评估

---

## P3 风险地图

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| D1 切换引入 P0 bug | 中 | 高 | per-call 切换 + 每次 e2e |
| D2 双跑差异找不到原因 | 中 | 中 | 先回滚 1 个 caller，定位后重新切 |
| D4 删漏 caller 导致启动失败 | 低 | 高 | Step 1 grep 必须为空 |
| D5 归档后回不去 | 极低 | 致命 | tag + push tag + 源仓 archive 三步分离 |
| 性能回退 | 低 | 中 | D1 切换时跑性能基线对比 |
| 用户 97 个 WIP 撞车 | 中 | 中 | 提前 commit + push，WIP 阶段让用户 review |

---

## P3 真实时间估计

| 子阶段 | 估计 | 实际（事后填） |
|---|---|---|
| D1 切换 | 1-2 天 | ___ |
| D2-D3 双跑 | 3 天 | ___ |
| D4 删存量 | 0.5 天 | ___ |
| D5 归档 | 1 小时 | ___ |
| 缓冲 | 1 天 | ___ |
| **总计** | **5-7 天** | ___ |

P2 阶段实际 5 个 D 阶段在 1 个日历日内完成（密集作业）。P3 真机操作没法这么压缩——**最少 3 天双跑是硬约束**。

---

## P3 完成后：剩余 P4 + P5 状态

| 阶段 | 状态 |
|---|---|
| P3 切上层+删存量 | 本手册覆盖 |
| P4 桌面端 | 独立 P4 计划（待写） |
| P5 终极验收 | 独立 P5 计划（待写） |

P4 入口（参考项目规划）：
- Electron 打包 .app
- 起 3010/3011/Local Runtime 三件套
- 守护 Agent-S / local-controller
- 4 项 macOS 权限引导

P5 入口：
- 8 节验收 9 项（已在技术方案 §11 列）
- 抖音/视频号 4 互动各 5 轮 + 微信 3 互动各 5 轮 + 发布 5 条
- 失败场景全覆盖

---

## 给未来的自己：节奏感

P1 + P2 累计 6+ 小时密集作业（**不应该连续作战**）。
P3 真机阶段建议：
- 每天 4-6 小时（双跑期容易 burnout）
- 每天结束 commit + push + 写 PROGRESS.md
- 周末休息，不要硬撑

代码可以等你，**人不能等代码**。
