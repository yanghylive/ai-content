# KaypalAI 桌面端发布包瘦身实施案

> 撰写日期: 2026-06-02
> 状态: 待执行
> 上游文档: kaypal-ai-desktop-user-experience-design-2026-06-02.md

---

## 核心结论

**根因不是 Python、不是 Electron，是「发布资源筛选失控」**。

实测当前 macOS `.app` 1.0G / DMG 600MB 主要由 3 类问题组成：

1. **开发态资源** 700MB+（frontend/dev/cache/turbopack 321MB + auto-upload/frontend/node_modules 145MB + auto-upload/.git 15MB）
2. **业务垃圾** 158MB（auto-upload/logs 96MB + auto-upload/videoFile 62MB）
3. **跨平台混打** 20MB（Prisma Windows engine 进 mac 包）

按优先级分三步走，每步都验证：

---

## 第一层：立刻瘦身（1-2 天，目标 .app 1.0G → 500MB / DMG 600MB → 300MB）

### 改动 1：frontend 排除 dev/cache

**问题**: `frontend/dev/cache/turbopack` 321MB 在包里，这是 Next.js dev 模式缓存（**`output: "export"` 时不应有 dev 目录**）

**根因**: frontend 构建后还有 dev 残留，可能是 dev server 跑过留下了

**修法**: 改 `frontend/next.config.ts` + desktop extraResources

```typescript
// frontend/next.config.ts
const nextConfig = {
  output: 'export',
  distDir: 'out',
  // 确保 build 完成后清理 dev 缓存
  experimental: {
    workerThreads: false,
  },
};
```

```json
// desktop/package.json extraResources
{
  "from": "../frontend/out",
  "to": "frontend",
  "filter": [
    "**/*",
    "!**/dev/**",        // 排除 dev 模式产物
    "!**/.next/**",      // 排除 .next
    "!**/cache/**",      // 排除 turbopack cache
    "!**/*.map"          // 排除 source map
  ]
}
```

**预期**: frontend 387MB → 100MB（**-287MB**）

### 改动 2：auto-upload 排除不需要的目录

**问题**: `auto-upload/frontend/node_modules` 145MB、`logs` 96MB、`videoFile` 62MB、`.git` 15MB 全在包里

**根因**: extraResources 用 `"filter": ["**/*", "!.venv", "!__pycache__", "!*.pyc", "!browser-profiles"]` 但漏了 node_modules / logs / videoFile / .git / tests / docs

**修法**: 改 desktop/package.json

```json
{
  "from": "../../../../auto-upload",
  "to": "auto-upload",
  "filter": [
    "**/*.py",
    "**/*.txt",
    "**/*.md",
    "**/conf*.py",
    "**/cdp_runtime.py",
    "**/platform_*.py",
    "**/myUtils/**",
    "**/packaging/**",
    "**/db/**",
    "**/cookiesFile/**",
    "**/avatars/**",
    "**/*.png",
    "**/*.ico",
    "**/main.py",
    "**/requirements.txt",
    "!.venv/**",
    "!__pycache__/**",
    "!*.pyc",
    "!browser-profiles/**",
    "!frontend/**",        // 关键：auto-upload 自带的 frontend 是开发用
    "!logs/**",            // 关键：日志不进包
    "!videoFile/**",       // 关键：业务素材不进包
    "!.git/**",            // 关键：git 永远不进包
    "!docs/**",
    "!tests/**",
    "!.env",
    "!.env.example",
    "!.DS_Store"
  ]
}
```

**预期**: auto-upload 343MB → 50MB（**-293MB**）

### 改动 3：Prisma engine 按平台

**问题**: macOS 包里 `query_engine-windows.dll.node` 20MB，毫无用处

**根因**: backend/prisma/schema.prisma `binaryTargets = ["native", "darwin", "darwin-arm64", "windows"]` 一次性生成所有平台

**修法**: 分平台生成 + electron-builder 阶段筛选

**方案 A（推荐）**: build 阶段用环境变量控制

```bash
# mac arm64 build
PRISMA_BINARY_TARGETS=native,darwin-arm64 npm run build:mac-arm

# win build
PRISMA_BINARY_TARGETS=native,windows npm run build:win
```

```prisma
// backend/prisma/schema.prisma
binaryTargets = env("PRISMA_BINARY_TARGETS").split(",")
```

```json
// desktop/package.json extraResources 兜底
{
  "from": "../backend/node_modules/.prisma/client",
  "to": "backend/client",
  "filter": [
    "*.node",
    "*.wasm",
    "*.js"
  ]
}
```

**预期**: backend/client 74MB → 50MB（**-24MB**）

### 改动 4：加 check-release-size 守门

**新文件**: `desktop/scripts/check-release-size.js`

```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LIMITS = {
  mac: 500 * 1024 * 1024,  // 500MB
  win: 500 * 1024 * 1024,  // 500MB
  dmg: 350 * 1024 * 1024,  // 350MB (压缩后)
  exe: 350 * 1024 * 1024,  // 350MB
};

const distDir = path.join(__dirname, '..', 'dist');
let totalCleaned = 0;

function checkApp(appName) {
  const appPath = path.join(distDir, 'mac-arm64', appName);
  if (!fs.existsSync(appPath)) return;
  const size = execSync(`du -sb "${appPath}" | awk '{print $1}'`).toString().trim();
  const sizeMB = (parseInt(size) / 1024 / 1024).toFixed(0);
  console.log(`${appName}: ${sizeMB}MB`);
  if (parseInt(size) > LIMITS.mac) {
    console.error(`❌ ${appName} 超过 500MB 限制 (${sizeMB}MB)`);
    process.exit(1);
  }
  totalCleaned = Math.max(totalCleaned, parseInt(size));
}

checkApp('KaypalAI内容创作平台.app');

// 检查关键资源是否被误删
const required = [
  'auto-upload/main.py',
  'auto-upload/requirements.txt',
  'backend/index.js',
  'backend/prisma/schema.prisma',
  'backend/prisma/dev.db',
  'backend/client/libquery_engine-darwin-arm64.dylib.node',
];

const appPath = path.join(distDir, 'mac-arm64', 'KaypalAI内容创作平台.app');
for (const f of required) {
  if (!fs.existsSync(path.join(appPath, 'Contents/Resources', f))) {
    console.error(`❌ 必要资源缺失: ${f}`);
    process.exit(1);
  }
}

console.log('✅ Release size check passed');
```

```json
// desktop/package.json scripts
"build:check-size": "node scripts/check-release-size.js",
"build:full": "npm run check:commercial-assets && electron-builder && npm run build:check-size"
```

### 第一层验证

```bash
# 1. 重新 build
cd desktop
rm -rf dist
npm run build:mac-arm

# 2. 验证体积
du -sh dist/mac-arm64/KaypalAI内容创作平台.app    # 应 < 500MB
du -sh dist/KaypalAI内容创作平台-*.dmg             # 应 < 350MB

# 3. 检查资源完整性
ls -la dist/mac-arm64/KaypalAI内容创作平台.app/Contents/Resources/auto-upload/main.py
ls -la dist/mac-arm64/KaypalAI内容创作平台.app/Contents/Resources/backend/index.js

# 4. 闭环测试
hdiutil attach dist/KaypalAI内容创作平台-1.0.0-arm64.dmg
cp -R /Volumes/KaypalAI*/KaypalAI内容创作平台.app /Applications/
open /Applications/KaypalAI内容创作平台.app
# 验证三端口监听：3010, 3011, 5409

# 5. 清理
hdiutil detach /Volumes/KaypalAI*
rm -rf /Applications/KaypalAI内容创作平台.app
```

**第一层完成标志**: .app < 500MB 且闭环测试通过

---

## 第二层：拆主包 + 组件包（2-3 周，目标主包 150-250MB）

### 架构调整

```
主包 KaypalAI内容创作平台 (~200MB):
├── Electron shell (~150MB)
├── Resources/frontend/ (~50MB, 静态导出)
├── Resources/backend/ (~15MB, 核心 API)
└── Resources/updater/ (~5MB, 组件下载器)

组件包 1 auto-upload-runner (~300MB) [首次使用自动化时下载]:
├── main.py
├── requirements.txt
├── venv/ (预构建, ~200MB)
├── Playwright Chromium (~80MB)
└── browser-profiles/ (~20MB 模板)

组件包 2 browser-data (~50MB) [按账号下载]:
├── profile-{platform}-{accountId}/
├── cookies/
└── assets/
```

### 实施步骤

#### Step 1: 改 main.js 启动逻辑

```javascript
// desktop/main.js
function startPythonService() {
  const autoUploadPath = getResourcePath('auto-upload');
  const serviceEntry = path.join(autoUploadPath, 'main.py');
  
  if (!fs.existsSync(serviceEntry)) {
    // 组件缺失，触发下载流程
    const installed = await ensureAutoUploadComponent(autoUploadPath);
    if (!installed) {
      dialog.showErrorBox('组件未安装', 'auto-upload 组件未安装，请检查网络后重试。');
      return;
    }
  }
  
  // 启动 Python
  const venvPath = ensurePythonVenv(autoUploadPath);
  // ... 现有逻辑
}

async function ensureAutoUploadComponent(targetPath) {
  // 从 OSS / CDN 下载组件包
  const componentUrl = 'https://enterprise-test.kaypal.cn/components/auto-upload-runner-1.0.0.tar.gz';
  // 显示下载进度
  // 解压到 targetPath
  // 返回成功/失败
}
```

#### Step 2: 改 package.json 拆出 extraResources

```json
{
  "extraResources": [
    {
      "from": "../frontend/out",
      "to": "frontend",
      "filter": ["**/*", "!**/dev/**", "!**/.next/**", "!**/cache/**", "!**/*.map"]
    },
    {
      "from": "../backend/dist-bundle",
      "to": "backend",
      "filter": ["index.js", "schema.prisma"]
    },
    {
      "from": "../backend/node_modules/.prisma/client",
      "to": "backend/client",
      "filter": ["*.node", "*.wasm", "*.js"]
    },
    {
      "from": "backend.env",
      "to": "backend/.env"
    }
    // 注意：不再包含 auto-upload，由组件下载器补
  ]
}
```

#### Step 3: 部署组件包到 OSS

```bash
# 打包 auto-upload 组件
cd /Users/yanghy/auto-upload
tar -czf /tmp/auto-upload-runner-1.0.0.tar.gz \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='.git' \
  --exclude='logs' \
  --exclude='videoFile' \
  --exclude='browser-profiles' \
  --exclude='frontend/node_modules' \
  --exclude='tests' \
  --exclude='docs' \
  .

# 上传到 OSS
ossutil cp /tmp/auto-upload-runner-1.0.0.tar.gz \
  oss://kaypal/components/auto-upload-runner-1.0.0.tar.gz
```

### 第二层验证

- 主包 .app < 250MB
- 首次启动检测到 auto-upload 缺失 → 触发下载
- 下载完成后自动重启 Python 服务
- 三端口 3010/3011/5409 正常

---

## 第三层：Python 依赖方案双 PoC（2-3 周，目标客户电脑 0 Python 依赖）

### PoC A：内置 Python runtime + 预构建 venv

**原理**: 打包阶段就用目标平台 Python build venv，连同 Python 解释器一起放进组件包

**步骤**:
1. 在 mac/win build 机器上装官方 Python 3.12+
2. `python -m venv venv`
3. `venv/bin/pip install -r requirements.txt`
4. 把 venv 整个打包进组件包

**优点**:
- 跨平台稳定（用官方 Python）
- 客户电脑 0 依赖
- 调试相对友好（标准 venv 结构）

**缺点**:
- venv 占空间 (~200MB)
- 跨平台要分别 build

### PoC B：PyInstaller onedir

**原理**: 用 PyInstaller 把 Python 服务打成单目录（不是 onefile）

**步骤**:
1. `pyinstaller --onedir --windowed main.py`
2. 把 dist/main/ 整个打包

**优点**:
- 不需要 venv
- 比 onefile 启动快
- 不需要系统 Python

**缺点**:
- PyInstaller 与某些库兼容性需要调试
- 排障不如 venv 直接

### 决策依据

跑两个 PoC，对比：
- macOS arm64 / x64 各一份组件包
- Windows x64 一份组件包
- 客户机器（无 Python）冷启动时间
- 组件包体积

**哪个稳用哪个**。

### 第三层验证

- 客户电脑完全无 Python：冷启动 < 30s，三服务正常
- 离线环境：启动正常（依赖全在组件包内）
- 跨平台：mac arm / mac x64 / win x64 三端组件包通用

---

## 时间线

```
第 1-2 天  第一层：清垃圾
            ↓
            验证 .app < 500MB
            ↓
第 3-7 天  准备第二层
            ↓
第 2-3 周  第二层：拆主包+组件包
            ↓
            验证主包 < 250MB
            ↓
第 4-6 周  第三层：Python 方案双 PoC
            ↓
            选一个上线
            ↓
第 7 周    收尾 + 文档 + 升级指引
```

---

## 决策点（开会拍板）

### 决策 1：第一层立刻开干

- [ ] 同意立刻开干第一层
- [ ] 暂缓，等第二层方案细化

### 决策 2：第二层工期

- [ ] 接受 2-3 周工期
- [ ] 拆分更细，2 周内出第一版

### 决策 3：组件包分发方式

- [ ] 走 OSS 公共读 + 签名 URL（成本低，速度快）
- [ ] 走自建 CDN（贵但快）
- [ ] 走客户机器自建（最便宜但首次启动慢）

### 决策 4：第三层方案

- [ ] 只做 PoC A（内置 Python venv）
- [ ] 只做 PoC B（PyInstaller onedir）
- [ ] 双 PoC 对比（推荐）
- [ ] 不做第三层，等 Node.js 重写

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| filter 写错把必要资源也排除了 | 中 | 高 | 闭环测试 + check-release-size 守门 |
| 跨平台 filter 不一致 | 中 | 中 | mac/win 分别测 |
| 组件包下载失败 | 中 | 中 | 友好提示 + 重试机制 |
| PyInstaller 与 playwright 兼容 | 高 | 中 | 优先 PoC A（兼容性更稳） |
| 客户机器磁盘空间不足 | 低 | 中 | 安装前检查空间 |

---

## 验收标准

### 第一层

- [ ] .app < 500MB
- [ ] DMG < 350MB
- [ ] 三端口 3010/3011/5409 监听正常
- [ ] 主要功能闭环测试通过
- [ ] check-release-size 脚本集成到 build 流程

### 第二层

- [ ] 主包 .app < 250MB
- [ ] 组件包 < 350MB
- [ ] 首次启动无 auto-upload → 触发下载
- [ ] 下载完成自动启动 Python 服务
- [ ] 组件包单独可更新

### 第三层

- [ ] 客户电脑无 Python：冷启动 < 30s
- [ ] 离线环境：依赖全在组件包
- [ ] mac arm / mac x64 / win x64 三端通用
