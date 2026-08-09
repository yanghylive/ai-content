---
name: jpage-pre-draft-preview
description: 在所有必需的图像通过资源检查和集成渲染门控后，上传并私密验证同一版本的 WeChat 文章 Markdown 源文件及其自包含视觉 HTML。在 format-wechat-article 之后、暴露预览位置或调用 publish-wechat-article 或 save-wechat-browser-draft 之前使用；永远不要展示包含缺失、过时、未审查或损坏图像的预览。
---

# JPage 预起草预览

## 目的

在每篇 WeChat 文章进入 WeChat Official Account 草稿箱之前，为其创建一个可追溯的私密 JPage 配对。Markdown 是可编辑的源文件，自包含的 HTML 是规范的视觉审查界面。在向用户展示预览位置或工作流继续执行 WeChat 草稿写入之前，必须验证远程文件和远程移动渲染。

## 范围与上游优先级

- 在 WeChat Official Account 运营者内部，此英文 wrapper 具有权威性。
- `references/upstream-skill.zh.md` 是用户提供的 bundle 中的 vendored JPage v1.6.6 参考。仅将其用于当前 CLI、上传、文件管理和渲染机制。
- 此 wrapper 覆盖上游全局触发器及其公开的默认示例。预起草 WeChat 预览默认为私密，永远不会自动继承 `isPublic=true` 或 `--public`。
- 捆绑的 reveal.js 资源为上游完整性而保留，但幻灯片和演示生成不在此预起草文章工作流范围内。

## 触发条件

在以下情况下使用此 skill：

- `format-wechat-article` 已生成当前文章的 Markdown 和渲染后的 WeChat HTML。
- 用户请求预览、审查、归档或将 WeChat 文章移至 WeChat 草稿箱。
- 下游草稿工作流需要证明两个预起草表示都已存储在 JPage 中。

不要将此 skill 用于无关的 JPage 管理、一般网站、Xiaohongshu 产物、公开落地页或 WeChat 草稿/发布写入本身。

## 必需输入

- 当前审查版本的本地 Markdown 路径。
- 从该 Markdown 版本生成并嵌入已审查图像的自包含 `article.jpage.html`。
- 显示 `asset_gate=pass`、`integrated_render_gate=pass` 以及匹配 Markdown、HTML、清单和资源哈希的当前版本 `visual-manifest.json` 和 `visual-quality-report.json`。
- 用于配对两个文件的共享文章词干和修订标签。
- `wechat-official-account-operator/env/.env` 中本地配置的 JPage 值。
- 明确批准将确切 Markdown 和 HTML 文件上传到所述 JPage base。

## 环境契约

| 变量 | 要求 |
|----------|-------------|
| `JPAGE_BASE` | JPage 服务 base URL。仓库示例使用 `https://jpage.cn`；本地忽略文件可能覆盖它。 |
| `JPAGE_TOKEN` | 首选 JPage CLI 凭证。永远不要打印、日志记录或提交它。 |
| `MCP_TOKEN` | 当所选 JPage 入口点使用它而非 `JPAGE_TOKEN` 时的可选兼容性凭证。 |
| `JPAGE_TOKEN_URL` | 用于获取或轮换令牌的可选人工可读位置。CLI 不直接消费此值。 |
| `JPAGE_DEFAULT_VISIBILITY` | 对于此工作流必须为 `private`，除非用户另行批准公开可见性。 |
| `JPAGE_DEFAULT_TAGS` | 上传后应用于两个预览文件的逗号分隔标签。 |

角色本地环境文件位于角色根目录下方，因此 JPage CLI 不会自动从大多数工作目录发现它。将它加载到当前进程而不回显值：

```bash
ROLE_ROOT="$(git rev-parse --show-toplevel)/wechat-official-account-operator"
set -a
. "$ROLE_ROOT/env/.env"
set +a
```

然后使用只读命令验证配置：

```bash
jpage --version
jpage whoami --base "$JPAGE_BASE"
jpage ls --base "$JPAGE_BASE" --limit 5
```


## 工作流

1. 仅在 `format-wechat-article` 生成两个文件并通过视觉质量报告之后、在暴露预览位置或执行任何 API 或基于浏览器的 WeChat 草稿写入之前运行。
2. 加载忽略的角色环境文件，确认 `JPAGE_BASE` 加一个支持的令牌源存在，而不显示它们的值。
3. 重新运行 `validate_visual_package.py --target jpage-preview`。确认其报告是最新的，其文章修订版本与 Markdown 和 HTML 匹配，每个必需的资源哈希匹配，并且两个本地门控都通过。
4. 确认 Markdown 和 HTML 使用相同的文章词干和修订标签。为每个本地文件计算 SHA-256 摘要，并将其与质量报告进行比较。
5. 检查两个文件中的凭证、不面向审查者的私人笔记、未解析的本地路径、阻止图像标记、不支持的声明和意外第三方数据。HTML 不得包含相对的、缺失的或未审查的图像源。
6. 确认 `JPAGE_DEFAULT_VISIBILITY=private`。展示确切的 base、两个源路径、名称、可见性和标签，然后获得对此远程上传配对的批准。
7. 在不使用 `--public` 的情况下上传两个文件：

   ```bash
   jpage upload "$MARKDOWN_PATH" --base "$JPAGE_BASE"
   jpage upload "$HTML_PATH" --base "$JPAGE_BASE"
   ```

8. 捕获两个返回的文件 ID。在配置时对每个 ID 应用 `JPAGE_DEFAULT_TAGS`，并在相同的文章词干和修订下保留此配对。
9. 读取回文件元数据并对已认证的远程内容进行哈希，而不打印它。验证两个文件的文件名、类型、私密可见性和内容摘要。
10. 在窄幅 375 px 和 390 px 宽度下内部打开已认证的私密 HTML。确认页面加载，每个已审查的图像渲染，没有图像损坏或被替换，标题、标签、裁剪、代码和文本节奏保持可读。此内部验证不是用户预览。
11. 仅在检查完成后记录 `remote_render_gate=pass`。记录包含所有三个视觉门控、base URL、文章修订、Markdown 和 HTML 文件 ID 及已认证位置、本地和远程哈希、可见性、标签、批准和验证结果的预览收据。
12. 仅在远程门控通过后，才能向用户显示已认证的 HTML 预览位置，或将包交给 `publish-wechat-article` 或 `save-wechat-browser-draft`。一次成功的上传或仅 Markdown 检查不是完成。

## 输出

- 同一文章修订版本的私密 JPage Markdown 源产物和私密自包含 HTML 视觉预览。
- 包含两个文件 ID、已认证预览 URL、哈希、可见性、标签、`asset_gate`、`integrated_render_gate`、`remote_render_gate` 和验证状态的配对预览收据。
- 明确的门控结果：准备进行 WeChat 草稿写入，或在任何草稿变更前被阻止。

## 审批门控

- 本地渲染、哈希、机密扫描和只读 JPage 检查不需要审批。
- 上传私密 Markdown 和 HTML 配对是外部写入，需要对确切的文件和 JPage base 进行审批。
- 公开可见性需要单独明确审批。永远不要从创建私密预览或 WeChat 草稿的审批中推断。
- 覆盖、重命名、更改可见性、模板实例化、恢复和删除每个都需要对确切目标的审批。

## 故障处理

- 如果 JPage 配置或认证缺失，保留两个本地文件，并在任何 WeChat 草稿写入之前停止。只列出缺失的变量名。
- 如果视觉清单或质量报告缺失、过时、失败或来自另一个修订版本，不要上传，也不要暴露预览位置。
- 如果只有一个文件上传，将配对标记为不完整，在重试前检查当前远程状态，并且不要创建或更新 WeChat 草稿。
- 如果本地和远程哈希不同，将预览视为过时或损坏，在确认操作后上传新的私密修订版本。
- 如果任何远程图像缺失、被替换、不可读或视觉损坏，保持预览私密且不公开，返回格式化或视觉生产，并重复所有受影响的门控。
- 如果 CLI 不可用，仅在存在已批准的 JPage MCP 连接时使用上游 MCP 上传机制，保留私密可见性和相同的双文件验证门控。
- 如果 JPage 对私密文件没有返回可共享的 URL，返回其文件 ID 和已认证预览位置；不要仅仅为了获取匿名链接而将其公开。

## 交接规则

- 将已验证的配对收据和不变的本地文章包交给 `publish-wechat-article` 或 `save-wechat-browser-draft`。
- 将内容或渲染更正返回给 `draft-deep-tutorial` 和 `format-wechat-article`，然后创建新的配对预览修订版本。
- 将持久令牌轮换、机密存储或托管自动化交给 DevOpsEngineer。
- 在需要时将独立预览渲染验证交给 QAEngineer。
