# ai-content 登录账号统一方案（微信 / 手机号 / 系统账号）

**日期**：2026-08-19
**状态**：待大王决策（方案 A/B/C 见文末）

---

## 1. 现状问题（一句话）

微信登录用 `wechat-${openid}` 当用户名**每次独立建号**，手机号无登录入口，账号密码一套、微信一套、Kaypal 一套——**同一个人有多个互不相通的账号**，数据（线索/积分/会话/审批）各自孤岛。

## 2. 目标架构：一人一账号，多把钥匙

```
                     ┌─────────────────────────────┐
  微信扫码登录 ──┐   │          User（账号）         │
  微信 App 登录 ─┤   │  id / username / email /     │
  手机号+验证码 ─┼──▶│  phone(主手机号) / kaypalUserId│
  账号密码登录 ──┤   └──────────┬──────────────────┘
  手机号+密码 ───┘              │ 1:N
                     ┌──────────▼──────────────────┐
                     │      UserIdentity（身份凭据） │
                     │  provider: password | phone  │
                     │           | wechat_app       │
                     │           | wechat_scan      │
                     │           | kaypal           │
                     │  identifier: 用户名/手机号/    │
                     │               openid/unionid  │
                     │  @@unique([provider,identifier])│
                     └──────────────────────────────┘
```

**一句话**：`User` 表存"人"，`UserIdentity` 表存"这个人的所有登录方式"。任一种方式登录 → 查 Identity → 定位到同一个 User → 发同一套 token。**微信、手机号、密码都是同一把账号下的不同钥匙。**

## 3. 数据模型改造

### 新增 `UserIdentity` 表
```prisma
model UserIdentity {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider   String   // password | phone | wechat_app | wechat_scan | kaypal
  identifier String   // 用户名 / 手机号 / openid / unionid / kaypalUserId
  secret     String?  // passwordHash（password/phone+密码 用）；第三方登录为 null
  meta       Json     // 昵称/头像/unionid 等快照
  createdAt  DateTime @default(now())

  @@unique([provider, identifier])
  @@index([userId])
}
```

### User 表微调
- 加 `phone String?`（主手机号，唯一，登录后绑定时回填）
- `username/email` 保留（兼容现有引用与展示）

### 登录端点统一
所有登录走 `authService.loginWithIdentity(provider, identifier, secret?)`：
- 查 Identity → 有 → 签发统一 token（沿用现有 session/JWT 机制）
- 无 → 按登录方式的建号规则建 User + Identity（见 §4）

## 4. 登录与建号规则（三种路径）

| 登录方式 | 首次登录 | 再次登录 |
|---------|---------|---------|
| 账号密码 | 建 User + Identity(password) | 校验密码 → 定位 User |
| 手机号+验证码 | 建 User + Identity(phone) | 查 phone → 定位 User |
| 手机号+密码 | 同左（secret=passwordHash） | 同左 |
| 微信 App/扫码 | 查 openid → 无则**优先按 unionid/授权手机号找已有 User 绑定**，仍无 → 建新 User + Identity(wechat) | 查 openid → 定位 User |

**关键**：微信登录不再是"造个假用户名开新号"，而是先尝试用授权返回的 **unionid / 手机号**（微信开放平台可申请获取）匹配已有账号。

## 5. 同人判定与账号合并（核心规则）

### 同人判定优先级（登录时按序尝试绑定）
1. `kaypalUserId`（Kaypal 统一身份，最强）
2. 手机号（微信授权手机号 / 短信登录）
3. 微信 `unionid`（同一开放平台下 App+公众号同人）
4. `openid`（单应用）
5. email

### 合并流程（存量多账号收敛）
场景：已有 A 账号（手机号登录），用户再用微信登录 → 检测到微信 openid 属于 B 账号：
1. 提示"检测到微信已绑定另一个账号（昵称 X），是否合并？"
2. **防劫持二次确认**：要求用户用 B 账号的登录方式验证（短信验证码 / 密码）或微信授权确认
3. 合并动作：B 的线索/积分/会话/审批/订阅数据**转移**到 A → B 标记 `merged`（禁止再登录，username 保留防引用断裂）
4. 合并幂等可逆：保留合并审计记录，必要时可回滚

### 铁律（防劫持）
- ❌ 绝不静默合并——必须二次验证
- ❌ 合并后旧账号立即锁定（防双端并行）
- ✅ 每次合并记录审计日志（谁/何时/从哪到哪）

## 6. 迁移与兼容（存量数据）

1. 迁移脚本：现有 `wechat-${openid}` 伪用户名账号 → 拆出 Identity(wechat_app, openid) 绑回原 User，username 保留
2. 存量多账号**不自动合并**（涉及数据归属决策）——只提供"合并引导"，用户在设置页自助发起
3. 现有 token/session 机制不动（统一 token 复用现有签发逻辑，只是签发前身份解析统一）

## 7. 分期落地

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| P1 | UserIdentity 表 + loginWithIdentity 统一 + 账号密码/微信登录改走新路径 | 中 |
| P2 | 手机号登录（短信验证码，需接短信服务）+ 微信授权手机号绑定 | 中 |
| P3 | 合并流程（二次验证 + 数据转移 + merged 锁定 + 审计） | 中 |
| P4 | 存量迁移脚本 + 设置页绑定/合并引导 UI | 小 |
| P5 | Kaypal 统一身份接入（unionid/手机号打通，对接已有 kaypalUserId） | 视 kaypal 侧能力 |

## 8. 决策点（请大王定）

- **A. 手机号登录的强度**：A1 只做"手机号+验证码"（需短信服务，最稳）；A2 手机号+密码（免短信，但手机号注册用户必须设密码）；A3 两者都要
- **B. 合并的数据归属**：B1 全部转移（B 的线索/积分并入 A，B 锁定）；B2 只转移积分/会话类，线索类保持来源归属（防业务数据串扰）
- **C. 是否顺带接入 Kaypal 统一身份**：C1 本轮一起做（对齐"统一 OIDC 签发方"大方向）；C2 先做本地三方式统一，Kaypal 下一轮
- **D. 微信授权手机号**：需要微信开放平台申请"手机号快速验证"接口权限（企业资质）——D1 先申请；D2 不依赖，仅用 unionid 判定（同人判定弱一档）

## 9. 风险与权衡

- 短信服务是新增外部依赖（费用 + 送达率）；若选 A2 可省
- 合并是高风险操作——二次验证 + 审计 + 可回滚三条缺一不可
- 微信 openid 单应用维度，换公众号/App 会变——必须依赖 unionid 或手机号做跨端同人判定
- 与 Kaypal 统一认证的关系：若 C1，未来 User 可整体迁移到 kaypal 平台（kaypalUserId 已有字段，衔接成本低）
