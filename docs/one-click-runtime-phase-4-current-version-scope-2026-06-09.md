# 一键桌面版 P4 当前版本范围核查

更新时间：2026-06-09

## 结论

按当前产品范围，P4 当前版本可以继续验收：

- 抖音评论 / 私信：互动读写。
- 视频号评论 / 私信：互动读写。
- 抖音、视频号、小红书、快手、B站：内容发布读写。
- 内容采集：不属于 5409/CDP 平台适配器迁移项，当前走 Nest 后端 `materials` crawler 链路。

快手评论 / 私信、小红书评论 / 私信不属于当前版本已经实现过的互动能力，放入下一版本开发，不在当前 P4 验收里判为缺口。

## 本轮校正

之前把“快手、小红书读写流程”误理解成“快手、小红书评论/私信互动读写”，已撤回相关误加项：

- 撤回 `xiaohongshu-comment-reply`。
- 撤回 `xiaohongshu-direct-message-reply`。
- 撤回 `kuaishou-comment-reply`。
- 撤回 `kuaishou-direct-message-reply`。

当前互动任务类型只保留已实现链路：

- `douyin-comment-reply`
- `douyin-direct-message-reply`
- `wechat-channel-comment-reply`
- `wechat-channel-direct-message-reply`

## 当前真实代码边界

互动 service：

- `backend/src/modules/runtime/platforms/douyin/comment-reply.service.ts`
- `backend/src/modules/runtime/platforms/douyin/direct-message-reply.service.ts`
- `backend/src/modules/runtime/platforms/wechat-channel/comment-reply.service.ts`
- `backend/src/modules/runtime/platforms/wechat-channel/direct-message-reply.service.ts`

发布 service：

- `backend/src/modules/runtime/platforms/publishing/platform-publish.service.ts`

发布 service 已覆盖：

- 抖音图文 / 视频
- 视频号图文 / 视频
- 小红书图文 / 视频
- 快手图文 / 视频
- B站视频

内容采集链路：

- `backend/src/modules/materials/materials.service.ts`
- `backend/src/modules/materials/crawlers/crawler.registry.ts`
- `backend/src/modules/materials/processors/crawl.processor.ts`
- `frontend/src/lib/api/materials.ts`

这条链路是后端 crawler + Prisma 素材入库，不是 5409 Python uploader，也不是 CDP 平台发布/互动适配器。当前一键桌面包里它需要跟随 Phase 2 的 SQLite/本地存储验证，不需要在 P4 里按平台 CDP 迁移。

素材上传 / 导入链路：

- `backend/src/modules/auto-upload/auto-upload.controller.ts`
- `backend/src/modules/auto-upload/auto-upload.service.ts`
- `frontend/src/lib/api/auto-upload.ts`

这条链路负责本地发布素材库和文章卡图导入，不属于平台适配器迁移；但它是内容发布的前置条件，需要在 P5/P6 安装包验收里确认素材目录、预览和删除都能在干净机器上工作。

## 下一版本开发项

以下能力进入下一版本，不进入当前 P4 验收：

- 小红书评论读取 / 回复。
- 小红书私信读取 / 回复。
- 快手评论读取 / 回复。
- 快手私信读取 / 回复。

开发这些能力时需要单独立项，不能复用当前发布 service 伪装成互动能力。
