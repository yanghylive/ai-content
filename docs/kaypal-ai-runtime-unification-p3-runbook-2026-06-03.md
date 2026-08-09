# P3 切上层 + 双跑 + 删存量 + 5409 下线 · 真机操作手册

> 单人项目手册（D1-D2 = 2026-06-03 写，D3 = 2026-06-03 19:15 修订）
> 配合 docs/kaypal-ai-runtime-unification-project-plan-2026-06-03.html §四 节阅读
> 配合 docs/adr/001 + 002 阅读
>
> **预计工作量**：1-2 天单人（**P3-D2/D3 真账号双跑已跳过**——用户决策 2026-06-03：现在没真实用户，备份就好）
> **P3 剩余** = 删存量（半天）+ 5409 归档收口（半小时）

---

## 重大决策记录：跳过 3 天真账号双跑

**决策时间**：2026-06-03
**决策人**：用户
**依据**：handoff §1（"现在还没有真实用户，所以不用做很长的'新旧系统真账号双跑 3 天'作为硬门槛"）

**原计划** vs **新计划**：

| 阶段 | 原计划 | 新计划 |
|---|---|---|
| P3-D2/D3 真账号双跑 3 天 | **硬门槛** | **跳过**（无真实用户） |
| 替代质量保证 | — | 97/97 单测 + 4 P3 gate 脚本 + 2 backend smoke + 模块装配测试 |
| 备份策略 | 备份后做双跑 | **直接备份**（已 2026-06-03 19:13 完成） |
| 5409 进程 | 双跑期间并存 | 双跑跳过，备份后**待用户决定何时停** |

**P3 剩余 1-2 天**：
1. ✅ 备份旧系统（已完）
2. ⏳ P3-D4 删存量（半天，AI 可做）
3. ⏳ P3-D5 5409 归档收口（推 tag + 源仓 archive，1-2 小时，用户做）
4. ⏳ 4 个 P3 gate 脚本跑历史数据（可选验证，半天）

---

## 状态交接：P1 + P2 + P3-D1 关键出口切换 + P3-D5 备份已完成

| 阶段 | 状态 | 关键产出 |
|---|---|---|
| P1 边界+路由 | ✅ done | 5 个 commit；Runtime skeleton + ExecutorRouter + ADR-001/002 |
| P2 D1 引擎 client | ✅ done | LocalRuntimeEngineClient + BrowserControlService |
| P2 D2 平台 services | ✅ done | 4 个 platform service（抖音/视频号 × 评论/私信） |
| P2 D3 证据持久化 | ✅ done | EvidenceService + Prisma runtime_executions 表 |
| P2 D4 缓冲 | ✅ done | ExecutorRouter 接通 EvidenceService |
| P3-D1 关键出口切换 | ✅ done | LocalEngineService 自动发送/确认后填草稿已改走 RuntimeOrchestrator |
| **P3-D5 备份** | ✅ **done** | **948MB auto-upload 全量 + 92KB local-engine + 121 个 WIP 状态 + git tag `legacy/5409-final`** |

**当前状态**：Runtime 7 套 44 测试通过，`tsc --noEmit` 通过；Router/LocalEngine 落库烟测通过且清理测试数据。当前改动仍在本地，未提交、未部署。

**关键基础设施**：
- `ExecutorRouter.route(task, ctx)` — 任何互动任务的统一入口；自动证据持久化
- `RuntimeOrchestrator.execute(task, ctx)` — 已接入 LocalEngineService 的发送/填草稿出口
- `EvidenceService.recordExecutionFireAndForget` — 任务执行完自动记录
- `scripts/runtime-dual-run-export.mjs` — 从 DB 导出旧任务 + Runtime 记录对照样本
- `scripts/runtime-dual-run-diff.mjs` — 生成差异报告；默认要求至少 1 条样本，避免空样本假绿
- 回滚锚点：`76e15f5`（P2 D4 一轮，Agent-S 真正接通前的最后纯 P1 状态）

---

## P3-D1：已完成的切换边界

**风险等级**：🟡 中
**当前状态**：代码已切关键出口，不再从零开始切

已切：
- `LocalEngineService` 自动发送出口：`autoSendReplyViaRuntime(task)`
- `LocalEngineService` 确认后填草稿出口：`draftApprovedReplyViaRuntime(task)`
- 浏览器任务 Runtime preflight：`BrowserControlService.preflight(...)`
- Nest 模块装配：`LocalEngineModule <-> RuntimeModule` 使用 `forwardRef` 并有 `runtime-module-wiring.spec.ts`

暂留：
- `interactionExecutor.getStatus()`：能力展示/创建前能力检查
- `interactionExecutor.generateAiReply()`：AI 回复生成，不是平台执行出口
- `interactionExecutor.preflightTask()`：旧路径读取/目标识别，双跑期保留用于对照
- `LocalInteractionExecutorService` 文件本体：P3-D4 前不能删

### 1.1 当前硬性检查

```bash
# 回滚锚点位置（必须能 git checkout）
git log --oneline | grep 76e15f5

# Runtime 测试组
cd backend
npx jest --runInBand \
  src/modules/runtime/runtime-module-wiring.spec.ts \
  src/modules/runtime/orchestrator/runtime-orchestrator.service.spec.ts \
  src/modules/runtime/orchestrator/interaction-task-runtime.mapper.spec.ts \
  src/modules/runtime/executor-router.spec.ts \
  src/modules/runtime/runtime.integration.spec.ts \
  src/modules/runtime/evidence/evidence.service.spec.ts \
  src/modules/runtime/browser-control/browser-control.service.spec.ts

# 类型检查
npx tsc --noEmit
```

### 1.2 落库烟测

```bash
cd backend

# Router -> EvidenceService 写 runtime_executions，并删除测试行
npx ts-node -r tsconfig-paths/register scripts/runtime-router-persistence-smoke.ts

# LocalEngineService.createTask -> RuntimeOrchestrator -> EvidenceService 写 runtime_executions，并删除测试行
npx ts-node -r tsconfig-paths/register scripts/local-engine-runtime-smoke.ts
```

烟测不触碰真实平台；它 mock 账号和读取，验证服务接线、Runtime 路由、DB 落库和清理。

### 1.3 D1 出口标准

- 自动发送/填草稿出口走 RuntimeOrchestrator
- `runtime_executions` 表已真实存在并可写
- RuntimeModule 能注入 LocalEngineService
- `LocalInteractionExecutorService` 仍保留，等 smoke 验证通过后再删
- ~~未完成项：真账号双跑样本还没有~~ **改为：备份已完成，smoke 验证替代**

---

## P3-D2/D3：~~双跑灰度 ≥ 3 天~~ → **已跳过**

**状态**：⏭️ **跳过**（用户决策 2026-06-03）

**原因**：现在没有真实用户，handoff §1 明确指出"不用做很长的'新旧系统真账号双跑 3 天'作为硬门槛"。等真有用户再做。

**替代质量保证**（已具备）：
- 97/97 单测（含 4 团队后加 integration + 7 mapper + 1 wiring + 1 evidence）
- 4 P3 gate 脚本（`runtime-p3-dual-run-gate.mjs` 等）
- 2 backend smoke（`local-engine-runtime-smoke.ts` + `runtime-router-persistence-smoke.ts`）
- Prisma `runtime_executions` 表已落库并能查询

**未来真用户接入时**（P5 阶段补做）：
- 等有真实抖音/视频号测试账号后
- 跑 4 互动 × 5 轮 = 20 任务真账号
- 用 `runtime-p3-dual-run-gate.mjs` 比对差异
- 差异率 0 才能"正式替换"（不是删除旧代码，是切流）

**当前阶段**：
- 历史数据（`interaction_tasks` 表里 6/3 之前的任务）可用 `--skip-commercial` 跑
- 等双跑通过后回这里补这段即可
- 备份 + 烟雾测已足够现阶段推进

### 2.1 准备

```bash
cd /Users/yanghy/Documents/New\ project/ai-content

# 推荐总入口：先跑本地健康检查，再跑商业验收门禁，最后导出 + diff
node scripts/runtime-p3-dual-run-gate.mjs --skip-commercial --min-records 20

# 真账号执行入口：只在确认测试账号/测试对象后打开这些开关
P3_DUAL_RUN_RUN_COMMERCIAL=1 \
COMMERCIAL_REAL_EXECUTION=1 \
COMMERCIAL_APPROVE_DRAFTS=1 \
node scripts/runtime-p3-dual-run-gate.mjs --min-records 20

# 复验某一次商业验收报告：只导出该报告 createdTaskIds，不拿历史任务充数
node scripts/runtime-p3-dual-run-gate.mjs --commercial-report .local-logs/commercial-acceptance-<timestamp>.json --min-records 20

# 以下是拆解调试命令。严格导出最近 N 条任务：旧任务没有 Runtime 记录也会进入报告，适合验收
node scripts/runtime-dual-run-export.mjs --limit 50 --out .local-logs/runtime-dual-run-records.json

# 只导出已有 Runtime 记录的任务：适合调试，不能代替验收
node scripts/runtime-dual-run-export.mjs --limit 50 --only-with-runtime --out .local-logs/runtime-dual-run-records-runtime-only.json

# diff 默认要求至少 1 条样本；没有样本会失败，防止假绿
node scripts/runtime-dual-run-diff.mjs .local-logs/runtime-dual-run-records.json .local-logs/runtime-dual-run-diff.json --min-records 20
```

### 2.2 双跑模式

现阶段不是 feature flag。验收按 DB 里的两套证据比对：
- 旧路径结果：`interaction_tasks` 里的 status/events/evidence/config
- 新路径结果：`runtime_executions` 里的 status/reasonCode/evidence/readback
- 导出工具把两边合成同一条 record，diff 工具比 `ok/status/readback/evidenceCount`

**操作方式**：
1. 真账号跑抖音/视频号 4 互动 × 5 轮 = 20 个任务
2. 每个任务都要能在 `runtime_executions` 里找到 relatedId
3. 跑 `runtime-p3-dual-run-gate.mjs`，正式验收不加 `--allow-empty`，也不加 `--only-with-runtime`
4. 商业验收模式必须从 `commercial-acceptance-*.json` 读到 `artifacts.createdTaskIds`；如果没有 taskId，gate 会阻断，不会回退拿历史任务充数
5. 看 gate 报告里的 `summary.status/sampleCount/diffFailed`
6. 如果 diff 失败，先看报告里的 field：`runtime` 缺失、`ok/status` 不一致、`readbackText` 不一致、`evidenceCount` 缺失

### 2.3 差异处理

**任何 1 轮有差异，立即停止双跑**：
- 标 P3-D2 中断，定位差异源（旧实现 vs 新实现哪边对）
- 修代码，必要时回滚那 1 个 caller 的切换
- 从头跑双跑

**接受 0 差异才能进 P3-D4**。

### 2.4 D2-D3 出口标准

- 4 互动 × 5 轮 × 2 路径 = 40 条结果，差异 = 0
- 每天 1 次完整跑（连续 3 天）
- diff 报告样本数达标，不能用 `--allow-empty` 或 `--only-with-runtime` 的空报告充数

---

## P3-D4：删存量代码

**风险等级**：🟡 中（机械工作，但量大）
**预计工作量**：半天
**入口**：`LocalInteractionExecutorService` 130KB+ 的 8 个 execute* 方法 + `CdpPlatformInteractionService` + `AutoUploadClient` 复用部分

### 4.1 删除前清单（按顺序）

```bash
# Step 1: 确认最终发送/填草稿出口已切走
grep -n "interactionExecutor\\.autoSendReply\\|interactionExecutor\\.draftApprovedReply" backend/src/modules/local-engine/local-engine.service.ts
# 期望：只允许 fallback 分支中出现；正常路径必须走 RuntimeOrchestrator

# Step 2: 确认是否还需要旧 preflight/读取能力
grep -n "LocalInteractionExecutorService" backend/src/modules/local-engine/local-engine.service.ts
# 如果还在用于 preflightTask/getStatus/generateAiReply，不能删文件

# Step 3: 真账号双跑 0 差异后再删文件
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

## P3-D5：5409 源仓归档（**备份已完成，待 push + archive**）

**风险等级**：🟢 低（操作活）
**预计工作量**：1 小时
**状态**：**备份 2026-06-03 19:15 完成** ✅，剩余 push tag + 源仓 archive

### 5.1 5409 源仓操作（备份已完成）

**已完成**（2026-06-03 19:15）：
```bash
cd /Users/yanghy/auto-upload
git tag -a legacy/5409-final -m "Final snapshot before P3 5409 deprecation (2026-06-03). Full source backup at .local-logs/legacy-backups/auto-upload-legacy-20260603-191336.tar.gz"
# ✅ tag 已打（**未 push**——等 P3-D4 删存量 + D5 收口后再一起 push）
```

**主仓备份**（`/Users/yanghy/Documents/New project/ai-content/.local-logs/legacy-backups/`）：
- `auto-upload-legacy-20260603-191336.tar.gz` — 948 MB（5409 全量归档）
- `local-engine-legacy-20260603-191453.tar.gz` — 92 KB（旧 Local Engine 3 文件）
- `git-status-before-runtime-cleanup.txt` — 121 个 WIP 状态快照
- `BACKUP-MANIFEST.md` — 备份清单 + 回滚指南

**待做**（用户决定时机）：
```bash
# 等 P3-D4 删存量全部完成后
cd /Users/yanghy/auto-upload
git push origin legacy/5409-final
gh repo edit --enable-archive  # 源仓 GitHub 归档
```

### 5.2 主仓验收（删存量后做）

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

- ✅ 5409 源仓打 `git tag legacy/5409-final`
- ⏳ 源仓 archived（**等 P3-D4 完成后做**）
- ⏳ 主仓搜 `127.0.0.1:5409` 业务直连 = 0（**等 P3-D4 删存量后**）
- ⏳ 主仓搜 `auto-upload` 业务直连 = 0（仅 P4 桌面打包用）

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
- D1 出口切换引入 P0 bug 修复时间 > 2 小时 → 立刻 revert
- D2-D3 双跑连续 2 轮差异找不到原因 → 暂停推进，定位问题
- D4 删代码后主仓 build 失败 → revert + 重新评估

---

## P3 风险地图

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| D1 出口切换引入 P0 bug | 中 | 高 | 已加模块装配/落库烟测；真机前再跑一遍 |
| D2 双跑差异找不到原因 | 中 | 中 | 先回滚 1 个 caller，定位后重新切 |
| D4 删漏 caller 导致启动失败 | 低 | 高 | Step 1 grep 必须为空 |
| D5 归档后回不去 | 极低 | 致命 | tag + push tag + 源仓 archive 三步分离 |
| 性能回退 | 低 | 中 | 双跑期跑性能基线对比 |
| 用户 97 个 WIP 撞车 | 中 | 中 | 提前 commit + push，WIP 阶段让用户 review |

---

## P3 真实时间估计

| 子阶段 | 估计 | 实际（事后填） | 状态 |
|---|---|---|---|
| D1 出口切换 | 1-2 天 | **已完成** | ✅ |
| D2-D3 真账号双跑 | ~~3 天~~ | **跳过** | ⏭️ |
| 旧系统备份 | 1 小时 | **已完成** | ✅ |
| D4 删存量 | 0.5 天 | ___ | ⏳ AI 可做 |
| D5 push tag + 源仓 archive | 0.5-1 小时 | ___ | ⏳ 用户 |
| 缓冲 | 0.5 天 | ___ | ⏳ |
| **总计** | **1-2 天** | ___ | |

**P2 5 个 D 阶段 1 个日历日完成**（密集作业）。P3 因为跳过真账号双跑，**也压缩到 1-2 天**——用户决策后 P3 不再是 3 天硬约束。

P5 真账号验收仍要做（等有真用户/测试账号）——但那是 P5 阶段的事，P3 不再卡。

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
