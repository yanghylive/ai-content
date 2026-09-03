# Round 10 报告 — 阶段 7 续：wait（免审批等待）+ extract 定向提取接通面板桥

日期：2026-09-03 ｜ commit：见 git log（本轮） ｜ 前序：round9（press_key，`cd17b831`）

## 结论

wait 与 extract 两个动作接通面板桥，支持列表扩至 **6 动作**（extract / goto / click /
type / press_key / wait），仅剩 tabs / screenshot 明确失败不回退。

- **wait**：无 CDP 副作用（不动页面、无白名单命令）→ **不签确认单**（"等待 N 毫秒"
  的审批卡是骚扰），身份/面板可用校验仍走 `executeViaPanel` 前置；时长
  `clampPanelWaitMs` 收敛（floor、非法/负数→0、上限 30s），防天文数字卡死会话状态机。
- **extract**：替换旧 observe textSample 整页快照行为 → **定向提取**，对齐旧无头
  语义 `locator(selector).first().textContent() → trim → slice(0,2000)`；
  `text=` 与 probe 同构（精确→包含两轮、可见元素过滤），CSS 分支 `querySelector`；
  未命中 `found:false` → 显式失败，不回退无头。

backend-only 改动（broker / desktop 运行时零改动），全量回归全绿。

## 改动文件

| 文件 | 改动 |
|---|---|
| `backend/.../agent-browser-executor.service.ts` | ① 导出 `buildTextExtractExpression(selector)`（text= 精确→包含两轮+可见过滤；CSS querySelector first 语义；页面内 `slice(0, 2000)`）；② 导出 `PANEL_WAIT_MAX_MS=30_000` + `clampPanelWaitMs(ms)`；③ 路由 extract：observe textSample 整页快照 → `extractViaPanel`（Runtime.evaluate 定向提取，命中回 extractText+binding 证据，未命中 failed「面板模式：提取失败：选择器 … 无文本内容（不回退到无头浏览器）」）；④ 路由 wait → `waitViaPanel`（免单本地 setTimeout，message 带实际 ms 与截断说明）；⑤ "暂不支持"文案更新（仅剩 tabs/screenshot） |
| `backend/.../agent-browser-executor.panel.spec.ts` | extract 用例改写为定向提取（断言表达式含 selector 与 `slice(0, 2000)`）+ 未命中显式失败用例；新增 wait 免单执行（断言 requestAction/execute 均未调）、wait off 透传、`clampPanelWaitMs` 纯函数用例（静态 import）；"暂不支持"用例 wait→tabs；PanelBridgeError 用例桩 observe→execute。现 **40 用例** |
| `desktop/scripts/browser-panel-stage11-smoke.mjs` | 新（6/6）：CSS 提取 / text= 精确 / text= 包含 / 未命中 found:false / 3000 字符截断恰 2000 |

## 设计要点

1. **wait 免审批的理由**：确认单的语义是"授权 CDP 写操作"，wait 没有任何 CDP 命令、
   不碰页面——签单只会制造"等待 N 毫秒"审批卡骚扰。fail-closed 兜底不变：面板模式
   off 时 wait 同样透传失败（off 透传用例在）。
2. **时长收敛**：`clampPanelWaitMs` floor + 非法/负数→0 + 上限 30s，对齐旧无头执行层
   `Math.min(step.ms, 30_000)`——防 `ms: 1e12` 这类输入把会话状态机挂死半小时。
3. **extract 语义替换交底**：旧面板行为是 observe 的 textSample 整页快照（拿整页文本），
   本轮替换为按 selector 定向提取。语义差异：候选元素带**可见性过滤**，不可见元素
   提取不到（旧无头 locator 不要求可见）——`text=` 两轮匹配与 probe 同构故天然继承。
   loop 的 `observe()` 走 playwright-mcp 独立路径，与 extract 动作解耦，替换无影响。
4. **loop 零改动**：`panelMethodForAction('extract')` 指纹、两阶段锁定/断链透传
   全泛化复用。

## 验证

| 项 | 结果 |
|---|---|
| backend `tsc --noEmit` | EXIT=0 |
| backend jest local-engine | 26 suites / **485** tests 全绿（teardown 泄漏为既有交底项） |
| desktop 9 个纯 node spec | **158** 条全绿（broker 未改，确认无波及） |
| Electron 真机 smoke 9 套 | stage1 11/11、stage2 9/9、stage5 11/11、stage6 9/9、stage7 7/7、stage8 6/6、stage9 6/6、stage10 6/6、**stage11（新）6/6** |

stage11 真机实证：S2 CSS 提取 `#title`→`browser-panel-p0`；S3 `text=` 精确匹配按钮；
S4 `text=browser` 包含匹配 h1；S5 `#not-exist-s11` → found:false 显式失败；S6 页面内
临时造 3000 字符节点 → 提取恰好 2000 → 收尾 remove 无残渣。

## 坑

- jest（ts-jest）**未开 `--experimental-vm-modules`**：动态 `await import()` 报
  `A dynamic import callback was invoked`——纯函数用例必须文件头静态 import。
- extract 从 observe 改 execute 后，PanelBridgeError 用例旧桩只 stub了 observe →
  `this.panelBridge.execute is not a function`（报错类型也跟着变 POLICY_DENIED→
  PANEL_ACTION_FAILED）。改路由时配套桩必须同步，spec 抓出后已修。

## ⚠️ 交底（欠账照旧 + 新增）

- **extract 可见性过滤语义差异**（新增，见设计要点 3）：不可见元素提取不到，与旧
  无头 locator 行为有差异；当前以"probe 同构、显式失败不回退"为准则接受此差异，
  有真实页面踩到再议。
- **probe/extract 表达式双端两份**：backend `buildTextExtractExpression`（源码单源）
  vs stage11 冒烟内同构拷贝（注释已标明）——改提取语义必须两侧同步（既有欠账，本轮
  extract 落地后此债范围扩大）。
- **tabs 未做**：需扩展 CDP 白名单 Target 域（createTarget/closeTarget）+ 破坏
  "panelId→单 webContents"绑定前提（manager 多 view 模型），单独一轮做。
- 欠账不变：windowsVirtualKeyCode 未合成（keyCode=0）；组合键不支持；insertText 无
  清空/替换语义；3011 跨进程真实 userData 验证；Windows 真机 smoke（阶段 1~11 全
  未跑）；loop 门禁 message 字符串匹配（脆弱耦合）。

## 下一步

**tabs**（Target 域白名单 + manager 多 view 绑定，单独一轮）→ screenshot →
3011 跨进程验证 → Windows smoke 补账。
