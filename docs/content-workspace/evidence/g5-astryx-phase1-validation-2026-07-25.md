# G5 Astryx 第一阶段验证记录

日期：2026-07-25

状态：`accepted`。基础设施、登录页代码迁移和三视口视觉证据均已完成，本记录构成 UX-14 第一阶段最终验收。

## 本阶段范围

- 实际安装并固定 `@astryxdesign/core`、`@astryxdesign/theme-neutral` 和 `@astryxdesign/cli` 0.1.7。
- 接入 Astryx reset、core CSS、neutral theme CSS 和根 Theme Provider。
- 登录页呈现树迁移为 Astryx `AppShell`、`Grid`、`Stack`、`Card`、`Button`、`Banner`、`Spinner`、`Heading`、`Text` 和 `Center`。
- 保留原登录授权状态机、`next` 深链校验、Electron 设备元数据和六种页面状态。
- 未迁移仪表盘外壳和内容工作区；这些路由继续使用现有 HeroUI 兼容层，功能入口没有删除。

## 备份

- 文件：`/Users/yanghy/Documents/New project/ai-content-backups/astryx-phase1-pre-20260724-235406.tar.gz`
- SHA-256：`9e959eb746a7148ad4faad942041eab52b243cdc24ba124b9a02dd7f711bf01e`
- 权限：`0600`

## Astryx CLI 记录

- CLI：`0.1.7`
- `astryx build`：用于确认先迁移 shell/navigation 基础和页面模板的实施顺序。
- `astryx template`：检查 `shell-nav`、`login-split`、`editor` 的 skeleton 契约。
- `astryx component`：检查 AppShell、TopNav、SideNav、MobileNav、Layout、Button、Card、Stack、Grid、Banner、Spinner、Text 和 Heading。
- `astryx docs`：检查 getting-started、theme 和 migration 指引。
- `astryx doctor`：7 pass、0 warn、0 fail、1 info。

## 兼容处理

`@astryxdesign/theme-neutral/built` 0.1.7 的 ESM 入口引用扩展名缺失的 `./icons`，Node 会返回 `ERR_MODULE_NOT_FOUND`。应用导入同包的 source theme 对象，并设置 `__built: true` 使用已经全局导入的 `theme.css`；生产构建通过，浏览器不再进行运行时样式注入。

主题桥接使用 hydration 快照：服务端和第一次客户端渲染均按默认深色输出，挂载后再同步用户主题，避免 Astryx wrapper 的 `className` 和 `data-theme` hydration mismatch。

## 自动验证

- TypeScript：通过。
- 触及文件 ESLint：通过。
- Astryx migration guard：通过。
- 内容工作区合同门禁：通过；64/64 workspace tests 通过。
- 契约守卫定向测试：25/25 通过。
- 导航零损失守卫：通过；71/68 基础叶子、54/54 路由别名，测试 6/6 通过。
- Next.js 16.1.6 Turbopack 生产构建：通过；142 个路由完成静态生成。

## 3010 运行时验证

- `http://localhost:3010` 服务在线，登录深链 HTTP 200。
- 已登录内容工作区在 1280 x 720 下完成全局样式回归：`data-astryx-theme=neutral`，页面无横向溢出，刷新后的新增 console error/warning 为 0。
- 截图：`docs/content-workspace/evidence/g5-astryx-global-workspace-smoke-1280.jpg`。
- 未登录登录页在 390 x 844、1024 x 768、1440 x 900 下均为 `data-astryx-theme=neutral`，实际视口匹配，无横向溢出、无关键文本溢出，console error/warning 为 0。
- 截图：`docs/content-workspace/evidence/g5-astryx-login-390x844.jpg`、`docs/content-workspace/evidence/g5-astryx-login-1024x768.jpg`、`docs/content-workspace/evidence/g5-astryx-login-1440x900.jpg`。
- 人工检查确认：移动端登录卡先于价值说明；1024 和 1440 为双栏；按钮、标题和底部文案无互相遮挡。

## 仍未迁移的范围

- 仪表盘 AppShell、SideNav、MobileNav 与内容工作区正文呈现尚未迁移到 Astryx，不得声明整体前端迁移完成。
- HeroUI 继续作为未迁移路由的兼容层，直到后续活动工单逐页替换。

## 下一步门禁

另开活动工单迁移仪表盘 AppShell、SideNav 和 MobileNav，并继续以导航零损失守卫约束 71 个现有入口。
