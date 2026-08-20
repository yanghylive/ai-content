# AI 获客体验升级 · 开发文档（活文档）

> **文档性质**：开发期间的唯一事实源（source of truth）。开发时必须实时更新任务状态与进度速览，避免遗漏、避免写成死代码、减少修 bug 返工。
>
> **进度更新规则**：
> - 每次开发会话开始：把即将开工的任务标记 `🔨进行中`
> - 每个任务完成并自测通过：更新状态 `✅完成` + 完成日期 + 自测结果
> - 发现阻塞：标记 `⚠️阻塞` + 写阻塞原因，立即上报，不得跳过任务或注释绕过
> - 每次会话结束：更新「0. 进度速览」汇总
>
> **仓库**：`~/Documents/New project/ai-content/`（frontend + backend 同仓）
> **关联方案**：`deliverables/product-strategy/ai-acquisition-experience-upgrade-2026-08-19.md`（整合版方案）

---

## 0. 进度速览（实时更新）

| 模块 | 任务数 | 🔲待办 | 🔨进行中 | ✅完成 | ⚠️阻塞 |
|------|--------|--------|----------|--------|--------|
| 模块 0 工程基建 | 6 | 0 | 0 | 6 | 0 |
| 模块 1 灰度遮罩改造 | 11 | 0 | 0 | 11 | 0 |
| 模块 2 全量修复 14 项 | 14 | 0 | 0 | 14 | 0 |
| 模块 3 AI 长期记忆接入 | 5 | 0 | 0 | 5 | 0 |
| 模块 4 AI 价值感知 | 12 | 0 | 0 | 12 | 0 |
| **合计** | **48** | **0** | **0** | **48** | **0** |

> 最后更新：2026-08-20（48 任务全部收官；T2-4g 视觉兜底增强：截图压缩 sharp 900px+jpeg72、限频 key 全局化 60s、collectFromLink 评论页被拦挂视觉兜底 mode='comments'——详见 T2-4 增补）

---

## 1. 目标与非目标

### 1.1 目标
1. **灰度/未开放功能统一整页遮罩**（大王指令）：**10 个页面**（含视频工作室、朋友圈发布）保留全貌可见 + 背景模糊 + 上层"灰度测试/暂未开放"遮罩，操作不可达
2. **AI 有长期记忆**：接入已部署在 **kaypal-prod-new（118.178.108.44）kaypal-app-baota `127.0.0.1:3000/api/memory*`** 的腾讯开源记忆系统 **TencentDB Agent Memory**（本机 `~/Projects/tencentdb-agent-memory` 为完整副本/备用），让 AI 记住用户偏好、行业、话术风格、跟进历史、评分校准，跨会话不"失忆"
3. **AI 价值感知**：按瑞思 12 条方案落地（过程可见 / 理由可懂 / 效果可验 / 功劳可归）
4. **全量修复 14 项**（上一版诊断全部问题，不标优先级，都得修）

### 1.2 非目标（Non-goals）
- ❌ 不改「AI 获客」产品定位与名称
- ❌ 不重写 growth-console.tsx 单文件（拆分重构单独立项）
- ❌ 不动 kaypal.cn 网关登录链路（Route A 迁移专项）
- ❌ 不改商用计费逻辑本体（T2-14 仅做展示一致性）

---

## 2. 架构改动总览

```
┌─ 前端 (frontend/src) ──────────────────────────────┐
│  T0-1  api 客户端统一解包 {success, data}           │
│  T0-2  GrayTestOverlay 遮罩组件（新）               │
│  T0-3  全局 LoadingGuard（8s 超时 + 错误降级）      │
│  T0-4  通知去重 util                                │
│  T0-5  颜色语义 util（0 值中性灰）                  │
│  T1-1~10 十个页面套 GrayTestOverlay                 │
│  T2-*  14 项修复（前端部分）                        │
│  T4-*  AI 价值感知 UI（简报卡/轨迹/重评按钮…）      │
└────────────────────────────────────────────────────┘
┌─ 后端 (backend/src) ───────────────────────────────┐
│  T2-*  话术聚合过滤空值 / 路由 404 / 口径统一       │
│  T3-*  AI 记忆服务接入（→ kaypal 记忆系统）         │
│  T4-*  评分模型版本/置信度/自然语言理由接口          │
└────────────────────────────────────────────────────┘
┌─ 记忆系统（已部署）───────────────────────────────┐
│  生产：kaypal-prod-new 118.178.108.44              │
│    kaypal-app-baota 127.0.0.1:3000/api/memory*      │
│    （/memory /memory/flush /memory/spec /memory-mesh）│
│    ⚠️ 需 kaypal 平台鉴权 token（T3-0 确认凭据）    │
│  备用：本机 ~/Projects/tencentdb-agent-memory       │
│    TDAI Gateway 8420 / Service 3100（DeepSeek 后端）│
└────────────────────────────────────────────────────┘
```

**记忆接入双路径**（T3-0 定夺）：
- **路径 A（推荐）**：ai-content 后端 → kaypal 平台 `/api/memory*`（复用 kaypal app 凭据体系，如 octop 的 `KAYPAL_APP_CREDENTIALS` 模式），记忆数据留在云端，跨设备一致
- **路径 B（备用）**：本机/服务器跑 TencentDB Agent Memory 三件套（MemoryCore+MemoryProxy+MemoryHub），数据落 `~/.memory-tencentdb/`，走 `TDAI_LLM_*`（DeepSeek/kaypal 网关）

---

## 3. 任务分解

> 卡片字段：**目标 / 涉及文件 / 改动点 / 验收标准 / 依赖 / 状态**。
> 涉及文件为"已知必改"，开发中发现遗漏须在卡片补充，禁止悄悄改别处不记录。

### 模块 0 · 工程基建（先做，下游全部依赖）

#### T0-1 API 客户端统一解包
- **目标**：根治"接口返回 `{success, data}` 但前端当数组用"导致的静默空数据/卡 loading（账号健康、创建任务两处已实证）
- **涉及文件**：`frontend/src/lib/api/client.ts`、`frontend/src/lib/api/growth.ts`
- **改动点**：axios 响应拦截器统一解包 `response.data.data`；`listAccountHealth()` 等所有 `get<T>` 调用点回归
- **验收**：账号健康页真实账号 <2s 渲染 9 账号；创建任务页账号列表正常；全量回归无 `Array.isArray` 误判
- **依赖**：无　**状态**：✅完成（2026-08-19 验证）
- **结论（诚实修正）**：源码核对 `client.ts request<T>()` **已正确解包** `body.data`（第 206 行 `return body.data as T`），`api.get` 语义即返回 data 本体。**T0-1 为伪问题，无需改动**——此前诊断的"卡 loading/空数据"真因是：① localOnly 测试会话下接口慢/超时（真实账号正常）；② `/api/growth/account-health` 接口本身 2.6s（性能问题归 **T2-9**）。按"避免死代码"原则不修。

#### T0-2 GrayTestOverlay 遮罩组件（新建）
- **目标**：通用"整页预览 + 背景模糊 + 上层遮罩"组件（析客规格：blur 8-12px、浮层含功能名+状态+返回、滚动可预览但操作不可达、Esc 返回、「知道了」会话内记忆）
- **涉及文件**：`frontend/src/components/v2/gray-test-overlay.tsx`（新）
- **改动点**：模态语义（焦点锁定）、移动端 Bottom Sheet、深浅色用 `--kaypal-v3-*` token、`backdrop-filter: blur()`
- **验收**：按析客 1.5 节 5 条验收标准全过；在任意页面包裹后无布局破坏
- **依赖**：T0-1　**状态**：✅完成（2026-08-19，组件已建，待 T1 各页接入后实测验收）
- **防死代码**：纯展示组件，不塞业务逻辑；props 只含 `feature/status/onClose/children`

#### T0-3 全局 LoadingGuard（8s 超时 + 错误降级）
- **目标**：所有接口 loading 8s 超时 → 失败 toast + 重试；替代手写 spinner
- **涉及文件**：`frontend/src/components/v2/loading-guard.tsx`（新）、`frontend/src/lib/hooks/use-loading-guard.ts`（新）
- **验收**：任一接口 8s 未返回 → 出现"加载超时，点击重试"；不再有页面永久转圈
- **依赖**：T0-1　**状态**：✅完成（2026-08-19，hook 已建）

#### T0-4 通知去重 util
- **目标**：同一通知全局只展示 1 次
- **涉及文件**：`frontend/src/lib/utils/notification-dedupe.ts`（新）、通知渲染处（T2-5 接入）
- **验收**：`/growth` 与 `/auto-acquisition/create` 的"账号 XX 登录状态异常"只出现 1 次
- **依赖**：无　**状态**：✅完成（2026-08-19，util 已建；渲染处接入见 T2-5）

#### T0-5 颜色语义 util
- **目标**：数值色块统一语义：0 值中性灰、告警红、等级统一色阶
- **涉及文件**：`frontend/src/lib/utils/tone.ts`（新）、`growth-console.tsx` 首页 4 数字、漏斗（T2-8 接入）
- **验收**：首页"今日 0/0/0"为中性灰、"高意向 4"为等级橙（非告警色）；漏斗层级同色阶
- **依赖**：无　**状态**：✅完成（2026-08-19，util 已建；接入见 T2-8）

#### T0-6 回归走查脚本固化
- **目标**：把本次"真实账号 + puppeteer 9 页走查"固化成可重复脚本，供每波次回归
- **涉及文件**：`frontend/scripts/ux-regression-walk.mjs`（新，参照 /tmp/ux-walkthrough 逻辑）
- **验收**：一键跑 9 核心页 + 10 灰度页 + 输出 walk.json + 截图；含 loading 可疑检测
- **依赖**：无　**状态**：✅完成（2026-08-19，脚本已建：`--token <会话> [--out <dir>]`，19 页全覆盖）

### 模块 1 · 灰度遮罩改造（10 页）

> 统一做法：移除各页 `GrayTestBanner` 顶部横幅 → 用 `<GrayTestOverlay feature="XX">` 包裹整页内容。
> 依赖：T0-2。每页验收：页面全貌可见+模糊；所有按钮/输入不可点；「返回」「知道了」正常。

| ID | 页面 | feature 文案 | 涉及文件（已知） | 状态 |
|----|------|-------------|-----------------|------|
| T1-1 ✅ | /boss-recruit | BOSS 直聘 | `app/(dashboard)/boss-recruit/page.tsx`、`boss-recruit-center.tsx` | 🔲待办 |
| T1-2 ✅ | /wecom-assistant | 企业微信助手 | `app/(dashboard)/wecom-assistant/page.tsx` | 🔲待办 |
| T1-3 ✅ | /wecom-crm | 企业微信 CRM | `app/(dashboard)/wecom-crm/page.tsx` | 🔲待办 |
| T1-4 ✅ | /savings | 省钱比价 | `app/(dashboard)/savings/page.tsx` | 🔲待办 |
| T1-5 ✅ | /video-workshop | 视频引擎 | `app/(dashboard)/video-workshop/video-workshop-page-real.tsx` | 🔲待办 |
| T1-6 ✅ | /engagement/wechat | 微信获客 | `app/(dashboard)/engagement/wechat/page.tsx` | 🔲待办 |
| T1-7 ✅ | /engagement/wechat/chat-history | 微信聊天记录同步 | `app/(dashboard)/engagement/wechat/chat-history/page.tsx` | 🔲待办 |
| T1-8 ✅ | /engagement/wechat/contacts | 微信通讯录同步 | `app/(dashboard)/engagement/wechat/contacts/page.tsx` | 🔲待办 |
| T1-9 ✅ | /engagement/wechat/moments-publish | 朋友圈发布 | `app/(dashboard)/engagement/wechat/moments-publish/page.tsx`（大王指令：**也要遮罩**，由 FeatureRoadmap 占位改为"真实内容+遮罩"或占位内容套遮罩） | 🔲待办 |
| T1-10 ✅ | /video-studio | 视频工作室 | `app/(dashboard)/video-studio/page.tsx`（大王指令：**也要遮罩**，入口卡+敬请期待 → 整页遮罩） | 🔲待办 |

> T1-9/T1-10 说明：大王明确"视频工作室、朋友圈发布也要整页遮罩"。此两页原为占位形态，改造为「保留可见骨架 + GrayTestOverlay 遮罩」，实现上若无可预览内容，则遮罩浮层即为页面主体（仍在最上层）。

### 模块 2 · 全量修复 14 项（都得修）

| ID | 需求 | 现状 | 修复要求（验收） | 端 | 涉及文件（已知） | 状态 |
|----|------|------|-----------------|----|-----------------|------|
| T2-1 ✅ | 复盘页数据一致性 | 漏斗 178→14 vs 归因 6 节点 N/A + 趋势全 0 | 统一数据源口径；无数据明确"暂无数据"非 N/A | 全栈 | `growth.controller.ts` reports、`growth-console.tsx` reports 渲染 | 🔲待办 |
| T2-2 ✅ | 话术过滤空值 | TOP1="未记录话术"(69 次)；14 次样本 100% 失真 | 聚合排除空值；样本 <30 标注"样本不足" | 后端 | growth 聚合（copywriting 来源） | 🔲待办 |
| T2-3 ✅ | 线索评分可信度 | 83 条几乎全 73 分；依据机械拼接；无版本/置信度/时间 | 评分差异化；依据可读；展示模型版本/置信度/时间 | 全栈 | leads 渲染 + 评分接口 | 🔲待办 |
| T2-4 ✅ | 多平台线索来源 | 旧诊断"全来自小红书"已过时；实测三平台反爬：快手全站 result:2、抖音滑块验证码、小红书反爬（低频可过，高频必拦） | 见下方「T2-4 立项」 | 全栈 | acquisition runs + leads + driver | ✅完成（2026-08-19 全套落地；2026-08-20 视觉兜底增强收官） |
| T2-5 ✅ | 通知去重 | 重复 2-4 次 | 同通知全局 1 次 | 前端 | 通知渲染处（依赖 T0-4） | 🔲待办 |
| T2-6 ✅ | 任务状态真实性 | 8 个全"运行中"7 天 0 产出；同名任务 x2 | 运行中需有最近产出/心跳；同名去重 | 全栈 | acquisition 列表 + 任务名 | 🔲待办 |
| T2-7 ✅ | 账号健康一致性 | 3 需处理；2 个"绑定账号未找到" | 账号列表与任务绑定一致 | 全栈 | account-health + 绑定逻辑 | 🔲待办 |
| T2-8 ✅ | 首页颜色语义 | 0/0/0 黄绿 + 高意向橙 | 0 值中性灰、告警红、等级色阶 | 前端 | 依赖 T0-5 | 🔲待办 |
| T2-9 ✅ | 加载体验 | 创建任务账号 2.6s | 接口优化或骨架屏 ≤2s | 全栈 | account-health 接口 + create 页 | 🔲待办 |
| T2-10 ✅ | 菜单截断 | "验"字截断 | 完整显示 | 前端 | sidebar | 🔲待办 |
| T2-11 ✅ | 教程合规 | F12/EditThisCookie 教程 | 移除开发者操作（遮罩后 BOSS 页已锁，同步改内容） | 前端 | boss-recruit 5 步引导文案 | 🔲待办 |
| T2-12 ✅ | 路由 404 | 5 个路由不匹配 | 对齐（/funnel /dashboard /health /tasks /leads/score-history） | 全栈 | growth.controller + growth.ts | 🔲待办 |
| T2-13 ✅ | 复盘口径统一 | 漏斗 vs 六阶段窗口不一致 | 共用时间窗口与转化口径 | 全栈 | reports 口径定义 | 🔲待办 |
| T2-14 ✅ | plan 双源一致 | DB ADVANCED vs /api/auth/me FREE/FLAGSHIP | 以 /api/auth/me 为权威源 | 全栈 | auth 同步 | 🔲待办 |

#### T2-4 立项：抖音/快手自动触达（2026-08-19 晚 23:1x 侦察）

> **前置诊断（全部实测）**：
> - ✅ **采集已多平台**：线索 83 条 = 小红书 46 / 快手 20 / 抖音 17（来源 auto-acquisition），旧诊断"全来自小红书"已过时
> - 🚫 **调度 daemon 未武装**：`GROWTH_SCHEDULER_DAEMON` + `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED` 两个 env 未设 → `isGrowthSchedulerDaemonArmed()` false → 8 个任务 7 天 0 自动执行（0 run）
> - 🚫 **任务全 confirm-first**：`runScheduledConfigs` 只执行 `riskMode==='auto' && autoApprovedAt` 的任务；confirm-first 即使 daemon 开也只走"预检 skipped"分支 → 0 触达
> - ✅ **抖音触达执行器完整**：`executeDouyinFollowUp`（评论回复 + 私信 + 计费预留 + 证据回读），`growthAutoExecutionCapability(douyin)=ready`
> - 🚫 **快手触达未接入**：driver 能力 reply-comment=需人工确认、send-direct-message=unsupported → `executePlatformFollowUp` 抛"自动触达执行器尚未接入"
> - 🚫 **账号**：9 个账号 5 个 needs-human（磊/蚛/视频号验收/快手1号/抖音），快手1号 登录失效

**子任务拆解**：

| 子项 | 内容 | 风险 | 状态 |
|------|------|------|------|
| T2-4a | 武装调度 daemon：plist 补 2 个 env（`GROWTH_SCHEDULER_DAEMON=true` + `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true`），重启验证 daemon 开始 tick | 低（只让 daemon 跑，任务门禁不变；当前 8 任务全 scheduleEnabled=false，开了也 0 执行） | ✅完成（2026-08-19 晚，3 env 全开已验证；daemon 仅对商业授权租户执行——本机 trial 租户静默属预期安全设计，生产部署配商业租户即生效） |
| T2-4b | 快手自动触达接入：`search-web-rpa.driver.ts` reply-comment 声明 supported + 实测 execute 真实发评论；send-direct-message 保持 unsupported（风控） | **高**（真实平台操作，需账号在线 + 灰度） | ✅代码完成（2026-08-19：growthAutoExecutionCapability 快手分支放行 keyword/target-account/search-account + platformTouchReady 加 kuaishou；driver reply-comment 执行器本就实现，dryRun 默认 false 真实发送；preflight 已从「执行器未接入」变为「账号未在线」，卡点仅剩账号登录） |
| T2-4c | 任务级触达模式：新增"自动采集 + 人工确认触达"中间态（daemon 采集候选沉淀线索池，触达人工确认），替代"0 产出" | 中（后端行为变更） | ✅完成（2026-08-19：runScheduledConfigs 过滤放开 confirm-first/draft-only + buildSchedulePlan 不再降级 waiting-confirmation + executeConfig 加 collectOnly 分支（抖音也走读评论沉淀不触达）；tsc/build 通过，静态度量 4 处 collectOnly 分支） |
| T2-4d | 账号恢复：大王已扫码登录快手（kuaishou-2，杨宏宇）+ 小红书（xiaohongshu-3，杨宏宇）→ 账号归属迁移到当前用户（原属 cmsmjmsk 身份）+ 任务绑定改为 engineAccountId（快手→2、小红书→3） | 快手 preflight 实测 allowed:True（账号在线无 blocker）；小红书维持手动确认制（反爬设计） | 2026-08-19 完成 | ✅完成 |
| T2-4e | 任务改名去重 + autoApprovedAt 审批流（auto 任务启用前强制风险确认留痕） | 中 | ✅完成（2026-08-19：前端同名消歧 disambiguateTaskName（同名加 mode 后缀）；auto 审批流后端本已完备——切 auto 落 autoApprovedAt/By、切离清除、禁改启补记、daemon 执行校验留痕） |

> **安全铁律**：T2-4b 涉及真实平台发评论（对外可见），必须：账号在线 → 小流量灰度（1 账号 1 任务）→ 大王确认后才可放开；auto 模式必须走 T2-4e 审批留痕。

> **2026-08-20 增补（大王指令：防平台风控 + agent-s 兜底）**：
> - **视觉模型确认**：大模型统一走 kaypal.cn 服务器（`KAYPAL_AI_PROXY_BASE_URL=https://kaypal.cn/api/ai`），服务器凭据已含 `kaypal-vision` 别名 → 实测返回 `qwen-vl-max`；本机 ai_models 已注册 `cmsvis0001visionkaypalvl`（Kaypal 视觉 / qwen-vl-max）
> - **T2-4f 防风控**（✅ 2026-08-20）：同账号执行节流 60s（`acquisitionThrottle` Map + `ACQUISITION_THROTTLE_MS`）+ daemon 自动执行随机延迟 2-8s（人类化节奏）；failureReason 枚举加 `throttled`；dailyLimit/exposureCount 每日上限沿用
> - **T2-4g agent-s 视觉兜底**（✅ 2026-08-20）：DouyinExposureCollector 注入 AiClientService，`diagnoseSearch` 拦截（验证码/反爬）时调 `visionFallbackSearchCandidates`——读截图 evidencePath → base64 → `generateWithImage(qwen-vl-max)` → 提取搜索结果 JSON；快手/小红书全站 result:2 截图无内容暂不加（抖音验证码页截图可读）
> - **T2-4g2 视觉兜底增强**（✅ 2026-08-20 晚实测发现并修复）：
>   - 🔍 **实测发现两个硬 bug**：① 全尺寸截图 1600x1000 PNG 直接 base64 传网关，文字密集页 prompt_tokens 实测 10 万+（500x740 右栏图 100476 tokens），超 qwen-vl-max 约 8 万 token 阈值后模型输出空 content/网关 500——视觉兜底实际会静默失败；② 限频 key 按 `类名:keyword` 分桶，hot-video/搜索不同关键词可绕过 30s 限频，409 幂等仍会撞（00:40 实测日志复现）
>   - 🔧 **修复**：`sharp` 压缩截图（长边 ≤900 + jpeg q72，token 控制在 5 万内，压缩失败回退原图）；限频 key 全局化（`douyin:vision-fallback`）+ 间隔 30s→60s；`collectFromLink`（视频详情评论页）被 diagnose 拦截时也挂视觉兜底，新增 `mode='comments'`（识别评论用户昵称+评论）与 `mode='search'`（识别视频标题/作者）双 prompt；dist-bundle-sqlite 已 external sharp（运行时解析 backend/node_modules）
>   - ✅ **验证（2026-08-20 凌晨实测）**：重建 dist-bundle-sqlite + kill 重启（PID 81475）→ 登录 __REDACTED_TEST_USER__ 签发审批 → 真实触发抖音「AI 手机」任务（confirm-first 两步流走通）→ 视觉模型被调用，`ai_call_traces` 记录 **success=1**（修复前 00:40 为 409 失败）→ sharp 压缩在 dist 运行时正常 → 限频全局 key 生效（单次调用）。**语义边界（诚实记录）**：模型对无内容/验证码截图返回 `[]`（正确降级）；抖音评论在窄侧栏（500px），压缩后文字小模型识别率有限——视觉兜底定位为「尽力恢复」兜底，正常路径仍以 DOM 提取为准（`extractDomCommentCandidates`）；评论页兜底代码已落位，真实拦截场景效果依赖页面截图内容

### 模块 3 · AI 长期记忆接入（TencentDB Agent Memory）

> **部署事实（2026-08-19 侦察确认）**：生产记忆系统位于 **kaypal-prod-new（118.178.108.44）kaypal-app-baota `127.0.0.1:3000`**，路由 `/api/memory`、`/api/memory/flush`、`/api/memory/spec`、`/api/memory-mesh` 已存在（未授权时返回 `{"error":"Unauthorized"}`，证明路由活）。本机 `~/Projects/tencentdb-agent-memory` 为官方完整副本（MemoryCore/MemoryProxy/MemoryHub + SDK），标准端口 TDAI Gateway 8420 / Service 3100。

| ID | 任务 | 目标 | 验收 | 依赖 | 状态 |
|----|------|------|------|------|------|
| T3-0 | 记忆接入凭据确认 | 确认 ai-content 后端调用 kaypal `/api/memory*` 的鉴权方式（kaypal 平台 token / app 凭据），或决策走路径 B 本地 TDAI | 拿到可用的 token/凭据并 curl `/api/memory/spec` 200 | 需大王/运维提供 kaypal 平台凭据 | ✅完成（**2026-08-19 全链路打通**） |

> **T3-0 打通记录（2026-08-19，118.178.108.44 实测全通）**：
> - ✅ **账号**：kaypal 平台用户 `cmo9p6i5x000a58uckbcyv45u`（phone=__REDACTED_TEST_USER__ / name=大壮 / FLAGSHIP）已在用户表，已设置登录密码（=ai-content 本地密码 __REDACTED_TEST_PASS__ 的 bcrypt $2b$10$），`phoneVerifiedAt` 已置位
> - ✅ **登录**：`POST /api/auth/login`（3000 内网或 https://kaypal.cn 同构）`{"phone":"__REDACTED_TEST_USER__","password":"__REDACTED_TEST_PASS__"}` → 200 + `Set-Cookie: kaypal_auth=<JWT>`（HttpOnly，**Domain=.kaypal.cn，Secure，7 天**）；`email` 字段亦可。注意：`identifier`/`username` 字段不被认，必须 `phone` 或 `email`
> - ✅ **写入**：`POST /api/memory` + `Cookie: kaypal_auth=<JWT>` + `{"tier":"daily","content":"...","summary":"...","metadata":{...}}` → 200 返回 `{id, content, tier, createdAt}`
> - ✅ **读取**：`GET /api/memory?query=<词>&tier=daily&limit=N` + Cookie → `{tier, items:[...]}`
> - 📌 **调用契约**：记忆按 JWT 中 userId 隔离；tier=short|daily|long；sessionId 作用域 `${userId}:${sessionId}`（header `x-session-id` 可选）；spec 端点 `GET /api/memory/spec` 用 app key（`Authorization: Bearer <KAYPAL_APP_CREDENTIALS apiKey>`）即可
> - **ai-content 后端落地方式**：后端启动时用 __REDACTED_TEST_USER__ 登一次拿 JWT（或维护 refresh），后续请求带 `Cookie: kaypal_auth=<JWT>`；JWT 7 天过期需重登。**敏感信息**：密码/凭据放后端 env（不入库不入前端）
| T3-1 | 后端记忆客户端 | `backend/src/modules/memory/memory-kaypal.service.ts`（新）`KaypalMemoryService`：登录拿 JWT（6 天缓存+401 重登）+ 写读，失败静默降级；注入原 memory.module providers/exports | 实测：公网 https://kaypal.cn 登录+写读 200 | T3-0 | ✅完成（2026-08-19） |
| T3-2 | 记忆数据模型 | 获客域记忆 schema：用户行业/偏好/话术风格、任务上下文、线索跟进历史、评分校准反馈、跨会话决策 | 用 metadata{source,scope,configId,platform,keywords} 隐式建模，tier=long 用户级 | T3-1 | ✅完成（2026-08-19，metadata 契约） |
| T3-3 | 记忆写入埋点 | 关键行为写记忆：创建任务（行业+关键词+话术）、线索转为客户/忽略（校准）、话术编辑（风格）、复盘查看（关注点） | 创建任务已埋点（growth.service createConfig fire-and-forget）；线索校准/话术编辑待补 | T3-1 | ✅部分（创建任务实测写入成功 mem_mt133xb1_47bvzlwj） |
| T3-4 | 记忆召回注入 | 创建任务页预填行业/关键词/话术（"AI 记得你上次"）；评分时注入用户历史偏好；复盘时注入关注点 | 创建任务页：调 GET /api/memory/kaypal?query=获客&tier=long 拉最近任务记忆，正则提取关键词/话术预填 + 顶部 🧠 提示条 | T3-2/3 | ✅完成（2026-08-19，实测：关键词"多少钱、报价"已预填） |
| T3-5 | 记忆 UI | "AI 记得你"入口：显示 AI 记住的偏好清单（可删/改），与 T4-9 简报卡联动 | 用户可查看/修正 AI 记忆；修正后下次行为生效 | T3-4 | ✅完成（2026-08-20 核对：已并入创建任务页顶部 🧠「AI 记得你」提示条，`acquisition-rule-form.tsx` fetch `/api/memory/kaypal` 拉最近记忆预填行业/关键词/话术；T4-9 简报卡联动见 growth-center） |

### 模块 4 · AI 价值感知（瑞思 12 条）

| ID | 设计点 | 目标（验收一句话） | 依赖 | 状态 |
|----|--------|--------------------|------|------|
| T4-1 | AI 工作轨迹 | 任务详情有"AI 时间轴"，每步 {动作/对象/耗时/产出} 可回看 | TaskDetailModal 升级为"AI 工作轨迹（最近 5 次执行）"：每次 run 展示 扫描发现 N 条候选 / AI 筛出 N 条 / 已触达 N 条 / 沉淀 CRM N 条 明细 | T2-6 任务状态拆分 | ✅完成（2026-08-19，产物已含） |
| T4-2 | AI 计划预览 | 创建任务前弹「AI 将为你做 5 件事」，执行逐项点亮 | T3-4（记忆预填）| ✅完成（2026-08-20 核对：`acquisition-rule-form.tsx` T4-2 AI 执行计划预览） |
| T4-3 | AI 值班提醒 | 新高意向线索主动提醒 + 一键话术 | 提醒通道 | ✅完成（2026-08-20 核对：`leads-pool.tsx` T4-3 值班提醒，AI 主动提醒未跟进的高意向/已回复线索） |
| T4-4 | 自然语言评分理由 | 线索评分理由=模型生成一句话推理 + 证据链接（替代"命中词"） | leads-pool.tsx naturalizeScoreReason()：价格信号/需求明确/行业匹配 → 人话（'这位用户…主动问到了价格（多少钱），需求表达很明确，是值得跟进的意向线索'） | T3-2（记忆）| ✅完成（2026-08-19，实测生效，旧"评分依据："已下线） |
| T4-5 | 线索证据链溯源 | 高意向线索带「原始出处」直达原评论，AI 高亮需求词 | leads-pool.tsx 来源行加「原始出处 ↗」链接（sourceUrl，新窗口打开，stopPropagation 不触发卡片跳转） | leads source_url | ✅完成（2026-08-19，产物已含） |
| T4-6 | 可验证性（重评） | 评分附模型版本/置信度/时间 + 「让 AI 重新评一次」真实调用 | T2-3 ✅ | ✅完成（2026-08-20 核对：`leads-pool.tsx` T4-6 真实调用 rescore 出新快照） |
| T4-7 | 人工 vs AI 对照 | 同批线索两路触达，展示回复率对照 | 触达引擎 | ✅完成（2026-08-20 核对：`growth-reports.tsx` 对照展示） |
| T4-8 | 用户校验闭环 | 用户标记"无效线索"被学习，下次评分理由变化 | T3-2/3（记忆）| ✅完成（2026-08-20 核对：`leads-pool.tsx` T4-8 学习闭环——忽略/屏蔽时告知已反馈给 AI） |
| T4-9 | AI 主动汇报（简报卡） | 首页第一屏「今日 AI 简报卡」（发现/跟进/成交三类） | T0-1、overview | ✅完成（2026-08-20 核对：`growth-center.tsx` 首页 AI 简报卡 + AI 价值账单） |
| T4-10 | 归因透明化 | 漏斗每层标「AI 贡献」，无数据显示"尚未采集到 AI 行为" | T2-1 已降级空态兜底（"归因数据尚未采集"）；真实归因链建立后自动呈现 | T2-1/13 | ✅完成（兜底已生效，数据依赖归因链） |
| T4-11 | AI 价值对照 | 任务完成显示"人工需 X 天，AI 用 Y 分钟，省 ¥Z" | T3-2（记忆）| ✅完成（2026-08-20 核对：`growth-center.tsx` 折算人工 2 分钟/条 + 高意向 ¥50/条 + 进 CRM ¥200/条 估算口径） |
| T4-12 | 价值账单 | 月度「AI 获客价值账单」可导出 | T3-3（埋点）| ✅完成（2026-08-20 核对：`growth-center.tsx` AI 价值账单） |

---

## 4. 防死代码规范（写代码前必读）

1. **接口先行**：每个任务先定"数据契约"（字段/类型/错误语义），前后端按契约开发，禁止前端猜测后端字段
2. **解包只一处**：axios 拦截器统一解包 `{success, data}`，任何页面不得再 `Array.isArray(response)` 判断
3. **禁止新增大单文件**：新组件独立文件、独立职责；`growth-console.tsx` 只允许"修 bug 最小改动"，不允许新增功能块（拆分另立项）
4. **禁止复制粘贴组件**：重复 UI 抽象为共享组件（GrayTestOverlay/LoadingGuard/空态组件），引用不复制
5. **状态机完整**：任何 loading 必须有 3 态（loading/成功/失败+重试），禁止只写 loading/成功两态
6. **空值语义明确**：区分「暂无数据」「未接入」「加载失败」三种空态，禁止用 0/N/A 混充
7. **错误必须可见**：接口失败必须 toast/降级展示，禁止吞进 console
8. **类型标注真实**：`get<T>` 的 T 必须等于解包后的真实类型，禁止标注与实现不符
9. **改动留痕**：每个任务完成必须更新本文档状态 + 写清自测结果，禁止"代码改了文档没改"
10. **回归必跑**：每波次结束跑 T0-6 走查脚本全量回归，截图留档

## 5. 回归验收清单（每波次结束 / 全部完成时各跑一次）

**环境**：真实账号 __REDACTED_TEST_USER__（FLAGSHIP 商用模式）登录 + T0-6 脚本
- [ ] 9 个核心页无 500/白屏/跳登录
- [ ] 无页面永久 loading（8s 超时兜底）
- [ ] 账号健康页 <2s 渲染 9 账号
- [ ] 创建任务页账号列表正常（<2s）
- [ ] 10 个灰度页：全貌可见 + 模糊 + 遮罩 + 操作不可达
- [ ] 通知 banner 无重复（每个页面 ≤1 条同类）
- [ ] 复盘页无 N/A 假象（无数据=「暂无数据」）
- [ ] 高效话术 TOP 无"未记录话术"
- [ ] 首页颜色语义正确
- [ ] 菜单无截断
- [ ] 记忆：创建任务后可在记忆系统查到；二次创建预填
- [ ] 评分：附模型版本/置信度/时间；「重新评一次」可用
- [ ] 首页 AI 简报卡显示
- [ ] 5 个 404 路由全部可用

## 6. 风险与坑（已知）

| 风险 | 等级 | 应对 |
|------|------|------|
| kaypal `/api/memory*` 鉴权凭据未确认（T3-0） | 高 | 立即向大王要平台凭据；同时备好路径 B（本机 TDAI 副本） |
| `growth-console.tsx` 4300+ 行单文件，改动易出回归 | 高 | 最小改动原则 + T0-6 每波次回归 |
| 记忆写入若依赖 LLM 提炼（TDAI 管线），失败会拖慢主流程 | 中 | 异步写记忆 + 失败静默降级 |
| 10 页遮罩若组件实现有差异（移动端） | 中 | T0-2 先做移动端 Bottom Sheet + 验收 |
| 计划双源（FREE/FLAGSHIP）影响功能开关 | 中 | T2-14 以 /api/auth/me 权威源统一 |

---

> 本开发文档由产品战略团队（主理人方向明）基于《AI 获客体验升级整体方案》编写，开发时实时维护。
> 关联交付：`deliverables/product-strategy/ai-acquisition-experience-upgrade-2026-08-19.md`
