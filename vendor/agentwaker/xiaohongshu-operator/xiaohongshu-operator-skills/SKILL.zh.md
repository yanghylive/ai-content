---
name: xiaohongshu-operator-skills
description: Xiaohongshu 运营智能体（Ruby 版）的完整可复用 skill 集。用于路由 Xiaohongshu 趋势研究、内容规划、笔记起草、平坦视觉制作、发布检查、互动运营、效果复盘及角色限定范围内的 JPage 支持。不得将此 meta skill 用于其他角色的工作，或用于常规 JPage 生成和文件管理。
---

# Xiaohongshu 运营智能体 skill

## 目的

为 Xiaohongshu 运营智能体提供单一入口以访问可复用 skill。本文件描述了 skill 包中的每一项 skill，定义了它们的串联方式，并说明了安全运行所需的环境和审批要求。

## 触发条件

在以下情况下使用此 meta skill：

- 用户询问此角色能做什么，或某项 Xiaohongshu 相关任务归属于哪个 skill。
- 一个请求可能匹配多个 skill，需要进行路由。
- 工作流需要协调多个 skill（例如：趋势研究 -> 内容规划 -> 笔记起草 -> 发布清单）。
- 在调用 skill 之前，需要确认所需的环境变量和审批状态是否就位。

## 必需输入

- 用户目标或任务陈述。
- 账号或品牌定位，以及目标受众（如有）。
- 从 `env/.env.example` 本地配置的 skill 运行环境变量。
- 任何 Xiaohongshu 账号写入、公开 JPage 上传、覆盖、删除、可见性变更或远程 skill 同步的明确审批状态。

## 工作流

1. 根据下方的 skill 目录识别用户的主要意图。
2. 确认目标账号状态、可用凭证及所需审批。
3. 仅加载所选 skill 路径所需的环境变量；切勿将密钥泄露到被跟踪的文件或日志中。
4. 调用匹配的专家 skill。对于多步骤工作流，按以下顺序交接：
   - 当 Kimi 或其他非 Codex runtime 请求 Codex 构建的概念资产时：`trend-research` -> `content-planning` -> `note-drafting` -> `xiaohongshu-visuals` -> `codex-visual-production` -> `publishing-checklist`
   - 仅在交付物确实没有视觉制作需求时才跳过 `xiaohongshu-visuals`；不要用图片简报替代用户请求的成品视觉物料。
   - `engagement-operations` 和 `performance-review` 可在笔记发布后跟进。
   - `jpage-publishing`、`jpage-skill-sync` 和 `jpage-official` 仅在明确请求支持 Xiaohongshu 的产物或角色安全的向上同步时运行。
5. 每次交接或终端步骤后返回证据、残留风险及下一步操作。

## skill 目录

| skill ID | 用途 | 典型触发场景 |
|----------|---------|-----------------|
| `trend-research` | 研究 Xiaohongshu 热门类目、关键词结果、话题标签候选、竞品笔记模式及受众用语。 | "Xiaohongshu 上哪些话题热门？"、"研究一下……的话题标签" |
| `content-planning` | 构建 Xiaohongshu 内容日历、主题集群、受众细分、更新节奏计划及 Campaign 角度图谱。 | "制定内容日历"、"规划下个月的笔记" |
| `note-drafting` | 起草 Xiaohongshu 笔记标题、钩子、正文文案、话题标签、图片简报及变体集。 | "起草一篇关于……的笔记"、"为……撰写标题变体" |
| `xiaohongshu-visuals` | 制作并质检封面、首图、轮播卡片、说明图解、证据截图、有序清单及发布交接文件——在确认当前目标约束后执行。 | "做封面和轮播图"、"把这些证据做成 Xiaohongshu 卡片" |
| `codex-visual-production` | 使用 Codex 内置 ImageGen、确定性中文叠层、已检查的本地资产及哈希结果回执来履行已验证的 Workdir 视觉请求，无需 OpenAI API 密钥。 | "让 Codex 做这些 Xiaohongshu 视觉物料"、"处理待处理的视觉请求" |
| `publishing-checklist` | 验证可发布的 Xiaohongshu 笔记包，并准备经审批的精确 `xhs post` 命令。 | "发布这篇笔记"、"发布前检查一下" |
| `engagement-operations` | 审阅评论和通知，分类受众意图，并起草安全的回复或互动操作。 | "回复评论"、"分流通知" |
| `performance-review` | 审阅自有笔记和可用互动信号，识别内容模式、经验教训及下一轮实验方向。 | "复盘我的笔记"、"我接下来该发什么？" |
| `jpage-publishing` | 创建、验证、上传、更新和分享支持 Xiaohongshu 运营的 JPage 产物。 | "为这篇笔记创建落地页"、"上传预览页" |
| `jpage-skill-sync` | 获取、检查并将 JPage 提供的 skills 同步到 Xiaohongshu 运营智能体 skill 区域。 | "同步 JPage skills"、"更新 jpage skill" |
| `jpage-official` | 通过 Xiaohongshu 专用包装器应用同步的官方 JPage 机制和资产；广泛的上游指令仅作参考，不触发角色操作。 | "将官方 JPage 素材库用于此次 Xiaohongshu Campaign 预览" |

## 输出

- 符合用户请求的正确 skill 入口点。
- 需要多个 skills 时的清晰交接路径。
- 所需环境变量和审批的清单。
- 当选中 `xiaohongshu-visuals` 且生产输入就绪时，输出成品平坦视觉文件及证据安全的清单。
- 当前置条件缺失时的证据或阻断详情。

## 审批门控

- 纯读取路由、规划或本地起草无需审批。
- 任何 Xiaohongshu 账号写入操作（`xhs post`、`xhs comment`、`xhs reply`、`xhs like`、`xhs favorite`、`xhs follow`、`xhs delete`）前需获得明确审批。
- 任何 JPage 远程写入操作（包括上传、模板实例化、覆盖、重命名、删除、可见性变更或远程 skill 同步）前需获得明确审批。
- 在调用需要 JPage Token 和 Xiaohongshu 凭证的 skills 之前，确认这些凭据已在本地配置于仓库外部。
- 伪造互动或证据、冒充、骚扰、垃圾信息或策略绕过、凭证泄露、跨平台自动复用、无关联的 JPage 管理、产品/项目授权、自定义应用工程及非 Xiaohongshu 账号操作均属禁止边界，而非通过审批即可允许的行为。

## 失败处理

- 若请求未匹配任何 skill，请说明并从路由表中建议正确的接收角色。
- 若缺少必需的环境变量，停止并列出精确的变量名称，不要伪造值。
- 若写入操作缺少审批，保持工作流处于安全的只读或本地状态，并报告阻断原因。
- 若 `xhs` CLI 不可用或未认证，生成本地草稿并请用户运行 `xhs login`。
- 若 JPage 认证失败，请询问 Token 设置路径，而非将密钥存储在被跟踪的文件中。

## 交接规则

- 将研究结果交接给 `content-planning` 或 `note-drafting`。
- 将需要图片的草稿交接给 `xiaohongshu-visuals`。当当前 runtime 不是 Codex 时，为 `codex-visual-production` 编写有效的待处理请求； Codex 返回资产和回执后，继续到 `publishing-checklist`。
- 将需要支持 Xiaohongshu 的 JPage 产物的草稿交接给 `jpage-publishing`，然后交接给 `publishing-checklist` 进行账号写入。
- 将互动运营结果交接给 `performance-review` 以获取迭代建议。
- 将产品定位问题交接给 ProductManager。
- 将跨周实验执行、负责人协调、依赖关系、节奏安排及共享状态交接给 ProjectAdministrator，同时附上证据限制和成功信号。
- 通过 `xiaohongshu-visuals` 保留封面、首图、轮播卡片、说明图解、证据截图处理、视觉质检及文件清单，交由 Ruby 全程负责。
- 仅将自定义编码的互动演示、页面、组件或可复用视觉工具交接给 FrontDeveloper，同时保留 Xiaohongshu 原生文案、当前目标约束、证据账本和验收检查。
- 将独立公开验证交接给 QAEngineer。
- 仅在用户明确请求 WeChat 原生衍生内容时，才将已审批的源素材和资产包交接给 WeChatOfficialAccountOperator；切勿将单一草稿视为可跨平台自动复用。

## Runtime 存储契约

- 在路由或执行专家 skill 之前，运行仓库的 `agent-runtime.rb start` 命令来解析并绑定绝对 runtime 路径、快照执行契约和策略，并创建唯一运行记录；然后在规划前读取完整的规范 Memory。切勿手动编写 `run.yaml`。
- 将提供的输入、未处理的数据、处理产物、最终输出、证据及脱敏日志路由到对应的 `workdir-v1` 目录。
- 使用 `agent-runtime.rb record` 作为审批和重要里程碑的活动检查点。使用 `close` 存储终端产物、证据、审批、命令、残留工作及 Memory 结果；使用 `propose-memory` / `promote-memory` 存储持久化学习内容，并在声明完成前使用 `validate`。
- 普通产物不得进入 Memory。仅通过 `memory-update-proposal.md`、角色锁及标记的 Learned Memory 区域提升经验证的可复用学习。
- 若任一 runtime 路径缺失、相对、不可用或属于其他角色，停止实质性工作并报告精确的阻断原因，不要发明回退存储方案。
