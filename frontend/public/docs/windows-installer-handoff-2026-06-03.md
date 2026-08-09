# AI Content 桌面端 (Windows 安装包) 交接单

**撰写日期**：2026-06-03 (3 轮 build 后定版)
**接手对象**：接手 ai-content 桌面端打包 / 分发 / 自动更新这条线的人
**当前线上版本**：v1.1.0 — sha512 `YKXlo35mnbas3/qXQTTY/G6v8OCv4cS/a9U4AhZRX0UaD2why1o8mP0cIm/0tU76H+jgt5Z4q+N5Te9TZCThjw==`

---

## 0. 一句话

AI Content 桌面端是个 Electron app。Windows 安装包 89 MB(壳)+ 5 个底层 dep(从 OSS 拉,首次装下载,共 472 MB,Node/Python/PostgreSQL/Redis/Chrome)。装完用户双击图标,后台 Electron 拉一个本地 Python (`auto-upload`) 去抖音/视频号自动发内容。

走 阿里云 OSS 当 update feed,`electron-updater` 用 `provider: 'generic'` 自管。**没代码签名**,没上 Windows 商店 / Mac App Store。

v1.1.0 一共 3 轮 build 才稳定,踩了 5 个坑,本文档详细记录。

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│ GitHub: yanghylive/ai-content                                        │
│   main 分支代码                                                      │
│   .github/workflows/release-desktop.yml  ←  3 平台并行 build+upload │
│   desktop/                          ←  Electron 主程序 + 装器配置   │
│   frontend/out/                     ←  前端 (打包时拷到 resources)  │
│   backend/dist-bundle/              ←  Node 后端 (打包时拷到)       │
└─────────────────────────────────────────────────────────────────────┘
                ↓ tag v1.x.x 推上去触发 CI
                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 阿里云 OSS bucket: kaypal  (region: cn-hangzhou, 公共读)            │
│   updates/                                                             │
│     ├── KaypalAI内容创作平台 Setup 1.1.0.exe    (89 MB)              │
│     ├── KaypalAI内容创作平台 Setup 1.1.0.exe.blockmap (97 KB)         │
│     ├── KaypalAI内容创作平台-1.1.0-arm64.dmg    (114 MB)             │
│     ├── KaypalAI内容创作平台-1.1.0-arm64-mac.zip (113 MB)            │
│     ├── ai-content-desktop_1.1.0_amd64.deb      (Linux)              │
│     ├── latest.yml          ← Windows update feed                    │
│     ├── latest-mac.yml      ← macOS update feed                      │
│     └── latest-linux.yml    ← Linux update feed                      │
│   deps/                                                                │
│     ├── node-v20.18.0-x64.msi                    (25 MB)             │
│     ├── python-3.11.9-amd64.exe                  (25 MB)             │
│     ├── postgresql-16.4-1-windows-x64.exe        (357 MB)            │
│     ├── Redis-3.0.504-Windows-x64.msi            (1.7 MB)            │
│     └── ChromeStandaloneSetup64.exe              (145 MB)            │
└─────────────────────────────────────────────────────────────────────┘
                ↓ 装器拉 deps
                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Windows 用户电脑                                                      │
│   C:\Program Files\KaypalAI\         (默认,可改)                     │
│     ├── KaypalAI.exe                 (主程序, Electron 32)            │
│     ├── resources/app.asar           (源码 + node_modules)           │
│     ├── resources/auto-upload/       (Python 自动化后端)              │
│     ├── resources/backend/           (Node 后端)                     │
│     ├── resources/frontend/          (Next.js 静态页)                │
│     └── installer/                   (bootstrap PowerShell + manifest)│
│                                                                          │
│   注册表: HKCU\Software\Microsoft\Windows\CurrentVersion\Run\KaypalAI  │
│   桌面快捷方式: KaypalAI 内容创作平台.lnk                              │
│                                                                          │
│   venv: <auto-upload>/.venv/Scripts/python.exe  (main.js 启动时建)     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 关键文件路径

### 2.1 项目代码 (`/Users/yanghy/Documents/New project/ai-content/`)

| 路径 | 作用 |
|---|---|
| `desktop/package.json` | Electron 入口配置,`build.*` 是 electron-builder 的配置 |
| `desktop/main.js` | Electron 主进程 (684 行):窗口、托盘、自动启动、**Python venv 创建** |
| `desktop/preload.js` | IPC 桥 (199 行):把 `app.getVersion` / `app.getUpdateStatus` 暴露给渲染层 |
| `desktop/auto-updater.js` | electron-updater 包装,带 tray 钩子 (`onStateChange`) |
| `desktop/cloud-api.js` | 云端 API 适配 (跟 kaypal-auth 配合 device flow) |
| **`desktop/installer.nsh`** | **NSIS 装器钩子 (20 行,含本次新增的 `RequestExecutionLevel admin`)** |
| **`desktop/installer/bootstrap-installer.ps1`** | **WPF 装器 UI (343 行)** |
| `desktop/installer/detect-deps.ps1` | 检测本机是否已装 Node/Python/PG/Redis/Chrome |
| `desktop/installer/download-deps.ps1` | 5 个 dep 的下载脚本 (被 bootstrap 调) |
| `desktop/installer/post-install.ps1` | 装完后的环境配 (PATH / 服务) |
| `desktop/installer/uninstall.ps1` | 卸载时反向清理 |
| **`desktop/installer/deps-manifest.json`** | **5 个 dep 的 OSS URL + 静默参数 (含 Python 3.11.9)** |
| `desktop/scripts/upload-to-oss.js` | ali-oss SDK 包装的上传脚本 |
| `desktop/scripts/release.js` | 一键构建 + 上传 (3 平台) |
| `desktop/scripts/check-update-feed.js` | 验证 yml sha 跟实际产物对得上 |
| `desktop/scripts/upload-deps.js` | 把 5 个 dep 上传到 `oss://kaypal/deps/` |
| **`desktop/assets/`** | **图标 (本次已换成 K + 绿点)** |
| `desktop/DEPLOYMENT.md` | 旧版装器说明 (本次更新后已部分过时) |
| `.github/workflows/release-desktop.yml` | CI:3 平台并行 build + upload |
| `docs/windows-installer-handoff-2026-06-03.md` | **本文档** |

### 2.2 OSS

- **桶**：`kaypal`,region `oss-cn-hangzhou`
- **update feed 根 URL**：`https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/`
- **dep 根 URL**：`https://kaypal.oss-cn-hangzhou.aliyuncs.com/deps/`
- **AccessKey** (已轮换,2026-06-03 起)：
  - ID: `<your-oss-access-key-id>`
  - Secret: `<your-oss-access-key-secret>`
  - Scope: `kaypal` 桶的读写
- **GitHub Secrets** (CI 用):`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET` / `OSS_REGION` / `OSS_UPDATE_PATH` / `AI_CONTENT_UPDATE_URL`

---

## 3. 装器流程 (NSIS + PowerShell)

```
用户双击 KaypalAI内容创作平台 Setup 1.1.0.exe
        ↓
NSIS 装器启动
  - 装器本身需要 admin (RequestExecutionLevel admin, installer.nsh:7)
  - UAC 弹窗 → 用户点"是"
  - 选安装目录 (默认 C:\Program Files\KaypalAI)
  - NSIS 抽 app.asar / resources/ / installer/ 到安装目录
        ↓
NSIS 调 PowerShell:  installer.nsh:9
  nsExec::ExecToLog 'powershell ... bootstrap-installer.ps1 ...'
        ↓
bootstrap-installer.ps1 启动
  - WPF 窗口出来:5 个 dep 检测列表 + 安装进度条
  - detect-deps.ps1: 查每个 dep 的版本
  - 缺的 / 版本低的:从 OSS deps/ 下
  - Start-Process 调 dep 装器,带 silentArgs (admin 下能装)
  - 5 个全过 → 把 $INSTDIR 的内容 wipe (保留 installer/ + Uninst*) 然后从 $AppSourceDir 拷过来
  - 写自启动注册表 + 桌面快捷方式
  - "启动应用" 按钮亮
        ↓
用户点"启动应用"
  - 调 KaypalAI.exe (Electron)
  - main.js load,启 tray + window
  - main.js 的 ensurePythonVenv 建/复用 .venv,装 requirements.txt 里的 pip 包
  - 启 Python 进程:python main.py (后台 CDP 持久浏览器)
  - electron-updater 后台查 OSS latest.yml,有新版就 tray 弹
```

### 3.1 `installer.nsh` (20 行,**新加 1 行 admin**)

```nsh
RequestExecutionLevel admin          ; ← 本次新增 (坑 #4),1.1.0 装器一开始就要 admin

!macro customInstall
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\bootstrap-installer.ps1" -InstallDir "$INSTDIR" -AppSourceDir "$INSTDIR" -ManifestPath "$INSTDIR\installer\deps-manifest.json"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "依赖安装未完全成功,但主程序已装好。..." IDOK
  ${EndIf}
!macroend
```

### 3.2 `bootstrap-installer.ps1` 关键段 (WPF UI + 5 步安装)

- `Start-DependencyInstall` 函数跑 5 个 dep 循环
- 每个 dep:`detect` → `download` (OSS) → `install` (Start-Process) → `verify` (run verifyCmd)
- 任何一步 `ExitCode != 0` 或异常 → `$Global:Failed = $true`
- 全过 → `Copy-Item` 把主程序拷进 $InstallDir (用 staging 目录中转,避免运行中自删)
- 写自启动 + 桌面快捷方式

### 3.3 `deps-manifest.json` (5 个 dep)

```json
{
  "deps": {
    "node":     { "url": "https://kaypal.oss-cn-hangzhou.aliyuncs.com/deps/node-v20.18.0-x64.msi",       "silentArgs": "/quiet /norestart" },
    "python":   { "version": "3.11.9", "url": "https://kaypal.oss-cn-hangzhou.aliyuncs.com/deps/python-3.11.9-amd64.exe",     "silentArgs": "/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_launcher=0" },
    "postgres": { "url": "https://kaypal.oss-cn-hangzhou.aliyuncs.com/deps/postgresql-16.4-1-windows-x64.exe", "silentArgs": "--unattended --mode unattended --superpassword ai_content_2026 --prefix \"C:\\Program Files\\PostgreSQL\\16\" --datadir \"C:\\Program Files\\PostgreSQL\\16\\data\" --servicename PostgreSQL" },
    "redis":    { "url": "https://kaypal.oss-cn-hangzhou.aliyuncs.com/deps/Redis-3.0.504-Windows-x64.msi", "silentArgs": "/i /quiet /norestart" },
    "chrome":   { "url": "https://kaypal.oss-cn-hangzhou.aliyuncs.com/deps/ChromeStandaloneSetup64.exe",   "silentArgs": "/silent /install", "optional": true }
  }
}
```

**PostgreSQL 密码硬编码**: `ai_content_2026` (manifest 第 25 行)。改密码要同步改 backend 里连 PG 的密码 (`backend.env` 里 `DATABASE_URL=...ai_content_2026...`)。

### 3.4 `main.js` 关键段 (Python venv 生命周期,**本次修过**)

```js
function ensurePythonVenv(autoUploadPath) {
  const venvPath = ...  // .venv/Scripts/python.exe (Windows)
  if (fs.existsSync(venvPath)) return venvPath;  // 已有,直接返回

  // 智能找 python: 试 python / python3 / py (Windows 启动器)
  const candidates = ...;
  let pythonBin = null;
  for (const c of candidates) {
    try { execSync(`${c} --version`); pythonBin = c; break; } catch {}
  }
  if (!pythonBin) return { error: 'python_not_found' };

  // 清残留半成品 .venv (上轮建失败留下的)
  if (fs.existsSync(venvDir)) fs.rmSync(venvDir, { recursive: true, force: true });

  // 建 venv + pip install
  try {
    execSync(`${pythonBin} -m venv "${venvDir}"`, { timeout: 60000 });
    execSync(`"${pipPath}" install -r "${requirementsPath}"`, { timeout: 300000 });
    return venvPath;
  } catch (err) {
    return { error: 'venv_create_failed', detail: err.message };
  }
}
```

---

## 4. v1.1.0 踩的 5 个坑 (必读)

### 坑 1: `electron-store` 和 `fix-path` 写在 `devDependencies`

**症状**: Windows 装完点图标 → "Cannot find module 'electron-store'" 弹窗,主程序起不来。

**根因**:
- `main.js:6` `const Store = require('electron-store')` 是**运行时**就要
- electron-builder 只把 `dependencies` 打 asar
- 这俩包被错放在 `devDependencies`,asar 里就没

**修法** (已 commit 在当前 main):
```diff
  "devDependencies": {
    "ali-oss": "^6.23.0",
    "electron": "^32.0.0",
-   "electron-builder": "^25.0.0",
-   "electron-store": "^8.2.0",
-   "fix-path": "^3.0.0"
+   "electron-builder": "^25.0.0"
  },
  "dependencies": {
+   "electron-store": "^8.2.0",
    "electron-updater": "^6.3.0",
+   "fix-path": "^3.0.0"
  }
```

**为什么踩这坑 (推测)**: v9 是 ESM-only,跟 main.js 的 CJS `require()` 冲突,降 v8 时顺手 `--save-dev`。忘了挪回去。

**预防**:
- 改 deps 时,跑一次 `npx asar list dist/win-unpacked/resources/app.asar | grep '名字'` 确认在 asar 里
- 加 CI gate:build 后 grep `main.js` 里 `require` 的所有包,必须在 `dependencies` 里

### 坑 2: `assets/**/*` 不在 `build.files`

**症状**: Windows 装完点图标 → "Failed to load image from path '...\resources\app.asar\assets\icon.ico'" 弹窗,主程序起不来。

**根因**: `desktop/package.json` 的 `build.files` 没列 `assets/`,electron-builder 跳过。

**修法** (已 commit):
```diff
  "files": [
    "main.js",
    "preload.js",
    "cloud-api.js",
    "auto-updater.js",
+   "assets/**/*",
    "installer/**/*"
  ],
```

**预防**:
- 默认用 `["**/*"]` 而不是手列
- 或加 CI gate:grep `main.js` / `auto-updater.js` / `preload.js` 里所有 `path.join(__dirname, ...)` 引用,确认路径在 `files` 里

### 坑 3: 换 logo 时把备份目录也打 asar 了 (过程问题)

**症状**: 我建了 `assets/old-icons-backup/` 备份老图标,`build.files` 的 `assets/**/*` 把它也打进去了,asar 多了 4 MB 垃圾。

**修法**: build 前 `rm -rf assets/old-icons-backup`。最终 build 干净。

**预防**:
- 备份用 git stash / 临时目录,别放 `assets/` 下
- 或 `build.files` 用 exclude:
  ```json
  "files": [
    "assets/**/*",
    "!**/old-icons-backup/**",
    "!**/*.bak"
  ]
  ```

### 坑 4: bootstrap 没 admin 权限

**症状**: 装器看着装完,但"依赖安装未完全成功"弹窗,5 个 dep 一个没装上,主程序起不来 (找不到 Node 等)。

**根因**:
- 5 个 dep 都要 admin (写 `C:\Program Files\` / 注册 Windows 服务)
- 装器调 PowerShell 用 `nsExec::ExecToLog`,**继承装器进程的权限**
- 装器默认是 user 权限,bootstrap 跟着是 user,`Start-Process` 不弹 UAC,5 个 dep 全静默失败

**修法** (已 commit): `installer.nsh:7` 加 `RequestExecutionLevel admin`,装器一开始就 admin,bootstrap 跟着 admin,`Start-Process` 装 dep 也都能跑。

**白话**: "装器跟 Windows 说一声'我要管电脑',Windows 问用户'让不让',用户点'是',后面所有步骤都有钥匙开所有门"。

### 坑 5: Python venv 创建失败 — 错误信息硬编码 + 没清残留

**症状**: Windows 装完启动 app,K+绿点 logo 出,但弹"服务启动失败 / 无法创建 Python 虚拟环境。请确保已安装 Python 3.12+。",app 退出。

**根因** (3 个子问题):
1. `main.js:194` 错误信息**硬编码 "Python 3.12+"**,但 `deps-manifest.json` 装的是 **Python 3.11.9**。信息误导用户去装错版本
2. `python` 命令找不到时直接报"venv 创建失败",不区分"没装"还是"装了但 venv 出错"
3. 如果之前一轮建 venv 失败留了半成品 `.venv` 目录,这次不会清,直接用坏的

**修法** (已 commit,本次定版的 v1.1.0):

a) `main.js` `ensurePythonVenv` 重写:
- 智能找 python: 试 `python` / `python3` / `py` (Windows 启动器) 三选一
- 返回类型从 `null` 改成 `{ error: 'python_not_found' | 'venv_create_failed', detail? }` 或 `venvPath`
- 重建前先 `rm -rf .venv` 清残留

b) caller `startPythonService` 拿到新返回类型,出**准的对话框**:
- `python_not_found` → "找不到 Python。开始菜单 → AI 内容创作平台 → 修复安装 重装依赖。"
- `venv_create_failed` → "无法创建 Python 虚拟环境 (需要 Python 3.11+):\n\n{detailed err}\n\n手动检查: 开始菜单 → 修复安装 重装依赖"
- 修复版本号提示从 "3.12+" 改为 "3.11+"

**预防**:
- main.js 里**所有**版本号 / URL / 路径字面量都要从 manifest / env 读,别硬编码
- 错误信息要带**具体**操作指引 ("开始菜单 → 修复安装"),别只说"请确保"
- `ensureXxx` 类函数**先清残留再建**,假设上次可能留了半成品

---

## 5. 图标 (K + 绿点) 怎么生成的

源文件: `/Users/yanghy/Documents/New project/kaypal-geo-ui/public/kaypal-logo.png` (192x192, RGBA)

转换步骤 (Mac 上):
```bash
SRC="/Users/yanghy/Documents/New project/kaypal-geo-ui/public/kaypal-logo.png"
DST="/Users/yanghy/Documents/New project/ai-content/desktop/assets"
TMPDIR="/tmp/kaypal-icon-build"

# 1. 8 个尺寸的 PNG (sips 上采样)
for sz in 16 32 48 64 128 256 512 1024; do
  sips -z $sz $sz "$SRC" --out "$TMPDIR/icon-${sz}.png"
done

# 2. 多分辨率 .ico (ImageMagick)
magick "$TMPDIR/icon-16.png" "$TMPDIR/icon-32.png" "$TMPDIR/icon-48.png" \
      "$TMPDIR/icon-64.png" "$TMPDIR/icon-128.png" "$TMPDIR/icon-256.png" \
      "$DST/icon.ico"

# 3. macOS .iconset (10 个尺寸)
mkdir -p "$DST/icon.iconset"
cp "$TMPDIR/icon-16.png"    "$DST/icon.iconset/icon_16x16.png"
cp "$TMPDIR/icon-32.png"    "$DST/icon.iconset/icon_16x16@2x.png"
cp "$TMPDIR/icon-32.png"    "$DST/icon.iconset/icon_32x32.png"
cp "$TMPDIR/icon-64.png"    "$DST/icon.iconset/icon_32x32@2x.png"
cp "$TMPDIR/icon-128.png"   "$DST/icon.iconset/icon_128x128.png"
cp "$TMPDIR/icon-256.png"   "$DST/icon.iconset/icon_128x128@2x.png"
cp "$TMPDIR/icon-256.png"   "$DST/icon.iconset/icon_256x256.png"
cp "$TMPDIR/icon-512.png"   "$DST/icon.iconset/icon_256x256@2x.png"
cp "$TMPDIR/icon-512.png"   "$DST/icon.iconset/icon_512x512.png"
cp "$TMPDIR/icon-1024.png"  "$DST/icon.iconset/icon_512x512@2x.png"

# 4. .icns (macOS 原生)
iconutil -c icns "$DST/icon.iconset" -o "$DST/icon.icns"

# 5. Linux .png (用 512)
cp "$TMPDIR/icon-512.png" "$DST/icon.png"
cp "$TMPDIR/icon-256.png" "$DST/icon_256.png"  # electron-builder 早期版本兼容
```

**注意**: 192x192 上采到 1024 会有点糊。理想是源图就给 1024+ 的 PNG。`kaypal-geo-ui` 那张是 192,这次凑合了。下次换 logo 让设计给 ≥1024 的源。

---

## 6. 怎么发一个新版本

### 方法 A: GitHub Actions (推荐)

```bash
cd "/Users/yanghy/Documents/New project/ai-content"
# 1. 改版本号
#    desktop/package.json: "version": "1.1.0" → "1.2.0"
#    同步改 README/release notes 里的版本号
# 2. commit
git add -A
git commit -m "release: v1.2.0"
git push origin main

# 3. 打 tag 触发 CI
git tag v1.2.0
git push origin v1.2.0
```

CI (`.github/workflows/release-desktop.yml`):
- 3 个 runner (macos-latest / windows-latest / ubuntu-latest) 并行
- 每个 runner 跑 `npm install && npx electron-builder --<plat>`
- 跑完调 `node scripts/upload-to-oss.js` 把产物传到 `oss://kaypal/updates/`
- 不需要本地有 OSS key,GitHub Secrets 自动注入

### 方法 B: 本地手工 (出了事,或要 hotfix)

```bash
cd "/Users/yanghy/Documents/New project/ai-content/desktop"

# 1. 改版本号
vim package.json  # version 字段

# 2. 装
npm install --no-audit --no-fund

# 3. build 一个平台
npx electron-builder --win --x64      # Mac 上 wine 自动下
npx electron-builder --mac --arm64    # 只能在 Mac 上
npx electron-builder --linux --x64

# 4. 验 (每次 build 完必跑)
npx asar list dist/win-unpacked/resources/app.asar | grep -E "electron-store|icon\.ico"
ls -lh dist/*.exe dist/*.yml dist/*.blockmap

# 5. 传 OSS (env vars 从 .env 读,或直接 inline)
OSS_ACCESS_KEY_ID=<your-oss-access-key-id> \
OSS_ACCESS_KEY_SECRET=<your-oss-access-key-secret> \
OSS_BUCKET=kaypal \
OSS_REGION=oss-cn-hangzhou \
OSS_UPDATE_PATH=updates/ \
node scripts/upload-to-oss.js \
  "dist/KaypalAI内容创作平台 Setup 1.1.0.exe" \
  "dist/KaypalAI内容创作平台 Setup 1.1.0.exe.blockmap" \
  "dist/latest.yml"

# 6. 验 OSS
curl -s "https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml" | head
# 看 version 是不是新版本号,sha512 跟本地对得上
```

### 6.1 5 个 dep 怎么重新传 OSS

```bash
cd "/Users/yanghy/Documents/New project/ai-content/desktop"
OSS_ACCESS_KEY_ID=... OSS_ACCESS_KEY_SECRET=... OSS_BUCKET=kaypal \
OSS_UPDATE_PATH=deps/ \
node scripts/upload-deps.js
# 会读 deps-manifest.json,逐个上传
```

---

## 7. Windows 上怎么测

### 7.1 装

```
https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/KaypalAI%E5%86%85%E5%AE%B9%E5%88%9B%E4%BD%9C%E5%B9%B3%E5%8F%B0%20Setup%201.1.0.exe
```

(URL 里的 `KaypalAI内容创作平台 Setup 1.1.0.exe` 是 URL-encoded 的: `KaypalAI%E5%86%85%E5%AE%B9%E5%88%9B%E4%BD%9C%E5%B9%B3%E5%8F%B0%20Setup%201.1.0.exe`)

步骤:
1. 控制面板卸载旧版 (如果装过)
2. 下载 89 MB
3. 双击 → UAC → "是"  ← **Plan A 关键,必须 admin**
4. 选安装目录
5. 装完 bootstrap WPF 窗口出 → 5 dep 进度条 (5-10 分钟,看网速)
6. "启动应用" 按钮亮 → 点
7. K+绿点 logo 在窗口标题栏出 (说明 icon 修了)
8. 不弹"无法创建 Python 虚拟环境"(说明 venv 修了)

### 7.2 测什么

- [ ] 装器 UAC 正常弹,能装上
- [ ] bootstrap 把 5 dep 都装上 (WPF 列表 5 个 ✓)
- [ ] 桌面图标 (K + 绿点) 对
- [ ] 双击图标 → Electron 窗口出
- [ ] 系统托盘图标对
- [ ] **`<auto-upload>/.venv/Scripts/python.exe` 存在** (说明 venv 建好了)
- [ ] 启动时没弹"服务启动失败"对话框 (说明 Python 服务起得来)
- [ ] 登录 device flow 通 (跟 test.kaypal.cn / kaypal.cn 配)
- [ ] 真实抖音 / 视频号账号能进 CDP 持久浏览器
- [ ] 自动发内容流程跑通
- [ ] 任务过程证据回传到云端

### 7.3 卸

控制面板 → "KaypalAI内容创作平台" → 卸载。会自动调 `installer/uninstall.ps1`,反向清:5 dep **不卸** (用户可能别的软件要用),只卸主程序 + 自启动 + 快捷方式 + `app.asar` + 配置目录 (`%AppData%/KaypalAI内容创作平台/`)。

### 7.4 看日志

- Electron 主进程日志: `%AppData%/Roaming/KaypalAI内容创作平台/logs/main.log`
- bootstrap 装器日志: 装的时候 WPF 窗口里看
- 详细 dep 装失败原因: `C:\Users\<user>\AppData\Local\Temp\ai-content-deps\` 下看下载的 msi/exe 是不是齐
- venv 创建失败详情: 看 main.log 里 `[Python]` 开头的行

### 7.5 排查命令 (出问题跑这些)

在 Windows 命令行 (cmd) 跑:
```cmd
where python
python --version
python -m venv --help
echo %PATH%
```

发给我时把**完整输出**带上。

---

## 8. 紧急情况 (Hotfix)

### 8.1 装完起不来

1. 让用户打开 `%AppData%/Roaming/KaypalAI内容创作平台/logs/main.log` 看最后 50 行
2. 90% 是 `Cannot find module` 之类 → 看 `desktop/dist/win-unpacked/resources/app.asar` 里有没有 (用 `npx asar list`)
3. 5 dep 装失败 → 重跑 `start menu → AI 内容创作平台 → 修复安装`
4. venv 创建失败 → 看 main.log 的 `[Python]` 行,新版本会写明原因

### 8.2 装器签名 / Defender 拦截

当前没代码签名,Defender 第一次会弹"未识别的应用"。用户点"仍要运行"即可。
- 长期:买 EV 代码签名证书 (~$300/年),用 `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a KaypalAI.exe`
- 短期:用 `signtool sign` 加自签证书,Defender 会更少拦

### 8.3 OSS 桶 403 / 写不进去

- 阿里云控制台 → RAM → 用户 `yanghylive-deploy` → 看 AccessKey 有没有 OSSFullAccess
- AccessKey 轮换:控制台 → 创建新 AK → 改 GitHub Secrets 6 项 + 改本地 `.env` → 删旧 AK
- 桶公共读:OSS → 桶 → 权限 → 读写权限 → 公共读

### 8.4 怎么回滚到上一版

- **代码**: `git revert <bad-tag-commit> && git tag v1.1.0-rollback && git push --tags`
- **OSS**: 不删 v1.1.0 (用户可能还在跑),上传 v1.0.x 产物 + yml,把 latest.yml 改成 v1.0.x
  ```bash
  # 1. 重 build 老 commit
  git checkout v1.0.0
  cd desktop && npm install && npx electron-builder --win
  # 2. 上传 (覆盖 yml)
  node scripts/upload-to-oss.js "dist/KaypalAI内容创作平台 Setup 1.0.0.exe" \
    "dist/KaypalAI内容创作平台 Setup 1.0.0.exe.blockmap" "dist/latest.yml"
  ```

### 8.5 用户装了多个 Python 版本冲突

`main.js` 现在用 `python` / `python3` / `py` 三选一,会拿 PATH 里**第一个**。如果有别的软件 (比如 Anaconda) 在 PATH 前面塞了 Python 2.x 或 3.7,**装 venv 会失败**。

**修法**:
- 短:用户控制面板 → 卸掉冲突的 Python,装我们的 3.11.9
- 中:bootstrap 装我们的 Python 时设 `setx PY_PYTHON 3.11`,用 `py` 启动器显式选版本
- 长:bootstrap 装完后 `setx` 把我们的 `C:\Program Files\Python311\` 放到 PATH 第一个

---

## 9. 没做 / 故意没做

| 项 | 为什么没做 | 何时做 |
|---|---|---|
| Windows 代码签名 | 贵 ($300/年 EV cert) 且流程慢 | 装机量 > 100 或被 Defender 大量报毒时 |
| macOS notarization | 需要 Apple Developer ID ($99/年) + Xcode | 上 Mac App Store 时 |
| 自动清 OSS 旧版本 | OSS 1 毛/GB/月,几 T 才几百块 | OSS 满的时候 |
| 多 channel (beta/stable) | 当前用户量 < 50,都用 latest 就行 | 团队 > 50 人要分批时 |
| Bootstrap 加进度百分比实时刷新 | 当前是按 dep step 切,不是按字节 | 用户反映"不知道装到哪"时 |
| Linux snap/flatpak | 当前 deb + AppImage 覆盖主流,Linux 用户基数小 | 用户要时 |
| 装器内嵌 update URL | 装出来后再改要走 regedit | 极少用 |
| 7-zip / 7za 集成 | 当前下载的 .msi / .exe 自己跑 | 装器要下 .zip 之类时 |
| 离线安装包 (5 dep 全打进去) | 单包 500+ MB,99% 用户有网 | 企业内网部署或大陆外网差时 |
| 装器自动选 Python 3.11 (避 PATH 冲突) | 当前多 Python 用户少 | 用户反馈"venv 装失败但 python 装了"时 |

---

## 10. 一句话给下一任

> 这条线 80% 时间花在"为什么我改了 A,Windows 上跑出来却是 B"。NSIS / PowerShell / electron-builder 三层叠在一起,任何一层的 silent 默认行为都能让你栽坑。
>
> 五条铁律 (按踩坑顺序):
> 1. **改动 deps / build.files / icon 路径,build 完必 `npx asar list` 验**
> 2. **NSIS 装器能跑通,不代表 dep 能装上。装 dep 要 admin 权限,装器必须自己就要 admin**
> 3. **所有版本号 / URL / 路径字面量从 manifest / env 读,别在 main.js 硬编码。报错要带"具体怎么修"**
> 4. **`ensureXxx` 类函数先清残留再建,假设上次可能留了半成品**
> 5. **OSS 上传完必 `curl` yml 验 sha 跟本地对得上**

---

## 11. 联系人

- 桌面端打包 / NSIS / bootstrap: 找 yanghy
- OSS / 阿里云 / RAM 子账号: 找 yanghy
- 抖音/视频号自动发: 看 `backend/src/modules/auto-upload/` 和 `desktop/services/`
- 云端 Kaypal 鉴权 (`kaypal-auth` device flow): 看 `kaypal-ai` 仓库 (yanghylive/kaypal-ai),不在本仓

---

## 12. 附录: v1.1.0 完整产物清单 (2026-06-03)

### 3 轮 build 演进

| 轮次 | sha512 (b64) | 修了啥 |
|---|---|---|
| 1 | `3jOcgfBwXA2Tl0Itd/QMPfFG0XzeyCnNJm+u3Oz6mOZ1s8Eh+IR82Lv11RjK4pQRKgyAhC+Hqiz+VMip9qsRxQ==` | 坑 1 (electron-store deps), 坑 2 (assets in build.files), 坑 3 (logo 换 K+绿点) |
| 2 | `BhmrXdK/5xGD+5OdHtbFvVnmI7l40PQ7RwQcYAZd8EKZSMqYe6WLE7sqT3cKlqt9j7mbYKRDhzIBubckbkaQWA==` | 坑 4 (NSIS admin) + 删 backup dir |
| **3 (定版)** | `YKXlo35mnbas3/qXQTTY/G6v8OCv4cS/a9U4AhZRX0UaD2why1o8mP0cIm/0tU76H+jgt5Z4q+N5Te9TZCThjw==` | **坑 5 (Python venv 智能检测 + 清残留 + 准报错)** |

### OSS `oss://kaypal/updates/` (最新版)

| 文件 | 大小 | sha512 (b64) |
|---|---|---|
| `KaypalAI内容创作平台 Setup 1.1.0.exe` | ~89 MB | `YKXlo35mnbas3/qXQTTY/G6v8OCv4cS/a9U4AhZRX0UaD2why1o8mP0cIm/0tU76H+jgt5Z4q+N5Te9TZCThjw==` |
| `KaypalAI内容创作平台 Setup 1.1.0.exe.blockmap` | 97 KB | (yml 里有) |
| `latest.yml` | 380 B | version 1.1.0 |

### OSS `oss://kaypal/deps/`

| 文件 | 大小 | 版本 |
|---|---|---|
| `node-v20.18.0-x64.msi` | 25 MB | Node 20.18.0 |
| `python-3.11.9-amd64.exe` | 25 MB | **Python 3.11.9** (跟 main.js 报的"3.11+" 一致) |
| `postgresql-16.4-1-windows-x64.exe` | 357 MB | PostgreSQL 16.4 (密码 `ai_content_2026` 硬编码) |
| `Redis-3.0.504-Windows-x64.msi` | 1.7 MB | Redis 3.0.504 |
| `ChromeStandaloneSetup64.exe` | 145 MB | Chrome 131.0.6778.140 (optional) |

### GitHub 仓库

- `yanghylive/ai-content` (本仓)
- 主分支 `main`
- v1.1.0 build 在 main 最新 commit
- 主要文件改动 (本轮):
  - `desktop/package.json` — deps 挪位 + `assets/**/*` 加进 files
  - `desktop/main.js` — `ensurePythonVenv` 重写
  - `desktop/installer.nsh` — 加 `RequestExecutionLevel admin`
  - `desktop/assets/*` — 换 K+绿点 logo

---

## 13. 已知问题 / 跟进

- [ ] 用户端还没在真机跑通 v1.1.0 完整流程 (实拍视频证明登录 device flow + 真账号发内容)。本轮只验到"装上能启动 + icon 对 + venv 智能报错"。
- [ ] 没在 Windows 实测 PostgreSQL 静默装器 (357 MB 的大块头,silent args 里 `--datadir` 路径写死,如果用户已经装过 PG 16,会冲突)
- [ ] 5 个 dep 都是 x64,没 arm64 build。Apple Silicon Mac 通过 Rosetta 跑 x64,凑合。
- [ ] `auto-upload` 项目的 `requirements.txt` 里如果某包 `requires-python>=3.12`,装 3.11 会装失败,但目前还没看到。

---

**文档结束。如有更新,在这文件直接追加章节,别另起文件。**
