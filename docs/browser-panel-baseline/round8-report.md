# 浏览器面板 第八轮报告：type（输入）动作接通面板桥（阶段 7 续）

> 2026-09-03 · 执行：二狗 · 指令：大王「继续」
> 上一轮：round7（commit `e62b17a7`，click 全链路）

## 结论

**type 动作全链路已接通**：确认单签 `Input.insertText`（与 `panelMethodForAction` 指纹一致，loop 闸门可锁定），执行 = 聚焦 mousePressed（method 组匹配消耗单）+ insertText（配对通道放行）。全量回归全绿 + stage9 真机冒烟 6/6。

## 改动文件

| 文件 | 改动 |
|---|---|
| `desktop/browser-panel-broker.js` | ① `_consumeApproval` method 组匹配：**insertText 型确认单只允许聚焦半步（mousePressed）消耗**（首版漏限 params.type，released 也能借道——负向用例抓出后收紧）；② 配对续作扩展 `Input.insertText`（免坐标）；③ `_consumeClickPair` 坐标校验只对带数值坐标的续作生效；**mouseReleased 不带坐标 → fail-closed 拒绝**（堵住免坐标绕过） |
| `desktop/browser-panel-broker.spec.js` | +5 条（输入单聚焦+配对闭环 / insertText 直接消耗完整单 / 配对一次性 / released 不许借输入单 / released 无坐标拒），29→**34** |
| `backend/.../agent-browser-executor.service.ts` | 路由 type → `typeViaPanel`：无单→probe（不存在不签单）→签 insertText 型单（摘要带 40 字符文本预览）；approved→落库→重新 probe 聚焦坐标→pressed（消耗单）→insertText（配对）；rejected→终态；执行时元素消失不盲输。文案改"仅支持 extract / goto / click / type" |
| `backend/.../agent-browser-executor.panel.spec.ts` | +6 条 type 用例（签单带 sessionId+预览 / 长文本截断 / 不签单 / approved 全链 / rejected 终态 / 元素消失）；"暂不支持"改 press_key。29→**35** |
| `desktop/scripts/browser-panel-stage9-smoke.mjs` | 新，真机冒烟 6 项 |

## 设计要点

1. **确认单 method = `Input.insertText`**：loop 面板单指纹按 `panelMethodForAction('type')` 比对，签别的 method 闸门不放行。一次逻辑输入覆盖两步 CDP：聚焦（dispatchMouseEvent mousePressed，组匹配消耗单）+ insertText（配对，免坐标）。
2. **组匹配严格收紧**：只有 mousePressed 可消耗 insertText 单；mouseReleased 借道被负向用例拦死。
3. **released 必须带坐标**：`_consumeClickPair` 对无坐标的 released fail-closed（不能借 insertText 的免坐标通道绕过偏移校验）。
4. **insertText 直接消耗完整单**（页面焦点已在目标时无需聚焦）也是合法路径——语义完整、fail-closed 不受损。

## 验证

| 项 | 结果 |
|---|---|
| backend `tsc --noEmit` | EXIT=0 |
| backend jest local-engine | 26 suites / **476 tests** 全绿（470→476） |
| desktop 9 node spec | **153 条**全绿（broker 29→34，其余不变） |
| Electron 冒烟 stage1/2/5/6/7/8 | 11/11、9/9、11/11、9/9、7/7、6/6 |
| **stage9（新，真机）** | **6/6**：S3 聚焦(带单)+insertText(配对)→值正确 **且 input 事件触发**（`#userops` 变 `input:agent-typed-s9`，证明走真实输入管线，React/Vue onChange 类监听收得到）；S4 无单拒；S5 配对一次性；S6 released 借道拒 |
| `git diff --check` | 干净 |

证据：`docs/browser-panel-baseline/stage9-evidence-2026-09-03T09-04-09.json`

## 本轮抓到的坑（含真机才暴露的）

1. **首版组匹配漏限 params.type**：insertText 单被 mouseReleased 也消耗了（released 同属 dispatchMouseEvent）——spec 负向用例抓出，收紧为"仅 mousePressed"。**unit 测试先行设计生效的一例**。
2. **真实点击聚焦 = 光标落在点击位置**（stage9 真机暴露）：insertText 在光标处插入而非末尾——S5 首跑 mid.field=`agent-typedagent-typed-s9-s9`（中间插入）。这不是 bug，是"拟真输入"的正确行为，但**上层 AI 需知道**：输入位置取决于点击落点。已写进冒烟断言注释。
3. 冒烟脚本首版断言读了 `__panelProbe()` 不存在的 `userops` 字段——fixture 探针没这字段，改用 evaluate 直接读 `#userops`。

## ⚠️ 交底

1. **insertText 不清空已有内容**（追加式，光标处插入）：旧无头路径是 Playwright `fill()`（清空后设值）。语义差异真实存在——需要"替换"语义时上层应先清空（后续轮次议是否加 clear 动作或双击全选前置步）。
2. 摘要文本预览会展示输入内容（截 40 字符）——面板是本机 UI、给用户本人看，不算凭据外泄面；若未来输入密码类字段需评估是否掩码。
3. 欠账照旧：3011 跨进程真实 userData 验证、Windows 真机 smoke（阶段 1~9 全未跑）、probe 表达式双端两份非单源。
4. loop 门禁失败判断仍靠 message 字符串匹配（"需用户确认"），type 文案已兼容，脆弱耦合照旧。

## 下一步（按 §4 顺序）

- `press_key`（dispatchKeyEvent——注意 keyDown/keyup 也是两步，需同款配对或单单放行设计）→ `wait` / `tabs` → extract 增强
- 3011 跨进程真实 userData 验证（欠账）；Windows 真机 smoke；真实平台迁移；打包验收
