# 3010 项目：Kaypal 百炼统一接入与全量问题修复方案

> 用途：交给 WorkBuddy 执行改造。
>
> 目标：所有线上 AI 能力统一经 `kaypal.cn` 的模型台/百炼网关，不再直连 DeepSeek 官方、OpenAI 官方或阿里百炼官方；同时修复当前审计发现的非 AI 问题。
>
> 当前代码基线：`43cc5bad`，但 `backend/src/modules/ai-gateway/ai-gateway.service.ts` 当前有未提交改动，执行前先保留并审查这些改动。

## 一、最终架构口径

### 1. 唯一 AI 出口

生产请求统一走以下逻辑：

```text
3010 前端/桌面端/移动端
        |
        v
3010 backend
        |
        v
https://kaypal.cn/api/ai
        |
        v
Kaypal 模型台 -> 阿里百炼模型
```

代码可以继续使用 OpenAI SDK，但这里只把它当作协议客户端，不能因此认为是 OpenAI 直连。

必须满足：

- 文本、工具调用、知识库、视觉、图片、视频、TTS、ASR 都由后端统一调用 Kaypal 网关。
- 后端只接受 `kaypal.cn` 或明确的测试域名 `test.kaypal.cn`。
- 禁止生产配置和数据库平台记录出现 `api.deepseek.com`、`api.openai.com`、`dashscope.aliyuncs.com`。
- `deepseek-v4-flash`、`deepseek-v4-pro` 如果是 Kaypal 返回的模型别名，可以继续作为 `modelId`；它们不是 DeepSeek 官方直连。模型来源必须记录为 `source: kaypal`。
- 视觉模型不能作为普通文本模型 fallback。

### 2. 统一配置

生产环境使用：

```env
KAYPAL_AUTH_BASE_URL=https://kaypal.cn
KAYPAL_AI_PROXY_BASE_URL=https://kaypal.cn/api/ai
KAYPAL_AI_PROXY_API_KEY=<Kaypal 服务端 Key>
KAYPAL_CLOUD_AI_BILLING_ENABLED=true
```

测试环境只允许把域名整体替换成 `https://test.kaypal.cn`，不能把模型请求改成第三方官方地址。

以下变量不得参与生产运行时 AI 路由：

```env
OPENAI_API_KEY
OPENAI_BASE_URL
DEEPSEEK_API_KEY
DASHSCOPE_API_KEY
```

若历史脚本仍需要这些变量，只能标记为离线开发脚本，并从生产 bundle、桌面 bundle、运行时配置扫描中排除。

## 二、第一阶段：统一 Kaypal 百炼 AI 路由

### A. 建立唯一 Provider Resolver

新增一个后端统一解析器，例如：

```text
backend/src/modules/ai-models/kaypal-provider.resolver.ts
```

职责：

- 解析 `KAYPAL_AUTH_BASE_URL`、`KAYPAL_AI_PROXY_BASE_URL`、`KAYPAL_AI_PROXY_API_KEY`。
- 校验 URL host，只允许 `kaypal.cn` / `test.kaypal.cn`。
- 统一生成 `x-kaypal-api-key`、`x-kaypal-user-id`、`Authorization` 等请求头。
- 统一返回 provider、模型能力、计费模式和请求超时。
- 禁止业务模块自行拼接 URL 或读取第三方 Key。

需要改造的重点文件：

- `backend/src/modules/ai-models/ai-client.service.ts`
- `backend/src/modules/ai-models/kaypal-model-sync.service.ts`
- `backend/src/modules/multimodal/multimodal.service.ts`
- `backend/src/modules/voice/voice-asr.service.ts`
- `backend/src/modules/voice/voice-tts.service.ts`
- `backend/src/modules/video-generation/wan-i2v.service.ts`
- `backend/src/modules/runtime/orchestrator/runtime-orchestrator.service.ts`
- `backend/src/modules/ai-employee/ai-employee.service.ts`

### B. 模型同步和默认模型

不再在业务代码里用“最新创建模型”作为默认模型。

统一规则：

1. 从 Kaypal 模型台读取 provider 和默认模型。
2. 按用途保存默认模型：`text`、`vision`、`image`、`video`、`tts`、`asr`。
3. 普通对话只选择 `text` 能力模型。
4. 视觉输入只选择 `vision` 能力模型。
5. 402 fallback 只能在同一能力组内切换。
6. 所有模型记录必须包含 `source = kaypal` 和 `providerId`。
7. 禁止 `findFirst(orderBy: createdAt/updatedAt desc)` 作为业务默认逻辑。

重点排查并统一这些现有调用：

- `ai-gateway.service.ts`
- `content-optimization/outline.service.ts`
- `ai-flavor/de-flavor.service.ts`
- `content-review/content-review.service.ts`
- `comment-acquisition/reply-engine.service.ts`
- 其他直接查询 `aIModel.findFirst()` 的服务。

### C. 修复当前 AI 网关未提交改动

`backend/src/modules/ai-gateway/ai-gateway.service.ts` 当前改动必须先修到：

- `model` 在 fallback 前完成非空收窄，消除 TS18047。
- `catch` 中使用 `unknown` 类型安全读取错误信息，消除 `any.message`。
- 通过 Prettier 和 ESLint。
- fallback 候选必须按能力过滤，禁止视觉模型作为文本 fallback。
- 所有候选都返回 402 时，直接返回明确的 Kaypal 余额错误，不继续盲目重试。
- 普通请求的幂等键必须由请求 ID/用户/模型/业务动作组成，不能每次随机生成导致上游 `BILLING_IDEMPOTENCY_REPLAY`。
- 对 401、402、409、429、5xx 分别映射为可操作的用户提示，并记录 `requestId`、`provider`、`modelId`、`billingIdempotencyKey`。

### D. 删除直连痕迹

源码、桌面 bundle、配置样例、DTO 示例、OpenAPI 文档和发布产物都要检查：

- 删除或改写 `api.deepseek.com/v1` 示例。
- 删除生产运行时对 `DASHSCOPE_API_KEY` 的读取。
- 删除生产运行时对 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 的读取。
- 更新多模态旧注释，不能再写“百炼直连或网关回退”。
- 重新构建 `desktop/backend-bundle`，不能只改 `backend/src`。
- 对 `desktop/backend-bundle`、`desktop/dist`、`backend/dist-bundle-*` 做最终域名扫描。

扫描命令：

```bash
rg -n -i "api\\.deepseek|deepseek\\.com|api\\.openai|dashscope\\.aliyuncs|OPENAI_API_KEY|DEEPSEEK_API_KEY|DASHSCOPE_API_KEY" \
  backend/src desktop/backend-bundle desktop/dist backend/dist-bundle-* scripts
```

允许出现的内容必须是依赖库文档、历史备份或离线脚本，并在报告中逐项说明；生产 bundle 不允许出现。

## 三、第二阶段：修复返利/提现 AI 工具闭环

当前 AI 意图路由创建了通用确认卡，但没有把确认动作绑定到真实 Savings 服务，且使用了伪造的 `尾号****` 和 `mock` 渠道。

改造要求：

1. 提现必须要求金额、渠道、脱敏账户三项真实参数；缺参数时返回补充信息卡，不创建可执行确认单。
2. 兑换和提现分别生成明确的业务确认类型：`savings.exchange`、`savings.withdraw`。
3. 确认单保存完整业务参数和幂等键。
4. 确认后明确调用：
   - `SavingsExchangeService.exchange()`
   - `SavingsWithdrawalService.withdraw()` 或审核流程
5. 生产环境禁止默认 `mock` 渠道；模拟渠道只能由显式开发开关启用。
6. 金额解析必须只解析金额字段，不能把收款账户数字拼进金额。
7. 增加重复确认、余额不足、实名缺失、渠道未开通、确认过期和网络重试测试。

重点文件：

- `backend/src/modules/ai-gateway/ai-gateway.service.ts`
- `backend/src/modules/savings/savings.controller.ts`
- `backend/src/modules/savings/savings-exchange.service.ts`
- `backend/src/modules/savings/savings-withdrawal.service.ts`
- `backend/src/modules/local-engine/local-engine.agent.mixin.ts`
- `frontend/src/app/(dashboard)/tasks/confirmations`

## 四、第三阶段：修复构建和本地启动假绿

### A. Prisma 生成隔离

当前 `build:bundle:sqlite` 会覆盖 `node_modules/@prisma/client`，之后普通 PostgreSQL `nest build` 产生大量模型不存在的假错误。

要求：

- PostgreSQL Client 和 SQLite Client 使用独立生成目录或独立构建工作目录。
- SQLite bundle 构建不得改变普通 `npm run build` 使用的 Prisma Client。
- 连续执行以下命令必须都通过：

```bash
cd backend
npm run build:bundle:sqlite
npm run build
npm run lint
```

- CI 中增加顺序回归，禁止只单独运行其中一个命令。

### B. 启动脚本必须验证新进程

修改 `scripts/start-local-integration.sh`：

- 启动前写入唯一 `RUN_ID`。
- 记录 backend/frontend PID，并验证 PID 仍存活。
- 健康接口返回 `buildId` 或 `runId`，必须和本次启动一致。
- 若新进程退出，即使旧进程仍占用端口，也必须失败。
- `wait_url()` 不能只用 curl 判断成功。
- 日志必须明确输出实际服务 PID、bundle 路径、数据库模式和 buildId。

验收：杀掉新 backend、保留旧 3011 进程时，脚本必须返回失败，不能打印 `All services are running`。

## 五、第四阶段：桌面端和移动端

### 桌面端

- 重新构建 desktop backend bundle，确保采用 Kaypal provider resolver。
- 重新跑 Mac/Windows 安装包内容检查。
- Windows 真机执行 `desktop/scripts/windows-commercial-release-gate.js --commercial-release`。
- 补齐微信登录、联系人、朋友圈、群发的真实设备证据。
- 检查安装包内没有旧的 DeepSeek/百炼直连运行时代码。

### 移动端

当前移动端仍是骨架，不能把占位能力标成已完成：

- `JsBridge.asrUpload()` 需要真实接入 `/api/voice/asr`。
- 微信 SDK 未接入前，界面必须明确显示“未开通”，不能显示可用能力。
- RPA 获客动作不能再静默跳过；未实现动作必须返回 `unsupported`，不能返回成功。
- `AgentService` 的 API 地址改为 BuildConfig 注入，debug、test、release 分离。
- 真实设备验证 WebView 登录态、任务领取、心跳、无障碍执行和失败回传。

重点文件：

- `mobile/app/src/main/java/com/aicontent/mobile/JsBridge.kt`
- `mobile/app/src/main/java/com/aicontent/mobile/agent/AgentService.kt`
- `mobile/app/src/main/java/com/aicontent/mobile/agent/RpaAccessibilityService.kt`
- `mobile/app/build.gradle.kts`

## 六、第五阶段：其他已发现问题

### 前端

- 修复 `agent-workbench-client.tsx` 未使用的 `icon`，使 `npm run lint:strict` 通过。
- 修复 footer 质量门禁：当前浏览器扫描 `151/151` 无 console 错误，但 `systemFooterPassCount=0`、`controlsComplete=false`、`brandReadable=false`。
- 保留现有路由，继续跑 navigation-zero-loss 和 content-workspace guard，不能通过删路由消除问题。

### 后端测试

- 修复 auto-upload 真实桌面进程测试超时。
- 测试写入 `.local-logs`、artifact 和临时目录必须使用可写的系统临时目录。
- supertest 测试禁止依赖受限环境监听 `0.0.0.0`，统一使用测试 server/localhost 策略。
- 修复测试 mock 中缺少 `RpaExecutionStore.createWithLock` 的警告。

### 生产配置

完成以下门禁后才能改为 production ready：

- `COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL`。
- 支付 webhook secret 和签名回放。
- 有效 STANDARD 以上订阅快照。
- `invoice.paid`、失败/降级和权益同步证据。
- HubSpot/Salesforce 测试租户真实写入、回滚和字段白名单。
- 抖音、小红书、微信真实发布、回读、失败恢复证据。

### 验收环境和测试失败明细

以下问题不能被简单标记为“测试环境问题”后忽略，必须在 CI 或验收脚本中有明确结果：

- 后端完整 Jest 当前有 4 个失败套件：
  - `auto-upload.client.spec.ts`：真实桌面微信进程检测超时，不能返回旧的未接入占位结果。
  - `local-engine/agent-s.service.spec.ts`：写入 `.local-logs/agent-s-artifacts` 发生 EPERM，测试产物必须改到可写临时目录。
  - `growth.controller.commercial.spec.ts`：supertest 监听 `0.0.0.0` 被环境拒绝，测试 server 需要改为可控 localhost/注入 server。
  - `ai-employee.controller.spec.ts`：同样的监听权限问题，不能把测试套件失败吞掉。
- 测试日志中的 `RpaExecutionStore.createWithLock is not a function`、Agent Browser persistence 写入 EPERM、未授权/402 fallback 警告必须分别修复 mock 或标注为预期降级，不能只看最终断言数量。
- `npm run db:validate:sqlite` 当前会因生成 schema 文件写入权限失败，脚本必须使用临时目录或确保生成目录可写。
- `npm run db:verify-migrations:postgres` 在 PostgreSQL 不可达时必须输出明确的 `BLOCKED`，不能被包装成普通测试通过。
- 移动端 `./gradlew test --dry-run` 若没有 JDK，必须在报告中标记 `ENV_BLOCKED`，不能写成移动端测试通过。

### 已存在但未完成的产品能力

这些页面和接口不是本轮新引入的错误，但必须在 WorkBuddy 交付时明确“完成、接入中或暂未开放”，不能让页面看起来像已上线：

- `content/face-swap`、移动端能力页中的视频工作坊/换脸仍是暂未开放能力。
- 微信好友申请列表后端目前没有持久化来源，页面必须保持“未配置/不可用”状态，不能伪造待处理数据。
- `content-workspace` 在后端 endpoint 不可用时会返回 `endpoint_unavailable`，前端必须展示真实原因并保留重试入口。
- 微信通讯录、会话历史、联系人读取等页面已有“暂未同步/暂未配置”分支，真实执行前要补真机证据。
- 所有灰度、占位、模拟渠道和本地规则 fallback 都要进入能力清单，禁止被商业文案扫描隐藏。

### 仓库卫生和发布产物

当前工作区还有未跟踪目录/文件，需要在提交和发布前明确处理：

- `docs/acceptance-evidence-2026-08-22/`
- `docs/acceptance-evidence-2026-08-23/`
- `kaypal-ai/`（体积约 239 MB）
- `mobile/gradlew.bat`

要求：

- 证据目录可以保留，但必须由发布脚本生成并单独归档，不能误混入业务提交。
- `kaypal-ai/` 运行时依赖必须通过 lockfile/安装脚本管理，不能把整份 `node_modules` 或临时运行库提交进产品仓库。
- 移动端 wrapper 是否纳入仓库必须有明确决定。
- 提交前运行 `git status --short` 和产物体积检查，防止把本地数据库、日志、凭据或浏览器缓存打包。

## 七、执行顺序和提交拆分

建议 WorkBuddy 按以下顺序提交，避免混在一起难以回滚：

1. `fix(ai): unify kaypal bailian provider and model capabilities`
2. `fix(ai): bind savings confirmations to real execution`
3. `fix(build): isolate postgres and sqlite prisma clients`
4. `fix(dev): make local integration health process-aware`
5. `fix(desktop): rebuild kaypal-only runtime bundle`
6. `fix(mobile): remove silent skeleton success and inject api base`
7. `fix(ui): close strict lint and footer quality gate`
8. `test(release): close billing crm and real-device gates`

每个提交都必须能单独通过对应模块测试，不要把生成的 `dist`、证据目录和本地数据库混入业务提交。

## 八、最终验收命令

### AI 路由

```bash
cd backend
npm run db:validate
npm run lint
npm run build
npm test -- --runInBand --cacheDirectory /tmp/ai-content-ai-gate-jest ai-models savings
```

### 前端

```bash
cd frontend
npm run lint:strict
npx tsc --noEmit --tsBuildInfoFile /tmp/ai-content-final.tsbuildinfo
npx vitest run --configLoader runner --maxWorkers 1
npm run build
```

### 桌面端

```bash
cd desktop
npm run test:credential-key-store
npm run test:local-bridge
npm run check:package-contents
```

### 运行时域名和配置扫描

```bash
rg -n -i "api\\.deepseek|deepseek\\.com|api\\.openai|dashscope\\.aliyuncs|OPENAI_API_KEY|DEEPSEEK_API_KEY|DASHSCOPE_API_KEY" \
  backend/src backend/dist-bundle-* desktop/backend-bundle desktop/dist
```

### 生产结论标准

只有同时满足以下条件，才能写“已完成”：

- 普通 AI、工具调用、视觉、多模态、语音均实际命中 Kaypal 网关。
- Kaypal 余额、鉴权、幂等和错误映射通过真实请求。
- `npm run lint`、`npm run build`、关键测试全通过。
- 本地启动脚本不能被旧进程伪造健康。
- 提现/兑换确认后能执行真实业务服务。
- 移动端未实现能力不再伪报成功。
- P5/P6/P7 生产门禁和外部平台真机门禁全部通过。
