# DESIGN.md — JIUZHANG AI 智能运营系统

参考品牌：**Linear**（结构/密度/导航）× **Stripe**（排版质感/阴影）× **Raycast**（命令栏）。
映射到现有 kaypal-v3 双主题令牌，不另起色板。AI 代理生成任何 UI 时必须先读本文件。

## 1. Visual Theme & Atmosphere

工具型运营工作台的视觉哲学：**安静、致密、可预测**。界面是操作员的工作台而非营销页——所有视觉能量服务于"下一步做什么"。

- 关键词：致密网格、扁平表面、语义色克制、动效仅反馈状态
- 光影：Light 模式 1 层薄阴影 + 0.5px 发丝边框；Dark 模式以表面明度分层、无阴影
- 禁止：渐变标题、装饰插画、大面积品牌色块、玻璃拟态

## 2. Color Palette & Roles

主色继承项目品牌紫（Linear 紫同族），语义色与 v3 令牌一致。

| 角色 | Light | Dark | CSS 变量 | 用途 |
|---|---|---|---|---|
| Primary | #7C5CF0 | #8B6FF5 | `--kaypal-v3-accent` | 主按钮、当前导航、链接、focus ring |
| Primary Ink | #5B3FD4 | #B7A6F8 | `--kaypal-v3-accent-ink` | 强调文字 |
| Primary Soft | #EDE8FD | #2B2735 | `--kaypal-v3-accent-soft` | 选中行底、徽章底 |
| Canvas | #F7F5FA | #141218 | `--kaypal-v3-canvas` | 页面背景 |
| Surface | #FFFFFF | #1C1A22 | `--kaypal-v3-surface` | 卡片、弹层 |
| Border | #E6E2EF | #2B2735 | `--kaypal-v3-border` | 发丝边框 |
| Text Primary | #1A1820 | #ECEAF2 | `--kaypal-v3-ink` | 标题/正文 |
| Text Secondary | #6B6875 | #9C99A6 | `--kaypal-v3-ink-2` | 次级文本 |
| Success | #1D9E75 | #5DCAA5 | `--kaypal-v3-success` | 趋势↑、完成 |
| Warning | #BA7517 | #EEBD72 | `--kaypal-v3-amber` | 待确认 |
| Danger | #DC2626 | #F09595 | `--kaypal-v3-danger` | 失败、删除 |
| Shadow | rgba(26,24,32,0.06) | 无 | `--shadow-card` | 卡片投影 |

规则：正文对比 ≥4.5:1；语义色只用于状态，不用于装饰；单屏强调色面积 ≤5%。

## 3. Typography Rules

字体栈：`"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`；数字/ID 用 `ui-monospace`。

| 层级 | Size | Weight | Line Height | Letter Spacing | 用途 |
|---|---|---|---|---|---|
| Page Title | 20px | 500 | 28px | -0.2px | 页标题 |
| Section | 14px | 500 | 20px | 0 | 卡标题、分组名 |
| Body | 13px | 400 | 20px | 0 | 正文、列表 |
| Caption | 12px | 400 | 16px | 0.1px | 辅助、时间戳 |
| Metric | 24px | 500 | 32px | -0.5px | 指标数字（tabular-nums） |
| Nav Group | 11px | 500 | 16px | 0.4px | 导航分组标签 |

哲学：只用 400/500 两档字重；层级靠字号与色彩而非加粗堆叠；数字一律 `font-variant-numeric: tabular-nums`。

## 4. Component Stylings

```css
/* Buttons */
.btn-primary{background:var(--kaypal-v3-accent);color:#fff;border:none;border-radius:8px;
  height:32px;padding:0 14px;font-size:13px;font-weight:500}
.btn-primary:hover{background:#6A4BDE}
.btn-primary:active{transform:translateY(1px)}
.btn-secondary{background:var(--kaypal-v3-surface);color:var(--kaypal-v3-ink);
  border:0.5px solid var(--kaypal-v3-border);border-radius:8px;height:32px;padding:0 14px}
.btn-ghost{background:transparent;color:var(--kaypal-v3-ink-2);border-radius:8px;height:32px;padding:0 10px}
.btn-ghost:hover{background:var(--kaypal-v3-accent-soft);color:var(--kaypal-v3-accent-ink)}
/* Cards */
.card{background:var(--kaypal-v3-surface);border:0.5px solid var(--kaypal-v3-border);
  border-radius:12px;padding:16px;box-shadow:var(--shadow-card)}
/* Inputs */
.input{background:var(--kaypal-v3-surface);border:0.5px solid var(--kaypal-v3-border);
  border-radius:8px;height:32px;padding:0 12px;font-size:13px}
.input:focus{outline:none;border-color:var(--kaypal-v3-accent);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--kaypal-v3-accent) 15%, transparent)}
/* Navigation */
.nav-item{height:32px;border-radius:8px;padding:0 10px;font-size:13px;color:var(--kaypal-v3-ink-2);
  display:flex;align-items:center;gap:8px}
.nav-item:hover{background:var(--kaypal-v3-accent-soft)}
.nav-item.active{background:var(--kaypal-v3-accent-soft);color:var(--kaypal-v3-accent-ink);font-weight:500}
/* Badges：语义化，红=需处理，紫=中性计数 */
.badge-danger{background:var(--kaypal-v3-danger);color:#fff;border-radius:99px;
  font-size:11px;padding:0 6px;height:16px;line-height:16px}
.badge-neutral{background:var(--kaypal-v3-accent-soft);color:var(--kaypal-v3-accent-ink);
  border-radius:99px;font-size:11px;padding:0 6px;height:16px;line-height:16px}
/* Modals */
.modal-overlay{background:rgba(20,18,24,0.48)}
.modal{background:var(--kaypal-v3-surface);border-radius:16px;box-shadow:0 24px 48px rgba(20,18,24,0.2)}
```

## 5. Layout Principles

- Spacing：4px 基数 → 4/8/12/16/24/32/48；卡内 12-16，区块间 24，页边距 24-32
- Grid：12 列，gutter 16px；内容 max-width 1280px
- 侧栏：232px（桌面）/ 图标 56px（<1024px）/ 底部抽屉（<640px）
- 留白：致密但不拥挤——行高 ≥ 字号 ×1.5，列表行高 40-48px

## 6. Depth & Elevation

| 层级 | Light | Dark | 场景 |
|---|---|---|---|
| L0 Canvas | #F7F5FA | #141218 | 页面 |
| L1 Surface | #FFF + shadow-card | #1C1A22 | 卡片 |
| L2 Elevated | #FFF + 0 8px 24px rgba(26,24,32,.10) | #24222B | 下拉、popover |
| L3 Overlay | #FFF + 0 24px 48px rgba(26,24,32,.20) | #2A2831 | 模态、命令面板 |

z-index：nav 10 / header 20 / dropdown 30 / modal 40 / toast 50。无毛玻璃。

## 7. Do's and Don'ts

Do：数字带趋势或动作；每条待办给单个主操作；空状态给引导+按钮；图标按钮带 aria-label；动效 ≤150ms 且可关闭。
Don't：不用纯"0"数字占首屏；不给无动作的红点；不写 Title Case/全大写标题；不用渐变文字；不在列表里嵌二级操作堆；不硬编码颜色（一律 var()）。

## 8. Responsive Behavior

| 断点 | 策略 |
|---|---|
| ≥1280 | 全功能：侧栏 232 + 4 指标卡 |
| 1024-1279 | 指标卡 2×2，侧栏折叠为图标 |
| 640-1023 | 单列；待办全宽；命令栏收为图标 |
| <640 | 底部导航 4 组；触区 ≥44px |

字体不随断点缩放（仅布局重排）。

## 9. Agent Prompt Guide

Quick reference：紫主 #7C5CF0、圆角 8/12/16、Body 13px/400、标题 20px/500、间距 4px 基数、双主题 var() 取色。

Prompts：
- "生成指标卡：数字 24px tabular-nums + 12px 趋势行（↑绿/↓红），点击跳列表"
- "生成待办行：32px 语义图标块 + 标题 13/500 + 原因 12/400 + 右置单个 btn-primary"
- "生成导航分组：11px 分组标签 + nav-item 32px，active 用 accent-soft 底"
- "生成 ⌘K 命令面板：L3 弹层，输入框 + 结果列表，键盘可达"
- "空状态：48px 线框图形 + 一句 13px 引导 + btn-secondary"

迭代：先灰度布局后上色；每屏一个强调色焦点；完成后对照第 7 节逐条自检。
