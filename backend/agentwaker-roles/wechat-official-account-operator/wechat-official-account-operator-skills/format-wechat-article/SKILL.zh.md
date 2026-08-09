---
name: format-wechat-article
description: 将已批准的、视觉完整的技术 Markdown 文章转换为 WeChat 兼容的 HTML 和独立的 JPage 审阅文档，然后验证移动端可读性、图片完整性、元数据和来源注释。仅在 design-wechat-visuals 生成最终资产和资产关卡清单后使用，用于 WeChat 编辑、Markdown 转换、布局清理、文章打包或预草稿格式设置。
---

# 格式化 WeChat 文章

## 目的

准备可移植、可检查的 HTML 和元数据，而不写入用户的 WeChat 账户或泄露未经验证的预览。

## 必需输入

- 已批准的 Markdown 草稿。
- 选定的标题、作者、摘要、来源 URL、CTA 和评论偏好。
- 最终封面和内容图片文件；不接受占位符。
- 当前修订版本的 `visual-manifest.json`，其中包含 `asset_gate=pass` 及所有必需资产已批准。
- 主题选择和任何品牌约束。

## 工作流程

1. 读取 `../plan-tech-series/references/editorial-categories.md`、`references/wechat-formatting.md` 和 `../design-wechat-visuals/references/visual-quality-gate.md`，了解类别、语法、包和视觉关卡要求。
2. 拒绝缺少或过时的清单、缺少或不支持的 `article.category`、任何未标记为已批准的必需资产、图片哈希不匹配、未解析的占位符、缺少 alt 文本或 `▲` 标题，或与清单不同的 Markdown 图片顺序。对于 `architecture-map`，还要拒绝概述前的 H2、过长方向的声明、第一个正文图片不是声明的完整概述，或任何未绑定到相同概述区域的工作流细节。
3. 运行 `scripts/render_wechat_html.py INPUT.md --output article.wechat.html --theme green-tech` 生成 WeChat 片段。仅对明确请求的替代处理保留旧版主题；它们不是账户默认值。
4. 使用 `--standalone --embed-local-images` 再次运行渲染器以创建 `article.jpage.html`。这是规范的视觉审阅界面，必须嵌入精确审阅的图片字节。
5. 在正常文章宽度以及 375 px 和 390 px 窄移动宽度下检查集成的独立页面。确认图片加载、顺序、清晰度、标签、标题、裁剪、文本节奏、标题、代码、链接和来源注释。
6. 仅在实际检查后，在当前修订版本清单中记录 `integrated_render_gate=pass` 并运行 `../design-wechat-visuals/scripts/validate_visual_package.py --target jpage-preview` 以创建 `visual-quality-report.json`。
7. 除非验证器退出 `0`、报告称 `gate: pass`，且其清单、Markdown、HTML 和资产哈希与当前包匹配，否则保持关卡关闭。
8. 创建区分本地审阅文件与后续 WeChat 上传 URL 的图片地图，然后打包 Markdown、两种 HTML 形式、清单、质量报告、标题、作者、摘要、封面、来源账本和就绪报告。

## 输出

- WeChat 兼容的内联 HTML。
- 包含精确审阅图片的独立 `article.jpage.html`。
- 元数据和图片地图。
- `visual-quality-report.json`，其中 `asset_gate=pass` 和 `integrated_render_gate=pass` 绑定到当前修订版本。
- 格式就绪报告和不支持的语法警告。
- 适用于 Doocs WeChat Markdown Editor 或 mdnice 的可选手动后备说明。

## 审批关卡

本地渲染或本地预览无需审批。上传图片、创建或更新 WeChat 草稿，或向第三方编辑器发送未发布内容前需要审批。

## 故障处理

如果捆绑渲染器无法保留必需的构造，请简化它，将其转换为已批准的图片，或使用已审阅的手动编辑器。如果任何图片缺失、过时、被阻止、质量低或未解析，返回 `design-wechat-visuals` 且不生成预览就绪的包。对于复杂布局，在视觉检查前不得声称平台兼容性。

## 交接规则

仅将完整的、通过关卡的本地包移交给 `jpage-pre-draft-preview`。将封面、图表、截图、图表、视觉密度或质量故障返回给 `design-wechat-visuals`。将自定义交互式资产工作移交给 FrontDeveloper。

## 触发条件

当请求符合此处描述的工作流程且保持在 WeChat 官方账号运营商边界内时使用此 skill。
