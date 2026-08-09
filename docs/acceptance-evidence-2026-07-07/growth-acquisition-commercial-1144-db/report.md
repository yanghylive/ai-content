# 增长获客 7 页商用验收结果

- 生成时间：2026-07-07T16:30:42.280Z
- 前端地址：http://127.0.0.1:3010
- API 地址：http://127.0.0.1:3011/api
- 视口：desktop 1440x1000 / laptop 1365x900 / narrow 768x1024
- 汇总：PASS=72 WARN=0 BLOCKED=0 FAILED=12

## 结果明细

| 状态 | 范围 | 说明 | 下一步 | 证据 |
| --- | --- | --- | --- | --- |
| PASS | auth | Created local acceptance session for kaypal_cmo9p6i5x000a58uckbcyv45u. | - | - |
| PASS | auth | Loaded 1 auth cookie(s) into 4 origin(s). | - | - |
| PASS | setup | Playwright loaded from ../backend/node_modules/playwright | - | - |
| PASS | setup | Evidence directory: docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db | - | - |
| PASS | auth | /auth/me accepted the browser cookie. | - | - |
| FAILED | 获客总览 desktop | missing required text: 执行记录 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/overview-desktop.png |
| FAILED | 获客总览 desktop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/overview-desktop.png |
| PASS | 获客总览 desktop | interactive controls detected: 43 | - | - |
| PASS | 获客总览 desktop | no body-level horizontal overflow | - | - |
| PASS | 自动获客矩阵 desktop | required text visible: 自动获客矩阵 / 创建获客任务 / 到期任务预检 / 获客任务列表 / 安全预检 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/acquisition-desktop.png |
| PASS | 自动获客矩阵 desktop | expected tables visible: 获客任务 | - | - |
| PASS | 自动获客矩阵 desktop | interactive controls detected: 49 | - | - |
| PASS | 自动获客矩阵 desktop | no body-level horizontal overflow | - | - |
| PASS | 获客策略 desktop | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/strategies-desktop.png |
| PASS | 获客策略 desktop | interactive controls detected: 30 | - | - |
| PASS | 获客策略 desktop | no body-level horizontal overflow | - | - |
| PASS | 线索池 desktop | required text visible: 线索池 / 手动补充线索 / 搜索线索 / 展开补充线索 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/leads-desktop.png |
| PASS | 线索池 desktop | expected tables visible: 线索池 | - | - |
| PASS | 线索池 desktop | interactive controls detected: 33 | - | - |
| PASS | 线索池 desktop | no body-level horizontal overflow | - | - |
| PASS | 账号健康 desktop | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/account-health-desktop.png |
| PASS | 账号健康 desktop | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 desktop | interactive controls detected: 25 | - | - |
| PASS | 账号健康 desktop | no body-level horizontal overflow | - | - |
| PASS | 增长复盘 desktop | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/reports-desktop.png |
| FAILED | 增长复盘 desktop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/reports-desktop.png |
| PASS | 增长复盘 desktop | interactive controls detected: 51 | - | - |
| PASS | 增长复盘 desktop | no body-level horizontal overflow | - | - |
| FAILED | 增长工作流 desktop | missing required text: 增长工作流 / 工作流名称 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/workflows-desktop.png |
| PASS | 增长工作流 desktop | interactive controls detected: 32 | - | - |
| PASS | 增长工作流 desktop | no body-level horizontal overflow | - | - |
| FAILED | 获客总览 laptop | missing required text: 执行记录 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/overview-laptop.png |
| FAILED | 获客总览 laptop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/overview-laptop.png |
| PASS | 获客总览 laptop | interactive controls detected: 43 | - | - |
| PASS | 获客总览 laptop | no body-level horizontal overflow | - | - |
| PASS | 自动获客矩阵 laptop | required text visible: 自动获客矩阵 / 创建获客任务 / 到期任务预检 / 获客任务列表 / 安全预检 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/acquisition-laptop.png |
| PASS | 自动获客矩阵 laptop | expected tables visible: 获客任务 | - | - |
| PASS | 自动获客矩阵 laptop | interactive controls detected: 49 | - | - |
| PASS | 自动获客矩阵 laptop | no body-level horizontal overflow | - | - |
| PASS | 获客策略 laptop | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/strategies-laptop.png |
| PASS | 获客策略 laptop | interactive controls detected: 30 | - | - |
| PASS | 获客策略 laptop | no body-level horizontal overflow | - | - |
| PASS | 线索池 laptop | required text visible: 线索池 / 手动补充线索 / 搜索线索 / 展开补充线索 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/leads-laptop.png |
| PASS | 线索池 laptop | expected tables visible: 线索池 | - | - |
| PASS | 线索池 laptop | interactive controls detected: 33 | - | - |
| PASS | 线索池 laptop | no body-level horizontal overflow | - | - |
| PASS | 账号健康 laptop | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/account-health-laptop.png |
| PASS | 账号健康 laptop | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 laptop | interactive controls detected: 25 | - | - |
| PASS | 账号健康 laptop | no body-level horizontal overflow | - | - |
| PASS | 增长复盘 laptop | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/reports-laptop.png |
| FAILED | 增长复盘 laptop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/reports-laptop.png |
| PASS | 增长复盘 laptop | interactive controls detected: 51 | - | - |
| PASS | 增长复盘 laptop | no body-level horizontal overflow | - | - |
| FAILED | 增长工作流 laptop | missing required text: 增长工作流 / 工作流名称 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/workflows-laptop.png |
| PASS | 增长工作流 laptop | interactive controls detected: 32 | - | - |
| PASS | 增长工作流 laptop | no body-level horizontal overflow | - | - |
| FAILED | 获客总览 narrow | missing required text: 执行记录 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/overview-narrow.png |
| FAILED | 获客总览 narrow | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/overview-narrow.png |
| PASS | 获客总览 narrow | interactive controls detected: 36 | - | - |
| PASS | 获客总览 narrow | no body-level horizontal overflow | - | - |
| PASS | 自动获客矩阵 narrow | required text visible: 自动获客矩阵 / 创建获客任务 / 到期任务预检 / 获客任务列表 / 安全预检 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/acquisition-narrow.png |
| PASS | 自动获客矩阵 narrow | expected tables visible: 获客任务 | - | - |
| PASS | 自动获客矩阵 narrow | interactive controls detected: 42 | - | - |
| PASS | 自动获客矩阵 narrow | no body-level horizontal overflow | - | - |
| PASS | 获客策略 narrow | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/strategies-narrow.png |
| PASS | 获客策略 narrow | interactive controls detected: 23 | - | - |
| PASS | 获客策略 narrow | no body-level horizontal overflow | - | - |
| PASS | 线索池 narrow | required text visible: 线索池 / 手动补充线索 / 搜索线索 / 展开补充线索 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/leads-narrow.png |
| PASS | 线索池 narrow | expected tables visible: 线索池 | - | - |
| PASS | 线索池 narrow | interactive controls detected: 26 | - | - |
| PASS | 线索池 narrow | no body-level horizontal overflow | - | - |
| PASS | 账号健康 narrow | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/account-health-narrow.png |
| PASS | 账号健康 narrow | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 narrow | interactive controls detected: 18 | - | - |
| PASS | 账号健康 narrow | no body-level horizontal overflow | - | - |
| PASS | 增长复盘 narrow | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/reports-narrow.png |
| FAILED | 增长复盘 narrow | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/reports-narrow.png |
| PASS | 增长复盘 narrow | interactive controls detected: 44 | - | - |
| PASS | 增长复盘 narrow | no body-level horizontal overflow | - | - |
| FAILED | 增长工作流 narrow | missing required text: 增长工作流 / 工作流名称 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-07-07/growth-acquisition-commercial-1144-db/screenshots/workflows-narrow.png |
| PASS | 增长工作流 narrow | interactive controls detected: 25 | - | - |
| PASS | 增长工作流 narrow | no body-level horizontal overflow | - | - |
| PASS | browser-console | No unexpected browser console errors captured. | - | - |

