# 客户互动真实闭环验收记录

时间：2026-06-05 22:36 - 23:39
入口：3010 客户互动，执行端为 3011 调用本机 legacy interaction worker，实际操作 5409/auto-upload CDP 浏览器。
结论：抖音评论、抖音私信、视频号评论、视频号私信均已完成真实平台读写闭环。

## 验收口径

通过必须同时满足：

- 读取真实平台客户内容。
- 生成/填入回复内容。
- 默认真实发送。
- 平台接口或页面回读确认。
- 截图证据落盘。

不以 `task.status=completed` 作为通过依据。

## 抖音评论

账号：`user_info.id=1`，平台：抖音。
真实读取：通过。读取到真实评论，包括 `66666`、`视频太真实了爱了`、`创作天花板了` 等。

真实发送结果：通过，至少 5 轮成功。

证据：

- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-comments-read-1-20260605223611-5a629295.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-comments-send-1-20260605224117-db78fb10.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-comments-send-1-20260605224156-a2de7993.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-comments-send-1-20260605224339-d3a1e500.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-comments-send-1-20260605224425-ea23a8ac.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-comments-send-1-20260605225514-396f0d3d.png`

额外验证：

- 平台私密作品拒绝时，系统返回 `platform_rejected`，原因是 `私密作品无法评论`，没有假报成功。

## 抖音私信

账号：`user_info.id=1`，平台：抖音。
真实读取：通过。读取到真实私信会话，包括 `「你收到了一个抖音红包，请在手机上查看」` 等。

真实发送结果：通过，5 轮成功。

证据：

- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-messages-read-1-20260605225756-10bf8b46.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-messages-send-1-20260605225909-210261c6.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-messages-send-1-20260605233345-cc507c1d.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-messages-send-1-20260605233407-ab5367b8.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-messages-send-1-20260605233429-7e4c2d59.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/douyin-messages-send-1-20260605233452-4e4376d9.png`

回读结果：

- 每轮 `status=sent`，`sent=true`。
- 页面回读到对应回复文本。
- 网络接口命中抖音私信发送接口。

## 视频号评论

账号：`user_info.id=4`，平台：视频号。
真实读取：通过。扫码后保存登录态，读取到评论管理页真实评论，`usableCount=8`。

真实发送结果：通过，5 轮成功。

证据：

- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-comments-read-4-20260605232604-4d4a020c.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-comments-send-4-20260605232749-06157aa2.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-comments-send-4-20260605233759-064393b8.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-comments-send-4-20260605233829-3c06d5b9.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-comments-send-4-20260605233859-481e85f0.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-comments-send-4-20260605233929-d66284c1.png`

回读结果：

- 平台接口命中 `comment/create_comment`。
- 返回 `errCode=0`。
- 页面回读到对应回复文本。
- 新评论 ID 示例：`14937823006252664832`。

## 视频号私信

账号：`user_info.id=4`，平台：视频号。
真实读取：通过。读取到真实私信会话，目标内容 `哈喽`。

真实发送结果：通过，5 轮成功。

证据：

- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-messages-read-4-20260605232207-0ac1c926.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-messages-send-4-20260605232438-ec88f5b1.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-messages-send-4-20260605233531-b225d2f6.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-messages-send-4-20260605233610-fd136f8b.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-messages-send-4-20260605233649-6a9fd627.png`
- `/Users/yanghy/auto-upload/logs/interaction-evidence/wechat-channel-messages-send-4-20260605233729-d8038a81.png`

回读结果：

- 平台接口命中 `private-msg/send-private-msg`。
- 每轮 `status=sent`，`sent=true`。
- 页面回读到对应回复文本。

## 本次修正点

- 抖音评论发送后增加平台回复接口解析，识别 `creator/comment/reply` 返回体。
- 抖音评论平台拒绝时返回 `platform_rejected` 和真实平台原因，不再假成功。
- 抖音评论编辑器定位放宽到实际 20px 输入框高度。
- 视频号扫码后 cookie 保存为旧 5409 可识别的 `{ cookies: [...] }` 格式。

## 验证命令

已通过：

```bash
/Users/yanghy/auto-upload/.venv/bin/python -m py_compile /Users/yanghy/auto-upload/main.py
cd /Users/yanghy/Documents/New\ project/ai-content/backend && npx tsc --noEmit --pretty false
```

## 剩余风险

- 3011 API 用 `curl` 无登录 cookie 会返回 `请先登录`，这是后台鉴权，不是平台闭环失败。
- 视频号登录态依赖微信扫码和 cookie 有效期。cookie 过期后需要重新扫码。
- 当前还有大量历史未提交改动，不能把本次真实闭环结果误认为全仓库已干净。

## 3011 迁移后复测补充

时间：2026-06-06 09:17 - 10:07
入口：3010 前端 / 3011 后端，本机 Playwright 持久浏览器 profile。
结论：抖音评论、抖音私信已验证 3011 路径；视频号评论、视频号私信当前阻断在 3011 视频号 profile 登录态。

### 已通过

- 抖音私信：`le_mq2k382v_0vx0lm` 完成真实读取、发送、页面回读。读取到 `毛毛宝贝昨天收到，感谢反馈。`，发送结果为 `抖音私信已发送：回复已点击发送，并在页面回读到回复内容。`
- 抖音评论：`le_mq2lmpd3_ms71xi` 完成真实读取、发送、页面回读。读取到 `通知网址抖音`，发送结果为 `抖音评论已发送：回复已点击发送，并在页面回读到回复内容。`
- 抖音私信过滤：`le_mq2lk7nn_juphi6` 复测没有再把系统自己的兜底回复当客户内容；过滤后无新可回复对象，返回 `no_target`。

### 当前阻断

- 视频号评论：`le_mq2lu6tf_8g4vd9` 阻断。实际页面停在 `https://channels.weixin.qq.com/login.html` 的视频号助手介绍页，没有进入评论后台。
- 视频号私信：`le_mq2lo87e_0d3c2b` 同样阻断在 `https://channels.weixin.qq.com/login.html`。

### 证据

- 视频号阻断截图：`/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1780765575775-wechat-channel-4.png`
- 抖音评论发送截图：`/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1780765226032-douyin-1.png`
- 抖音私信发送截图：`/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1780764743869-douyin-1.png`

### 本轮代码修正

- 3011 browser-assisted 任务由 LocalEngine 生命周期执行，队列 worker 不再重复执行。
- 抖音私信读取候选会过滤当前回复和配置的兜底回复，避免把自己刚发的内容当客户内容。
- 抖音评论预检导航超时改成 best-effort，页面已打开或可继续判断时不直接阻断。
- 视频号读取失败时补充 URL、页面文本和截图证据，避免只返回“未登录”。

### 下一步

- 需要在 3011 打开的 `wechat-channel-4` 持久浏览器里重新完成视频号扫码/授权，让 profile 进入真实后台页。
- 登录态恢复后重跑视频号评论和视频号私信，每条至少再跑 1 轮确认 3011 路径；若通过，再补各 5 轮稳定性验收。

## 3011 迁移后复测补充二

时间：2026-06-07 00:56 PDT
入口：3010 前端 / 3011 后端，本机 Playwright MCP 持久浏览器 profile。
结论：3011 路径下，抖音评论已补足 5 轮真实闭环；抖音私信当前 1 轮真实闭环成功，后续轮次因没有新的真实私信对象返回 `no_target`，没有乱发；视频号评论/私信仍阻断在平台登录态。

### 抖音评论

3011 路径已通过至少 5 轮：

- `le_mq2ujos4_15l1qq`：completed，页面回读成功。
- `le_mq2umdmx_t4m6mr`：completed，页面回读成功。
- `le_mq2xgd3r_bmybth`：completed，读取 `嘉言善行📷00:`，页面回读成功。
- `le_mq3hann7_v5rzfn`：completed，读取 `大壮AI研究员06月03日 14:07对对对 0 查看1条`，页面回读成功。
- `le_mq3hbhwt_2x5mki`：completed，读取 `大壮AI研究员06月03日 14:07对对对 0 查看1条`，页面回读成功。

判定：通过。满足“真实读取 -> 生成回复 -> 自动发送 -> 页面回读确认”。

### 抖音私信

3011 路径当前结果：

- `le_mq2xgd6j_e6mx04`：completed，读取 `#情感 #啤酒🍻发布于2026年02月24日 19:51`，发送并页面回读成功。
- `le_mq3hbv3l_9r31gv`：no_target，没有可处理真实私信，未发送。
- `le_mq3hcbe3_2pqjnu`：no_target，没有可处理真实私信，未发送。
- `le_mq3hclhp_nm1nv0`：no_target，没有可处理真实私信，未发送。
- `le_mq3hcu1z_xv2700`：no_target，没有可处理真实私信，未发送。

判定：发送能力通过 1 轮；5 轮稳定性未满，原因是当前平台没有新的可回复真实私信对象。`no_target` 是正确保护，不是发送失败。

### 视频号评论 / 视频号私信

当前阻断：

- `le_mq2xgd6p_6jotfu`：视频号评论 failed。实际页面为 `https://channels.weixin.qq.com/login.html`，没有进入评论后台。
- `le_mq2xggnv_wjl9y8`：视频号私信 failed。实际页面为 `https://channels.weixin.qq.com/login.html`，没有进入私信后台。

判定：不是 3011 代码闭环成功，也不是发送失败；是视频号平台登录态缺失。必须先在 `wechat-channel-4` 持久 profile 里完成扫码/授权，再重跑。

### 本轮 5409 收口验证

- 后端构建通过：`cd backend && npm run build`。
- 客户互动关键单测通过：`platforms-douyin.spec.ts`、`platforms-wechat-channel.spec.ts`、`auto-upload.service.spec.ts`，共 42 条。
- 桌面商用资源预检通过：`cd desktop && npm run check:commercial-assets`。
- 主打包配置已不再要求 `desktop/sidecars/auto-upload` 和 `installer/wheelhouse/auto-upload`。
- 主打包配置仍保留 Agent-S，因为后续微信/桌面 GUI 自动化要用。

### 当前剩余

1. 视频号 `wechat-channel-4` 持久浏览器 profile 重新扫码登录。
2. 视频号评论、视频号私信登录后各跑 5 轮真实闭环。
3. 抖音私信需要真实新私信对象才能补足 5 轮；没有对象时不能强行发送。
4. 旧源码目录 `desktop/sidecars/auto-upload` 仍在仓库里，但当前打包路径已不依赖它；最终可另起清理任务删除或归档，避免误用。
