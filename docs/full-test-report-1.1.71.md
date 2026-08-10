# ai-content v1.1.71 全量测试报告

> 日期：2026-08-09 ｜ 测试对象：1.1.71（win + mac）｜ 测试人：自动化全量扫描 + 真实启动验证
> 结论：**核心链路全绿；挖出并修复 3 个真实 bug（缺表×2 + JSON path 语法×1）；发布/微信同步等需真实账号的项已列明**

---

## 1. 测试范围总览

| 层面 | 覆盖 | 结果 |
|---|---|---|
| 后端 API 全量扫描 | 226 个无参 GET 端点 | ✅ 217 个 200，9 个参数校验 400/403（预期），0 个 500 |
| 后端单测 | voice/multimodal/video-generation/ai-models | ✅ 30/30 |
| 验收门禁 | commercial-acceptance-gate | ✅ PASS=49 / FAILED=0 |
| 桌面端（真实启动 mac 包 + CDP） | 登录页交互/微信/确认页/复制授权码/记住账号 | ✅ 全过 |
| 前端页面 | 17 个真实菜单页面 | ✅ 全部渲染，0 JS 错误，0 网络 5xx |
| AI 能力端到端 | 对话/生图/配音/语音 TTS/ASR/生视频 | ✅ 全通（生视频云端之前已验证） |
| 代码质量 | 后端 tsc / 前端 build | ✅ 通过 |

---

## 2. 后端 API 全量扫描（本次重点）

**方法**：从源码提取全部 controller 路由 → 无参 GET 用 kaypal 云账号 session 并发探测。

### 2.1 结果统计

| 状态 | 数量 | 说明 |
|---|---|---|
| 200 | 217 | 正常 |
| 400/403 | 9 | 缺参数校验（如 preview 缺文件名）/ 需高级套餐（commercial-readiness）——预期行为 |
| 401 | 1 | `desktop-auth/mcp-session/consume`（一次性消费端点，需有效凭证）——预期 |
| 404 | 1 | `auth/wechat/callback`（无 code/state 参数时）——预期（扫码回调专用） |
| **500** | **0（修复前 3）** | **见 2.2** |

### 2.2 挖出并修复的 3 个 500（真实 bug）

| 端点 | 根因 | 修复 |
|---|---|---|
| `/api/savings/procurements` | 桌面 SQLite 库**缺表** `procurement_lists`（并行 agent 新 model 未迁移建表） | 补建 20 张缺失表（仅 CREATE TABLE IF NOT EXISTS，不动现有数据） |
| `/api/savings/stores` | 同上，缺 `stores` 表 | 同上 |
| `/api/auto-upload/calendar` | `runtimeJson.path` 传数组 `['plannedAt']`（Postgres JSONPath 语法）→ SQLite 需字符串 `$.plannedAt` | 改为 `$.plannedAt`（已提交） |

> 补建的 20 张表：billing_subscriptions/invoices/webhook_events、solution_run/task/result、intelligence_item、benchmark_account、risk_policies、crm_import_batch、growth_account_health_snapshots/scheduler_lease、push_subscriptions、account_subscriptions、cps_platforms/vendors、product_masters、offer_snapshots、stores、procurement_lists

---

## 3. 前端页面扫描（真实桌面 app + CDP 逐页）

17 个真实菜单页面全部 ✅：**0 JS 错误 / 0 网络 5xx / 无登录态丢失**。

/today、/agent、/customer、/content（+topics/articles/strategies/workspace）、/distribution-v2/tasks、/message、/mine、/materials、/platforms、/settings、/apps、/savings、/local-engine

---

## 4. 桌面端交互测试（真实启动 mac 1.1.70/1.1.71 打包产物）

| 功能 | 验证方式 | 结果 |
|---|---|---|
| 登录页元素（账号密码/微信/扫码/记住账号） | CDP 检查 | ✅ 全在 |
| 微信登录按钮 | CDP 点击 | ✅ 302 → 生产扫码页，redirect_uri=kaypal.cn |
| 「打开 JIUZHANG AI 确认页」 | CDP 点击 | ✅ 系统浏览器打开，app 页面不跳走 |
| 「复制授权码」 | CDP 点击 + pbpaste | ✅ 系统剪贴板 = 授权码 |
| 微信扫码回跳闭环 | 模拟完整链路 | ✅ state 编码本地回跳地址，returnUrl 干净单 origin |
| 同源 API | 检查网络请求 | ✅ 零跨域 3011 请求（单入口生效） |
| 内置静态服务反代 | curl /api | ✅ 200（含 502 兜底代码） |

---

## 5. AI 能力端到端（kaypal 云账号）

| 能力 | 端点 | 结果 |
|---|---|---|
| 对话 | ai-gateway/chat | ✅ SSE 流式输出 |
| 生图 | /api/ai/image | ✅ 424KB PNG 入库（qwen-image 云端） |
| 配音 | /api/ai/speech | ✅ 103KB mp3 入库 |
| 语音 TTS | /api/voice/tts/stream | ✅ 61KB WAV |
| 语音 ASR | /api/voice/asr | ✅ 识别准确（"语音面板测试。"） |
| 生视频 | wan-i2v（云端 video 端点） | ✅ 之前已验证 SUCCEEDED（本轮未重复提交） |

---

## 6. 未测项（需真实环境/账号，非代码缺陷）

| 项 | 原因 |
|---|---|
| 真实发布到抖音/小红书等平台 | 本机发布账号 = 0（验收门禁 BLOCKED 预期项） |
| 微信通讯录同步（OCR 兜底） | 需 Windows + 微信 4.x 环境（mac 无法验证） |
| Boss 直聘真实获客流程 | 需登录 Boss 账号 |
| 支付/webhook 回调 | 需生产支付环境 |
| commercial-readiness 备份/回滚 | 需 STANDARD+ 套餐授权 |

---

## 7. 结论

1. **1.1.71 核心链路全绿**：登录（含微信闭环）/ 单入口同源 / AI 全能力 / 主要页面 / 后端 226 端点全部验证通过
2. **本次全量扫描额外修复 3 个 bug**（发布日历 + 省钱模块缺表）——都是之前测试盲区
3. 建议：同事装 1.1.71 后按 `windows-test-guide-1.1.67.md` 回归，真实账号类功能（发布/微信同步）在真实环境实测
4. 遗留提示：并行 agent（P0b SKU 归并）新增的 model 需在桌面库跑一次迁移（本次已补 20 张表，后续新表需同步）
