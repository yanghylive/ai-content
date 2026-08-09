# RedFox 情报接入增长与 CRM 第一批落点

更新时间：2026-06-29

## 范围

本批只定义增长获客侧的最小接入合同，不改 `redfox` / `intelligence` 模块，不改 Prisma schema，不改 frontend sidebar。

已落后端入口：

- `POST /growth/intelligence/redfox/benchmark-accounts/preview`
- `POST /growth/intelligence/redfox/leads/confirm`

## 增长闭环

```text
RedFox 对标账号/相似账号/黑马账号情报
  -> Growth preview 标准化
  -> 对标账号池草稿
  -> 获客策略草稿
  -> 线索确认草稿
  -> 人工确认
  -> Growth 线索池
  -> 后续按现有线索跟进、CRM 转客户/机会
```

## 人工确认边界

必须人工确认：

- 对标账号加入账号池。
- 情报生成增长策略并保存。
- 情报转线索入池。
- 启用真实获客任务或后台计划。
- 评论、私信、加微、群发等任何外联动作。

默认不自动执行：

- RedFox 情报不会直接创建真实外联任务。
- 对标账号不会直接变成客户线索，除非情报中出现明确需求、咨询、联系方式或购买意图。
- CRM 客户/机会不由 RedFox 情报直接写入；先进入 Growth 线索池，再走现有确认和转化动作。

## 证据链

每条情报草稿保留：

- `source`：`redfox` / `kaypal` / `manual`。
- `sourceId`：RedFox 请求、Skill 或结果 ID。
- `sourceUrl` / `evidenceUrl`：原始来源和审计证据。
- `rawHash`：原始批次摘要 hash。
- `collectedAt`：采集或导入时间。
- `note`：证据说明。

人工确认入线索池后，证据链接写入 `GrowthLead.evidenceUrls`，证据摘要写入 `GrowthLead.notes`。

## 未完成风险

- 对标账号池当前是预览草稿，尚未新增持久化表；稳定版需要 `BenchmarkAccount` 表或复用未来 intelligence 标准表。
- CRM 只定义后续承接路径，尚未新增 RedFox 线索一键转 CRM 客户/机会的专门接口。
- 前端页面和 API client 尚未接入这两个入口，需要后续在增长页面或数据情报页面加确认 UI。
- 真实 RedFox Client、成本、权限和租户级调用日志由 RedFox/intelligence 模块负责，本批只消费标准化后的输入合同。
