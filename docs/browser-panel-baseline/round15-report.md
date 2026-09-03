# browser-panel Round 15 报告：控制条 tab 条 UI——用户手动切/关 tab

日期：2026-09-03 ｜ 对齐 round14 报告结构

## 结论

**round11 遗留的「控制条 tab 条 UI」已闭环：多 tab 时控制条出现 tab 条（单 tab 不出现、零干扰），用户可手动切换/关闭 tab；与 Agent 动作链共用同一台账与状态流，互不打架。**
stage15 真机冒烟 8/8、desktop 10 spec 187 全绿（183+4）。backend 零改动。

| 验证 | 结果 |
|---|---|
| stage15 真机冒烟（真实 strip DOM 点击 + Agent 审批链） | **8/8 PASSED** |
| desktop 10 spec | **187/187**（manager 28，+4 ⑮ 用例） |
| backend | 零改动，未波及 |

## 文件清单

| 文件 | 改动 |
|---|---|
| `desktop/browser-panel-manager.js` | `_tabList()`（title/url 明细）；`switchTabByUser/closeTabByUser`（复用 tabsOperation 语义校验，错误转 `{ok:false}` 不抛）；`publicState.tabList`；`_stripHeight()` 动态高度（多 tab 66px / 单 tab 40px）；relayout 用动态值；close 后台 tab 分支补 relayout；`page-title-updated` 事件（active-only，驱动 tab 条标题） |
| `desktop/browser-panel-ipc.js` | `browser-panel:switch-tab` / `close-tab`（**stripOnly** 门禁：只有控制条能发，前端不得替用户操作） |
| `desktop/browser-control-strip-preload.js` | 白名单加两通道 |
| `desktop/browser-control-strip.html` | 两行布局（tabbar + toolbar）；tab 条渲染（active 紫色 #722ed1 高亮、✕ 关闭、最后一个不显示 ✕、多 tab 才出现） |
| `desktop/browser-panel-manager.spec.js` | ⑮ 用例 4 条（switch/close 用户通道 + 越界不抛 + 动态高度 + 标题事件隔离） |
| `desktop/scripts/browser-panel-stage15-smoke.mjs` | 新，8 项真机场景（真实 strip DOM click） |
| `docs/browser-panel-baseline/round15-report.md` + `stage15-evidence-*.json` | 本报告 + 证据 |

## 设计要点

1. **用户操作不走 Agent 审批闸门**：审批只约束 Agent 动作；用户在自家面板点 tab 与点后退/刷新同权（`stripOnly` + `isStripSender` 门禁在 IPC 层，前端 3010 不得替用户切 tab）。
2. **零干扰原则**：单 tab 时 tab 条不渲染（`display:none`）、strip 高度不变（40px）；第一个多 tab 出现时才占位（+26px=66px），面板页随 relayout 下移——对齐「零学习成本」，不被用不到的 UI 打扰。
3. **状态互通**：Agent `Panel.tabs` 动作与用户点击改的是**同一个台账**，`_emitState` 广播 `tabList/tabActiveIndex`，tab 条与 Agent 视角永远一致；用户切 tab 后 Agent 的下一个动作作用于新 active（既有 panelView 模型语义，审批卡 URL 反映新页）。
4. **事件隔离**：`page-title-updated` 沿用 active-only 判断——后台 tab 标题变化不广播（不打扰状态流），active 标题变化驱动 tab 条刷新。
5. **安全不变**：新 IPC 通道走 stripOnly 白名单；preload 不透传任意 channel；tab 条只显示自家面板页面（完整 url 与地址栏同权，非对外证据流）。

## 冒烟排障（两轮收敛，如实交底）

| 轮次 | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | S3~S7 全挂（"No handler registered for 'browser-panel:switch-tab'"） | stage15 漏注册 IPC 层——`registerBrowserPanelIpc` 只在 stage6/7 有，本轮新脚本没接；strip 点击的 invoke 全部无人接 | 补注册（同 stage6/7 姿态） |
| 2 | S6 断言不符；S7 detail 空 | ① `switchTabByUser` 把错误转 `{ok:false}` 后，stripOnly 包装是 `success:true`——**行为比断言预设的更正确**（handler 内转错误对象），修断言；② S7 用了 fake 才有的 `_bounds`，真机应 `getBounds()` | 改断言/改 API |
| 3 | — | — | **8/8** |

## 交底（欠账与边界）

- **tab 条无拖拽重排/中键关闭**（最小可用：点击切换 + ✕ 关闭）；tab 标题截断 40 字符。
- **user 手动切 tab 会改变 Agent 所见**：这是 panelView 恒=active 模型的既有语义；若 Agent 动作正飞（审批卡已出），用户切换后执行落在新 active 上——审批卡在浮层可见且 URL 反映执行前 binding，风险与 round11 语义一致，不额外锁。
- 累计欠账不变：windowOpenHandler 未动；screenshotBase64 上层消费；probe/extract 表达式双端两份；Windows smoke 1~15；loop 门禁 message 匹配；keyCode；insertText 清空；darwin 打包分支真机打包验证（round14）。

## 下一步

1. Windows 真机 smoke 1~15 补账（jz-win11-*）。
2. Mac 打包发版时验证 darwin userData 分支（round14 遗留）。
