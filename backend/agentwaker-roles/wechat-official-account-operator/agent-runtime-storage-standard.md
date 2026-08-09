# Agent 运行存储规范

本文定义 AgentWaker 角色在真实执行过程中的工作文件、长期记忆与正式目标目录协议。目标是让 Codex、Claude、IDE Agent、CLI 或其他运行器通过统一变量区分过程存储、长期记忆和按任务启用的正式目标边界。

## 一、核心模型

每个 Agent 只有两个运行存储入口：

| 环境变量 | 类型 | 责任 |
|----------|------|------|
| `AGENT_WORK_DIR` | 目录 | 保存每次任务的输入、原始数据、中间产物、输出、证据和脱敏日志 |
| `AGENT_MEMORY_FILE` | Markdown 文件 | 指向该角色现有的 `agent-soul/MEMORY.md`，启动时读取，只写入经过筛选的长期经验 |
| `AGENT_TARGET_ROOT` | 目录（可选） | 本次任务正式读写的目标根目录；未设置时，正式产物只进入当前 run 的 `output/` |

两者必须严格分工：

- 所有任务都必须在 `AGENT_WORK_DIR` 中留下一份可追踪的运行记录。
- 不是每个任务都必须修改 `AGENT_MEMORY_FILE`。
- 原始数据、草稿、普通产物和工具日志不得灌入 `MEMORY.md`。
- 用户纠正、稳定偏好、可复用流程、已验证的失败经验和长期决定可以晋升到 `MEMORY.md`。

## 二、环境变量协议

每个角色的运行进程都必须获得：

```dotenv
AGENT_WORK_DIR=/absolute/path/to/the-role/workdir
AGENT_MEMORY_FILE=/absolute/path/to/the-role/agent-soul/MEMORY.md
AGENT_TARGET_ROOT=/absolute/path/to/formal/target
```

规则：

1. 三个变量一旦设置都必须是绝对路径，不允许依赖当前工作目录、`~` 展开或隐式默认值；前两个必需，`AGENT_TARGET_ROOT` 可选。
2. `AGENT_WORK_DIR` 必须是该 Agent 独占、可读写的目录。
3. `AGENT_MEMORY_FILE` 必须是普通文件，并指向当前角色的 `agent-soul/MEMORY.md`。
4. 同一套变量名在所有角色中复用；启动器必须为每个 Agent 进程注入该角色自己的两个值。
5. 真实值只写入被 Git 忽略的 `env/.env` 或运行器的 Secret/Environment 配置；仓库中的 `env/.env.example` 只放占位符。
6. 缺失、不可读写或指向错误角色时不得静默回退到仓库根目录、用户主目录或 `/tmp`。
7. `AGENT_TARGET_ROOT` 不属于某一类角色。Creator、开发、评审、文档或运营角色只要存在正式目录目标都可以使用；它不得指向 Workdir 并替代过程记录。

标准运行器的解析优先级固定为：显式 `--work-dir/--memory-file/--target-root`、进程环境变量、该角色被忽略的 `env/.env`。dotenv 解析器只读取三个运行时键，不执行命令、不插值其他变量；`run.yaml` 只记录来源名称，不输出其他环境内容。

## 三、角色目录入口

每个角色都应包含：

```text
{role}/
├── agent-soul/
│   └── MEMORY.md
├── workdir/
│   ├── README.md
│   └── .gitignore
└── env/
    ├── .env.example
    └── .env              # local only, ignored
```

`workdir/README.md` 说明结构和边界；`.gitignore` 排除实际运行内容。运行数据可以通过 `AGENT_WORK_DIR` 改到仓库外，但目录结构和语义保持不变。

## 四、Workdir v1 结构

```text
{AGENT_WORK_DIR}/
├── .agentwaker-workdir.yaml
├── runs/
│   └── YYYY/MM/DD/{run-id}/
│       ├── run.yaml
│       ├── input/
│       ├── raw/
│       ├── intermediate/
│       ├── output/
│       ├── evidence/
│       ├── logs/
│       ├── tmp/
│       └── memory-update-proposal.md
├── shared/
├── archive/
└── .locks/
```

`.agentwaker-workdir.yaml` 是运行器原子创建的角色绑定哨兵，记录角色 ID、角色目录、Profile 与 Memory 的真实路径。同一个 Workdir 只允许属于一个角色；哨兵不匹配时必须停止，禁止手工改写以绕过隔离。

目录语义：

| 路径 | 内容 |
|------|------|
| `input/` | 用户或上游 Agent 提供的任务说明、附件与明确输入 |
| `raw/` | API 返回、网页快照、截图、导出、采集数据等未经处理的原始材料；原则上只读 |
| `intermediate/` | 清洗数据、草稿、候选版本、渲染中间文件和可重建过程产物 |
| `output/` | 已完成并准备交付的最终产物；未完成文件不得冒充最终输出 |
| `evidence/` | 来源账本、测试报告、哈希、回读结果、发布状态和其他完成证据 |
| `logs/` | 已脱敏的工具、操作和错误日志 |
| `tmp/` | 明确允许清理的短期临时文件 |
| `memory-update-proposal.md` | 本次任务产生但尚未晋升的长期记忆候选 |
| `shared/` | 多次运行复用且不属于单一任务的非秘密素材 |
| `archive/` | 按角色保留策略归档的已关闭任务包 |
| `.locks/` | 并发任务使用的租约或文件锁 |

角色专属结构只能在单次运行目录、`shared/` 或 `archive/` 下扩展，不能把角色特例强加给所有 Agent 的顶层结构。

## 五、运行记录

每次正式工作必须创建唯一 `run-id`，推荐格式：

```text
YYYYMMDDTHHMMSSZ-{short-slug}-{random}
```

`run.yaml` 的正式机器可读契约是 [`schemas/run-record.schema.json`](schemas/run-record.schema.json)，关闭门禁和保留默认值由 [`agent-runtime-policy.yaml`](agent-runtime-policy.yaml) 定义。记录至少包含：

```yaml
schema_version: "1.0"
agent_id: ""
run_id: ""
goal: ""
tool: ""
started_at: ""
finished_at: null
status: active
profile:
  file: "/absolute/path/to/agent-soul/PROFILE.yaml"
  schema_version: "2.1"
  version: "2.0.0"
  sha256: ""
execution_contract:
  env_example: {file: "/absolute/path/to/env/.env.example", sha256: ""}
  mcp: {file: "/absolute/path/to/mcp/mcp.json", sha256: ""}
  skills:
    - {file: "/absolute/path/to/role-skills/SKILL.md", sha256: ""}
  runtime_sources:
    work_dir: "process environment"
    memory_file: "/absolute/path/to/role/env/.env"
memory:
  file: "/absolute/path/to/agent-soul/MEMORY.md"
  read_at: ""
  read_sha256: ""
inputs: []
outputs: []
evidence: []
approvals: []
commands: []
residual_work: []
memory_update:
  status: pending
  proposal_file: memory-update-proposal.md
  entries: []
  promoted_at: null
retention:
  policy_file: "/absolute/path/to/agent-runtime-policy.yaml"
  policy_sha256: ""
  close_requirements: {}  # 完整复制所选 policy 的所有终态门禁
  retention_rules: {}     # 完整复制所选 policy 的保留规则
  closed_at: null
  archived_at: null
```

允许状态为 `active`、`complete`、`partial`、`blocked`、`failed` 或 `cancelled`。`inputs`、`outputs`、`evidence` 中的本地文件记录必须包含运行目录相对路径、SHA-256、字节数和记录时间；`approvals`、`commands`、`residual_work` 必须显式存在，即使为空。只有最终产物、证据、遗留事项和 Memory 处理状态都已记录时，运行记录才可关闭。

默认关闭门禁如下：

| 状态 | Output | Evidence | Residual work |
|------|--------|----------|---------------|
| `complete` | 至少 1 项 | 至少 1 项 | 必须为空 |
| `partial` | 至少 1 项 | 至少 1 项 | 至少 1 项 |
| `blocked` | 可为空 | 至少 1 项 | 至少 1 项 |
| `failed` | 可为空 | 至少 1 项 | 至少 1 项 |
| `cancelled` | 可为空 | 可为空 | 至少 1 项 |

仓库不得以非标准状态（如 `done`、`completed`、`in_progress`、`in_review`）继续写新记录；旧记录必须通过迁移命令转换并保留备份。

审批与命令不能只留一段无法追责的自由文本，最小 JSON 记录示例：

```json
{"action":"publish","target":"draft-1","approved_by":"user","approved_at":"2026-07-12T00:00:00Z","evidence":"evidence/approval.txt"}
{"command":"bundle exec rake test","executed_at":"2026-07-12T00:01:00Z","exit_code":0,"cwd":"/absolute/project/path","evidence":"evidence/tests.txt"}
```

Approval 必须包含 `action`、`target`、`approved_by`、`approved_at`、`evidence`；Command 必须包含 `command`、`executed_at`、`exit_code`。可选哈希字段由正式 schema 定义，缺少必需字段时整个关闭操作失败且不得写回半成品记录。

## 六、任务生命周期

### 1. 启动

1. 解析并验证两个必需变量及可选的 `AGENT_TARGET_ROOT`。
2. 完整读取 `AGENT_MEMORY_FILE`，然后再制定任务计划。
3. 创建唯一运行目录和 `run.yaml`。
4. 在 `run.yaml` 记录 Profile 的 schema/version/hash，以及 Memory 文件路径、读取时间和内容哈希。
5. 快照 `env/.env.example`、`mcp/mcp.json`、全部角色 `SKILL.md`（稳定排序）和所选 runtime policy 的绝对路径与 SHA-256，使本次执行契约可追溯。
6. 运行器创建或核对 Workdir 哨兵；若它已经绑定其他角色，立即停止。

### 2. 工作中

1. 所有本地输入、采集数据、过程文件和输出只能写入本次运行目录或用户明确指定的正式目标仓库。
2. 对正式目标仓库的修改应在 Workdir 中记录路径、基准提交、最终提交或差异证据，不复制整仓。
3. 可能值得长期复用的经验先写入 `memory-update-proposal.md`，不得在尚未验证时直接污染长期记忆。
4. 长任务、外部写入前后或取得审批时，使用 `agent-runtime.rb record` 原子记录当前 input/output/evidence/approval/command。Checkpoint 保持 `status: active`，使进程崩溃后仍能从最后一份有效记录恢复。

### 3. 收尾

1. 将最终交付放入 `output/`，验证证据放入 `evidence/`。
2. 更新 `run.yaml` 的状态、文件清单和遗留事项。
3. 评估 Memory 候选：无合格内容时记录 `none`；合格时按本规范晋升；发生并发冲突时记录 `proposal-only` 或 `conflict`。
4. `tmp/` 可以清理；其他内容没有明确保留策略时不得自动删除。

关闭动作必须先在内存中形成候选记录并完整校验，只有通过终态门禁后才能原子替换 `run.yaml`。失败的关闭尝试不得把半关闭状态写回磁盘。

## 七、长期 Memory 读写协议

`AGENT_MEMORY_FILE` 指向现有的英文权威源文件。Agent 必须读取整个文件，但自动写入只允许发生在以下标记之间：

```markdown
## Learned Memory

<!-- AGENT_LEARNED_MEMORY:BEGIN -->

<!-- AGENT_LEARNED_MEMORY:END -->
```

合格的记忆包括：

- 用户明确要求记住的内容；
- 用户对 Agent 的重要纠正；
- 稳定且可复用的用户偏好；
- 已验证并可重复使用的流程、模式和修复办法；
- 重要、长期有效且有证据的决定或约束；
- 一次失败中已经验证的原因、恢复方法和再发生条件。

禁止写入：

- 原始数据、普通任务产物、完整对话或大段日志；
- Token、密码、Cookie、私钥、认证头或敏感个人数据；
- 未验证推断、短期状态和没有验证日期的易漂移事实；
- 已由当前权威源完整定义、无需重复的内容。

推荐条目格式：

```markdown
### MEM-YYYYMMDD-NNN — Short title

- **Type:** preference | correction | decision | lesson | procedure
- **Scope:** agent | project | user
- **Memory:** What should change in future work.
- **Evidence:** Absolute or Workdir-relative verified reference.
- **Verified at:** YYYY-MM-DD
- **Reuse when:** Conditions under which this memory applies.
- **Supersedes:** Previous memory ID or none.
```

所有写入保持英文。冲突或过期内容通过 `Supersedes` 保留谱系，不得无痕覆盖。

## 八、并发与原子写入

写回 Memory 前必须：

1. 获取 `{AGENT_WORK_DIR}/.locks/memory.lock`。
2. 重新读取 Memory 文件并比较启动时哈希。
3. 仅在安全合并后，以同目录临时文件加原子替换方式写入。
4. 无法安全合并时保留 `memory-update-proposal.md`，不得采用最后写入者覆盖。

同一 Agent 的并发任务必须使用不同 `run-id`；不同 Agent 不得共享 `AGENT_WORK_DIR` 或直接写入对方的 Memory。

标准运行器的 `promote-memory` 在锁内完成哈希复核和原子替换。若启动哈希与当前文件不同，必须保留原 proposal，另存 `memory-update-conflict-*.md` 并把运行记录标为 `conflict`；不得使用最后写入者覆盖。

晋升前后都必须重新校验 proposal 的结构、证据路径、保留标记与秘密模式，手工篡改的 proposal 不能绕过 `propose-memory` 门禁。晋升写入权威 Memory 后，运行器必须自动重新生成 `agent-detail.en.md`，再执行 `validate-role.rb <role> --phase standalone`；两条命令、退出码和完整输出分别记录为 `commands` 与 `evidence/memory-promotion-*.log`。若后置校验失败，必须在同一把锁内原子恢复晋升前的 Memory、重建英文合集，把状态退回 `proposal-only` 并记录 rollback 结果；不得留下损坏的权威 Memory 或谎报闭环完成。

## 九、Git 与生成文件

- `workdir/` 的运行内容不得提交。
- `agent-soul/MEMORY.md` 是 Git 权威源；写回后应留下可审阅差异。
- Memory 写回不等于获得提交或推送授权。
- 修改 `MEMORY.md` 后必须重新生成 `agent-detail.en.md` 并运行角色校验。
- `env/.env` 不得提交；`.env.example` 不得包含本机真实路径、凭据或账号信息。

## 十、安全与保留

- Workdir 默认仅当前用户可读写；类 Unix 系统建议目录权限 `0700`、文件权限 `0600`。
- 标准运行器将 Workdir 根、顶层运行目录、日期层、单次 run 与其标准子目录统一为 `0700`；`run.yaml`、哨兵、proposal 和 lock 统一为 `0600`。验证器把更宽权限视为失败，而不是只给建议。
- 日志写入前必须脱敏，禁止保存完整环境变量快照。
- 拒绝路径穿越和逃逸 Workdir 根目录的符号链接。
- `gc --apply` 与 `migrate-run --apply` 必须在规划时及破坏性动作前分别重验每一级路径：运行目录、`tmp/`、归档目标和旧记录祖先均不得是符号链接，解析后的真实路径必须仍位于当前角色的 `runs/` 或 `archive/` 内。
- `tmp/` 可在任务关闭后清理；`input/`、`raw/`、`output/`、`evidence/` 和长期 Memory 没有明确策略时不得自动删除。
- 用户要求遗忘或删除时，应同时处理运行记录中的派生副本、Memory 条目和可控索引。

仓库默认策略为：终态运行 7 天后可清理 `tmp/`，30 天后可移入 `archive/`，默认永不删除归档。`gc` 永远先报告；只有显式传入 `--apply` 才执行报告中的动作。Memory 状态为 `proposal-only` 或 `conflict` 的归档在默认策略下不得删除。

每次 `start` 都把当时完整的 `close_requirements` 与 retention 规则复制进 `run.yaml`，并同时记录 policy 的绝对路径和哈希。`close` 与 `gc` 使用这份运行级快照；根 policy 后续升级不会让已经关闭的历史记录失效。Active run 在 checkpoint 或 close 前仍必须证明源 policy 路径与哈希未变化，防止任务中途静默换门禁。

## 十一、微信公众号示例

Weaver 的一次文章任务可以映射为：

- 搜索结果、RSS、GitHub API、网页快照和后台导出进入 `raw/`；
- 选题分析、来源清洗、文章草稿和 HTML 中间版进入 `intermediate/`；
- 最终 Markdown、HTML、封面和正文图片进入 `output/`；
- 来源账本、视觉检查、JPage 回执、微信草稿或发布状态进入 `evidence/`；
- 只有可复用的编辑规则、用户纠正、已验证的平台经验或长期偏好才晋升到 `MEMORY.md`。

## 十二、验收门禁

每个角色都必须证明：

1. `PROFILE.yaml` 声明三个环境变量及 Workdir v1，并明确目标根目录可按任务不设置。
2. `env/.env.example` 恰好声明一次 `AGENT_WORK_DIR`、`AGENT_MEMORY_FILE` 和 `AGENT_TARGET_ROOT`。
3. `workdir/README.md` 与 `workdir/.gitignore` 存在。
4. `MEMORY.md` 包含 Learned Memory 标记块和写入规则。
5. `BIBLE.md` 要求启动时读取 Memory、创建运行记录并在收尾时评估记忆晋升。
6. `TOOLS.md` 与 `DELIVERY_COMMITMENTS.md` 区分工作文件和长期记忆。
7. Workdir 运行内容不会被 Git 或角色源文件扫描器误收集。
8. 实际环境通过绝对路径、可读写性和 Memory 文件身份校验。

## 十三、维护命令

本独立仓库已经接入 Workdir v1，不附带面向其他角色的迁移器。需要迁移
AgentWaker 团队中的其他角色时，请使用
[AgentWaker 主仓库](https://github.com/code2rich/agentwaker)提供的迁移工具。

验证仓库定义和本机真实路径：

```bash
ruby tools/validate-role.rb . --phase standalone
ruby tools/agent-runtime.rb validate-all --role .
```

执行 Workdir v1 生命周期（命令均从仓库根运行，默认读取 `AGENT_WORK_DIR`、`AGENT_MEMORY_FILE` 与可选的 `AGENT_TARGET_ROOT`）：

```bash
RUNTIME=tools/agent-runtime.rb

ruby "$RUNTIME" start --role {role-directory} --goal "Task goal" --tool codex
ruby "$RUNTIME" record --role {role-directory} --run "$RUN_DIR" \
  --output output/current-result.md --evidence evidence/current-tests.txt
ruby "$RUNTIME" close --role {role-directory} --run "$RUN_DIR" --status complete \
  --output output/result.md --evidence evidence/validation.txt
ruby "$RUNTIME" validate --role {role-directory} --run "$RUN_DIR"
ruby "$RUNTIME" validate-all --role {role-directory}
```

Memory 候选与晋升：

```bash
ruby "$RUNTIME" propose-memory --role {role-directory} --run "$RUN_DIR" \
  --title "Short title" --type lesson --scope project \
  --memory "Durable verified learning." --evidence evidence/validation.txt \
  --reuse-when "The same condition recurs."
ruby "$RUNTIME" promote-memory --role {role-directory} --run "$RUN_DIR"
```

保留策略与旧记录迁移默认均为 dry-run；只有 `--apply` 改变磁盘：

```bash
ruby "$RUNTIME" gc --role {role-directory}
ruby "$RUNTIME" migrate-run path/to/legacy/run.yaml --role {role-directory}
```

`migrate-run --apply` 必须先完成祖先路径与 Schema 审计，再在原文件旁创建不可覆盖的 `run.yaml.legacy.bak`，将已知旧字段映射到 v1，并把未识别字段保留在 `extensions.legacy`。解析失败、路径逃逸、角色身份不匹配或备份已存在时不得覆盖原记录；写回后的 v1 验证若失败，必须恢复原 `run.yaml` 并保留备份供审计。
