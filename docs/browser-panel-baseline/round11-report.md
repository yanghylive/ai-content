# browser-panel Round 11 报告：tabs 接通面板桥（多标签页台账）

日期：2026-09-03 ｜ 分支：当前工作线 ｜ 对齐 round10 报告结构

## 结论

**tabs 动作已接通面板桥，支持 new / switch / close 三种操作，全部经 mutation 审批闸门。**
stage12 真机冒烟 8/8、desktop 9 spec 172 全绿（158+14）、backend local-engine 26 suites 全绿、tsc EXIT=0。

| 验证 | 结果 |
|---|---|
| stage12 真机冒烟（真实 manager + wireBrowserPanel + 双页 fixture） | **8/8 PASSED** |
| desktop 9 spec（纯 node） | **172/172**（broker 44 / manager 24 / wiring 13 / server 19 / client 17 / registry 11 / runtime 8 / mode 16 / overlay 20） |
| backend local-engine jest | 26 suites 全 PASS（含 executor.panel 44 + merge 17） |
| backend `tsc --noEmit` | EXIT=0 |
| backend 全量 jest | 237 passed / 3 failed（douyin / growth / local-bridge，**非本线**，见交底） |

## 文件清单

| 文件 | 改动 |
|---|---|
| `desktop/browser-panel-manager.js` | 多 tab 台账 `_panelTabs/_activeTabIndex`；抽取 `_spawnTabView`；`tabsOperation(operation,index)`；`_setActiveTab` / `_tabSnapshot`；`_disposePanelView` 清全部 tab；`hide()` 遍历隐藏；事件 push 加 active-only 判断；`publicState` 加 `tabCount/tabActiveIndex` |
| `desktop/browser-panel-broker.js` | `CDP_WHITELIST`/`MUTATION_METHODS` 加 `Panel.tabs`（主进程伪 method，不走 debugger）；deps 注入 `tabsHandler`（未注入 fail-closed）；`sendCDP` 特判分支 + 执行后 fresh target 重解析 |
| `desktop/browser-broker-wiring.js` | 注入 `tabsHandler: (op, i) => manager.tabsOperation(op, i)` |
| `desktop/browser-agent-bridge-server.js` | mutation result 过滤放行 `Panel.tabs` 特例（台账快照 `{tabs,activeIndex,url}` 是面板 UI 结构，非页面内容/凭据） |
| `backend/.../agent-panel-bridge.service.ts` | `panelMethodForAction('tabs')` → `'Panel.tabs'` |
| `backend/.../agent-browser-executor.service.ts` | 路由 `case 'tabs'` → `tabsViaPanel`（switch 也签单：切换改变用户所见页面） |
| `desktop/browser-panel-{manager,broker}-spec、browser-broker-wiring.spec.js` | ⑪ tabs 用例 +7/+5/+2 |
| `backend ...panel.spec.ts / ...merge.spec.ts` | ⑪ tabs 用例 4 条；断言迁移 `tabs → 'Panel.tabs'` |
| `desktop/scripts/browser-panel-stage12-smoke.mjs` | 新，8 项真机场景 |
| `docs/browser-panel-baseline/round11-report.md` + `stage12-evidence-*.json`（滚动保留最新） | 本报告 + 证据 |

## 设计要点

1. **不用 CDP Target 域（关键交底）**：broker 的 CDP 通道是 `webContents.debugger`（target 级 session，attach '1.3'），`Target.createTarget/closeTarget` 等 browser 级命令在此通道发不出去——已用 /tmp probe 脚本实证。故走**主进程伪 method `Panel.tabs`**：broker 白名单/闸门照常，execute 特判分支经注入的 `tabsHandler` 回调 manager 原生台账。
2. **panelView 恒 = active tab 视图**：既有 `resolvePanelTarget/navigate/goBack/relayout` 等零改动自动作用于当前 tab。台账下标即 `tabs.index`。
3. **一次批准 = 一次 tabs 操作**：审批消耗在 mutation 闸门；handler 抛错 = 单已耗 + 动作失败（与 CDP 失败语义一致，重试需重新签单）。switch 也签单——切换改变用户所见页面，知情卡片合理。
4. **语义对齐旧无头（ai-browser-action.service case 'tabs'）+ 两点收紧**：
   - `new` = 空白页 + 置 active（对齐 `newPage()+bringToFront`），并 **loadURL('about:blank')**——不加载时 `getURL()` 为空串，binding 会回落陈旧 URL（stage12 S4 实证修复）；
   - `switch` 越界**显式失败**（旧无头 fallback `pages[0]` 是静默降级，fail-closed 收紧）；
   - `close` 缺省关 active、**最后一个不可关**；多 tab 时允许关 tab[0]（与旧无头保护 `pages[0]` 的差异交底）。
5. **fresh target**：`Panel.tabs` 执行后 broker 重新 `resolveTarget`——switch/new 后 active 已变，binding 必须反映新 active。
6. **事件隔离**：后台 tab 的导航/加载事件不更新会话状态（push 加 `wc.id === panelView.webContents.id` 判断），switch 后自然跟踪新 active。

## stage12 冒烟排障（三轮收敛，如实交底）

| 轮次 | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | S4 bindingUrl=page-a（陈旧） | 新 tab 未加载，`getURL()` 空串，broker `wcUrl || session.currentUrl` 回落旧值 | `tabsOperation('new')` 里 `loadURL('about:blank')`（**产品代码修复**） |
| 2 | S4 仍 FAIL；S5 "No target available" | S4 断言本身错；S5 待查 | 加分步日志 |
| 3 | S4 `bindingUrl=about:blank` 仍断 `含page-b` 失败；S5 detail `{step:"post-eval", error:"No target available", activeWcId:5, tabs:[5,6]}` | ① `Page.navigate` 普通分支的 `done.target` = **执行前** resolve 的 binding（当时 about:blank），断言写错方向；② smoke 裸调 `wc.debugger.sendCommand`，而 broker 只在执行 CDP 时 attach 当时的 active tab，switch 换绑后新 active 未 attach | ① 断言改锁语义 `bindingUrl === 'about:blank'`，页面到位由 getURL+evaluate 证明；② harness 补 `if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')`（**均为 smoke 脚本修复，产品链路无此问题**——broker 每次 sendCDP 重新 resolve+attach） |

排障副产品：probe 脚本两次挂死教训（Electron 下 ESM 加载错误会挂住而非退出；对同步返回值调 `.catch` 直接 FATAL）。

## 交底（欠账与边界）

- **控制条 tab 条 UI 未做**：`tabCount/tabActiveIndex` 已进 publicState，但面板控制条还没有 tab 切换条 UI——当前多 tab 只能由 Agent 动作切换，用户无法手动切。后续补。
- **windowOpenHandler 行为未动**：页面 `window.open` 仍 deny，不会自动变成新 tab。
- **backend 全量 jest 有 3 个非本线失败**（douyin exposure-collector / growth commercial / local-bridge integration）：growth/discovery 并发方地盘 + 环境依赖用例（`runtime_unavailable`），本线未触碰这些模块，local-engine 26 suites 全绿。
- 累计既有欠账不变：probe/extract 表达式双端两份非单源；3011 跨进程真实 userData 验证；Windows 真机 smoke 1~12 全未跑；loop 门禁 message 字符串匹配。

## 下一步

1. **screenshot**（最后一个未接通动作，`Page.captureScreenshot` 已在白名单，补执行器路由 + 二进制结果落盘/回传语义）。
2. 3011 跨进程真实 userData 验证。
3. Windows 真机 smoke 1~12 补账（jz-win11-*）。
