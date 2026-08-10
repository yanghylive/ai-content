# 炼刀 AI 员工 vs JIUZHANG AI · 代码级差距复核（2026-08-10 第五轮）

> 基线：炼刀 dt-ai-helper 1.8.5，渲染端 asar 提取 188 个可见 IPC/HTTP 风格能力路径；对照当前 JIUZHANG 源码、前端页面、Electron 1.1.72 Windows 未解包目录与 backend bundle。
> 本轮重点：复核前一轮“差距清零”结论是否真的落到**前端入口、执行链路、打包资源**，不把接口存在当成能力完成。
> 结果：核心能力大部分已真实接线；发现并修复 1 个 Windows 包装包缺口（悬浮球 HTML 未进包）。剩余差距主要是产品形态/技术路线差异，不再是已承诺能力的虚位。

---

## 一、结论总览

| 能力域 | 炼刀基线 | 当前代码核对 | 结论 |
|---|---:|---|---|
| 微信自动化 | 8 大能力 | Windows native contract + 7 runner（含 auto-reply）+ wx_key/OCR/helper 资源 | ✅ 代码/资源闭环；需 Windows x64 真机证明 |
| 群发计划 | 14 路径 | 10 个 groups/plans 路由 + status completed 过滤 + config | ✅ 核心已接线；产品端点粒度不同 |
| AI 网页代操作 | midscene/hoverBall | backend AI action + LLM JSON 校验 + LocalBrowserEngine + 前端页 + Electron 悬浮球 | ✅ 已真实接线；本轮修复 Windows 包内 HTML 缺口 |
| POI 门店 | 5 路径 | PoiStore + 5 API + `/poi` 前端页 + mine 入口 | ✅ 已真实接线 |
| Token/RPA 用量 | 3 路径 | `/usage/token` 查询/预检/上报 + costs 页面展示 | 🟡 Token 上报 API 已有；自动接入每次 AI 调用仍需继续核对/补齐 |
| 商品视频 | video_creation 19 路径 | product-copy + product-cut + video page + studio_core promo | ✅ 当前是可运行的模板+成片提交链路；非炼刀完整剪辑工作台 |
| TikTok 海外获客 | 17 路径 | 仅 RedFox 采集/下载能力目录 | ⛔ 产品决策排除，不算待办 |
| 手机操控 | nut-js/手机 RPA | mobile-executor/device registry 存在；无 adb/scrcpy/uiautomator 代码 | 🔴 仍是实质差距 |
| 桌面悬浮球 | hoverBall | main.js + preload bridge + hover-ball.html | ✅ 已接线并已补打包 |

---

## 二、本轮发现并修复的真实缺口

### Windows 1.1.72 包：悬浮球 HTML 未被打包

**发现**：
- 源码存在 `desktop/hover-ball.html`，`main.js` 在启动时通过 `path.join(__dirname, 'hover-ball.html')` 加载。
- `desktop/package.json` 的 electron-builder `files` 原先只包含 `main.js/preload.js/.../assets/**/*`，没有 `hover-ball.html`。
- 因此之前生成的 1.1.72 安装包虽然有悬浮球代码，但安装后 `loadFile()` 找不到 HTML，悬浮球无法显示。

**修复**：
- 将 `hover-ball.html` 加入 `build.files`。
- 重新交叉构建 Windows 安装包。
- 验证 `desktop/dist/win-unpacked/hover-ball.html` 存在。
- 新包：`JIUZHANG AI 内容创作平台 Setup 1.1.72.exe`，08:43 构建，341,595,289 bytes。
- 构建守卫：✅ All checks PASSED。

### 注意：旧安装包需要作废

凡是 08:29 构建的旧 1.1.72 包不要再给 Windows 真机安装；应使用 08:43 构建的新包。版本号相同但内容不同，后续正式发布时建议升到 1.1.73，避免更新器把同版本包误认为未更新。

---

## 三、逐项代码核对

### 1. 微信自动化：✅ 代码闭环，真机仍是证据缺口

当前 native command contract 已含：
- `contacts`
- `group-broadcast`
- `contact-add`
- `friend-accept`
- `moments-publish`
- `moments-marketing`
- `chat-history`
- `auto-reply`

Windows 包资源已核对：
- `wechat-native-runners/*`（含 auto-reply）
- `wechat-db-helper/wx_key.dll`
- `wechat-db-helper/*.exe`
- `wechat-ocr/RapidOcrOnnx.exe + models`
- Windows Playwright Chromium 148.0.7778.96

结论：与炼刀的微信核心闭环在**代码和资源层**已对齐；唯一未完成的是 Windows x64 真机在真实微信 4.x 上的 A 级验证。

### 2. 群发计划：✅ 核心功能已接线

当前路由：
- `GET /groups/plans`
- `GET /groups/plans/config`
- `POST /groups/plans`
- `GET /groups/plans/:id/detail-list`
- `POST /groups/plans/:id/pause`
- `POST /groups/plans/:id/resume`
- `POST /groups/plans/:id/resume-confirmation`
- `POST /groups/plans/:id/resend`
- `DELETE /groups/plans/:id`
- `POST /groups/plans/:id/remove`

`?status=completed` 已由任务查询层支持；炼刀的 `upgrade-data-version` 属于其旧数据迁移端点，当前 Prisma migration 体系替代，不是功能差距。

### 3. AI 网页代操作：✅ 前后端与桌面接线完整

链路：
`/local-engine/ai-action` 页面 → `local-engine.ts` API → `AiBrowserActionService` →
LLM `purpose=ai_browser_action`（失败降级规则解析）→ `LocalBrowserEngine.getOrCreateSession` →
真实页面动作 → 每步 `captureEvidence` → 悬浮球展示结果。

安全：动作白名单、HTTPS URL 校验、动作数量上限、`DISPATCH_MOCK` 硬失败。

已知形态差异：炼刀 midscene 的自然语言理解更通用；当前是结构化 LLM JSON + 规则降级，能力边界更窄但更可控。

### 4. POI：✅ 前后端真实接线

- `PoiStore` Prisma model
- `/api/poi` create / PATCH / GET list / GET report / DELETE
- 前端 `/poi` 页面
- 「我的」页有「门店管理」入口
- report 按城市/分类聚合、探店次数统计

当前不是炼刀完整本地生活平台（无地图搜索/第三方 POI 自动导入/门店 CRM 深度联动），但本轮承诺的 POI 数据层已完成。

### 5. Token 用量：🟡 仍需补“自动消费接线”

已有：
- `AiUsageQuota.tokenCount/tokenLimit`
- `GET /api/usage/token`
- `POST /api/usage/token/pre-check`
- `POST /api/usage/token/report`
- costs 页面读取并展示 token 用量

本轮源码核对显示 `recordTokenUsage` 目前主要由显式 report 调用，未发现所有 `AiClientService.generate` 成功返回后自动统一上报 Token 的调用点。

因此精确结论是：**Token 账本与 API 已有，自动计量闭环尚未证明完整**。如果要达到炼刀 RPA token 端点的强度，下一步应从 `AiClientService.generate/generateWithImage/generateImage` 的 provider 返回 usage 统一采集 `prompt_tokens + completion_tokens`，并调用 `AiAuditService.recordTokenUsage`。

### 6. 商品视频：✅ 可运行，但不是完整剪辑工作台

当前：
- `POST /api/video/product-copy`：带货文案+分镜
- `POST /api/video/product-cut`：提交 studio_core `promo` pipeline
- 前端已有 `/video/product-cut`
- studio_core 离线时返回已生成文案的可操作降级

差异：炼刀的 video_creation 路径还包含商品视频编辑、下载任务队列、多种模板配置等更宽的工作台面。当前交付的是一键商品成片闭环，不应宣称已经覆盖炼刀全部视频编辑端点。

### 7. 手机操控：🔴 仍缺

当前源码有 `mobile-executor` / `device-registry`，但全仓未发现 `adb`、`scrcpy`、`uiautomator` 执行链。
这意味着当前是“移动设备注册/执行器抽象”，不是炼刀的真实远程手机操控能力。

### 8. TikTok：⛔ 产品决策排除

RedFox 仍有 TikTok 采集/下载能力目录，但用户已经明确“不考虑上 TikTok 全链路”。不列入当前产品差距待办。

---

## 四、真实剩余差距（按优先级）

| 优先级 | 差距 | 结论 | 建议 |
|---|---|---|---|
| P0 | Token 自动计量接线 | API/账本已有，统一自动上报未证明 | 直接在 AiClientService 统一采集 usage 并上报 |
| P1 | Windows x64 微信真机 A 级证据 | 代码/资源已齐，未实测 | 安装 08:43 新包，按 windows-test-guide-1.1.72.md |
| P1 | 商品视频完整工作台 | 一键成片闭环已完成，炼刀更宽 | 仅在有真实用户需求时补模板/队列/下载 |
| P2 | 手机操控 | 当前无 ADB/scrcpy/uiautomator | 单独立项，风险/维护成本高 |
| P2 | AI 网页动作理解 | 当前 JSON+规则，弱于 Midscene 通用理解 | 真实失败样本积累后再扩模型 schema |
| P3 | POI 第三方导入/地图 | 当前 CRUD+报告，无地图/自动导入 | 本地生活需求明确后再做 |
| 排除 | TikTok 海外获客 | 用户明确不做 | 不排期 |

---

## 五、验证结果

- 后端全量单测：**133 suites / 1451 tests passed**
- 最新 Windows 交叉构建：**All checks PASSED**
- 最新包内 `hover-ball.html`：✅ 存在
- 最新包内 wx_key/OCR/native runners/Playwright Chromium：✅ 存在
- 生产域名非测试配置：源码发布默认 `kaypal.cn`；`test.kaypal.cn` 仅保留在测试/兼容性文案或旧构建静态文档中

---

## 六、最终判断

不再用“炼刀 188 路径 vs 我们接口数量”做粗粒度结论。当前更准确的判断是：

- **微信、POI、群发、AI 网页代操作、悬浮球、商品一键成片**：已达到代码级可交付。
- **Token**：账本/API 到位，但自动消费采集仍有真实差距，不能把“report 端点存在”当作完整计量。
- **手机操控**：仍是实质差距。
- **视频工作台深度与 Midscene 泛化能力**：是产品深度差距，不是当前一期交付阻塞。
- **TikTok**：按产品决策排除。
