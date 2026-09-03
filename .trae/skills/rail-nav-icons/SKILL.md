---
name: "rail-nav-icons"
description: "Design/maintain the main-navigation rail brand icon set for the JIUZHANG desktop app (faceless solid glyphs, gold-gradient active glow, no background blocks). Invoke when asked to create, change, refine, or audit rail nav icons, add a scene icon, or fix rail icon styling/coordination in ai-content."
---

# Rail Nav Icons（主导航 rail 品牌图标标准）

九章桌面端左侧主导航 rail 图标体系的可复用设计规则。完整标准文档见
`docs/design/rail-nav-icon-standard.md`;本 skill 是可执行要点。

## 何时使用
- 新建/修改/评审 rail 图标,或为 rail 场景新增一枚图标
- 处理 rail 激活态、图标尺寸、颜色、与整体 UI 协调性问题
- 检查 rail 图标是否违反本标准(走查/验收)

## 硬性约束(不可违反)
1. **禁止任何背景容器/色块**:激活与未激活都不画方章、渐变底、圆角块。激活靠"点亮",不靠"贴块"。
2. **禁止普通线性图标冒充 rail 图标**:rail 是全局唯一的面性品牌语系;正文用 IconPark outline / 壳内用 ShellIcon,不混用。
3. **激活 = 金,不是紫**:rail 恒为深紫黑底(`linear-gradient(180deg,#1c1431,#110c1e 88%)`),激活色是金色语言。图标金渐变 `#f0b45c → #c9811f`;指示条与激活文字用 `--kx-gold`。不要用 `--kaypal-v3-accent`(紫)做 rail 激活指示(曾造成金块+紫字+紫条同屏冲突)。
4. **不要"加一版重画"式返工**:历史教训(v1 线性点 / v2 渐变印章 / v3 纯剪影均被否)。图形一旦验收,只做精修,不整组换文法。

## 设计文法
- SVG `viewBox 0 0 24 24`,渲染 24px,`aria-hidden`+`focusable=false`。
- 图形结构 = 主体(一眼可读)+ 第二层细节(精致感来源),每枚细节 1-3 个元素,22px 下仍清晰:
  - growth:三柱渐升 + 上升趋势线/端点
  - customer:人像(主)+ 右后第二人(透明)+ 领口 V
  - content:文档 + 文字行 ×2 + 笔尖
  - interaction:气泡 + 三点 + 已读勾
  - execution:卡片 + 进度条 + 完成勾
  - device:平板 + 摄像头点 + 屏内容行
  - assistant:四角星 + 伴星(透明)+ 中心点
  - mine:人像 + 领口 V
- 颜色规则:未激活主体 `currentColor`(灰)、细节 `opacity .32`;激活主体金渐变、细节 `#fff` 不透明。
- 实现集中在 `frontend/src/components/shell/rail-icons.tsx`(`RailIcon`/`ThemeToggleIcon`),不要复制 SVG 到业务页。

## 代码契约要点
- 场景按钮:`<RailIcon name={scene.railName} size={24} active={activeScene===scene.key} />`
- **「我的」按钮**:点击只开设置面板不跳路由时,激活判定必须是 `mineActive = activeScene==="mine" || settingsOpen`,否则图标/指示条不会点亮(曾有真缺陷)。
- 主题切换钮用 `ThemeToggleIcon`(同款金渐变描边),不用普通线性 sun/moon。

## 验收清单
- [ ] 无背景容器/色块(激活+未激活)
- [ ] 激活:金渐变 + 白细节 + 金指示条 + 无渐变底
- [ ] 未激活灰、细节可辨
- [ ] 亮/暗主题、hover、激活、面板展开四态通过
- [ ]「我的」开面板时点亮
- [ ] 22/24px 渲染细节不糊
- [ ] typecheck + eslint + build 通过
