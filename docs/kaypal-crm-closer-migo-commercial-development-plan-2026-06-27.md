# Kaypal CRM + Closer + MIGO 商业化开发计划

版本：2026-06-27  
参考文档：`/Users/yanghy/Projects/kaypal-closer/extensions/kaypal-closer-mcp/docs/kaypal-closer-commercialization-dev-plan.html`  
当前定位：3010 系统已具备本地 CRM Lite、应用市场、entitlement、商用就绪检查、增长获客沉淀等底座，但仍应描述为“本地可交付试点 + 商业化 readiness/foundation”，不能描述为完整真实商用 SaaS 已上线。

## 1. 总目标

把 3010 系统做成三层产品闭环：

1. **Kaypal CRM Lite**：给没有 CRM 的客户使用，能管理公司、联系人、商机、任务、备注和时间线。
2. **Kaypal Closer**：AI 销售军师，基于 CRM 数据给出今日跟进对象、原因、话术、风险、日报和主管视图。
3. **MIGO Safe Import / Connector**：安全导入和外部 CRM 接入层，先 contract-only / dry-run-only，再逐步进入受控写入。

最终商业包装：

- **Kaypal Closer for Existing CRM**：客户已有 HubSpot / Salesforce / Twenty / 飞书 / Notion / Airtable 时，只读接入并生成行动建议。
- **Kaypal CRM + Closer**：客户没有 CRM 时，直接用 Kaypal CRM Lite，再由 Closer 生成销售行动建议。
- **Kaypal Enterprise**：私有化部署、多租户、权限、审计、自定义 connector、安全导入和 11G 生产写入 gate。

## 2. 工期判断

6 人并行开发，按真实商用节奏评估：

| 阶段 | 工期 | 可交付状态 | 说明 |
| --- | ---: | --- | --- |
| Phase 0：确认与基线 | 0.5-1 天 | 开发基线冻结 | 明确范围、分支、验收口径、测试数据和账号。 |
| Phase 1：商业 Demo | 7-10 个工作日 | 可给客户演示 | CRM Lite + Closer + MIGO proof + Connector Center。 |
| Phase 2：试点 MVP | 4-6 周 | 可交付试点客户 | 登录/权限、审批、审计、飞书/Notion 只读、usage tracking。 |
| Phase 3：付费 Beta | 8-12 周 | 可收费试运行 | Postgres 多租户、部署、备份、监控、license、支付、onboarding。 |
| Phase 4：GA | 3-6 个月 | 可宣称商用 SaaS | SLA、SSO、安全白皮书、标准销售和交付流程、11G gate。 |

如果只做“能演示、能本地试点”的 CRM 主线，第一阶段 2 周内可以完成；如果目标是“完整真实商用 SaaS 已上线”，至少按 8-12 周 Beta + 后续 GA 做，不能按几天吹。

## 3. 六人分工

我负责总架构、任务拆解、代码审查、验收闭环和风险裁决。6 个专家按下面并行推进。

| 角色 | 负责人类型 | 主责 | 第一阶段交付 |
| --- | --- | --- | --- |
| 专家 1：产品/销售流程架构 | Product Lead | CRM + Closer 信息架构、客户演示脚本、PoC 口径 | 页面流程、Demo 数据、销售证明包。 |
| 专家 2：CRM 后端/数据模型 | Backend CRM | CRM Lite 数据、时间线、去重、导入落库边界 | CRM API 补全、客户 360 数据聚合、自动获客到 CRM 映射。 |
| 专家 3：MIGO 安全导入 | Safety/MIGO | CSV/Excel preview、字段映射、PII、dry-run、proof、rollback plan | `/crm/import` 后端合同、质量报告、proof 文件。 |
| 专家 4：前端工作台 | Frontend | CRM、Closer、Import、Connector、Readiness 页面 | `/crm/closer`、`/crm/import`、`/crm/connectors` UI。 |
| 专家 5：SaaS/权限/运维 | Platform | tenant、entitlement、backup、monitor、payment、deployment gate | 商用 readiness 扩展、备份/监控/授权 gate。 |
| 专家 6：集成/QA/Windows 回归 | Integration QA | 外部 connector contract、Windows 安装包、验收证据 | connector contract tests、Windows evidence checklist。 |

## 4. Phase 1：商业 Demo 详细计划

目标：在 7-10 个工作日内，让 3010 能完整演示“客户数据进入 CRM → MIGO 安全检查 → Closer 生成行动建议 → Connector Center 展示已有 CRM 接入策略”。

### Day 1：基线与页面骨架

交付：
- 新增 `/crm/import`：导入向导骨架。
- 新增 `/crm/closer`：销售行动建议骨架。
- 新增 `/crm/connectors`：Connector Center 骨架。
- CRM 入口和应用市场安装后的导航串通。
- 固定 Demo 数据集和验收数据。

验收：
- 3010 页面能打开，不 404。
- 未安装 CRM 时正确引导去应用市场。
- 已安装 CRM 时能进入三个新页面。

### Day 2-3：MIGO Safe Import P0

交付：
- CSV 文本上传/粘贴解析。
- 字段识别：公司、联系人、电话、邮箱、微信、商机、备注。
- 字段映射建议。
- PII 标记：phone、email、wechat。
- 数据质量报告：空字段、重复、格式异常、可导入行数。
- dry-run proof：生成 proof id、row count、hash、mapping、warnings。
- 明确安全边界：不直接写正式 CRM 表。

验收：
- 上传样例 CSV 后能看到字段映射和质量报告。
- dry-run proof 可复制/导出。
- 没有人工确认和 11G gate 时不能写正式客户表。

### Day 4-5：Kaypal Closer P0

交付：
- 今日跟进列表：按客户状态、最近互动、任务、商机阶段排序。
- 每个客户显示：为什么跟、怎么跟、建议话术、风险点、下一步任务。
- 老客户/沉睡客户唤醒建议。
- 主管日报：新增线索、待跟进、风险商机、今日建议动作。
- 建议生成记录写入时间线或审计表。

验收：
- 基于 CRM Lite 数据能生成至少 5 条行动建议。
- 每条建议能追溯到客户、商机、任务或时间线。
- 页面明确标注“AI 建议，需人工判断”，不自动外发。

### Day 6-7：Connector Center / Readiness Hub

交付：
- Twenty / HubSpot / Salesforce / 飞书 connector contract 卡片。
- 每个 connector 展示：字段映射目标、安全边界、当前状态、future gate。
- CSV / Excel-like dry-run 卡片。
- Readiness Hub 汇总：contract-ready、dry-run-ready、writeTables=[]、requiredFutureGate=11G。
- 只做 contract-only，不收 token、不联网、不 OAuth、不 webhook。

验收：
- 可生成每类 connector contract。
- UI 明确展示 no-network / no-token / no-write。
- contract 进入审计记录或 proof 下载。

### Day 8-10：演示闭环与验收

交付：
- 一键加载 Demo 数据。
- “没有 CRM 的客户”演示路线：CRM Lite → Closer 建议 → 日报。
- “已有 CRM 的客户”演示路线：Connector Center → MIGO preview → Closer 建议。
- 商用 readiness 页面加入 CRM/Closer/MIGO 专项 gate。
- 生成验收文档和截图证据。

验收：
- 本地 3010 可完成完整演示。
- 后端单测、前端 build、接口 smoke 通过。
- 文档明确仍是 Demo/PoC，不宣称真实 SaaS GA。

## 5. Phase 2：试点 MVP

目标：4-6 周内让系统可给真实试点客户使用，但仍以受控、可审计、不自动写生产外部 CRM 为原则。

交付范围：
- workspace / tenant / role / permission 真正贯穿 CRM、Import、Closer、Connector。
- 导入审批页面：提交、审批、驳回、审计。
- CSV/Excel 真实文件上传，支持 xlsx parser。
- 飞书表格或 Notion 只读 connector 二选一先落地。
- Closer 建议支持团队维度、主管看板、日报导出。
- usage tracking：导入次数、建议生成次数、用户活跃、connector contract 次数。
- 基础计费数据：套餐、额度、超限提示。
- 试点客户 onboarding checklist。

验收：
- 一个真实试点客户能从数据导入到行动建议闭环跑通。
- 所有导入都有 proof 和 audit。
- 外部 connector 默认只读。
- 任意写入动作必须经过审批和 gate。

## 6. Phase 3：付费 Beta

目标：8-12 周内具备可收费试运行能力。

交付范围：
- Postgres 多租户数据层。
- Redis / queue / scheduled jobs。
- Object Storage 存 proof、导入文件、备份 manifest。
- SaaS 部署与 Docker Compose 私有化部署两条线。
- 备份、恢复演练、监控、告警。
- Stripe/Kaypal billing webhook、license、plan limits。
- HubSpot / Salesforce 只读 connector sandbox。
- Windows 安装包回归：登录、扫码绑定、微信通讯录、自动获客、CRM/Closer 页面。
- 客户成功流程：开通、导入、培训、回滚、问题响应。

验收：
- 试点客户可付费开通。
- 账单/授权/额度可追踪。
- 关键任务失败有告警。
- 数据可备份、可恢复。
- Windows 安装包有真机证据。

## 7. Phase 4：GA

目标：3-6 个月达到可以对外宣称完整商用 SaaS。

交付范围：
- SSO / 企业权限 / 审计合规模块。
- 安全白皮书、SLA、状态页、价格页。
- 标准 PoC 包、标准销售演示、标准交付 SOP。
- 11G Production Promotion Write：正式写入 gate。
- 生产 connector 的 canary、rollback、kill switch、post-write verification。
- 客户数据隔离审计与渗透测试。

验收：
- 有真实付费客户。
- 有生产部署和备份恢复记录。
- 有外部 CRM connector 的安全审计证据。
- 有故障处理和 SLA 记录。

## 8. 第一阶段验收清单

Phase 1 完成时，必须具备：

- `/crm`：联系人、公司、商机、任务、备注、时间线可用。
- `/crm/import`：CSV preview、字段映射、PII、质量报告、dry-run proof。
- `/crm/closer`：今日跟进建议、客户理由、话术、风险、日报。
- `/crm/connectors`：Twenty/HubSpot/Salesforce/飞书 contract-only 展示。
- `/commercial-readiness`：新增 CRM/Closer/MIGO gate。
- 后端测试通过。
- 前端 build 通过。
- 本地 3010 演示通过。
- 文档和截图证据齐全。

不能通过的情况：

- 导入直接写正式客户表。
- connector 要求真实 token 才能展示。
- Closer 建议没有数据来源说明。
- 没有 proof/audit，却宣称 MIGO 闭环。
- 只做页面，不做 API 和验收证据。

## 9. 用户需要配合

为了真正闭环，需要你配合这些外部资源：

1. 提供 1-2 份脱敏客户 CSV/Excel 样例，包含公司、联系人、电话、微信、商机、备注。
2. 明确第一批演示行业：装修获客、企业 AI、还是通用 B2B 销售。
3. 提供一套客户演示话术偏好：激进销售、专业顾问、还是温和提醒。
4. 如果要做飞书/Notion 真实只读 connector，提供测试 workspace 和测试 token。
5. 如果要走付费 Beta，提供 Stripe/Kaypal 计费配置。
6. Windows 安装包回归仍需要真机截图和操作证据。

## 10. 下一刀建议

下一刀不要再扩自动获客，先把 CRM 主线做透：

1. 建 `/crm/import` 页面和后端 proof contract。
2. 建 `/crm/closer` 页面和建议生成 API。
3. 建 `/crm/connectors` 页面，先做 contract-only。
4. 把这三项接入 `/commercial-readiness`。
5. 跑一次本地 3010 验收，生成 evidence 文档。

这条路径最贴合 Kaypal Closer 商业化文档，也最容易从当前 3010 基础设施接上去。
