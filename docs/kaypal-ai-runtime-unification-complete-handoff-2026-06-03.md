# Kaypal AI Runtime 统一 + Windows 商业包完整交接单

覆盖时间：截至 2026-06-03 本地工作批次
工作区：`/Users/yanghy/Documents/New project/ai-content`
当前结论：还不能交给商业用户。代码主线已经推进到可打包阶段，但 Windows 包和本地启动验收还没闭环。

---

## 1. 白话结论

这个项目现在分两件事：

1. **Runtime 统一**
   - 把旧的互动执行逻辑，逐步收口到统一的 `Runtime / ExecutorRouter / EvidenceService`。
   - 目标是后面抖音、视频号、Agent-S、自动化证据都走同一套执行和落库逻辑。

2. **Windows 商业包**
   - 用户双击安装包后，不应该再让用户自己装 Python、Node、Postgres、pip 依赖。
   - 程序要自己检测、安装/准备、启动后端、启动自动化 sidecar、启动 Agent-S。

按用户最新判断：

- 现在还没有真实用户，所以不用做很长的“新旧系统真账号双跑 3 天”作为硬门槛。
- 老系统要先备份好，能回滚即可。
- 但商业用户不能手动装依赖，这个要求仍然是硬门槛。
- Agent-S 是另一件事：代码适配已经接上了一部分，但商业包里自动启动、依赖、真实执行还没验收完。

---

## 2. 当前完成度

整体完成度：**约 60-65%**

拆开看：

| 模块 | 完成度 | 说明 |
|---|---:|---|
| Runtime 统一代码主线 | 70-75% | Router、Evidence、Agent-S adapter、LocalEngine 出口切换已推进，测试通过过一轮 |
| Agent-S 接入代码 | 60-65% | Backend adapter 和 desktop sidecar 启动逻辑已写，但商业安装/真实运行没验完 |
| Windows 打包资源 | 60% | 资源已进入 `desktop/sidecars` 并被 package 配置引用，但包里仍有 Prisma engine 问题 |
| 商业安装验收 | 35-45% | 构建能跑，但干净 Windows VM 安装、首启、依赖无需手装还没闭环 |
| 旧系统下线 | 20-30% | 已明确策略：先备份老系统，再删旧 executor；但还没真正归档/删除 |
| 文档/交接 | 70% | 总结页、P3 runbook、installer checklist 已更新，本交接单补齐接手路径 |

如果按“能给外部商业用户用”算，目前不是 65% 可交付，而是 **还在内测收口阶段**。

---

## 3. 本地/服务器状态

**所有这次改动都在本地。**

- 未确认已提交。
- 未确认已推 GitHub。
- 未部署到服务器。
- 本地打出过 Windows 包：`desktop/dist/KaypalAI内容创作平台 Setup 1.1.10.exe`
- 这个 `1.1.10` 包 **不能宣称可交付**，因为 release-size 检查发现 Windows 包混入了 macOS Prisma engine。

当前包里的 Prisma engine 状态：

```text
desktop/dist/win-unpacked/resources/backend/client/query_engine-windows.dll.node
desktop/dist/win-unpacked/resources/backend/client/libquery_engine-darwin-arm64.dylib.node  # 不该出现在 Windows 包
```

---

## 4. 已完成的主要工作

### 4.1 Runtime / P3 gate

新增：

- `scripts/runtime-p3-dual-run-gate.mjs`
- `scripts/runtime-dual-run-export.mjs`
- `scripts/runtime-dual-run-diff.mjs`
- `scripts/runtime-write-smoke.mjs`

作用：

- 能导出旧任务和 Runtime 记录。
- 能做 diff。
- 不允许用空样本假装验收成功。
- 如果商业验收报告有 `artifacts.createdTaskIds`，gate 会只拿这些 task id 做导出/对比。

已更新：

- `docs/kaypal-ai-runtime-unification-p3-runbook-2026-06-03.md`
- `docs/kaypal-ai-runtime-unification-project-summary-2026-06-03.html`

### 4.2 Backend 修复

已改：

- `backend/src/modules/local-engine/agent-s.service.ts`
  - Agent-S 请求头改为 `x-kaypal-agent-s-token`。
  - token 优先读 `KAYPAL_AGENT_S_TOKEN`，再回退 `KAYPAL_RUNTIME_SHARED_SECRET`。

- `backend/src/modules/materials/materials.service.ts`
  - 修正 `crawlProcessor.process(...)` 入参类型。
  - 这一步修过 `npx tsc --noEmit` 的类型错误。

注意：

- `materials.service.ts` 里还有一些不是本轮新增的已有改动，不要随手 revert。

### 4.3 Agent-S sidecar 资源

已复制到：

- `desktop/sidecars/agent-s-executor`

已纳入包配置：

- `desktop/package.json`
  - `extraResources` 里新增 `agent-s-executor`
  - `auto-upload` 改为本仓 `desktop/sidecars/auto-upload`

已写桌面主进程启动逻辑：

- `desktop/main.js`
  - 新增 Agent-S 进程变量、端口、token。
  - 新增 `startAgentSService()` / `stopAgentSService()`。
  - 后端启动时注入：
    - `AGENT_S_BASE_URL=http://127.0.0.1:17777`
    - `KAYPAL_RUNTIME_SHARED_SECRET=change-me-local-token`
    - `KAYPAL_AGENT_S_TOKEN=change-me-local-token`
  - 托盘菜单新增“重启 Agent-S”。
  - `service:restart` 会一起重启 Agent-S。
  - `service:status` 会返回 `agentS` 状态。

### 4.4 商业包资源检查

已改：

- `desktop/scripts/check-commercial-assets.js`
- `desktop/scripts/check-full-installer-assets.js`
- `desktop/scripts/check-release-size.js`
- `desktop/installer/self-check.ps1`

现在检查范围包括：

- `auto-upload/main.py`
- `auto-upload/requirements.txt`
- `agent-s-executor/main.py`
- `agent-s-executor/requirements.txt`
- 不能打进 `.venv`、日志、cookies、browser profiles、smoke data 等用户/开发垃圾。

### 4.5 Prisma engine 脚本

已部分改：

- `desktop/scripts/prepare-prisma-engines.js`

新增了 `prune` 子命令，用来删掉非目标平台 engine。

还没完成：

- `desktop/scripts/build-win-full.js` 还没挂上 `prune`。
- 所以现在 Windows 包仍然混入 macOS engine。

---

## 5. 已经跑过的验证

这些是本轮工作过程中已经跑过并通过的项：

```bash
node --check desktop/main.js
node --check desktop/scripts/check-commercial-assets.js
node --check desktop/scripts/check-full-installer-assets.js
node --check desktop/scripts/check-release-size.js
npm run check:commercial-assets
npm run check:full-installer-assets:pre
```

Backend：

```bash
cd backend
npx tsc --noEmit
npx jest --runInBand \
  src/modules/runtime/agent-s-adapter.spec.ts \
  src/modules/runtime/executor-router.spec.ts \
  src/modules/runtime/runtime.integration.spec.ts
```

结果：

- TypeScript 通过过一轮。
- Runtime/Agent-S Jest 组通过过一轮：3 suites / 39 tests。

Python：

```bash
python3 -m py_compile desktop/sidecars/agent-s-executor/*.py
```

结果：

- Agent-S sidecar Python 编译通过。
- `auto-upload` 用系统 `python3` 编译时会因为 Python 3.9 不支持部分新语法失败；目标打包 Python 是 3.12，所以不能用 macOS 系统 `python3` 当最终判断。

Windows build：

```bash
cd desktop
npm run build:win
```

结果：

- 曾经成功打出 `desktop/dist/KaypalAI内容创作平台 Setup 1.1.10.exe`。
- 但后续 release-size 检查失败。

失败项：

```bash
cd desktop
BUILD_PLATFORM=win-x64 node scripts/check-release-size.js
```

失败原因：

- Windows 包包含 `query_engine-windows.dll.node`，这是对的。
- 同时还包含 `libquery_engine-darwin-arm64.dylib.node`，这是错的。

---

## 6. 当前明确卡点

### 卡点 1：Windows 包混入 macOS Prisma engine

现象：

- `desktop/dist/win-unpacked/resources/backend/client` 里同时有 Windows 和 macOS engine。

原因：

- `backend/node_modules/.prisma/client` 里残留了 Darwin engine。
- electron-builder 直接复制了 `*.node`，把残留文件也打进去了。

下一步：

1. 在 `desktop/scripts/build-win-full.js` 的 `Generate Prisma Windows client` 之后调用：

```js
run('Prune Prisma engines for Windows package', 'node', ['scripts/prepare-prisma-engines.js', 'prune'], {
  cwd: desktopRoot,
  env: { BUILD_PLATFORM: 'win-x64' },
});
```

2. 打包后再跑：

```bash
cd desktop
BUILD_PLATFORM=win-x64 node scripts/check-release-size.js
```

3. 如果为了恢复本机 macOS dev Prisma client，需要在打包结束后重新跑：

```bash
cd backend
npx prisma generate
```

### 卡点 2：Windows 下两个 Python sidecar 共用 venv

现象：

- `desktop/main.js` 里的 `ensurePythonVenv(autoUploadPath)` 在 Windows 下固定用：

```text
<userData>/runtime/auto-upload-venv
```

问题：

- `auto-upload` requirements 是：

```text
Flask[async]
flask-cors
playwright
xhs
biliup
loguru
qrcode
requests
```

- `agent-s-executor` requirements 是：

```text
fastapi==0.115.5
pydantic==2.10.6
uvicorn==0.32.1
```

如果两个服务共用一个 venv，很容易出现：

- 先启动 auto-upload，venv 里没有 fastapi/uvicorn，Agent-S 起不来。
- 或先启动 Agent-S，auto-upload 依赖不全。

下一步：

- 把 `ensurePythonVenv` 改成支持 runtime name。
- Windows 下分别用：

```text
<userData>/runtime/auto-upload-venv
<userData>/runtime/agent-s-executor-venv
```

建议改法：

```js
function ensurePythonVenv(runtimePath, runtimeName = 'auto-upload') {
  const venvName = runtimeName === 'agent-s-executor'
    ? 'agent-s-executor-venv'
    : 'auto-upload-venv';
  ...
}
```

调用处：

```js
ensurePythonVenv(autoUploadPath, 'auto-upload')
ensurePythonVenv(agentSPath, 'agent-s-executor')
```

### 卡点 3：打包前还没有强制本地启动 smoke

用户问得对：应该先调起来测，再打包。

当前问题：

- `build:win` 会构建前端、后端、Prisma、资源检查、electron-builder。
- 但还没有固定执行“启动 Agent-S sidecar -> healthz -> 创建 session -> 跑一次 mock run”的 smoke。

下一步：

新增：

```text
desktop/scripts/smoke-agent-s-sidecar.js
```

最小验收内容：

1. 找 Python 3.12。
2. 为 Agent-S 建临时 venv 或使用隔离 venv。
3. `pip install -r desktop/sidecars/agent-s-executor/requirements.txt`
4. 启动：

```bash
KAYPAL_AGENT_S_PORT=17779 \
KAYPAL_AGENT_S_TOKEN=change-me-local-token \
KAYPAL_AGENT_S_RUNNER_MODE=mock \
python -u main.py
```

5. 请求：

```http
GET /healthz
POST /sessions
POST /sessions/{session_id}/run
GET /sessions/{session_id}
GET /sessions/{session_id}/artifacts
```

6. 等 session 状态变成 `completed`。
7. 确认至少有 artifact。
8. 退出进程。

然后在 `desktop/scripts/build-win-full.js` 里，打包前增加：

```js
run('Smoke Agent-S sidecar before packaging', 'node', ['scripts/smoke-agent-s-sidecar.js'], {
  cwd: desktopRoot,
});
```

### 卡点 4：商业用户不能手动装依赖

当前安装器已做：

- Python 3.12 检测/安装。
- PostgreSQL 检测/安装。
- 数据库初始化。
- 安装后自检资源。

但仍有风险：

- Python 包依赖目前主要靠 app 首次启动时 `pip install -r requirements.txt`。
- 这对商业用户不够稳，因为会受网络、pip 源、权限、杀软影响。

商业级建议二选一：

1. **最小可接受方案**
   - 安装后自检或首次启动自动预热两个 venv。
   - 用户不用手点命令。
   - 如果失败，给修复安装入口和明确日志。

2. **更稳方案**
   - 打包 wheelhouse。
   - 离线安装：

```bash
pip install --no-index --find-links resources/wheelhouse -r requirements.txt
```

优先建议：先做最小可接受方案，VM 验收通过后再做 wheelhouse。

### 卡点 5：干净 Windows VM 还没验

没有完成：

- 干净 Windows VM 双击安装包。
- 第一屏就是环境检测。
- 缺依赖时一键安装。
- 安装后数据库初始化。
- 首启自动起 backend。
- 首启自动起 auto-upload。
- 首启自动起 Agent-S。
- 用户不打开终端、不手动装 pip 包。

这是商业包最终门槛。

---

## 7. Agent-S 到底干到哪里了

已完成：

- Backend `AgentSService` 能用正确 token header 调 sidecar。
- Runtime adapter / router 测试通过过。
- Agent-S sidecar 源码已放进 `desktop/sidecars/agent-s-executor`。
- Electron 主进程已写自动启动 Agent-S 的逻辑。
- 包资源检查已纳入 Agent-S 文件。

未完成：

- Windows VM 里 Agent-S 没有完成真实启动验收。
- Agent-S 依赖和 auto-upload venv 还没隔离。
- `agent_s_sdk` 真执行依赖没有被证明已随商业包可用。
- 真实 GUI 执行、截图、approval、artifact 回传还没跑通商业验收。

一句话：

**Agent-S 的代码接线干了一半以上；商业可用还没过关。**

---

## 8. 老系统备份 + 下线策略

因为现在没有真实用户，策略可以从“长时间双跑”改成：

```text
备份老系统 -> 新系统最小真实 smoke -> 删除旧互动 executor -> 保留回滚包
```

要备份的范围：

1. 旧 5409 / auto-upload 源仓或目录。
2. 当前 `LocalInteractionExecutorService` 相关旧执行代码。
3. 当前数据库和 migration 状态。
4. 当前可运行安装包和包内资源。

建议动作：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content
mkdir -p .local-logs/legacy-backups

# 先记录当前 git 状态
git status --short > .local-logs/legacy-backups/git-status-before-runtime-cleanup.txt

# 备份旧 auto-upload，如果路径存在
tar -czf .local-logs/legacy-backups/auto-upload-legacy-$(date +%Y%m%d-%H%M%S).tar.gz /Users/yanghy/auto-upload 2>/dev/null || true

# 备份当前关键旧执行文件
tar -czf .local-logs/legacy-backups/local-engine-legacy-$(date +%Y%m%d-%H%M%S).tar.gz \
  backend/src/modules/local-engine/local-interaction-executor.service.ts \
  backend/src/modules/local-engine/local-engine.service.ts \
  backend/src/modules/auto-upload/auto-upload.client.ts
```

如果仓库状态允许，再打 tag：

```bash
git tag legacy/5409-final
```

注意：

- 当前工作区很脏，不能直接乱 commit/tag。
- 如果要严谨，先开 clean worktree 或单独备份 tar，再删旧代码。

---

## 9. 接手后的推荐顺序

### Step 1：先修 venv 隔离

改：

- `desktop/main.js`

目标：

- auto-upload 和 Agent-S 在 Windows 下使用不同 venv。

验证：

```bash
node --check desktop/main.js
```

### Step 2：新增 Agent-S 本地启动 smoke

新增：

- `desktop/scripts/smoke-agent-s-sidecar.js`

验证：

```bash
cd desktop
node scripts/smoke-agent-s-sidecar.js
```

通过标准：

- `/healthz` 返回 ok。
- mock session 能跑到 completed。
- 有 artifacts。
- 进程能正常退出。

### Step 3：修 build-win-full 顺序

改：

- `desktop/scripts/build-win-full.js`

必须加入：

1. 打包前跑 Agent-S smoke。
2. Prisma generate 后跑 engine prune。
3. 打包后跑 post asset check。
4. 最后跑 release-size check，或者至少接手人手动跑。

建议顺序：

```text
Build frontend static export
Build backend bundle
Set Prisma Windows engine target
Generate Prisma Windows client
Prune Prisma engines for Windows package
Smoke Agent-S sidecar before packaging
Check commercial assets
Check full installer assets before packaging
Build Windows installer
Check full installer assets after packaging
Check release size
Restore local Prisma native client
```

### Step 4：重打 Windows 包

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/desktop
npm run build:win
BUILD_PLATFORM=win-x64 node scripts/check-release-size.js
```

通过标准：

- `check-release-size.js` 通过。
- Windows 包里只有 `query_engine-windows.dll.node`，没有 Darwin engine。
- `auto-upload` / `agent-s-executor` 都有 `main.py` 和 `requirements.txt`。
- 没有 `.venv`、cookies、browser profile、logs、smoke data。

### Step 5：干净 Windows VM 验收

必须做：

1. 把最新 `.exe` 放到干净 Windows VM。
2. 双击安装包。
3. 确认第一屏是 KaypalAI 环境检测。
4. 缺依赖时点一键安装。
5. 安装后启动 app。
6. 验证端口：

```powershell
netstat -ano | findstr 3011
netstat -ano | findstr 5409
netstat -ano | findstr 17777
```

7. 验证 Agent-S：

```powershell
curl.exe -H "x-kaypal-agent-s-token: change-me-local-token" http://127.0.0.1:17777/healthz
```

8. 验证用户没有手动运行任何：

```text
pip install
npm install
python -m venv
```

### Step 6：备份老系统并删旧执行路径

入口：

- `backend/src/modules/local-engine/local-interaction-executor.service.ts`
- `backend/src/modules/local-engine/cdp-platform-interaction.service.ts`
- `backend/src/modules/auto-upload/auto-upload.client.ts` 里互动执行相关方法

先备份，再删。

删完后跑：

```bash
cd backend
npx tsc --noEmit
npx jest --runInBand \
  src/modules/runtime/agent-s-adapter.spec.ts \
  src/modules/runtime/executor-router.spec.ts \
  src/modules/runtime/runtime.integration.spec.ts
```

再搜：

```bash
rg -n "127\\.0\\.0\\.1:5409|localhost:5409|LocalInteractionExecutorService|CdpPlatformInteractionService" backend/src frontend/src desktop
```

---

## 10. 剩余时间估算

按单人连续做：

| 工作 | 估时 |
|---|---:|
| venv 隔离 + Agent-S smoke | 0.5-1 天 |
| Prisma prune 接入 build + 重打包 | 0.5 天 |
| release-size / asset checks 全绿 | 0.5 天 |
| 干净 Windows VM 安装 + 首启调试 | 1-2 天 |
| 用户无需手动依赖的预热/修复安装闭环 | 1-2 天 |
| 老系统备份 + 删除旧 executor | 1-2 天 |
| 最小真实账号/真实 GUI smoke | 1-2 天 |
| 文档、验收记录、最终包归档 | 0.5-1 天 |

最短：**5-7 天**

稳妥：**8-10 天**

如果要重新做“连续 3 天真账号双跑”，再额外加 **3 天**。

---

## 11. 不能踩的坑

1. 不能只因为 `npm run build:win` 成功就说可交付。
2. 不能跳过 `BUILD_PLATFORM=win-x64 node scripts/check-release-size.js`。
3. 不能让 Windows 包带 macOS/Linux Prisma engine。
4. 不能让 auto-upload 和 Agent-S 共用同一个 venv。
5. 不能把用户手动 `pip install` 当商业级方案。
6. 不能在当前脏工作区里随手 revert 用户已有改动。
7. 不能把没有 `createdTaskIds` 的商业验收报告当真验收。
8. 不能把 `--only-with-runtime` 的调试导出当正式验收。
9. 不能在没有 VM 验收前把安装包发给外部用户。

---

## 12. 关键文件索引

Runtime：

- `backend/src/modules/runtime/`
- `backend/src/modules/local-engine/agent-s.service.ts`
- `backend/src/modules/local-engine/local-engine.service.ts`
- `scripts/runtime-p3-dual-run-gate.mjs`
- `scripts/runtime-dual-run-export.mjs`
- `scripts/runtime-dual-run-diff.mjs`

Desktop：

- `desktop/main.js`
- `desktop/package.json`
- `desktop/backend.env`
- `desktop/scripts/build-win-full.js`
- `desktop/scripts/prepare-prisma-engines.js`
- `desktop/scripts/check-commercial-assets.js`
- `desktop/scripts/check-full-installer-assets.js`
- `desktop/scripts/check-release-size.js`

Sidecars：

- `desktop/sidecars/auto-upload`
- `desktop/sidecars/agent-s-executor`

Installer：

- `desktop/installer.nsh`
- `desktop/installer/bootstrap-installer.ps1`
- `desktop/installer/self-check.ps1`
- `desktop/installer/deps-manifest.json`
- `docs/windows-installer-preflight-execution-checklist-2026-06-03.md`

Project docs：

- `docs/kaypal-ai-runtime-unification-project-summary-2026-06-03.html`
- `docs/kaypal-ai-runtime-unification-p3-runbook-2026-06-03.md`
- `docs/windows-installer-handoff-2026-06-03.md`

---

## 13. 最终交付标准

这几条全满足，才能说项目这一阶段完成：

1. 老系统已备份，有回滚包。
2. 旧 executor 删除或完全退出主路径。
3. `npx tsc --noEmit` 通过。
4. Runtime / Agent-S 核心 Jest 通过。
5. `npm run check:commercial-assets` 通过。
6. `npm run check:full-installer-assets:pre` 通过。
7. `npm run build:win` 通过。
8. `BUILD_PLATFORM=win-x64 node scripts/check-release-size.js` 通过。
9. 干净 Windows VM 安装通过。
10. 用户不手动安装依赖。
11. app 首启后 backend、auto-upload、Agent-S 都能自动启动。
12. Agent-S mock run 至少能完成一次并产生 artifact。
13. 最小真实账号/真实 GUI smoke 有记录。
14. 最新包归档，文档写清楚版本号、验证时间、验证机器。

---

## 14. 当前一句话给老板/用户

代码已经推进到“能打包但还不能交付”的阶段。现在最要紧的不是继续堆功能，而是把本地启动 smoke、Windows 包 engine 清理、两个 Python venv 隔离、干净 VM 安装验收这四件事做完。做完后再备份旧系统、删旧执行器，才算商业包可交付。
