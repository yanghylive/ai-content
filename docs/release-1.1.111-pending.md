# 1.1.111 待发清单 & 发版 SOP

> 生成时间：2026-08-31 19:55（大王决策：1.1.110 已是当前发布版，platform_id 回填修复**攒到下一版**一起发）
> 当前发布版：**1.1.110**（Win/Mac 双通道，远端 feed 已验证）
> 本文目的：下轮发版直接照做，不重复踩本轮踩过的坑。

---

## 一、1.1.111 待发内容（发版时先核对是否还有新增）

| 项 | commit | 说明 | 进包 |
|---|---|---|---|
| `ai_models.platform_id` NULL 回填 | `4a4d1a73` | 旧库（1.1.103- platform_id 可空时代）遗留 NULL 行 → Prisma include 崩 → 模型同步降级。启动时自动回填 Kaypal 模型台 / 删孤儿行。实测通过 | 是（backend） |

**可能追加的候选**（发版前确认）：
- CI 收尾（mac CI Build artifacts 失败点定位、`skip_upload` 开关）——见 `docs/ai-content-CI发布门禁与修复-交接-20260831.md`
- P2：Cloud API 死接口已移除，若有残留观察项

---

## 二、发版 SOP（钉死流程，逐条走）

### 0. 前置（最容易漏，本轮血泪）

- **关闭本机已安装的桌面端 app**（`pkill -f JIUZHANG`）——否则门禁 L1/L3 会假红：
  app 占 8088/3011 → `ai-employee.controller.spec` 连 sidecar ECONNRESET、L3 mac-app-test / core-verify 失败。
  （1.1.109 门禁 14/17 就是这个原因，不是代码问题）
- 确认工作区干净：`git status --short`
- 清理 `desktop/._*`（macOS 元数据）：`find desktop -maxdepth 1 -name "._*" -delete`

### 1. 版本号（6 处，漏一处用户看到旧版本）

```bash
cd /Users/yanghy/Documents/New project/ai-content
# desktop/package.json + package-lock.json 的 "version"
# desktop/packager.json 的 1.x.y
# frontend/src/app/(dashboard)/release-notes/page.tsx 的 currentVersion
# frontend/src/lib/release-notes.ts 的 DESKTOP_APP_VERSION + RELEASE_NOTES 新增条目
# desktop/release-notes.md 顶部新增版本说明
# 校验：cd desktop && node scripts/check-version-sync.js
```

### 2. 构建与打包（Win 先、Mac 后）

```bash
# 前端
cd frontend && NEXT_PUBLIC_API_BASE=/api KAYPAL_SKIP_NEXT_BUILD_LINT=1 KAYPAL_SKIP_NEXT_BUILD_TYPECHECK=1 npm run build
# Win bundle + runtime + playwright + 打包
cd ../backend && BUILD_PLATFORM=win-x64 KAYPAL_KEEP_SQLITE_PRISMA_CLIENT=1 npm run build:bundle:sqlite
cd ../desktop && BUILD_PLATFORM=win-x64 node scripts/prepare-node-runtime.js \
  && BUILD_PLATFORM=win-x64 node scripts/prepare-playwright-browsers.js \
  && npx electron-builder --win nsis --x64 --publish never
# 精确验收（必须带 --installer）
BUILD_PLATFORM=win-x64 node scripts/check-full-installer-assets.js --phase=post --installer="dist/JIUZHANG AI 内容创作平台 Setup <ver>.exe"
node scripts/check-package-contents.js --win-only
```

### 3. 全量门禁（Mac 状态，17 项必须全绿，不 skip-build）

```bash
cd ../backend && BUILD_PLATFORM=mac-arm64 KAYPAL_KEEP_SQLITE_PRISMA_CLIENT=1 npm run build:bundle:sqlite
cd ../desktop && BUILD_PLATFORM=mac-arm64 node scripts/prepare-node-runtime.js \
  && BUILD_PLATFORM=mac-arm64 node scripts/prepare-playwright-browsers.js
cd /Users/yanghy/Documents/New project/ai-content && node scripts/pre-release-full.mjs
# 证据：docs/gate-evidence-<ts>-<commit>/NN-*.log（含 command / exit / duration / commit）
```

### 4. Mac 包 + 推送 + 远端验证

```bash
cd desktop && npx electron-builder --mac zip --config.mac.notarize=false --publish never
BUILD_PLATFORM=mac-arm64 node scripts/check-full-installer-assets.js --phase=post --installer="dist/JIUZHANG AI 内容创作平台-<ver>-arm64-mac.zip"
OSS_UPDATE_PATH=updates/ node scripts/upload-to-oss.js
node scripts/verify-oss-release.js --remote        # 无过滤（Linux 已移除，应为 passed）
node scripts/verify-mac-release.js --remote
```

### 5. Agent-S 包级证据 + commit 哈希绑定

```bash
# 起 bundle 后端后跑（real-execution 必须 5/5）
COMMERCIAL_REAL_EXECUTION=1 SMOKE_USERNAME=18230326666 SMOKE_PASSWORD=sn198456 \
  API_BASE=http://127.0.0.1:3011/api node scripts/commercial-acceptance-gate.mjs
# 生成 docs/acceptance-evidence-<date>/agent-s-binding-<ver>.json（installer sha256 + task id）
# commit message 内嵌 Win/Mac SHA256（包哈希 ↔ commit 绑定，复核硬要求）
```

---

## 三、本轮血泪坑（发版前扫一遍）

1. **门禁前必须关 app**（8088/3011 占用 → L1 ECONNRESET + L3 假红）。
2. **mac 包检查假红**：宿主 `NODE_OPTIONS=--use-system-ca` 泄漏 → 包内 node 启动即失败被判"不可执行"。已修（`assertBundledNodeExecutable` 清 env），若复现看 stderr。
3. **bundle 后端 env 是 `SQLITE_DATABASE_URL`，不是 `DATABASE_URL`**（直接跑 bundle 验证时传错会 P1012 起不来）。
4. **release-guards 是 node:test**，jest 跑不到——门禁 L1 里有专门步骤，别用 `npx jest` 验证它（`node --test scripts/release-guards.test.js`）。
5. **改名/改路径必须 grep 全仓库**（dev.db→seed.db 时漏了 `release-guards.js:621`，导致检查读不存在的路径失败）。
6. **改 `.env` 凭据对运行中进程无效**，必须重启后端；同一用户两个 env key 值不一致是隐性坑（OctopIdentity 用 `OCTOP_ADMIN_*`，RealOctopAdapter 用 `OCTOP_PASSWORD`）。
7. **云电脑 SYSTEM 会话**：`Get-FileHash`/`certutil` 对大文件返回空（改用字节数 + 装后版本号验证）；ps1 含中文路径需 UTF-8 BOM 或改用通配符查找；`run-command` 的 Output 在 `Invocations[0].InvokeDesktops[0].Output`。
8. **长任务必须走计划任务**（下载/安装 > run-command timeout 会被强杀且丢输出）。

---

## 四、验收结论（1.1.110，可复用对照）

- 门禁 17/17、Win/Mac 精确 `--installer` 解包检查通过、release-guards 25/25
- 远端 latest.yml / latest-mac.yml = 1.1.110，verify 双 passed
- 云电脑真机（Win11）：安装 exit=0、应用启动、后端 Nest 运行、前端 3010 200、
  内置 node/chromium/seed.db ✅、dev.db 不存在 ✅
- 待发项修复（platform_id）已实测通过，随 1.1.111 下发后用户首启自动治愈
