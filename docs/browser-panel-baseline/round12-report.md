# browser-panel Round 12 报告：screenshot 接通面板桥——阶段 7 八动作全通

日期：2026-09-03 ｜ 对齐 round11 报告结构

## 结论

**screenshot 已接通面板桥，阶段 7 全部 8 个动作（extract / goto / click / type / press_key / wait / tabs / screenshot）面板模式全通。**
stage13 真机冒烟 8/8、desktop 9 spec 172 全绿、backend local-engine 491 全绿、tsc EXIT=0。

| 验证 | 结果 |
|---|---|
| stage13 真机冒烟（真实 manager + fixture 双页） | **8/8 PASSED**（PNG 魔数 / 尺寸 / fresh binding / 事件流无数据 / 销毁后 fail-closed） |
| desktop 9 spec | 172/172（本轮 desktop 产品代码**零改动**，回归确认无波及） |
| backend local-engine jest | **491/491**（489+2：executor.panel 46 + merge 17） |
| backend `tsc --noEmit` | EXIT=0 |

## 设计要点

1. **免单 readonly 观察类（同 extract/probe/wait 先例）**：`Page.captureScreenshot` 早已在 desktop 白名单 `READONLY_METHODS`，`panelMethodForAction('screenshot')` 保持 null（merge spec 原有锁定）。免单理由：不改变页面、无写副作用；loop 观察循环高频截图，弹审批卡是纯骚扰（wait 免单同理）。
2. **desktop 零改动**：broker/server 白名单与 readonly result 放行链路本轮均未动——smoke 实证 `Page.captureScreenshot` 直接 `sendCDPForAgent`（无单）即可执行。事件流 `readonly completed` 只带 method+target，**不含 base64**（stage13 S7 实证）。
3. **executor `screenshotViaPanel`**：`execute(Page.captureScreenshot {format:'png'})` → 取 `result.data`（空/缺失显式失败，不回退）→ result 加 `screenshotBase64` 专用字段，message 只报字节数**不携带数据**（防 base64 撑爆 message/日志/事件流）。
4. **敏感度交底**：截图是全页视觉，可能捕获用户没点名的内容（侧边聊天、自动填充），敏感度高于定向 extract——本轮按 extract 先例免单，将来可选"敏感页提示"增强，当前不做（记录欠账）。
5. `isWriteAction('screenshot')` = false（既有 default）→ `allowWrite=false` 会话也可截图（观察类，合理）；loop `mapTool('screenshot')` → 'snapshot' 策略审计映射既有。

## 文件清单

| 文件 | 改动 |
|---|---|
| `backend/.../agent-browser-executor.service.ts` | `AgentBrowserExecuteResult` 加 `screenshotBase64?`；路由 5.9 分支；新增 `screenshotViaPanel`；"暂不支持"文案更新（8 动作全列，删除"下一步"措辞） |
| `backend/.../agent-browser-executor.panel.spec.ts` | 原"暂不支持 screenshot"用例改写为未登记动作（`record_video`）+ 新 ⑫ 用例 2 条（免单全链断言 + 无数据显式失败） |
| `desktop/scripts/browser-panel-stage13-smoke.mjs` | 新，8 项真机场景 |
| `docs/browser-panel-baseline/round12-report.md` + `stage13-evidence-*.json` | 本报告 + 证据 |

desktop 产品代码（manager/broker/wiring/server）**零改动**。

## 冒烟排障（两轮收敛，如实交底）

| 轮次 | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | S8 "面板会话未登记" | S7 先 `manager.destroy()` 销了会话，S8 再查事件流自然失败——场景顺序错误 | 互换 S7/S8：事件流校验（销毁前查）提前 |
| 2 | S7 仍"未登记" | smoke 硬编码 `panelId='panel-1'`，真实 panelId 是运行时生成 | 改用 `manager.session.panelId` |
| 3 | — | — | **8/8** |

## 交底（欠账与边界）

- **截图敏感度**：免单策略下 Agent 可静默截屏（同 extract 先例）；报告记欠账，将来可选增强。
- **screenshotBase64 现只进 executor result**：上层（loop/前端展示）消费方式未接（旧无头 screenshot 本就是空操作，loop 拿 ok+message）；落盘/多模态观察是后续需求，本轮不扩。
- **未登记动作文案**改为"8 动作已全部接通，出现本提示说明解析层产出了未登记的动作类型"。
- 累计欠账不变：控制条 tab 条 UI 未做；windowOpenHandler 未动（window.open 仍 deny）；probe/extract 表达式双端两份非单源；3011 跨进程真实 userData 验证；Windows 真机 smoke 1~13 全未跑；loop 门禁 message 字符串匹配；keyCode 未合成；insertText 无清空语义。

## 下一步

1. **3011 跨进程真实 userData 验证**（累计最大欠账）。
2. 控制条 tab 条 UI（round11 遗留）。
3. Windows 真机 smoke 1~13 补账（jz-win11-*）。
