# 浏览器面板 · 第六轮报告（①审批 UI ②确认机制合并 ③灰度开关）

日期：2026-09-03 ｜ 执行：二狗 ｜ 决策：大王拍板「1A 2A 3A」

## 0. 结论先行

**三项决策全部落地并全量验证通过：backend 26 suites / 465 tests 全绿，desktop 9 个 spec 143 条全绿，5 个 Electron 真机冒烟 11/11、9/9、11/11、9/9、7/7 全过。** 其中 stage7 冒烟抓到 1 个真 bug（toggle 不广播状态，控制条点两下=开了两次），已修复并加回归用例锁死。

## 1. 本轮做了什么

| 决策 | 内容 | 状态 |
|---|---|---|
| ① 桌面审批 UI | 审批浮层（第三视图）：Agent 签单 → 浮层弹出卡片 → 用户真实点击批准/拒绝 → 走真实 IPC 回主进程。textContent-only 防注入。 | ✅ 完成（stage6 冒烟 9/9） |
| ② 两套确认机制合并 | 面板单与后端单**合并进同一张 AgentConfirmation 表**，主键=桥 actionId，全链路一个 id，零 migration。审批入口只有一个（桌面面板）。 | ✅ 完成（13+4+12 条新测试） |
| ③ 灰度开关 | 控制条「AI 代操作」按钮 → userData 下 0600 开关文件 → 3011 按需读取。env 显式 > 文件 > 默认 off。 | ✅ 完成（stage7 冒烟 7/7） |

## 2. 修改文件清单

**backend（local-engine）：**

| 文件 | 改动 |
|---|---|
| `agent-panel-bridge.service.ts` | 面板单落库引擎（persistTicket/markTicket/markApproved/markRejected）、`panelMethodForAction`、`isPanelConfirmation`、**③ `readPanelModeRegistry`**（1s 缓存 + protocol/mode/7 天老化/pid 探活全 fail-closed）、`panelModeRegistryPath`、`clearPanelModeRegistryCache` |
| `agent-browser-executor.service.ts` | `AgentBrowserExecuteInput.sessionId`、`gotoViaPanel`（approved/rejected/无单三分支）、`markApprovalSafe`（审计旁路：落库失败只 warn 不阻断已批准动作）、**③ `readAgentPanelMode` 双来源**（env 显式 > 文件 > off，非法 env → invalid） |
| `agent-browser-loop.service.ts` | 确认闸门重写：面板模式无单 → 放行给 executor 桌面签单（**不再建第二张后端单**）；`resolveConfirmation` 面板单按 CDP method 指纹 + `json.status==='approved'` 放行；stepEvent 留痕 `panelApproval:true`；`executeWithRetry` 透传 sessionId |
| `local-engine.persist.mixin.ts` | 三处组装点过滤面板单（不进后端"待你确认"列表，行留库供审计） |

**desktop：**

| 文件 | 改动 |
|---|---|
| `browser-panel-mode-registry.js`（新） | 开关投递文件读写：0600 + protocol 校验 + 7 天老化 + pid 探活；文件里没有 token，删文件即回 off |
| `browser-panel-manager.js` | ③ `getAgentMode`/`setAgentMode`（写/删文件 + **_emitState 广播**）、`publicState.agentMode`、构造注入 `getUserDataDir`、`destroy()` 主动清文件 |
| `browser-panel-ipc.js`（新） | 12+1 通道共享注册，新增 `browser-panel:toggle-agent-mode`（stripOnly 门禁） |
| `browser-control-strip-preload.js` | invoke 白名单加 toggle 通道 |
| `browser-control-strip.html` | 「AI 代操作」按钮（status 与 hide 之间，主题紫 #722ed1 高亮表示开） |
| `main.js` | manager 构造注入 `getUserDataDir`（与桥凭据同一目录取法） |
| 其余（wiring/broker/overlay 三件套等） | ①② 的既有改动（见上轮交接） |

**测试（新建/扩充）：**

| 文件 | 条数 |
|---|---|
| `local-engine.panel-confirmation-merge.spec.ts`（新） | 13（待批列表过滤 5 / method 映射 2 / loop 闸门 6） |
| `agent-browser-executor.panel.spec.ts` | 18→24（② 4 条 + ③ 优先级 6 条，`{}` 用例改显式传文件源防真机漂移，beforeEach 隔离 `KAYPAL_BROWSER_PANEL_MODE_FILE`） |
| `agent-panel-bridge.service.spec.ts` | 20→42（② 落库 12 条 + ③ readPanelModeRegistry 10 条） |
| `browser-panel-mode-registry.spec.js`（新） | 16 |
| `browser-panel-manager.spec.js` | 11→17（③ 6 条） |
| `desktop/scripts/browser-panel-stage7-smoke.mjs`（新） | 真机 B1-B6（7 检查项） |

## 3. ② 合并的核心设计（复核要点）

- **双状态维度**：`status` 列留给两阶段锁定（pending→in_use→consumed，原子 updateMany），审批态写在 `confirmationJson.status`（pending/approved/rejected）。批准了但没执行 = status:pending + json.status:approved。
- **审批入口只有一个**：桌面面板审批 UI。后端三处组装点过滤面板单。
- **loop 闸门**：面板单指纹按 CDP method 比对（`panelMethodForAction` 映射，未登记动作 → null 不放行）；`json.status==='approved'` 才放行；放行后照旧两阶段锁定。批准态由 executor 在桥上真实查到 approved 后经 `markApprovalSafe` 写库——后端不自说自话。
- **审计旁路原则**：`markApprovalSafe` —— 用户已点批准，桥也认了，落库失败只告警不阻断执行（拿审计需求卡业务 = 错）。

## 4. ③ 开关协议

- 文件：`<userData>/browser-panel-mode.json`，0600，`{version:1, protocol:'kaypal-browser-panel-mode', mode:'on'|'off', pid, startedAt}`。
- 优先级：`KAYPAL_AGENT_PANEL_MODE` env 显式（'off'=管理员一票否决，非法值=invalid 显式报错）> 开关文件 > 默认 off。
- fail-closed：文件缺失/形状非法/超 7 天/pid 已死 → 未开启。3011 读取带 1s 缓存（每个动作都查，不能打磁盘），desktop 删文件后最迟 1s 生效。
- 关 = 删文件（不留 'off' 残留）；desktop destroy() 主动清，进程整个退出靠 pid 探活兜底。

## 5. 验证结果

| 验证 | 命令 | 结果 |
|---|---|---|
| backend 全量 | `npx jest src/modules/local-engine` | **26 suites / 465 tests 全过** |
| backend 类型 | `npx tsc --noEmit -p tsconfig.json` | EXIT=0 |
| desktop 9 spec | `node <spec>.js` | **143 条全过**（client 17 / server 19 / overlay 20 / wiring 11 / bridge-registry 11 / runtime 8 / mode-registry 16 / broker 24 / manager 17） |
| 真机冒烟 | `env -u ELECTRON_RUN_AS_NODE electron scripts/…` | **stage1 11/11、stage2 9/9、stage5 11/11、stage6 9/9、stage7 7/7** |
| git | `git diff --check` | 干净 |

## 6. E2E 抓到的真 bug（已修）

**stage7 首跑 2 条失败**：toggle 写文件成功但**没广播状态**——控制条 `onState` 拿不到新 `agentMode`，按钮不高亮；且控制条用陈旧 `lastState` 计算下一次 toggle，点两下 = 开了两次。修复：`setAgentMode` 末尾补 `_emitState()`；manager.spec 加广播断言用例锁死（`pushed deepEqual ['on','off']`）。

## 7. 未完成与风险交底（⚠️ 必读）

1. **3011 跨进程端到端未做真机验证**：开关文件 → 3011 读取这条链，backend 侧用临时文件 + jest 全覆盖（10 条），desktop 侧 stage7 全覆盖，但**没有起真实 3011 进程读真实 userData 的文件**。两端常量（文件名/protocol/老化/pid）是同一份规格写两边，靠测试对齐而非编译期约束——若改 protocol 记得两侧同步。
2. **`resolveDesktopUserDataDir` 在生产 3011 环境的推导**依赖 `project-paths.ts`（该文件有并发方的未提交改动，本线未触碰）；若该目录推导变化，桥凭据与开关文件会一起失效——属既有风险非本轮引入。
3. **开关文件删除后 1s 缓存窗口**：desktop 关掉后，3011 最迟 1s 内仍认为 on。窗口内若正有动作在飞，会走完面板审批（fail-closed 闸门仍在，无安全风险，只是"立即生效"不严格成立）。
4. **click/type/press_key 映射已给但桥未开通**：`panelMethodForAction` 给了映射，executor 会拦"暂不支持"——按文档 §4 接动作时逐个放开。
5. **已知既有问题**（非本线引入）：jest 末尾 "A worker process has failed to exit gracefully"（teardown 泄漏）；Electron `canGoBack/canGoForward` deprecation 警告。
6. **未提交的并发方改动**（project-paths/main.ts/discovery/growth/rpa/ai-employee/frontend 等 ~16 个文件）本线全程未触碰，提交时逐文件 add 严格隔离。

## 8. 需大王确认

- 灰度开关 UI 文案与位置（控制条「AI 代操作」紫色按钮）是否 OK；
- 下一轮：按文档 §4 接 click → fill_form → press_key/wait_for/tabs → extract_text，还是先做真实 3011 跨进程验证 / Windows 真机 smoke。
