# Runtime 统一合并 · P1 范围声明

**日期**：2026-06-03
**版本**：v1
**对应方案**：`docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html`
**配套规划**：`docs/kaypal-ai-runtime-unification-project-plan-2026-06-03.html`
**时间盒**：3-5 周（16-25 工作日；realistic ≈ 32 天含 buffer）

---

## 一、本期做什么

把 5409 拆解并入主仓，形成四件套：

- **3010 UI**：唯一用户入口
- **3011 Core API**：新增 ExecutorRouter
- **Kaypal Local Runtime**：接管 5409 浏览器 CDP 能力
- **Agent-S / local-controller**：继续承担桌面 GUI 执行

最终判断标准：用户只启动 KaypalAI 内容创作平台、只访问 3010；任何真实平台动作由 3011 创建任务、ExecutorRouter 决定走 Local Runtime 还是 Agent-S、3011 保存证据、3010 展示结果。

## 二、本期不变更项（命中即驳回 PR）

1. **不改变 Agent-S 主执行器地位**——微信及一切桌面 GUI 客户端互动继续走 Agent-S，不切到 Local Runtime / local-engine。
2. **不改变默认 auto-send 行为**——审批仅在不确定目标、风险内容、权限缺失或用户显式选择时触发。
3. **不让 local-engine 替代 Agent-S**——local-engine 仅做权限/策略/状态/证据/审计协调。
4. **不让前端绕过 3011 直发 Agent-S RPC**——`use-agent-s-state` Hook 仅做 UI 状态编排，业务调用仍走 3011 ExecutorRouter。
5. **不做 S+ 投入**——多 Agent / LLM Router / Computer Use 集成不进入本期路线图，本期完成后视市场和数据再评估。
6. **不做 Windows / Linux 支持**——本期只覆盖 macOS。
7. **不新增平台**——飞书 / 钉钉 / 企微等不在本期范围；仅在架构上预留 Platform Pack 接口。
8. **不上云端控制面**——保持单机本地架构。

## 三、本期产出物

- `backend/src/modules/runtime/` 完整模块（ExecutorRouter、LocalRuntimeClient、AgentSClient、EvidenceService）
- `runtime/platforms/{douyin,channel}/` 按目录隔离的平台实现
- `runtime-manifest.json`（桌面端启动后写入）
- 5409 源仓打 `git tag legacy/5409-final` 归档为只读
- 八节验收 9 项全部通过的证据归档
- 至少 4 篇 ADR：ExecutorRouter capability 接口、Evidence 异步队列、5409 双跑差异判定、Electron 多进程守护
- handover 文档更新到终态

## 四、纪律（贯穿全程）

- **PR 标签强制**：每个 PR 标题前缀必须是 `[b-plus]` / `[a-plus-hook]` / `[bugfix]` / `[chore]` 之一，其它标签拒绝合入；禁止 `[s-plus]`。
- **每周日 LLM 自审**：把本周关键 diff + ADR 喂 Claude/GPT，要求"找 3 个本周代码里最可能有问题的地方"。
- **每周五 30 分钟复盘**：本周代码有无掺入 S+ 幻想；有则回滚或挪 backlog。
- **季度末复盘**：A+ 留的接口是否被实际使用；未使用则下季度删除。
- **WIP=1**：一次只做一个阶段，不允许"先进下阶段、回头补"。

## 五、单人特有约束

- 工时模式：7×24 弹性，但日产出按 8-10h 稳态估，保留 30% buffer。
- 连续 3 天日产出 ≤ 50% 强制 6h/day × 2 天恢复，不可硬撑。
- 24h 卡同一技术问题 → 喂 LLM 或求助社区；48h 仍未解 → reduce scope。
- 每日 commit + push，PROGRESS.md 强制更新，即便只有半成品。

## 六、参考文档

- 技术方案：`docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html`
- 项目规划：`docs/kaypal-ai-runtime-unification-project-plan-2026-06-03.html`
- 客户互动护栏：`AGENTS.md`
- 前置交接：`docs/handover-2026-06-03.md`
- 进度日志：`PROGRESS.md`（仓库根）

---

签字：________  日期：________
