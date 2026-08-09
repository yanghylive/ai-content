# JIUZHANG AI 多平台发布中心升级开发文档

> 版本：v1.0  
> 日期：2026-08-01  
> 状态：待开发  
> 参考项目：`leaperone/MultiPost-Extension` v1.4.4（Apache-2.0）  
> 目标：保留 JIUZHANG AI 的后端、合规、审计和账号体系，吸收 MultiPost 的轻量本地桥接、平台注册表和平台适配经验。

---

## 1. 文档目的

本文件不是概念方案，而是开发团队可直接拆任务、编码、测试和验收的实施文档，覆盖：

- 当前系统真实现状与问题
- 目标架构和模块边界
- 网页控制台 ↔ 本地执行器通信协议
- 平台适配器注册表
- 发布任务、账号、素材和审计数据结构
- 后端 REST API、前端 SDK、本地桥接接口
- 安全授权、风险确认、权限和日志要求
- 分阶段迁移、文件级改造清单
- 测试、验收、灰度、监控和回滚方案
- Apache-2.0 合规要求

## 2. 范围与边界

### 2.1 本期范围

1. 新增 JIUZHANG Local Bridge（本地桥接层）。
2. 前端 3010 可探测并调用本地执行器。
3. 建立统一的 `PlatformAdapter` 注册表。
4. 将现有五个平台逐步从 `auto-upload.client.ts` 拆出：
   - 小红书 `xiaohongshu`
   - 视频号 `wechat-channel`
   - 抖音 `douyin`
   - 快手 `kuaishou`
   - B站 `bilibili`
5. 保留微信公众号官方 API 发布链路。
6. 新增文章页采集和远程图片预处理能力。
7. 选择性增加微博、知乎、头条等平台。

### 2.2 明确不做

- 不一次性接入 MultiPost 的 84 个平台。
- 不把 MultiPost 整仓合并进 JIUZHANG AI。
- 不替换现有认证、多租户、计费、风险确认和审计体系。
- 不默认自动点击最终“发布”；高风险发布仍需用户确认。
- 不把平台 Cookie、token 或密码发往云端。
- 不承诺平台 DOM 永久稳定。

## 3. 当前系统基线

### 3.1 已有能力

| 能力 | 当前实现 |
|---|---|
| 后端 | NestJS + Prisma，端口 3011 |
| 前端 | Next.js，端口 3010 |
| 桌面宿主 | Electron，可自起本地后端 |
| 浏览器执行 | Playwright + CDP + LocalBrowserEngine |
| 浏览器平台 | 小红书、视频号、抖音、快手、B站 |
| 微信公众号 | 官方 API：`draft/add`、`draft/get`、`freepublish/submit`、`freepublish/get` |
| 账号 | `PublishAccount`，含 tenant/user/platform/config，加密凭证体系 |
| 记录 | `PublishRecord`，含 payload/result/evidence/readback |
| 风控 | 发布前 confirmation、计划权限、风险审计 |
| 前检 | engine/account/material/cover/schedule/content 多维 preflight |
| 前端入口 | `distribution-v2` 发布中心、文章发布、视频发布、任务列表 |

### 3.2 当前主要问题

1. `backend/src/modules/auto-upload/auto-upload.client.ts` 超过 4600 行，平台逻辑、会话管理、账号校验和任务编排耦合。
2. 前端只能调用 3011 REST API，没有通用的“网页 → 本地执行器”能力协议。
3. 新增平台需要修改主干大文件，回归范围大。
4. 平台能力无法统一发现：不知道某平台支持文章、视频、定时、封面还是回读。
5. 页面采集、图片预处理和本地发布没有统一数据契约。
6. DOM 自动化选择器缺少版本、健康度和降级策略。

## 4. 参考项目可复用价值

MultiPost 的核心价值不是“84 个平台”本身，而是以下模式：

1. **网页作为控制台、本地扩展作为执行器**：通过统一 request/response 消息通信。
2. **信任域名授权**：首次弹窗确认，之后按白名单放行。
3. **平台适配器注册表**：每个平台一个文件，统一声明能力、入口和执行函数。
4. **发布中枢**：统一做素材预处理、开页面、注入、执行和关闭。
5. **文章采集器**：从当前页面提取标题、正文、封面和摘要。
6. **平台经验**：公众号后台接口、视频号 Shadow DOM、小红书文件注入等。

注意：MultiPost 仓库许可证是 **Apache-2.0**，不是 MIT。

## 5. 架构决策

| 决策 | 选择 | 原因 |
|---|---|---|
| 项目结构 | feature-first | 新能力集中在 `local-bridge`、`platform-adapters`、`content-scraper` |
| 后端 | 继续 NestJS | 避免形成第二套服务和第二套权限体系 |
| 数据库 | 继续 Prisma + 现有 PostgreSQL/SQLite 双模式 | 桌面与云端口径一致 |
| 前端通信 | REST 调 3011；网页与本地桥接使用 typed postMessage/RPC | 保持现有 API，补本地能力通道 |
| 实时状态 | 第一阶段轮询；第二阶段 SSE | 发布状态单向推送，不需要 WebSocket 复杂度 |
| 认证 | 复用现有 JWT/设备授权；本地桥接叠加 origin 白名单 + nonce | 云端身份和本地授权分层 |
| 错误处理 | 统一 typed error code | 前端可给出明确下一步动作 |
| 平台执行 | Adapter Registry | 新平台不修改 orchestrator 主干 |
| 发布模式 | API 优先、浏览器自动化兜底 | 稳定性、合规性和覆盖率兼顾 |

## 6. 目标架构

```text
┌────────────────────────────────────────────────────────────┐
│ Next.js 3010：发布中心 / 账号中心 / 采集入口              │
│ LocalBridgeClient + REST API Client                         │
└───────────────┬───────────────────────┬────────────────────┘
                │ REST/JWT              │ postMessage RPC
                ▼                       ▼
┌──────────────────────────┐   ┌─────────────────────────────┐
│ NestJS 3011              │   │ JIUZHANG Local Bridge       │
│ Publishing Orchestrator  │   │ origin/nonce/action 校验    │
│ Preflight / Risk / Audit │   │ 扩展或 Electron preload     │
└───────────────┬──────────┘   └──────────────┬──────────────┘
                │                             │
                └──────────────┬──────────────┘
                               ▼
                 ┌─────────────────────────────┐
                 │ Platform Adapter Registry    │
                 │ xhs/douyin/channel/kuaishou │
                 │ bilibili/wechat-api/...      │
                 └──────────────┬──────────────┘
                                ▼
                 官方 API / Playwright CDP / 页面注入
```

### 6.1 原则

- 3010 只负责交互，不保存平台敏感凭证。
- 3011 是任务、风控、记录和审计的权威来源。
- Local Bridge 只接受已授权 origin 的白名单 action。
- Adapter 只负责平台差异，不负责全局权限、计费和任务状态。
- 所有发布行为必须产生 `PublishRecord` 和结构化 evidence。

## 7. 模块设计

### 7.1 后端新增目录

```text
backend/src/modules/
  local-bridge/
    local-bridge.module.ts
    local-bridge.controller.ts
    local-bridge.service.ts
    local-bridge.types.ts
    local-bridge.errors.ts
    dto/
  platform-adapters/
    platform-adapters.module.ts
    platform-adapter.interface.ts
    platform-adapter.registry.ts
    platform-capability.types.ts
    adapters/
      xiaohongshu.adapter.ts
      wechat-channel.adapter.ts
      douyin.adapter.ts
      kuaishou.adapter.ts
      bilibili.adapter.ts
      wechat-official-api.adapter.ts
    shared/
      wait-for-element.ts
      file-injection.ts
      shadow-dom.ts
      image-preprocessor.ts
  content-scraper/
    content-scraper.module.ts
    content-scraper.service.ts
    scraper.interface.ts
    scrapers/
      wechat-article.scraper.ts
      zhihu.scraper.ts
      juejin.scraper.ts
      generic-readability.scraper.ts
```

### 7.2 前端新增目录

```text
frontend/src/lib/local-bridge/
  client.ts
  protocol.ts
  actions.ts
  errors.ts
  use-local-bridge.ts

frontend/src/lib/platforms/
  capabilities.ts
  display.ts

frontend/src/app/(dashboard)/distribution/
  local-bridge-status.tsx
  platform-capability-grid.tsx
  publish-preflight-panel.tsx
  publish-progress-timeline.tsx
```

### 7.3 桌面/扩展新增目录

优先方案：Electron preload 提供本地桥接；需要控制 Chrome 已登录标签页时，再配套浏览器扩展。

```text
desktop/src/local-bridge/
  preload-bridge.ts
  action-router.ts
  origin-policy.ts
  nonce-store.ts
  handlers/

browser-extension/（第二阶段）
  src/contents/bridge.ts
  src/background/action-router.ts
  src/options/trusted-origins.tsx
  src/platforms/
```

## 8. 统一内容数据契约

```ts
export type ContentKind = 'article' | 'video' | 'dynamic' | 'podcast';

export interface PublishAsset {
  id?: string;
  name: string;
  url?: string;
  localPath?: string;
  mimeType?: string;
  size?: number;
  checksum?: string;
}

export interface PublishContent {
  kind: ContentKind;
  sourceId?: string;
  title: string;
  summary?: string;
  plainText?: string;
  html?: string;
  markdown?: string;
  tags?: string[];
  cover?: PublishAsset;
  images?: PublishAsset[];
  video?: PublishAsset;
  audio?: PublishAsset;
  scheduledAt?: string;
  original?: boolean;
  allowComment?: boolean;
  platformOverrides?: Record<string, Record<string, unknown>>;
}
```

规则：

- `sourceId` 绑定 JIUZHANG Article/Material。
- `platformOverrides` 只能保存非敏感、平台特有参数，如 B站分区、合集 ID。
- 远程资源执行前必须下载到受控临时目录，计算 checksum。
- 禁止在 payload 中传 Cookie、密码、access token。

## 9. Platform Adapter 接口

```ts
export interface PlatformCapability {
  platform: string;
  displayName: string;
  contentKinds: ContentKind[];
  executionModes: Array<'official-api' | 'cdp' | 'extension-injection'>;
  supportsSchedule: boolean;
  supportsDraft: boolean;
  supportsCover: boolean;
  supportsReadback: boolean;
  supportsAccountDetection: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  adapterVersion: string;
}

export interface PlatformAdapter {
  readonly capability: PlatformCapability;

  preflight(ctx: AdapterContext, content: PublishContent): Promise<PreflightResult>;
  detectAccount?(ctx: AdapterContext): Promise<DetectedAccount>;
  openLogin?(ctx: AdapterContext): Promise<LoginSession>;
  publish(ctx: AdapterContext, content: PublishContent): Promise<PublishResult>;
  readback?(ctx: AdapterContext, result: PublishResult): Promise<ReadbackResult>;
  healthcheck?(ctx: AdapterContext): Promise<AdapterHealth>;
}
```

注册表：

```ts
@Injectable()
export class PlatformAdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>();

  register(adapter: PlatformAdapter): void;
  get(platform: string): PlatformAdapter;
  listCapabilities(): PlatformCapability[];
  has(platform: string): boolean;
}
```

要求：

- adapter 不直接访问 HTTP Request/Response。
- adapter 不直接判断套餐权限。
- adapter 不写 `PublishRecord`；由 orchestrator 统一写。
- adapter 必须返回标准错误码和 evidence。
- 每个 adapter 必须有独立单元测试和 fixture。

## 10. 本地桥接 RPC 协议

### 10.1 请求

```ts
export interface LocalBridgeRequest<T = unknown> {
  protocol: 'jiuzhang-local-bridge';
  version: 1;
  type: 'request';
  traceId: string;
  action: LocalBridgeAction;
  timestamp: number;
  nonce: string;
  data: T;
}
```

### 10.2 响应

```ts
export interface LocalBridgeResponse<T = unknown> {
  protocol: 'jiuzhang-local-bridge';
  version: 1;
  type: 'response';
  traceId: string;
  action: LocalBridgeAction;
  code: number;
  errorCode?: string;
  message: string;
  data: T | null;
  timestamp: number;
}
```

### 10.3 第一阶段 action

| Action | 风险 | 用途 |
|---|---:|---|
| `JZ_BRIDGE_CHECK_STATUS` | 低 | 探测本地桥接是否在线、版本和能力 |
| `JZ_BRIDGE_LIST_CAPABILITIES` | 低 | 返回平台能力注册表 |
| `JZ_BRIDGE_LIST_ACCOUNTS` | 中 | 返回本地已识别账号，不返回敏感凭证 |
| `JZ_BRIDGE_REFRESH_ACCOUNTS` | 中 | 刷新平台登录态 |
| `JZ_BRIDGE_OPEN_LOGIN` | 中 | 打开平台登录窗口 |
| `JZ_BRIDGE_PREFLIGHT_PUBLISH` | 中 | 本地资源、登录态、选择器预检 |
| `JZ_BRIDGE_EXECUTE_PUBLISH` | 高 | 执行发布，必须携带 confirmationId |
| `JZ_BRIDGE_GET_TASK_STATUS` | 低 | 查询本地执行状态 |
| `JZ_BRIDGE_CANCEL_TASK` | 高 | 取消任务 |
| `JZ_BRIDGE_SCRAPE_PAGE` | 中 | 采集当前文章页 |
| `JZ_BRIDGE_REQUEST_TRUST_ORIGIN` | 中 | 请求信任当前域名 |
| `JZ_BRIDGE_LIST_TRUSTED_ORIGINS` | 高 | 查看白名单 |
| `JZ_BRIDGE_REVOKE_TRUST_ORIGIN` | 高 | 删除白名单 |

### 10.4 前端调用示例

```ts
const status = await localBridge.request<BridgeStatus>(
  'JZ_BRIDGE_CHECK_STATUS',
  {},
  { timeoutMs: 3000 },
);
```

### 10.5 防重放

- `timestamp` 与当前时间偏差不得超过 60 秒。
- `nonce` 使用 128-bit 随机值，消费后写入 5 分钟短期缓存。
- 同一 `traceId` 只允许一个进行中的请求。
- 高风险 action 需要 3011 签发的一次性 `confirmationId`。

## 11. 信任域名授权

### 11.1 默认白名单

开发环境：

- `http://127.0.0.1:3010`
- `http://localhost:3010`

生产环境只允许正式产品 origin，不使用 `*`。

### 11.2 首次授权流程

1. 网页发送 `JZ_BRIDGE_REQUEST_TRUST_ORIGIN`。
2. Bridge 从 `event.origin` 获取真实来源，不信任请求体里的 origin。
3. Electron/扩展弹出独立确认窗口。
4. 展示域名、申请权限、动作风险和撤销入口。
5. 用户确认后保存 `{origin, permissions, createdAt, lastUsedAt}`。
6. 返回授权结果。

### 11.3 权限分级

```ts
type BridgePermission =
  | 'status:read'
  | 'capability:read'
  | 'account:read'
  | 'account:login'
  | 'content:scrape'
  | 'publish:preflight'
  | 'publish:execute'
  | 'task:cancel';
```

不得使用一个“全权限”开关覆盖全部动作；生产环境按 permission 精确授权。

## 12. 后端 REST API

保留现有 `/auto-upload` 和 `/publishing`，新增聚合层 `/distribution`，避免前端继续感知内部模块。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/distribution/capabilities` | 平台能力列表 |
| GET | `/distribution/accounts` | 统一账号列表 |
| POST | `/distribution/accounts/:id/validate` | 校验账号 |
| POST | `/distribution/preflight` | 云端/后端前检 |
| POST | `/distribution/publish/confirmations` | 高风险确认 |
| POST | `/distribution/publish` | 创建统一发布任务 |
| GET | `/distribution/tasks/:id` | 任务详情 |
| GET | `/distribution/tasks/:id/events` | SSE 状态流（第二阶段） |
| POST | `/distribution/tasks/:id/cancel` | 取消任务 |
| POST | `/distribution/tasks/:id/retry` | 重试失败平台 |
| GET | `/distribution/records` | 发布记录与证据 |

创建发布任务请求：

```json
{
  "content": {
    "kind": "article",
    "sourceId": "article_xxx",
    "title": "示例标题",
    "html": "<p>正文</p>",
    "tags": ["AI"]
  },
  "targets": [
    { "platform": "wechat-official", "accountId": "acc_1", "mode": "official-api" },
    { "platform": "xiaohongshu", "accountId": "acc_2", "mode": "cdp" }
  ],
  "sendMode": "manual-confirm",
  "confirmationId": "confirm_xxx",
  "idempotencyKey": "publish_xxx"
}
```

## 13. 任务状态机

```text
DRAFT
  → PREFLIGHTING
  → WAITING_CONFIRMATION
  → QUEUED
  → PREPARING_ASSETS
  → OPENING_SESSION
  → EXECUTING
  → VERIFYING
  → SUCCEEDED
  ↘ PARTIALLY_SUCCEEDED
  ↘ FAILED
  ↘ BLOCKED_NEEDS_LOGIN
  ↘ BLOCKED_RISK_CONFIRMATION
  ↘ CANCELLED
```

规则：

- 多平台任务允许部分成功。
- 平台级状态独立保存，重试只重试失败平台。
- `EXECUTING` 后取消属于“尽力取消”，必须提示可能已提交。
- 每次状态变更写入事件日志，禁止只覆盖最终状态。
- `idempotencyKey` 防止重复点击造成重复发布。

## 14. 数据库变更

尽量复用 `PublishAccount` 和 `PublishRecord`，新增三张表：

```prisma
model DistributionTask {
  id             String   @id @default(cuid())
  tenantId       String   @map("tenant_id")
  userId         String   @map("user_id")
  idempotencyKey String   @map("idempotency_key")
  contentKind    String   @map("content_kind")
  contentJson    Json     @map("content_json")
  status         String   @default("draft")
  confirmationId String?  @map("confirmation_id")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  targets DistributionTarget[]
  events  DistributionTaskEvent[]

  @@unique([tenantId, userId, idempotencyKey])
  @@index([tenantId, userId, status, createdAt])
  @@map("distribution_tasks")
}

model DistributionTarget {
  id          String @id @default(cuid())
  taskId      String @map("task_id")
  platform    String
  accountId   String @map("account_id")
  mode        String
  status      String @default("pending")
  adapterVersion String? @map("adapter_version")
  resultJson  Json? @map("result_json")
  errorCode   String? @map("error_code")
  errorMessage String? @map("error_message")

  task DistributionTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, status])
  @@map("distribution_targets")
}

model DistributionTaskEvent {
  id        String   @id @default(cuid())
  taskId    String   @map("task_id")
  type      String
  level     String
  payload   Json?
  createdAt DateTime @default(now()) @map("created_at")

  task DistributionTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, createdAt])
  @@map("distribution_task_events")
}
```

SQLite schema 必须同步修改，不能只改 PostgreSQL schema。

## 15. 错误码

| 错误码 | 含义 | 前端动作 |
|---|---|---|
| `BRIDGE_OFFLINE` | 本地桥接未在线 | 提示启动桌面应用 |
| `ORIGIN_NOT_TRUSTED` | 域名未授权 | 打开授权流程 |
| `BRIDGE_VERSION_MISMATCH` | 协议版本不兼容 | 提示升级桌面应用 |
| `NONCE_REPLAYED` | nonce 重放 | 重新发起请求并记录安全日志 |
| `CONFIRMATION_REQUIRED` | 缺少高风险确认 | 打开确认弹窗 |
| `ACCOUNT_NEEDS_LOGIN` | 账号登录失效 | 打开扫码登录 |
| `PLATFORM_NOT_SUPPORTED` | 无适配器 | 禁用目标平台 |
| `ADAPTER_DEGRADED` | 适配器健康检查失败 | 改为手动辅助模式 |
| `SELECTOR_NOT_FOUND` | 页面改版 | 保存截图/DOM evidence 并上报 |
| `ASSET_FETCH_FAILED` | 远程素材下载失败 | 提示替换素材 |
| `PUBLISH_UNCERTAIN` | 已点击提交但无法回读 | 显示“需人工核对”，禁止自动重试 |
| `PUBLISH_REJECTED` | 平台拒绝 | 展示平台返回信息 |
| `TASK_ALREADY_EXISTS` | 幂等冲突 | 跳转已有任务 |

## 16. 素材预处理

执行顺序：

1. URL 协议校验，只允许 `https`、受控 `http://127.0.0.1` 和本地受控路径。
2. 阻止访问内网和云元数据地址，防 SSRF。
3. 下载到项目临时目录，限制文件大小和总量。
4. MIME sniffing，不只信任扩展名。
5. 计算 SHA-256。
6. 图片统一处理 EXIF 方向；必要时输出 WebP/JPEG。
7. 生成 blob/file 或平台 API 所需 multipart。
8. 任务结束后按保留策略清理。

默认限制：

- 单图 20MB，总图片 200MB。
- 单视频 4GB（按平台再限制）。
- 单音频 1GB。
- 临时文件默认保留 24 小时，失败 evidence 按现有审计策略保留。

## 17. 文章采集器

统一接口：

```ts
export interface ContentScraper {
  readonly id: string;
  matches(url: URL): boolean;
  scrape(page: Page): Promise<ScrapedArticle>;
}
```

采集优先级：

1. 平台专用 scraper。
2. JSON-LD / OpenGraph。
3. Mozilla Readability 通用提取。
4. 用户手动选择正文区域。

采集结果必须标记来源 URL、抓取时间和原作者；进入 AI 改写前提示版权与合规责任。

## 18. 前端产品流程

### 18.1 发布流程

1. 选择内容。
2. 选择平台账号。
3. 展示每个平台能力差异。
4. 后端 preflight + 本地 bridge preflight。
5. 汇总问题：登录失效、素材不符、平台不支持、风险项。
6. 用户确认发布。
7. 创建任务，进入实时进度页。
8. 平台级展示：准备素材、打开页面、填写、提交、回读。
9. 部分失败时允许只重试失败项。

### 18.2 Bridge 状态条

发布页顶部固定显示：

- 本地执行器：在线/离线/版本过低。
- 浏览器会话：已连接数量。
- 账号健康：正常/需登录/受阻。
- 一键修复入口：启动桌面应用、刷新账号、升级版本。

### 18.3 主题与可访问性

- 复用现有 light/dark/system 主题。
- 状态不能只靠颜色区分，必须带文字和图标。
- 所有确认弹窗可键盘操作。
- 动画遵守 `prefers-reduced-motion`。

## 19. 安全要求

1. `event.origin` 必须来自浏览器事件本身，不接受 payload 自报。
2. 生产环境不允许 wildcard origin。
3. Bridge action 使用 allowlist，不执行任意字符串方法。
4. 高风险动作绑定 `tenantId/userId/sessionId/target/hash/expiry`。
5. confirmation 仅可使用一次。
6. 不在日志中记录 Cookie、token、密码、完整正文和个人敏感信息。
7. 本地凭证继续使用 `CredentialEnvelopeService`。
8. 所有远程 URL 做 SSRF 防护。
9. 页面注入严格限制 host permissions。
10. Adapter evidence 默认脱敏；截图支持自动遮挡手机号、头像和昵称。

## 20. 可观测性

每个任务至少记录：

- `traceId/taskId/targetId`
- tenant/user/session（内部 ID）
- platform/accountId（不记录敏感凭证）
- adapterVersion/executionMode
- 状态和耗时
- 错误码、重试次数、是否回读成功
- evidence 引用

核心指标：

- 平台发布成功率
- preflight 拦截率
- 登录失效率
- `SELECTOR_NOT_FOUND` 比例
- 从提交到完成的 P50/P95
- `PUBLISH_UNCERTAIN` 数量
- Bridge 在线率和版本分布

## 21. 分阶段实施计划

### Phase 0：护栏与契约

- 新增共享类型、错误码、action allowlist。
- 添加 Apache-2.0 第三方声明。
- 为现有五个平台补基线 E2E fixture。
- 不改变生产行为。

验收：现有发布功能无回归，五道质量门全绿。

### Phase 1：Local Bridge MVP

- 实现 `CHECK_STATUS`、`LIST_CAPABILITIES`、`LIST_ACCOUNTS`、`PREFLIGHT_PUBLISH`。
- 实现 origin 白名单和首次授权窗口。
- 前端显示 Bridge 状态，不执行真实发布。

验收：3010 能探活、列能力、列账号；未授权域名返回 403。

### Phase 2：平台注册表与现有平台迁移

按顺序迁移：B站 → 快手 → 抖音 → 小红书 → 视频号。

原因：先迁相对简单的平台，视频号 Shadow DOM 最后。

每迁一个平台：

1. 建 adapter。
2. 旧方法包一层委托到 adapter。
3. 双跑 dry-run 对比结果。
4. feature flag 灰度。
5. 旧逻辑保留一个版本后删除。

验收：`auto-upload.client.ts` 不再包含平台选择器和页面操作细节。

### Phase 3：真实本地发布

- 增加 `EXECUTE_PUBLISH`、`GET_TASK_STATUS`、`CANCEL_TASK`。
- confirmationId 与现有风险策略绑定。
- 发布记录和 readback 接回现有系统。

验收：五个平台全链路 E2E；重复请求不重复发布。

### Phase 4：采集和素材增强

- 接入专用 scraper + Readability。
- 远程图片下载、checksum、blob/file 注入。
- 发布中心新增“一键采集当前页”。

验收：公众号/知乎/掘金文章采集成功，图片不裂。

### Phase 5：新增平台

建议顺序：

1. 知乎文章
2. 微博动态
3. 头条文章/视频

每个平台必须满足“适配器 + 测试 + 健康检查 + evidence + 降级模式”五件套。

### Phase 6：公众号订阅号实验（单独风险评审）

- 官方 API 继续作为主链路。
- 后台 cgi-bin 方案仅作为实验性 adapter，不默认启用。
- 必须评估平台条款、账号风险和接口变更成本。
- 需单独 feature flag 和醒目风险提示。

## 22. 文件级改造清单

### 后端

- [ ] 新建 `backend/src/modules/local-bridge/**`
- [ ] 新建 `backend/src/modules/platform-adapters/**`
- [ ] 新建 `backend/src/modules/content-scraper/**`
- [ ] 新建 `backend/src/modules/distribution/**` 聚合 API
- [ ] 修改 `backend/src/app.module.ts` 注册模块
- [ ] 修改 `backend/prisma/schema.prisma`
- [ ] 同步修改 `backend/prisma/schema.sqlite.prisma`
- [ ] 渐进拆分 `backend/src/modules/auto-upload/auto-upload.client.ts`
- [ ] 保留 `backend/src/modules/publishing/wechat-publisher/**` 官方 API

### 前端

- [ ] 新建 `frontend/src/lib/local-bridge/**`
- [ ] 修改 `distribution/publish-flow.tsx` 增加双 preflight
- [ ] 修改 `distribution/publish-center.tsx` 展示平台级状态
- [ ] 修改 `frontend/src/lib/api/auto-upload.ts`，逐步切到 distribution 聚合 API
- [ ] 新增 Bridge 状态条、能力矩阵、进度时间线

### 桌面/扩展

- [ ] Electron preload 暴露最小 Bridge API
- [ ] 主进程 action router 和 origin policy
- [ ] 如需控制外部 Chrome，再建独立扩展工程
- [ ] 扩展权限最小化，禁止 `<all_urls>` 作为最终生产方案

### 合规

- [ ] 新增第三方声明，注明 MultiPost-Extension、版本、仓库、Apache-2.0
- [ ] 保留 LICENSE；如上游有 NOTICE 同时保留
- [ ] 修改的上游文件增加变更说明
- [ ] 记录独立实现与参考实现的边界

## 23. 测试策略

### 23.1 单元测试

- Protocol 序列化、traceId、超时、nonce。
- Origin exact match 和通配规则。
- Action allowlist。
- Adapter registry 注册、冲突、未找到。
- 每个 adapter 的 selector fixture。
- 图片下载、MIME、大小、SSRF 拦截。
- 任务状态机合法/非法迁移。

### 23.2 契约测试

- 3010 `LocalBridgeRequest` 与 Bridge handler 类型一致。
- Bridge 与 3011 confirmation payload 一致。
- Adapter 统一返回 `PublishResult`。
- PostgreSQL 和 SQLite schema 一致。

### 23.3 集成测试

- 未授权 origin → 403。
- 已授权 origin → 探活成功。
- 过期 timestamp/重复 nonce → 拒绝。
- 无 confirmationId 执行发布 → 拒绝。
- 登录失效 → `ACCOUNT_NEEDS_LOGIN`。
- 多平台部分失败 → `PARTIALLY_SUCCEEDED`。
- 幂等键重复 → 返回已有 task。

### 23.4 E2E

每个平台至少覆盖：

1. 登录态识别。
2. dry-run 填写到最终按钮前。
3. 用户确认后真实发布（测试账号）。
4. readback 或 evidence。
5. 页面改版模拟：选择器缺失时失败可解释。

### 23.5 质量门

必须通过：

- frontend lint:strict
- frontend tsc --noEmit
- backend lint:strict
- backend tsc --noEmit
- demo-guard
- 单元/集成/E2E 测试
- 两种 Prisma schema 校验
- 安全测试（origin、nonce、SSRF、日志脱敏）

## 24. 验收标准

### 功能验收

- 3010 能识别 Bridge 在线状态和版本。
- 未授权网页不能读取账号或执行发布。
- 五个现有浏览器平台通过 adapter 执行。
- 微信公众号官方 API 行为不变。
- 一次任务可多平台发布并显示平台级状态。
- 失败平台可单独重试。
- 发布有记录、有 evidence、可回读时必须回读。

### 工程验收

- `auto-upload.client.ts` 不再包含平台 DOM 选择器。
- 新平台不修改 orchestrator 主干。
- action、错误码和 adapter 类型有共享定义。
- PostgreSQL/SQLite schema 同步。
- 生产构建不忽略 TypeScript 错误。

### 性能验收

- Bridge 探活本机 P95 < 300ms。
- 能力列表 P95 < 500ms。
- 创建任务 API P95 < 800ms（不含实际发布）。
- UI 操作保持 60fps；长任务不阻塞主线程。

## 25. 灰度与 Feature Flags

建议开关：

```text
LOCAL_BRIDGE_ENABLED
LOCAL_BRIDGE_PUBLISH_ENABLED
PLATFORM_ADAPTER_REGISTRY_ENABLED
PLATFORM_ADAPTER_<PLATFORM>_ENABLED
CONTENT_SCRAPER_ENABLED
WECHAT_BACKOFFICE_EXPERIMENT_ENABLED
```

灰度顺序：开发环境 → 内部测试账号 → 10% 桌面用户 → 50% → 全量。

任何平台错误率连续 15 分钟超过阈值，自动关闭对应 adapter，不影响其他平台。

## 26. 回滚方案

1. Phase 1 只读 action 可直接关闭 `LOCAL_BRIDGE_ENABLED`。
2. 平台迁移期间保留 legacy executor；adapter 失败可回落旧实现。
3. 数据库新增表不影响旧表；回滚应用时不立即删表。
4. 新前端检测不到能力时回退现有 `/auto-upload` 流程。
5. 公众号官方 API 不参与重构，始终保留稳定链路。
6. 禁止使用 `git reset --hard` 等方式做生产回滚；使用版本化发布和 feature flag。

## 27. 开发任务建议拆分

1. 协议与共享类型。
2. Origin/nonce/confirmation 安全层。
3. Electron Bridge MVP。
4. 前端 Bridge SDK 与状态条。
5. Distribution 聚合 API。
6. Adapter registry。
7. B站 adapter 迁移。
8. 快手 adapter 迁移。
9. 抖音 adapter 迁移。
10. 小红书 adapter 迁移。
11. 视频号 adapter 迁移。
12. 任务状态机与数据表。
13. SSE 进度流。
14. 采集器。
15. 图片预处理。
16. 知乎/微博/头条新平台。
17. 合规声明、文档和最终回归。

## 28. 最终建议

JIUZHANG AI 不应变成 MultiPost 的复制品。正确路线是：

- 保留我们的官方 API、凭证加密、多租户、风险确认、任务记录和回读底座；
- 独立实现同类网页↔本地 RPC 协议；
- 用 adapter registry 拆掉 4600 行平台耦合；
- 在 Apache-2.0 合规前提下，选择性参考平台适配和采集代码；
- 先把五个已有平台做稳，再扩到 8-10 个头部平台。

这样得到的是企业级、可审计、可扩展的多平台发布系统，而不是一个容易因页面改版整体失效的脚本集合。
