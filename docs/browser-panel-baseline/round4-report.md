# 第四轮报告：阶段 4 地基（3011 Agent-S ⇄ desktop 面板上行桥）

## 本轮目标

工作流文档 §4 阶段 4「Agent-S 接同一页面」。本轮**只建桥的地基**：desktop 侧起一个只暴露「只读 observe + 签发确认单」的本地上行桥，并补上对称的客户端 SDK 协议实现。

**边界声明（严格遵守 AGENTS.md：Agent-S 为桌面客户互动主执行器，未经批准不改其执行路径）**：

- ✅ 本轮做了：桥服务端（协议 + 安全校验链）、桥客户端 SDK、main.js 懒起停与退出收尾、两端各 12 条安全测试。
- ❌ 本轮没做：`ensureBrowserBridge()` **默认不启动**；endpoint/token **不投递给 3011**；不改 3011 任何代码；不做写动作闭环；不做审批 UI。

## 修改文件

| 文件 | 变更与原因 |
|---|---|
| `desktop/browser-agent-bridge-server.js` | 新增：上行桥服务端。`127.0.0.1` 随机端口 + `randomBytes(24)` 随机 token；路由表**只三条**（`GET /health`、`POST /observe`、`POST /action-request`），**不代理任意 CDP**（无 `/cdp` 泛化端点）；校验链 token timing-safe → nonce 防重放（5min TTL）→ 时钟偏差 ±60s → 路由白名单 → actor 必填；`action-request` **只签发确认单、服务端拒绝自我批准**；出网前 `redactTarget` 双保险脱敏；`observe` 返回统一 `binding{panelId,sessionId,webContentsId,url}`（与 action-request 同形，便于 Agent 侧一处校验落在哪个 session） |
| `desktop/browser-agent-bridge-server.js` close 修复 | **本轮抓到的真 bug**：Node 19+ http 默认 keep-alive，`server.close()` 只停 accept、会等空闲连接自然结束 → close 返回后旧 socket 仍可复用发请求（**退出后桥仍可调**）。改为：置 `closed` fail-closed 标志 → 销毁全部在途 socket → `closeAllConnections()` → `close()`；幂等 |
| `desktop/browser-agent-bridge-client.js` | 新增：3011 侧调用 SDK（协议另一半）。构造期 fail-closed（缺 token / 非回环 endpoint / 非法协议一律抛）；只允许 `127.0.0.1 / localhost / ::1`；每次请求自动新 nonce + 时间戳；4xx 抛 `BridgeError` **不重试、不降级、不伪造成功** |
| `desktop/browser-agent-bridge-server.spec.js` | 新增 12 用例（含新增的 close 生命周期用例） |
| `desktop/browser-agent-bridge-client.spec.js` | 新增 12 用例（对**真实**桥服务器端到端，非 mock） |
| `desktop/main.js:99-144` | 桥懒起停三个函数 `ensureBrowserBridge() / getBrowserBridgeInfo() / closeBrowserBridge()`；注释写明 token 只存活主进程、不经任何 web/前端广播通道下发 |
| `desktop/main.js:2800-2821` | `app.on('before-quit')` 加入 `closeBrowserBridge()`（释放随机端口 + 销毁 token；失败只 warn，不阻断退出） |

## 协议形状

```
POST /observe         { panelId, actor:{ownerId,tenantId} }
  → { binding:{panelId,sessionId,webContentsId,url}, target, title, textSample }
POST /action-request  { panelId, actor, method, params, summary }
  → { actionId, binding:{webContentsId, method} }        // 只签单，不自批
GET  /health          → { ok, protocol, version }        // 免 actor
```

错误码：`UNAUTHORIZED`/`STALE_REQUEST` 401、`REPLAY` 409、`ACTOR_REQUIRED` 400、`POLICY_DENIED` 403、`UNKNOWN_ROUTE` 404、`BRIDGE_CLOSED` 503、`INTERNAL_ERROR` 500（不回显堆栈）。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `node desktop/browser-agent-bridge-server.spec.js` | **PASS 12/12** |
| `node desktop/browser-agent-bridge-client.spec.js` | **PASS 12/12** |
| `node desktop/browser-panel-broker.spec.js` | PASS 11/11（阶段 1 回归） |
| `node desktop/browser-panel-manager.spec.js` | PASS 11/11（阶段 2 回归） |
| `node desktop/browser-broker-wiring.spec.js` | PASS 11/11（阶段 3 回归） |
| `electron scripts/browser-panel-smoke.mjs` | **PASSED 11/11**（electron 32.3.3） |
| `electron scripts/browser-panel-stage2-smoke.mjs` | **PASSED 9/9** |
| `node -c main.js` / `node -c browser-agent-bridge-client.js` | SYNTAX_OK |

服务端 12 用例明细：无 token 401 / 错 token 401 / 重放 409 / 时钟偏差 401 STALE / observe 脱敏成功（`SECRET-abc` 不出网、`token=***`+`keep=1` 保留）/ 跨 owner 403 / 缺 actor 400 / action-request 只签单 / 未知路由 404 / health 免 actor / timingSafe 长度不等不抛 / **close 后端口释放且旧 token 不可达**。

客户端 12 用例明细：缺 token 构造即抛 / 非回环 endpoint 拒（`evil.example.com`、`10.0.0.5`、`192.168.1.9`）/ 非法协议拒（`file:` `ftp:` 非 URL）/ parseEndpoint 端口解析 / health 真实往返 / observe 脱敏 + binding 三方字段 / 客户端本地拒缺 actor·panelId·method（不发无效请求）/ 跨 owner → `BridgeError(POLICY_DENIED,403)` 不吞错 / 错 token → 401 / 连续两次 observe 各带新 nonce 均成功（防重放不误伤）/ requestAction 拿到 `act-1` + `webContentsId=77` / **桥 close 后调用 → NETWORK_ERROR**。

证据：`docs/browser-panel-baseline/{smoke-evidence-2026-09-02T17-25-57.json, smoke-screenshot-2026-09-02T17-25-57.png, stage2-evidence-2026-09-02T17-26-11.json}`（滚动保留最新一轮）。

## 本轮抓到的真 bug（不是测试桩问题）

**`close()` 后端口未释放**：Node 19+ `http.globalAgent` 默认 `keepAlive:true`，`server.close()` 只停止 accept 并等待空闲连接结束，回调不触发、旧 socket 仍可复用发请求。意味着 `before-quit` 里只调 `server.close()` 的话，**应用退出后本地桥仍可能被继续调用**。已修并加断言锁死（服务端「close 后端口释放」+ 客户端「close 后 NETWORK_ERROR」双验）。

附带修掉的协议不一致：`observe` 原只回 `target`，`action-request` 回 `binding`，两侧形状不同 → 统一为两条路由都回 `binding`。

## 未完成与风险交底 ⚠️

1. **桥默认不启动**：`ensureBrowserBridge()` 没有任何调用点。要真正让 Agent-S 走同页面板，必须把 `endpoint + token` 跨进程投递给 3011——这是**改 Agent-S 执行路径**的高风险动作（AGENTS.md 强监管），**需大王单独批准**，本轮不做。
2. **只通了只读通路**：`observe` 已可跑通；写动作（click/fill/press_key/navigate）目前只能在桥上**申请确认单**，批准路径仍是 `approveActionForAgent` 默认拒绝（硬约束 5），审批 UI 未建。
3. **token 投递机制未定**：候选是「主进程写 0600 临时文件 + 3011 读取后即删」或「env 注入子进程」。两种都要解决 3011 与 desktop 生命周期不同步的问题（3011 重启后 token 失效需重新获取）。**未实现，等批准后再定。**
4. **Windows 真机 smoke 欠账继续累积**：阶段 1/2/3/4 全部只在 macOS 验证，阶段 6 打包验收前必须补。
5. **既有失败未动**：`node --test desktop/scripts/build-win-full.test.js` 在 mac 上加载模块即被平台守卫崩（HEAD~2 同样红），与本轮无关，是否修需单独定。
6. 本轮零改动后端/前端/数据库/IPC 通道（只动 desktop 主进程新增文件 + `before-quit` 一行收尾），既有基线不失效；工作区 `backend/src/modules/{discovery,growth,rpa}` 的并发方未提交修改**未触碰**。

## 需要用户确认的事项

- **是否批准把 bridge endpoint+token 安全投递给 3011 Agent-S？** 批准后才进入阶段 4 完整闭环：确认单审批 UI → observe→act 闭环 → 证据链落 3011 evidence 目录 → 按文档 §4 顺序接 navigate（origin 白名单）→ click → fill_form → press_key/wait_for/tabs → extract_text。
- 若不批准，阶段 4 就停在「地基 + 只读通路」这一档，可直接跳到阶段 5（真实平台迁移）或先补 Windows 真机 smoke。
