# Agent Gateway 生产运维 Runbook（P1-4）

> 值班人员可在无开发介入下完成以下演练。所有操作均有 env 开关可回滚。

## 1. Octop

| 场景 | 检查 | 处理 |
|---|---|---|
| Octop 不可达 | `curl 127.0.0.1:8088/api/health` 非 200 | 引擎自动降级为 3010 原生工具（OCTOP_DEGRADED），无需人工介入 |
| 能力降级 | `GET /api/agent/octop/capabilities` degraded=true | 检查 `~/.octop/config.json` capabilities.* 探测值；重启 Octop（launchd：`kill <pid>` 自动重拉） |
| 凭据失效 | 登录返回 401 | 检查 `OCTOP_USERNAME/OCTOP_PASSWORD`（backend .env）；`octop user passwd` 重置桥账号 |
| 回滚 | — | 设 `OCTOP_ENABLED=false` 回退 Mock（不影响主链路） |

## 2. Memory Outbox

| 场景 | 检查 | 处理 |
|---|---|---|
| outbox 堆积 | `agent_gateway_memory_outbox` 表 pending 增多 | worker 每 2s 自动重试（指数退避）；远程恢复后自动 flush |
| 死信 | 表 status=dead | 人工重放：确认远程可用后触发 `replayDeadLetters()`（原型/引擎方法）或清表重写入 |
| 删除后重建 | 已删除内容重现 | 检查删除时 outbox 是否作废（`voidPendingOutboxForItem`）；升级修复即可 |
| 重启续跑 | — | `onModuleInit` 自动恢复 pending 并续跑，无需人工 |

## 3. 设备 / 租约

| 场景 | 检查 | 处理 |
|---|---|---|
| 设备离线 | `agent_gateway_device_leases` status | 心跳超时 → 租约过期；任务走 DEVICE_OFFLINE 重试 |
| 同设备多租约 | 唯一索引 `uq_device_lease_active` | 违反则清理旧 active 租约（partial index 兜底） |

## 4. WebSocket

| 场景 | 检查 | 处理 |
|---|---|---|
| 断线重连 | lastEventId 重放 | 窗口内自动补发；超窗返回 RESUME_WINDOW_EXPIRED，前端改拉快照 |
| 鉴权失败 | WS 收 UNAUTHORIZED/FORBIDDEN | 检查 token（Sec-WebSocket-Protocol `kaypal-auth.*`）与会话所有权 |
| 事件丢失 | `agent_gateway_events` 缺行 | 检查 `PrismaMirror` 落库（fire-and-forget，失败静默）；必要时补跑镜像 |

## 5. Usage / 账务对账

```sql
-- 重复 usageId（不应存在）
SELECT usage_id, count(*) FROM agent_gateway_usage_events GROUP BY usage_id HAVING count(*)>1;
-- 与 Kaypal 回执对账（草案，回执表落地后启用）
SELECT u.usage_id FROM agent_gateway_usage_events u
LEFT JOIN kaypal_receipts r ON r.usage_id = u.usage_id
WHERE u.status='ok' AND r.usage_id IS NULL;
```
| 场景 | 处理 |
|---|---|
| usageId 冲突 | 数据库唯一约束兜底（P2002），重试改新 key |
| 失败 usage | status=failed 不计费、cost=0，人工复核 |

## 6. 回滚

| 层 | 回滚动作 |
|---|---|
| 引擎持久化 | `AGENT_GATEWAY_PERSISTENCE` 置空 → 回内存态（写镜像停） |
| 真实业务 | `AGENT_GATEWAY_REAL_BUSINESS` 置空 → 回 Mock |
| Octop | `OCTOP_ENABLED=false` → 回 Mock |
| 数据库 | 单迁移回滚：`prisma migrate resolve --rolled-back <migration>`；表级：备份恢复（`pg_dump` 前先备份，见迁移计划） |
