# P8 Third-party CRM Sync Gate

- Generated: 2026-08-09T17:17:19.360Z
- Evidence root: docs/acceptance-evidence-2026-08-09
- Database: sqlite backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 6

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| PASS | 本地 CRM 写入回滚边界 | 本地导入和回滚均证明 externalCrmTouched=false；这只证明本地 CRM 闭环，不证明外部 CRM 生产同步。 | docs/acceptance-evidence-2026-08-09/p4-business-journey-2026-08-09T11-25-27-924Z/crm-phase1/report.json | 继续把本地写入和外部同步分开验收。 |
| PASS | 外部 CRM 连接合同边界 | P4 证明当前连接器为合同/干跑阶段：不收 token、不联网、不写外部系统，真实同步仍需 11G 后续验收。 | docs/acceptance-evidence-2026-08-09/p4-business-journey-2026-08-09T11-25-27-924Z/crm-phase1/report.json | 保持合同边界，后续生产同步必须另跑 P8。 |
| CONFIG_REQUIRED | 外部 CRM 授权保护 | 当前运行库没有 HubSpot/Salesforce 有效授权记录，不能做真实租户只读探针或同步。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 在专用 HubSpot/Salesforce 测试租户保存可撤销授权，确认密钥不回显、不落明文。 |
| CONFIG_REQUIRED | 外部 CRM 只读探针 | 当前运行库没有成功的外部 CRM 只读探针；不能确认授权、网络和字段读取可用。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 使用专用测试租户运行 HubSpot/Salesforce 只读探针，读取公司/联系人/商机样本并留存审计。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 生产写入确认 | 当前没有 externalCrmWrite=true 且带人工确认/11G 证据的外部 CRM 写入审计。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 在专用测试租户执行一次受控写入，必须包含人工确认、字段白名单、远端对象 ID 和 proofHash。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 写入后回读与字段白名单 | 外部写入=0，回读校验=0，字段白名单=0。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 写入后立刻从远端 CRM 回读同一对象，校验只写允许字段，禁止把本地通过当成外部同步通过。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 回滚与清理 | 当前没有外部 CRM 回滚、撤销或测试对象清理证据。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 对测试租户写入对象执行撤销或清理，确认远端已删除/归档并留下审计。 |
| REAL_ACCEPTANCE_REQUIRED | 外部 CRM 审计链完整性 | 外部写入/回读/回滚完整审计=0，带 proofHash=0。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 补齐外部写入、远端回读、回滚清理三段审计，并确保每段都有 proofHash 或等价不可抵赖证据。 |

## Decision

第三方 CRM 只能认定为本地边界和连接合同已确认，不能认定为生产同步可用。

