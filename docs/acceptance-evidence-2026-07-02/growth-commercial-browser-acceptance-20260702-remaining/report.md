# 增长获客 7 页商用验收结果

- 生成时间：2026-07-02T23:34:59.500Z
- 前端地址：http://localhost:3010
- API 地址：http://localhost:3011/api
- 视口：desktop 1440x1000 / laptop 1365x900 / narrow 768x1024
- 汇总：PASS=78 WARN=0 BLOCKED=0 FAILED=6

## 结果明细

| 状态 | 范围 | 说明 | 下一步 | 证据 |
| --- | --- | --- | --- | --- |
| PASS | auth | Created local acceptance session for codex_smoke. | - | - |
| PASS | auth | Loaded 1 auth cookie(s) into 4 origin(s). | - | - |
| PASS | setup | Playwright loaded from ../backend/node_modules/playwright | - | - |
| PASS | setup | Evidence directory: docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining | - | - |
| PASS | auth | /auth/me accepted the browser cookie. | - | - |
| PASS | 获客总览 desktop | required text visible: 增长获客总览 / 商用级增长底座 / 执行记录 / 线索池 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/overview-desktop.png |
| PASS | 获客总览 desktop | expected tables visible: 执行记录 | - | - |
| PASS | 获客总览 desktop | interactive controls detected: 48 | - | - |
| PASS | 获客总览 desktop | no body-level horizontal overflow | - | - |
| FAILED | 自动获客矩阵 desktop | missing required text: 到期计划队列 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/acquisition-desktop.png |
| FAILED | 自动获客矩阵 desktop | missing expected table(s): 到期计划队列 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/acquisition-desktop.png |
| PASS | 自动获客矩阵 desktop | interactive controls detected: 57 | - | - |
| PASS | 自动获客矩阵 desktop | no body-level horizontal overflow | - | - |
| PASS | 获客策略 desktop | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/strategies-desktop.png |
| PASS | 获客策略 desktop | interactive controls detected: 32 | - | - |
| PASS | 获客策略 desktop | no body-level horizontal overflow | - | - |
| PASS | 线索池 desktop | required text visible: 线索池 / 手动补充线索 / 搜索线索 / 展开补充线索 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/leads-desktop.png |
| PASS | 线索池 desktop | expected tables visible: 线索池 | - | - |
| PASS | 线索池 desktop | interactive controls detected: 105 | - | - |
| PASS | 线索池 desktop | no body-level horizontal overflow | - | - |
| PASS | 账号健康 desktop | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/account-health-desktop.png |
| PASS | 账号健康 desktop | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 desktop | interactive controls detected: 35 | - | - |
| PASS | 账号健康 desktop | no body-level horizontal overflow | - | - |
| PASS | 增长复盘 desktop | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/reports-desktop.png |
| PASS | 增长复盘 desktop | expected tables visible: 任务表现 / 账号表现 / 话术表现 / 执行记录 | - | - |
| PASS | 增长复盘 desktop | interactive controls detected: 59 | - | - |
| PASS | 增长复盘 desktop | no body-level horizontal overflow | - | - |
| PASS | 增长工作流 desktop | required text visible: 增长工作流 / 创建商用增长 SOP / 工作流名称 / 模板 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/workflows-desktop.png |
| PASS | 增长工作流 desktop | interactive controls detected: 34 | - | - |
| PASS | 增长工作流 desktop | no body-level horizontal overflow | - | - |
| PASS | 获客总览 laptop | required text visible: 增长获客总览 / 商用级增长底座 / 执行记录 / 线索池 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/overview-laptop.png |
| PASS | 获客总览 laptop | expected tables visible: 执行记录 | - | - |
| PASS | 获客总览 laptop | interactive controls detected: 48 | - | - |
| PASS | 获客总览 laptop | no body-level horizontal overflow | - | - |
| FAILED | 自动获客矩阵 laptop | missing required text: 到期计划队列 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/acquisition-laptop.png |
| FAILED | 自动获客矩阵 laptop | missing expected table(s): 到期计划队列 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/acquisition-laptop.png |
| PASS | 自动获客矩阵 laptop | interactive controls detected: 57 | - | - |
| PASS | 自动获客矩阵 laptop | no body-level horizontal overflow | - | - |
| PASS | 获客策略 laptop | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/strategies-laptop.png |
| PASS | 获客策略 laptop | interactive controls detected: 32 | - | - |
| PASS | 获客策略 laptop | no body-level horizontal overflow | - | - |
| PASS | 线索池 laptop | required text visible: 线索池 / 手动补充线索 / 搜索线索 / 展开补充线索 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/leads-laptop.png |
| PASS | 线索池 laptop | expected tables visible: 线索池 | - | - |
| PASS | 线索池 laptop | interactive controls detected: 105 | - | - |
| PASS | 线索池 laptop | no body-level horizontal overflow | - | - |
| PASS | 账号健康 laptop | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/account-health-laptop.png |
| PASS | 账号健康 laptop | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 laptop | interactive controls detected: 35 | - | - |
| PASS | 账号健康 laptop | no body-level horizontal overflow | - | - |
| PASS | 增长复盘 laptop | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/reports-laptop.png |
| PASS | 增长复盘 laptop | expected tables visible: 任务表现 / 账号表现 / 话术表现 / 执行记录 | - | - |
| PASS | 增长复盘 laptop | interactive controls detected: 59 | - | - |
| PASS | 增长复盘 laptop | no body-level horizontal overflow | - | - |
| PASS | 增长工作流 laptop | required text visible: 增长工作流 / 创建商用增长 SOP / 工作流名称 / 模板 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/workflows-laptop.png |
| PASS | 增长工作流 laptop | interactive controls detected: 34 | - | - |
| PASS | 增长工作流 laptop | no body-level horizontal overflow | - | - |
| PASS | 获客总览 narrow | required text visible: 增长获客总览 / 商用级增长底座 / 执行记录 / 线索池 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/overview-narrow.png |
| PASS | 获客总览 narrow | expected tables visible: 执行记录 | - | - |
| PASS | 获客总览 narrow | interactive controls detected: 39 | - | - |
| PASS | 获客总览 narrow | no body-level horizontal overflow | - | - |
| FAILED | 自动获客矩阵 narrow | missing required text: 到期计划队列 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/acquisition-narrow.png |
| FAILED | 自动获客矩阵 narrow | missing expected table(s): 到期计划队列 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/acquisition-narrow.png |
| PASS | 自动获客矩阵 narrow | interactive controls detected: 48 | - | - |
| PASS | 自动获客矩阵 narrow | no body-level horizontal overflow | - | - |
| PASS | 获客策略 narrow | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/strategies-narrow.png |
| PASS | 获客策略 narrow | interactive controls detected: 23 | - | - |
| PASS | 获客策略 narrow | no body-level horizontal overflow | - | - |
| PASS | 线索池 narrow | required text visible: 线索池 / 手动补充线索 / 搜索线索 / 展开补充线索 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/leads-narrow.png |
| PASS | 线索池 narrow | expected tables visible: 线索池 | - | - |
| PASS | 线索池 narrow | interactive controls detected: 96 | - | - |
| PASS | 线索池 narrow | no body-level horizontal overflow | - | - |
| PASS | 账号健康 narrow | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/account-health-narrow.png |
| PASS | 账号健康 narrow | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 narrow | interactive controls detected: 26 | - | - |
| PASS | 账号健康 narrow | no body-level horizontal overflow | - | - |
| PASS | 增长复盘 narrow | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/reports-narrow.png |
| PASS | 增长复盘 narrow | expected tables visible: 任务表现 / 账号表现 / 话术表现 / 执行记录 | - | - |
| PASS | 增长复盘 narrow | interactive controls detected: 50 | - | - |
| PASS | 增长复盘 narrow | no body-level horizontal overflow | - | - |
| PASS | 增长工作流 narrow | required text visible: 增长工作流 / 创建商用增长 SOP / 工作流名称 / 模板 | - | docs/acceptance-evidence-2026-07-02/growth-commercial-browser-acceptance-20260702-remaining/screenshots/workflows-narrow.png |
| PASS | 增长工作流 narrow | interactive controls detected: 25 | - | - |
| PASS | 增长工作流 narrow | no body-level horizontal overflow | - | - |
| PASS | browser-console | No unexpected browser console errors captured. | - | - |

