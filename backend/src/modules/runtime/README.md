# runtime · JIUZHANG AI Local Runtime 模块

> JIUZHANG AI 内容创作平台 Runtime 统一合并的核心模块。
> 详见 `docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html`。

## 当前阶段

**3011 in-process Runtime（2026-06-07）**：浏览器类客户互动已由 3011 内部 Runtime / Playwright MCP 执行，不再启动或调用独立 `5409 auto-upload` 服务。

## 模块结构

```
runtime/
├── README.md                   ← 本文件
├── executor.interface.ts       ← TaskExecutor + ExecutorTask + RuntimeExecutionResult 类型契约
├── local-runtime-engine.client.ts ← 兼容旧调用方的 in-process Runtime client
├── platforms/                  ← 抖音 / 视频号客户互动执行器
├── executor-router.ts          ← capability-based 路由 + 护栏（微信桌面强制 agent-s）
└── runtime.module.ts           ← NestJS Module
```

## 设计要点

1. **Capability-based 路由**：执行器自我声明能力，Router 按优先级选；不按 `task.type` 硬编码分发。这是 A+ 接口口子。
2. **强制护栏**：`wechat-desktop` 任务必须命中 `agent-s` 执行器，命中其它直接 reject 并写审计日志。
3. **不抛异常**：Router 总是返回 `RuntimeExecutionResult`，方便上层统一错误处理。
4. **AgentSService 不重做**：桌面 GUI 能力继续使用现有 `local-engine/agent-s.service.ts`，浏览器客户互动走 3011 Runtime。
5. **不再双跑 5409**：`5409` 只允许出现在历史说明、迁移注释或备份目录中，不允许作为业务运行服务、数据源或兜底执行器。

## 已完成边界

| 能力 | 当前口径 |
|------|------|
| 抖音评论 / 私信 | 3011 Runtime 真实读取、生成、发送、回读 |
| 视频号评论 / 私信 | 3011 Runtime 执行；登录态失效时必须返回 `needs_login` / 明确失败 |
| 账号状态 | 读 Postgres `publish_accounts` + Playwright MCP + 最近真实任务证据 |
| 执行证据 | `interaction_tasks`、`runtime_executions`、页面回读或失败原因 |
| 真实发布 | 未接入平台回执前返回 `not_integrated`，不能假成功 |
| 微信桌面 | 未接入 Agent-S/local-controller 前必须阻断 |

## 不变更项（命中即驳回 PR）

- 不改变 Agent-S 在桌面 GUI 互动中的主执行器地位
- 不改变默认 auto-send 行为
- 不让 local-engine 替代 Agent-S
- 不让前端绕过 3011 直发 Agent-S RPC
- 不做 S+ 投入（多 Agent / LLM Router / Computer Use 集成不在本期）
- 不恢复 `127.0.0.1:5409`、`AUTO_UPLOAD_ENGINE_URL`、旧 SQLite 账号/素材读取

## 相关 ADR

- `docs/adr/001-executor-router-capability-interface.md`
