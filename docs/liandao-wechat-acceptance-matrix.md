# 炼刀微信体系复刻验收矩阵

## 12 天打平工程路线（执行参考）

目标不是把炼刀代码搬过来，而是用自研 Windows runtime、后端合同、前端诊断和真机验收，把微信任务做到同级可用。

### 并行责任线
- 联系人同步：Windows native runtime、数据库优先、UIA 全量滚动、OCR/诊断兜底。
- 后端接入：native runtime -> legacy engine -> PowerShell/OCR fallback，所有失败可导出诊断。
- 统一命令合同：群发、加好友、朋友圈发布、朋友圈营销、会话历史共用同一套 runtime input/output。
- 前端体验：随机/全部同步、分层错误、无重叠、0 联系人可处理。
- 打包发布：安装包、自动更新、OSS、资源门禁都带上微信 runtime。
- 真机验收：Windows 10/11、微信不同页面、失败恢复、证据归档。

### 工程交付门槛（参考）

本段保留工程推进顺序；正式商用验收以“12 天商用验收闭环”和“真机验收矩阵”为准。

| 天数 | 交付物 | 通过标准 | 不通过就不能做什么 |
| --- | --- | --- | --- |
| Day 1 | native runtime 联系人同步主链路 | `contacts --mode random/all` 有稳定 JSON 输出；非 Windows 和无微信时也能给分层诊断 | 不能打包给用户 |
| Day 2 | Windows 真机联系人同步随机模式 | Windows 10/11 至少各 1 台，随机模式不采集 3010/抖音/发布中心页面 | 不能宣称联系人同步可用 |
| Day 3 | Windows 真机联系人同步全部模式 | 全量滚动或数据库路径能稳定返回；连续 3 次数量不大幅波动，失败可导出诊断 | 不能开放“同步全部好友” |
| Day 4 | 加密 DB/helper 合同 | 能识别 plaintext/encrypted/helper-missing/helper-failed；不裸报 sqlite/PowerShell 异常 | 不能把 DB 解密问题归因给用户系统 |
| Day 5 | 后端统一 runtime runner | contacts/group-broadcast/contact-add/moments/chat-history 有统一命令合同和错误结构 | 不能继续给每个功能复制脚本分支 |
| Day 6 | 普通群发小流量闭环 | 目标选择、每日上限、间隔、暂停/恢复、对象级成功/失败记录可验 | 不能开放自动群发 |
| Day 7 | 加好友小流量闭环 | 验证语、黑名单、每日上限、风控/验证码阻断和证据可验 | 不能开放批量加好友 |
| Day 8 | 朋友圈发布闭环 | 文案、素材路径、缺素材阻断、发布证据、暂停/恢复可验 | 不能开放朋友圈发布 |
| Day 9 | 朋友圈营销闭环 | 随机/定向、点赞、评论、AI/固定评论、营销记录和截图可验 | 不能开放朋友圈营销 |
| Day 10 | 会话/聊天历史闭环 | 会话列表、历史同步、失败诊断、当前微信号关联可验 | 不能宣称微信 CRM 数据闭环 |
| Day 11 | 前端商用体验回归 | `/workbench/wechat` 无重叠、无未捕获异常、错误能指导操作 | 不能给外部用户安装包 |
| Day 12 | 安装包 + OSS + 回归报告 | 新版本号、资源完整、自动更新可识别、Windows 10/11 smoke 通过并归档证据 | 不能上传正式 OSS 发布口 |

### 发布红线
- 没有 Windows 10 和 Windows 11 真机证据，不能说“已打平”。
- 联系人数量连续 3 次大幅波动且没有诊断原因，不能发包。
- 任一微信任务只创建记录但没有本地执行证据，不能算通过。
- 安装包缺 `wechat-native-runtime`、`wechat-engine` 或 `wechat-db-helper` 任一资源，不能上传 OSS。
- 任何真实发送、加好友、朋友圈动作必须保留对象级状态和截图/事件证据。

## 联系人库
- 同步通讯录不会采集 3010 页面、抖音页面或其他前台窗口。
- 联系人至少包含名称；增强字段包含 `wxid`、微信号/别名、昵称、备注、标签、同步时间。
- 支持手动新增、编辑、删除、清空。
- 支持导出联系人。
- 能读取当前登录微信号；计划关联微信号不一致时阻断执行。

## 会话与聊天历史
- 支持拉取会话列表。
- 支持按会话读取聊天历史。
- 支持触发一次本地同步并返回同步状态。
- 同步失败时给出明确原因，不伪造历史数据。

## 群发计划
- 支持计划名、计划时间、关联微信号、每日上限、发送间隔、对象列表。
- 支持对象明细状态：待执行、运行中、等待确认、成功、失败、跳过。
- 支持暂停、恢复、删除、立即重发、编辑后重发。
- 受控模式只停在首个确认点；自动模式按上限和间隔继续执行。
- 执行证据能关联到对象明细。

## 加好友计划
- 支持目标列表、验证语、每日上限、黑名单。
- 黑名单对象必须跳过并记录原因。
- 达到每日上限后不继续执行。
- 支持完成数、失败数、跳过数、待执行数。
- 出现验证码、风控、微信未登录时阻断并留证。

## 朋友圈发布
- 支持文案、素材路径、可见范围、计划开始时间、每日发布数。
- 素材缺失时必须阻断。
- 支持发布进度：总数、已发布、待发布、失败。
- 支持暂停、恢复、删除。
- 真实发表后必须有截图或事件证据。

## 朋友圈营销
- 支持随机浏览和定向联系人两种模式。
- 支持每日浏览上限、随机浏览数、开始时间。
- 支持点赞、评论、点赞+评论。
- 支持 AI 评论、固定评论、按目标评论。
- 支持营销记录：目标、动作、评论内容、结果、截图。
- Prompt 配置可读写，并能被执行器使用。

## 本地执行
- 可执行任务必须由本地执行器接管，不只写任务记录。
- 执行前检查本机助手、微信窗口、权限、当前微信号。
- 暂停/删除后不能继续跑后续对象。
- 失败后可重试，重试必须保留原计划来源。

## 前端
- `/workbench/wechat` 能看到联系人库、计划中心、创建计划区。
- 计划行显示状态、类型、计划名、关联微信号、计划时间、每日上限、对象统计、失败原因。
- 所有按钮有真实 API 或明确禁用状态。
- 控制台无 React key、hydration、接口未捕获错误。

## 轻量自动验收

### 运行方式
- 只读 smoke：`cd ai-content && node scripts/liandao-wechat-smoke.mjs`
- 后端类型检查：`cd ai-content/backend && npx tsc --noEmit`
- 前端类型检查：`cd ai-content/frontend && npx tsc --noEmit`
- 可选构建兜底：`cd ai-content/frontend && npm run build`

### smoke 覆盖范围
- API 存在性：检查 `local-engine.controller.ts` 中微信会话、联系人、聊天历史、群发计划、加好友、朋友圈、任务控制、回复规则相关路由是否存在。
- 前端 API 合同：检查 `frontend/src/lib/api/local-engine.ts` 是否引用对应 `/local-engine/...` 路径。
- 页面入口：检查 `/workbench/wechat`、`/workbench/wechat-groups`、`/workbench/wechat-moments` 页面文件存在。
- 关键页面检查点：检查工作台文案包含联系人库、计划中心、会话回复、群发、加好友、朋友圈发布、朋友圈营销、计划时间、关联微信号、每日上限等第三轮必验信息。
- 执行器入口：检查 `vendor/skillhub` 下微信自动回复、当前会话回复、通讯录同步、加好友、聊天同步、朋友圈发布、朋友圈营销入口脚本存在。
- 护栏：检查 `AGENTS.md` 仍声明微信桌面任务不能绕过 Agent-S/local-controller。

### 第三轮真实验收补充
- smoke 只证明静态合同和入口存在，不能证明微信窗口可控、当前微信号一致、真实素材可发布或消息已发送。
- 第三轮需要在登录本机微信后，逐项验证联系人同步、会话历史同步、群发首个确认点、加好友黑名单/每日上限、朋友圈素材缺失阻断、朋友圈营销记录与截图证据。
- 第三轮不要把“任务已创建”当作“真实发送成功”；成功标准必须包含 Agent-S/local-controller 执行证据、对象明细状态和截图/事件证据。
- smoke 不访问真实外部网络，不依赖登录态，不触发真实微信发送。

## 12 天商用验收闭环

### 完成定义
- 每天必须产出可复跑的证据目录：`docs/acceptance-evidence-YYYY-MM-DD/liandao-wechat-day-N/`。
- 每个能力必须同时有 API/页面/执行器/证据四类结论，不能只以“任务创建成功”计入通过。
- 自动 smoke 必跑：`node scripts/liandao-wechat-smoke.mjs`。Windows 真机回归再跑：`LIANDAO_SMOKE_LIVE=1 LIANDAO_SMOKE_STRICT_LIVE=1 node scripts/liandao-wechat-smoke.mjs`。
- 真机 random/all 联系人同步只在明确授权时执行：`LIANDAO_SMOKE_REAL_WECHAT=1 LIANDAO_SMOKE_LIVE=1 LIANDAO_SMOKE_STRICT_LIVE=1 node scripts/liandao-wechat-smoke.mjs`。
- 每天收口时必须更新阻断项 owner、下一步和复测命令；阻断项不能静默带入第二天。

### 12 天交付计划
| 天数 | 交付物 | 验收门槛 | 必留证据文件 |
| --- | --- | --- | --- |
| Day 1 | 验收基线、测试账号、Windows 10/11 机器清单、微信版本表 | static smoke 全绿；证据目录创建；测试账号和测试群不触达真实客户 | `00-baseline-smoke.json`、`windows-machine-matrix.md`、`wechat-version.txt` |
| Day 2 | 联系人同步 random 闭环 | random 同步返回真实联系人，拒绝抖音/发布中心污染，诊断导出可读 | `contacts-random-sync-result.json`、`contacts-diagnostics-export.json`、`contacts-random-screen.png` |
| Day 3 | 联系人同步 all 闭环 | all 能从通讯录顶部到尾部完成或明确阻断；联系人数量、翻页/滚动阶段、耗时可解释 | `contacts-all-sync-result.json`、`contacts-all-diagnostics.json`、`contacts-export.json` |
| Day 4 | 会话历史闭环 | 会话列表可读；指定会话历史可读；真实读取不可用时返回 blocked/empty 和原因，不伪造消息 | `chat-sessions.json`、`chat-history-target.json`、`chat-history-sync-result.json` |
| Day 5 | 群发计划合同 | 群发计划字段、对象明细、暂停/恢复/重发 API 和页面状态通过；首个确认点可拦截 | `group-plan-create.json`、`group-detail-list.json`、`group-first-confirmation.png` |
| Day 6 | 群发真机受控发送 | 测试群/测试联系人收到内容；间隔、每日上限、附件证据可追踪；停止后不继续后续对象 | `group-task-diagnostics.json`、`group-records-export.json`、`group-recipient-proof.png` |
| Day 7 | 加好友计划合同 | 目标列表、验证语、备注策略、黑名单、每日上限、间隔字段被 API/执行器接收 | `contact-add-plan.json`、`contact-add-detail-list.json`、`blacklist-skip.json` |
| Day 8 | 加好友真机风控回归 | 黑名单必跳过；达到每日上限停止；验证码/风控/未登录必须 blocked 并留诊断 | `contact-add-diagnostics.json`、`contact-add-records-export.json`、`risk-blocker-screen.png` |
| Day 9 | 朋友圈发布合同和素材校验 | 文案、素材、可见范围、计划时间、发布间隔字段完整；素材缺失/图片视频混选阻断 | `moments-assets-smoke.json`、`moments-publish-plan.json`、`missing-asset-blocker.json` |
| Day 10 | 朋友圈发布真机回归 | 测试朋友圈真实出现或停在确认点；截图/事件证据能关联任务；暂停/恢复/删除有效 | `moments-publish-diagnostics.json`、`moments-publish-records-export.json`、`moments-proof.png` |
| Day 11 | 朋友圈营销 random/targeted | random 浏览数、targeted 联系人、点赞/评论/AI 评论/固定评论均有记录；Prompt 配置可读写 | `moments-marketing-random.json`、`moments-marketing-targeted.json`、`prompt-config.json` |
| Day 12 | 全量商用回归包 | Windows 10 和 Windows 11 各跑一轮 static + live + 真机清单；P0/P1 为 0；剩余 P2 有 owner 和规避方案 | `liandao-wechat-smoke-final.json`、`win10-final-report.md`、`win11-final-report.md`、`acceptance-signoff.md` |

## 真机验收矩阵
| 验收项 | 覆盖范围 | 自动 smoke | 手工真机步骤 | 通过标准 | 失败诊断 | 证据文件 | Windows 10/11 差异 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 联系人同步 random | 当前可见/随机联系人、去重、结构化字段、污染防护 | static 检查 `/wechat/contacts/sync`、联系人导出、诊断导出；`LIANDAO_SMOKE_REAL_WECHAT=1` 时执行 `mode=random` | 打开微信通讯录，确认不是抖音/发布中心；点击随机同步；同步后导出联系人和诊断 | 返回真实联系人；至少包含名称，增强字段有 wxid/别名/昵称/备注/标签/同步时间；不采集前台浏览器内容 | 若 0 条或名称异常，查窗口标题、OCR/辅助功能、DPI、污染拒绝日志、`contacts/diagnostics/export` | `contacts-random-sync-result.json`、`contacts-diagnostics-export.json`、`contacts-random-screen.png` | Windows 10 常见 UIA 节点少，优先截图/OCR 兜底；Windows 11 多显示器和缩放更常见，需记录缩放比例和窗口区域 |
| 联系人同步 all | 全量通讯录顶部到尾部扫描、滚动停止、数量稳定 | static 检查 `mode=all` 合同；真机模式执行 `mode=all`，超时默认 13 分钟 | 通讯录回到顶部；执行全部同步；观察滚动到底、重复页停止、数量稳定；导出联系人 | 全量同步完成或明确 blocked；数量与人工抽样相符；重复率可解释；耗时和页数写入诊断 | 查是否卡在首屏、滚动未生效、微信掉线、账号风控、超时、重复联系人过多 | `contacts-all-sync-result.json`、`contacts-all-diagnostics.json`、`contacts-export.json` | Windows 10 触摸板/滚轮事件差异大，要验证滚动量；Windows 11 Snap Layout 可能改变窗口坐标，要固定微信窗口位置 |
| 群发 | 普通群发、对象明细、附件、计划时间、每日上限、间隔、暂停/恢复/重发 | static 检查 groups 任务/计划/明细/控制 API；live 读取 `/groups/*` 和 records export | 用测试群和测试联系人创建计划；受控模式确认首个对象；验证暂停后不继续，恢复后继续，编辑后重发保留来源 | 每个对象状态可追踪；首个确认点可拦截；发送成功有截图或事件证据；每日上限和间隔生效 | 查任务诊断、对象明细、Agent-S 事件、附件路径、微信号不一致 blocker、停止后是否仍执行 | `group-plan-create.json`、`group-detail-list.json`、`group-task-diagnostics.json`、`group-records-export.json`、`group-recipient-proof.png` | Windows 10 文件选择器路径粘贴更易失焦；Windows 11 文件选择器和安全弹窗层级更高，需额外截图 |
| 加好友 | 目标列表、验证语、备注策略、黑名单、每日上限、验证码/风控 | static 检查 customers 任务/记录和 contact-add 执行器字段；live 读取 `/customers/*` 和 records export | 准备 3 个测试微信号，其中 1 个黑名单；创建计划；验证黑名单跳过、每日上限停止、验证码/风控 blocked | 黑名单对象状态为 skipped 且有原因；达到每日上限后不再执行；验证语/备注按配置写入 | 查 `contact-add` 诊断、搜索框定位、验证消息输入、风控弹窗、当前微信号 mismatch | `contact-add-plan.json`、`blacklist-skip.json`、`contact-add-diagnostics.json`、`contact-add-records-export.json` | Windows 10 搜索框焦点容易被输入法抢占；Windows 11 输入法候选窗覆盖按钮时要记录截图并重试 |
| 朋友圈发布 | 文案、素材路径、可见范围、计划开始时间、每日发布数、发布间隔、素材规则 | static 检查 moments 任务/记录、素材 smoke、calibration helper；live 读取 `/moments/*` 和 records export | 先跑素材校验；用测试文案和素材创建计划；受控确认发布；验证暂停/恢复/删除；素材缺失必须阻断 | 真实发表后有截图/事件证据；素材缺失、图片视频混选、超过数量必须 blocked；进度总数/已发布/失败准确 | 查素材路径、文件选择器、微信朋友圈窗口、可见范围选择、诊断包 evidenceReplay | `moments-assets-smoke.json`、`moments-publish-plan.json`、`moments-publish-diagnostics.json`、`moments-proof.png` | Windows 10 文件选择器对长路径兼容差，要准备短路径素材；Windows 11 权限弹窗和图库预览可能遮挡确认按钮 |
| 朋友圈营销 | random 浏览、定向联系人、点赞、评论、点赞+评论、AI/固定/按目标评论、Prompt | static 检查 `wechat-moments-marketing` 类型、Prompt 字段、执行器入口；live 读取 moments records export | random 模式设置浏览上限；targeted 模式选择联系人；分别测试点赞、评论、点赞+评论；保存并复用 Prompt | 每个目标都有动作、评论内容、结果和截图；AI 评论不为空且可追溯 Prompt；固定评论不被改写 | 查目标定位、滚动停止、评论框焦点、AI 模型 blocker、Prompt 读取、点赞重复状态 | `moments-marketing-random.json`、`moments-marketing-targeted.json`、`prompt-config.json`、`marketing-records-export.json` | Windows 10 滚动惯性弱，需降低浏览速度；Windows 11 动画/圆角窗口可能影响坐标，需校准点击点 |
| 会话历史 | 会话列表、指定会话消息、同步状态、blocked/empty 语义 | static 检查 chat-sessions/chat-history/sync API 和真实 OCR/DB 读取器；live 读取会话列表，提供 `LIANDAO_SMOKE_CHAT_SESSION_ID` 后读历史 | 打开测试会话；同步历史；读取最近 20 条；验证空会话、无权限、DB/RPA 未接入时返回原因而非假数据 | 会话列表和历史消息来源明确；真实消息与微信窗口抽样一致；失败时 status 为 blocked/empty/error 并给 nextAction | 查 DB/RPA/OCR 来源、会话 id、窗口焦点、权限、`chat-history-sync-result`、最新截图 | `chat-sessions.json`、`chat-history-target.json`、`chat-history-sync-result.json`、`chat-history-screen.png` | Windows 10 OCR 字体渲染更粗，需人工抽样；Windows 11 高 DPI 下截图缩放要写入诊断 |

## Windows 真机回归清单
- 机器矩阵：Windows 10 22H2、Windows 11 23H2/24H2 至少各 1 台；记录 CPU、内存、显示缩放、输入法、微信版本、管理员权限状态。
- 账号边界：只用测试微信号、测试群、测试素材；群发/加好友/朋友圈发布不得触达真实客户。
- 权限预检：桌面助手、屏幕录制/截图能力、文件访问、输入法、剪贴板、WeChat 窗口标题和当前微信号必须截图留证。
- 失败收敛：失败必须导出对应 `diagnostics/export`、`records/export` 或任务诊断包；没有证据的失败不能关闭。
- 商用门槛：Day 12 最终报告中 P0/P1 必须为 0；P2 必须有绕行方案、owner 和复测日期。

## smoke 脚本分层
- 静态合同检查：`node scripts/liandao-wechat-smoke.mjs`，只证明接口/页面/脚本/矩阵合同存在，不代表商用通过。
- 本地 live 只读：`LIANDAO_SMOKE_LIVE=1 node scripts/liandao-wechat-smoke.mjs`，检查本地 API、页面状态、records export、联系人诊断导出；401/403 记为 blocked。
- 模拟器联系人：`node scripts/wechat-windows-contacts-acceptance.mjs --simulator --base-url http://127.0.0.1:3011`，只验证 random/all 合同和诊断导出，不能替代 Windows 真机证据。
- 真机 random/all 联系人同步：`WECHAT_ACCEPT_EVIDENCE_DIR=docs/acceptance-evidence-YYYY-MM-DD/windows-wechat-contacts-win10 node scripts/wechat-windows-contacts-acceptance.mjs --real --base-url http://127.0.0.1:3011`，Win10/Win11 分别跑，证据目录不能带 `simulator`。
- 严格真机 smoke：`LIANDAO_SMOKE_LIVE=1 LIANDAO_SMOKE_REAL_WECHAT=1 LIANDAO_SMOKE_STRICT_LIVE=1 node scripts/liandao-wechat-smoke.mjs`，blocked 也会使退出码失败，适合 Day 12。
- 正式 Windows 上传门禁：在 `desktop` 目录运行 `WINDOWS_GATE_EVIDENCE_DIR=docs/acceptance-evidence-YYYY-MM-DD WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE=docs/acceptance-evidence-YYYY-MM-DD/windows-wechat-contacts-win10 npm run check:win-commercial-release`。输出中的 `static`、`simulator`、`real-windows` 分层必须看清；没有 `real-windows` 证据时只能是 blocked。
- Windows 联系人同步证据包：`node scripts/wechat-windows-contacts-acceptance.mjs --real --base-url http://127.0.0.1:3011`，会落盘 readiness、random/all 同步结果、联系人导出、诊断导出和 `summary.md`。
- 可选参数：`LIANDAO_SMOKE_BASE_URL`、`LIANDAO_SMOKE_FRONTEND_URL`、`LIANDAO_SMOKE_COOKIE`、`LIANDAO_SMOKE_BEARER_TOKEN`、`LIANDAO_SMOKE_CHAT_SESSION_ID`、`LIANDAO_SMOKE_TASK_IDS`、`LIANDAO_SMOKE_EVIDENCE_DIR`。
