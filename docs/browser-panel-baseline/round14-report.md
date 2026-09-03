# browser-panel Round 14 报告：3011 跨进程真实 userData 验证——实锤并修复一个 P1 断链

日期：2026-09-03 ｜ 对齐 round12 报告结构

## 结论

**累计最大欠账（3011 跨进程真实 userData 验证）已清，且当场抓到一个 P1 真 bug：macOS 打包版 userData 与 backend 推导目录不一致，面板模式/面板桥两条跨进程链在生产 macOS 上全断。已修复（desktop 统一固定 userData），stage14 真机写读闭环 10/10。**

## P1 bug 证据链（真机实证，非纸面推断）

| 环节 | 证据 |
|---|---|
| 打包版 userData 目录名 | `dist/mac-arm64/JIUZHANG AI 内容创作平台.app/Contents/Info.plist`：`CFBundleName = "JIUZHANG AI 内容创作平台"`（stage14 S1 实锤）→ macOS 默认 userData = `~/Library/Application Support/JIUZHANG AI 内容创作平台/` |
| backend 推导 | `backend/src/common/project-paths.ts` `resolveDesktopUserDataDir()` darwin 硬编码 `~/Library/Application Support/ai-content-desktop` |
| desktop 固定逻辑 | main.js `configureStableUserDataPath()` **只兜 Windows**（execPath NSIS 路径推导），macOS 无任何 setPath |
| 为什么从未暴露 | dev 版 package.json `name = ai-content-desktop` 恰好与推导一致；本机 `JiuZhangAI` 目录经查是九章AI管家（`.daemon.lock`）的 userData，与本案无关（排查时排除的干扰项） |
| Windows 侧 | NSIS per-user 安装被 `configureStableUserDataPath` 固定到 `%APPDATA%\ai-content-desktop`，一致 ✓ |

**影响**：生产 macOS 打包版上，desktop 写开关/凭据到中文目录、3011 读英文目录 → 面板模式永远 off、面板桥永远不可用（fail-closed，无安全风险，但功能整体失效）。

## 修复

- **新增 `desktop/user-data-path.js`（纯函数可单测）**：`resolveStableUserDataDir({platform,isPackaged,appName,execPath,appData})`——Windows 既有语义原样平移；**darwin 打包版 → 固定 `ai-content-desktop` + `migrateFrom = productName 目录`**；dev/其他平台 → null（不动）。
- **main.js 接线**：`configureStableUserDataPath` 改调纯函数；macOS 打包版一次性 **rename 迁移**（同分区原子；stable 已存在则不迁——dev/打包共存场景以 stable 为准；迁移失败只记错误不阻塞启动，老数据原地保留不丢）。
- **backend 零改动**。

## stage14 真机冒烟（10/10，首跑全绿）

写读闭环走**全真实链**：`manager.setAgentMode`（真实 writeMode 0600 文件 + pid）→ **backend dist 真实编译产物** `readPanelModeRegistry`（子进程 `HOME=临时目录`，走真实默认推导代码路径，**零 env 覆盖、零生产污染**）。

| # | 场景 | 结果 |
|---|---|---|
| S1 | Info.plist CFBundleName ≠ ai-content-desktop（bug 实锤） | ✅ |
| S2 | user-data-path 纯函数 spec 全绿（win 平移回归 + mac 新增） | ✅ 11/11 |
| S3 | setAgentMode(true) → dist 读 `on` + 文件 0600 + 目录对称 | ✅ |
| S4 | setAgentMode(false)（删文件）→ `null`（默认 off） | ✅ |
| S5 | pid 已死 → `null`（跨进程探活 fail-closed） | ✅ |
| S6 | startedAt 老化 8 天 → `null`（7 天阈值） | ✅ |
| S7 | 存量 0644 → 读后收紧 0600 | ✅ |
| S8 | 1s 缓存窗口：改文件立即读=旧值，clear 后=新值（既有欠账行为实证） | ✅ |
| S9 | 目录对称性：backend 推导 == desktop 写入 | ✅ |
| S10 | 附带：面板 open 无回归 | ✅ |

**真实启动冒烟（铁律 2.5，main.js 是入口脚本）**：dev Electron 真实启动 22s，`app threw / fatal / uncaughtException` = 0，`[user-data]` 异常输出 = 0（darwin dev 走 null 分支正确）；3011 副本 EADDRINUSE 退出为既有预期（端口被本机真实 3011 占用）。进程已干净回收。

## 回归

| 项 | 结果 |
|---|---|
| desktop 10 spec | **183/183**（172 + user-data-path 11） |
| backend local-engine + common jest | 32 suites / **522** 全绿 |
| `npx nest build` | EXIT=0（dist 刷新，stage14 用真实编译产物验证） |
| backend tsc | 无改动（本轮 backend 零代码变更） |

## 交底（欠账与边界）

- **macOS 打包分支的真机打包验证未做**：dev 进程内 `app.isPackaged=false`，修复的 darwin 分支只有纯函数 spec + 源码接线覆盖；下次发 Mac 包时需在打包产物上实测（user-data 迁移 + 面板链通）。
- **迁移策略**：`rename` 一次性；stable 已存在的老用户（本机 dev+打包并存的开发机场景）不迁移、老中文目录原地保留——生产用户不受影响，开发机遗留目录手动清。
- S8 证实 1s 缓存窗口行为与欠账描述一致（无回归）。
- 累计欠账不变：控制条 tab 条 UI；windowOpenHandler；screenshotBase64 上层消费；probe/extract 表达式双端两份；Windows smoke 1~14；loop 门禁 message 匹配；keyCode；insertText 清空。

## 下一步

1. 下次 Mac 发版时在打包产物上验证 darwin 分支（迁移 + 面板链真机）。
2. 控制条 tab 条 UI（round11 遗留）。
3. Windows 真机 smoke 1~14 补账（jz-win11-*）。
