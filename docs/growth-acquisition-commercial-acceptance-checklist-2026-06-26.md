# 增长获客 7 页商用验收脚本与检查清单

来源文档：`docs/growth-acquisition-commercial-ux-optimization-plan-2026-06-26.md`

本清单服务于商用验证专家角色，只验收增长获客 7 页，不改业务逻辑，不替 CRM 做验收。

## 自动化脚本

脚本：`scripts/growth-acquisition-acceptance.mjs`

用途：

- 按 7 个路由逐页检查关键文案、表格外壳、交互控件数量、body 级横向溢出、按钮文字换行、潜在无标签输入、浏览器控制台错误。
- 默认覆盖 `1440x1000`、`1365x900`、`768x1024` 三个视口。
- 截图与报告写入 `docs/acceptance-evidence-YYYY-MM-DD/growth-acquisition-commercial-*/`。
- 支持只打印清单，不启动浏览器。

常用命令：

```bash
GROWTH_ACCEPTANCE_LIST_ONLY=1 node scripts/growth-acquisition-acceptance.mjs
```

```bash
FRONTEND_URL=http://localhost:3010 API_BASE=http://localhost:3011/api GROWTH_ACCEPTANCE_LOCAL_LOGIN=1 node scripts/growth-acquisition-acceptance.mjs
```

```bash
FRONTEND_URL=http://localhost:3010 GROWTH_ACCEPTANCE_SESSION_TOKEN=... node scripts/growth-acquisition-acceptance.mjs
```

环境变量：

| 变量 | 说明 |
| --- | --- |
| `FRONTEND_URL` | 前端地址，默认 `http://localhost:3010` |
| `API_BASE` | API 地址，默认 `http://localhost:3011/api` |
| `GROWTH_ACCEPTANCE_VIEWPORTS` | 视口列表，如 `1440x1000:desktop,768x1024:narrow` |
| `GROWTH_ACCEPTANCE_EVIDENCE_DIR` | 自定义证据输出目录 |
| `GROWTH_ACCEPTANCE_LOCAL_LOGIN` | 设为 `1` 时，从本地 SQLite 活跃用户创建临时验收 session |
| `GROWTH_ACCEPTANCE_SESSION_TOKEN` | 直接注入 `ai_content_session` cookie |
| `GROWTH_ACCEPTANCE_COOKIE_HEADER` | 注入完整 Cookie header |
| `GROWTH_ACCEPTANCE_COOKIE_FILE` | 读取 Netscape cookie 文件 |
| `GROWTH_ACCEPTANCE_HEADLESS` | 设为 `0` 时打开有头浏览器 |

## 页面矩阵

| 页面 | 路由 | 自动化必看文案 | 自动化表格检查 | 手工重点 |
| --- | --- | --- | --- | --- |
| 获客总览 | `/growth` | 增长获客总览、执行记录、线索池 | 执行记录 | KPI 语义、就绪状态条、最新线索入口、空状态 CTA |
| 自动获客矩阵 | `/growth/acquisition` | 自动获客矩阵、创建获客任务、执行计划队列、安全确认 | 执行计划队列、获客任务 | 表单分组、真实执行/演练/草稿、账号不可用入口、到期预检原因 |
| 获客策略 | `/growth/strategies` | 获客策略中心、行业、场景、搜索策略、健康度 | 无强制表格 | 搜索、版本/复核、套用确认、删除确认 |
| 线索池 | `/growth/leads` | 线索池、手动补充线索、搜索线索、加入线索池 | 线索池 | 表格不被表单挤压、批量确认、详情分区、去重证据 |
| 账号健康 | `/growth/account-health` | 账号健康中心、账号风控台、在线正常、需人工处理 | 账号健康 | 状态汇总、风险排序、冷却/解除、修复入口 |
| 增长复盘 | `/growth/reports` | 增长复盘、增长趋势、增长瓶颈诊断、任务表现 | 任务表现、账号表现、话术表现、执行记录 | 漏斗/趋势解释、瓶颈动作、导出范围、跨页定位 |
| 增长工作流 | `/growth/workflows` | 增长工作流、创建商用增长 SOP、工作流名称、模板 | 无强制表格 | 模板选中态、步骤状态、备注保存、完成/回退闭环 |

## 通用验收

- [ ] 7 个页面在 `1440x1000`、`1365x900`、`768x1024` 均无 body 级横向溢出。
- [ ] 所有输入框、下拉框、日期框、搜索框高度和边框语义一致，文字垂直居中。
- [ ] 所有按钮文字一行显示，窄屏不换成两行。
- [ ] 页面主操作与当前页面相关，不复用无关顶部按钮。
- [ ] 每页能说明当前是否可真实执行、为什么不能执行、下一步做什么。
- [ ] 空状态至少有一个可执行 CTA，不只显示“暂无数据”。
- [ ] 表格支持搜索、筛选、排序语义、批量操作或局部横向滚动承载真实数据规模。
- [ ] 危险操作有确认；批量操作说明影响范围。
- [ ] 执行失败、风控阻断、账号不可用有原因、证据和下一步。
- [ ] 控制台无非预期 error；页面无白屏、无登录循环、无 hydration 异常。

## 状态覆盖

每页至少记录以下 5 类证据：

| 状态 | 验收要求 | 证据 |
| --- | --- | --- |
| 桌面有数据 | 核心区块、表格、操作按钮完整可见 | 截图、URL、可见文案 |
| 窄屏有数据 | 无横向炸版，主操作不换行 | 截图、溢出检查结果 |
| 空数据 | 有下一步 CTA，说明原因 | 截图、CTA 文案 |
| 失败态 | 展示原因、证据、下一步 | 错误文案、控制台记录 |
| 禁用/只读 | 状态可区分，禁用原因清楚 | 控件截图、说明文案 |

## 操作流清单

- [ ] 创建获客任务：必填校验、账号选择、风控模式、计划时间、创建后进入预检或配置表。
- [ ] 打开到期任务预检：展示 checks、warnings、blockers、剩余额度、计划状态。
- [ ] 生成策略：复核后生成，能看到评分、风险项、建议。
- [ ] 套用策略：说明会创建或覆盖的获客任务，需确认。
- [ ] 删除策略：需确认，不误删。
- [ ] 添加线索：能写入线索池，状态和来源清楚。
- [ ] 批量改线索状态：说明选中数量、目标状态、影响范围。
- [ ] 查看线索详情：基本信息、跟进、去重、证据分区清楚。
- [ ] 账号冷却/解除：冷却时长、风险状态、检测时间和建议明确。
- [ ] 导出报表：说明 CSV/快照包含的范围。
- [ ] 创建工作流：模板选中态明确，步骤可备注、保存、完成、回退。

## 结果记录模板

| 日期 | 命令 | 结果 | 失败点 | 证据目录 |
| --- | --- | --- | --- | --- |
| 2026-06-26 | `node --check scripts/growth-acquisition-acceptance.mjs` | 通过 | 无 | 无 |
| 2026-06-26 | `GROWTH_ACCEPTANCE_LIST_ONLY=1 node scripts/growth-acquisition-acceptance.mjs` | 通过 | 成功输出 7 页矩阵 | 无 |
| 2026-06-26 | `GROWTH_ACCEPTANCE_LOCAL_LOGIN=1 GROWTH_ACCEPTANCE_TIMEOUT_MS=12000 GROWTH_ACCEPTANCE_ROUTE_STABILITY_MS=400 node scripts/growth-acquisition-acceptance.mjs` | 阻断 | 脚本创建了 SQLite 临时 session，但当前 3011 后端未接受该 cookie，21 个页面视口组合均跳转 `/login?next=...`；推断当前后端连接的不是该 SQLite 数据库或需要真实 Kaypal cookie | `docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-053041/` |
| 2026-06-26 | `npx tsc --noEmit`（frontend） | 失败 | `frontend/src/components/growth/growth-console.tsx` 缺少 `manual-import` 模式配置；两处 `Button onPress` 把 `PressEvent` 传给 `(templateKey?: string) => Promise<void>` | 无 |
| 2026-06-26 | `npm run lint`（frontend） | 通过，有 warning | 8 个 warning：`crm/page.tsx` 1 个 hook 依赖；`growth-console.tsx` 7 个未使用导入/函数/变量 | 无 |
