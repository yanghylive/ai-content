# 视频工坊 + AI员工 78项商用浏览器验收状态

时间：2026-06-17 10:12 PT

## 本轮修复

- 修复 AI员工侧栏“视频号评论”死入口：可见入口从 `/workbench/channel-comments` 改为 `/workbench/wechat-channel-comments`。
- 新增 `/workbench/wechat-channel-comments` 真实工作台页，复用视频号评论真实任务类型 `wechat-channel-comment-reply`。
- 兼容入口 `channel-comments` 的本机运行检查跳转改到新稳定路径。
- 修复 P2 群发间隔 `0` 秒被误判为无效的问题，并补后端单测。

## 已验证通过

- 前端构建：`frontend npm run build` 通过。
- 后端单测：`backend npm test -- ai-employee.service.spec.ts --runInBand` 通过，37 项通过。
- 关键路由 HTTP 检查全部 200：
  - `/apps/ai-employee`
  - `/video-workshop`
  - `/distribution?tab=video`
  - `/workbench`
  - `/workbench/douyin-comments`
  - `/workbench/douyin-messages`
  - `/workbench/wechat-channel-comments`
  - `/workbench/channel-messages`
  - `/interaction/wecom-assistant`
  - `/local-engine`
- 浏览器新标签验证通过：
  - `/apps/ai-employee`
  - `/workbench/wechat-channel-comments`
  - `/workbench/channel-messages`
  - 页面内不再出现旧死链 `/workbench/channel-comments`。
- 视频工坊 1-15 项主闭环已跑通：
  - 生成成片 `browser-commercial-78-1781708628719.mp4`
  - ffprobe 显示 mp4、时长 5.061995 秒、大小 5413837 字节
  - 模板/参数/搜索/筛选/复制路径/分镜脚本日志/去发布均有浏览器证据
- 抖音获客读取已跑通：
  - 爆款视频、链接曝光、搜索账号、定向、留资模式均返回候选或可解释结果
  - 跟进计划能生成高意向筛选、跳过原因和话术
- 聚合发布真实发出：
  - 抖音发布结果成功 1/1
  - 发布回读 `readbackOk: true`
  - 平台地址：`https://creator.douyin.com/creator-micro/content/manage?enter_from=publish`
- 微信桌面链路已真实执行：
  - 微信会话回复：completed，已发送给 `KayPal (4)`
  - 微信群发：completed，成功 1，失败 0
  - 朋友圈发布：completed，已执行发表
  - 朋友圈固定营销：completed，成功 1，失败 0
  - 朋友圈 AI 营销：completed，成功 1，失败 0
  - 执行记录和证据数量满足 P2 绝大多数项目

## 真实阻塞

- P2 还不是 ready：`ai-p2-readiness-final-after-restart.json` 显示 `status: blocked`，唯一 blocker 是加好友计划。
- 自动加好友失败：
  - 任务 `le_mqia04yr_0ys9rp`
  - 状态 `failed`
  - 原因：`自动加好友没有任何对象处理成功：失败 1 个。`
  - 当前目标是 `KayPal (4)`，它是已存在会话/联系人，不是可加好友的新对象。
- 抖音评论真实发送失败：
  - 任务 `le_mqia0cc9_387roh`
  - 状态 `failed`
  - 原因：`抖音目标评论不存在或已被删除`
  - 执行器回读：`未找到目标评论行或评论行回复按钮`
- 抖音私信真实发送未完成：
  - 当前创建任务停留在等待/失败链路，原因是没有真实可达私信会话。
  - 已有候选多为搜索结果或页面噪声，不能冒充可发私信对象。
- 任务暂停/恢复/继续没有在“运行中的真实任务”上完整验收：
  - 跳过已证明：`control-skip-retry-douyin-comment.json`
  - 重试失败原因已证明可记录
  - 暂停/恢复/继续在已失败任务上调用不会形成有效商用闭环

## 当前结论

P0-P3 的功能入口、视频工坊、发布、微信回复、群发、朋友圈运营、证据链大部分已跑通；但 78 项还不能判定全部商用通过。

未通过的真实闭环集中在：

1. 一个可加好友的新微信测试对象。
2. 一个抖音真实可回复评论行。
3. 一个抖音真实可达私信会话。
4. 在真实运行任务上的暂停/恢复/继续验收。

这些不能用 mock、合成目标或“按钮存在”替代。

## 2026-06-17 10:31 PT 追加修复与复验

### 新修复

- 修复任务控制状态机：暂停不再把未处理对象标成“已跳过”，而是保持 queued，避免把未执行目标误计入跳过。
- 修复恢复动作：恢复 paused 任务后会重新进入 queued 并重启真实生命周期，不再只是改状态文本。
- 继续动作现在可基于真实未处理对象创建后续任务；跳过/重试仍保留证据链和来源任务 ID。

### 新增验证证据

- API 级任务控制回归：`task-control-api-regression-1781717221349.json`
  - pauseKeptQueuedNotSkipped: true
  - resumeRestartedLifecycle: true
  - pauseAgainKeptTargets: true
  - continueCreatedNewTask: true
  - skipRecordedSkipped: true
  - retryCreatedNewTask: true
- 浏览器页面级复验：`ai-employee-browser-page-after-control-fix-corrected-1781717477341.json`
  - AI员工页已加载，不再停在登录验证。
  - 视频工坊、爆款视频获客、微信客户跟进、自动加好友、朋友圈运营、聚合发布、任务记录均可见。
  - 暂停、恢复、继续、跳过、重试控制项均可见。
  - 旧可见死链 `/workbench/channel-comments` 数量为 0。
  - 新视频号评论入口 `/workbench/wechat-channel-comments` 数量为 1。
- 前端构建：`frontend npm run build` 通过，55 个页面生成通过。
- 后端构建：`backend npm run build` 通过。
- 后端单测：
  - `backend npm test -- local-engine.business-task-type.spec.ts --runInBand` 通过，30 项通过。
  - `backend npm test -- ai-employee.service.spec.ts --runInBand` 通过，37 项通过。

### 当前仍不能判定 78/78 商用通过的点

- 自动加好友真实发送仍需要一个“未成为好友、可被搜索/添加”的微信测试对象；当前 `KayPal (4)` 是已有会话/联系人，不是可加好友新对象。
- 抖音评论真实发送仍需要一个当前后台可见且带回复按钮的真实评论行；已有失败原因是目标评论不存在/页面未找到回复按钮。
- 抖音私信真实发送仍需要一个真实可达私信会话；已有候选不能冒充可发送对象。
- 控制项本轮已用真实 3011 API 和浏览器记录验证通过；但如果要把“暂停运行中的外部平台真实发送任务”也列入商用实发验收，还需要上述抖音/微信真实目标先可用。

## 2026-06-17 11:31 PT 追加修复与复验

### 新修复

- 修复抖音图文聚合发布：图文发布不再误停在“发布视频”页，会先切到“发布图文”标签，再使用图片上传入口。
- 修复抖音图文发布设置：发布前自动关闭“同时发布到番茄小说/红果短剧”，处理自主声明区域，滚动到底部后点击真正的“发布”按钮。
- 修复抖音图文回读：不再把“重新检测”按钮本身当失败；以管理页 URL、发布成功提示或明确失败文案作为判定。
- 发布执行器新增单测覆盖抖音图文链路。

### 新增验证证据

- 抖音图文真实发布：`auto-upload-real-image-publish-result-1781719320573.json`
  - total: 1
  - success: 1
  - failed: 0
  - publishUrl: `https://creator.douyin.com/creator-micro/content/manage?enter_from=publish`
  - readbackOk: true
- 78 项逐项矩阵：`acceptance-78-status-matrix-1781719437782.json`
  - pass: 73
  - blocked: 5
  - missingEvidence: 0
- 浏览器页面回归：`browser-regression-after-image-publish-fix-1781719522884.json`
  - AI员工、视频工坊、发布页均无控制台错误。
  - 主内容区无开发文档用语。
  - 可见旧死链 `/workbench/channel-comments` 为 0。
- 可见链接回归：`visible-link-http-check-after-image-publish-1781719549918.json`
  - checked: 103
  - failureCount: 0
- 前端构建：`frontend npm run build` 通过，55 个页面生成通过。
- 后端构建：`backend npm run build` 通过。
- 后端单测：
  - `backend npm test -- platform-publish.service.spec.ts --runInBand` 通过，11 项通过。
  - `backend npm test -- local-engine.business-task-type.spec.ts --runInBand` 通过，30 项通过。
  - `backend npm test -- ai-employee.service.spec.ts --runInBand` 通过，37 项通过。

### 当前剩余 5 个阻塞项

- 34 抖音评论跟进任务：需要真实可见且带回复按钮的抖音评论行。
- 35 抖音私信跟进任务：需要真实可达抖音私信会话。
- 36 P1准备检查：P1 读取和计划已通，但评论/私信真实发送未完成，所以不能 ready。
- 46 自动加好友任务：需要未成为好友、可搜索/可添加的微信测试对象。
- 78 P2微信任务检查：P2 仍被自动加好友目标阻塞。

## 2026-06-17 13:10 PT 追加修复与商用门禁复验

### 新修复

- 修复账号校验慢路径：已有持久浏览器 profile 登录态时，不再先走慢 cookie 文件校验；`/api/auto-upload/accounts?validate=true&force=true` 已降到秒内返回。
- 修复旧视频号评论入口：`/workbench/channel-comments` 和尾斜杠访问均稳定到可用页面，不再 308/旧死链。
- 修复浏览器任务结果归类：Runtime 返回 `target_not_found/comment_missing/message_missing/no_target` 时，任务状态归为 `no_target`，不再误记 `failed`。
- 收紧后端高风险风控：
  - `/auto-upload/publish` 无 `riskConfirmation` 时必须被后端风控阻断。
  - `/local-engine/evidence/cleanup` 和 `/auto-upload/interaction/evidence/cleanup` 无确认时不能删除证据。
  - `/local-engine/wechat/session/takeover` 无确认时不能接管桌面微信。
  - 对象存储远程测试必须带确认，避免无确认使用云密钥做远程上传/删除探测。
- 修复商用门禁脚本误报：
  - 发布接口返回 `platforms` 逐平台结果时也视为可审计结果。
  - 平台账号未登录、素材/权限/平台状态导致的真实发布阻断归 `BLOCKED`，不再误报 `FAILED`。
  - 真实任务状态 `blocked` 作为终态处理，不再轮询 90 次后误报超时 `FAILED`。

### 新增验证证据

- 后端单测：
  - `backend npm test -- auto-upload.service.spec.ts local-engine.business-task-type.spec.ts storage.service.spec.ts --runInBand` 通过，53 项通过。
- 前端类型检查：
  - `frontend npx tsc --noEmit --pretty false` 通过。
- 构建：
  - `backend npm run build` 通过。
  - `frontend npm run build` 通过，55 个页面生成通过。
- 商用门禁非真实授权复验：
  - 报告：`docs/acceptance-evidence-2026-06-17/rerun-78-final-nonreal-0918/commercial-acceptance-2026-06-17T20-08-24-605Z.json`
  - Summary：PASS=55，WARN=2，BLOCKED=5，FAILED=0。
- 商用门禁真实授权快速复验：
  - 报告：`docs/acceptance-evidence-2026-06-17/rerun-78-real-fix-quick-0910/commercial-acceptance-2026-06-17T20-05-49-504Z.json`
  - Summary：PASS=65，WARN=2，BLOCKED=11，FAILED=0。
- 商用门禁真实授权完整 5 条内容链路：
  - 报告：`docs/acceptance-evidence-2026-06-17/rerun-78-real-082140/commercial-acceptance-2026-06-17T19-57-25-027Z.json`
  - 内容生产到发布中心 5/5 跑通，生成并导入 5 条小红书内容。
  - 该轮暴露的脚本误报已在上面的快速复验中修正为 FAILED=0。

### 当前剩余真实阻塞

- 视频号账号不 ready：发布账号/客户互动检查已刷新出视频号缺少可用登录态，需要重新登录或校验视频号账号。
- 抖音发布账号未登录：真实发布被平台账号状态挡住，结果为 `login_required`，需要到平台账号页重新登录后再发布。
- 抖音评论/私信没有可处理目标：真实读取链路能执行并留证据，但当前没有可回复评论行/可达私信会话，自动发送 0/1 或 0/5 只能 BLOCKED。
- 桌面微信需要手机确认登录并整理唯一目标会话：当前微信停在“需在手机上完成登录”，且历史 preflight 检测到 `搜索聊天记录、微信、朋友圈、图片和视频、微信 (窗口)` 多窗口，不能算唯一目标会话。

### 当前结论

代码级 bug 本轮已清到商用门禁 `FAILED=0`。剩下不是前端入口或后端接口 bug，而是真实外部账号/测试对象条件：

1. 登录视频号账号。
2. 重新登录可发布的抖音创作者账号。
3. 准备真实可回复抖音评论和真实可达抖音私信会话。
4. 手机确认桌面微信登录，并把微信停在唯一测试会话窗口。

## 2026-06-17 13:54 PT 追加修复与真实账号复验

### 新修复

- 收紧账号 ready 判定：本地持久 profile 不再直接等于已登录；必须进入平台后台页面后才算 ready。
- 修复视频号 stale profile 假绿：当前 CDP 页面停在 `channels.weixin.qq.com/login.html` 时，`/auto-upload/accounts?validate=true&force=true` 和 `/local-engine/browser/status` 都返回“需要重新登录”。
- 修复抖音互动页假绿：抖音 URL 在 `/interactive/comment` 不再单独作为已登录依据；如果最近一次真实读取返回“扫码登录/账号未登录”，账号状态会立即变成“需要重新登录”。
- 浏览器账号状态新增 `unverified`：重启后只有本地 profile、尚未打开平台后台时，前端显示“待确认登录”，不会让真实评论/私信按钮继续误用。

### 新增验证证据

- 后端单测：
  - `backend npm test -- auto-upload.client.spec.ts local-engine.browser-status.spec.ts --runInBand` 通过，21 项通过。
- 构建：
  - `backend npm run build` 通过。
  - `frontend npm run build` 通过，55 个页面生成通过。
- 状态收紧验证：
  - 重启后未确认平台页时，抖音/快手/小红书显示 `待确认登录`，不再假绿。
  - 打开平台后台后，抖音/快手/小红书显示 ready，视频号仍为 `需要重新登录`。
  - 触发一次抖音评论真实读取后，页面实际落到扫码登录状态，`/auto-upload/cdp-sessions` 和 `/local-engine/browser/status` 立即把抖音改为 `needs_login`。
- UI 浏览器入口检查：
  - `scripts/ui-acceptance-browser.mjs` 页面层打开 18 项通过。
  - API flow 暴露抖音评论读取失败：`抖音账号未登录：抖音账号未登录，不能读取或回复。`
  - 修复后该失败会同步反映到账号状态，前端不再继续把抖音评论账号当可用。
- 商用门禁真实开关复验：
  - 报告：`docs/acceptance-evidence-2026-06-17/rerun-78-real-tight-status-autosend-1341/commercial-acceptance-2026-06-17T20-46-30-337Z.json`
  - Summary：PASS=65，WARN=2，BLOCKED=11，FAILED=0。
  - 内容生产到发布中心快速真实链路 1/1 跑通，生成文章并导入 6 个素材。

### 当前剩余真实阻塞

- 抖音账号需要重新登录：真实评论读取页显示扫码登录，真实发布也返回 `login_required`。
- 视频号账号需要重新登录：当前停在 `https://channels.weixin.qq.com/login.html`。
- 桌面微信需要确认唯一目标会话：preflight 仍为 `无法确认当前前台窗口是唯一微信目标会话`。
- 抖音评论/私信需要真实可处理目标：已有任务能留证据，但当前没有可回复评论行或可达私信会话，自动发送只能 `no_target`。

## 2026-06-17 14:42 PT 继续测试与脚本口径修复

### 新修复

- 修复 UI smoke 脚本口径：页面/入口 smoke 不再把真实账号未登录、无评论/私信对象这类环境阻断误报成前端 `FAIL`。
- `scripts/ui-acceptance-browser.mjs` 现在遇到抖音/视频号账号不 ready 时记 `WARN` 并跳过真实互动 API，继续验证 Agent 会话、确认队列和发布确认保护。
- 保留商用门禁脚本的严格口径：真实账号缺失、真实对象缺失仍在 `commercial-acceptance-gate.mjs` 中记为 `BLOCKED`，不算通过。

### 新增验证证据

- UI 浏览器 smoke 全流程：
  - 命令：`COMMERCIAL_COOKIE_FILE=/tmp/ai-content-acceptance-78-20260617.cookie SMOKE_UI_TIMEOUT_MS=30000 SMOKE_INTERACTION_TASK_ATTEMPTS=30 node scripts/ui-acceptance-browser.mjs`
  - Summary：PASS=21，WARN=1，FAIL=0。
  - WARN：抖音账号当前不 ready，跳过真实互动任务 API。
- 微信会话自动对齐测试：
  - 目标：`文件传输助手`
  - 结果：未锁定，`alignment.ok=false`，stage=`ambiguous`。
  - 证据：`/tmp/ai-content-wechat-align-1781732516.png`
  - 原因：检测到 2 个微信窗口，前台为 `对话框`，截图/OCR 被其它窗口内容干扰，不能确认唯一目标会话。
- 后端单测：
  - `backend npm test -- auto-upload.client.spec.ts local-engine.browser-status.spec.ts --runInBand` 通过，21 项通过。
- 构建：
  - `backend npm run build` 通过。
  - `frontend npm run build` 通过，55 个页面生成通过。
- 商用门禁当前阻断复验：
  - 报告：`docs/acceptance-evidence-2026-06-17/rerun-78-current-blockers-1442/commercial-acceptance-2026-06-17T21-43-45-644Z.json`
  - Summary：PASS=56，WARN=2，BLOCKED=5，FAILED=0。

### 当前状态

- 当前 ready 平台账号只剩快手、小红书；抖音和视频号都需要重新登录。
- 当前桌面微信已登录并可检测，但未能确认唯一目标会话，不能自动填草稿/发送。
- 代码级验收仍保持 `FAILED=0`；阻断集中在真实账号登录和真实测试对象准备。
