# ADR-002: Copy-first 迁移策略

**日期**：2026-06-03（D3 末，P1 收尾后）
**状态**：Accepted
**作者**：单人开发
**审阅**：——（未来协作者回填）

---

## 1. Context（决策背景）

D3 末 P1 自审发现仓库有 96 个 pending changes（未提交的用户工作），其中 5 个文件正好是 P2 目标，已积累 +718 行未提交工作：

| 文件 | 用户 WIP 行数 |
|---|---:|
| `backend/src/modules/auto-upload/auto-upload.client.ts` | +2 |
| `backend/src/modules/local-engine/local-engine.service.ts` | +215 |
| `backend/src/modules/local-engine/local-engine.types.ts` | +16 |
| `backend/src/modules/local-engine/local-interaction-executor.service.ts` | +31 |
| `desktop/main.js` | +479 |

按原 P2 计划（ADR-001 §3）要在这些文件里直接做改动：迁移方法、删 5409 health 检查、改 manifest 路径等。这会导致：

1. 合并冲突频发，开发体验差
2. 可能覆盖用户 WIP 关键改动
3. 难以独立验证我的 P2 改动是否生效（baseline 已经被污染）
4. 出问题时回滚困难（混在用户改动里）

且 P3 原本就要做"双跑灰度"——Runtime 与 5409 并行 ≥3 天观察差异。**既然终态本来就是两套并存观察**，没必要在 P2 阶段就把原代码改了。

## 2. Decision（决策）

**P2 阶段全部采用"复制不修改"策略**：

> 新代码全部写在 `runtime/` 目录下的新文件里。
> 原存量代码（local-engine、auto-upload、desktop/main.js 等）在 P2 期间 **一行不动**。
> P3 切换 + 删除阶段才动存量。

### 具体映射

| 原文件（P2 期间不动） | 新建副本 / 等价物 |
|---|---|
| `backend/src/modules/auto-upload/auto-upload.client.ts` | `backend/src/modules/runtime/local-runtime-engine.client.ts` |
| `backend/src/modules/local-engine/local-interaction-executor.service.ts` 的 `executeDouyin*` | `runtime/platforms/douyin/{comment-reply,direct-message-reply}.service.ts` |
| `backend/src/modules/local-engine/local-interaction-executor.service.ts` 的 `executeWechatChannel*` | `runtime/platforms/channel/{comment-reply,direct-message-reply}.service.ts` |
| `backend/src/modules/local-engine/local-engine.service.ts` 中 5409 health 检查 | `runtime/health/runtime-health.service.ts`（新写，独立于现有 health） |
| `backend/src/modules/local-engine/cdp-platform-interaction.service.ts` | `runtime/browser-control/browser-control.service.ts` |
| `backend/src/modules/local-engine/agent-s.service.ts` | `runtime/agent-s-adapter.ts`（薄壳包装，不复制实现） |
| `desktop/main.js` 中多进程启动逻辑 | `desktop/runtime-launcher.js`（新文件） |

### 例外说明（不复制的）

- **`AgentSService` 本体不复制**——它是 Agent-S 的事实控制器，价值在于 sidecar 生命周期管理。新建 `AgentSExecutorAdapter` 薄壳包装，注入现有 AgentSService 即可。
- **Prisma schema 不分叉**——AgentSession / InteractionTask 等表继续使用，不建并行表。这与 ADR-001 §4 一致。

## 3. Consequences（影响）

### 好处

1. **用户 WIP 不会被覆盖**——P2 期间存量文件一行不改，merge 冲突归零。
2. **新旧两套天然并存**——P3 双跑灰度本来就要双跑，提前并存等于提前进入 P3 准备期。
3. **回滚零成本**——出问题就删 `runtime/` 下相关文件，存量代码一行没动。
4. **独立测试**——Runtime 模块可以独立写单测 + e2e，不污染或依赖存量测试基线。
5. **基线清晰**——P2 验证只看"新代码自己跑得通"，不需要证明"现网未退化"（因为没改现网）。

### 代价

1. **短期代码重复**——同一份 publishing 逻辑会同时存在于 `auto-upload/auto-upload.client.ts` 和 `runtime/local-runtime-engine.client.ts`。P3 切换前是技术债。
2. **切换时机必须明确**——P3 D1 必须把上层调用（Orchestrator、前端 Hook 间接路径）从旧切到新；不能让两套永久并存。
3. **切换后必须立即清理**——P3 D4 必须删存量。不能让 "其实两套都跑得通" 的状态拖过 P3。
4. **AgentSService 多一层适配**——AgentSExecutorAdapter 在 AgentSService 上加一层，性能可忽略，但读代码多一跳。

### 切换边界与节奏

P3 的"双跑灰度"成为真正的切换关口：

| 时点 | 状态 |
|---|---|
| P2 末（D11） | 两套代码都跑通；上层调用 + 前端 Hook 仍走旧路径；新代码用单测 + 内部脚本触发验证 |
| P3 D1-D2 | 上层 Orchestrator 切到 ExecutorRouter；存量代码进入"未被调用"状态，但仍保留可回滚 |
| P3 D3 | 双跑对照样本集：抖音/视频号 4 条互动各 5 轮，新旧两路结果比对，差异为零 |
| P3 D4 | **删除存量代码**——LocalInteractionExecutorService 的 8 个 execute* 方法、CdpPlatformInteractionService、AutoUploadClient 不再用的部分 |
| P3 D5 | 5409 源仓打 `legacy/5409-final` tag，归档为只读 |

如果 P3 D1-D3 双跑发现差异，**回滚 = 把 Orchestrator 切回旧路径**，存量代码本来就还在，零代价。

## 4. Alternatives Considered（备选方案）

### 备选 A：先让用户提交或 stash 那 96 个 pending changes，再按原计划改

否决原因：
- 用户的 718 行 WIP 状态未知（可能未完成、不可用、需要整理），强制 commit 或 stash 不属于本期合并的工作范围。
- 即便 stash 干净了，未来 merge 那 718 行回来时还是会撞 P2 改动，问题被推迟而非消除。
- 时间成本高（用户要先理顺 96 个 pending），且对用户工作流是侵入式干扰。

### 备选 B：在原文件里加 if-else 双跑

否决原因：
- 把"是否走 Runtime"的 if 塞进存量代码本身，污染严重。
- 切换后清理麻烦——要在多个文件里逐处删 if 块。
- 与 ExecutorRouter "外层路由" 的设计意图不符（ADR-001 §2.2）。

### 备选 C：用 git worktree 在另一个分支做改动，最后再 merge

否决原因：
- 单人项目，多 worktree 自己管理上下文切换复杂度。
- merge 时仍会遇到用户 WIP 的冲突，问题没解决。
- 收益不明显，复杂度上升。

## 5. 实施清单（P2 D4-D11 修订版）

### D4 · AgentSExecutorAdapter

- 新建 `backend/src/modules/runtime/agent-s-adapter.ts`
- 通过 LocalEngineModule.exports 注入 `AgentSService`（已经 export，见 ADR-001 §3.5）
- 实现 TaskExecutor 接口，把 ExecutorTask 翻译成 `AgentSService.runTask` 的 input 格式
- 加入 ExecutorRouter.executors
- 单元测试：3 个 case（执行成功 / sidecar 不可用 / 翻译失败）

### D5-D6 · LocalRuntimeEngineClient + BrowserControl

- 新建 `runtime/local-runtime-engine.client.ts`
  - 参考 AutoUploadClient 但去掉 5409 硬编码
  - URL 从 ConfigService（`KAYPAL_RUNTIME_URL` 或 manifest）读
  - 不引用 AutoUploadClient（避免反向依赖）
- 新建 `runtime/browser-control/browser-control.service.ts`
  - 参考 CdpPlatformInteractionService 的 status + preflight 逻辑
  - 但通过 LocalRuntimeEngineClient 调用，不直接调 AutoUploadService
- LocalRuntimeClient（已有 stub）改：
  - canHandle 对 platform='douyin' / 'wechat-channel' 返回 `{ ok: true, priority: 70 }`
  - execute 调 LocalRuntimeEngineClient

### D7-D8 · Platform 路径复制

- 新建 `runtime/platforms/douyin/comment-reply.service.ts`
  - **复制** LocalInteractionExecutorService 的 douyin-comment-reply 相关方法
  - 改造为只通过 LocalRuntimeEngineClient + BrowserControlService 调用
- 同样新建 `runtime/platforms/douyin/direct-message-reply.service.ts`
- 同样新建 `runtime/platforms/channel/{comment-reply,direct-message-reply}.service.ts`
- 每个 platform service 至少 2 个单测（成功路径 + 1 个失败路径）

### D9-D10 · EvidenceService

- 新建 `runtime/evidence/evidence.service.ts`
- 异步队列写入，写失败 = 任务整体降级到 `blocked + readback_failed`（见技术方案九节 风险 7）
- 不复用现有审计日志，独立写入到 Prisma `runtime_executions` 表（草案见 ADR-001 §4）
- 若 P2 时 InteractionTask + AgentSession 表已经够用，跳过此表新建（ADR-001 §7 未决问题 2）

### D11 · Desktop runtime-launcher

- 新建 `desktop/runtime-launcher.js`
- 参考 `desktop/main.js` 的子进程启动逻辑
- 只启动 Runtime 进程（不动 5409 启动逻辑、不动 Agent-S 启动逻辑、不动 main window 逻辑）
- 暴露 IPC 接口供 main.js 调用（main.js 调不调由用户决定，本期不动 main.js）

### P2 出口验证（修订）

旧标准（项目规划 P1 出口口径）：
> 所有现网 e2e 用例改走 ExecutorRouter 后仍通过

P2 出口标准修订为：
> Runtime 模块对每个目标 platform 至少有 1 条端到端单元测试通过；不要求现网代码改走 ExecutorRouter（推迟到 P3 D1）。

P3 出口标准对应修订为：
> P3 D2 末，Orchestrator 切到 ExecutorRouter；P3 D3 双跑无差异 ≥ 3 天后，P3 D4 删除存量代码。

## 6. 未决问题

- **P3 切换是用 feature flag 还是直接 hard switch？** 倾向 hard switch（单人项目无并发用户压力）。回滚靠 git revert 即可。
- **`runtime/local-runtime-engine.client.ts` 复制 AutoUploadClient 多少？** 不全复制，only-as-needed——P2 D5 实际复制时按 platform 服务的需要逐方法搬。
- **Prisma `runtime_executions` 表到底建不建？** 等 P2 D7 写 platform service 时再判定。如果 InteractionTask + AgentSession 表的字段够用，跳过；不够再加。

---

## 准则总结（贴显眼处，给未来的协作者 / 未来的自己）

> **P2 阶段：不改任何存量文件。所有新代码进 `runtime/` 目录或新建文件。**
>
> **P3 阶段：切换上层调用到 ExecutorRouter，然后删除存量。**
>
> **冲突预期：归零。**
