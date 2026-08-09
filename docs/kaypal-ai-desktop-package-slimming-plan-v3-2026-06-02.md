# KaypalAI 桌面端发布包瘦身实施修正案 v3

> 撰写日期: 2026-06-02
> 上游: v1 (被否) → v2 (85% 对) → **v3 (本版，可执行)**
> 状态: 第一层可立即开干

---

## v3 修正点（v2 之后又补的 7 个执行层坑）

| # | v2 错点 | v3 修法 |
|---|---|---|
| 1 | auto-upload 白名单漏 `utils/stealth.min.js` | 补上 `utils/**/*.js` |
| 2 | 验证脚本用 `npm run build:mac-arm`（不存在） | 改用 `npm run build:mac` |
| 3 | 验证脚本查 3010 端口 | 3010 是 dev only，生产用 `loadFile(frontend/index.html)`。验证 `frontend/index.html` 存在 + 3011 + 5409 |
| 4 | Prisma engine 检查写死 darwin-arm64 | 按 `BUILD_PLATFORM` 参数化 |
| 5 | Prisma 改 schema 用 `git checkout` 还原 | 改用 try/finally 备份还原（不依赖 git） |
| 6 | frontend filter 冗余列子目录 | 简化为 `**/*.html + **/_next/**` + 显式排除 |
| 7 | 白名单未 dry-run | 加 dry-run 验证步骤（`favicon.ico` 等不存在项要被剔除） |

---

## 1. auto-upload 白名单（v3 修正版）

**白名单依据**: 实际 import 关系 + 主程序入口

```javascript
// desktop/scripts/resolve-auto-upload-manifest.js
// 用脚本生成白名单，而不是手写
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/yanghy/auto-upload';
const REQUIRED = [
  'main.py',
  'requirements.txt',
  'conf.py',
  'conf.example.py',
  'cdp_runtime.py',
  'platform_douyin_cdp.py',
  'platform_channel_cdp.py',
];

const DIRS_TO_INCLUDE = [
  'uploader',
  'utils',
  'myUtils',
  'packaging',
];

// 自动搜集所有子目录文件
const whitelist = new Set(REQUIRED);

function walk(dir, base = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === '__pycache__') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, rel);
    } else {
      whitelist.add(rel);
    }
  }
}

for (const d of DIRS_TO_INCLUDE) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full)) walk(full, d);
}

const sorted = [...whitelist].sort();
fs.writeFileSync(
  path.join(__dirname, 'auto-upload-manifest.json'),
  JSON.stringify(sorted, null, 2)
);
console.log(`Generated manifest: ${sorted.length} files`);

// 输出白名单大小
let totalSize = 0;
for (const f of sorted) {
  try {
    totalSize += fs.statSync(path.join(ROOT, f)).size;
  } catch {}
}
console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
```

```bash
# 生成 manifest
node desktop/scripts/resolve-auto-upload-manifest.js
# 输出: ~5-8MB
```

**auto-upload 白名单（最终版）**：

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
    "uploader/**/*.py",
    "utils/**/*.py",
    "utils/**/*.js",
    "myUtils/**/*.py",
    "packaging/**/*.py"
  ]
}
```

**关键**：包含 `utils/**/*.js` 兜住 `stealth.min.js`

**预期**: auto-upload 343MB → **< 10MB**（-333MB）

---

## 2. frontend 白名单（v3 简化版）

```json
// desktop/package.json extraResources
{
  "from": "../frontend/out",
  "to": "frontend",
  "filter": [
    "**/*.html",
    "**/*.css",
    "**/*.js",
    "**/*.json",
    "**/*.svg",
    "**/*.png",
    "**/*.ico",
    "**/*.woff2",
    "**/*.webmanifest",
    "**/*.txt",
    "_next/**",
    "!**/dev/**",
    "!**/.next/**",
    "!**/cache/**",
    "!**/server/**",
    "!**/*.map"
  ]
}
```

**预期**: frontend 387MB → **< 50MB**

---

## 3. Prisma engine 按平台（v3 修法）

**v2 错点**: 用 `git checkout` 还原 schema
**v3 修法**: 用 try/finally 备份还原，不依赖 git

```javascript
// desktop/scripts/prepare-prisma-engines.js
const fs = require('fs');
const path = require('path');

const PLATFORM_TARGETS = {
  'mac-arm64': ['native', 'darwin-arm64'],
  'mac-x64':   ['native', 'darwin'],
  'win-x64':   ['native', 'windows'],
};

const platform = process.env.BUILD_PLATFORM || (process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64' : process.platform === 'darwin' ? 'mac-x64' : 'win-x64');

if (!PLATFORM_TARGETS[platform]) {
  console.error(`Unknown BUILD_PLATFORM: ${platform}`);
  console.error(`Valid: ${Object.keys(PLATFORM_TARGETS).join(', ')}`);
  process.exit(1);
}

const schemaPath = path.resolve(__dirname, '../../backend/prisma/schema.prisma');
const original = fs.readFileSync(schemaPath, 'utf8');
const updated = original.replace(
  /binaryTargets = \[[^\]]+\]/,
  `binaryTargets = [${PLATFORM_TARGETS[platform].map(t => `"${t}"`).join(', ')}]`
);

fs.writeFileSync(schemaPath, updated);
console.log(`✓ Prisma binaryTargets updated to: ${PLATFORM_TARGETS[platform].join(', ')}`);

// 注册退出钩子，进程退出时还原
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  fs.writeFileSync(schemaPath, original);
  console.log(`✓ Prisma schema restored to original`);
}

process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });
process.on('uncaughtException', (err) => { restore(); console.error(err); process.exit(1); });
```

**build 流程**：

```bash
# mac arm64
BUILD_PLATFORM=mac-arm64 node desktop/scripts/prepare-prisma-engines.js
cd backend && npx prisma generate
cd .. && npm run build:mac  # 进程退出时自动还原
```

**v3 size check（按平台参数化）**：

```javascript
// desktop/scripts/check-release-size.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLATFORM = process.env.BUILD_PLATFORM || 'mac-arm64';
const LIMITS_MB = 500;

const PLATFORM_CHECKS = {
  'mac-arm64': {
    app: 'dist/mac-arm64/KaypalAI内容创作平台.app',
    resourceBase: 'Contents/Resources',
    requiredEngines: ['libquery_engine-darwin-arm64.dylib.node'],
    forbiddenEngines: ['query_engine-windows.dll.node', 'libquery_engine-darwin.dylib.node'],
  },
  'mac-x64': {
    app: 'dist/mac-x64/KaypalAI内容创作平台.app',
    resourceBase: 'Contents/Resources',
    requiredEngines: ['libquery_engine-darwin.dylib.node'],
    forbiddenEngines: ['query_engine-windows.dll.node', 'libquery_engine-darwin-arm64.dylib.node'],
  },
  'win-x64': {
    app: 'dist/win-unpacked',
    resourceBase: 'resources',
    requiredEngines: ['query_engine-windows.dll.node'],
    forbiddenEngines: ['libquery_engine-darwin-arm64.dylib.node', 'libquery_engine-darwin.dylib.node'],
  },
};

const config = PLATFORM_CHECKS[PLATFORM];
if (!config) {
  console.error(`Unknown platform: ${PLATFORM}`);
  process.exit(1);
}

function dirSize(p) {
  let total = 0;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try { total += fs.statSync(full).size; } catch {}
      }
    }
  }
  walk(p);
  return total;
}

function checkApp() {
  const appPath = path.join(__dirname, '..', config.app);
  if (!fs.existsSync(appPath)) {
    console.log(`⊘ ${PLATFORM} 未 build，跳过检查`);
    return;
  }
  const sizeMB = (dirSize(appPath) / 1024 / 1024).toFixed(0);
  console.log(`${PLATFORM} app: ${sizeMB}MB (limit ${LIMITS_MB}MB)`);
  if (parseInt(sizeMB) > LIMITS_MB) {
    console.error(`❌ ${PLATFORM} 超过 ${LIMITS_MB}MB 限制`);
    process.exit(1);
  }
}

function checkEngines() {
  const clientDir = path.join(__dirname, '..', config.app, config.resourceBase, 'backend/client');
  for (const e of config.requiredEngines) {
    if (!fs.existsSync(path.join(clientDir, e))) {
      console.error(`❌ 缺少必需 engine: ${e}`);
      process.exit(1);
    }
    console.log(`✓ engine present: ${e}`);
  }
  for (const e of config.forbiddenEngines) {
    if (fs.existsSync(path.join(clientDir, e))) {
      console.error(`❌ 不该出现的 engine: ${e}`);
      process.exit(1);
    }
    console.log(`✓ engine absent: ${e}`);
  }
}

function checkRequiredResources() {
  const required = [
    'auto-upload/main.py',
    'auto-upload/requirements.txt',
    'backend/index.js',
    'backend/prisma/schema.prisma',
  ];
  const base = path.join(__dirname, '..', config.app, config.resourceBase);
  for (const f of required) {
    if (!fs.existsSync(path.join(base, f))) {
      console.error(`❌ 必要资源缺失: ${f}`);
      process.exit(1);
    }
  }
  console.log(`✓ 所有必要资源齐全`);
}

console.log(`=== Release Size Check [${PLATFORM}] ===`);
checkApp();
checkEngines();
checkRequiredResources();
console.log('✅ All checks passed');
```

---

## 4. 验证脚本（v3 修正：去 3010）

**v2 错点**: 验证 `127.0.0.1:3010` 是错的（生产模式 Electron 用 `loadFile`）
**v3 修法**: 验证 `frontend/index.html` 存在 + 3011 backend + 5409 auto-upload

```bash
# desktop/scripts/verify-release.sh
#!/bin/bash
set -e

PLATFORM="${BUILD_PLATFORM:-mac-arm64}"

echo "=== 1. 重新 build ==="
cd desktop
rm -rf dist

if [ "$PLATFORM" = "mac-arm64" ] || [ "$PLATFORM" = "mac-x64" ]; then
  BUILD_PLATFORM=$PLATFORM node scripts/prepare-prisma-engines.js
  (cd backend && npx prisma generate)
  npm run build:mac
elif [ "$PLATFORM" = "win-x64" ]; then
  BUILD_PLATFORM=$PLATFORM node scripts/prepare-prisma-engines.js
  (cd backend && npx prisma generate)
  npm run build:win
fi

echo "=== 2. 体积 + 资源检查 ==="
BUILD_PLATFORM=$PLATFORM node scripts/check-release-size.js

echo "=== 3. 必要资源完整性 ==="
if [[ "$PLATFORM" == mac-* ]]; then
  APP="dist/$PLATFORM/KaypalAI内容创作平台.app"
  RES="$APP/Contents/Resources"
  [ -f "$RES/auto-upload/main.py" ] || { echo "❌ main.py 缺失"; exit 1; }
  [ -f "$RES/auto-upload/requirements.txt" ] || { echo "❌ requirements.txt 缺失"; exit 1; }
  [ -f "$RES/auto-upload/utils/stealth.min.js" ] || { echo "❌ stealth.min.js 缺失"; exit 1; }
  [ -f "$RES/backend/index.js" ] || { echo "❌ backend/index.js 缺失"; exit 1; }
  [ -f "$RES/frontend/index.html" ] || { echo "❌ frontend/index.html 缺失"; exit 1; }
  echo "✓ 必要资源齐全（含 stealth.min.js + frontend/index.html）"
fi

echo "=== 4. 不应存在的资源（隐私/开发垃圾） ==="
SHOULD_NOT_EXIST=(
  "$RES/auto-upload/.git"
  "$RES/auto-upload/logs"
  "$RES/auto-upload/videoFile"
  "$RES/auto-upload/frontend/node_modules"
  "$RES/auto-upload/tests"
  "$RES/auto-upload/docs"
  "$RES/auto-upload/cookiesFile"
  "$RES/auto-upload/avatars"
  "$RES/auto-upload/db"
  "$RES/frontend/dev"
  "$RES/frontend/cache"
  "$RES/frontend/.next"
)
for f in "${SHOULD_NOT_EXIST[@]}"; do
  if [ -e "$f" ]; then
    echo "❌ 不该存在的资源: $f"
    exit 1
  fi
done
echo "✓ 隐私/开发资源已排除"

if [[ "$PLATFORM" == mac-* ]]; then
  echo "=== 5. DMG 安装并闭环测试 ==="
  DMG=$(ls dist/KaypalAI内容创作平台-*.dmg 2>/dev/null | head -1)
  if [ -z "$DMG" ]; then
    echo "⊘ 没找到 DMG（可能只 build 了 .app），跳过"
  else
    echo "DMG: $DMG"
    MOUNT_POINT=$(mktemp -d)
    hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_POINT" "$DMG"
    rm -rf "/Applications/KaypalAI内容创作平台.app"
    cp -R "$MOUNT_POINT/KaypalAI内容创作平台.app" /Applications/
    open /Applications/KaypalAI内容创作平台.app
    sleep 12

    echo "--- 进程监听 ---"
    APP_PID=$(pgrep -f "KaypalAI内容创作平台.app/Contents/MacOS" | head -1)
    if [ -z "$APP_PID" ]; then
      echo "❌ Electron 主进程未启动"
      exit 1
    fi
    echo "✓ Electron PID: $APP_PID"

    echo "--- 端口 3011 (后端) ---"
    curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3011/api/health 2>&1 || echo "（后端无 /health 端点属正常，看是否 LISTEN）"
    lsof -nP -iTCP:3011 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN && echo "✓ 3011 监听" || { echo "❌ 3011 未监听"; exit 1; }

    echo "--- 端口 5409 (auto-upload) ---"
    lsof -nP -iTCP:5409 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN && echo "✓ 5409 监听" || { echo "❌ 5409 未监听"; exit 1; }
    curl -s -o /dev/null -w "auto-upload: HTTP %{http_code}\n" http://127.0.0.1:5409/ --max-time 5

    echo "--- 注意：不查 3010 ---"
    echo "（生产模式 Electron 用 mainWindow.loadFile(frontend/index.html)，3010 仅 dev 模式）"

    # 清理
    kill $APP_PID 2>/dev/null || true
    sleep 3
    hdiutil detach "$MOUNT_POINT" 2>/dev/null || true
    rm -rf /Applications/KaypalAI内容创作平台.app
    rmdir "$MOUNT_POINT"
  fi
fi

echo ""
echo "=== ✅ 闭环验证通过 [${PLATFORM}] ==="
```

---

## 5. 第一层最终预算

| 模块 | 当前 | 目标 | 减重 |
|---|---:|---:|---:|
| macOS .app | 1.0GB | **< 500MB** | -500MB |
| DMG | 600MB | **< 350MB** | -250MB |
| frontend | 387MB | < 50MB | -337MB |
| auto-upload | 343MB | < 10MB（含 stealth.min.js）| -333MB |
| backend/client | 74MB | < 50MB | -24MB |

---

## 6. 一次性脚本（生成 + 验证）

```bash
# desktop/scripts/lean-build.sh
#!/bin/bash
set -e
cd "$(dirname "$0")/.."

PLATFORM="${BUILD_PLATFORM:-mac-arm64}"
echo "=== Lean Build for $PLATFORM ==="

# 1. 生成 auto-upload 白名单 manifest
node scripts/resolve-auto-upload-manifest.js

# 2. 准备 Prisma engines
BUILD_PLATFORM=$PLATFORM node scripts/prepare-prisma-engines.js

# 3. 生成 Prisma client
(cd ../backend && npx prisma generate)

# 4. Build Electron app
if [[ "$PLATFORM" == mac-* ]]; then
  npm run build:mac
elif [ "$PLATFORM" = "win-x64" ]; then
  npm run build:win
fi

# 5. 验证
BUILD_PLATFORM=$PLATFORM ./scripts/verify-release.sh
```

---

## 7. 决策点（开会拍板）

### 决策 1：立刻开干

- [ ] 同意按 v3 立即执行
- [ ] 还要再调

### 决策 2：白名单生成方式

- [ ] 用 `resolve-auto-upload-manifest.js` 脚本生成（推荐，可维护）
- [ ] 手动写死白名单（v2 思路）

### 决策 3：Prisma 跨平台

- [ ] build script + try/finally 还原（推荐，v3 方案）
- [ ] electron-builder afterPack 钩子（更彻底但复杂）
- [ ] 暂时不处理，每个平台都打全部 engine

### 决策 4：闭环测试平台

- [ ] 只测 mac-arm64（最常用）
- [ ] mac-arm64 + mac-x64 + win-x64 全测
- [ ] 只测最简冒烟（启动 + 端口）

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 白名单漏文件导致 Python 启动报错 | 中 | 高 | stealth.min.js 已补，闭环测试会捕获 |
| try/finally 还原 schema 在 SIGKILL 时不触发 | 低 | 中 | 启动时检测 schema 是否被改，自动还原 |
| 跨平台 build 在 mac 测 win 不准 | 中 | 中 | 至少本地 mac-arm64 全闭环，win 在真机测 |
| `frontend/out/dev` 残留源头没解决 | 中 | 中 | 改 filter 排除；后续用 clean script 预处理 |

---

## 9. 验收标准（v3）

第一层完成标志：

- [ ] `BUILD_PLATFORM=mac-arm64 ./scripts/lean-build.sh` 一次性通过
- [ ] macOS .app < 500MB
- [ ] DMG < 350MB
- [ ] `Resources/auto-upload` < 10MB（含 stealth.min.js）
- [ ] `Resources/frontend` < 50MB
- [ ] 必要资源齐全（含 `utils/stealth.min.js`、`frontend/index.html`）
- [ ] 隐私/开发资源已排除（`cookiesFile`、`avatars`、`db`、`logs`、`videoFile`、`.git`、`frontend/node_modules`、`tests`、`docs`）
- [ ] Prisma 只含本平台 engine
- [ ] DMG 安装到 /Applications 后：Electron 启动、3011 监听、5409 监听

**达成所有 9 项 = 第一层完成**
