# AI 员工 P0-P3 证据包模板

日期：2026-06-15

## 存放规则

建议最终验收证据统一放到：

```text
docs/evidence/ai-employee-p0-p3/
```

每条链路一个文件夹：

```text
docs/evidence/ai-employee-p0-p3/
  p0-spikes/
  p1-douyin-acquisition/
  p1-publish-basic/
  p2-wechat-service/
  p2-wechat-broadcast/
  p2-wechat-contact-add/
  p3-moments-publish/
  p3-moments-random-marketing/
  p3-moments-targeted-marketing/
```

## 每条链路必须包含

| 文件 | 内容 |
| --- | --- |
| `README.md` | 账号、时间、操作者、入口 URL、执行步骤、结果结论。 |
| `task.json` | 创建任务时的 payload、taskId、sessionId。 |
| `runtime.json` | Agent-S / Node Runtime / Local Engine 返回结果。 |
| `screenshots/` | 关键页面截图：登录态、目标页、发送/评论/发布前后、风控或失败页面。 |
| `records.json` | 前端记录或 Local Engine records 导出。 |
| `failures.md` | 失败原因、恢复动作、最终状态。没有失败也写“无失败”。 |

## P0 必填证据

- 抖音链接曝光：真实视频链接、评论候选、过滤规则 payload。
- 抖音搜索曝光：关键词、搜索结果、目标账号/作品、评论入口。
- 微信会话：Agent-S/Node Runtime health、微信会话截图、草稿证据。
- 朋友圈发布：发布窗口、文案/素材填充、发布或草稿结果。
- 聚合发布：发布任务 payload、登录态检查、成功或阻断证据。

## P1 必填证据

- 抖音账号登录态。
- 导入链接或关键词。
- 候选评论列表。
- 评论/私信文案生成结果。
- 评论/私信任务执行结果。
- 每日上限、黑名单、失败码、截图证据。
- 抖音/小红书发布检查和发布记录。

## P2 必填证据

- 微信桌面在线状态。
- 会话读取截图。
- AI 回复草稿。
- 人工确认和发送/草稿结果。
- 群发目标、间隔、每日上限、暂停/恢复。
- 加好友目标、验证消息、黑名单、失败恢复。

## P3 必填证据

- 朋友圈发布：文案、素材、发布入口、结果截图。
- 随机营销：朋友圈第 N 条、浏览、点赞、评论、截图。
- 定向营销：联系人、个性化评论、点赞/评论结果。
- 风控保护：验证码/频繁/账号异常时的停止截图。
- 失败恢复：失败目标进入待恢复并继续执行的记录。

## 验收结论格式

```markdown
## 验收结论

- 链路：
- 账号：
- 时间：
- 结果：通过 / 未通过
- 证据目录：
- 失败项：
- 是否需要修代码：
```
