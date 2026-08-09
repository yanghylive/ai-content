# 客户互动商用能力 Skill 方案

更新时间：2026-05-31

> 状态：已被 `customer-interaction-cdp-persistent-browser-plan.md` 替代。
>
> 2026-06-01 起，客户互动网页平台主线改为“可见持久浏览器 + CDP 9223 + 完整 profile + 人工验证兜底”。朋友圈发布功能已下线，本文件中关于 `wechat.moments.publish`、朋友圈页面和朋友圈发布验收的内容仅保留为历史记录，不再作为开发依据。

## 一句话目标

客户互动的商用结果不是任务记录、状态流转、证据页或验收脚本，而是系统用真实账号、真实浏览器或真实桌面，把评论、私信、微信会话、微信群、朋友圈里的内容实际回复、发送或发布出去。

## 当前要纠正的问题

- 不要再把重点放到记录页、验收页、日志页、证明有没有发。
- 不要在前台页面里零散拼自然语言任务，让每个页面各写一套执行逻辑。
- 不要把微信桌面能力改成 local-engine 自己执行。微信桌面主路径必须是 Agent-S + local-controller。
- 不要把“草稿生成”“任务创建”“状态完成”等同于商用能力。
- 不要把自动发送默认改成确认后发送。默认是自动发送，只有用户选择确认后发送、目标不确定、权限不够或风险阻断时才停下来。

## 正确架构

前台按钮只调用业务 skill：

```text
前台 workbench
  -> skill registry
  -> 平台 skill
  -> Agent-S / browser executor
  -> local-controller / browser automation
  -> 真实平台发送或发布
```

前台只传参数，不负责写执行流程：

- 平台账号
- 目标对象
- 文案或回复内容
- 发送模式：默认 `auto-send`
- 附加约束：可见范围、素材、频率、停止条件

skill 负责：

- 打开正确平台或应用
- 定位目标
- 读取上下文
- 生成或使用回复内容
- 输入内容
- 点击发送、发表或发布
- 回读发送后状态
- 失败时停止并返回明确卡点

## Skill 列表

### `douyin.comment.auto_reply`

执行路径：浏览器后台优先。

必须做到：

- 使用已登录抖音账号。
- 打开评论管理真实页面。
- 读取可回复评论。
- 过滤平台提示、空内容、已处理对象。
- 自动生成或使用回复。
- 输入回复并点击发送。
- 发送后回读评论状态。

### `douyin.dm.auto_reply`

执行路径：浏览器后台优先。

必须做到：

- 使用已登录抖音账号。
- 打开私信真实页面。
- 读取真实客户私信。
- 过滤系统通知，例如“你收到一条新类型消息，请打开抖音app查看”。
- 自动回复并点击发送。
- 发送后回读会话状态。

### `wechat.session.auto_reply`

执行路径：Agent-S + local-controller。

必须做到：

- 打开桌面微信。
- 定位目标联系人。
- 确认窗口标题和当前会话是同一个目标。
- 读取最近上下文。
- 输入回复。
- 默认自动点击发送。
- 目标不一致、搜一搜/公众号/视频号结果页、弹窗遮挡、权限缺失时必须停。

### `wechat.group.broadcast`

执行路径：Agent-S + local-controller。

必须做到：

- 按目标列表逐个打开微信群或联系人。
- 每个目标都要做窗口和名称确认。
- 输入同一条群发内容。
- 默认自动发送。
- 支持节奏限制、失败跳过、停止任务、人工接管。

### `wechat.moments.publish`

执行路径：Agent-S + local-controller。

必须做到：

- 打开桌面微信。
- 进入朋友圈发布入口。
- 填入朋友圈文案。
- 支持图片或视频素材。
- 设置可见范围。
- 回读文案和素材状态。
- 默认自动点击发表。
- 找不到入口、文案回读不一致、发布按钮不可见、权限不足时必须停。

## 成功标准

只有下面结果算成功：

- 评论回复真实发出。
- 私信回复真实发出。
- 微信会话消息真实发出。
- 微信群消息真实发出。
- 朋友圈真实发表。

下面都不算成功：

- 任务创建成功。
- 状态变成 completed。
- 写入执行记录。
- 生成草稿。
- 页面显示“已启动”。
- 有截图或日志。

## 实施顺序

1. 建 skill registry：统一注册 `skill_id`、输入 schema、执行器、能力要求、风险策略。
2. 把微信三类能力先改成 skill 调用：会话、群发、朋友圈。
3. 把朋友圈从“微信回复模板”里拆出来，做成独立 `wechat.moments.publish`。
4. 抖音评论和私信改成浏览器 skill，补强系统通知过滤和发送后回读。
5. 前台 workbench 只调用 skill，不再自己拼大段执行指令。
6. local-engine 只做权限、状态、审计、停止、接管和诊断，不做微信主执行器。
7. 用真实测试账号跑每个 skill 的 5 轮自动发送。

## 开发红线

- 禁止把客户互动开发转成记录页优化。
- 禁止把客户互动开发转成验收脚本文档。
- 禁止把微信桌面主路径从 Agent-S 改走 local-engine。
- 禁止默认确认后发送。
- 禁止没有真实发送能力时假装 completed。
- 禁止把平台系统提示当客户消息自动回复。

## 下一步具体动作

先做 `wechat.moments.publish` skill，因为当前页面已经暴露出最明显问题：它不应该复用微信联系人回复模板。

落地要求：

- 新增 skill registry。
- 新增 `wechat.moments.publish` skill 定义。
- 前台朋友圈页面调用该 skill。
- Agent-S run metadata 带上 `skill_id=wechat.moments.publish`。
- 指令明确最终动作是点击发表，不是生成草稿。
- 失败只允许返回明确卡点，不允许伪成功。

## 2026-05-31 第一批落地

- 已新增前端 skill registry：`frontend/src/lib/ops-workbench/interaction-skills.ts`。
- 已新增 `wechat.moments.publish` skill 定义。
- 朋友圈页面已改为调用 `wechat.moments.publish`，不再复用微信联系人回复模板。
- Agent-S run metadata 已带 `skill_id=wechat.moments.publish`。
- 默认自动发布仍是 `auto-send`；确认后发布只在用户点确认后发送时启用。

## 2026-05-31 SkillHub 接入记录

安装入口：

```bash
curl -fsSL https://skillhub.cn/install/skillhub.md
```

已安装 SkillHub CLI：

- `~/.local/bin/skillhub`

已安装到项目内的 SkillHub skill：

- `skillhub-skills/wechat-auto-reply`
- `skillhub-skills/wechat-sender`
- `skillhub-skills/desktop-guardian`
- `skillhub-skills/browser-use`

当前本机依赖状态：

- 已存在：`brew`、`cliclick`
- 已 vendor 化并可执行：`wechat-auto-reply`
- 缺失：`peekaboo`、`eye-server`、`browser-use`、`hs`

接入原则：

- 不再优先自写微信桌面 skill。
- 微信会话和微信群发优先复用 SkillHub `wechat-auto-reply`。
- 朋友圈发布优先参考 SkillHub `wechat-sender` 的桌面视觉流程。
- 依赖命令缺失时必须阻断并显示缺失项，不能伪装可执行。
- Homebrew 安装 `wechat-auto-reply` 这次被本机代理/镜像卡住，已停止后台进程；后续要么修网络再装，要么把 skill 里的执行脚本随项目 vendor 化。

代码接入状态：

- `wechat.session.auto_reply` 已迁到 SkillHub 来源：`wechat-auto-reply`。
- `wechat.group.broadcast` 已迁到 SkillHub 来源：`wechat-auto-reply`。
- `wechat.moments.publish` 已迁到 SkillHub 来源：`wechat-sender`。
- 前台微信会话、微信群发、朋友圈页面都调用 `interaction-skills.ts` 生成的 skill request。
- 后端 `PluginRuntimeService` 已能识别 `skillhub-skills` 目录和缺失命令，能力页不会把“已安装说明文件”误判成“可真实执行”。

还缺的运行依赖：

- `wechat-auto-reply` 命令：已通过 `vendor/skillhub/wechat-auto-reply` 安装到 `~/.local/bin/wechat-auto-reply`，用于微信会话和微信群发的真实发送执行。
- `peekaboo` / `eye-server`：用于 `wechat-sender` 的视觉桌面控制流程。
- 或者把上述 skill 的执行脚本 vendor 到本项目，并改成直接走现有 Agent-S/local-controller。

本次补充：

- Homebrew core clone 过慢，已停止。
- 直接读取 `bjdzliu/openclaw` tap 里的 formula 和脚本。
- 已把 `wechat-dm.sh`、`wechat-dm.applescript` vendor 到项目。
- 已创建 `~/.local/bin/wechat-auto-reply` 包装命令。
- 当前 `wechat-auto-reply "联系人" "消息内容"` 可进入主动发送模式；该模式不依赖 OCR/PyObjC。

后端执行接入：

- `AgentSService.runTask` 已拦截 `skill_id=wechat.session.auto_reply`。
- 会话回复会直接调用 `wechat-auto-reply "联系人" "回复内容"`。
- `AgentSService.runTask` 已拦截 `skill_id=wechat.group.broadcast`。
- 群发会按 `wechat_group_targets` 逐个调用 `wechat-auto-reply "目标" "群发内容"`。
- 缺目标、缺内容、命令失败或超时都会返回 failed，不会伪成功。
- 前后端类型检查已通过。
