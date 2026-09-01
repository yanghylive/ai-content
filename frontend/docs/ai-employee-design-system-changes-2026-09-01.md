# 3010 前端接入「AI员工」设计系统 — 改动清单

> 日期:2026-09-01 | 基线:`ai-content/frontend` @ 当前 HEAD
> 状态:已完成并验证(npm run build 通过,静态产物已同步 3010 服务)

## 1. 改动总览

| 阶段 | 文件 | 改动类型 | 行数 |
|------|------|---------|------|
| 方案 A | `src/app/globals.css` | 新增 token | +31 |
| 方案 B | `src/app/globals.css` | 面板/暗色适配 | +70 |
| 方案 B | `src/components/v2/ui-kit.tsx` | 组件升级 | ~12 |
| 方案 B | `src/components/shell/shell.css` | 按钮/导航 | ~7 |
| 方案 B | `tailwind.config.ts` | HeroUI 阴影 | ~12 |
| 方案 B | `src/components/ai-employee/capability-workbench.tsx` | 能力页 | ~9 |
| 驾驶舱 | `agent-cockpit-canvas/ui/{button,card,badge}.tsx` | 组件升级 | ~15 |
| 深色调优 | `globals.css` + 3 组件 | 渐变提亮/内高光 token | ~12 |

**影响范围**:212 个 page + 79 个 v2/ui-kit 引用方,全部通过共享层自动生效,零逐页修改。

## 2. 方案 A:Token 补全(仅新增,不改现有值)

`globals.css` `:root` 新增 22 个 `--kaypal-v3-*` token:

- **间距 8 级**:`--kaypal-v3-space-{1-8}`(4px → 64px)
- **阴影 5 级 + glow**:`--kaypal-v3-shadow-{1-5}`、`--kaypal-v3-glow`、`--kaypal-v3-glow-sm`
- **渐变 5 个**:`--kaypal-v3-gradient-{primary,primary-soft,card-stat,avatar,shimmer}`
- **动效 2 条**:`--kaypal-v3-ease-spring`、`--kaypal-v3-dur-smooth`

全部基于品牌紫 `#722ed1` 色阶推导,与现有体系同源。

## 3. 方案 B:视觉升级

### 3.1 `globals.css`

- **`kaypal-v3-panel`**:阴影从单层 `card-shadow` 升级为 `shadow-1`,hover 时边框泛紫 + 阴影升 `shadow-2` + 顶部紫色光泽线渐显(伪元素)
- **`kaypal-v3-page-header`**:阴影同步升级
- **`.dark` 补全 14 个暗色 token**:渐变走深紫系、阴影走黑系、glow 走亮紫系

### 3.2 `v2/ui-kit.tsx`(79 个引用方一次受益)

- **`V2PrimaryButton`**:平涂紫 → 三色渐变 `#9254de → #722ed1 → #531dab` + inset 高光 + 有色 glow 阴影,hover 浮起 1px
- **`V2GhostButton`**:hover 紫色 tint 背景 + 边框变紫 + 文字变紫
- **`inputClass`**:focus ring 从 4px 灰紫 → 紫色 glow(3px 光晕)+ hover 边框变紫
- **`V2StatusChip`**:加状态圆点(::before `bg-current` 点即色)
- **`V2StatCard`**:顶部渐变 accent 线 + hover 阴影升级

### 3.3 `shell.css`

- **`kx-btn-primary`**:平涂 → 渐变 + glow 阴影,hover 浮起 1px
- **`kx-rail-item.kx-active`**:激活态渐变底 + 指示条渐变发光(紫色 glow)

### 3.4 `tailwind.config.ts`

- HeroUI `boxShadow` small/medium/large → `shadow-1/2/3`(明暗两套都改)

### 3.5 `capability-workbench.tsx`(AI员工能力页)

- **`CapabilityCard`**:hover 上浮 + 边框泛紫 + 紫色投影,图标块渐变底 + inset 描边
- **`Metric`**:渐变底卡片 + 顶部彩色 accent 线(按 tone 区分)+ hover 阴影

### 3.6 驾驶舱 `agent-cockpit-canvas/ui/`

- **`button.tsx`**:primary 变体渐变 + glow,`dark:` 前缀适配深色渐变
- **`card.tsx`**:hover 上浮 2px + 边框泛紫 + 紫色投影,圆角 8 → 10px
- **`badge.tsx`**:徽章加状态圆点,asChild 模式保持兼容

## 4. 深浅色双轨适配

| 属性 | 浅色 `:root` | 深色 `.dark` |
|------|-------------|-------------|
| 主按钮渐变 | `#9254de → #722ed1 → #531dab` | `#a87ae0 → #9254de → #722ed1`(提亮) |
| 内高光 `--kaypal-v3-btn-inset` | `rgba(255,255,255,.18)` | `rgba(255,255,255,.08)`(柔和) |
| hover 内高光 `-inset-hover` | `rgba(255,255,255,.22)` | `rgba(255,255,255,.12)` |
| 阴影 | 紫调 rgba(42,36,56) | 黑系 rgba(0,0,0) |
| glow | `rgba(114,46,209,.10)` | `rgba(146,84,222,.16)`(亮紫) |

切换机制:组件统一引用 `var(--kaypal-v3-*)` token,`.dark` 类自动切换。

## 5. 验证结果

- [x] `npm run build` 通过(Next.js 16.3.1,212 页面全量)
- [x] 静态产物已同步(`out/` + `.workbuddy/ai-content-frontend/out`)
- [x] 浏览器实测:今日增长 / AI员工能力页 / 驾驶舱三页正常渲染
- [x] 深浅色切换正常,按钮渐变/内高光跟随变化

## 6. 回滚建议

所有改动集中在 5 个共享文件,可整体 `git revert` 或按文件回滚:

- 只想回滚视觉升级(保留 token 地基):revert 方案 B 提交,保留 globals.css 的 token 新增段
- 只想回滚驾驶舱:revert `agent-cockpit-canvas/ui/` 三个文件
- 完全回滚:revert 全部改动

## 7. 后续可选项

- 驾驶舱 `chat/` 对话区样式未动(如需统一可继续)
- 移动端 `mx-*` 玻璃拟态体系未动(与桌面端共享 token 的差异层,如需对齐可单独评估)
- OKLCH 色阶迁移:本次保留 Hex(避免 `--agent-cockpit-*` HSL 消费层连锁改动),可作为后续独立任务


## 8. 页面覆盖核查(2026-09-01)

**统计方法**:对 212 个 `page.tsx` 做深链 import 追踪(页面 → 组件 → 组件深层,最多 4 层),判断是否消费共享样式(kaypal-v3 / kx-* / mx-* / HeroUI / v2-ui-kit / 渐变按钮等)。

### 覆盖结果

| 分类 | 数量 | 说明 |
|------|------|------|
| ✅ 已覆盖 | 202 | 深链追踪确认消费共享样式,获得全部新质感 |
| 🔀 纯重定向页 | 10 | 无 UI,`redirect()` 到真实页面,无需样式 |
| 🛠 开发工具页 | 1 | `dev-clear-browser-cache`(仅 dev 模式,生产 404) |
| **合计** | **212** | **全部覆盖,无遗漏** |

### 10 个纯重定向页(无需优化)

| 页面 | 跳转目标 |
|------|---------|
| `(dashboard)/page.tsx` | `/today` |
| `compliance-check` | `/compliance` |
| `crm-closer` | `/crm/closer` |
| `crm-connectors` | `/crm/connectors` |
| `crm-import` | `/crm/import` |
| `distribution/compliance` | `/compliance` |
| `engagement/customers` | `/crm` |
| `face-swap` | `/content/face-swap` |
| `intelligence/inbox-processing` | `/intelligence/inbox` |
| `capabilities` | `/capabilities/models` |

### 误报澄清(深链追踪前误判为未覆盖)

- `schedules` / `styles` / `templates` / `apps` — 复用 `v2/resource-center`(49 处共享样式消费),已覆盖
- `content/workspace` — 引用 `V2PrimaryButton`(渐变按钮)+ 3 处共享样式,已覆盖

### 结论

方案 B 的共享层策略生效:一次改 5 个共享文件,212 个页面全部受益,零逐页修改,无遗漏页面。


## 9. 回归验收报告(2026-09-01)

在 OKLCH 色阶迁移 + sparkline + Table/导航补全后执行完整回归验收。

### 9.1 页面渲染检查

| 页面 | 结果 |
|------|------|
| `/today` 今日增长 | ✅ h1/导航正常,913 字符内容 |
| `/apps/ai-employee` 能力页 | ✅ h1「能力与任务入口」正常 |
| `/agent-cockpit-canvas` 驾驶舱 | ✅ h1 + 输入框正常 |
| `/tasks` 任务中心 | ✅ h1 + 表格 8 行渲染 |
| `/growth/reports` 增长复盘 | ✅ h1「增长复盘」+ 表格正常 |
| `/crm` 客户管理 | ✅ h1 + 2247 字符完整内容 |
| `/content` 内容运营 | ✅ h1 + 内容正常 |

### 9.2 深浅色模式

- 浅色:OKLCH 生效 `lab(35.74% 68.69 -85.68)`(原 #722ed1)
- 深色:OKLCH 生效 `lab(47.55% 57.44 -73.07)`(原 #b885f7)
- 渐变 token:OKLCH 三段式,深色提亮档正常

### 9.3 Console 报错扫描

- 全部 error 为 `net::ERR_ABORTED`(SPA 路由切换正常现象)和 API 404(静态环境无后端)
- **零 CSS 样式错误** — OKLCH 迁移无回归

### 9.4 结论

✅ 通过:无样式回归,无功能异常,全部页面正常渲染。

### 9.5 提交记录

| Commit | 内容 |
|--------|------|
| `5d6dba82` | 方案 A+B 主体落地(token + 视觉升级 + 深浅色) |
| `86e5680d` | 覆盖核查报告文档 |
| `be732c46` | Table/导航补全 + sparkline + 全量 OKLCH 迁移 |

## 10. 视觉对齐审计与收尾(2026-09-01)

在驾驶舱 chat 区升级之后,对全站做多轮视觉差距审计,修复所有未对齐细节,并完成最后一项 OKLCH/HSL 色阶迁移。

### 10.1 驾驶舱 chat 区升级(`1ddfe9a2`)

| 元素 | 升级内容 |
|------|---------|
| 发送按钮 | 普通态 → 品牌紫渐变,与全局 CTA 一致 |
| 输入框 | focus-within 紫色 glow 光环,textarea 透明底融入容器 |
| 用户消息气泡 | 纯色块 → 紫渐变气泡(明暗自校准) |
| 建议卡片 | hover 变紫 + 上浮,与 capability-workbench 对齐 |
| 助手消息 | hover 底色 tint,弱化高对比边框 |

### 10.2 品牌紫硬编码 → HSL token 主题化

**问题**:多处阴影/glow/文字硬编码 `rgba(114,46,209,...)` 深紫 RGB,暗色模式下 `primary` token 切亮紫 `#b885f7` 后不跟随,视觉脱节。

**统一方案**:`hsl(var(--agent-cockpit-primary) / alpha)` — 与 Tailwind 语义类同源,明暗自适应。

| Commit | 修复范围 |
|--------|---------|
| `9ef6dd84` | chat 区 3 处 + `ui/button.tsx` 阴影(6 处)+ 输入框 px 冲突 + 停止按钮 destructive 语义 |
| `3810f226` | 驾驶舱 dashboard:error 卡暗色适配、确认按钮 `text-black`、`ui/card.tsx` hover 阴影 |
| `fee59719` | 能力工作台 3 处 + `ui-kit.tsx` 输入框/按钮 3 处 + content/message 移动端 tint + nav-registry |

### 10.3 补全缺失 chart 色阶(`3810f226`)

驾驶舱图表引用 `--chart-1..5` 但全局从未定义(编译产物 0 定义),图表颜色会回退失效。在 `globals.css` 补全品牌紫主导的明暗两套色阶。

### 10.4 `${color}xx` hex-alpha 拼接修复(`910207a3`)

**问题**:8 处用模板字符串 `${color}1f`/`22`/`55`/`1a` 拼 hex 透明度。色值迁移到 `var(--kaypal-v3-*)` 后拼接失效(`var(...)1f` 非法),图标/徽标背景丢失。

**修复**:统一改 `color-mix(in srgb, ${color} 12%, transparent)`(hex 精确映射:1a=10%、1f=12%、22=13%、55=33%)。

涉及:growth-mobile-console、settings/memory、knowledge、publish-center、distribution-tasks、accounts-matrix、mine 共 7 文件。

### 10.5 light-only 页面 token 化(`55c467d2`、`6ccf99ed`)

早期实现的真实页面残留 `rgba(255,255,255,.72)` 白卡 + `#fff` 输入框 + `#6b7a93` 灰字,暗色下刺眼不可读:

| 文件 | 修复 |
|------|------|
| `video-workshop-page-real.tsx` | 表单/进度卡 → `panel-bg`,select/textarea → `field-bg`,灰字 → `muted` |
| `seedance-video/page.tsx` | 同上 3 处白卡 + 输入框 + 历史卡 |
| `copy-compare/page.tsx` | 2 处白卡 + 平台按钮 + 结果行卡 + 变体行 |
| `settings-detail.tsx` | 5 处输入框 `.7` 白底 → `field-bg` |
| `scrape/page.tsx` | **可读性 bug**:白字配浅底 → `ink` |
| `ai-assistant.tsx` | high risk 硬编码 → `danger`/`danger-soft` token |

### 10.6 HeroUI 主题色阶迁移(`41d6face`)

最后遗留项:`tailwind.config.ts` HeroUI 主题 33 处 hex 色阶。

**过程**:先尝试 OKLCH 迁移,对比验证发现 **HeroUI 插件不解析 `oklch()`,静默丢弃整个 primary 主题**(产物中 `--heroui-primary-50..900` 全部缺失),会造成 `color="primary"` 组件渲染损坏。排除 OKLCH。

**最终方案**:hex → **HSL 三元组**(HeroUI 原生格式 + 与 `--agent-cockpit-*` HSL token 同体系),精确转换零视觉回归。产物验证 33 个 primary 变量完整输出,light `primary-600 = 265 63.9% 50%`(#722ed1)、dark `primary-600 = 266.8 87.7% 74.5%`(#b885f7)。

### 10.7 审计结论

- 全站(除 demo 路由,postbuild 删除)视觉对齐完成,无未对齐细节
- 保留的硬编码均属正常:平台品牌色(抖音红/微信绿)、领域语义色(savings 橙/AI 专家粉)、HeroUI `bg-white + dark:` 双轨写法、彩色实底白字按钮
- 共享层策略贯穿始终:修复集中在基础组件与 token,引用方自动受益

### 10.8 完整提交链

| Commit | 内容 |
|--------|------|
| `1ddfe9a2` | 驾驶舱 chat 区统一设计系统视觉 |
| `9ef6dd84` | chat 区阴影/glow 主题化 + 语义清理 |
| `3810f226` | 驾驶舱 dashboard 修复 + chart 色阶补全 |
| `fee59719` | 跨区域品牌紫硬编码主题化(content/message/nav) |
| `910207a3` | `${color}xx` 拼接 → color-mix 统一修复 |
| `55c467d2` | light-only 页面 token 化(video/seedance/copy-compare) |
| `6ccf99ed` | 轮扫修复(ai-assistant/settings/scrape) |
| `41d6face` | HeroUI 主题色阶 hex → HSL 迁移 |
