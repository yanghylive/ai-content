# 增长获客 7 页商用验收结果

- 生成时间：2026-07-20T03:11:31.467Z
- 前端地址：http://localhost:3010
- API 地址：http://localhost:3011/api
- 视口：desktop 1440x1000 / mobile 390x844
- 汇总：PASS=3 WARN=2 BLOCKED=14 FAILED=0

## 结果明细

| 状态 | 范围 | 说明 | 下一步 | 证据 |
| --- | --- | --- | --- | --- |
| WARN | auth | No auth cookie/session token provided; protected routes may redirect to login. | - | - |
| PASS | setup | Playwright loaded from ../backend/node_modules/playwright | - | - |
| PASS | setup | Evidence directory: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002 | - | - |
| WARN | auth | /auth/me did not accept the browser cookie: HTTP 401 {"success":false,"data":null,"message":"请先登录","timestamp":"2026-07-20T03:10:04.724Z","path":"/api/auth/me","requestId":"c30a2ed9-c40f-4416-a121-91dcbad2c43b"} | 如果后续路由跳登录页，请提供当前后端认可的 session token/cookie；SQLite 临时登录不适用于 PostgreSQL 后端。 | - |
| BLOCKED | 获客总览 desktop | redirected to login (http://localhost:3010/login?next=%2Fgrowth) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/overview-desktop.png |
| BLOCKED | 自动获客矩阵 desktop | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Facquisition) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/acquisition-desktop.png |
| BLOCKED | 获客策略 desktop | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Fstrategies) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/strategies-desktop.png |
| BLOCKED | 线索池 desktop | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Fleads) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/leads-desktop.png |
| BLOCKED | 账号健康 desktop | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Faccount-health) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/account-health-desktop.png |
| BLOCKED | 增长复盘 desktop | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Freports) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/reports-desktop.png |
| BLOCKED | 增长工作流 desktop | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Fworkflows) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/workflows-desktop.png |
| BLOCKED | 获客总览 mobile | redirected to login (http://localhost:3010/login?next=%2Fgrowth) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/overview-mobile.png |
| BLOCKED | 自动获客矩阵 mobile | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Facquisition) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/acquisition-mobile.png |
| BLOCKED | 获客策略 mobile | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Fstrategies) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/strategies-mobile.png |
| BLOCKED | 线索池 mobile | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Fleads) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/leads-mobile.png |
| BLOCKED | 账号健康 mobile | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Faccount-health) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/account-health-mobile.png |
| BLOCKED | 增长复盘 mobile | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Freports) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/reports-mobile.png |
| BLOCKED | 增长工作流 mobile | redirected to login (http://localhost:3010/login?next=%2Fgrowth%2Fworkflows) | 提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。 | docs/acceptance-evidence-2026-07-20/growth-acquisition-commercial-20260720-031002/screenshots/workflows-mobile.png |
| PASS | browser-console | No unexpected browser console errors captured. | - | - |

