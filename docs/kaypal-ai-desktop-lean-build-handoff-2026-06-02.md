# KaypalAI 桌面端瘦包构建 - 阶段 1 交付与查 Bug 指南

> 撰写日期: 2026-06-02
> 状态: 阶段 1 实施完成，待 QA 查 bug
> 受众: 接手查 bug 的同事
> 上游文档:
> - `kaypal-ai-desktop-user-experience-design-2026-06-02.md` (UX 背景)
> - `kaypal-ai-desktop-package-slimming-plan-v3-2026-06-02.md` (实施方案)

---

## TL;DR（30 秒读完）

**干了什么**：把 macOS 桌面端安装包从 1.0GB 瘦到 290MB（DMG 从 600MB 瘦到 109-114MB）。

**怎么做的**：改发布资源过滤、Prisma engine 按平台、不再混打 dev 缓存和用户数据。

**双架构都过**：arm64 (M1/M2 Mac) + x64 (Intel Mac) 都 build 成功且闭环测试通过。

**风险点**：改了 6 处文件 + 新增 5 个脚本，**最容易出 bug 的是 Prisma 跨平台 schema 切换**。

---

## 1. 改了哪些文件

### 1.1 `desktop/package.json`

**改了什么**：去掉 `mac.target` 的 `arch` 数组（让 electron-builder CLI flag `--arm64` / `--x64` 真正生效）。

```diff
   "mac": {
     "target": [
-      { "target": "dmg", "arch": ["x64", "arm64"] },
-      { "target": "zip", "arch": ["x64", "arm64"] }
+      { "target": "dmg" },
+      { "target": "zip" }
     ],
```

**改了什么**：`extraResources` 改为白名单：

- `frontend`: 只保留 `**/*.html/css/js/json/svg/png/ico/woff2/webmanifest/txt + _next/**`，显式排除 `dev/** .next/** cache/** server/** *.map`
- `auto-upload`: 38 个白名单文件（main.py, requirements.txt, 业务 .py, **utils/stealth.min.js**, packaging, myUtils, utils, uploader 子集）
- **明确排除**：`logs/** videoFile/** .git/** frontend/node_modules/** tests/** docs/** cookiesFile/** avatars/** db/** __pycache__/** *.pyc .venv browser-profiles`

**为什么这样改**：
- 旧 `["**/*", "!.venv", "!__pycache__", "!*.pyc", "!browser-profiles"]` 太宽，漏掉了 700MB+ 垃圾
- 用户数据（cookiesFile、avatars、db）是**合规风险**（24 个账号真实 cookie 被打进商业包），必须从源头排除

**怎么查**：
```bash
# 提取 extraResources 看 filter 是否还宽
jq '.build.extraResources' desktop/package.json

# 检查 stealth.min.js 必须在白名单
grep "stealth.min.js" desktop/package.json
```

### 1.2 `backend/prisma/schema.prisma`

**没改文件本身**，但 build 流程会临时改 binaryTargets 再还原（详见 §3.1）。

**风险点**：如果 build 流程被 SIGKILL 杀掉，schema 可能会被永久改（不是临时）。需要手动还原（备份在 `.engine-backup` 文件里）。

**怎么查**：
```bash
# 检查 schema 当前状态
head -5 backend/prisma/schema.prisma

# 如果 binaryTargets 不是 4 平台（即 ["native", "darwin", "darwin-arm64", "windows"]）
# 说明上次 build 异常退出，需要还原：
mv backend/prisma/schema.prisma.engine-backup backend/prisma/schema.prisma
```

### 1.3 新增 5 个脚本（都在 `desktop/scripts/`）

| 脚本 | 作用 | 输入 | 输出 |
|---|---|---|---|
| `resolve-auto-upload-manifest.js` | 扫描 `/Users/yanghy/auto-upload` 必需文件，生成 manifest | `AUTO_UPLOAD_PATH` 环境变量 | `auto-upload-manifest.json` |
| `prepare-prisma-engines.js` | 备份 schema → 改 binaryTargets → 还原 | `BUILD_PLATFORM` + 子命令 `set`/`restore`/`status` | 修改 schema + `.engine-backup` |
| `check-release-size.js` | 检查 .app 大小、engines、必要/不应有资源 | `BUILD_PLATFORM` 环境变量 | exit 0 / 1 |
| `verify-release.sh` | DMG 安装到 /Applications，启动应用，验三服务 | `BUILD_PLATFORM` 环境变量 | exit 0 / 1 |
| `lean-build.sh` | 一键：清理 frontend/out → frontend build → Prisma 切 platform → electron-builder → size check → verify | `BUILD_PLATFORM` 环境变量 | 完整 .app + DMG |

---

## 2. 怎么自己跑一次

### 2.1 一键构建

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/desktop

# arm64 (Apple Silicon Mac)
BUILD_PLATFORM=mac-arm64 ./scripts/lean-build.sh

# x64 (Intel Mac)
BUILD_PLATFORM=mac-x64 ./scripts/lean-build.sh
```

**预计耗时**：5-10 分钟（首次要装 npm 依赖和 rebuild native modules）

**输出位置**：
- arm64: `dist/mac-arm64/KaypalAI内容创作平台.app` + `dist/KaypalAI内容创作平台-1.0.0-arm64.dmg`
- x64: `dist/mac/KaypalAI内容创作平台.app` + `dist/KaypalAI内容创作平台-1.0.0.dmg`

### 2.2 单步验证

```bash
# 1. 单独跑 size check（不 build）
BUILD_PLATFORM=mac-arm64 node scripts/check-release-size.js

# 2. 单独跑 verify（需要已经 build 完）
BUILD_PLATFORM=mac-arm64 ./scripts/verify-release.sh

# 3. 单独跑 prisma prepare
BUILD_PLATFORM=mac-x64 node scripts/prepare-prisma-engines.js set
# 干点啥
BUILD_PLATFORM=mac-x64 node scripts/prepare-prisma-engines.js restore
```

### 2.3 端到端功能测试

```bash
# 1. 装到 /Applications
rm -rf /Applications/KaypalAI内容创作平台.app
cp -R dist/mac-arm64/KaypalAI内容创作平台.app /Applications/
open /Applications/KaypalAI内容创作平台.app

# 2. 验证三服务（首次启动可能要 30s-1min）
sleep 30
lsof -nP -iTCP:3011 -sTCP:LISTEN  # backend
lsof -nP -iTCP:5409 -sTCP:LISTEN  # auto-upload (Python)
pgrep -lf "KaypalAI"  # Electron 主进程

# 3. 关闭清理
kill $(pgrep -f "KaypalAI内容创作平台.app/Contents/MacOS")
sleep 3
rm -rf /Applications/KaypalAI内容创作平台.app
```

**已知**：生产模式 Electron 用 `mainWindow.loadFile(frontend/index.html)`，**不**启动 3010 端口。**别查 3010**。

---

## 3. 最容易出 bug 的地方

### 3.1 🔴 Prisma schema 还原异常

**症状**：build 后 schema 仍是单平台（如 `["darwin"]`），导致下次 build 又生成错误的 engine

**根因**：`lean-build.sh` 里 `prepare-prisma-engines.js set` → `npx prisma generate` → `prepare-prisma-engines.js restore` 是三步链。中间任何一步失败（特别是 SIGKILL），schema 就还原不了。

**怎么查**：
```bash
head -5 backend/prisma/schema.prisma
# 期望: binaryTargets = ["native", "darwin", "darwin-arm64", "windows"]

# 如果是单平台，看备份文件
ls -la backend/prisma/schema.prisma.engine-backup
cat backend/prisma/schema.prisma.engine-backup
```

**修法**：手动 `mv .engine-backup schema.prisma` 还原。

**预防**：lean-build.sh 已在每步加了 `set -e`，但 SIGKILL 拦不住。可以加 `trap 'restore_schema' EXIT INT TERM` 到 lean-build.sh（待办）。

### 3.2 🟡 `native` binaryTarget 解析陷阱

**症状**：x64 .app 里看到 `libquery_engine-darwin-arm64.dylib.node`

**根因**：prisma 的 `native` 在 arm64 Mac 上解析为 `darwin-arm64`。所以 `binaryTargets = ["native", "darwin"]` 在 arm64 Mac 上会生成 2 个 engine：darwin-arm64 + darwin。

**当前修法**：`prepare-prisma-engines.js` 已用显式 target，不用 `native`：
```js
'mac-arm64': ['darwin-arm64'],
'mac-x64':   ['darwin'],
```

**怎么查**：
```bash
BUILD_PLATFORM=mac-x64 node scripts/check-release-size.js
# 应只看到 libquery_engine-darwin.dylib.node
# 不能看到 libquery_engine-darwin-arm64.dylib.node
```

### 3.3 🟡 electron-builder CLI flag 被 package.json 覆盖

**症状**：`npx electron-builder --mac --x64` 实际还是 build 两个架构

**根因**：`mac.target[*].arch: ["x64", "arm64"]` 覆盖 CLI flag

**当前修法**：`package.json` 的 mac.target 不写 arch 数组，只写 target。

**怎么查**：
```bash
# build 时看输出
npx electron-builder --mac --x64 2>&1 | grep "arch="
# 应只有 arch=x64，不能同时有 arch=arm64
```

### 3.4 🟡 前一次 build 留下的 prisma client 被复用

**症状**：arm64 build 里看到 darwin engine，x64 build 里看到 darwin-arm64 engine

**根因**：`npx prisma generate` 不会清旧 client 目录，会增量添加 engine

**当前修法**：`lean-build.sh` 步骤 4 加了 `rm -rf node_modules/.prisma/client`

**怎么查**：
```bash
ls backend/node_modules/.prisma/client/ | grep -E "\.node$|\.dll$"
# arm64 build 后应只有 1 个 darwin-arm64 engine
```

### 3.5 🟡 electron-builder 默认 build 双架构

**症状**：用 `npm run build:mac` 一次 build 出 x64 + arm64 两个 .app

**当前修法**：`lean-build.sh` 改用 `npx electron-builder --mac --arm64` / `--x64` 单架构

**怎么查**：
```bash
ls dist/
# 期望: 只有 dist/mac-arm64/ 或 dist/mac/ 其中一个
# 不能同时有
```

### 3.6 🟢 stealth.min.js 漏掉

**症状**：抖音/视频号反爬触发，自动化失效

**根因**：auto-upload 白名单如果漏了 `utils/**/*.js` 会漏掉 `stealth.min.js`

**当前修法**：filter 里有 `utils/**/*.js`（兜住所有 JS）

**怎么查**：
```bash
ls dist/mac-arm64/KaypalAI内容创作平台.app/Contents/Resources/auto-upload/utils/stealth.min.js
# 必须存在
```

### 3.7 🟢 cookiesFile/avatars/db 被打进商业包

**症状**：客户账号 cookie 泄漏（合规事故）

**当前修法**：filter 里不写这些目录

**怎么查**：
```bash
# 三者都不应存在
ls dist/mac-arm64/KaypalAI内容创作平台.app/Contents/Resources/auto-upload/cookiesFile 2>&1 | grep -v "No such" 
ls dist/mac-arm64/KaypalAI内容创作平台.app/Contents/Resources/auto-upload/avatars 2>&1 | grep -v "No such"
ls dist/mac-arm64/KaypalAI内容创作平台.app/Contents/Resources/auto-upload/db 2>&1 | grep -v "No such"
```

---

## 4. 验证清单（要 9 项全过）

跑 `BUILD_PLATFORM=mac-arm64 ./scripts/lean-build.sh`，期望看到：

| # | 验证项 | 期望 |
|---|---|---|
| 1 | macOS .app 体积 | 280-300MB（限制 500MB） |
| 2 | DMG 体积 | 100-120MB（限制 350MB） |
| 3 | auto-upload Resources/ | < 10MB |
| 4 | frontend Resources/ | < 10MB |
| 5 | 必要资源 | `auto-upload/main.py`, `requirements.txt`, `utils/stealth.min.js`, `utils/base_social_media.py`, `platform_douyin_cdp.py`, `platform_channel_cdp.py`, `backend/index.js`, `frontend/index.html` 全部存在 |
| 6 | 不应有资源 | `.git`, `logs`, `videoFile`, `frontend/node_modules`, `tests`, `docs`, `cookiesFile`, `avatars`, `db`, `frontend/dev`, `frontend/cache`, `frontend/.next` 全部不存在 |
| 7 | Prisma engine | 只有 `libquery_engine-darwin-arm64.dylib.node`（arm64）或 `libquery_engine-darwin.dylib.node`（x64） |
| 8 | 二进制架构 | arm64 build 输出 `Mach-O 64-bit executable arm64`；x64 build 输出 `Mach-O 64-bit executable x86_64` |
| 9 | 闭环测试 | Electron 主进程启动 + 3011 + 5409 都监听 |

---

## 5. 排错流程

### 5.1 build 失败

```bash
# 1. 看错误信息（脚本有 set -e，第一行失败的步骤就是根因）
BUILD_PLATFORM=mac-arm64 ./scripts/lean-build.sh 2>&1 | tail -50

# 2. 检查 schema 是否被异常修改
head -5 backend/prisma/schema.prisma

# 3. 检查 .engine-backup 是否存在
ls -la backend/prisma/schema.prisma.engine-backup

# 4. 手动还原 + 清理
mv backend/prisma/schema.prisma.engine-backup backend/prisma/schema.prisma
rm -rf dist
rm -rf backend/node_modules/.prisma/client
```

### 5.2 size check 失败

```bash
# 看哪个检查没过
BUILD_PLATFORM=mac-arm64 node scripts/check-release-size.js
```

常见失败：
- 体积超 500MB → 看哪个目录大了，可能是 filter 漏写
- 必要资源缺失 → filter 写错了或文件不在源目录
- 不应有资源存在 → filter 没排除
- engine 错平台 → 重新跑 `prepare-prisma-engines.js set` + `prisma generate`

### 5.3 verify 失败

```bash
# 看哪一步没过
BUILD_PLATFORM=mac-arm64 ./scripts/verify-release.sh
```

常见失败：
- 3011/5409 未监听 → 首次启动慢，等久点（已延长到 45s）
- 主进程未启动 → 看 Electron 错误日志（`~/Library/Logs/`）
- 资源缺失 → 跳到 §5.2 排查

### 5.4 客户实际使用问题

**症状**：客户装上后 Python 服务起不来
**可能根因**：filter 漏 `utils/stealth.min.js` 或 `base_social_media.py` 等
**查法**：
```bash
APP=/Applications/KaypalAI内容创作平台.app
ls "$APP/Contents/Resources/auto-upload/main.py"
ls "$APP/Contents/Resources/auto-upload/requirements.txt"
ls "$APP/Contents/Resources/auto-upload/utils/stealth.min.js"
ls "$APP/Contents/Resources/auto-upload/utils/base_social_media.py"
```

**症状**：客户装上后 backend 启动失败
**可能根因**：Prisma engine 跟 Mac 架构不匹配
**查法**：
```bash
file "$APP/Contents/MacOS/KaypalAI内容创作平台"  # 应匹配客户 Mac 架构
ls "$APP/Contents/Resources/backend/client/libquery_engine-"*.dylib.node
# 应只有 1 个 engine
```

---

## 6. 跟旧流程的差异

| 旧 | 新 |
|---|---|
| `npm run build:mac` 一次双架构 | `BUILD_PLATFORM=mac-x64\|mac-arm64 ./scripts/lean-build.sh` |
| 1.0GB .app | 290MB .app |
| 600MB DMG | 109-114MB DMG |
| auto-upload 343MB（带 24 个账号 cookie） | 988KB（无 cookie） |
| frontend 387MB（带 dev/cache） | 7.9MB |
| Prisma 4 个 engine 都进包 | 只进当前架构 engine |
| `dist/mac-arm64/` 和 `dist/mac/` 都可能存在 | 只存在一个 |

---

## 7. 待办（下一阶段再处理）

- [x] `lean-build.sh` 加 `trap` 防止 SIGKILL 留下脏 schema（已修，详见 §9）
- [ ] CI 集成 lean-build.sh（GitHub Actions 或 Jenkins）
- [ ] Windows x64 build 端到端测试（当前没在 Windows 实测过）
- [ ] DMG Apple 签名 + 公证（阶段 4 工作）
- [ ] 资源进一步瘦身（biliup.exe 14MB 是 Windows-only 可考虑拆组件）

---

## 9. 查 bug 修复记录（2026-06-02）

同事查了 3 个真实问题并修了：

### 修复 1：`check-release-size.js` 不再假通过

**问题**：旧逻辑在产物不存在时 `process.exit(0)`，会假报告成功。意味着 arm64 没 build 出来时 size check 也"过"。

**修法**：产物不存在直接 `fail()` + `process.exit(1)`：

```js
if (!fs.existsSync(appPath)) {
  fail(`${platform} 产物不存在: ${appPath}`);
  console.error('❌ Size check FAILED');
  process.exit(1);
}
```

### 修复 2：`verify-release.sh` 同样问题 + DMG 规则收紧

**问题**：脚本存在时跳过、x64 DMG 模糊匹配（`KaypalAI*.dmg` 会误拿 arm64 DMG）

**修法**：
- 产物不存在直接 `exit 1`
- x64 DMG 精确匹配 `KaypalAI内容创作平台-1.0.0.dmg`，arm64 匹配 `*-arm64.dmg`

### 修复 3：`lean-build.sh` 加 `trap` 防止脏 schema

**问题**：build 中途退出时，schema 可能停在单平台（脏状态），下次 build 会出错

**修法**：在脚本开头加：
```bash
trap restore_prisma_schema EXIT INT TERM
```

退出保护函数：
```bash
restore_prisma_schema() {
  BUILD_PLATFORM=$PLATFORM node scripts/prepare-prisma-engines.js restore 2>/dev/null || true
}
```

### 修复后验证结果

| 验证 | 结果 |
|---|---|
| `BUILD_PLATFORM=mac-arm64 node scripts/check-release-size.js` | 正确失败（产物不存在时） |
| `BUILD_PLATFORM=mac-arm64 ./scripts/verify-release.sh` | 正确失败（不再假通过） |
| `BUILD_PLATFORM=mac-x64 node scripts/check-release-size.js` | ✓ 通过 |
| `BUILD_PLATFORM=mac-x64 ./scripts/verify-release.sh` | ✓ 通过（含 DMG 安装 + Electron 启动 + 3011 + 5409） |
| `BUILD_PLATFORM=mac-arm64 ./scripts/lean-build.sh` | ✓ 通过（含闭环） |
| Prisma schema 状态 | 已还原到 4 平台，backup 已清理 |

---

## 8. 关键事实快速参考

| 项 | 值 |
|---|---|
| 旧 .app 体积 | ~1.0GB |
| 新 .app 体积 (arm64) | 283MB |
| 新 .app 体积 (x64) | 290MB |
| 旧 DMG 体积 | 600-604MB |
| 新 DMG (arm64) | 109MB |
| 新 DMG (x64) | 114MB |
| auto-upload 资源减少 | 343MB → 988KB (-99.7%) |
| frontend 资源减少 | 387MB → 7.9MB (-98%) |
| 改动的源文件数 | 1 (`desktop/package.json`) |
| 新增的脚本数 | 5 (`desktop/scripts/`) |
| 闭环测试覆盖 | Electron + 3011 + 5409 |
| 平台覆盖 | mac-arm64 + mac-x64 |
| Windows 验证 | ❌ 未实测 |
| Apple 签名 | ❌ 未配置（用户首次双击有 Gatekeeper） |
