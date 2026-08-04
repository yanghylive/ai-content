 # Agent 画像生成规范

本文定义本仓库生成标准化 Agent 画像的教义、分层、流程和验收门禁。目标是让新增 Agent 既适合大模型协作，也能稳定生成中文画像页和团队入口卡片。

## 一、核心原则

1. **灵魂先于骨架**
   新角色必须先证明其存在必要性，形成角色命题、第一责任、判断方式和授权边界，再填写模板。目录完整只能证明角色成形，不能证明角色已经“醒来”。

2. **身份源文件英文化，技能资料可本地化**
   `agent-soul/` 下所有内容必须使用英文。它是给模型、工具和生成器读取的权威身份定义，不承担中文展示职责。
   `PROFILE.yaml` 中明确用于生成中文展示层、且字段名以 `_zh` 结尾的字符串值可以使用中文；除此之外的角色身份、推荐、边界与行为定义保持英文。
   `{role-name}-skills/` 下的技能入口建议使用英文以便跨模型路由，但允许根据用户、业务和交付场景使用中文；技能附属的 `templates/`、`references/`、示例、业务文档模板和上游资料可以保留原语言。

3. **展示层中文化**
   `agent-detail.zh.md` 与 `agent-persona.html` 使用中文。它们服务于人类阅读、团队沟通和角色展示。

4. **推荐层结构化**
   每个角色必须有 `agent-soul/PROFILE.yaml`。它是推荐、路由和画像生成的机器可读入口，不能只依赖大段 Markdown 推断。
   当前正式版本为 Schema `2.1`，由 [`schemas/profile-v2.1.schema.json`](schemas/profile-v2.1.schema.json) 定义；`mcp/mcp.json` 由 [`schemas/mcp.schema.json`](schemas/mcp.schema.json) 定义。角色自身的 `version` 描述角色内容演化，不得与 `schema_version` 混用。

5. **执行层可操作**
   `IDENTITY.md`、`PERSONA.md`、`BIBLE.md` 等文件必须能指导 Agent 被选中后的真实工作，而不是只描述性格。

6. **技能层独立**
   每个角色必须预留 `{role-name}-skills/` 目录（kebab-case 角色名 + `-skills`）。角色可以有多个技能，每个技能独立成 `{role-name}-skills/{skill-id}/`，避免把所有执行细节都塞进 `BIBLE.md`。

7. **MCP 配置集中**
   每个角色必须在 `mcp/mcp.json` 中声明其使用的 MCP Server。该文件是角色可用外部工具/数据能力的机器可读清单，避免把 MCP 启动参数散落在各个 skill 或 agent-soul 文件中。

8. **边界先于能力**
   一个好 Agent 不只写“会做什么”，还必须写“不做什么”“什么时候交接”“什么时候必须询问或审批”。

9. **证据优先**
   所有完成标准、工具使用、外部写入和高风险操作都必须有证据或门禁，避免模型凭感觉宣布完成。

10. **稳定判断构成人格**
   人格不是形容词或背景故事，而是角色在模糊、冲突、压力、失败和越界诱惑下仍可辨认的选择方式。任何人格描述都必须映射到可观察行为。

11. **标准是骨架，不是灵魂**
   模板统一角色的基本器官，不统一角色的判断。若多个角色仅替换名称后仍可共用同一段使命、人格或工作流，则角色尚未完成定制。

12. **工作文件与长期记忆分离**
   每个角色必须通过 `AGENT_WORK_DIR` 保存任务输入、原始数据、过程产物、输出与证据，通过 `AGENT_MEMORY_FILE` 读取和精选写回现有 `agent-soul/MEMORY.md`，并声明可选的 `AGENT_TARGET_ROOT` 作为按任务启用的正式目标目录。完整协议见 [agent-runtime-storage-standard.md](agent-runtime-storage-standard.md)。

### 1.1 角色灵魂内核

在创建最终文件前，必须先形成三项工作产物：

1. **角色命题（Role Thesis）**：用一句话说明角色为谁、持续负责什么结果、依靠什么独特判断、权限止于哪里。
2. **灵魂内核（Soul Kernel）**：至少包含存在理由、受益者与代价、第一责任、保护对象、核心张力、价值优先级、最深失败、需要抵抗的诱惑、身份不变量和反目标。
3. **行为契约（Behavioral Contract）**：把灵魂内核映射到推荐信号、决策启发、工作流、沟通方式、自主决策区、必须告知区、必须确认区、拒绝/交接区、失败恢复、完成证据和记忆规则。

角色命题回答“为什么需要它”，灵魂内核回答“它在冲突中是谁”，行为契约回答“用户如何看见它确实如此”。三者不一致时，不得进入展示层制作和团队登记。

创建独立角色前还必须做“角色或 Skill”判断：若需求只是可复用流程、没有独立且反复发生的判断责任，应优先扩展现有角色的 Skill，而不是新增角色目录。

## 二、文件分层

| 层级 | 文件 | 语言 | 用途 |
|------|------|------|------|
| 推荐入口 | `agent-soul/PROFILE.yaml` | 英文 | 角色 ID、推荐规则、适用/不适用场景、交接目标、生成摘要 |
| 身份边界 | `agent-soul/IDENTITY.md` | 英文 | 角色使命、职责、边界、不可协商原则、完成标准 |
| 行为风格 | `agent-soul/PERSONA.md` | 英文 | 性格、沟通方式、决策启发法、反模式 |
| 工作风格 | `agent-soul/WORK_STYLES.md` | 英文 | 可标签化的行为偏好和常见模式 |
| 执行圣经 | `agent-soul/BIBLE.md` | 英文 | 完整工作流、门禁、异常处理、交付合同 |
| 工具说明 | `agent-soul/TOOLS.md` | 英文 | 可用工具、触发条件、权限边界、失败降级 |
| 能力表 | `agent-soul/CORE_CAPABILITIES.md` | 英文 | 核心能力与一句话说明 |
| 交付承诺 | `agent-soul/DELIVERY_COMMITMENTS.md` | 英文 | 不同任务类型的交付物和完成门禁 |
| 用户学习 | `agent-soul/USER.md` | 英文 | 用户偏好、长期上下文、运行时学习 |
| 长期记忆 | `agent-soul/MEMORY.md` | 英文 | 记忆规则、长期经验、用户纠正、历史决策与 Learned Memory |
| 技能总览 | `{role-name}-skills/SKILL.md` | 英文优先，可中文 | 本角色技能索引、命名规则、技能边界、路由与门禁 |
| 具体技能 | `{role-name}-skills/{skill-id}/SKILL.md` | 英文优先，可中文 | 单个可复用技能的触发条件、流程、输入输出、门禁 |
| 技能模板/参考 | `{role-name}-skills/{skill-id}/templates/`、`references/` | 原语言 | 产出模板、业务模板、上游资料和示例，不作为角色身份权威源 |
| 中文详情 | `agent-detail.zh.md` | 中文 | 角色入口说明、agent-soul 索引、能力摘要、详细工作流与检查清单 |
| 英文源合集 | `agent-detail.en.md` | 英文 | agent-soul 全部文件的集中展示 |
| 中文画像 | `agent-persona.html` | 中文 | 可视化画像页 |
| 环境变量 | `env/.env.example` | 中文注释 | 角色与技能所需外部配置示例 |
| 工作目录入口 | `workdir/README.md`、`workdir/.gitignore` | 英文 | Workdir v1 结构、运行文件边界和 Git 排除规则 |
| MCP 配置 | `mcp/mcp.json` | JSON | 该角色使用的 MCP Server 清单与启动参数 |

例外和约束：技能附属资料可以保留原语言，但不得替代 `agent-soul/` 中的身份边界，不得扩大角色权限，不得把上游默认动作变成角色授权。若 `SKILL.md` 使用中文，仍必须保留 YAML frontmatter、标准二级标题、触发条件、审批门禁、输出和失败处理，保证工具可校验、模型可路由。

## 三、标准生成流程

### 1. 定义角色定位

先回答以下问题；能从仓库和工作流证据中安全推断时，直接形成有标注的假设，不要把流程变成字段问卷：

| 问题 | 输出位置 |
|------|----------|
| 这个 Agent 解决哪类真实问题？ | `PROFILE.yaml`、`IDENTITY.md` |
| 如果它不存在，哪项反复发生的责任会无人承担？ | `PROFILE.yaml`、`IDENTITY.md` |
| 它的第一责任是什么？ | `IDENTITY.md` |
| 它保护什么，最害怕造成什么失败？ | `PROFILE.yaml`、`IDENTITY.md`、`PERSONA.md` |
| 哪组核心张力决定它的取舍？ | `IDENTITY.md`、`PERSONA.md` |
| 用户如何从压力下的选择认出它？ | `PERSONA.md`、`BIBLE.md` |
| 它不能碰什么？ | `IDENTITY.md`、`BIBLE.md` |
| 它可以自主决定、必须告知、必须确认、必须拒绝或交接什么？ | `IDENTITY.md`、`TOOLS.md`、`BIBLE.md` |
| 用户什么表达应该推荐它？ | `PROFILE.yaml` |
| 什么情况应该推荐别的角色？ | `PROFILE.yaml`、`BIBLE.md` |
| 完成任务的最低证据是什么？ | `BIBLE.md`、`DELIVERY_COMMITMENTS.md` |
| 哪些身份不变量可防止未来更新悄悄替换角色？ | `PROFILE.yaml`、`MEMORY.md` |

### 2. 先写角色命题与 `PROFILE.yaml`

角色命题和灵魂内核是 `PROFILE.yaml` 的前置输入。`PROFILE.yaml` 是推荐层入口，必须先写。它应该短、准、可比较，不写长篇工作流。

必须包含：

- `schema_version: "2.1"`
- `id`
- `display_name`
- `role_type`
- `version`
- `lifecycle`
- `mission`
- `role_thesis`
- `soul_kernel`
- `identity_invariants`
- `primary_jobs`
- `best_for`
- `not_for`
- `routing.triggers`
- `routing.negative_triggers`
- `routing.required_context`
- `handoff_targets`
- `tools`
- `quality_tests`
- `completion_gates`
- `runtime_storage`
- `generation`

`quality_tests` 至少包含 `necessity`、`replacement`、`pressure`、`authority`、`truth`、`evolution` 六项。正式角色中的每一项必须是可审计对象：

```yaml
quality_tests:
  necessity:
    status: pass
    assertion: "Why this recurring responsibility needs an independent owner."
    evidence:
      - agent-soul/IDENTITY.md
```

正式角色只允许 `status: pass`；`assertion` 必须是非空结论，`evidence` 必须是角色目录内现存普通文件的相对路径，禁止绝对路径、路径逃逸和不存在的“证据”。模板允许 `pending` 与占位符，但仍使用相同对象结构。

Schema `2.0` 到 `2.1` 的迁移只改变画像契约：把六项质量测试字符串迁移为
`{status, assertion, evidence}`，并把 `schema_version` 更新为 `2.1`。本独立
仓库已经使用 Schema `2.1`，不附带面向其他角色的迁移器；团队级迁移请使用
[AgentWaker 主仓库](https://github.com/code2rich/agentwaker)。

### 3. 再写英文源文件

写作顺序建议：

1. `IDENTITY.md`
2. `PERSONA.md`
3. `CORE_CAPABILITIES.md`
4. `TOOLS.md`
5. `DELIVERY_COMMITMENTS.md`
6. `BIBLE.md`
7. `WORK_STYLES.md`
8. `USER.md`
9. `MEMORY.md`

原则：先边界，再能力，再流程。

源文件之间必须共享同一第一责任和价值优先级，但不得机械重复同一段话。每个文件应回答自己的问题：身份为何存在、人格如何判断、工作流如何行动、工具如何受限、交付如何举证、记忆如何守住身份。

### 4. 配置运行时存储

每个角色必须在 `PROFILE.yaml` 声明：

```yaml
runtime_storage:
  work_dir_env: AGENT_WORK_DIR
  memory_file_env: AGENT_MEMORY_FILE
  target_root_env: AGENT_TARGET_ROOT
  work_dir_layout: workdir-v1
  memory_read_on_start: true
  memory_write_policy: curated
  completion_record: run.yaml
```

同时完成：

- 在 `env/.env.example` 中声明三个变量；Workdir 与 Memory 必需，Target Root 可选，真实绝对路径只写入被忽略的 `env/.env` 或运行器环境。
- 创建 `workdir/README.md` 与 `workdir/.gitignore`。
- 在 `BIBLE.md` 中要求任务启动时读取 Memory、创建运行记录，收尾时评估长期记忆晋升。
- 在 `MEMORY.md` 中保留统一 Learned Memory 标记块，原始数据和普通产物只进入 Workdir。
- 按 [agent-runtime-storage-standard.md](agent-runtime-storage-standard.md) 执行并发、秘密、保留和生成文件规则。

运行记录不得靠手工拼写和自由状态字符串维护。统一入口为：

```bash
ruby tools/agent-runtime.rb <command> --role . ...
```

| 命令 | 职责 |
|------|------|
| `start` | 解析角色路径与安全配置、读取 Memory、快照 Profile/Skill/MCP/环境示例/策略哈希并初始化唯一运行 |
| `record` | 在运行仍为 `active` 时原子追加输入、产物、证据、审批、命令和遗留工作检查点 |
| `close` | 记录终态、产物、证据、审批、命令与遗留工作，不允许用 `active` 关闭 |
| `validate` / `validate-all` | 校验单次运行或该角色的全部运行记录 |
| `propose-memory` / `promote-memory` | 先形成可审提案，再在锁和哈希保护下晋升长期记忆 |
| `gc` | 默认只报告保留策略候选；只有显式 `--apply` 才执行清理 |
| `migrate-run` | 默认只审计旧清单；`--apply` 时先保留 `.legacy.bak` 再迁移 |

命令参数、`run.yaml` 必需字段、终态和保留策略以 [agent-runtime-storage-standard.md](agent-runtime-storage-standard.md)、[`schemas/run-record.schema.json`](schemas/run-record.schema.json) 与 [`agent-runtime-policy.yaml`](agent-runtime-policy.yaml) 为唯一权威；角色 `workdir/README.md` 只保留角色路径和专属扩展说明，不复制一份可能漂移的 Schema。

### 5. 定义角色技能

每个角色必须有 `{role-name}-skills/SKILL.md` 作为技能总览。当某个能力具备稳定触发条件和可复用流程时，应升级为独立技能目录。

推荐结构：

```
{role-name}-skills/
├── SKILL.md           # 技能总览、路由与门禁
└── {skill-id}/
    ├── SKILL.md
    ├── scripts/        # optional
    ├── templates/      # optional
    └── examples/       # optional
```

`SKILL.md` 必须包含：

- purpose
- trigger conditions
- required inputs
- workflow
- outputs
- approval gates
- failure handling
- handoff rules

技能设计原则：

- 一个技能只解决一类稳定任务。
- 技能必须能被 `PROFILE.yaml` 或 `TOOLS.md` 引用。
- 技能不能扩大角色边界；越界时必须交接。
- 技能目录使用英文、短横线命名，例如 `bug-reproduction`、`prd-generation`。

#### 共享能力依赖

跨角色重复出现的信息采集、视觉生成等执行能力统一维护在仓库根目录 `capabilities/`。共享能力只提供稳定输入输出契约、适配器与通用检查，不拥有角色判断、角色权限或平台发布决策。每个角色仍保留角色自有 Skill wrapper，并在角色根目录的 `capabilities.yaml` 中声明“角色 Skill -> 共享能力 -> 能力 Profile”的依赖关系。

- `capabilities/{capability-id}/CAPABILITY.yaml` 是共享能力的版本化入口。
- `capabilities/registry.yaml` 是可导入共享能力清单；导入系统必须先注册能力，再解析角色依赖。
- `{role}/capabilities.yaml` 是人维护的角色依赖清单；即使没有依赖也必须存在并使用空数组。
- `capabilities.lock.yaml` 是导入系统可选生成的解析结果，不手工维护，也不代替源清单。
- 共享能力不能自动扩大角色权限；实际权限取系统、共享能力、角色声明与当前用户授权的交集。
- 不得把共享能力手工复制为多个可编辑角色副本。需要独立分发时，由导出流程生成带版本和内容摘要的只读快照。

### 6. 生成中文展示层

中文展示层从英文源文件生成或人工整理：

1. `agent-detail.zh.md`：入口、角色定位、技能清单、`agent-soul/` 索引、完整角色说明、配置项、工作流、检查清单。
2. `agent-persona.html`：可视化展示身份、能力、工作流、交付承诺。
3. `agent-team.html`：增加一张入口卡片，链接指向 `{role}/agent-persona.html`。

中文展示层可以更易读，但不能引入英文源文件没有定义的核心能力或越权承诺。

中文语义同步完成后运行 `sync-display-digest.rb {role}`。该命令只把当前源文件、技能、环境示例和 MCP 配置的摘要写入中文详情与画像，不翻译、不修复、也不替代人工或模型语义复核；后续任一输入变化都会使机械校验失败，直到展示层重新复核并同步摘要。

### 7. 分两阶段验证并登记

新角色不能一边要求“已登记”才能通过验证，一边又要求“验证通过”才能登记。固定顺序如下：

1. 先对完整但尚未登记的角色运行 `validate-role.rb {role} --phase standalone`。
2. `standalone` 通过后，才更新 `agent-team.html` 与两份 README。
3. 登记完成后运行 `validate-role.rb {role} --phase integrated`，验证团队卡片、索引、跨角色交接与全部仓库约束。

现有角色更新也沿用此顺序：先验证角色自身，再同步公共表面，最后验证集成状态。默认 phase 为 `integrated`，但工作流中必须显式写出 phase，避免误用。

## 四、推荐规则设计

每个角色至少定义四类推荐信号：

| 类型 | 说明 | 示例 |
|------|------|------|
| 正向触发 | 用户说什么时推荐此角色 | “帮我修复接口 bug” |
| 负向触发 | 用户说什么时不要推荐此角色 | “只想看测试报告” |
| 上下文要求 | 推荐前最好确认什么 | 仓库路径、目标分支、MCP Token |
| 交接目标 | 不适合时交给谁 | QA、Backend、DevOps |

推荐逻辑应按职责优先级判断，而不是按关键词粗暴匹配：

`handoff_targets[].role` 必须填写接收角色已登记的 `PROFILE.yaml.id`，不能填写展示名、未登记角色或“相关专家”这类动态类别。需要按领域动态选择接收者时，应单独声明咨询规则，并说明如何从已登记角色中解析实际接收者。

| 用户意图 | 首选角色 |
|----------|----------|
| 定义产品方向、PRD、需求优先级 | ProductManager |
| 拆计划、排期、风险、负责人、会议纪要 | ProjectAdministrator |
| 判断结构、模块边界、架构债务 | Architect |
| 实现后端功能、修复后端 bug | BackendDeveloper |
| 实现页面、组件、交互、视觉 | FrontDeveloper |
| 复现、验证、测试计划、缺陷证据 | QAEngineer |
| CI/CD、环境、部署、回滚、监控 | DevOpsEngineer |
| 多仓库分支合并到 dev | CodeMergeIntegrator |
| AgentWakerTeam 代码检视平台查询、解释、评价 | CodeReviewer |
| 小红书内容运营、笔记草稿、趋势调研、发布检查、即页辅助页面 | XiaohongshuOperator |
| AI 科技情报、公众号深度写作、微信排版、草稿与审批发布、文章复盘 | WeChatOfficialAccountOperator |
| 创建、深化、修复、审计或演化 Agent 角色及团队责任边界 | AgentWakerCreator |

## 五、英文源文件写作要求

### 必须做到

- 使用清晰短句，减少文学化表达。
- 每个职责都能映射到具体输入、动作和输出。
- 所有外部写入、高风险操作和权限动作必须写审批条件。
- 明确“done means”，不要只写“best effort”。
- 写清楚阻塞时如何降级。
- 工具不可用时必须给出可执行替代路径。

### 禁止

- 只写人格，不写流程。
- 写“负责所有相关事项”这类泛化职责。
- 多个角色共享同一大段模板却不改边界。
- 在中文展示层添加英文源文件没有的能力。
- 把推荐规则藏在 `BIBLE.md` 深处。
- 把运行时记忆写死成不可更新事实。
- 用“专业、可靠、主动、证据驱动”等通用形容词代替角色特有的判断方式。
- 写虚构工具、权限、经验或完成证据来增强角色的戏剧性。
- 让多个角色仅替换名称后仍可共享相同的 `PERSONA.md`、`IDENTITY.md` 或 `BIBLE.md`。
- 在没有角色命题和压力测试的情况下，因文件齐全就宣布角色完成。

可以使用有感染力的语言，但每一句核心人格表达都必须能追溯到具体的决策、拒绝、恢复或交接行为。无法影响行为的文学化内容应删除。

## 六、验收门禁

新增 Agent 进入团队入口前，必须检查：

| 门禁 | 通过标准 |
|------|----------|
| 存在必要性 | 能说明若无此角色哪项反复发生的责任会无人承担；若只是流程，应改为 Skill |
| 角色命题 | 一句话包含受益者、负责结果、独特判断和权限边界 |
| 灵魂内核 | 明确第一责任、保护对象、核心张力、价值顺序、最深失败、诱惑、身份不变量与反目标 |
| 盲测辨识度 | 删除角色名称后，仍可凭其判断、拒绝、恢复和交付偏好区别于通用助手及相邻角色 |
| 压力测试 | 在模糊、冲突、捷径压力、越界诱惑、失败和变化场景下给出稳定且角色特有的选择 |
| 授权清晰 | 明确可自主决定、必须告知、必须确认、必须拒绝或交接的动作 |
| 角色生态 | 与至少两个最相邻角色说明交集、第一责任分界和交接包，或证明不存在相邻冲突 |
| 能力真实 | 每项能力映射到真实工作流、Skill、工具或明确标注的未来缺口 |
| 身份可演化 | 记录身份不变量；更新时区分深化、演化与重生 |
| Schema 契约 | `PROFILE.yaml` 通过 `schemas/profile-v2.1.schema.json`；`mcp/mcp.json` 通过 `schemas/mcp.schema.json` |
| 质量证据 | 六项 `quality_tests` 均为 `pass`，每项有非空结论和角色目录内现存相对证据路径 |
| 文件完整性 | 模板文件齐全，`agent-soul/` 有 10 个文件，并有 `workdir/README.md` 与 `workdir/.gitignore` |
| 技能目录 | 存在 `{role-name}-skills/SKILL.md`，具体技能按 `{role-name}-skills/{skill-id}/SKILL.md` 扩展 |
| 语言分层 | `agent-soul/` 英文，展示层中文；角色自有 `SKILL.md` 英文优先但可中文，技能模板、参考和示例可保留原语言 |
| 推荐可判定 | `PROFILE.yaml` 有正向、负向、上下文、交接规则 |
| 边界清晰 | `IDENTITY.md` 写明职责、不负责项和审批条件 |
| 执行可落地 | `BIBLE.md` 有流程、门禁、失败处理 |
| 工具可控 | `TOOLS.md` 写明触发条件、权限和失败降级 |
| 交付可验证 | `DELIVERY_COMMITMENTS.md` 有完成证据 |
| 工作留痕 | 每次正式工作在 `AGENT_WORK_DIR` 下创建独立运行记录，输入、原始数据、过程产物、输出和证据不散落 |
| 记忆闭环 | 启动时读取 `AGENT_MEMORY_FILE`；仅将验证后的长期经验写入 Learned Memory，普通工作文件不得灌入 |
| 无能力漂移 | 中文展示层没有超出英文源文件的核心能力，并携带语义复核后同步的当前源摘要 |
| 两阶段验证 | 登记前 `standalone` 通过，登记后 `integrated` 通过；不以临时缺卡或先登记后补验证绕过门禁 |
| 入口登记 | `agent-team.html` 有卡片且链接正确 |
| 主题独立 | 画像主题色与现有角色不撞色 |

语义门禁与机械门禁必须分别结论。机械全部通过但任一必需语义门禁失败时，角色仍不得视为完成。

### 机械验证入口

```bash
# Bundled shared capabilities and this standalone role
ruby tools/validate-capabilities.rb
ruby tools/validate-role.rb . --phase standalone

# Runtime records under the configured Workdir
ruby tools/agent-runtime.rb validate-all --role .
```

团队入口、可复用模板和跨角色集成校验属于完整 AgentWaker 仓库，不是本独立
角色的本地门禁。

## 七、推荐的迭代策略

不要一次性把所有旧角色重写。建议：

1. 先把模板稳定下来。
2. 选一个角色作为样板，例如 `CodeReviewer` 或 `BackendDeveloper`。
3. 为样板补 `PROFILE.yaml`，并把 `agent-soul/` 翻译/收敛成英文，补齐 `{role-name}-skills/SKILL.md`。
4. 用样板验证生成 `agent-detail.zh.md`、`agent-detail.en.md`、`agent-persona.html` 的质量。
5. 再批量迁移其他角色。
