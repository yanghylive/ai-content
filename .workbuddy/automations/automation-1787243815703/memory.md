# automation-1787243815703 执行记录（ai-content 错误自动检查+修复，模式 B）

## 2026-08-24 09:30 PDT（首次执行）
- OSS `error-reports/` 共 61 对象；今天(08-24)+昨天(08-23)新报告 21 条（已排除 test-/e2e- 前缀）。
- 21 条全部同一错误：`POST /api/ai-models/v1/chat/completions` → 503「AI 服务暂时不可用：409 BILLING_IDEMPOTENCY_REPLAY」。version=0.0.1（开发构建），hostname 192.168.1.3（局域网开发机，darwin arm64 18核 64GB）。
- 分类：**可自动修复代码 bug**。根因：ai-client.service.ts 的 generate/streamGenerate/generateWithImage 每次 randomUUID() 生成 kaypal 计费幂等键，同内容重试（调用方 3 连发、间隔 4-6s）键不同 → 网关判定计费重放 409。项目内 ai-gateway（计划二.C.6，8/23）已有同策略修复先例。
- 修复：`buildKaypalIdempotencyKey`（场景+用户+模型+内容 sha256 确定性键），替换 3 处随机键；chargeCloudAiCredits 扣积分幂等键（行 722）**保留随机**（语义不同，非本次 409 来源，未动）。
- 验证：后端 tsc ✅；ai-client.service.spec 19/19 ✅（新增确定性单测）；L1 门禁 tsc/vitest/循环依赖 ✅；agent-gateway 11 失败为既有失败（stash 对照确认，lead_discover 真实闭环依赖外部环境，与本次无关）。
- commit：`0aa12fa4`（fix(error-report): ai-models 幂等键改稳定哈希…）。**未打包/未传 OSS/未发版**，等大王确认后走 ai-content-desktop-release。
- 注意事项：首次过滤脚本踩坑——OSS SDK 的 lastModified 是字符串非 Date，字符串与 Date 比较全被过滤误报 0；修复为统一 new Date() 再比较。

## 2026-08-27 09:36 执行（第二次）
- OSS `error-reports/` 133 对象；今天(08-27)+昨天(08-26)新报告 11 个对象（无 test-/e2e- 前缀文件）。
- 分类结果：**1 条真实可修 bug + 8 条 502 环境问题 + 1 条 503 外部服务 + 2 条人工 E2E 验证报告 + 1 个 stderr 文本**。
  - `0f9f248d` (08-26 08:12, ver 0.0.1 开发构建, 192.168.1.175)：POST /api/growth/acquisition/configs/*/execute → 500，**Prisma 交互事务超时**（timeout 5000ms / 实际 5004ms，Transaction already closed）。根因：saveStoreToDatabase 默认 5s 交互事务，SQLite 单写 + 最多 1000 条 leads 逐条 findUnique×2+upsert（3000+ 串行查询）跑不完。
  - 8 条 502（client-* 无堆栈，localhost/127.0.0.1 的 /content /device-center /growth/acquisition）：开发机 192.168.1.175 后端未启动/挂掉，环境问题，非代码 bug。
  - `f3809bef` (08:15)：503 kaypal 账号服务不可达（fetchKaypal），外部服务，与 08:14-08:24 的 502 同窗口（开发机网络/后端不稳）。
  - `299adcb2`/`1c6c46b1`（e2e-report-mac-001/win-001）：人工 E2E 上报链路验证，非真实错误。`win-acceptance-stderr.txt`：prisma 引擎文件名列表，验收产物。
- 修复：growth.service.ts `saveStoreToDatabase` 的 `$transaction(async…)` 显式加 `{ timeout: 60_000 }`（默认 5000ms → 60s，本地单用户幂等 upsert 无脏数据风险）；新增 spec 断言 `$transaction` 被以 `{ timeout: 60000 }` 调用；prettier 事务体缩进归一（仅 1 个 hunk）。
- 验证：后端 tsc ✅；growth.service.spec **96/96** ✅；L1 门禁 10/15——红项：L1 jest 后端单测 `auto-upload.client.spec` 为 **flaky**（两次全量跑 1 FAIL 1 PASS，单跑两次 PASS，与 growth 改动零交集）；L2 commercial-assets / L3 Mac 包 18 项 / L3 发版核心 9 项 / L3 登录态路由扫描为环境性（需桌面 app/浏览器/登录态，非本次改动，且本次不发版）。
- commit：`c1332a10`（fix(error-report): growth 交互事务超时 5s→60s）。**未打包/未传 OSS/未发版**，等大王确认后走 ai-content-desktop-release。
- 复查 409 REPLAY：08-25/08-26 均无 ai-models 409 报告 → 08-24 修复（0aa12fa4）确认生效。

## 2026-08-28 09:37 执行（第三次）
- OSS `error-reports/` 151 对象；本次窗口（上次 08-27 09:36 执行后）新报告 **18 条**（08-27 全天，08-28 暂无），无 test-/e2e- 前缀。
- 分类：**可自动修复 0 条**（无需新改代码、无 commit）；代码已修/旧构建上报 3 条；环境问题 9 条；外部服务/凭据 6 条。
- 代码已修（旧构建/旧包上报，等发版生效）：
  - `362e86fc` 409 BILLING_IDEMPOTENCY_REPLAY（08-27 18:39，ver 0.0.1 dist-bundle-sqlite）→ 0aa12fa4 修复在源码+重建 bundle（21:46）中，报告来自旧 bundle，非新 bug。
  - `29986596`（1.1.98 生产包 21:03）+ `96026d6e`（开发构建 21:34）StudioCore fetch failed / 404 OpenStory → `a7aed86c`（08-27 21:39）已提交 StudioCore 不可达回退 kaypal 云端视频通道，try/catch 兜住，**未发版**。
- 环境问题 9 条（**全部本机 192.168.1.175 测试后端 3012**）：
  - 8×522 SQLite disk I/O error（10:43~20:08 北京，auth/tenants/kaypal/profile/local-engine/auto-upload/materials 等）→ **根因：本机磁盘 99% 满（/System/Volumes/Data 剩 17Gi）**，SQLite 写库 ENOSPC。建议清理 data/（4.9G）、backend/node_modules（998M）、/tmp/dev.db.* 备份。
  - 1×502（20:15，http://127.0.0.1:3012/agent）→ 测试后端 3012 未运行（复查时仍未监听）。
- 外部服务/凭据 6 条：4×「Kaypal 模型台服务端授权未放行」（云电脑 win 1.1.96 ×3 + 1.1.97 ×1）→ kaypal.cn billing/AI proxy 服务端 key 配置；2×kaypal 401（1.1.98 生图 21:03 + 视频 21:51）→ KAYPAL_AI_PROXY_API_KEY 权限/失效。
- 背景：大王 08-27 晚连发 1.1.97（a2e1e3da，含错误上报链路修复 e8cc5571）/1.1.98（bce527d0）；HEAD=a7aed86c 工作区干净。HEAD 已含 0aa12fa4+a7aed86c+41e3c871 修复 → 新版本已准备好，**等大王确认发版**。
- **未打包/未传 OSS/未发版**（铁律）。

## 后续执行提示
- auto-upload.client.spec 是 flaky（偶发，两次全量跑一次 FAIL），再遇 FAIL 先单跑确认再判断。
- 排查事务超时复发：若 60s 仍超（极端 1000 leads 场景），下一步考虑批量 upsert（createMany/updateMany）或仅增量持久化变更 leads，但 preserveConverted 逻辑依赖逐条 findUnique，改动需谨慎。
- agent-gateway 4 个 spec 11 用例是既有失败（lead_discover 真实业务闭环），与 error-report 无关。
