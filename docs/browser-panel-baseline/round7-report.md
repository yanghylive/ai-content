# 浏览器面板 第七轮报告：click 动作接通面板桥（阶段 7）

> 2026-09-03 · 执行：二狗 · 指令：大王「先开发」
> 上一轮：round6（commit `4433bb06`，灰度开关 ③ 全链路）

## 结论

**click 动作全链路已接通**：backend executor `clickViaPanel` + broker「一次批准=一次逻辑点击」配对通道 + loop 确认单透传断链修复。全量回归全绿 + stage8 真机冒烟 6/6。**未提交前欠账照旧交底（见 ⚠️）**。

## 改动文件

| 文件 | 改动 |
|---|---|
| `desktop/browser-panel-broker.js` | ① 构造加 `_clickPairs` Map；② mutation 分支加配对放行（released 且单已被 pressed 消耗时走 `_consumeClickPair`）；③ pressed 执行成功后登记配对（10s TTL）；④ 新增 `_consumeClickPair`（先烧单再校验：同面板/未超时/坐标 ≤4px，fail-closed） |
| `desktop/browser-panel-broker.spec.js` | +5 条配对用例（一次批准覆盖一次点击 / 无单 released 拒 / 偏移>4px 拒且烧单 / 配对一次性 / 超时拒），24→**29** |
| `backend/.../agent-browser-executor.service.ts` | ① `AgentBrowserExecuteInput` 加 `actionId?`（loop 锁定单透传）；② 路由 click；③ 模块级导出 `buildSelectorProbeExpression`（text= 精确→包含两轮匹配、可见元素过滤、JSON.stringify 防注入、仅主 frame）；④ `probeSelector`（readonly `Runtime.evaluate`）；⑤ `clickViaPanel`：无单→先 probe（元素不存在不签单）→签语义级单（label/selector/targetText）；approved→markApproved→**执行时重新解析坐标**→pressed+released 同单；rejected→终态收口；⑥「暂不支持」文案改 type（类型里无 fill_form，已核对 AiBrowserAction） |
| `backend/.../agent-browser-loop.service.ts` | **修真断链**：`executeWithRetry` 加第 7 参 `panelActionId` 透传 `exec.execute({actionId})`；调用点传 `lockedConfirmationId`。此前 loop 锁单后 id 从未到 executor，重试会再签新单（用户批一张废一张，死循环；C3 未暴露因 executor 是桩） |
| `backend/.../agent-browser-executor.panel.spec.ts` | +5 条 click 用例（无单 probe→签单带 sessionId/摘要、probe 未找到不签单、approved→markApproved+pressed/released 同单同坐标、rejected 终态、approved 但执行时元素消失不盲点）；旧「click 暂不支持」改「type 暂不支持」。24→**29** |
| `backend/.../agent-browser.spec.ts` | P1/P2 两阶段用例补断言：`executeSingle` 被调时携带 `actionId:'c-1'`（锁断链） |
| `desktop/scripts/browser-panel-stage8-smoke.mjs` | 新，真机冒烟 6 项（下表） |

## 设计要点

1. **一次批准 = 一次逻辑点击**：一次 click = mousePressed + mouseReleased 两次 CDP，只有一张确认单。pressed 消耗单后登记 `{panelId,x,y,expiresAt+10s}`；released 走 `_consumeClickPair`：**先 delete 烧单再校验**（一次性、同面板、≤4px、10s 内）。
2. **审批是语义级**：确认单 summary 带 selector+目标文本（不带坐标）；批准后执行时**重新解析坐标**——页面可能已滚动/元素移动，防点偏；元素已消失则显式失败不盲点。
3. **无单先 probe 再签单**：元素不存在就不签单，用户不看到一张注定废掉的死卡片。
4. **released 兼容双单模式**：released 携带一张**完整未消耗**批准单时仍可经 `_consumeApproval` 放行——stage1 smoke（browser-panel-smoke.mjs）的 pressed/released 双单基线依赖此语义，有意保留。产品路径（executor）只走单单+配对。

## 验证

| 项 | 结果 |
|---|---|
| backend `tsc --noEmit` | EXIT=0 |
| backend jest local-engine | 26 suites / **470 tests** 全绿（465→470） |
| desktop 9 node spec | 148 条全绿（broker 24→29，其余不变） |
| Electron 冒烟 stage1/2/5/6/7 | 11/11、9/9、11/11、9/9、7/7 |
| **stage8（新，真机）** | **6/6**：S1 fixture 加载；S2 同构探测出真实坐标；S3 单单一次点击计数恰好 +1；S4 偏移>4px 拒+烧单+计数不变；S5 无单 released 拒；S6 配对一次性第二次拒、计数只 +1 |
| `git diff --check` | 干净 |

证据：`docs/browser-panel-baseline/stage8-evidence-2026-09-03T08-23-16.json`

## ⚠️ 交底（未解决/有意保留）

1. **probe 仅支持主 frame**：跨 iframe 元素探测不到 → found:false → 不签单。当前平台页无此场景，真遇到会显式失败（不假成功）。
2. **released 可消耗新批准单**（见设计要点 4）：语义上「只点一半」可消耗一张完整单（无 click 效果，DoS 而非提权），为保 stage1 基线保留；若要收紧需同步改 stage1。
3. **stage8 的 probe 表达式是同构拷贝**（非 require backend 源码）：表达式一致性目前靠 backend 单测（probeSelector 走桥 mock）+ stage8 同构验证，**未做源码级单源**。后续可考虑把表达式抽成共享 JSON/JS 文件双端引用。
4. **3011 跨进程真实 userData 验证**欠账照旧（round6 遗留，未动）。
5. **Windows 真机 smoke** 未跑（本机 macOS 32.3.3）。
6. loop `executeWithRetry` 门禁类失败不重试的判断靠 message 字符串匹配（`需用户确认` 等），click 的失败文案已兼容（含「需用户确认」），但这是脆弱耦合，后续轮次建议改结构化 code。

## 下一步（按 §4 顺序）

- `type`（输入）→ `press_key` / `wait` / `tabs` → `extract_text`
- 3011 跨进程真实 userData 验证（欠账）
- Windows 真机 smoke；真实平台迁移；打包验收
