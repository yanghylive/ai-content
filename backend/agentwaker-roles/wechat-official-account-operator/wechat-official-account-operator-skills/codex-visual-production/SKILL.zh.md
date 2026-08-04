---
name: codex-visual-production
description: 通过 Codex 内置的 ImageGen 授权来满足待处理的 WeChat 视觉请求，无需 OpenAI API 密钥或单独的图像 API 集成。当 Kimi 或另一个文本智能体已在当前 WeChat Workdir v1 运行中编写了有效的 visual-request.json，且 Codex 必须生成概念栅格背景、添加确定性中文字体、检查候选图像并返回哈希本地资产和 visual-result.json 时使用。请勿在 Codex 之外使用，不得用于证据伪造或作为同步 API/MCP 承诺。
---

# Codex 视觉生产

## 目的

通过 Codex 内置的 ImageGen 授权和确定性本地渲染，将经过验证的 WeChat 视觉请求转换为已检查的本地资产，无需 OpenAI API 密钥。

## 触发条件

仅在当前 Codex task 具有包含 `input/visual-request.json` 且 `status: pending_codex` 的有效 WeChat Workdir v1 运行时使用。

## 必需输入

- 绑定的 `AGENT_WORK_DIR` 和当前运行的 `run.yaml`。
- 包含冻结文章版本、位置、精确文案、艺术方向、避免列表、候选预算和生成概念证据策略的协议 v1 请求。
- 将私密或未公开输入发送到内置生成器之前需获得用户批准。

## 合约

仅在当前 WeChat 运行中操作，由 `AGENT_WORK_DIR` 解析。读取 `references/request-schema.md`，然后在生成任何内容之前用 `scripts/visual_inbox.py` 验证 `input/visual-request.json`。

将此视为异步文件交接：

1. Kimi 或另一个智能体编写请求并停在 `status: pending_codex`。
2. Codex 验证并认领请求。
3. Codex 在该功能实际可用时使用其内置的 `imagegen` skill/tool。
4. Codex 将生成的源文件存储在 `intermediate/visuals/`、确定性最终图像存储在 `output/assets/`、检查证据存储在 `evidence/visuals/`。
5. Codex 用确切路径、SHA-256 值、出处、审查状态和残留问题完成请求。

永远不要要求或读取 `OPENAI_API_KEY`。Codex 产品授权不是 API，不得暴露为 API。如果内置 ImageGen 不可用，保持请求待处理并报告 `codex_imagegen_unavailable`。

## 工作流

1. 运行 `python3 scripts/visual_inbox.py validate --request "$AGENT_WORK_DIR/input/visual-request.json" --platform wechat`。
2. 运行 `compile`。它必须拒绝模糊的视觉合约并写入 `intermediate/visuals/compiled-prompt.json` 和 `compiled-prompt.txt`。永远不要将自由形式的上游提示直接交给 ImageGen。
3. 检查通过的编译器收据，然后用执行器 `codex` 运行 `claim`。Claim 拒绝缺失或过时的编译提示。
4. 读取 `design-wechat-visuals` 并应用其品牌、密度、证据、裁剪、清单和集成渲染规则。
5. 仅将 ImageGen 用于概念栅格主体、场景、光照、纹理或编辑。不要生成看起来像证据的界面、终端、基准测试、标志或无法验证的结果。
6. 保持中文标题、确切声明、图表、截图和数据确定性。在选择背景后本地添加。对于 `architecture-map`，将完整概览和所有概览绑定的详细图表路由到代码原生的架构信息图表系统；ImageGen 可能仅支持单独的抽象封面背景。
7. 在全尺寸、文章宽度、当前封面裁剪和移动端缩略图处检查每个候选图像。拒绝通用 AI 主题、模板雷同、伪影或与文章关联性不足的内容。
8. 将选定文件存储在当前运行中。用最终文件和审查摘要运行 `complete`。
9. 将 `evidence/visual-result.json` 和排序后的资产交回 `design-wechat-visuals` 进行正常的清单和渲染检查。

## 命令

```bash
python3 scripts/visual_inbox.py validate \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat

python3 scripts/visual_inbox.py compile \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat

python3 scripts/visual_inbox.py claim \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat --executor codex

python3 scripts/visual_inbox.py complete \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat \
  --asset "$AGENT_WORK_DIR/output/assets/cover.png" \
  --review "$AGENT_WORK_DIR/evidence/visuals/review.md"
```

## 输出

- `intermediate/visuals/` 下的概念源候选。
- `output/assets/` 下经过确定性渲染和检查的最终资产。
- 本地审查记录和 `evidence/visual-result.json`，包含路径、哈希、出处和完成时间。
- 确定性提示编译器收据和绑定到请求哈希的最终 ImageGen 提示。

## 审批门

- 不得执行 JPage、WeChat 资产、草稿、预览、发布或群发写入。
- 在将私密文本、截图、代码或内部数据发送到 ImageGen 之前确认。
- 不得声称订阅成本、配额或无限可用性；仅记录观察到的能力和完成情况。
- 请求仅在每个声明的最终路径都存在于运行中且其哈希被记录时才完成。

## 失败处理

- 如果 ImageGen 不可用，不得认领完成；保持或恢复 `pending_codex` 并报告 `codex_imagegen_unavailable`。
- 如果验证、权利、隐私、裁剪、复制或视觉审查失败，保持请求被阻止或处理，并提供确切原因，不得生成伪造资产。
- 如果请求包含凭证或超出运行范围，在生成前拒绝。

## 交接规则

将结果收据和排序文件返回 `design-wechat-visuals`。仅其正常的清单、集成渲染和远程渲染检查可继续进入预览或 WeChat 草稿。
