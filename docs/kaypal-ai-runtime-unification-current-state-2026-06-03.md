# KaypalAI Runtime 统一合并 · 当前完成度 + 剩余工作

> **撰写日期**：2026-06-03（local 时间）
> **基线来源**：handoff 文档 + git 状态 + jest 实测 + 关键文件存在性
> **取代**：之前那份过度乐观的 `project-summary-2026-06-03.html`（建议归档或标注过时）

---

## 一、当前完成度

**整体：约 60-65%**

| 维度 | 完成度 | 评注 |
|---|---:|---|
| Runtime 统一代码主线 | **75%** | 内部代码通；删存量 + 真机未做 |
| Agent-S 接入 | **65%** | sidecar 复制 + main.js 启动 + token 改；真机没验 |
| Windows 打包资源 | **60%** | 资源齐 + 资源检查脚本有；engine 混杂 + 缺 smoke |
| 商业安装验收 | **35-40%** | 装器 60% 齐；5 个硬卡点全未解 |
| 旧系统归档 + 5409 备份 | **20%** | 备份目录未建，5409 进程仍在跑 |
| 文档/交接 | **75%** | 14 份 doc；本份为最新基线 |

**handoff §14 一句话**："代码已经推进到'能打包但还不能交付'的阶段。"

---

## 二、已完成（已验证）

### 2.1 代码侧（14 commits，121 文件 WIP 未提交）

| 类别 | 文件 | 状态 |
|---|---|---|
| **P1 骨架** | `backend/src/modules/runtime/{executor.interface,executor-router}.ts` | ✅ |
| **P2 D4 Agent-S 接入** | `runtime/agent-s-adapter.ts` | ✅ |
| **P2 D1 引擎 client** | `runtime/{local-runtime-engine.client,browser-control/}.ts` | ✅ |
| **P2 D2 平台 services** | `runtime/platforms/{douyin,wechat-channel}/{comment,direct-message}-reply.service.ts`（4 个） | ✅ |
| **P2 D3 证据持久化** | `runtime/evidence/evidence.service.ts` + Prisma `RuntimeExecution` model（schema L578） | ✅ |
| **P2 D4 缓冲** | ExecutorRouter.route() 末尾自动调 EvidenceService | ✅ |
| **P3-D1 切换** | `runtime/orchestrator/{runtime-orchestrator,interaction-task-runtime.mapper}.ts`（**mapper 是团队后加**） | ✅ |
| **P3 gate 脚本** | `scripts/{runtime-p3-dual-run-gate,runtime-dual-run-export,runtime-dual-run-diff,runtime-write-smoke}.mjs` | ✅ |
| **P3 smoke** | `backend/scripts/{local-engine-runtime-smoke,runtime-router-persistence-smoke}.ts` | ✅ |
| **Agent-S 资源** | `desktop/sidecars/agent-s-executor/{main.py,requirements.txt,...}` | ✅ |
| **auto-upload 资源** | `desktop/sidecars/auto-upload/{main.py,requirements.txt,...}` | ✅ |
| **Agent-S token 改** | `agent-s.service.ts` 用 `x-kaypal-agent-s-token` header + `KAYPAL_AGENT_S_TOKEN` env（grep 确认 2 处） | ✅ |
| **Backend 修复** | `materials.service.ts` `crawlProcessor.process(...)` 入参类型修 | ✅ |
| **资源检查脚本** | `desktop/scripts/{check-commercial-assets,check-full-installer-assets,check-release-size,prepare-prisma-engines}.js` | ✅ |

### 2.2 测试侧（97/97 通过，**实测**）

| 套件 | 测数 | 位置 |
|---|---:|---|
| ExecutorRouter | 8 | `executor-router.spec.ts` |
| AgentSAdapter | 14 | `agent-s-adapter.spec.ts` |
| LocalRuntimeEngineClient | 12 | `local-runtime-engine.client.spec.ts` |
| BrowserControlService | 7 | `browser-control.service.spec.ts` |
| DouyinPlatformServices | 14 | `platforms/douyin/platforms-douyin.spec.ts` |
| WechatChannelPlatformServices | 10 | `platforms/wechat-channel/platforms-wechat-channel.spec.ts` |
| EvidenceService | 7 | `evidence/evidence.service.spec.ts` |
| RuntimeIntegration | 12 | `runtime.integration.spec.ts`（含 evidence 链路） |
| RuntimeOrchestrator | 4 | `orchestrator/runtime-orchestrator.service.spec.ts`（**团队后加**） |
| InteractionTaskRuntimeMapper | 若干 | `orchestrator/interaction-task-runtime.mapper.spec.ts`（**团队后加**） |
| RuntimeModuleWiring | 1+ | `runtime-module-wiring.spec.ts`（**团队后加**，forwardRef 验证） |

### 2.3 文档侧（14 份 + 2 ADR）

```
docs/
├── adr/
│   ├── 000-template.md
│   ├── 001-executor-router-capability-interface.md
│   └── 002-copy-first-migration-strategy.md
├── adr/adr-template.md                                 # 我未看
├── auto-update-oss.md
├── commercial-readiness-development-plan-2026-06-02.md  # 713 行，商用 Gate 全景
├── commercial-version-remaining-development-plan-2026-06-01.md
├── customer-interaction-cdp-persistent-browser-plan.md
├── customer-interaction-skill-plan.md
├── handover-2026-06-03.md                              # 商用部署交接单，58 PASS 0 FAIL
├── kaypal-ai-desktop-lean-build-handoff-2026-06-02.md
├── kaypal-ai-desktop-package-slimming-plan-*.md        # v1/v2/v3 三版
├── kaypal-ai-desktop-user-experience-design-2026-06-02.md
├── kaypal-ai-runtime-unification-complete-handoff-2026-06-03.md  # 751 行，**当前最权威**
├── kaypal-ai-runtime-unification-dependency-slim-2026-06-03.html  # 590 行，我写
├── kaypal-ai-runtime-unification-development-plan-2026-06-03.html # 1022 行
├── kaypal-ai-runtime-unification-p3-runbook-2026-06-03.md         # 333 行（**团队已更新**）
├── kaypal-ai-runtime-unification-project-plan-2026-06-03.html      # 776 行
├── kaypal-ai-runtime-unification-project-summary-2026-06-03.html   # 640 行，**作废**（过度乐观）
├── kaypal-ai-runtime-unification-scope-2026-06-03.md
├── kaypal-workbench-v3-vs-3010-dashboard-comparison-2026-06-03.html
├── windows-installer-handoff-2026-06-03.md              # 636 行，Windows 装器交接
└── windows-installer-preflight-execution-checklist-2026-06-03.md
```

---

## 三、未完成（已分类、按风险排序）

### 3.1 🔴 P3 商业 Gate 5 个硬卡点（**handoff §6**）

| 卡点 | 现象 | 修在哪 | 谁做 | 风险 |
|---|---|---|---|---|
| **1. Prisma engine 混杂** | Windows 包带 `libquery_engine-darwin-arm64.dylib.node` | `desktop/scripts/build-win-full.js` 加 `prune` 步骤 | **用户**（WIP 文件） | 中 |
| **2. venv 不隔离** | auto-upload + agent-s 共用 `<userData>/runtime/auto-upload-venv` | `desktop/main.js` `ensurePythonVenv` 加 `runtimeName` 参数 | **用户**（WIP 文件） | 中 |
| **3. 缺 Agent-S smoke** | 打包前没起 Python 服务跑过 `/healthz` | 新增 `desktop/scripts/smoke-agent-s-sidecar.js` | **可我做**（半天） | 低 |
| **4. pip 依赖用户手装** | 装后要 `pip install -r requirements.txt` | wheelhouse 离线包（`pip install --no-index --find-links`） | **用户** | 中 |
| **5. 干净 Windows VM 验收** | 没在真 Windows 机验过 | 真机：装包 → 起 backend → 起 auto-upload → 起 Agent-S → 4 端口监听 | **用户**（需 Windows 机） | 高 |

### 3.2 🟡 P3 阶段未做（按计划）

| 阶段 | 状态 | 说明 |
|---|---|---|
| **P3-D2/D3 双跑 3 天** | ❌ | 必须真抖音/视频号账号；用 `runtime-p3-dual-run-gate.mjs`；差异必须 0 |
| **P3-D4 删存量** | ❌ | `LocalInteractionExecutorService` 130KB + `CdpPlatformInteractionService` + `AutoUploadClient` 8 个互动方法（**等双跑通过**） |
| **P3-D5 5409 归档** | ❌ | 5409 源仓 `git tag legacy/5409-final` + archive（**用户**） |
| **旧系统备份** | ❌ | `.local-logs/legacy-backups/` 目录还没建（handoff §8 给了备份命令） |
| **5409 进程停** | ❌ | `.local-logs/auto-upload-5409.pid` 还在跑 |

### 3.3 🟡 P4 桌面端（按计划 3-4 天）

- 4 项 macOS 权限引导（辅助功能/自动化/文件访问/屏幕录制）
- wheelhouse 离线 Python 装
- Agent-S 进程崩了自动重启
- 端口冲突用空闲端口扫描 + IPC

### 3.4 🟢 P5 终极验收（按计划 3-5 天）

- 抖音/视频号 4 互动各 5 轮（Local Runtime 路径）
- 微信 3 互动各 5 轮（Agent-S 路径，证据含 trajectory）
- 图文/视频发布闭环
- 失败场景全覆盖（账号过期/权限/Local Runtime 断/Agent-S 断/回读失败）

### 3.5 ⚪ 几个小尾巴（不紧急）

- `pollTimeoutMs/pollIntervalMs` 公共可写字段改 readonly（foot-gun，D5+）
- 集成测试走 `imports: [RuntimeModule]`（覆盖率盲区）
- 性能基线对比（要等真机 + 5409 引擎）
- **作废我之前那份 `project-summary-2026-06-03.html`**（与 handoff 严重不符）

---

## 四、谁做什么

### 用户（必须亲手做）

1. **P3-D2/D3 双跑 3 天**（真账号 + 真浏览器）
2. **P3-D5 5409 归档**（源仓 tag + archive）
3. **P4 桌面端 macOS 4 项权限引导**（需 Mac）
4. **P4 wheelhouse 离线包**（需打包 Python 依赖）
5. **P4 干净 Windows VM 验收**（需 Windows 机）
6. **P5 8 节 9 项验收**（需真账号）
7. **修卡点 1、2、4、5**（在 WIP 文件里改：build-win-full.js / main.js / wheelhouse / VM）
8. **决定何时停 5409 进程**（`.local-logs/auto-upload-5409.pid`）

### AI（不碰 WIP，能帮的）

1. **写 `smoke-agent-s-sidecar.js`**（卡点 3）— 半天
2. **修订 `project-summary-2026-06-03.html`**（按 handoff 框架重写）— 10 分钟
3. **修订 `dependency-slim-2026-06-03.html`**（加 P4 卡点备注）— 5 分钟
4. **P3-D4 删存量**（**等双跑通过后**可做）— 半天
5. **PR review**（用户 commit 前帮我看）

---

## 五、时间估计

按 handoff §10（更悲观）：

| 工作 | 估计 |
|---|---:|
| 5 卡点（venv 隔离 + Agent-S smoke + Prisma prune + wheelhouse + VM 验收） | 2-3 天 |
| P3-D2/D3 真账号双跑 3 天 | **3 天**（硬约束） |
| P3-D4 删存量 | 0.5 天 |
| P3-D5 5409 归档 + 备份 | 1-2 小时 |
| P4 桌面端（权限 + wheels + 守护） | 1-2 天 |
| 旧系统下线 / 真账号 smoke | 1-2 天 |
| 文档收口 + 最终包归档 | 0.5-1 天 |
| **总计** | **8-12 天单人** |

**最乐观**：5-7 天（如果 Windows VM 一次性过 + 5 卡点全绿）
**稳妥**：8-10 天
**悲观**：12 天（卡点反复）

---

## 六、关键文件索引

### Runtime 代码
- `backend/src/modules/runtime/` — 全部 runtime 模块
- `backend/src/modules/local-engine/agent-s.service.ts` — token 改了
- `backend/prisma/schema.prisma` — L578 RuntimeExecution model

### P3 工具
- `scripts/runtime-p3-dual-run-gate.mjs` — 门禁主入口
- `scripts/runtime-dual-run-export.mjs` — 导出
- `scripts/runtime-dual-run-diff.mjs` — diff（**强制 ≥1 样本**）
- `scripts/runtime-write-smoke.mjs` — 落库烟测
- `scripts/commercial-acceptance-gate.mjs` — 商业验收
- `backend/scripts/{local-engine-runtime-smoke,runtime-router-persistence-smoke}.ts` — 落库烟测

### 桌面端
- `desktop/main.js` — 启动逻辑（WIP）
- `desktop/package.json` — extraResources 含 agent-s-executor
- `desktop/sidecars/agent-s-executor/` — FastAPI 服务
- `desktop/sidecars/auto-upload/` — Python 副本
- `desktop/scripts/{build-win-full,prepare-prisma-engines,check-release-size,check-commercial-assets,check-full-installer-assets}.js`
- `desktop/installer/{bootstrap-installer.ps1,deps-manifest.json,self-check.ps1}`

### 文档
- **最权威基线**：`docs/kaypal-ai-runtime-unification-complete-handoff-2026-06-03.md`（751 行）
- P3 真机手册：`docs/kaypal-ai-runtime-unification-p3-runbook-2026-06-03.md`（333 行，团队已更新）
- 商用 Gate 计划：`docs/commercial-readiness-development-plan-2026-06-02.md`（713 行）
- Windows 装器交接：`docs/windows-installer-handoff-2026-06-03.md`（636 行）
- 商用部署交接：`docs/handover-2026-06-03.md`（58 PASS 0 FAIL）
- 依赖瘦身决策：`docs/kaypal-ai-runtime-unification-dependency-slim-2026-06-03.html`（590 行）
- **已作废**：`docs/kaypal-ai-runtime-unification-project-summary-2026-06-03.html`（我写，过度乐观）

---

## 七、建议下一步（按 ROI 排）

1. **修订 `project-summary-2026-06-03.html`**（用 handoff 框架，10 分钟）— 避免继续误导
2. **写 `smoke-agent-s-sidecar.js`**（卡点 3，半天）— 高 ROI
3. **P3-D2/D3 真账号双跑 3 天**（你自己）— 商业 Gate 硬门槛
4. **P3-D4 删存量**（双跑过后我做，半天）— 清理死代码
5. **修订 `dependency-slim-2026-06-03.html`**（加 P4 卡点备注，5 分钟）
6. **P4 桌面端**（你自己，3-4 天）
7. **P5 验收**（你自己，3-5 天）

---

## 八、节奏感

今天已 8+ 小时密集作业（我 + 你/团队）。继续推进建议：

- 我做修订 + smoke（30-40 分钟）— 不累
- P3-D2/D3 双跑你做时建议每天 4-6 小时（双跑期容易 burnout）
- 周末休息
- P4 桌面端可以等 P3 真机跑完再做

**代码可以等人。人不可以等代码。**

---

**这份文档是新的基线**。请用它取代我之前那份"100% 完工"总结。
