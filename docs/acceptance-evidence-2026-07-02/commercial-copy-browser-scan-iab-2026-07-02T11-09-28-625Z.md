# Commercial Copy Browser Scan (In-App Browser)

- Started: 2026-07-02T11:05:46.251Z
- Finished: 2026-07-02T11:09:28.625Z
- Frontend: http://127.0.0.1:3010
- Routes: 85
- Passed: 71
- Failed: 14
- Console errors: 0
- JSON: docs/acceptance-evidence-2026-07-02/commercial-copy-browser-scan-iab-2026-07-02T11-09-28-625Z.json

## Failures

### /apps/ai-employee
- Final URL: http://127.0.0.1:3010/apps/ai-employee
- blankPage: blank
  - page body text is empty or too short

### /capabilities/executor
- Final URL: http://127.0.0.1:3010/capabilities/executor
- skillSurface: 插件与技能
  - 远程控制 详情 通过 基础能力 用户接管审计 Agent 会话已保留接管审计字段。 远程控制 详情 未开放 基础能力 插件与技能运行时 插件和技能目录不在快速健康检查里做磁盘扫描，避免启动页卡顿。 需要诊断插件时进入后续插件页或单独运行插件检查。 详情 未开放 基础能力 插件目录 快速健康检查已跳过目录扫描。 插件
- apiSurface: /api/
  - 端口 3010 详情 通过 服务和进程 主系统后端 主系统后端 在线，但未检测到托管会话 http://localhost:3011/api/auth/setup-status · 端口 3011 详情 旧实现/可选 服务和进程 外部 17777 Python sidecar 当前使用包内桌面执行层；旧外部服务未监听不能单独判定桌面执行不可用。
- backendSurface: 后端
  - 重新启动 停止服务 重新启动或停止会让页面短暂断开；等待服务恢复后刷新即可。 在线 主系统前端 主系统前端 在线，但未检测到托管会话 查看诊断 在线 主系统后端 主系统后端 在线，但未检测到托管会话 查看诊断 在线 Agent-S 包内 Node Runtime Agent-S 包内 Node Runtime 在线，但未检测到托管会话 查看诊断 诊断信息 普通处理不用看这里；启动失败
- runtimeSurface: Runtime
  - 主系统前端 在线，但未检测到托管会话 查看诊断 在线 主系统后端 主系统后端 在线，但未检测到托管会话 查看诊断 在线 Agent-S 包内 Node Runtime Agent-S 包内 Node Runtime 在线，但未检测到托管会话 查看诊断 诊断信息 普通处理不用看这里；启动失败、任务失败时再展开最近日志和服务细节。 展开诊断 任务队列 执行中 0 待继续 0
- internalMode: readiness
  - shared, visible=true) 浏览器引擎 详情 警告 基础能力 真实互动执行器 快速健康检查不下发真实互动任务；完整 readiness 会检查各平台 executor。 查看 /local-engine/readiness 的完整 executor 结果。 详情 警告 基础能力 执行入口 已注册 RuntimeOrchestr
- devPlaceholder: 模型配置
  - 康接口不再读取云端积分余额，避免系统首页被外部授权/网络拖慢。 Kaypal 账号与权益 详情 警告 基础能力 AI 回复模型 默认模型配置不在快速健康检查里读取；需要生成回复时由具体任务和完整检查确认。 到模型配置或完整运行检查确认文章创作/选题/互动回复模型是否已同步。 详情 警告 基础能力 默认模型配置 已跳过数据库和模型平台检查；真实

### /capabilities/risk
- Final URL: http://127.0.0.1:3010/capabilities/risk
- runtimeSurface: runtime
  - 无 保存 retry-publish 重试发布会重新触达外部平台；默认自动执行并保留审计。 默认 high 无 保存 runtime-control 启动、停止、重启本机服务默认自动执行并保留审计。 默认 medium 无 保存 schedule-enable 启用计划任务会持续触发采集、生成或发布链路；默认自动执行。

### /commercial-readiness
- Final URL: http://127.0.0.1:3010/commercial-readiness
- secretSurface: webhook
  - nId、contactedCount、截图和回读结果，并设置 WINDOWS_GATE_GROWTH_SEND_EVIDENCE=<证据文件>。 真实支付与 webhook 配置 负责人：用户 证据已收到 已检测到支付配置，或已经处理过签名计费 webhook。 下一步：请提供 Stripe/Kaypal 测试或生产环境的 webhook secret，并跑一条签名订阅事件完成授权落库。
- internalMode: dry-run
  - 数据模型已在，但还缺真实业务数据闭环 待加固 下一步：继续把自动获客、导入、外部 CRM 同步统一写入 CRM 时间线 CRM 受控导入安全干跑 导入 dry-run 返回 proof，且 writeTables=[]、requiredFutureGate=11G 通过 下一步：保持 preview/dry-run no-write；本地 CRM commit 必须走显式 gate、p
- commercialLeak: 租户
  - 大 商用上线检查 多租户、授权、CRM、备份、监控、外部集成和 Windows 包的统一验收入口。 重新检查 导出本地备份 备份状态 恢复演练 当前结论 不可宣称完整商用 生成时间：2026/7/2 04:06:28 80 分 通过 9 待加固

### /content/optimization
- Final URL: http://127.0.0.1:3010/content/optimization
- externalVendor: RedFox
  - 大 RedFox 创作工作流 创作优化 承接 RedFox 标题评分、文案改写、小红书笔记优化和爆款结构拆解，让热点与样本进入可保存、可追溯的内容版本。 查看 RedFox Skills 进入合规审核 优化入口 3 标题评分、文案改写
- apiSurface: /api/
  - 结构 沉淀标签建议 进入合规审核 接入状态 当前已完成稳定上线入口，后续持续补齐真实处理、记录留存和证据链。 能力 业务入口 当前状态 标题评分 POST /api/content-optimization/title-score 后端骨架已注册 文案改写 POST /api/content-optimization/rewrite 后端骨架已注册 小红书优化 POST /api/conten
- backendSurface: 后端
  - 续补齐真实处理、记录留存和证据链。 能力 业务入口 当前状态 标题评分 POST /api/content-optimization/title-score 后端骨架已注册 文案改写 POST /api/content-optimization/rewrite 后端骨架已注册 小红书优化 POST /api/content-optimization/xhs-note-optimize 后端骨架已

### /growth/acquisition
- Final URL: http://127.0.0.1:3010/growth/acquisition
- apiSurface: 接口
  - 置 GROWTH_EXECUTION_ENABLED=true，并重新跑 live gate。 后台定时未武装 调度 daemon 未开启，任务只能由页面或接口手动触发。 商用部署时同时设置 GROWTH_SCHEDULER_DAEMON=true 和 GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true。 没有可自动执行的在线账号 当前用户没有可验证的平台
- backendSurface: 后端
  - 只展示会影响商用验收的证据、阻断和动作。 刷新 修复可自动处理项 打开账号健康 Readiness blockers 4 项 真实执行开关未开启 当前后端处于安全审阅模式，不会执行评论、私信或后台计划任务。 商用部署时显式设置 GROWTH_EXECUTION_ENABLED=true，并重新跑 live gate。 后台定时未武装 调度 daemon 未开启，任务只能由页面或接口
- internalMode: Readiness
  - 用 在线账号 0/0 Ready 任务 0/0 商用闭环下一步 只展示会影响商用验收的证据、阻断和动作。 刷新 修复可自动处理项 打开账号健康 Readiness blockers 4 项 真实执行开关未开启 当前后端处于安全审阅模式，不会执行评论、私信或后台计划任务。 商用部署时显式设置 GROWTH_EXECUTION_ENABLED=true，并重新跑 live ga

### /interaction/comment-insights
- Final URL: http://127.0.0.1:3010/interaction/comment-insights
- externalVendor: RedFox
  - 大 RedFox 客户互动洞察 评论洞察 把抖音、小红书等评论转成痛点、需求、异议、意向词和回复建议，默认进入人工确认与回复规则沉淀。 查看回复规则 查看对标账号 洞察对象 评论 作品评论、关键词评论和导入评论样本 输出维度 5
- apiSurface: /api/
  - 人工确认入池 CRM 后续承接 接入状态 当前已完成稳定上线入口，后续持续补齐真实处理、记录留存和证据链。 能力 业务入口 当前状态 评论分析 POST /api/comment-insights/analyze 后端骨架已注册 洞察记录 GET /api/comment-insights 占位列表，待持久化 回复规则 客户互动规则链路 待接入规则保存
- backendSurface: 后端
  - 上线入口，后续持续补齐真实处理、记录留存和证据链。 能力 业务入口 当前状态 评论分析 POST /api/comment-insights/analyze 后端骨架已注册 洞察记录 GET /api/comment-insights 占位列表，待持久化 回复规则 客户互动规则链路 待接入规则保存

### /interaction/wecom-assistant
- Final URL: http://127.0.0.1:3010/interaction/wecom-assistant
- backendSurface: 后端
  - 读取客户微信，不自动替客户发送 1. 连接企业微信 2. 设置客服规则 3. 完成安装 安装企业微信连接器 用户在应用内粘贴企业微信群机器人 Webhook，后端测试成功后即可启用。 安全模式说明 第一版不会直接替你回复客户，只会把 AI 建议发送到企业微信群，由员工确认后回复客户。 连接名称 企业微信机器人 Webhook 发送测试消息 下一步：设置客服规则 用户安装指引 给最终用户看
- secretSurface: Webhook
  - 全边界 不直接读取客户微信，不自动替客户发送 1. 连接企业微信 2. 设置客服规则 3. 完成安装 安装企业微信连接器 用户在应用内粘贴企业微信群机器人 Webhook，后端测试成功后即可启用。 安全模式说明 第一版不会直接替你回复客户，只会把 AI 建议发送到企业微信群，由员工确认后回复客户。 连接名称 企业微信机器人 Webhook 发送测试消息 下一步：设置客服规则 用户安装指引

### /local-engine
- Final URL: http://127.0.0.1:3010/local-engine
- skillSurface: 插件与技能
  - 远程控制 详情 通过 基础能力 用户接管审计 Agent 会话已保留接管审计字段。 远程控制 详情 未开放 基础能力 插件与技能运行时 插件和技能目录不在快速健康检查里做磁盘扫描，避免启动页卡顿。 需要诊断插件时进入后续插件页或单独运行插件检查。 详情 未开放 基础能力 插件目录 快速健康检查已跳过目录扫描。 插件
- apiSurface: 接口
  - ypal 登录态和套餐信号；云端套餐、积分余额和授权有效期由完整检查或真实扣点动作确认。 需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。 详情 警告 基础能力 本地登录态 本地会话已绑定 Kaypal 用户 cmo9p6i5x000a58uckbcyv45u；未在健康接口中请求云端余额。 Kaypal 账号与权益 详情
- backendSurface: 后端
  - nt local browser runtime 0.1.0 在线 账号状态正常。 详情 通过 文件和凭证 主系统项目目录 主系统前后端代码、脚本和本地运行记录所在目录。 /Users/yanghy/Documents/New project/ai-content · 目录 · - 详情 通过 文件和凭证 主系统后端目录 本地接口、数据库访问
- runtimeSurface: helper
  - 待服务恢复后刷新即可。 任务队列 执行中 0 待继续 0 已完成 0 失败 0 完整检查项 按通过、警告、阻断汇总本地助手、微信窗口、DB/helper、UIA/OCR 和任务执行条件。 通过 24 警告 18 阻断 0 合计 53 搜索 状态 全部状态 阻断 警告 通过 未开放 状态 全部状态 分类 全部分类 服务和进程 基础能力 平台账号 互动执行 微信通讯录 文件和凭证
- internalMode: readiness
  - shared, visible=true) 浏览器引擎 详情 警告 基础能力 真实互动执行器 快速健康检查不下发真实互动任务；完整 readiness 会检查各平台 executor。 查看 /local-engine/readiness 的完整 executor 结果。 详情 警告 基础能力 执行入口 已注册 RuntimeOrchestr
- devPlaceholder: 模型配置
  - 康接口不再读取云端积分余额，避免系统首页被外部授权/网络拖慢。 Kaypal 账号与权益 详情 警告 基础能力 AI 回复模型 默认模型配置不在快速健康检查里读取；需要生成回复时由具体任务和完整检查确认。 到模型配置或完整运行检查确认文章创作/选题/互动回复模型是否已同步。 详情 警告 基础能力 默认模型配置 已跳过数据库和模型平台检查；真实

### /release-notes
- Final URL: http://127.0.0.1:3010/release-notes
- apiSurface: 接口
  - 压重叠的问题。 修复普通群发计划时间原生日期输入在中文环境下挤字的问题，改为清晰的文本时间格式。 修复安装新版后旧 Kaypal 后端仍占用 3011，导致同步接口实际跑旧代码的问题。 修复 Windows PowerShell 报 `ForEach-Object : Cannot convert value "o" to type System.Int32` 导致第三次同步失败的问题。 修复 W
- backendSurface: 后端
  - 写入通讯录缓存。 知识库云端同步遇到 401 时不再显示成整体失败；本机知识照常可检索，页面提示云端授权需要重新登录。 新增 Windows 微信独立引擎：后端不再只依赖 PowerShell 脚本，先走 sidecar engine，失败再回退旧链路。 新增安装包资源校验：Windows 包必须带 `wechat-engine`，否则预检直接失败。 新增同步诊断显示：页面会展示引擎、DB
- runtimeSurface: Runtime
  - 系人同步模式：随机保留原快速逻辑，全部会尽量从通讯录顶部扫到列表底部。 新增微信任务页空表单保护：缺群发对象、缺加好友目标、缺定向营销联系人时只提示，不再弹 Runtime Error。 普通群发左侧表单重新分区：计划设置、同步名单、发送对象独立显示，不再堆成一列。 全部同步最多滚动 200 次，连续 5 次没有新增联系人后停止，避免无限卡住。 修复用户升级后旧 3011 后端继续占用端口
- secretSurface: token
  - 新增版本号入口，集中展示新增功能、修复内容和剩余注意事项。 仍需注意 当前 Windows 安装包仍未完成生产代码签名：Windows VM 能识别 USB token，但没有可用的代码签名私钥/叶子证书。 商业验收里仍有真实账号/真实动作类阻断项：需要登录真实平台账号并明确开启真实发布、真实执行环境变量后才能跑通。 桌面微信真实执行仍要求人工确认当前前台微信窗口、联系人和草稿内容，系统不会绕过

### /solutions
- Final URL: http://127.0.0.1:3010/solutions
- externalVendor: RedFox
  - 大 方案中心 5 个可试运行 57 个 RedFox 能力 AI 业务方案中心 这里不是接口列表，而是把能力打包成可试跑、可交付、可复用的业务方案。 先选一个客户场景，填清楚目标，再跑一次，看它能不能产出真实业务结果。 能力来源 这页到底干什么用 它是“业务方案试跑台”：
- skillSurface: Skill
  - 、素材、选题或 CRM 模块 运营节奏 试运行：单次配置后生成执行计划和结果预览 上线：按日报/周报节奏沉淀业务结果 复盘：每周查看 ROI、失败步骤、未映射 Skill 和采纳率 权限与审计 可操作：运营成员、运营负责人 审批：运营负责人 外部能力执行必须命中白名单、用量上限、安全口令和人工确认。 右侧：哪些能力现在能跑 绿色区域里的按钮就是当前可试跑能力；跑完会显示进度和交付文件。 可启用
- apiSurface: 接口
  - 大 方案中心 5 个可试运行 57 个 RedFox 能力 AI 业务方案中心 这里不是接口列表，而是把能力打包成可试跑、可交付、可复用的业务方案。 先选一个客户场景，填清楚目标，再跑一次，看它能不能产出真实业务结果。 能力来源 这页到底干什么用 它是“业务方案试跑台”：把 RedFox 能力包装成客户能买、团队能交付的
- secretSurface: 密钥
  - 门/点赞飙升 小红书爆款 公众号 10w+ AI 信息源 现在可以点按钮试跑的能力 全网热搜/聚合热点 可试跑 交付：情报条目、选题 · 需要已连接账号密钥 配置好方案后，可以先做一次本机试跑。 试跑这个能力 最近跑过的方案 点一条查看当时跑到哪一步 热点选题解决方案 待确认 6 步 · 100% 2026/7/1 15:00:11 热点选题解决方案 待确认 6 步 · 1

### /topics
- Final URL: http://127.0.0.1:3010/topics
- externalVendor: RedFox
  - 全部创作状态 最新创建 最早创建 AI 评分最高 AI 评分最低 最新创建 一键挖掘新选题 验收选题 2026-06-30T19-21-33-348Z 待评估 RedFox 情报 • 2026/6/30 验收用评论线索，验证入库、派发、素材和选题链路。 全维度评估 验收选题 2026-06-30T19-19-13-105Z 待评估 RedFox 情报 • 2026/6/30 验收用评论线索，

### /video-workshop
- Final URL: http://127.0.0.1:3010/video-workshop
- apiSurface: api
  - 坊模板 · 已恢复 · 本机成片 生成 2026-06-16 13:54:52 完成 已恢复最近成片 100% commercial-acceptance-api-1781643140932.mp4 视频工坊模板 · 已恢复 · 本机成片 生成 2026-06-16 13:52:25 完成 已恢复最近成片 100% ui-proof-1781638619397.mp4 视频工坊模板 ·
- backendSurface: 后端
  - 创建视频 素材、模板、参数和成片输出都在这里完成 草稿 素材路径 开始前需要一个本机素材路径。 选择本机素材 点击选择会打开系统文件选择器；也可以直接粘贴后端可读取的绝对路径。 创作目标 写清目标后，脚本和剪辑日志会更容易追踪。 风格预设 清晰卖点 / 快节奏 探店真实 / 生活感 案例讲述 / 稳重 知识口播 / 简洁 声线 中文女声 · 稳定播报 中文男声 · 商务叙述 自然口播 ·
- internalMode: proof
  - 1643140932.mp4 视频工坊模板 · 已恢复 · 本机成片 生成 2026-06-16 13:52:25 完成 已恢复最近成片 100% ui-proof-1781638619397.mp4 视频工坊模板 · 已恢复 · 本机成片 生成 2026-06-16 12:37:01 完成 已恢复最近成片 100% workbench-final-proof.mp4 视频工坊模板

### /war-room
- Final URL: http://127.0.0.1:3010/war-room
- runtimeSurface: 本地引擎
  - 行态势 从发布、评论、私信和素材链路里汇总异常任务，后续可接入实时告警。 高风险操作留痕 需要人工确认的桌面控制、账号登录和发布动作统一落到证据中心。 本地引擎健康 浏览器控制、桌面权限、文件访问和日志状态通过本地引擎页继续检查。

