# 按钮系统规范 v1.0

> 状态:2026-09 定稿(经全站按钮盘点后收敛)
> 适用范围:九章桌面 + 移动端全部按钮/可点击 CTA
> 相关文件:
> - `frontend/src/components/v2/ui-kit.tsx` —— V2PrimaryButton/V2GhostButton/V2DangerButton
> - `frontend/src/components/shell/shell.css` / `desktop-vp.css` —— 桌面壳按钮
> - `frontend/src/components/shell/mobile.css` —— 移动端按钮
> - `frontend/src/app/globals.css` —— 全局 token 与收编
> - @heroui/react `Button`(56 文件裸用,默认 md)

---

## 1. 问题基线(盘点结论 · 为什么要统一)

- 高度档位 8+ 种混用:≈24/28/30-32/36/40/41/44/50-52,同义 CTA 横跨 36/40/44;`py-2`(≈36)与 `py-2.5`(≈40)同文件并存。
- 桌面 kx 壳 / 移动 mx 壳 / kaypal-v3 手写 / heroui 四套并行,互不共享。
- 带图规则混乱:"新建"存在 13px svg、13px Plus、16px、纯文字四种做法;行内按钮图标 13-20 乱飞。
- 主题靠打补丁:globals 用 !important 二次扫字号/字重/圆角,「看到类名 ≠ 最终高度」。
- 金/紫双主色:主按钮已金化(token 层),但 agent-cockpit 紫渐变 default、login-preview 紫渐变仍存在。

## 2. 档位规则(核心)

### 2.1 高度三档

| 档 | 高度 | 场景 | 对应现有 |
|---|---|---|---|
| `sm` | **32px** | 表格/列表行内操作、次级小按钮、筛选 chips 旁操作 | heroui size=sm、agent-cockpit sm、growth-console |
| `md` | **40px** | 常规 CTA、页面主操作、对话框按钮 | V2 三件套默认、.kx-btn 系、heroui 默认 |
| `lg` | **48px** | 页面头号 CTA、登录/引导、空态主操作 | login 主钮(50→48)、ops min-h-11(52→48) |

- **移动端触控下限**:任意档位渲染时 `min-height ≥ 44px`(触控目标规范)仅作用于 ≤768px;移动端视觉档位向上取整到最近档(sm 视觉 32→实际 44 命中)。
- chip/标签(≈28)不属于按钮档,归徽标体系。

### 2.2 尺寸实现约定
- 用 `min-height` + 内联 flex 居中实现,勿用 `py` 猜测高度。
- 字号:sm=13 / md=14 / lg=15(行内 500-600,主按钮 600-700,禁用全局 !important 二次扫覆盖组件内声明)。
- 圆角:sm/md 用 `var(--kaypal-v3-radius-sm)`;lg 用 `var(--kaypal-v3-radius)`。

## 3. 变体与配色

| 变体 | 填充 | 用途 |
|---|---|---|
| primary | `--kaypal-v3-gradient-primary`(金渐变,已统一) | 主 CTA/确认 |
| ghost | paper 底 + border | 次级/取消/浏览 |
| danger | danger 描边(ghost 语义)或 danger 实底(确认破坏时) | 删除/危险 |
| 链接式(text) | 无底 underline | 行内重试/次要跳转(非按钮档,允许) |

- **紫色不得作为按钮实底主色**(金为主操作色)。紫色保留给:logo、头像、选中态、品牌文字、导航激活。
- 残留需清理:agent-cockpit `ui/button.tsx` 紫渐变 default、login-preview 紫渐变(见 §7)。

## 4. 图标规则(核心)

- **标准按钮内图标统一 16px**(行内/紧凑按钮也 16,不因 sm 缩小到 13-14)。
- **带图语义规则(固定)**:
  - 必带图:新建/新增/创建、刷新、导出、导入、上传、下载、发送、搜索、返回、添加
  - 必不带图:取消、关闭、删除、保存(纯文字)、确定
  - 可选:编辑、查看、更多(带图标表达方向性)
- 图标置左(gap 6-8px);仅"前进/去往"类图标可置右。
- **BrandIcon(品牌图形)禁止进标准按钮内**,它只进卡片/宫格/行容器(入口身份)。按钮内统一线性 16px(IconPark/lucide)。
- loading:替换图标为同尺寸 spinner 或加 `animate-spin`,保持文字占位。
- 图标组件包裹 16px:`h-4 w-4` 或 `size={16}`。

## 5. 组件契约

V2 三件套新增 `size?: "sm" | "md" | "lg"`(默认 md),签名:
```tsx
<V2PrimaryButton size="md" icon={Plus}>新建客户</V2PrimaryButton>
```
- `icon?: LucideIcon` → 渲染 16px;`loading` → spinner。
- 旧调用(无 size)保持 md 视觉不变,可渐进迁移。

CSS 类统一(桌面壳):
```css
.kx-btn          /* 基类,md 40 */
.kx-btn-primary / .kx-btn-ghost / .kx-btn-danger  /* 40 */
.kx-btn-sm       /* sm 32 基类 */
.kx-btn-sm-primary / .kx-btn-sm-ghost
.kx-btn-lg       /* 新增,lg 48 */
```

移动端保留 `.mx-btn-gold/.mx-btn-danger`(44 触控),但**禁止再被内联 style 缩小**(盘点发现 `mx-btn-gold + fontSize:12/padding:7px 12px` 缩到 ≈26 —— 违规)。小号场景改走 sm 档(44 命中)。

## 6. 使用决策表(新按钮先查这表)

| 位置 | 档位 | 变体 | 图标 |
|---|---|---|---|
| 页面头号 CTA(新建获客任务/去生成/去发布) | lg(移动 44) | primary | 有(语义带图) |
| 区块主操作 | md | primary | 按语义 |
| 对话框底按钮 | md | primary + ghost | 确认无图/取消无图 |
| 表格行操作 | sm | ghost | 按语义(编辑/删除规则) |
| 空态主操作 | lg | primary | 有 |
| 筛选 chips | 非按钮(28 chip) | — | — |

## 7. 残留清理清单(后续分批)
- [ ] agent-cockpit `ui/button.tsx`:default 变体紫渐变 → 金(或映射 token);其 size h-8/9/10 → sm 32/md 40/lg 48
- [ ] login-preview 主钮紫渐变 50 → 金 lg 48
- [ ] 页面内 `mx-btn-gold` + inline 缩小写法(≈26/30) → 移除 inline,用档位类
- [ ] 手写重复 V2 实现的空态 CTA(publish-center 422 等) → 换 V2PrimaryButton
- [ ] 行内图标 13/14/15 → 统一 16(语义带图处)
- [ ] heroui Button:`size` 显式化(default→md 或按表),startContent 图标统一 16
- [ ] globals 二次扫(1514/1895):改为不覆盖组件内档位/字重声明的收编

## 8. 验收清单
- [ ] 任意页面同语义 CTA 高度一致(36/44 混排消除)
- [ ] 按钮高度只出现 32/40/48(+移动 44 命中)
- [ ] 带图规则按 §4 语义表执行,按钮内图标均 16
- [ ] BrandIcon 不出现在标准按钮内
- [ ] 金为主色,无紫实底按钮残留(§7 项逐步清零)
- [ ] hover/active/loading/disabled 四态齐全

## 9. 变更记录
- 2026-09 v1.0:三档 32/40/48 + 16px 图标语义规则定稿;主按钮金化落地。
