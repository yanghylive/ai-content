# KaypalAI 桌面端发布包瘦身实施修正案 v2

> 撰写日期: 2026-06-02
> 上游: kaypal-ai-desktop-package-slimming-plan-2026-06-02.md (v1)
> v1 已被 7 处技术错误修正，详见末尾"v1 错点逐条对照"
> 状态: 待执行（仅第一层）

---

## 修正要点

v1 文档**方向对但执行细节错**。本修正案只做最关键改动：

1. **不改 next.config.ts**（它已经是 `output: "export"` + `distDir: "out"`，问题在 dist 阶段不在这）
2. **明确白名单机制**：用"最小运行集"白名单，**不**用泛排除黑名单
3. **明确数据分类**：开发垃圾 / 用户数据 / 运行必需 三类分清
4. **跨平台 size check**：用 Node `fs.statSync` 递归算，不用 `du -sb`
5. **Prisma engine 按平台**：用 build script 切换，**不**用 `env().split()`
6. **不写死 Playwright 体积**：实测后再补

---

## 第一层修正版：最小白名单 + 闭环验证

### 1. 数据分类（先分类再决定进/不进包）

| 类别 | 内容 | 是否进商业包 | 理由 |
|---|---|---|---|
| **运行必需** | `main.py`, `requirements.txt`, `conf.py`, 业务 `.py` 模块, `cdp_runtime.py` | **是** | 不进就起不来 |
| **运行必需（资源）** | `bg1.png`, 启动图标 | **是**（最小集） | UI 需要 |
| **用户数据** | `cookiesFile/*.json` (24 个账号), `db/database.db`, `avatars/` | **否** | 客户账号数据，隐私合规风险，**必须用户首次运行时登录生成** |
| **开发/测试** | `logs/**`, `videoFile/**`, `tests/**`, `docs/**`, `.git/**`, `__pycache__/**`, `*.pyc`, `frontend/node_modules/**`, `frontend/src/**`, `frontend/.next/**` | **否** | 不进包 |
| **构建产物** | `frontend/out/dev/**`, `frontend/out/.next/**`, `frontend/out/cache/**` | **否** | dev mode 残留 |
| **跨平台误带** | mac 包带 `query_engine-windows.dll.node` | **否** | 按平台出包 |

### 2. 白名单最小集（auto-upload）

```json
// desktop/package.json extraResources
{
  "from": "../../../../auto-upload",
  "to": "auto-upload",
  "filter": [
    "main.py",
    "requirements.txt",
    "conf.py",
    "conf.example.py",
    "cdp_runtime.py",
    "platform_douyin_cdp.py",
    "platform_channel_cdp.py",
    "uploader/__init__.py",
    "uploader/**/*.py",
    "utils/__init__.py",
    "utils/**/*.py",
    "myUtils/__init__.py",
    "myUtils/**/*.py",
    "packaging/__init__.py",
    "packaging/**/*.py",
    "bg1.png",
    "favicon.ico"
  ]
}
```

**白名单效果**（先在本地 dry-run 验证）：

```bash
# 模拟 filter 行为
cd /Users/yanghy/auto-upload
files_to_include=(
  main.py requirements.txt conf.py conf.example.py
  cdp_runtime.py platform_douyin_cdp.py platform_channel_cdp.py
  uploader utils myUtils packaging
  bg1.png favicon.ico
)

# 估算白名单体积
du -ch main.py requirements.txt conf*.py cdp_runtime.py platform_*.py \
  uploader utils myUtils packaging 2>/dev/null | tail -1
# 预期: < 5MB
```

**白名单总预期**: auto-upload 343MB → **< 10MB**（**-333MB**）

### 3. 白名单最小集（frontend）

**修法**: **不改 next.config.ts**（已经是 export 模式）。改 desktop extraResources + 清理步骤。

```json
// desktop/package.json extraResources
{
  "from": "../frontend/out",
  "to": "frontend",
  "filter": [
    "**/*.html",
    "**/*.txt",
    "**/*.css",
    "**/*.js",
    "**/*.json",
    "**/*.svg",
    "**/*.png",
    "**/*.ico",
    "**/*.woff2",
    "**/*.webmanifest",
    "_next/**",
    "agent-console/**",
    "dashboard/**",
    "agent-workbench/**",
    "interaction/**",
    "local-engine/**",
    "publishing/**",
    "**/index.html",
    "!**/dev/**",          // 显式排除 dev mode 残留
    "!**/.next/**",        // 显式排除
    "!**/cache/**",        // 显式排除 turbopack cache
    "!**/server/**",       // 排除 SSR server 产物（export 模式不需要）
    "!**/*.map"            // 排除 source map
  ]
}
```

**预期**: frontend 387MB → **< 50MB**（**-337MB**）

### 4. Prisma engine 按平台（修法修正）

**v1 错误**: `binaryTargets = env("PRISMA_BINARY_TARGETS").split(",")` 不是 Prisma schema 合法语法

**v2 修法**: 用 build script 在构建时**生成两份 schema**，分别给不同平台

```javascript
// desktop/scripts/prepare-prisma-engines.js
const fs = require('fs');
const path = require('path');

const platform = process.env.BUILD_PLATFORM; // 'mac-arm64' | 'mac-x64' | 'win-x64'

const targets = {
  'mac-arm64': ['native', 'darwin-arm64'],
  'mac-x64':   ['native', 'darwin'],
  'win-x64':   ['native', 'windows'],
};

if (!targets[platform]) {
  console.error(`Unknown BUILD_PLATFORM: ${platform}`);
  process.exit(1);
}

const schemaPath = path.join(__dirname, '../../backend/prisma/schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

schema = schema.replace(
  /binaryTargets = \[[^\]]+\]/,
  `binaryTargets = [${targets[platform].map(t => `"${t}"`).join(', ')}]`
);

fs.writeFileSync(schemaPath, schema);
console.log(`Updated Prisma binaryTargets to: ${targets[platform].join(', ')}`);
```

```bash
# build 流程
BUILD_PLATFORM=mac-arm64 node desktop/scripts/prepare-prisma-engines.js
cd backend && npx prisma generate
# build Electron ...
cd .. && git checkout backend/prisma/schema.prisma  # 还原
```

**预期**: mac 包 backend/client 74MB → **< 50MB**（去 windows engine -20MB）

**兜底方案**: 如果 build script 太复杂，先用 electron-builder filter 排除：

```json
// 临时方案：filter 排除 windows engine
{
  "from": "../backend/node_modules/.prisma/client",
  "to": "backend/client",
  "filter": [
    "*.node", "*.wasm", "*.js"
  ]
}
// 然后 build 后手动删
// 或在 extraMetadata 阶段用 afterPack 钩子删
```

### 5. 跨平台 size check 脚本（修法修正）

**v1 错误**: macOS `du -sb` 不稳

**v2 修法**: 用 Node `fs.statSync` 递归算

```javascript
// desktop/scripts/check-release-size.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LIMITS_MB = {
  app: 500,    // .app / unpacked dir
  dmg: 350,    // mac DMG
  exe: 350,    // windows installer
};

const REQUIRED_RESOURCES = [
  'auto-upload/main.py',
  'auto-upload/requirements.txt',
  'backend/index.js',
  'backend/prisma/schema.prisma',
  'backend/prisma/dev.db',
  'backend/client/libquery_engine-darwin-arm64.dylib.node',
];

function dirSize(p) {
  let total = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch (e) {}
      }
    }
  }
  if (fs.existsSync(p)) walk(p);
  return total;
}

function checkMac() {
  const appPath = path.join(__dirname, '..', 'dist', 'mac-arm64', 'KaypalAI内容创作平台.app');
  if (!fs.existsSync(appPath)) return;
  const sizeMB = (dirSize(appPath) / 1024 / 1024).toFixed(0);
  console.log(`macOS .app: ${sizeMB}MB (limit ${LIMITS_MB.app}MB)`);
  if (parseInt(sizeMB) > LIMITS_MB.app) {
    console.error(`❌ macOS .app 超过 ${LIMITS_MB.app}MB 限制 (${sizeMB}MB)`);
    process.exit(1);
  }
}

function checkWindows() {
  const exePath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'KaypalAI内容创作平台.exe');
  if (!fs.existsSync(exePath)) return;
  const totalSize = dirSize(path.dirname(exePath));
  const sizeMB = (totalSize / 1024 / 1024).toFixed(0);
  console.log(`Windows unpacked: ${sizeMB}MB (limit ${LIMITS_MB.app}MB)`);
  if (parseInt(sizeMB) > LIMITS_MB.app) {
    console.error(`❌ Windows 超过 ${LIMITS_MB.app}MB 限制 (${sizeMB}MB)`);
    process.exit(1);
  }
}

function checkRequiredResources() {
  const platform = process.platform === 'darwin' ? 'mac-arm64' : 'win-unpacked';
  const basePath = path.join(__dirname, '..', 'dist', platform);
  const resourceBase = platform === 'mac-arm64' 
    ? path.join(basePath, 'KaypalAI内容创作平台.app', 'Contents/Resources')
    : path.join(basePath, 'resources');
  
  for (const f of REQUIRED_RESOURCES) {
    const full = path.join(resourceBase, f);
    if (!fs.existsSync(full)) {
      console.error(`❌ 必要资源缺失: ${f}`);
      process.exit(1);
    }
    console.log(`✓ ${f}`);
  }
}

console.log('=== Release Size Check ===');
checkMac();
checkWindows();
checkRequiredResources();
console.log('✅ All checks passed');
```

### 6. 闭环验证脚本（核心）

**白名单改了之后，资源可能没按预期进包，必须做端到端验证**：

```bash
# desktop/scripts/verify-release.sh
#!/bin/bash
set -e

echo "=== 1. 重新 build ==="
cd desktop
rm -rf dist
npm run build:mac-arm

echo "=== 2. 体积检查 ==="
node scripts/check-release-size.js

echo "=== 3. 必要资源完整性 ==="
APP="dist/mac-arm64/KaypalAI内容创作平台.app"
[ -f "$APP/Contents/Resources/auto-upload/main.py" ] || { echo "❌ main.py 缺失"; exit 1; }
[ -f "$APP/Contents/Resources/auto-upload/requirements.txt" ] || { echo "❌ requirements.txt 缺失"; exit 1; }
[ -f "$APP/Contents/Resources/backend/index.js" ] || { echo "❌ backend/index.js 缺失"; exit 1; }
echo "✓ 必要资源齐全"

echo "=== 4. 不应存在的资源（隐私/开发垃圾） ==="
SHOULD_NOT_EXIST=(
  "$APP/Contents/Resources/auto-upload/.git"
  "$APP/Contents/Resources/auto-upload/logs"
  "$APP/Contents/Resources/auto-upload/videoFile"
  "$APP/Contents/Resources/auto-upload/frontend/node_modules"
  "$APP/Contents/Resources/auto-upload/tests"
  "$APP/Contents/Resources/auto-upload/docs"
  "$APP/Contents/Resources/frontend/dev"
  "$APP/Contents/Resources/frontend/cache"
  "$APP/Contents/Resources/backend/client/query_engine-windows.dll.node"
  "$APP/Contents/Resources/auto-upload/cookiesFile"
  "$APP/Contents/Resources/auto-upload/avatars"
  "$APP/Contents/Resources/auto-upload/db"
)
for f in "${SHOULD_NOT_EXIST[@]}"; do
  if [ -e "$f" ]; then
    echo "❌ 不该存在的资源: $f"
    exit 1
  fi
done
echo "✓ 隐私/开发资源已排除"

echo "=== 5. DMG 安装并闭环测试 ==="
DMG=$(ls dist/KaypalAI内容创作平台-*.dmg | head -1)
echo "DMG: $DMG"

# 挂载
MOUNT_POINT=$(mktemp -d)
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_POINT" "$DMG"

# 复制到 /Applications
rm -rf "/Applications/KaypalAI内容创作平台.app"
cp -R "$MOUNT_POINT/KaypalAI内容创作平台.app" /Applications/

# 启动
open /Applications/KaypalAI内容创作平台.app
sleep 10

# 验证三服务监听
echo "--- 端口监听 ---"
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E "3010|3011|5409" || {
  echo "❌ 服务未启动"
  exit 1
}

# 验证 frontend 可访问
curl -s -o /dev/null -w "Frontend: HTTP %{http_code}\n" http://127.0.0.1:3010/ || {
  echo "❌ frontend 不可访问"
  exit 1
}

# 清理
APP_PID=$(pgrep -f "KaypalAI内容创作平台.app/Contents/MacOS")
kill $APP_PID 2>/dev/null
sleep 2
hdiutil detach "$MOUNT_POINT"
rm -rf /Applications/KaypalAI内容创作平台.app
rmdir "$MOUNT_POINT"

echo ""
echo "=== ✅ 闭环验证通过 ==="
```

### 7. 第一层预算

| 模块 | 当前 | 目标 | 减重 |
|---|---:|---:|---:|
| macOS .app | 1.0GB | **< 500MB** | -500MB |
| DMG | 600MB | **< 350MB** | -250MB |
| frontend | 387MB | < 50MB | -337MB |
| auto-upload | 343MB | < 10MB | -333MB |
| backend/client | 74MB | < 50MB | -24MB |

---

## 8. v1 错点逐条对照

| # | v1 错点 | v2 修法 |
|---|---|---|
| 1 | 建议改 `next.config.ts` 加 `output: "export"` | **不改**。已经是 export 模式，问题在 dist 阶段 |
| 2 | `auto-upload` 路径写错成 `New project/auto-upload` | 修正为 `/Users/yanghy/auto-upload`（从 `ai-content/desktop` 出发 `../../../../auto-upload`） |
| 3 | filter 用 `**/*.md`、`**/*.png` 泛保留 | 改为最小白名单（具体列文件） |
| 4 | 没区分 `cookiesFile`、`avatars`、`db/database.db` 是用户数据 | 明确**不进商业包**（隐私合规） |
| 5 | `binaryTargets = env("PRISMA_BINARY_TARGETS").split(",")` 不是合法 Prisma 语法 | 用 build script 替换 schema 文本（不用 env split） |
| 6 | `du -sb` macOS 不支持 | 用 Node `fs.statSync` 递归算 |
| 7 | Playwright 80MB 写死 | 改为"实测后再补"，不写死 |

---

## 9. 决策点

### 决策 1：先做最小白名单 + 闭环验证

- [ ] 同意按 v2 修正版执行（白名单 + 闭环 + 守门脚本）
- [ ] 暂缓，等更细化方案

### 决策 2：白名单 vs 黑名单

- [ ] **白名单**（推荐，v2 采用）：明确列出进包文件，安全但维护成本高（新增文件要改 filter）
- [ ] **黑名单**（v1 思路）：默认全进，明确排除某些，安全风险高（漏掉一个就出隐私事故）

### 决策 3：cookiesFile 处置

- [ ] 完全不进包，main.js 首次启动时引导用户登录生成（推荐）
- [ ] 进包但加密（用户体验差 + 仍有合规风险）
- [ ] 提供 init 脚本，build 时清理

### 决策 4：Prisma 跨平台方案

- [ ] build script 替换 schema（推荐，v2 方案 A）
- [ ] electron-builder afterPack 钩子删 engine（v2 方案 B）
- [ ] 不管，先用 windows engine 占 20MB

---

## 10. 第一层执行清单（不含第二、三层）

1. 改 `desktop/package.json` extraResources（最小白名单）
2. 加 `desktop/scripts/prepare-prisma-engines.js`
3. 加 `desktop/scripts/check-release-size.js`（Node 版本）
4. 加 `desktop/scripts/verify-release.sh`（闭环验证）
5. 在 `package.json` scripts 加 `verify:release`
6. build → verify → 修问题 → 再 build
7. 重复 6 直到 `.app < 500MB` 且所有必要资源齐全

**预计工期**: 1-2 天（含踩坑）
**风险**: 漏白名单导致 Python 服务起不来（用闭环验证发现）
**依赖**: 0 外部依赖，全在 desktop/ 内部
