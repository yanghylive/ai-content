# B 类真机验证 v2.2 真实根因诊断报告

**日期**：2026-09-05
**结论**：B 类真机功能仍 **BLOCKED**，但根因已精确锁定到「详情页 headless 被快手反爬拦截（result:2）」。
**代码层修复全部通过**，防假绿机制通过；卡点不再是脚本或解析选择器，而是平台风控。

---

## 一、复核结论 P1/P2 处理结果

| 项 | 状态 | 处理 |
|----|------|------|
| P1-1 真实关键词搜索跑通 | ⚠️ **仍 BLOCKED** | 根因新定位（见第二节） |
| P1-2 最新脚本未提交 | ✅ 已提交 `f48198ca`（v2.2） | 见第三节 |
| P1-3 插库阶段可能残留 session | ✅ 已修 | 整体纳入 try/finally + sessionInjected/accountInjected 布尔标记幂等清理 |
| P1-4 证据文件未形成闭环 | ✅ 已修 | `backend/docs/b-class-evidence/verify-kuaishou-2026-09-05T07-{49,52,55}-...FAIL.json` 三份 |
| P1-5 SHA 不能证明 bundle 干净 | ✅ 已修 | 证据加 `worktreeDirty`/`worktreeDirtyFiles` |
| P2 零副作用断言不完整 | ✅ 已修 | 加前后库快照（leads/interaction_events/comment_acquisition_leads/lead_signals/lead_score_snapshots/acquisition_quotas/comment_insights） |
| P2 端口探测未验证真实能力 | ⚠️ 未做（脚本只探测根路径，不调 Agent-S health/browserControl） | 见第四节 |

---

## 二、P1-1 真实根因（新定位）

之前误以为 P1-1 失败是「搜索降级推荐流」。新证据表明：

**搜索关键词本身这次通过了**，但**详情页 headless 被快手反爬直接拦截**。

### 证据 1：脚本断言透传成功

`e33deb72` 之前 `discoveryFallback=true` 是推荐流降级冒充关键词结果。
**这次 v2.2 三次跑（3013/3014）全部是 HTTP 500**，没有任何 `discoveryFallback=true`，说明**搜索没有降级**——真的搜到了关键词命中的内容 URL：`https://www.kuaishou.com/short-video/5227271991363579431`。

### 证据 2：搜索日志确认命中真实视频

```
[Nest] WARN [CommentAcquisitionService] [comment-acquisition] kuaishou 读评论失败
  （https://www.kuaishou.com/short-video/5227271991363579431）
  : 评论区未解析到评论（页面结构变化、评论区未加载或无评论）

[Nest] ERROR POST /api/comment-acquisition/scan 500
Error: kuaishou 关键词搜索命中的内容全部读评论失败（1 条），页面结构可能变化
    at CommentAcquisitionService.discoverByKeyword (...)
    at async CommentAcquisitionService.scanAccount (...)
```

`searchByKeyword` 成功 → `readComments` 打开详情页 → 评论区解析返回 `[]` → codex 之前修的「防吞异常」机制正确抛错。

### 证据 3：详情页 DOM 铁证（headless）

`backend/scripts/diag-kuaishou-comments.mjs` 直接打开同一个详情页（headless）：

```
=== 2. 页面文本前 600 字 ===
{"result":2,"error_msg":null,"request_id":"788594873553217410"}

=== 3. .comment-item 是否存在 ===
旧选择器 .comment-item 数量: 0

=== 4. 评论区候选 DOM（class 含 comment 的元素全列）===
[]

=== 5. 页面里所有 data-* 含 comment 的节点 ===
[]

=== 6. 页面是否出现「登录/验证码/请稍后」拦截 ===
{"hasLogin":false}
```

**截图 `backend/.kuaishou-comments.png` 显示页面 body 只有这一行 JSON，**没有任何真实 DOM**——快手风控直接拦截，详情页 HTML 根本没下发。

### 根因判定

**详情页 headless = 快手反爬拦截（result:2）**，与选择器失效无关。
原因候选：headless 指纹检测（`--disable-blink-features=AutomationControlled` 不够）、IP 频率风控、或快手对详情页有更严格的 anti-bot（搜索页不拦但详情页拦）。

### 已知边界（不动）

- 小红书（登录 expired）：本次未跑
- replyComment（回复链路）：本次未跑
- 小红书搜索→详情页点击：本次未跑
- 抖音 scan：未在本次跑（已知抖音走 searchAccounts 三段式，与快手/小红书不同路径）

---

## 三、v2.2 脚本与证据

### 脚本提交

- Commit: `f48198ca fix(verify): 验证脚本 v2.2——插库全纳入 try/finally + 库快照零副作用断言`
- 文件: `backend/scripts/verify-b-class-realmachine.mjs`（+192/-52 行）
- 头部注释版本号：v2.1 → **v2.2**（P1-3 + P1-5 + P2 三项修复）

### 关键改动（脚本 v2.2）

1. **P1-3 修复**：session 注入（3a）+ 账号插入（3b）+ scan 调用（3c/d）+ 快照对比 整体移入 try 块，finally 用 `sessionInjected`/`accountInjected` 布尔标记幂等清理。即使「session 注入成功、账号插入失败」也会清掉 session，不会残留。
2. **P1-5 修复**：证据加 `worktreeDirty: boolean` + `worktreeDirtyFiles: string[]`——脏工作区无法证明运行 bundle 干净，证据明确标注。
3. **P2 修复**：scan 前对 7 张表拍 before 快照，scan 后拍 after 快照，逐表对比；任意一张表行数变化 → `snapshotNoSideEffect: false` → FAIL。

### 证据

`backend/docs/b-class-evidence/`：

```
verify-kuaishou-2026-09-05T07-49-08-403Z-FAIL.json  (v2.1 → v2.2 commit，3013 端口)
verify-kuaishou-2026-09-05T07-52-30-198Z-FAIL.json  (v2.2 commit，3014 端口，自己起的)
verify-kuaishou-2026-09-05T07-55-40-517Z-FAIL.json  (v2.2 commit，3014 端口再跑确认稳定)
```

每份证据含：
- `commitSha`: `f48198ca`（脚本 commit）
- `bundleHash`: `bbdb249f7a1d5f22...`（dist-bundle-sqlite sha256 前 16 位）
- `worktreeDirty: true` + 完整脏文件列表
- `portStatus`: 3013/3014/3011 三端口实时探测
- `httpStatus: 500` + 完整 body（success/data/message/timestamp/path/requestId/traceId/retryable）
- `assertions`: http2xx=false, scannedPositive=false, notFallback=true, readOnlyNoSideEffect=false, snapshotNoSideEffect=true
- `snapshot`: 7 张表前后行数
- `cleanup`: session=deleted, account=deleted-and-verified

---

## 四、未做项（诚实交底）

1. **P2 端口探测深度**：脚本只 `GET /`，没探 `/api/agent-s/health`、`/api/browserControl`、Chromium 真执行能力。复跑证据里有三端口，但只证明 HTTP 进程活着，不证明 B 类业务端到端。
2. **headful 对比**：写好了 `diag-kuaishou-comments-headful.mjs` 但**未跑**（headful 会弹真实窗口打扰用户）。理论预期是「headful 能过详情页 + 登录态过期」，但**没有真实证据**，不能写进结论。
3. **小红书 + replyComment + 抖音**：本次全部未跑。
4. **B 类整体验收**：仍 **BLOCKED**。代码层修复通过 ≠ 真机功能通过。

---

## 五、待用户拍板

1. 是否允许弹真实 headful 窗口跑详情页对比脚本，确认 headless 风控是 headful 特有还是 IP/账户风控？
2. 快手 kuaishou-2 登录态是否需要重新扫码续期（之前 summary 提到「登录态过期」）？
3. 小红书 xhs 登录态是否需要重新扫码（expired 状态）？
4. 是否对快手切 headful + 设备指纹伪装作为产品决策？（涉及性能/成本/真实性权衡）

---

## 六、相关提交

- `f48198ca` fix(verify): 验证脚本 v2.2——插库全纳入 try/finally + 库快照零副作用断言
- `e33deb72` fix(comment-acquisition): 透传推荐流降级标记 + 防吞异常 + 重写验证脚本（之前已交）
- 诊断脚本（本次新，未提交）：
  - `backend/scripts/diag-kuaishou-comments.mjs`（详情页 headless DOM 诊断）
  - `backend/scripts/diag-kuaishou-comments-headful.mjs`（headful 对比，待跑）