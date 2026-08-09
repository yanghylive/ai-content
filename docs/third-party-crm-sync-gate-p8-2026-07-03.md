# P8 第三方 CRM 生产同步门禁

日期：2026-07-03

## 结论

第三方 CRM 当前不能认定为生产同步可用。

已确认的部分是：本地 CRM 导入和回滚边界成立，外部 CRM 连接器仍处在合同/干跑阶段，没有保存明文授权、没有联网写入、没有触碰外部 CRM。

尚未完成的商用条件是：真实测试租户授权、只读探针、受控写入、写入后远端回读、字段白名单、外部回滚清理和完整审计链。

## 可重复检查命令

```bash
node scripts/p8-third-party-crm-sync-gate.mjs
```

严格发布门禁模式：

```bash
node scripts/p8-third-party-crm-sync-gate.mjs --strict
```

`--strict` 会在第三方 CRM 生产同步证据不足时返回非 0，用于发布前阻断。

## 当前最新证据

- P8 报告：`docs/acceptance-evidence-2026-07-03/p8-third-party-crm-sync-gate-2026-07-03T13-09-14-746Z/report.md`
- P5 总门禁：`docs/acceptance-evidence-2026-07-03/p5-production-readiness-gate-2026-07-03T13-10-00-692Z/report.md`
- P4 CRM 本地闭环：`docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-49-04-879Z/crm-phase1/report.md`
- 当前运行库：`backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite`

## 商用验收口径

| 状态 | 验收项 | 当前判断 | 下一步 |
| --- | --- | --- | --- |
| PASS | 本地 CRM 写入回滚边界 | 本地导入和回滚均证明没有触碰外部 CRM。 | 继续把本地写入与外部同步分开验收。 |
| PASS | 外部 CRM 连接合同边界 | 当前连接器只证明字段合同和干跑边界，不收授权、不联网、不写外部系统。 | 保持该边界，真实同步单独验收。 |
| CONFIG_REQUIRED | 外部 CRM 授权保护 | 当前运行库没有 HubSpot/Salesforce 有效授权记录。 | 在专用测试租户保存可撤销授权，确认密钥不回显、不落明文。 |
| CONFIG_REQUIRED | 外部 CRM 只读探针 | 当前没有成功的外部 CRM 只读探针。 | 读取测试租户里的公司、联系人、商机样本并留存审计。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 生产写入确认 | 当前没有带人工确认的外部 CRM 写入证据。 | 对测试租户执行一次受控写入，保留远端对象 ID 和 proofHash。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 写入后回读与字段白名单 | 当前外部写入、回读校验、字段白名单均为 0。 | 写入后从远端 CRM 回读同一对象，确认只写允许字段。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 回滚与清理 | 当前没有外部 CRM 回滚、撤销或测试对象清理证据。 | 对测试对象执行撤销或清理，确认远端已删除/归档。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 审计链完整性 | 当前外部写入、回读、回滚三段审计链不存在。 | 补齐三段审计，并确保每段都有 proofHash 或等价证据。 |

## 发布判定

第三方 CRM 目前只能用于本地 CRM 闭环和连接方案展示，不能在正式生产发布中宣称已经完成 HubSpot/Salesforce 生产同步。

只有当 P8 全部转为 `PASS`，P5 总门禁里的“第三方 CRM 生产同步”才可以解除阻断。
