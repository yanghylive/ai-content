# DEMO 模块免责说明（合规边界确认书 v2 第五节）

> **永久保留**：任何 demo 代码合入主干前必须阅读本文，任何 PR 涉及 demo 代码必须勾选已读。

## 1. 演示舱定义

**演示舱（Tier 2 / Demo-only）**：为证明团队具备某领域工程能力而写的代码，**默认不开启、默认剔除、禁止生产使用**。

## 2. 演示舱代码必须满足

- 置于 `**/demo/**` 目录或 `*.demo.ts(x)` 后缀
- 使用 `isDemoModeEnabled()` / `requireDemoMode()` 守卫
- 使用 mock 数据（`demo/fixtures/*.json`），**禁止真实凭证、真实账号、真实平台域名**
- 任何 demo UI 顶部常驻红字 Banner：「⚠ 演示模式 · 不合规功能 · 禁止生产使用」
- 日志统一前缀 `[DEMO-MODE][NON-COMPLIANT]`

## 3. 生产红线（不可逾越）

1. 生产构建（`NODE_ENV=production`）必须 tree-shake 掉 demo 入口；CI 断言产物 bundle 不含 demo 符号
2. release 流水线强制 `ENABLE_DEMO=false`
3. demo 代码禁止 import 生产凭证模块（`KAYPAL_CREDENTIAL_MASTER_KEY` 体系）
4. demo 自动化目标必须是本地 mock 服务，**绝不连真实微信/抖音/小红书/TikTok**
5. 即便在 demo 中，也不实现可绕过平台风控的对抗性逻辑到可运行程度

## 4. 启动演示模式（开发者本机）

```bash
export ENABLE_DEMO=true
export DEMO_OVERRIDE_TOKEN=$(openssl rand -hex 16)  # 32 位随机 token
export NODE_ENV=development
npm run demo:check  # 本机自检
```

## 5. 谁负责守门

- **CI 守门**：`.github/workflows/demo-guard.yml` 自动跑 `scripts/ci/demo-guard-ci.mjs`
- **人工守门**：PR reviewer 必须检查 demo 代码是否符合本说明
- **文档守门**：本文件 + `DEMO_MODULE_CONTRACT.md`

## 6. 违规后果

- CI 守门失败 → PR 不可合并
- 人工 review 发现违规 → 打回修改
- 生产环境发现 demo 代码 → **P0 安全缺陷**，立即下线 + 复盘

---

**参考**：`DEMO_MODULE_CONTRACT.md`（写 demo 前必读）+ 合规边界确认书 v2 第五节
