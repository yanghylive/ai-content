# logout 换库——每账号独立 SQLite 设计定稿

> 生成：2026-09-01 21:25 · 大王拍板「A 照修 + logout 换库一起做」
> 触发发现：Material/Source/GrowthLead 等业务模型**无 userId/ownerId 字段**（单机单用户时代设计）——逐模块加字段过滤成本巨大且单机场景字段永远单值；**物理换库 = 一次架构改动覆盖 #1/#2/#6/#7/#9/#11 全部隔离问题**，查询代码零侵入。

---

## 一、目标形态

```
系统库  system.sqlite        ← 登录认证（user / userSession / 基础表），未登录态用
账号库  accounts/<uid>.sqlite ← 该账号全部业务数据（materials/growth/video/contact-cache/配置…）
```

| 事件 | 动作 |
|---|---|
| 启动（未登录） | 连系统库 |
| 登录成功 | 切到该账号库（首登=从模板种子创建并接管存量库） |
| 登出 | 切回系统库（**库文件保留**，数据不删） |
| 切换账号 | 直接切到另一账号库（旧账号数据原地保留） |

---

## 二、为什么换库是对的（vs 逐模块加过滤）

| 对比 | 换库（每账号一文件） | 字段过滤（每模型加 userId） |
|---|---|---|
| 改动面 | prisma.service + auth + 启动链路 ≈ 5 处 | 10+ 模型 migration + 全模块查询改造 |
| 数据迁移 | 存量库整体归首个账号，零丢失 | 存量数据要逐个表灌 userId |
| 漏网风险 | 无（物理隔离） | 高（漏一个查询就白干） |
| 单机成本 | 多文件管理 | 字段永远单值（浪费） |
| 微信缓存等文件缓存 | 文件路径也要按账号隔离（配套改） | 缓存是文件不是 DB，字段方案管不到 |

---

## 三、影响面清单（逐项核实过的）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `backend/src/main.ts:90-115` DB 路径计算 | 支持 system/accounts/<uid> 双路径；启动时先连系统库 |
| 2 | `backend/src/prisma/prisma.service.ts:50/:3623` | 提供 `switchDatabase(path)`：改 env → `$disconnect()` → `onModuleInit` 重连 |
| 3 | `backend/src/modules/auth/auth.service.ts` login/logout | login 成功后调 switchDatabase；logout 切回系统库 |
| 4 | `backend/src/modules/local-engine/*.mixin.ts` 微信联系人/聊天缓存路径 | 缓存根目录加账号维度：`<data>/accounts/<uid>/wechat-cache/` |
| 5 | desktop/main.js（Electron 主进程 userDataDir / 后端启动参数 / auto-heal） | 后端启动传系统库路径；auto-heal 同时覆盖账号库 |
| 6 | `sqlite-empty-template` / `seed.db` 机制 | 新账号首登：模板复制为 `accounts/<uid>.sqlite` |
| 7 | `scripts/release-guards.js:621` DB 路径断言、check-package-contents | 断言改为系统库路径 |
| 8 | backup 逻辑 | 备份系统库 + 全部账号库 |
| 9 | 版本升级迁移 | 旧单库 `kaypal-ai.sqlite` → 首登账号接管（改名/移动，非删除） |

---

## 四、数据决策（默认值，大王可改）

- **D1 存量库归属**：现有 `kaypal-ai.sqlite`（含当前全部数据）→ **首个成功登录的账号接管**（移动为 `accounts/<uid>.sqlite`）。默认接受，否则需指定。
- **D2 全局配置随账号走**：sources / ai-models / styles / content-strategies 在换库后**每账号一份**（行为变化：账号 A 配的信息源/模型/风格，账号 B 看不到）。交底：当前单用户形态无感知；多账号时是"配置天然隔离"，与安全目标一致。
- **D3 登出不删数据**：换库≠清库，登出只切连接。数据隔离靠"查不到"而非"删得掉"。

---

## 五、实施步骤（独立 commit，每步可验）

1. **P0 prisma.service.switchDatabase** + main.ts 双路径（先只支持 env 覆盖，不动默认行为）→ 验证：启动正常、/api/health 绿
2. **P1 auth 接入**：login/logout 切库 → 验证：登录后 DB 文件出现 `accounts/<uid>.sqlite`、登出回系统库
3. **P1.5 首登迁移**：存量库接管 + 新账号模板种子 → 验证：老账号数据完整、新账号空库可注册
4. **P2 文件缓存按账号**：wechat 缓存路径 → 验证：A 账号缓存目录独立
5. **P3 desktop 侧**：main.js 参数 + auto-heal + backup → 验证：真实启动冒烟（本机装包跑）
6. **P4 release-guards / check-package-contents 断言更新** → 验证：27/27 + L4 打包检查
7. **负向用例**：账号 A 登录造数据 → 登出 → 账号 B 登录 → B 的素材/微信缓存/视频任务全为空（404/空列表）→ A 再登回数据完整

---

## 六、风险交底

1. **登录认证本身依赖系统库**：user/userSession 从业务库拆到系统库——登录相关查询（auth.service bootstrapUser/login）必须显式用系统库连接，不能沿用业务库 client（切库竞态）。实现上：PrismaService 维护 `systemClient` + `accountClient` 双实例，auth 模块用 systemClient。
2. **切库竞态**：单会话桌面安全；但 auth 切库期间若业务请求在途，可能用错库——加"切库时拒绝业务请求"的短暂闸（`switching` 标志 + 419/503）。
3. **auto-heal 只修当前库**：切库后损坏检测要覆盖所有账号库文件（启动时遍历 `accounts/*.sqlite` quick_check）。
4. **行为变化**：D2 全局配置按账号隔离（见四）。
5. **改动触及底座邻近区**（auth 登录链路）：按底座红线纪律，auth 的改动单独 commit + 全量门禁 + 真实启动冒烟，不与其他批次混。

---

## 七、批次 A 剩余项（独立于换库，并行做）

| # | 修法 |
|---|---|
| #3 证据文件 | allowedRoots 移除 `/tmp` 直读 + `realpath` 前缀校验（防 symlink 逃逸） |
| #4 换脸路径 | resolveMaterial 校验落点必须在素材根目录（realpath 前缀） |
| #5 视频模板剪辑 | 同 #4 + 任务 ID 归属校验（任务表加 ownerId 查询条件；若无字段→至少做「任务目录按会话隔离」） |
| #8 计费 | generateViaKaypalGateway 未传 user 时：有 `x-kaypal-user-id` 用当前用户，否则显式 throw（不静默记主账号）；保留注释说明 |
| #10 支付验签 | 现状=回调地址未配置（死路），最小正确修：验签改 fail-closed（缺签名头/平台证书 → 拒绝且不落充值）；文档标注「启用 WXPAY_NOTIFY_URL 前必须接平台证书验签」 |
