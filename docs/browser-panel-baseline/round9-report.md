# Round 9 报告 — 阶段 7 续：press_key（按键）动作接通面板桥

日期：2026-09-03 ｜ commit：见 git log（本轮） ｜ 前序：round8（type，`066bb88a`）

## 结论

press_key 全链路接通面板桥：确认单签 `Input.dispatchKeyEvent`（loop 指纹已有映射），
执行 = **keyDown 消耗确认单（method 严格相等）+ keyUp 配对通道放行**（一次性、同面板、
键位一致、10s 内）。一次批准 = 一次逻辑按键，不弹两张卡。全量回归全绿。

## 改动文件

| 文件 | 改动 |
|---|---|
| `desktop/browser-panel-broker.js` | ① `isPairableFollowUp` 增加 `dispatchKeyEvent + type==='keyUp'`；② keyDown 成功后登记按键配对（`kind:'key'`，键位非空才登记）；③ `_consumeClickPair` 通道隔离：keyUp 只认按键配对且键位必须一致；insertText/mouseReleased 不许借按键配对、keyUp 不许借鼠标/输入配对（互不串门，fail-closed） |
| `backend/.../agent-browser-executor.service.ts` | 路由 press_key → `pressKeyViaPanel`：无单→签语义级单（label 按下按键 + key，无 selector 不探测）；approved→keyDown（消耗单）+ keyUp（配对），同单同键位；rejected 终态；pending 停留。**可打印单字符 keyDown 补 `text`**（CDP 无 text 不触发文本插入，对齐 Playwright keyboard.press 拟真语义）；"暂不支持"文案更新为 extract/goto/click/type/press_key |
| `desktop/browser-panel-broker.spec.js` | +5（39）：按键单全链 / 配对一次性 / 键位不匹配拒+烧单 / keyUp 借鼠标配对拒 / insertText+released 借按键配对拒 |
| `backend/.../agent-browser-executor.panel.spec.ts` | +5（40）：无单签单带 key 摘要 / approved Enter 全链（无 text）/ 可打印字符补 text（keyUp 不带）/ rejected 终态 / pending 停留；"暂不支持"用例 press_key→wait |
| `desktop/scripts/browser-panel-stage10-smoke.mjs` | 新（6/6） |

## 设计要点

1. **loop 零改动**：`panelMethodForAction('press_key')='Input.dispatchKeyEvent'` 映射
   早已就位；两阶段锁定/断链透传（第七轮）全泛化，press_key 天然复用。
2. **allowWrite 门禁窄语义（有意保留）**：loop `isWriteAction` 对 press_key 只认
   Enter/Tab——非 Enter 键不被 allowWrite=false 阻断，但 broker 侧 dispatchKeyEvent
   是 MUTATION，面板模式下任何按键都要确认单（fail-closed 兜底，无洞）。
3. **配对通道隔离**：`kind:'key'` 配对只认 keyUp + 键位一致；负向用例锁死三个方向
   （keyUp↛鼠标配对、insertText↛按键配对、released↛按键配对）。
4. **拟真键入语义**：可打印单字符 keyDown 带 `text`（真机实证 input 事件链触发）；
   功能键（Enter 等）只派发 keydown/keyup 事件链。

## 验证

| 项 | 结果 |
|---|---|
| backend `tsc --noEmit` | EXIT=0 |
| backend jest local-engine | 26 suites / **481** tests 全绿（teardown 泄漏为既有交底项） |
| desktop 9 个纯 node spec | **158** 条全绿（broker 39 / manager 17 / wiring 11 / bridge-server 19 / bridge-client 17 / registry 11 / runtime 8 / mode-registry 16 / approval-overlay 20） |
| Electron 真机 smoke 8 套 | stage1 11/11、stage2 9/9、stage5 11/11、stage6 9/9、stage7 7/7、stage8 6/6、stage9 6/6、**stage10（新）6/6** |
| `git diff --check` | 干净 |

stage10 真机实证：S3 Enter keydown 事件链（页面监听收到 `enter:<值>`）；S4 可打印
字符 'x' 补 text → 输入框值追加 + input 事件触发；S5 无单拒；S6 配对一次性 + 键位
不匹配拒 + 烧单后同单正确键位也拒。

## 坑

- CDP `Input.dispatchKeyEvent` 不带 `text` 时 Chromium 只发 keydown/keyup、
  **不触发文本插入**——可打印键必须补 text，否则"按了但没输入"的假成功。
- broker 的鼠标配对登记无 kind 字段（历史结构），按键配对用 `kind:'key'` 区分，
  `_consumeClickPair` 先判 keyUp 再判 kind，保证双向隔离且不破坏 stage1 双单基线。

## ⚠️ 交底（欠账照旧 + 新增）

- **windowsVirtualKeyCode 未合成**：个别依赖 keyCode 的页面逻辑可能收不到按键
  （事件链在但 keyCode=0），后续按需补 keymap。
- **press_key 无清空/组合键编排**：修饰键组合（Ctrl+C 等）需多步 keyDown/keyup
  序列，当前只支持单键单次；"清空输入框"语义仍未做（round8 交底延续）。
- 欠账不变：probe 仅主 frame；probe 表达式双端两份非单源；insertText 无清空/替换
  语义；3011 跨进程真实 userData 验证；Windows 真机 smoke（阶段 1~10 全未跑）；
  loop 门禁 message 字符串匹配（脆弱耦合）。

## 下一步

按 §4 顺序：**wait / tabs**（无 CDP mutation，设计待定：wait 纯本地延时或免单放行、
tabs 走 Target 域白名单扩展）→ extract 增强 → 3011 跨进程验证 / Windows smoke 补账。
