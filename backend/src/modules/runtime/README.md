# runtime · Kaypal Local Runtime 模块

> KaypalAI 内容创作平台 Runtime 统一合并的核心模块。
> 详见 `docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html`。

## 当前阶段

**P1 骨架（2026-06-03）**：接口 + Router + LocalRuntimeClient 占位实现。所有 `canHandle` 返回 false，所有 `execute` 返回 `runtime_unavailable`。

## 模块结构

```
runtime/
├── README.md                   ← 本文件
├── executor.interface.ts       ← TaskExecutor + ExecutorTask + RuntimeExecutionResult 类型契约
├── local-runtime.client.ts     ← TaskExecutor 实现（浏览器 CDP 路径），P2 接入 AutoUploadService
├── executor-router.ts          ← capability-based 路由 + 护栏（微信桌面强制 agent-s）
└── runtime.module.ts           ← NestJS Module
```

## 设计要点

1. **Capability-based 路由**：执行器自我声明能力，Router 按优先级选；不按 `task.type` 硬编码分发。这是 A+ 接口口子。
2. **强制护栏**：`wechat-desktop` 任务必须命中 `agent-s` 执行器，命中其它直接 reject 并写审计日志。
3. **不抛异常**：Router 总是返回 `RuntimeExecutionResult`，方便上层统一错误处理。
4. **AgentSService 不重做**：P2 通过 forwardRef 引用现有 `local-engine/agent-s.service.ts`，不新建客户端。

## 路线图

| 阶段 | 目标 |
|------|------|
| P1 骨架（当前） | 接口 + Router + LocalRuntimeClient stub |
| P2 浏览器迁移 | LocalRuntimeClient 接 AutoUploadService；迁入 5409 浏览器执行；加 `runtime/platforms/{douyin,channel}/`；加 EvidenceService |
| P2 桌面接入 | ExecutorRouter 引入 AgentSService（forwardRef）；wechat-desktop 任务路由打通 |
| P3 双跑灰度 | LocalRuntimeClient 与 5409 直连并行；差异告警；通过后 5409 下线 |
| P5 验收 | 八节验收 9 项全过 |

## 不变更项（命中即驳回 PR）

- 不改变 Agent-S 在桌面 GUI 互动中的主执行器地位
- 不改变默认 auto-send 行为
- 不让 local-engine 替代 Agent-S
- 不让前端绕过 3011 直发 Agent-S RPC
- 不做 S+ 投入（多 Agent / LLM Router / Computer Use 集成不在本期）

## 相关 ADR

- `docs/adr/001-executor-router-capability-interface.md`
