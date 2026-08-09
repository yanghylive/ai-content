# 三项前端降级功能所需的后端能力清单

> 对应移动端用户旅程测试（2026-08-08）中 3 项「流程正确触发、依赖后端能力」的功能：
> 1. 素材链接去水印采集
> 2. 小红书笔记生成（AgentWaker 小红书运营助理，前端昵称 Ruby）
> 3. 视频号私信
>
> 以下结论均基于 `backend/src` 实际代码，非推测。

---

## 1. 素材链接去水印采集

**入口**：`POST /redfox/collect/link`
**实现**：`modules/redfox/redfox-collect.service.ts` → `collectFromLink`

### 需要的后端能力
- **RedFox 外部数据平台连接（必填）**
  - API Key 来源二选一：
    - 库表 `redfoxConnection`（按 tenant/user）中存已加密的 `apiKey`（经 `POST /redfox/connection` 保存）；
    - 或环境变量 `REDFOX_API_KEY`（可选 `REDFOX_API_BASE_URL`，默认 `https://redfox.hk`）。
  - `getEffectiveConnection` → `mergeEffectiveConnection` 中，若拿不到 key，连接状态为 `missing_key`，返回「系统数据服务暂未开通，请联系管理员处理」。
- **后端出网能力**：需能直连 RedFox 解析接口（`POST /story/api/parseWork/parse`）并 `fetch` 解析出的媒体 URL（60s 超时），再经 `autoUpload.saveMaterialBuffer` 写入素材库。
- **登录态**：操作人需登录（`authUser`）。

### 重要澄清：不依赖「数据情报扣积分」网关
`redfox-client.service.ts` 的 `shouldBillRedfoxCredits` 仅对 `operation.startsWith('intelligence.')` 计费。collect/link 的 operation 是 `redfox.skill.execute.collect.*`，**不会**触发 `aiEmployeeService.deductExternalDataCredits`，因此「积分服务未接入」**不阻塞**此功能。

### 启用动作
后台「RedFox 连接」填入 API Key（或部署时配置 `REDFOX_API_KEY` 环境变量）→ 点「测试连接」通过 → 功能即可用。

---

## 2. 小红书笔记生成（AgentWaker 小红书运营助理）

**入口**：`POST /agentwaker/runs` → `POST /agentwaker/runs/:id/execute`
**实现**：`modules/agentwaker/agentwaker.service.ts`

### 需要的后端能力
- **AgentWaker 角色文件包需随部署上线（核心 blocker）**
  - `executeRun` / `createRun` 调 `roleFilesAvailable(directory, role.promptFiles)`，检查磁盘 `<root>/xiaohongshu-operator/` 下 5 个文件是否齐全：
    - `agent-detail.zh.md`
    - `xiaohongshu-operator-skills/trend-research/SKILL.zh.md`
    - `xiaohongshu-operator-skills/note-drafting/SKILL.zh.md`
    - `xiaohongshu-operator-skills/xiaohongshu-visuals/SKILL.zh.md`
    - `xiaohongshu-operator-skills/publishing-checklist/SKILL.zh.md`
  - 角色根目录解析顺序：`AGENTWAKER_ROLES_ROOT` 环境变量 → `vendor/agentwaker`（项目根）→ `agentwaker-roles`（cwd）。
  - 文件缺失 → 直接 400「小红书运营助理角色尚未安装完整，请检查 vendor/agentwaker 目录。」
  - 生产 health `getRolePackageHealth()` 返回 `ok:false` → 即测试中报告的 `agentWaker: missing`。**根因：角色包未随生产部署上线。**
- **默认文章创作模型需配置**
  - `executeRun` → `resolveModelId` → `defaultModels.getDefaults().articleCreation || topicSelection`；为空则 400「请先配置默认文章创作模型」。
  - 需要 KAYPAL 模型网关可达（真正调 AI 生成 JSON 产物）。
- **账号套餐 ≥ STANDARD**：控制器 `@RequirePlans('STANDARD','PRO','ADVANCED','FLAGSHIP')` 拦截更低套餐。
- **登录态**：`resolveOwnerScope` 要求登录上下文。

### 澄清：前端昵称「Ruby」= 后端 `xiaohongshu-operator`
代码中仅两个角色：`xiaohongshu-operator`（名「小红书运营助理」）与 `wechat-official-account-operator`。「Ruby」是前端角色展示名，属同一角色，无需额外后端改动。

### 启用动作
将 `vendor/agentwaker/xiaohongshu-operator/` 角色目录（含全部 prompt 文件）打包进生产部署，或设置 `AGENTWAKER_ROLES_ROOT` 指向已安装角色；后台配置默认模型；确认账号套餐达标。

---

## 3. 视频号私信

**任务类型**：`wechat-channel-direct-message-reply`
**实现**：`modules/runtime/platforms/wechat-channel/direct-message-reply.service.ts`

### 需要的后端能力
- **视频号平台账号需在后台登录并保活（核心 blocker）**
  - 引擎入口 `accountId = task.accountId`，为 null 或引擎侧账号未登录 → 直接 `rejectResult('account_not_logged_in', '视频号账号未登录', '请完成视频号后台登录后重试')`。与测试报告「账号未连接后台」完全吻合。
  - 浏览器/CDP 状态异常会返回 `editor_missing`（「视频号私信编辑器未就绪（账号未登录或浏览器状态异常）」）。
- **本地运行时引擎（Local Runtime / browser-cdp）就绪**
  - 该能力**不是纯云端 API**，而是 `PlatformInteractionExecutor` 驱动 `LocalRuntimeEngineClient`，在本地浏览器/CDP 中操作视频号会话（draft/send 端点 `/interaction/wechat-channel/messages/draft|send`）。
  - 需要后端运行中的本地运行时进程，并能打开一个已登录的视频号账号会话。
- **平台账号接入**：账号需登记进平台注册表（platform-registry）且连接状态正常。
- **登录态**：操作人需登录。

### 启用动作
后台「平台账号」完成视频号账号的扫码/登录连接（使 `accountId` 可用且会话保活），并确保本地运行时引擎进程在线、可驱动视频号网页会话。

---

## 对照表

| 功能 | 后端模块 | 核心缺失能力 | 是否依赖积分网关 |
|------|----------|--------------|------------------|
| 素材链接去水印采集 | `redfox` | RedFox 平台 API Key 未配置/未连通 | 否（operation 非 intelligence.*） |
| 小红书笔记生成 | `agentwaker` | 小红书角色文件包未随部署上线 + 默认模型未配 | 否（AI 生成走模型网关） |
| 视频号私信 | `runtime/wechat-channel` | 视频号账号未登录/本地运行时未连接 | 否（本地浏览器自动化） |

> 三项均属「外部连接/部署资产缺失」，非前端 bug；前端降级提示正确。
