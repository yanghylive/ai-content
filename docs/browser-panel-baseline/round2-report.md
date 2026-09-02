# 第二轮报告：阶段 2 右侧 BrowserPanel UI

## 本轮目标

工作流文档 §4 阶段 2：右侧可收起、可调宽的浏览器面板（Electron `WebContentsView` + 本地控制条 + 3010 dock），UI 门禁全覆盖（空白/加载失败/导航超时/面板关闭/主窗口重建均有可读状态）；不迁移平台、不发版。

## 修改文件

### 新增（桌面侧）
| 文件 | 说明 |
|---|---|
| `desktop/browser-panel-manager.js` | 面板生命周期与布局：`open/hide/show/navigate/back/forward/reload/setWidth/resolvePanelTarget`；会话契约（§3.3 形状，含 partition 按账号持久化）；关闭=隐藏保留会话；换账号重建视图；导航仅 http/https；面板视图零特权（`sandbox:true`、无 preload、`contextIsolation:true`）；`setWindowOpenHandler` 一律 deny 并回报；状态机 `starting/ready/needs-human/blocked/stopped/error` 全事件广播 |
| `desktop/browser-control-strip.html` + `desktop/browser-control-strip-preload.js` | 本地受信控制条（地址栏/后退/前进/刷新/收起/左缘拖拽调宽 + 状态灯）；preload 通道白名单（对齐 tab-strip 安全模式） |
| `desktop/browser-panel-manager.spec.js` | 纯 node 契约测试 11 用例（布局几何/遮挡/最小最大宽度/会话保留/换账号重建/协议白名单/零特权/状态机/新 tab 拦截/strip sender/三方绑定） |
| `desktop/scripts/browser-panel-stage2-smoke.mjs` | 真实 Electron 验证 9 检查（S1a~S7），产出证据 JSON |

### 修改（存量文件，最小侵入）
| 位置 | 变更 |
|---|---|
| `desktop/workspace-tabs.js:137` + `relayout()` | 新增 `rightInset` 字段；业务标签视图宽度减去面板占用（面板打开时不遮挡 3010 主内容） |
| `desktop/main.js:76-92` | 实例化 `BrowserPanelManager`（注入 store/tabManager） |
| `desktop/main.js:886` | `createWindow` 中 attach（主窗口重建路径自动覆盖） |
| `desktop/main.js:2602-2649` | 面板 IPC：`open/state` 双通道 sender 校验（strip 视图或受信 3010 origin）；`navigate/back/forward/reload/hide/show/set-width` strip-only |
| `desktop/preload.js:108-116` | `electronAPI.browserPanel`（open/getState/onState/removeOnState，白名单 channel） |
| `frontend/src/types/electron-api.d.ts:42` | `browserPanel` 类型 + `BrowserPanelState/BrowserPanelSessionView` 契约 |
| `frontend/src/components/browser-panel-dock.tsx` | 新增：3010 浮动 dock（仅 Electron 渲染；输入网址开面板/开当前页；状态灯订阅） |
| `frontend/src/app/(dashboard)/layout.tsx:1022` | footer 挂 `<BrowserPanelDock />` |

## 协议/数据变化

- `electronAPI.browserPanel.open({url, ownerId?, tenantId?, accountId?, platform?}) → {success, state}`；状态经 `browser-panel:state` 双向广播（strip + 业务标签）。
- TabManager 新增 `rightInset`（面板→布局的唯一耦合面；阶段 3/4 Broker 直调 `resolvePanelTarget()`，不经 IPC 暴露 webContents）。
- 无数据库/后端接口变化（阶段 4 才接 3011）。

## 验证命令与结果

- `node desktop/browser-panel-manager.spec.js` — **PASS 11/11**（首跑 FAIL 2：换账号 partition 未更新=真 bug，已修 manager；stub `this` 绑定，已修测试）
- `electron desktop/scripts/browser-panel-stage2-smoke.mjs`（Mac 实跑）— **PASSED 9/9**：真实加载/控制条渲染/480 右列与业务视图零重叠/navigate 回读一致/goBack 生效/面板内 `browserControl+electronAPI` 均 undefined（零特权实证）/hide→stopped+rightInset 归零/show→ready+恢复/destroy 无泄漏
- `node desktop/browser-panel-broker.spec.js` — PASS 11/11（阶段 1 回归）
- `node desktop/scripts/browser-panel-smoke.mjs` — 阶段 1 P0 不受影响（manager 未触碰 broker）
- `node desktop/scripts/release-guards.test.js` — 全过
- 前端 `tsc --noEmit` 0；`eslint` 新改文件 0 问题
- 后端未改动（本轮无业务代码变更，全量基线 237 suites/2689 passed 仍有效）
- 证据路径：`docs/browser-panel-baseline/stage2-evidence-2026-09-02T16-37-22.json`

## 同页控制证据

- `resolvePanelTarget()` → `{panelId, sessionId, webContentsId}` 三方绑定（spec + smoke 双验）；面板 webContents 只在 main 进程内引用，IPC 不回传对象只回传状态。
- S4：navigate 后 `webContents.getURL()` 与会话 `currentUrl` 回读一致——控制条显示与 Agent 可读取的始终是同一文档。

## 未完成与风险

1. **控制条 → strip 通道的端到端 IPC 未在 smoke 里走真实 ipcRenderer**（strip 是本地视图，smoke 用 manager 直调等价路径 + sender 判定单测覆盖；真实点击链路进打包验收时随 dock 一起人工过一遍）。
2. **导航超时**：fixture 未显式造慢站；`did-fail-load`/`unresponsive`/`render-process-gone` 状态广播已覆盖（S6/spec），超时降级提示在 strip 文案层，属 P2。
3. **dock 的"开当前页"入口是过渡形态**：正式产品入口应在具体业务场景（阶段 5 平台迁移时逐点内置化），保留外部浏览器 fallback 按钮（文档 §4 阶段 5 要求），本轮未动 `openExternal` 任何调用点。
4. Windows 真机仍未跑（同阶段 1 风险，累积到打包验收）。

## 需要用户确认的事项

- 面板默认宽度 480 / 最小 360 / 最大 60%、dock 浮动按钮位置（右下 bottom:64）是否符合预期，或按产品口味调整。
- 批准后进入**阶段 3（会话与安全边界）**：capability token 持久化进 Broker、跨租户 fail-closed 全负向矩阵、Broker 与 manager 的 `resolvePanelTarget` 正式接线。
