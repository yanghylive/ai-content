# AI Content 商用补齐开发文档

更新时间：2026-06-02

## 目的

本文给开发使用，目标是把当前项目从“功能骨架可跑”推进到“可商用交付”。

当前项目不能只看客户互动 4 个入口。完整商用范围包括：

- 内容生产：素材、信息源、选题、文章、小红书、模板、风格、内容规则。
- 发布中心：图文发布、视频发布、发布素材、平台账号、发布任务、日志、计划任务。
- 客户互动：抖音评论、抖音私信、视频号评论、视频号私信、回复规则、回复记录。
- 本机运行：local-engine、Agent-S、确认队列、执行证据、运行检查。
- 系统配置：账号、模型、默认模型、存储、权限、风控。
- 桌面端：Electron、前端静态包、后端服务、auto-upload 服务、更新和安装包。

商用优先级不是平均推进。当前最高优先级是：

```text
先修不能假成功
  -> 再跑客户互动真实闭环
  -> 再补发布中心真实发布
  -> 再打通内容生产到发布
  -> 最后做桌面端和体验收尾
```

## 商用完成标准

### 算完成

- 使用真实账号。
- 打开真实平台后台。
- 使用真实可见浏览器或真实桌面执行。
- 读取真实客户评论、私信、内容或发布素材。
- AI 回复或生成内容必须基于真实输入。
- 自动发送模式下真实点击发送。
- 发送或发布后有页面回读、接口回执或可审计证据。
- 失败时显示明确原因，不用笼统的“无对象”覆盖所有失败。

### 不算完成

- 只创建任务。
- 只把状态改成 `completed`。
- 只写执行记录。
- 只生成草稿。
- 只有截图但没有真实回读。
- 使用 mock、dry-run、临时浏览器或旧 bridge 假装商用。
- 把“没有对象”当成登录失效、接口加载失败、验证码、网络超时的统一结果。

## 当前检查结果

### 已通过

- 前端 TypeScript：`npx tsc --noEmit` 通过。
- 后端 TypeScript：`npx tsc --noEmit -p tsconfig.build.json` 通过。
- Prisma schema：`npm run db:validate` 通过。
- 前端服务：`http://127.0.0.1:3010/` HTTP 200。
- 客户互动页面：`http://127.0.0.1:3010/workbench/channel-comments` HTTP 200。
- auto-upload：`http://127.0.0.1:5409/health` 正常。

### 未通过

- 前端 lint：`npm run lint -- --quiet` 失败，39 个 error。
- 后端测试：`npm test -- --runInBand` 失败。
  - 19 个 test suite，18 个通过，1 个失败。
  - 115 个测试，111 个通过，4 个失败。
  - 失败集中在 `backend/src/modules/local-engine/local-engine.service.spec.ts`。
- Jest 测试结束后存在未关闭异步句柄，需要排查定时器、cron、队列或后台任务清理。

## P0 必修：不能假成功

P0 的目标是先让系统不能把失败伪装成成功。这个阶段不追求 UI 好看，不扩展新功能。

### P0.1 修前端假回读成功

问题位置：

```text
frontend/src/components/ops-workbench/interaction-realtime-panel.tsx
```

当前问题：

```ts
const readbackOk = readbackStep?.status === "completed" || readbackFromEvents || task.status === "completed";
```

问题解释：

- `task.status === "completed"` 不能代表平台回读成功。
- 后端如果因为其它原因把任务设成 completed，前端会直接显示“回读成功”。
- 这违反商用标准：只认真实平台回读，不认状态流转。

修复要求：

- 删除 `task.status === "completed"` 作为回读成功条件。
- 回读成功只能来自明确证据：
  - `readbackStep.status === "completed"` 且 step key/message 明确是发送后回读。
  - 后端返回明确字段，例如 `readbackOk=true`。
  - 事件里有明确的平台回读内容，并能和本次回复文本匹配。
- `editorCleared`、`editorGone` 只能作为辅助信号，不能单独等同回读成功。

完成标准：

- 没有 readback 证据时，任务 completed 也不能显示“回读成功”。
- 发送失败、回读缺失、回读不一致时显示失败或等待回读。
- 客户互动 4 个页面都使用同一套判断。

### P0.2 修后端 sent 就算成功

问题位置：

```text
backend/src/modules/local-engine/local-interaction-executor.service.ts
backend/src/modules/auto-upload/auto-upload.client.ts
```

当前问题：

- 抖音评论、抖音私信只看 `result.status === 'sent' || result.sent === true`。
- 视频号评论、视频号私信也只把 `sent` 当成功。
- 没有强制校验：
  - 是否走 CDP 持久可见浏览器。
  - 是否真的点击发送按钮。
  - 是否回读到刚发送的回复。
  - 私信最后一条是否为系统刚发出的内容。

修复要求：

后端统一定义发送验证结果，不再直接信任 `sent=true`：

```ts
type InteractionSendVerification = {
  runtimeMode: "cdp-attached-browser" | "persistent-cdp-browser";
  sentClicked: boolean;
  readbackOk: boolean;
  readbackText?: string;
  readbackSource: "dom" | "network" | "platform-api";
  targetStable: boolean;
  failureReason?: string;
};
```

成功必须同时满足：

- `runtimeMode` 是 CDP 持久可见浏览器路线。
- 已真实点击发送，或平台接口返回明确发送成功。
- 发送后回读成功。
- 回读内容和本次回复匹配。
- 目标对象没有变更。

失败必须区分：

- `cdp_unavailable`
- `login_required`
- `captcha_required`
- `target_missing`
- `editor_missing`
- `send_button_missing`
- `network_timeout`
- `readback_missing`
- `readback_mismatch`
- `platform_blocked`

完成标准：

- auto-upload 返回 `sent=true` 但没有回读时，local-engine 不能 completed。
- auto-upload 返回旧 bridge/runtimeMode 时，local-engine 不能当商用成功。
- 抖音评论、抖音私信、视频号评论、视频号私信都走同一套成功判定。

### P0.3 修 CDP 预检不硬阻断

问题位置：

```text
backend/src/modules/local-engine/cdp-platform-interaction.service.ts
```

当前问题：

- `browserReady` 为 false 时只加入 blockers。
- `ok` 只看 `!loginRequired`。
- 结果是 CDP 浏览器未启动时仍可能显示预检通过。

修复要求：

预检通过必须满足：

- profile ready。
- CDP browser ready。
- 平台账号已登录。
- 没有验证码、扫码、风控阻断。
- auto-upload 服务可用。

建议逻辑：

```ts
const ok = status.profileExists && browserReady && !loginRequired && blockers.length === 0;
```

完成标准：

- CDP 未启动时明确阻断。
- 登录失效时明确阻断。
- 验证码、扫码、接口加载失败时明确阻断。
- 前端能显示具体 blocker，不显示“可以执行”。

### P0.4 修 local-engine 失败测试

失败文件：

```text
backend/src/modules/local-engine/local-engine.service.spec.ts
```

当前失败点：

1. 回复规则预期不符。
   - 预期包含“多少钱 / 可上门评估 / 留个电话”。
   - 实际回复是泛化价格话术。
2. 批量互动草稿任务状态错误。
   - 预期 `waiting_for_send_confirmation`。
   - 实际 `running`。
3. 微信群发/朋友圈/客户跟进共享能力状态错误。
   - 预期 `waiting_for_send_confirmation`。
   - 实际 `running`。
4. 风险 gate 未拦截。
   - 预期 `approveTask` reject。
   - 实际 resolved。

修复顺序：

1. 先修风险 gate。
2. 再修状态机。
3. 最后修回复规则预期或规则生成逻辑。

完成标准：

- `npm test -- --runInBand` 通过。
- 风险确认不满足时，不能 approve 成功。
- 需要人工确认的任务不能停留在 `running`。
- 测试结束后 Jest 不再提示 open handles。

### P0.5 修前端 lint 39 个错误

命令：

```bash
cd frontend
npm run lint -- --quiet
```

当前错误集中在：

```text
frontend/src/app/(dashboard)/local-engine/local-engine-client.tsx
frontend/src/app/(dashboard)/settings/page.tsx
frontend/src/app/(dashboard)/workbench/douyin-messages/page.tsx
frontend/src/lib/api/settings.ts
frontend/src/lib/cloud-api-adapter.ts
frontend/src/lib/ops-workbench/hooks/use-agent-s-state.ts
frontend/src/lib/ops-workbench/hooks/use-wechat-state.ts
```

修复要求：

- 不用 `any` 糊过去。
- API 返回结构补类型。
- hooks 状态补明确类型。
- cloud adapter 的请求/响应补接口。

完成标准：

- `npm run lint -- --quiet` 0 error。
- `npx tsc --noEmit` 仍通过。

## P0 必修：客户互动真实闭环

客户互动是当前商用优先级最高的模块。

四条链路：

```text
/workbench/douyin-comments
/workbench/douyin-messages
/workbench/channel-comments
/workbench/channel-messages
```

统一验收标准：

- 从系统前台点击开始，不绕过系统手工去平台发。
- 读到真实客户评论或私信。
- AI 回复和客户内容相关。
- 默认自动发送。
- 真实点击发送或平台接口确认发送。
- 页面或接口回读确认。
- 失败时显示明确失败原因。
- 每条链路连续 5 轮。

### 抖音评论

必须实现：

- 打开 `creator.douyin.com` 评论管理。
- 过滤系统提示、按钮文案、作品标题、已回复评论。
- 只把真实客户评论交给 AI。
- 自动发送真实点击发送按钮。
- 发送后回读该评论下是否出现本次回复。
- 已回复对象去重。

验收：

- 连续 5 轮真实评论。
- 每轮客户原文、AI 回复、发送结果、回读结果完整记录。

### 抖音私信

必须实现：

- 打开抖音私信后台。
- 扫描全部、朋友私信、陌生人私信、群消息。
- 结合 DOM 和 Network 判断私信加载状态。
- 捕获 `imapi.snssdk.com`、`mcs.snssdk.com`、`creator.douyin.com/*/im` 请求状态。
- 区分无私信、接口持续加载、IM 超时、登录失效、App 才能查看、验证码。
- 读取客户最后一条真实私信。
- 过滤系统提示、日期、联系人名、自己的历史回复。
- 发送后回读会话最后一条，确认是系统刚发的回复。

验收：

- 连续 5 轮真实私信。
- 每轮最后一条客户消息和系统回复可对应。

### 视频号评论

必须实现：

- 独立 `wechat-channel-{accountId}` profile。
- 打开 `channels.weixin.qq.com` 或可用官方后台。
- 登录、扫码、验证都在同一可见浏览器处理。
- 读取真实评论。
- AI 按评论内容回复。
- 自动发送。
- 发送后回读。

验收：

- 连续 5 轮真实评论。
- 不把页面导航、作品标题、系统提示当评论。

### 视频号私信

必须实现：

- 打开视频号私信或互动后台。
- 读取真实会话。
- 过滤系统文本、空状态、自己的历史回复。
- AI 按对方内容回复。
- 自动发送。
- 发送后回读。

验收：

- 连续 5 轮真实私信。
- 每轮有客户原文、AI 回复、发送结果、回读结果。

## P1：发布中心商用闭环

发布中心不能只停留在预检、任务记录和日志。

### 图文发布

必须实现：

- 读取真实平台账号状态。
- 读取真实素材。
- 支持标题、正文、标签、封面、平台参数。
- 真实发布前经过风险确认。
- 平台未登录、素材缺失、能力缺失时阻断。
- 发布成功后返回平台结果或页面回读证据。

验收：

- 对实际支持的平台各跑 5 轮。
- 失败原因按平台区分。

### 视频发布

必须实现：

- 上传真实视频素材。
- 支持标题、简介、标签、封面、平台参数。
- 显示上传进度。
- 发布结果可回读。
- 支持失败恢复和重试。

验收：

- 每个平台 5 轮真实测试账号发布。
- 不允许 dry-run 伪通过。

### 平台账号和 profile

必须实现：

- 内容发布、客户互动、发布中心共享同一账号 profile。
- 账号过期时明确提示重新登录。
- 删除账号时清理本地 cookie/profile/头像/状态。
- 删除账号不破坏历史任务记录。
- 本地管理员有本地账号删除权限，不能被 SaaS 超管逻辑卡死。

## P1：内容生产到发布打通

范围：

- 内容素材。
- 选题库。
- 文章库。
- 小红书笔记。
- 视频工坊。
- 内容规则。

必须实现：

- 每个入口不是空壳或演示数据。
- AI 生成失败有明确原因。
- 素材采集失败能区分网络失败、源不可用、解析失败、模型失败。
- 文章、小红书笔记、视频脚本能进入发布中心。
- 删除、批量删除、默认规则切换等高风险动作走统一后端风控。

验收：

- 从采集素材到生成选题、生成文章或笔记、进入发布中心，连续 5 条内容跑通。
- 不依赖 mock 数据。

## P1：权限、本地商用策略和运行检查

必须实现：

- 本地管理员拥有本机账号、素材、任务、平台账号管理权限。
- SaaS 角色和本地角色分离。
- 高风险动作需要确认和审计。
- 普通用户被正确限制。
- 运行检查覆盖：
  - 前端服务。
  - 后端服务。
  - auto-upload 5409。
  - CDP 浏览器。
  - 平台账号 profile。
  - 桌面权限。
  - 日志下载。
  - 一键修复或明确下一步。

验收：

- 断开 5409、CDP、账号过期、权限缺失时，前台都显示真实原因。

## P1：桌面端交付

问题位置：

```text
desktop/package.json
desktop/main.js
desktop/cloud-api.js
```

当前问题：

- `desktop/package.json` 已改为只允许从仓库内 `../auto-upload` 打包，并用构建检查阻断缺失资源；当前仓库仍缺少该目录，不能产出商用自包含包。
- 更新地址已从 `package.json` 默认配置移除；未配置真实 `AI_CONTENT_UPDATE_URL` 时禁用自动更新，发布脚本会阻断占位地址。
- packaged auto-upload 文档仍显示 MVP、dry-run、选择器脆弱等风险。

必须实现：

- 打包依赖自包含，不能依赖开发者机器外部路径。
- auto-upload、后端、前端静态包启动顺序可靠。
- 服务端口冲突有明确处理。
- 更新地址真实可用，或者商用包禁用自动更新并明确说明。
- 敏感文件不进入安装包或仓库。
- Windows/macOS 至少各完成一次安装、启动、登录、执行冒烟。

验收：

- 新机器安装后可以启动。
- 3010、3011、5409 服务状态可见。
- 平台账号登录可保持。
- 客户互动或发布中心至少跑一条真实冒烟。

## P2：收尾和一致性

这些不是第一优先级，但商用前必须收。

### 文档和配置口径

当前口径已收口为：本地/桌面默认 SQLite，Redis 是可选本机记忆/缓存能力，PostgreSQL 只作为服务端部署示例 profile 保留。

要求：

- README、`.env.example`、docker-compose、Prisma schema 保持一致。
- 文档要区分：
  - 本地桌面版 SQLite。
  - Redis 可选，启用本机记忆/缓存能力时再配置。
  - 服务端部署版 PostgreSQL。

### Next.js 配置

问题位置：

```text
frontend/next.config.ts
```

当前问题：

- 已保留 `output: "export"`；商用入口隐藏和缓存/跳转不依赖 `headers()` 或 `redirects()`。
- 半成品入口已通过前端显式路由保护拦截，只有设置 `NEXT_PUBLIC_SHOW_DEV_NAV=true` 时才显示或允许直接访问。

要求：

- 继续静态导出时，所有跳转、入口隐藏和缓存处理必须由前端显式实现。
- 如果需要服务端 headers/redirects，取消静态导出并调整桌面打包方式。

### 工程入口和半成品页面

要求：

- 不在商用主导航暴露半成品。
- 保留工程页时只给管理员或开发模式。
- 页面文案明确“不在一期商用范围”。

涉及页面包括：

```text
capabilities/memory
capabilities/plugins
capabilities/sandbox
capabilities/tools
war-room
wechat / groups / moments 相关跳转页
```

### 品牌和模板文案

问题位置：

```text
frontend/src/app/layout.tsx
```

当前 metadata 已改为：

```text
AI Content
AI 内容生产、发布和客户互动工作台
```

要求：

- 继续清理页面里的模板残留文案。

## 开发顺序

### 第 1 阶段：明确 bug 修复，2-3 个工作日

目标：不再假成功，检查项通过。

任务：

1. 修前端假回读成功。
2. 修后端 sent 判定。
3. 修 CDP 预检。
4. 修 local-engine 4 个失败测试。
5. 修前端 lint 39 个 error。
6. 修 Jest open handles。
7. 修 sqlite/PostgreSQL 文档和配置口径。
8. 修 Next export 与 headers/redirects 冲突。

验收：

```bash
cd frontend
npm run lint -- --quiet
npx tsc --noEmit

cd ../backend
npm run db:validate
npx tsc --noEmit -p tsconfig.build.json
npm test -- --runInBand
```

### 第 2 阶段：客户互动商用闭环，5-7 个工作日

前提：

- 抖音、视频号真实账号可用。
- 有真实评论和私信测试对象。
- 允许真实发送。
- CDP 可见浏览器可用。

任务：

1. CDP 持久浏览器底座硬化。
2. 抖音评论 5 轮。
3. 抖音私信 5 轮。
4. 视频号评论 5 轮。
5. 视频号私信 5 轮。
6. 前台实时反馈补齐。
7. 失败原因分类补齐。
8. 回读证据和去重账本补齐。

验收：

- 四条链路各 5 轮真实闭环。
- 没有回读证据时不能 completed。
- 登录、验证码、接口超时、目标缺失都能显示明确原因。

### 第 3 阶段：整项目商用交付，2-3 周

任务：

1. 发布中心真实图文/视频发布闭环。
2. 内容生产到发布中心 5 条内容连续跑通。
3. 本地权限、风控、账号策略补齐。
4. 桌面端自包含打包和安装验证。
5. 商用验收 Gate 补齐并跑通。
6. 文档、配置、品牌、半成品入口收尾。

验收：

- 客户互动真实闭环通过。
- 发布中心真实发布通过。
- 内容生产到发布通过。
- 桌面端新机器安装冒烟通过。
- 商用 Gate 无 FAILED；真实账号缺失时只能 BLOCKED，不能假通过。

## 回归命令

### 基础检查

```bash
cd frontend
npm run lint -- --quiet
npx tsc --noEmit

cd ../backend
npm run db:validate
npx tsc --noEmit -p tsconfig.build.json
npm test -- --runInBand
```

### 服务检查

```bash
curl -i http://127.0.0.1:3010/
curl -i http://127.0.0.1:3010/workbench/channel-comments
curl -s http://127.0.0.1:5409/health
```

### 商用 Gate

按真实环境设置变量后执行：

```bash
COMMERCIAL_USERNAME=admin \
COMMERCIAL_PASSWORD='your-password' \
COMMERCIAL_DOUYIN_ACCOUNT_ID='真实抖音账号ID' \
COMMERCIAL_WECHAT_ACCOUNT_ID='真实视频号账号ID' \
COMMERCIAL_REAL_EXECUTION=1 \
COMMERCIAL_REAL_PUBLISH=1 \
COMMERCIAL_APPROVE_PUBLISH=1 \
node scripts/commercial-acceptance-gate.mjs
```

要求：

- 缺账号、缺权限、缺真实素材时输出 `BLOCKED`。
- 接口行为错、证据缺失、风控未拦截时输出 `FAILED`。
- 不允许空环境输出通过。

## 开发红线

- 不把 `completed` 当商用完成。
- 不把 `sent=true` 当商用完成。
- 不把截图当商用完成。
- 不把草稿当商用完成。
- 不把“无对象”当所有失败原因。
- 不继续优化旧 browser bridge 作为客户互动主链路。
- 不在客户互动 P0 未完成前优先做记录页、证据页、美化页。
- 不暴露半成品工程页给普通商用用户。

## 风险和依赖

- 平台页面结构会变，选择器和接口需要持续维护。
- 抖音私信依赖 IM SDK、Network、登录态、风控状态，不能只靠 DOM。
- 视频号登录、扫码、验证必须允许用户在同一可见浏览器处理。
- 真实发送测试需要账号、客户对象和发送授权。
- 桌面端打包依赖路径必须收敛，否则换机器不可复现。

## 最短可执行结论

如果开发资源有限，先只做这一组：

1. 修前端假回读成功。
2. 修后端 sent 判定。
3. 修 CDP 预检。
4. 修 local-engine 失败测试。
5. 修前端 lint。
6. 四条客户互动链路各跑 5 轮。

这组不完成，项目不能按商用交付。
