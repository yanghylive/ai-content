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
| 模块 0 工程基建 | 6 | 6 | 0 | 0 | 0 |
| 模块 1 灰度遮罩改造 | 11 | 11 | 0 | 0 | 0 |
| 模块 2 全量修复 14 项 | 14 | 14 | 0 | 0 | 0 |
| 模块 3 AI 长期记忆接入 | 5 | 5 | 0 | 0 | 0 |
| 模块 4 AI 价值感知 | 12 | 12 | 0 | 0 | 0 |
| **合计** | **48** | **48** | **0** | **0** | **0** |

> 最后更新：2026-08-19（文档创建）

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
- **依赖**：无　**状态**：🔲待办
- **防死代码**：解包只写一处；类型标注同步修正（`get<GrowthAccountHealth[]>` → 真实返回类型）

#### T0-2 GrayTestOverlay 遮罩组件（新建）
- **目标**：通用"整页预览 + 背景模糊 + 上层遮罩"组件（析客规格：blur 8-12px、浮层含功能名+状态+返回、滚动可预览但操作不可达、Esc 返回、「知道了」会话内记忆）
- **涉及文件**：`frontend/src/components/v2/gray-test-overlay.tsx`（新）
- **改动点**：模态语义（焦点锁定）、移动端 Bottom Sheet、深浅色用 `--kaypal-v3-*` token、`backdrop-filter: blur()`
- **验收**：按析客 1.5 节 5 条验收标准全过；在任意页面包裹后无布局破坏
- **依赖**：T0-1　**状态**：🔲待办
- **防死代码**：纯展示组件，不塞业务逻辑；props 只含 `feature/status/onClose/children`

#### T0-3 全局 LoadingGuard（8s 超时 + 错误降级）
- **目标**：所有接口 loading 8s 超时 → 失败 toast + 重试；替代手写 spinner
- **涉及文件**：`frontend/src/components/v2/loading-guard.tsx`（新）、`frontend/src/lib/hooks/use-loading-guard.ts`（新）
- **验收**：任一接口 8s 未返回 → 出现"加载超时，点击重试"；不再有页面永久转圈
- **依赖**：T0-1　**状态**：🔲待办

#### T0-4 通知去重 util
- **目标**：同一通知全局只展示 1 次
- **涉及文件**：`frontend/src/lib/utils/notification-dedupe.ts`（新）、通知渲染处
- **验收**：`/growth` 与 `/auto-acquisition/create` 的"账号 XX 登录状态异常"只出现 1 次
- **依赖**：无　**状态**：🔲待办

#### T0-5 颜色语义 util
- **目标**：数值色块统一语义：0 值中性灰、告警红、等级统一色阶
- **涉及文件**：`frontend/src/lib/utils/tone.ts`（新）、`growth-console.tsx` 首页 4 数字、漏斗
- **验收**：首页"今日 0/0/0"为中性灰、"高意向 4"为等级橙（非告警色）；漏斗层级同色阶
- **依赖**：无　**状态**：🔲待办

#### T0-6 回归走查脚本固化
- **目标**：把本次"真实账号 + puppeteer 9 页走查"固化成可重复脚本，供每波次回归
- **涉及文件**：`frontend/scripts/ux-regression-walk.mjs`（新，参照 /tmp/ux-walkthrough 逻辑）
- **验收**：一键跑 9 页 + 输出 walk.json + 截图；含 loading 卡死检测（8s）
- **依赖**：无　**状态**：🔲待办

### 模块 1 · 灰度遮罩改造（10 页）

> 统一做法：移除各页 `GrayTestBanner` 顶部横幅 → 用 `<GrayTestOverlay feature="XX">` 包裹整页内容。
> 依赖：T0-2。每页验收：页面全貌可见+模糊；所有按钮/输入不可点；「返回」「知道了」正常。

| ID | 页面 | feature 文案 | 涉及文件（已知） | 状态 |
|----|------|-------------|-----------------|------|
| T1-1 | /boss-recruit | BOSS 直聘 | `app/(dashboard)/boss-recruit/page.tsx`、`boss-recruit-center.tsx` | 🔲待办 |
| T1-2 | /wecom-assistant | 企业微信助手 | `app/(dashboard)/wecom-assistant/page.tsx` | 🔲待办 |
| T1-3 | /wecom-crm | 企业微信 CRM | `app/(dashboard)/wecom-crm/page.tsx` | 🔲待办 |
| T1-4 | /savings | 省钱比价 | `app/(dashboard)/savings/page.tsx` | 🔲待办 |
| T1-5 | /video-workshop | 视频引擎 | `app/(dashboard)/video-workshop/video-workshop-page-real.tsx` | 🔲待办 |
| T1-6 | /engagement/wechat | 微信获客 | `app/(dashboard)/engagement/wechat/page.tsx` | 🔲待办 |
| T1-7 | /engagement/wechat/chat-history | 微信聊天记录同步 | `app/(dashboard)/engagement/wechat/chat-history/page.tsx` | 🔲待办 |
| T1-8 | /engagement/wechat/contacts | 微信通讯录同步 | `app/(dashboard)/engagement/wechat/contacts/page.tsx` | 🔲待办 |
| T1-9 | /engagement/wechat/moments-publish | 朋友圈发布 | `app/(dashboard)/engagement/wechat/moments-publish/page.tsx`（大王指令：**也要遮罩**，由 FeatureRoadmap 占位改为"真实内容+遮罩"或占位内容套遮罩） | 🔲待办 |
| T1-10 | /video-studio | 视频工作室 | `app/(dashboard)/video-studio/page.tsx`（大王指令：**也要遮罩**，入口卡+敬请期待 → 整页遮罩） | 🔲待办 |

> T1-9/T1-10 说明：大王明确"视频工作室、朋友圈发布也要整页遮罩"。此两页原为占位形态，改造为「保留可见骨架 + GrayTestOverlay 遮罩」，实现上若无可预览内容，则遮罩浮层即为页面主体（仍在最上层）。

### 模块 2 · 全量修复 14 项（都得修）

| ID | 需求 | 现状 | 修复要求（验收） | 端 | 涉及文件（已知） | 状态 |
|----|------|------|-----------------|----|-----------------|------|
| T2-1 | 复盘页数据一致性 | 漏斗 178→14 vs 归因 6 节点 N/A + 趋势全 0 | 统一数据源口径；无数据明确"暂无数据"非 N/A | 全栈 | `growth.controller.ts` reports、`growth-console.tsx` reports 渲染 | 🔲待办 |
| T2-2 | 话术过滤空值 | TOP1="未记录话术"(69 次)；14 次样本 100% 失真 | 聚合排除空值；样本 <30 标注"样本不足" | 后端 | growth 聚合（copywriting 来源） | 🔲待办 |
| T2-3 | 线索评分可信度 | 83 条几乎全 73 分；依据机械拼接；无版本/置信度/时间 | 评分差异化；依据可读；展示模型版本/置信度/时间 | 全栈 | leads 渲染 + 评分接口 | 🔲待办 |
| T2-4 | 多平台线索来源 | 全来自小红书；抖音/快手 0 | 接入抖音/快手；未接入前标注"未接入" | 全栈 | acquisition runs + leads | 🔲待办 |
| T2-5 | 通知去重 | 重复 2-4 次 | 同通知全局 1 次 | 前端 | 通知渲染处（依赖 T0-4） | 🔲待办 |
| T2-6 | 任务状态真实性 | 8 个全"运行中"7 天 0 产出；同名任务 x2 | 运行中需有最近产出/心跳；同名去重 | 全栈 | acquisition 列表 + 任务名 | 🔲待办 |
| T2-7 | 账号健康一致性 | 3 需处理；2 个"绑定账号未找到" | 账号列表与任务绑定一致 | 全栈 | account-health + 绑定逻辑 | 🔲待办 |
| T2-8 | 首页颜色语义 | 0/0/0 黄绿 + 高意向橙 | 0 值中性灰、告警红、等级色阶 | 前端 | 依赖 T0-5 | 🔲待办 |
| T2-9 | 加载体验 | 创建任务账号 2.6s | 接口优化或骨架屏 ≤2s | 全栈 | account-health 接口 + create 页 | 🔲待办 |
| T2-10 | 菜单截断 | "验"字截断 | 完整显示 | 前端 | sidebar | 🔲待办 |
| T2-11 | 教程合规 | F12/EditThisCookie 教程 | 移除开发者操作（遮罩后 BOSS 页已锁，同步改内容） | 前端 | boss-recruit 5 步引导文案 | 🔲待办 |
| T2-12 | 路由 404 | 5 个路由不匹配 | 对齐（/funnel /dashboard /health /tasks /leads/score-history） | 全栈 | growth.controller + growth.ts | 🔲待办 |
| T2-13 | 复盘口径统一 | 漏斗 vs 六阶段窗口不一致 | 共用时间窗口与转化口径 | 全栈 | reports 口径定义 | 🔲待办 |
| T2-14 | plan 双源一致 | DB ADVANCED vs /api/auth/me FREE/FLAGSHIP | 以 /api/auth/me 为权威源 | 全栈 | auth 同步 | 🔲待办 |

### 模块 3 · AI 长期记忆接入（TencentDB Agent Memory）

> **部署事实（2026-08-19 侦察确认）**：生产记忆系统位于 **kaypal-prod-new（118.178.108.44）kaypal-app-baota `127.0.0.1:3000`**，路由 `/api/memory`、`/api/memory/flush`、`/api/memory/spec`、`/api/memory-mesh` 已存在（未授权时返回 `{"error":"Unauthorized"}`，证明路由活）。本机 `~/Projects/tencentdb-agent-memory` 为官方完整副本（MemoryCore/MemoryProxy/MemoryHub + SDK），标准端口 TDAI Gateway 8420 / Service 3100。

| ID | 任务 | 目标 | 验收 | 依赖 | 状态 |
|----|------|------|------|------|------|
| T3-0 | 记忆接入凭据确认 | 确认 ai-content 后端调用 kaypal `/api/memory*` 的鉴权方式（kaypal 平台 token / app 凭据），或决策走路径 B 本地 TDAI | 拿到可用的 token/凭据并 curl `/api/memory/spec` 200 | 需大王/运维提供 kaypal 平台凭据 | 🔲待办 ⚠️关键前置 |
| T3-1 | 后端记忆客户端 | `backend/src/modules/memory/` 封装（记忆写/读/搜索），支持路径 A（HTTP→kaypal `/api/memory*`）与路径 B（@tencentdb-agent-memory SDK）双实现 | 单测：写入→召回一致；错误时静默降级不阻断主流程 | T3-0 | 🔲待办 |
| T3-2 | 记忆数据模型 | 获客域记忆 schema：用户行业/偏好/话术风格、任务上下文、线索跟进历史、评分校准反馈、跨会话决策 | schema 落库（kaypal 侧或本地 TDAI）；类型与接口对齐 | T3-1 | 🔲待办 |
| T3-3 | 记忆写入埋点 | 关键行为写记忆：创建任务（行业+关键词+话术）、线索转为客户/忽略（校准）、话术编辑（风格）、复盘查看（关注点） | 上述行为触发写记忆，可在记忆系统查到 | T3-1 | 🔲待办 |
| T3-4 | 记忆召回注入 | 创建任务页预填行业/关键词/话术（"AI 记得你上次"）；评分时注入用户历史偏好；复盘时注入关注点 | 二次创建任务自动带上次行业与话术风格；评分理由引用历史反馈 | T3-2/3 | 🔲待办 |
| T3-5 | 记忆 UI | "AI 记得你"入口：显示 AI 记住的偏好清单（可删/改），与 T4-9 简报卡联动 | 用户可查看/修正 AI 记忆；修正后下次行为生效 | T3-4 | 🔲待办 |

### 模块 4 · AI 价值感知（瑞思 12 条）

| ID | 设计点 | 目标（验收一句话） | 依赖 | 状态 |
|----|--------|--------------------|------|------|
| T4-1 | AI 工作轨迹 | 任务详情有"AI 时间轴"，每步 {动作/对象/耗时/产出} 可回看 | T2-6 任务状态拆分 | 🔲待办 |
| T4-2 | AI 计划预览 | 创建任务前弹「AI 将为你做 5 件事」，执行逐项点亮 | T3-4（记忆预填）| 🔲待办 |
| T4-3 | AI 值班提醒 | 新高意向线索主动提醒 + 一键话术 | 提醒通道 | 🔲待办 |
| T4-4 | 自然语言评分理由 | 线索评分理由=模型生成一句话推理 + 证据链接（替代"命中词"） | T3-2（记忆）| 🔲待办 |
| T4-5 | 线索证据链溯源 | 高意向线索带「原始出处」直达原评论，AI 高亮需求词 | leads source_url | 🔲待办 |
| T4-6 | 可验证性（重评） | 评分附模型版本/置信度/时间 + 「让 AI 重新评一次」真实调用 | T2-3 | 🔲待办 |
| T4-7 | 人工 vs AI 对照 | 同批线索两路触达，展示回复率对照 | 触达引擎 | 🔲待办 |
| T4-8 | 用户校验闭环 | 用户标记"无效线索"被学习，下次评分理由变化 | T3-2/3（记忆）| 🔲待办 |
| T4-9 | AI 主动汇报（简报卡） | 首页第一屏「今日 AI 简报卡」（发现/跟进/成交三类） | T0-1、overview | 🔲待办 |
| T4-10 | 归因透明化 | 漏斗每层标「AI 贡献」，无数据显示"尚未采集到 AI 行为" | T2-1/13 | 🔲待办 |
| T4-11 | AI 价值对照 | 任务完成显示"人工需 X 天，AI 用 Y 分钟，省 ¥Z" | T3-2（记忆）| 🔲待办 |
| T4-12 | 价值账单 | 月度「AI 获客价值账单」可导出 | T3-3（埋点）| 🔲待办 |

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

**环境**：真实账号 18230326666（FLAGSHIP 商用模式）登录 + T0-6 脚本
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
