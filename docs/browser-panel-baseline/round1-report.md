# 第一轮报告：阶段 0 基线 + 阶段 1 同页控制 P0 验证

## 本轮目标

只验证工作流文档 §9 的硬命题：**用户看到的页面、Agent 读取/操作的页面、截图证据对应的页面，是同一个 `sessionId / webContentsId / 页面目标`**。未做右侧 UI、未迁移任何平台、未提交发布包。

## 修改文件

| 文件 | 变更与原因 |
|---|---|
| `desktop/browser-panel-broker.js` | 新增：阶段 1 最小 Broker——`panelId→webContents→browserSession` 映射、capability token 鉴权（过期/重放/错 owner fail-closed）、CDP 方法白名单、写动作一次性确认单（绑定 webContentsId，页面目标变化即作废）、统一事件流（panel.created / action.requested / action.approved / action.started / action.completed / blocked） |
| `desktop/browser-panel-broker.spec.js` | 新增：Broker 契约纯 node 测试 11 用例（含负向：错 token、过期 token、跨用户不可见、确认单重放拒绝、换页作废、非 persist 分区拒绝） |
| `desktop/test-fixtures/browser-panel.html` | 新增：P0 测试页（计数器按钮/输入框/键盘回显/用户事件通道/window.open 触发器） |
| `desktop/scripts/browser-panel-smoke.mjs` | 新增：Electron 内 P0 同页控制验证脚本（C1~C7 共 11 检查，产出证据 JSON + 截图 hash） |
| `docs/browser-panel-baseline/baseline-20260903T000008.md` | 新增：阶段 0 基线证据（commit/版本/健康/外开调用点清单/底座复用点/风险交底） |

## 协议/数据变化

- `BrowserPanelSession` 契约已按文档 §3.3 立形状（panelId/sessionId/ownerId/tenantId/accountId/platform/partition/currentUrl/status）。
- Broker 对上层只暴露 `requestAction/approveAction/sendCDP/resolveTarget`，不暴露裸 CDP（白名单强制）。
- 未改动 3011 / 3010 任何现有接口；未动 `desktop/main.js`（阶段 2 才接入）。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `node desktop/browser-panel-broker.spec.js` | **PASS 11/11** |
| `ELECTRON=... electron desktop/scripts/browser-panel-smoke.mjs`（Mac 实跑） | **PASSED 11/11**（electron 32.3.3） |
| Windows 静态兼容检查 | PASS：无 mac-only 路径/无 darwin 硬编码；所用 CDP 域（Input/Page/DOM/Accessibility/Runtime）均为 Electron 跨平台标准能力 |
| 后端/前端 tsc、jest | 本轮未改业务代码，上轮全量基线仍有效（237 suites/2689 passed） |

## 同页控制证据（核心）

- **panelId**: `panel-p0` / **sessionId**: `sess-p0-001` / **webContentsId**: `3`
- Broker `resolveTarget` 三方一致断言：`sameWebContents=true, sameSession=true`
- before/after URL: `http://127.0.0.1:<随机端口>/browser-panel.html`（加载、动作、回读全程一致）
- C4a：CDP 点击 → `counter 0→1`（真实 DOM 变化）；C4b：`Input.insertText`+Enter → 页面回显 `enter:agent-typed`
- C5：页面内"用户通道"键入 `user-typed-abc` → **CDP Runtime.evaluate 同帧读到**（同文档对象）
- C6：CDP 读 `field.value` 与页内 `__panelProbe()` 完全一致，URL 与 Broker 记录一致
- C7：`window.open` 被 setWindowOpenHandler 拦截可观测；导航失败 `did-fail-load` 可读；失败后可恢复
- 截图证据：`smoke-screenshot-2026-09-02T16-15-25.png`（34550B，sha256/16=`7b2c179120d7caba`，webContentsId=3）
- 事件流 29 条全带 `panelId+sessionId+webContentsId`（action.requested/approved/started/completed 各 7）
- 证据文件：`docs/browser-panel-baseline/smoke-evidence-2026-09-02T16-15-25.json`

## 未完成与风险

1. **Windows 真机未跑**：本轮按文档只做了静态兼容检查；正式验收前应在 jz-win11 云电脑跑一次同一 smoke（文档 §4 阶段 6 要求 Mac/Windows 双平台验证，届时一并做）。
2. **窗口必须可见**：`show:false` 时 `Page.captureScreenshot` 会挂起（无合成帧）、真实输入不派发——阶段 2 面板设计时注意（隐藏≠销毁之外还要处理"窗口最小化/遮挡"场景的截图策略，可能需 `osr` 或显示态约束）。
3. **Broker 是形状验证**：capability token 目前内存态、事件未持久化——阶段 3/4 接入真实会话存储与 3011 证据链（文档已排期，不是缺陷）。
4. 工作区历史存在并发修改方提交（main 前进到 `8690813c`），本轮文件与其无交集。

## 需要用户确认的事项

- 是否批准进入**阶段 2（右侧 BrowserPanel UI）**，或先在 jz-win11 云电脑补一次 Windows smoke 再放行。
