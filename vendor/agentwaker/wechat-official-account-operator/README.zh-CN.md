# 微信公众号运营助手

[English](README.md)

Weaver 是一个开源的 AgentWaker 角色，面向重证据、重深度、重安全边界的微信公众号运营。它覆盖 AI 热点研究、选题规划、深度技术教程、视觉制作、微信 HTML 排版、私有预览、需明确审批的草稿与发布操作，以及发布后的数据复盘。

## 包含内容

- `agent-soul/` 下完整的 AgentWaker 角色定义
- 中英文角色说明和可视化角色主页
- 研究、规划、写作、配图、排版、JPage 审阅、微信草稿/发布、效果复盘等可复用技能
- 微信官方 API 工具和可选的 SSH Token Broker
- 渲染器、信息采集、视觉包和 API 工具的本地测试

## 安全边界

资料研究和本地渲染默认只读。任何外部写入、素材上传、草稿修改、预览发送、公开发布、群发或删除，都必须针对准确目标和最终内容取得明确授权。AppSecret、Access Token、Cookie、未发布素材及运行产物不得提交到 Git。

## 快速开始

### 环境要求

| 使用范围 | 环境要求 |
|---|---|
| 核心角色、生命周期和校验 | Git、Ruby 2.6+、Python 3.9+ |
| JPage 私有预览 | Node.js 20+、`@code2rich/jpage` 和操作者自己的 Token |
| 微信官方 API 操作 | 符合条件的公众号、所需 API 权限、凭据，以及已批准的 IP 白名单或 Token Broker |
| SSH Token Broker | 带 systemd 的 Linux、OpenSSH、Python 3.9+、curl |
| 浏览器草稿或生成式配图 | 具备已授权浏览器或图片生成工具的兼容 Agent 运行时 |

### 独立运行

1. 克隆本仓库：

   ```bash
   git clone https://github.com/code2rich/agentwaker-wechat-official-account-operator.git
   cd agentwaker-wechat-official-account-operator
   ```

2. 将 `env/.env.example` 复制为 `env/.env`，只填写需要启用的集成；真实配置文件默认被 Git 忽略。
3. 从仓库根目录设置绝对运行路径：

   ```bash
   export AGENT_WORK_DIR="$PWD/workdir"
   export AGENT_MEMORY_FILE="$PWD/agent-soul/MEMORY.md"
   ```

4. 创建一个受生命周期管理的任务运行：

   ```bash
   ruby tools/agent-runtime.rb start \
     --role . \
     --goal "撰写一篇有证据支撑的微信公众号文章" \
     --tool codex
   ```

5. 阅读 `wechat-official-account-operator-skills/SKILL.zh.md`，将任务路由到对应的专业技能。

### 安装为 Agent Skill

仓库根目录已经提供 `SKILL.md`，兼容 Agent Skills 的客户端可以直接使用整个仓库：

```bash
git clone \
  https://github.com/code2rich/agentwaker-wechat-official-account-operator.git \
  ~/.agents/skills/wechat-official-account-operator
```

如果客户端使用其他 Skill 目录，请将仓库克隆到对应位置。不要只复制单个
`SKILL.md`：专业技能依赖相邻的 `agent-soul/`、`tools/`、`workdir/` 和
`schemas/`。

仓库已经包含共享能力、Schema、运行策略、生命周期工具和独立校验器，无需再克隆完整的 AgentWaker。它也可以作为一个角色重新嵌入 [AgentWaker](https://github.com/code2rich/agentwaker) 团队。

## 本地测试

```bash
find wechat-official-account-operator-skills -name 'test_*.py' -type f -print0 |
  sort -z |
  xargs -0 -n1 python3
```

也可以直接运行单个测试文件。多数工具只依赖 Python 标准库，可选集成会在各自文档中说明额外依赖。

校验角色及内置共享能力：

```bash
ruby tools/validate-capabilities.rb
ruby tools/validate-role.rb . --phase standalone
```

## 开源协议

项目使用 [MIT License](LICENSE)。仓库内打包的第三方资源保留其原始协议，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

欢迎提交 Issue 和贡献改进。
