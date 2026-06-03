# ADR-001: ExecutorRouter Capability 接口设计

**日期**：2026-06-03（D2）
**状态**：Accepted（待 LLM 周日自审）
**作者**：单人开发
**审阅**：—— （未来协作者回填）

---

## 1. Context（决策背景）

D1 仓库扫描后，D2 通读以下 4 个 local-engine 源文件，做方法盘点：

- `backend/src/modules/local-engine/local-engine.controller.ts`（811 行）
- `backend/src/modules/local-engine/local-engine.service.ts`（约 7000 行，290KB）
- `backend/src/modules/local-engine/local-interaction-executor.service.ts`（约 3000 行，130KB）
- `backend/src/modules/local-engine/cdp-platform-interaction.service.ts`（170 行）
- `backend/src/modules/local-engine/agent-s.controller.ts`（80 行）
- `backend/src/modules/local-engine/agent-s.service.ts`（1300+ 行，43KB）

### 现状与原方案的差异

| 项 | 原方案假设 | 实际现状 |
|---|---|---|
| Agent-S 调用层 | 需新建 `backend/src/modules/runtime/agent-s.client.ts` | **`AgentSService` 已存在**，含完整 sidecar 生命周期（ensureRunning / createSession / runTask / getEvents / cancelSession / approveSession / getArtifacts），并已有独立 `/agent-s` HTTP 入口 |
| 事实执行器 | `local-engine` 是"轻量协调"模块 | **`LocalInteractionExecutorService`（130KB）才是事实执行器**，包含 douyin / channel / wechat / channel-comments / channel-messages / wechat-group-broadcast / wechat-moments-publish 等所有平台执行逻辑 |
| `LocalEngineService` 职责 | 不清楚 | 业务状态机（task / agent session 生命周期）+ Risk Control + Reply Rule + Evidence Cleanup。**这是合理且应保留的职责** |
| 数据库模型 | 未提及 | 已存在 `AgentSession` / `AgentConfirmation` / `InteractionTask` / `local_engine_reply_rules` 等表，新方案必须复用 |

### 结论：原方案对边界划分有误

- 不应"把 Agent-S 调用搬进 runtime 模块"——已经有干净的 `AgentSService`，重复造一份会出现两套 sidecar 状态。
- 不应"把 local-engine 整体降级为支持角色"——它的业务状态机是核心资产。
- 真正要拆的是 **`LocalInteractionExecutorService`**：浏览器执行迁 Runtime，桌面/微信执行调用现有 AgentSService。

## 2. Decision（决策）

### 2.1 ExecutorRouter 接口（Capability-based）

```typescript
// backend/src/modules/runtime/executor.interface.ts

export interface TaskExecutor {
  /** 执行器唯一标识 */
  readonly id: 'local-runtime' | 'agent-s';

  /** 判断能否处理任务 + 优先级 */
  canHandle(task: ExecutorTask): {
    ok: boolean;
    priority: number;         // 0-100，高优先
    reason?: string;          // 不能处理时的原因
  };

  /** 执行入口 */
  execute(task: ExecutorTask, ctx: ExecutorContext): Promise<RuntimeExecutionResult>;

  /** 健康检查 */
  isHealthy(): Promise<{ ok: boolean; details?: string }>;
}

export interface ExecutorTask {
  type: InteractionTaskType;      // 复用现有枚举
  platform: 'douyin' | 'wechat-channel' | 'wechat-desktop';
  accountId?: number;
  payload: unknown;
  sessionId?: string;              // 对应 AgentSession.id 或 InteractionTask.id
}

export interface ExecutorContext {
  riskContext: RiskContext;        // 复用现有
  approvalDecision?: ApprovalDecision;
  sendMode: 'auto-send' | 'draft-only';
}
```

### 2.2 ExecutorRouter 行为

```typescript
@Injectable()
export class ExecutorRouter {
  constructor(
    private readonly localRuntime: LocalRuntimeClient,
    private readonly agentS: AgentSService,         // ← 复用现有！
  ) {}

  async route(task: ExecutorTask, ctx: ExecutorContext): Promise<RuntimeExecutionResult> {
    const candidates = [this.localRuntime, this.agentS]
      .map((e) => ({ executor: e, capability: e.canHandle(task) }))
      .filter((c) => c.capability.ok)
      .sort((a, b) => b.capability.priority - a.capability.priority);

    if (candidates.length === 0) {
      return rejectResult('runtime_unavailable', '没有可用执行器');
    }

    // 微信/桌面任务强制命中 Agent-S，命不中 reject（护栏）
    if (task.platform === 'wechat-desktop' && candidates[0].executor.id !== 'agent-s') {
      return rejectResult('runtime_unavailable', '微信桌面任务必须命中 Agent-S，路由错配');
    }

    return candidates[0].executor.execute(task, ctx);
  }
}
```

### 2.3 关键约束

1. **AgentSService 不重做**——本期 `agent-s.client.ts` 不新建，ExecutorRouter 直接注入现有 AgentSService。如果将来需要适配层，再加 `AgentSExecutorAdapter`（薄壳），不动 AgentSService 本身。
2. **AgentSession 模型复用**——ExecutorRouter 不创建新的 session 概念。一次 route 调用对应一个已存在的 AgentSession 或 InteractionTask，由 LocalEngineService 负责 CRUD。
3. **默认 reject**——`canHandle` 全部返回 `ok=false` 时，ExecutorRouter 返回 `RuntimeExecutionResult { ok: false, reasonCode: 'runtime_unavailable' }`，不抛异常。
4. **强制护栏**——微信桌面任务命中 Local Runtime = bug，直接 reject 并写审计日志。

## 3. Consequences（对原方案的调整）

### 3.1 runtime/ 目录内容收窄

| 原方案 | 调整后 |
|---|---|
| `runtime/local-runtime.client.ts` | 保留 |
| `runtime/agent-s.client.ts` | **删除**，复用 `AgentSService` |
| `runtime/executor-router.ts` | 保留 |
| `runtime/evidence.service.ts` | 保留 |
| `runtime/platforms/{douyin,channel}/` | 保留 |
| `runtime/executor.interface.ts`（新） | 添加，定义 TaskExecutor + ExecutorTask 等接口 |
| `runtime/agent-s-adapter.ts`（可选） | 仅在 AgentSService 接口与 TaskExecutor 不匹配时新建，作为薄壳 |

### 3.2 LocalEngineService 改动收窄

- **保留**：业务状态机（task / agent session 生命周期）、Risk Control、Reply Rule、Evidence Cleanup、WeChat session 控制、Health/Readiness 等。
- **改动**：`saveInteractionAsset` 等需要执行的方法，下层调用改走 ExecutorRouter，不直接调 `LocalInteractionExecutorService`。
- **不动**：HTTP 接口签名、数据库交互逻辑、Risk Control 策略。

### 3.3 LocalInteractionExecutorService 拆解

| 方法/职责 | 归属 | 阶段 |
|---|---|---|
| `getStatus()` | LocalEngineService 已有，去重 | P1 |
| `preflightTask(task)` | 拆：判断执行器走 ExecutorRouter.canHandle；保留 task 校验在 LocalEngineService | P1 |
| `draftApprovedReply(task)` | 拆：drafting 逻辑保留为 service 方法；下层调 ExecutorRouter | P2 |
| `autoSendReply(task)` | 同上 | P2 |
| `executeDouyinCommentReply` / `executeDouyinDirectMessageReply` | 迁 `runtime/platforms/douyin/` | P2 |
| `executeWechatChannelCommentReply` / `executeWechatChannelDirectMessageReply` | 迁 `runtime/platforms/channel/` | P2 |
| `executeWechatGroupBroadcast` / `executeWechatMomentsPublish` | **迁调用 AgentSService**（这些已是桌面执行） | P2 |
| `preflightWechatDesktop()` | 调用 AgentSService.health / getStatus 替代 | P2 |
| `blockUnreleasedWechatCommercialTask` | 保留为支持方法在 LocalEngineService | P1 |

### 3.4 CdpPlatformInteractionService 处置

- 170 行小文件，纯封装 CDP browser status / preflight。
- **整体迁入 `runtime/browser-control/`**，名字改 `BrowserControlService`。
- `AutoUploadService` 依赖随之迁入 `LocalRuntimeClient` 内部。

### 3.5 AgentSService 处置

- **不变更**。位置可保留在 `local-engine/agent-s.service.ts`，也可考虑移到 `runtime/agent-s.service.ts` 或独立模块，本期不做物理迁移。
- 仅在 `LocalEngineModule` 的 imports / exports 暴露给 ExecutorRouter。

## 4. Prisma 模型复用方案

| 表 | 原职责 | ExecutorRouter 视角 |
|---|---|---|
| `local_engine_agent_sessions` (`AgentSession`) | Agent 会话生命周期 | ExecutorRouter 不操作此表；通过 sessionId 关联到执行；CRUD 仍归 LocalEngineService |
| `local_engine_agent_confirmations` (`AgentConfirmation`) | 审批决策 | 同上 |
| `local_engine_interaction_tasks` (`InteractionTask`) | 互动任务 | 同上 |
| `local_engine_reply_rules` | 回复规则 | ExecutorRouter 不读不写 |
| 新增：`runtime_executions` | 执行历史 + 证据快照 | EvidenceService 写入；与 InteractionTask / AgentSession 通过 `relatedId` + `relatedType` 多态关联 |

`runtime_executions` 表 schema（草案）：

```prisma
model RuntimeExecution {
  id              String   @id @default(cuid())
  executor        String   // 'local-runtime' | 'agent-s'
  relatedId       String   // InteractionTask.id 或 AgentSession.id
  relatedType     String   // 'interaction-task' | 'agent-session'
  ok              Boolean
  status          String
  reasonCode      String
  payload         Json
  result          Json
  evidence        Json     // 与 RuntimeExecutionResult.evidence 一致
  startedAt       DateTime
  finishedAt      DateTime?
  durationMs      Int?

  createdAt       DateTime @default(now())

  @@index([relatedId, relatedType])
  @@index([executor, status])
  @@map("runtime_executions")
}
```

D2 末把此 schema 草案写进 `backend/prisma/schema.prisma` 注释（暂不 migrate），P2 真实迁入时再启用。

## 5. Alternatives Considered（备选方案）

### 备选 A：把 AgentSService 整个搬进 runtime/

否决原因：物理迁移成本大，且 AgentSService 内部已经稳定，新增风险无收益。

### 备选 B：让 ExecutorRouter 完全替代 LocalInteractionExecutorService

否决原因：LocalInteractionExecutorService 里"task 校验 + 商用 blocker + auto-send/draft-only 决策"是业务层，不应进 Router。Router 只做"选执行器 + 转发"，不做业务判断。

### 备选 C：按 task.type 硬编码路由（不用 capability）

否决原因：硬编码每加平台都要改 Router；capability-based 设计加平台只需在新执行器里加 `canHandle` 分支。这是本期最重要的 A+ 接口预留。

## 6. 实施清单（D3 起）

P1 剩余天数（D3）：

1. 把 `runtime/executor.interface.ts` 写入仓库。
2. 把 ExecutorRouter 骨架写入 `runtime/executor-router.ts`（不接真实执行器，全部 stub canHandle = false）。
3. 把 LocalRuntimeClient 骨架写入 `runtime/local-runtime.client.ts`，内部 import AutoUploadService。
4. 在 `LocalEngineModule.imports` 加 RuntimeModule。
5. 更新技术方案十节文件清单 v1 → v2，标注每个方法的归属决定。

## 7. 未决问题（明确不解决）

- AgentSService 是否物理移到 `runtime/` 目录：本期不做，留 P5 验收后评估。
- `runtime_executions` 表是否真的需要：P2 实施时如果 InteractionTask + AgentSession 已经够用，可不加。
- LocalInteractionExecutorService 重命名为 `InteractionOrchestratorService` 是否合理：本期不重命名，避免 git blame 噪音。
