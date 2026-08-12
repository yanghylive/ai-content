# UI 规则收敛清单（方案 B：kaypal-v3 作为 Astryx 品牌定制层）

## 目标
四套设计系统收敛为「Astryx 结构 + kaypal-v3 品牌」两层：
- Astryx（@astryxdesign/core + theme-neutral + StyleX）= 组件 API、语义 token 结构、reset
- kaypal-v3 = 品牌视觉（紫 accent #7c5cf0 / 粉 brand #b4236c / 圆角 14/10/6px）
- heroui 退役、mx-* 仅移动端保留

## 落地机制
`src/app/astryx-brand-overrides.css`（已建）：在 Astryx theme.css 之后引入，
把 `--color-*` / `--radius-*` 语义 token 映射到 `var(--kaypal-v3-*)`，明暗自动跟随。

## Token 映射表（Astryx 语义 token ← kaypal-v3 品牌值）

| Astryx token | kaypal-v3 | 值（light） |
|---|---|---|
| --color-accent | accent | #7c5cf0 紫 |
| --color-accent-muted | accent-soft | #ede8fd |
| --color-text-accent / --color-icon-accent | accent-ink | #5b3fd4 |
| --color-background-body | canvas | #f7f5fa |
| --color-background-surface/card/popover | paper | #ffffff |
| --color-background-muted | paper-soft | #efecf4 |
| --color-text-primary | ink | #2a2438 |
| --color-text-secondary | soft-ink | #4d4560 |
| --color-text-disabled | muted | #8b84a0 |
| --color-icon-primary | ink | #2a2438 |
| --color-icon-secondary | soft-ink | #4d4560 |
| --color-border | border | #e6e2ef |
| --color-border-emphasized | border-strong | #cfc8e0 |
| --color-success | success | #16a34a |
| --color-error | danger | #dc2626 |
| --color-warning | amber | #c26a06 |
| --color-skeleton | paper-soft | #efecf4 |
| --radius-inner | radius-xs | 6px |
| --radius-element | radius-sm | 10px |
| --radius-container | radius | 14px |

## 待补（后续批次）
- [ ] 字体映射：Astryx Figtree → kaypal-v3 font-nav（中文字体栈）
- [ ] 阴影：--shadow-low/med/high → kaypal-v3 card-shadow/elevated-shadow
- [ ] 时长：--duration-* → kaypal-v3 dur-micro/short
- [ ] dark 模式逐项核对（kaypal-v3 .dark 值已定义，覆盖层用 var 引用自动跟随）

## 迁移批次（heroui → Astryx，按频次）
- 批次 1：内容工作室（已部分迁，workspace-header/mobile-tools 已换 v2 组件）
- 批次 2：AI 工作台、爆款拆解、CRM
- 批次 3：低频页面
- 每迁一页，scripts/astryx-migration-guard.mjs 加一条检查锁死
