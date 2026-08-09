# G5 S3 三态运行证据 - 2026-07-26

- 日期：2026-07-26（America/Los_Angeles）
- active work：`CW-G5-S3-ROLLOUT-OBSERVATION`
- requirement：`UX-15`，仍为 `in_progress`
- 决策：`CW-D010`、`CW-D011`
- 环境：3010 前端、3011 SQLite 后端、Astryx CLI 0.1.7
- QA 范围：隔离本地 QA 账号，未使用客户、品牌、素材或发布数据

## 验收前置

- 三份产品基准 HTML 的 SHA-256 与 `contract.json` 基线一致，未发现原型、功能页或开发计划漂移。
- `content-workspace:guard:test`：85/85 通过。
- `frontend/scripts/content-workspace-rollout-report.test.mjs`：4/4 通过；合并执行的 rollout/report 测试：10/10 通过。
- Astryx Doctor：7 pass、0 warn、0 fail、1 info。
- Astryx migration guard：通过。
- `git diff --check`：通过。

## State A：关闭

启动配置：

```text
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=false
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=0
```

实测结果：

- `/` 没有“直接开始内容工作”结果入口。
- `/content/workspace?intent=create` 没有“写一篇内容”表单，回到旧版“内容工作室”。
- 旧内容队列、编辑区和上下文栏仍可见。

截图：`g5-s3-closed-state-1366x900.png`

## State B：10% 灰度

启动配置：

```text
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=true
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=10
```

隔离 QA 用户的稳定桶为 6，因此满足 `rolloutPercent > bucket` 的 10% 条件。该用户标识和桶值只用于本次本地验证，未写入事件或草稿请求；验证完成后已删除账号、会话和草稿。

实测结果：

- `/` 显示四个结果入口：写一篇内容、改写已有内容、生成多平台版本、准备发布。
- `/content/workspace?intent=create` 显示“写一篇内容”表单、内容目标和首发平台字段。
- 提交一次隔离 QA 草稿后，页面进入 `/content/workspace?...&step=brief`，旧工作台编辑器、队列、保存和五步流程保持可用。

截图：

- `g5-s3-10pct-state-1366x900.png`
- `g5-s3-10pct-intent-form-1366x900.png`

报告工具验证：

```bash
node frontend/scripts/content-workspace-rollout-report.mjs \
  --input /path/to/anonymized-events.json --json --strict
```

工具只接受五类冻结事件，并拒绝用户、租户、品牌、目标文本、文章、素材和引用字段。浏览器事件缓冲未在本次自动化中读取或导出；因此这里证明的是报表和脱敏合同可用，不把一次本地烟测计为正式 telemetry 或 48 小时统计。

## State C：回滚

回滚通过恢复默认关闭构建执行：

```text
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=false
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=0
```

实测结果：

- `/` 恢复旧版“今日工作台”，四个结果入口消失。
- `/content/workspace?intent=create` 恢复旧版“内容工作室”，没有意图表单。
- 当前 3010 已恢复由默认关闭的 `frontend-guard.sh` 启动。

截图：`g5-s3-rollback-state-1366x900.png`

## 清理与观察窗口

- QA 用户：0
- QA 会话：0
- QA 草稿：0
- P0/P1：本次本地烟测 0；这不等同于 48 小时线上观察结论

| 字段 | 状态 |
| --- | --- |
| 真实观察开始 | pending |
| 真实观察结束（不少于 48 小时） | pending |
| 正式构建/版本 | pending |
| 10% 结果入口查看数 | pending |
| 意图提交数 | pending |
| 草稿成功数 | pending |
| 草稿失败数 | pending |
| P0/P1 数 | pending |

在真实窗口结束、正式指标面板可读且回滚证据被发布负责人复核前，`UX-15` 不得标记为 accepted，也不得切换默认入口。

