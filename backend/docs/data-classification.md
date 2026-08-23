# 数据分类与留存（P1-5）

> 对齐《开发前补充文档包》4.3（业务删除 ≠ 审计删除）与《剩余缺口与冻结清单》P1-5。

## 1. 敏感等级

| 等级 | 数据 | 示例 | 存储位置 |
|---|---|---|---|
| **L4 极高** | 登录凭据、访问令牌、密码 | Kaypal access_token、Octop token、`x-kaypal-api-key` | 仅 env（gitignore），不落业务表 |
| **L3 高** | 手机号、Cookie、私信正文、平台账号 | `crm.phone`、Cookie 快照、`evidence` 截图 | 业务表加密/脱敏列；证据表只追加 |
| **L2 中** | 线索、记忆、对话内容 | `lead`、`memory_outbox.content`、agent 事件 payload | agent_gateway_* 表；事件 payload 为 JSON |
| **L1 低** | 审计元数据、用量、操作日志 | usage_event、tool_call.inputHash（非原文） | agent_gateway_* 表 |

## 2. 留存期限（建议）

| 数据 | 期限 | 动作 |
|---|---|---|
| 会话（agent_gateway_sessions） | 30 天 | 过期（expiresAt）后不恢复；定期清理 |
| 任务/审批/工具调用 | 90 天 | 只追加；终态任务按策略归档 |
| 证据（agent_gateway_evidence） | 法务留存期（≥ 180 天） | **只追加、不物理删除**；`redaction_version` 递增脱敏 |
| usage / 账务 | 对账完成 + 12 个月 | 保留（计费审计）；与 Kaypal 账单对账后归档 |
| 记忆（outbox/远程） | 用户删除即时生效 | 删除作废 pending outbox（防重建） |
| 审计日志 | 法务留存期 | 只追加 |

## 3. 删除规则

| 操作 | 规则 |
|---|---|
| 用户删除记忆 | 本地+远程同 itemId 对账删除；pending outbox 作废；`deleted` 准确标志（本地或远程任一实际删除即 true） |
| 业务数据删除 | 标记删除，不物理清证据/审计（4.3 不变量） |
| 证据脱敏 | `redaction_version` 递增，保留审计引用 |
| 租户/用户删除 | 不级联删审计；证据保留 + 脱敏 |

## 4. 权限审计

- 所有 agent_gateway_* 读写经 `assertOwnership`（tenant+user+agent 三项校验）——多租户越权防护已由安全加固测试锁定。
- 凭据（L4）不落库；token 只走 env 与内存。
