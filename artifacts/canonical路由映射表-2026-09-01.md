# JIUZHANG AI canonical 路由映射表（A 类盘点 · 终版）

> 日期：2026-09-01 · 范围：`frontend/src/app/(dashboard)/` 全部 240+ 路由
> 目的：厘清 canonical / alias / gray / desktop / create / detail，作为 A 类「canonical 收敛」实施依据。
> 结论先行：**代码层的「重复入口」已大量用 redirect 收敛，v1 的「碎片化重复」诊断大半是误判。真正剩下的 canonical 冲突很少，聚焦在互动正门 + 导航过期引用。**

---

## 一、三种「别名收敛」机制（代码层已存在的去重手段）

| 机制 | 位置 | 行为 | 数量 |
|---|---|---|---|
| `routeAliases` | `route-config.ts:11` + `layout.tsx:1006` | 客户端 `router.replace`（无 HTTP 301） | 25 条 |
| `redirect()` 页 | 各顶层 `page.tsx` | 服务端重定向（静态导出下退化客户端跳转） | 10 个 |
| `QueryPreservingRedirect` | `customer/page.tsx` 等 | 客户端保留查询参数跳转（静态导出安全） | 1 个 |
| re-export 页 | `admin/*`、`capabilities/*` | `export default XxxPage` 直接转发组件 | 21 个 |

---

## 二、`redirect()` 收敛页清单（10 个）

这些「看似重复」的顶层入口，实际已服务端重定向到 canonical：

| 重定向页 | canonical | 原 v1 误判 |
|---|---|---|
| `(dashboard)/page` | `/today` | — |
| `crm-closer` | `/crm/closer` | v1 列为「CRM 碎片」，实已收敛 |
| `crm-import` | `/crm/import` | 同上 |
| `crm-connectors` | `/crm/connectors` | 同上 |
| `customer` | `/crm`（QueryPreservingRedirect） | 同上 |
| `engagement/customers` | `/crm` | 同上 |
| `face-swap` | `/content/face-swap` | v1 列为「换脸双入口」，实已收敛 |
| `compliance-check` | `/compliance` | — |
| `distribution/compliance` | `/compliance` | — |
| `intelligence/inbox-processing` | `/intelligence/inbox` | v1 列为「收件箱双入口」，实已收敛 |

---

## 三、v1「重复环节」诊断的逐条撤回

| v1 判断 | 核实真相 | 结论 |
|---|---|---|
| CRM 7 目录碎片 | `crm-closer/import/connectors` 顶层均 `redirect` 到 `crm/*`；`customer` 收敛到 `/crm` | **撤回**，已收敛 |
| 换脸双入口 `face-swap` vs `content/face-swap` | 顶层 `redirect` 到 `content/face-swap` | **撤回**，已收敛 |
| 情报收件箱双入口 | `inbox-processing` `redirect` 到 `inbox` | **撤回**，已收敛 |
| 图片双入口 `image-gen` vs `ai-image-gen` | 是**两个功能**：`image-gen`=一句话图文多页配图；`ai-image-gen`=单图生图(qwen) | **撤回**，非重复 |
| 小红书双入口 `xiaohongshu` vs `xiaohongshu-assistant` | 是**列表 vs 生成器**配合：列表页 createHref/backHref 均指向 assistant | **撤回**，非重复 |
| 视频 7 入口碎片 | 是**不同引擎/形态**：Wan 图生视频 / Seedance / dashscope 文生视频 / 商品剪辑 / 发布计划 / 工作坊 / studio_core 独立产品 | **撤回**，非重复 |
| admin/capabilities 双轨镜像 | 已双层收敛：`routeAliases` + re-export 组件复用 | **撤回**，已收敛 |

> 教训：v1 把「功能多样性」和「路由别名收敛」误判成「重复环节」。真实问题不在「重复」，在**「功能发现」**——视频 7 引擎、图片 2 形态没有给用户清晰的「选哪个」导航。

---

## 四、真正剩下的 canonical 冲突（A 类实打实的活）

| # | 冲突 | 现状 | 建议 |
|---|---|---|---|
| C1 | **`/message` vs `/engagement`** | `message` 是 rail 一级「互动中心」ScenePage；`engagement` 是独立「统一收件箱 + 客服机器人」Tab 页 | 定互动正门：建议 `/engagement` 为收件箱 canonical，`/message` 收敛为入口卡片或 redirect |
| C2 | **sceneOfPath 6 处过期前缀** | 见下 | 清理 + 修正导航高亮 |

### sceneOfPath 过期引用（app-shell.tsx:43-108）

| 前缀 | 问题 | 实际路由 |
|---|---|---|
| `/douyin` | 死前缀 | `/engagement/douyin-messages`、`douyin-comments` |
| `/wechat` | 冗余（`/engagement` 已覆盖） | `/engagement/wechat` |
| `/confirmations` | 死前缀 | `/tasks/confirmations` |
| `/rpa-workbench` | 错位 | `/growth/rpa-workbench` |
| `/agent-console` | **死引用**（无 `agent-console/page.tsx`） | 已删未清引用 |
| `/report-new` | 错位 | `/intelligence/report-new` |

---

## 五、门控清单（gray / desktop / 占位）

### gray（9 页，`GrayTestOverlay` 可预览不可操作）
`savings`、`wecom-crm`、`boss-recruit`、`video-studio`、`video-workshop`、`engagement/wechat`、`engagement/wechat/moments-publish`、`engagement/wechat/contacts`、`engagement/wechat/chat-history`

### desktop（9 页，`DesktopOnlyGate` 移动端拦截）
`engagement/douyin-comments`、`local-engine/run`、`crm-import/flow`、`video-workshop`、`local-engine/workbench`、`solutions/run`、`solutions/configure`、`local-engine/browser`、`local-engine/desktop`

### 占位（2 页，`UnderConstruction`）
`video-studio`、`video-workshop`（均叠加 gray）

---

## 六、A 类可动手结论（聚焦，可回滚）

| 优先级 | 动作 | 说明 |
|---|---|---|
| P0 | C1 定 `/message` 与 `/engagement` canonical 关系 | 互动正门唯一，改导航映射 |
| P0 | C2 清理 sceneOfPath 6 处过期前缀 | 修正导航高亮 + 删死引用 `agent-console` |
| P1 | 视频/图片「能力导航」梳理 | 7 视频引擎 + 2 图片形态给统一入口说明（UX 层，非去重） |
| P2 | alias 命名去歧义 | `admin/tools`→本机服务 与 `capabilities/tools` 语义不一致 |

---

## 七、待确认（交底）

1. `agent-console` 死引用：需确认「已删未清」还是「漏建」，决定是删引用还是补页面。
2. `routeAliases` 走 `router.replace(path)` 不带 query，大王已指出可能丢查询参数——A2/A3 实施前需用真实点击验证 `replace` 是否保留 `?query`；`QueryPreservingRedirect` 已提供「保留参数」的正确范式，可统一采用。
3. 视频 7 引擎的「能力导航」属 UX 组织问题，不在本次「canonical 去重」范围内，单独立项。
4. 本次为静态盘点，未跑浏览器实测。
