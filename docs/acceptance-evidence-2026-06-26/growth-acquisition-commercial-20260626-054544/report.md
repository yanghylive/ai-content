# 增长获客 7 页商用验收结果

- 生成时间：2026-06-26T05:54:34.847Z
- 前端地址：http://localhost:3010
- API 地址：http://localhost:3011/api
- 视口：desktop 1440x1000 / laptop 1365x900 / narrow 768x1024
- 汇总：PASS=2 WARN=2 BLOCKED=0 FAILED=1

## 结果明细

| 状态 | 范围 | 说明 | 下一步 | 证据 |
| --- | --- | --- | --- | --- |
| WARN | auth | No auth cookie/session token provided; protected routes may redirect to login. | - | - |
| PASS | setup | Playwright loaded from ../backend/node_modules/playwright | - | - |
| PASS | setup | Evidence directory: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-054544 | - | - |
| WARN | auth | /auth/me did not accept the browser cookie: HTTP 0 page.goto: Timeout 30000ms exceeded.<br>Call log:<br>[2m  - navigating to "http://localhost:3010/login", waiting until "domcontentloaded"[22m<br> | 如果后续路由跳登录页，请提供当前后端认可的 session token/cookie；SQLite 临时登录不适用于 PostgreSQL 后端。 | - |
| FAILED | unexpected error | page.setViewportSize: Target page, context or browser has been closed<br>    at /Users/yanghy/Documents/New project/ai-content/scripts/growth-acquisition-acceptance.mjs:154:16 | 修复脚本异常、依赖或本地服务后重新执行。 | - |

