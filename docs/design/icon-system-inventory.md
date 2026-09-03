# 九章图标系统盘点与分层清单

> 生成:2026-09 · 扫描范围:`frontend/src`(719 个 ts/tsx 文件,已剔除注释与 .design)
> 配套数据:`docs/design/icon-inventory.json`(433 个 import 名 → 使用文件全集)

## 0. 一句话结论

全库是「**1 套面性品牌(rail)+ 3 套同源线性**」结构。统一不是"全部换成 rail 面性图形"(行内 12-16px 面性会糊),而是**分层统一**:
- **品牌图形层**:场景/入口级图标(rail 8 枚 + 入口/大卡若干)→ rail 文法(无容器、细节、金点亮);
- **统一线性层**:行内/按钮/徽标/表格(≈其余)→ 收编到同一线性规范(24 网格、stroke 1.8、圆头、currentColor),消除 48/24 网格混用与散装手绘;
- 颜色分层:金(激活/品牌)、灰(currentColor/语义灰)、tint 彩色(容器)。

## 1. 来源矩阵

| 来源 | 载体 | 数量 | 形态 | 规模 |
|---|---|---|---|---|
| RailIcon | `shell/rail-icons.tsx` 自绘 | 8 + ThemeToggle | 面性、金渐变激活 | 仅 app-shell |
| ShellIcon | `shell/icons.tsx` | 64 name(30 PARK / 34 自绘) | 线性双轨 | 15 个生态文件 |
| IconPark 适配层 | `@/components/iconpark` | **433 个 import 名**(导出≈236 常用) | 强制 outline / 48 网格 | 2400+ 引用点 |
| lucide-icon-compat | `lucide-icon-compat.tsx` | ~160 个 solar/fa 映射 key(在用 35) | outline | 11 文件 |
| 手绘内联 `<svg>` | 17 个业务文件 | ~51 处(小图标 10 文件) | 24 网格线性 stroke2-2.4 | 游离散装 |
| lucide-react / heroicons / tabler / antd | — | **0 残留** | — | — |
| @heroui/react 内置 | 组件库内部 | 关闭/展开/加载等 | — | 静态不可扫(盲区) |

## 2. IconPark(适配层)高频 Top 30

按「本地名 → 文件数 / 出现次数」:
ArrowLeft 69/150 · CheckCircle2 72/141 · RefreshCw 59/97 · ArrowRight 51/88 · Loader2 44/76 · Sparkles 41/64 · Search 33/61 · ShieldCheck 33/50 · FileText 32/61 · RefreshCcw 32/53 · ShieldAlert 29/52 · XCircle 30/47 · AlertTriangle 30/45 · Plus 24/44 · BellRing 20/44 · MessageSquareText 25/41 · Save 24/39 · Database 20/39 · Send 23/38 · Trash2 23/36 · Clock 17/35 · Download 20/31 · Target 19/30 · Users 15/25 · X 17/24 · TrendingUp 16/24 · TriangleAlert 21/23 · Inbox 14/22 · ImageIcon 12/22 · RotateCcw 16/20

(433 名完整名单与文件见 `icon-inventory.json`;Top 60 明细见《rail 图标标准》变更记录审计附录)

## 3. ShellIcon 全集(64 name)

**PARK(经 IconPark,48 网格线性)**:home · users · user · messageSq · chat · wechatBubble · botHead · replySq · megaphone · fileText · history · phone · cpu · search · sun · moon · logout · inboxTray · recordList · groupSend · videocam · filmRoll · playButton · movieCamera · collectPic · sendUp · calendarPlan · fetchDoc · checkCircle? · play?(PARK 口径以 icons.tsx 为准,共 30)

**自绘 PATHS(24 网格线性 stroke1.8)**:wallet · briefcase · pen · message · mic · target · rocket · alert · chart · clipboard · database · layers · download · trending · bulb · video · archive · sparkles · settings · file · bell · wecomBubble · channelCircle · keyboard 等(共 34)

**未使用兜底 11**:chatRound · botSq · check · bot · send · music · play · grid · rss · gauge · listChecks(rail 场景语义已由 RailIcon 取代)

使用高频场景:command-palette(入口图 20+)、mobile-shell/tab、nav-registry(业务目录 40 入口)、content/message/page、settings-nav-panel、Ticker、ai-assistant。

## 4. 手绘内联 `<svg>`(17 文件 / ~51 处)

小图标(UI,12-20px):`publish-center.tsx`×5 · `mine/page.tsx`×4(mx-chev 灰) · `topics-center.tsx`×3 · `distribution-articles.tsx`×2 · `distribution-tasks.tsx`×2 · `topic-form.tsx`×2 · `article-list.tsx` · `scrape/page.tsx` · `demo/video-studio` · `ai-assistant.tsx`
混合:content/page.tsx×11 · message/page.tsx×7 · agent-workbench×5
中大/图形:today-center(趋势图) · brand-logo · mobile-tab-bar · v2/ui-kit(折线组件)
共同特征:24 网格、`fill:none stroke:currentColor`(部分硬编码 `#b9c5d4`)、stroke 2-2.4 圆头 —— 属 ShellIcon 自绘 PATHS 的"散装版"。

## 5. 分层统一方案(建议)

### 层一 · 品牌图形层(rail 文法:无容器 + 细节 + 金点亮)
- rail 8 枚(已完成定稿)+ ThemeToggle。
- **候选升级**:nav-registry 一级业务目录入口 / ScenePage 大卡 icon / 设置面板一级项 —— 这些是"图标即入口身份"处,可吸收 rail 文法。**数量建议 ≤ 24 枚**,逐枚手绘,不进 IconPark。
- 已验收的 rail 标准见 `rail-nav-icon-standard.md` 与 `.trae/skills/rail-nav-icons`。

### 层二 · 统一线性层(小尺寸通用)
- 目标:行内/按钮/徽标/表格图标统一到「24 网格 outline、stroke 1.8、圆头、currentColor、尺寸三档 16/20/24」。
- 消除:48 网格(IconPark 适配)/24 网格(自绘)混用导致的粗细观感差;散装手绘 svg(尤其 `#b9c5d4` 硬编码灰)收编为统一组件或语义 token。
- 语义去重先行:"消息/气泡"(Message/messageSq/chat/wecomBubble/groupSend…)、"视频"(videocam/filmRoll/playButton/movieCamera…)、"播放"等多轨收敛到单一轨道。

### 层三 · 颜色规范
- 金(激活/品牌高亮,rail)、灰(currentColor 中性)、tint 彩色(容器底色,不在图标本体)。
- `#b9c5d4` 等硬编码灰收编为 token。

## 6. 执行注意
- @heroui 内置图标为静态扫描盲区,需库级 provider 干预(若用户在意)。
- 本清单为"统一前基线";任何批量替换前先由设计预览定文法,勿直接全局替换(433 枚规模大、回归风险高)。
