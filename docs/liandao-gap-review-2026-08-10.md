# 炼刀 AI 员工 vs JIUZHANG AI · 代码级差距复核（2026-08-10 第四轮）

> 方法：炼刀 1.8.5 渲染端 asar 反解（188 个 IPC 端点提取）→ 对照 JIUZHANG 当前源码逐项 grep 验证
> 前情：2026-07-30 差距评估（274 端点）→ 2026-08-09 三轮审计（微信 8 能力/社交互动/多平台发布/AI 员工已补齐）→ 本报告为最新一轮
> 结论：**核心赛道能力已对齐 80%+，剩余差距集中在「获客纵深」（TikTok/POI/手机操控）与「通用 RPA 层」（悬浮球/AI 网页代操作）**

---

## 一、已确认对齐（前几轮补齐，本轮复核 ✅）

| 能力 | 炼刀 | 我们 | 状态 |
|---|---|---|---|
| 微信营销自动化（8 能力） | ~80 端点 | 联系人/会话/群发/加友/朋友圈×2/自动回复/直播回复 双平台 | ✅ 全对齐（auto-reply win 已补） |
| 群发计划 | 14 端点 | 9 端点（list/create/detail/pause/resume/resend/remove） | 🟡 缺 completed 完成列表/config/upgrade-data-version |
| 社交互动 | 4 平台 | 抖音/视频号 × 评论/私信 真实浏览器 | ✅ |
| 多平台发布 | 9 平台 | 9 平台（weibo/zhihu/toutiao 本轮已接） | ✅ |
| 曝光/获客自动化 | ~35 端点 | 5 种曝光 + growth 获客 + Boss 直聘采集 | ✅ 骨架完整 |
| AI 员工工作流 | workflow 6 端点 | ai-employee-workflow（依赖编排+授权确认） | ✅ 更完整 |
| 客户管理 | private_message 6 | crm（互动关联+跟进话术） | ✅ |
| 视频创作 | ~44 端点 | 一键成片（studio_core）+ video-workshop 模板 | 🟡 深度待核 |

---

## 二、本轮新确认的差距（代码级实锤）

### 🔴 差距 1：TikTok 全链路（炼刀 17 端点，我们 0 真实能力）

炼刀：`/tiktok/authorize` `/tiktok/accounts` `/auto_add_friend` `/extract_phone` `/smart_reply` `/data/report` 等 17 个
我们：`redfox-interface-catalog` 只有 `platformCode: 'tool-tiktok'` **接口目录虚位条目**——无授权流程、无账号管理、无自动加友、无号码提取、无智能回复

**影响**：海外版抖音获客完全空白。炼刀主打「自动加友 + 号码提取 + 智能回复」闭环，我们只有国内抖音。
**决策（2026-08-10）**：❌ **不考虑上 TikTok 全链路**（产品方向排除海外获客），不排期。

### 🔴 差距 2：POI 门店管理（炼刀 5 端点，我们 0）

炼刀：`/poi/create` `/poi/edit` `/poi/pages` `/poi/delete` `/poi/report`——本地生活商家门店点位管理
我们：grep 全库无 poi 模块

**影响**：本地生活赛道（探店/团购）缺失。炼刀有「门店探店」内容场景，我们有 video-workshop 门店探店模板但无 POI 数据层。

### 🔴 差距 3：通用 RPA 层（悬浮球 + 手机操控 + AI 网页代操作）

| 子项 | 炼刀 | 我们 | 说明 |
|---|---|---|---|
| 桌面悬浮球 hoverBall | 独立窗口（快捷操作） | ❌ 无 | UI 形态缺失 |
| 手机远程操控 | nut-js + 手机操控 | ❌ 无 | 获客物理层缺失 |
| AI 网页代操作（midscene） | AI 驱动网页点击 | 🟡 有 LocalBrowserEngine+Playwright（**底层真实浏览器有**） | 缺「AI 自然语言驱动网页操作」的产品形态；browser-assist 仅社媒互动辅助 |

### 🟡 差距 4：Token/RPA 额度追踪（炼刀 3 端点，我们只有次数配额）

炼刀：`/token` `/token/rpa/use/pre_check` `/token/rpa/use/report`——token 消耗量 + RPA 调用预检/上报
我们：`AiUsageQuota` 只有**每日对话/工具次数**（chatCount/toolCount），无 token 消耗量、无 RPA 额度预检

### 🟡 差距 5：商品视频/智能剪辑

炼刀 video_creation 19 端点含：商品视频剪辑、视频合成模板、下载任务队列、文案扩展
我们：video.service 一键成片（studio_core）+ video-workshop 模板（门店/案例/卖点）——**商品视频自动剪辑与下载队列未确认**

### 🟡 差距 6：RPA 聊天同步（`/rpa_sync_chat_history`）

炼刀：RPA 模拟操作同步微信聊天
我们：微信聊天历史走 native runner + OCR 兜底（直接读库/视觉识别，非 RPA 模拟）——**技术路线不同但能力等价**，无需补

---

## 三、差距优先级建议（2026-08-10 更新：TikTok 已排除）

| 优先级 | 差距 | 理由 | 参考工作量 |
|---|---|---|---|
| ~~P0~~ | ~~POI 门店数据层~~ | ✅ **已完成（2026-08-10）**：PoiStore + /api/poi 5 端点 + 城市/分类聚合报告 | - |
| ~~P0~~ | ~~Token 用量追踪 + RPA 额度预检~~ | ✅ **已完成（2026-08-10）**：/api/usage/token GET/pre-check/report + token_count 累计 | - |
| ~~P1~~ | ~~商品视频自动剪辑~~ | ✅ **已完成（2026-08-10）**：/api/video/product-copy 带货文案 + /api/video/product-cut 商品成片（promo 管线，离线降级） | - |
| ~~P2(接口层)~~ | ~~AI 网页代操作~~ | ✅ **接口层已完成（2026-08-10）**：/api/local-engine/browser/ai-action（指令→动作→真实浏览器+证据）；悬浮球 UI 与 AI-LLM 动作解析为二期 | - |
| ~~P3~~ | ~~群发计划管理端点补齐（completed/config）~~ | ✅ **已完成（2026-08-10）**：/groups/plans/config 新增；completed 走 status 过滤 | - |
| ~~P0~~ | ~~TikTok 授权 + 自动加友 + 号码提取~~ | ❌ 已排除（产品方向不含海外获客） | - |

---

## 四、结论

1. **赛道核心能力已对齐 80%+**：微信自动化/社媒互动/多平台发布/获客曝光/AI 员工全链路无虚位
2. **真实差距 = 获客纵深 + 通用 RPA 形态**：POI（0）、Token 用量（0）、手机操控/悬浮球/AI 网页代操作（0）、商品视频剪辑（未深）——TikTok 已由产品决策排除（2026-08-10，海外获客不在方向内）
3. **技术可行性高**：AI 网页代操作可基于已有 LocalBrowserEngine 加 AI 意图层；POI/Token 用量是标准数据层；无需新建基础设施
4. 2026-08-10 已全部交付：Token 用量 / POI / 商品视频 / 群发端点 / AI 网页代操作接口层；二期候选：悬浮球 UI、AI-LLM 动作解析增强
