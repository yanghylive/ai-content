# 可选执行链路外部依赖清单

> 生成：2026-09-01（审计 #18）· 结论：**核心 Agent-S 链路完全包内化**；以下为可选能力的运行时外部依赖，启用对应能力才需要，未启用不影响核心链路。
> 用途：不再宣称"全部能力零外部依赖"；给部署/排障一份权威清单。

---

## 一、核心链路（无外部依赖 ✅）

| 能力 | 依赖 | 说明 |
|---|---|---|
| Agent-S 主执行（node-playwright runner） | 包内 node + playwright browsers | browserControl=true 实测可用 |
| MCP 工具（23 个） | 包内子进程 | 子进程正常 |
| 桌面交互（微信联系人/聊天缓存） | 包内 wechat-db-helper / OCR | 内置组件按需下载 |
| 视频换脸 / 模板剪辑 / StudioCore | 包内 ffmpeg + 引擎 | media-tools 打包内置 |

## 二、可选能力外部依赖（⚠️ 启用才需要）

| 能力 | 外部依赖 | 位置 | 可配置项 | 未配置时行为 |
|---|---|---|---|---|
| Redfox SkillHub 脚本 | `python3`（`/usr/bin/python3` 优先） | agent-s.service.ts:3613 `resolveRedfoxSkillHubPythonCommand` | `REDFOX_SKILLHUB_PYTHON` env 覆盖 | 脚本执行失败，有明确报错 |
| Redfox SkillHub 增强工具 | `uvx` / `~/.local/bin`、`/opt/homebrew/bin` | agent-s.service.ts:3626 spawn PATH 注入 | PATH 已有本地 bin | 找不到命令时报错 |
| macOS 桌面自动化 | `osascript`（系统自带） | local-engine 苹果脚本链路 | — | 系统自带，无需安装 |
| 微信桌面数据（Mac） | 外部 `.venv`（第三方工具链） | wechat 同步脚本 | 按需下载组件 | 未下载时提示按需加载 |
| Swift 辅助脚本（可选） | `swift`（Xcode CLT） | 少数据链路 | — | 未装时提示 |

## 三、判定标准

- **可配置**：`REDFOX_SKILLHUB_PYTHON` 等 env 可指向任意解释器 → 部署方自行保证可用性。
- **fail-closed**：依赖缺失时显式报错（不静默降级假成功）。
- **不在承诺内**：本清单列出的可选能力**不保证开箱即用**；开箱即用承诺仅限核心链路。

## 四、排障指引

1. 某可选能力报"命令找不到" → 按上表定位依赖 + 配置项。
2. 需要无外部依赖部署 → 只启用核心链路（不接 Redfox SkillHub / 微信数据按需组件）。
