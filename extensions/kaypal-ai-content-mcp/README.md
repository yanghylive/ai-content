# Kaypal AI Content Goose MCP

这是 Kaypal AI Content 的 Goose MCP 桥接扩展。它不替换当前桌面版安装包，而是让 Goose 通过本机 MCP stdio 工具调用 `3011` 后端、打开 `3010` 页面。

## 能做什么

- 检查并可按确认启动/停止本机 `3010`、`3011`。
- 在 Goose 里提供 `Kaypal AI Content` MCP App 入口。
- 检查本机 `3011`、Agent-S、Playwright MCP、运行检查状态。
- 打开账号页、运行检查、抖音评论/私信、视频号评论/私信页面。
- 读取平台账号状态、Kaypal 账户/订阅/积分、互动任务和执行记录。
- 生成评论/私信建议回复。
- 在用户明确传 `confirm=true` 时，调用智能挖题、文章生成、打开互动入口。

首版不提供直接发布、直接发送、删除素材/账号等高影响工具。

## 本机开发安装

```bash
npm --prefix "/Users/yanghy/Documents/New project/ai-content/extensions/kaypal-ai-content-mcp" install
npm --prefix "/Users/yanghy/Documents/New project/ai-content/extensions/kaypal-ai-content-mcp" run build
npm --prefix "/Users/yanghy/Documents/New project/ai-content/extensions/kaypal-ai-content-mcp" run mcp:smoke
npm --prefix "/Users/yanghy/Documents/New project/ai-content/extensions/kaypal-ai-content-mcp" run install:goose
npm --prefix "/Users/yanghy/Documents/New project/ai-content/extensions/kaypal-ai-content-mcp" run install:goose-app
```

安装脚本会生成：

```text
~/.config/goose/recipes/kaypal-ai-content-operator.yaml
~/.config/goose/mcp-apps-cache/apps_<hash>.json
```

`install:goose` 安装的是 Goose 配方，负责 MCP 工具调用。MCP 服务自身会暴露 `ui://apps/kaypal-ai-content` 应用资源，并提供 `kaypal_ai_content_open_app` 工具。

`install:goose-app` 只是 Goose “应用”页缓存兜底。如果 Goose 清理了本地 app cache，仍可通过配方里的 `kaypal_ai_content_open_app` 读取 MCP App 资源重新打开。

## 登录态

Goose MCP 是独立 stdio 进程，不会自动拿到 3010 浏览器里的 `ai_content_session` Cookie。

如果只做公开健康检查和打开页面，不需要配置 Cookie。

如果要读取用户、订阅、积分、任务记录等私有接口，需要给 Goose recipe 的 `envs` 增加任一变量：

```yaml
KAYPAL_AI_CONTENT_SESSION: "<ai_content_session 的值>"
```

或：

```yaml
KAYPAL_AI_CONTENT_COOKIE: "ai_content_session=<token>"
```

不要把这两个变量放进 Goose recipe 的 `env_keys`，除非已经在 Goose secret/config 里配置同名值；否则 Goose 会报 `Configuration value not found`。

## 常用工具

- `kaypal_ai_content_health_check`
- `kaypal_ai_content_open_app`
- `kaypal_ai_content_local_services`
- `kaypal_ai_content_open_page`
- `kaypal_ai_content_account_status`
- `kaypal_ai_content_kaypal_profile`
- `kaypal_ai_content_runtime_status`
- `kaypal_ai_content_list_tasks`
- `kaypal_ai_content_list_records`
- `kaypal_ai_content_generate_reply`
- `kaypal_ai_content_open_interaction_entry`
- `kaypal_ai_content_discover_topics`
- `kaypal_ai_content_generate_article`
