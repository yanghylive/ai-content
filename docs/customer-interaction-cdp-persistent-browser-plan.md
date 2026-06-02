# 客户互动 CDP 持久浏览器商用方案

更新时间：2026-06-01

## 结论

客户互动的网页平台主线改为：

```text
真实用户前台操作
  -> 后端客户互动任务
  -> 平台账号和权限校验
  -> 持久可见浏览器
  -> CDP 9223 接管同一个浏览器
  -> AI 读取客户内容并生成回复
  -> 按发送模式真实点击发送
```

这套方案替代“每次任务临时拉 Playwright 浏览器 + cookie/storage_state”的主路径。原因很简单：抖音私信、视频号私信这类页面依赖完整浏览器环境、长期登录态、IM SDK、IndexedDB、WebSocket、风控状态和可见人工接管。只保存 cookie 不够。

朋友圈发布功能已下线，不再作为客户互动商用目标。

## 商用目标

客户互动只认真实结果：

- 抖音评论：读到真实评论，AI 按评论内容回复，真实发送出去。
- 抖音私信：读到真实客户私信，AI 按对方内容回复，真实发送出去。
- 视频号评论：读到真实评论，AI 按评论内容回复，真实发送出去。
- 视频号私信：读到真实私信，AI 按对方内容回复，真实发送出去。
- 微信会话：二阶段开发；当前前台导航隐藏。二阶段优先判断是否有可用网页版/后台，没有稳定网页能力时再走桌面控制。
- 微信群发：二阶段开发；当前前台导航隐藏。二阶段同样网页优先，桌面兜底。

下面都不算完成：

- 创建任务成功。
- 状态显示 completed。
- 只生成回复草稿。
- 只写执行记录。
- 只截图证明页面打开。
- 只返回“没有对象”，但没有说明真实读取失败原因。

## 设计原则

### 1. 固定浏览器，不临时开浏览器

每个平台账号绑定一个持久浏览器 profile：

```text
auto-upload/browser-profiles/
  douyin-{accountId}/
  wechat-channel-{accountId}/
  xiaohongshu-{accountId}/
```

账号首次登录时使用这个 profile。后续所有评论、私信、发布后台操作都复用同一个 profile。

### 2. 可见浏览器，不用 headless

浏览器必须是用户能看见的窗口：

```text
Chromium / Chrome / Edge
  --remote-debugging-port=9223
  --remote-debugging-address=127.0.0.1
  --user-data-dir=<profileDir>
```

禁止客户互动主链路使用 `--headless`。用户必须能看见系统在打开哪个后台、点哪个会话、发哪条回复。

### 3. CDP 控制同一个窗口

系统通过 CDP 连接 `http://127.0.0.1:9223/json`，接管当前可见浏览器。

CDP 用途：

- 打开平台后台。
- 点击、输入、发送。
- 读取 DOM。
- 截图。
- 抓网络请求。
- 抓 `imapi`、评论接口、私信接口失败原因。
- 遇到登录、滑块、扫码、短信验证时暂停，让用户在同一窗口处理。

### 4. 9223 只监听本机

`9223` 是浏览器调试端口，只允许本机访问，不允许公网暴露。

如果未来做远程浏览器或 noVNC，只开放用户可见入口，CDP 端口仍只给本机 Agent 使用。

### 5. 默认自动发送

用户默认模式是自动发送。

只有这些情况停下：

- 用户选择“确认后发送”。
- 目标不确定。
- 页面或账号状态不确定。
- 权限不够。
- 风控验证未过。
- AI 生成内容命中规则禁区。
- 发送按钮不可见或发送后回读不一致。

## 平台策略

### 抖音评论

目标状态：商用闭环。

路径：

```text
/workbench/douyin-comments
  -> localEngineApi.createBusinessTask("comments")
  -> backend LocalInteractionExecutor
  -> AutoUploadClient
  -> CDP persistent browser
  -> creator.douyin.com 评论管理
```

必须实现：

- 读取当前登录抖音账号。
- 打开评论管理页。
- 过滤系统提示、空评论、已回复评论。
- AI 根据评论内容生成回复。
- 自动发送时直接点击发送。
- 发送后回读该评论状态。
- 前台显示实时步骤：打开后台、读取评论、生成回复、发送、回读结果。

### 抖音私信

目标状态：最高优先级。

现状问题：

- 临时 Playwright 浏览器能打开页面，但私信会话列表会持续加载。
- 已捕获到 `imapi.snssdk.com/v2/message/get_by_user_init` 等请求超时或中断。
- 单纯 DOM 扫描无法判断是“没消息”还是“IM 接口没加载成功”。

新方案：

```text
持久 profile
  -> 可见 Chrome/Edge/Chromium
  -> CDP 9223
  -> 打开 creator.douyin.com 私信页
  -> CDP Network 捕获 IM 请求
  -> DOM + 网络结果双判断
```

必须实现：

- 进入私信页后先等待账号和私信 tab 稳定。
- 扫描 `全部 / 朋友私信 / 陌生人私信 / 群消息`。
- 抓取 `imapi.snssdk.com` 请求状态、错误码、耗时和响应摘要。
- 有会话时读取客户最后一条真实消息。
- 过滤系统提示，例如“请打开抖音 app 查看”。
- AI 根据对方消息生成回复，不允许固定模板硬发。
- 自动发送时真实点击发送。
- 发送后回读会话最后一条消息，确认是系统刚发出的回复。
- 如果列表持续加载，前台要显示“私信接口加载失败/持续加载”，不能显示“没有私信”。

### 视频号评论和私信

优先走网页后台。

路径：

```text
/workbench/channel-comments
/workbench/channel-messages
  -> 微信/视频号后台账号
  -> CDP persistent browser
  -> channels.weixin.qq.com 或可用官方后台
```

必须实现：

- 复用和抖音一致的 CDP 持久浏览器运行时。
- 独立 profile：`wechat-channel-{accountId}`。
- 读取评论/私信真实内容。
- AI 按内容生成回复。
- 默认自动发送。
- 验证或扫码时用户在同一浏览器处理。

### 微信会话和微信群发

不要先死磕桌面版。

优先级：

1. 能用网页后台或官方客服后台，就走 CDP 持久浏览器。
2. 个人微信网页版账号不支持或功能不完整时，再走桌面控制。
3. 桌面控制只是兜底，不是微信相关能力的唯一主线。

桌面兜底仍然要保持：

- Agent-S 负责规划和视觉控制。
- local-controller 负责真实截图、点击、输入、文件选择。
- 目标不确定时必须停。

## 运行时设计

### 新增模块建议

后端：

```text
backend/src/modules/local-engine/
  cdp-browser-profile.service.ts
  cdp-browser-session.service.ts
  cdp-platform-interaction.service.ts
```

自动化服务：

```text
auto-upload/
  cdp_runtime.py
  platform_douyin_cdp.py
  platform_channel_cdp.py
```

前端：

```text
frontend/src/app/(dashboard)/workbench/douyin-comments/page.tsx
frontend/src/app/(dashboard)/workbench/douyin-messages/page.tsx
frontend/src/app/(dashboard)/workbench/channel-comments/page.tsx
frontend/src/app/(dashboard)/workbench/channel-messages/page.tsx
```

### CDP Browser Session

统一接口：

```ts
type CdpBrowserSession = {
  platform: "douyin" | "wechat-channel" | "xiaohongshu" | "bilibili" | "kuaishou";
  accountId: string;
  profileDir: string;
  debuggingPort: number;
  status: "starting" | "ready" | "needs_login" | "blocked" | "stopped";
  visibleWindow: boolean;
  currentUrl?: string;
  lastError?: string;
};
```

必须提供方法：

```ts
ensureSession(accountId, platform)
open(url)
click(selectorOrPoint)
type(selectorOrPoint, text)
press(key)
evaluate(script)
captureScreenshot()
enableNetworkTrace(patterns)
stop()
```

### CDP Network Trace

每次互动任务至少记录：

- 请求 URL。
- method。
- status。
- errorText。
- timing。
- response content-type。
- response body 摘要。

抖音私信重点匹配：

```text
imapi.snssdk.com
mcs.snssdk.com
creator.douyin.com/*/im
creator.douyin.com/*/user_token
```

前台要把网络诊断转成人话：

```text
正在加载私信列表
私信接口超时
账号需要重新登录
页面有验证，需要你在浏览器里处理
读取到 3 个会话，正在回复第 1 个
已发送，正在回读确认
```

## AI 回复生成

回复必须基于对方内容，不允许固定内容硬发。

输入：

```ts
type ReplyGenerationInput = {
  platform: string;
  scene: "comment" | "direct_message" | "wechat_session" | "group";
  customerName?: string;
  customerMessage: string;
  recentContext?: string[];
  businessProfile?: string;
  replyRule?: {
    tone: "warm" | "professional" | "concise";
    forbiddenTopics: string[];
    handoffTriggers: string[];
  };
};
```

输出：

```ts
type ReplyGenerationOutput = {
  reply: string;
  confidence: number;
  shouldSend: boolean;
  handoffReason?: string;
};
```

发送前校验：

- 回复不能为空。
- 回复不能只复读客户原话。
- 回复不能包含未确认价格、承诺、医疗法律金融高风险内容。
- 回复不能命中平台禁词。
- `shouldSend=false` 时必须停下，不允许自动发送。

## 前台实时反馈

客户互动页面不能只显示“已启动”。

每个任务必须显示：

- 当前平台账号。
- 当前打开页面。
- 当前步骤。
- 当前对象。
- 读取到的客户原文摘要。
- AI 生成回复摘要。
- 发送模式。
- 发送按钮是否已点击。
- 发送后回读结果。
- 卡住原因和下一步。

步骤示例：

```text
1. 正在打开抖音后台
2. 已进入私信页
3. 正在读取会话列表
4. 读取到客户：张三
5. 正在生成回复
6. 已点击发送
7. 已回读确认发送成功
```

## 失败标准

必须失败并停止的情况：

- 没有登录账号。
- 账号需要重新登录。
- 页面出现验证码、扫码、滑块。
- 私信/评论接口持续加载。
- 找不到目标会话或评论。
- AI 不能生成安全回复。
- 发送按钮不可见。
- 发送后回读不一致。
- CDP 浏览器断开。
- 用户点击停止。

禁止：

- 失败写 completed。
- 把接口加载失败说成“没有消息”。
- 把系统通知当客户内容回复。
- 没有点击发送却写“已发送”。

## 账号和 profile 共享

平台账号页登录一次后，客户互动、发布中心、内容发布应共享同一个真实登录态。

实现要求：

- 账号记录保存 `profileDir`。
- 所有同平台动作优先复用该 `profileDir`。
- 不同账号必须隔离 profile。
- 不同平台必须隔离 profile。
- 重登时不删除历史任务，只更新 profile 状态。

## 验收标准

### 抖音评论

连续 5 轮：

- 每轮读到真实评论。
- 每轮 AI 回复内容和评论相关。
- 自动发送模式下每轮真实发出。
- 发送后能在页面回读到回复。

### 抖音私信

连续 5 轮：

- 每轮读到真实私信会话。
- 每轮 AI 回复内容和对方消息相关。
- 自动发送模式下每轮真实发出。
- 发送后能在会话里回读到最后一条系统发送消息。
- 如果接口加载失败，必须显示真实网络失败原因。

### 视频号评论/私信

各 5 轮：

- 真实后台。
- 真实账号。
- 真实客户内容。
- AI 相关回复。
- 自动发送。
- 回读确认。

### 微信会话/群发

各 5 轮：

- 网页后台能完成则网页完成。
- 网页不可用时桌面兜底完成。
- 目标不一致时必须停。
- 自动发送默认生效。

## 实施顺序

### 第 1 阶段：CDP 持久浏览器底座

- 新增 profile 目录管理。
- 启动可见 Chromium/Chrome/Edge。
- 监听本机 `9223`。
- 通过 CDP 打开页面、截图、执行 JS、抓网络。
- 前台显示浏览器连接状态。

### 第 2 阶段：抖音评论迁移

- 抖音评论从临时 Playwright 迁到 CDP 持久浏览器。
- 保留当前能用逻辑，但运行在固定 profile。
- 增加实时步骤和发送后回读。

### 第 3 阶段：抖音私信打通

- 用持久 profile 打开私信页。
- 抓 `imapi` 网络请求。
- 区分“无消息”和“接口加载失败”。
- 实现真实读取、AI 生成、自动发送、回读确认。

### 第 4 阶段：视频号评论/私信

- 复用 CDP 底座。
- 建独立 profile。
- 跑通评论和私信。

### 第 5 阶段：微信网页优先，桌面兜底

- 当前阶段先隐藏微信会话和微信群发前台导航，不作为一期验收目标。
- 梳理可用微信网页后台。
- 能网页化的走 CDP。
- 桌面控制只保留不可网页化场景。

## 当前代码改造点

现有临时浏览器集中在：

```text
/Users/yanghy/auto-upload/main.py
```

当前抖音私信接口：

```text
POST /interaction/douyin/messages/read
POST /interaction/douyin/messages/draft
POST /interaction/douyin/messages/send
```

后端调用层：

```text
backend/src/modules/auto-upload/auto-upload.client.ts
backend/src/modules/local-engine/local-interaction-executor.service.ts
```

前台入口：

```text
frontend/src/app/(dashboard)/workbench/douyin-comments/page.tsx
frontend/src/app/(dashboard)/workbench/douyin-messages/page.tsx
frontend/src/app/(dashboard)/workbench/channel-comments/page.tsx
frontend/src/app/(dashboard)/workbench/channel-messages/page.tsx
```

## 开发红线

- 不再新增朋友圈发布功能。
- 不再把临时浏览器当客户互动商用主线。
- 不再默认确认后发送。
- 不再把“无对象”当成所有失败的统一结果。
- 不再优先优化记录页、证据页、验收页。
- 不再为了证明失败而开发，必须围绕真实发送结果开发。

## 参考

- SkillHub `tencent-novnc-chromium-cdp`：核心参考是“可见浏览器 + CDP + 持久 profile + 人工验证兜底”。
- 本项目当前 `auto-upload` 抖音评论已能真实发送，迁移时应保留有效 DOM 操作和回复生成逻辑。
- 当前抖音私信卡点在 IM 会话列表加载和 `imapi` 网络层，必须用 CDP network trace 解决，不能继续只扫 DOM。
