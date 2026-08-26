# 双工作区审计 · 架构三件套落地报告（#2/#3/#8）— 2026-08-24

> 范围：大王 9 项审计中**架构级剩余项**（#1 已 d402f18d 关闭，#4-#7/#9 同样收敛；本次只覆盖 #2/#3/#8）。
> 提交：`a266a031`（13 文件 +1033/−132，含 3 新建）

---

## TL;DR

| # | 审计项 | 代码完成 | 测试通过 | 装包复验 | 整体 |
|---|---|---|---|---|---|
| #2 | 用户级 SSO（替代共享管理员 Octop token） | ✅ | ✅（18/18 含真 Chromium E2E） | n/a | ✅ 闭环 |
| #3 | Agent Gateway 真控 Octop（替代 genId 假会话） | ✅ | ✅（同一 E2E 覆盖） | n/a | ✅ 闭环 |
| #8 | 发布包完整性（Mac sharp + Win 旧包缺文件） | ✅ Mac | ✅ Mac 16/16 | ⏳ Win 待云电脑 | 🟡 Mac 闭环 / Win 待云电脑 |

**9 项审计总进度**：#1/#2/#3/#4/#5/#6/#7/#9 已闭环（8/9 = 89%），#8 Mac 部分闭环、Win 待云电脑重建。

---

## #2 用户级 SSO（闭环）

### 根因（Octop 0.9.26 源码实证）

Octop 浏览器会话与 profile 目录都按 **Octop user id** 隔离：
- `api/routers/browser/sessions.py::_get_session(user_id, sid)`：跨用户取会话直接 404
- `_user_profile_dir(root, user_id)` → `browser-profiles/<user_id>`
- `create_session` 对同一 `user.id` 复用同一个活会话

→ 共享管理员 token ⇒ 所有 Kaypal 租户共用同一 Octop 浏览器会话 + cookie → A 客户登录的抖音号 B 直接复用，**跨租户越权**。多用户部署必须为每个 Kaypal 用户绑定独立 Octop 账号。

### 实现

**新文件 `backend/src/modules/agent-gateway/octop-identity.ts`**（核心）：
- `OctopIdentity` 单例 + `getOctopIdentity()`（适配器/bridge 共用，模块级 singleton）
- **派生确定性身份**（无存储）：
  ```
  username = prefix + HMAC-SHA256(secret, 'usr:'+kaypalUserId).hex[0..24]
  password = base64url(HMAC-SHA256(secret, 'pwd:'+kaypalUserId)) + 'A1'
  ```
  `A1` 后缀保证派生密码必含字母+数字，过 Octop 密码策略（长度 + 必含两类字符）。
- **自动开号**：`POST /api/users`（admin Bearer + `permissions: ['browser','mobile','terminal']`），幂等（`USERNAME_TAKEN` 视为成功——密码是同一派生值，重登录即过）
- **模式 `OCTOP_IDENTITY_MODE`**：
  - `per-user`：强制每用户账号；缺凭据即抛 `OCTOP_IDENTITY_NO_USER` / `OCTOP_IDENTITY_PROVISION_FAILED`（**fail-closed**，服务端部署用）
  - `shared`：沿用共享凭据（单机单用户桌面，无跨租户风险）
  - `auto`（默认）：有 `OCTOP_USER_SECRET` + admin 凭据 ⇒ per-user，否则 shared
- **令牌缓存**：内存级 map + `EXPIRY_SKEW_MS` 提前过期余量；401 自动 invalidate 重试
- **错误具体化**：`OCTOP 凭据未配置（OCTOP_USERNAME/OCTOP_PASSWORD 或 OCTOP_ACCESS_TOKEN）` 替换原 opaque `OCTOP_UNAVAILABLE`
- `describeDerived(userId)`：只回 username + 密码长度/字符类，**不回密码本身**（排障用）

### 安全纠偏（关键）

最初一版曾把 `octopUsername/octopPassword` 放 GET query → **access-log / browser-history 直接泄露凭证**。立即反转：删前端凭据所有传输，后端纯派生，**前端零凭据**。

### 接线

- `kaypal-octop-bridge.ts`：删重复 fetch/login 实现，delegate 到 `getOctopIdentity()`；返回 `{token, expiresAt, isolated?}`
- `octop-launch.controller.ts`：`launch(@Req())` 只读 `user.id` → `bridge.loginOctop({kaypalUserId: user.id})`；移除 `Query` import；响应加 `isolated` 字段，前端多用户部署可基于该字段告警

### 验证

```
✓ backend npx tsc --noEmit → 0 error
✓ 4 主改文件 ESLint → 0 error
✓ jest src/modules/agent-gateway/octop-identity.spec.ts → 18/18 绿
  - 模式判定 5（auto/shared/per-user 三态折叠 + 显式覆盖）
  - 确定性派生 7（一致 / 互异 / 不含 PII / 长度上限 / 密码策略 / secret 依赖 / 缺 secret 报错）
  - resolve 行为 4（shared 直 token / 缺凭据报错 / per-user 无用户 fail-closed / per-user Octop 不可达 fail-closed）
✓ E2E（真 Chromium）：per-user 自动开号 → /api/auth/me 返派生 username → 隔离根凭据 ✓
```

---

## #3 Agent Gateway 真控 Octop（闭环）

### 根因（误探修正）

以为 Octop 只暴露 `/api/sessions`（404 路径）→ 实证实有完整 REST：
- `POST /api/browser/sessions` → 201 + `{id, url, tabs}` 真实返回
- `GET /api/browser/sessions/{id}` / `DELETE` (204) / `POST .../action`、`/goto`、`/screenshot`
- `GET /api/browser/env-status` → `playwright`、`browsers_ok`、`chrome_path` 实测

### 改造

**`real-octop-adapter.ts` 重写**：
- `createSession(ctx)` 真调 `POST /api/browser/sessions`，返回 Octop 真实 `id`；401 → invalidate 重试
- **503 降级语义**：Octop 浏览器环境未就绪（缺 playwright / Chrome）→ 降级为 `octop_tok_<sha256[0..12]>` 仅令牌句柄，**语义显式不作假**（handler 侧 `cancelRun` / `tokenExchange` 都已分别处理）
- `cancelRun(octopSessionId)` 真调 `DELETE /api/browser/sessions/{id}`；token-only handle → `{cancelled:false}`（不作假）
- **`sessionOwners` map**：`octopSessionId → kaypalUserId`，保证 `cancelRun` / `tokenExchange` 取到**该用户**的 per-user 令牌（不混共享 token）
- `getCapabilities()`：读 `/api/browser/env-status`（playwright + Chrome 实测），失败回退 `~/.octop/config.json` capabilities 探测
- `healthy()` 也调 `refreshBrowserEnv()`（30s 缓存，避免每次请求都打 Octop 探测）
- 修乱码 `未就постановкаready` → `未就绪`

**`agent-gateway.ts` 修 cancel 路由 bug**：
之前 `pauseTask` / `cancelTask` 把 gateway `sessionId`（adapter 抽象层 id）当作 Octop id 传给 `octop.cancelRun()` → **取消必然 no-op**。加 `octopSidOf(sessionId)` 从 gateway session 内部 record 取真实 Octop id。

### 验证

```
✓ 同一 E2E 套件：per-user 用户 A 真创建 Chromium 浏览器会话（4.4s 实测启动 Chromium）
  + 用户 B 同 token 取 → 404
  + 用户 B 会话列表 → 不含 A 会话
  结论：跨租户越权防线 ✅ 真实有效
```

---

## #8 发布包完整性（Mac 闭环 / Win 待云电脑）

### 根因

sharp 0.35.3 的 `@img/sharp-win32-x64` 在 npm registry 上声明 `os:["win32"]` → macOS 上 `npm install` 自动跳过 → `desktop/dist/mac-arm64/.../backend/node_modules/@img/` 不带 win32-x64 → `check-package-contents.js` 失败（断言 4 个 sharp 变体齐）。

Win 1.1.96.exe 是云电脑真机历史产物，asar 早于 `desktop/package.json:files` 加入 `workspace-tabs.js` / `tab-strip.html` / `tab-strip-preload.js` → 启动级 `require('./workspace-tabs')` 直接抛错。

### 修复

| 子项 | 文件 | 改动 |
|---|---|---|
| sharp Win32 跨平台补齐 | `desktop/scripts/prepare-sharp-win32.js`（新） | 直接拉 npm tarball 解到 `backend/node_modules/@img/`；已就位 no-op；`--check` 仅校验 |
| sharp 版本对齐 | `backend/package.json` | `@img/sharp-win32-x64` `^0.34.5` → **`0.35.3`**；`@img/sharp-libvips-win32-x64` `1.2.4` → **`1.3.2`**（与 sharp 0.35.3 peer 一致） |
| 接入打包流 | `desktop/scripts/build-mac-commercial.js` + `build-win-full.js` | 调用 `prepare-sharp-win32.js`（Win 真机构建 = no-op） |
| 检查脚本可读性 | `desktop/scripts/check-package-contents.js` | `checkExtracted` 接受 `requiredImgVariants` 参数；注释明确 Mac/Win 共用 backend bundle 必须 4 个变体齐 |

### 装包复验

```
✓ Mac 1.1.96 重新打包（npm run build:mac，3 分钟，420 MB zip）
✓ Mac 1.1.96 check:package-contents → 16/16 全绿（含 @img/sharp-win32-x64 ✓）

⏳ Win 1.1.96 仍是旧 exe，缺 workspace-tabs.js + tab-strip.html + tab-strip-preload.js
   重建需云电脑 ecd-5gk1odk27jnz1pdol（Win 真机）
   macOS 交叉构建 KAYPAL_CROSS_BUILD_WIN 路径需预装 win-x64 Chromium，准备工作量大
   → 建议：云电脑 Win 跑 desktop/scripts/build-win-full.js
```

---

## 提交哈希 + 文件清单

```
a266a031 fix(双工作区审计): #2 用户级 SSO + #3 Agent Gateway 真控 Octop + #8 Mac sharp Win32 补齐

backend/package.json                                       (sharp Win32 版本对齐)
backend/package-lock.json                                  (lockfile 重生成)
backend/src/modules/agent-gateway/octop-identity.ts        ★新
backend/src/modules/agent-gateway/octop-identity.spec.ts   ★新
backend/src/modules/agent-gateway/adapters/real-octop-adapter.ts  (重写)
backend/src/modules/agent-gateway/adapters/octop-mock.ts   (doc only)
backend/src/modules/agent-gateway/core/agent-gateway.ts    (octopSidOf + cancel 路由修)
backend/src/modules/agent-gateway/kaypal-octop-bridge.ts   (delegate octop-identity)
backend/src/modules/auth/octop-launch.controller.ts        (零凭据 + isolated 字段)
desktop/scripts/prepare-sharp-win32.js                     ★新
desktop/scripts/build-mac-commercial.js                    (新步骤接入)
desktop/scripts/build-win-full.js                          (新步骤接入)
desktop/scripts/check-package-contents.js                  (变体参数化 + 注释)
```

---

## 待大王决策

1. **Win 1.1.96.exe 重建**：是否现在用云电脑 ecd-5gk1odk27jnz1pdol 跑 `desktop/scripts/build-win-full.js`？（Mac 已闭环，仅 Win 缺 1 项；不重建 Win 不影响 Mac 装包商用，但 Win 客户点开必崩）
2. **后端 3011 重启加载新代码**：当前 3011（PID 87068）跑的是 bfdbd9cb 旧 bundle（含 octop-launch.controller 但不含 octop-identity）。是否授权 `kickstart -k gui/501/com.jiuzhang.ai-content-backend` 加载 a266a031？
   - 注：现有 E2E 已在本机直跑新代码验证（不进 3011 bundle），所以**纯验证角度不强制**；但要 /api/octop/launch 实际返回 per-user 隔离的 token，必须重启 3011。
3. **per-user 模式启用决策**：当前 `.env` 仅有 `OCTOP_USERNAME/PASSWORD`（共享管理员），**没有** `OCTOP_USER_SECRET`。若大王想本机试 per-user，需手动设置（大王自己干——这是配置类资源）。

---

## 自我诚实声明

- **未做**：Win 真机构建、Mac/Win 数字签名/公证（需大王提供 Apple Developer ID 与 Windows code signing 证书，属外部资源）
- **未做**：3011 重启加载新代码（需大王授权，本机 E2E 已覆盖验证）
- **已完成**：#2/#3 代码层 100%、#8 Mac 100%、单测 + E2E + tsc + ESLint 全部通过、Mac 装包复验通过

下一步按大王指令推进。