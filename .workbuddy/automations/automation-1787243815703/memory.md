# automation-1787243815703 执行记录（ai-content 错误自动检查+修复，模式 B）

## 2026-08-24 09:30 PDT（首次执行）
- OSS `error-reports/` 共 61 对象；今天(08-24)+昨天(08-23)新报告 21 条（已排除 test-/e2e- 前缀）。
- 21 条全部同一错误：`POST /api/ai-models/v1/chat/completions` → 503「AI 服务暂时不可用：409 BILLING_IDEMPOTENCY_REPLAY」。version=0.0.1（开发构建），hostname 192.168.1.3（局域网开发机，darwin arm64 18核 64GB）。
- 分类：**可自动修复代码 bug**。根因：ai-client.service.ts 的 generate/streamGenerate/generateWithImage 每次 randomUUID() 生成 kaypal 计费幂等键，同内容重试（调用方 3 连发、间隔 4-6s）键不同 → 网关判定计费重放 409。项目内 ai-gateway（计划二.C.6，8/23）已有同策略修复先例。
- 修复：`buildKaypalIdempotencyKey`（场景+用户+模型+内容 sha256 确定性键），替换 3 处随机键；chargeCloudAiCredits 扣积分幂等键（行 722）**保留随机**（语义不同，非本次 409 来源，未动）。
- 验证：后端 tsc ✅；ai-client.service.spec 19/19 ✅（新增确定性单测）；L1 门禁 tsc/vitest/循环依赖 ✅；agent-gateway 11 失败为既有失败（stash 对照确认，lead_discover 真实闭环依赖外部环境，与本次无关）。
- commit：`0aa12fa4`（fix(error-report): ai-models 幂等键改稳定哈希…）。**未打包/未传 OSS/未发版**，等大王确认后走 ai-content-desktop-release。
- 注意事项：首次过滤脚本踩坑——OSS SDK 的 lastModified 是字符串非 Date，字符串与 Date 比较全被过滤误报 0；修复为统一 new Date() 再比较。

## 后续执行提示
- 排查 409 REPLAY 复发：看是否仍由 ai-models 路径产生（修复后应消失）；若仍出现，检查 chargeCloudAiCredits 扣积分幂等键（行 722）是否成为新 409 来源。
- agent-gateway 4 个 spec（controller/real-business-tools/real-content-tools/e2e-full-chain）11 用例是既有失败（lead_discover 真实业务闭环），与 error-report 检查无关，别误判为本次回归。
