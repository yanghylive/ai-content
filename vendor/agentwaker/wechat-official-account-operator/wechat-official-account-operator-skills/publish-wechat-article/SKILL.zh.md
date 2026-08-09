---
name: publish-wechat-article
description: 通过官方服务器 API 安全管理 WeChat Official Account 内容图片、封面素材、草稿、预览投递、发布任务、已发布文章及结果校验。当用户请求创建、检查、编辑、预览、发布、验证或删除 WeChat 内容时使用；资产写入、草稿修改、正式发布和删除需分别进行审批。
---

# 发布 WeChat 文章

## 目的

将经过审核的本地文章包通过官方 WeChat 草稿和发布工作流程移动，同时确保权限明确、凭证规范且状态可追溯。

## 必需输入项

- 确切的账号标签、类型、认证状态和 API 权限状态。
- 需配置已获批的托管 `WECHAT_ACCESS_TOKEN`、固定出口 SSH Token Broker，或本地 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。
- 最终标题、作者、摘要、HTML、封面、图片映射、来源 URL、评论设置和版权状态。
- 当前修订版本的视觉清单和质量报告，包含 `asset_gate=pass` 和 `integrated_render_gate=pass`。
- 验证后的私有 JPage 配对回执，包含 `remote_render_gate=pass`；其修订版本和哈希值必须与本地包一致，方可进行任何 WeChat 预览或草稿写入。
- 用于更新或删除操作的目标草稿或文章标识符。
- 针对确切下一步写入操作的明确审批。

## 工作流程

1. 读取 `references/official-api.md` 以了解当前端点行为、账号限制和权限。仅在评估外部编辑器、skill、MCP、CLI、浏览器辅助工具或 SaaS 时读取 `references/market-landscape.md`。
2. 验证视觉质量报告和私有 JPage 配对回执。若任何必需图片缺失或已变更，任何视觉门禁未达 `pass`，或回执修订版本和哈希值与本地包不一致，则停止操作。
3. 运行 `scripts/wechat_api.py doctor`，不打印敏感信息。
4. 验证公网 IP 白名单或管理员确认状态，以及 WeChat 后台中的相关 API 权限。
5. 优先使用经审批的托管 `WECHAT_ACCESS_TOKEN`；否则使用固定出口 SSH Token Broker。仅把本地 AppID/AppSecret 申请稳定令牌作为兼容回退。
6. 上传已审核的内容图片，仅在获得资产写入审批后将经验证的本地引用替换为 WeChat 返回的 URL。
7. 将封面上传为永久图片资产，仅在获得资产写入审批后记录其媒体标识符。
8. 运行 `scripts/build_article_payload.py` 以合并最终 HTML 片段和元数据，拒绝未解析的本地图片或独立预览 HTML。
9. 在获得草稿写入审批后，呈现确切的文章元数据并创建或更新草稿。
10. 读取草稿并在 WeChat 后台或等效预览中检查。
11. 获得针对此确切正式版本的独立最终审批。
12. 提交草稿，记录发布任务标识符，并持续查询状态直至终止。
13. 成功后记录返回的文章标识符或 URL；否则报告确切的失败状态。
14. 将粉丝群发视为单独的高风险工作流程，需明确用户请求、独立审批和本地启用开关。

## 常用命令

```bash
python3 scripts/wechat_api.py doctor
python3 scripts/wechat_api.py draft-list --count 10
python3 scripts/wechat_api.py draft-get --media-id MEDIA_ID
python3 scripts/wechat_api.py upload-content-image --file ./image.png --confirm-write
python3 scripts/wechat_api.py upload-cover --file ./cover.png --confirm-write
python3 scripts/build_article_payload.py --html ./article.wechat.html --title "Title" --author "Author" --digest "Digest" --cover-media-id MEDIA_ID --output ./article.json
python3 scripts/wechat_api.py draft-create --payload ./article.json --confirm-write
python3 scripts/wechat_api.py draft-update --payload ./update.json --confirm-write
python3 scripts/wechat_api.py publish-submit --media-id MEDIA_ID --confirm-publish
python3 scripts/wechat_api.py publish-status --publish-id PUBLISH_ID
# Disabled by default; publication approval does not authorize this command:
WECHAT_ENABLE_MASS_SEND=1 python3 scripts/wechat_api.py mass-send --payload ./mass-send.json --confirm-mass-send
```


## 输出

- 就绪状态和权限报告。
- 确切的已审批命令和脱敏载荷摘要。
- 草稿媒体标识符或发布任务标识符。
- 写入回读、终止发布状态和文章标识符或 URL。
- 残余风险和手动回退方案。

## 审批门

- 每次批量上传前需获得资产写入审批。
- 创建、更新、预览或删除前需获得草稿写入审批。
- 草稿检查后需获得独立的最终发布审批。
- 删除已发布内容前需获得不可逆操作确认。
- 群发前需获得独立的粉丝投递审批和本地启用开关。
- 不得从早期的研究、草稿撰写、渲染、安装或凭证设置中推断审批。

## 故障处理

若视觉或 JPage 回执缺失、过时或失败，则返回 `design-wechat-visuals`、`format-wechat-article` 或 `jpage-pre-draft-preview`，不执行任何账号写入。否则记录端点、安全错误码和不含敏感信息的响应消息。若 IP 无效，更新授权白名单或管理员流程。若 API 行为未授权，验证账号类型、认证和后台权限。若发布自动化不可用，保持草稿状态或使用手动后台。

## 交接规则

将持久令牌管理、回拨、调度器或托管收集器交接给 DevOpsEngineer。将公开渲染验证交接给 QAEngineer。将文章更正交接给 `draft-deep-tutorial` 和 `format-wechat-article`，然后再进行另一次写入。

## 触发条件

当请求与此处描述的工作流程相符且保持在 WeChat Official Account 运营者边界内时使用此 skill。
