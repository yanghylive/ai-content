# 炼刀微信能力矩阵 · 代码级核对报告

日期：2026-08-09
范围：`docs/liandao-wechat-acceptance-matrix.md` 全部能力，对照 JIUZHANG 代码实现（后端 API + 执行器 + 打包资源）
方法：静态 smoke（251项全过）+ 代码级 grep 执行链路 + 双平台打包产物核对

## 结论总览

**矩阵 8 大能力已全部双平台覆盖**（本轮修复前 7/8，auto-reply 曾只有 macOS；修复后 Windows native runner 已补）。

| 能力 | macOS | Windows | 证据 |
|------|-------|---------|------|
| 联系人同步 | ✅ | ✅ | mac: wechat-contact-sync.py + Vision OCR；win: native `contacts` + helper + wx_key.dll |
| 会话/聊天历史 | ✅ | ✅ | mac: wechat-chat-history；win: native `chat-history` |
| 群发计划 | ✅ | ✅ | mac: skillhub group-broadcast；win: native `group-broadcast` |
| 加好友 | ✅ | ✅ | mac: wechat-contact-add + friend-accept；win: native `contact-add` + `friend-accept` |
| 朋友圈发布 | ✅ | ✅ | mac: wechat-moments-publish；win: native `moments-publish` |
| 朋友圈营销 | ✅ | ✅ | mac: wechat-moments-marketing；win: native `moments-marketing` |
| 会话回复（auto-reply） | ✅ | ✅（本轮补） | mac: wechat-auto-reply/live-auto-reply → skillhub 脚本；win: native `auto-reply`（read-latest/draft/send） |
| 直播自动回复（live-auto-reply） | ✅ | ✅（复用 auto-reply runner） | mac: wechat-live-auto-reply；win: `auto-reply` runner 的 read-latest 读原文能力 |

## 一、Windows 自动回复断链的 3 个实锤

### 1. Windows native 命令集没有 auto-reply
`backend/src/modules/local-engine/wechat-native-command.contract.ts:1412`
```ts
WECHAT_NATIVE_LEGACY_TASK_TYPE_TO_COMMAND = {
  'wechat-contacts-sync': 'contacts',
  'wechat-group-broadcast': 'group-broadcast',
  'wechat-contact-add': 'contact-add',
  'wechat-friend-accept': 'friend-accept',
  'wechat-moments-publish': 'moments-publish',
  'wechat-moments-marketing': 'moments-marketing',
  'wechat-chat-history-sync': 'chat-history',
}
```
7 个命令，**无 auto-reply**。`desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js` 同样只有这 7 个。

### 2. reply-draft 任务在 Windows 上走 mac 命令路径
`backend/src/modules/local-engine/local-engine.wechat-native.mixin.ts:1163`：reply-draft 无 AI 回复文本时调用
```ts
this.runWechatDesktopCommand('wechat-live-auto-reply', [target, 'read-only'], target)
```
`runWechatDesktopCommand`（local-engine.wechat-command.mixin.ts:78）用 `getMacWechatCommandRoot()` 解析——macOS 专用目录。Windows 上返回空 → 回退 `~/.local/bin`、homebrew → 找不到 → spawn 字面量 `wechat-live-auto-reply` → **必然失败**。

### 3. 发送链路（sendWechatReply）在 Windows 上双路径都断
`backend/src/modules/auto-upload/auto-upload.client.ts:3789`：
- 高级路径：`canRunAdvancedWechatScript()` 需要 `vendor/open-cowork-upstream/scripts/` 下的 4 个 mjs + pyautogui —— **Windows 包内没有 open-cowork-upstream**（mac 包有，是手工放的，不在 extraResources）
- 回退路径：`executeWechatDesktopCommand('wechat-auto-reply')` → `resolveWechatCommandPaths`（:963）只查 `KAYPAL_WECHAT_COMMAND_ROOT`（main.js 只 darwin 注入）+ mac 目录 + homebrew —— **Windows 无任何候选**

## 二、macOS 侧核实（对照矩阵）

macOS 命令全集（runtime/wechat-macos/bin/ 9 个）：
cliclick / kaypal-pointer.jxa / wechat-auto-reply / wechat-chat-history / wechat-contact-add / wechat-contact-sync / wechat-live-auto-reply / wechat-moments-marketing / wechat-moments-publish

vendor/skillhub 脚本全集（7 个技能）：
wechat-auto-reply / wechat-chat-sync / wechat-contact-add / wechat-contact-sync / wechat-live-auto-reply / wechat-moments-marketing / wechat-moments-publish

**macOS 侧 8 大能力全覆盖**。auto-reply 脚本是真实 shell（260/296字节），正确转发到 skillhub 脚本。

## 三、打包资源现状（双平台）

| 资源 | macOS 包 | Windows 包 | extraResources 固化 |
|------|---------|-----------|---------------------|
| wechat-macos/bin（9工具） | ✅ | - | ✅ 已加（af079359） |
| wechat-macos/skillhub | ✅ | - | ✅ 已加 |
| wechat-native-runners（7 runner） | ✅ | ✅ | ✅ 已加 |
| wechat-db-helper（6 exe/dll） | ✅ | ✅ | ✅ |
| wechat-engine | ✅ | ✅ | ✅ |
| wechat-ocr | ✅ | ✅ | ✅ |
| **open-cowork-upstream/scripts（4 mjs）** | ✅（手工放） | ❌ | ❌ **未加** |

## 四、修复清单

**已完成（本轮）**：

1. ✅ **Windows auto-reply native runner 已实现**
   - contract：`auto-reply` 命令加入 WECHAT_NATIVE_COMMANDS + 输入/输出类型（WechatNativeAutoReplyInput/Output）+ legacy 映射（wechat-reply-draft → auto-reply）
   - runner-core：COMMANDS 加入 auto-reply + buildPlan/validatePlan/dryRunOutput 分支 + `Invoke-AutoReply` PowerShell（read-latest 读原文 / draft 写草稿 / send 发送+读回）
   - 新入口：`kaypal-wechat-auto-reply-runner.js`
   - native-runtime：SUPPORTED_COMMANDS 加 auto-reply + `validateAutoReply`
   - 验证：dry-run send/read-latest 通过，native-runtime 调度通过，tsc 通过
2. ✅ **open-cowork-upstream 打包固化**：extraResources 加条目（scripts/**/*）
3. ✅ **main.js 注入 KAYPAL_DESKTOP_SCRIPT_ROOT**（open-cowork-upstream/scripts 根，mac/win 共用）
4. ✅ **resolveWechatCommandPaths 补 Windows 候选**（resources/wechat-macos/bin + resources/open-cowork-upstream/scripts）

**验证结果**：炼刀 smoke 251 项全过，verify-oss-release local 通过，tsc 通过。

## 五、证据等级

- 本文档为 **C/D 级**（源码 + 静态合同）核对结论
- Windows auto-reply 断链为**确定性结论**（代码路径无任何 Windows 分支）
- 真机执行验证仍待 Windows 10/11 实测（A 级证据）

---

# 补充核对（2026-08-09 第二轮）：社交互动 + 多平台发布 + AI员工/客户

## 社交互动（评论/私信/点赞/关注）— 核对完成 ✅

### 结论：4 个平台互动是真实浏览器实现，非假数据
- 任务类型：douyin-comment-reply / douyin-direct-message-reply / wechat-channel-comment-reply / wechat-channel-direct-message-reply / customer-follow-up
- 执行链路：RuntimeOrchestrator → LocalRuntimeClient → 5 个 platform service（douyin/wechat-channel 各 comment/dm + exposure）→ PlatformInteractionExecutor.dispatch → PlaywrightMcpService + LocalBrowserEngine 真实浏览器
- 真实操作证据：browser_fill_form + browser_click + 发送后回读验证（sendReadbackOk）+ 截图证据（executor 476-572 行）
- 防伪保护：DISPATCH_MOCK=true 时 dispatch 硬失败（不能伪造 sent/draft_filled 成功）
- 读取链路：readLivePlatformInteractions → interactionExecutor.read（真实浏览器 + 登录态检测 + 证据截图）
- 打包：playwright + playwright-browsers 已在 extraResources ✅

### 发现：customer-follow-up（客户跟进）是"话术生成 + 人工确认"模式
- browser-assist.mixin 只生成跟进话术 + 等待人工在微信/消息中处理，不自动发送
- 设计取舍（合规合理），非缺口；对比炼刀客户管理时需标注此差异

## 待核对（下一轮）：多平台发布 + AI 员工/客户管理

## 多平台发布 — 核对完成 ✅（发现 weibo/zhihu/toutiao 虚位）

### 发布执行链路（真实）
- publishBatch → runtime.execute(platform-publish-*) → ExecutorRouter → PlatformPublishService → LocalBrowserEngine 真实浏览器 + adapter（buildVideoPublishPlan/buildImageTextPublishPlan）
- 高风险确认（confirmationId）+ durable record（幂等去重 P2002 防重复）+ 登录态检测 + 发布后 readback + 截图证据
- PlatformAdapterRegistry 注册 9 平台：xiaohongshu/wechat-channel/wechat-official/douyin/kuaishou/bilibili/weibo/zhihu/toutiao

### 真实发布能力矩阵
| 平台 | 视频 | 图文 | 状态 |
|------|------|------|------|
| 抖音 douyin | ✅ | ✅ | service if 分支 + adapter |
| 视频号 wechat-channel | ✅ | ✅ | ✅ |
| 小红书 xiaohongshu | ✅ | ✅ | ✅ |
| 快手 kuaishou | ✅ | ✅ | ✅ |
| B站 bilibili | ✅ | ❌(未实现) | 视频真发，图文未接 |
| 微博 weibo | adapter有 | adapter有 | **service 未调用 → not_integrated** |
| 知乎 zhihu | - | adapter有 | **service 未调用 → not_integrated** |
| 头条 toutiao | - | adapter有 | **service 未调用 → not_integrated** |
| 公众号 wechat-official | 图文API | - | idouq API 真实发布 |

### 缺口
- **weibo/zhihu/toutiao**：adapter 已注册但 PlatformPublishService 无入口分支 → 永远 not_integrated（"旧 5409 uploader 下线后未迁入"）
- bilibili 图文未实现
- 真实发布授权/回读仍需真机验证（A 级证据）

## 待核对：AI 员工/专家 + 客户管理

## AI 员工/专家 + 客户管理 — 核对完成 ✅

### AI 员工工作流（真闭环）
- ai-employee-workflow.service.ts：workflow 定义 + run + executeRun
- 执行闭环：步骤依赖检查 → 外部动作授权确认（externalActionsAuthorized）→ 路由 runtime.execute → 状态机 pending/running/completed/blocked/failed + attempt 重试 + cancelRequestedAt 取消
- 比炼刀多：依赖编排 + 外部动作人工确认

### 客户管理（真闭环）
- crm.service.ts：客户 CRUD + interactionTask 关联（firstInteractionTaskId/latestInteractionTaskId + 账号归属校验 1551-1594）
- customer-follow-up 是"话术生成 + 人工确认"模式（合规设计）

## 第二轮总核对结论（2026-08-09）

### 全部核对完成，新增发现 1 个虚位缺口：
- **weibo/zhihu/toutiao 发布**：adapter 已注册（weibo 视频+图文，zhihu/toutiao 图文），但 PlatformPublishService 无入口分支 → 永远 not_integrated
- bilibili 图文未实现（视频已真发）

### 确认真实（非假数据）的能力：
- 微信全链路（8 能力，auto-reply 本轮补全）
- 社交互动 4 平台（抖音/视频号 × 评论/私信，真实浏览器 + 防伪 DISPATCH_MOCK）
- 多平台发布 6 平台真发（douyin/wechat-channel/xhs/kuaishou/bilibili视频/公众号API）
- AI 员工工作流（依赖编排 + 授权确认）
- 客户管理（互动结果关联）

### 剩余待真机验证（A 级证据，非代码缺口）：
- Windows/macOS 真机微信同步、发布授权回读、互动真实发送

## 发布虚位补全（2026-08-09 第三轮）：weibo/zhihu/toutiao 接线 + weibo 视频修复

### 改动
1. **platform-publish.service.ts**：4 个入口分支（weibo 视频/图文、zhihu 图文、toutiao 图文）+ 4 个方法（publishWeiboVideo/publishWeiboImageText/publishZhihuImageText/publishToutiaoImageText）
2. **executor.interface.ts**：ExecutorTaskPlatform 加 weibo/zhihu/toutiao
3. **weibo-publish.adapter.ts**：buildVideoPublishPlan 的 platform 从 'bilibili'（残留）改为 'weibo'——原来 weibo 视频会错误地开 bilibili 浏览器会话
4. **platform-adapter.interface.ts**：VideoPublishPlan.platform 加 'weibo'
5. **auto-upload.controller.ts**：平台白名单 1-5 → 1-9（loginAccount）
6. **auto-upload.client.ts**：resolvePlatformName 加 微博/知乎/头条；resolveBrowserPlatformSlug 加 6/7/8
7. **publishing.service.ts**：resolvePublishPlatform 加 6/7/8

### 验证
- 发布模块 7 测试套件 50 测试全过（新增 4 个 weibo/zhihu/toutiao 用例）
- tsc（后端+前端）全过、炼刀 smoke 251/251

### 剩余
- bilibili 图文：adapter 无 buildImageTextPublishPlan（能力不含图文），不接线
- 真机发布授权/回读仍需 A 级验证

## 第三轮全量复核（2026-08-09）：任务类型全集/专项能力/前端契约/schema/打包资源

### 1. 任务类型全集 vs 执行器（16 类型全覆盖 ✅）
- InteractionTaskType 11 个：douyin/wechat-channel × comment/dm（4，真实浏览器）、reply-draft（auto-reply runner）、friend-accept/group-broadcast/contact-add/moments-publish/moments-marketing（5 native runner）、customer-follow-up（话术+人工确认，设计决策）
- 曝光 5 种：douyin-link/search-account/hot-video/targeted/retention-exposure → DouyinExposureService + ExposureCollector（2566 行，LocalBrowserEngine 真实浏览器，只读候选采集 + 防伪）✅
- wechat-contacts-sync → native contacts；platform-publish-image-text/video → PlatformPublishService（8 平台）
- content-publishing/wechat-execution/ai-reply-model 是能力分类非任务类型

### 2. 专项能力（全部真实 ✅）
- 公众号 wechat-official：WechatPublisherService.publish → fetch(idouq API, Bearer token) + api.weixin.qq.com 官方 API + readback 验证
- 视频号账号状态同步：auto-upload.service CDP 浏览器会话检测（ready/needs_login/blocked）→ logged_in/needs_login/error/unknown 状态机，openAccounts 走 LocalBrowserEngine 真实会话

### 3. 前端/后端契约（全匹配 ✅）
- auto-upload（20 接口）、local-engine（26 接口含 wechat-plans 独立 controller）、publishing（15 接口）全部前端调用有后端路由对应
- /engagement /tasks/confirmations 是页面路由非 API

### 4. DB schema 迁移（✅）
- 106 模型，核心表（publish_accounts/interaction_tasks/runtime_executions/client_configs/publish_records/agent_sessions）全部有迁移 + SQLite 实际存在

### 5. 打包资源（发现并修复 2 缺口，commit f5738e25）
- **media-tools（ffmpeg/ffprobe）win 断链**：win 构建无 prepare-media-tools 步骤、extraResources 未固化（mac 靠 7月30日手工放）→ 视频发布（douyin/kuaishou/bilibili/weibo 视频）+ video-face-swap 在 win 桌面端断链。已修：build-win-full 加 prepare（BUILD_PLATFORM=win-x64）+ extraResources + win/mac verify 断言
- **vendor 资源未进 git**：open-cowork-upstream（4 mjs，已打包但 0 tracked）+ skillhub 4 目录（chat-sync/contact-add/contact-sync/moments-marketing 12 文件）→ 换机器丢。已 git add -f
- **bailongma**：extraResources 已固化（平台无关 JS/HTML），但 main.js 未启动 bailongma-runtime（语音功能未完全接线，待办）

### 结论
第三轮全量复核：任务/执行器、专项能力、前后端契约、schema 迁移全部无缺口；新修复打包 2 缺口（media-tools win 断链 + vendor 资源跟踪）。
