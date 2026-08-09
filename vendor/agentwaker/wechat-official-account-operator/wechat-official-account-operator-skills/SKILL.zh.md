---
name: wechat-official-account-operator-skills
description: WeChat Official Account 运营专员的完整可复用 skill 集。使用此 meta skill 路由已注册的编辑类别，如完整地图优先架构解析和开源推荐，通过 AI 信号研究、规划、起草、视觉设计、格式化、配对 JPage 审核、WeChat Official Account 草稿或发布操作以及效果复盘。不要使用此 skill 执行属于其他智能体角色的工作。
---

# WeChat Official Account 运营专员 skill 集

## 目的

为 WeChat Official Account 运营专员的可复用 skill 提供单一入口。本文件描述了 skill 包中的每一项 skill，定义了它们的链接方式，并明确了安全运行所需的环境和审批条件。每次运行首先解析 `AGENT_WORK_DIR`，读取完整的 `AGENT_MEMORY_FILE`，并在 `workdir-v1` 下记录输入、处理产物、输出和证据。在 `research-ai-signals` 之前或同时使用 `aihot` 进行快速中文 AI 新闻查询。每篇完成的文章必须包含经过质量检验的有用视觉素材包；通过素材、集成渲染和私有远程渲染门禁；并将同一审核修订版本同时以 Markdown 和 HTML 格式存储在 JPage 中，然后才能展示预览位置或执行任何 WeChat Official Account 草稿写入操作。

## 触发条件

在以下情况下使用此 meta skill：

- 用户询问此角色能做什么，或哪个 skill 负责某个 WeChat Official Account 相关任务。
- 请求可能匹配多个 skill，需要路由。
- 工作流需要协调多个 skill（例如：研究 -> 规划 -> 起草 -> 格式化 -> 发布）。
- 在调用某个 skill 之前，需要确认所需的环境变量和审批是否就位。

## 所需输入

- 用户目标或任务陈述。
- 绝对路径的 `AGENT_WORK_DIR` 和 `AGENT_MEMORY_FILE` 值。记忆路径必须解析为此角色的规范 `agent-soul/MEMORY.md`。
- 涉及发布时的账户类型、认证状态和 API 权限状态。
- 从 `env/.env.example` 本地配置的本 skill 路径所需的环境变量。
- 当文章从本地格式化转向 WeChat Official Account 草稿时，需要 JPage 基础路径和令牌配置。
- 任何外部写入、草稿修改、素材上传、公开发布或粉丝群发操作的明确审批状态。

## 工作流

1. 从仓库根目录运行 `ruby tools/agent-runtime.rb start --role .`，验证并绑定两个运行时存储路径，快照执行契约和策略，并创建带日期的运行记录；然后在规划前读取完整的规范记忆文件。切勿手动编写 `run.yaml`。
2. 根据下方 skill 目录识别用户的主要意图。对于完成的文章，从 `plan-tech-series/references/editorial-categories.md` 中精确分配一个类别；不要用通用格式标签替换该类别。
3. 确认目标账户状态、可用凭证和所需审批。
4. 仅加载所选 skill 路径所需的环境变量；切勿将密钥加载到跟踪文件或日志中。
5. 调用匹配的专家 skill。对于多步骤工作流，按以下顺序交接：
   - `aihot`（可选的快速中文 AI 新闻查询）-> `research-ai-signals` -> `plan-tech-series` -> `draft-deep-tutorial` -> `design-wechat-visuals` -> 当另一个运行时需要 Codex ImageGen 时 -> `codex-visual-production` -> `format-wechat-article` -> `jpage-pre-draft-preview` -> `publish-wechat-article` 或 `save-wechat-browser-draft`。
   - `architecture-map` 必须以完整架构作为第一个正文图片开头，然后分解概述绑定的编号区域。`open-source-recommendation` 必须产出基于证据的采用裁决和评级。未来的类别必须进入注册表并连接到相同的规划、起草、视觉、格式化和验证路径。
   - `design-wechat-visuals` 对每篇完成的文章都是强制性的。它必须产出真实的封面和所需的正文图片，满足自适应视觉基准和所选类别契约，并记录 `asset_gate=pass`；单独的简报或提示不能继续。
   - `format-wechat-article` 必须生成自包含的视觉 HTML，在移动端宽度下检查，并记录带有机器验证质量报告的 `integrated_render_gate=pass`。
   - `jpage-pre-draft-preview` 必须上传并验证同一修订版本的 Markdown 源文件和渲染 HTML。其角色限定的私有默认设置覆盖 vendored 上游 JPage 参考中的更广泛或公共默认示例。
   - `jpage-pre-draft-preview` 仅在内部远程移动端检查记录 `remote_render_gate=pass` 且每张图片正确加载后，才能展示私有 HTML 预览位置。
   - `review-wechat-performance` 可在任何已发布文章之后进行，以告知下一个周期。
6. 随着工作进展，将有意义的输入、原始数据、中间文件、最终输出和验证证据存储在当前运行目录下。使用 `agent-runtime.rb record` 进行审批、账户写入和重要里程碑的原子检查点。
7. 使用 `agent-runtime.rb close` 进行最终记录，使用 `propose-memory` / `promote-memory` 进行已验证的可复用经验，并在声称完成前使用 `validate`。`none` 结果是正常的；普通产物保留在工作目录中。
8. 在每次交接或最终步骤后返回运行路径、输出和证据路径、记忆结果、剩余风险以及下一步操作。

## 运行时存储契约

- 将 `$AGENT_WORK_DIR/runs/YYYY/MM/DD/{run-id}/` 与 `run.yaml`、`input/`、`raw/`、`intermediate/`、`output/`、`evidence/`、`logs/`、`tmp/` 和 `memory-update-proposal.md` 配合使用；参见 `../workdir/README.md` 了解完整的 `workdir-v1` 契约。
- 仅通过 `agent-runtime.rb start`、`record`、`close` 和 `validate` 创建和修改运行记录；记录包含 Profile、skill、MCP、environment-example、Memory、approval、command 和 policy 证据。
- 不要将 shell 工作目录、仓库根目录、桌面或 `/tmp` 作为无声替代品。外部工具仅在需要时使用临时位置；将有意义的内容和证据复制回运行目录。
- 在选择 skill 路径或规划前读取 `AGENT_MEMORY_FILE`。当前指令和当前已验证证据优先于较旧的记忆。
- 仅在验证后并在 `AGENT_LEARNED_MEMORY` 标记内提升记忆，使用角色锁定和哈希冲突规则。切勿将原始数据、草稿、日志、密钥或隐藏推理写入记忆。

## skill 目录

| skill ID | 目的 | 典型触发 |
|----------|---------|-----------------|
| `aihot` | 在 AI HOT（aihot.virxact.com）查询中文 AI 新闻、每日简报、热门话题和类别特定信号。无需 API 密钥。 | "今天 AI 有什么动态？"、"AI 每日简报"、"最近的 OpenAI 发布"、"AI HOT" |
| `research-ai-signals` | 为 WeChat Official Account 科技账号发现、验证、规范化、去重并排名当前的 AI / 智能体 / AI 编程信号。 | "找出本周的 AI 信号"、"有什么值得写的？" |
| `plan-tech-series` | 将排名后的候选内容转化为连贯、节奏合理的系列文章，包含读者承诺和证据需求。 | "规划一个关于 Vibe Coding 工具的系列"、"下个月应该发布什么？" |
| `draft-deep-tutorial` | 研究并起草原创的、有证据支撑的、可复现的 WeChat Official Account 技术教程或解读文章。 | "起草一个关于...的教程"、"写一篇关于...的深度文章" |
| `design-wechat-visuals` | 制作并审核最终的封面和自适应的一组安全截图、图表、图表和概念图片。 | "为这篇文章设计视觉素材"、"这篇草稿需要更多有用的图片" |
| `codex-visual-production` | 使用 Codex 内置 ImageGen、确定性叠加、已检查的本地素材和哈希结果回执履行已验证的 Workdir 视觉请求，无需 OpenAI API 密钥。 | "让 Codex 制作这些 WeChat Official Account 视觉素材"、"处理待处理的视觉请求" |
| `format-wechat-article` | 构建 WeChat Official Account HTML 加上自包含的视觉审核页面，然后验证完整的移动端渲染。 | "为 WeChat Official Account 格式化这篇草稿"、"渲染完整的插图文章" |
| `jpage-pre-draft-preview` | 私下存储并验证同一 Markdown 和视觉 HTML 修订版本，然后仅在远程图片和移动端检查通过后才展示预览。 | "将文章预览放入 JPage"、"让我审核完成的插图文章" |
| `publish-wechat-article` | 通过官方服务器 API 管理 WeChat Official Account 内容图片、草稿、预览、发布任务和结果检查。 | "发布这篇文章"、"上传图片并创建草稿" |
| `save-wechat-browser-draft` | 通过受控浏览器将已批准的文章包填充到已登录的官方后台，仅保存草稿。 | "我没有 API 访问权限，将其保存为后台草稿" |
| `review-wechat-performance` | 审核允许的 WeChat Official Account 指标和读者信号，然后推荐基于证据的编辑实验。 | "回顾上个月的文章"、"哪些有效哪些无效？" |

## 输出

- 符合用户请求的正确 skill 入口点。
- 需要多个 skill 时的清晰交接路径。
- 所需环境变量和审批的清单。
- 包含输入、输出、证据和精选记忆状态的最终 `run.yaml`，以及相应的产物路径。
- 经验证的 JPage 预览回执，包含 Markdown 和 HTML 文件 ID，以及在预览展示或任何 WeChat Official Account 草稿写入之前通过的素材、集成渲染和远程渲染三个门禁。
- 缺少先决条件时的证据或阻止详情。

## 审批门禁

- 纯读取的路由、规划或本地渲染无需审批。
- 在将精确的私有 Markdown 和 HTML 预览对上传到 JPage 之前需要明确审批。公开可见性是单独的审批，对于未发布的 WeChat Official Account 内容永远不是默认设置。
- 在任何外部写入、素材上传、草稿修改、公开发布、粉丝群发、删除或身份绑定操作之前需要明确审批。
- 在允许相应 skill 调用危险开关（`WECHAT_ENABLE_MASS_SEND`、`WECHAT_ENABLE_PUBLISHED_DELETE`）之前，确认它们是故意设置的。
- 源平台交互、Xiaohongshu 或其他非 WeChat Official Account 账户操作、浏览器点击的公开或定时发布或粉丝群发、平台绕过、凭证泄露和伪造证据是禁止边界，而非通过审批变得允许的操作。

## 失败处理

- 如果请求不匹配任何 skill，说明情况并建议路由表中的正确接收角色。
- 如果缺少所需的环境变量，停止并列出确切的变量名称，不要伪造值。
- 如果任一运行时路径是相对的、不可用的或属于另一个角色，在实质性 skill 工作之前停止；不要发明备用位置。
- 如果记忆同时发生变化或提议的经验不是持久且经过验证的，保留 `memory-update-proposal.md`，记录 `proposal-only` 或 `conflict`，并保持规范记忆不变。
- 如果实际的视觉文件、当前修订清单、质量报告或三个视觉门禁中的任何一个缺失或未通过，不展示预览，也不继续执行 WeChat Official Account 草稿。
- 如果任一 JPage 预览文件缺失、未验证、未经审批公开或来自不同文章修订版本，保留本地包并在任何 WeChat Official Account 草稿写入之前停止。
- 如果写入操作缺少审批，保持工作流处于安全的只读或本地状态并报告阻止者。

## 交接规则

- 将快速 AI HOT 新闻结果交给 `research-ai-signals` 进行验证、规范化和排名，然后才能成为文章素材。
- 将研究结果交给 `plan-tech-series` 或 `draft-deep-tutorial`。
- 将每个已批准的完成文章修订版本交给 `design-wechat-visuals`。当当前运行时不是 Codex 时，为 `codex-visual-production` 写一个有效的待处理请求；在 Codex 返回素材和回执后，继续到 `format-wechat-article`。
- 将格式化的本地包交给 `jpage-pre-draft-preview`；仅有通过全部三个视觉门禁的私有 Markdown 和 HTML 对才能展示给用户或继续到 `publish-wechat-article` 或 `save-wechat-browser-draft`。
- 将已发布文章复盘交给 `review-wechat-performance`。
- 将持续性基础设施、调度、回调或密钥管理交给 DevOpsEngineer。
- 将公开渲染验证交给 QAEngineer。
- 将未解决的产品定位或商业声明交给 ProductManager。
- 仅在用户明确要求 Xiaohongshu 原生衍生内容时，将已批准的来源账本和可复用素材包交给 XiaohongshuOperator；保持平台编辑和账户审批分开。
