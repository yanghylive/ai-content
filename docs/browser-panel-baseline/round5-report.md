# 第五轮报告：阶段 4/5 完整闭环（token 投递 + 写动作闭环 + 后端面板路由）

> 前置：第四轮只建了「上行桥地基」，桥默认不启动、endpoint/token 不投递给 3011、不改 Agent-S 执行路径。
> 本轮在**大王明确「批准」**之后推进，把执行路径的缝接上，但**默认仍然关闭**（见交底第 1 条）。

## 本轮目标

1. **token 投递机制**：把桥的 endpoint+token 安全交付给 3011 Agent-S（0600 凭据文件模式，沿用 `backend/src/modules/auth/local-mcp-auth.ts` 先例）。
2. **桥生命周期**：面板可见 → 起桥 + 写凭据；面板隐藏/销毁/换账号 → 关桥 + **删凭据文件**（退出不留残留 token）。
3. **写动作闭环**：`签确认单 → 用户在桌面端批准 → 携带 actionId 执行 → observe 回读`，**批准权始终在用户手上**（桥不自我批准、后端只认 `approved`）。
4. **后端真正接入**：`AgentBrowserExecutor` 增加面板路由（`KAYPAL_AGENT_PANEL_MODE`，**默认 off**），on 模式下 `extract/goto` 走用户右侧那个面板页面。
5. **端到端真实验证**：阶段 5 smoke 用**真实 Electron 真窗口 + 真实子进程（扮演 3011）**，断言同页（`webContentsId` 相等）与写动作闭环。

## 修改文件

### desktop（新增）

| 文件 | 行数 | 变更与原因 |
|---|---|---|
| `desktop/browser-panel-bridge-registry.js` | 171 | 凭据投递文件读写。`resolveRegistryPath`(31) / `chmod600`(41) / `writeRegistry`(53) / `readRegistry`(106) / `clearRegistry`(144)。**3011 不一定由 desktop 启动，env 注入不可靠**，改用 userData 下 0600 文件。**读取存量文件时也强制 chmod 0o600**（修旧不修新会让磁盘上已存在的 0644 老文件一直裸奔）；文件带 `writtenAt`/`panelId`，读取侧校验新鲜度与结构 |
| `desktop/browser-panel-bridge-runtime.js` | 152 | 桥生命周期编排。**main.js 与 E2E 脚本共用同一模块**，避免「E2E 验副本、生产跑另一份」。并发 `sync` 串行化（同一次 syncing 期间的事件跳过，不重复起桥） |
| `desktop/scripts/browser-panel-stage5-agent.mjs` | 171 | E2E 中扮演「3011 一侧」的**真实子进程**（独立进程、独立 Electron 实例，不走 IPC 后门）。支持 `sign` / `execute <actionId>` 两种模式 |
| `desktop/scripts/browser-panel-stage5-smoke.mjs` | 471 | 阶段 5 端到端主脚本，11 项断言（详见验证表） |

### desktop（修改）

| 文件 | 变更与原因 |
|---|---|
| `desktop/browser-panel-broker.js` (+205) | `approveAction`(358) 增加第四参 `context`，记录 `approvedAt` + `approvalContext.channel`（**区分「用户点批」与「Agent 自批」**）；新增 `listPendingActions`(377)（**不含 token**）、`noteActionApprovalContext`(424)、**`actionState`(401)**——后端执行写动作的合法前置，**查询不消费确认单**；删除重复的旧注释块 |
| `desktop/browser-broker-wiring.js` (+37) | 新增**用户（owner）批准通道** `approveActionAsOwner`(167)（阶段 4 审批 UI 的主进程接缝，写死 `channel:'owner-ui'`）、`actionStateForAgent`(180)、`listPendingActions`(185)。`approveActionForAgent`(194) 的 harness 分支补 `channel:'self-approve-harness'` 以便留痕区分 |
| `desktop/browser-agent-bridge-server.js` (+68) | 新增 3 条路由：**`POST /execute`(178)**（写动作缺 `actionId` 即 403，桥仍无执行权）、`POST /pending-actions`(212)、`POST /action-state`(216)；403 判定正则补 `\|必填` |
| `desktop/browser-agent-bridge-client.js` (+42) | 对称 SDK：`execute`(188) / `pendingActions`(204) / `actionState`(214)，均带本地 fail-closed 校验（不发无效请求） |
| 三个 `.spec.js` (+492) | broker 24/24（+3）、bridge-server 19/19（+7）、bridge-client 17/17（+5） |
| `desktop/main.js` | 桥生命周期改为调用**共享 runtime 模块**（删掉原先内联的 `ensure/closeBrowserBridge`），并订阅 `browserPanel.onSessionEvent` 驱动 `sync`；`getBrowserBridgeInfo()` **不再返回 token**；`before-quit` 关桥（停监听 + 销毁 token + 删凭据文件） |

### backend（新增）

| 文件 | 行数 | 变更与原因 |
|---|---|---|
| `backend/src/modules/local-engine/agent-panel-bridge.service.ts` | 495 | 3011 侧的桥客户端服务。封装 `observe / requestAction / actionState / execute / pendingActions / health / status`；endpoint 只允许回环；凭据缺失/过期 → `status().available=false`（**不抛、不降级**） |
| `.../agent-panel-bridge.service.spec.ts` | 551 | 25 条（全新） |
| `.../agent-browser-executor.panel.spec.ts` | 338 | 14 条，锁死「三条硬规矩」 |

### backend（修改）

| 文件 | 变更与原因 |
|---|---|
| `agent-browser-executor.service.ts` (+236/-部分) | 新增 `readAgentPanelMode`(60)（非法值返回 `'invalid'`，**不猜配置**）；构造注入 `@Optional() panelBridge`(76)；`execute`(85) off→纯透传 / invalid→显式失败 / on 但桥未注入→显式失败（不回退）；`executeViaPanel`(120) 缺身份→失败、面板不可用→失败且写明「不静默回退到无头浏览器」、`extract`→面板 observe（带回 `panelWebContentsId`/`panelSessionId`）、`goto`→`gotoViaPanel`(183)、其余动作→明确「暂不支持」且「未回退」；`isAlive`(109) 面板模式下看桥健康 |
| `agent-browser-loop.service.ts` (+9) | `executeWithRetry` 新增第 5 参 `actor`(657)，从**会话租约**取身份 `session.lease.ownerId/tenantId`(339) 透传下去(685) |
| `local-engine.module.ts` (+2) | import(22) 并注册 `AgentPanelBridgeService`(72) |

## 协议与数据变化

桥协议从 3 条路由扩到 6 条（**仍然不代理裸 CDP，无 `/cdp` 泛化端点**）：

```
GET  /health           → { ok, protocol, version }                          // 免 actor
POST /observe          { panelId, actor }  → { binding, target, title, textSample }
POST /action-request   { panelId, actor, method, params, summary }
                       → { actionId, binding }                              // 只签单，不自批
POST /execute          { panelId, actor, method, params, actionId }
                       → { binding, method, executed, actionId, result }    // 写动作必带已批确认单
POST /pending-actions  { panelId, actor }  → { panelId, actions:[…无 token…] }
POST /action-state     { panelId, actor, actionId }
                       → { actionId, state: pending|approved|none, panelId, method,
                           approvedAt, binding, summary }                   // 查询不消费确认单
```

- `/execute` 的写动作判定复用 broker 导出的 `MUTATION_METHODS` 集合（**同一份来源，不在 server 里复制一份白名单**）：`Input.dispatchMouseEvent`、`Input.dispatchKeyEvent`、`Input.insertText`、`Page.navigate`。
- 写动作结果**只回 `executed:true`，不回显 CDP 原始 result**（避免把页面内部细节带出网）；只读方法才回 `result`。
- 凭据文件：`{userData}/browser-panel-bridge.json`，mode **0600**，含 `endpoint / token / panelId / writtenAt`；读侧校验新鲜度 + 结构。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `node desktop/browser-panel-broker.spec.js` | **PASS 24/24**（+3：pending→approved→消费后 none、查询不消费、换页后旧单不可执行） |
| `node desktop/browser-broker-wiring.spec.js` | **PASS 11/11** |
| `node desktop/browser-agent-bridge-server.spec.js` | **PASS 19/19**（+7：`/execute` 缺单 403、跨 owner 403、跨 tenant 403、未知单 none、pending-actions 不含 token、写动作不回显 result、close 后不可达） |
| `node desktop/browser-agent-bridge-client.spec.js` | **PASS 17/17**（+5：execute 带单透传、缺 method 本地拒、actionState 三态、pendingActions、close 后 NETWORK_ERROR） |
| `node desktop/browser-panel-bridge-registry.spec.js` | **PASS 11/11**（新增） |
| `node desktop/browser-panel-bridge-runtime.spec.js` | **PASS 8/8**（新增，含并发 sync 串行化） |
| `node desktop/browser-panel-manager.spec.js` | **PASS 11/11**（阶段 2 回归） |
| `env -u ELECTRON_RUN_AS_NODE electron scripts/browser-panel-smoke.mjs` | **PASSED 11/11** |
| `env -u ELECTRON_RUN_AS_NODE electron scripts/browser-panel-stage2-smoke.mjs` | **PASSED 9/9** |
| `env -u ELECTRON_RUN_AS_NODE electron scripts/browser-panel-stage5-smoke.mjs` | **PASSED 11/11**，EXIT=0 |
| `cd backend && npx tsc --noEmit` | 无输出（干净） |
| `cd backend && npx jest src/modules/local-engine` | **25 suites / 425 tests 全绿**（含新增 executor 14 + 桥服务 25） |

### 阶段 5 E2E 11 项断言（真实 Electron 真窗口 + 真实子进程）

| # | 断言 | 结果 |
|---|---|---|
| P1 | 面板打开 → 凭据文件落盘且权限 0600 | ✅ mode=600 |
| P2 | 子进程跨进程读到凭据并连通 `/health` | ✅ protocol=kaypal-browser-bridge v1 |
| **P3** | **observe 的 `webContentsId` == 面板真实 `webContents.id`** | ✅ **4 == 4** |
| P4 | observe 内容与面板真实渲染一致 | ✅ `BrowserPanel P0 Fixture` |
| P5 | 脱敏：`SECRET-E2E-123` 不出网、敏感 query 变 `***` | ✅ leaked=false |
| P6 | 子进程只拿得到确认单，**拿不到执行权** | ✅ `act-1847365393c7566bfcbf16a3` |
| P6b | Agent 尝试自我批准 → 被拒（硬约束 5） | ✅ 抛错并写明「批准必须由用户通道发起」 |
| P7 | 未批准的 `Page.navigate` → 被审批闸门拒绝 | ✅ 抛「先 requestAction 再携带 approvedActionId」 |
| **P8** | **真实导航闭环**：签单→用户批准→CDP 执行→observe 回读到新页面 | ✅ `afterUrl=…/nav-target.html`、markerFound、**afterWcId=4 == realWcId=4** |
| **P9** | **后端视角写动作闭环**：签单(pending 拒执行)→用户批准→带单执行→回读 | ✅ pending 执行被拒 `POLICY_DENIED`；批准后 executed、`afterUrl=…/nav-target-2.html`、markerFound |
| P10 | 面板隐藏 → 凭据文件删除 + 桥关闭（子进程再调必然失败） | ✅ fileGone=true、agent 报 `NO_CREDENTIALS` |

证据（滚动保留最新一轮）：`docs/browser-panel-baseline/{smoke-evidence-2026-09-02T19-07-14.json, smoke-screenshot-2026-09-02T19-07-14.png, stage2-evidence-2026-09-02T19-07-15.json, stage5-evidence-2026-09-02T19-07-44.json}`

## 本轮抓到的真 bug（不是测试桩问题）

1. **`Page.navigate` 返回时新文档未提交 → `webContents.getURL()` 滞后一拍。**
   首次跑 P9 出现「文本内容已是新页、URL 仍是旧页」的**自相矛盾证据**。若不修，会拿到一份「内容与 URL 不自洽」的假证据并据此宣判通过。修法：回读改为**轮询**（最多 6s / 300ms 间隔，**URL 与文本同时满足**才退出），并记录 `observePolls` 进证据。

2. **`ELECTRON_RUN_AS_NODE` 空串不生效 → 子进程以 GUI 模式挂死。**
   `spawn(env: { ...process.env, ELECTRON_RUN_AS_NODE: '' })` 在 Electron 里**等于没设**，子进程以 GUI 模式启动后卡住 2 分钟无任何输出（脚本本身也没有超时保护，表现为「静默挂死」）。修法三处：env 显式 `'1'`；`runAgent` 自带 20s 超时 + SIGKILL；脚本加 150s 全局看门狗（macOS 无 `timeout` 命令）。

3. **`/execute` 的假桩绕过缝风险。**
   给 `/execute` 补测试时发现假桩 `sendCDPForAgent` **没做 actor 断言**，于是「跨 owner」用例返回 200 而非 403——真实接线里这是 `handleFor → broker.assertActor` 保证的，但**假桩不做断言就会让 `/execute` 在测试里看起来安全、实则是绕过缝**。已给假桩补上断言并加注释说明原因。

4. **收尾顺序错误导致证据日志噪音。**
   原来先打印结论再在 `finally` 里收尾，但 `app.exit()` 会**立刻终止进程**，finally 永远跑不到 → 日志尾部留下 `[browser-panel] 面板视图销毁异常：Object has been destroyed`。修法：收尾依赖提升为模块作用域，新增 `finish()` **先收干净（runtime.close → manager.destroy → win.destroy → server.close）再宣判**。

5. **（环境问题，非代码）宿主环境继承了 `ELECTRON_RUN_AS_NODE=1`**，导致本轮一度所有 Electron smoke 以纯 node 模式启动、`app` 为 undefined、316ms 内全部 EXIT=1。运行命令已统一加 `env -u ELECTRON_RUN_AS_NODE`。

## 未完成与风险交底 ⚠️

1. **默认仍然关闭，Agent-S 执行路径「可切但尚未切」。**
   `KAYPAL_AGENT_PANEL_MODE` 未设置 = `off` = `AgentBrowserExecutor` 纯透传到既有 `AiBrowserActionService.executeSingle`。**本轮没有改动任何默认行为**，线上执行路径零变化。
2. **桌面端审批 UI 尚未渲染。**
   只落了主进程接缝 `approveActionAsOwner(panelId, actionId)` 与 `listPendingActions(panelId)`，**渲染器里没有界面**。E2E 里的「用户批准」是脚本代表用户直接调主进程函数——**真实用户目前无法在界面上点批**。这是阶段 4 审批 UI 的剩余工作，未做。
3. **面板模式仅支持 `extract` / `goto`。**
   `click` / `fill_form` / `press_key` / `wait_for` / `tabs` 在 on 模式下**明确返回 `ok:false` 且写明「未回退」**，不会偷偷走无头浏览器。按文档 §4 顺序逐个开通。
4. **两套确认机制并存，尚未统一。**
   后端既有 `prisma/schema.prisma:1556 model AgentConfirmation`（两阶段锁定 pending→in_use→consumed、风险分级 `agent-browser-policy.service.ts:114-136`）与本轮新增的「面板确认单」是**两套独立机制**，互不同步。面板确认单的 `actionId` 目前只在 `AgentBrowserExecuteResult.confirmationId` 上带回，**没有落库**。是否合并需大王定夺。
5. **Windows 真机 smoke 欠账继续累积。** 阶段 1~5 全部只在 `darwin-arm64` / electron 32.3.3 验证，阶段 6 打包验收前必须补 Windows 真机。
6. **既有失败未动**：`node --test desktop/scripts/build-win-full.test.js` 在 mac 上加载模块即被平台守卫崩（HEAD~2 同样红），与本线无关。
7. `npx jest src/modules/local-engine` 末尾有一行 `A worker process has failed to exit gracefully` 警告——既有测试的 teardown 泄漏，非本线引入，未处理。
8. 工作区里 `backend/src/modules/{discovery,growth,rpa}` 与 `backend/src/main.ts`、`common/project-paths.ts` 的**并发方未提交改动全程未触碰**；提交严格逐文件 `git add`，不用 `git commit -am`。

## 需要用户确认的事项

- **① 审批 UI 是否现在做？** 没有界面，写动作闭环在真实使用中走不通（用户没法点批）。建议下一轮就补。
- **② 两套确认机制（AgentConfirmation vs 面板确认单）是否合并？** 不合并就维持「面板只做执行闸门、后端确认单继续管业务审批」的分工，但需要文档写死边界。
- **③ 是否开放 `KAYPAL_AGENT_PANEL_MODE=on` 做真机灰度？** 在 ① 完成前开放没有实际意义（写动作全卡在批准环节）。
- 下一轮默认建议顺序：**审批 UI → click → fill_form → press_key/wait_for/tabs → extract_text → Windows 真机 smoke → 阶段 5 真实平台迁移（general-web → 小红书 → 抖音 → 视频号 → 草稿 → 真实发布）**。
