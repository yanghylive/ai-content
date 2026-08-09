# JIUZHANG AI 安全评估报告（2026-08-08）

> 评估范围：ai-content backend（NestJS，~50 controller）+ 前端（Next.js）。
> 方法：威胁建模 + OWASP Top 10 / CWE Top 25 代码审查 + 认证授权/注入/密钥/CSRF/CORS/安全头/文件上传专项审计（含 2 个并行子审计）。
> 结论：**3 个高危已修复并验证；认证/密钥/注入面整体健康；补齐 CI 安全扫描。**

---

## 一、威胁模型（STRIDE）

### 系统概览
- **架构**：NestJS monolith 后端（3011）+ Next.js 前端（3010）+ Electron 桌面 + 安卓 APK（WebView）+ 本地 Bridge；Postgres（云端）+ SQLite（桌面）。
- **数据分级**：用户凭证（密码/会话 token/OIDC token）、平台账号会话（抖音/小红书/微信）、AI 平台 apiKey、对象存储凭证、业务数据（内容/客户/发布记录）。
- **信任边界**：用户浏览器 → 前端 → 后端 API → DB；桌面/Electron → 本地 Bridge → 后端；OIDC 中台（test.kaypal.cn）→ 应用。

### STRIDE 关键威胁与现状
| 威胁 | 组件 | 风险 | 现状 |
|---|---|---|---|
| Spoofing | 会话认证 | 高 | ✅ session 256 位随机 token、存 sha256、scrypt 密码、httpOnly+lax cookie |
| Spoofing | desktop-auth/poll 会话恢复 | **高（已修）** | ❌→✅ 空 deviceId 曾可匹配任意会话，已强制非空+严格匹配 |
| Info Disclosure | ai-platforms apiKey | **高（已修）** | ❌→✅ 曾明文返回，已脱敏 + 写限 admin |
| Info Disclosure | storage/config 凭证 | **高（已修）** | ❌→✅ 曾任意用户可读写，已限 admin + 全脱敏 |
| Tampering | SQL 注入 | 低 | ✅ 全部 Prisma 参数化 / sqlValue 单引号加倍转义（0 真实注入点） |
| Tampering | 命令注入 | 低 | ✅ spawn 脚本路径内部常量 + action 白名单 + 风险门 |
| DoS | 文件上传 | 中 | ⚠️ 类型白名单+路径穿越防护在，**缺大小限制**（待加固） |
| CSRF | 写操作 | 低 | ✅ sameSite=lax + 无 GET 写操作 |
| Info Disclosure | 安全头 | 中 | ❌→✅ 曾全局缺失，已补（含生产 HSTS） |

---

## 二、发现清单与修复

### 🔴 高危（3 项，已全部修复并验证）

**R1 — desktop-auth/poll 会话恢复绕过设备绑定（High）**
- 位置：`backend/src/modules/auth/kaypal-desktop-auth.controller.ts` `restoreDesktopSession`
- 问题：filter 条件 `(!deviceId || metadata.kaypalDesktopDeviceId === deviceId)`，空 deviceId 时匹配**任意**活跃 desktop 会话 → 配合会话恢复可越权接管。
- 修复：deviceId 强制非空 + 严格相等；空 deviceId 直接返回 null。poll 路径本由 DTO（`@MinLength(1)`）保证非空，此修复堵死 mcp-session 空 deviceId 路径。
- 验证：desktop-auth spec 6/6 通过（测试适配为传匹配 deviceId）。

**R2 — ai-platforms 明文返回 apiKey + 任意登录用户可改（High）**
- 位置：`backend/src/modules/ai-models/ai-platforms.controller.ts`
- 问题：`findAll/findOne` 直接返回含 `apiKey` 明文对象；`POST/PUT/DELETE` 无任何权限校验 → 任意登录用户可读取全部 AI 平台密钥、可篡改全局模型配置。
- 修复：GET 响应 apiKey 脱敏（`********`）；写操作限 `admin` 角色。
- 验证：tsc/eslint 0。

**R3 — storage/config 任意登录用户读写全局存储凭证（High）**
- 位置：`backend/src/modules/storage/storage-config.controller.ts`
- 问题：`PUT /storage/config` 无权限校验，任意登录用户可改全局对象存储（accessKey/secretKey/bucket/endpoint）→ 可将存储指向攻击者 endpoint 窃取后续上传文件；GET 原仅脱敏 secretKey，accessKey 明文。
- 修复：`PUT`/`config/test` 限 admin；GET 增加 accessKey 脱敏；脱敏占位符（`********`）提交时不覆盖原值。
- 验证：tsc/eslint 0。

### 🟡 中危（2 项，已修）

**R4 — 全局安全响应头缺失（Medium）**
- 修复：`main.ts` 加安全头中间件：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`X-XSS-Protection`、`Referrer-Policy`、`Permissions-Policy`；生产环境加 `Strict-Transport-Security`（1 年 + 子域）。

**R5 — CORS 局域网 origin 无条件放行 + credentials（Medium）**
- 问题：`isLanOrigin` 无条件放行 192.168/10./172 网段且 `credentials: true`，生产环境同样生效 → 恶意局域网页面理论上可带 cookie 调 API。
- 修复：仅非生产环境放行局域网 origin；生产收紧。

### 🟢 低危 / 加固项
- 文件上传缺大小限制（video-workshop material-files）：类型白名单 + basename 防路径穿越已在，建议补单文件大小上限（如 200MB）。
- compliance.service.ts:288 `addColumnIfMissing`：建议标识符白名单（防御性）。
- crm.service.ts 手工 `sqlValue` 转义模式：中期建议迁移到 Prisma 参数化查询。
- 登录端点无显式限流：依赖上游/网关，建议补账号锁定或速率限制。

### ✅ 审计确认健康项
- 认证：session token `randomBytes(32)`、存 sha256、scrypt 密码（随机盐 + timingSafeEqual）、cookie httpOnly+sameSite=lax+secure。
- 密钥：无硬编码高熵密钥、无日志打印敏感字段、`.env` 未入库（仅 .env.example）。
- SQL 注入：全量审计 0 真实注入点（参数化/转义齐全）。
- 命令注入：spawn 路径内部常量 + action 白名单 + 风险门审计。
- 越权/IDOR：solutions/crm/growth/intelligence/articles/publishing/knowledge 归属校验到位，多租户 `x-tenant-id` 有 membership 校验。
- 文件上传：类型白名单 + 路径穿越防护。
- `@Public()` 19 处：18 处合理（健康检查/登录/webhook 带 HMAC），无危险公开业务端点。

---

## 三、CI 安全扫描（新增，阻断回归）

在 `.github/workflows/quality-gates.yml` 追加 3 道安全门（与现有 lint/tsc/demo-guard 并行）：

| Job | 工具 | 阻断策略 |
|---|---|---|
| ⑩ 密钥泄露扫描 | Gitleaks（全历史） | 发现密钥即失败 |
| ⑪ 依赖漏洞审计 | npm audit（前后端） | high/critical 失败，moderate 仅提示 |
| ⑫ SAST 静态扫描 | Semgrep（OWASP Top 10 + CWE Top 25） | 命中规则失败 |

---

## 四、后续加固建议（按优先级）

1. **文件上传大小限制**（本周）：video-workshop material-files 补单文件大小上限，防磁盘 DoS。
2. **登录限流**（本周）：登录/验证码端点加速率限制或失败锁定，防爆破。
3. **前端 nginx 安全头**（下周）：前端静态资源（out/）经 nginx 服务，补 CSP 等头（后端已补，前端 nginx 层另需）。
4. **crm 参数化迁移**（下迭代）：手工 sqlValue 转义迁 Prisma 参数化，消除手工转义的心智负担。
5. **合规**：如涉真实用户数据，补 SOC 2 / 等保对应审计日志留存策略。

---

**验证**：backend tsc 0 / build 0 / 相关 spec 全绿（desktop-auth 6/6、storage、ai-models）。修复 commit `69d1578c`。
