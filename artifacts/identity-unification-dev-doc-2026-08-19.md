# ai-content 登录账号统一 — 开发文档（实施版）

**日期**：2026-08-19
**决策基线**：A1（手机号+验证码，接短信服务）/ B1（合并数据全转移）/ C1（本轮接入 Kaypal 统一身份）/ D1（申请微信手机号快速验证）
**关联**：方案文档 `artifacts/identity-unification-plan-2026-08-19.md`
**代码基线**：main @ `465fc4a6`（历史已重写，旧 clone 需重新拉取）

---

## 0. 目标与范围

| 项 | 内容 |
|----|------|
| 目标 | 一人一账号：微信 / 手机号 / 账号密码 / Kaypal 身份，任一种登录都收敛到同一 User |
| 不在范围 | 多租户改造、权限体系重构、前端登录页视觉重做（只改交互逻辑） |
| 破坏性 | 新增表 + User 加列；存量 `wechat-${openid}` 账号迁移；**无**存量数据自动合并 |

## 1. 数据模型（Prisma schema 变更）

### 1.1 新增 `UserIdentity` 模型
```prisma
model UserIdentity {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider   String   // password | phone | wechat_app | wechat_scan | kaypal
  identifier String   // 用户名 / 手机号 / openid / unionid / kaypalUserId
  secret     String?  // passwordHash（password/phone 密码用）；第三方登录 null
  meta       Json     @default("{}")  // 昵称/头像/unionid/绑定时间快照
  boundAt    DateTime @default(now()) @map("bound_at")
  createdAt  DateTime @default(now()) @map("created_at")

  @@unique([provider, identifier])
  @@index([userId])
  @@map("user_identities")
}
```

### 1.2 `User` 表变更
```prisma
model User {
  // ...现有字段保留
  phone      String?  @unique @map("phone")   // 主手机号（登录/绑定后回填）
  identities UserIdentity[]
  // kaypalUserId 已存在，继续作为 kaypal provider 的 identifier
}
```

### 1.3 迁移
- PG 手写迁移 `20260819210000_identity_unification`（CREATE TABLE user_identities + ALTER users ADD phone）
- SQLite 运行时 DDL 兜底（`src/prisma/prisma.service.ts` 追加建表 + 加列，对齐现有模式）
- 存量 `wechat-${openid}` 账号迁移脚本：见 §6

## 2. 后端 API 设计

### 2.1 新增端点

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/auth/phone/send-code` | 发短信验证码（A1） | Public + 限流(1条/60s/手机号) |
| POST | `/auth/phone/login` | 手机号+验证码登录（无号自动建号） | Public + 限流 |
| POST | `/auth/bind/phone` | 已登录状态下绑定手机号 | Auth |
| POST | `/auth/bind/wechat` | 已登录状态下绑定微信 | Auth |
| POST | `/auth/merge/request` | 发起合并（检测到另一账号） | Auth + 二次验证码 |
| POST | `/auth/merge/confirm` | 确认合并（短信/密码二次验证） | Auth |
| GET | `/auth/me/identities` | 查询当前账号已绑定的登录方式 | Auth |
| DELETE | `/auth/bind/:identityId` | 解绑某登录方式（至少保留一种） | Auth |

### 2.2 修改端点

| 端点 | 改动 |
|------|------|
| `POST /auth/login` | 密码校验改为查 `UserIdentity(password, username)`；保留兼容（username 仍是入口） |
| `POST /auth/wechat-app-login` | 不再用 `wechat-${openid}` 建号——查 `UserIdentity(wechat_app, openid)`；无则按 §4.3 尝试绑定/建号 |
| `GET /auth/wechat/callback`（kaypal 扫码） | 解析 kaypalToken → kaypalUserId → 查/建 `UserIdentity(kaypal, kaypalUserId)`，同时**拉 kaypal 用户资料回填 phone/email**（C1） |

### 2.3 统一登录服务（核心）

`src/modules/auth/identity-login.service.ts`（新增）：
```ts
async loginWithIdentity(input: {
  provider: IdentityProvider;      // password | phone | wechat_app | wechat_scan | kaypal
  identifier: string;              // username / 手机号 / openid / unionid / kaypalUserId
  secret?: string;                 // 密码 / 短信验证码（外部校验后传 null）
  profile?: { nickname?; avatar?; phone?; unionid? };  // 第三方登录授权资料
}): Promise<{ user: User; sessionToken: string; isNewUser: boolean }>
```

流程（伪代码）：
```
1. identity = findUserIdentity(provider, identifier)
2. if identity:
     user = identity.user
     if user.status === 'merged': throw 已合并，请用主账号登录
     if provider === 'password' && !verify(secret, identity.secret): throw 密码错误
     return login(user)                       // 签发统一 session token
3. if 无 identity：
     // 同人判定链（C1/D1）：
     matched = null
     for key of [kaypalUserId, profile.phone, profile.unionid]:
        matched ||= findUserByIdentityChain(key)   // 查已有 User 的对应身份
     if matched:
        // 已存在账号 → 绑定新身份（微信/手机号挂到既有账号）
        createUserIdentity(userId: matched.id, provider, identifier)
        return login(matched)
     else:
        user = createUser({ username: 生成唯一, phone: profile.phone, ... })
        createUserIdentity(userId: user.id, provider, identifier)
        return login(user)                     // 新用户
4. 并发防重：createUserIdentity 撞 @@unique → catch P2002 → 重查返回
```

### 2.4 登录后统一 token
- 沿用现有 `UserSession` + `AUTH_COOKIE_NAME` 机制，**不引入第二套 token**
- 签发逻辑不变，只改"身份解析 → 定位 userId"这一层

## 3. 短信服务接入（A1 · 服务商已定：阿里云短信）

### 3.1 服务商与配置
- **服务商：阿里云短信服务（Dysmsapi，v20170525）**——项目已有阿里云体系（cloud-api 的 DashScope key 同系），凭据复用阿里云 AccessKey
- 配置项（`.env`）：
  ```
  SMS_PROVIDER=aliyun
  ALIYUN_SMS_ACCESS_KEY_ID=...
  ALIYUN_SMS_ACCESS_KEY_SECRET=...
  ALIYUN_SMS_SIGN_NAME=...            # 短信签名（需阿里云控制台申请审核）
  ALIYUN_SMS_TEMPLATE_CODE=...        # 验证码模板 Code（需审核）
  ```
- 本地开发兜底：`SMS_PROVIDER=mock`（验证码打印日志，前端可填）——**与阿里云实现共用同一 SmsService 接口**
- 接入方式：优先官方 SDK `@alicloud/dysmsapi20170525`；若后端打包（bundle）体积受限，退化为 RPC 签名直调（`SendSms` 接口，HMAC-SHA1 签名）
- 发送参数：`PhoneNumbers` / `SignName` / `TemplateCode` / `TemplateParam={"code":"123456"}`
- 失败处理：接口返回 `isOk=false` 或网络异常 → 抛 ServiceUnavailable，前端提示稍后重试；**记录失败日志（含阿里云返回 Code/Message）便于排障**

### 3.2 验证码存储
- `SmsCode` 表：`phone, codeHash, expiresAt, usedAt, attempts, @@index([phone])`
- 校验规则：5 分钟有效 / 60s 重发 / 单号 10 次/日 / 错误 5 次作废
- 登录成功即标记 used（防重放）

### 3.3 微信授权手机号（D1）
- 微信开放平台「手机号快速验证」：前端 `wx.getPhoneNumber` → 后端 code 换手机号（接口路径 `https://api.weixin.qq.com/wxa/business/getuserphonenumber`，需 openid + access_token）
- 微信 App 登录（非小程序）：`sns/oauth2` 拿 openid 后，**申请开通「开放平台账号信息」接口**获取 unionid + 手机号（企业资质）
- 获取失败不阻断登录：降级为 openid 建号 + `meta.phoneRequested=false`，后续可在绑定流程补手机号

## 4. 微信登录改造（核心改动）

### 4.1 `POST /auth/wechat-app-login` 新逻辑
```
code → access_token + openid（现有逻辑）
userinfo = 可选：unionid/手机号（D1 权限开通后）
→ loginWithIdentity({ provider: 'wechat_app', identifier: openid, profile: { unionid, phone } })
```

### 4.2 `wechat/start + callback`（kaypal 扫码）新逻辑
```
kaypalToken → 解析 kaypalUserId + 用户资料（昵称/头像/手机号/unionid）
→ loginWithIdentity({ provider: 'kaypal', identifier: kaypalUserId, profile })
```
（对齐 C1：kaypal 成为第一优先级同人判定链）

### 4.3 绑定流程（已登录 + 新登录方式）
- 场景：用户已登录 A（手机号），再点"绑定微信"
- 前端唤起微信授权 → 后端 `loginWithIdentity` 内部发现 identity 无主（新建分支）→ **发现 profile.unionid 已绑 B 账号** → 不直接绑，返回 `needsMerge: true + targetUserId: B 摘要` → 走 §5 合并流程
- 若 unionid/手机号无主 → 直接绑到 A

## 5. 合并流程（B1：数据全转移）

### 5.1 状态
- 合并发起方 = 主账号 M（用户当前登录）；被合并方 = 源账号 S（另一登录方式所属）
- S 标记 `status='merged'` + `mergedIntoUserId=M.id` + 审计记录
- S 的所有身份（UserIdentity）**迁移到 M**（provider+identifier 若与 M 冲突，identifier 加后缀保留）

### 5.2 数据转移清单（B1 全量）
| 数据域 | 处理 |
|--------|------|
| UserSession | S 全部失效（logout 所有） |
| 线索/评论获客 | userId 改 M |
| 积分/账本/提现 | userId 改 M |
| 会话/审批/发布记录 | userId 改 M |
| 租户/成员 | 合并到 M（M 无则继承 S 的） |
| 订阅/配置/草稿 | userId 改 M |
| 审计/操作日志 | **保留 S 原 userId 不动**（历史可追溯） |

> 全部在**单个 $transaction** 内执行，任一步失败整体回滚；表清单以 `prisma/schema.prisma` 里所有含 `userId` 字段的模型为准，实施时逐一核对。

### 5.3 二次验证（防劫持，铁律）
- `merge/request`：检测 S 存在 → 生成 mergeToken + 要求验证 S 的登录方式（短信验证码发到 S 手机号 / S 的密码 / S 的微信授权一次）
- `merge/confirm`：带 mergeToken + 验证码 → 校验通过才执行 §5.2
- 验证码有效期 10 分钟、一次性
- 审计：`MergeAuditLog` 表（requesterId, sourceUserId, targetUserId, verifyMethod, ip, createdAt）

### 5.4 幂等与可回滚
- 合并事务带 `mergeRunId`；重复 confirm 幂等（已合并直接返回结果）
- 合并前自动备份 S 行快照到 `MergeAuditLog.snapshotJson`（数据量小，支持人工回滚）

## 6. 存量数据迁移

### 6.1 `wechat-${openid}` 账号迁移脚本（一次性，`backend/scripts/migrate-wechat-identities.ts`）
```
1. 找所有 username LIKE 'wechat-%' 的 User
2. 每个：openid = username 去掉 'wechat-' 前缀
   建 UserIdentity(wechat_app, openid, userId)（撞唯一则跳过——说明已有正式身份）
3. 不动 username（保留兼容旧引用/URL）
4. 报告：迁移数 / 跳过数 / 异常数
```

### 6.2 存量多账号
- **不自动合并**。用户下次用第二种方式登录时走 §4.3/§5 引导合并
- 登录页提示：登录后可在「账号与安全」查看已绑定方式

## 7. 前端改动

| 页面/组件 | 改动 |
|-----------|------|
| 登录页（账号密码） | 加「手机号登录」Tab（验证码输入 + 倒计时） |
| 登录页 | 微信登录按钮：App 走 wx.getPhoneNumber 预取手机号（D1） |
| 设置页「账号与安全」 | 已绑定方式列表（identities）、绑定/解绑入口、合并引导 |
| 合并弹窗 | 二次验证表单（验证码）+ 合并后果说明（数据将合并，旧账号失效） |
| API client | `src/lib/api/auth.ts` 新增对应方法 |

## 8. 实施任务拆分

| 阶段 | 任务 | 产出 | 预估 |
|------|------|------|------|
| **P1 基础** | ① schema：UserIdentity + User.phone + PG/SQLite 迁移 | 迁移文件 | 0.5d |
| | ② identity-login.service + loginWithIdentity + 密码登录改走新路径 | 服务+测试 | 1.5d |
| | ③ 微信 App 登录改造（去 wechat- 伪建号） | 改造+测试 | 1d |
| **P2 手机号** | ④ SmsService 抽象 + mock 实现 + 验证码表 | 服务+测试 | 1d |
| | ⑤ /auth/phone/* 端点 + 前端手机号登录 Tab | 端点+UI+测试 | 1d |
| **P3 合并** | ⑥ 绑定/解绑端点 + 同人判定链 | 端点+测试 | 1d |
| | ⑦ merge/request+confirm + 数据转移事务 + MergeAuditLog + 前端合并弹窗 | 服务+UI+测试 | 2d |
| **P4 迁移** | ⑧ 存量 wechat- 账号迁移脚本 + 演练 | 脚本+报告 | 0.5d |
| **P5 Kaypal(C1)** | ⑨ callback 解析 kaypalUserId 入 identity + 拉资料回填 | 改造+测试 | 1d |
| **P6 上线** | ⑩ 微信 D1 权限开通后联调（真机）+ 全量回归 | 联调记录 | 1d（外部依赖） |

**合计：约 9.5 人日 + 外部依赖（短信服务商签约 / 微信开放平台 D1 权限）**

## 9. 测试要点

- 单测：identity-login（建号/绑定/并发 P2002/merged 拒绝）、phone code（限流/过期/重放）、merge（二次验证/幂等/事务回滚/审计）
- 集成：真实 PG 跑迁移；SQLite 运行时 DDL 验证
- E2E（真机）：微信 App 登录（有/无绑定）、扫码登录、手机号登录、绑定流程、合并流程、合并后登录任一方式均进主账号
- 回归：现有账号密码登录、现有 wechat- 账号登录（迁移后仍能进）、token 续期

## 10. 验收标准

1. 同一个人：微信 / 手机号 / 账号密码 三种方式登录，返回同一个 userId
2. 新方式登录发现已有账号 → 走合并引导，二次验证后才合并
3. 合并后：S 不可再登录；M 持有全部数据；审计可查
4. 存量 `wechat-*` 账号迁移后原方式仍可登录（进正式 User）
5. 全量测试通过（含新增），tsc 0

## 11. 风险与依赖

| 依赖 | 状态 | 影响 |
|------|------|------|
| 短信服务商（A1） | ✅ 已定阿里云短信；**待申请短信签名 + 验证码模板审核**（阿里云控制台） | 阻塞 P2 真机联调；mock 可先行开发 |
| 微信开放平台手机号快速验证（D1） | 待申请（企业资质） | 弱化同人判定（降级 unionid），不阻塞开发 |
| Kaypal 平台资料接口（C1） | 待确认可用性 | 回填 phone/email 依赖 |

---

**给开发团队的说明**：按 P1→P6 顺序推进；P1-P4 不依赖外部资源可先做；P5 与 Kaypal 对接需拉通 kaypal 侧接口文档；P6 联调前先确保 D1 权限落地。每个阶段结束跑全量测试 + tsc 0。
