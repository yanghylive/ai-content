# Commercial Copy Browser Scan (IAB)

- Started: 2026-07-02T11:38:24.953Z
- Finished: 2026-07-02T11:44:01.519Z
- Frontend: http://127.0.0.1:3010
- Routes: 85
- Passed: 82
- Failed: 3
- Console errors: 21
- JSON: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-02/commercial-copy-browser-scan-iab-2026-07-02T11-44-01-519Z.json

## Failures

### /capabilities/executor

- Final URL: http://127.0.0.1:3010/capabilities/executor
- Status: loaded
- skillSurface: 插件与技能 — 程接管不是当前本机执行必需条件。 用户接管审计 通过 Agent 会话已保留接管审计字段。 本机任务按当前电脑的浏览器、桌面微信和发布执行器状态判断。 插件与技能运行时 未开放/可选 插件和技能目录不在快速健康检查里做磁盘扫描，避免启动页卡顿。 插件目录 未开放/可选 快速健康检查已跳过目录扫描。 插件运行 未开放/可选 插件执行不影响当前内容生产和客户互动主流程。 需要诊断插
- apiSurface: 接口 — 授权有效期由完整检查或真实扣点动作确认。 本地登录态 警告 本地会话已绑定 Kaypal 用户 cmo9p6i5x000a58uckbcyv45u；未在健康接口中请求云端余额。 积分余额 警告 健康接口不再读取云端积分余额，避免系统首页被外部授权/网络拖慢。 需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。 AI 回复模型 警告 默认模型配置不在快
- runtimeSurface: 执行器 — nning (pid=93271, profile=shared, visible=true) 浏览器引擎 详情 警告 基础能力 真实互动执行器 快速健康检查不下发真实互动任务；完整 预检 会检查各平台 executor。 查看 /local-engine/预检 的完整 executor 结果。 详情 警告 基础能力 执行入口 已注册 Run
- internalMode: readiness — nning (pid=93271, profile=shared, visible=true) 真实互动执行器 警告 快速健康检查不下发真实互动任务；完整 readiness 会检查各平台 executor。 执行入口 警告 已注册 RuntimeOrchestrator，但快速检查不证明真实读写发送回读成功。 查看 /local-engine/readiness 的完整 executo
- devPlaceholder: 模型配置 — 余额，避免系统首页被外部授权/网络拖慢。 需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。 AI 回复模型 警告 默认模型配置不在快速健康检查里读取；需要生成回复时由具体任务和完整检查确认。 默认模型配置 警告 已跳过数据库和模型平台检查；真实 AI 任务会在执行前校验模型授权。 到模型配置或完整运行检查确认文章创作/选题/互动回复模型是否已同步。

### /commercial-readiness

- Final URL: http://127.0.0.1:3010/commercial-readiness
- Status: loaded
- commercialLeak: tenant — 制/安全限制/安全限制；真实 授权/read-only sandbox 进入下一阶段。 多组织隔离 已建立持久化默认组织和成员关系，但业务表还没有全面迁到 tenantId 待加固 下一步：把 CRM、应用市场、增长任务从 userId 逐步迁到 tenantId + actorUserId 双维度 支付与计费回调 已处理签名支付 企业微信连接地址，并形成 active 订阅与组织授权

### /local-engine

- Final URL: http://127.0.0.1:3010/local-engine
- Status: loaded
- skillSurface: 插件与技能 — 程接管不是当前本机执行必需条件。 用户接管审计 通过 Agent 会话已保留接管审计字段。 本机任务按当前电脑的浏览器、桌面微信和发布执行器状态判断。 插件与技能运行时 未开放/可选 插件和技能目录不在快速健康检查里做磁盘扫描，避免启动页卡顿。 插件目录 未开放/可选 快速健康检查已跳过目录扫描。 插件运行 未开放/可选 插件执行不影响当前内容生产和客户互动主流程。 需要诊断插
- apiSurface: 接口 — 授权有效期由完整检查或真实扣点动作确认。 本地登录态 警告 本地会话已绑定 Kaypal 用户 cmo9p6i5x000a58uckbcyv45u；未在健康接口中请求云端余额。 积分余额 警告 健康接口不再读取云端积分余额，避免系统首页被外部授权/网络拖慢。 需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。 AI 回复模型 警告 默认模型配置不在快
- runtimeSurface: 执行器 — nning (pid=93271, profile=shared, visible=true) 浏览器引擎 详情 警告 基础能力 真实互动执行器 快速健康检查不下发真实互动任务；完整 预检 会检查各平台 executor。 查看 /local-engine/预检 的完整 executor 结果。 详情 警告 基础能力 执行入口 已注册 Run
- internalMode: readiness — nning (pid=93271, profile=shared, visible=true) 真实互动执行器 警告 快速健康检查不下发真实互动任务；完整 readiness 会检查各平台 executor。 执行入口 警告 已注册 RuntimeOrchestrator，但快速检查不证明真实读写发送回读成功。 查看 /local-engine/readiness 的完整 executo
- devPlaceholder: 模型配置 — 余额，避免系统首页被外部授权/网络拖慢。 需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。 AI 回复模型 警告 默认模型配置不在快速健康检查里读取；需要生成回复时由具体任务和完整检查确认。 默认模型配置 警告 已跳过数据库和模型平台检查；真实 AI 任务会在执行前校验模型授权。 到模型配置或完整运行检查确认文章创作/选题/互动回复模型是否已同步。

