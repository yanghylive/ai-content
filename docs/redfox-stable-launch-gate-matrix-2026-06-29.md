# RedFox 稳定上线 Gate 1-10 测试与安全验收矩阵

更新时间：2026-06-29

角色：测试与安全专家

来源：

- `docs/redfox-skills-integration-stable-launch-plan-2026-06-29.md`
- `docs/growth-acquisition-commercial-acceptance-checklist-2026-06-26.md`
- `docs/liandao-wechat-acceptance-matrix.md`
- `docs/windows-installer-preflight-execution-checklist-2026-06-03.md`
- `backend/.env.example`
- `backend/package.json`、`frontend/package.json`、`desktop/package.json`

## 1. 完成定义

RedFox 稳定上线版只有同时满足以下条件，才能进入正式发布口：

- Gate 1-10 全部为 `PASS`，没有 `P0/P1` 阻断项。
- API Key 脱敏、租户隔离、调用限额、失败降级、证据链五条安全主线均有自动化或人工证据。
- 端到端链路可复跑：连接配置 -> Skill 同步 -> 拉取情报 -> 导入素材 -> 生成选题 -> 创作优化 -> 合规审核 -> 写入证据。
- RedFox 不可用、超时、超限、Key 失效时，已有内容生产、发布草稿、客户互动页面不白屏、不误判成功。
- 所有真实外部调用、导入、生成、合规、评论洞察结果都有 `tenantId`、`userId`、`requestHash`、`sourceUrl/externalId`、`callLogId` 或等价证据索引。
- 不把“任务已创建”“接口返回 200”“页面有按钮”单独算作通过；必须有结果、状态、失败原因或证据文件。

## 2. 验收分层

| 层级 | 用途 | 运行时机 | 通过口径 |
| --- | --- | --- | --- |
| Static contract | 检查文档、配置样例、脚本入口、路由/接口合同是否齐全 | 每个 PR | 缺合同即失败，不访问 RedFox |
| Unit test | RedFox Client、脱敏、限额、错误映射、normalizer、import 去重 | 后端模块落地后 | 关键分支覆盖成功和失败 |
| API smoke | 只读 GET 和受控 POST，验证 3011 API 状态 | 集成环境 | 401/403/404 要有明确 blocker，不算静默通过 |
| Browser acceptance | 3010 页面在桌面/窄屏可用，交互和错误态可见 | 页面落地后 | 页面无白屏、无控制台非预期 error、无 body 横向溢出 |
| Live controlled | 使用测试 RedFox Key 和测试租户跑最小真实链路 | Release candidate | 有调用日志、成本记录、证据包 |
| Manual signoff | 非工程用户照手册完成核心流程 | 第 10 周 | 用户能独立完成并导出验收报告 |

## 3. 状态和证据规则

| 状态 | 含义 | 是否允许上线 |
| --- | --- | --- |
| `PASS` | 自动或人工证据满足通过标准 | 是 |
| `WARN` | 非阻断风险，有 owner、规避方案、复测日期 | 允许带 P2，不允许带 P0/P1 |
| `BLOCKED` | 环境、账号、权限、真实 RedFox Key 或页面未准备好 | 否 |
| `FAILED` | 功能或安全断言失败 | 否 |
| `SKIPPED` | 本轮范围外，且计划文档明确暂不做 | 需写清原因 |

每个 Gate 的证据目录建议为：

```text
docs/acceptance-evidence-YYYY-MM-DD/redfox-stable-launch-gate-<run-id>/
  summary.json
  report.md
  gate-01-connection.json
  gate-02-skills.json
  ...
  screenshots/
```

证据必须脱敏：

- 不保存完整 `REDFOX_API_KEY`、Cookie、Authorization、RedFox 原始账号隐私字段。
- API Key 只允许展示前 4 位和后 4 位，例如 `rf_live_1234...abcd`。
- 请求体中涉及手机号、微信号、私信内容、评论用户标识时，报告只保存 hash、摘要或测试账号标识。

## 4. Gate 1 - RedFox 连接

目标：配置、测试、失败提示、脱敏展示均正常，且前端不直连 RedFox。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G1.1 | 环境变量合同 | Static | `REDFOX_API_BASE_URL`、`REDFOX_API_KEY`、`REDFOX_TIMEOUT_MS`、用户/租户日限额、缓存 TTL 有样例或部署清单 | 配置清单截图/文本 | P1 |
| G1.2 | API Key 保存 | API + Browser | 保存 Key 后前端只显示脱敏值，后端不返回明文 | `/api/redfox/connection` 响应、页面截图 | P0 |
| G1.3 | API Key 加密存储 | Unit + DB inspect | 数据库不出现明文 Key，字段命名为 encrypted/secret reference；日志无明文 | 单测、DB 抽样、日志 grep | P0 |
| G1.4 | 连接测试成功 | Controlled POST | 测试 Key 可连 RedFox，记录 `lastTestAt/status/latencyMs` | `gate-01-connection.json` | P0 |
| G1.5 | 连接测试失败 | API mock/live bad key | Key 错误、超时、DNS 失败都有用户可读原因，不抛 500 明文堆栈 | 失败响应、页面错误态 | P0 |
| G1.6 | 后端代理约束 | Static + Browser network | 前端没有直接请求 `redfox.hk`；所有调用走 `http://127.0.0.1:3011/api` | network log、源码 grep | P0 |
| G1.7 | 无 Key 页面状态 | Browser | RedFox 相关页面显示配置引导，不能白屏或展示假数据 | 页面截图 | P1 |
| G1.8 | 连接证据链 | API | 每次测试连接生成调用日志或连接测试事件，包含 tenant/user/status/errorCode | call log export | P0 |

安全断言：

- API Key 明文不得进入前端状态、localStorage、console、错误 toast、调用日志。
- 测试连接只能验证当前租户自己的 Key，不能读取或复用其他租户 Key。

## 5. Gate 2 - Skill 同步

目标：Skill 列表可同步、搜索、分类、启停，并保留 raw 以应对 RedFox 字段变化。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G2.1 | Skill 同步入口 | API | `POST /api/redfox/skills/sync` 需要鉴权和租户上下文 | API smoke | P0 |
| G2.2 | 目录字段标准化 | Unit | `skillNo/code/name/platform/tags/summary/raw/syncedAt` 可从 RedFox 响应映射 | normalizer 单测 | P0 |
| G2.3 | 字段变化兼容 | Unit mock | RedFox 增减字段时不崩溃，未知字段进入 `raw` | 单测 | P1 |
| G2.4 | 搜索和筛选 | API + Browser | 可按平台、标签、场景、关键词筛选；空结果有说明 | API 响应、截图 | P1 |
| G2.5 | 启停 Skill | API + Browser | 启用/停用只影响当前租户；状态刷新后保持 | 前后状态 JSON | P0 |
| G2.6 | 同步限额 | API mock | 高频同步触发限流或缓存提示，不无限调用 RedFox | limit evidence | P0 |
| G2.7 | 同步失败降级 | API mock | RedFox 失败时保留上次成功目录，标注 `stale` 和失败原因 | API 响应、页面截图 | P0 |
| G2.8 | Skill 可见范围 | RBAC | 普通用户不能启用管理员限定 Skill；跨租户不可见 | 403 响应、租户 A/B 数据 | P0 |

安全断言：

- Skill 原始能力不能全部无差别暴露给用户，只能展示稳定上线范围内的业务场景绑定。
- coming soon 或未验证平台能力必须显示不可用状态，不能伪装为可执行。

## 6. Gate 3 - 情报导入

目标：热点、搜索、爆款、账号结果可标准化入库，支持去重和来源追溯。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G3.1 | 热点拉取 | API live/mock | 全网热点返回 `IntelligenceItem[]`，含平台、类型、标题、来源、热度 | `gate-03-trends.json` | P0 |
| G3.2 | 平台搜索 | API live/mock | 抖音、小红书、公众号至少一种测试数据可标准化；未接平台明确 blocked | search evidence | P0 |
| G3.3 | 爆款样本 | API live/mock | 标题、正文摘要、账号、互动指标、原链接可见 | viral evidence | P1 |
| G3.4 | 对标账号 | API live/mock | 昵称、平台、主页、指标、推荐原因可入 `BenchmarkAccount` | accounts evidence | P1 |
| G3.5 | 去重 | Unit + API | 同一 `sourceUrl/externalId/requestHash` 重复导入不会生成重复素材/情报 | 单测、重复导入响应 | P0 |
| G3.6 | 原始数据保留 | DB inspect | `raw` 可追溯 RedFox 响应，敏感字段脱敏或 hash | DB 抽样 | P1 |
| G3.7 | 导入失败 | API mock | 单条失败不拖垮批量导入，返回成功/失败明细 | failure report | P0 |
| G3.8 | 租户隔离 | API | 租户 A 导入结果，租户 B 查询不到 | A/B 查询证据 | P0 |

安全断言：

- 情报导入不能自动创建高意向线索、自动私信或自动评论任务。
- 任何外部用户标识进入系统前必须标注来源和采集目的，报告里只保留必要字段。

## 7. Gate 4 - 内容联动

目标：情报可导入素材、生成选题、进入创作优化，原文不被覆盖。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G4.1 | 导入内容素材 | API + Browser | 选中情报后生成素材记录，来源为 RedFox，含 `intelligenceItemId` | material JSON | P0 |
| G4.2 | 生成选题 | API + Browser | 选题草稿含来源情报、推荐角度、目标平台 | topic JSON | P0 |
| G4.3 | 创作优化入口 | Browser | 素材/选题/文章/小红书笔记能进入创作优化，不丢上下文 | 截图、URL | P1 |
| G4.4 | 标题评分 | API mock/live | 返回分数、理由、改进建议，写入调用日志 | optimization evidence | P1 |
| G4.5 | 文案改写 | API mock/live | 生成新版本，不覆盖原文；高风险建议不自动发布 | before/after JSON | P0 |
| G4.6 | 爆款拆解 | API mock/live | 拆解结构可保存为参考，不抄袭原文全文 | breakdown JSON | P1 |
| G4.7 | 失败保留草稿 | API mock | RedFox/AI 失败时用户草稿仍可保存，错误原因可见 | failure screenshot | P0 |
| G4.8 | 证据关联 | API | 素材、选题、优化版本都能追到 RedFox call log 和来源 | evidence export | P0 |

安全断言：

- 创作优化结果必须区分“参考来源”和“生成内容”，避免将外部样本当原创事实。
- 高风险改写、诱导外联、平台规则风险必须进入待确认或合规审核。

## 8. Gate 5 - 合规审核

目标：发布前可检测，风险结果可追溯，高风险默认进入待确认。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G5.1 | 合规审核 API | API | `POST /api/compliance/check` 支持平台、文本、目标对象 | compliance response | P0 |
| G5.2 | 平台专属检测 | API mock/live | 小红书、抖音、公众号至少各有命中/不命中样例 | platform fixtures | P0 |
| G5.3 | 风险等级 | Unit | `low/medium/high/blocker` 或等价等级映射稳定 | 单测 | P0 |
| G5.4 | 命中词和替换建议 | API | 返回命中位置、词项、建议；敏感词报告可脱敏展示 | response JSON | P1 |
| G5.5 | 发布前 Gate | Browser/API | 高风险内容不能直接进入发布，进入待我确认 | 发布前截图 | P0 |
| G5.6 | 审核失败降级 | API mock | RedFox 不可用时不丢草稿，展示“合规暂不可用”并记录失败 | failure evidence | P0 |
| G5.7 | 复查 | API | 历史 `ComplianceCheck` 可按目标/平台查询，结果不可被普通用户越权查看 | query evidence | P0 |
| G5.8 | 证据链 | API | 审核结果写入证据，含平台、版本号、风险等级、人工确认状态 | evidence export | P0 |

安全断言：

- 合规审核失败不能被前端当作通过。
- 合规通过不代表自动发布授权；发布仍需原有发布权限和账号状态校验。

## 9. Gate 6 - 评论洞察

目标：评论可分析，回复建议默认待确认，不自动发送。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G6.1 | 评论来源输入 | Browser/API | 支持作品链接、关键词或已有作品；非法链接有提示 | input evidence | P1 |
| G6.2 | 抖音评论分析 | API mock/live | 输出痛点、异议、需求、意向词、常见问题 | douyin insight JSON | P1 |
| G6.3 | 小红书评论分析 | API mock/live | 输出结构与抖音一致，平台字段正确 | xhs insight JSON | P1 |
| G6.4 | 回复建议 | API | 建议带风险等级和适用场景，默认待确认 | suggestion JSON | P0 |
| G6.5 | 回复规则沉淀 | API + Browser | 经人工确认后才能保存为回复规则 | before/after JSON | P0 |
| G6.6 | 线索联动 | API | 可关联线索池，但不自动创建高意向线索 | lead link evidence | P0 |
| G6.7 | 自动发送禁止 | Static/API | 评论洞察链路不会创建自动私信/自动评论任务 | task table/API grep | P0 |
| G6.8 | 失败和空评论 | API mock | 空评论、RedFox 超时、权限不足都有解释和下一步 | failure JSON | P1 |

安全断言：

- 评论洞察不是自动外联工具。任何回复、私信、评论都必须进入原有人工确认和平台账号风控链路。
- 评论用户名、头像、主页等个人信息只保留业务必要字段。

## 10. Gate 7 - 成本控制

目标：调用日志、成本统计、限额和告警生效。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G7.1 | 调用日志 | API | 每次 RedFox 调用记录 endpoint、skillCode、status、latencyMs、costPoints、requestHash | call log JSON | P0 |
| G7.2 | 成本汇总 | API + Browser | 管理员可看日/周/月成本，普通用户只能看自身范围 | cost summary | P0 |
| G7.3 | 用户日限额 | Unit/API | 超过 `REDFOX_DAILY_USER_LIMIT` 返回明确超限，不再调用 RedFox | limit test | P0 |
| G7.4 | 租户日限额 | Unit/API | 超过 `REDFOX_DAILY_TENANT_LIMIT` 阻断全租户继续调用 | tenant limit evidence | P0 |
| G7.5 | 单 Skill 限额 | Unit/API | 高频 Skill 被限制，其他 Skill 不受误伤 | skill limit evidence | P1 |
| G7.6 | 高成本确认 | Browser/API | 超过阈值必须人工确认，取消后不调用 RedFox | confirmation evidence | P0 |
| G7.7 | 缓存和去重 | Unit/API | 搜索类相同关键词在 TTL 内命中缓存或提示复用 | cache evidence | P1 |
| G7.8 | 告警 | API/Manual | 达到 80%/100% 限额有 UI 或日志告警 | alert evidence | P1 |

安全断言：

- 限额检查必须在调用 RedFox 前执行。
- 失败重试最多 2 次，重试也计入调用日志，不能无限循环。

## 11. Gate 8 - 权限安全

目标：租户隔离、角色权限、API Key 脱敏通过。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G8.1 | 鉴权必需 | API | 未登录访问 RedFox/Intelligence/Compliance/Comment API 返回 401 | 401 matrix | P0 |
| G8.2 | RBAC | API | 普通用户不能看全租户成本、不能管理他人 Key、不能启停管理员 Skill | 403 matrix | P0 |
| G8.3 | 租户 A/B 隔离 | API + DB | A 租户的连接、Skill install、情报、成本、审核、洞察，B 租户不可见 | A/B report | P0 |
| G8.4 | 用户范围隔离 | API | 同租户普通用户不能看无权限项目；管理员可按规则查看 | user scope report | P1 |
| G8.5 | API Key 脱敏 | Unit/API/Browser | 所有响应、页面、日志只出现 mask，不出现明文 | grep report | P0 |
| G8.6 | 审计字段 | DB/API | 所有写操作有 tenantId、userId、createdAt、source/action | audit export | P0 |
| G8.7 | 输入校验 | API fuzz | keyword/url/platform/skillCode 非法值不造成 500 或注入 | fuzz summary | P1 |
| G8.8 | 敏感日志扫描 | Script | `.local-logs`、证据目录、调用日志无完整 Key/Cookie/Authorization | redaction grep | P0 |

安全断言：

- 前端隐藏按钮不是权限。后端必须独立拦截越权。
- 证据包可共享给测试团队，但不能包含生产 Key、生产 Cookie 或真实客户隐私原文。

## 12. Gate 9 - 降级兜底

目标：RedFox 不可用时系统可继续使用已有功能，并给出可执行下一步。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G9.1 | RedFox 5xx | API mock | 返回业务错误和重试建议，不抛未捕获异常 | failure JSON | P0 |
| G9.2 | RedFox 超时 | API mock | 在 `REDFOX_TIMEOUT_MS` 后失败，页面可恢复 | timeout evidence | P0 |
| G9.3 | Key 过期 | API mock | 标记连接失效，引导重新配置，不清空历史数据 | expired-key screenshot | P0 |
| G9.4 | 限额耗尽 | API mock | 页面显示今日额度耗尽，已有内容生产可继续 | quota screenshot | P0 |
| G9.5 | 部分导入失败 | API mock | 批量导入保留成功项和失败明细，可重试失败项 | partial report | P1 |
| G9.6 | 缓存兜底 | API | 有上次成功热点/Skill 时可显示 stale 标记 | stale evidence | P1 |
| G9.7 | 旧功能不受影响 | Browser/API | `/materials`、`/topics`、`/articles`、`/schedules` 不因 RedFox 挂掉白屏 | browser sweep | P0 |
| G9.8 | 失败证据 | API | failureReason、errorCode、retryCount、nextAction 写入证据链 | evidence export | P0 |

安全断言：

- 降级不能返回假成功、假成本、假合规通过。
- 失败恢复后不能重复扣费或重复导入。

## 13. Gate 10 - 运营可用

目标：非工程用户可按手册完成核心流程，异常时能自助定位。

| ID | 测试项 | 方法 | 通过标准 | 证据 | 自动化优先级 |
| --- | --- | --- | --- | --- | --- |
| G10.1 | 运营手册 | Manual | 手册覆盖连接、同步、热点导入、选题、合规、评论洞察、成本查看 | 手册链接 | P1 |
| G10.2 | 首次配置 | User test | 非工程用户能在 10 分钟内配置测试 Key 并完成连接测试 | 录屏/观察记录 | P1 |
| G10.3 | 核心流程 | User test | 用户独立完成热点到选题到合规审核 | signoff report | P0 |
| G10.4 | 页面可读性 | Browser | 关键页面在 1440x1000、1365x900、768x1024 无白屏、无横向炸版 | screenshots | P1 |
| G10.5 | 异常处理 Runbook | Manual | Key 失效、超限、RedFox 超时、同步失败、合规失败都有处理步骤 | runbook | P0 |
| G10.6 | 报告导出 | API/Browser | 可导出调用、成本、审核、证据报告 | exported files | P1 |
| G10.7 | 支持交接 | Manual | 支持团队知道看哪里：任务记录、操作证据、运行记录、调用成本 | support checklist | P1 |
| G10.8 | 发布签核 | Manual | P0/P1 为 0，P2 有 owner、规避方案、复测日期 | signoff table | P0 |

安全断言：

- 运营手册不得要求用户把 API Key 发给工程师或粘贴到聊天窗口。
- 对外演示只能使用测试 Key、测试租户、测试账号和脱敏证据。

## 14. 横向安全矩阵

| 安全主题 | 必测点 | 最低证据 | 失败即阻断 |
| --- | --- | --- | --- |
| API Key 脱敏 | 前端、API 响应、日志、证据包、错误提示、浏览器 storage | `redaction-grep.txt`、页面截图、API JSON | 是 |
| API Key 存储 | 加密字段、无明文 DB、轮换后旧 Key 不可用 | DB 抽样、单测 | 是 |
| 租户隔离 | connection、skill install、intelligence、call log、cost、compliance、comment insight | A/B 租户 API 矩阵 | 是 |
| 调用限额 | user/day、tenant/day、skill/day、高成本确认、重试上限 | limit 单测/API 报告 | 是 |
| 失败降级 | 5xx、timeout、bad key、quota、partial failure、stale cache | mock failure report | 是 |
| 证据链 | callLogId、requestHash、sourceUrl/externalId、tenantId、userId、risk result、人工确认 | evidence export | 是 |
| 合规边界 | 高风险待确认、失败不当通过、不自动发布 | browser/API evidence | 是 |
| 外联边界 | 评论洞察不自动私信/评论，不自动创建高意向线索 | task audit | 是 |

## 15. 角色权限矩阵

| 能力 | Owner/Admin | Operator | Viewer | 未登录 |
| --- | --- | --- | --- | --- |
| 配置 RedFox Key | 允许 | 禁止或需授权 | 禁止 | 401 |
| 测试连接 | 允许 | 允许自身范围 | 禁止 | 401 |
| 同步 Skill 目录 | 允许 | 禁止或只读 | 禁止 | 401 |
| 启停 Skill | 允许 | 允许被授权场景 | 禁止 | 401 |
| 拉取情报 | 允许 | 允许配额内 | 只读历史 | 401 |
| 导入素材/生成选题 | 允许 | 允许配额内 | 禁止 | 401 |
| 合规审核 | 允许 | 允许 | 只读历史 | 401 |
| 评论洞察 | 允许 | 允许配额内 | 只读历史 | 401 |
| 查看全租户成本 | 允许 | 禁止 | 禁止 | 401 |
| 导出证据 | 允许 | 允许自身任务 | 允许被授权范围 | 401 |

## 16. 配置样例和部署清单

建议在稳定上线实现时把以下变量加入正式环境示例。当前文档先作为合同，不直接修改并行中的 `.env.example`。

```bash
REDFOX_API_BASE_URL=https://redfox.hk
REDFOX_API_KEY=
REDFOX_TIMEOUT_MS=60000
REDFOX_DAILY_USER_LIMIT=200
REDFOX_DAILY_TENANT_LIMIT=2000
REDFOX_DAILY_SKILL_LIMIT=500
REDFOX_HIGH_COST_CONFIRM_THRESHOLD=1
REDFOX_CACHE_TTL_SECONDS=3600
REDFOX_RETRY_MAX_ATTEMPTS=2
REDFOX_CALL_LOG_RETENTION_DAYS=180
```

上线前必须确认：

- `REDFOX_API_KEY` 不进入前端构建环境。
- 生产环境 Key 由密钥管理或后端加密存储注入，不写进 Git。
- 本地开发、测试、生产使用不同 Key 和不同租户。
- 成本和限额默认保守，未配置时 RedFox 调用应 blocked，而不是无限开放。

## 17. 自动化落地建议

优先自动化顺序：

| 优先级 | 自动化项 | 建议位置 | 对应 Gate |
| --- | --- | --- | --- |
| P0 | RedFox Client 脱敏、错误映射、重试上限、超时 | `backend/src/modules/redfox/*.spec.ts` | 1, 7, 8, 9 |
| P0 | API Key 明文日志/证据扫描 | `scripts/redfox-stable-launch-gate.mjs` | 1, 8 |
| P0 | 租户 A/B API 隔离矩阵 | 后端 e2e 或 gate live 模式 | 3, 7, 8 |
| P0 | 限额在调用前阻断 | `redfox-cost-guard.service.spec.ts` | 7 |
| P0 | 合规失败不当通过回归 | `compliance.service.spec.ts` + browser | 5, 9 |
| P1 | Skill 同步 normalizer fixture | `redfox-skill-catalog.service.spec.ts` | 2 |
| P1 | Intelligence 去重和导入失败明细 | `intelligence-import.service.spec.ts` | 3 |
| P1 | 页面三视口 smoke | Playwright script | 10 |
| P1 | 成本总览权限 | API e2e | 7, 8 |

## 18. 发布签核模板

| Gate | 状态 | 证据目录 | Owner | 剩余风险 | 复测日期 |
| --- | --- | --- | --- | --- | --- |
| Gate 1 RedFox 连接 |  |  |  |  |  |
| Gate 2 Skill 同步 |  |  |  |  |  |
| Gate 3 情报导入 |  |  |  |  |  |
| Gate 4 内容联动 |  |  |  |  |  |
| Gate 5 合规审核 |  |  |  |  |  |
| Gate 6 评论洞察 |  |  |  |  |  |
| Gate 7 成本控制 |  |  |  |  |  |
| Gate 8 权限安全 |  |  |  |  |  |
| Gate 9 降级兜底 |  |  |  |  |  |
| Gate 10 运营可用 |  |  |  |  |  |

上线红线：

- 任何 P0/P1 `FAILED` 或 `BLOCKED`，不能发布。
- 没有租户隔离证据，不能发布。
- 没有 API Key 脱敏证据，不能发布。
- 没有 RedFox 不可用降级证据，不能发布。
- 没有端到端证据链，不能发布。
