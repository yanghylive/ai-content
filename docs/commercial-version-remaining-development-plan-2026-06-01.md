# AI Content 商用版剩余开发文档

更新时间：2026-06-01

## 结论

当前项目不能再按“看到哪里不好就补哪里”的方式推进。剩余工作要按商用主线收束：

```text
内容生产
  -> 发布中心
  -> 客户互动
  -> 本机运行 / 账号 / 权限 / 风控
  -> 商用验收
```

其中最紧急、最不能再跑偏的是客户互动。客户互动必须按 `docs/customer-interaction-cdp-persistent-browser-plan.md` 执行：

```text
固定 Chrome / Edge profile
  -> 本机 CDP 9223
  -> connect_over_cdp 接管同一个可见窗口
  -> AI 读取真实客户内容
  -> 默认自动发送
  -> 页面回读确认
```

现有代码里已经有一些真实平台动作经验可以复用，但不能继续把旧 browser bridge、临时上下文、任务记录、截图、假 completed 当商用结果。

## 当前真实状态

### 已有基础

- 前台主导航已经围绕四块展开：内容生产、发布中心、客户互动、系统设置。
- 内容生产已有素材、选题、文章、小红书笔记、视频工坊、内容规则入口。
- 发布中心已有图文发布、视频发布、发布素材、平台账号、计划任务入口。
- 客户互动已有抖音评论、抖音私信、视频号评论、视频号私信、客户跟进、回复规则、回复记录入口。
- 后端已有本地执行任务、任务阶段、发送模式、风险控制、待确认、执行证据等基础模型。
- `auto-upload` 已经能打开平台后台，抖音评论和私信已有真实发送动作经验。
- `commercial-acceptance-gate.mjs` 已经有严格阻断逻辑，空环境不会假通过。

### 主要问题

- 客户互动底座还没有严格按文档实现。当前 `auto-upload/main.py` 使用过 `launch_persistent_context`，不是最终要求的“系统 Chrome / Edge 进程 + CDP 接管同一可见窗口”。
- 后端 `backend/src/modules/auto-upload/auto-upload.client.ts` 仍保留抖音 `browserBridge...` fallback，失败时可能退回旧路线。
- 抖音私信和评论虽然有真实动作，但还没有在正确 CDP 底座上形成稳定商用闭环。
- 视频号评论和私信还没有按同一套 CDP 持久浏览器底座跑到稳定商用闭环。
- 微信会话、微信群发按当前阶段应隐藏，不作为一期验收目标；朋友圈发布已下线，不应再开发。
- 部分能力页仍是“系统能力说明 / 工程入口”，不是用户商用功能。
- 前台实时反馈还不够像真实工作台，用户看不清当前到底在打开哪个后台、读到谁、准备回什么、是否点了发送、是否回读成功。

## 开发红线

- 不再开发朋友圈发布。
- 不再把微信会话、微信群发作为一期客户互动目标；前台导航保持隐藏或弱化。
- 不再优化旧 browser bridge 作为客户互动主链路。
- 不再用“任务创建成功”“状态 completed”“写入记录”“截图存在”代表商用完成。
- 不再默认确认后发送。用户默认是自动发送，只有明确选择确认后发送或触发风控时才停。
- 不再把“无对象”当所有失败原因。接口加载失败、登录失效、验证码、网络失败、页面结构变更必须分开报。
- 不再优先做记录页、验收页、证据页美化。先保证真实平台动作能完成。

## P0：客户互动商用闭环

这是当前最高优先级。

### P0.1 CDP 持久浏览器底座

目标：替换客户互动主线里的临时浏览器和旧 bridge。

必须实现：

- 每个账号一个固定 profile：

```text
auto-upload/browser-profiles/douyin-{accountId}
auto-upload/browser-profiles/wechat-channel-{accountId}
```

- 启动或复用可见 Chrome / Edge / Chromium：

```text
--remote-debugging-port=9223
--remote-debugging-address=127.0.0.1
--user-data-dir=<profileDir>
```

- 自动化服务通过 `connect_over_cdp("http://127.0.0.1:<port>")` 接管已有浏览器。
- CDP 端口只监听 `127.0.0.1`。
- 用户可以在同一个窗口处理登录、扫码、验证码、滑块。
- 后端返回 `runtimeMode=cdp-attached-browser` 或同等明确字段，不能伪装。
- 如果 CDP 连接断开，任务失败并显示明确原因。

需要改的地方：

```text
/Users/yanghy/auto-upload/main.py
backend/src/modules/auto-upload/auto-upload.client.ts
backend/src/modules/local-engine/local-interaction-executor.service.ts
frontend/src/app/(dashboard)/workbench/*
```

必须删除或禁用：

- 抖音评论/私信的 `browserBridgeReadDouyin...`
- 抖音评论/私信的 `browserBridgeSendDouyin...`
- 自动 fallback 到旧 browser bridge 的逻辑

### P0.2 抖音评论

目标：商用闭环。

用户路径：

```text
/workbench/douyin-comments
  -> 选择抖音账号
  -> 开始
  -> 系统打开固定抖音后台窗口
  -> 读取真实评论
  -> AI 按评论内容生成回复
  -> 默认自动发送
  -> 页面回读确认
```

必须实现：

- 打开 `creator.douyin.com` 评论管理。
- 能选择有评论的作品。
- 过滤用户名、按钮文案、系统文案、已回复评论、展开回复等噪声。
- 只把真实客户评论交给 AI。
- 回复内容必须和评论相关，不能固定模板。
- 自动发送必须真实点击发送按钮。
- 发送后必须在页面看到回复内容或评论接口返回成功。
- 已回复对象不能重复回复。
- 回读不一致时任务失败，不能 completed。

验收：

- 连续 5 轮真实评论。
- 每轮回复内容和评论相关。
- 每轮真实发出。
- 每轮页面回读成功。

### P0.3 抖音私信

目标：最高优先级商用闭环。

必须实现：

- 打开抖音私信后台。
- 扫描 `全部 / 朋友私信 / 陌生人私信 / 群消息`。
- CDP Network 抓取 `imapi.snssdk.com`、`mcs.snssdk.com`、`creator.douyin.com/*/im`、`user_token`。
- 区分：
  - 真的没有私信
  - 私信列表持续加载
  - IM 接口超时
  - 账号登录失效
  - App 才能查看的新类型消息
  - 页面验证码或风控
- 读取客户最后一条真实私信。
- 过滤“请打开抖音 app 查看”、群名、联系人名、日期、系统通知、自己刚发出的回复。
- AI 按对方内容生成回复。
- 默认自动发送。
- 发送后回读会话最后一条，确认是系统刚发的回复。
- 已回复对象进入去重账本，避免重复回复。

验收：

- 连续 5 轮真实私信。
- 每轮识别客户原文。
- 每轮回复和客户内容相关。
- 每轮真实发送。
- 每轮回读最后一条为系统回复。

### P0.4 视频号评论

目标：复用 CDP 底座跑通商用闭环。

必须实现：

- 独立 `wechat-channel-{accountId}` profile。
- 打开 `channels.weixin.qq.com` 评论/互动后台。
- 登录、扫码、验证在同一可见浏览器处理。
- 读取真实评论。
- AI 按评论内容回复。
- 默认自动发送。
- 发送后回读确认。

验收：

- 连续 5 轮真实评论。
- 不把页面导航、作品标题、系统提示当评论。
- 真实发出并回读。

### P0.5 视频号私信

目标：复用 CDP 底座跑通商用闭环。

必须实现：

- 打开视频号私信/互动后台。
- 读取真实私信会话。
- 过滤系统文本、空状态、自己的历史回复。
- AI 按对方内容生成回复。
- 默认自动发送。
- 发送后回读。

验收：

- 连续 5 轮真实私信。
- 每轮有客户原文、AI 回复、发送结果、回读结果。

### P0.6 前台实时动作反馈

客户互动页面不能只显示“任务已启动”。

每个页面必须显示：

- 当前平台账号。
- 当前浏览器连接状态。
- 当前打开 URL。
- 当前步骤。
- 读取到的客户对象。
- 客户原文。
- AI 生成回复。
- 发送模式。
- 是否点击发送。
- 回读结果。
- 卡住原因和下一步。

推荐步骤文案：

```text
正在连接固定浏览器
已进入抖音后台
正在读取评论/私信
读到客户内容
正在生成回复
已点击发送
正在回读确认
发送成功 / 发送失败
```

## P1：发布中心商用闭环

发布中心已经有较多基础，但仍要按真实商用口径补齐。

### 图文发布

必须实现：

- 读取真实平台账号状态。
- 读取真实素材。
- 支持图文内容、标题、正文、标签、封面、平台参数。
- 真实发布前必须经过后端风险确认。
- 平台未登录、素材缺失、能力缺失时阻断。
- 真实发布成功后返回平台结果或页面回读证据。

验收：

- 抖音、小红书、视频号、快手、B 站中实际支持的图文平台至少各 5 轮。
- 失败原因分平台返回。

### 视频发布

必须实现：

- 真实视频素材上传。
- 标题、简介、标签、封面、平台参数。
- 上传进度、发布按钮、发布结果回读。
- 失败恢复和重试。

验收：

- 每个平台 5 轮真实测试账号发布。
- 不允许 dry-run 伪通过。

### 平台账号

必须实现：

- 本地版本用户应有账号删除权限，不能因为缺 SaaS 超管角色删除不了本地账号。
- 登录一次后，内容发布、客户互动、发布中心共享同一账号 profile。
- 账号过期时明确提示重新登录。
- 删除账号时清理本地 cookie/profile/头像/状态，但不破坏历史任务记录。

## P1：内容生产商用完善

内容生产主线相对完整，但还需要做商用品质收尾。

范围：

- 内容素材
- 选题库
- 文章库
- 小红书笔记
- 视频工坊
- 内容规则

剩余工作：

- 保证每个入口都不是空壳或演示数据。
- AI 生成失败时有明确原因。
- 素材采集失败时区分网络失败、源不可用、解析失败、模型失败。
- 文章、小红书笔记、视频脚本能直接进入发布中心。
- 删除、批量删除、默认规则切换等高风险动作走统一后端风控。
- 页面文案从工程描述改成用户价值描述。

验收：

- 从采集素材到生成选题、生成文章/笔记、进入发布中心，连续 5 条内容跑通。
- 不依赖 mock 数据。

## P1：权限、套餐和本地商用策略

当前用户关心的是本地自用版本，不能照搬 SaaS 超管逻辑。

必须实现：

- 本地管理员账号拥有本机账号、素材、任务、平台账号的完整管理权限。
- SaaS 角色和本地角色分离。
- 高风险动作需要确认，但不能让本地用户因为没有 `SUPER_ADMIN` 无法删除自己的本地账号。
- 套餐限制要清楚：
  - 免费 / 试用
  - 付费
  - 最好订阅号 / 旗舰账号
- 当前登录账号 `__REDACTED_TEST_USER__` 这类本地用户的订阅状态要能在后端真实配置，不能只前端显示。

验收：

- 本地管理员能删除本地平台账号。
- 普通用户被正确限制。
- 高风险动作有审计记录。

## P1：系统设置和运行检查

必须实现：

- 本地服务 5409 状态。
- 后端状态。
- 前端状态。
- 固定浏览器 CDP 状态。
- 平台账号 profile 状态。
- 桌面权限状态。
- 日志诊断下载。
- 一键修复或明确下一步。

验收：

- 断开 5409、CDP、账号过期、权限缺失时，前台都能显示真实原因。

## P2：工程入口和非一期能力处理

以下页面不是一期商用主线：

- `capabilities/memory`
- `capabilities/plugins`
- `capabilities/sandbox`
- `war-room`
- `about`
- `capabilities/models` 如果接口路径未修好也不应暴露给用户

处理原则：

- 不在主导航暴露。
- 如果保留页面，只给管理员/开发模式看。
- 页面文案必须说明“当前不在一期商用范围”，不能伪装成完整功能。
- 不要为了这些页面消耗一期主线时间。

## 验收总标准

商用完成只认真实闭环：

- 真实账号。
- 真实平台后台。
- 真实浏览器或真实桌面。
- 真实客户内容。
- AI 按内容生成回复。
- 默认自动发送。
- 页面或接口回读确认。
- 失败时明确失败原因。

不算完成：

- 创建任务成功。
- 状态 completed。
- 只写记录。
- 只截图。
- 只生成草稿。
- 只显示“无对象”但没有真实诊断。
- 使用 mock / dry-run / 临时浏览器假装商用。

## 建议实施顺序

### 第 1 天：客户互动底座

- 改 `auto-upload/main.py` 为固定 Chrome / Edge 进程 + CDP attach。
- 禁用后端抖音 browser bridge fallback。
- 浏览器 profile 和账号状态打通。
- 前台显示 CDP 连接状态。

### 第 2 天：抖音评论和私信

- 抖音评论迁到正确 CDP 底座。
- 抖音私信迁到正确 CDP 底座。
- IM 网络诊断补齐。
- 发送后回读和去重补齐。
- 各跑 5 轮。

### 第 3 天：视频号评论和私信

- 视频号评论迁到 CDP 底座。
- 视频号私信迁到 CDP 底座。
- 登录/扫码/验证同窗口处理。
- 各跑 5 轮。

### 第 4 天：前台反馈和发布中心补齐

- 客户互动实时动作反馈。
- 发布中心账号/profile 共享。
- 图文/视频真实发布失败矩阵。
- 本地账号删除权限修正。

### 第 5 天：全系统商用验收

- 内容生产 5 条链路。
- 发布中心真实发布矩阵。
- 客户互动四条主线各 5 轮。
- 权限、风控、日志、诊断。
- `commercial-acceptance-gate.mjs` 跑到 PASS 或明确 BLOCKED 原因。

## 文件级任务清单

### 自动化服务

```text
/Users/yanghy/auto-upload/main.py
```

- 抽出 CDP session runtime。
- 启动/复用固定系统浏览器。
- `connect_over_cdp` 接管。
- 保留抖音评论/私信已有可用 DOM 动作，但迁移到底座上。
- 视频号复用同一底座。
- 发送成功写去重账本。
- 失败返回明确诊断。

### 后端

```text
backend/src/modules/auto-upload/auto-upload.client.ts
backend/src/modules/local-engine/local-interaction-executor.service.ts
backend/src/modules/local-engine/local-engine.service.ts
backend/src/modules/auth/risk-control.ts
```

- 删除客户互动旧 browser bridge fallback。
- 强制客户互动走 CDP persistent browser 能力。
- 自动发送结果必须依赖真实回读。
- 本地管理员权限和 SaaS 角色拆开。
- 高风险动作保留审计，不阻断本地合法操作。

### 前端

```text
frontend/src/app/(dashboard)/workbench/douyin-comments/page.tsx
frontend/src/app/(dashboard)/workbench/douyin-messages/page.tsx
frontend/src/app/(dashboard)/workbench/channel-comments/page.tsx
frontend/src/app/(dashboard)/workbench/channel-messages/page.tsx
frontend/src/app/(dashboard)/sidebar-items.tsx
frontend/src/lib/api/local-engine.ts
```

- 客户互动四个页面显示实时动作。
- 默认自动发送。
- 只在用户选择确认后发送或风控触发时进入确认。
- 微信会话/群发/朋友圈不进一期主导航。
- 能力说明页不混进用户主线。

### 验收脚本

```text
scripts/commercial-acceptance-gate.mjs
scripts/smoke-local-integration.sh
scripts/ui-acceptance-browser.mjs
```

- Gate 增加 CDP 固定浏览器检查。
- Gate 检查客户互动 runtimeMode 不能是 browser bridge。
- Gate 检查每条发送有真实回读字段。
- Gate 保持缺真实账号时 BLOCKED，不假 PASS。

## 预计剩余时间

如果只做客户互动一期四条主线：

```text
最快：2 天
稳妥：3 天
```

如果把整个系统按商用版收尾，包括内容生产、发布中心、权限、前台体验和验收矩阵：

```text
最快：5 天
稳妥：7 天
```

前提：

- 本地抖音、视频号账号可用。
- Chrome / Edge 可启动并允许 CDP。
- 测试账号允许真实评论/私信回复。
- 发布测试账号和素材可用。

## 最重要的一句话

后续开发必须先把客户互动底座改正确，再复用已有平台动作逻辑。不能再在旧浏览器路线、记录页、证据页、工程说明页上消耗主线时间。
