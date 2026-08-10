# 生产账号 __REDACTED_TEST_USER__ 云端配置交接（v1.1.72 验收前置）

> 背景：codex 测试时把 `backend/.env` 的 `KAYPAL_AUTH_BASE_URL` 切到 `https://test.kaypal.cn`，因为 **test 环境的账号 __REDACTED_TEST_USER__ 已配置账号等级与积分，而 kaypal.cn 生产环境的同名账号未配置**（导致生产走积分冻结 401，无法真实发布）。
> 现状：代码与 `.env` 已恢复生产（kaypal.cn）。**要让生产环境直接用于真实验收，需在 kaypal.cn 服务端把账号 __REDACTED_TEST_USER__ 配置到与 test 一致**。
> 2026-08-10

---

## 1. 结论：本地无法配置云端账号

- 账号等级（`kaypalSubscriptionPlan`）与积分余额（`kaypalCreditBalance`）是 **kaypal.cn 云端服务端账号属性**，由客户端登录后从云端拉取（`GET /api/.../profile` → subscription + credit balance）。
- 本地代码（ai-content）**没有**管理云端账号等级/积分的接口，也没有写云端数据库的通道。
- 需要 **kaypal.cn 云端管理员**在服务端完成配置（管理后台或服务端内部操作）。

## 2. 需要配置的账号与目标值

| 项 | 目标值（与 test.kaypal.cn 账号一致） | 来源 |
|---|---|---|
| 账号 | **__REDACTED_TEST_USER__**（kaypal.cn 生产） | 验收账号 |
| 账号等级（plan） | **ADVANCED**（`kaypalSubscriptionPlan=ADVANCED`） | 本机 2026-08-10 验收 session 实测值 |
| 套餐有效期 | 至少覆盖验收期（参照 test：至 2026-09-08） | 同上 |
| 积分余额 | **≥ 16037**（参照 test 实测 `kaypalCreditBalance=16037.01`） | 同上 |
| 角色（可选） | SUPER_ADMIN（test 端为 SUPER_ADMIN，验收可全功能） | 同上 |

## 3. 配置后的验证（本机）

配置完成后，无需再切 `.env`：

```bash
# 1. 确认 .env 保持生产（已恢复，勿再改回 test）
grep KAYPAL_AUTH_BASE_URL ~/Documents/New\ project/ai-content/backend/.env
# 期望：KAYPAL_AUTH_BASE_URL=https://kaypal.cn

# 2. 用 __REDACTED_TEST_USER__ 登录后拉 profile，确认等级与积分
# 登录 → GET /api/auth/profile（或前端「账号与设备」页）
# 期望：subscriptionPlan=ADVANCED，creditBalance ≥ 16037，非冻结（无 401）

# 3. 重跑真实验收门禁（生产环境）
cd ~/Documents/New\ project/ai-content
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
  COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN=1 \
  API_BASE=http://localhost:3011/api FRONTEND_URL=http://localhost:3010 \
  COMMERCIAL_REAL_EXECUTION=1 COMMERCIAL_REAL_PUBLISH=1 COMMERCIAL_APPROVE_PUBLISH=1 \
  COMMERCIAL_DOUYIN_ACCOUNT_ID=<登录后账号 id> \
  COMMERCIAL_PUBLISH_MATERIAL_FILE=<素材> \
  node scripts/commercial-acceptance-gate.mjs
```

## 4. 验收通过后（可选清理）

- 门禁通过后，`.env` 保持生产即可，**不需要**再切 test。
- 测试期间产生的临时 session（`user_sessions` 中 source 为 test/acceptance 的）已由测试侧清理；如仍有残留可忽略（过期自动失效）。

## 5. 测试环境切换约定（避免再踩）

- **日常开发/测试环境**：`KAYPAL_AUTH_BASE_URL=https://test.kaypal.cn` 显式设置（临时）
- **真实验收/发布**：必须生产 `https://kaypal.cn`（代码 DEFAULT 已是生产，无 env 即生产）
- 任何测试结束，务必把 `.env` 恢复生产（本次已修复并入库默认生产）
