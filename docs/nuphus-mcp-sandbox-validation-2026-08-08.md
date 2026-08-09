# nuphus-mcp 沙盒验证报告

日期：2026-08-08

## 结论

nuphus-mcp 可以作为 JIUZHANG 3011 的“桌面操作兜底执行器”候选，但当前不建议直接进入商用发布链。

本轮已验证：

- 官方二进制可以启动。
- stdio JSON-RPC / MCP 握手可以完成。
- `tools/list` 可以返回 36 个工具。
- 桌面只读能力可以执行。
- 严格确认模式可以阻止未授权的写操作。
- 默认 SSRF 防护可以阻止回环/内网导航。

当前阻断：

- 官方 npm 包在本机无法正常按平台自动安装。
- 平台包的 `osx` 标记不符合 npm 对 macOS 的平台标识，应核查为 `darwin`。
- 平台包的 `bin` 路径包含字面量 `bin\\nuphus-mcp`，不是正常的 `bin/nuphus-mcp` 路径，发布脚本需要修正并重新打包。
- Windows 真机、Chrome CDP、OCR 模型、视觉模型和 JIUZHANG 业务链路尚未完成验证。

因此，当前结论是：**技术候选通过，商用交付未通过。**

## 验证对象

- 上游仓库：`mrpulor-gh/nuphus-mcp`
- 验证提交：`2d429eb9dda89fc5bcdb8bfcd3f1f55aff0ffce1`
- 提交时间：2026-08-07 15:38:29 +08:00
- 验证版本：`0.1.10`
- 本机：macOS ARM64
- 本机 Rust 工具链：未安装，因此未执行本地源码编译

## 测试记录

| 编号 | 项目 | 结果 | 说明 |
| --- | --- | --- | --- |
| N-01 | 解压官方 macOS ARM64 tarball | 通过 | 得到 `nuphus-mcp` 和 `libonnxruntime.dylib` |
| N-02 | 进程启动与退出 | 通过 | 进程正常返回，退出码为 0 |
| N-03 | MCP `initialize` | 通过 | 返回协议 `2024-11-05`，服务端版本 `0.1.10` |
| N-04 | MCP `tools/list` | 通过 | 返回 36 个工具 |
| N-05 | `desktop_screen_size` | 通过 | 返回本机屏幕尺寸 `3024x1964` |
| N-06 | 未确认的 `browser_new_tab` | 通过 | 被严格确认模式拒绝，无副作用 |
| N-07 | 未确认的 `browser_navigate` | 通过 | 被严格确认模式拒绝，无副作用 |
| N-08 | 已确认的回环地址导航 | 通过 | 被默认 SSRF 防护拒绝 |
| N-09 | npm 自动安装 | 未通过 | 平台包未被正确解析，meta 包 postinstall 报 binary missing |
| N-10 | 本机源码编译 | 未执行 | 本机没有 `cargo` / `rustc` |
| N-11 | Windows 真机 | 未执行 | 需要 Windows x64 真机 |
| N-12 | 外部 Chrome CDP | 未执行 | 需要独立 Chrome 调试端口和测试浏览器 |
| N-13 | OCR / 视觉模型 | 未执行 | 需要模型下载、权限和准确率测试 |
| N-14 | 3011 业务闭环 | 未执行 | 尚未接入账号、发布、回读、审计和失败补偿 |

## 能力边界

nuphus-mcp 适合提供以下底层执行能力：

- Windows 桌面窗口、鼠标、键盘、剪贴板和截图。
- Windows 本地应用或网页的视觉定位和 OCR 辅助操作。
- Chrome CDP 浏览器标签页、快照、点击、输入、滚动和内容读取。
- 作为 MCP stdio 子进程被 3011 调度。

nuphus-mcp 不替代 3011 的业务能力：

- 平台账号绑定、登录态数据库和账号归属。
- 发布任务状态机、幂等键、重试和回滚。
- 发布结果回读和“已发布/待确认/结果不确定”判定。
- 多组织隔离、权限、额度、计费和审计。
- 抖音、视频号、小红书等平台的业务适配。
- 用户侧的确认流程和高风险操作授权。

## 推荐接入方式

### 1. 独立 sidecar

在 3011 后端增加独立的 `NuphusMcpService`，通过 stdio 启动 nuphus-mcp，不让业务代码直接散落执行桌面动作。

建议结构：

```text
3011 API
  -> DesktopFallbackOrchestrator
      -> NuphusMcpService
          -> nuphus-mcp stdio process
              -> Windows desktop / Chrome CDP
```

### 2. 与现有 Playwright MCP 隔离

- nuphus-mcp 使用独立的 Chrome profile。
- 使用独立的 CDP 端口。
- 不复用 3011 当前浏览器会话锁。
- 每次执行绑定 `taskId`、`accountId`、`organizationId` 和 `traceId`。
- 任务结束后释放浏览器连接、窗口锁和临时文件。

### 3. 强制安全策略

- 默认开启 `NUPHUS_MCP_CONFIRM_WRITE=1`。
- 3011 只允许白名单工具，不允许 AI 任意调用 36 个工具。
- 导航域名、窗口标题、可操作控件和文件路径全部做 allowlist。
- 发布、评论、私信、删除、上传等动作必须经过 3011 的业务确认，不以 nuphus 的 `confirm:true` 代替业务授权。
- 所有桌面动作记录前后截图、工具名、参数摘要、账号和任务状态。
- 发生 CDP 断开、窗口切换或结果无法回读时，统一进入 `outcome_uncertain`，禁止自动重复发布。

## 进入下一阶段的门槛

### P0：发布链修复

1. 修复 npm 平台字段和 bin 路径。
2. 重新生成 macOS、Windows x64、Windows ARM64 包。
3. 在干净环境执行安装、启动、升级和卸载。
4. 为平台包增加 CI 校验：
   - `os` / `cpu` 与 npm 平台值一致。
   - `bin` 目标文件实际存在。
   - 可执行文件可启动并响应 MCP 握手。

### P1：Windows 真机

1. Windows 10/11 x64 启动。
2. 无管理员权限启动。
3. SmartScreen / Defender 场景。
4. 安装目录含中文、空格和非系统盘。
5. 3011 端口占用、后端超时和重启恢复。
6. DPI 100%、125%、150%。
7. 多显示器和最小化/切屏。
8. Chrome CDP 连接、断开、重连。
9. OCR 中文、英文、混合文本。
10. 桌面写操作确认和取消。

### P1：业务闭环

1. 3011 只调用白名单工具。
2. 账号登录态和任务账号严格绑定。
3. 发布前确认、执行中状态、完成后读回。
4. 失败、超时、部分成功和结果不确定均可恢复。
5. 重启 3011 后任务状态不丢失。
6. 同一幂等键不重复发布。
7. 真实互动动作必须具备人工确认和审计记录。

## 最终建议

先修复 nuphus-mcp 的 npm 分发问题，再做 Windows 真机 P1 验证。只有在 Windows 桌面控制、Chrome CDP、权限、断线恢复和 3011 业务回读全部通过后，才把它放入商用安装包。

当前不建议：

- 直接把 nuphus-mcp 放入 3011 主进程。
- 直接开放 36 个工具给 AI。
- 直接用它替代平台官方 API 或现有业务状态机。
- 在没有回读证据时自动重试发布。
