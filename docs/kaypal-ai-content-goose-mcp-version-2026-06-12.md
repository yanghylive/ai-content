# Kaypal AI Content Goose MCP 版

日期：2026-06-12

## 结论

可以做，首版已经按“Goose MCP 工具包”落地。

它不是替换 Kaypal AI Content 桌面安装包，而是让 Goose 通过 MCP stdio 连接本机 `3011` 后端，再操作 `3010` 页面和现有能力。

## 已落地

路径：

```text
extensions/kaypal-ai-content-mcp
```

已提供能力：

- `kaypal_ai_content_local_services`：检查、启动或停止本机 `3010`/`3011`，`start`/`stop` 需要 `confirm=true`。
- `kaypal_ai_content_health_check`：检查 3011、Agent-S、Playwright MCP、运行检查、登录态。
- `kaypal_ai_content_open_page`：打开账号页、运行检查、抖音评论/私信、视频号评论/私信等 3010 页面。
- `kaypal_ai_content_account_status`：读取平台账号和登录状态。
- `kaypal_ai_content_kaypal_profile`：读取 Kaypal 用户、订阅、积分/账单。
- `kaypal_ai_content_runtime_status`：读取本机运行检查、浏览器、执行器、文件访问、MCP 状态。
- `kaypal_ai_content_list_tasks`：查看互动任务。
- `kaypal_ai_content_list_records`：查看互动执行记录和证据。
- `kaypal_ai_content_generate_reply`：生成建议回复，不直接发送。
- `kaypal_ai_content_open_interaction_entry`：打开 CDP 持久浏览器互动入口，需要 `confirm=true`。
- `kaypal_ai_content_discover_topics`：智能挖题，需要 `confirm=true`。
- `kaypal_ai_content_generate_article`：按选题生成文章，需要 `confirm=true`。

首版故意不开放直接发布、直接发送、删除素材、删除账号等高影响工具。

## Goose 注册

已生成并安装：

```text
~/.config/goose/recipes/kaypal-ai-content-operator.yaml
```

Goose Desktop `/recipes/list` 已能识别：

```text
Kaypal AI Content 本机工作台
```

## 验证结果

已通过：

```bash
npm install
npm run build
npm run mcp:smoke
```

MCP 协议验证结果：

- 工具数：11
- Resource 数：1
- MCP server 可启动、可列工具、可调用工具。

当前本机没有监听 `3011`，所以 smoke 调用后端接口时返回 `fetch failed`。这是运行环境未启动，不是 MCP 包编译失败。

## 2026-06-12 Goose 前台崩溃处理记录

现象：

- Goose 1.37.0 前台 App 启动即崩，崩溃报告为 `EXC_BREAKPOINT (SIGTRAP)`。
- 把 `kaypal-ai-content-operator.yaml` 移出 `~/.config/goose/recipes` 后仍然崩溃。

结论：

- 崩溃不是 Kaypal AI Content recipe 单独触发。
- 当前 Goose 应用包 `~/Applications/Goose.app/Contents/Resources/app.asar` 是 2026-06-12 05:42 后被 patch 过的版本；恢复到 `~/.config/goose/backups/goose-prompt-zh-20260612054248` 后前台恢复可启动。

已处理：

- 崩溃版应用包已备份到：

```text
~/.config/goose/backups/goose-crash-current-20260612062507
```

- 已恢复 Goose 应用包：

```text
~/.config/goose/backups/goose-prompt-zh-20260612054248/app.asar
~/.config/goose/backups/goose-prompt-zh-20260612054248/Info.plist
```

- 已重新启用 Kaypal AI Content recipe。
- 已清理旧的 `goosed` 后台实例，只保留当前前台启动的 `goosed`。
- Goose `/recipes/list` 当前能看到 7 个 recipe，其中包含 `Kaypal AI Content 本机工作台`。

## 登录态边界

Goose MCP 是独立 stdio 进程，不会自动继承 3010 浏览器里的 `ai_content_session` Cookie。

公开接口和打开页面可以直接用。

如果要读取私有接口，应该先通过 Kaypal AI Content 桌面应用完成登录。高级调试时可以临时给 MCP 进程传入会话 Cookie，但不要把这些变量写进 Goose recipe 的 `env_keys`，否则 Goose 会把它当成必填 secret 并报 `Configuration value not found`。

可选高级变量：

```bash
KAYPAL_AI_CONTENT_SESSION=<ai_content_session>
```

或：

```bash
KAYPAL_AI_CONTENT_COOKIE=ai_content_session=<token>
```

后续如果要做成小白可用，需要在桌面版里提供本机安全 token/IPC，让 Goose MCP 不需要用户手动复制 Cookie。

## Goose 应用入口

已经补了 Goose “应用”页入口安装脚本：

```bash
npm --prefix "extensions/kaypal-ai-content-mcp" run install:goose-app
```

它会生成：

```text
~/.config/goose/mcp-apps-cache/apps_17fb3f19ed669c850e3709dd11b76faa705dc189c796370048c5efdb38a4740b.json
```

应用 URI：

```text
ui://apps/kaypal-ai-content
```

这个入口负责：

- 检查本机 `3010`/`3011` 是否可访问。
- 打开 Kaypal AI Content 常用页面。
- 通过 `ui/message` 把“启动服务、运行检查、账号检查、互动记录检查”等任务发回 Goose 对话。

真正的本机动作仍然走 `Kaypal AI Content 本机工作台` recipe 和 MCP 工具；Goose App 的 HTML 不直接绕过沙盒启动进程。

## 下一步

1. 启动最新 Kaypal AI Content 桌面版，确认 `3011` 在线。
2. 等 Goose 当前会话空闲后刷新或重启 Goose，确认“应用”页出现 `kaypal-ai-content`。
3. 在 Goose 里打开 `Kaypal AI Content 本机工作台` recipe，真实调用健康检查、账号状态、运行检查。
4. 如果要进入产品化，把 `extensions/kaypal-ai-content-mcp` 打进桌面安装包资源，并由安装器生成 Goose recipe。
