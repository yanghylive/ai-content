# 全系统图标统一规范 v2.0

> 状态:已铺全(2026-09 · 经多轮验收 + 落地修正 + 全系统铺开)
> 适用范围:九章 桌面 + 移动端全部「入口 / 导航 / 快捷操作」图标位
> 相关文件:
> - `frontend/src/components/shell/rail-icons.tsx` —— RailIcon(主导航 rail)
> - `frontend/src/components/shell/brand-icons.tsx` —— BrandIcon(层一品牌图形,66 枚)
> - `frontend/src/components/shell/icons.tsx` —— ShellIcon(壳线性图标,未替换)
> - `docs/design/rail-nav-icon-standard.md` —— rail 图标专项规范(v1.0)
> - `docs/design/icon-system-inventory.md` —— 全库图标盘点基线(433 import 名)
> - `docs/design/icon-inventory.json` —— 图标名 → 使用文件完整清单

---

## 1. 为什么长这样(演进史 · 教训沉淀)

这套体系经历了「rail 定制 → 层一品牌图形 → 全系统铺开」三个里程碑,期间多次踩坑:

| 阶段 | 动作 | 教训(不可回退) |
|---|---|---|
| rail 图标 | 5 轮迭代定稿(线性点→印章→剪影→A 图形→金点亮) | ① 不给图标加背景容器/色块;② 图形要带「第二层细节」;③ 激活用「点亮」不用「贴块」 |
| 层一品牌图形 | 预览选定 → 落地踩坑 | ④ 预览是放大看,**落地前先确认小尺寸形态**;⑤ 实心图形若用 currentColor 会变「黑块」(浅底近黑);⑥ 实心金整体铺会「太土」;最终 **idle 雾紫灰 + gold 金渐变 + tint 随容器色** 三态 |
| 全系统铺开 | 内容/消息/设置/增长/CRM/移动端逐区覆盖 | ⑦ 改前先核实组件是否真实渲染(settings-center 是死代码白改一次);⑧ 共用数据源(nav-registry)不要乱加字段,渲染层做语义映射 |

**核心判断:图标分两类,不可混为一谈**
- **入口身份图标**(功能卡、导航、快捷入口、设置行、Tab)→ 用品牌图形(实心 + 细节 + 三态色)。
- **行内操作图标**(删除/刷新/关闭/上传/⌘K 命令行)→ 保持线性,品牌化会糊、伤可用性。

---

## 2. 体系总览(双层图标)

```
品牌图形层(实心 + 反白细节,入口身份)
├── RailIcon   主导航 rail 8 枚 + 主题钮  → rail-nav-icon-standard.md
└── BrandIcon  层一入口 66 枚             ← 本规范主体
     ├── idle  雾紫灰 #6b5b8e(桌面浅底行/卡)
     ├── gold  金渐变 #f0b45c→#c9811f(入口卡/快捷卡/激活)
     └── tint  currentColor(彩色 tint 容器内,随语义色)

统一线性层(行内操作,保持现状)
├── ShellIcon(壳 64 name,含 IconPark/自绘双轨)
├── IconPark 适配层(页面正文 14-24px outline)
└── @heroui 内置(盲区,库级干预)
```

---

## 3. BrandIcon 设计文法(必守)

- 24 网格面性图形,`viewBox 0 0 24 24`,无容器、无外框。
- 结构 = **主体实心图形**(一眼可读)+ **第二层细节**(1-3 个,反白细线/圆点/小条)。
- 主体激活 **不用 currentColor**(会近黑),detail 反白固定 `#fff`。
- `aria-hidden` + `focusable=false`;图标旁必有文字/aria-label 承载语义。

### 3.1 三态色语义(调用方按语境选)

| tone | 填充 | 细节 | 适用 |
|---|---|---|---|
| `idle` | 雾紫灰 `#6b5b8e` | 白 92% | 桌面**白底/浅底**行与卡(设置面板、ScenePage 未激活) |
| `gold` | 金渐变 `#f0b45c→#c9811f` | 白 100% | 金色系入口卡、快捷卡、增长卡、桌面渠道卡、素材库卡 |
| `tint` | `currentColor`(=容器语义色) | 白 100% | 移动端**彩色 tint 圆形容器**内的图标(随微信绿/抖音红等) |

**落地准则**:先看承载容器再定 tone——白底用 idle;金卡组用 gold;彩色底用 tint。三态都由同一 SVG 图形渲染,只换填充。

### 3.2 尺寸档位

| 位置 | 尺寸 |
|---|---|
| rail 主导航 | 24(rail-icons 固定) |
| ScenePage 功能卡 | 32 |
| WorkbenchCenter 快捷卡(桌面) | 30;quickActions 26 |
| 设置面板行(桌面) | 18 |
| 移动端菜单/宫格/工具行 | 18-20 |
| 移动端 Tab | 19 |
| 移动端渠道 svc | 22 |

---

## 4. 全系统接线地图(已铺区域)

| 区域 | 文件 | 图标来源/映射 | tone/尺寸 |
|---|---|---|---|
| 主导航 rail | `shell/app-shell.tsx` | `RailIcon`(8 场景 + 助手 + 我的) | active 金 / 24 |
| rail 主题钮 | `shell/app-shell.tsx` | `ThemeToggleIcon` | 金渐变描边 / 20 |
| 内容桌面 15 卡 | `(dashboard)/content/page.tsx` + `shell/scene-page.tsx` | 每卡 `brand:`(materials/topic/…) | gold / 32 |
| 消息渠道桌面卡 | `(dashboard)/message/page.tsx` | `CHANNEL_BRAND[key]` | gold / 32 |
| 消息渠道移动端 | `message/page.tsx` `MOBILE_CHANNELS` | `brandIcon` | tint / 22 |
| 设置面板(桌面) | `shell/settings-nav-panel.tsx` | `brandForMineKey(item.key)` | idle / 18 |
| 「我的」移动端菜单 | `(dashboard)/mine/page.tsx` | `MINE_BRAND` | tint / 18 |
| today 增长 7 卡 | `(dashboard)/today/today-center.tsx` | `brand:`(leads/acquisition/…) | gold / 30-38 |
| /settings/account 快捷卡 | `(dashboard)/settings/account/page.tsx` | `QUICK[].brand` | gold / 30 |
| CRM 快捷卡 | `(dashboard)/crm/crm-center.tsx` | `brand:`(userPlus/importTray/followUp) | gold |
| 回复规则中心 | `(dashboard)/engagement/rules/reply-rules-center.tsx` | `brand:` + advancedLinks brand | gold |
| CRM 导入中心 | `(dashboard)/crm/import/crm-import-center.tsx` | `brand:` + advancedLinks brand | gold |
| 内容移动端宫格/工具 | `(dashboard)/content/page.tsx` | `CONTENT_TOOL_ENTRIES/quickEntries.brand` | tint / 18-20 |
| 移动端底部 Tab | `shell/mobile-shell.tsx` | `MOBILE_TABS[].brand` | tint / 19 |
| WorkbenchCenter advancedLinks | `v2/workbench-center.tsx` | `WorkbenchLink.brand`(全站子页「全部功能」) | tint / 18-20(随行 icon 色) |

---

## 5. 语义映射表(维护入口)

### 5.1 MINE_BRAND(`brand-icons.tsx` 导出,设置面板 + 我的菜单共用)
平台账号→`phoneOk` · 多账号矩阵→`avatarGrid` · 账号与团队→`member` · 我的记忆→`knowledge` · 账号与安全→`user` · AI 服务→`botHead` · 通知设置→`notifications` · 显示设置→`textAa` · 文件存储/数据管理→`database` · 桌面设置/电脑本机→`desktop` · 合规→`shield` · 数据用量→`reports` · 任务证据→`accountHealth` · 引擎权限→`key` · AI 工件/案例→`archive` · 数据服务管理→`chip` · 商业就绪→`rocket`

移动端:客户管理→`customer` · 手机端能力→`phone` · 企微 CRM→`wecom` · BOSS→`team`(member) · 增长报告→`reports` · 工作流→`workflows` · 账号健康→`accountHealth` · 监控/趋势→`eye` · 合规→`shield`

### 5.2 CHANNEL_BRAND(message/page.tsx 内)
统一收件箱→`inbox` · 客服机器人→`botHead` · 抖音→`douyin` · 视频号→`channelVideo` · 微信→`wechat` · 企微→`wecom` · AI 回复→`replyPen` · 互动记录→`historyClock` · 群发→`groupSend`

### 5.3 其它注入点
内容页/增长卡/CRM/设置页等为页面内 `brand:` 字面量,见 §4 表格。

---

## 6. 保留线性(刻意,勿品牌化)

| 位置 | 原因 |
|---|---|
| ⌘K 命令面板(51 行 × 17px) | 高频逐行扫描,实心图形=视觉噪声 |
| 行内操作按钮(删除/刷新/关闭/上传/外链…) | 与文字同行、密度高,面性化会糊 |
| @heroui/react 内置图标 | 库级默认,需 provider 干预 |
| 表格/标签 12-14px 细节 | 低于 18px 可读阈值 |

规则:**入口身份才品牌化;动作/信息密度高的保持线性**。18px 是品牌图形可读下限。

---

## 7. 代码契约

```tsx
import { BrandIcon, type BrandIconName } from "@/components/shell/brand-icons";
import { brandForMineKey } from "@/components/shell/brand-icons"; // 设置/菜单行映射

// 白底行/卡:idle
<BrandIcon name="materials" size={32} />
// 金色入口卡:gold
<BrandIcon name="materials" size={32} tone="gold" />
// 彩色 tint 容器内:tint
<BrandIcon name="wechat" size={20} tone="tint" />
```

给某位置接品牌图形的最短路径:
1. `brand-icons.tsx`:确认语义图形存在(union + GLYPHS),没有就补一枚;
2. 数据位注入 `brand` 字段(SceneCard / WorkbenchAction / WorkbenchLink / MOBILE_TABS / 页面数组);
3. 渲染位按容器定 tone(白底 idle / 金卡 gold / 彩色 tint);
4. typecheck + lint + build,浏览器实测 SVG `fill` 是否符合预期色。

---

## 8. 验收清单

- [ ] 无黑块:任何白底上的 idle 图标都是雾紫灰,不是 currentColor 近黑
- [ ] 无突兀金:仅「入口/激活」语境用 gold;行/列表常态用 idle 或 tint
- [ ] 小尺寸(18px)细节可辨,无糊团
- [ ] 亮/暗主题、hover、active 四态过一遍
- [ ] 桌面与移动端同源数据位(Tab/设置/我的)视觉一致
- [ ] 保留线性区未被动(命令面板/行内操作)
- [ ] typecheck + eslint + build 通过

## 9. 变更记录
- 2026-09 v1.0:rail 图标标准落档(见 rail-nav-icon-standard.md)
- 2026-09 v2.0:层一 BrandIcon 66 枚 + 全系统铺开(内容/消息/设置/增长/CRM/移动端)+ 三态色规范;沉淀踩坑教训与接线地图。
