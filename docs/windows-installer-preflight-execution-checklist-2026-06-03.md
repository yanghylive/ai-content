# Windows 安装包预检执行清单

更新时间：2026-06-03

## 目标

做一个小白用户能用的 Windows 安装包：

1. 用户双击安装包后，先看到 KaypalAI 环境检测窗口。
2. 检测本机是否已有 Node.js、Python 3.12、PostgreSQL、Redis、Chrome/Edge。
3. 缺什么就明确列出来。
4. 用户点击「一键安装缺失环境」后，从 Kaypal 阿里云 OSS 下载依赖并安装。
5. 安装完依赖后自动复检。
6. 必需依赖通过后，才继续安装主程序。
7. 主程序安装后再做数据库初始化、快捷方式、自检。
8. 没有在干净 Windows VM 里看到这条完整流程，不能把包交给用户测试。

## 这次反复出错的原因

之前把环境检测放在了 `customInstall`。

`customInstall` 是 NSIS 已经开始安装主程序文件以后才执行的钩子，所以用户看到的是：

1. 普通安装进度先跑。
2. 快结束时才弹依赖检测。
3. 依赖或初始化失败后，安装器报“安装未完成”。

这不符合目标。正确顺序必须是：

```text
打开安装包
-> 安装前环境检测
-> 缺依赖则一键下载/安装/复检
-> 依赖通过
-> 安装主程序文件
-> 数据库初始化和安装后自检
-> 启动应用
```

## 当前采用方案

先用最快可收口方案：NSIS 启动阶段预检。

关键点：

1. 在 `desktop/installer.nsh` 增加 `customInit`。
2. 在安装器启动后、进入欢迎页/目录页/安装进度页前，把 `bootstrap-installer.ps1`、`detect-deps.ps1`、`deps-manifest.json` 提取到 `$PLUGINSDIR`。
3. 运行：

```powershell
bootstrap-installer.ps1 -Mode Preflight
```

4. `Preflight` 只负责依赖检测、下载、安装、复检，不初始化主程序。
5. `customInstall` 只运行：

```powershell
bootstrap-installer.ps1 -Mode PostInstall
```

6. `PostInstall` 只负责数据库初始化、快捷方式、安装后自检。

## 需要修改的文件

1. `desktop/installer/bootstrap-installer.ps1`
   - 增加 `-Mode Preflight | PostInstall | Full`。
   - `Preflight` 通过后退出 0，让 NSIS 继续安装。
   - `PostInstall` 不再重新安装依赖，只做主程序初始化和自检。

2. `desktop/installer.nsh`
   - 增加安装器启动阶段预检。
   - `customInstall` 改成安装后初始化，不再做依赖安装。

3. `desktop/scripts/check-full-installer-assets.js`
   - 检查 NSIS 里必须有 `customInit`。
   - 检查预检必须使用 `-Mode Preflight`。
   - 检查安装后必须使用 `-Mode PostInstall`。

4. `desktop/package.json`
   - 打包版本递增。

## 验收标准

必须同时满足：

1. `npm run check:full-installer-assets:pre` 通过。
2. `npm run build:win` 通过。
3. `npm run check:full-installer-assets:post` 通过。
4. 新安装包推到 Windows VM。
5. Windows VM 双击安装包后，第一步能看到 KaypalAI 环境检测窗口。
6. 不再先出现普通安装进度再报错。
7. 如果依赖缺失，窗口列出缺失项，并提供「一键安装缺失环境」。
8. 如果依赖已齐，预检通过后继续主程序安装。
9. 安装后能启动 KaypalAI 内容创作平台，或明确给出可定位日志。

## 不能再做

1. 不能只打包成功就说可用。
2. 不能让用户先试，再发现同样错误。
3. 不能把依赖检测继续放在 `customInstall` 当主方案。
4. 不能把 VM 文件传输问题当成安装包问题。
5. 不能跳过 Windows VM 真实安装路径验证。

## 当前下一步

1. 打最新 Windows 包。
2. 推到干净 Windows VM。
3. 验证第一屏就是环境检测。
4. 验证主程序资源包含 `auto-upload` 和 `agent-s-executor`。
5. 验证启动后后端、Local Runtime、Agent-S sidecar 都能自动启动，不要求用户手动安装依赖。
